import {
  SIGNAL_BACKEND_CONTRACT_VERSION,
  SignalBackendContractError,
  type SignalComparisonV1,
  type SignalFilterV1
} from "@noisia/query-engine";

import { pool } from "@/lib/db";
import type { ResolvedSignalWorkspace } from "@/lib/data-os/signal-workspace";
import { hasSignalWorkspaceReportIdentityV1 } from "@/lib/data-os/signal-strategic-releases";
import {
  assessSignalServingReadiness,
  getSignalServingReadiness
} from "@/lib/data-os/signal-serving";
import {
  loadPublishedSignalOverview,
  mapPublishedSignalActions,
  type PublishedSignalActionRow,
  type PublishedSignalOverview
} from "@/lib/data-os/published-signal-overview";
import type { PublicActionCard, PublicTbFinding } from "@/lib/signal/contracts";
import { SIGNAL_SERVING_CONTRACT_VERSION } from "@/lib/signal/semantics";

export const SIGNAL_TRIGGERS_BARRIERS_CONTRACT_VERSION = "signal-triggers-barriers-v2" as const;

type CutSource = "workspace_release" | "published_output";

export type SignalTriggersBarriersCutV2 = {
  source: CutSource;
  source_id: string;
  output_id: string | null;
  analysis_id: string;
  snapshot_id: string;
  study_corpus_id: string;
  title: string;
  period_start: string;
  period_end: string;
  corpus_revision: number;
  published_at: string | null;
};

export type SignalTriggersBarriersEvidenceRecordV2 = {
  mention_id: string;
  text: string;
  title: string | null;
  platform: string;
  content_type: string | null;
  occurred_at: string;
  source_url: string | null;
  is_protagonist: boolean;
};

export type SignalTriggersBarriersEvidencePageV2 = {
  contract_version: typeof SIGNAL_TRIGGERS_BARRIERS_CONTRACT_VERSION;
  finding_id: string;
  evidence_authority: {
    state: "available" | "withheld";
    required_usage_purposes: readonly ["client-mention-list", "client-text-or-excerpt"];
    withheld_count: number;
  };
  records: SignalTriggersBarriersEvidenceRecordV2[];
  page: {
    limit: number;
    total_count: number;
    next_cursor: string | null;
  };
};

export type SignalTriggersBarriersFindingDetailV2 = {
  contract_version: typeof SIGNAL_TRIGGERS_BARRIERS_CONTRACT_VERSION;
  finding_id: string;
  finding_name: string;
  polarity: PublicTbFinding["polarity"];
  layer: PublicTbFinding["layer"];
  mobility: PublicTbFinding["mobility"];
  confidence: PublicTbFinding["confidence"];
  frequency_mentions: number;
  intensity_score: number | null;
  predictive_capacity: number | null;
  composite_score: number;
  evidence_count: number;
  platforms: string[];
  public_quote: string | null;
  actions: PublicActionCard[];
  reading: {
    title: string;
    description: string;
    mobility_reason: string | null;
    channel_insight: string | null;
    format_insight: string | null;
    period_insight: string | null;
    competitor_insight: string | null;
    limitation: string | null;
  };
};

export type SignalTriggersBarriersOverviewV2 = {
  contract_version: typeof SIGNAL_TRIGGERS_BARRIERS_CONTRACT_VERSION;
  workspace_id: string;
  study: {
    id: string;
    title: string;
  };
  cut: Omit<SignalTriggersBarriersCutV2, "source" | "source_id" | "study_corpus_id">;
  coverage: {
    date_from: string;
    date_through: string;
  };
  filter: SignalFilterV1;
  comparison: SignalComparisonV1;
  corpus: PublishedSignalOverview["corpus"];
  metrics: PublishedSignalOverview["metrics"];
  findings: PublicTbFinding[];
  finding_time_series: PublishedSignalOverview["finding_time_series"];
  initial_finding: SignalTriggersBarriersFindingDetailV2 | null;
  initial_evidence: SignalTriggersBarriersEvidencePageV2 | null;
};

export type SignalTriggersBarriersSeriesV2 = {
  contract_version: typeof SIGNAL_TRIGGERS_BARRIERS_CONTRACT_VERSION;
  finding_id: string | null;
  records: PublishedSignalOverview["finding_time_series"];
};

type CutRow = {
  source: CutSource;
  source_id: string;
  output_id: string | null;
  analysis_id: string;
  snapshot_id: string;
  study_corpus_id: string;
  title: string;
  period_start: string | null;
  period_end: string | null;
  corpus_revision: number | string | null;
  published_at: string | null;
};

