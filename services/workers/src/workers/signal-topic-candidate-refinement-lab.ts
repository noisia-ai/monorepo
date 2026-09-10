/**
 * Local-disposable, proposal-only Topic candidate refinement runner.
 *
 * This is deliberately a manual bounded tool loop instead of a database-capable agent: the
 * model returns either one of six validated navigation requests or one structured proposal. The
 * wrapper owns the pool, session, prompt compaction, token clamps and terminal receipt.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { APICallError } from "ai";
import {
  appendSignalTopicCandidateRefinementProposalV1,
  appendSignalTopicCandidateRefinementTerminalReceiptV1,
  claimSignalTopicCandidateRefinementFlightExecutionV1,
  navigateSignalTopicCandidateRefinementV1,
  SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY,
  type SignalTopicCandidateRefinementFlightV1,
  type SignalTopicEvaluationActorV2
} from "@noisia/db";
import {
  signalTopicCandidateRefinementNavigationRequestSchemaV1,
  signalTopicCandidateRefinementProposalSchemaV1,
  signalTopicEvaluationDigestV2
} from "@noisia/query-engine";
import { z } from "zod";

import { generateAnthropicBoundedTextV1, mapAnthropicTopicEvaluationBoundaryErrorV1 } from
  "../providers/anthropic-bounded-text";
import { assertSignalTopicCandidateRefinementLabCredentialCustodyV1,
  SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_NAME } from
  "../../scripts/signal-topic-candidate-refinement-lab-credential-v1";

const decisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tool"), request: signalTopicCandidateRefinementNavigationRequestSchemaV1 }).strict(),
  z.object({ kind: z.literal("final"), proposal: signalTopicCandidateRefinementProposalSchemaV1 }).strict()
]);
// Anthropic custom-tool schemas require a root JSON object. The refinement protocol itself is a
// discriminated union, so carry it in a strict envelope at the provider boundary and unwrap only
// after the known provider response is received.
const decisionEnvelopeSchema = z.object({ decision: decisionSchema }).strict();

const PROMPT_MAX_BYTES = 24_000;
const RESULT_CONTEXT_MAX_BYTES = 18_000;

type Pool = { connect(): Promise<{
  query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
  release(): void;
}> };
type NavigationResult = Awaited<ReturnType<typeof navigateSignalTopicCandidateRefinementV1>>;
type BoundedTransport = typeof generateAnthropicBoundedTextV1;

export type SignalTopicCandidateRefinementLabResultV1 = {
  contract_version: "signal-topic-candidate-refinement-lab-result-v1";
  terminal_status: "completed" | "definitely_not_sent" | "provider_response_invalid" | "outcome_unknown";
  flight_key: string;
  provider_call_count: number;
  input_tokens: number | null;
  output_tokens: number | null;
  settled_micro_usd: number | null;
  proposal_appended: boolean;
  topic_adoption: false;
  publication: false;
  serving: false;
};

/** This function accepts a local injected credential only from the scrubbed one-shot child
 * environment; it never reads parent-shell, UAT or project environment configuration. */
