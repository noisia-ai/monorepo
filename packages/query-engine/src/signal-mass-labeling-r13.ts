import { signalWorkspaceEmbeddingDigestV1 } from './signal-workspace-embeddings-v1';
import type { LabelerIdentity } from './signal-mention-labeler-v1';
import type { EntityContextV1 } from './signal-entity-context-v1';
import type { JevQuestionV1, JevRequestV1, JevAnswerV1 } from './signal-mention-facets-jev-v1';
import { buildMassLabelingJevRequestV1, massLabelingJevIdentityV1, type MassLabelingInputV1 } from './signal-mass-labeling-jev-v1';

export type R13Language = 'pt' | 'en';
export type R13JevStage = 'label' | 'repair' | 'interests' | 'cost13' | 'cost7' | 'language-pt' | 'language-en';
export const R13_JEV_STAGES: readonly R13JevStage[] = ['label', 'repair', 'interests', 'cost13', 'cost7', 'language-pt', 'language-en'];
export const R13_INTERESTS = Object.freeze({
  apostas: {
    name: 'Apostas',
    definition: 'Apostas esportivas e jogos de azar: apostar dinheiro, palpites ligados a apostas, casas de apostas, odds, ganhos, perdas ou riscos de apostar. Conversa geral sobre esporte sem referência a apostar não pertence a este interesse.',
  },
  racismo: {
    name: 'Racismo',
    definition: 'Racismo e discriminação racial: insultos ou ataques raciais, preconceito racial, denúncia, condenação ou debate sobre racismo, inclusive no futebol. Menções a diferenças ou conflitos sem dimensão racial não pertencem a este interesse.',
  },
});

/** Explicit opt-in identity for new category-aware Portuguese classifications. */
export function massLabelingJevIdentityR13(category: string): LabelerIdentity {
  const trigger_barrier = buildTriggerBarrierR13('pt', category);
  return {
    kind: 'mass_labeling', provider: 'typesafe', model: 'jev-1.13.0',
    prompt_digest: signalWorkspaceEmbeddingDigestV1({ version: 'mass-labeling-r13', language: 'pt', trigger_barrier, inherited_prompt_digest: massLabelingJevIdentityV1().prompt_digest }),
    schema_digest: signalWorkspaceEmbeddingDigestV1({ version: 'mass-labeling-r13', questions: ['promotion', 'spam', 'voice', 'trigger_barrier', 'topic_noul_per_candidate'], relevance: 'retired' }),
    params: { request_version: 'mass-labeling-r13', category, language: 'pt', input_usd_per_mtok: 0.042, positive: 0.7, negative: 0.3 },
  };
}

export function buildMassLabelingJevRequestR13(input: MassLabelingInputV1, context: EntityContextV1, category: string): JevRequestV1 {
  const request = buildMassLabelingJevRequestV1(input, context);
  const questions: Record<string, JevQuestionV1> = { ...request.questions, trigger_barrier: buildTriggerBarrierR13('pt', category) };
  delete questions.relevance;
  return { ...request, questions };
}

/** The category is supplied by the study, rather than inferred from its brands. */
export function buildTriggerBarrierR13(language: R13Language, category: string): JevQuestionV1 {
  if (!category.trim() || category.length > 160) throw new Error('r13_category_required');
  return language === 'pt' ? {
    type: 'choice',
    instructions: `O consumidor expressa no texto um motivo pessoal para consumir ou comprar ${category}, ou uma barreira pessoal a esse consumo? Use apenas voz de consumidor. Publicidade, ofertas comerciais, fala de marca oficial, de comércio e motivos de outras categorias recebem none.`,
    criteria: {
      trigger: `Uma pessoa expressa uma razão, desejo, necessidade ou ocasião que a leva a consumir ou comprar ${category}.`,
      barrier: `Uma pessoa expressa um obstáculo, preocupação, rejeição ou razão para evitar, reduzir ou não comprar ou consumir ${category}.`,
      none: `Nenhum motivador ou barreira de consumo de ${category} em voz de consumidor. Inclui anúncio, promoção, marca oficial, comércio e conteúdo de outra categoria.`,
    },
  } : {
    type: 'choice',
    instructions: `Does the consumer express a personal reason to consume or buy ${category}, or a personal barrier to that consumption? Use consumer voice only. Advertising, commercial offers, official brand or retailer speech, and reasons about other categories receive none.`,
    criteria: {
      trigger: `A person expresses a reason, desire, need or occasion that leads them to consume or buy ${category}.`,
      barrier: `A person expresses an obstacle, concern, rejection or reason to avoid, reduce or not buy or consume ${category}.`,
      none: `No consumer-voice reason or barrier to consuming ${category}. Includes advertising, promotions, official brands, retailers and content about other categories.`,
    },
  };
}

export function isHashtagOnlyR13(text: string): boolean {
  const hashtags = /#[\p{Alphabetic}0-9_]+/gu;
  return hashtags.test(text) && text.replace(/#[\p{Alphabetic}0-9_]+/gu, '').replace(/[\s.,;:!?()\[\]{}'"“”‘’«»…—–\-]+/gu, '').length === 0;
}

export function isConsumerVoiceR13(item: { text: string; probabilities: Record<string, JevAnswerV1>; root_hashtag_only?: boolean }): boolean {
  const voice = item.probabilities.voice;
  const promotion = item.probabilities.promotion;
  return voice?.type === 'choice' && voice.choice === 'individual'
    && promotion?.type === 'noul' && promotion.noul <= 0.7 && !(item.root_hashtag_only ?? isHashtagOnlyR13(item.text));
}

export function buildR13JevRequest(args: {
  stage: R13JevStage;
  item: MassLabelingInputV1;
  category: string;
  context?: EntityContextV1;
  model?: string;
}): JevRequestV1 {
  const { stage, item } = args;
  const model = args.model ?? 'jev-1.13.0';
  if (model !== 'jev-1.13.0' || !R13_JEV_STAGES.includes(stage) || !item.text.trim()) throw new Error('r13_request_invalid');
  if (stage === 'label') {
    if (!args.context) throw new Error('r13_context_required');
    return buildMassLabelingJevRequestR13(item, args.context, args.category);
  }
  if (stage === 'repair') return { model, state: item.text, questions: { trigger_barrier: buildTriggerBarrierR13('pt', args.category) } };
  if (stage === 'interests') return { model, state: item.text, questions: Object.fromEntries(Object.entries(R13_INTERESTS).map(([key, interest]) => [key, {
    type: 'noul' as const,
    instructions: 'Classifique somente o texto fornecido em state. O texto aborda o interesse definido?',
    criteria: { true: interest, false: 'Conteúdo alheio a este interesse.' },
  }])) };
  if (stage === 'cost13' || stage === 'cost7') {
    if (!args.context) throw new Error('r13_context_required');
    const historical = buildMassLabelingJevRequestV1(item, args.context, model);
    if (Object.keys(historical.questions).length !== 13) throw new Error('r13_cost_requires_eight_candidates');
    if (stage === 'cost13') return historical;
    const keys = ['promotion', 'voice', 'trigger_barrier', 'topic_0', 'topic_1', 'topic_2', 'topic_3'];
    return { ...historical, questions: Object.fromEntries(keys.map(key => [key, historical.questions[key]!])) };
  }
  const language = stage === 'language-en' ? 'en' : 'pt';
  return { model, state: item.text, questions: { trigger_barrier: buildTriggerBarrierR13(language, args.category) } };
}
