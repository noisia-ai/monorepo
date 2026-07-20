import pg from "pg";

import { getDatabaseSslConfig, isLocalDatabaseUrl, requireSafeDatabaseWriteTarget } from "../seeds/connection.js";
import { requireEnv } from "../seeds/env.js";

type ReviewAction = "approve" | "reject" | "needs_review";

type ReviewTargetSummary = {
  action: ReviewAction;
  confidence: string | null;
  evidence_count: number;
  next_status: string;
  previous_status: string;
  review_event_created: true;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVIEW_ACTIONS = new Set<ReviewAction>(["approve", "reject", "needs_review"]);
const TAG_REVIEW_STATUS_BY_ACTION: Record<ReviewAction, string> = {
  approve: "approved",
  reject: "rejected",
  needs_review: "needs_review"
};
const ASSERTION_STATUS_BY_ACTION: Record<ReviewAction, string> = {
  approve: "active",
  reject: "rejected",
  needs_review: "needs_review"
};

function requireUuidEnv(name: string) {
  const value = requireEnv(name).trim();
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`${name} must be a UUID.`);
  }
  return value;
}

function optionalUuidEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) return null;
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`${name} must be a UUID when provided.`);
  }
  return value;
}

function requireReviewAction(name: string, fallback: ReviewAction) {
  const value = (process.env[name]?.trim() || fallback) as ReviewAction;
  if (!REVIEW_ACTIONS.has(value)) {
    throw new Error(`${name} must be approve, reject or needs_review.`);
  }
  return value;
}

function requireHumanApproval() {
  if (process.env.NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED !== "true") {
    throw new Error(
      [
        "Refusing to write Data OS review events without NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true.",
        "Use this only after a human has inspected the selected tag and assertion in the review queue."
      ].join(" ")
    );
  }
}

function isAutoSelectLocalEnabled() {
  return process.env.NOISIA_DATA_OS_REVIEW_SAMPLE_AUTO_SELECT_LOCAL === "true";
}

function evidenceCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function safeNotes() {
  const notes = process.env.NOISIA_DATA_OS_REVIEW_NOTES?.trim();
  return notes || "Data OS staging release gate human sample.";
}

async function reviewTag(
  client: pg.Client,
  input: {
    action: ReviewAction;
    corpusId: string;
    notes: string;
    reviewerUserId: string | null;
    tagId: string;
  }
) {
  const nextStatus = TAG_REVIEW_STATUS_BY_ACTION[input.action];
  const existing = await client.query(
    `
      SELECT
        rt.id,
        rt.value,
        rt.confidence,
        rt.review_status,
        rt.evidence,
        tx.taxonomy_key,
        tt.term_key
      FROM record_tags rt
      JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
      JOIN taxonomies tx ON tx.id = tt.taxonomy_id
      WHERE rt.id = $1
        AND rt.study_corpus_id = $2
        AND jsonb_typeof(rt.evidence) = 'array'
        AND jsonb_array_length(rt.evidence) > 0
      FOR UPDATE
    `,
    [input.tagId, input.corpusId]
  );

  const current = existing.rows[0];
  if (!current) {
    throw new Error("NOISIA_DATA_OS_REVIEW_TAG_ID was not found in this corpus with reviewable evidence.");
  }

  const previousValue = {
    confidence: current.confidence,
    review_status: current.review_status,
    taxonomy_key: current.taxonomy_key,
    term_key: current.term_key,
    value: current.value
  };
  const nextValue = {
    ...previousValue,
    review_status: nextStatus
  };

  await client.query(
    `
      UPDATE record_tags
      SET review_status = $3
      WHERE id = $1
        AND study_corpus_id = $2
    `,
    [input.tagId, input.corpusId, nextStatus]
  );

  await client.query(
    `
      INSERT INTO tag_review_events (
        record_tag_id,
        reviewer_user_id,
        action,
        previous_value,
        next_value,
        notes
      )
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
    `,
    [
      input.tagId,
      input.reviewerUserId,
      input.action,
      JSON.stringify(previousValue),
      JSON.stringify(nextValue),
      input.notes
    ]
  );

  return {
    action: input.action,
    confidence: current.confidence,
    evidence_count: evidenceCount(current.evidence),
    next_status: nextStatus,
    previous_status: current.review_status,
    review_event_created: true,
    taxonomy_key: current.taxonomy_key
  } satisfies ReviewTargetSummary & { taxonomy_key: string };
}