export async function runSignalTopicCandidateRefinementLabV1(args: {
  pool: Pool;
  workspace_id: string;
  actor: SignalTopicEvaluationActorV2;
  flight_key: string;
  transport?: BoundedTransport;
}): Promise<SignalTopicCandidateRefinementLabResultV1> {
  // The provider-capable entrypoint accepts no credential argument. It may execute only inside
  // the fixed scrubbed Keychain child composition; UAT, `.env`, Railway and parent-shell values
  // are rejected before any claim, client construction or transport edge.
  try {
    assertSignalTopicCandidateRefinementLabCredentialCustodyV1(process.env);
    const credential = process.env[SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_NAME]!;
    // Claim the database-sealed authority before constructing a request-capable provider client.
    // The returned projection deliberately replaces the caller input, so a forged/stale object
    // cannot select a candidate or reach the transport edge.
    const flight = await claimSignalTopicCandidateRefinementFlightExecutionV1({ pool: args.pool,
      workspace_id: args.workspace_id, actor: args.actor, flight_key: args.flight_key });
    const transport = args.transport ?? generateAnthropicBoundedTextV1;
    const history: NavigationResult[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let providerCalls = 0;
    // These two prerequisites are server-derived evidence reads, not optional model choices.
    // Use the same session-bound core as later navigation, including its trace and total limits.
    // No provider client is constructed until both authoritative reads have completed.
    try {
      for (const operation of ["candidate_context", "brand_os_context"] as const) {
        history.push(await navigateSignalTopicCandidateRefinementV1({ pool: args.pool,
          workspace_id: args.workspace_id, actor: args.actor, session_key: flight.session_key,
          request: { operation } }));
      }
    } catch {
      return await terminal({ ...args, flight }, "definitely_not_sent", 0, 0, 0, 0, null,
        "topic_refinement_context_bootstrap_rejected");
    }
    const provider = createAnthropic({ apiKey: credential });
    for (let turn = 0; turn < SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.max_model_turns; turn += 1) {
      let prompt: string;
      try {
        prompt = buildPrompt(flight, turn, history);
        assertTurnReservation(inputTokens, outputTokens, prompt);
      } catch {
        const beforeFirstTransport = providerCalls === 0;
        return await terminal({ ...args, flight }, beforeFirstTransport ? "definitely_not_sent" : "provider_response_invalid",
          providerCalls, beforeFirstTransport ? 0 : inputTokens, beforeFirstTransport ? 0 : outputTokens,
          beforeFirstTransport ? 0 : costMicroUsd(inputTokens, outputTokens), null,
          "topic_refinement_turn_budget_exhausted");
      }
      let result: Awaited<ReturnType<BoundedTransport>>;
      try {
        result = await transport({ model: SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.model, prompt,
          max_output_tokens: SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.max_output_tokens_per_turn,
          structured_output: { schema: decisionEnvelopeSchema, name: "topic_candidate_refinement_decision",
            description: "One bounded evidence-navigation request or one proposal-only Topic candidate refinement." } },
        provider);
      } catch (error) {
        const mapped = mapAnthropicTopicEvaluationBoundaryErrorV1(error);
        const definitelyNotSent = mapped instanceof Error && "outcome_class" in mapped
          && (mapped as { outcome_class?: unknown }).outcome_class === "definitely_not_sent";
        // A transport exception that is not locally pre-flight can occur after the provider
        // received the request, even on the first turn. Count that attempted edge before writing
        // the immutable unknown-outcome receipt; otherwise 0119 correctly rejects a zero-call
        // unknown receipt and would leave the reservation without a terminal reconciliation.
        const failure = classifyTransportFailureTerminal({ definitely_not_sent: definitelyNotSent,
          provider_call_count: providerCalls, input_tokens: inputTokens, output_tokens: outputTokens });
        return await terminal({ ...args, flight }, failure.terminal_status, failure.provider_call_count,
          failure.input_tokens, failure.output_tokens, failure.settled_micro_usd, null,
          definitelyNotSent ? failure.error_code : safeTransportDiagnostic(error));
      }
      providerCalls += 1;
      inputTokens += result.usage.input_tokens;
      outputTokens += result.usage.output_tokens;
      if (!usageWithinFlight(inputTokens, outputTokens)) {
        return await terminal({ ...args, flight }, "provider_response_invalid", providerCalls, inputTokens, outputTokens,
          costMicroUsd(inputTokens, outputTokens), result.provider_request_id
            ? signalTopicEvaluationDigestV2({ provider_request_id: result.provider_request_id }) : null,
          "topic_refinement_provider_usage_exceeded");
      }
      let decision: z.infer<typeof decisionSchema>;
      try { decision = decisionEnvelopeSchema.parse(JSON.parse(result.text)).decision; }
      catch {
        return await terminal({ ...args, flight }, "provider_response_invalid", providerCalls, inputTokens, outputTokens,
          costMicroUsd(inputTokens, outputTokens), result.provider_request_id
            ? signalTopicEvaluationDigestV2({ provider_request_id: result.provider_request_id }) : null,
          result.structured_output_failure === "output_limit"
            ? "topic_refinement_provider_output_limit" : result.structured_output_failure === "missing_output"
              ? "topic_refinement_provider_output_missing" : "topic_refinement_provider_response_invalid");
      }
      if (decision.kind === "final") {
        try {
          await appendSignalTopicCandidateRefinementProposalV1({ pool: args.pool, workspace_id: args.workspace_id,
            actor: args.actor, session_key: flight.session_key,
            idempotency_key: `${flight.flight_key}:proposal`, proposal: decision.proposal });
        } catch {
          return await terminal({ ...args, flight }, "provider_response_invalid", providerCalls, inputTokens, outputTokens,
            costMicroUsd(inputTokens, outputTokens), result.provider_request_id
              ? signalTopicEvaluationDigestV2({ provider_request_id: result.provider_request_id }) : null,
            "topic_refinement_proposal_rejected");
        }
        return await terminal({ ...args, flight }, "completed", providerCalls, inputTokens, outputTokens,
          costMicroUsd(inputTokens, outputTokens), result.provider_request_id
            ? signalTopicEvaluationDigestV2({ provider_request_id: result.provider_request_id }) : null, null, true);
      }
      try {
        if (history.length >= flight.max_navigation_calls) {
          throw new Error("topic_refinement_navigation_budget_exhausted");
        }
        history.push(await navigateSignalTopicCandidateRefinementV1({ pool: args.pool,
          workspace_id: args.workspace_id, actor: args.actor, session_key: flight.session_key,
          request: decision.request }));
      } catch {
        return await terminal({ ...args, flight }, "provider_response_invalid", providerCalls, inputTokens, outputTokens,
          costMicroUsd(inputTokens, outputTokens), result.provider_request_id
            ? signalTopicEvaluationDigestV2({ provider_request_id: result.provider_request_id }) : null,
          "topic_refinement_navigation_rejected");
      }
    }
    return await terminal({ ...args, flight }, "provider_response_invalid", providerCalls, inputTokens, outputTokens,
      costMicroUsd(inputTokens, outputTokens), null, "topic_refinement_final_turn_missing");
  } finally {
    // The child exits after one flight. Clear the in-memory process entry on every local path.
    delete process.env[SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_NAME];
  }
}

function buildPrompt(flight: SignalTopicCandidateRefinementFlightV1, turn: number,
  history: NavigationResult[]) {
  const context = compactTraceContext(history);
  const prompt = `You are refining one already-generated Topic candidate. You have no SQL, no corpus export, no\n`
    + `credentials, and no ability to edit or activate anything. Return exactly one structured decision.\n`
    + `The server has already supplied and traced candidate_context and brand_os_context below. Use both;\n`
    + `do not request duplicate candidate_context. Next retrieve representative_mentions or search_cluster\n`
    + `for its source clusters. Candidate metadata is a hypothesis, not newly retrieved evidence.\n`
    + `Only cite evidence_refs returned by evidence navigation in this session. Use next_cursor unchanged\n`
    + `with the same search filters to inspect more mentions. Do not infer that unread mentions agree.\n`
    + `Use only returned cluster/candidate keys; never invent related candidates. Return a final proposal\n`
    + `by the final turn with a concrete evidence-backed name, description and recommendation.\n`
    + `Keep the final concise: name <=80 characters, description <=500 characters, rationale <=300\n`
    + `characters, and 3-5 decisive evidence_refs (not every mention read). The response has a\n`
    + `1000-token output budget; avoid repeating citations or including prose outside the decision.\n`
    + `Candidate key: ${flight.candidate_key}.\n`
    + `Navigation calls remaining: ${Math.max(0, flight.max_navigation_calls - history.length)}/${flight.max_navigation_calls}.\n`
    + `Flight ${flight.flight_key}; turn ${turn + 1}/${flight.max_model_turns}. Current trace context:\n`
    + JSON.stringify(context);
  if (Buffer.byteLength(prompt, "utf8") > PROMPT_MAX_BYTES) {
    throw new Error("topic_refinement_prompt_too_large_before_transport");
  }
  return prompt;
}

function compactTraceContext(history: NavigationResult[]) {
  const visibleHistory = [...history];
  const project = (stringLimit: number) => visibleHistory.map((entry) => {
    const isCandidateContext = entry.operation === "candidate_context";
    const data = entry.result.data;
    // The DB deliberately records no newly citable refs for candidate_context. Hide the old
    // proposal's citations here so a model cannot mistake them for evidence it just inspected.
    const visibleData = isCandidateContext && data && typeof data === "object" && !Array.isArray(data)
      ? Object.fromEntries(Object.entries(data).filter(([key]) => key !== "evidence_refs")) : data;
    return { operation: entry.operation,
      evidence_refs: isCandidateContext ? [] : entry.result.evidence_refs.slice(0, 48),
      // Opaque signed cursors must never pass through prose truncation.
      next_cursor: entry.result.next_cursor,
      result: compactValue(visibleData, stringLimit) };
  });
  let compact = project(900);
  while (Buffer.byteLength(JSON.stringify(compact), "utf8") > RESULT_CONTEXT_MAX_BYTES && compact.length > 1) {
    visibleHistory.shift();
    compact = project(900);
  }
  for (const stringLimit of [450, 225]) {
    if (Buffer.byteLength(JSON.stringify(compact), "utf8") <= RESULT_CONTEXT_MAX_BYTES) break;
    compact = project(stringLimit);
  }
  return compact;
}

function compactValue(value: unknown, stringLimit: number): unknown {
  if (typeof value === "string") return value.slice(0, stringLimit);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => compactValue(item, stringLimit));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .slice(0, 16).map(([key, item]) => [key, compactValue(item, stringLimit)]));
  return value;
}

