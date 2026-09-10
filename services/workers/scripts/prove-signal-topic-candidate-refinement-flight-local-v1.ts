/**
 * One-shot PostgreSQL proof for migration 0119's local-only refinement-flight authority.
 *
 * It uses the synthetic, externally anchored Lab clone only. It creates one short-lived
 * candidate-refinement session, reserves the sealed $1 ceiling, and records a zero-cost
 * `definitely_not_sent` terminal receipt. It never constructs a provider client and cannot
 * touch the retained LAB-2G candidate corpus, UAT, production, Topic adoption, publication,
 * or serving.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  appendSignalTopicCandidateRefinementTerminalReceiptV1,
  createSignalTopicCandidateRefinementFlightV1,
  createSignalTopicCandidateRefinementSessionV1
} from "@noisia/db";
import { signalTopicEvaluationDigestV2 } from "@noisia/query-engine";

import { createSignalTopicEvaluationLabDockerWritePoolV2 } from
  "./signal-topic-evaluation-lab-docker-write-pool-v2";
import { verifyFixedSignalTopicEvaluationLabHostReceiptV1 } from
  "./signal-topic-evaluation-lab-host-provenance-v2";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const CONFIRMATION = "PROVE_0119_LOCAL_REFINEMENT_FLIGHT_POSTGRES_AUTHORITY";
const RUNTIME_PROFILE = "local_disposable_lab_v1";
const SYNTHETIC_RUN_KEY = "lab2h.proof.seed.20260905";
const MIGRATION_0116 = "sha256:02a53637d73be36c4001536a05fc112fb0d7f0aceb32878cb45939e7533e9664";
const MIGRATION_0117 = "sha256:096e0e81bafe38ee7ca5071aaf4a06007c7a376a4da7e9b5515286b43b6a6c02";
const MIGRATION_0118 = "sha256:e4d578426fe0457d450f56df4d1f6909bc14e4629c53d92a8a6c81bb865ccf2f";

type Candidate = {
  workspace_id: string;
  actor_id: string;
  run_key: string;
  candidate_key: string;
  candidate_revision: number;
  state_token: string;
};

export async function proveSignalTopicCandidateRefinementFlightLocalV1(env: NodeJS.ProcessEnv) {
  if (env.NOISIA_RUNTIME_PROFILE !== RUNTIME_PROFILE
      || env.NOISIA_TOPIC_REFINEMENT_LAB_FLIGHT_POSTGRES_PROOF_ENABLED !== "true"
      || env.NOISIA_TOPIC_REFINEMENT_LAB_FLIGHT_POSTGRES_PROOF_CONFIRMATION !== CONFIRMATION) {
    throw new Error("topic_refinement_flight_postgres_proof_disabled");
  }
  const { receipt, container } = await verifyFixedSignalTopicEvaluationLabHostReceiptV1();
  const pool = createSignalTopicEvaluationLabDockerWritePoolV2(receipt);
  const before = (await pool.query<{ migration_0119: number; flights: number; terminals: number;
    candidates: number; provider_calls: number; candidate: Candidate | null }>(`SELECT
      (SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger
        WHERE ordinal=119 AND migration_name='0119_signal_topic_evaluation_v2_candidate_refinement_flight.sql'
          AND disposition='applied') migration_0119,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_refinement_flights) flights,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_refinement_flight_terminal_receipts) terminals,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates) candidates,
      (SELECT COALESCE(sum(provider_call_count),0)::int FROM signal_topic_evaluation_v2_runs) provider_calls,
      (SELECT json_build_object(
        'workspace_id',candidate.workspace_id::text,'actor_id',snapshot.created_by_user_id::text,
        'run_key',run.run_key,'candidate_key',candidate.candidate_key,
        'candidate_revision',COALESCE(editorial.revision,1)::int,
        'state_token',signal_topic_evaluation_v2_candidate_state_token_v1(candidate.id,
          COALESCE(editorial.revision,1),COALESCE(editorial.version_digest,base.payload_digest))
      ) FROM signal_topic_evaluation_v2_candidates candidate
        JOIN signal_topic_evaluation_v2_runs run ON run.id=candidate.run_id
        JOIN signal_topic_evaluation_v2_snapshots snapshot ON snapshot.id=run.snapshot_id
        JOIN signal_topic_evaluation_v2_candidate_revisions base ON base.candidate_id=candidate.id
          AND base.revision=1
        LEFT JOIN LATERAL(SELECT revision.*
          FROM signal_topic_evaluation_v2_candidate_editorial_revisions revision
          WHERE revision.candidate_id=candidate.id ORDER BY revision.revision DESC LIMIT 1) editorial ON true
        WHERE run.run_key='${SYNTHETIC_RUN_KEY}' AND candidate.status='pending'
          AND NOT candidate.adopted AND NOT candidate.published AND NOT candidate.serving
        LIMIT 1) candidate`)).rows[0];
  if (!before || before.migration_0119 !== 1 || before.flights !== 0 || before.terminals !== 0
      || before.candidates !== 1 || before.provider_calls !== 0 || !before.candidate
      || before.candidate.run_key !== SYNTHETIC_RUN_KEY) {
    throw new Error("topic_refinement_flight_postgres_proof_not_pristine");
  }
  const candidate = before.candidate;
  const idSuffix = signalTopicEvaluationDigestV2({ clone: receipt.clone_name,
    candidate_key: candidate.candidate_key, migration: 119 }).slice(7, 23);
  const actor = { id: candidate.actor_id, user_type: "noisia_internal" as const };
  let session;
  try {
    session = await createSignalTopicCandidateRefinementSessionV1({
      pool, workspace_id: candidate.workspace_id, actor,
      idempotency_key: `lab2h.flight.session.${idSuffix}`,
      input: { run_key: candidate.run_key, candidate_key: candidate.candidate_key,
        expected_revision: candidate.candidate_revision, state_token: candidate.state_token }
    });
  } catch (error) {
    const cause = error instanceof Error ? error.message : "unknown";
    throw new Error(`topic_refinement_flight_postgres_proof_session_failed:${cause}`);
  }
  let flight;
  try {
    flight = await createSignalTopicCandidateRefinementFlightV1({
      pool, workspace_id: candidate.workspace_id, actor, session_key: session.session_key,
      idempotency_key: `lab2h.flight.authority.${idSuffix}`,
      confirmation: "AUTHORIZE_LOCAL_DISPOSABLE_TOPIC_CANDIDATE_REFINEMENT",
      provenance: {
        source_clone_receipt_digest: receipt.receipt_digest,
        source_container_identity_digest: signalTopicEvaluationDigestV2({ container_id: container.container_id,
          image_id: container.image_id }),
        migration_0116_checksum: MIGRATION_0116,
        migration_0117_checksum: MIGRATION_0117,
        migration_0118_checksum: MIGRATION_0118
      }
    });
  } catch (error) {
    const cause = error instanceof Error ? error.message : "unknown";
    throw new Error(`topic_refinement_flight_postgres_proof_authority_failed:${cause}`);
  }
  let terminal;
  try {
    terminal = await appendSignalTopicCandidateRefinementTerminalReceiptV1({
      pool, workspace_id: candidate.workspace_id, flight_key: flight.flight_key,
      terminal_status: "definitely_not_sent", provider_call_count: 0,
      input_tokens: 0, output_tokens: 0, settled_micro_usd: 0,
      provider_request_digest: null, error_code: "topic_refinement_preflight_proof"
    });
  } catch (error) {
    const cause = error instanceof Error ? error.message : "unknown";
    throw new Error(`topic_refinement_flight_postgres_proof_terminal_failed:${cause}`);
  }
  const after = (await pool.query<{ flights: number; terminals: number; provider_calls: number;
    candidate_status: string; adopted: boolean; published: boolean; serving: boolean; reserved: number;
    settled: number; authority_digest: string; terminal_digest: string }>(`SELECT
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_refinement_flights) flights,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_refinement_flight_terminal_receipts) terminals,
      (SELECT COALESCE(sum(provider_call_count),0)::int FROM signal_topic_evaluation_v2_runs) provider_calls,
      candidate.status candidate_status,candidate.adopted,candidate.published,candidate.serving,
      flight.reserved_micro_usd reserved,terminal.settled_micro_usd settled,
      flight.flight_authority_digest authority_digest,terminal.terminal_digest terminal_digest
    FROM signal_topic_evaluation_v2_candidate_refinement_flights flight
      JOIN signal_topic_evaluation_v2_candidate_refinement_flight_terminal_receipts terminal
        ON terminal.flight_id=flight.id
      JOIN signal_topic_evaluation_v2_candidates candidate ON candidate.id=flight.candidate_id
    WHERE flight.workspace_id=$1::uuid AND flight.flight_key=$2`,
  [candidate.workspace_id, flight.flight_key])).rows[0];
  if (!after || after.flights !== 1 || after.terminals !== 1 || after.provider_calls !== 0
      || after.candidate_status !== "pending" || after.adopted || after.published || after.serving
      || after.reserved !== 1_000_000 || after.settled !== 0
      || after.authority_digest === "sha256:" + "0".repeat(64)
      || after.terminal_digest === "sha256:" + "0".repeat(64)
      || terminal.terminal_digest !== after.terminal_digest) {
    throw new Error("topic_refinement_flight_postgres_proof_verify_failed");
  }
  const evidence = {
    contract_version: "signal-topic-candidate-refinement-flight-postgres-proof-v1",
    recorded_at: new Date().toISOString(),
    target: { clone_name: receipt.clone_name, host_anchor_receipt_digest: receipt.receipt_digest,
      container_identity_digest: signalTopicEvaluationDigestV2({ container_id: container.container_id,
        image_id: container.image_id }) },
    flight: { flight_key: flight.flight_key, session_key: session.session_key,
      candidate_key: candidate.candidate_key, reserved_micro_usd: 1_000_000,
      authority_digest: after.authority_digest, terminal_digest: after.terminal_digest,
      terminal_status: terminal.terminal_status, settled_micro_usd: after.settled },
    effects: { provider_calls: 0, uat_connections: 0, production_accessed: false,
      candidate_adoption: 0, topic_publication: 0, serving: 0 }
  };
  const directory = resolve(ROOT, ".data/signal-topic-evaluation/lab-2h", receipt.clone_name);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, "flight-0119-postgres-proof.sanitized.json");
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return { evidence, path, receipt_digest: signalTopicEvaluationDigestV2(evidence) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  proveSignalTopicCandidateRefinementFlightLocalV1(process.env).then(({ evidence, path, receipt_digest }) => {
    process.stdout.write(`${JSON.stringify({ status: "pass", flight: evidence.flight,
      receipt_path: path, receipt_digest, effects: evidence.effects })}\n`);
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "topic_refinement_flight_postgres_proof_failed"}\n`);
    process.exitCode = 1;
  });
}
