import pg from "pg";

import { getDatabaseSslConfig, requireSafeDatabaseReadTarget } from "../seeds/connection.js";
import { requireEnv } from "../seeds/env.js";

type ReviewTagRow = {
  id: string;
  confidence: string | null;
  evidence: unknown;
  mention_platform: string | null;
  mention_preview: string | null;
  review_status: string;
  source: string | null;
  taxonomy_key: string;
  term_key: string;
  term_label: string | null;
  value: string | null;
};

type ReviewAssertionRow = {
  id: string;
  assertion_text: string;
  assertion_type: string;
  confidence: string | null;
  evidence: unknown;
  knowledge_source_title: string | null;
  link_count: number;
  status: string;
  usage_event_count: number;
};

type ReviewSummaryRow = {
  knowledge_assertion_review_events: number;
  knowledge_assertions_candidate: number;
  knowledge_assertions_with_evidence: number;
  record_tag_taxonomies: number;
  record_tags_reviewed: number;
  record_tags_total: number;
  record_tags_unreviewed: number;
  record_tags_with_evidence: number;
  tag_review_events: number;
};

function parsePositiveInteger(value: string | undefined, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function boolEnv(name: string) {
  return process.env[name] === "true";
}

function evidenceItems(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function redactedId(value: string, showIds: boolean) {
  return showIds ? value : "set_redacted";
}

function maybePrivate<T>(value: T, showContext: boolean) {
  return showContext ? value : "redacted_set_NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_CONTEXT_true_to_inspect_locally";
}

async function loadSummary(client: pg.Client, corpusId: string) {
  const result = await client.query<ReviewSummaryRow>(
    `
      WITH corpus_scope AS (
        SELECT sc.id AS corpus_id, sc.brand_id
        FROM study_corpora sc
        WHERE sc.id = $1
      )
      SELECT
        (SELECT count(*)::int FROM record_tags rt WHERE rt.study_corpus_id = cs.corpus_id) AS record_tags_total,
        (
          SELECT count(*)::int
          FROM record_tags rt
          WHERE rt.study_corpus_id = cs.corpus_id
            AND rt.review_status = 'unreviewed'
        ) AS record_tags_unreviewed,
        (
          SELECT count(*)::int
          FROM record_tags rt
          WHERE rt.study_corpus_id = cs.corpus_id
            AND rt.review_status <> 'unreviewed'
        ) AS record_tags_reviewed,
        (
          SELECT count(*)::int
          FROM record_tags rt
          WHERE rt.study_corpus_id = cs.corpus_id
            AND jsonb_typeof(rt.evidence) = 'array'
            AND jsonb_array_length(rt.evidence) > 0
        ) AS record_tags_with_evidence,
        (
          SELECT count(DISTINCT tx.taxonomy_key)::int
          FROM record_tags rt
          JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
          JOIN taxonomies tx ON tx.id = tt.taxonomy_id
          WHERE rt.study_corpus_id = cs.corpus_id
        ) AS record_tag_taxonomies,
        (
          SELECT count(*)::int
          FROM tag_review_events tre
          JOIN record_tags rt ON rt.id = tre.record_tag_id
          WHERE rt.study_corpus_id = cs.corpus_id
        ) AS tag_review_events,
        (
          SELECT count(*)::int
          FROM knowledge_assertions ka
          JOIN brand_knowledge_sources bks ON bks.id = ka.knowledge_source_id
          WHERE ka.status = 'candidate'
            AND (
              bks.study_corpus_id = cs.corpus_id
              OR (cs.brand_id IS NOT NULL AND bks.brand_id = cs.brand_id AND bks.study_corpus_id IS NULL)
            )
        ) AS knowledge_assertions_candidate,
        (
          SELECT count(*)::int
          FROM knowledge_assertions ka
          JOIN brand_knowledge_sources bks ON bks.id = ka.knowledge_source_id
          WHERE jsonb_typeof(ka.evidence) = 'array'
            AND jsonb_array_length(ka.evidence) > 0
            AND (
              bks.study_corpus_id = cs.corpus_id
              OR (cs.brand_id IS NOT NULL AND bks.brand_id = cs.brand_id AND bks.study_corpus_id IS NULL)
            )
        ) AS knowledge_assertions_with_evidence,
        (
          SELECT count(*)::int
          FROM knowledge_assertion_review_events kare
          JOIN knowledge_assertions ka ON ka.id = kare.knowledge_assertion_id
          JOIN brand_knowledge_sources bks ON bks.id = ka.knowledge_source_id
          WHERE bks.study_corpus_id = cs.corpus_id
             OR (cs.brand_id IS NOT NULL AND bks.brand_id = cs.brand_id AND bks.study_corpus_id IS NULL)
        ) AS knowledge_assertion_review_events
      FROM corpus_scope cs
    `,
    [corpusId]
  );
  return result.rows[0] ?? null;
}

async function loadTags(client: pg.Client, corpusId: string, limit: number) {
  const result = await client.query<ReviewTagRow>(
    `
      SELECT
        rt.id,
        rt.value,
        rt.confidence,
        rt.source,
        rt.review_status,
        rt.evidence,
        tx.taxonomy_key,
        tt.term_key,
        tt.label AS term_label,
        mention.platform AS mention_platform,
        COALESCE(mention.text_snippet, left(mention.text_clean, 320)) AS mention_preview
      FROM record_tags rt
      JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
      JOIN taxonomies tx ON tx.id = tt.taxonomy_id
      LEFT JOIN mentions mention
        ON rt.subject_type = 'mention'
       AND mention.id = rt.subject_id
       AND mention.study_corpus_id = rt.study_corpus_id
      WHERE rt.study_corpus_id = $1
        AND rt.review_status = 'unreviewed'
        AND jsonb_typeof(rt.evidence) = 'array'
        AND jsonb_array_length(rt.evidence) > 0
      ORDER BY
        CASE tx.taxonomy_key
          WHEN 'trigger' THEN 0
          WHEN 'barrier' THEN 1
          WHEN 'journey_stage' THEN 2
          ELSE 3
        END,
        CASE rt.confidence WHEN 'low' THEN 0 WHEN 'medium' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,
        rt.created_at DESC,
        rt.id
      LIMIT $2
    `,
    [corpusId, limit]
  );
  return result.rows;
}

async function loadAssertions(client: pg.Client, corpusId: string, limit: number) {
  const result = await client.query<ReviewAssertionRow>(
    `
      WITH corpus_scope AS (
        SELECT sc.id AS corpus_id, sc.brand_id
        FROM study_corpora sc
        WHERE sc.id = $1
      )
      SELECT
        ka.id,
        bks.title AS knowledge_source_title,
        ka.assertion_text,
        ka.assertion_type,
        ka.confidence,
        ka.status,
        ka.evidence,
        COALESCE(link_counts.link_count, 0)::int AS link_count,
        COALESCE(usage_counts.usage_event_count, 0)::int AS usage_event_count
      FROM corpus_scope cs
      JOIN brand_knowledge_sources bks
        ON bks.study_corpus_id = cs.corpus_id
        OR (cs.brand_id IS NOT NULL AND bks.brand_id = cs.brand_id AND bks.study_corpus_id IS NULL)
      JOIN knowledge_assertions ka ON ka.knowledge_source_id = bks.id
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS link_count
        FROM knowledge_assertion_links kal
        WHERE kal.knowledge_assertion_id = ka.id
      ) link_counts ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS usage_event_count
        FROM knowledge_usage_events kue
        WHERE kue.knowledge_assertion_id = ka.id
      ) usage_counts ON true
      WHERE ka.status = 'candidate'
        AND jsonb_typeof(ka.evidence) = 'array'
        AND jsonb_array_length(ka.evidence) > 0
      ORDER BY
        CASE ka.confidence WHEN 'low' THEN 0 WHEN 'medium' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,
        ka.created_at DESC,
        ka.id
      LIMIT $2
    `,
    [corpusId, limit]
  );
  return result.rows;
}

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const corpusId = process.env.NOISIA_DATA_OS_REVIEW_CORPUS_ID?.trim()
    || requireEnv("NOISIA_DATA_OS_BACKFILL_CORPUS_ID");
  const limit = parsePositiveInteger(process.env.NOISIA_DATA_OS_REVIEW_QUEUE_LIMIT, 5, 25);
  const showIds = boolEnv("NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_IDS");
  const showContext = boolEnv("NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_CONTEXT");

  requireSafeDatabaseReadTarget(databaseUrl, {
    operation: "data-os:review-queue",
    allowRemoteEnv: "NOISIA_DATA_OS_REVIEW_QUEUE_ALLOW_REMOTE"
  });

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig()
  });

  await client.connect();
  try {
    const summary = await loadSummary(client, corpusId);
    const tags = await loadTags(client, corpusId, limit);
    const assertions = await loadAssertions(client, corpusId, limit);
    const selectedTagId = tags[0]?.id ?? "<record_tag_id>";
    const selectedAssertionId = assertions[0]?.id ?? "<knowledge_assertion_id>";

    console.log(JSON.stringify({
      ok: true,
      corpus_id: showIds ? corpusId : "set_redacted",
      contains_sensitive_review_ids: showIds,
      contains_private_review_context: showContext,
      do_not_commit_or_paste_when_sensitive: showIds || showContext,
      note: showIds || showContext
        ? "Local operator aid only. Do not attach this output to PR evidence."
        : "IDs and context are redacted by default. Set SHOW_IDS/SHOW_CONTEXT only while inspecting locally.",
      summary: {
        ...(summary ?? {}),
        ready_for_human_review:
          Number(summary?.record_tags_total ?? 0) > 0 &&
          Number(summary?.record_tags_with_evidence ?? 0) >= Number(summary?.record_tags_total ?? 0) &&
          Number(summary?.record_tag_taxonomies ?? 0) >= 5 &&
          Number(summary?.knowledge_assertions_candidate ?? 0) > 0 &&
          Number(summary?.knowledge_assertions_with_evidence ?? 0) >= Number(summary?.knowledge_assertions_candidate ?? 0),
        required_before_client_visible: true
      },
      tags: tags.map((tag) => ({
        confidence: tag.confidence,
        evidence_count: evidenceItems(tag.evidence).length,
        evidence_preview: maybePrivate(evidenceItems(tag.evidence).slice(0, 3), showContext),
        id: redactedId(tag.id, showIds),
        mention_platform: tag.mention_platform,
        mention_preview: maybePrivate(tag.mention_preview, showContext),
        review_status: tag.review_status,
        source: tag.source,
        taxonomy_key: tag.taxonomy_key,
        term_key: tag.term_key,
        term_label: tag.term_label,
        value: maybePrivate(tag.value, showContext)
      })),
      assertions: assertions.map((assertion) => ({
        assertion_text: maybePrivate(assertion.assertion_text, showContext),
        assertion_type: assertion.assertion_type,
        confidence: assertion.confidence,
        evidence_count: evidenceItems(assertion.evidence).length,
        evidence_preview: maybePrivate(evidenceItems(assertion.evidence).slice(0, 3), showContext),
        id: redactedId(assertion.id, showIds),
        knowledge_source_title: maybePrivate(assertion.knowledge_source_title, showContext),
        link_count: assertion.link_count,
        status: assertion.status,
        usage_event_count: assertion.usage_event_count
      })),
      suggested_exports: {
        NOISIA_DATA_OS_REVIEW_CORPUS_ID: showIds ? corpusId : "<study_corpus_id>",
        NOISIA_DATA_OS_REVIEW_TAG_ID: showIds ? selectedTagId : "<record_tag_id>",
        NOISIA_DATA_OS_REVIEW_ASSERTION_ID: showIds ? selectedAssertionId : "<knowledge_assertion_id>",
        NOISIA_DATA_OS_REVIEW_TAG_ACTION: "approve",
        NOISIA_DATA_OS_REVIEW_ASSERTION_ACTION: "approve",
        NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED: "true"
      },
      next_command: "corepack pnpm data-os:staging-finalize"
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
