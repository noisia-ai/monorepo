/** One-shot adversarial PostgreSQL proof for 0120 on the hydrated, disposable successor only. */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { appendSignalTopicCandidateRefinementTerminalReceiptV1,
  claimSignalTopicCandidateRefinementFlightExecutionV1,
  createSignalTopicCandidateRefinementFlightV1,
  createSignalTopicCandidateRefinementSessionV1 } from "@noisia/db";
import { signalTopicEvaluationDigestV2 } from "@noisia/query-engine";

import { createSignalTopicEvaluationLabDockerWritePoolV2 } from
  "./signal-topic-evaluation-lab-docker-write-pool-v2";
import { SignalTopicEvaluationLabWriteErrorV2 } from
  "./signal-topic-evaluation-lab-docker-write-pool-v2";
import { verifyFixedSignalTopicCandidateRefinementSuccessorHostReceiptV1 } from
  "./signal-topic-candidate-refinement-successor-host-provenance-v1";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const CONFIRMATION = "PROVE_0120_LOCAL_REFINEMENT_FLIGHT_EXECUTION_SEAL";
const CHECKSUMS = {
  m116: "sha256:02a53637d73be36c4001536a05fc112fb0d7f0aceb32878cb45939e7533e9664",
  m117: "sha256:096e0e81bafe38ee7ca5071aaf4a06007c7a376a4da7e9b5515286b43b6a6c02",
  m118: "sha256:e4d578426fe0457d450f56df4d1f6909bc14e4629c53d92a8a6c81bb865ccf2f"
} as const;
type Candidate = { workspace_id: string; actor_id: string; run_key: string; candidate_key: string;
  candidate_revision: number; state_token: string };

