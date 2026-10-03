import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOW_REMOTE_ENV = "NOISIA_SIGNAL_TAXONOMY_REVIEW_ALLOW_REMOTE";
const HUMAN_APPROVAL_ENV = "NOISIA_SIGNAL_TAXONOMY_HUMAN_APPROVED";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FORBIDDEN_TERM_KEYS = [
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
];

type Args = {
  apply: boolean;
  corpusId: string;
  historicalOutputId: string;
  notes: string;
};

type ScopeRow = {
  workspace_id: string;
  active_operational_memberships: number;
  historical_output_status: string;
  subject_matches: boolean;
};

type ProfileRow = {
  profile_id: string;
  kind: "topic" | "narrative";
  version: number;
  status: string;
  context_hash: string;
  taxonomy_id: string;
  rule_set_id: string;
  model_version_id: string;
  rule_taxonomy_id: string | null;
  model_rule_set_id: string | null;
  term_count: number;
  invalid_term_status_count: number;
  forbidden_term_count: number;
  missing_statement_count: number;
  unexpected_statement_count: number;
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
  const notes = value("--notes")?.trim() ?? "";
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

function requireLiteralTrue(name: string) {
  if (process.env[name] !== "true") {
    throw new Error(`${name}=true is required.`);
  }
}

async function resolveScope(
  pool: import("pg").Pool,
  args: Args
): Promise<ScopeRow> {
  const result = await pool.query<ScopeRow>(`
    WITH candidates AS (
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
    )
    SELECT candidate.id::text AS workspace_id,
      candidate.active_operational_memberships,
      output.status AS historical_output_status,
      (
        output.study_corpus_id = corpus.id
        AND output.brand_id IS NOT DISTINCT FROM corpus.brand_id
        AND output.theme_id IS NOT DISTINCT FROM corpus.theme_id
      ) AS subject_matches
    FROM study_corpora corpus
    JOIN published_outputs output
      ON output.id = $2::uuid
     AND output.study_corpus_id = corpus.id
    JOIN candidates candidate ON true
    WHERE corpus.id = $1::uuid
  `, [args.corpusId, args.historicalOutputId]);
  const row = result.rows[0];
  if (
    result.rows.length !== 1
    || !row
    || row.active_operational_memberships !== 1
  ) {
    throw new Error(
      "Signal workspace resolution is missing or ambiguous; review refused."
    );
  }
  if (!row.subject_matches || row.historical_output_status !== "published") {
    throw new Error("Historical output is not a published match for this corpus.");
  }
  return row;
}

async function resolveReviewer(pool: import("pg").Pool) {
  const configured = (process.env.NOISIA_BOOTSTRAP_FOUNDER_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (configured.length !== 1) {
    throw new Error(
      "Exactly one NOISIA_BOOTSTRAP_FOUNDER_EMAILS reviewer must be configured."
    );
  }
  const result = await pool.query<{ id: string }>(`
    SELECT id::text
    FROM users
    WHERE lower(email) = $1
      AND status = 'active'
      AND user_type = 'noisia_internal'
      AND primary_role IN ('noisia_admin', 'analyst')
  `, [configured[0]]);
  if (result.rows.length !== 1) {
    throw new Error("Configured reviewer is not one active authorized internal user.");
  }
  return result.rows[0]!.id;
}

async function loadDraftProfiles(
  pool: import("pg").Pool,
  workspaceId: string
): Promise<ProfileRow[]> {
  const result = await pool.query<ProfileRow>(`
    SELECT profile.id::text AS profile_id, profile.kind, profile.version,
      profile.status, profile.context_hash,
      profile.taxonomy_id::text, profile.rule_set_id::text,
      profile.model_version_id::text,
      rule_set.taxonomy_id::text AS rule_taxonomy_id,
      model.tagging_rule_set_id::text AS model_rule_set_id,
      count(term.id)::int AS term_count,
      count(*) FILTER (
        WHERE term.id IS NOT NULL
          AND term.status NOT IN ('candidate', 'active')
      )::int AS invalid_term_status_count,
      count(*) FILTER (
        WHERE term.term_key = ANY($2::text[])
      )::int AS forbidden_term_count,
      count(*) FILTER (
        WHERE profile.kind = 'narrative'
          AND NULLIF(term.metadata->>'statement', '') IS NULL
      )::int AS missing_statement_count,
      count(*) FILTER (
        WHERE profile.kind = 'topic'
          AND NULLIF(term.metadata->>'statement', '') IS NOT NULL
      )::int AS unexpected_statement_count
    FROM signal_taxonomy_profiles profile
    JOIN tagging_rule_sets rule_set ON rule_set.id = profile.rule_set_id
    JOIN tagging_model_versions model ON model.id = profile.model_version_id
    LEFT JOIN taxonomy_terms term ON term.taxonomy_id = profile.taxonomy_id
    WHERE profile.workspace_id = $1::uuid
      AND profile.status = 'draft'
    GROUP BY profile.id, rule_set.id, model.id
    ORDER BY profile.kind, profile.version DESC
  `, [workspaceId, FORBIDDEN_TERM_KEYS]);
  return result.rows;
}

function assertProfilesReady(profiles: ProfileRow[]) {
  const latest = new Map<ProfileRow["kind"], ProfileRow>();
  for (const profile of profiles) {
    if (!latest.has(profile.kind)) latest.set(profile.kind, profile);
  }
  const selected = ["topic", "narrative"].map((kind) =>
    latest.get(kind as ProfileRow["kind"])
  );
  if (selected.some((profile) => !profile)) {
    throw new Error("One draft topic and one draft narrative profile are required.");
  }
  for (const profile of selected as ProfileRow[]) {
    const invalid =
      profile.status !== "draft"
      || profile.term_count < 1
      || profile.rule_taxonomy_id !== profile.taxonomy_id
      || profile.model_rule_set_id !== profile.rule_set_id
      || !/^sha256:[0-9a-f]{64}$/u.test(profile.context_hash)
      || profile.invalid_term_status_count > 0
      || profile.forbidden_term_count > 0
      || profile.missing_statement_count > 0
      || profile.unexpected_statement_count > 0;
    if (invalid) {
      throw new Error(`${profile.kind} profile failed activation reconciliation.`);
    }
  }
  return selected as [ProfileRow, ProfileRow];
}

async function activateProfiles(args: {
  pool: import("pg").Pool;
  profiles: [ProfileRow, ProfileRow];
  reviewerId: string;
  notes: string;
}) {
  const client = await args.pool.connect();
  try {
    await client.query("BEGIN");
    const activated: Array<{
      kind: string;
      version: number;
      status: string;
      approved_at: string;
    }> = [];
    for (const profile of args.profiles) {
      const result = await client.query<{
        kind: string;
        version: number;
        status: string;
        approved_at: string;
      }>(`
        SELECT kind, version, status, approved_at::text
        FROM activate_signal_taxonomy_profile($1::uuid, $2::uuid)
      `, [profile.profile_id, args.reviewerId]);
      if (!result.rows[0]) {
        throw new Error(`Failed to activate ${profile.kind} profile.`);
      }
      await client.query(`
        UPDATE signal_taxonomy_profiles
        SET metadata = metadata || jsonb_build_object(
          'profile_review',
          jsonb_build_object(
            'action', 'approve',
            'reviewer_user_id', $2::uuid,
            'notes', $3::text,
            'reviewed_at', approved_at
          )
        )
        WHERE id = $1::uuid
      `, [profile.profile_id, args.reviewerId, args.notes]);
      activated.push(result.rows[0]);
    }
    await client.query("COMMIT");
    return activated;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
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
      ? "approve Signal Topics & Narratives taxonomy profiles"
      : "review Signal Topics & Narratives taxonomy profiles",
    allowRemoteEnv: ALLOW_REMOTE_ENV
  };
  if (args.apply) {
    requireSafeDatabaseWriteTarget(databaseUrl, guard);
    requireLiteralTrue(HUMAN_APPROVAL_ENV);
  } else {
    requireSafeDatabaseReadTarget(databaseUrl, guard);
  }

  try {
    const scope = await resolveScope(pool, args);
    const profiles = assertProfilesReady(
      await loadDraftProfiles(pool, scope.workspace_id)
    );
    const reviewerId = await resolveReviewer(pool);
    const activated = args.apply
      ? await activateProfiles({
          pool,
          profiles,
          reviewerId,
          notes: args.notes
        })
      : [];
    console.log(JSON.stringify({
      contract_version: "signal-topics-narratives-v1",
      mode: args.apply ? "apply" : "dry-run",
      reviewer: "configured_internal_reviewer",
      profiles: profiles.map((profile) => ({
        kind: profile.kind,
        version: profile.version,
        term_count: profile.term_count,
        ready_for_activation: true
      })),
      activated,
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
