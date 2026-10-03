import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse } from "dotenv";
import pg from "pg";

const mode = process.argv[2];
const target = process.env.NOISIA_REMOTE_DATABASE_TARGET;
const workspaceId = process.env.NOISIA_TOPIC_CATALOG_UAT_WORKSPACE_ID;
const acknowledged = process.env.NOISIA_TOPIC_CATALOG_FIXTURE_APPROVED === "true";
const envFile = process.env.NOISIA_ENV_FILE ?? resolve(process.cwd(), "../../apps/studio/.env.local");
const sourceKey = "topic-catalog-uat-operational-population-v1";
const expectedIncludedMentions = 192;

if (!(["preflight", "apply", "verify"] as const).includes(mode as "preflight")) {
  throw new Error("Mode must be preflight, apply or verify.");
}
if (target !== "noisia-staging" || !workspaceId?.match(/^[0-9a-f-]{36}$/u)) {
  throw new Error("The Topics population watermark is restricted to an explicit staging workspace.");
}
if (mode === "apply" && !acknowledged) {
  throw new Error("Apply requires the explicit UAT fixture acknowledgement.");
}

const env = { ...parse(await readFile(envFile, "utf8")), ...process.env };
const databaseUrl = env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is unavailable in the selected environment file.");

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  application_name: "noisia-topics-uat-population-watermark"
});

await client.connect();
try {
  await client.query("SET statement_timeout='2min'; SET lock_timeout='15s'");
  const before = await inspect(client, workspaceId);
  if (before.state === "partial") throw new Error("The UAT population watermark is inconsistent.");
  if (mode === "preflight") {
    emit({ mode, writes_performed: false, ...before });
  } else if (mode === "verify") {
    if (before.state !== "complete") throw new Error("The UAT population watermark is unavailable.");
    emit({ mode, writes_performed: false, ...before });
  } else if (before.state === "complete") {
    emit({ mode, action: "verified_existing", writes_performed: false, ...before });
  } else {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `noisia:uat:topics-population-watermark:${workspaceId}`
      ]);
      const locked = await inspect(client, workspaceId);
      if (locked.state !== "absent") throw new Error("The UAT population watermark changed after preflight.");
      const metadata = {
        contract_version: sourceKey,
        fixture_scope: "uat_only",
        derived_from_watermark_id: locked.source_watermark_id,
        derived_from_study_corpus_id: locked.study_corpus_id,
        population_definition_hash: locked.population_definition_hash,
        included_mentions: locked.included_mentions
      };
      await client.query(`
        INSERT INTO signal_data_watermarks(
          workspace_id,study_corpus_id,population_id,data_source_id,source_key,
          corpus_revision,last_source_sync_run_id,last_import_batch_id,max_observed_at,
          accepted_at,materialized_at,source_freshness_state,data_freshness_state,
          stale_after,metadata
        )
        SELECT $1::uuid,NULL,$2::uuid,NULL,$3,source.corpus_revision,
          source.last_source_sync_run_id,source.last_import_batch_id,source.max_observed_at,
          source.accepted_at,source.materialized_at,source.source_freshness_state,
          source.data_freshness_state,source.stale_after,$4::jsonb
        FROM signal_data_watermarks source
        WHERE source.id=$5::uuid AND source.workspace_id=$1::uuid
      `, [workspaceId, locked.population_id, sourceKey, JSON.stringify(metadata),
        locked.source_watermark_id]);
      const applied = await inspect(client, workspaceId);
      if (applied.state !== "complete") throw new Error("The UAT population watermark did not verify.");
      await client.query("COMMIT");
      emit({ mode, action: "created", writes_performed: true, ...applied });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }
} finally {
  await client.end();
}

type Inspection = {
  state: "absent" | "complete" | "partial";
  workspace_id: string;
  population_id: string;
  population_version: number;
  population_definition_hash: string;
  study_corpus_id: string;
  included_mentions: number;
  source_watermark_id: string;
  source_key: string;
  fixture_watermark_id: string | null;
};

