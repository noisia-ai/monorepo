import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { config as loadEnv } from "dotenv";
import pg from "pg";

const ROOT = "/Users/brandhon_o/Downloads/noisia-website";
const OUTPUT_DIR = resolve(ROOT, ".data/signal-governed-serving/backend-07");
const EXPECTED_POOLER = "sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815";
const sha256 = (value: string | Buffer) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const fingerprint = (value: string) => {
  const parsed = new URL(value);
  return sha256([
    parsed.protocol, parsed.hostname.toLowerCase(), parsed.port || "5432",
    parsed.pathname.replace(/^\//u, ""), parsed.username
  ].join("|"));
};

loadEnv({ path: resolve(ROOT, "apps/studio/.env.local"), override: true });
loadEnv({ path: resolve(ROOT, "services/workers/.env"), override: false });
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl || fingerprint(databaseUrl) !== EXPECTED_POOLER) {
  throw new Error("signal_strategic_preflight_target_mismatch");
}
const database = new pg.Client({ connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }, application_name: "noisia-backend-07-preflight-readonly" });
await database.connect();
let workspaceId = "";
let before: Record<string, number>;
try {
  await database.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const workspace = (await database.query<{ id: string }>(`SELECT workspace.id::text
    FROM signal_workspaces workspace JOIN brands brand ON brand.id=workspace.brand_id
    WHERE brand.slug='laika' AND workspace.status='active'`)).rows;
  if (workspace.length !== 1) throw new Error("signal_strategic_preflight_workspace_ambiguous");
  workspaceId = workspace[0]!.id;
  before = (await database.query(`SELECT
    (SELECT count(*)::int FROM signal_strategic_run_controls WHERE workspace_id=$1::uuid) AS runs,
    (SELECT count(*)::int FROM signal_strategic_run_outbox WHERE workspace_id=$1::uuid) AS run_jobs,
    (SELECT count(*)::int FROM signal_strategic_step_outbox WHERE workspace_id=$1::uuid) AS step_jobs,
    (SELECT count(*)::int FROM signal_strategic_budget_reservations reservation
      JOIN signal_strategic_run_controls control ON control.id=reservation.run_control_id
      WHERE control.workspace_id=$1::uuid) AS reservations`, [workspaceId])).rows[0];
  await database.query("COMMIT");
} catch (error) {
  await database.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await database.end();
}

const { preflightSignalTbStrategicRun } = await import(
  "../src/lib/data-os/signal-strategic-consumption"
);
const preflight = await preflightSignalTbStrategicRun({
  workspaceId,
  periodStart: "2025-07-14",
  periodEnd: "2026-07-24",
  timezone: "America/Mexico_City",
  studySize: "medium",
  hardCapUsd: 15
});
const sanitizedPreflight = {
  ...preflight,
  destinations: preflight.destinations
    ? Object.fromEntries(Object.entries(preflight.destinations).map(([key, value]) => [
        key,
        typeof value === "string" ? value.replaceAll(workspaceId, "{workspaceId:redacted}") : value
      ]))
    : preflight.destinations
};

const verify = new pg.Client({ connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }, application_name: "noisia-backend-07-preflight-verify" });
await verify.connect();
let after: Record<string, number>;
try {
  await verify.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  after = (await verify.query(`SELECT
    (SELECT count(*)::int FROM signal_strategic_run_controls WHERE workspace_id=$1::uuid) AS runs,
    (SELECT count(*)::int FROM signal_strategic_run_outbox WHERE workspace_id=$1::uuid) AS run_jobs,
    (SELECT count(*)::int FROM signal_strategic_step_outbox WHERE workspace_id=$1::uuid) AS step_jobs,
    (SELECT count(*)::int FROM signal_strategic_budget_reservations reservation
      JOIN signal_strategic_run_controls control ON control.id=reservation.run_control_id
      WHERE control.workspace_id=$1::uuid) AS reservations`, [workspaceId])).rows[0];
  await verify.query("COMMIT");
} catch (error) {
  await verify.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await verify.end();
}
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("preflight_performed_writes");
const evidence = {
  contract_version: "signal-backend-07-free-preflight-v1",
  captured_at: new Date().toISOString(), target: "noisia-staging",
  method: "GET-service-contract", request: {
    period_start: "2025-07-14", period_end: "2026-07-24",
    timezone: "America/Mexico_City", study_size: "medium", hard_cap_usd: 15
  },
  response: sanitizedPreflight, protected_before: before, protected_after: after
};
await mkdir(OUTPUT_DIR, { recursive: true, mode: 0o700 });
const output = `${JSON.stringify(evidence, null, 2)}\n`;
const outputPath = resolve(OUTPUT_DIR, "free-preflight.sanitized.json");
await writeFile(outputPath, output, { mode: 0o600 });
await chmod(outputPath, 0o600);
process.stdout.write(`${JSON.stringify({
  ok: preflight.ready && preflight.launch_authorized,
  ready: preflight.ready, launch_authorized: preflight.launch_authorized,
  blockers: preflight.blocking_reasons, denominator: preflight.denominator?.count ?? null,
  coverage_state: preflight.coverage?.state ?? null,
  model: preflight.provider?.model ?? null,
  estimated_cost_usd: preflight.budget?.estimated_cost_usd ?? null,
  hard_cap_usd: preflight.budget?.hard_cap_usd ?? null,
  worker_ready: preflight.readiness.worker_alive,
  recovery_ready: preflight.readiness.recovery_ready,
  jobs_enqueued: preflight.jobs_enqueued, provider_calls: preflight.provider_calls,
  preflight_digest: preflight.preflight_digest,
  artifact_sha256: sha256(output)
})}\n`);
if (!preflight.ready || !preflight.launch_authorized) process.exitCode = 2;
