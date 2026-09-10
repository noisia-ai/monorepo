import { randomUUID } from "node:crypto";

import { signalTopicEvaluationDigestV2 } from "@noisia/query-engine";

import { SignalTopicEvaluationV2Error, type SignalTopicEvaluationActorV2 } from
  "./signal-topic-evaluation-v2";

export const SIGNAL_TOPIC_REFINEMENT_FLIGHT_CONFIRMATION =
  "AUTHORIZE_LOCAL_DISPOSABLE_TOPIC_CANDIDATE_REFINEMENT" as const;
export const SIGNAL_TOPIC_REFINEMENT_FLIGHT_CONFIRMATION_DIGEST =
  "sha256:c9ed8bdf211a2d62edcfd2e02a39a1af9e223058106021f7c7ec0e5efc7e59ad" as const;
export const SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY = Object.freeze({
  source_run_key: "backend-10c2c-2026-08-21-final-2-bertopic-bge-detail-seed-17",
  pricing_version: "anthropic-sonnet-5-topic-refinement-2026-09-05",
  model: "claude-sonnet-5",
  input_micro_usd_per_token: 3,
  output_micro_usd_per_token: 15,
  max_model_turns: 12,
  max_navigation_calls: 12,
  max_input_tokens: 240_000,
  max_output_tokens: 12_000,
  max_input_tokens_per_turn: 24_000,
  max_output_tokens_per_turn: 1_000,
  hard_cap_micro_usd: 1_000_000,
  aggregate_budget_scope: "topic-refinement-local-aggregate-v1",
  aggregate_budget_cap_micro_usd: 18_807_816
} as const);

type Queryable = { query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{
  rows: T[]; rowCount: number | null }> };
type TransactionClient = Queryable & { release(): void };

type FlightSessionRow = {
  id: string;
  workspace_id: string;
  run_id: string;
  snapshot_id: string;
  candidate_id: string;
  candidate_key: string;
  candidate_revision: number;
  candidate_state_token: string;
  candidate_version_digest: string;
  brand_os_authority_digest: string;
  snapshot_digest: string;
};

export type SignalTopicCandidateRefinementFlightProvenanceV1 = {
  source_clone_receipt_digest: string;
  source_container_identity_digest: string;
  migration_0116_checksum: string;
  migration_0117_checksum: string;
  migration_0118_checksum: string;
};

export type SignalTopicCandidateRefinementFlightV1 = {
  contract_version: "signal-topic-candidate-refinement-flight-v1";
  flight_key: string;
  session_key: string;
  candidate_key: string;
  reserved_micro_usd: typeof SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.hard_cap_micro_usd;
  max_model_turns: typeof SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.max_model_turns;
  max_navigation_calls: typeof SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.max_navigation_calls;
  topic_adoption: false;
  publication: false;
  serving: false;
};

/**
 * A claim is the durable, one-way boundary immediately before a provider edge.  A runner never
 * trusts a caller-provided flight object: it claims the persisted authority and uses the returned
 * projection for every subsequent navigation, proposal and terminal receipt.
 */
export async function claimSignalTopicCandidateRefinementFlightExecutionV1(args: {
  pool: { connect(): Promise<TransactionClient> };
  workspace_id: string;
  actor: SignalTopicEvaluationActorV2;
  flight_key: string;
}): Promise<SignalTopicCandidateRefinementFlightV1> {
  assertActor(args.actor);
  if (!/^topic-refinement-flight-[a-f0-9]{16}$/u.test(args.flight_key)) {
    throw new SignalTopicEvaluationV2Error("topic_refinement_flight_input_invalid", 422);
  }
  const client = await args.pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const flight = (await client.query<{ flight_key: string; session_key: string; candidate_key: string }>(`SELECT
      flight.flight_key,session.session_key,candidate.candidate_key
      FROM signal_topic_evaluation_v2_candidate_refinement_flights flight
      JOIN signal_topic_evaluation_v2_candidate_refinement_sessions session ON session.id=flight.session_id
      JOIN signal_topic_evaluation_v2_candidates candidate ON candidate.id=flight.candidate_id
      WHERE flight.workspace_id=$1::uuid AND flight.flight_key=$2 AND flight.actor_user_id=$3::uuid`,
    [args.workspace_id, args.flight_key, args.actor.id])).rows[0];
    if (!flight) throw new SignalTopicEvaluationV2Error("topic_refinement_flight_not_found", 404);
    const inserted = (await client.query<{ id: string }>(`INSERT INTO
      signal_topic_evaluation_v2_candidate_refinement_flight_dispatch_claims(
        id,flight_id,actor_user_id,claim_key
      ) SELECT $1::uuid,flight.id,$2::uuid,$3
      FROM signal_topic_evaluation_v2_candidate_refinement_flights flight
      WHERE flight.workspace_id=$4::uuid AND flight.flight_key=$5
      RETURNING id`, [randomUUID(), args.actor.id, `topic-refinement-claim-${randomUUID()}`,
      args.workspace_id, args.flight_key])).rows[0];
    if (!inserted) throw new SignalTopicEvaluationV2Error("topic_refinement_flight_claim_failed", 500);
    await client.query("COMMIT");
    return projectFlight(flight.flight_key, flight.session_key, flight.candidate_key);
  } catch (error) {
    await rollbackSafely(client);
    throw mapFlightError(error);
  } finally { client.release(); }
}

