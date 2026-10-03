import type { PoolClient } from "pg";

export type TbAnalysisArtifactGraphResult = {
  artifacts: number;
  evidenceGroups: number;
  evidenceLinks: number;
  artifactRelations: number;
  lineageEdges: number;
};

type CountRow = {
  artifacts: number | string;
  evidence_groups: number | string;
  evidence_links: number | string;
  artifact_relations: number | string;
  lineage_edges: number | string;
};

/**
 * Rebuilds the draft artifact graph for one T&B analysis.
 *
 * This runs inside the Step 6 transaction. Existing typed T&B tables remain the
 * domain stores; the graph makes each record independently addressable by
 * Review, Signal and lineage. Reviewed artifacts are never overwritten.
 */
export async function replaceTbAnalysisArtifactGraph(
  client: PoolClient,
  tbAnalysisId: string
): Promise<TbAnalysisArtifactGraphResult> {
  const reviewed = await client.query<{ reviewed_artifacts: number | string }>(
    `SELECT COUNT(*) AS reviewed_artifacts
     FROM analysis_artifacts
     WHERE tb_analysis_id = $1
       AND review_status <> 'draft'`,
    [tbAnalysisId]
  );
  if (numeric(reviewed.rows[0]?.reviewed_artifacts) > 0) {
    throw new Error(
      "Reviewed analysis artifacts are immutable; create a new analysis revision instead of rerunning Step 6."
    );
  }

  await client.query(
    `DELETE FROM lineage_edges
     WHERE (
       target_type = 'analysis_artifact'
       AND target_id IN (SELECT id FROM analysis_artifacts WHERE tb_analysis_id = $1)
     ) OR (
       source_type = 'analysis_artifact'
       AND source_id IN (SELECT id FROM analysis_artifacts WHERE tb_analysis_id = $1)
     )`,
    [tbAnalysisId]
  );
  await client.query(`DELETE FROM analysis_artifacts WHERE tb_analysis_id = $1`, [tbAnalysisId]);

  await insertDomainArtifacts(client, tbAnalysisId);
  await insertSynthesisArtifacts(client, tbAnalysisId);
  await insertEvidenceGraph(client, tbAnalysisId);
  await insertArtifactRelations(client, tbAnalysisId);
  await projectArtifactLineage(client, tbAnalysisId);

  const counts = await client.query<CountRow>(
    `SELECT
       COUNT(DISTINCT artifact.id) AS artifacts,
       COUNT(DISTINCT evidence_group.id) AS evidence_groups,
       COUNT(DISTINCT evidence_link.id) AS evidence_links,
       COUNT(DISTINCT relation.id) AS artifact_relations,
       COUNT(DISTINCT lineage.id) AS lineage_edges
     FROM analysis_artifacts artifact
     LEFT JOIN analysis_evidence_groups evidence_group
       ON evidence_group.artifact_id = artifact.id
     LEFT JOIN analysis_evidence_links evidence_link
       ON evidence_link.evidence_group_id = evidence_group.id
     LEFT JOIN analysis_artifact_relations relation
       ON relation.source_artifact_id = artifact.id
     LEFT JOIN lineage_edges lineage
       ON lineage.target_type = 'analysis_artifact'
      AND lineage.target_id = artifact.id
     WHERE artifact.tb_analysis_id = $1`,
    [tbAnalysisId]
  );
  const row = counts.rows[0];

  return {
    artifacts: numeric(row?.artifacts),
    evidenceGroups: numeric(row?.evidence_groups),
    evidenceLinks: numeric(row?.evidence_links),
    artifactRelations: numeric(row?.artifact_relations),
    lineageEdges: numeric(row?.lineage_edges)
  };
}

