import type { JevAnswerV1, JevQuestionV1, JevRequestV1, JevResponseV1 } from "./signal-mention-facets-jev-v1";
import { signalWorkspaceEmbeddingDigestV1 as digest } from "./signal-workspace-embeddings-v1";

/** JEV bills input tokens only. The price is part of the run plan, not a worker literal. */
export const SIGNAL_LISTENING_JEV_INPUT_USD_PER_MTOK_V1 = 0.042;

/** A question is identified by the model and the exact wire sent to JEV. Its
 * request key, scope and position are not part of the identity: they decide who
 * gets asked, never what the answer means. The same wire is never paid twice. */
export function signalListeningQuestionIdentityV1(model: string, wire: JevQuestionV1): string {
  if (!model.trim() || !wire || (wire.type !== "noul" && wire.type !== "choice")) throw new Error("listening_question_invalid");
  return digest({ contract_version: "signal-listening-question-v1", model, wire });
}

export type SignalListeningAskedQuestionV1 = {
  /** Key of this question inside the request. */
  request_key: string;
  question_digest: string;
  kind: "noul" | "choice";
  wire: JevQuestionV1;
  /** Stable human-readable handle, such as `voice` or `topic:price`. */
  label: string;
};

/** One root, one text fragment, one request. */
export type SignalListeningItemV1 = {
  root_id: string;
  /** `sha256:` digest of the fragment in `request.state`. */
  input_digest: string;
  request: JevRequestV1;
  questions: SignalListeningAskedQuestionV1[];
};

export type SignalListeningAnswerRowV1 = {
  question_digest: string;
  root_id: string;
  input_digest: string;
  probability: number;
  choice: string | null;
  probabilities: Record<string, number> | null;
};

/** Describe every question of a request so its answers can be cached by identity. */
export function describeSignalListeningRequestV1(request: JevRequestV1,
  label: (request_key: string, wire: JevQuestionV1) => string = key => key): SignalListeningAskedQuestionV1[] {
  return Object.entries(request.questions).map(([request_key, wire]) => ({
    request_key, wire, kind: wire.type, label: label(request_key, wire),
    question_digest: signalListeningQuestionIdentityV1(request.model, wire),
  }));
}

/** The response was already validated against the request by the transport. */
export function mapSignalListeningAnswersV1(item: SignalListeningItemV1, response: JevResponseV1): SignalListeningAnswerRowV1[] {
  return item.questions.map(question => {
    const answer: JevAnswerV1 | undefined = response.answers[question.request_key];
    if (!answer || answer.type !== question.kind) throw new Error("listening_response_invalid");
    return answer.type === "noul"
      ? { question_digest: question.question_digest, root_id: item.root_id, input_digest: item.input_digest,
        probability: answer.noul, choice: null, probabilities: null }
      : { question_digest: question.question_digest, root_id: item.root_id, input_digest: item.input_digest,
        probability: answer.confidence, choice: answer.choice, probabilities: answer.probabilities };
  });
}

export function signalListeningCostMicroUsdV1(input_tokens: number, input_usd_per_mtok = SIGNAL_LISTENING_JEV_INPUT_USD_PER_MTOK_V1): number {
  if (!Number.isFinite(input_tokens) || input_tokens < 0 || !Number.isFinite(input_usd_per_mtok) || input_usd_per_mtok <= 0) {
    throw new Error("listening_cost_invalid");
  }
  return Math.ceil(input_tokens * input_usd_per_mtok);
}