export type SignalTopicCandidateRefinementTerminalStatusV1 =
  "completed" | "definitely_not_sent" | "provider_response_invalid" | "outcome_unknown";

export async function createSignalTopicCandidateRefinementFlightV1(args: {
  pool: { connect(): Promise<TransactionClient> };
  workspace_id: string;
  actor: SignalTopicEvaluationActorV2;
  session_key: string;
  idempotency_key: string;
  confirmation: string;
  provenance: SignalTopicCandidateRefinementFlightProvenanceV1;
}): Promise<SignalTopicCandidateRefinementFlightV1> {
  assertActor(args.actor);
  assertInput(args);
  if (args.confirmation !== SIGNAL_TOPIC_REFINEMENT_FLIGHT_CONFIRMATION) {
    throw new SignalTopicEvaluationV2Error("topic_refinement_confirmation_required", 422);
  }
  const client = await args.pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const existing = (await client.query<{ flight_key: string; session_key: string; candidate_key: string;
      idempotency_key: string }>(`SELECT flight.flight_key,session.session_key,candidate.candidate_key,
        flight.idempotency_key
      FROM signal_topic_evaluation_v2_candidate_refinement_flights flight
      JOIN signal_topic_evaluation_v2_candidate_refinement_sessions session ON session.id=flight.session_id
      JOIN signal_topic_evaluation_v2_candidates candidate ON candidate.id=flight.candidate_id
      WHERE flight.workspace_id=$1::uuid AND flight.idempotency_key=$2`,
    [args.workspace_id, args.idempotency_key])).rows[0];
    if (existing) {
      if (existing.session_key !== args.session_key) {
        throw new SignalTopicEvaluationV2Error("topic_refinement_idempotency_conflict", 409);
      }
      await client.query("COMMIT");
      return projectFlight(existing.flight_key, existing.session_key, existing.candidate_key);
    }
    const session = (await client.query<FlightSessionRow>(`${flightSessionSql()}
      WHERE session.workspace_id=$1::uuid AND session.session_key=$2 AND session.actor_user_id=$3::uuid`,
    [args.workspace_id, args.session_key, args.actor.id])).rows[0];
    if (!session) throw new SignalTopicEvaluationV2Error("topic_refinement_session_not_found", 404);
    const flightKey = `topic-refinement-flight-${signalTopicEvaluationDigestV2({
      session_key: args.session_key, idempotency_key: args.idempotency_key,
      source_clone_receipt_digest: args.provenance.source_clone_receipt_digest
    }).slice(7, 23)}`;
    const inserted = (await client.query<{ flight_authority_digest: string }>(`INSERT INTO signal_topic_evaluation_v2_candidate_refinement_flights(
      id,session_id,workspace_id,run_id,snapshot_id,candidate_id,actor_user_id,idempotency_key,flight_key,
      confirmation_digest,source_run_key,source_clone_receipt_digest,source_container_identity_digest,
      source_snapshot_digest,source_brand_os_authority_digest,migration_0116_checksum,
      migration_0117_checksum,migration_0118_checksum,pricing_version,model,input_micro_usd_per_token,
      output_micro_usd_per_token,max_model_turns,max_navigation_calls,max_input_tokens,max_output_tokens,
      max_input_tokens_per_turn,max_output_tokens_per_turn,hard_cap_micro_usd,reserved_micro_usd,
      aggregate_budget_scope,aggregate_budget_cap_micro_usd,flight_authority_digest
    ) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8,$9,$10,$11,$12,$13,$14,
      $15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)
      RETURNING flight_authority_digest`, [
      randomUUID(), session.id, args.workspace_id, session.run_id, session.snapshot_id, session.candidate_id,
      args.actor.id, args.idempotency_key, flightKey, SIGNAL_TOPIC_REFINEMENT_FLIGHT_CONFIRMATION_DIGEST,
      SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.source_run_key, args.provenance.source_clone_receipt_digest,
      args.provenance.source_container_identity_digest, session.snapshot_digest, session.brand_os_authority_digest,
      args.provenance.migration_0116_checksum, args.provenance.migration_0117_checksum,
      args.provenance.migration_0118_checksum, SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.pricing_version,
      SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.model, SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.input_micro_usd_per_token,
      SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.output_micro_usd_per_token,
      SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.max_model_turns,
      SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.max_navigation_calls,
      SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.max_input_tokens,
      SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.max_output_tokens,
      SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.max_input_tokens_per_turn,
      SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.max_output_tokens_per_turn,
      SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.hard_cap_micro_usd,
      SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.hard_cap_micro_usd,
      SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.aggregate_budget_scope,
      SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.aggregate_budget_cap_micro_usd, emptyDigest()
    ])).rows[0];
    if (!inserted) throw new SignalTopicEvaluationV2Error("topic_refinement_flight_write_failed", 500);
    await client.query("COMMIT");
    return projectFlight(flightKey, args.session_key, session.candidate_key);
  } catch (error) {
    await rollbackSafely(client);
    throw mapFlightError(error);
  } finally { client.release(); }
}

