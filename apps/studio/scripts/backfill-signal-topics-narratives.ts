import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOW_REMOTE_ENV = "NOISIA_SIGNAL_TAXONOMY_BACKFILL_ALLOW_REMOTE";
const APPLY_APPROVAL_ENV = "NOISIA_SIGNAL_TAXONOMY_BACKFILL_APPROVED";
const HUMAN_APPROVAL_ENV = "NOISIA_SIGNAL_TAXONOMY_HUMAN_APPROVED";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type Args = {
  apply: boolean;
  corpusId: string;
  historicalOutputId: string;
  budgetCapUsd: number | null;
};

type ScopeRow = {
  workspace_id: string;
  study_corpus_id: string;
  corpus_revision: number;
  historical_output_id: string;
  historical_output_status: string;
  subject_matches: boolean;
  active_operational_memberships: number;
  included_mentions: number;
  date_from: string | null;
  date_through: string | null;
};

type ProfileRow = {
  profile_id: string;
  kind: "topic" | "narrative";
  version: number;
  model_version_id: string;
  term_count: number;
  approved_tags: number;
  pending_tags: number;
  rejected_tags: number;
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
  const value = (name: string) => {
    const inline = argv.find((item) => item.startsWith(`${name}=`));
    if (inline) return inline.slice(name.length + 1);
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const corpusId = value("--corpus-id")?.trim().toLowerCase() ?? "";
  const historicalOutputId =
    value("--historical-output-id")?.trim().toLowerCase() ?? "";
  const budgetText = value("--budget-cap-usd")?.trim();
  const budgetCapUsd = budgetText === undefined ? null : Number(budgetText);
  const values = new Set([
    corpusId,
    historicalOutputId,
    ...(budgetText === undefined ? [] : [budgetText])
  ]);
  const unknown = argv.filter((item) =>
    item !== "--apply"
    && item !== "--corpus-id"
    && item !== "--historical-output-id"
    && item !== "--budget-cap-usd"
    && !item.startsWith("--corpus-id=")
    && !item.startsWith("--historical-output-id=")
    && !item.startsWith("--budget-cap-usd=")
    && !values.has(item)
  );
  if (unknown.length) {
    throw new Error(`Unknown arguments: ${unknown.join(", ")}`);
  }
  if (!UUID.test(corpusId)) throw new Error("--corpus-id must be a UUID.");
  if (!UUID.test(historicalOutputId)) {
    throw new Error("--historical-output-id must be a UUID.");
  }
  if (
    budgetCapUsd !== null
    && (!Number.isFinite(budgetCapUsd) || budgetCapUsd <= 0)
  ) {
    throw new Error("--budget-cap-usd must be a positive number.");
  }
  return {
    apply: argv.includes("--apply"),
    corpusId,
    historicalOutputId,
    budgetCapUsd
  };
}

async function loadScope(pool: import("pg").Pool, args: Args) {
  const result = await pool.query<ScopeRow>(`
    WITH workspace_candidates AS (
      SELECT workspace.id,
        count(*) OVER ()::int AS active_operational_memberships
      FROM signal_workspace_corpora membership
      JOIN signal_workspaces workspace ON workspace.id = membership.workspace_id
      JOIN study_corpora corpus ON corpus.id = membership.study_corpus_id
      LEFT JOIN brands brand ON brand.id = corpus.brand_id
      LEFT JOIN themes theme ON theme.id = corpus.theme_id
      WHERE membership.study_corpus_id = $1::uuid
        AND membership.role = 'operational'
        AND membership.valid_to IS NULL
        AND workspace.status = 'active'
        AND workspace.organization_id = COALESCE(
          brand.organization_id,
          theme.organization_id
        )
        AND workspace.brand_id IS NOT DISTINCT FROM corpus.brand_id
        AND workspace.theme_id IS NOT DISTINCT FROM corpus.theme_id
    ),
    mention_scope AS (
      SELECT count(*) FILTER (
          WHERE mention.inclusion_status = 'included'
        )::int AS included_mentions,
        min(mention.published_at)::date::text AS date_from,
        max(mention.published_at)::date::text AS date_through
      FROM mentions mention
      WHERE mention.study_corpus_id = $1::uuid
    )
    SELECT candidate.id::text AS workspace_id,
      corpus.id::text AS study_corpus_id,
      corpus.corpus_revision,
      output.id::text AS historical_output_id,
      output.status AS historical_output_status,
      (
        output.study_corpus_id = corpus.id
        AND output.brand_id IS NOT DISTINCT FROM corpus.brand_id
        AND output.theme_id IS NOT DISTINCT FROM corpus.theme_id
      ) AS subject_matches,
      candidate.active_operational_memberships,
      mention_scope.included_mentions,
      mention_scope.date_from,
      mention_scope.date_through
    FROM study_corpora corpus
    JOIN published_outputs output
      ON output.id = $2::uuid
     AND output.study_corpus_id = corpus.id
    JOIN workspace_candidates candidate ON true
    CROSS JOIN mention_scope
    WHERE corpus.id = $1::uuid
  `, [args.corpusId, args.historicalOutputId]);
  const row = result.rows[0];
  if (!row) {
    throw new Error(
      "The corpus/output pair has no governed active operational Signal workspace."
    );
  }
  if (result.rows.length !== 1 || row.active_operational_memberships !== 1) {
    throw new Error(
      "Signal workspace resolution is ambiguous; refusing to select an operational workspace."
    );
  }
  if (!row.subject_matches) {
    throw new Error("Historical output and corpus subject do not match.");
  }
  if (row.historical_output_status !== "published") {
    throw new Error("Historical Signal output must be published.");
  }
  if (row.included_mentions < 1 || !row.date_from || !row.date_through) {
    throw new Error("The governed corpus has no included mentions to classify.");
  }
  return row;
}

async function loadProfiles(
  pool: import("pg").Pool,
  workspaceId: string,
  corpusId: string
) {
  const result = await pool.query<ProfileRow>(`
    SELECT profile.id::text AS profile_id,
      profile.kind,
      profile.version,
      profile.model_version_id::text,
      count(DISTINCT term.id)::int AS term_count,
      count(DISTINCT tag.id) FILTER (
        WHERE tag.review_status = 'approved'
      )::int AS approved_tags,
      count(DISTINCT tag.id) FILTER (
        WHERE tag.review_status IN ('pending', 'needs_review')
      )::int AS pending_tags,
      count(DISTINCT tag.id) FILTER (
        WHERE tag.review_status = 'rejected'
      )::int AS rejected_tags
    FROM signal_taxonomy_profiles profile
    LEFT JOIN taxonomy_terms term
      ON term.taxonomy_id = profile.taxonomy_id
     AND term.status = 'active'
    LEFT JOIN record_tags tag
      ON tag.signal_taxonomy_profile_id = profile.id
     AND tag.study_corpus_id = $2::uuid
    WHERE profile.workspace_id = $1::uuid
      AND profile.status = 'active'
    GROUP BY profile.id
    ORDER BY profile.kind
  `, [workspaceId, corpusId]);
  return result.rows;
}

function validateActiveProfiles(profiles: ProfileRow[]) {
  const byKind = new Map(profiles.map((profile) => [profile.kind, profile]));
  const topic = byKind.get("topic");
  const narrative = byKind.get("narrative");
  if (!topic || !narrative || profiles.length !== 2) {
    throw new Error(
      "Exactly one approved active topic profile and one approved active narrative profile are required."
    );
  }
  if (topic.term_count < 1 || narrative.term_count < 1) {
    throw new Error("Active taxonomy profiles must contain active terms.");
  }
  return [topic, narrative] as const;
}

async function queueBackfillRuns(args: {
  pool: import("pg").Pool;
  scope: ScopeRow;
  profiles: readonly [ProfileRow, ProfileRow];
  budgetCapUsd: number;
}) {
  const client = await args.pool.connect();
  try {
    await client.query("BEGIN");
    const budgetPerProfile = args.budgetCapUsd / args.profiles.length;
    const runIds: string[] = [];
    for (const profile of args.profiles) {
      const idempotencyKey = [
        "signal-taxonomy-backfill-v1",
        args.scope.workspace_id,
        args.scope.study_corpus_id,
        args.scope.corpus_revision,
        profile.profile_id
      ].join(":");
      const result = await client.query<{ id: string }>(`
        INSERT INTO signal_refresh_runs (
          workspace_id,
          study_corpus_id,
          source_key,
          idempotency_key,
          trigger,
          status,
          attempt,
          scheduled_for,
          run_type,
          taxonomy_profile_id,
          model_version_id,
          input_corpus_revision,
          budget_cap_usd,
          result_summary
        ) VALUES (
          $1::uuid,
          $2::uuid,
          $3,
          $4,
          'manual',
          'queued',
          1,
          now(),
          'taxonomy_enrichment',
          $5::uuid,
          $6::uuid,
          $7,
          $8,
          '{"requested_by":"signal-topics-narratives-backfill","client_activation":false}'::jsonb
        )
        ON CONFLICT (idempotency_key) DO UPDATE
        SET updated_at = signal_refresh_runs.updated_at
        RETURNING id::text
      `, [
        args.scope.workspace_id,
        args.scope.study_corpus_id,
        `taxonomy:${profile.kind}`,
        idempotencyKey,
        profile.profile_id,
        profile.model_version_id,
        args.scope.corpus_revision,
        budgetPerProfile
      ]);
      const id = result.rows[0]?.id;
      if (!id) throw new Error("Failed to persist taxonomy enrichment outbox run.");
      runIds.push(id);
    }
    await client.query("COMMIT");
    return runIds;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  loadEnvironment();
  const args = parseArgs();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const [
    { pool },
    { requireSafeDatabaseReadTarget, requireSafeDatabaseWriteTarget }
  ] = await Promise.all([
    import("../src/lib/db"),
    import("../../../infrastructure/db/seeds/connection")
  ]);
  const guard = {
    operation: args.apply
      ? "Signal Topics & Narratives targeted backfill"
      : "Signal Topics & Narratives targeted backfill dry-run",
    allowRemoteEnv: ALLOW_REMOTE_ENV
  };
  if (args.apply) requireSafeDatabaseWriteTarget(databaseUrl, guard);
  else requireSafeDatabaseReadTarget(databaseUrl, guard);

  try {
    const scope = await loadScope(pool, args);
    const profiles = validateActiveProfiles(
      await loadProfiles(pool, scope.workspace_id, scope.study_corpus_id)
    );
    let runIds: string[] = [];
    if (args.apply) {
      if (process.env[APPLY_APPROVAL_ENV] !== "true") {
        throw new Error(`${APPLY_APPROVAL_ENV}=true is required for --apply.`);
      }
      if (process.env[HUMAN_APPROVAL_ENV] !== "true") {
        throw new Error(`${HUMAN_APPROVAL_ENV}=true is required for --apply.`);
      }
      if (args.budgetCapUsd === null) {
        throw new Error("--budget-cap-usd is required for --apply.");
      }
      runIds = await queueBackfillRuns({
        pool,
        scope,
        profiles,
        budgetCapUsd: args.budgetCapUsd
      });
    }
    console.log(JSON.stringify({
      contract_version: "signal-topics-narratives-v1",
      mode: args.apply ? "apply" : "dry-run",
      workspace_id: scope.workspace_id,
      corpus_id: scope.study_corpus_id,
      historical_output_id: scope.historical_output_id,
      corpus_revision: scope.corpus_revision,
      mention_window: {
        start: scope.date_from,
        end: scope.date_through,
        included_mentions: scope.included_mentions
      },
      profiles: profiles.map((profile) => ({
        profile_id: profile.profile_id,
        kind: profile.kind,
        version: profile.version,
        term_count: profile.term_count,
        approved_tags: profile.approved_tags,
        pending_tags: profile.pending_tags,
        rejected_tags: profile.rejected_tags
      })),
      durable_runs: runIds,
      paid_provider_invoked: false,
      next: args.apply
        ? "Start approved workers; PostgreSQL outbox reconciliation will enqueue the durable runs."
        : `Obtain human taxonomy approval and a USD cap, then re-run with --apply, ${APPLY_APPROVAL_ENV}=true, ${HUMAN_APPROVAL_ENV}=true and ${ALLOW_REMOTE_ENV}=true.`
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
