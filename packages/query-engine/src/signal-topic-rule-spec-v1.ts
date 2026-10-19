import { createHash } from "node:crypto";
import { z } from "zod";

export const SIGNAL_TOPIC_RULE_SPEC_V1 = "signal-topic-rule-spec-v1" as const;
export const SIGNAL_TOPIC_RULE_COMPILER_V1 = "signal-topic-rule-simple-fts-v1" as const;
export const SIGNAL_TOPIC_RULE_LIMITS_V1 = Object.freeze({
  terms_per_group:16,total_terms:32,term_characters:160,filters_per_field:16,max_placeholder_offset:1000
} as const);

const scope=z.enum(["primary_brand","same_entity","competitor","category","other"]);
const noControls=(value:string)=>!/[\u0000-\u0008\u000e-\u001f\u007f]/u.test(value);
const uniqueSorted=<T extends string>(values:T[])=>[...new Set(values)].sort();
const prose=(max:number)=>z.string().min(1).max(max).refine(noControls,"topic_rule_control_character")
  .transform((value)=>value.trim()).pipe(z.string().min(1));
// Only ASCII whitespace is folded. Case, punctuation and Unicode spelling stay literal;
// PostgreSQL's explicit simple dictionary owns tokenization, not a guessed JS tokenizer.
const literal=z.string().min(1).max(SIGNAL_TOPIC_RULE_LIMITS_V1.term_characters)
  .refine(noControls,"topic_rule_control_character")
  .transform((value)=>value.replace(/[ \t\r\n\f\v]+/gu," ").replace(/^ | $/gu,""))
  .pipe(z.string().min(1).regex(/[\p{L}\p{N}]/u,"topic_rule_word_required"));
const terms=z.array(literal).max(SIGNAL_TOPIC_RULE_LIMITS_V1.terms_per_group);
const lexical=z.object({any:terms,all:terms,not:terms}).strict().superRefine((value,context)=>{
  if(value.any.length+value.all.length===0)context.addIssue({code:z.ZodIssueCode.custom,
    message:"topic_rule_positive_term_required"});
  if(value.any.length+value.all.length+value.not.length>SIGNAL_TOPIC_RULE_LIMITS_V1.total_terms)
    context.addIssue({code:z.ZodIssueCode.custom,message:"topic_rule_total_terms_exceeded"});
}).transform((value)=>({any:uniqueSorted(value.any),all:uniqueSorted(value.all),not:uniqueSorted(value.not)}));

/** Empty filter lists explicitly impose no restriction, including on NULL metadata.
 * Nonempty fields use OR within that field and AND across fields; NULL does not pass.
 * These are observed ISO-shaped language/market codes, not inferred availability authority.
 */
export const signalTopicRuleSpecSchemaV1=z.object({
  contract_version:z.literal(SIGNAL_TOPIC_RULE_SPEC_V1),kind:z.literal("topic"),
  label:prose(160),definition:prose(1500),lexical,
  filters:z.object({
    languages:z.array(z.string().regex(/^[a-z]{2}$/u)).max(SIGNAL_TOPIC_RULE_LIMITS_V1.filters_per_field)
      .transform(uniqueSorted),
    markets:z.array(z.string().regex(/^[A-Z]{2}$/u)).max(SIGNAL_TOPIC_RULE_LIMITS_V1.filters_per_field)
      .transform(uniqueSorted),
    scopes:z.array(scope).max(SIGNAL_TOPIC_RULE_LIMITS_V1.filters_per_field).transform(uniqueSorted)
  }).strict()
}).strict();

export type SignalTopicRuleSpecV1=z.infer<typeof signalTopicRuleSpecSchemaV1>;
export type CompiledSignalTopicRuleV1={
  spec:SignalTopicRuleSpecV1;spec_digest:string;compiler_version:typeof SIGNAL_TOPIC_RULE_COMPILER_V1;
  predicate:string;filter_predicate:string;lexical_predicate:string;values:Array<string|string[]>;plan_hash:string
};

export function parseSignalTopicRuleSpecV1(value:unknown):SignalTopicRuleSpecV1{
  return signalTopicRuleSpecSchemaV1.parse(value);
}

export function signalTopicRuleSpecDigestV1(value:unknown):string{
  return digest(parseSignalTopicRuleSpecV1(value));
}

const compilerOptions=z.object({placeholderOffset:z.number().int().min(0)
  .max(SIGNAL_TOPIC_RULE_LIMITS_V1.max_placeholder_offset).default(0)}).strict();

/** Pure compiler only. The caller owns the eligible population, authorization and execution.
 * any = OR; all = AND; not = AND NOT. Each individual item is a PostgreSQL simple-FTS
 * phrase, NOT a regex, tsquery program, substring test, semantic assignment or gold label.
 * Special characters remain bind data passed through phraseto_tsquery, never SQL syntax.
 */
export function compileSignalTopicRuleSpecV1(value:unknown,
  options:{placeholderOffset?:number}={}):CompiledSignalTopicRuleV1{
  const spec=parseSignalTopicRuleSpecV1(value),{placeholderOffset}=compilerOptions.parse(options);
  const specDigest=digest(spec),canonical=compilePredicates(spec,0);
  const compiled=placeholderOffset===0?canonical:compilePredicates(spec,placeholderOffset);
  return{spec,spec_digest:specDigest,compiler_version:SIGNAL_TOPIC_RULE_COMPILER_V1,...compiled,
    // Parameter relocation for an outer statement does not change the semantic trial plan.
    plan_hash:digest({compiler_version:SIGNAL_TOPIC_RULE_COMPILER_V1,spec_digest:specDigest,...canonical})};
}

function compilePredicates(spec:SignalTopicRuleSpecV1,offset:number){
  const values:Array<string|string[]>=[];
  const parameter=(value:string|string[])=>{values.push(value);return`$${offset+values.length}`;};
  const match=(term:string)=>`(to_tsvector('simple', COALESCE(eligible.text_clean, '')) @@ phraseto_tsquery('simple', ${parameter(term)}::text))`;
  const positive:string[]=[];
  if(spec.lexical.any.length)positive.push(`(${spec.lexical.any.map(match).join(" OR ")})`);
  if(spec.lexical.all.length)positive.push(`(${spec.lexical.all.map(match).join(" AND ")})`);
  if(spec.lexical.not.length)positive.push(`(${spec.lexical.not.map((term)=>`NOT ${match(term)}`).join(" AND ")})`);
  const lexicalPredicate=`(${positive.join(" AND ")})`;
  const filters:string[]=[];
  if(spec.filters.languages.length)filters.push(`COALESCE(eligible.language = ANY(${parameter([...spec.filters.languages])}::text[]), FALSE)`);
  if(spec.filters.markets.length)filters.push(`COALESCE(eligible.market = ANY(${parameter([...spec.filters.markets])}::text[]), FALSE)`);
  if(spec.filters.scopes.length)filters.push(`COALESCE(eligible.scope = ANY(${parameter([...spec.filters.scopes])}::text[]), FALSE)`);
  const filterPredicate=filters.length?`(${filters.join(" AND ")})`:"TRUE";
  return{lexical_predicate:lexicalPredicate,filter_predicate:filterPredicate,
    predicate:`(${filterPredicate} AND ${lexicalPredicate})`,values};
}

function digest(value:unknown){return`sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;}
function stableJson(value:unknown):string{
  if(Array.isArray(value))return`[${value.map(stableJson).join(",")}]`;
  if(value!==null&&typeof value==="object")return`{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0)
    .map(([key,item])=>`${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