async function insertDomainArtifacts(client: PoolClient, tbAnalysisId: string) {
  await client.query(
    `INSERT INTO analysis_artifacts (
       study_corpus_id, tb_analysis_id, artifact_key, artifact_type,
       source_entity_type, source_entity_id, title, summary, content,
       confidence, position, metadata
     )
     SELECT
       analysis.study_corpus_id,
       finding.tb_analysis_id,
       'finding:' || finding.finding_id,
       'finding',
       'tb_finding',
       finding.id,
       finding.nombre_comercial,
       finding.movilidad_razon,
       jsonb_strip_nulls(jsonb_build_object(
         'finding_id', finding.finding_id,
         'polarity', finding.polarity,
         'layer', finding.layer,
         'frequency', finding.frecuencia,
         'average_intensity', finding.intensidad_promedio,
         'predictive_capacity', finding.capacidad_predictiva,
         'composite_score', finding.score_compuesto,
         'mobility', finding.movilidad,
         'mobility_reason', finding.movilidad_razon,
         'period_start', finding.period_start,
         'period_end', finding.period_end,
         'protagonist_quote', finding.cita_protagonista
       )),
       finding.confidence,
       finding.position_in_layer,
       jsonb_build_object('methodology', 'triggers-barriers', 'contract', 'analysis-artifacts-v1')
     FROM tb_findings finding
     JOIN tb_analyses analysis ON analysis.id = finding.tb_analysis_id
     WHERE finding.tb_analysis_id = $1`,
    [tbAnalysisId]
  );

  await client.query(
    `INSERT INTO analysis_artifacts (
       study_corpus_id, tb_analysis_id, artifact_key, artifact_type,
       source_entity_type, source_entity_id, title, summary, content,
       confidence, position, metadata
     )
     SELECT
       analysis.study_corpus_id,
       recommendation.tb_analysis_id,
       'recommendation:' || recommendation.id::text,
       'recommendation',
       'tb_recommendation',
       recommendation.id,
       COALESCE(
         recommendation.intervencion_sugerida,
         recommendation.recomendacion,
         recommendation.medio_recomendado,
         recommendation.kind
       ),
       COALESCE(
         recommendation.indicador_exito,
         recommendation.razon_estructural,
         recommendation.tono_recomendado
       ),
       to_jsonb(recommendation) - 'created_at',
       finding.confidence,
       recommendation.position,
       jsonb_build_object('methodology', 'triggers-barriers', 'contract', 'analysis-artifacts-v1')
     FROM tb_recommendations recommendation
     JOIN tb_analyses analysis ON analysis.id = recommendation.tb_analysis_id
     LEFT JOIN tb_findings finding ON finding.id = recommendation.finding_id
     WHERE recommendation.tb_analysis_id = $1`,
    [tbAnalysisId]
  );

  await client.query(
    `INSERT INTO analysis_artifacts (
       study_corpus_id, tb_analysis_id, artifact_key, artifact_type,
       source_entity_type, source_entity_id, title, summary, content,
       confidence, position, metadata
     )
     SELECT
       analysis.study_corpus_id,
       insight.tb_analysis_id,
       'insight:' || insight.insight_id,
       'insight',
       'tb_insight',
       insight.id,
       insight.title,
       insight.summary,
       to_jsonb(insight) - 'created_at' - 'updated_at',
       insight.confidence,
       insight.position,
       jsonb_build_object('methodology', 'triggers-barriers', 'insight_kind', insight.kind)
     FROM tb_insights insight
     JOIN tb_analyses analysis ON analysis.id = insight.tb_analysis_id
     WHERE insight.tb_analysis_id = $1`,
    [tbAnalysisId]
  );

  await client.query(
    `INSERT INTO analysis_artifacts (
       study_corpus_id, tb_analysis_id, artifact_key, artifact_type,
       source_entity_type, source_entity_id, title, summary, content,
       confidence, position, metadata
     )
     SELECT
       analysis.study_corpus_id,
       signal.tb_analysis_id,
       'open_signal:' || signal.signal_id,
       'open_signal',
       'tb_open_signal',
       signal.id,
       signal.title,
       signal.why_it_matters,
       to_jsonb(signal) - 'created_at' - 'updated_at',
       signal.confidence,
       signal.position,
       jsonb_build_object('methodology', 'triggers-barriers', 'signal_type', signal.signal_type)
     FROM tb_open_signals signal
     JOIN tb_analyses analysis ON analysis.id = signal.tb_analysis_id
     WHERE signal.tb_analysis_id = $1`,
    [tbAnalysisId]
  );

  await client.query(
    `INSERT INTO analysis_artifacts (
       study_corpus_id, tb_analysis_id, artifact_key, artifact_type,
       source_entity_type, source_entity_id, title, summary, content,
       confidence, position, metadata
     )
     SELECT
       analysis.study_corpus_id,
       opportunity.tb_analysis_id,
       'opportunity:' || opportunity.opportunity_id,
       'strategic_opportunity',
       'tb_strategic_opportunity',
       opportunity.id,
       opportunity.title,
       opportunity.evidence_summary,
       to_jsonb(opportunity) - 'created_at',
       opportunity.confidence,
       opportunity.position,
       jsonb_build_object('methodology', 'triggers-barriers', 'level', opportunity.level)
     FROM tb_strategic_opportunities opportunity
     JOIN tb_analyses analysis ON analysis.id = opportunity.tb_analysis_id
     WHERE opportunity.tb_analysis_id = $1`,
    [tbAnalysisId]
  );

  await client.query(
    `INSERT INTO analysis_artifacts (
       study_corpus_id, tb_analysis_id, artifact_key, artifact_type,
       source_entity_type, source_entity_id, title, summary, content,
       confidence, position, metadata
     )
     SELECT
       analysis.study_corpus_id,
       action.tb_analysis_id,
       'action:' || action.action_id,
       'action',
       'tb_action',
       action.id,
       action.title,
       action.rationale,
       to_jsonb(action) - 'created_at',
       action.confidence,
       action.priority_rank,
       jsonb_build_object(
         'methodology', 'triggers-barriers',
         'target_team', action.target_team,
         'action_kind', action.kind
       )
     FROM tb_action_studio action
     JOIN tb_analyses analysis ON analysis.id = action.tb_analysis_id
     WHERE action.tb_analysis_id = $1`,
    [tbAnalysisId]
  );
}

