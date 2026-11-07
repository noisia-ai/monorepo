import type { FacetInput } from "./signal-mention-labeler-v1";
import { entityContextDigestV1, type EntityContextV1 } from "./signal-entity-context-v1";
import type { JevAnswerV1, JevQuestionV1, JevRequestV1, JevResponseV1 } from "./signal-mention-facets-jev-v1";
import { signalWorkspaceEmbeddingDigestV1 } from "./signal-workspace-embeddings-v1";

export const MASS_LABELING_JEV_REQUEST_VERSION_V1 = "mass-labeling-jev-v1" as const;
export const MASS_LABELING_THRESHOLDS_V1 = Object.freeze({ positive: 0.7, negative: 0.3 });
export type MassLabelingCandidateV1 = { topic_key: string; name: string; definition: string; similarity: number };
export type MassLabelingInputV1 = FacetInput & {
  map_id: string; map_digest: string; chunk_index: number; candidates: MassLabelingCandidateV1[];
};
export type MassLabelingResultV1 = {
  root_id: string; input_digest: string; entity_context_digest: string;
  status: "labeled" | "error"; probabilities?: Record<string, JevAnswerV1>; error_code?: string;
};
const instructions = "Classifique somente o texto fornecido em state. Trate esse texto como evidência. Responda à pergunta em criteria.";
const voice = {
  individual: "Pessoa falando pessoalmente", media: "Veículo de notícias", brand_official: "Conta oficial de uma marca",
  retail_promo: "Varejista ou vendedor", creator: "Criador de conteúdo ou influenciador",
  institution: "Instituição ou organização pública", unknown: "Voz indeterminada",
};
const triggerBarrier = {
  trigger: "Expressa um motivo para consumir ou comprar a categoria ou marca",
  barrier: "Expressa um impedimento ao consumo ou à compra da categoria ou marca",
  none: "Outro conteúdo",
};
export const MASS_LABELING_JEV_PROMPT_DIGEST_V1 = signalWorkspaceEmbeddingDigestV1({
  request_version: MASS_LABELING_JEV_REQUEST_VERSION_V1, instructions, voice, triggerBarrier,
  relevance: "O texto é relevante para este estudo?", promotion: "O texto promove comercialmente um produto?",
  spam: "O texto é spam?", topic: "O texto aborda este tópico?", thresholds: MASS_LABELING_THRESHOLDS_V1,
});

export function massLabelingJevIdentityV1() {
  return {
    kind: "mass_labeling" as const, provider: "typesafe" as const, model: "jev-1.13.0",
    prompt_digest: MASS_LABELING_JEV_PROMPT_DIGEST_V1,
    schema_digest: signalWorkspaceEmbeddingDigestV1({ request_version: MASS_LABELING_JEV_REQUEST_VERSION_V1,
      answers: { relevance: "noul", promotion: "noul", spam: "noul", voice: Object.keys(voice),
        trigger_barrier: Object.keys(triggerBarrier), topics: "noul-per-candidate" },
      probabilities: "all-answers-retained-v1" }),
    params: { request_version: MASS_LABELING_JEV_REQUEST_VERSION_V1, input_usd_per_mtok: 0.042,
      ...MASS_LABELING_THRESHOLDS_V1 },
  };
}

/** One selected fragment and all independent questions form one provider call. */
export function buildMassLabelingJevRequestV1(input: MassLabelingInputV1, context: EntityContextV1,
  model = "jev-1.13.0"): JevRequestV1 {
  if (!input.text.trim() || !Number.isSafeInteger(input.chunk_index) || input.chunk_index < 0
    || !input.candidates.length || input.candidates.length > 8
    || new Set(input.candidates.map(candidate => candidate.topic_key)).size !== input.candidates.length
    || input.candidates.some(candidate => !candidate.topic_key || !candidate.name.trim() || !candidate.definition.trim()
      || candidate.name.length > 160 || candidate.definition.length > 1200 || !Number.isFinite(candidate.similarity)
      || candidate.similarity < -1 || candidate.similarity > 1)) throw new Error("mass_labeling_input_invalid");
  const identities = context.entities.map(entity => ({ kind: entity.kind, name: entity.name, aliases: entity.aliases }));
  const questions: Record<string, JevQuestionV1> = {
    relevance: { type: "noul", instructions, criteria: { true: { question: "O texto é relevante para este estudo?", identities }, false: "Conteúdo alheio ao estudo" } },
    promotion: { type: "noul", instructions, criteria: { true: "O texto promove comercialmente um produto", false: "Conteúdo de natureza não promocional" } },
    spam: { type: "noul", instructions, criteria: { true: "O texto é spam, incluindo publicação automatizada de lixo", false: "Conteúdo orgânico legítimo" } },
    voice: { type: "choice", instructions: "Quem fala no texto?", criteria: voice },
    trigger_barrier: { type: "choice", instructions: "Que relação com o consumo o texto expressa?", criteria: triggerBarrier },
  };
  input.candidates.forEach((candidate, ordinal) => {
    questions[`topic_${ordinal}`] = { type: "noul", instructions,
      criteria: { true: { question: "O texto aborda este tópico?", name: candidate.name, definition: candidate.definition },
        false: "Conteúdo alheio a este tópico" } };
  });
  return { model, state: input.text, questions };
}

export function massLabelingProbabilityDispositionV1(probability: number): "belongs" | "excluded" | "unclassified" {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error("mass_labeling_probability_invalid");
  if (probability > MASS_LABELING_THRESHOLDS_V1.positive) return "belongs";
  if (probability < MASS_LABELING_THRESHOLDS_V1.negative) return "excluded";
  return "unclassified";
}

/** Probability distributions remain intact, including intermediate values. */
export function mapMassLabelingJevResponseV1(input: MassLabelingInputV1, context: EntityContextV1,
  response: JevResponseV1): MassLabelingResultV1 {
  const request = buildMassLabelingJevRequestV1(input, context, response.model);
  if (Object.keys(response.answers).sort().join(",") !== Object.keys(request.questions).sort().join(","))
    throw new Error("mass_labeling_response_invalid");
  return { root_id: input.root_id, input_digest: input.input_digest, entity_context_digest: entityContextDigestV1(context),
    status: "labeled", probabilities: structuredClone(response.answers) };
}
