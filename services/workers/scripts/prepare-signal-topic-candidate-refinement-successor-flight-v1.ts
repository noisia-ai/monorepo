/**
 * Seals one provider-disabled, proposal-only refinement flight on a freshly cloned LAB-2G result.
 *
 * This does not read a credential, construct a provider, claim the flight, retrieve evidence, or
 * change a candidate. It creates the two append-only authorities that a later audited launcher
 * must use. A deterministic idempotency digest makes a safe local recovery replay the same rows.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createSignalTopicCandidateRefinementFlightV1,
  createSignalTopicCandidateRefinementSessionV1,
  SIGNAL_TOPIC_REFINEMENT_FLIGHT_CONFIRMATION,
  SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY
} from "@noisia/db";
import { signalTopicEvaluationDigestV2 } from "@noisia/query-engine";

import { createSignalTopicEvaluationLabDockerWritePoolV2 } from
  "./signal-topic-evaluation-lab-docker-write-pool-v2";
import { verifyFixedSignalTopicCandidateRefinementSuccessorHostReceiptV1 } from
  "./signal-topic-candidate-refinement-successor-host-provenance-v1";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const CONFIRMATION = "PREPARE_ONE_LOCAL_DISPOSABLE_TOPIC_CANDIDATE_REFINEMENT_FLIGHT";
const SOURCE_RUN_KEY = "backend-10c2c-2026-08-21-final-2-bertopic-bge-detail-seed-17";
const EVALUATION_RUN_KEY = "topic-v2-lab-run-ee9dcedca1342d414d6646fd";

type Queryable = { query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{
  rows: T[]; rowCount: number | null }> };
type HostProof = Awaited<ReturnType<typeof verifyFixedSignalTopicCandidateRefinementSuccessorHostReceiptV1>>;

type CandidateAuthority = {
  workspace_id: string;
  actor_user_id: string;
  candidate_key: string;
  expected_revision: number;
  state_token: string;
  run_key: string;
};

type PreparationProof = {
  database_name: string;
  source_run_key: string;
  output_digest: string;
  run_count: number;
  authorizations: number;
  model_turns: number;
  retrievals: number;
  retrieval_evidence: number;
  candidates: number;
  candidate_revisions: number;
  candidate_evidence: number;
  rankings: number;
  provider_calls: number;
  candidate_editorial_revisions: number;
  proposals: number;
  adoption: number;
  publication: number;
  serving: number;
  sessions: number;
  flights: number;
  claims: number;
  terminals: number;
  migration_0116: number;
  migration_0117: number;
  migration_0118: number;
  migration_0119: number;
  migration_0120: number;
  migration_0121: number;
  host_anchor_count: number;
};

type MigrationLedgerRow = { ordinal: number; migration_name: string; checksum_sha256: string };

export class SignalTopicCandidateRefinementFlightPreparationError extends Error {
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

function preparationProofSql(receipt: HostProof["receipt"], containerIdentityDigest: string) {
  return `SELECT json_build_object(
    'database_name',current_database(),
    'source_run_key',(SELECT source_run_key FROM signal_topic_evaluation_v2_snapshots WHERE state='frozen' LIMIT 1),
    'output_digest',${OUTPUT_DIGEST_SQL},
    'run_count',(SELECT count(*)::int FROM signal_topic_evaluation_v2_runs WHERE run_key='${EVALUATION_RUN_KEY}' AND status='completed'),
    'authorizations',(SELECT count(*)::int FROM signal_topic_evaluation_v2_execution_authorizations),
    'model_turns',(SELECT count(*)::int FROM signal_topic_evaluation_v2_model_turns),
    'retrievals',(SELECT count(*)::int FROM signal_topic_evaluation_v2_retrievals),
    'retrieval_evidence',(SELECT count(*)::int FROM signal_topic_evaluation_v2_retrieval_evidence),
    'candidates',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE status='pending' AND NOT adopted AND NOT published AND NOT serving),
    'candidate_revisions',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_revisions),
    'candidate_evidence',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_evidence),
    'rankings',(SELECT count(*)::int FROM signal_topic_evaluation_v2_rankings),
    'provider_calls',(SELECT COALESCE(sum(provider_call_count),0)::int FROM signal_topic_evaluation_v2_runs),
    'candidate_editorial_revisions',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_editorial_revisions),
    'proposals',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_refinement_proposals),
    'adoption',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE adopted),
    'publication',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE published),
    'serving',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE serving),
    'sessions',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_refinement_sessions),
    'flights',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_refinement_flights),
    'claims',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_refinement_flight_dispatch_claims),
    'terminals',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_refinement_flight_terminal_receipts),
    'migration_0116',(SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=116 AND disposition='applied'),
    'migration_0117',(SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=117 AND disposition='applied'),
    'migration_0118',(SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=118 AND disposition='applied'),
    'migration_0119',(SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=119 AND disposition='applied'),
    'migration_0120',(SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=120 AND disposition='applied'),
    'migration_0121',(SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=121 AND disposition='applied'),
    'host_anchor_count',(SELECT count(*)::int FROM noisia_topic_evaluation_lab.host_receipt_anchor anchor
      WHERE anchor.marker_id AND anchor.clone_name=current_database()
        AND anchor.host_receipt_digest='${receipt.receipt_digest}'
        AND anchor.container_identity_digest='${containerIdentityDigest}')
  )::text AS payload`;
}

const CANDIDATE_SQL = `SELECT json_build_object(
  'workspace_id',candidate.workspace_id::text,
  'actor_user_id',run.requested_by_user_id::text,
  'candidate_key',candidate.candidate_key,
  'expected_revision',COALESCE(editorial.revision,1)::int,
  'state_token',signal_topic_evaluation_v2_candidate_state_token_v1(candidate.id,COALESCE(editorial.revision,1),COALESCE(editorial.version_digest,base.payload_digest)),
  'run_key',run.run_key
)::text AS payload
FROM signal_topic_evaluation_v2_candidates candidate
JOIN signal_topic_evaluation_v2_runs run ON run.id=candidate.run_id AND run.status='completed'
JOIN signal_topic_evaluation_v2_candidate_revisions base ON base.candidate_id=candidate.id AND base.revision=1
LEFT JOIN LATERAL(SELECT revision.* FROM signal_topic_evaluation_v2_candidate_editorial_revisions revision
  WHERE revision.candidate_id=candidate.id ORDER BY revision.revision DESC LIMIT 1) editorial ON true
WHERE candidate.status='pending' AND NOT candidate.adopted AND NOT candidate.published AND NOT candidate.serving
  AND run.run_key='${EVALUATION_RUN_KEY}'
ORDER BY candidate.candidate_key LIMIT 1`;

async function queryPayload<T>(pool: Queryable, sql: string): Promise<T> {
  const row = (await pool.query<{ payload: string }>(sql)).rows[0];
  if (!row || typeof row.payload !== "string") {
    throw new SignalTopicCandidateRefinementFlightPreparationError("topic_refinement_flight_preparation_database_proof_invalid");
  }
  try { return JSON.parse(row.payload) as T; }
  catch { throw new SignalTopicCandidateRefinementFlightPreparationError("topic_refinement_flight_preparation_database_proof_invalid"); }
}

function isPristine(proof: PreparationProof, receipt: HostProof["receipt"]) {
  return proof.database_name === receipt.clone_name && proof.source_run_key === SOURCE_RUN_KEY
    && proof.output_digest === receipt.parent_output_digest && proof.run_count === 1 && proof.authorizations === 1
    && proof.model_turns === 12 && proof.retrievals === 11 && proof.retrieval_evidence === 30
    && proof.candidates === 10 && proof.candidate_revisions === 10 && proof.candidate_evidence === 30
    && proof.rankings === 10 && proof.provider_calls === 12 && proof.candidate_editorial_revisions === 0
    && proof.proposals === 0 && proof.adoption === 0 && proof.publication === 0 && proof.serving === 0
    && proof.sessions === 0 && proof.flights === 0 && proof.claims === 0 && proof.terminals === 0
    && proof.migration_0116 === 1 && proof.migration_0117 === 1 && proof.migration_0118 === 1
    && proof.migration_0119 === 1 && proof.migration_0120 === 1 && proof.migration_0121 === 1
    && proof.host_anchor_count === 1;
}

async function migrationChecksum(ordinal: number, name: string) {
  const bytes = await readFile(resolve(ROOT, "infrastructure/db/migrations", name));
  return { ordinal, name, checksum_sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
}

async function exactMigrationLedger(pool: Queryable, expected: readonly {
  ordinal: number; name: string; checksum_sha256: string
}[]) {
  const ledger = await queryPayload<MigrationLedgerRow[]>(pool, `SELECT COALESCE(json_agg(json_build_object(
    'ordinal',ordinal,'migration_name',migration_name,'checksum_sha256',checksum_sha256
  ) ORDER BY ordinal), '[]'::json)::text AS payload
  FROM signal_workspace_data_plane_migration_ledger
  WHERE ordinal BETWEEN 116 AND 121 AND disposition='applied'`);
  if (ledger.length !== expected.length || ledger.some((entry, index) => entry.ordinal !== expected[index]?.ordinal
      || entry.migration_name !== expected[index]?.name
      || entry.checksum_sha256 !== expected[index]?.checksum_sha256)) {
    throw new SignalTopicCandidateRefinementFlightPreparationError("topic_refinement_flight_preparation_migration_ledger_mismatch");
  }
  return ledger;
}

function deterministicIdempotency(receipt: HostProof["receipt"], candidate: CandidateAuthority) {
  const digest = signalTopicEvaluationDigestV2({ contract: "signal-topic-candidate-refinement-flight-card-v1",
    host_receipt_digest: receipt.receipt_digest, parent_output_digest: receipt.parent_output_digest,
    candidate_key: candidate.candidate_key, candidate_revision: candidate.expected_revision,
    candidate_state_token: candidate.state_token });
  return {
    digest,
    session_idempotency_key: `topic-refine-session-${digest.slice(7, 23)}`,
    flight_idempotency_key: `topic-refine-flight-${digest.slice(23, 39)}`
  };
}

async function writeCard(path: string, card: Record<string, unknown>) {
  await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 });
  const encoded = `${JSON.stringify(card, null, 2)}\n`;
  try { await writeFile(path, encoded, { mode: 0o600, flag: "wx" }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readFile(path, "utf8");
    if (existing !== encoded) throw new SignalTopicCandidateRefinementFlightPreparationError(
      "topic_refinement_flight_card_conflict");
  }
}

export async function prepareSignalTopicCandidateRefinementSuccessorFlightV1(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: {
    verifyHostReceipt?: typeof verifyFixedSignalTopicCandidateRefinementSuccessorHostReceiptV1;
    createPool?: typeof createSignalTopicEvaluationLabDockerWritePoolV2;
  } = {}
) {
  if (environment.NOISIA_RUNTIME_PROFILE !== "local_disposable_lab_v1"
      || environment.NOISIA_TOPIC_REFINEMENT_FLIGHT_PREPARATION_ENABLED !== "true"
      || environment.NOISIA_TOPIC_REFINEMENT_FLIGHT_PREPARATION_CONFIRMATION !== CONFIRMATION) {
    throw new SignalTopicCandidateRefinementFlightPreparationError("topic_refinement_flight_preparation_disabled");
  }
  // The orchestrator reconciles earlier experiments across preserved clones. Never carry a
  // historical literal balance into a new card; validate the current balance before any write.
  const remainingValue = environment.NOISIA_TOPIC_REFINEMENT_AGGREGATE_REMAINING_MICRO_USD ?? "";
  const aggregateRemainingMicroUsd = Number(remainingValue);
  if (!/^[0-9]+$/u.test(remainingValue) || !Number.isSafeInteger(aggregateRemainingMicroUsd)
      || aggregateRemainingMicroUsd < SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.hard_cap_micro_usd
      || aggregateRemainingMicroUsd > SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.aggregate_budget_cap_micro_usd) {
    throw new SignalTopicCandidateRefinementFlightPreparationError("topic_refinement_flight_preparation_budget_invalid");
  }
  // Intentionally before any write authority and before any Keychain/provider composition.
  const { receipt, container } = await (dependencies.verifyHostReceipt
    ?? verifyFixedSignalTopicCandidateRefinementSuccessorHostReceiptV1)();
  const containerIdentityDigest = signalTopicEvaluationDigestV2({
    container_id: container.container_id, image_id: container.image_id
  });
  const pool = (dependencies.createPool ?? createSignalTopicEvaluationLabDockerWritePoolV2)(receipt);
  const before = await queryPayload<PreparationProof>(pool, preparationProofSql(receipt, containerIdentityDigest));
  if (!isPristine(before, receipt)) {
    throw new SignalTopicCandidateRefinementFlightPreparationError("topic_refinement_flight_preparation_not_pristine");
  }
  const candidate = await queryPayload<CandidateAuthority>(pool, CANDIDATE_SQL);
  if (candidate.run_key !== EVALUATION_RUN_KEY || !candidate.workspace_id || !candidate.actor_user_id
      || !candidate.candidate_key || candidate.expected_revision !== 1
      || !/^sha256:[0-9a-f]{64}$/u.test(candidate.state_token)) {
    throw new SignalTopicCandidateRefinementFlightPreparationError("topic_refinement_flight_preparation_candidate_invalid");
  }
  const migrations = await Promise.all([
    migrationChecksum(116, "0116_signal_topic_evaluation_disposable_lab_execution.sql"),
    migrationChecksum(117, "0117_signal_topic_evaluation_lab_evaluation_brief.sql"),
    migrationChecksum(118, "0118_signal_topic_evaluation_v2_candidate_refinement.sql"),
    migrationChecksum(119, "0119_signal_topic_evaluation_v2_candidate_refinement_flight.sql"),
    migrationChecksum(120, "0120_signal_topic_evaluation_v2_candidate_refinement_flight_execution_seal.sql"),
    migrationChecksum(121, "0121_signal_topic_evaluation_v2_candidate_refinement_flight_provenance_anchor.sql")
  ]);
  await exactMigrationLedger(pool, migrations);
  const idempotency = deterministicIdempotency(receipt, candidate);
  const actor = { id: candidate.actor_user_id, user_type: "noisia_internal" as const };
  const session = await createSignalTopicCandidateRefinementSessionV1({ pool, workspace_id: candidate.workspace_id,
    actor, idempotency_key: idempotency.session_idempotency_key, input: { run_key: candidate.run_key,
      candidate_key: candidate.candidate_key, expected_revision: candidate.expected_revision,
      state_token: candidate.state_token } });
  const flight = await createSignalTopicCandidateRefinementFlightV1({ pool, workspace_id: candidate.workspace_id,
    actor, session_key: session.session_key, idempotency_key: idempotency.flight_idempotency_key,
    confirmation: SIGNAL_TOPIC_REFINEMENT_FLIGHT_CONFIRMATION, provenance: {
      source_clone_receipt_digest: receipt.receipt_digest,
      source_container_identity_digest: containerIdentityDigest,
      migration_0116_checksum: migrations[0].checksum_sha256,
      migration_0117_checksum: migrations[1].checksum_sha256,
      migration_0118_checksum: migrations[2].checksum_sha256
    } });
  const after = await queryPayload<PreparationProof>(pool, preparationProofSql(receipt, containerIdentityDigest));
  if (!isPristine({ ...after, sessions: 0, flights: 0 }, receipt)
      || after.sessions !== 1 || after.flights !== 1 || after.claims !== 0 || after.terminals !== 0) {
    throw new SignalTopicCandidateRefinementFlightPreparationError("topic_refinement_flight_preparation_reconciliation_failed");
  }
  await exactMigrationLedger(pool, migrations);
  const card = {
    contract_version: "signal-topic-candidate-refinement-flight-card-v1",
    // A deterministic card is required for idempotent local recovery. The receipt is the immutable
    // target-time anchor; the database holds the actual session/flight creation timestamps.
    host_receipt_created_at: receipt.created_at,
    flight, session: { session_key: session.session_key, candidate_key: session.candidate_key,
      candidate_revision: session.candidate_revision, expires_at: session.expires_at },
    target: { clone_name: receipt.clone_name, host_receipt_digest: receipt.receipt_digest,
      parent_output_digest: receipt.parent_output_digest, container_identity_digest: containerIdentityDigest },
    candidate: { candidate_key: candidate.candidate_key, expected_revision: candidate.expected_revision,
      state_token: candidate.state_token, run_key: candidate.run_key },
    budget: { hard_cap_micro_usd: SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.hard_cap_micro_usd,
      hard_cap_usd: "1.00", max_model_turns: SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.max_model_turns,
      max_navigation_calls: SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.max_navigation_calls,
      aggregate_remaining_micro_usd_before_flight: aggregateRemainingMicroUsd },
    migrations,
    provider: { credential_read: false, calls_before_dispatch: 0, execution_claims: after.claims,
      terminal_receipts: after.terminals, retry_automatic: false },
    effects: { candidate_edits: 0, topic_adoption: false, publication: false, serving: false,
      uat_connections: 0, production_accessed: false }
  };
  const path = resolve(ROOT, ".data/signal-topic-evaluation/lab-2h", receipt.clone_name,
    "refinement-flight-card.sanitized.json");
  await writeCard(path, card);
  return { card, path, card_digest: signalTopicEvaluationDigestV2(card) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareSignalTopicCandidateRefinementSuccessorFlightV1().then(({ card, path, card_digest }) => {
    process.stdout.write(`${JSON.stringify({ status: "prepared_provider_disabled", flight: card.flight,
      candidate: card.candidate, budget: card.budget, receipt_path: path, card_digest,
      effects: card.effects })}\n`);
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "topic_refinement_flight_preparation_failed"}\n`);
    process.exitCode = 1;
  });
}

export const signalTopicCandidateRefinementFlightPreparationTestOnly = { CONFIRMATION, isPristine, exactMigrationLedger };
