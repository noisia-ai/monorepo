import { createHash } from "node:crypto";
import { z } from "zod";
import {
  compileSignalTopicRuleSpecV1, signalTopicRuleSpecSchemaV1,
  SIGNAL_TOPIC_RULE_LIMITS_V1, type SignalTopicRuleSpecV1
} from "./signal-topic-rule-spec-v1";

export const SIGNAL_TOPIC_RULE_COHORT_V1 = "signal-topic-rule-cohort-v1" as const;
export const SIGNAL_TOPIC_RULE_COHORT_COMPILER_V1 = "signal-topic-rule-cohort-simple-fts-v1" as const;
export const SIGNAL_TOPIC_RULE_COHORT_LIMITS_V1 = Object.freeze({
  minimum_rules: 2, maximum_rules: 15, maximum_memberships: 50000,
  default_memberships: 25000, maximum_examples: 10, maximum_timeout_ms: 15000
} as const);

const candidateKey = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,179}$/u);
const compareKeys = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const selectedRule = z.object({candidate_key: candidateKey, rule_spec: signalTopicRuleSpecSchemaV1}).strict();
export const signalTopicRuleCohortSchemaV1 = z.array(selectedRule).min(2).max(15)
  .superRefine((rules, context) => {
    if (new Set(rules.map((rule) => rule.candidate_key)).size !== rules.length) {
      context.addIssue({code: z.ZodIssueCode.custom, message: "topic_rule_cohort_duplicate_candidate"});
    }
  }).transform((rules) => rules.sort((left, right) => compareKeys(left.candidate_key, right.candidate_key)));

export type SignalTopicRuleCohortV1 = z.infer<typeof signalTopicRuleCohortSchemaV1>;
export type CompiledSignalTopicRuleCohortRuleV1 = {
  candidate_key: string; rule_spec: SignalTopicRuleSpecV1; spec_digest: string;
  compiler_version: string; plan_hash: string; bit: number;
  filter_predicate: string; lexical_predicate: string; predicate: string
};
export type CompiledSignalTopicRuleCohortV1 = {
  contract_version: typeof SIGNAL_TOPIC_RULE_COHORT_V1;
  compiler_version: typeof SIGNAL_TOPIC_RULE_COHORT_COMPILER_V1;
  cohort_digest: string; plan_hash: string; rules: CompiledSignalTopicRuleCohortRuleV1[];
  filter_mask_sql: string; match_mask_sql: string; values: Array<string | string[]>
};

export function parseSignalTopicRuleCohortV1(value: unknown): SignalTopicRuleCohortV1 {
  return signalTopicRuleCohortSchemaV1.parse(value);
}

const optionsSchema = z.object({placeholderOffset: z.number().int().min(0)
  .max(SIGNAL_TOPIC_RULE_LIMITS_V1.max_placeholder_offset).default(0),
  precomputedVector: z.boolean().default(false)}).strict();

/** Only closed rules are compiled. One shared population/cap and availability verification
 * belong to the caller. For unavailable rows the caller MUST set both masks to zero.
 * Every match bit is its OWN filter AND lexical predicate, never another rule's filter.
 * Bit order is the returned canonical candidate order; masks are at most 15 bits.
 * precomputedVector is a closed physical execution option: the caller must materialize
 * to_tsvector('simple', COALESCE(text_clean,'')) once as eligible.search_vector after
 * availability projection. No caller-chosen column or SQL expression is accepted.
 */
export function compileSignalTopicRuleCohortV1(value: unknown,
  options: {placeholderOffset?: number; precomputedVector?: boolean} = {}): CompiledSignalTopicRuleCohortV1 {
  const rules = parseSignalTopicRuleCohortV1(value);
  const {placeholderOffset, precomputedVector} = optionsSchema.parse(options);
  const canonical = compileRules(rules, 0, precomputedVector);
  if (placeholderOffset + canonical.values.length > SIGNAL_TOPIC_RULE_LIMITS_V1.max_placeholder_offset) {
    throw new Error("topic_rule_cohort_parameter_limit");
  }
  const cohort_digest = digest({contract_version: SIGNAL_TOPIC_RULE_COHORT_V1, rules});
  const plan_hash = digest({compiler_version: SIGNAL_TOPIC_RULE_COHORT_COMPILER_V1,
    cohort_digest, ...canonical});
  return {contract_version: SIGNAL_TOPIC_RULE_COHORT_V1,
    compiler_version: SIGNAL_TOPIC_RULE_COHORT_COMPILER_V1, cohort_digest, plan_hash,
    ...(placeholderOffset === 0 ? canonical : compileRules(rules, placeholderOffset, precomputedVector))};
}