async function reviewAssertion(
  client: pg.Client,
  input: {
    action: ReviewAction;
    assertionId: string;
    corpusId: string;
    notes: string;
    reviewerUserId: string | null;
  }
) {
  const nextStatus = ASSERTION_STATUS_BY_ACTION[input.action];
  const existing = await client.query(
    `
      WITH corpus_scope AS (
        SELECT sc.id AS corpus_id, sc.brand_id
        FROM study_corpora sc
        WHERE sc.id = $2
      )
      SELECT
        ka.id,
        ka.knowledge_source_id,
        ka.assertion_type,
        ka.confidence,
        ka.status,
        ka.evidence
      FROM corpus_scope cs
      JOIN brand_knowledge_sources bks
        ON bks.study_corpus_id = cs.corpus_id
        OR (cs.brand_id IS NOT NULL AND bks.brand_id = cs.brand_id AND bks.study_corpus_id IS NULL)
      JOIN knowledge_assertions ka ON ka.knowledge_source_id = bks.id
      WHERE ka.id = $1
        AND jsonb_typeof(ka.evidence) = 'array'
        AND jsonb_array_length(ka.evidence) > 0
      FOR UPDATE OF ka
    `,
    [input.assertionId, input.corpusId]
  );

  const current = existing.rows[0];
  if (!current) {
    throw new Error("NOISIA_DATA_OS_REVIEW_ASSERTION_ID was not found in this corpus scope with reviewable evidence.");
  }

  const previousValue = {
    assertion_type: current.assertion_type,
    confidence: current.confidence,
    knowledge_source_id: current.knowledge_source_id,
    status: current.status
  };
  const nextValue = {
    ...previousValue,
    status: nextStatus
  };

  await client.query(
    `
      UPDATE knowledge_assertions
      SET status = $2,
          updated_at = now()
      WHERE id = $1
    `,
    [input.assertionId, nextStatus]
  );

  await client.query(
    `
      INSERT INTO knowledge_assertion_review_events (
        knowledge_assertion_id,
        reviewer_user_id,
        action,
        previous_value,
        next_value,
        notes
      )
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
    `,
    [
      input.assertionId,
      input.reviewerUserId,
      input.action,
      JSON.stringify(previousValue),
      JSON.stringify(nextValue),
      input.notes
    ]
  );

  return {
    action: input.action,
    assertion_type: current.assertion_type,
    confidence: current.confidence,
    evidence_count: evidenceCount(current.evidence),
    next_status: nextStatus,
    previous_status: current.status,
    review_event_created: true
  } satisfies ReviewTargetSummary & { assertion_type: string };
}

