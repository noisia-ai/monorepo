import { createHash } from "node:crypto";
import { z } from "zod";
import seed from "./data/study-templates/triggers-barriers.r16b-v1.json";
import seedV2 from "./data/study-templates/triggers-barriers.r16b-v2.json";
import seedV3 from "./data/study-templates/triggers-barriers.r16b-v3.json";
import type { JevQuestionV1 } from "./signal-mention-facets-jev-v1";
import { signalListeningQuestionIdentityV1, type SignalListeningAskedQuestionV1 } from "./signal-listening-questions-v1";

/**
 * A Study is a methodology applied to a cut of a brand's corpus, about a
 * subject. It reuses the corpus roots, their vectors and the listening
 * answers. Everything the methodology asks or tells an agent comes from its
 * template, which a study freezes when it is created. This module is pure.
 */

const key = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u);
const text = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0);
const option = z.object({ key, definition: text(1600) }).strict();
export const SIGNAL_STUDY_LAYERS_V1 = ["psychological", "personal", "social", "cultural", "unclear"] as const;
export const SIGNAL_STUDY_PERMISSIONS_V1 = ["movable", "partial", "structural_align_or_exit", "no_permission"] as const;
export type SignalStudyLayerV1 = typeof SIGNAL_STUDY_LAYERS_V1[number];
export type SignalStudyPermissionV1 = typeof SIGNAL_STUDY_PERMISSIONS_V1[number];
const templateSchema = z.object({
  contract_version: z.literal("signal-study-template-v1"), key, version: text(80), model: z.literal("jev-1.13.0"), instructions: text(2000),
  axes: z.array(z.object({ key, role: z.enum(["direction", "target", "use"]), text: text(1600), options: z.array(option).min(2).max(12) }).strict()).length(3),
  motive_question: z.object({ text: text(600), negative: text(600) }).strict(),
  layers: z.array(z.object({ key: z.enum(SIGNAL_STUDY_LAYERS_V1), permission: z.enum(SIGNAL_STUDY_PERMISSIONS_V1) }).strict()).length(5),
  diagnostics: z.array(z.object({ key, layer: z.enum(SIGNAL_STUDY_LAYERS_V1), question: text(1600) }).strict()).min(1).max(8),
  editorial: z.object({ base: text(4000), motives: text(4000), layers: text(4000), boundary: text(4000), contrast: text(4000) }).strict(),
  rules: z.object({
    cut: z.object({ voice: z.literal("individual"), promotion_max: z.number().min(0).max(1), exclude_hashtag_only: z.literal(true), require_category_lexicon: z.literal(true) }).strict(),
    group_directions: z.array(z.string()).min(1), group_targets: z.array(z.string()).min(1), group_use: z.string(),
    /** The uses that count toward the subject and enter motive discovery. Without it, only `group_use`. */
    group_uses: z.array(z.string()).min(1).max(4).optional(),
    /** A direction counts from this probability up; below it the post is kept as probable and read as `none`. */
    direction_min_probability: z.number().min(0).max(1).optional(),
    /** One direction over this share of the cut means the rules read too much: the output says so. */
    direction_share_max: z.number().min(0).max(1).optional(),
    /** The layer is read post by post on this many confirmed posts of each motive, and a motive takes the layer most of them show. */
    layer_mentions_per_motive: z.number().int().min(5).max(60).optional(), layer_majority_min: z.number().min(0.5).max(1).optional(),
    roots_per_group: z.number().int().min(20), min_groups: z.number().int().min(1), max_groups: z.number().int().min(1), min_group: z.number().int().min(1),
    random_sample: z.number().int().min(1).max(60), far_sample: z.number().int().min(0).max(20), excerpt_chars: z.number().int().min(80).max(2000),
    blind_passes: z.literal(2), kappa_min: z.number().min(0).max(1), boundary_recode_max: z.literal(1), dominance_max: z.number().min(0).max(1),
    motive_candidates: z.number().int().min(1).max(8), motive_approval_min: z.number().min(0).max(1), verbatims_per_motive: z.number().int().min(0).max(20),
    no_default_layer: z.literal(true), multilayer: z.literal("split"), without_literal_evidence: z.literal("unclear"), output_status: z.literal("directional"),
  }).strict(),
}).strict();
export type SignalStudyTemplateV1 = z.infer<typeof templateSchema>;
export function validateSignalStudyTemplateV1(value: unknown): SignalStudyTemplateV1 {
  const parsed = templateSchema.safeParse(value);
  if (!parsed.success || new Set(parsed.data.axes.map(axis => axis.role)).size !== 3 || new Set(parsed.data.layers.map(layer => layer.key)).size !== 5) {
    throw new Error("study_template_invalid");
  }
  return parsed.data;
}
/** The first Triggers & Barriers template. Studies made with it keep their own copy. */
export const SIGNAL_STUDY_TB_TEMPLATE_V1: Readonly<SignalStudyTemplateV1> = validateSignalStudyTemplateV1(seed);
/**
 * The second template, after the first blind evaluation: a direction needs a
 * force of the speaker's own and only counts from 0.85 (the first wording read
 * plain mentions as triggers); the layer is read post by post, because
 * agreement over a dozen motives says little; and a post is a member of a
 * motive from 0.85. Its direction turned out too narrow: it asked for a stated
 * reason and left out the emotion a speaker expresses about the subject.
 */