async function inspect(queryable: pg.Client, workspace: string): Promise<Inspection> {
  const scope = (await queryable.query<{
    population_id: string;
    population_version: number;
    population_definition_hash: string;
    study_corpus_id: string;
    included_mentions: number;
    included_in_corpus: number;
  }>(`
    SELECT population.id::text population_id,population.version population_version,
      population.definition_hash population_definition_hash,corpus.study_corpus_id::text,
      count(membership.*) FILTER(WHERE membership.membership_status='included'
        AND membership.removed_at IS NULL)::int included_mentions,
      count(membership.*) FILTER(WHERE membership.membership_status='included'
        AND membership.removed_at IS NULL AND mention.study_corpus_id=corpus.study_corpus_id
        AND mention.canonical_mention_id=mention.id)::int included_in_corpus
    FROM signal_workspaces workspace
    JOIN signal_workspace_population_pointers pointer ON pointer.workspace_id=workspace.id
      AND pointer.purpose='operational'
    JOIN signal_population_definitions population ON population.id=pointer.population_id
      AND population.workspace_id=workspace.id AND population.status='active'
    JOIN signal_workspace_corpora corpus ON corpus.workspace_id=workspace.id
      AND corpus.role='operational' AND corpus.valid_to IS NULL
    LEFT JOIN signal_population_memberships membership ON membership.population_id=population.id
      AND membership.workspace_id=workspace.id
    LEFT JOIN mentions mention ON mention.id=membership.mention_id
    WHERE workspace.id=$1::uuid AND workspace.status='active'
    GROUP BY population.id,population.version,population.definition_hash,corpus.study_corpus_id
  `, [workspace])).rows[0];
  if (!scope) throw new Error("The active UAT workspace, population or corpus is unavailable.");
  const included = Number(scope.included_mentions);
  if (included !== expectedIncludedMentions || Number(scope.included_in_corpus) !== included) {
    throw new Error(`The UAT population must contain exactly ${expectedIncludedMentions} accepted corpus mentions.`);
  }

  const source = (await queryable.query<{ id: string }>(`
    SELECT id::text FROM signal_data_watermarks
    WHERE workspace_id=$1::uuid AND study_corpus_id=$2::uuid AND population_id IS NULL
      AND last_import_batch_id IS NOT NULL AND data_freshness_state IN('fresh','partial')
    ORDER BY accepted_at DESC,id DESC LIMIT 1
  `, [workspace, scope.study_corpus_id])).rows[0];
  if (!source) throw new Error("An accepted operational corpus watermark is unavailable.");

  const fixture = (await queryable.query<{
    id: string;
    population_id: string | null;
    contract_version: string | null;
    source_watermark_id: string | null;
    study_corpus_id: string | null;
    data_source_id: string | null;
  }>(`
    SELECT id::text,population_id::text,metadata->>'contract_version' contract_version,
      metadata->>'derived_from_watermark_id' source_watermark_id,
      study_corpus_id::text,data_source_id::text
    FROM signal_data_watermarks
    WHERE workspace_id=$1::uuid AND source_key=$2
    ORDER BY id
  `, [workspace, sourceKey])).rows;
  const item = fixture[0];
  const complete = fixture.length === 1 && item?.population_id === scope.population_id
    && item.contract_version === sourceKey && item.source_watermark_id === source.id
    && item.study_corpus_id === null && item.data_source_id === null;
  return {
    state: fixture.length === 0 ? "absent" : complete ? "complete" : "partial",
    workspace_id: workspace,
    population_id: scope.population_id,
    population_version: Number(scope.population_version),
    population_definition_hash: scope.population_definition_hash,
    study_corpus_id: scope.study_corpus_id,
    included_mentions: included,
    source_watermark_id: source.id,
    source_key: sourceKey,
    fixture_watermark_id: item?.id ?? null
  };
}

function emit(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
