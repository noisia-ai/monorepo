import {
  signalTaxonomyCoverageV1,
  type SignalTaxonomyKindV1
} from "@noisia/query-engine";

import { pool } from "@/lib/db";
import {
  requireOperationalCorpus,
  type ResolvedSignalWorkspace
} from "@/lib/data-os/signal-workspace";

const FORBIDDEN_TERM_KEYS = new Set([
  "trigger",
  "triggers",
  "barrier",
  "barriers",
  "decision_layer",
  "decision_layers",
  "observed_signal",
  "observed_signals",
  "finding",
  "findings",
  "opportunity",
  "opportunities",
  "recommendation",
  "recommendations"
]);

type ReconciliationRow = {
  id: string;
  kind: SignalTaxonomyKindV1;
  version: number;
  status: string;
  context_hash: string;
  taxonomy_id: string;
  rule_set_id: string;
  model_version_id: string;
  rule_taxonomy_id: string | null;
  model_rule_set_id: string | null;
  term_key: string | null;
  term_status: string | null;
  statement: string | null;
};

export async function reconcileSignalTaxonomyProfileV1(args: {
  workspace: ResolvedSignalWorkspace;
  profile_id: string;
}) {
  const result = await pool.query<ReconciliationRow>(`
    SELECT profile.id::text, profile.kind, profile.version, profile.status,
      profile.context_hash, profile.taxonomy_id::text,
      profile.rule_set_id::text, profile.model_version_id::text,
      rule_set.taxonomy_id::text AS rule_taxonomy_id,
      model.tagging_rule_set_id::text AS model_rule_set_id,
      term.term_key, term.status AS term_status,
      NULLIF(term.metadata->>'statement', '') AS statement
    FROM signal_taxonomy_profiles profile
    JOIN tagging_rule_sets rule_set ON rule_set.id = profile.rule_set_id
    JOIN tagging_model_versions model ON model.id = profile.model_version_id
    LEFT JOIN taxonomy_terms term ON term.taxonomy_id = profile.taxonomy_id
    WHERE profile.id = $1::uuid AND profile.workspace_id = $2::uuid
    ORDER BY term.term_key
  `, [args.profile_id, args.workspace.id]);
  const profile = result.rows[0];
  if (!profile) return null;
  const terms = result.rows.filter((row) => row.term_key);
  const blockers: string[] = [];
  if (terms.length === 0) blockers.push("taxonomy_has_no_terms");
  if (profile.rule_taxonomy_id !== profile.taxonomy_id) {
    blockers.push("rule_set_taxonomy_mismatch");
  }
  if (profile.model_rule_set_id !== profile.rule_set_id) {
    blockers.push("model_rule_set_mismatch");
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(profile.context_hash)) {
    blockers.push("context_hash_invalid");
  }
  if (terms.some((term) => term.term_key && FORBIDDEN_TERM_KEYS.has(term.term_key))) {
    blockers.push("tb_or_strategic_concept_leaked_into_taxonomy");
  }
  if (profile.kind === "narrative" && terms.some((term) => !term.statement)) {
    blockers.push("narrative_statement_missing");
  }
  if (profile.kind === "topic" && terms.some((term) => Boolean(term.statement))) {
    blockers.push("topic_contains_narrative_statement");
  }
  if (terms.some((term) => !["candidate", "active"].includes(term.term_status ?? ""))) {
    blockers.push("term_status_not_activatable");
  }
  return {
    contract_version: "signal-topics-narratives-v1",
    profile_id: profile.id,
    workspace_id: args.workspace.id,
    kind: profile.kind,
    version: profile.version,
    status: profile.status,
    term_count: terms.length,
    ready_for_activation: profile.status === "draft" && blockers.length === 0,
    ready_for_backfill:
      ["active", "activating"].includes(profile.status)
      && blockers.length === 0,
    blockers
  };
}

