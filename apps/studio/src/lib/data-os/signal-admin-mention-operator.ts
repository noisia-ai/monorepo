import { createHash } from "node:crypto";

import { SignalBackendContractError } from "@noisia/query-engine";

import { pool } from "@/lib/db";

type OperatorValue = null | boolean | number | string | OperatorValue[] | { [key: string]: OperatorValue };

const BLOCKED_OPERATOR_KEYS = /(^|_)(raw|text|body|content|url|email|phone|token|secret|password|cookie|authorization|handle)($|_)/iu;

const INCLUSION_STATES = ["pending", "included", "excluded"] as const;
const RESOLUTION_STATES = [
  "unresolved",
  "pending",
  "approved_by_model",
  "approved_by_human",
  "approved_by_policy",
  "rejected",
  "superseded"
] as const;
const REVIEW_STATES = ["unresolved", "pending", "approved", "rejected"] as const;
const ELIGIBILITY_STATES = ["unresolved", "not_eligible", "candidate", "eligible"] as const;
const GOVERNANCE_ACTIONS = ["include", "exclude", "revert", "send_to_review"] as const;

export type SignalAdminMentionOperatorFiltersV1 = {
  inclusion_status: typeof INCLUSION_STATES[number] | null;
  resolution_state: typeof RESOLUTION_STATES[number] | null;
  review_status: typeof REVIEW_STATES[number] | null;
  eligibility_status: typeof ELIGIBILITY_STATES[number] | null;
  minimum_quality_score: number | null;
  quality_flag: string | null;
  latest_governance_action: typeof GOVERNANCE_ACTIONS[number] | null;
  provenance_source_id: string | null;
};

export function parseSignalAdminMentionOperatorFiltersV1(params: URLSearchParams) {
  const filters: SignalAdminMentionOperatorFiltersV1 = {
    inclusion_status: enumParameter(params, "inclusion_status", INCLUSION_STATES),
    resolution_state: enumParameter(params, "resolution_state", RESOLUTION_STATES),
    review_status: enumParameter(params, "review_status", REVIEW_STATES),
    eligibility_status: enumParameter(params, "eligibility_status", ELIGIBILITY_STATES),
    minimum_quality_score: numberParameter(params, "minimum_quality_score"),
    quality_flag: stringParameter(params, "quality_flag"),
    latest_governance_action: enumParameter(params, "latest_governance_action", GOVERNANCE_ACTIONS),
    provenance_source_id: uuidParameter(params, "provenance_source_id")
  };
  return {
    filters,
    digest: `sha256:${createHash("sha256").update(JSON.stringify(filters)).digest("hex")}`,
    active: Object.values(filters).some((value) => value !== null)
  };
}

export async function resolveSignalAdminMentionOperatorFilterIdsV1(args: {
  workspaceId: string;
  filters: SignalAdminMentionOperatorFiltersV1;
}) {
  const params: unknown[] = [args.workspaceId];
  const conditions: string[] = [];
  const parameter = (value: unknown, cast = "") => {
    params.push(value);
    return `$${params.length}${cast}`;
  };
  if (args.filters.inclusion_status) {
    conditions.push(`root.inclusion_status = ${parameter(args.filters.inclusion_status)}`);
  }
  if (args.filters.resolution_state) {
    conditions.push(`semantic.resolution_state = ${parameter(args.filters.resolution_state)}`);
  }
  if (args.filters.review_status) {
    conditions.push(`semantic.review_status = ${parameter(args.filters.review_status)}`);
  }
  if (args.filters.eligibility_status) {
    conditions.push(`semantic.eligibility_status = ${parameter(args.filters.eligibility_status)}`);
  }
  if (args.filters.minimum_quality_score !== null) {
    conditions.push(`COALESCE(root.quality_score, 0) >= ${parameter(args.filters.minimum_quality_score, "::numeric")}`);
  }
  if (args.filters.quality_flag) {
    const qualityFlag = parameter(args.filters.quality_flag);
    conditions.push(`(
      (jsonb_typeof(root.quality_flags) = 'object'
        AND root.quality_flags ? ${qualityFlag}
        AND lower(COALESCE(root.quality_flags->>${qualityFlag}, 'false')) IN ('true', '1', 'yes'))
      OR (jsonb_typeof(root.quality_flags) = 'array' AND root.quality_flags ? ${qualityFlag})
    )`);
  }
  if (args.filters.latest_governance_action) {
    conditions.push(`governance.action = ${parameter(args.filters.latest_governance_action)}`);
  }
  if (args.filters.provenance_source_id) {
    conditions.push(`EXISTS (
      SELECT 1 FROM signal_mention_import_memberships membership
      WHERE membership.workspace_id = root.workspace_id
        AND membership.mention_id = root.id
        AND membership.data_source_id = ${parameter(args.filters.provenance_source_id, "::uuid")}
    )`);
  }
  const result = await pool.query<{ mention_id: string }>(`
    SELECT root.id::text AS mention_id
    FROM mentions root
    LEFT JOIN LATERAL (${semanticSummarySql("root")}) semantic ON true
    LEFT JOIN LATERAL (
      SELECT event.action
      FROM signal_mention_governance_events event
      WHERE event.workspace_id = root.workspace_id AND event.mention_id = root.id
      ORDER BY event.created_at DESC, event.id DESC
      LIMIT 1
    ) governance ON true
    WHERE root.workspace_id = $1::uuid
      AND root.canonical_mention_id = root.id
      AND NOT signal_mention_has_only_incomplete_imports_v1(root.workspace_id,root.id)
      ${conditions.length ? `AND ${conditions.join("\n      AND ")}` : ""}
    ORDER BY root.id
  `, params);
  return result.rows.map((row) => row.mention_id);
}

