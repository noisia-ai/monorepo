import { z } from "zod";
import type { JevQuestionV1 } from "./signal-mention-facets-jev-v1";
import { MASS_LABELING_JEV_WIRES_V2 } from "./signal-mass-labeling-jev-v2";
import { signalListeningQuestionIdentityV1, type SignalListeningAskedQuestionV1 } from "./signal-listening-questions-v1";
import { signalWorkspaceEmbeddingDigestV1 as digest } from "./signal-workspace-embeddings-v1";

const key = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u);
const text = (max: number) => z.string().trim().min(1).max(max);
/** Who proposed an item. `agent` leaves room for an assisted design experience;
 * `methodology` marks a question a study template lent to the report. */
const origin = z.enum(["brand_os", "agent", "methodology"]);

const definedTopic = z.object({
  key, name: text(160), definition: text(1200), active: z.boolean(),
  origin: origin.default("brand_os"), human_locked: z.boolean().default(false),
}).strict();
const choiceQuestion = z.object({
  key, text: text(600),
  options: z.array(z.object({ key, definition: text(600) }).strict()).min(2).max(12),
  /** `all`: every root. `consumer_category`: consumer voice that talks about the category. */
  scope: z.enum(["all", "consumer_category"]),
  active: z.boolean(), origin: origin.default("brand_os"), human_locked: z.boolean().default(false),
}).strict();
const schema = z.object({
  contract_version: z.literal("signal-listening-config-v1"),
  model: z.literal("jev-1.13.0"),
  category: text(160),
  lexicon_terms: z.array(text(200)).max(256),
  candidate_language: z.enum(["en", "original"]),
  /** Fixed for every brand. Nothing else belongs to the base. */
  base: z.tuple([z.literal("voice"), z.literal("promotion")]),
  /** Topics the brand defines. Asked on every root. */
  defined_topics: z.array(definedTopic).max(32),
  /** Topics found by discovery. Each root is asked its closest candidates. */
  discovered: z.object({ candidates_per_root: z.literal(4) }).strict(),
  /** Questions with options. */
  questions: z.array(choiceQuestion).max(16),
}).strict();

export type SignalListeningDefinedTopicV1 = z.infer<typeof definedTopic>;
export type SignalListeningChoiceQuestionV1 = z.infer<typeof choiceQuestion>;
export type SignalListeningConfigurationV1 = z.infer<typeof schema>;
export const SIGNAL_LISTENING_RESERVED_KEYS_V1 = ["voice", "promotion", "trigger_barrier"] as const;

export function validateSignalListeningConfigurationV1(value: unknown): SignalListeningConfigurationV1 {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("listening_configuration_invalid");
  const config = parsed.data, keys = [...config.defined_topics.map(topic => topic.key), ...config.questions.map(question => question.key)];
  if (new Set(keys).size !== keys.length || keys.some(item => (SIGNAL_LISTENING_RESERVED_KEYS_V1 as readonly string[]).includes(item))
    || config.questions.some(question => new Set(question.options.map(option => option.key)).size !== question.options.length)) {
    throw new Error("listening_configuration_invalid");
  }
  return { ...config, lexicon_terms: [...new Set(config.lexicon_terms)].sort(),
    defined_topics: [...config.defined_topics].sort((a, b) => a.key.localeCompare(b.key)),
    questions: config.questions.map(question => ({ ...question, options: [...question.options].sort((a, b) => a.key.localeCompare(b.key)) }))
      .sort((a, b) => a.key.localeCompare(b.key)) };
}
export function signalListeningConfigurationDigestV1(value: SignalListeningConfigurationV1): string {
  return digest(validateSignalListeningConfigurationV1(value));
}

/** The starting configuration of a brand: the fixed base and whatever it already defined. */
export function signalListeningBaseConfigurationV1(args: {
  category: string; lexicon_terms: string[]; candidate_language: "en" | "original";
  defined_topics?: Array<{ key: string; name: string; definition: string; active: boolean }>;
}): SignalListeningConfigurationV1 {
  return validateSignalListeningConfigurationV1({ contract_version: "signal-listening-config-v1", model: "jev-1.13.0",
    category: args.category, lexicon_terms: args.lexicon_terms, candidate_language: args.candidate_language,
    base: ["voice", "promotion"], defined_topics: args.defined_topics ?? [], discovered: { candidates_per_root: 4 }, questions: [] });
}

