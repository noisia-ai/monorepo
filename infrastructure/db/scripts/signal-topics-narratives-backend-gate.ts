import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type JsonObject = Record<string, unknown>;

const REQUIRED_JSON = [
  "laika-taxonomy-backfill.json",
  "signal-topics-narratives-worker.json",
  "signal-topics-narratives-reconcile.json",
  "signal-topics-narratives-serving.json",
  "release-gate.json"
] as const;

async function main() {
  const evidenceDir =
    process.env.NOISIA_SIGNAL_TAXONOMY_EVIDENCE_DIR?.trim();
  if (!evidenceDir) {
    throw new Error("NOISIA_SIGNAL_TAXONOMY_EVIDENCE_DIR is required.");
  }
  const absoluteDir = resolve(evidenceDir);
  const stagingCheck = await readFile(
    resolve(absoluteDir, "staging-check.txt"),
    "utf8"
  );
  const evidence = Object.fromEntries(
    await Promise.all(REQUIRED_JSON.map(async (name) => [
      name,
      await parseJsonArtifact(resolve(absoluteDir, name))
    ]))
  ) as Record<(typeof REQUIRED_JSON)[number], JsonObject>;
  const backfill = evidence["laika-taxonomy-backfill.json"];
  const worker = evidence["signal-topics-narratives-worker.json"];
  const reconcile = evidence["signal-topics-narratives-reconcile.json"];
  const serving = evidence["signal-topics-narratives-serving.json"];
  const release = evidence["release-gate.json"];
  const profiles = objectArray(backfill.profiles);
  const profileKinds = new Set(profiles.map((profile) => profile.kind));
  const termsApproved = profiles.every((profile) =>
    profile.status === "active"
    && profile.human_approved === true
    && positiveInteger(profile.term_count) !== null
  );
  const checks = {
    staging_preview_target:
      stagingCheck.includes("ready_for_staging_shadow=true")
      && (
        stagingCheck.includes("NOISIA_REMOTE_DATABASE_TARGET=staging")
        || stagingCheck.includes("NOISIA_REMOTE_DATABASE_TARGET=preview")
      ),
    laika_scope_resolved:
      backfill.ok === true
      && backfill.mode === "apply"
      && backfill.scope_resolved_from_postgres === true
      && backfill.identifiers_redacted === true,
    approved_profiles:
      profileKinds.size === 2
      && profileKinds.has("topic")
      && profileKinds.has("narrative")
      && termsApproved,
    enrichment_completed:
      worker.ok === true
      && worker.topic_run_status === "completed"
      && worker.narrative_run_status === "completed"
      && positiveInteger(worker.approved_topic_tags) !== null
      && positiveInteger(worker.approved_narrative_tags) !== null,
    incremental_runtime_safe:
      worker.import_triggered === true
      && worker.tb_rerun === false
      && worker.retry_idempotency_verified === true
      && worker.dead_letter_recovery_verified === true,
    sql_reconciled:
      reconcile.ok === true
      && reconcile.topic_exact_ids === true
      && reconcile.narrative_exact_ids === true
      && reconcile.pending_rejected_excluded === true
      && reconcile.explain_analyze === true
      && reconcile.required_indexes_present === true,
    workspace_serving_safe:
      serving.ok === true
      && serving.filter_parity === true
      && serving.authz_negative_passed === true
      && serving.lineage_complete === true
      && serving.published_payload_read === false
      && serving.chart_aggregates_read === false,
    valid_data_os_release_gate:
      release.ready_for_production_review === true
      && release.database_format === "postgres_url",
    spend_within_explicit_cap:
      nonNegativeNumber(worker.llm_spend_usd) !== null
      && nonNegativeNumber(worker.llm_budget_cap_usd) !== null
      && Number(worker.llm_spend_usd) <= Number(worker.llm_budget_cap_usd),
    clients_not_activated:
      backfill.client_activation === false
      && serving.client_activation === false
  };
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([key]) => key);
  const ready = failed.length === 0;
  console.log(JSON.stringify({
    backend_ready_for_signal_topics_narratives: ready,
    identifiers_redacted: true,
    checks,
    failed,
    evidence_artifacts: ["staging-check.txt", ...REQUIRED_JSON],
    llm_spend_usd: nonNegativeNumber(worker.llm_spend_usd),
    llm_budget_cap_usd: nonNegativeNumber(worker.llm_budget_cap_usd),
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

function objectArray(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonObject =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item)
      )
    : [];
}

function positiveInteger(value: unknown) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function nonNegativeNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