export async function resolveSignalTriggersBarriersCutV2(args: {
  workspace: ResolvedSignalWorkspace;
  reportKey?: string;
  studyCorpusId?: string;
}): Promise<SignalTriggersBarriersCutV2 | null> {
  const reportKey = args.reportKey ?? "triggers-barriers";
  if (args.studyCorpusId) {
    const membership = args.workspace.corpora.find((corpus) => (
      corpus.id === args.studyCorpusId
      && corpus.methodologySlug === "triggers-barriers"
    ));
    if (!membership) return null;
  }

  const hasReportIdentity = await hasSignalWorkspaceReportIdentityV1();
  const reportCurrentJoin = hasReportIdentity
    ? `LEFT JOIN signal_workspace_report_current_releases current_release
         ON current_release.workspace_id = release.workspace_id
        AND current_release.report_key = release.report_key
        AND current_release.release_id = release.id`
    : `LEFT JOIN signal_workspace_current_releases current_release
         ON current_release.workspace_id = release.workspace_id
        AND current_release.release_id = release.id`;
  const reportFilter = hasReportIdentity ? "AND release.report_key = $2" : "";

  const release = await pool.query<CutRow>(
    `SELECT
       'workspace_release'::text AS source,
       release.id::text AS source_id,
       NULL::text AS output_id,
       release.tb_analysis_id::text AS analysis_id,
       release.snapshot_id::text,
       analysis.study_corpus_id::text,
       release.title,
       release.period_start::text,
       release.period_end::text,
       release.corpus_revision,
       release.published_at::text
     FROM signal_workspace_releases release
     JOIN tb_analyses analysis ON analysis.id = release.tb_analysis_id
     ${reportCurrentJoin}
     WHERE release.workspace_id = $1::uuid
       ${reportFilter}
       AND release.status = 'published'
       AND release.visibility = 'client'
     ORDER BY (current_release.release_id IS NOT NULL) DESC,
       release.period_end DESC, release.published_at DESC NULLS LAST, release.id
     LIMIT 1`,
    hasReportIdentity ? [args.workspace.id, reportKey] : [args.workspace.id]
  );
  if (release.rows[0]) return normalizeCut(release.rows[0]);

  if (!args.studyCorpusId) return null;

  const published = await pool.query<CutRow>(
    `SELECT
       'published_output'::text AS source,
       output.id::text AS source_id,
       output.id::text AS output_id,
       output.tb_analysis_id::text AS analysis_id,
       analysis.snapshot_id::text,
       output.study_corpus_id::text,
       output.title,
       COALESCE(analysis.period_start, snapshot_scope.period_start)::text AS period_start,
       COALESCE(analysis.period_end, snapshot_scope.period_end)::text AS period_end,
       COALESCE(analysis.corpus_revision, corpus.corpus_revision)::int AS corpus_revision,
       output.published_at::text
     FROM published_outputs output
     JOIN tb_analyses analysis ON analysis.id = output.tb_analysis_id
     JOIN study_corpora corpus ON corpus.id = output.study_corpus_id
     JOIN signal_workspace_corpora membership
       ON membership.workspace_id = $1::uuid
      AND membership.study_corpus_id = output.study_corpus_id
      AND membership.valid_to IS NULL
     LEFT JOIN LATERAL (
       SELECT MIN(mention.published_at)::date AS period_start,
         MAX(mention.published_at)::date AS period_end
       FROM corpus_snapshot_mentions snapshot_mention
       JOIN mentions mention ON mention.id = snapshot_mention.mention_id
       WHERE snapshot_mention.snapshot_id = analysis.snapshot_id
     ) snapshot_scope ON true
     WHERE output.study_corpus_id = $2::uuid
       AND output.status = 'published'
       AND output.archived_at IS NULL
       AND output.manifest #>> '{data_contract,version}' = $3
       AND output.manifest #>> '{data_contract,source_of_truth}' = 'relational'
       AND output.tb_analysis_id IS NOT NULL
       AND analysis.snapshot_id IS NOT NULL
     ORDER BY output.published_at DESC NULLS LAST, output.updated_at DESC, output.id
     LIMIT 1`,
    [args.workspace.id, args.studyCorpusId, SIGNAL_SERVING_CONTRACT_VERSION]
  );
  return published.rows[0] ? normalizeCut(published.rows[0]) : null;
}