export const SIGNAL_STUDY_TB_TEMPLATE_V2: Readonly<SignalStudyTemplateV1> = validateSignalStudyTemplateV1(seedV2);
/**
 * The template new studies are made with. Direction is asked in two steps:
 * first whether the force is aimed at the subject at all (what the first
 * wording got wrong was posts about something else), then its direction, where
 * an emotion or an experience about the subject counts as much as a stated
 * reason, as the methodology defines a trigger. A post with a counted direction
 * enters motive discovery unless its use is figurative or ironic: once a force
 * aimed at the subject is found the post is already an evaluation, and the use
 * question reads `other` for a subject that is not a product. Everything else
 * is as in the second template. One direction over half of the cut is reported
 * as a sign that the rules read too much.
 */
export const SIGNAL_STUDY_TB_TEMPLATE_V3: Readonly<SignalStudyTemplateV1> = validateSignalStudyTemplateV1(seedV3);
/** A study may use its own lexicon for its cut instead of the brand's: lowercase terms, one or two words each. */
export function validateSignalStudyLexiconV1(value: unknown): string[] {
  const parsed = z.array(z.string().trim().min(2).max(80)).min(1).max(400).safeParse(value);
  if (!parsed.success) throw new Error("study_lexicon_invalid");
  return [...new Set(parsed.data.map(term => term.toLocaleLowerCase().replace(/\s+/gu, " ")))].sort();
}

const subjectSchema = z.object({
  kind: z.enum(["category", "own_brand", "alternative"]), name: text(240), category: text(240), own_brand: text(240),
  competitors: z.array(text(80)).max(20), alternatives: z.array(text(80)).max(20), conventional_category: text(240).optional(),
}).strict();
export type SignalStudySubjectV1 = z.infer<typeof subjectSchema>;
export function validateSignalStudySubjectV1(value: unknown): SignalStudySubjectV1 {
  const parsed = subjectSchema.safeParse(value);
  if (!parsed.success || (parsed.data.kind === "alternative" && !parsed.data.conventional_category)) throw new Error("study_subject_invalid");
  return parsed.data;
}
export function interpolateSignalStudyTextV1(value: string, subject: SignalStudySubjectV1): string {
  const variables: Record<string, string> = { subject: subject.name, category: subject.category, own_brand: subject.own_brand,
    competitors: subject.competitors.join("; ") || "(not configured)", alternatives: subject.alternatives.join("; ") || "(not configured)",
    conventional_category: subject.conventional_category ?? subject.category };
  return value.replace(/\{\{([a-z_]+)\}\}/gu, (_match, name: string) => {
    if (!(name in variables)) throw new Error("study_template_variable_invalid");
    return variables[name]!;
  });
}

function asked(model: string, request_key: string, label: string, wire: JevQuestionV1): SignalListeningAskedQuestionV1 {
  return { request_key, label, wire, kind: wire.type, question_digest: signalListeningQuestionIdentityV1(model, wire) };
}
export type SignalStudyAxesQuestionsV1 = Record<"direction" | "target" | "use", SignalListeningAskedQuestionV1>;
/** The three questions of the study, written with its exact subject. */
export function compileSignalStudyAxesV1(template: SignalStudyTemplateV1, subject: SignalStudySubjectV1): SignalStudyAxesQuestionsV1 {
  const rules = interpolateSignalStudyTextV1(template.instructions, subject);
  const entries = template.axes.map(axis => [axis.role, asked(template.model, axis.key, `study:${template.key}:${axis.key}`, { type: "choice",
    instructions: { rules, question: interpolateSignalStudyTextV1(axis.text, subject) },
    criteria: Object.fromEntries(axis.options.map(item => [item.key, interpolateSignalStudyTextV1(item.definition, subject)])) })] as const);
  return Object.fromEntries(entries) as SignalStudyAxesQuestionsV1;
}
/** The yes-or-no question that confirms a root for one motive. */
export function signalStudyMotiveQuestionV1(template: SignalStudyTemplateV1, subject: SignalStudySubjectV1, motive: { key: string; name: string; definition: string }): SignalListeningAskedQuestionV1 {
  return asked(template.model, `motive_${motive.key}`, `study:${template.key}:motive:${motive.key}`, { type: "noul",
    instructions: interpolateSignalStudyTextV1(template.instructions, subject),
    criteria: { true: { question: interpolateSignalStudyTextV1(template.motive_question.text, subject), name: motive.name, definition: motive.definition },
      false: template.motive_question.negative } });
}