export async function loadSignalAdminMentionOperatorSummariesV1(args: {
  workspaceId: string;
  mentionIds: string[];
}) {
  if (args.mentionIds.length === 0) return new Map<string, Record<string, unknown>>();
  const result = await pool.query<Record<string, unknown> & { mention_id: string }>(`
    SELECT root.id::text AS mention_id,
      root.inclusion_status, root.exclusion_reason,
      root.quality_score, root.quality_flags,
      semantic.resolution_state, semantic.review_status,
      semantic.eligibility_status, semantic.current_assertion_count,
      governance.action AS latest_governance_action,
      governance.reason AS latest_governance_reason,
      governance.created_at::text AS latest_governance_at,
      provenance.source_count, provenance.import_count,
      provenance.study_count, provenance.source_names
    FROM mentions root
    LEFT JOIN LATERAL (${semanticSummarySql("root")}) semantic ON true
    LEFT JOIN LATERAL (
      SELECT event.action, event.reason, event.created_at
      FROM signal_mention_governance_events event
      WHERE event.workspace_id = root.workspace_id AND event.mention_id = root.id
      ORDER BY event.created_at DESC, event.id DESC
      LIMIT 1
    ) governance ON true
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT membership.data_source_id)::int AS source_count,
        count(DISTINCT membership.import_batch_id)::int AS import_count,
        count(DISTINCT study.study_corpus_id)::int AS study_count,
        COALESCE(array_agg(DISTINCT source.name ORDER BY source.name)
          FILTER (WHERE source.id IS NOT NULL), ARRAY[]::text[]) AS source_names
      FROM signal_mention_import_memberships membership
      JOIN data_sources source ON source.id = membership.data_source_id
        AND source.workspace_id = membership.workspace_id
      LEFT JOIN signal_mention_study_memberships study
        ON study.workspace_id = membership.workspace_id
       AND study.mention_id = membership.mention_id
      WHERE membership.workspace_id = root.workspace_id
        AND membership.mention_id = root.id
    ) provenance ON true
    WHERE root.workspace_id = $1::uuid
      AND root.canonical_mention_id = root.id
      AND NOT signal_mention_has_only_incomplete_imports_v1(root.workspace_id,root.id)
      AND root.id = ANY($2::uuid[])
  `, [args.workspaceId, args.mentionIds]);
  return new Map(result.rows.map((row) => [row.mention_id, {
    inclusion_status: row.inclusion_status,
    exclusion_reason: row.exclusion_reason,
    quality_score: row.quality_score,
    quality_flags: sanitizeOperatorValue(row.quality_flags),
    resolution_state: row.resolution_state,
    review_status: row.review_status,
    eligibility_status: row.eligibility_status,
    current_assertion_count: row.current_assertion_count,
    latest_governance: row.latest_governance_action ? {
      action: row.latest_governance_action,
      reason: row.latest_governance_reason,
      occurred_at: row.latest_governance_at
    } : null,
    provenance: {
      source_count: row.source_count,
      import_count: row.import_count,
      study_count: row.study_count,
      source_names: row.source_names
    }
  }]));
}

