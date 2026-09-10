/** Apply the append-only refinement control plane to one direct completed-LAB-2G clone. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { signalTopicEvaluationDigestV2 } from "@noisia/query-engine";

import { runSignalTopicEvaluationLabDockerV1 } from "./signal-topic-evaluation-lab-docker-transport-v2";
import { SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME } from "./signal-topic-evaluation-lab-host-provenance-v2";
import { verifyFixedSignalTopicCandidateRefinementSuccessorHostReceiptV1 } from
  "./signal-topic-candidate-refinement-successor-host-provenance-v1";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const CONFIRMATION = "APPLY_REFINEMENT_CONTROL_PLANE_TO_DIRECT_LAB2G_SUCCESSOR";
const MIGRATIONS = [
  { ordinal: 118, name: "0118_signal_topic_evaluation_v2_candidate_refinement.sql" },
  { ordinal: 119, name: "0119_signal_topic_evaluation_v2_candidate_refinement_flight.sql" },
  { ordinal: 120, name: "0120_signal_topic_evaluation_v2_candidate_refinement_flight_execution_seal.sql" },
  { ordinal: 121, name: "0121_signal_topic_evaluation_v2_candidate_refinement_flight_provenance_anchor.sql" }
] as const;

class RefinementSuccessorControlPlaneError extends Error {
  constructor(readonly code: string) { super(code); }
}

const OUTPUT_DIGEST_SQL = `signal_semantic_context_digest_json_v2(jsonb_build_object(
  'authorization',(SELECT jsonb_agg(to_jsonb(auth) ORDER BY auth.id) FROM signal_topic_evaluation_v2_execution_authorizations auth),
  'run',(SELECT jsonb_agg(to_jsonb(run) ORDER BY run.id) FROM signal_topic_evaluation_v2_runs run),
  'model_turn',(SELECT jsonb_agg(to_jsonb(turn) ORDER BY turn.run_id,turn.turn_index) FROM signal_topic_evaluation_v2_model_turns turn),
  'retrieval',(SELECT jsonb_agg(to_jsonb(retrieval) ORDER BY retrieval.id) FROM signal_topic_evaluation_v2_retrievals retrieval),
  'retrieval_evidence',(SELECT jsonb_agg(to_jsonb(evidence) ORDER BY evidence.retrieval_id,evidence.evidence_ref) FROM signal_topic_evaluation_v2_retrieval_evidence evidence),
  'candidate',(SELECT jsonb_agg(to_jsonb(candidate) ORDER BY candidate.id) FROM signal_topic_evaluation_v2_candidates candidate),
  'candidate_revision',(SELECT jsonb_agg(to_jsonb(revision) ORDER BY revision.id) FROM signal_topic_evaluation_v2_candidate_revisions revision),
  'candidate_evidence',(SELECT jsonb_agg(to_jsonb(evidence) ORDER BY evidence.candidate_id,evidence.retrieval_id,evidence.evidence_ref) FROM signal_topic_evaluation_v2_candidate_evidence evidence),
  'ranking',(SELECT jsonb_agg(to_jsonb(ranking) ORDER BY ranking.candidate_id) FROM signal_topic_evaluation_v2_rankings ranking)
))`;

function proofSql() {
  return `SELECT json_build_object(
    'authorizations',(SELECT count(*)::int FROM signal_topic_evaluation_v2_execution_authorizations),
    'runs',(SELECT count(*)::int FROM signal_topic_evaluation_v2_runs WHERE run_key='topic-v2-lab-run-ee9dcedca1342d414d6646fd' AND status='completed'),
    'model_turns',(SELECT count(*)::int FROM signal_topic_evaluation_v2_model_turns),
    'retrievals',(SELECT count(*)::int FROM signal_topic_evaluation_v2_retrievals),
    'retrieval_evidence',(SELECT count(*)::int FROM signal_topic_evaluation_v2_retrieval_evidence),
    'candidates',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE status='pending' AND NOT adopted AND NOT published AND NOT serving),
    'candidate_revisions',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_revisions),
    'candidate_evidence',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_evidence),
    'rankings',(SELECT count(*)::int FROM signal_topic_evaluation_v2_rankings),
    'provider_calls',(SELECT COALESCE(sum(provider_call_count),0)::int FROM signal_topic_evaluation_v2_runs),
    'adoption',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE adopted),
    'publication',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE published),
    'serving',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE serving),
    '0116',(SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=116 AND disposition='applied'),
    '0117',(SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=117 AND disposition='applied'),
    '0118',(SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=118 AND disposition='applied'),
    '0119',(SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=119 AND disposition='applied'),
    '0120',(SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=120 AND disposition='applied'),
    '0121',(SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=121 AND disposition='applied'),
    -- pg_class permits the pre-migration proof to remain parse-safe before 0118 creates these tables.
    'sessions',COALESCE((SELECT n_live_tup::int FROM pg_stat_all_tables WHERE relid=to_regclass('signal_topic_evaluation_v2_candidate_refinement_sessions')),0),
    'flights',COALESCE((SELECT n_live_tup::int FROM pg_stat_all_tables WHERE relid=to_regclass('signal_topic_evaluation_v2_candidate_refinement_flights')),0),
    'claims',COALESCE((SELECT n_live_tup::int FROM pg_stat_all_tables WHERE relid=to_regclass('signal_topic_evaluation_v2_candidate_refinement_flight_dispatch_claims')),0),
    'terminals',COALESCE((SELECT n_live_tup::int FROM pg_stat_all_tables WHERE relid=to_regclass('signal_topic_evaluation_v2_candidate_refinement_flight_terminal_receipts')),0),
    'output_digest',${OUTPUT_DIGEST_SQL}
  )::text`;
}

function isExpected(value: Record<string, unknown>, migrationCount: 0 | 1, expectedOutputDigest: string) {
  return value.authorizations === 1 && value.runs === 1 && value.model_turns === 12 && value.retrievals === 11
    && value.retrieval_evidence === 30 && value.candidates === 10 && value.candidate_revisions === 10
    && value.candidate_evidence === 30 && value.rankings === 10 && value.provider_calls === 12
    && value.adoption === 0 && value.publication === 0 && value.serving === 0 && value["0116"] === 1 && value["0117"] === 1
    && value["0118"] === migrationCount && value["0119"] === migrationCount && value["0120"] === migrationCount
    && value["0121"] === migrationCount && value.sessions === 0 && value.flights === 0 && value.claims === 0
    && value.terminals === 0 && value.output_digest === expectedOutputDigest;
}

async function queryJson(database: string, sql: string) {
  const output = await runSignalTopicEvaluationLabDockerV1(["exec", SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,
    "psql", "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1",
    "--username", "postgres", "--dbname", database, "--command", sql]);
  try { return JSON.parse(output) as Record<string, unknown>; }
  catch { throw new RefinementSuccessorControlPlaneError("topic_refinement_successor_control_plane_database_proof_invalid"); }
}

async function applyMigration(database: string, targetFingerprint: string, migration: { ordinal: number; name: string }) {
  const bytes = await readFile(resolve(ROOT, "infrastructure/db/migrations", migration.name));
  const checksum = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const ledger = `INSERT INTO signal_workspace_data_plane_migration_ledger(migration_name,ordinal,checksum_sha256,disposition,runner_version,target_fingerprint)
    VALUES('${migration.name}',${migration.ordinal},'${checksum}','applied','topic-refinement-successor-control-plane-v1','${targetFingerprint}');`;
  await runSignalTopicEvaluationLabDockerV1(["exec", "--interactive", SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,
    "psql", "--no-psqlrc", "--quiet", "--set", "ON_ERROR_STOP=1", "--username", "postgres", "--dbname", database],
  Buffer.from(`BEGIN;\n${bytes.toString("utf8")}\n${ledger}\nCOMMIT;\n`));
  return { ...migration, checksum_sha256: checksum, applied_exactly_once: true };
}

export async function applySignalTopicCandidateRefinementSuccessorControlPlaneV1(env: NodeJS.ProcessEnv) {
  if (env.NOISIA_RUNTIME_PROFILE !== "local_disposable_lab_v1"
      || env.NOISIA_TOPIC_REFINEMENT_SUCCESSOR_CONTROL_PLANE_ENABLED !== "true"
      || env.NOISIA_TOPIC_REFINEMENT_SUCCESSOR_CONTROL_PLANE_CONFIRMATION !== CONFIRMATION) {
    throw new RefinementSuccessorControlPlaneError("topic_refinement_successor_control_plane_disabled");
  }
  const { receipt, container } = await verifyFixedSignalTopicCandidateRefinementSuccessorHostReceiptV1();
  const before = await queryJson(receipt.clone_name, proofSql());
  if (!isExpected(before, 0, receipt.parent_output_digest)) {
    throw new RefinementSuccessorControlPlaneError("topic_refinement_successor_control_plane_not_pristine");
  }
  const migrations = [];
  for (const migration of MIGRATIONS) {
    try { migrations.push(await applyMigration(receipt.clone_name, receipt.receipt_digest, migration)); }
    catch { throw new RefinementSuccessorControlPlaneError(`topic_refinement_successor_migration_${migration.ordinal}_failed`); }
  }
  const after = await queryJson(receipt.clone_name, proofSql());
  if (!isExpected(after, 1, receipt.parent_output_digest)) {
    throw new RefinementSuccessorControlPlaneError("topic_refinement_successor_control_plane_verify_failed");
  }
  const evidence = { contract_version: "signal-topic-candidate-refinement-successor-control-plane-v1", recorded_at: new Date().toISOString(),
    target: { clone_name: receipt.clone_name, host_receipt_digest: receipt.receipt_digest,
      parent_output_digest: receipt.parent_output_digest, container_identity_digest: signalTopicEvaluationDigestV2({
        container_id: container.container_id, image_id: container.image_id }) }, migrations, before, after,
    effects: { provider_calls_during_control_plane: 0, uat_connections: 0, production_accessed: false,
      candidate_edits: 0, topic_adoption: 0, publication: 0, serving: 0 } };
  const directory = resolve(ROOT, ".data/signal-topic-evaluation/lab-2h", receipt.clone_name);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, "successor-control-plane.sanitized.json");
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return { evidence, path, receipt_digest: signalTopicEvaluationDigestV2(evidence) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  applySignalTopicCandidateRefinementSuccessorControlPlaneV1(process.env).then(({ evidence, path, receipt_digest }) => {
    process.stdout.write(`${JSON.stringify({ status: "applied_once", target: evidence.target, migrations: evidence.migrations,
      receipt_path: path, receipt_digest, effects: evidence.effects })}\n`);
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "topic_refinement_successor_control_plane_failed"}\n`);
    process.exitCode = 1;
  });
}
