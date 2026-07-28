import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Job } from "bullmq";

import type { SignalMaterializeJobDataV1 } from "@noisia/query-engine";

const ALLOW_REMOTE_ENV = "NOISIA_SIGNAL_TAXONOMY_TAG_REVIEW_ALLOW_REMOTE";
const APPLY_APPROVAL_ENV = "NOISIA_SIGNAL_TAXONOMY_TAG_REVIEW_APPROVED";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type Args = {
  apply: boolean;
  corpusId: string;
  historicalOutputId: string;
  notes: string;
};

type Scope = {
  workspace_id: string;
  study_corpus_id: string;
  corpus_revision: number;
  timezone: string;
  affected_from: string;
  affected_through: string;
};

type ReviewCount = {
  kind: "topic" | "narrative";
  pending_tags: number;
  rejected_tags: number;
  approved_tags: number;
};

function loadEnvironment() {
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const repoDir = resolve(appDir, "../..");
  for (const path of [
    resolve(appDir, ".env.local"),
    resolve(repoDir, ".env.local")
  ]) {
    if (!existsSync(path)) continue;
    for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/u)) {
      const match = rawLine.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
      const key = match?.[1];
      const raw = match?.[2]?.trim();
      if (!key || raw === undefined || process.env[key] !== undefined) continue;
      process.env[key] = (
        (raw.startsWith("\"") && raw.endsWith("\""))
        || (raw.startsWith("'") && raw.endsWith("'"))
      ) ? raw.slice(1, -1) : raw;
    }
  }
}

