/** Fixed one-shot child for the local-only Keychain refinement launcher. */
import { createSignalTopicEvaluationLabDockerWritePoolV2 } from
  "./signal-topic-evaluation-lab-docker-write-pool-v2";
import { verifyFixedSignalTopicCandidateRefinementSuccessorHostReceiptV1 } from
  "./signal-topic-candidate-refinement-successor-host-provenance-v1";
import { assertSignalTopicCandidateRefinementLabCredentialCustodyV1 } from
  "./signal-topic-candidate-refinement-lab-credential-v1";
import { runSignalTopicCandidateRefinementLabV1 } from
  "../src/workers/signal-topic-candidate-refinement-lab";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const FLIGHT_KEY = /^topic-refinement-flight-[a-f0-9]{16}$/u;

export async function runSignalTopicCandidateRefinementLabChildV1(environment: NodeJS.ProcessEnv = process.env) {
  assertSignalTopicCandidateRefinementLabCredentialCustodyV1(environment);
  const flightKey = environment.NOISIA_TOPIC_REFINEMENT_LAB_FLIGHT_KEY ?? "";
  if (!FLIGHT_KEY.test(flightKey)) throw new Error("topic_refinement_local_child_flight_invalid");
  const { receipt } = await verifyFixedSignalTopicCandidateRefinementSuccessorHostReceiptV1();
  const pool = createSignalTopicEvaluationLabDockerWritePoolV2(receipt);
  const authority = (await pool.query<{ workspace_id: string; actor_user_id: string }>(`SELECT
    workspace_id::text,actor_user_id::text FROM signal_topic_evaluation_v2_candidate_refinement_flights
    WHERE flight_key=$1`, [flightKey])).rows[0];
  if (!authority) throw new Error("topic_refinement_local_child_flight_not_found");
  const result = await runSignalTopicCandidateRefinementLabV1({ pool, workspace_id: authority.workspace_id,
    actor: { id: authority.actor_user_id, user_type: "noisia_internal" }, flight_key: flightKey });
  return { terminal_status: result.terminal_status, flight_key: result.flight_key,
    provider_call_count: result.provider_call_count, settled_micro_usd: result.settled_micro_usd,
    proposal_appended: result.proposal_appended, topic_adoption: false as const,
    publication: false as const, serving: false as const };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSignalTopicCandidateRefinementLabChildV1().then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error: unknown) => {
    process.stderr.write(`${safeChildErrorCode(error)}\n`);
    process.exitCode = 1;
  });
}

function safeChildErrorCode(error: unknown) {
  const candidate = error as { code?: unknown; message?: unknown };
  for (const value of [candidate?.code, candidate?.message]) {
    if (typeof value === "string" && /^topic_refinement_[a-z0-9_]+$/u.test(value)) return value;
  }
  return "topic_refinement_local_child_failed";
}

export const signalTopicCandidateRefinementLabChildTestOnly = { safeChildErrorCode };