export async function loadSignalAdminMentionOperatorFacetsV1(args: { workspaceId: string }) {
  const result = await pool.query<{
    dimension: string;
    key: string;
    label: string;
    count: number;
  }>(`
    WITH semantic AS (
      SELECT assertion.mention_id,
        CASE
          WHEN count(*) FILTER (WHERE assertion.is_current) = 0 THEN 'superseded'
          WHEN bool_or(assertion.is_current AND assertion.review_status = 'pending') THEN 'pending'
          WHEN bool_or(assertion.is_current AND assertion.review_status = 'approved'
            AND (assertion.approval_source = 'claude_semantic_resolution'
              OR assertion.evidence_kind = 'model_reviewed_context')) THEN 'approved_by_model'
          WHEN bool_or(assertion.is_current AND assertion.review_status = 'approved'
            AND (assertion.approved_by_user_id IS NOT NULL
              OR assertion.approval_source = 'noisia_admin_semantic_review')) THEN 'approved_by_human'
          WHEN bool_or(assertion.is_current AND assertion.review_status = 'approved') THEN 'approved_by_policy'
          WHEN bool_or(assertion.is_current AND assertion.review_status = 'rejected') THEN 'rejected'
          ELSE 'unresolved'
        END AS resolution_state,
        CASE
          WHEN count(*) FILTER (WHERE assertion.is_current) = 0 THEN 'unresolved'
          WHEN bool_or(assertion.is_current AND assertion.review_status = 'pending') THEN 'pending'
          WHEN bool_or(assertion.is_current AND assertion.review_status = 'approved') THEN 'approved'
          WHEN bool_or(assertion.is_current AND assertion.review_status = 'rejected') THEN 'rejected'
          ELSE 'unresolved'
        END AS review_status,
        CASE
          WHEN count(*) FILTER (WHERE assertion.is_current) = 0 THEN 'unresolved'
          WHEN bool_or(assertion.is_current AND assertion.review_status = 'approved'
            AND assertion.eligibility_status = 'eligible') THEN 'eligible'
          WHEN bool_or(assertion.is_current AND assertion.eligibility_status = 'candidate') THEN 'candidate'
          WHEN bool_or(assertion.is_current) THEN 'not_eligible'
          ELSE 'unresolved'
        END AS eligibility_status
      FROM signal_mention_attributions assertion
      WHERE assertion.workspace_id = $1::uuid
        AND assertion.attribution_basis = 'mention_semantic'
      GROUP BY assertion.mention_id
    ), governance AS (
      SELECT DISTINCT ON (event.mention_id) event.mention_id, event.action
      FROM signal_mention_governance_events event
      WHERE event.workspace_id = $1::uuid
      ORDER BY event.mention_id, event.created_at DESC, event.id DESC
    ), roots AS (
      SELECT root.id, root.workspace_id, root.inclusion_status,
        root.quality_flags, COALESCE(root.resolved_platform, root.platform) AS platform,
        COALESCE(semantic.resolution_state, 'unresolved') AS resolution_state,
        COALESCE(semantic.review_status, 'unresolved') AS review_status,
        COALESCE(semantic.eligibility_status, 'unresolved') AS eligibility_status,
        governance.action AS latest_governance_action
      FROM mentions root
      LEFT JOIN semantic ON semantic.mention_id = root.id
      LEFT JOIN governance ON governance.mention_id = root.id
      WHERE root.workspace_id = $1::uuid AND root.canonical_mention_id = root.id
        AND NOT signal_mention_has_only_incomplete_imports_v1(root.workspace_id,root.id)
    ), values AS (
      SELECT id, 'inclusion_status'::text AS dimension, inclusion_status AS key,
        inclusion_status AS label FROM roots
      UNION ALL SELECT id, 'resolution_state', resolution_state, resolution_state FROM roots
      UNION ALL SELECT id, 'review_status', review_status, review_status FROM roots
      UNION ALL SELECT id, 'eligibility_status', eligibility_status, eligibility_status FROM roots
      UNION ALL SELECT id, 'platform', lower(platform), platform FROM roots WHERE platform IS NOT NULL
      UNION ALL SELECT id, 'latest_governance_action', latest_governance_action,
        latest_governance_action FROM roots WHERE latest_governance_action IS NOT NULL
      UNION ALL
      SELECT root.id, 'quality_flag', flag.key, flag.key
      FROM roots root
      CROSS JOIN LATERAL (
        SELECT item.key
        FROM jsonb_each(CASE WHEN jsonb_typeof(root.quality_flags) = 'object'
          THEN root.quality_flags ELSE '{}'::jsonb END) item(key, value)
        WHERE lower(item.value::text) IN ('true', '"true"', '1', '"yes"')
        UNION
        SELECT value
        FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(root.quality_flags) = 'array'
          THEN root.quality_flags ELSE '[]'::jsonb END) value
      ) flag
      UNION ALL
      SELECT DISTINCT root.id, 'provenance_source', source.id::text, source.name
      FROM roots root
      JOIN signal_mention_import_memberships membership
        ON membership.workspace_id = $1::uuid AND membership.mention_id = root.id
      JOIN data_sources source ON source.id = membership.data_source_id
        AND source.workspace_id = $1::uuid
    )
    SELECT dimension, key, min(label) AS label, count(DISTINCT id)::int AS count
    FROM values
    WHERE key IS NOT NULL AND btrim(key) <> ''
    GROUP BY dimension, key
    ORDER BY dimension, count DESC, key
  `, [args.workspaceId]);
  const facets: Record<string, typeof result.rows> = {};
  for (const row of result.rows) (facets[row.dimension] ??= []).push(row);
  return {
    contract_version: "signal-admin-mention-facets-v1" as const,
    scope: "all_workspace_canonical_roots" as const,
    facets
  };
}