/** The uses of the subject that count: the template's list, or its single use when it has none. Literal use without rules. */
export function signalStudyGroupUsesV1(rules?: Partial<Pick<SignalStudyTemplateV1["rules"], "group_use" | "group_uses">>): string[] {
  return rules?.group_uses ?? [rules?.group_use ?? "literal"];
}
export type SignalStudyAxesV1 = { direction: string; target: string; use: string; source_direction: string; alternative_inverted: boolean;
  /** The direction the classifier gave below the line that makes it count; the post is read as `none`. */
  direction_probable: string | null;
  /** Where the root is counted: the study subject, a competitor (reported apart), an alternative, or not at all. */
  aggregate: "subject" | "competitor" | "alternative" | "figurative_or_ironic" | "other" };
/** Reads the three answers of a root. When the subject is an alternative, rejecting
 * the conventional category counts as moving toward the alternative. */
export function resolveSignalStudyAxesV1(subject: SignalStudySubjectV1, given: { direction: string; target: string; use: string; direction_probability?: number | null },
  rules?: Pick<SignalStudyTemplateV1["rules"], "direction_min_probability"> & Partial<Pick<SignalStudyTemplateV1["rules"], "group_use" | "group_uses">>): SignalStudyAxesV1 {
  const counted = signalStudyGroupUsesV1(rules);
  const weak = rules?.direction_min_probability !== undefined && given.direction !== "none" && (given.direction_probability ?? 0) < rules.direction_min_probability;
  const answers = { ...given, direction: weak ? "none" : given.direction };
  const inverted = subject.kind === "alternative" && answers.target === "category" && answers.direction === "barrier" && answers.use === "literal";
  return { source_direction: given.direction, direction_probable: weak ? given.direction : null,
    direction: inverted ? "trigger" : answers.direction, target: answers.target, use: answers.use, alternative_inverted: inverted,
    aggregate: answers.use === "figurative_or_ironic" ? "figurative_or_ironic" : !counted.includes(answers.use) ? "other"
      : answers.target === "competitor_brand" ? "competitor" : answers.target === "alternative" && subject.kind !== "alternative" ? "alternative" : "subject" };
}
/** Roots that enter motive discovery: a direction, about the subject, in a use that counts. Pooled across directions. */
export function signalStudyInMotivePoolV1(template: SignalStudyTemplateV1, axes: SignalStudyAxesV1): boolean {
  return template.rules.group_directions.includes(axes.direction) && signalStudyGroupUsesV1(template.rules).includes(axes.use) && template.rules.group_targets.includes(axes.target)
    && axes.aggregate === "subject";
}
export function signalStudyPermissionForLayerV1(template: SignalStudyTemplateV1, layer: SignalStudyLayerV1): SignalStudyPermissionV1 {
  return template.layers.find(item => item.key === layer)!.permission;
}

// ---------- samples

