import { createHash } from "node:crypto";
import { z } from "zod";

export const SIGNAL_TOPIC_EDITORIAL_SCREENING_MODEL_V1 = "claude-sonnet-4-6" as const;
// Sonnet 4.6 supports a 128K maximum output. The future provider adapter still
// seals a much smaller 16K output cap for this compact screening contract.
export const SIGNAL_TOPIC_EDITORIAL_SCREENING_BATCH_SIZE_V1 = 40;
export const SIGNAL_TOPIC_EDITORIAL_SCREENING_MAX_OUTPUT_TOKENS_V1 = 16_384;
export const SIGNAL_TOPIC_EDITORIAL_SCREENING_MAX_GROUPS_V1 = 5_000;

export type SignalTopicEditorialEvidenceV1 = {
  ref_id: string; text: string; locale: string | null; platform: string | null;
};
export type SignalTopicEditorialScreeningGroupV1 = {
  group_key: string; group_digest: string; dossier_digest: string; community_key: string;
  root_count: number; chunk_count: number; terms: string[];
  scope_counts: { brand: number; competitor: number; category: number; unknown: number };
  neighbors: Array<{ group_key: string; similarity: number }>;
  evidence: SignalTopicEditorialEvidenceV1[];
};
export type SignalTopicEditorialBrandContextV1 = {
  brand_name: string; default_locale: string; summary: string;
  audiences: string[]; categories: string[]; competitors: string[];
  positive_anchors: string[]; negative_anchors: string[]; abstention_anchors: string[];
};
export type SignalTopicEditorialScreeningBatchV1 = {
  contract_version: "signal-topic-editorial-screening-batch-v1";
  batch_index: number; batch_key: string; request_digest: string; model: typeof SIGNAL_TOPIC_EDITORIAL_SCREENING_MODEL_V1;
  context_digest: string; group_keys: string[]; prompt: string;
};
export type SignalTopicEditorialScreeningPlanV1 = {
  contract_version: "signal-topic-editorial-screening-plan-v1";
  expected_group_count: number; context_digest: string; model: typeof SIGNAL_TOPIC_EDITORIAL_SCREENING_MODEL_V1;
  batch_size: number; batches: SignalTopicEditorialScreeningBatchV1[]; plan_digest: string;
};

const digestPattern=/^sha256:[0-9a-f]{64}$/u;
const groupKeyPattern=/^(open|guided):[A-Za-z0-9_.:-]{1,180}$/u;
const keyPattern=/^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const ascii=(a:string,b:string)=>a<b?-1:a>b?1:0;
const fail=(code:string):never=>{ throw new Error(code); };
const stable=(value:unknown):string=>value===null||typeof value!=="object"?JSON.stringify(value)
  :Array.isArray(value)?`[${value.map(stable).join(",")}]`
  :`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>ascii(a,b))
    .map(([key,child])=>`${JSON.stringify(key)}:${stable(child)}`).join(",")}}`;
export const signalTopicEditorialDigestV1=(value:unknown)=>`sha256:${createHash("sha256").update(stable(value)).digest("hex")}`;
const bounded=(value:unknown,name:string,max:number)=>typeof value==="string"&&value.trim()===value&&value.length>0
  &&Buffer.byteLength(value,"utf8")<=max?value:fail(name);
