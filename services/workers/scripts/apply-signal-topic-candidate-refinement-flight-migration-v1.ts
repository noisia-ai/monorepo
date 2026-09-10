/** Applies 0119 exactly once to the host-receipt-bound, disposable local refinement Lab. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { signalTopicEvaluationDigestV2 } from "@noisia/query-engine";

import { runSignalTopicEvaluationLabDockerV1 } from "./signal-topic-evaluation-lab-docker-transport-v2";
import { SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,
  verifyFixedSignalTopicEvaluationLabHostReceiptV1 } from "./signal-topic-evaluation-lab-host-provenance-v2";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const MIGRATION_NAME = "0119_signal_topic_evaluation_v2_candidate_refinement_flight.sql";
const MIGRATION_PATH = resolve(ROOT, "infrastructure/db/migrations", MIGRATION_NAME);
const CONFIRMATION = "APPLY_0119_TO_EXTERNALLY_ANCHORED_DISPOSABLE_REFINEMENT_LAB";

export async function applySignalTopicCandidateRefinementFlightMigrationV1(env: NodeJS.ProcessEnv) {
  if (env.NOISIA_RUNTIME_PROFILE !== "local_disposable_lab_v1"
      || env.NOISIA_TOPIC_REFINEMENT_LAB_MIGRATION_APPLY_ENABLED !== "true"
      || env.NOISIA_TOPIC_REFINEMENT_LAB_MIGRATION_CONFIRMATION !== CONFIRMATION) {
    throw new Error("topic_refinement_flight_migration_apply_disabled");
  }
  const { receipt, container } = await verifyFixedSignalTopicEvaluationLabHostReceiptV1();
  const bytes = await readFile(MIGRATION_PATH);
  const checksum = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const before = JSON.parse(await query(receipt.clone_name, `SELECT json_build_object(
    '0118',(SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger
      WHERE ordinal=118 AND migration_name='0118_signal_topic_evaluation_v2_candidate_refinement.sql'
        AND disposition='applied'),
    '0119',(SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger
      WHERE ordinal=119 OR migration_name='${MIGRATION_NAME}'),
    'flights_present',to_regclass('signal_topic_evaluation_v2_candidate_refinement_flights') IS NOT NULL
  )::text`)) as Record<string, unknown>;
  if (before["0118"] !== 1 || before["0119"] !== 0 || before.flights_present !== false) {
    throw new Error("topic_refinement_flight_migration_not_pristine");
  }
  const ledger = `INSERT INTO signal_workspace_data_plane_migration_ledger(migration_name,ordinal,
    checksum_sha256,disposition,runner_version,target_fingerprint) VALUES('${MIGRATION_NAME}',119,
    '${checksum}','applied','topic-refinement-flight-lab-migrator-v1','${receipt.receipt_digest}');`;
  await runSignalTopicEvaluationLabDockerV1(["exec", "--interactive",
    SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME, "psql", "--no-psqlrc", "--quiet", "--set",
    "ON_ERROR_STOP=1", "--username", "postgres", "--dbname", receipt.clone_name],
  Buffer.from(`BEGIN;\n${bytes.toString("utf8")}\n${ledger}\nCOMMIT;\n`));
  const proof = JSON.parse(await query(receipt.clone_name, `SELECT json_build_object(
    'ledger_count',(SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=119
      AND migration_name='${MIGRATION_NAME}' AND checksum_sha256='${checksum}' AND disposition='applied'),
    'flights',to_regclass('signal_topic_evaluation_v2_candidate_refinement_flights') IS NOT NULL,
    'receipts',to_regclass('signal_topic_evaluation_v2_candidate_refinement_flight_terminal_receipts') IS NOT NULL,
    'negative_proofs',to_regclass('signal_topic_evaluation_v2_candidate_refinement_negative_proofs') IS NOT NULL,
    'provider_calls',(SELECT COALESCE(sum(provider_call_count),0)::int FROM signal_topic_evaluation_v2_runs),
    'candidates',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates)
  )::text`)) as Record<string, unknown>;
  if (proof.ledger_count !== 1 || proof.flights !== true || proof.receipts !== true
      || proof.negative_proofs !== true || Number(proof.provider_calls) !== 0 || Number(proof.candidates) !== 1) {
    throw new Error("topic_refinement_flight_migration_verify_failed");
  }
  const evidence = { contract_version: "signal-topic-refinement-flight-migration-v1", recorded_at: new Date().toISOString(),
    target: { clone_name: receipt.clone_name, host_anchor_receipt_digest: receipt.receipt_digest,
      container_identity_digest: signalTopicEvaluationDigestV2({ container_id: container.container_id,
        image_id: container.image_id }) }, migration: { ordinal: 119, name: MIGRATION_NAME,
      checksum_sha256: checksum, applied_exactly_once: true }, sentinels: proof,
    effects: { provider_calls: 0, uat_connections: 0, production_accessed: false, topic_adoption: 0,
      publication: 0, serving: 0 } };
  const dir = resolve(ROOT, ".data/signal-topic-evaluation/lab-2h", receipt.clone_name);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = resolve(dir, "migration-0119.sanitized.json");
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return { evidence, path, receipt_digest: signalTopicEvaluationDigestV2(evidence) };
}

async function query(database: string, sql: string) {
  return runSignalTopicEvaluationLabDockerV1(["exec", SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,
    "psql", "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1",
    "--username", "postgres", "--dbname", database, "--command", sql]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  applySignalTopicCandidateRefinementFlightMigrationV1(process.env).then(({ evidence, path, receipt_digest }) => {
    process.stdout.write(`${JSON.stringify({ status: "applied_once", migration: evidence.migration,
      receipt_path: path, receipt_digest, effects: evidence.effects })}\n`);
  }).catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message
    : "topic_refinement_flight_migration_failed"}\n`); process.exitCode = 1; });
}