async function loadReviewCounts(client: pg.Client, corpusId: string) {
  const result = await client.query(
    `
      WITH corpus_scope AS (
        SELECT sc.id AS corpus_id, sc.brand_id
        FROM study_corpora sc
        WHERE sc.id = $1
      )
      SELECT
        (
          SELECT count(*)::int
          FROM tag_review_events tre
          JOIN record_tags rt ON rt.id = tre.record_tag_id
          WHERE rt.study_corpus_id = cs.corpus_id
        ) AS tag_review_events,
        (
          SELECT count(*)::int
          FROM record_tags rt
          WHERE rt.study_corpus_id = cs.corpus_id
            AND rt.review_status <> 'unreviewed'
        ) AS record_tags_reviewed,
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

  return result.rows[0] ?? {
    knowledge_assertion_review_events: 0,
    record_tags_reviewed: 0,
    tag_review_events: 0
  };
}

async function loadAutoSelectedTargets(client: pg.Client, corpusId: string) {
  const tag = await client.query<{ id: string }>(
    `
      SELECT rt.id
      FROM record_tags rt
      JOIN taxonomy_terms tt ON tt.id = rt.taxonomy_term_id
      JOIN taxonomies tx ON tx.id = tt.taxonomy_id
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
      LIMIT 1
    `,
    [corpusId]
  );

  const assertion = await client.query<{ id: string }>(
    `
      WITH corpus_scope AS (
        SELECT sc.id AS corpus_id, sc.brand_id
        FROM study_corpora sc
        WHERE sc.id = $1
      )
      SELECT ka.id
      FROM corpus_scope cs
      JOIN brand_knowledge_sources bks
        ON bks.study_corpus_id = cs.corpus_id
        OR (cs.brand_id IS NOT NULL AND bks.brand_id = cs.brand_id AND bks.study_corpus_id IS NULL)
      JOIN knowledge_assertions ka ON ka.knowledge_source_id = bks.id
      WHERE ka.status = 'candidate'
        AND jsonb_typeof(ka.evidence) = 'array'
        AND jsonb_array_length(ka.evidence) > 0
      ORDER BY
        CASE ka.confidence WHEN 'low' THEN 0 WHEN 'medium' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,
        ka.created_at DESC,
        ka.id
      LIMIT 1
    `,
    [corpusId]
  );

  const tagId = tag.rows[0]?.id;
  const assertionId = assertion.rows[0]?.id;
  if (!tagId || !assertionId) {
    throw new Error("Local auto-select could not find a reviewable tag and assertion with evidence.");
  }
  return { assertionId, tagId };
}

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const corpusId = process.env.NOISIA_DATA_OS_REVIEW_CORPUS_ID?.trim()
    ? requireUuidEnv("NOISIA_DATA_OS_REVIEW_CORPUS_ID")
    : requireUuidEnv("NOISIA_DATA_OS_BACKFILL_CORPUS_ID");
  const explicitTagId = optionalUuidEnv("NOISIA_DATA_OS_REVIEW_TAG_ID");
  const explicitAssertionId = optionalUuidEnv("NOISIA_DATA_OS_REVIEW_ASSERTION_ID");
  const autoSelectLocal = isAutoSelectLocalEnabled();
  const reviewerUserId = optionalUuidEnv("NOISIA_DATA_OS_REVIEWER_USER_ID");
  const tagAction = requireReviewAction("NOISIA_DATA_OS_REVIEW_TAG_ACTION", "approve");
  const assertionAction = requireReviewAction("NOISIA_DATA_OS_REVIEW_ASSERTION_ACTION", "approve");
  const notes = safeNotes();

  requireHumanApproval();
  if ((!explicitTagId || !explicitAssertionId) && !autoSelectLocal) {
    throw new Error(
      "NOISIA_DATA_OS_REVIEW_TAG_ID and NOISIA_DATA_OS_REVIEW_ASSERTION_ID are required unless NOISIA_DATA_OS_REVIEW_SAMPLE_AUTO_SELECT_LOCAL=true."
    );
  }
  if (autoSelectLocal && !isLocalDatabaseUrl(databaseUrl)) {
    throw new Error("NOISIA_DATA_OS_REVIEW_SAMPLE_AUTO_SELECT_LOCAL is only allowed for local disposable databases.");
  }
  requireSafeDatabaseWriteTarget(databaseUrl, {
    operation: "data-os:review-sample",
    allowRemoteEnv: "NOISIA_DATA_OS_REVIEW_ALLOW_REMOTE"
  });

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig()
  });

  await client.connect();
  let tag: Awaited<ReturnType<typeof reviewTag>>;
  let assertion: Awaited<ReturnType<typeof reviewAssertion>>;
  try {
    const autoTargets = explicitTagId && explicitAssertionId
      ? null
      : await loadAutoSelectedTargets(client, corpusId);
    const tagId = explicitTagId ?? autoTargets?.tagId;
    const assertionId = explicitAssertionId ?? autoTargets?.assertionId;
    if (!tagId || !assertionId) {
      throw new Error("Could not resolve review sample tag/assertion ids.");
    }

    await client.query("BEGIN");
    tag = await reviewTag(client, {
      action: tagAction,
      corpusId,
      notes,
      reviewerUserId,
      tagId
    });
    assertion = await reviewAssertion(client, {
      action: assertionAction,
      assertionId,
      corpusId,
      notes,
      reviewerUserId
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }

  try {
    const summaryAfter = await loadReviewCounts(client, corpusId);
    console.log(JSON.stringify({
      ok: true,
      auto_selected_local: autoSelectLocal && (!explicitTagId || !explicitAssertionId),
      corpus_id: "set_redacted",
      human_review_sample: {
        assertion,
        reviewer_user_id: reviewerUserId ? "set_redacted" : null,
        tag
      },
      notes_present: notes.length > 0,
      ready_for_release_review_sample:
        Number(summaryAfter.tag_review_events ?? 0) >= 1 &&
        Number(summaryAfter.knowledge_assertion_review_events ?? 0) >= 1,
      summary_after: summaryAfter
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