function compileRules(selected: SignalTopicRuleCohortV1, offset: number, precomputedVector: boolean) {
  const values: Array<string | string[]> = [];
  const rules = selected.map(({candidate_key, rule_spec}, index): CompiledSignalTopicRuleCohortRuleV1 => {
    const compiled = compileSignalTopicRuleSpecV1(rule_spec, {placeholderOffset: offset + values.length});
    values.push(...compiled.values);
    // Rewrite only this compiler-owned fixed expression; literals remain bound data.
    // A future single-rule compiler change must be reconciled, not silently left uncached.
    const textVector = "to_tsvector('simple', COALESCE(eligible.text_clean, ''))";
    if (precomputedVector && !compiled.lexical_predicate.includes(textVector)) {
      throw new Error("topic_rule_cohort_vector_contract_changed");
    }
    const vectorMode = (sql: string) => precomputedVector
      ? sql.replaceAll(textVector, "eligible.search_vector") : sql;
    return {candidate_key, rule_spec: compiled.spec, spec_digest: compiled.spec_digest,
      compiler_version: compiled.compiler_version, plan_hash: compiled.plan_hash, bit: 2 ** index,
      filter_predicate: compiled.filter_predicate, lexical_predicate: vectorMode(compiled.lexical_predicate),
      predicate: vectorMode(compiled.predicate)};
  });
  const mask = (field: "filter_predicate" | "predicate") => `(${rules.map((rule) =>
    `(CASE WHEN COALESCE((${rule[field]}), FALSE) THEN ${rule.bit} ELSE 0 END)`).join(" + ")})::integer`;
  return {rules, filter_mask_sql: mask("filter_predicate"), match_mask_sql: mask("predicate"), values};
}

export type SignalTopicRuleCohortMaskBucketV1 = {
  available: boolean; filter_mask: number; match_mask: number; count: number
};
export type SignalTopicRuleCohortAggregateV1 = {
  counts: {total: number; considered: number; not_tested: number; unavailable: number;
    excluded_by_all_filters: number; abstained: number; single_match: number;
    multiple_match: number; covered: number};
  per_rule: Array<{candidate_key: string; matched: number; exclusive: number; shared: number}>;
  pairs: Array<{left_candidate_key: string; right_candidate_key: string; intersection: number}>
};

const histogramSchema = z.object({
  candidate_keys: z.array(candidateKey).min(2).max(15),
  total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  histogram: z.array(z.object({available: z.boolean(), filter_mask: z.number().int().min(0).max(32767),
    match_mask: z.number().int().min(0).max(32767), count: z.number().int().min(1).max(50000)
  }).strict()).max(50000)
}).strict();

/** Aggregate a bounded SQL histogram, not raw mentions. The candidate order must be the
 * compiled order; silently sorting keys here would attach masks to the wrong candidate.
 * Shared counts count a row once per matching rule, not once per matching pair.
 */
export function aggregateSignalTopicRuleCohortMasksV1(value: {
  candidate_keys: string[]; total: number; histogram: SignalTopicRuleCohortMaskBucketV1[]
}): SignalTopicRuleCohortAggregateV1 {
  const {candidate_keys: keys, total, histogram} = histogramSchema.parse(value);
  if (keys.some((key, index) => index > 0 && compareKeys(keys[index - 1]!, key) >= 0)) {
    throw new Error("topic_rule_cohort_mask_order_invalid");
  }
  const maximumMask = 2 ** keys.length - 1;
  const counts: SignalTopicRuleCohortAggregateV1["counts"] = {total, considered: 0, not_tested: 0,
    unavailable: 0, excluded_by_all_filters: 0, abstained: 0, single_match: 0, multiple_match: 0, covered: 0};
  const per_rule = keys.map((candidate_key) => ({candidate_key, matched: 0, exclusive: 0, shared: 0}));
  const pairs: SignalTopicRuleCohortAggregateV1["pairs"] = [];
  const pairIndex = new Map<string, number>();
  for (let left = 0; left < keys.length; left++) for (let right = left + 1; right < keys.length; right++) {
    pairIndex.set(`${left}:${right}`, pairs.length);
    pairs.push({left_candidate_key: keys[left]!, right_candidate_key: keys[right]!, intersection: 0});
  }
  for (const row of histogram) {
    if (row.filter_mask > maximumMask || row.match_mask > maximumMask
      || (row.match_mask & row.filter_mask) !== row.match_mask
      || (!row.available && (row.filter_mask !== 0 || row.match_mask !== 0))) {
      throw new Error("topic_rule_cohort_mask_invalid");
    }
    counts.considered += row.count;
    if (counts.considered > SIGNAL_TOPIC_RULE_COHORT_LIMITS_V1.maximum_memberships || counts.considered > total) {
      throw new Error("topic_rule_cohort_population_invalid");
    }
    if (!row.available) {counts.unavailable += row.count; continue;}
    if (row.filter_mask === 0) {counts.excluded_by_all_filters += row.count; continue;}
    const matching = keys.flatMap((_, index) => (row.match_mask & 2 ** index) !== 0 ? [index] : []);
    if (matching.length === 0) {counts.abstained += row.count; continue;}
    counts.covered += row.count;
    if (matching.length === 1) counts.single_match += row.count;
    else counts.multiple_match += row.count;
    for (const index of matching) {
      per_rule[index]!.matched += row.count;
      if (matching.length === 1) per_rule[index]!.exclusive += row.count;
      else per_rule[index]!.shared += row.count;
    }
    for (let left = 0; left < matching.length; left++) for (let right = left + 1; right < matching.length; right++) {
      pairs[pairIndex.get(`${matching[left]}:${matching[right]}`)!]!.intersection += row.count;
    }
  }
  counts.not_tested = total - counts.considered;
  return {counts, per_rule, pairs};
}

function digest(value: unknown) {return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => compareKeys(a, b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