export async function loadSignalAdminMentionOperatorV1(args: {
  workspaceId: string;
  mentionId: string;
}) {
  const result = await pool.query<{
      requested_mention_id: string;
      canonical_mention_id: string;
      inclusion_status: string;
      exclusion_reason: string | null;
      quality_score: number | null;
      quality_flags: unknown;
      author_id: string | null;
      author_platform: string | null;
      author_handle: string | null;
      author_display_name: string | null;
      author_followers: number | null;
      author_country: string | null;
      author_verified: boolean | null;
      author_business: boolean | null;
      aliases: Array<Record<string, unknown>>;
      imports: Array<Record<string, unknown>>;
      studies: Array<Record<string, unknown>>;
      assertions: Array<Record<string, unknown>>;
      reviews: Array<Record<string, unknown>>;
      populations: Array<Record<string, unknown>>;
      tags: Array<Record<string, unknown>>;
      entities: Array<Record<string, unknown>>;
      features: Array<Record<string, unknown>>;
      codings: Array<Record<string, unknown>>;
      evidence: Array<Record<string, unknown>>;
      governance: Array<Record<string, unknown>>;
    }>(`
      WITH root AS (
        SELECT requested.id AS requested_mention_uuid,
          requested.id::text AS requested_mention_id,
          canonical.id AS canonical_mention_uuid,
          canonical.id::text AS canonical_mention_id,
          canonical.inclusion_status, canonical.exclusion_reason,
          canonical.quality_score, canonical.quality_flags,
          author.id::text AS author_id, author.platform AS author_platform,
          author.handle AS author_handle, author.display_name AS author_display_name,
          author.follower_count_last_seen AS author_followers,
          author.inferred_country AS author_country,
          author.is_verified AS author_verified,
          author.is_business AS author_business
        FROM mentions requested
        JOIN mentions canonical
          ON canonical.id = requested.canonical_mention_id
         AND canonical.workspace_id = requested.workspace_id
         AND canonical.canonical_mention_id = canonical.id
        LEFT JOIN authors author ON author.id = canonical.author_id
        WHERE requested.id = $2::uuid
          AND requested.workspace_id = $1::uuid
          AND NOT signal_mention_has_only_incomplete_imports_v1(
            canonical.workspace_id,canonical.id
          )
      ), family AS MATERIALIZED (
        SELECT mention.*
        FROM mentions mention
        JOIN root ON mention.workspace_id = $1::uuid
          AND mention.canonical_mention_id = root.canonical_mention_uuid
      )
      SELECT root.*,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'mention_id', mention.id::text,
          'is_canonical', mention.id = root.canonical_mention_uuid,
          'source_system', mention.source_system, 'platform', mention.platform,
          'data_source_id', mention.data_source_id::text,
          'source_file_id', mention.source_file_id::text,
          'created_at', mention.created_at::text
        ) ORDER BY (mention.id = root.canonical_mention_uuid) DESC, mention.created_at, mention.id)
          FROM family mention), '[]'::jsonb) AS aliases,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'membership_id', membership.id::text,
          'import_batch_id', membership.import_batch_id::text,
          'data_source_id', membership.data_source_id::text,
          'source_name', source.name, 'source_type', source.source_type,
          'provider', source.provider, 'import_status', batch.status,
          'imported_at', batch.created_at::text, 'created_at', membership.created_at::text
        ) ORDER BY membership.created_at, membership.id)
          FROM signal_mention_import_memberships membership
          JOIN data_sources source ON source.id = membership.data_source_id
            AND source.workspace_id = membership.workspace_id
          JOIN import_batches batch ON batch.id = membership.import_batch_id
            AND batch.workspace_id = membership.workspace_id
          WHERE membership.workspace_id = $1::uuid
            AND membership.mention_id = root.canonical_mention_uuid), '[]'::jsonb) AS imports,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'membership_id', membership.id::text,
          'study_corpus_id', membership.study_corpus_id::text,
          'study_name', corpus.name, 'import_batch_id', membership.import_batch_id::text,
          'membership_role', membership.membership_role,
          'created_at', membership.created_at::text
        ) ORDER BY membership.created_at, membership.id)
          FROM signal_mention_study_memberships membership
          JOIN study_corpora corpus ON corpus.id = membership.study_corpus_id
          WHERE membership.workspace_id = $1::uuid
            AND membership.mention_id = root.canonical_mention_uuid), '[]'::jsonb) AS studies,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', assertion.id::text, 'scope', assertion.scope,
          'entity_type', assertion.entity_type, 'entity_id', assertion.entity_id::text,
          'entity_label', assertion.entity_label, 'confidence', assertion.confidence::text,
          'review_status', assertion.review_status,
          'eligibility_status', assertion.eligibility_status,
          'attribution_source', assertion.attribution_source,
          'evidence_kind', assertion.evidence_kind, 'evidence_hash', assertion.evidence_hash,
          'semantic_policy_key', assertion.semantic_policy_key,
          'policy_version', assertion.policy_version, 'model_version', assertion.model_version,
          'assertion_version', assertion.assertion_version,
          'supersedes_attribution_id', assertion.supersedes_attribution_id::text,
          'is_current', assertion.is_current, 'approval_source', assertion.approval_source,
          'approved_at', assertion.approved_at::text,
          'approved_by_user_id', assertion.approved_by_user_id::text,
          'approved_by_display_name', reviewer.full_name,
          'created_at', assertion.created_at::text, 'updated_at', assertion.updated_at::text
        ) ORDER BY assertion.is_current DESC, assertion.assertion_version DESC, assertion.id)
          FROM signal_mention_attributions assertion
          LEFT JOIN users reviewer ON reviewer.id = assertion.approved_by_user_id
          WHERE assertion.workspace_id = $1::uuid
            AND assertion.mention_id = root.canonical_mention_uuid
            AND assertion.attribution_basis = 'mention_semantic'), '[]'::jsonb) AS assertions,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', event.id::text, 'attribution_id', event.attribution_id::text,
          'action', event.action, 'previous_review_status', event.previous_review_status,
          'next_review_status', event.next_review_status,
          'previous_eligibility_status', event.previous_eligibility_status,
          'next_eligibility_status', event.next_eligibility_status,
          'reviewer_user_id', event.reviewer_user_id::text,
          'reviewer_display_name', reviewer.full_name,
          'review_policy_key', event.review_policy_key,
          'review_policy_version', event.review_policy_version,
          'rationale_hash', event.rationale_hash, 'created_at', event.created_at::text
        ) ORDER BY event.created_at, event.id)
          FROM signal_mention_attribution_review_events event
          JOIN signal_mention_attributions assertion ON assertion.id = event.attribution_id
            AND assertion.workspace_id = event.workspace_id
          LEFT JOIN users reviewer ON reviewer.id = event.reviewer_user_id
          WHERE event.workspace_id = $1::uuid
            AND assertion.mention_id = root.canonical_mention_uuid), '[]'::jsonb) AS reviews,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'population_id', definition.id::text, 'population_key', definition.population_key,
          'version', definition.version, 'purpose', definition.purpose,
          'population_status', definition.status,
          'contract_version', definition.definition->>'contract_version',
          'membership_status', membership.membership_status,
          'membership_reason', membership.membership_reason,
          'effective_at', membership.effective_at::text, 'removed_at', membership.removed_at::text,
          'is_current_pointer', pointer.population_id IS NOT NULL
        ) ORDER BY definition.purpose, definition.version, definition.id)
          FROM signal_population_memberships membership
          JOIN signal_population_definitions definition ON definition.id = membership.population_id
            AND definition.workspace_id = membership.workspace_id
          LEFT JOIN signal_workspace_population_pointers pointer
            ON pointer.workspace_id = definition.workspace_id
           AND pointer.purpose = definition.purpose AND pointer.population_id = definition.id
          WHERE membership.workspace_id = $1::uuid
            AND membership.mention_id = root.canonical_mention_uuid), '[]'::jsonb) AS populations,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', tag.id::text, 'subject_id', tag.subject_id::text,
          'term_key', term.term_key, 'label', term.label,
          'taxonomy_key', taxonomy.taxonomy_key, 'value', tag.value,
          'score', tag.score::text, 'confidence', tag.confidence, 'source', tag.source,
          'review_status', tag.review_status, 'approval_source', tag.approval_source,
          'approval_policy_version', tag.approval_policy_version,
          'approved_at', tag.approved_at::text,
          'signal_taxonomy_profile_id', tag.signal_taxonomy_profile_id::text,
          'tb_analysis_id', tag.tb_analysis_id::text, 'created_at', tag.created_at::text
        ) ORDER BY taxonomy.taxonomy_key, term.term_key, tag.created_at, tag.id)
          FROM record_tags tag
          JOIN taxonomy_terms term ON term.id = tag.taxonomy_term_id
          JOIN taxonomies taxonomy ON taxonomy.id = term.taxonomy_id
          WHERE tag.subject_type = 'mention'
            AND tag.subject_id IN (SELECT id FROM family)), '[]'::jsonb) AS tags,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', link.id::text, 'subject_id', link.subject_id::text,
          'relation_type', link.relation_type, 'confidence', link.confidence,
          'entity_id', entity.id::text, 'entity_type', entity.entity_type,
          'canonical_name', entity.canonical_name, 'status', entity.status
        ) ORDER BY entity.entity_type, entity.canonical_name, link.id)
          FROM record_entity_links link
          JOIN intelligence_entities entity ON entity.id = link.entity_id
          WHERE link.subject_type = 'mention'
            AND link.subject_id IN (SELECT id FROM family)), '[]'::jsonb) AS entities,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', feature.id::text, 'subject_id', feature.subject_id::text,
          'feature_key', feature.feature_key, 'feature_value', feature.feature_value,
          'value_type', feature.value_type, 'confidence', feature.confidence,
          'source', feature.source, 'model_version_id', feature.model_version_id::text,
          'tb_analysis_id', feature.tb_analysis_id::text, 'created_at', feature.created_at::text
        ) ORDER BY feature.feature_key, feature.created_at, feature.id)
          FROM record_feature_values feature
          WHERE feature.subject_type = 'mention'
            AND feature.subject_id IN (SELECT id FROM family)), '[]'::jsonb) AS features,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', coding.id::text, 'mention_id', coding.mention_id::text,
          'tb_analysis_id', coding.tb_analysis_id::text, 'finding_id', coding.finding_id::text,
          'polarity', coding.polarity, 'layer', coding.layer,
          'intensity_score', coding.intensity_score::text,
          'emergent_tags', coding.emergent_tags, 'ambiguous', coding.ambiguous,
          'report_key', analysis.report_key, 'analysis_status', analysis.status,
          'created_at', coding.created_at::text
        ) ORDER BY coding.created_at, coding.id)
          FROM tb_mention_codings coding
          JOIN tb_analyses analysis ON analysis.id = coding.tb_analysis_id
          WHERE coding.mention_id IN (SELECT id FROM family)
            AND analysis.workspace_id = $1::uuid), '[]'::jsonb) AS codings,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'citation_id', citation.id::text, 'mention_id', citation.mention_id::text,
          'is_protagonist', citation.is_protagonist,
          'finding_row_id', finding.id::text, 'finding_id', finding.finding_id,
          'polarity', finding.polarity, 'layer', finding.layer,
          'tb_analysis_id', analysis.id::text, 'release_id', release.id::text,
          'report_key', release.report_key, 'report_revision', release.report_revision,
          'release_status', release.status,
          'is_current_release', current_release.release_id IS NOT NULL
        ) ORDER BY analysis.created_at, finding.position_in_layer, citation.position, citation.id)
          FROM tb_finding_citations citation
          JOIN tb_findings finding ON finding.id = citation.finding_id
          JOIN tb_analyses analysis ON analysis.id = finding.tb_analysis_id
          LEFT JOIN signal_workspace_releases release ON release.workspace_id = analysis.workspace_id
            AND release.tb_analysis_id = analysis.id
          LEFT JOIN signal_workspace_report_current_releases current_release
            ON current_release.workspace_id = release.workspace_id
           AND current_release.report_key = release.report_key
           AND current_release.release_id = release.id
          WHERE citation.mention_id IN (SELECT id FROM family)
            AND analysis.workspace_id = $1::uuid), '[]'::jsonb) AS evidence,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', event.id::text, 'action', event.action,
          'previous_inclusion_status', event.previous_inclusion_status,
          'next_inclusion_status', event.next_inclusion_status,
          'previous_exclusion_reason', event.previous_exclusion_reason,
          'next_exclusion_reason', event.next_exclusion_reason,
          'actor_user_id', event.actor_user_id::text,
          'actor_display_name', actor.full_name, 'reason', event.reason,
          'reverts_event_id', event.reverts_event_id::text,
          'created_at', event.created_at::text
        ) ORDER BY event.created_at, event.id)
          FROM signal_mention_governance_events event
          LEFT JOIN users actor ON actor.id = event.actor_user_id
          WHERE event.workspace_id = $1::uuid
            AND event.mention_id = root.canonical_mention_uuid), '[]'::jsonb) AS governance
      FROM root
    `, [args.workspaceId, args.mentionId]);
  const root = result.rows[0];
  if (!root) return null;
  const assertionRows: Array<Record<string, unknown> & { resolution_state: string }> = root.assertions.map((row) => ({
    ...row,
    resolution_state: semanticResolutionState(row as Record<string, unknown>)
  }));
  return {
    contract_version: "signal-admin-mention-operator-v1" as const,
    canonical: {
        requested_mention_id: root.requested_mention_id,
        mention_id: root.canonical_mention_id,
        requested_via_alias: root.requested_mention_id !== root.canonical_mention_id,
        aliases: root.aliases
      },
      author: root.author_id ? {
        id: root.author_id,
        platform: root.author_platform,
        handle: root.author_handle,
        display_name: root.author_display_name,
        follower_count: root.author_followers,
        country: root.author_country,
        is_verified: root.author_verified,
        is_business: root.author_business
      } : null,
      inclusion: {
        status: root.inclusion_status,
        exclusion_reason: root.exclusion_reason,
        quality_score: root.quality_score,
        quality_flags: sanitizeOperatorValue(root.quality_flags)
      },
      provenance: {
        imports: root.imports,
        studies: root.studies
      },
      semantic: {
        current: assertionRows.filter((row) => Boolean(row["is_current"])),
        history: assertionRows,
        review_events: root.reviews
      },
      operational: {
        populations: root.populations
      },
      enrichment: {
        tags: root.tags,
        entities: root.entities,
        features: root.features.map((row) => ({
          ...row,
          feature_value: sanitizeOperatorValue((row as Record<string, unknown>).feature_value)
        }))
      },
      triggers_barriers: {
        codings: root.codings,
        evidence_and_releases: root.evidence
      },
      governance: {
        history: root.governance,
        latest_review_request: [...root.governance].reverse().find(
          (row) => (row as { action?: string }).action === "send_to_review"
        ) ?? null
    }
  };
}