async function insertSynthesisArtifacts(client: PoolClient, tbAnalysisId: string) {
  await client.query(
    `INSERT INTO analysis_artifacts (
       study_corpus_id, tb_analysis_id, artifact_key, artifact_type,
       title, summary, content, position, metadata
     )
     SELECT
       study_corpus_id,
       id,
       'knowledge_impact',
       'knowledge_impact',
       'Knowledge impact',
       meta_json #>> '{knowledge_impact,business_question_answer}',
       meta_json->'knowledge_impact',
       0,
       jsonb_build_object('methodology', 'triggers-barriers', 'contract', 'analysis-artifacts-v1')
     FROM tb_analyses
     WHERE id = $1
       AND jsonb_typeof(meta_json->'knowledge_impact') = 'object'
       AND meta_json->'knowledge_impact' <> '{}'::jsonb`,
    [tbAnalysisId]
  );

  await client.query(
    `WITH expanded AS (
       SELECT
         analysis.study_corpus_id,
         analysis.id AS tb_analysis_id,
         signal.value AS content,
         signal.ordinality::integer - 1 AS position
       FROM tb_analyses analysis
       CROSS JOIN LATERAL jsonb_array_elements(
         CASE
           WHEN jsonb_typeof(analysis.meta_json->'future_signals') = 'array'
             THEN analysis.meta_json->'future_signals'
           ELSE '[]'::jsonb
         END
       ) WITH ORDINALITY AS signal(value, ordinality)
       WHERE analysis.id = $1
     )
     INSERT INTO analysis_artifacts (
       study_corpus_id, tb_analysis_id, artifact_key, artifact_type,
       title, summary, content, confidence, position, metadata
     )
     SELECT
       study_corpus_id,
       tb_analysis_id,
       'future_signal:' || COALESCE(NULLIF(content->>'signal_id', ''), position::text),
       'future_signal',
       content->>'title',
       content->>'why_it_could_emerge',
       content,
       content->>'confidence',
       position,
       jsonb_build_object('methodology', 'triggers-barriers', 'contract', 'analysis-artifacts-v1')
     FROM expanded`,
    [tbAnalysisId]
  );

  await client.query(
    `INSERT INTO analysis_artifacts (
       study_corpus_id, tb_analysis_id, artifact_key, artifact_type,
       title, summary, content, position, metadata
     )
     SELECT
       study_corpus_id,
       id,
       'market_analysis',
       'market_analysis',
       meta_json #>> '{market_analysis,headline}',
       meta_json #>> '{market_analysis,answer}',
       meta_json->'market_analysis',
       0,
       jsonb_build_object('methodology', 'triggers-barriers', 'contract', 'analysis-artifacts-v1')
     FROM tb_analyses
     WHERE id = $1
       AND jsonb_typeof(meta_json->'market_analysis') = 'object'
       AND meta_json->'market_analysis' <> '{}'::jsonb`,
    [tbAnalysisId]
  );

  await client.query(
    `WITH expanded AS (
       SELECT
         analysis.study_corpus_id,
         analysis.id AS tb_analysis_id,
         dive.value AS content,
         dive.ordinality::integer - 1 AS position
       FROM tb_analyses analysis
       CROSS JOIN LATERAL jsonb_array_elements(
         CASE
           WHEN jsonb_typeof(analysis.meta_json->'evidence_deep_dives') = 'array'
             THEN analysis.meta_json->'evidence_deep_dives'
           ELSE '[]'::jsonb
         END
       ) WITH ORDINALITY AS dive(value, ordinality)
       WHERE analysis.id = $1
     )
     INSERT INTO analysis_artifacts (
       study_corpus_id, tb_analysis_id, artifact_key, artifact_type,
       title, summary, content, position, metadata
     )
     SELECT
       study_corpus_id,
       tb_analysis_id,
       'evidence_deep_dive:' || COALESCE(NULLIF(content->>'finding_id', ''), position::text),
       'evidence_deep_dive',
       content->>'plain_language_title',
       content->>'description',
       content,
       position,
       jsonb_build_object('methodology', 'triggers-barriers', 'contract', 'analysis-artifacts-v1')
     FROM expanded`,
    [tbAnalysisId]
  );

  await client.query(
    `INSERT INTO analysis_artifacts (
       study_corpus_id, tb_analysis_id, artifact_key, artifact_type,
       title, summary, content, position, metadata
     )
     SELECT
       study_corpus_id,
       id,
       'analysis_context:data_os',
       'analysis_context',
       'Data OS context consumed',
       CASE
         WHEN COALESCE((meta_json #>> '{data_os_context,consumed}')::boolean, false)
           THEN 'Structured Study context was available to the analysis.'
         ELSE 'Structured Study context was not available to the analysis.'
       END,
       meta_json->'data_os_context',
       0,
       jsonb_build_object(
         'methodology', 'triggers-barriers',
         'evidence_scope', 'contextual_not_claim_specific'
       )
     FROM tb_analyses
     WHERE id = $1
       AND jsonb_typeof(meta_json->'data_os_context') = 'object'`,
    [tbAnalysisId]
  );
}