/** A terminal receipt is a new immutable fact. It never changes a candidate or a Topic. */
export async function appendSignalTopicCandidateRefinementTerminalReceiptV1(args: {
  pool: { connect(): Promise<TransactionClient> };
  workspace_id: string;
  flight_key: string;
  terminal_status: SignalTopicCandidateRefinementTerminalStatusV1;
  provider_call_count: number;
  input_tokens: number | null;
  output_tokens: number | null;
  settled_micro_usd: number | null;
  provider_request_digest: string | null;
  error_code: string | null;
}) {
  assertTerminalInput(args);
  const client = await args.pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const flight = (await client.query<{ id: string }>(`SELECT flight.id FROM
      signal_topic_evaluation_v2_candidate_refinement_flights flight
      JOIN signal_topic_evaluation_v2_candidate_refinement_flight_dispatch_claims claim
        ON claim.flight_id=flight.id
      WHERE flight.workspace_id=$1::uuid AND flight.flight_key=$2`,
    [args.workspace_id, args.flight_key])).rows[0];
    if (!flight) throw new SignalTopicEvaluationV2Error("topic_refinement_flight_not_found", 404);
    const terminal = (await client.query<{ terminal_digest: string }>(`INSERT INTO signal_topic_evaluation_v2_candidate_refinement_flight_terminal_receipts(
      id,flight_id,terminal_status,provider_call_count,input_tokens,output_tokens,settled_micro_usd,
      provider_request_digest,error_code,terminal_digest
    ) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING terminal_digest`, [randomUUID(), flight.id,
      args.terminal_status, args.provider_call_count, args.input_tokens, args.output_tokens,
      args.settled_micro_usd, args.provider_request_digest, args.error_code, emptyDigest()
    ])).rows[0];
    if (!terminal) throw new SignalTopicEvaluationV2Error("topic_refinement_terminal_write_failed", 500);
    await client.query("COMMIT");
    return { terminal_status: args.terminal_status, terminal_digest: terminal.terminal_digest,
      topic_adoption: false as const, publication: false as const, serving: false as const };
  } catch (error) {
    await rollbackSafely(client);
    throw mapFlightError(error);
  } finally { client.release(); }
}

function flightSessionSql() {
  return `SELECT session.id::text,session.workspace_id::text,session.run_id::text,session.snapshot_id::text,
    session.candidate_id::text,candidate.candidate_key,session.candidate_revision,
    session.candidate_state_token,session.candidate_version_digest,session.brand_os_authority_digest,
    snapshot.snapshot_digest
    FROM signal_topic_evaluation_v2_candidate_refinement_sessions session
    JOIN signal_topic_evaluation_v2_candidates candidate ON candidate.id=session.candidate_id
    JOIN signal_topic_evaluation_v2_snapshots snapshot ON snapshot.id=session.snapshot_id`;
}