export function sanitizeOperatorValue(value: unknown, depth = 0): OperatorValue {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 500);
  if (depth >= 3) return null;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeOperatorValue(item, depth + 1));
  if (typeof value !== "object") return null;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !BLOCKED_OPERATOR_KEYS.test(key))
    .slice(0, 50)
    .map(([key, item]) => [key, sanitizeOperatorValue(item, depth + 1)]));
}

function semanticResolutionState(row: Record<string, unknown>) {
  if (!row.is_current) return "superseded";
  if (row.review_status === "rejected") return "rejected";
  if (row.review_status === "pending") return "pending";
  if (row.approval_source === "claude_semantic_resolution" || row.evidence_kind === "model_reviewed_context") {
    return "approved_by_model";
  }
  if (row.approved_by_user_id || row.approval_source === "noisia_admin_semantic_review") {
    return "approved_by_human";
  }
  return "approved_by_policy";
}

function semanticSummarySql(rootAlias: string) {
  return `
    SELECT
      CASE
        WHEN count(*) FILTER (WHERE assertion.is_current) = 0
          AND count(*) > 0 THEN 'superseded'
        WHEN count(*) FILTER (WHERE assertion.is_current) = 0 THEN 'unresolved'
        WHEN bool_or(assertion.is_current AND assertion.review_status = 'pending') THEN 'pending'
        WHEN bool_or(assertion.is_current AND assertion.review_status = 'approved'
          AND (assertion.approval_source = 'claude_semantic_resolution'
            OR assertion.evidence_kind = 'model_reviewed_context')) THEN 'approved_by_model'
        WHEN bool_or(assertion.is_current AND assertion.review_status = 'approved'
          AND (assertion.approved_by_user_id IS NOT NULL
            OR assertion.approval_source = 'noisia_admin_semantic_review')) THEN 'approved_by_human'
        WHEN bool_or(assertion.is_current AND assertion.review_status = 'approved') THEN 'approved_by_policy'
        WHEN bool_or(assertion.is_current AND assertion.review_status = 'rejected') THEN 'rejected'
        ELSE 'unresolved'
      END AS resolution_state,
      CASE
        WHEN count(*) FILTER (WHERE assertion.is_current) = 0 THEN 'unresolved'
        WHEN bool_or(assertion.is_current AND assertion.review_status = 'pending') THEN 'pending'
        WHEN bool_or(assertion.is_current AND assertion.review_status = 'approved') THEN 'approved'
        WHEN bool_or(assertion.is_current AND assertion.review_status = 'rejected') THEN 'rejected'
        ELSE 'unresolved'
      END AS review_status,
      CASE
        WHEN count(*) FILTER (WHERE assertion.is_current) = 0 THEN 'unresolved'
        WHEN bool_or(assertion.is_current AND assertion.review_status = 'approved'
          AND assertion.eligibility_status = 'eligible') THEN 'eligible'
        WHEN bool_or(assertion.is_current AND assertion.eligibility_status = 'candidate') THEN 'candidate'
        WHEN bool_or(assertion.is_current) THEN 'not_eligible'
        ELSE 'unresolved'
      END AS eligibility_status,
      count(*) FILTER (WHERE assertion.is_current)::int AS current_assertion_count
    FROM signal_mention_attributions assertion
    WHERE assertion.workspace_id = ${rootAlias}.workspace_id
      AND assertion.mention_id = ${rootAlias}.id
      AND assertion.attribution_basis = 'mention_semantic'
  `;
}

