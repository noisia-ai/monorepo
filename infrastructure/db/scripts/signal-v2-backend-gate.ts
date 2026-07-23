import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type JsonObject = Record<string, unknown>;

const REQUIRED_JSON = [
  "serving-smoke.json",
  "signal-v2-backfill.json",
  "signal-v2-reconcile.json",
  "signal-v2-explain.json",
  "signal-v2-shadow.json"
] as const;

async function main() {
  const evidenceDir = process.env.NOISIA_DATA_OS_EVIDENCE_PACK_DIR?.trim()
    ?? process.env.NOISIA_DATA_OS_STAGING_EVIDENCE_DIR?.trim();
  if (!evidenceDir) {
    throw new Error("NOISIA_DATA_OS_EVIDENCE_PACK_DIR is required.");
  }
  const absoluteDir = resolve(evidenceDir);
  const stagingCheck = await readFile(resolve(absoluteDir, "staging-check.txt"), "utf8");
  const evidence = Object.fromEntries(
    await Promise.all(REQUIRED_JSON.map(async (name) => [
      name,
      await parseJsonArtifact(resolve(absoluteDir, name))
    ]))
  ) as Record<(typeof REQUIRED_JSON)[number], JsonObject>;

  const servingSmoke = evidence["serving-smoke.json"];
  const backfill = evidence["signal-v2-backfill.json"];
  const reconcile = evidence["signal-v2-reconcile.json"];
  const explain = evidence["signal-v2-explain.json"];
  const shadow = evidence["signal-v2-shadow.json"];
  const livePayloadParity = objectValue(servingSmoke.live_payload_parity);
  const fallbackChecks = objectValue(servingSmoke.fallback_checks);
  const visibilityChecks = objectValue(servingSmoke.visibility_checks);
  const checks = {
    staging_target_approved: stagingCheck.includes("ready_for_staging_shadow=true"),
    legacy_serving_shadow_ready:
      servingSmoke.ok === true
      && servingSmoke.ready_for_serving_shadow === true,
    legacy_payload_parity_preserved:
      livePayloadParity.live_behind_payload === false,
    legacy_fallback_safe:
      fallbackChecks.data_os_disabled_ready === true
      && fallbackChecks.signal_pulse_live_disabled_ready === true,
    legacy_visibility_safe:
      visibilityChecks.client_source_health_hidden === true
      && visibilityChecks.client_internal_dashboard_refs_hidden === true
      && visibilityChecks.internal_source_health_visible === true
      && visibilityChecks.internal_dashboard_refs_preserved === true,
    targeted_backfill_applied:
      backfill.ok === true
      && backfill.mode === "apply"
      && backfill.payload_preserved === true,
    metric_sql_drilldown_reconciled: reconcile.ok === true,
    representative_query_plans_within_budget:
      explain.ok === true
      && explain.analyze === true
      && explain.representative_volume === true,
    facade_shadow_ready: shadow.ready_for_backend_signal_v2 === true,
    identifiers_redacted:
      servingSmoke.corpus_id === "set_redacted"
      && servingSmoke.output_id === "set_redacted"
      && servingSmoke.contains_sensitive_ids === false
      && REQUIRED_JSON
        .filter((name) => name !== "serving-smoke.json")
        .every((name) => evidence[name].identifiers_redacted === true),
    zero_llm_spend:
      Number(backfill.llm_spend_usd) === 0
      && Number(shadow.llm_spend_usd) === 0,
    clients_not_activated:
      backfill.client_activation === false
      && shadow.client_activation === false
  };
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([key]) => key);
  const ready = failed.length === 0;
  console.log(JSON.stringify({
    backend_ready_for_signal_v2: ready,
    identifiers_redacted: true,
    checks,
    failed,
    evidence_artifacts: ["staging-check.txt", ...REQUIRED_JSON],
    llm_spend_usd: 0,
    client_activation: false
  }, null, 2));
  if (!ready) process.exitCode = 1;
}

async function parseJsonArtifact(path: string): Promise<JsonObject> {
  const source = await readFile(path, "utf8");
  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < firstBrace) {
    throw new Error(`${path} does not contain a JSON object.`);
  }
  const parsed = JSON.parse(source.slice(firstBrace, lastBrace + 1));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object.`);
  }
  return parsed as JsonObject;
}

function objectValue(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