export async function loadSignalTriggersBarriersOverviewV2(args: {
  workspace: ResolvedSignalWorkspace;
  studyCorpusId?: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  preferredFindingId?: string | null;
}): Promise<SignalTriggersBarriersOverviewV2 | null> {
  const cut = await loadSignalTriggersBarriersCutV2(args);
  if (!cut) return null;
  const period = resolveSignalTriggersBarriersPeriodV2(cut, args.dateFrom, args.dateTo);

  const [overview, periodMetrics, codedMentions] = await Promise.all([
    loadPublishedSignalOverview({
      analysisId: cut.analysis_id,
      snapshotId: cut.snapshot_id,
      corpusId: cut.study_corpus_id,
      dateFrom: period.start,
      dateTo: period.end,
      outputId: cut.output_id ?? undefined,
      requireGovernedRef: cut.source === "published_output"
    }),
    loadPeriodFindingMetrics(cut, period),
    loadPeriodCodedMentionCount(cut, period)
  ]);
  const findings = applyPeriodFindingMetrics(overview.findings, periodMetrics);
  const activeFindings = findings.filter((finding) => finding.frequency_mentions > 0);
  const preferredFinding = activeFindings.find(
    (finding) => finding.finding_id === args.preferredFindingId
  );
  const initialFinding = preferredFinding ?? [...activeFindings].sort(compareFindings)[0] ?? null;
  const [initialDetail, initialEvidence] = initialFinding
    ? await Promise.all([
        loadSignalTriggersBarriersFindingV2({
          cut,
          findingId: initialFinding.finding_id,
          dateFrom: period.start,
          dateTo: period.end
        }),
        loadSignalTriggersBarriersEvidenceV2({
          cut,
          findingId: initialFinding.finding_id,
          dateFrom: period.start,
          dateTo: period.end,
          limit: 5
        })
      ])
    : [null, null];
  const study = args.studyCorpusId
    ? args.workspace.corpora.find((corpus) => corpus.id === args.studyCorpusId)
    : null;
  const periodMetricsSummary = {
    ...overview.metrics,
    findings_total: activeFindings.length,
    triggers_total: activeFindings.filter((finding) => finding.polarity === "trigger").length,
    barriers_total: activeFindings.filter((finding) => finding.polarity === "barrier").length,
    movable_total: activeFindings.filter((finding) => finding.mobility === "movible_por_marca").length,
    citations_total: activeFindings.reduce(
      (total, finding) => total + finding.evidence_count,
      0
    ),
    coded_mentions_total: codedMentions
  };

  return {
    contract_version: SIGNAL_TRIGGERS_BARRIERS_CONTRACT_VERSION,
    workspace_id: args.workspace.id,
    study: {
      id: "triggers-barriers",
      title: study?.name?.trim() || cut.title || "Triggers & Barriers"
    },
    cut: {
      output_id: cut.output_id,
      analysis_id: cut.analysis_id,
      snapshot_id: cut.snapshot_id,
      title: cut.title,
      period_start: cut.period_start,
      period_end: cut.period_end,
      corpus_revision: cut.corpus_revision,
      published_at: cut.published_at
    },
    coverage: {
      date_from: cut.period_start,
      date_through: cut.period_end
    },
    filter: {
      contract_version: SIGNAL_BACKEND_CONTRACT_VERSION,
      date_range: period,
      timezone: args.workspace.timezone,
      granularity: preferredGranularity(period.start, period.end),
      dimensions: {}
    },
    comparison: { mode: "none", date_range: null },
    corpus: overview.corpus,
    metrics: periodMetricsSummary,
    findings,
    finding_time_series: overview.finding_time_series,
    initial_finding: initialDetail,
    initial_evidence: initialEvidence
  };
}

export async function loadSignalTriggersBarriersCutV2(args: {
  workspace: ResolvedSignalWorkspace;
  studyCorpusId?: string;
}) {
  const cut = await resolveSignalTriggersBarriersCutV2(args);
  if (!cut) return null;
  await assertCutReady(cut);
  return cut;
}

export async function loadSignalTriggersBarriersSeriesV2(args: {
  cut: SignalTriggersBarriersCutV2;
  findingId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}): Promise<SignalTriggersBarriersSeriesV2> {
  const period = resolveSignalTriggersBarriersPeriodV2(args.cut, args.dateFrom, args.dateTo);
  const overview = await loadPublishedSignalOverview({
    analysisId: args.cut.analysis_id,
    snapshotId: args.cut.snapshot_id,
    corpusId: args.cut.study_corpus_id,
    dateFrom: period.start,
    dateTo: period.end,
    outputId: args.cut.output_id ?? undefined,
    requireGovernedRef: args.cut.source === "published_output"
  });
  return {
    contract_version: SIGNAL_TRIGGERS_BARRIERS_CONTRACT_VERSION,
    finding_id: args.findingId ?? null,
    records: args.findingId
      ? overview.finding_time_series.filter((record) => record.finding_id === args.findingId)
      : overview.finding_time_series
  };
}