async function insertEvidenceGraph(client: PoolClient, tbAnalysisId: string) {
  await client.query(
    `INSERT INTO analysis_evidence_groups (
       artifact_id, group_key, role, label, position, metadata
     )
     SELECT
       artifact.id,
       CASE WHEN artifact.artifact_type = 'analysis_context' THEN 'structured-sources' ELSE 'primary-evidence' END,
       CASE WHEN artifact.artifact_type = 'analysis_context' THEN 'contextual' ELSE 'supporting' END,
       CASE WHEN artifact.artifact_type = 'analysis_context' THEN 'Structured Study sources' ELSE 'Primary evidence' END,
       0,
       jsonb_build_object('contract', 'analysis-artifacts-v1')
     FROM analysis_artifacts artifact
     WHERE artifact.tb_analysis_id = $1`,
    [tbAnalysisId]
  );

  await client.query(
    `INSERT INTO analysis_evidence_links (
       evidence_group_id, source_type, source_id, relation_type,
       evidence_role, quote, locator, position, metadata
     )
     SELECT
       evidence_group.id,
       'mention',
       citation.mention_id,
       'supports',
       CASE WHEN citation.is_protagonist THEN 'protagonist' ELSE 'supporting' END,
       COALESCE(mention.text_snippet, LEFT(mention.text_clean, 500)),
       jsonb_strip_nulls(jsonb_build_object(
         'url', mention.url,
         'published_at', mention.published_at,
         'source_file_id', mention.source_file_id,
         'platform', COALESCE(mention.resolved_platform, mention.platform)
       )),
       citation.position,
       jsonb_build_object(
         'tb_finding_citation_id', citation.id,
         'within_snapshot', true
       )
     FROM analysis_artifacts artifact
     JOIN analysis_evidence_groups evidence_group
       ON evidence_group.artifact_id = artifact.id
      AND evidence_group.group_key = 'primary-evidence'
     JOIN tb_finding_citations citation
       ON artifact.source_entity_type = 'tb_finding'
      AND citation.finding_id = artifact.source_entity_id
     JOIN mentions mention ON mention.id = citation.mention_id
     WHERE artifact.tb_analysis_id = $1`,
    [tbAnalysisId]
  );

  await client.query(
    `WITH governed_refs AS (
       SELECT
         ref.finding_id,
         ref.source_type,
         COALESCE(ref.data_observation_id, ref.data_asset_record_id) AS source_id,
         ref.evidence_role,
         ref.reference_token,
         COALESCE(observation.data_asset_id, record.data_asset_id) AS data_asset_id,
         COALESCE(observation.data_source_id, record.data_source_id) AS data_source_id,
         COALESCE(observation.source_sync_run_id, record.source_sync_run_id) AS source_sync_run_id,
         COALESCE(observation.knowledge_source_id, record.knowledge_source_id) AS knowledge_source_id,
         COALESCE(observation.dataset_key, record.dataset_key) AS dataset_key,
         COALESCE(observation.row_index, record.row_index) AS row_index,
         observation.metric_key,
         observation.metric_value,
         observation.metric_unit,
         COALESCE(observation.period_start, record.period_start) AS period_start,
         COALESCE(observation.period_end, record.period_end) AS period_end,
         COALESCE(observation.entity_type, record.entity_type) AS entity_type,
         COALESCE(observation.entity_key, record.entity_key) AS entity_key,
         COALESCE(observation.lineage, record.lineage) AS source_lineage,
         asset.storage_ref,
         asset.name AS asset_name
       FROM tb_finding_structured_evidence_refs ref
       LEFT JOIN data_observations observation ON observation.id = ref.data_observation_id
       LEFT JOIN data_asset_records record ON record.id = ref.data_asset_record_id
       LEFT JOIN data_assets asset
         ON asset.id = COALESCE(observation.data_asset_id, record.data_asset_id)
     )
     INSERT INTO analysis_evidence_links (
       evidence_group_id, source_type, source_id, relation_type,
       evidence_role, locator, position, metadata
     )
     SELECT
       evidence_group.id,
       governed_ref.source_type,
       governed_ref.source_id,
       'supports',
       governed_ref.evidence_role,
       jsonb_strip_nulls(jsonb_build_object(
         'reference_token', governed_ref.reference_token,
         'asset_id', governed_ref.data_asset_id,
         'asset_name', governed_ref.asset_name,
         'storage_ref', governed_ref.storage_ref,
         'dataset_key', governed_ref.dataset_key,
         'row_index', governed_ref.row_index,
         'metric_key', governed_ref.metric_key,
         'metric_value', governed_ref.metric_value,
         'metric_unit', governed_ref.metric_unit,
         'period_start', governed_ref.period_start,
         'period_end', governed_ref.period_end,
         'entity_type', governed_ref.entity_type,
         'entity_key', governed_ref.entity_key
       )),
       ROW_NUMBER() OVER (
         PARTITION BY evidence_group.id
         ORDER BY governed_ref.reference_token
       )::integer - 1,
       jsonb_strip_nulls(jsonb_build_object(
         'claim_specific', governed_ref.evidence_role = 'claim_specific',
         'data_asset_id', governed_ref.data_asset_id,
         'data_source_id', governed_ref.data_source_id,
         'source_sync_run_id', governed_ref.source_sync_run_id,
         'knowledge_source_id', governed_ref.knowledge_source_id,
         'source_lineage', governed_ref.source_lineage,
         'contract', 'analysis-artifacts-v1'
       ))
     FROM analysis_artifacts artifact
     JOIN analysis_evidence_groups evidence_group
       ON evidence_group.artifact_id = artifact.id
      AND evidence_group.group_key = 'primary-evidence'
     JOIN governed_refs governed_ref
       ON artifact.source_entity_type = 'tb_finding'
      AND governed_ref.finding_id = artifact.source_entity_id
     WHERE artifact.tb_analysis_id = $1
     ON CONFLICT ON CONSTRAINT uq_analysis_evidence_links_source DO UPDATE SET
       evidence_role = EXCLUDED.evidence_role,
       locator = EXCLUDED.locator,
       metadata = analysis_evidence_links.metadata || EXCLUDED.metadata`,
    [tbAnalysisId]
  );

  await client.query(
    `INSERT INTO analysis_evidence_links (
       evidence_group_id, source_type, source_id, relation_type,
       evidence_role, position, metadata
     )
     SELECT
       evidence_group.id,
       'knowledge_source',
       source.source_id,
       'contextualizes',
       'contextual',
       source.position::integer - 1,
       jsonb_build_object('declared_by', 'tb_insights.kb_source_ids')
     FROM analysis_artifacts artifact
     JOIN analysis_evidence_groups evidence_group
       ON evidence_group.artifact_id = artifact.id
      AND evidence_group.group_key = 'primary-evidence'
     JOIN tb_insights insight
       ON artifact.source_entity_type = 'tb_insight'
      AND insight.id = artifact.source_entity_id
     CROSS JOIN LATERAL unnest(insight.kb_source_ids) WITH ORDINALITY AS source(source_id, position)
     WHERE artifact.tb_analysis_id = $1
     ON CONFLICT ON CONSTRAINT uq_analysis_evidence_links_source DO NOTHING`,
    [tbAnalysisId]
  );

  await client.query(
    `INSERT INTO analysis_evidence_links (
       evidence_group_id, source_type, source_id, relation_type,
       evidence_role, locator, position, metadata
     )
     SELECT
       evidence_group.id,
       'data_asset',
       asset.id,
       'available_as_context',
       'contextual',
       jsonb_strip_nulls(jsonb_build_object(
         'name', asset.name,
         'asset_kind', asset.asset_kind,
         'layer', asset.layer,
         'row_count', asset.row_count
       )),
       ROW_NUMBER() OVER (ORDER BY asset.name, asset.id)::integer - 1,
       jsonb_build_object(
         'claim_specific', false,
         'accepted_observations', (
           SELECT COUNT(*)
           FROM data_observations observation
           WHERE observation.data_asset_id = asset.id
             AND observation.quality_status = 'accepted'
         ),
         'accepted_records', (
           SELECT COUNT(*)
           FROM data_asset_records record
           WHERE record.data_asset_id = asset.id
             AND record.quality_status = 'accepted'
         )
       )
     FROM analysis_artifacts artifact
     JOIN analysis_evidence_groups evidence_group
       ON evidence_group.artifact_id = artifact.id
      AND evidence_group.group_key = 'structured-sources'
     JOIN data_assets asset ON asset.study_corpus_id = artifact.study_corpus_id
     WHERE artifact.tb_analysis_id = $1
       AND artifact.artifact_type = 'analysis_context'
       AND asset.status = 'active'
       AND (
         EXISTS (
           SELECT 1 FROM data_observations observation
           WHERE observation.data_asset_id = asset.id
             AND observation.quality_status = 'accepted'
         )
         OR EXISTS (
           SELECT 1 FROM data_asset_records record
           WHERE record.data_asset_id = asset.id
             AND record.quality_status = 'accepted'
         )
       )`,
    [tbAnalysisId]
  );
}

