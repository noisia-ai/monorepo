import {
  signalTaxonomyCoverageV1,
  type SignalTaxonomyKindV1
} from "@noisia/query-engine";

import { pool } from "@/lib/db";
import type { ResolvedSignalWorkspace } from "@/lib/data-os/signal-workspace";

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
    ready_for_backfill: profile.status === "active" && blockers.length === 0,
    blockers
  };
}

export async function loadSignalTaxonomyCoverageV1(args: {
  workspace: ResolvedSignalWorkspace;
  profile_id?: string;
  include_emerging_candidates?: boolean;
}) {
  const corpus = args.workspace.corpora[0];
  if (!corpus) throw new Error("Signal workspace has no serving corpus.");
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
}) {
  const corpus = args.workspace.corpora[0];
  if (!corpus) throw new Error("Signal workspace has no serving corpus.");
  const nextStatus = {
    approve: "approved",
    reject: "rejected",
    needs_review: "needs_review"
  }[args.action];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{
      id: string;
      review_status: string;
      subject_id: string;
      term_key: string;
    }>(`
      SELECT tag.id::text, tag.review_status, tag.subject_id::text,
        term.term_key
      FROM record_tags tag
      JOIN taxonomy_terms term ON term.id = tag.taxonomy_term_id
      JOIN signal_taxonomy_profiles profile
        ON profile.id = tag.signal_taxonomy_profile_id
      WHERE tag.id = $1::uuid
        AND tag.signal_taxonomy_profile_id = $2::uuid
        AND profile.workspace_id = $3::uuid
        AND tag.study_corpus_id = $4::uuid
      FOR UPDATE OF tag
    `, [args.tag_id, args.profile_id, args.workspace.id, corpus.id]);
    const tag = current.rows[0];
    if (!tag) {
      await client.query("ROLLBACK");
      return null;
    }
    const updated = await client.query(`
      UPDATE record_tags
      SET review_status = $2
      WHERE id = $1::uuid
      RETURNING id::text, subject_id::text, review_status
    `, [args.tag_id, nextStatus]);
    const event = await client.query<{ id: string }>(`
      INSERT INTO tag_review_events (
        record_tag_id, reviewer_user_id, action,
        previous_value, next_value, notes
      ) VALUES (
        $1::uuid, $2::uuid, $3,
        jsonb_build_object('review_status', $4, 'term_key', $5),
        jsonb_build_object('review_status', $6, 'term_key', $5),
        $7
      )
      RETURNING id::text
    `, [
      args.tag_id,
      args.reviewer_user_id,
      args.action,
      tag.review_status,
      tag.term_key,
      nextStatus,
      args.notes?.trim() || null
    ]);
    await client.query(`
      WITH watermark AS (
        SELECT id
        FROM signal_data_watermarks
        WHERE workspace_id = $1::uuid AND study_corpus_id = $2::uuid
        ORDER BY accepted_at DESC, id
        LIMIT 1
      ), observed AS (
        SELECT published_at::date AS observed_on
        FROM mentions
        WHERE id = $3::uuid AND study_corpus_id = $2::uuid
      )
      INSERT INTO signal_data_invalidations (
        workspace_id, study_corpus_id, data_watermark_id,
        source_key, idempotency_key, reason,
        affected_from, affected_through, scope
      )
      SELECT $1::uuid, $2::uuid, watermark.id,
        'signal-taxonomy-review', 'taxonomy-review:' || $4::text,
        'taxonomy_review_changed', observed.observed_on, observed.observed_on,
        jsonb_build_object(
          'taxonomy_profile_id', $5::uuid,
          'record_tag_id', $6::uuid
        )
      FROM watermark CROSS JOIN observed
      ON CONFLICT (idempotency_key) DO NOTHING
    `, [
      args.workspace.id,
      corpus.id,
      tag.subject_id,
      event.rows[0]!.id,
      args.profile_id,
      args.tag_id
    ]);
    await client.query("COMMIT");
    return {
      contract_version: "signal-topics-narratives-v1",
      profile_id: args.profile_id,
      review_event_id: event.rows[0]!.id,
      tag: updated.rows[0]
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