export async function loadSignalTriggersBarriersFindingV2(args: {
  cut: SignalTriggersBarriersCutV2;
  findingId: string;
  dateFrom?: string | null;
  dateTo?: string | null;
}): Promise<SignalTriggersBarriersFindingDetailV2 | null> {
  const period = resolveSignalTriggersBarriersPeriodV2(args.cut, args.dateFrom, args.dateTo);
  const [result, actionsResult] = await Promise.all([pool.query<{
    finding_id: string;
    finding_name: string;
    polarity: string;
    layer: string;
    mobility: string | null;
    confidence: string | null;
    frequency_mentions: number;
    intensity_score: string | null;
    predictive_capacity: string | null;
    composite_score: string | null;
    evidence_count: number;
    platforms: string[];
    public_quote: string | null;
    mobility_reason: string | null;
    reading_title: string | null;
    reading_description: string | null;
    reading_content: Record<string, unknown> | null;
    limitation: string | null;
  }>(
    `SELECT finding.finding_id,
       finding.nombre_comercial AS finding_name,
       lower(finding.polarity) AS polarity,
       lower(finding.layer) AS layer,
       finding.movilidad AS mobility,
       finding.confidence,
       COALESCE(period_coding.frequency_mentions, 0)::int AS frequency_mentions,
       period_coding.intensity_score::text AS intensity_score,
       finding.capacidad_predictiva::text AS predictive_capacity,
       finding.score_compuesto::text AS composite_score,
       COALESCE(period_evidence.evidence_count, 0)::int AS evidence_count,
       COALESCE(period_coding.platforms, ARRAY[]::text[]) AS platforms,
       CASE
         WHEN jsonb_typeof(finding.cita_protagonista) = 'string'
           THEN trim(BOTH '"' FROM finding.cita_protagonista::text)
         WHEN jsonb_typeof(finding.cita_protagonista) = 'object'
           THEN COALESCE(finding.cita_protagonista->>'text', finding.cita_protagonista->>'quote')
         ELSE NULL
       END AS public_quote,
       finding.movilidad_razon AS mobility_reason,
       dive.title AS reading_title,
       dive.summary AS reading_description,
       dive.content AS reading_content,
       CASE
         WHEN jsonb_typeof(analysis.limitations) = 'string'
           THEN trim(BOTH '"' FROM analysis.limitations::text)
         WHEN jsonb_typeof(analysis.limitations) = 'object'
           THEN COALESCE(analysis.limitations->>'summary', analysis.limitations->>'description')
         ELSE NULL
       END AS limitation
     FROM tb_findings finding
     JOIN tb_analyses analysis ON analysis.id = finding.tb_analysis_id
     LEFT JOIN LATERAL (
       SELECT COUNT(DISTINCT coding.mention_id)::int AS frequency_mentions,
         AVG(coding.intensity_score) AS intensity_score,
         COALESCE(
           ARRAY_AGG(DISTINCT COALESCE(
             NULLIF(BTRIM(mention.resolved_platform), ''),
             NULLIF(BTRIM(mention.platform), '')
           )) FILTER (WHERE COALESCE(
             NULLIF(BTRIM(mention.resolved_platform), ''),
             NULLIF(BTRIM(mention.platform), '')
           ) IS NOT NULL),
           ARRAY[]::text[]
         ) AS platforms
       FROM tb_mention_codings coding
       JOIN corpus_snapshot_mentions snapshot_mention
         ON snapshot_mention.snapshot_id = $2::uuid
        AND snapshot_mention.mention_id = coding.mention_id
       JOIN mentions mention ON mention.id = coding.mention_id
       WHERE coding.tb_analysis_id = finding.tb_analysis_id
         AND coding.finding_id = finding.id
         AND mention.published_at >= $4::date
         AND mention.published_at < ($5::date + interval '1 day')
     ) period_coding ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(DISTINCT citation.mention_id)::int AS evidence_count
       FROM tb_finding_citations citation
       JOIN corpus_snapshot_mentions snapshot_mention
         ON snapshot_mention.snapshot_id = $2::uuid
        AND snapshot_mention.mention_id = citation.mention_id
       JOIN mentions mention ON mention.id = citation.mention_id
       WHERE citation.finding_id = finding.id
         AND mention.published_at >= $4::date
         AND mention.published_at < ($5::date + interval '1 day')
     ) period_evidence ON true
     LEFT JOIN LATERAL (
       SELECT artifact.title, artifact.summary, artifact.content
       FROM analysis_artifacts artifact
       WHERE artifact.tb_analysis_id = finding.tb_analysis_id
         AND artifact.artifact_type = 'evidence_deep_dive'
         AND artifact.content->>'finding_id' = finding.finding_id
         AND artifact.review_status IN ('accepted', 'corrected', 'limited')
         AND NOT EXISTS (
           SELECT 1 FROM analysis_artifacts newer
           WHERE newer.tb_analysis_id = artifact.tb_analysis_id
             AND newer.artifact_key = artifact.artifact_key
             AND newer.revision > artifact.revision
         )
       ORDER BY artifact.revision DESC
       LIMIT 1
     ) dive ON true
     WHERE finding.tb_analysis_id = $1::uuid
       AND finding.finding_id = $3
     LIMIT 1`,
    [args.cut.analysis_id, args.cut.snapshot_id, args.findingId, period.start, period.end]
  ), pool.query<PublishedSignalActionRow>(
    `SELECT action.action_id,
       action.target_team,
       action.kind,
       action.title,
       COALESCE((
         SELECT array_agg(linked_finding.finding_id ORDER BY linked.position, linked_finding.finding_id)
         FROM tb_action_findings linked
         JOIN tb_findings linked_finding ON linked_finding.id = linked.finding_id
         WHERE linked.action_id = action.id
           AND linked_finding.tb_analysis_id = action.tb_analysis_id
       ), ARRAY[]::text[]) AS finding_ids,
       primary_finding.finding_id AS primary_finding_id,
       action.rationale,
       action.action_text,
       action.suggested_channel,
       action.suggested_format,
       action.success_signal,
       action.estimated_effort,
       action.estimated_impact,
       action.confidence,
       action.priority_rank::int,
       (
         SELECT COUNT(DISTINCT snapshot_mention.mention_id)::int
         FROM tb_action_findings evidence_link
         JOIN tb_findings evidence_finding ON evidence_finding.id = evidence_link.finding_id
         JOIN tb_finding_citations citation ON citation.finding_id = evidence_link.finding_id
         JOIN corpus_snapshot_mentions snapshot_mention
           ON snapshot_mention.mention_id = citation.mention_id
          AND snapshot_mention.snapshot_id = $2::uuid
         WHERE evidence_link.action_id = action.id
           AND evidence_finding.tb_analysis_id = action.tb_analysis_id
       ) AS citation_count
     FROM tb_action_studio action
     JOIN tb_action_findings selected_link ON selected_link.action_id = action.id
     JOIN tb_findings selected_finding
       ON selected_finding.id = selected_link.finding_id
      AND selected_finding.tb_analysis_id = action.tb_analysis_id
     LEFT JOIN tb_findings primary_finding
       ON primary_finding.id = action.primary_finding_id
      AND primary_finding.tb_analysis_id = action.tb_analysis_id
     WHERE action.tb_analysis_id = $1::uuid
       AND selected_finding.finding_id = $3
     ORDER BY action.priority_rank, selected_link.position, action.created_at, action.id`,
    [args.cut.analysis_id, args.cut.snapshot_id, args.findingId]
  )]);
  const row = result.rows[0];
  if (!row) return null;
  const content = recordValue(row.reading_content);
  return {
    contract_version: SIGNAL_TRIGGERS_BARRIERS_CONTRACT_VERSION,
    finding_id: row.finding_id,
    finding_name: row.finding_name,
    polarity: normalizePolarity(row.polarity),
    layer: normalizeLayer(row.layer),
    mobility: normalizeMobility(row.mobility),
    confidence: normalizeConfidence(row.confidence),
    frequency_mentions: numeric(row.frequency_mentions),
    intensity_score: nullableNumeric(row.intensity_score),
    predictive_capacity: nullableNumeric(row.predictive_capacity),
    composite_score: numeric(row.composite_score),
    evidence_count: numeric(row.evidence_count),
    platforms: [...row.platforms].sort((left, right) => left.localeCompare(right)),
    public_quote: row.public_quote,
    actions: mapPublishedSignalActions(actionsResult.rows),
    reading: {
      title: row.reading_title?.trim() || row.finding_name,
      description: row.reading_description?.trim() || row.mobility_reason?.trim() || "",
      mobility_reason: row.mobility_reason,
      channel_insight: stringValue(content.channel_insight),
      format_insight: stringValue(content.format_insight),
      period_insight: stringValue(content.period_insight),
      competitor_insight: stringValue(content.competitor_insight),
      limitation: row.limitation
    }
  };
}