const rank = (seedText: string, id: string) => createHash("sha256").update(`${seedText}\0${id}`).digest("hex");
/** Cuts a text without leaving half of a character at the end: a lone half cannot be stored as JSON. */
export function cutSignalStudyTextV1(value: string, max_chars: number): string {
  const cut = value.slice(0, max_chars), last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
export type SignalStudySampleRowV1 = { root_id: string; text: string; source: "random" | "far" };
/**
 * The examples an agent reads for a group: random ones plus the members farthest
 * from the centre, so its variety is visible. The two blind passes read different
 * examples whenever the group is large enough.
 */
export function sampleSignalStudyGroupV1(args: { group_key: string; members: Array<{ root_id: string; text: string; similarity: number }>;
  random: number; far: number; pass: "a" | "b"; excerpt_chars: number }): SignalStudySampleRowV1[] {
  const excerpt = (value: string) => cutSignalStudyTextV1(value, args.excerpt_chars);
  const byFar = [...args.members].sort((left, right) => left.similarity - right.similarity || left.root_id.localeCompare(right.root_id));
  const farCount = Math.min(args.far, Math.floor(byFar.length / 4)), offset = args.pass === "b" && byFar.length >= 2 * (args.random + farCount) ? 1 : 0;
  const far = byFar.slice(offset * farCount, offset * farCount + farCount);
  const taken = new Set(far.map(row => row.root_id));
  const shuffled = args.members.filter(row => !taken.has(row.root_id)).map(row => ({ row, order: rank(args.group_key, row.root_id) }))
    .sort((left, right) => left.order.localeCompare(right.order)).map(item => item.row);
  const random = shuffled.slice(offset * args.random, offset * args.random + args.random);
  return [...random.map(row => ({ root_id: row.root_id, text: excerpt(row.text), source: "random" as const })),
    ...far.map(row => ({ root_id: row.root_id, text: excerpt(row.text), source: "far" as const }))];
}

// ---------- agent steps: payloads, answer schemas and tolerant validation

const string = { type: "string" } as const, strings = { type: "array", items: string } as const;
const object = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const wordingWire = object({ name: string, definition: string });
const clean = (value: string) => value.trim().replace(/\s+/gu, " ");
const validKey = (value: string) => /^[a-z][a-z0-9_]{0,119}$/u.test(value);
function usable(value: { name: string; definition: string }) {
  const name = clean(value.name), definition = clean(value.definition);
  return name && definition && name.length <= 160 && definition.length <= 1200 ? { name, definition } : null;
}
export type SignalStudyWordingV1 = { original_language: string; original: { name: string; definition: string }; en: { name: string; definition: string };
  es: { name: string; definition: string } };
const studyContext = (subject: SignalStudySubjectV1) => ({ subject: subject.name, subject_kind: subject.kind, category: subject.category, own_brand: subject.own_brand });

export const SIGNAL_STUDY_MOTIVES_SCHEMA_V1 = object({
  motives: { type: "array", items: object({ key: string, group_keys: strings, original_language: string, original: wordingWire, en: wordingWire, es: wordingWire }) },
  insufficient_groups: strings });
export type SignalStudyGroupV1 = { group_key: string; roots: number; directions: Record<string, number>; sample: SignalStudySampleRowV1[] };
export function buildSignalStudyMotivesPayloadV1(args: { subject: SignalStudySubjectV1; groups: SignalStudyGroupV1[] }): string {
  return JSON.stringify({ study: studyContext(args.subject), groups: args.groups.map(group => ({ key: group.group_key, posts: group.roots, directions: group.directions,
    examples: group.sample.map(row => ({ text: row.text, kind: row.source })) })) });
}
export type SignalStudyMotiveV1 = { motive_key: string; wording: SignalStudyWordingV1; group_keys: string[] };
/** Turns the agent's naming into motives. Every group ends in exactly one motive or is set aside;
 * a group the answer forgot becomes its own unnamed-by-agent leftover and is reported. */
export function applySignalStudyMotivesV1(args: { groups: SignalStudyGroupV1[]; output: unknown }): { motives: SignalStudyMotiveV1[]; insufficient_groups: string[];
  uncovered_groups: string[]; rejected: Array<{ key: string; reason: string }> } {
  const parsed = z.object({ motives: z.array(z.object({ key: z.string(), group_keys: z.array(z.string()), original_language: z.string(),
    original: z.object({ name: z.string(), definition: z.string() }), en: z.object({ name: z.string(), definition: z.string() }),
    es: z.object({ name: z.string(), definition: z.string() }) })).max(200), insufficient_groups: z.array(z.string()) }).safeParse(args.output);
  if (!parsed.success) throw new Error("study_motives_output_invalid");
  const known = new Set(args.groups.map(group => group.group_key)), used = new Set<string>(), motives: SignalStudyMotiveV1[] = [], rejected: Array<{ key: string; reason: string }> = [];
  for (const item of parsed.data.motives) {
    const groups = [...new Set(item.group_keys)].filter(group => known.has(group) && !used.has(group));
    const original = usable(item.original), en = usable(item.en), es = usable(item.es), language = clean(item.original_language);
    const problem = !validKey(item.key) ? "key_invalid" : motives.some(motive => motive.motive_key === item.key) ? "key_taken" : !groups.length ? "no_groups"
      : !original || !en || !es || language.length < 2 || language.length > 35 ? "wording_incomplete" : null;
    if (problem) { rejected.push({ key: item.key, reason: problem }); continue; }
    for (const group of groups) used.add(group);
    motives.push({ motive_key: item.key, wording: { original_language: language, original: original!, en: en!, es: es! }, group_keys: groups.sort() });
  }
  const insufficient = [...new Set(parsed.data.insufficient_groups)].filter(group => known.has(group) && !used.has(group));
  for (const group of insufficient) used.add(group);
  return { motives, insufficient_groups: insufficient.sort(), uncovered_groups: [...known].filter(group => !used.has(group)).sort(), rejected };
}

const diagnosticWire = (keys: string[]) => object({ key: { type: "string", enum: keys }, changes_the_force: { type: "boolean" }, reason: string });
export function signalStudyLayersSchemaV1(template: SignalStudyTemplateV1) {
  const layer = { type: "string", enum: [...SIGNAL_STUDY_LAYERS_V1] };
  // The answer is written in this order and without a scratchpad: the diagnostics and the literal proof come before the layer they justify.
  return object({ motives: { type: "array", items: object({ motive_key: string, diagnostics: { type: "array", items: diagnosticWire(template.diagnostics.map(item => item.key)) },
    proof: string, normative_proof: string, layer, permission_override: { type: "string", enum: ["", ...SIGNAL_STUDY_PERMISSIONS_V1] }, permission_override_reason: string,
    parts: { type: "array", items: object({ original_language: string, original: wordingWire, en: wordingWire, es: wordingWire, proof: string, normative_proof: string, layer }) } }) } });
}
export type SignalStudyMotiveSampleV1 = { motive_key: string; name: string; definition: string; sample: SignalStudySampleRowV1[]; rule?: string };
export function buildSignalStudyLayersPayloadV1(args: { template: SignalStudyTemplateV1; subject: SignalStudySubjectV1; motives: SignalStudyMotiveSampleV1[] }): string {
  return JSON.stringify({ study: studyContext(args.subject),
    diagnostics_in_order: args.template.diagnostics.map(item => ({ key: item.key, layer_when_yes: item.layer, question: item.question })),
    permission_by_layer: Object.fromEntries(args.template.layers.map(item => [item.key, item.permission])),
    motives: args.motives.map(motive => ({ key: motive.motive_key, name: motive.name, definition: motive.definition,
      ...(motive.rule ? { decision_rule: motive.rule } : {}), examples: motive.sample.map(row => row.text) })) });
}
export type SignalStudyLayerCodingV1 = { motive_key: string; layer: SignalStudyLayerV1; proof: string | null; normative_proof: string | null;
  diagnostics: Array<{ key: string; changes_the_force: boolean; reason: string }>;
  permission: SignalStudyPermissionV1; permission_override: { permission: SignalStudyPermissionV1; reason: string } | null;
  parts: Array<{ wording: SignalStudyWordingV1; layer: SignalStudyLayerV1; proof: string | null }>; downgraded: string | null };
const literalIn = (quote: string, sample: SignalStudySampleRowV1[]) => { const value = quote.trim(); return value.length >= 8 && sample.some(row => row.text.includes(value)) ? value : null; };
/**
 * Reads one blind pass. The rules that protect the methodology are enforced
 * here, not trusted to the agent: a layer without a literal fragment of one of
 * the motive's examples is `unclear`; cultural without a literal normative
 * fragment is `unclear`; permission follows the layer unless a reason is written.
 */
export function applySignalStudyLayersV1(args: { template: SignalStudyTemplateV1; motives: SignalStudyMotiveSampleV1[]; output: unknown }): SignalStudyLayerCodingV1[] {
  const layer = z.enum(SIGNAL_STUDY_LAYERS_V1);
  const parsed = z.object({ motives: z.array(z.object({ motive_key: z.string(), layer, diagnostics: z.array(z.object({ key: z.string(), changes_the_force: z.boolean(), reason: z.string() })),
    proof: z.string(), normative_proof: z.string(), permission_override: z.string(), permission_override_reason: z.string(),
    parts: z.array(z.object({ original_language: z.string(), original: z.object({ name: z.string(), definition: z.string() }),
      en: z.object({ name: z.string(), definition: z.string() }), es: z.object({ name: z.string(), definition: z.string() }), layer, proof: z.string(), normative_proof: z.string() })) })) }).safeParse(args.output);
  if (!parsed.success) throw new Error("study_layers_output_invalid");
  const answers = new Map(parsed.data.motives.map(item => [item.motive_key, item]));
  return args.motives.map(motive => {
    const answer = answers.get(motive.motive_key);
    const missing: SignalStudyLayerCodingV1 = { motive_key: motive.motive_key, layer: "unclear", proof: null, normative_proof: null, diagnostics: [],
      permission: signalStudyPermissionForLayerV1(args.template, "unclear"), permission_override: null, parts: [], downgraded: "not_answered" };
    if (!answer) return missing;
    const proof = literalIn(answer.proof, motive.sample), normative = literalIn(answer.normative_proof, motive.sample);
    const downgraded = answer.layer === "unclear" ? null : !proof ? "no_literal_proof" : answer.layer === "cultural" && !normative ? "no_normative_proof" : null;
    const final: SignalStudyLayerV1 = downgraded ? "unclear" : answer.layer;
    const override = SIGNAL_STUDY_PERMISSIONS_V1.find(item => item === answer.permission_override), reason = clean(answer.permission_override_reason);
    const byRule = signalStudyPermissionForLayerV1(args.template, final);
    const parts = answer.parts.flatMap(part => {
      const original = usable(part.original), en = usable(part.en), es = usable(part.es), language = clean(part.original_language);
      const partProof = literalIn(part.proof, motive.sample);
      const partLayer: SignalStudyLayerV1 = !partProof || (part.layer === "cultural" && !literalIn(part.normative_proof, motive.sample)) ? "unclear" : part.layer;
      return original && en && es && language.length >= 2 && language.length <= 35
        ? [{ wording: { original_language: language, original, en, es }, layer: partLayer, proof: partProof }] : [];
    });
    return { motive_key: motive.motive_key, layer: final, proof, normative_proof: normative, diagnostics: answer.diagnostics.map(item => ({ ...item, reason: clean(item.reason).slice(0, 1600) })),
      // An override only counts with a written reason, and never rescues an unclear layer.
      permission: override && reason && final !== "unclear" && override !== byRule ? override : byRule,
      permission_override: override && reason && final !== "unclear" && override !== byRule ? { permission: override, reason } : null,
      parts: parts.length >= 2 ? parts : [], downgraded };
  });
}
/** Cohen's kappa between the two blind passes, over motives. 1 when both always agree. */
export function signalStudyLayerKappaV1(a: SignalStudyLayerCodingV1[], b: SignalStudyLayerCodingV1[]): { kappa: number | null; agreement: number | null; disagreements: string[] } {
  const other = new Map(b.map(item => [item.motive_key, item.layer]));
  const pairs = a.flatMap(item => other.has(item.motive_key) ? [[item.motive_key, item.layer, other.get(item.motive_key)!] as const] : []);
  if (!pairs.length) return { kappa: null, agreement: null, disagreements: [] };
  const agreement = pairs.filter(([, left, right]) => left === right).length / pairs.length;
  const expected = SIGNAL_STUDY_LAYERS_V1.reduce((sum, layer) => sum + (pairs.filter(([, left]) => left === layer).length / pairs.length)
    * (pairs.filter(([, , right]) => right === layer).length / pairs.length), 0);
  return { kappa: expected >= 1 ? 1 : (agreement - expected) / (1 - expected), agreement, disagreements: pairs.filter(([, left, right]) => left !== right).map(([motive]) => motive).sort() };
}

// ---------- the layer, read post by post

/** The answer is written in this order and without a scratchpad: the literal proof comes before the layer it justifies. */
export const SIGNAL_STUDY_MENTION_LAYERS_SCHEMA_V1 = object({ posts: { type: "array", items: object({ id: string, proof: string, normative_proof: string,
  layer: { type: "string", enum: [...SIGNAL_STUDY_LAYERS_V1] } }) } });
export type SignalStudyLayerPostV1 = { id: string; motive_key: string; text: string };
/** One blind reading: every post with the motive it was confirmed for. `order` shuffles the posts so two readings do not see them in the same sequence. */
export function buildSignalStudyMentionLayersPayloadV1(args: { template: SignalStudyTemplateV1; subject: SignalStudySubjectV1;
  motives: Array<{ motive_key: string; name: string; definition: string }>; posts: SignalStudyLayerPostV1[]; order: string }): string {
  const posts = args.posts.map(post => ({ post, rank: rank(args.order, post.id) })).sort((left, right) => left.rank.localeCompare(right.rank)).map(item => item.post);
  return JSON.stringify({ study: studyContext(args.subject),
    diagnostics_in_order: args.template.diagnostics.map(item => ({ key: item.key, layer_when_yes: item.layer, question: item.question })),
    motives: args.motives.map(motive => ({ key: motive.motive_key, name: motive.name, definition: motive.definition })),
    posts: posts.map(post => ({ id: post.id, motive: post.motive_key, text: post.text })) });
}
export type SignalStudyPostLayerV1 = { layer: SignalStudyLayerV1; proof: string | null; downgraded: string | null };
/**
 * Reads one blind reading. The rules are enforced here, not trusted to the
 * agent: a layer without a literal fragment of that same post is `unclear`, and
 * cultural also needs a literal normative fragment of that post. A post the
 * answer forgot is `unclear`.
 */
export function applySignalStudyMentionLayersV1(args: { posts: SignalStudyLayerPostV1[]; output: unknown }): Map<string, SignalStudyPostLayerV1> {
  const parsed = z.object({ posts: z.array(z.object({ id: z.string(), proof: z.string(), normative_proof: z.string(), layer: z.enum(SIGNAL_STUDY_LAYERS_V1) })) }).safeParse(args.output);
  if (!parsed.success) throw new Error("study_layers_output_invalid");
  const answers = new Map(parsed.data.posts.map(item => [item.id, item]));
  return new Map(args.posts.map(post => {
    const answer = answers.get(post.id);
    if (!answer) return [post.id, { layer: "unclear" as const, proof: null, downgraded: "not_answered" }];
    const literal = (quote: string) => { const value = quote.trim(); return value.length >= 8 && post.text.includes(value) ? value : null; };
    const proof = literal(answer.proof);
    const downgraded = answer.layer === "unclear" ? null : !proof ? "no_literal_proof" : answer.layer === "cultural" && !literal(answer.normative_proof) ? "no_normative_proof" : null;
    return [post.id, { layer: downgraded ? "unclear" : answer.layer, proof, downgraded }];
  }));
}
/** Agreement between the two readings, post by post. */
export function signalStudyMentionKappaV1(first: Map<string, SignalStudyPostLayerV1>, second: Map<string, SignalStudyPostLayerV1>): { kappa: number | null; agreement: number | null; n: number } {
  const pairs = [...first].flatMap(([id, coded]) => second.has(id) ? [[coded.layer, second.get(id)!.layer] as const] : []);
  if (!pairs.length) return { kappa: null, agreement: null, n: 0 };
  const agreement = pairs.filter(([left, right]) => left === right).length / pairs.length;
  const expected = SIGNAL_STUDY_LAYERS_V1.reduce((sum, layer) => sum + (pairs.filter(([left]) => left === layer).length / pairs.length)
    * (pairs.filter(([, right]) => right === layer).length / pairs.length), 0);
  return { kappa: expected >= 1 ? 1 : (agreement - expected) / (1 - expected), agreement, n: pairs.length };
}
/**
 * The layer of each motive from its posts: every reading of every post is one
 * vote. A motive takes a layer only when that layer has the required share of
 * the votes; otherwise, or when most votes are `unclear`, it stays `unclear`.
 */
export function decideSignalStudyMotiveLayersV1(args: { template: SignalStudyTemplateV1; posts: SignalStudyLayerPostV1[];
  readings: Array<Map<string, SignalStudyPostLayerV1>> }): Array<{ motive_key: string; layer: SignalStudyLayerV1; permission: SignalStudyPermissionV1; posts: number;
  votes: Record<string, number>; share: number; proofs: string[] }> {
  const needed = args.template.rules.layer_majority_min ?? 0.6, byMotive = new Map<string, SignalStudyLayerPostV1[]>();
  for (const post of args.posts) { const list = byMotive.get(post.motive_key); if (list) list.push(post); else byMotive.set(post.motive_key, [post]); }
  return [...byMotive].sort(([left], [right]) => left.localeCompare(right)).map(([motive_key, posts]) => {
    const coded = posts.flatMap(post => args.readings.flatMap(reading => reading.has(post.id) ? [reading.get(post.id)!] : []));
    const votes: Record<string, number> = {};
    for (const item of coded) votes[item.layer] = (votes[item.layer] ?? 0) + 1;
    const [top, count] = Object.entries(votes).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0] ?? ["unclear", 0];
    const share = coded.length ? count / coded.length : 0, layer = (share >= needed ? top : "unclear") as SignalStudyLayerV1;
    return { motive_key, layer, permission: signalStudyPermissionForLayerV1(args.template, layer), posts: posts.length, votes, share,
      proofs: [...new Set(coded.flatMap(item => item.layer === layer && item.proof ? [item.proof] : []))].slice(0, 3) };
  });
}