function assertTurnReservation(inputTokens: number, outputTokens: number, prompt: string) {
  const promptBytes = Buffer.byteLength(prompt, "utf8");
  if (promptBytes > SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.max_input_tokens_per_turn
      || inputTokens + promptBytes > SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.max_input_tokens
      || outputTokens + SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.max_output_tokens_per_turn
        > SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.max_output_tokens) {
    throw new Error("topic_refinement_turn_budget_exhausted_before_transport");
  }
}

function usageWithinFlight(inputTokens: number, outputTokens: number) {
  return Number.isSafeInteger(inputTokens) && Number.isSafeInteger(outputTokens)
    && inputTokens >= 0 && outputTokens >= 0
    && inputTokens <= SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.max_input_tokens
    && outputTokens <= SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.max_output_tokens
    && costMicroUsd(inputTokens, outputTokens) <= SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.hard_cap_micro_usd;
}

function costMicroUsd(inputTokens: number, outputTokens: number) {
  return inputTokens * SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.input_micro_usd_per_token
    + outputTokens * SIGNAL_TOPIC_REFINEMENT_FLIGHT_POLICY.output_micro_usd_per_token;
}

/** Closed diagnostics retain the failure category, never provider bodies, headers or URLs.
 * These codes do not change the ambiguous/no-retry classification of any HTTP/network error. */