export async function loadSignalTriggersBarriersEvidenceV2(args: {
  cut: SignalTriggersBarriersCutV2;
  findingId: string;
  cursor?: string | null;
  limit?: number;
  dateFrom?: string | null;
  dateTo?: string | null;
}): Promise<SignalTriggersBarriersEvidencePageV2> {
  const period = resolveSignalTriggersBarriersPeriodV2(args.cut, args.dateFrom, args.dateTo);
  const limit = boundedLimit(args.limit);
  const cursor = args.cursor ? decodeEvidenceCursor(args.cursor, args) : null;
  const params: unknown[] = [
    args.cut.analysis_id,
    args.cut.snapshot_id,
    args.findingId,
    period.start,
    period.end
  ];
  let cursorSql = "";
  if (cursor) {
    params.push(cursor.position, cursor.mention_id);
    cursorSql = `AND (citation_position, id) > ($6::int, $7::uuid)`;
  }
  params.push(limit + 1);
  const result = await pool.query<{
    mention_id: string | null;
    text: string | null;
    title: string | null;
    platform: string | null;
    content_type: string | null;
    occurred_at: Date | null;
    source_url: string | null;
    is_protagonist: boolean | null;
    citation_position: number | null;
    total_count: number;
    evidence_allowed: boolean;
  }>(
    `WITH governed AS (
       SELECT EXISTS (
         SELECT 1 FROM signal_strategic_run_controls control
         WHERE control.workspace_id=(SELECT snapshot.workspace_id FROM corpus_snapshots snapshot
           WHERE snapshot.id=$2::uuid)
           AND control.tb_analysis_id=$1::uuid AND control.snapshot_id=$2::uuid
       ) AS governed_v2
     ), scoped AS (
       SELECT mention.id,
         COALESCE(NULLIF(mention.text_snippet, ''), NULLIF(mention.text_clean, ''), mention.title, '') AS text,
         mention.title,
         COALESCE(mention.resolved_platform, mention.platform) AS platform,
         mention.content_type,
         mention.published_at AS occurred_at,
         mention.url AS source_url,
         citation.is_protagonist,
         citation.position AS citation_position,
         NOT (SELECT governed_v2 FROM governed) OR EXISTS (
           SELECT 1 FROM signal_mention_import_memberships provenance
           JOIN LATERAL (
             SELECT binding.licensing_policy_id,binding.retention_policy_id
             FROM signal_provenance_policy_bindings binding
             WHERE binding.workspace_id=mention.workspace_id
               AND binding.data_source_id=provenance.data_source_id
               AND (binding.import_batch_id=provenance.import_batch_id
                 OR binding.import_batch_id IS NULL)
               AND binding.status='active' AND binding.effective_from<=now()
               AND (binding.effective_to IS NULL OR binding.effective_to>now())
             ORDER BY (binding.import_batch_id IS NOT NULL) DESC,
               binding.binding_version DESC,binding.id LIMIT 1
           ) applicable ON true
           JOIN signal_licensing_policies license
             ON license.id=applicable.licensing_policy_id
            AND license.workspace_id=mention.workspace_id
            AND license.status='active' AND license.effective_from<=now()
            AND (license.effective_to IS NULL OR license.effective_to>now())
           JOIN signal_retention_policies retention
             ON retention.id=applicable.retention_policy_id
            AND retention.workspace_id=mention.workspace_id
            AND retention.status='active' AND retention.retention_state='allowed'
            AND retention.effective_from<=now()
            AND (retention.effective_to IS NULL OR retention.effective_to>now())
            AND (retention.retain_until IS NULL OR retention.retain_until>now())
           JOIN signal_licensing_policy_usages list_usage
             ON list_usage.licensing_policy_id=license.id
            AND list_usage.usage_purpose='client-mention-list'
            AND list_usage.decision='allowed'
           JOIN signal_licensing_policy_usages text_usage
             ON text_usage.licensing_policy_id=license.id
            AND text_usage.usage_purpose='client-text-or-excerpt'
            AND text_usage.decision='allowed'
           WHERE provenance.workspace_id=mention.workspace_id
             AND provenance.mention_id=mention.id
         ) AS evidence_allowed
       FROM tb_findings finding
       JOIN tb_finding_citations citation ON citation.finding_id = finding.id
       JOIN corpus_snapshot_mentions snapshot_mention
         ON snapshot_mention.snapshot_id = $2::uuid
        AND snapshot_mention.mention_id = citation.mention_id
       JOIN mentions mention ON mention.id = citation.mention_id
       WHERE finding.tb_analysis_id = $1::uuid
         AND finding.finding_id = $3
         AND mention.published_at >= $4::date
         AND mention.published_at < ($5::date + interval '1 day')
     ), authority AS (
       SELECT COALESCE(bool_and(evidence_allowed),true) AS evidence_allowed,
         count(*)::int AS total_count FROM scoped
     )
     SELECT CASE WHEN authority.evidence_allowed THEN id::text END AS mention_id,
       CASE WHEN authority.evidence_allowed THEN text END AS text,
       CASE WHEN authority.evidence_allowed THEN title END AS title,
       CASE WHEN authority.evidence_allowed THEN platform END AS platform,
       CASE WHEN authority.evidence_allowed THEN content_type END AS content_type,
       CASE WHEN authority.evidence_allowed THEN occurred_at END AS occurred_at,
       CASE WHEN authority.evidence_allowed THEN source_url END AS source_url,
       CASE WHEN authority.evidence_allowed THEN is_protagonist END AS is_protagonist,
       CASE WHEN authority.evidence_allowed THEN citation_position END AS citation_position,
       authority.total_count,authority.evidence_allowed
     FROM scoped AS mention
     CROSS JOIN authority
     WHERE true ${cursorSql}
     ORDER BY citation_position, id
     LIMIT $${params.length}::int`,
    params
  );
  const evidenceAllowed = result.rows[0]?.evidence_allowed !== false;
  const authorizedRows = evidenceAllowed
    ? result.rows.filter((row): row is typeof row & {
        mention_id: string; text: string; platform: string; occurred_at: Date;
        is_protagonist: boolean; citation_position: number;
      } => row.mention_id != null && row.text != null && row.platform != null
        && row.occurred_at != null && row.is_protagonist != null
        && row.citation_position != null)
    : [];
  const hasNext = evidenceAllowed && authorizedRows.length > limit;
  const pageRows = authorizedRows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    contract_version: SIGNAL_TRIGGERS_BARRIERS_CONTRACT_VERSION,
    finding_id: args.findingId,
    evidence_authority: {
      state: evidenceAllowed ? "available" : "withheld",
      required_usage_purposes: ["client-mention-list", "client-text-or-excerpt"],
      withheld_count: evidenceAllowed ? 0 : numeric(result.rows[0]?.total_count)
    },
    records: pageRows.map((row) => ({
      mention_id: row.mention_id,
      text: row.text,
      title: row.title,
      platform: row.platform,
      content_type: row.content_type,
      occurred_at: row.occurred_at.toISOString(),
      source_url: row.source_url,
      is_protagonist: row.is_protagonist
    })),
    page: {
      limit,
      total_count: numeric(result.rows[0]?.total_count),
      next_cursor: hasNext && last
        ? encodeEvidenceCursor({
            analysis_id: args.cut.analysis_id,
            finding_id: args.findingId,
            position: last.citation_position,
            mention_id: last.mention_id
          })
        : null
    }
  };
}