function enumParameter<const T extends readonly string[]>(
  params: URLSearchParams,
  key: string,
  values: T
): T[number] | null {
  const value = params.get(key)?.trim() || null;
  params.delete(key);
  if (value && !(values as readonly string[]).includes(value)) {
    throw new SignalBackendContractError("invalid_filter", `${key} is not supported.`, { field: key });
  }
  return value as T[number] | null;
}

function stringParameter(params: URLSearchParams, key: string) {
  const value = params.get(key)?.trim() || null;
  params.delete(key);
  if (value && (value.length > 100 || !/^[\p{L}\p{N}_.:-]+$/u.test(value))) {
    throw new SignalBackendContractError("invalid_filter", `${key} is invalid.`, { field: key });
  }
  return value;
}

function uuidParameter(params: URLSearchParams, key: string) {
  const value = params.get(key)?.trim() || null;
  params.delete(key);
  if (value && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new SignalBackendContractError("invalid_filter", `${key} must be a UUID.`, { field: key });
  }
  return value;
}

function numberParameter(params: URLSearchParams, key: string) {
  const raw = params.get(key)?.trim() || null;
  params.delete(key);
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new SignalBackendContractError("invalid_filter", `${key} must be between 0 and 100.`, { field: key });
  }
  return value;
}