export const SIGNAL_STUDY_BOUNDARY_SCHEMA_V1 = object({ rules: { type: "array", items: object({ motive_key: string, decision_rule: string }) } });
export function buildSignalStudyBoundaryPayloadV1(args: { template: SignalStudyTemplateV1; subject: SignalStudySubjectV1;
  motives: Array<SignalStudyMotiveSampleV1 & { first: SignalStudyLayerCodingV1; second: SignalStudyLayerCodingV1 }> }): string {
  return JSON.stringify({ study: studyContext(args.subject), diagnostics_in_order: args.template.diagnostics.map(item => ({ key: item.key, layer_when_yes: item.layer, question: item.question })),
    motives: args.motives.map(motive => ({ key: motive.motive_key, name: motive.name, definition: motive.definition,
      assessments: [motive.first, motive.second].map(coding => ({ layer: coding.layer, diagnostics: coding.diagnostics })) })) });
}
export function applySignalStudyBoundaryV1(output: unknown, motive_keys: string[]): Map<string, string> {
  const parsed = z.object({ rules: z.array(z.object({ motive_key: z.string(), decision_rule: z.string() })) }).safeParse(output);
  if (!parsed.success) throw new Error("study_boundary_output_invalid");
  return new Map(parsed.data.rules.filter(rule => motive_keys.includes(rule.motive_key) && clean(rule.decision_rule)).map(rule => [rule.motive_key, clean(rule.decision_rule).slice(0, 2400)]));
}