export async function proveSignalTopicCandidateRefinementFlightExecutionSealV2(env: NodeJS.ProcessEnv) {
  if (env.NOISIA_RUNTIME_PROFILE !== "local_disposable_lab_v1"
      || env.NOISIA_TOPIC_REFINEMENT_LAB_0120_PROOF_ENABLED !== "true"
      || env.NOISIA_TOPIC_REFINEMENT_LAB_0120_PROOF_CONFIRMATION !== CONFIRMATION) {
    throw new Error("topic_refinement_0120_postgres_proof_disabled");
  }
  const { receipt, container } = await verifyFixedSignalTopicCandidateRefinementSuccessorHostReceiptV1();
  const pool = createSignalTopicEvaluationLabDockerWritePoolV2(receipt);
  const before = (await pool.query<Candidate>(`SELECT candidate.workspace_id::text, snapshot.created_by_user_id::text actor_id,
    run.run_key,candidate.candidate_key,base.revision::int candidate_revision,
    signal_topic_evaluation_v2_candidate_state_token_v1(candidate.id,base.revision,base.payload_digest) state_token
    FROM signal_topic_evaluation_v2_candidates candidate
    JOIN signal_topic_evaluation_v2_runs run ON run.id=candidate.run_id
    JOIN signal_topic_evaluation_v2_snapshots snapshot ON snapshot.id=run.snapshot_id
    JOIN signal_topic_evaluation_v2_candidate_revisions base ON base.candidate_id=candidate.id AND base.revision=1
    WHERE candidate.status='pending' AND NOT candidate.adopted AND NOT candidate.published AND NOT candidate.serving
    ORDER BY candidate.candidate_key LIMIT 1`)).rows[0];
  const baseline = (await pool.query<{ sessions: number; flights: number; claims: number; terminals: number; m120: number; m121: number;
    anchored_receipt_digest: string; anchored_container_identity_digest: string }>(`SELECT
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_refinement_sessions) sessions,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_refinement_flights) flights,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_refinement_flight_dispatch_claims) claims,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_refinement_flight_terminal_receipts) terminals,
    (SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=120 AND disposition='applied') m120,
    (SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=121 AND disposition='applied') m121,
    (SELECT host_receipt_digest FROM noisia_topic_evaluation_lab.host_receipt_anchor) anchored_receipt_digest,
    (SELECT container_identity_digest FROM noisia_topic_evaluation_lab.host_receipt_anchor) anchored_container_identity_digest`)).rows[0];
  if (!before || !baseline || baseline.sessions !== 0 || baseline.flights !== 0 || baseline.claims !== 0
      || baseline.terminals !== 0 || baseline.m120 !== 1 || baseline.m121 !== 1
      || baseline.anchored_receipt_digest !== receipt.receipt_digest
      || baseline.anchored_container_identity_digest !== signalTopicEvaluationDigestV2({
        container_id: container.container_id, image_id: container.image_id
      })) throw new Error("topic_refinement_0120_postgres_proof_not_pristine");
  const suffix = signalTopicEvaluationDigestV2({ clone: receipt.clone_name, candidate: before.candidate_key,
    migration: 120 }).slice(7, 23);
  const actor = { id: before.actor_id, user_type: "noisia_internal" as const };
  const session = await createSignalTopicCandidateRefinementSessionV1({ pool, workspace_id: before.workspace_id, actor,
    idempotency_key: `lab2h.0120.session.${suffix}`, input: { run_key: before.run_key,
      candidate_key: before.candidate_key, expected_revision: before.candidate_revision, state_token: before.state_token } });
  let forgedProvenanceRejected = false;
  try {
    await createSignalTopicCandidateRefinementFlightV1({ pool, workspace_id: before.workspace_id, actor,
      session_key: session.session_key, idempotency_key: `lab2h.0121.forged.${suffix}`,
      confirmation: "AUTHORIZE_LOCAL_DISPOSABLE_TOPIC_CANDIDATE_REFINEMENT", provenance: {
        source_clone_receipt_digest: `sha256:${"0".repeat(64)}`,
        source_container_identity_digest: signalTopicEvaluationDigestV2({ container_id: container.container_id, image_id: container.image_id }),
        migration_0116_checksum: CHECKSUMS.m116, migration_0117_checksum: CHECKSUMS.m117, migration_0118_checksum: CHECKSUMS.m118
      } });
  } catch (error) { forgedProvenanceRejected = isExpectedDomainError(error, "topic_refinement_flight_rejected"); }
  const flight = await createSignalTopicCandidateRefinementFlightV1({ pool, workspace_id: before.workspace_id, actor,
    session_key: session.session_key, idempotency_key: `lab2h.0120.flight.${suffix}`,
    confirmation: "AUTHORIZE_LOCAL_DISPOSABLE_TOPIC_CANDIDATE_REFINEMENT", provenance: {
      source_clone_receipt_digest: receipt.receipt_digest,
      source_container_identity_digest: signalTopicEvaluationDigestV2({ container_id: container.container_id, image_id: container.image_id }),
      migration_0116_checksum: CHECKSUMS.m116, migration_0117_checksum: CHECKSUMS.m117, migration_0118_checksum: CHECKSUMS.m118
    } });
  const flightId = (await pool.query<{ id: string }>(`SELECT id::text FROM signal_topic_evaluation_v2_candidate_refinement_flights
    WHERE workspace_id=$1::uuid AND flight_key=$2`, [before.workspace_id, flight.flight_key])).rows[0]?.id;
  if (!flightId) throw new Error("topic_refinement_0120_postgres_proof_flight_missing");
  const beforeClaimTerminalRejected = await expectDirectTerminalRejection(pool, flightId, "definitely_not_sent", 0, 0, 0, 0,
    "topic_refinement_terminal_authority_invalid");
  await claimSignalTopicCandidateRefinementFlightExecutionV1({ pool, workspace_id: before.workspace_id, actor, flight_key: flight.flight_key });
  let duplicateClaimRejected = false;
  try { await claimSignalTopicCandidateRefinementFlightExecutionV1({ pool, workspace_id: before.workspace_id, actor, flight_key: flight.flight_key }); }
  catch (error) { duplicateClaimRejected = isExpectedDomainError(error, "topic_refinement_flight_rejected"); }
  const nullKnownSettlementRejected = await expectDirectTerminalRejection(pool, flightId, "completed", 1, null, null, null,
    "topic_refinement_terminal_settlement_invalid");
  const terminal = await appendSignalTopicCandidateRefinementTerminalReceiptV1({ pool, workspace_id: before.workspace_id,
    flight_key: flight.flight_key, terminal_status: "definitely_not_sent", provider_call_count: 0,
    input_tokens: 0, output_tokens: 0, settled_micro_usd: 0, provider_request_digest: null,
    error_code: "topic_refinement_0120_postgres_proof" });
  const after = (await pool.query<{ sessions: number; flights: number; claims: number; terminals: number;
    candidate_status: string; adopted: boolean; published: boolean; serving: boolean; settled: number; terminal_digest: string }>(`SELECT
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_refinement_sessions) sessions,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_refinement_flights) flights,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_refinement_flight_dispatch_claims) claims,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_refinement_flight_terminal_receipts) terminals,
      candidate.status candidate_status,candidate.adopted,candidate.published,candidate.serving,
      terminal.settled_micro_usd settled,terminal.terminal_digest
      FROM signal_topic_evaluation_v2_candidate_refinement_flights flight
      JOIN signal_topic_evaluation_v2_candidate_refinement_flight_terminal_receipts terminal ON terminal.flight_id=flight.id
      JOIN signal_topic_evaluation_v2_candidates candidate ON candidate.id=flight.candidate_id
      WHERE flight.flight_key=$1`, [flight.flight_key])).rows[0];
  if (!forgedProvenanceRejected || !beforeClaimTerminalRejected || !duplicateClaimRejected || !nullKnownSettlementRejected || !after
      || after.sessions !== 1 || after.flights !== 1 || after.claims !== 1 || after.terminals !== 1
      || after.candidate_status !== "pending" || after.adopted || after.published || after.serving
      || after.settled !== 0 || terminal.terminal_digest !== after.terminal_digest) {
    throw new Error(`topic_refinement_0120_postgres_proof_verify_failed:${JSON.stringify({
      forged_provenance_rejected: forgedProvenanceRejected,
      before_claim_terminal_rejected: beforeClaimTerminalRejected,
      duplicate_claim_rejected: duplicateClaimRejected,
      null_known_settlement_rejected: nullKnownSettlementRejected,
      terminal_written: Boolean(after?.terminal_digest)
    })}`);
  }
  const evidence = { contract_version: "signal-topic-candidate-refinement-0120-postgres-proof-v2", recorded_at: new Date().toISOString(),
    target: { clone_name: receipt.clone_name, host_anchor_receipt_digest: receipt.receipt_digest,
      container_identity_digest: signalTopicEvaluationDigestV2({ container_id: container.container_id, image_id: container.image_id }) },
    proof: { candidate_key: before.candidate_key, flight_key: flight.flight_key, session_key: session.session_key,
      forged_provenance_rejected: true, before_claim_terminal_rejected: true, duplicate_claim_rejected: true,
      null_known_settlement_rejected: true,
      terminal_status: terminal.terminal_status, terminal_digest: terminal.terminal_digest },
    effects: { provider_calls_during_proof: 0, uat_connections: 0, production_accessed: false, candidate_edits: 0,
      topic_adoption: 0, publication: 0, serving: 0 } };
  const directory = resolve(ROOT, ".data/signal-topic-evaluation/lab-2h", receipt.clone_name);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, "flight-0120-postgres-proof.sanitized.json");
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return { evidence, path, receipt_digest: signalTopicEvaluationDigestV2(evidence) };
}

