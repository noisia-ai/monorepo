import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Job } from "bullmq";

import type { SignalMaterializeJobDataV1 } from "@noisia/query-engine";

const ALLOW_REMOTE_ENV = "NOISIA_SIGNAL_V2_BACKFILL_ALLOW_REMOTE";
const APPROVAL_ENV = "NOISIA_SIGNAL_V2_BACKFILL_APPROVED";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type Args = { outputId: string; workspaceId: string; apply: boolean };
type ScopeRow = {
  output_id: string;
  workspace_id: string;
  study_corpus_id: string;
  output_status: string;
  output_kind: string;
  methodology_slug: string;
  corpus_methodology_slug: string;
  membership_role: string | null;
  subject_matches: boolean;
  latest_import_batch_id: string | null;
  date_from: string | null;
  date_through: string | null;
  corpus_revision: number;
  metric_definitions: number;
  payload_digest: string;
};

function loadEnvironment() {
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const repoDir = resolve(appDir, "../..");
  for (const path of [resolve(appDir, ".env.local"), resolve(repoDir, ".env.local")]) {
    if (!existsSync(path)) continue;
    for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/u)) {
      const match = rawLine.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
      const key = match?.[1];
      const raw = match?.[2]?.trim();
      if (!key || raw === undefined || process.env[key] !== undefined) continue;
      process.env[key] = (
        (raw.startsWith('"') && raw.endsWith('"'))
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
  const outputId = value("--output-id")?.trim().toLowerCase() ?? "";
  const workspaceId = value("--workspace-id")?.trim().toLowerCase() ?? "";
  const known = new Set(["--apply", "--output-id", "--workspace-id", outputId, workspaceId]);
  const unknown = argv.filter((item) => !known.has(item) && !item.startsWith("--output-id=") && !item.startsWith("--workspace-id="));
  if (unknown.length) throw new Error(`Unknown arguments: ${unknown.join(", ")}`);
  if (!UUID.test(outputId)) throw new Error("--output-id must be a UUID.");
  if (!UUID.test(workspaceId)) throw new Error("--workspace-id must be a UUID.");
  return { outputId, workspaceId, apply: argv.includes("--apply") };
}

async function loadScope(pool: import("pg").Pool, args: Args) {
  const result = await pool.query<ScopeRow>(
    `SELECT
       output.id::text AS output_id,
       workspace.id::text AS workspace_id,
       output.study_corpus_id::text,
       output.status AS output_status,
       output.kind AS output_kind,
       output.methodology_slug,
       methodology.slug AS corpus_methodology_slug,
       membership.role AS membership_role,
       (
         workspace.organization_id = COALESCE(brand.organization_id, theme.organization_id)
         AND workspace.brand_id IS NOT DISTINCT FROM output.brand_id
         AND workspace.theme_id IS NOT DISTINCT FROM output.theme_id
       ) AS subject_matches,
       latest_import.id::text AS latest_import_batch_id,
       mention_scope.date_from::text,
       mention_scope.date_through::text,
       corpus.corpus_revision,
       (
         SELECT COUNT(*)::integer
         FROM metric_definitions definition
         WHERE definition.status = 'active'
           AND definition.metric_group_key IS NOT NULL
       ) AS metric_definitions,
       md5(output.payload::text) AS payload_digest
     FROM published_outputs output
     JOIN study_corpora corpus ON corpus.id = output.study_corpus_id
     JOIN methodologies methodology ON methodology.id = corpus.methodology_id
     LEFT JOIN brands brand ON brand.id = output.brand_id
     LEFT JOIN themes theme ON theme.id = output.theme_id
     JOIN signal_workspaces workspace ON workspace.id = $2::uuid
     LEFT JOIN signal_workspace_corpora membership
       ON membership.workspace_id = workspace.id
      AND membership.study_corpus_id = output.study_corpus_id
      AND membership.valid_to IS NULL
     LEFT JOIN LATERAL (
       SELECT batch.id
       FROM import_batches batch
       WHERE batch.study_corpus_id = output.study_corpus_id
         AND batch.status = 'completed'
       ORDER BY batch.created_at DESC, batch.id
       LIMIT 1
     ) latest_import ON true
     LEFT JOIN LATERAL (
       SELECT MIN(mention.published_at)::date AS date_from,
         MAX(mention.published_at)::date AS date_through
       FROM mentions mention
       WHERE mention.study_corpus_id = output.study_corpus_id
         AND mention.inclusion_status = 'included'
     ) mention_scope ON true
     WHERE output.id = $1::uuid`,
    [args.outputId, args.workspaceId]
  );
  const row = result.rows[0];
  if (!row) throw new Error("Signal output/workspace pair was not found.");
  if (row.output_status !== "published") throw new Error("Signal output must be published.");
  const supportedFallback =
    (
      row.methodology_slug === "signal-pulse"
      && row.corpus_methodology_slug === "signal-pulse"
      && row.output_kind === "signal_pulse"
    )
    || (
      row.methodology_slug === "triggers-barriers"
      && row.corpus_methodology_slug === "triggers-barriers"
      && row.output_kind === "signal"
    );
  if (!supportedFallback) {
    throw new Error(
      "Signal V2 operational backfill requires a published Signal Pulse output "
      + "or a published Triggers & Barriers Signal fallback over the same governed corpus."
    );
  }
  if (!row.subject_matches) throw new Error("Signal output and workspace subject/organization do not match.");
  if (!row.date_from || !row.date_through) throw new Error("Signal corpus has no included mention window.");
  if (row.metric_definitions < 1) throw new Error("Signal metric catalog is not seeded.");
  return row;
}

async function applyBackfill(pool: import("pg").Pool, args: Args, scope: ScopeRow) {
  if (process.env[APPROVAL_ENV] !== "true") {
    throw new Error(`${APPROVAL_ENV}=true is required for --apply.`);
  }
  process.env.NOISIA_SIGNAL_INTERPRETATIONS_ENABLED = "false";
  process.env.NOISIA_SIGNAL_INTERPRETATIONS_LLM_ENABLED = "false";
  const client = await pool.connect();
  let invalidationId: string | null = null;
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE signal_workspaces
       SET metadata = metadata || jsonb_build_object(
         'legacy_output_id', $2::uuid,
         'signal_v2_backfilled_at', now()
       ),
       updated_at = now()
       WHERE id = $1::uuid`,
      [args.workspaceId, args.outputId]
    );
    await client.query(
      `UPDATE signal_workspace_corpora
       SET valid_to = GREATEST(now(), valid_from + interval '1 microsecond'),
           metadata = metadata || '{"reason":"signal_v2_targeted_backfill_superseded"}'::jsonb,
           updated_at = now()
       WHERE workspace_id = $1::uuid
         AND role = 'operational'
         AND valid_to IS NULL
         AND study_corpus_id <> $2::uuid`,
      [args.workspaceId, scope.study_corpus_id]
    );
    await client.query(
      `UPDATE signal_workspace_corpora
       SET valid_to = GREATEST(now(), valid_from + interval '1 microsecond'),
           metadata = metadata || '{"reason":"signal_v2_selected_corpus_role_superseded"}'::jsonb,
           updated_at = now()
       WHERE workspace_id = $1::uuid
         AND study_corpus_id = $2::uuid
         AND role <> 'operational'
         AND valid_to IS NULL`,
      [args.workspaceId, scope.study_corpus_id]
    );
    await client.query(
      `INSERT INTO signal_workspace_corpora (workspace_id, study_corpus_id, role, metadata)
       VALUES ($1::uuid, $2::uuid, 'operational', '{"backfill":"signal-v2"}'::jsonb)
       ON CONFLICT DO NOTHING`,
      [args.workspaceId, scope.study_corpus_id]
    );
    await client.query(
      `UPDATE signal_workspace_corpora
       SET role = 'operational',
           metadata = metadata || '{"backfill":"signal-v2"}'::jsonb,
           updated_at = now()
       WHERE workspace_id = $1::uuid
         AND study_corpus_id = $2::uuid
         AND valid_to IS NULL`,
      [args.workspaceId, scope.study_corpus_id]
    );
    await client.query(
      `INSERT INTO signal_refresh_policies (
         workspace_id, source_key, adapter_key, cadence, timezone, enabled, metadata
       )
       SELECT id, 'manual-import', 'manual_import', 'manual', timezone, false,
         '{"backfill":"signal-v2","client_activation":false}'::jsonb
       FROM signal_workspaces WHERE id = $1::uuid
       ON CONFLICT (workspace_id, source_key) DO NOTHING`,
      [args.workspaceId]
    );
    const watermark = await client.query<{ id: string }>(
      `SELECT id::text
       FROM signal_data_watermarks
       WHERE workspace_id = $1::uuid AND study_corpus_id = $2::uuid
       ORDER BY accepted_at DESC, id
       LIMIT 1`,
      [args.workspaceId, scope.study_corpus_id]
    );
    if (!watermark.rows[0] && scope.latest_import_batch_id) {
      await client.query(
        `SELECT * FROM record_signal_data_acceptance(
          $1::uuid, 'manual-import', NULL, NULL, $2::uuid, $3::integer, now(), now()
        )`,
        [scope.study_corpus_id, scope.latest_import_batch_id, scope.corpus_revision]
      );
    }
    const invalidation = await client.query<{ id: string }>(
      `WITH latest_watermark AS (
         SELECT id
         FROM signal_data_watermarks
         WHERE workspace_id = $1::uuid AND study_corpus_id = $2::uuid
         ORDER BY accepted_at DESC, id
         LIMIT 1
       )
       INSERT INTO signal_data_invalidations (
         workspace_id, study_corpus_id, data_watermark_id, source_key,
         idempotency_key, affected_from, affected_through, scope
       )
       SELECT $1::uuid, $2::uuid, id, 'signal-v2-backfill',
         'signal-v2-backfill:' || $1::uuid::text || ':' || $3::integer::text,
         $4::date, $5::date,
         '{"targets":["metric_materializations","interpretation_freshness"],"backfill":"signal-v2"}'::jsonb
       FROM latest_watermark
       ON CONFLICT (idempotency_key) DO UPDATE SET
         affected_from = EXCLUDED.affected_from,
         affected_through = EXCLUDED.affected_through
       RETURNING id::text`,
      [args.workspaceId, scope.study_corpus_id, scope.corpus_revision, scope.date_from, scope.date_through]
    );
    invalidationId = invalidation.rows[0]?.id ?? null;
    if (!invalidationId) throw new Error("Signal data watermark is not available.");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  const [{ signalMaterializationJob }, workerDb] = await Promise.all([
    import("../../../services/workers/src/workers/signal-materialization"),
    import("../../../services/workers/src/db/client")
  ]);
  try {
    const data: SignalMaterializeJobDataV1 = {
      contract_version: "signal-materialization-v1",
      trigger: "invalidation",
      workspace_id: args.workspaceId,
      study_corpus_id: scope.study_corpus_id,
      invalidation_id: invalidationId,
      affected_from: scope.date_from,
      affected_through: scope.date_through
    };
    return await signalMaterializationJob({ data } as Job<SignalMaterializeJobDataV1>);
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
    operation: args.apply ? "Signal V2 targeted backfill" : "Signal V2 targeted backfill dry-run",
    allowRemoteEnv: ALLOW_REMOTE_ENV
  };
  if (args.apply) safety.requireSafeDatabaseWriteTarget(databaseUrl, guard);
  else safety.requireSafeDatabaseReadTarget(databaseUrl, guard);
  try {
    const before = await loadScope(pool, args);
    const materialization = args.apply ? await applyBackfill(pool, args, before) : null;
    const after = await loadScope(pool, args);
    if (before.payload_digest !== after.payload_digest) {
      throw new Error("published_outputs.payload changed during Signal V2 backfill.");
    }
    console.log(JSON.stringify({
      ok: true,
      mode: args.apply ? "apply" : "dry-run",
      identifiers_redacted: true,
      scope: {
        output_published: after.output_status === "published",
        legacy_fallback_supported:
          (
            after.methodology_slug === "signal-pulse"
            && after.output_kind === "signal_pulse"
          )
          || (
            after.methodology_slug === "triggers-barriers"
            && after.output_kind === "signal"
          ),
        subject_matches: after.subject_matches,
        operational_membership: args.apply ? after.membership_role === "operational" : after.membership_role,
        included_window_available: Boolean(after.date_from && after.date_through),
        metric_definitions: after.metric_definitions
      },
      materialization,
      payload_preserved: before.payload_digest === after.payload_digest,
      llm_spend_usd: 0,
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