type SignalTriggersBarriersPeriodV2 = { start: string; end: string };

type PeriodFindingMetric = {
  finding_id: string;
  frequency_mentions: number;
  intensity_score: string | null;
  evidence_count: number;
};

export function resolveSignalTriggersBarriersPeriodV2(
  cut: Pick<SignalTriggersBarriersCutV2, "period_start" | "period_end">,
  requestedStart?: string | null,
  requestedEnd?: string | null
): SignalTriggersBarriersPeriodV2 {
  const start = requestedStart?.trim() || cut.period_start;
  const end = requestedEnd?.trim() || cut.period_end;
  if (!isIsoDate(start) || !isIsoDate(end) || start > end) {
    throw new SignalBackendContractError(
      "invalid_filter",
      "The Triggers & Barriers period is invalid.",
      { start, end }
    );
  }
  if (start < cut.period_start || end > cut.period_end) {
    throw new SignalBackendContractError(
      "invalid_filter",
      "The selected period must stay inside the published cut.",
      { start, end, cut_start: cut.period_start, cut_end: cut.period_end }
    );
  }
  return { start, end };
}

async function loadPeriodFindingMetrics(
  cut: SignalTriggersBarriersCutV2,
  period: SignalTriggersBarriersPeriodV2
) {
  const result = await pool.query<PeriodFindingMetric>(
    `SELECT finding.finding_id,
       COALESCE(coded.frequency_mentions, 0)::int AS frequency_mentions,
       coded.intensity_score::text,
       COALESCE(evidence.evidence_count, 0)::int AS evidence_count
     FROM tb_findings finding
     LEFT JOIN LATERAL (
       SELECT COUNT(DISTINCT coding.mention_id)::int AS frequency_mentions,
         AVG(coding.intensity_score) AS intensity_score
       FROM tb_mention_codings coding
       JOIN corpus_snapshot_mentions snapshot_mention
         ON snapshot_mention.snapshot_id = $2::uuid
        AND snapshot_mention.mention_id = coding.mention_id
       JOIN mentions mention ON mention.id = coding.mention_id
       WHERE coding.tb_analysis_id = finding.tb_analysis_id
         AND coding.finding_id = finding.id
         AND mention.published_at >= $3::date
         AND mention.published_at < ($4::date + interval '1 day')
     ) coded ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(DISTINCT citation.mention_id)::int AS evidence_count
       FROM tb_finding_citations citation
       JOIN corpus_snapshot_mentions snapshot_mention
         ON snapshot_mention.snapshot_id = $2::uuid
        AND snapshot_mention.mention_id = citation.mention_id
       JOIN mentions mention ON mention.id = citation.mention_id
       WHERE citation.finding_id = finding.id
         AND mention.published_at >= $3::date
         AND mention.published_at < ($4::date + interval '1 day')
     ) evidence ON true
     WHERE finding.tb_analysis_id = $1::uuid
     ORDER BY finding.finding_id`,
    [cut.analysis_id, cut.snapshot_id, period.start, period.end]
  );
  return new Map(result.rows.map((row) => [row.finding_id, row]));
}