const digest=(value:unknown,name:string)=>{const result=bounded(value,name,71);return digestPattern.test(result)?result:fail(name);};
const natural=(value:unknown,name:string,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&Number(value)>=0&&Number(value)<=max
  ?Number(value):fail(name);
const unit=(value:unknown,name:string)=>typeof value==="number"&&Number.isFinite(value)&&value>=0&&value<=1?value:fail(name);
const strings=(values:unknown,name:string,limit:number,max:number)=>{
  if(!Array.isArray(values)||values.length>limit)return fail(name);
  const result=values.map(value=>bounded(value,name,max));
  if(new Set(result).size!==result.length)return fail(name);
  return result;
};

function normalizeContext(value:SignalTopicEditorialBrandContextV1):SignalTopicEditorialBrandContextV1{
  return {brand_name:bounded(value.brand_name,"topic_editorial_context_invalid",300),
    default_locale:bounded(value.default_locale,"topic_editorial_context_invalid",35),
    summary:bounded(value.summary,"topic_editorial_context_invalid",12_000),
    audiences:strings(value.audiences,"topic_editorial_context_invalid",50,500),
    categories:strings(value.categories,"topic_editorial_context_invalid",50,500),
    competitors:strings(value.competitors,"topic_editorial_context_invalid",100,500),
    positive_anchors:strings(value.positive_anchors,"topic_editorial_context_invalid",100,500),
    negative_anchors:strings(value.negative_anchors,"topic_editorial_context_invalid",100,500),
    abstention_anchors:strings(value.abstention_anchors,"topic_editorial_context_invalid",100,500)};
}
function normalizeGroup(value:SignalTopicEditorialScreeningGroupV1):SignalTopicEditorialScreeningGroupV1{
  const group_key=bounded(value.group_key,"topic_editorial_group_invalid",256);
  if(!groupKeyPattern.test(group_key))return fail("topic_editorial_group_invalid");
  const evidence=value.evidence;
  if(!Array.isArray(evidence)||evidence.length<1||evidence.length>5)return fail("topic_editorial_evidence_invalid");
  const normalizedEvidence=evidence.map(item=>({ref_id:digest(item.ref_id,"topic_editorial_evidence_invalid"),
    text:bounded(item.text,"topic_editorial_evidence_invalid",800),
    locale:item.locale===null?null:bounded(item.locale,"topic_editorial_evidence_invalid",35),
    platform:item.platform===null?null:bounded(item.platform,"topic_editorial_evidence_invalid",100)}));
  if(new Set(normalizedEvidence.map(item=>item.ref_id)).size!==normalizedEvidence.length)return fail("topic_editorial_evidence_invalid");
  const counts=value.scope_counts;
  const scope_counts={brand:natural(counts.brand,"topic_editorial_group_invalid"),
    competitor:natural(counts.competitor,"topic_editorial_group_invalid"),
    category:natural(counts.category,"topic_editorial_group_invalid"),unknown:natural(counts.unknown,"topic_editorial_group_invalid")};
  const root_count=natural(value.root_count,"topic_editorial_group_invalid",10_000_000);
  if(root_count<1||Object.values(scope_counts).reduce((sum,count)=>sum+count,0)!==root_count)return fail("topic_editorial_group_invalid");
  const neighbors=value.neighbors.map(item=>({group_key:bounded(item.group_key,"topic_editorial_group_invalid",256),
    similarity:unit(item.similarity,"topic_editorial_group_invalid")}));
  if(neighbors.length>10||new Set(neighbors.map(item=>item.group_key)).size!==neighbors.length
    ||neighbors.some(item=>item.group_key===group_key||!groupKeyPattern.test(item.group_key)))return fail("topic_editorial_group_invalid");
  neighbors.sort((a,b)=>b.similarity-a.similarity||ascii(a.group_key,b.group_key));
  const chunk_count=natural(value.chunk_count,"topic_editorial_group_invalid",20_000_000);
  if(chunk_count<root_count)return fail("topic_editorial_group_invalid");
  return {group_key,group_digest:digest(value.group_digest,"topic_editorial_group_invalid"),
    dossier_digest:digest(value.dossier_digest,"topic_editorial_group_invalid"),
    community_key:bounded(value.community_key,"topic_editorial_group_invalid",256),root_count,
    chunk_count,
    terms:strings(value.terms,"topic_editorial_group_invalid",32,200),scope_counts,neighbors,evidence:normalizedEvidence};
}

const INSTRUCTIONS=`Eres editor de inteligencia de marca. Revisa cada grupo computacional exactamente una vez.
Decide si representa un Topic estable, una Narrative verificable, Noise fuera del contexto de la marca o un caso Unresolved.
No fuerces conversaciones irrelevantes dentro de un Topic. Usa las anclas positivas, negativas y de abstención como límites, no como etiquetas obligatorias.
Para Topic o Narrative propón un nombre y una definición claros en el idioma dominante de la evidencia. candidate_key es una propuesta local a este lote y debe comenzar con el batch_key indicado. Cita únicamente ref_id presentes en ese grupo.
Responde sólo con el objeto JSON del contrato solicitado. No omitas, dupliques ni inventes group_key.`;

export function buildSignalTopicEditorialScreeningPlanV1(args:{expected_group_count:number;context_digest:string;
  context:SignalTopicEditorialBrandContextV1;groups:SignalTopicEditorialScreeningGroupV1[];batch_size?:number}):SignalTopicEditorialScreeningPlanV1{
  const expected=natural(args.expected_group_count,"topic_editorial_plan_invalid",SIGNAL_TOPIC_EDITORIAL_SCREENING_MAX_GROUPS_V1);
  if(expected<1||args.groups.length!==expected)return fail("topic_editorial_plan_incomplete");
  const context_digest=digest(args.context_digest,"topic_editorial_context_invalid"),context=normalizeContext(args.context);
  if(signalTopicEditorialDigestV1(context)!==context_digest)return fail("topic_editorial_context_digest_invalid");
  const batchSize=natural(args.batch_size??SIGNAL_TOPIC_EDITORIAL_SCREENING_BATCH_SIZE_V1,"topic_editorial_plan_invalid",60);
  if(batchSize<10)return fail("topic_editorial_plan_invalid");
  const groups=args.groups.map(normalizeGroup).sort((a,b)=>ascii(a.community_key,b.community_key)||ascii(a.group_key,b.group_key));
  if(new Set(groups.map(group=>group.group_key)).size!==groups.length)return fail("topic_editorial_plan_invalid");
  const batches:SignalTopicEditorialScreeningBatchV1[]=[];
  for(let offset=0;offset<groups.length;offset+=batchSize){
    const batch_index=batches.length,items=groups.slice(offset,offset+batchSize),payload={contract_version:"signal-topic-editorial-screening-request-v1",
      batch_index,batch_key_prefix:`b${String(batch_index).padStart(4,"0")}-`,context_digest,context,groups:items};
    const prompt=`${INSTRUCTIONS}\n\nINPUT_JSON\n${stable(payload)}`;
    if(Buffer.byteLength(prompt,"utf8")>1_500_000)return fail("topic_editorial_batch_capacity_exceeded");
    const request_digest=signalTopicEditorialDigestV1({model:SIGNAL_TOPIC_EDITORIAL_SCREENING_MODEL_V1,prompt});
    batches.push({contract_version:"signal-topic-editorial-screening-batch-v1",batch_index,
      batch_key:`topic-consolidation-screen-v1:${batch_index}:${request_digest.slice(7,23)}`,request_digest,
      model:SIGNAL_TOPIC_EDITORIAL_SCREENING_MODEL_V1,context_digest,group_keys:items.map(item=>item.group_key),prompt});
  }
  const header={contract_version:"signal-topic-editorial-screening-plan-v1" as const,expected_group_count:expected,context_digest,
    model:SIGNAL_TOPIC_EDITORIAL_SCREENING_MODEL_V1,batch_size:batchSize,batches};
  return {...header,plan_digest:signalTopicEditorialDigestV1(header)};
}

export const signalTopicEditorialScreeningOutputSchemaV1=z.object({
  contract_version:z.literal("signal-topic-editorial-screening-output-v1"),batch_index:z.number().int().nonnegative(),
  decisions:z.array(z.object({group_key:z.string(),disposition:z.enum(["topic","narrative","noise","unresolved"]),
    candidate:z.object({candidate_key:z.string(),label:z.string(),definition:z.string(),locale:z.string()}).strict().nullable(),
    confidence:z.number().min(0).max(1).nullable(),rationale:z.string().nullable(),cited_ref_ids:z.array(z.string())}).strict()),
}).strict();
export type SignalTopicEditorialScreeningOutputV1=z.infer<typeof signalTopicEditorialScreeningOutputSchemaV1>;

export function validateSignalTopicEditorialScreeningOutputV1(batch:SignalTopicEditorialScreeningBatchV1,value:unknown,
  evidenceByGroup:ReadonlyMap<string,ReadonlySet<string>>):SignalTopicEditorialScreeningOutputV1{
  const parsed=signalTopicEditorialScreeningOutputSchemaV1.safeParse(value);
  if(!parsed.success||parsed.data.batch_index!==batch.batch_index||parsed.data.decisions.length!==batch.group_keys.length)
    return fail("topic_editorial_output_invalid");
  const expected=new Set(batch.group_keys),seen=new Set<string>();
  const decisions=parsed.data.decisions.map(decision=>{
    if(!expected.has(decision.group_key)||seen.has(decision.group_key))return fail("topic_editorial_output_coverage_invalid");
    seen.add(decision.group_key);
    const publishable=decision.disposition==="topic"||decision.disposition==="narrative";
    if(publishable!==Boolean(decision.candidate))return fail("topic_editorial_output_target_invalid");
    const candidate=decision.candidate===null?null:{candidate_key:bounded(decision.candidate.candidate_key,"topic_editorial_output_target_invalid",256),
      label:bounded(decision.candidate.label,"topic_editorial_output_target_invalid",160),
      definition:bounded(decision.candidate.definition,"topic_editorial_output_target_invalid",800),
      locale:bounded(decision.candidate.locale,"topic_editorial_output_target_invalid",35)};
    const candidatePrefix=`b${String(batch.batch_index).padStart(4,"0")}-`;
    if(candidate&&(!keyPattern.test(candidate.candidate_key)||!candidate.candidate_key.startsWith(candidatePrefix)))
      return fail("topic_editorial_output_target_invalid");
    const citations=strings(decision.cited_ref_ids,"topic_editorial_output_citation_invalid",5,71),allowed=evidenceByGroup.get(decision.group_key);
    if(!allowed||citations.some(ref=>!digestPattern.test(ref)||!allowed.has(ref))||publishable&&citations.length<1)
      return fail("topic_editorial_output_citation_invalid");
    return {...decision,candidate,rationale:decision.rationale===null?null:bounded(decision.rationale,"topic_editorial_output_invalid",500),
      cited_ref_ids:citations};
  }).sort((a,b)=>ascii(a.group_key,b.group_key));
  return {...parsed.data,decisions};
}

export function validateSignalTopicEditorialScreeningCoverageV1(plan:SignalTopicEditorialScreeningPlanV1,
  outputs:SignalTopicEditorialScreeningOutputV1[]){
  if(outputs.length!==plan.batches.length)return fail("topic_editorial_result_incomplete");
  const byIndex=new Map(outputs.map(output=>[output.batch_index,output]));
  const decisions=plan.batches.flatMap(batch=>{
    const output=byIndex.get(batch.batch_index);
    if(!output||output.decisions.length!==batch.group_keys.length
      ||output.decisions.some((decision,index)=>decision.group_key!==[...batch.group_keys].sort(ascii)[index]))
      return fail("topic_editorial_result_incomplete");
    return output.decisions;
  });
  if(decisions.length!==plan.expected_group_count||new Set(decisions.map(item=>item.group_key)).size!==plan.expected_group_count)
    return fail("topic_editorial_result_incomplete");
  return {contract_version:"signal-topic-editorial-screening-result-v1" as const,plan_digest:plan.plan_digest,
    group_count:decisions.length,topic_count:decisions.filter(item=>item.disposition==="topic").length,
    narrative_count:decisions.filter(item=>item.disposition==="narrative").length,
    noise_count:decisions.filter(item=>item.disposition==="noise").length,
    unresolved_count:decisions.filter(item=>item.disposition==="unresolved").length,decisions};
}

export const SIGNAL_TOPIC_EDITORIAL_GLOBAL_MAX_OUTPUT_TOKENS_V1=65_536;
export type SignalTopicEditorialScreeningResultV1=ReturnType<typeof validateSignalTopicEditorialScreeningCoverageV1>;
export type SignalTopicEditorialGlobalReviewV1={
  contract_version:"signal-topic-editorial-global-review-v1";screening_plan_digest:string;request_digest:string;
  model:typeof SIGNAL_TOPIC_EDITORIAL_SCREENING_MODEL_V1;group_count:number;prompt:string;
};
export type SignalTopicEditorialGlobalResultV1={
  contract_version:"signal-topic-editorial-global-result-v1";
  concepts:Array<{concept_key:string;kind:"topic"|"narrative";label:string;definition:string;locale:string;member_group_keys:string[]}>;
  noise_group_keys:string[];unresolved_group_keys:string[];
};

const GLOBAL_INSTRUCTIONS=`Eres el editor final del catálogo de inteligencia de marca. Recibes el resultado completo de una primera revisión y debes producir un catálogo corto y manejable.
Agrupa los grupos elegibles que expresen el mismo asunto estable o la misma narrativa verificable. Puedes separar una comunidad numérica o fusionar candidatos de comunidades distintas cuando los resúmenes lo justifiquen.
No conviertas Noise ni Unresolved de la primera revisión en contenido publicable: no recibes evidencia suficiente para hacerlo. Sí puedes bajar un candidato elegible a Noise o Unresolved.
Cada group_key debe aparecer exactamente una vez: como miembro de un concepto, en noise_group_keys o en unresolved_group_keys. Un Topic es un asunto estable; una Narrative es una afirmación o marco recurrente. No mezcles ambos tipos en el mismo concepto.
Usa nombres y definiciones claros en el idioma dominante. No inventes popularidad, sentimiento, causalidad ni hechos que no aparezcan en los resúmenes. Responde sólo con el JSON solicitado.`;

export function buildSignalTopicEditorialGlobalReviewV1(args:{plan:SignalTopicEditorialScreeningPlanV1;
  screening:SignalTopicEditorialScreeningResultV1;groups:SignalTopicEditorialScreeningGroupV1[]}):SignalTopicEditorialGlobalReviewV1{
  if(args.screening.plan_digest!==args.plan.plan_digest||args.screening.group_count!==args.plan.expected_group_count
    ||args.groups.length!==args.plan.expected_group_count)return fail("topic_editorial_global_input_invalid");
  const groups=args.groups.map(normalizeGroup),byGroup=new Map(groups.map(group=>[group.group_key,group]));
  if(byGroup.size!==groups.length)return fail("topic_editorial_global_input_invalid");
  const fixed_noise:string[]=[],fixed_unresolved:string[]=[],eligible:unknown[]=[];
  for(const decision of args.screening.decisions){
    const group=byGroup.get(decision.group_key);
    if(!group)return fail("topic_editorial_global_input_invalid");
    if(decision.disposition==="noise"){fixed_noise.push(decision.group_key);continue;}
    if(decision.disposition==="unresolved"){fixed_unresolved.push(decision.group_key);continue;}
    if(!decision.candidate)return fail("topic_editorial_global_input_invalid");
    eligible.push({group_key:decision.group_key,community_key:group.community_key,root_count:group.root_count,
      terms:group.terms,scope_counts:group.scope_counts,screening_disposition:decision.disposition,
      candidate:decision.candidate,confidence:decision.confidence,rationale:decision.rationale,
      cited_ref_ids:decision.cited_ref_ids,neighbors:group.neighbors});
  }
  const payload={contract_version:"signal-topic-editorial-global-request-v1",screening_plan_digest:args.plan.plan_digest,
    group_count:args.plan.expected_group_count,fixed_noise:fixed_noise.sort(ascii),fixed_unresolved:fixed_unresolved.sort(ascii),eligible};
  const prompt=`${GLOBAL_INSTRUCTIONS}\n\nINPUT_JSON\n${stable(payload)}`;
  if(Buffer.byteLength(prompt,"utf8")>4_000_000)return fail("topic_editorial_global_capacity_exceeded");
  return {contract_version:"signal-topic-editorial-global-review-v1",screening_plan_digest:args.plan.plan_digest,
    request_digest:signalTopicEditorialDigestV1({model:SIGNAL_TOPIC_EDITORIAL_SCREENING_MODEL_V1,prompt}),
    model:SIGNAL_TOPIC_EDITORIAL_SCREENING_MODEL_V1,group_count:args.plan.expected_group_count,prompt};
}

const globalOutputSchema=z.object({contract_version:z.literal("signal-topic-editorial-global-result-v1"),
  concepts:z.array(z.object({concept_key:z.string(),kind:z.enum(["topic","narrative"]),label:z.string(),definition:z.string(),
    locale:z.string(),member_group_keys:z.array(z.string())}).strict()),noise_group_keys:z.array(z.string()),
  unresolved_group_keys:z.array(z.string())}).strict();

export function validateSignalTopicEditorialGlobalResultV1(args:{review:SignalTopicEditorialGlobalReviewV1;
  screening:SignalTopicEditorialScreeningResultV1;value:unknown}):SignalTopicEditorialGlobalResultV1{
  const parsed=globalOutputSchema.safeParse(args.value);
  if(!parsed.success||args.review.screening_plan_digest!==args.screening.plan_digest
    ||args.review.group_count!==args.screening.group_count)return fail("topic_editorial_global_output_invalid");
  const eligible=new Set(args.screening.decisions.filter(item=>item.disposition==="topic"||item.disposition==="narrative").map(item=>item.group_key));
  const fixedNoise=new Set(args.screening.decisions.filter(item=>item.disposition==="noise").map(item=>item.group_key));
  const fixedUnresolved=new Set(args.screening.decisions.filter(item=>item.disposition==="unresolved").map(item=>item.group_key));
  const concepts=parsed.data.concepts.map(concept=>{
    const concept_key=bounded(concept.concept_key,"topic_editorial_global_concept_invalid",256),kind=concept.kind;
    if(!keyPattern.test(concept_key)||!concept_key.startsWith(`${kind}-`))return fail("topic_editorial_global_concept_invalid");
    const members=strings(concept.member_group_keys,"topic_editorial_global_members_invalid",5_000,256).sort(ascii);
    if(!members.length||members.some(member=>!eligible.has(member)||!groupKeyPattern.test(member)))
      return fail("topic_editorial_global_members_invalid");
    return {concept_key,kind,label:bounded(concept.label,"topic_editorial_global_concept_invalid",160),
      definition:bounded(concept.definition,"topic_editorial_global_concept_invalid",1200),
      locale:bounded(concept.locale,"topic_editorial_global_concept_invalid",35),member_group_keys:members};
  }).sort((a,b)=>ascii(a.concept_key,b.concept_key));
  if(concepts.length>500||new Set(concepts.map(item=>item.concept_key)).size!==concepts.length
    ||new Set(concepts.map(item=>item.label.normalize("NFKC").toLocaleLowerCase("und"))).size!==concepts.length)
    return fail("topic_editorial_global_concept_invalid");
  const noise=strings(parsed.data.noise_group_keys,"topic_editorial_global_coverage_invalid",5_000,256).sort(ascii),
    unresolved=strings(parsed.data.unresolved_group_keys,"topic_editorial_global_coverage_invalid",5_000,256).sort(ascii);
  if([...fixedNoise].some(key=>!noise.includes(key))||[...fixedUnresolved].some(key=>!unresolved.includes(key)))
    return fail("topic_editorial_global_fixed_disposition_invalid");
  const assigned=concepts.flatMap(item=>item.member_group_keys),all=[...assigned,...noise,...unresolved];
  if(all.length!==args.screening.group_count||new Set(all).size!==all.length
    ||all.some(key=>!eligible.has(key)&&!fixedNoise.has(key)&&!fixedUnresolved.has(key)))
    return fail("topic_editorial_global_coverage_invalid");
  return {contract_version:"signal-topic-editorial-global-result-v1",concepts,noise_group_keys:noise,unresolved_group_keys:unresolved};
}