function parseArgs(): Args {
  const argv = process.argv.slice(2).filter((value) => value !== "--");
  const read = (name: string) => {
    const inline = argv.find((item) => item.startsWith(`${name}=`));
    if (inline) return inline.slice(name.length + 1);
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const corpusId = read("--corpus-id")?.trim().toLowerCase() ?? "";
  const historicalOutputId =
    read("--historical-output-id")?.trim().toLowerCase() ?? "";
  const notes = read("--notes")?.trim() ?? "";
  if (!UUID.test(corpusId)) throw new Error("--corpus-id must be a UUID.");
  if (!UUID.test(historicalOutputId)) {
    throw new Error("--historical-output-id must be a UUID.");
  }
  if (!notes || notes.length > 2_000) {
    throw new Error("--notes must contain between 1 and 2000 characters.");
  }
  return {
    apply: argv.includes("--apply"),
    corpusId,
    historicalOutputId,
    notes
  };
}

async function loadScope(pool: import("pg").Pool, args: Args): Promise<Scope> {
  const result = await pool.query<Scope & {
    active_memberships: number;
    active_profiles: number;
  }>(`
    WITH candidates AS (
      SELECT workspace.id, workspace.timezone,
        count(*) OVER ()::int AS active_memberships
      FROM signal_workspace_corpora membership
      JOIN signal_workspaces workspace ON workspace.id = membership.workspace_id
      JOIN study_corpora corpus ON corpus.id = membership.study_corpus_id
      JOIN published_outputs output
        ON output.id = $2::uuid
       AND output.study_corpus_id = corpus.id
       AND output.status = 'published'
       AND output.brand_id IS NOT DISTINCT FROM corpus.brand_id
       AND output.theme_id IS NOT DISTINCT FROM corpus.theme_id
      WHERE corpus.id = $1::uuid
        AND membership.role = 'operational'
        AND membership.valid_to IS NULL
        AND workspace.status = 'active'
    )
    SELECT candidate.id::text AS workspace_id,
      corpus.id::text AS study_corpus_id, corpus.corpus_revision,
      candidate.timezone, candidate.active_memberships,
      count(DISTINCT profile.id)::int AS active_profiles,
      min((mention.published_at AT TIME ZONE candidate.timezone)::date)::text
        AS affected_from,
      max((mention.published_at AT TIME ZONE candidate.timezone)::date)::text
        AS affected_through
    FROM candidates candidate
    JOIN study_corpora corpus ON corpus.id = $1::uuid
    JOIN signal_taxonomy_profiles profile
      ON profile.workspace_id = candidate.id
     AND profile.status = 'active'
    JOIN mentions mention
      ON mention.study_corpus_id = corpus.id
     AND mention.inclusion_status = 'included'
    GROUP BY candidate.id, candidate.timezone, candidate.active_memberships,
      corpus.id
  `, [args.corpusId, args.historicalOutputId]);
  const scope = result.rows[0];
  if (
    result.rows.length !== 1
    || !scope
    || scope.active_memberships !== 1
    || scope.active_profiles !== 2
    || !scope.affected_from
    || !scope.affected_through
  ) {
    throw new Error(
      "Exactly one governed workspace and two active profiles are required."
    );
  }
  return scope;
}

async function loadCounts(
  pool: import("pg").Pool | import("pg").PoolClient,
  scope: Scope
) {
  const result = await pool.query<ReviewCount>(`
    SELECT profile.kind,
      count(tag.id) FILTER (WHERE tag.review_status = 'pending')::int
        AS pending_tags,
      count(tag.id) FILTER (WHERE tag.review_status = 'rejected')::int
        AS rejected_tags,
      count(tag.id) FILTER (WHERE tag.review_status = 'approved')::int
        AS approved_tags
    FROM signal_taxonomy_profiles profile
    LEFT JOIN record_tags tag
      ON tag.signal_taxonomy_profile_id = profile.id
     AND tag.study_corpus_id = $2::uuid
    WHERE profile.workspace_id = $1::uuid
      AND profile.status = 'active'
    GROUP BY profile.id
    ORDER BY profile.kind
  `, [scope.workspace_id, scope.study_corpus_id]);
  return result.rows;
}

async function resolveReviewer(pool: import("pg").Pool) {
  const emails = (process.env.NOISIA_BOOTSTRAP_FOUNDER_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length !== 1) {
    throw new Error("Exactly one configured founder reviewer is required.");
  }
  const result = await pool.query<{ id: string }>(`
    SELECT id::text
    FROM users
    WHERE lower(email) = $1
      AND status = 'active'
      AND user_type = 'noisia_internal'
      AND primary_role IN ('noisia_admin', 'analyst')
  `, [emails[0]]);
  if (result.rows.length !== 1) {
    throw new Error("Configured reviewer is not one authorized internal user.");
  }
  return result.rows[0]!.id;
}

async function applyReview(args: {
  pool: import("pg").Pool;
  scope: Scope;
  reviewerId: string;
  notes: string;
}) {
  const client = await args.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`signal-taxonomy-tag-review:${args.scope.workspace_id}`]
    );
    const events = await client.query<{ reviewed_tags: number }>(`
      WITH candidates AS MATERIALIZED (
        SELECT tag.id, tag.review_status, term.term_key
        FROM record_tags tag
        JOIN signal_taxonomy_profiles profile
          ON profile.id = tag.signal_taxonomy_profile_id
         AND profile.workspace_id = $1::uuid
         AND profile.status = 'active'
        JOIN taxonomy_terms term ON term.id = tag.taxonomy_term_id
        WHERE tag.study_corpus_id = $2::uuid
          AND tag.review_status = 'pending'
        FOR UPDATE OF tag
      ), events AS (
        INSERT INTO tag_review_events (
          record_tag_id, reviewer_user_id, action,
          previous_value, next_value, notes
        )
        SELECT candidate.id, $3::uuid, 'approve',
          jsonb_build_object(
            'review_status', candidate.review_status,
            'term_key', candidate.term_key
          ),
          jsonb_build_object(
            'review_status', 'approved',
            'term_key', candidate.term_key
          ),
          $4::text
        FROM candidates candidate
        RETURNING record_tag_id
      ), updated AS (
        UPDATE record_tags tag
        SET review_status = 'approved',
          approval_source = 'human',
          approval_policy_version = NULL,
          approved_at = now()
        FROM events
        WHERE tag.id = events.record_tag_id
        RETURNING tag.id
      )
      SELECT count(*)::int AS reviewed_tags FROM updated
    `, [
      args.scope.workspace_id,
      args.scope.study_corpus_id,
      args.reviewerId,
      args.notes
    ]);
    const reviewedTags = events.rows[0]?.reviewed_tags ?? 0;
    if (reviewedTags < 1) {
      throw new Error("No pending taxonomy tags were available for review.");
    }
    const invalidation = await client.query<{ id: string }>(`
      WITH watermark AS (
        SELECT id
        FROM signal_data_watermarks
        WHERE workspace_id = $1::uuid AND study_corpus_id = $2::uuid
        ORDER BY accepted_at DESC, id
        LIMIT 1
      )
      INSERT INTO signal_data_invalidations (
        workspace_id, study_corpus_id, data_watermark_id,
        source_key, idempotency_key, reason,
        affected_from, affected_through, scope
      )
      SELECT $1::uuid, $2::uuid, watermark.id,
        'signal-taxonomy-review',
        'signal-taxonomy-bulk-review-v1:' || $1::uuid::text
          || ':' || $3::int::text,
        'taxonomy_review_changed',
        $4::date, $5::date,
        jsonb_build_object(
          'taxonomy_kinds', jsonb_build_array('topic', 'narrative'),
          'reviewed_tags', $6::int,
          'review_mode', 'human_approved_bulk_v1'
        )
      FROM watermark
      ON CONFLICT (idempotency_key) DO UPDATE SET
        scope = signal_data_invalidations.scope || EXCLUDED.scope
      RETURNING id::text
    `, [
      args.scope.workspace_id,
      args.scope.study_corpus_id,
      args.scope.corpus_revision,
      args.scope.affected_from,
      args.scope.affected_through,
      reviewedTags
    ]);
    const invalidationId = invalidation.rows[0]?.id;
    if (!invalidationId) throw new Error("A current data watermark is required.");
    await client.query("COMMIT");
    return { reviewedTags, invalidationId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function materialize(scope: Scope, invalidationId: string) {
  process.env.NOISIA_SIGNAL_INTERPRETATIONS_ENABLED = "false";
  process.env.NOISIA_SIGNAL_INTERPRETATIONS_LLM_ENABLED = "false";
  const [{ signalMaterializationJob }, workerDb] = await Promise.all([
    import("../../../services/workers/src/workers/signal-materialization"),
    import("../../../services/workers/src/db/client")
  ]);
  try {
    const data: SignalMaterializeJobDataV1 = {
      contract_version: "signal-materialization-v1",
      trigger: "invalidation",
      workspace_id: scope.workspace_id,
      study_corpus_id: scope.study_corpus_id,
      invalidation_id: invalidationId,
      affected_from: scope.affected_from,
      affected_through: scope.affected_through
    };
    return await signalMaterializationJob(
      { data } as Job<SignalMaterializeJobDataV1>
    );
  } finally {
    await workerDb.pool.end();
  }
}

async function main() {
  loadEnvironment();
  const args = parseArgs();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const [{ pool }, safety] = await Promise.all([
    import("../src/lib/db"),
    import("../../../infrastructure/db/seeds/connection")
  ]);
  const guard = {
    operation: args.apply
      ? "approve Signal taxonomy tag assignments"
      : "review Signal taxonomy tag assignments",
    allowRemoteEnv: ALLOW_REMOTE_ENV
  };
  if (args.apply) safety.requireSafeDatabaseWriteTarget(databaseUrl, guard);
  else safety.requireSafeDatabaseReadTarget(databaseUrl, guard);
  try {
    const scope = await loadScope(pool, args);
    const before = await loadCounts(pool, scope);
    const reviewerId = await resolveReviewer(pool);
    let reviewedTags = 0;
    let materialization = null;
    if (args.apply) {
      if (process.env[APPLY_APPROVAL_ENV] !== "true") {
        throw new Error(`${APPLY_APPROVAL_ENV}=true is required for --apply.`);
      }
      const applied = await applyReview({
        pool,
        scope,
        reviewerId,
        notes: args.notes
      });
      reviewedTags = applied.reviewedTags;
      materialization = await materialize(scope, applied.invalidationId);
    }
    const after = await loadCounts(pool, scope);
    console.log(JSON.stringify({
      contract_version: "signal-topics-narratives-v1",
      mode: args.apply ? "apply" : "dry-run",
      reviewer: "configured_internal_reviewer",
      before,
      after,
      reviewed_tags: reviewedTags,
      materialization,
      rejected_tags_unchanged: before.every((row, index) =>
        row.rejected_tags === after[index]?.rejected_tags
      ),
      paid_provider_invoked: false,
      client_activation: false
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