async function loadPeriodCodedMentionCount(
  cut: SignalTriggersBarriersCutV2,
  period: SignalTriggersBarriersPeriodV2
) {
  const result = await pool.query<{ count: number }>(
    `SELECT COUNT(DISTINCT coding.mention_id)::int AS count
     FROM tb_mention_codings coding
     JOIN corpus_snapshot_mentions snapshot_mention
       ON snapshot_mention.snapshot_id = $2::uuid
      AND snapshot_mention.mention_id = coding.mention_id
     JOIN mentions mention ON mention.id = coding.mention_id
     WHERE coding.tb_analysis_id = $1::uuid
       AND mention.published_at >= $3::date
       AND mention.published_at < ($4::date + interval '1 day')`,
    [cut.analysis_id, cut.snapshot_id, period.start, period.end]
  );
  return numeric(result.rows[0]?.count);
}

function applyPeriodFindingMetrics(
  findings: PublicTbFinding[],
  periodMetrics: Map<string, PeriodFindingMetric>
) {
  const mapped = findings.map((finding) => {
    const metric = periodMetrics.get(finding.finding_id);
    return {
      ...finding,
      frequency_mentions: numeric(metric?.frequency_mentions),
      intensity_score: numeric(metric?.intensity_score),
      evidence_count: numeric(metric?.evidence_count)
    };
  });
  const totalFrequency = mapped.reduce((sum, finding) => sum + finding.frequency_mentions, 0);
  return mapped.map((finding) => ({
    ...finding,
    share_of_findings_pct: totalFrequency > 0
      ? finding.frequency_mentions / totalFrequency * 100
      : 0
  }));
}