async function insertArtifactRelations(client: PoolClient, tbAnalysisId: string) {
  await client.query(
    `INSERT INTO analysis_artifact_relations (
       source_artifact_id, target_artifact_id, relation_type, position, metadata
     )
     SELECT source_artifact_id, target_artifact_id, relation_type, MIN(position), metadata
     FROM (
       SELECT
         opportunity_artifact.id AS source_artifact_id,
         finding_artifact.id AS target_artifact_id,
         'supported_by'::text AS relation_type,
         link.position,
         jsonb_build_object('source_table', 'tb_opportunity_findings') AS metadata
       FROM tb_opportunity_findings link
       JOIN analysis_artifacts opportunity_artifact
         ON opportunity_artifact.source_entity_type = 'tb_strategic_opportunity'
        AND opportunity_artifact.source_entity_id = link.opportunity_id
       JOIN analysis_artifacts finding_artifact
         ON finding_artifact.source_entity_type = 'tb_finding'
        AND finding_artifact.source_entity_id = link.finding_id
       WHERE opportunity_artifact.tb_analysis_id = $1

       UNION ALL

       SELECT
         action_artifact.id,
         finding_artifact.id,
         'supported_by'::text,
         link.position,
         jsonb_build_object('source_table', 'tb_action_findings')
       FROM tb_action_findings link
       JOIN analysis_artifacts action_artifact
         ON action_artifact.source_entity_type = 'tb_action'
        AND action_artifact.source_entity_id = link.action_id
       JOIN analysis_artifacts finding_artifact
         ON finding_artifact.source_entity_type = 'tb_finding'
        AND finding_artifact.source_entity_id = link.finding_id
       WHERE action_artifact.tb_analysis_id = $1

       UNION ALL

       SELECT
         recommendation_artifact.id,
         finding_artifact.id,
         'supported_by'::text,
         recommendation.position,
         jsonb_build_object('source_table', 'tb_recommendations')
       FROM tb_recommendations recommendation
       JOIN analysis_artifacts recommendation_artifact
         ON recommendation_artifact.source_entity_type = 'tb_recommendation'
        AND recommendation_artifact.source_entity_id = recommendation.id
       JOIN analysis_artifacts finding_artifact
         ON finding_artifact.source_entity_type = 'tb_finding'
        AND finding_artifact.source_entity_id = recommendation.finding_id
       WHERE recommendation.tb_analysis_id = $1

       UNION ALL

       SELECT
         insight_artifact.id,
         finding_artifact.id,
         'supported_by'::text,
         finding_ref.position::integer - 1,
         jsonb_build_object('source_field', 'tb_insights.finding_ids')
       FROM tb_insights insight
       JOIN analysis_artifacts insight_artifact
         ON insight_artifact.source_entity_type = 'tb_insight'
        AND insight_artifact.source_entity_id = insight.id
       CROSS JOIN LATERAL unnest(insight.finding_ids) WITH ORDINALITY AS finding_ref(finding_id, position)
       JOIN tb_findings finding
         ON finding.tb_analysis_id = insight.tb_analysis_id
        AND finding.finding_id = finding_ref.finding_id
       JOIN analysis_artifacts finding_artifact
         ON finding_artifact.source_entity_type = 'tb_finding'
        AND finding_artifact.source_entity_id = finding.id
       WHERE insight.tb_analysis_id = $1

       UNION ALL

       SELECT
         derived_artifact.id,
         finding_artifact.id,
         'supported_by'::text,
         finding_ref.position::integer - 1,
         jsonb_build_object('source_field', 'content.related_finding_ids')
       FROM analysis_artifacts derived_artifact
       CROSS JOIN LATERAL jsonb_array_elements_text(
         CASE
           WHEN jsonb_typeof(derived_artifact.content->'related_finding_ids') = 'array'
             THEN derived_artifact.content->'related_finding_ids'
           ELSE '[]'::jsonb
         END
       ) WITH ORDINALITY AS finding_ref(finding_id, position)
       JOIN tb_findings finding
         ON finding.tb_analysis_id = derived_artifact.tb_analysis_id
        AND finding.finding_id = finding_ref.finding_id
       JOIN analysis_artifacts finding_artifact
         ON finding_artifact.source_entity_type = 'tb_finding'
        AND finding_artifact.source_entity_id = finding.id
       WHERE derived_artifact.tb_analysis_id = $1
         AND derived_artifact.artifact_type = 'future_signal'

       UNION ALL

       SELECT
         dive_artifact.id,
         finding_artifact.id,
         'explains'::text,
         0,
         jsonb_build_object('source_field', 'content.finding_id')
       FROM analysis_artifacts dive_artifact
       JOIN tb_findings finding
         ON finding.tb_analysis_id = dive_artifact.tb_analysis_id
        AND finding.finding_id = dive_artifact.content->>'finding_id'
       JOIN analysis_artifacts finding_artifact
         ON finding_artifact.source_entity_type = 'tb_finding'
        AND finding_artifact.source_entity_id = finding.id
       WHERE dive_artifact.tb_analysis_id = $1
         AND dive_artifact.artifact_type = 'evidence_deep_dive'

       UNION ALL

       SELECT
         market_artifact.id,
         finding_artifact.id,
         'supported_by'::text,
         finding_ref.position::integer - 1,
         jsonb_build_object('source_field', 'content.patterns.related_finding_ids')
       FROM analysis_artifacts market_artifact
       CROSS JOIN LATERAL jsonb_array_elements(
         CASE
           WHEN jsonb_typeof(market_artifact.content->'patterns') = 'array'
             THEN market_artifact.content->'patterns'
           ELSE '[]'::jsonb
         END
       ) AS pattern(value)
       CROSS JOIN LATERAL jsonb_array_elements_text(
         CASE
           WHEN jsonb_typeof(pattern.value->'related_finding_ids') = 'array'
             THEN pattern.value->'related_finding_ids'
           ELSE '[]'::jsonb
         END
       ) WITH ORDINALITY AS finding_ref(finding_id, position)
       JOIN tb_findings finding
         ON finding.tb_analysis_id = market_artifact.tb_analysis_id
        AND finding.finding_id = finding_ref.finding_id
       JOIN analysis_artifacts finding_artifact
         ON finding_artifact.source_entity_type = 'tb_finding'
        AND finding_artifact.source_entity_id = finding.id
       WHERE market_artifact.tb_analysis_id = $1
         AND market_artifact.artifact_type = 'market_analysis'
     ) relation_candidates
     GROUP BY source_artifact_id, target_artifact_id, relation_type, metadata
     ON CONFLICT ON CONSTRAINT uq_analysis_artifact_relations_pair DO NOTHING`,
    [tbAnalysisId]
  );
}