export const SIGNAL_STUDY_CONTRAST_SCHEMA_V1 = object({ motives: { type: "array", items: object({ key: string, original_language: string, original: wordingWire, en: wordingWire, es: wordingWire }) } });
export function buildSignalStudyContrastPayloadV1(args: { subject: SignalStudySubjectV1; rewrite: SignalStudyMotiveSampleV1[]; neighbours: Array<{ motive_key: string; name: string; definition: string }> }): string {
  return JSON.stringify({ study: studyContext(args.subject), rewrite: args.rewrite.map(motive => ({ key: motive.motive_key, name: motive.name, definition: motive.definition,
    examples: motive.sample.map(row => row.text) })), neighbours_read_only: args.neighbours.map(motive => ({ key: motive.motive_key, name: motive.name, definition: motive.definition })) });
}
export function applySignalStudyContrastV1(output: unknown, motive_keys: string[]): Map<string, SignalStudyWordingV1> {
  const parsed = z.object({ motives: z.array(z.object({ key: z.string(), original_language: z.string(), original: z.object({ name: z.string(), definition: z.string() }),
    en: z.object({ name: z.string(), definition: z.string() }), es: z.object({ name: z.string(), definition: z.string() }) })) }).safeParse(output);
  if (!parsed.success) throw new Error("study_contrast_output_invalid");
  const result = new Map<string, SignalStudyWordingV1>();
  for (const item of parsed.data.motives) {
    const original = usable(item.original), en = usable(item.en), es = usable(item.es), language = clean(item.original_language);
    if (motive_keys.includes(item.key) && original && en && es && language.length >= 2 && language.length <= 35) result.set(item.key, { original_language: language, original, en, es });
  }
  return result;
}