async function expectDirectTerminalRejection(pool: ReturnType<typeof createSignalTopicEvaluationLabDockerWritePoolV2>, flightId: string,
  terminalStatus: "completed" | "definitely_not_sent", calls: number, input: number | null, output: number | null,
  settled: number | null, expectedDomainCode: string) {
  try { await pool.query(`INSERT INTO signal_topic_evaluation_v2_candidate_refinement_flight_terminal_receipts(
      id,flight_id,terminal_status,provider_call_count,input_tokens,output_tokens,settled_micro_usd,
      provider_request_digest,error_code,terminal_digest) VALUES(gen_random_uuid(),$1::uuid,$2,$3,$4,$5,$6,NULL,
      'topic_refinement_0120_direct_sql_proof','sha256:${"0".repeat(64)}')`, [flightId, terminalStatus, calls, input, output, settled]);
    return false;
  } catch (error) {
    return error instanceof SignalTopicEvaluationLabWriteErrorV2 && error.sqlstate === "23514"
      && error.domain_code === expectedDomainCode;
  }
}

function isExpectedDomainError(error: unknown, expected: string) {
  return error instanceof Error && (error as { code?: unknown }).code === expected;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  proveSignalTopicCandidateRefinementFlightExecutionSealV2(process.env).then(({ evidence, path, receipt_digest }) => {
    process.stdout.write(`${JSON.stringify({ status: "pass", proof: evidence.proof, receipt_path: path, receipt_digest,
      effects: evidence.effects })}\n`);
  }).catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "topic_refinement_0120_postgres_proof_failed"}\n`); process.exitCode = 1; });
}