async function assertCutReady(cut: SignalTriggersBarriersCutV2) {
  const readiness = await getSignalServingReadiness({
    analysisId: cut.analysis_id,
    snapshotId: cut.snapshot_id,
    outputId: cut.output_id,
    requireDataRefs: cut.source === "published_output"
  });
  const assessment = assessSignalServingReadiness(readiness);
  if (!assessment.ready) {
    throw new SignalBackendContractError(
      "not_available",
      "The published Triggers & Barriers cut is not ready for relational serving.",
      { hard_blocks: assessment.hardBlocks }
    );
  }
}

function normalizeCut(row: CutRow): SignalTriggersBarriersCutV2 {
  if (!row.period_start || !row.period_end) {
    throw new SignalBackendContractError(
      "not_available",
      "The published Triggers & Barriers cut has no frozen period.",
      { source_id: row.source_id }
    );
  }
  return {
    ...row,
    corpus_revision: numeric(row.corpus_revision),
    period_start: row.period_start,
    period_end: row.period_end
  };
}

function compareFindings(left: PublicTbFinding, right: PublicTbFinding) {
  return right.composite_score - left.composite_score
    || right.frequency_mentions - left.frequency_mentions
    || left.finding_id.localeCompare(right.finding_id);
}

function preferredGranularity(start: string, end: string): SignalFilterV1["granularity"] {
  const days = Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000) + 1;
  if (days <= 90) return "day";
  if (days <= 365) return "week";
  return "month";
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value)
    && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

function normalizePolarity(value: string): PublicTbFinding["polarity"] {
  if (value === "trigger" || value === "barrier") return value;
  return "mixed";
}

function normalizeLayer(value: string): PublicTbFinding["layer"] {
  if (value === "psicologico" || value === "psychological") return "psicologico";
  if (value === "social" || value === "cultural") return value;
  return "personal";
}

function normalizeMobility(value: string | null): PublicTbFinding["mobility"] {
  if (value === "movible_por_marca" || value === "parcialmente_movible" || value === "estructural") {
    return value;
  }
  return null;
}

function normalizeConfidence(value: string | null): PublicTbFinding["confidence"] {
  if (value === "alta" || value === "baja_direccional") return value;
  return "media";
}

function boundedLimit(value: number | undefined) {
  const parsed = Number(value ?? 20);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new SignalBackendContractError(
      "invalid_filter",
      "limit must be between 1 and 50.",
      { field: "limit" }
    );
  }
  return parsed;
}

type EvidenceCursor = {
  analysis_id: string;
  finding_id: string;
  position: number;
  mention_id: string;
};

export function encodeSignalTriggersBarriersEvidenceCursorV2(cursor: EvidenceCursor) {
  return encodeEvidenceCursor(cursor);
}

export function decodeSignalTriggersBarriersEvidenceCursorV2(value: string) {
  return parseEvidenceCursor(value);
}

function encodeEvidenceCursor(cursor: EvidenceCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeEvidenceCursor(
  value: string,
  scope: { cut: SignalTriggersBarriersCutV2; findingId: string }
) {
  const cursor = parseEvidenceCursor(value);
  if (
    cursor.analysis_id !== scope.cut.analysis_id
    || cursor.finding_id !== scope.findingId
  ) {
    throw new SignalBackendContractError(
      "invalid_filter",
      "Evidence cursor does not match the active release and finding.",
      { field: "cursor" }
    );
  }
  return cursor;
}

function parseEvidenceCursor(value: string): EvidenceCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<EvidenceCursor>;
    if (
      typeof parsed.analysis_id !== "string"
      || typeof parsed.finding_id !== "string"
      || !Number.isInteger(parsed.position)
      || typeof parsed.mention_id !== "string"
    ) throw new Error("invalid");
    return parsed as EvidenceCursor;
  } catch {
    throw new SignalBackendContractError(
      "invalid_filter",
      "Evidence cursor is invalid.",
      { field: "cursor" }
    );
  }
}

function numeric(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumeric(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return numeric(value);
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