function emptyDigest() { return "sha256:" + "0".repeat(64); }

function projectFlight(flight_key: string, session_key: string, candidate_key: string): SignalTopicCandidateRefinementFlightV1 {
  return { contract_version: "signal-topic-candidate-refinement-flight-v1", flight_key, session_key,
    candidate_key, reserved_micro_usd: SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.hard_cap_micro_usd,
    max_model_turns: SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.max_model_turns,
    max_navigation_calls: SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.max_navigation_calls,
    topic_adoption: false, publication: false, serving: false };
}

function assertActor(actor: SignalTopicEvaluationActorV2) {
  if (actor.user_type !== "noisia_internal" || !actor.id) {
    throw new SignalTopicEvaluationV2Error("topic_refinement_forbidden", 403);
  }
}

function assertInput(args: { session_key: string; idempotency_key: string;
  provenance: SignalTopicCandidateRefinementFlightProvenanceV1 }) {
  if (!/^topic-refine-[a-f0-9]{16}$/u.test(args.session_key)
      || !/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key)
      || Object.values(args.provenance).some((value) => !/^sha256:[0-9a-f]{64}$/u.test(value))) {
    throw new SignalTopicEvaluationV2Error("topic_refinement_flight_input_invalid", 422);
  }
}

function assertTerminalInput(args: { flight_key: string; terminal_status: string; provider_call_count: number;
  input_tokens: number | null; output_tokens: number | null; settled_micro_usd: number | null;
  provider_request_digest: string | null; error_code: string | null }) {
  const knownResponse = args.terminal_status === "completed"
    || args.terminal_status === "provider_response_invalid";
  const definitelyNotSent = args.terminal_status === "definitely_not_sent";
  const outcomeUnknown = args.terminal_status === "outcome_unknown";
  if (knownResponse && (args.input_tokens === null || args.output_tokens === null
      || args.settled_micro_usd === null)) {
    throw new SignalTopicEvaluationV2Error("topic_refinement_terminal_input_invalid", 422);
  }
  if (knownResponse) {
    // The preceding branch narrows these three fields for the known-response settlement only.
    const inputTokens = args.input_tokens as number;
    const outputTokens = args.output_tokens as number;
    const settledMicroUsd = args.settled_micro_usd as number;
    if (args.provider_call_count < 1 || inputTokens < 0 || outputTokens < 0 || settledMicroUsd < 0) {
      throw new SignalTopicEvaluationV2Error("topic_refinement_terminal_input_invalid", 422);
    }
  }
  if (!/^topic-refinement-flight-[a-f0-9]{16}$/u.test(args.flight_key)
      || !knownResponse && !definitelyNotSent && !outcomeUnknown
      || !Number.isInteger(args.provider_call_count) || args.provider_call_count < 0
      || args.provider_call_count > SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.max_model_turns
      || (definitelyNotSent && (args.provider_call_count !== 0 || args.input_tokens === null
        || args.output_tokens === null || args.settled_micro_usd === null
        || args.input_tokens !== 0 || args.output_tokens !== 0 || args.settled_micro_usd !== 0))
      || (outcomeUnknown && (args.provider_call_count < 1 || args.input_tokens !== null
        || args.output_tokens !== null || args.settled_micro_usd !== null))
      || (args.provider_request_digest !== null && !/^sha256:[0-9a-f]{64}$/u.test(args.provider_request_digest))
      || (args.error_code !== null && !/^topic_refinement_[a-z0-9_]+$/u.test(args.error_code))) {
    throw new SignalTopicEvaluationV2Error("topic_refinement_terminal_input_invalid", 422);
  }
}

function mapFlightError(error: unknown): unknown {
  if (error instanceof SignalTopicEvaluationV2Error) return error;
  const candidate = error as { code?: unknown; sqlstate?: unknown; constraint?: unknown };
  const sqlstate = candidate?.sqlstate ?? candidate?.code;
  if (sqlstate === "23514" || sqlstate === "23505" || sqlstate === "55000") {
    return new SignalTopicEvaluationV2Error("topic_refinement_flight_rejected", 409);
  }
  return error;
}

async function rollbackSafely(client: TransactionClient) {
  // The local psql transport exits on a rejected statement. Preserve that original SQLSTATE
  // instead of allowing a synchronous rollback-on-closed-client error to mask it.
  try { await client.query("ROLLBACK"); } catch { /* original error remains authoritative */ }
}
