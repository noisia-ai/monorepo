/**
 * Creates one fresh, direct physical clone of completed LAB-2G for candidate refinement.
 *
 * This is intentionally not a pg_dump replay: LAB-2G's authoritative local schema contains
 * provenance checks added after the older disposable template. A physical clone preserves every
 * completed row and constraint byte-for-byte, then receives a new immutable local host anchor.
 */
import { randomBytes, createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { signalTopicEvaluationDigestV2 } from "@noisia/query-engine";

import { runSignalTopicEvaluationLabDockerV1 } from "./signal-topic-evaluation-lab-docker-transport-v2";
import { SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME, inspectSignalTopicEvaluationLabContainerV1 } from
  "./signal-topic-evaluation-lab-host-provenance-v2";
import { SIGNAL_TOPIC_REFINEMENT_SUCCESSOR_HOST_RECEIPT_PATH,
  SIGNAL_TOPIC_REFINEMENT_SUCCESSOR_PARENT_DATABASE,
  ensureSignalTopicCandidateRefinementSuccessorHostReceiptDirectoryV1,
  signalTopicCandidateRefinementSuccessorHostReceiptDigestV1,
  type SignalTopicCandidateRefinementSuccessorHostReceiptV1 } from
  "./signal-topic-candidate-refinement-successor-host-provenance-v1";

process.umask(0o077);

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const SOURCE_RUN = "topic-v2-lab-run-ee9dcedca1342d414d6646fd";
const MARKER_PATH = resolve(ROOT, "services/workers/scripts/setup-signal-topic-evaluation-lab-provenance-v2.sql");
const MARKER_DIGEST = "sha256:213e2f7a6187c001a82e320bf38f27818934edb60a4038c1ee8a94fbd9442d95";

class RefinementSuccessorCloneError extends Error {
  constructor(readonly code: string) { super(code); }
}

async function queryJson(database: string, sql: string) {
  const output = await runSignalTopicEvaluationLabDockerV1(["exec", SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,
    "psql", "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1",
    "--username", "postgres", "--dbname", database, "--command", sql]);
  try { return JSON.parse(output) as Record<string, unknown>; }
  catch { throw new RefinementSuccessorCloneError("topic_refinement_successor_clone_database_proof_invalid"); }
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
    'database_name',current_database(),
    'system_identifier',(pg_control_system()).system_identifier::text,
    'source_run_key',snapshot.source_run_key,
    'snapshot_digest',snapshot.snapshot_digest,
    'artifact_binding_digest',snapshot.artifact_binding_digest,
    'membership_binding_digest',snapshot.membership_binding_digest,
    'run_count',(SELECT count(*)::int FROM signal_topic_evaluation_v2_runs WHERE run_key='${SOURCE_RUN}' AND status='completed'),
    'authorizations',(SELECT count(*)::int FROM signal_topic_evaluation_v2_execution_authorizations),
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
    'output_digest',${OUTPUT_DIGEST_SQL}
  )::text FROM signal_topic_evaluation_v2_snapshots snapshot
    WHERE snapshot.state='frozen' AND snapshot.source_run_key='backend-10c2c-2026-08-21-final-2-bertopic-bge-detail-seed-17'`;
}

function assertCompletedLab2G(value: Record<string, unknown>, expectedDatabase: string) {
  if (value.database_name !== expectedDatabase || value.source_run_key !== "backend-10c2c-2026-08-21-final-2-bertopic-bge-detail-seed-17"
      || value.run_count !== 1 || value.authorizations !== 1 || value.model_turns !== 12 || value.retrievals !== 11
      || value.retrieval_evidence !== 30 || value.candidates !== 10 || value.candidate_revisions !== 10
      || value.candidate_evidence !== 30 || value.rankings !== 10 || value.provider_calls !== 12
      || value.adoption !== 0 || value.publication !== 0 || value.serving !== 0 || value["0116"] !== 1 || value["0117"] !== 1
      || typeof value.snapshot_digest !== "string" || typeof value.artifact_binding_digest !== "string"
      || typeof value.membership_binding_digest !== "string" || typeof value.system_identifier !== "string"
      || !/^sha256:[0-9a-f]{64}$/u.test(String(value.output_digest ?? ""))) {
    throw new RefinementSuccessorCloneError("topic_refinement_successor_parent_invalid");
  }
}

async function runSql(database: string, input: Buffer) {
  await runSignalTopicEvaluationLabDockerV1(["exec", "--interactive", SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,
    "psql", "--no-psqlrc", "--quiet", "--set", "ON_ERROR_STOP=1", "--username", "postgres", "--dbname", database], input);
}

async function sealHostAnchor(cloneName: string, receipt: SignalTopicCandidateRefinementSuccessorHostReceiptV1,
  containerIdentityDigest: string) {
  const encoded = (value: string) => `convert_from(decode('${Buffer.from(value, "utf8").toString("base64")}','base64'),'utf8')`;
  return queryJson(cloneName, `WITH inserted AS (
    INSERT INTO noisia_topic_evaluation_lab.host_receipt_anchor(host_receipt_digest,container_identity_digest,anchor_digest)
    VALUES(${encoded(receipt.receipt_digest)},${encoded(containerIdentityDigest)},'sha256:${"0".repeat(64)}') RETURNING *
  ) SELECT row_to_json(inserted) FROM inserted`);
}

async function main() {
  if (process.env.NOISIA_RUNTIME_PROFILE !== "local_disposable_lab_v1") {
    throw new RefinementSuccessorCloneError("topic_refinement_successor_runtime_profile_invalid");
  }
  try {
    await access(SIGNAL_TOPIC_REFINEMENT_SUCCESSOR_HOST_RECEIPT_PATH, constants.F_OK);
    throw new RefinementSuccessorCloneError("topic_refinement_successor_host_receipt_already_exists");
  } catch (error) {
    if (error instanceof RefinementSuccessorCloneError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new RefinementSuccessorCloneError("topic_refinement_successor_host_receipt_unavailable");
  }
  const marker = await readFile(MARKER_PATH);
  if (`sha256:${createHash("sha256").update(marker).digest("hex")}` !== MARKER_DIGEST) {
    throw new RefinementSuccessorCloneError("topic_refinement_successor_marker_checksum_mismatch");
  }
  const [container, source] = await Promise.all([
    inspectSignalTopicEvaluationLabContainerV1(), queryJson(SIGNAL_TOPIC_REFINEMENT_SUCCESSOR_PARENT_DATABASE, proofSql())
  ]);
  assertCompletedLab2G(source, SIGNAL_TOPIC_REFINEMENT_SUCCESSOR_PARENT_DATABASE);
  const cloneName = `noisia_topic_eval_lab_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}_${randomBytes(6).toString("hex")}`;
  await runSignalTopicEvaluationLabDockerV1(["exec", SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME, "createdb", "--username", "postgres",
    "--template", SIGNAL_TOPIC_REFINEMENT_SUCCESSOR_PARENT_DATABASE, cloneName]);
  // This schema is only the old parent's clone marker. The fresh clone receives a new one tied to
  // its own name and a freshly sealed host receipt; no output table is deleted or altered.
  await runSql(cloneName, Buffer.from(`BEGIN;\nDROP SCHEMA noisia_topic_evaluation_lab CASCADE;\nCOMMIT;\n${marker.toString("utf8")}\n`));
  const cloned = await queryJson(cloneName, proofSql());
  assertCompletedLab2G(cloned, cloneName);
  if (cloned.output_digest !== source.output_digest || cloned.system_identifier !== source.system_identifier) {
    throw new RefinementSuccessorCloneError("topic_refinement_successor_clone_content_mismatch");
  }
  const containerIdentityDigest = signalTopicEvaluationDigestV2({ container_id: container.container_id, image_id: container.image_id });
  const unsigned: Omit<SignalTopicCandidateRefinementSuccessorHostReceiptV1, "receipt_digest"> = {
    contract_version: "signal-topic-candidate-refinement-successor-host-provenance-v1", created_at: new Date().toISOString(),
    container_name: container.container_name, container_id: container.container_id, image_id: container.image_id,
    image_reference: container.image_reference, endpoint_host: container.endpoint_host, endpoint_port: container.endpoint_port,
    clone_name: cloneName, parent_clone_name: SIGNAL_TOPIC_REFINEMENT_SUCCESSOR_PARENT_DATABASE,
    source_run_key: "backend-10c2c-2026-08-21-final-2-bertopic-bge-detail-seed-17", source_snapshot_digest: String(source.snapshot_digest),
    source_artifact_binding_digest: String(source.artifact_binding_digest), source_membership_binding_digest: String(source.membership_binding_digest),
    parent_output_digest: String(source.output_digest), server_system_identifier: String(source.system_identifier)
  };
  const receipt = { ...unsigned, receipt_digest: signalTopicCandidateRefinementSuccessorHostReceiptDigestV1(unsigned) };
  const anchor = await sealHostAnchor(cloneName, receipt, containerIdentityDigest);
  if (anchor.clone_name !== cloneName || anchor.host_receipt_digest !== receipt.receipt_digest
      || anchor.container_identity_digest !== containerIdentityDigest || anchor.source_run_key !== receipt.source_run_key
      || anchor.source_snapshot_digest !== receipt.source_snapshot_digest || anchor.source_artifact_binding_digest !== receipt.source_artifact_binding_digest
      || anchor.source_membership_binding_digest !== receipt.source_membership_binding_digest || anchor.system_identifier !== receipt.server_system_identifier
      || !/^sha256:[0-9a-f]{64}$/u.test(String(anchor.anchor_digest ?? ""))) {
    throw new RefinementSuccessorCloneError("topic_refinement_successor_host_anchor_seal_failed");
  }
  await ensureSignalTopicCandidateRefinementSuccessorHostReceiptDirectoryV1();
  await writeFile(SIGNAL_TOPIC_REFINEMENT_SUCCESSOR_HOST_RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ status: "created", clone_name: cloneName, host_receipt_digest: receipt.receipt_digest,
    parent_output_digest: receipt.parent_output_digest, effects: { local_clones_created: 1, provider_calls_during_clone: 0,
      uat_connections: 0, candidate_edits: 0, topic_adoption: 0, publication: 0, serving: 0 } }));
}

await main().catch((error: unknown) => {
  console.error(error instanceof RefinementSuccessorCloneError ? error.code : "topic_refinement_successor_clone_failed");
  process.exitCode = 1;
});