function asked(model: string, request_key: string, label: string, wire: JevQuestionV1): SignalListeningAskedQuestionV1 {
  return { request_key, label, wire, kind: wire.type, question_digest: signalListeningQuestionIdentityV1(model, wire) };
}
/** The wire of a question with options. Its text and every definition come from the configuration. */
export function signalListeningChoiceWireV1(question: SignalListeningChoiceQuestionV1): JevQuestionV1 {
  return { type: "choice", instructions: { rules: MASS_LABELING_JEV_WIRES_V2.instructions, question: question.text },
    criteria: Object.fromEntries(question.options.map(option => [option.key, option.definition])) };
}

export type SignalListeningCompiledV1 = {
  model: string;
  base: { voice: SignalListeningAskedQuestionV1; promotion: SignalListeningAskedQuestionV1 };
  defined: SignalListeningAskedQuestionV1[];
  choices: Array<SignalListeningAskedQuestionV1 & { scope: "all" | "consumer_category" }>;
  /** A discovered topic, worded for the request. */
  topic(topic_key: string, wording: { name: string; definition: string }): SignalListeningAskedQuestionV1;
};
/** Everything a run may ask, with its identity. Base, defined and discovered
 * topics keep the R15 wires, so their R15 answers are found in the cache. */
export function compileSignalListeningConfigurationV1(value: SignalListeningConfigurationV1): SignalListeningCompiledV1 {
  const config = validateSignalListeningConfigurationV1(value), model = config.model;
  return {
    model,
    base: { voice: asked(model, "voice", "voice", MASS_LABELING_JEV_WIRES_V2.voice()),
      promotion: asked(model, "promotion", "promotion", MASS_LABELING_JEV_WIRES_V2.promotion()) },
    defined: config.defined_topics.filter(topic => topic.active)
      .map(topic => asked(model, `interest_${topic.key}`, `interest:${topic.key}`, MASS_LABELING_JEV_WIRES_V2.interest(topic))),
    choices: config.questions.filter(question => question.active)
      .map(question => ({ ...asked(model, `question_${question.key}`, `question:${question.key}`, signalListeningChoiceWireV1(question)), scope: question.scope })),
    topic: (topic_key, wording) => asked(model, `topic_${topic_key}`, `topic:${topic_key}`, MASS_LABELING_JEV_WIRES_V2.topic(wording)),
  };
}

/** Consumer voice: a private individual, not promotional, and more than a row of hashtags. */
export const SIGNAL_LISTENING_CONSUMER_CUT_V1 = { voice: "individual", promotion_max: 0.7 } as const;
export function signalListeningConsumerVoiceV1(base: { voice_choice: string | null; promotion: number | null; hashtag_only: boolean }): boolean | null {
  if (base.voice_choice === null || base.promotion === null) return null;
  return base.voice_choice === SIGNAL_LISTENING_CONSUMER_CUT_V1.voice && base.promotion <= SIGNAL_LISTENING_CONSUMER_CUT_V1.promotion_max && !base.hashtag_only;
}

/**
 * What one root still has to be asked. Cached answers are never asked again.
 * A `consumer_category` question waits until the base answers exist, and is
 * only asked when the root is consumer voice and matches the category lexicon.
 */
export function selectSignalListeningPendingV1(args: {
  compiled: SignalListeningCompiledV1;
  /** Candidate discovered topics of this root, already limited and worded. */
  topics: SignalListeningAskedQuestionV1[];
  answered: ReadonlySet<string>;
  base: { voice_choice: string | null; promotion: number | null; hashtag_only: boolean };
  category_match: boolean;
}): SignalListeningAskedQuestionV1[] {
  const { compiled } = args, consumer = signalListeningConsumerVoiceV1(args.base);
  const wanted: SignalListeningAskedQuestionV1[] = [compiled.base.promotion, compiled.base.voice, ...compiled.defined, ...args.topics,
    ...compiled.choices.filter(question => question.scope === "all" || (consumer === true && args.category_match))];
  const seen = new Set<string>();
  return wanted.filter(question => !args.answered.has(question.question_digest) && !seen.has(question.question_digest) && seen.add(question.question_digest));
}