async function projectArtifactLineage(client: PoolClient, tbAnalysisId: string) {
  await client.query(
    `INSERT INTO lineage_edges (
       source_type, source_id, target_type, target_id, relation_type, metadata
     )
     SELECT
       evidence_link.source_type,
       evidence_link.source_id,
       'analysis_artifact',
       artifact.id,
       evidence_link.relation_type,
       jsonb_build_object(
         'evidence_group_id', evidence_group.id,
         'evidence_role', evidence_link.evidence_role,
         'contract', 'analysis-artifacts-v1'
       )
     FROM analysis_artifacts artifact
     JOIN analysis_evidence_groups evidence_group ON evidence_group.artifact_id = artifact.id
     JOIN analysis_evidence_links evidence_link ON evidence_link.evidence_group_id = evidence_group.id
     WHERE artifact.tb_analysis_id = $1
     ON CONFLICT ON CONSTRAINT uq_lineage_edges_relation DO UPDATE SET
       metadata = lineage_edges.metadata || EXCLUDED.metadata`,
    [tbAnalysisId]
  );

  await client.query(
    `WITH governed_sources AS (
       SELECT
         ref.source_type AS target_type,
         COALESCE(ref.data_observation_id, ref.data_asset_record_id) AS target_id,
         COALESCE(observation.data_asset_id, record.data_asset_id) AS data_asset_id,
         COALESCE(observation.data_source_id, record.data_source_id) AS data_source_id,
         COALESCE(observation.source_sync_run_id, record.source_sync_run_id) AS source_sync_run_id,
         COALESCE(observation.knowledge_source_id, record.knowledge_source_id) AS knowledge_source_id,
         COALESCE(observation.lineage, record.lineage) AS source_lineage,
         asset.storage_ref
       FROM tb_finding_structured_evidence_refs ref
       JOIN tb_findings finding ON finding.id = ref.finding_id
       LEFT JOIN data_observations observation ON observation.id = ref.data_observation_id
       LEFT JOIN data_asset_records record ON record.id = ref.data_asset_record_id
       LEFT JOIN data_assets asset
         ON asset.id = COALESCE(observation.data_asset_id, record.data_asset_id)
       WHERE finding.tb_analysis_id = $1
     ),
     candidates AS (
       SELECT
         'data_asset'::text AS source_type,
         data_asset_id AS source_id,
         target_type,
         target_id,
         'contains'::text AS relation_type,
         jsonb_strip_nulls(jsonb_build_object('storage_ref', storage_ref)) AS metadata
       FROM governed_sources
       WHERE data_asset_id IS NOT NULL

       UNION ALL

       SELECT 'data_source', data_source_id, target_type, target_id, 'sourced_from', '{}'::jsonb
       FROM governed_sources
       WHERE data_source_id IS NOT NULL

       UNION ALL

       SELECT 'source_sync_run', source_sync_run_id, target_type, target_id, 'imported_as', '{}'::jsonb
       FROM governed_sources
       WHERE source_sync_run_id IS NOT NULL

       UNION ALL

       SELECT 'knowledge_source', knowledge_source_id, target_type, target_id, 'sourced_from', '{}'::jsonb
       FROM governed_sources
       WHERE knowledge_source_id IS NOT NULL

       UNION ALL

       SELECT
         'import_batch',
         (source_lineage->>'import_batch_id')::uuid,
         target_type,
         target_id,
         'imported_as',
         '{}'::jsonb
       FROM governed_sources
       WHERE COALESCE(source_lineage->>'import_batch_id', '')
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     )
     INSERT INTO lineage_edges (
       source_type, source_id, target_type, target_id, relation_type, metadata
     )
     SELECT source_type, source_id, target_type, target_id, relation_type,
       metadata || jsonb_build_object('contract', 'analysis-artifacts-v1')
     FROM candidates
     ON CONFLICT ON CONSTRAINT uq_lineage_edges_relation DO UPDATE SET
       metadata = lineage_edges.metadata || EXCLUDED.metadata`,
    [tbAnalysisId]
  );

  await client.query(
    `INSERT INTO lineage_edges (
       source_type, source_id, target_type, target_id, relation_type, metadata
     )
     SELECT
       'analysis_artifact',
       relation.source_artifact_id,
       'analysis_artifact',
       relation.target_artifact_id,
       relation.relation_type,
       relation.metadata || jsonb_build_object('contract', 'analysis-artifacts-v1')
     FROM analysis_artifact_relations relation
     JOIN analysis_artifacts source_artifact ON source_artifact.id = relation.source_artifact_id
     WHERE source_artifact.tb_analysis_id = $1
     ON CONFLICT ON CONSTRAINT uq_lineage_edges_relation DO UPDATE SET
       metadata = lineage_edges.metadata || EXCLUDED.metadata`,
    [tbAnalysisId]
  );

  await client.query(
    `INSERT INTO lineage_edges (
       source_type, source_id, target_type, target_id, relation_type, metadata
     )
     SELECT
       artifact.source_entity_type,
       artifact.source_entity_id,
       'analysis_artifact',
       artifact.id,
       'materializes_as',
       jsonb_build_object(
         'artifact_key', artifact.artifact_key,
         'artifact_type', artifact.artifact_type,
         'contract', 'analysis-artifacts-v1'
       )
     FROM analysis_artifacts artifact
     WHERE artifact.tb_analysis_id = $1
       AND artifact.source_entity_type IS NOT NULL
       AND artifact.source_entity_id IS NOT NULL
     ON CONFLICT ON CONSTRAINT uq_lineage_edges_relation DO UPDATE SET
       metadata = lineage_edges.metadata || EXCLUDED.metadata`,
    [tbAnalysisId]
  );
}

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