function safeTransportDiagnostic(error: unknown) {
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 400) return "topic_refinement_provider_http_bad_request";
    if (error.statusCode === 401 || error.statusCode === 403) return "topic_refinement_provider_http_auth";
    if (error.statusCode === 429) return "topic_refinement_provider_http_rate_limit";
    if (typeof error.statusCode === "number" && error.statusCode >= 500) return "topic_refinement_provider_http_server";
    if (typeof error.statusCode === "number") return "topic_refinement_provider_http_other";
  }
  return "topic_refinement_provider_ambiguous";
}

/** A local pre-transport failure can be zero-cost only before every provider response. Once a
 * preceding turn has settled known usage, retain that usage in a valid terminal receipt rather
 * than trying to write an impossible definitely-not-sent receipt with a nonzero call count. */
function classifyTransportFailureTerminal(args: { definitely_not_sent: boolean; provider_call_count: number;
  input_tokens: number; output_tokens: number }) {
  if (args.definitely_not_sent && args.provider_call_count === 0) {
    return { terminal_status: "definitely_not_sent" as const, provider_call_count: 0,
      input_tokens: 0, output_tokens: 0, settled_micro_usd: 0,
      error_code: "topic_refinement_provider_definitely_not_sent" };
  }
  if (args.definitely_not_sent) {
    return { terminal_status: "provider_response_invalid" as const,
      provider_call_count: args.provider_call_count, input_tokens: args.input_tokens,
      output_tokens: args.output_tokens,
      settled_micro_usd: costMicroUsd(args.input_tokens, args.output_tokens),
      error_code: "topic_refinement_provider_turn_rejected_after_response" };
  }
  return { terminal_status: "outcome_unknown" as const, provider_call_count: args.provider_call_count + 1,
    input_tokens: null, output_tokens: null, settled_micro_usd: null,
    error_code: "topic_refinement_provider_ambiguous" };
}

async function terminal(args: { pool: Pool; workspace_id: string; flight: SignalTopicCandidateRefinementFlightV1 },
  terminalStatus: SignalTopicCandidateRefinementLabResultV1["terminal_status"], providerCallCount: number,
  inputTokens: number | null, outputTokens: number | null, settledMicroUsd: number | null,
  providerRequestDigest: string | null, errorCode: string | null, proposalAppended = false
): Promise<SignalTopicCandidateRefinementLabResultV1> {
  await appendSignalTopicCandidateRefinementTerminalReceiptV1({ pool: args.pool,
    workspace_id: args.workspace_id, flight_key: args.flight.flight_key, terminal_status: terminalStatus,
    provider_call_count: providerCallCount, input_tokens: inputTokens, output_tokens: outputTokens,
    settled_micro_usd: settledMicroUsd, provider_request_digest: providerRequestDigest, error_code: errorCode });
  return { contract_version: "signal-topic-candidate-refinement-lab-result-v1", terminal_status: terminalStatus,
    flight_key: args.flight.flight_key, provider_call_count: providerCallCount, input_tokens: inputTokens,
    output_tokens: outputTokens, settled_micro_usd: settledMicroUsd, proposal_appended: proposalAppended,
    topic_adoption: false, publication: false, serving: false };
}

export const signalTopicCandidateRefinementLabTestOnly = {
  buildPrompt, compactTraceContext, assertTurnReservation, usageWithinFlight, decisionEnvelopeSchema,
  classifyTransportFailureTerminal, safeTransportDiagnostic
};