// ---------- checks and output

/** A motive or a layer that covers more than the allowed share of the cut points at the definitions, not at the corpus. */
export function signalStudyDominanceV1(args: { template: SignalStudyTemplateV1; directed_roots: number; motives: Array<{ motive_key: string; layer: SignalStudyLayerV1; roots: number }>;
  /** Distinct posts per layer. A post in two motives of one layer counts once; without it the motives are added up. */
  layer_roots?: Record<string, number> }) {
  const limit = args.template.rules.dominance_max, total = Math.max(1, args.directed_roots);
  const byLayer = new Map<string, number>(Object.entries(args.layer_roots ?? {}));
  if (!args.layer_roots) for (const motive of args.motives) byLayer.set(motive.layer, (byLayer.get(motive.layer) ?? 0) + motive.roots);
  const dominant_layers = [...byLayer].filter(([, roots]) => roots / total > limit).map(([layer]) => layer).sort();
  const dominant_motives = args.motives.filter(motive => motive.roots / total > limit).map(motive => motive.motive_key).sort();
  // A dominant layer is rewritten through its largest motives.
  const from_layers = dominant_layers.flatMap(layer => args.motives.filter(motive => motive.layer === layer).sort((a, b) => b.roots - a.roots).slice(0, 3).map(motive => motive.motive_key));
  return { dominant_motives, dominant_layers, rewrite: [...new Set([...dominant_motives, ...from_layers])].sort() };
}
/** Handles of users are cut from anything that is shown. */
export function redactSignalStudyTextV1(value: string): string {
  return value.replace(/(^|[^\p{L}\p{N}_])@[\p{L}\p{N}_.]{2,}/gu, "$1@…");
}
/** A quote is only shown when it is a literal piece of the source text. This protects what is displayed; it is not a gate on labeling. */
export function verifySignalStudyVerbatimV1(quote: string, source: string): boolean {
  return quote.trim().length > 0 && source.includes(quote);
}

/**
 * Chooses what to show of a post: its longest stretch without user handles or
 * links, cut at a word. The result is always a literal piece of the source.
 */
export function pickSignalStudyVerbatimV1(source: string, max_chars: number): string | null {
  const pieces = source.split(/(?:^|(?<=[^\p{L}\p{N}_]))@[\p{L}\p{N}_.]{2,}|https?:\/\/\S+/gu).map(piece => piece.replace(/^[\s,;:.!?\-–—]+/u, "").trimEnd());
  let best = pieces.sort((left, right) => right.length - left.length)[0] ?? "";
  if (best.length > max_chars) { const cut = best.slice(0, max_chars); best = cutSignalStudyTextV1(cut, Math.max(cut.lastIndexOf(" "), Math.floor(max_chars * 0.6))).trimEnd(); }
  return best.length >= 20 && verifySignalStudyVerbatimV1(best, source) ? best : null;
}