export async function loadSignalTaxonomyCoverageV1(args: {
  workspace: ResolvedSignalWorkspace;
  profile_id?: string;
  include_emerging_candidates?: boolean;
}) {
  const corpus = requireOperationalCorpus(args.workspace);
  const profiles = await pool.query<{
    profile_id: string;
    kind: SignalTaxonomyKindV1;
    version: number;
    included_mentions: number;
    processed_mentions: number;
    approved_mentions: number;
    pending_mentions: number;
    rejected_mentions: number;
    approved_tag_assertions: number;
  }>(`
    WITH selected_profiles AS (
      SELECT profile.id, profile.kind, profile.version
      FROM signal_taxonomy_profiles profile
      WHERE profile.workspace_id = $1::uuid
        AND (
          ($3::uuid IS NULL AND profile.status = 'active')
          OR profile.id = $3::uuid
        )
    ), included AS (
      SELECT count(*)::int AS mention_count
      FROM mentions mention
      WHERE mention.study_corpus_id = $2::uuid
        AND mention.inclusion_status = 'included'
    )
    SELECT profile.id::text AS profile_id, profile.kind, profile.version,
      included.mention_count AS included_mentions,
      COALESCE(feature_stats.processed_mentions, 0)::int AS processed_mentions,
      COALESCE(tag_stats.approved_mentions, 0)::int AS approved_mentions,
      COALESCE(tag_stats.pending_mentions, 0)::int AS pending_mentions,
      COALESCE(tag_stats.rejected_mentions, 0)::int AS rejected_mentions,
      COALESCE(tag_stats.approved_tag_assertions, 0)::int
        AS approved_tag_assertions
    FROM selected_profiles profile
    CROSS JOIN included
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT feature.subject_id)::int AS processed_mentions
      FROM record_feature_values feature
      WHERE feature.study_corpus_id = $2::uuid
        AND feature.subject_type = 'mention'
        AND feature.feature_key =
          'signal_taxonomy_classification:' || profile.id::text
        AND feature.source = 'signal_taxonomy_profile:' || profile.id::text
    ) feature_stats ON true
    LEFT JOIN LATERAL (
      SELECT
        count(DISTINCT tag.subject_id) FILTER (
          WHERE tag.review_status = 'approved'
        )::int AS approved_mentions,
        count(DISTINCT tag.subject_id) FILTER (
          WHERE tag.review_status IN ('pending', 'unreviewed', 'needs_review')
        )::int AS pending_mentions,
        count(DISTINCT tag.subject_id) FILTER (
          WHERE tag.review_status = 'rejected'
        )::int AS rejected_mentions,
        count(tag.id) FILTER (
          WHERE tag.review_status = 'approved'
        )::int AS approved_tag_assertions
      FROM record_tags tag
      WHERE tag.study_corpus_id = $2::uuid
        AND tag.subject_type = 'mention'
        AND tag.signal_taxonomy_profile_id = profile.id
    ) tag_stats ON true
    ORDER BY profile.kind
  `, [args.workspace.id, corpus.id, args.profile_id ?? null]);

  const emerging = args.include_emerging_candidates
    ? await pool.query<{
        profile_id: string;
        reason: string;
        mention_count: number;
      }>(`
        SELECT profile.id::text AS profile_id,
          feature.feature_value->>'unclassified_reason' AS reason,
          count(*)::int AS mention_count
        FROM signal_taxonomy_profiles profile
        JOIN record_feature_values feature
          ON feature.study_corpus_id = $2::uuid
         AND feature.subject_type = 'mention'
         AND feature.feature_key = 'signal_taxonomy_classification:' || profile.id::text
         AND feature.source = 'signal_taxonomy_profile:' || profile.id::text
        WHERE profile.workspace_id = $1::uuid
          AND profile.status = 'active'
          AND COALESCE((feature.feature_value->>'assignment_count')::int, 0) = 0
          AND NULLIF(feature.feature_value->>'unclassified_reason', '') IS NOT NULL
        GROUP BY profile.id, feature.feature_value->>'unclassified_reason'
        ORDER BY mention_count DESC, reason
        LIMIT 100
      `, [args.workspace.id, corpus.id])
    : { rows: [] as Array<{ profile_id: string; reason: string; mention_count: number }> };

  return {
    contract_version: "signal-topics-narratives-v1",
    workspace_id: args.workspace.id,
    study_corpus_id: corpus.id,
    profiles: profiles.rows.map((row) => ({
      profile_id: row.profile_id,
      kind: row.kind,
      version: row.version,
      processed_mentions: Number(row.processed_mentions),
      ...signalTaxonomyCoverageV1({
        included_mentions: Number(row.included_mentions),
        processed_mentions: Number(row.processed_mentions),
        classified_mentions: Number(row.approved_mentions),
        tag_assertions: Number(row.approved_tag_assertions),
        pending_mentions: Number(row.pending_mentions),
        rejected_mentions: Number(row.rejected_mentions)
      })
    })),
    emerging_candidates: emerging.rows,
    emerging_candidates_visibility: args.include_emerging_candidates
      ? "internal_review_only"
      : "hidden"
  };
}

export async function reviewSignalTaxonomyTagV1(args: {
  workspace: ResolvedSignalWorkspace;
  profile_id: string;
  tag_id: string;
  reviewer_user_id: string;
  action: "approve" | "reject" | "needs_review";
  notes?: string;
}): Promise<Record<string, unknown> | null> {
  void args;
  throw new Error(
    "signal_classification_ledger_required_10b: taxonomy decisions must be appended to the classification authority before projection"
  );
}

export async function loadSignalTaxonomyTagV1(args: {
  workspace: ResolvedSignalWorkspace;
  profile_id: string;
  tag_id: string;
}) {
  const corpus = requireOperationalCorpus(args.workspace);
  const result = await pool.query(`
    SELECT tag.id::text, tag.subject_id::text, tag.value,
      tag.score::float8, tag.confidence, tag.evidence, tag.review_status,
      tag.created_at, term.term_key, term.label, term.description,
      profile.id::text AS profile_id, profile.kind, profile.version,
      profile.context_hash, profile.model_version_id::text,
      COALESCE(mention.text_snippet, left(mention.text_clean, 500))
        AS mention_preview,
      mention.published_at,
      COALESCE(
        jsonb_agg(jsonb_build_object(
          'id', event.id,
          'action', event.action,
          'reviewer_user_id', event.reviewer_user_id,
          'notes', event.notes,
          'created_at', event.created_at
        ) ORDER BY event.created_at, event.id)
          FILTER (WHERE event.id IS NOT NULL),
        '[]'::jsonb
      ) AS review_events
    FROM record_tags tag
    JOIN signal_taxonomy_profiles profile
      ON profile.id = tag.signal_taxonomy_profile_id
    JOIN taxonomy_terms term ON term.id = tag.taxonomy_term_id
    JOIN mentions mention
      ON mention.id = tag.subject_id
     AND mention.study_corpus_id = tag.study_corpus_id
    LEFT JOIN tag_review_events event ON event.record_tag_id = tag.id
    WHERE tag.id = $1::uuid
      AND profile.id = $2::uuid
      AND profile.workspace_id = $3::uuid
      AND tag.study_corpus_id = $4::uuid
    GROUP BY tag.id, term.id, profile.id, mention.id
  `, [args.tag_id, args.profile_id, args.workspace.id, corpus.id]);
  if (!result.rows[0]) return null;
  return {
    contract_version: "signal-topics-narratives-v1",
    workspace_id: args.workspace.id,
    study_corpus_id: corpus.id,
    tag: result.rows[0]
  };
}
