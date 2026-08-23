import { createHash } from "node:crypto";

import { SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V2 } from "@noisia/query-engine";
import {
  appendSignalSemanticContextProposalsV1 as appendSignalSemanticContextProposalsDbV1,
  loadLatestSignalSemanticContextProposalRunForGenerationV1,
  loadSignalSemanticContextProposalPreflightRuntimeV1,
  loadSignalSemanticContextProposalRunV1,
  revalidateSignalSemanticContextPaidResponseV1,
  retrySignalSemanticContextProposalRunV1,
  signalSemanticContextProposalRuntimeConfigurationFromEnvV1,
  startSignalSemanticContextProposalRunV1
} from "@noisia/db";

import type { SignalBrandPolicyQueryable } from "@/lib/data-os/signal-governed-brand-policy";
import { withSignalAcquisitionTransactionV1 } from "@/lib/data-os/signal-acquisition-plan";
import {
  beginSignalProductOperationV1,
  completeSignalProductOperationV1
} from "@/lib/data-os/signal-product-operation";
import type { ResolvedSignalWorkspace, SignalWorkspaceUser } from "@/lib/data-os/signal-workspace";

export const SIGNAL_SEMANTIC_CONTEXT_PACK_CONTRACT_VERSION = "signal-semantic-context-pack-v1" as const;
export const SIGNAL_SEMANTIC_CONTEXT_PREFLIGHT_CONTRACT_VERSION =
  "signal-semantic-context-pack-preflight-v1" as const;

export const SIGNAL_SEMANTIC_CONTEXT_ELEMENT_KINDS = [
  "identity_term","alias","product","feature","surface","category","need","benefit",
  "friction","usage_occasion","competitor_term","locale_variant","exclusion","homonym",
  "ambiguous_term","abstention_rule","positive_anchor","negative_anchor","boundary_anchor",
  "typed_relation"
] as const;
export const SIGNAL_SEMANTIC_CONTEXT_RELATION_KINDS = [
  "is_a","part_of","surface_of","competes_with","associated_with"
] as const;
export const SIGNAL_SEMANTIC_CONTEXT_RECONCILIATION_REASONS = [
  "brand_os_drift","knowledge_drift","locale_market_drift","provider_lineage_missing",
  "provider_lineage_changed","operator_requested_reconciliation"
] as const;
export const SIGNAL_SEMANTIC_CONTEXT_SOURCE_TYPES = [
  "brand_os_profile","brand_os_product","brand_os_competitor","brand_os_seed_term",
  "knowledge_source","knowledge_chunk","knowledge_assertion"
] as const;

export type SignalSemanticContextElementKindV1 = typeof SIGNAL_SEMANTIC_CONTEXT_ELEMENT_KINDS[number];
export type SignalSemanticContextRelationKindV1 = typeof SIGNAL_SEMANTIC_CONTEXT_RELATION_KINDS[number];
export type SignalSemanticContextReconciliationReasonV1 =
  typeof SIGNAL_SEMANTIC_CONTEXT_RECONCILIATION_REASONS[number];
export type SignalSemanticContextSourceTypeV1 = typeof SIGNAL_SEMANTIC_CONTEXT_SOURCE_TYPES[number];
export type SignalSemanticContextSourceRefV1 = {
  source_type: SignalSemanticContextSourceTypeV1;
  source_id: string;
  relation_type: "supports" | "limits" | "contradicts";
};
export type SignalSemanticContextProposalV1 = {
  element_key: string;
  element_kind: SignalSemanticContextElementKindV1;
  canonical_key: string;
  display_text: string;
  scope: string | null;
  entity_type: string | null;
  entity_id: string | null;
  locale: string | null;
  relation_kind: SignalSemanticContextRelationKindV1 | null;
  relation_target_key: string | null;
  confidence: number | null;
  origin_kind: "server_projection" | "provider_proposal";
  source_refs: SignalSemanticContextSourceRefV1[];
};

type Authority = {
  brandOsProfileId:string;brandOsProfileVersion:number;brandOsDigest:string;
  knowledgeGenerationKey:string;knowledgeDigest:string;localeContextDigest:string;
  primaryLocale:string;localeVariants:string[];markets:string[];timezone:string;
  sourceAuthorityDigest:string;
};
type GenerationRow = {
  id:string;artifact_id:string;generation_key:string;generation_version:number;status:"draft"|"published";
  supersedes_generation_id:string|null;supersession_reason:SignalSemanticContextReconciliationReasonV1|null;
  brand_os_profile_id:string;brand_os_profile_version:number;
  brand_os_digest:string;knowledge_generation_key:string;knowledge_digest:string;
  locale_context_digest:string;primary_locale:string;locale_variants:string[];markets:string[];
  timezone:string;draft_digest:string;pack_digest:string|null;created_at:Date|string;published_at:Date|string|null;
  proposal_model:string|null;proposal_model_version:string|null;proposal_prompt_digest:string|null;
  proposal_pricing_version:string|null;
};
type ElementRow = {
  id:string;artifact_id:string;evidence_group_id:string;element_key:string;element_version:number;
  element_kind:SignalSemanticContextElementKindV1;canonical_key:string;display_text:string;
  scope:string|null;entity_type:string|null;entity_id:string|null;locale:string|null;
  relation_kind:SignalSemanticContextRelationKindV1|null;relation_target_key:string|null;
  confidence:string|null;disposition:"pending"|"approved"|"rejected";origin_kind:string;
  supersedes_element_id:string|null;original_proposal_element_id:string|null;
  source_refs_digest:string;element_digest:string;source_ref_count:number;
  proposed_by_user_id:string|null;decided_by_user_id:string|null;
  proposed_at:Date|string;decided_at:Date|string|null;created_at:Date|string;
};

export class SignalSemanticContextPackError extends Error {
  constructor(public readonly code:string,public readonly status=409){super(code);}
}

export async function loadSignalSemanticContextReadinessV1(args:{
  queryable:SignalBrandPolicyQueryable;workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;
}){
  assertInternal(args.actor);
  const [live,generations]=await Promise.all([
    resolveLiveAuthorityV1(args),
    args.queryable.query<GenerationRow>(`${generationSelect}
      WHERE generation.workspace_id=$1::uuid AND NOT EXISTS(
        SELECT 1 FROM signal_semantic_context_generations successor
        WHERE successor.supersedes_generation_id=generation.id)
      ORDER BY generation.generation_version DESC`,[args.workspace.id])
  ]);
  const published=generations.rows.find((row)=>row.status==="published");
  const draft=generations.rows.find((row)=>row.status==="draft");
  const selected=published??draft??null;
  const counts=selected?await loadCurrentCounts(args.queryable,selected.id):emptyCounts();
  const drift=selected?compareAuthority(selected,live):[];
  const ready=Boolean(published&&selected===published&&drift.length===0&&counts.approved>0
    &&counts.pending===0&&published.pack_digest);
  return{
    contract_version:SIGNAL_SEMANTIC_CONTEXT_PACK_CONTRACT_VERSION,
    brand_os_digest:live.brandOsDigest,
    knowledge_digest:live.knowledgeDigest,
    semantic_context_pack_digest:published?.pack_digest??null,
    lifecycle_state:selected?.status??"not_available",
    generation:selected?publicGeneration(selected,counts):null,
    open_draft:draft?{generation_key:draft.generation_key,generation_version:draft.generation_version,
      counts:await loadCurrentCounts(args.queryable,draft.id)}:null,
    counts,locale_market_coverage:{primary_locale:live.primaryLocale,
      locales:live.localeVariants,markets:live.markets,timezone:live.timezone},
    drift_state:selected?(drift.length===0?"current":"stale"):"not_available",
    drift_reasons:drift,
    ready_for_context_aware_discovery:ready,
    limitations:ready?[]:[published?"semantic_context_pack_not_reconciled":"published_context_pack_required"]
  } as const;
}

export async function loadSignalSemanticContextGenerationV1(args:{
  queryable:SignalBrandPolicyQueryable;workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;
  generationKey?:string;
}){
  assertInternal(args.actor);
  const generation=await loadGeneration(args.queryable,args.workspace.id,args.generationKey);
  if(!generation)throw new SignalSemanticContextPackError("semantic_context_generation_not_found",404);
  const current=await loadCurrentElements(args.queryable,generation.id);
  const links=current.length?await args.queryable.query<{evidence_group_id:string;source_type:string;
    source_id:string;relation_type:string}>(`SELECT evidence_group_id::text,source_type,
      source_id::text,relation_type FROM analysis_evidence_links
    WHERE evidence_group_id=ANY($1::uuid[]) ORDER BY evidence_group_id,position,id`,
  [current.map((element)=>element.evidence_group_id)]):{rows:[],rowCount:0};
  const refsByGroup=new Map<string,Array<{source_type:string;source_ref:string;relation_type:string}>>();
  for(const link of links.rows){const refs=refsByGroup.get(link.evidence_group_id)??[];
    refs.push({source_type:link.source_type,source_ref:sha256(link.source_id),relation_type:link.relation_type});
    refsByGroup.set(link.evidence_group_id,refs);}
  const latestProposalRun=await loadLatestSignalSemanticContextProposalRunForGenerationV1({
    queryable:args.queryable as never,workspace:proposalWorkspace(args.workspace),actor:proposalActor(args.actor),
    generation_key:generation.generation_key});
  return{contract_version:SIGNAL_SEMANTIC_CONTEXT_PACK_CONTRACT_VERSION,
    generation:publicGeneration(generation,countRows(current)),
    elements:current.map((element)=>publicElement(element,refsByGroup.get(element.evidence_group_id)??[])),
    latest_proposal_run:latestProposalRun,
    source_authority:{brand_os_digest:generation.brand_os_digest,
      knowledge_digest:generation.knowledge_digest,locale_context_digest:generation.locale_context_digest}} as const;
}

export async function loadSignalSemanticContextDiffV1(args:{
  queryable:SignalBrandPolicyQueryable;workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;
  generationKey?:string;
}){
  assertInternal(args.actor);
  const generation=await loadGeneration(args.queryable,args.workspace.id,args.generationKey);
  const live=await resolveLiveAuthorityV1(args);
  return{contract_version:"signal-semantic-context-diff-v1",generation_key:generation?.generation_key??null,
    drift_state:generation&&compareAuthority(generation,live).length===0?"current":"stale",
    reasons:generation?compareAuthority(generation,live):["generation_missing"],
    current:{brand_os_digest:live.brandOsDigest,knowledge_digest:live.knowledgeDigest,
      locale_context_digest:live.localeContextDigest},
    sealed:generation?{brand_os_digest:generation.brand_os_digest,
      knowledge_digest:generation.knowledge_digest,locale_context_digest:generation.locale_context_digest}:null};
}

export async function loadSignalSemanticContextProposalPreflightV1(args:{
  queryable:SignalBrandPolicyQueryable;workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;
  configuration:SignalSemanticContextProviderConfigurationV1;
}){
  const [readiness,live]=await Promise.all([
    loadSignalSemanticContextReadinessV1(args),resolveLiveAuthorityV1(args)
  ]);
  const draft=await loadGeneration(args.queryable,args.workspace.id,undefined,"draft");
  const config=validateProviderConfiguration(args.configuration);
  const estimated=((config.max_input_tokens*config.input_usd_per_million_tokens)
    +(config.max_output_tokens*config.output_usd_per_million_tokens))/1_000_000;
  const blockers:string[]=[];
  if(!draft)blockers.push("semantic_context_draft_required");
  if(!config.available)blockers.push("provider_configuration_unavailable");
  if(draft&&compareAuthority(draft,live).length)blockers.push("semantic_context_draft_stale");
  if(draft&&(!draft.proposal_model||!draft.proposal_model_version||!draft.proposal_prompt_digest
      ||!draft.proposal_pricing_version))blockers.push("provider_lineage_required");
  if(draft&&config.available&&(draft.proposal_model!==config.model
      ||draft.proposal_model_version!==config.model_version
      ||draft.proposal_prompt_digest!==config.prompt_template_digest
      ||draft.proposal_pricing_version!==config.pricing_version))blockers.push("provider_lineage_drift");
  if(estimated>config.hard_cap_usd)blockers.push("hard_cap_insufficient");
  return{contract_version:SIGNAL_SEMANTIC_CONTEXT_PREFLIGHT_CONTRACT_VERSION,
    readiness:blockers.length===0?"ready":"blocked",blockers,
    generation_key:draft?.generation_key??null,context_authority:{
      brand_os_digest:readiness.brand_os_digest,knowledge_digest:readiness.knowledge_digest,
      locale_context_digest:draft?.locale_context_digest??null},maximum_provider_calls:1,
    provider:{key:config.provider,model:config.model,model_version:config.model_version,
      pricing_version:config.pricing_version,prompt_template_digest:config.prompt_template_digest},
    budget:{estimated_max_cost_usd:estimated.toFixed(6),hard_cap_usd:config.hard_cap_usd.toFixed(6),
      within_hard_cap:estimated<=config.hard_cap_usd},writes_performed:false,provider_calls:0};
}

export type SignalSemanticContextProviderConfigurationV1={
  available:boolean;provider:string;model:string;model_version:string;pricing_version:string;
  prompt_template_digest:string;max_input_tokens:number;max_output_tokens:number;
  input_usd_per_million_tokens:number;output_usd_per_million_tokens:number;hard_cap_usd:number;
};

export function signalSemanticContextProviderConfigurationFromEnvV1(
  env:Record<string,string|undefined>=process.env
):SignalSemanticContextProviderConfigurationV1{
  const provider=env.NOISIA_SEMANTIC_CONTEXT_PROVIDER?.trim()??"anthropic";
  const model=env.NOISIA_SEMANTIC_CONTEXT_MODEL?.trim()??"";
  const modelVersion=env.NOISIA_SEMANTIC_CONTEXT_MODEL_VERSION?.trim()??"";
  const pricing=env.NOISIA_SEMANTIC_CONTEXT_PRICING_VERSION?.trim()??"";
  const prompt=SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V2;
  const numeric=(key:string)=>{const value=Number(env[key]);return Number.isFinite(value)?value:0;};
  const config={available:false,provider,model,model_version:modelVersion,pricing_version:pricing,
    prompt_template_digest:prompt,max_input_tokens:numeric("NOISIA_SEMANTIC_CONTEXT_MAX_INPUT_TOKENS"),
    max_output_tokens:numeric("NOISIA_SEMANTIC_CONTEXT_MAX_OUTPUT_TOKENS"),
    input_usd_per_million_tokens:numeric("NOISIA_SEMANTIC_CONTEXT_INPUT_USD_PER_MILLION_TOKENS"),
    output_usd_per_million_tokens:numeric("NOISIA_SEMANTIC_CONTEXT_OUTPUT_USD_PER_MILLION_TOKENS"),
    hard_cap_usd:numeric("NOISIA_SEMANTIC_CONTEXT_HARD_CAP_USD")};
  return{...config,available:Boolean(model&&modelVersion&&pricing&&digestPattern.test(prompt)
    &&config.max_input_tokens>0&&config.max_output_tokens>0
    &&config.input_usd_per_million_tokens>=0&&config.output_usd_per_million_tokens>=0
    &&config.hard_cap_usd>0)};
}

export async function createSignalSemanticContextDraftV1(args:{
  queryable:SignalBrandPolicyQueryable;workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;
  idempotencyKey:string;proposalLineage?:{model:string;model_version:string;prompt_digest:string;pricing_version:string};
}){
  assertInternal(args.actor);
  if(args.proposalLineage&&(!args.proposalLineage.model.trim()||!args.proposalLineage.model_version.trim()
      ||!digestPattern.test(args.proposalLineage.prompt_digest)||!args.proposalLineage.pricing_version.trim())){
    throw new SignalSemanticContextPackError("semantic_context_provider_lineage_invalid",422);
  }
  await lockWorkspace(args.queryable,args.workspace.id);
  const operation=await beginSignalProductOperationV1<{generation_key:string;generation_version:number;status:"draft"}>({
    ...args,action:"create-semantic-context-draft",input:{contract_version:SIGNAL_SEMANTIC_CONTEXT_PACK_CONTRACT_VERSION,
      proposal_lineage:args.proposalLineage??null}
  });
  if(operation.replay)return operation.replay;
  const live=await resolveLiveAuthorityV1(args);
  const existing=await loadGeneration(args.queryable,args.workspace.id);
  if(existing)throw new SignalSemanticContextPackError("semantic_context_draft_exists");
  const inserted=await insertDraftGenerationV1({queryable:args.queryable,workspaceId:args.workspace.id,
    actorId:args.actor.id,operationId:operation.operationId,live,proposalLineage:args.proposalLineage,
    predecessor:null,reason:null});
  await insertEvent(args.queryable,{workspaceId:args.workspace.id,generationId:inserted.rows[0]!.id,
    operationId:operation.operationId,eventIndex:0,eventKind:"generation_created",previous:null,
    next:inserted.rows[0]!.draft_digest,actorId:args.actor.id});
  const result={generation_key:inserted.rows[0]!.generation_key,
    generation_version:inserted.rows[0]!.generation_version,status:"draft" as const};
  await completeSignalProductOperationV1({queryable:args.queryable,workspaceId:args.workspace.id,
    key:operation.key,result});return result;
}

export async function reconcileSignalSemanticContextGenerationV1(args:{
  queryable:SignalBrandPolicyQueryable;workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;
  idempotencyKey:string;reason:SignalSemanticContextReconciliationReasonV1;
  proposalLineage:{model:string;model_version:string;prompt_digest:string;pricing_version:string};
}){
  assertInternal(args.actor);
  if(!SIGNAL_SEMANTIC_CONTEXT_RECONCILIATION_REASONS.includes(args.reason)
      ||!args.proposalLineage.model.trim()||!args.proposalLineage.model_version.trim()
      ||!digestPattern.test(args.proposalLineage.prompt_digest)
      ||!args.proposalLineage.pricing_version.trim()){
    throw new SignalSemanticContextPackError("semantic_context_reconciliation_invalid",422);
  }
  await lockWorkspace(args.queryable,args.workspace.id);
  const operation=await beginSignalProductOperationV1<{outcome:"created"|"noop";
    generation_key:string;generation_version:number;status:"draft"|"published"}>({...args,
      action:"reconcile-semantic-context-generation",input:{
        contract_version:"signal-semantic-context-reconciliation-v1",reason:args.reason}
  });
  if(operation.replay)return operation.replay;
  const live=await resolveLiveAuthorityV1(args);
  const current=await loadGeneration(args.queryable,args.workspace.id);
  if(!current)throw new SignalSemanticContextPackError("semantic_context_generation_not_found",404);
  const authorityReasons=compareAuthority(current,live);
  const providerReason=!current.proposal_model||!current.proposal_model_version
      ||!current.proposal_prompt_digest||!current.proposal_pricing_version
    ?"provider_lineage_missing"
    :current.proposal_model!==args.proposalLineage.model
      ||current.proposal_model_version!==args.proposalLineage.model_version
      ||current.proposal_prompt_digest!==args.proposalLineage.prompt_digest
      ||current.proposal_pricing_version!==args.proposalLineage.pricing_version
      ?"provider_lineage_changed":null;
  const actualReasons=[...authorityReasons,...(providerReason?[providerReason]:[])];
  if(actualReasons.length===0){const result={outcome:"noop" as const,
      generation_key:current.generation_key,generation_version:current.generation_version,
      status:current.status};
    await completeSignalProductOperationV1({queryable:args.queryable,workspaceId:args.workspace.id,
      key:operation.key,result});return result;}
  if(args.reason!=="operator_requested_reconciliation"&&!actualReasons.includes(args.reason)){
    throw new SignalSemanticContextPackError("semantic_context_reconciliation_reason_mismatch",422);
  }
  const activeRun=await args.queryable.query<{status:string}>(`
    SELECT status FROM signal_semantic_context_proposal_runs
    WHERE workspace_id=$1::uuid AND generation_id=$2::uuid
      AND status IN ('queued','processing','validating') LIMIT 1`,[args.workspace.id,current.id]);
  if(activeRun.rows[0])throw new SignalSemanticContextPackError("semantic_context_proposal_run_active");
  const inserted=await insertDraftGenerationV1({queryable:args.queryable,workspaceId:args.workspace.id,
    actorId:args.actor.id,operationId:operation.operationId,live,
    proposalLineage:args.proposalLineage,predecessor:current,reason:args.reason});
  await insertEvent(args.queryable,{workspaceId:args.workspace.id,generationId:inserted.rows[0]!.id,
    operationId:operation.operationId,eventIndex:0,eventKind:"generation_reconciled",
    previous:current.pack_digest??current.draft_digest,next:inserted.rows[0]!.draft_digest,
    actorId:args.actor.id});
  const result={outcome:"created" as const,generation_key:inserted.rows[0]!.generation_key,
    generation_version:inserted.rows[0]!.generation_version,status:"draft" as const};
  await completeSignalProductOperationV1({queryable:args.queryable,workspaceId:args.workspace.id,
    key:operation.key,result});return result;
}

async function insertDraftGenerationV1(args:{queryable:SignalBrandPolicyQueryable;workspaceId:string;
  actorId:string;operationId:string;live:Authority;
  proposalLineage?:{model:string;model_version:string;prompt_digest:string;pricing_version:string};
  predecessor:GenerationRow|null;reason:SignalSemanticContextReconciliationReasonV1|null;
}){
  const history=await args.queryable.query<{version:number}>(`
    SELECT COALESCE(max(generation_version),0)::int version
    FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid`,[args.workspaceId]);
  const version=(history.rows[0]?.version??0)+1;
  if(args.predecessor&&args.predecessor.generation_version!==version-1){
    throw new SignalSemanticContextPackError("semantic_context_generation_conflict");
  }
  const generationKey=`semantic-context-v${version}`;
  const draftDigest=sha256(stableJson({contract_version:SIGNAL_SEMANTIC_CONTEXT_PACK_CONTRACT_VERSION,
    generation_key:generationKey,source_authority_digest:args.live.sourceAuthorityDigest,elements:[]}));
  const artifact=await args.queryable.query<{id:string}>(`
    INSERT INTO analysis_artifacts(workspace_id,workspace_artifact_kind,workspace_authority_digest,
      artifact_key,artifact_type,content,review_status,revision,metadata)
    VALUES($1::uuid,'semantic_context',$2,$3,'semantic_context_pack_generation',$4::jsonb,
      'needs_review',1,$5::jsonb) RETURNING id::text`,[args.workspaceId,args.live.sourceAuthorityDigest,
      generationKey,JSON.stringify({contract_version:SIGNAL_SEMANTIC_CONTEXT_PACK_CONTRACT_VERSION,
        generation_version:version,lifecycle_state:"draft"}),JSON.stringify({authority_only:true})]);
  return args.queryable.query<{id:string;generation_key:string;generation_version:number;draft_digest:string}>(`
    INSERT INTO signal_semantic_context_generations(workspace_id,artifact_id,generation_key,
      generation_version,status,supersedes_generation_id,supersession_reason,brand_os_profile_id,
      brand_os_profile_version,brand_os_digest,knowledge_generation_key,knowledge_digest,
      locale_context_digest,primary_locale,locale_variants,markets,timezone,proposal_model,
      proposal_model_version,proposal_prompt_digest,proposal_pricing_version,draft_digest,
      created_operation_id,created_by_user_id)
    VALUES($1::uuid,$2::uuid,$3,$4,'draft',$5::uuid,$6,$7::uuid,$8,$9,$10,$11,$12,$13,
      $14::text[],$15::text[],$16,$17,$18,$19,$20,$21,$22::uuid,$23::uuid)
    RETURNING id::text,generation_key,generation_version,draft_digest`,[args.workspaceId,
      artifact.rows[0]!.id,generationKey,version,args.predecessor?.id??null,args.reason,
      args.live.brandOsProfileId,args.live.brandOsProfileVersion,args.live.brandOsDigest,
      args.live.knowledgeGenerationKey,args.live.knowledgeDigest,args.live.localeContextDigest,
      args.live.primaryLocale,args.live.localeVariants,args.live.markets,args.live.timezone,
      args.proposalLineage?.model??null,args.proposalLineage?.model_version??null,
      args.proposalLineage?.prompt_digest??null,args.proposalLineage?.pricing_version??null,
      draftDigest,args.operationId,args.actorId]);
}

/** Server-owned boundary for deterministic projections or a future bounded provider adapter. */
export async function appendSignalSemanticContextProposalsV1(args:{
  queryable:SignalBrandPolicyQueryable;workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;
  idempotencyKey:string;generationKey:string;proposals:SignalSemanticContextProposalV1[];
}){
  assertInternal(args.actor);validateProposals(args.proposals);
  if(args.workspace.subject.type!=="brand")throw new SignalSemanticContextPackError("brand_workspace_required",422);
  try{return await appendSignalSemanticContextProposalsDbV1({queryable:args.queryable as never,
    workspace:{id:args.workspace.id,organization_id:args.workspace.organizationId,
      brand_id:args.workspace.subject.id},actor:{id:args.actor.id,user_type:"noisia_internal"},
    idempotency_key:args.idempotencyKey,generation_key:args.generationKey,
    proposals:args.proposals});}
  catch(error){if(error instanceof Error&&"code" in error)throw new SignalSemanticContextPackError(
    String((error as {code:unknown}).code),"status" in error?Number((error as {status:unknown}).status):409);
    throw error;}
}

export async function decideSignalSemanticContextElementV1(args:{
  queryable:SignalBrandPolicyQueryable;workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;
  idempotencyKey:string;generationKey:string;elementKey:string;action:"approve"|"reject"|"edit";
  edit?:{canonical_key:string;display_text:string;scope?:string|null;entity_type?:string|null;
    entity_id?:string|null;locale:string|null;relation_kind:SignalSemanticContextRelationKindV1|null;
    relation_target_key:string|null};
}){
  assertInternal(args.actor);await lockWorkspace(args.queryable,args.workspace.id);
  if(args.action==="edit"&&!args.edit)throw new SignalSemanticContextPackError("semantic_context_edit_required",422);
  if(args.action!=="edit"&&args.edit)throw new SignalSemanticContextPackError("semantic_context_edit_forbidden",422);
  const operation=await beginSignalProductOperationV1<{element_key:string;element_version:number;disposition:string}>({
    ...args,action:"decide-semantic-context-element",input:{generation_key:args.generationKey,
      element_key:args.elementKey,action:args.action,edit:args.edit??null}
  });if(operation.replay)return operation.replay;
  const generation=await requireDraft(args.queryable,args.workspace.id,args.generationKey);
  const current=await loadCurrentElement(args.queryable,generation.id,args.elementKey);
  if(!current)throw new SignalSemanticContextPackError("semantic_context_element_not_found",404);
  if(current.disposition!=="pending")throw new SignalSemanticContextPackError("semantic_context_element_not_pending");
  const created=await createDecisionSuccessor(args.queryable,{workspaceId:args.workspace.id,generation,current,
    action:args.action,edit:args.edit,operationId:operation.operationId,actorId:args.actor.id});
  const draftDigest=await refreshDraftDigest(args.queryable,generation);
  await insertEvent(args.queryable,{workspaceId:args.workspace.id,generationId:generation.id,
    elementId:created.id,operationId:operation.operationId,eventIndex:0,
    eventKind:args.action==="approve"?"element_approved":args.action==="reject"?"element_rejected":"element_corrected",
    previous:current.element_digest,next:created.elementDigest,actorId:args.actor.id});
  const result={element_key:current.element_key,element_version:current.element_version+1,
    disposition:created.disposition,draft_digest:draftDigest};
  await completeSignalProductOperationV1({queryable:args.queryable,workspaceId:args.workspace.id,
    key:operation.key,result});return result;
}

export async function bulkApproveSignalSemanticContextElementsV1(args:{
  queryable:SignalBrandPolicyQueryable;workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;
  idempotencyKey:string;generationKey:string;elementKeys:string[];
}){
  assertInternal(args.actor);const keys=[...new Set(args.elementKeys)].sort();
  if(keys.length<1||keys.length>100)throw new SignalSemanticContextPackError("semantic_context_bulk_scope_invalid",422);
  await lockWorkspace(args.queryable,args.workspace.id);
  const operation=await beginSignalProductOperationV1<{generation_key:string;approved:number;draft_digest:string}>({
    ...args,action:"bulk-approve-semantic-context-elements",input:{generation_key:args.generationKey,element_keys:keys}
  });if(operation.replay)return operation.replay;
  const generation=await requireDraft(args.queryable,args.workspace.id,args.generationKey);
  const created:string[]=[];
  for(const key of keys){const current=await loadCurrentElement(args.queryable,generation.id,key);
    if(!current||current.disposition!=="pending")throw new SignalSemanticContextPackError("semantic_context_bulk_element_invalid");
    const next=await createDecisionSuccessor(args.queryable,{workspaceId:args.workspace.id,generation,current,
      action:"approve",operationId:operation.operationId,actorId:args.actor.id});created.push(next.id);}
  const draftDigest=await refreshDraftDigest(args.queryable,generation);
  await insertEvent(args.queryable,{workspaceId:args.workspace.id,generationId:generation.id,
    operationId:operation.operationId,eventIndex:0,eventKind:"elements_bulk_approved",
    previous:generation.draft_digest,next:draftDigest,actorId:args.actor.id});
  const result={generation_key:generation.generation_key,approved:created.length,draft_digest:draftDigest};
  await completeSignalProductOperationV1({queryable:args.queryable,workspaceId:args.workspace.id,
    key:operation.key,result});return result;
}

export async function publishSignalSemanticContextGenerationV1(args:{
  queryable:SignalBrandPolicyQueryable;workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;
  idempotencyKey:string;generationKey:string;
}){
  assertInternal(args.actor);await lockWorkspace(args.queryable,args.workspace.id);
  const operation=await beginSignalProductOperationV1<{generation_key:string;generation_version:number;
    lifecycle_state:"published";semantic_context_pack_digest:string}>({...args,
      action:"publish-semantic-context-generation",input:{generation_key:args.generationKey}
  });if(operation.replay)return operation.replay;
  const generation=await requireDraft(args.queryable,args.workspace.id,args.generationKey);
  const live=await resolveLiveAuthorityV1(args);const drift=compareAuthority(generation,live);
  if(drift.length)throw new SignalSemanticContextPackError("semantic_context_authority_drift");
  const elements=await loadCurrentElements(args.queryable,generation.id);const counts=countRows(elements);
  if(counts.pending>0||counts.approved<1)throw new SignalSemanticContextPackError("semantic_context_not_publishable");
  const approved=elements.filter((element)=>element.disposition==="approved").sort(elementSort);
  if(new Set(approved.map((element)=>`${element.element_kind}:${element.canonical_key}:${element.locale??""}`)).size
      !==approved.length)throw new SignalSemanticContextPackError("semantic_context_approved_key_collision");
  const packDigest=sha256(stableJson({contract_version:SIGNAL_SEMANTIC_CONTEXT_PACK_CONTRACT_VERSION,
    generation_key:generation.generation_key,source_authority:live.sourceAuthorityDigest,
    elements:approved.map(packElement)}));
  const draftDigest=await refreshDraftDigest(args.queryable,generation);
  const updated=await args.queryable.query(`UPDATE signal_semantic_context_generations SET
    status='published',draft_digest=$3,pack_digest=$4,published_operation_id=$5::uuid,
    published_by_user_id=$6::uuid,published_at=clock_timestamp()
    WHERE id=$1::uuid AND workspace_id=$2::uuid AND status='draft'`,[generation.id,args.workspace.id,
      draftDigest,packDigest,operation.operationId,args.actor.id]);
  if(updated.rowCount!==1)throw new SignalSemanticContextPackError("semantic_context_publish_conflict");
  await insertEvent(args.queryable,{workspaceId:args.workspace.id,generationId:generation.id,
    operationId:operation.operationId,eventIndex:0,eventKind:"generation_published",
    previous:draftDigest,next:packDigest,actorId:args.actor.id});
  const result={generation_key:generation.generation_key,generation_version:generation.generation_version,
    lifecycle_state:"published" as const,semantic_context_pack_digest:packDigest};
  await completeSignalProductOperationV1({queryable:args.queryable,workspaceId:args.workspace.id,
    key:operation.key,result});return result;
}

export async function createSignalSemanticContextDraftProductV1(args:Omit<Parameters<typeof createSignalSemanticContextDraftV1>[0],"queryable"|"proposalLineage">){
  const config=signalSemanticContextProposalRuntimeConfigurationFromEnvV1();
  const proposalLineage=config.available?{model:config.model,model_version:config.model_version,
    prompt_digest:SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V2,
    pricing_version:config.pricing_version}:undefined;
  return withSignalAcquisitionTransactionV1((queryable)=>createSignalSemanticContextDraftV1({
    ...args,queryable,proposalLineage}));
}
export async function reconcileSignalSemanticContextGenerationProductV1(args:Omit<
  Parameters<typeof reconcileSignalSemanticContextGenerationV1>[0],"queryable"|"proposalLineage">){
  const config=signalSemanticContextProposalRuntimeConfigurationFromEnvV1();
  if(!config.available)throw new SignalSemanticContextPackError("provider_configuration_unavailable");
  return withSignalAcquisitionTransactionV1((queryable)=>reconcileSignalSemanticContextGenerationV1({
    ...args,queryable,proposalLineage:{model:config.model,model_version:config.model_version,
      prompt_digest:SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V2,
      pricing_version:config.pricing_version}}));
}
export async function decideSignalSemanticContextElementProductV1(args:Omit<Parameters<typeof decideSignalSemanticContextElementV1>[0],"queryable">){
  return withSignalAcquisitionTransactionV1((queryable)=>decideSignalSemanticContextElementV1({...args,queryable}));
}
export async function bulkApproveSignalSemanticContextElementsProductV1(args:Omit<Parameters<typeof bulkApproveSignalSemanticContextElementsV1>[0],"queryable">){
  return withSignalAcquisitionTransactionV1((queryable)=>bulkApproveSignalSemanticContextElementsV1({...args,queryable}));
}
export async function publishSignalSemanticContextGenerationProductV1(args:Omit<Parameters<typeof publishSignalSemanticContextGenerationV1>[0],"queryable">){
  return withSignalAcquisitionTransactionV1((queryable)=>publishSignalSemanticContextGenerationV1({...args,queryable}));
}
export async function loadSignalSemanticContextReadinessProductV1(args:Omit<Parameters<typeof loadSignalSemanticContextReadinessV1>[0],"queryable">){
  const{pool}=await import("@/lib/db");return loadSignalSemanticContextReadinessV1({...args,queryable:pool});
}
export async function loadSignalSemanticContextGenerationProductV1(args:Omit<Parameters<typeof loadSignalSemanticContextGenerationV1>[0],"queryable">){
  const{pool}=await import("@/lib/db");return loadSignalSemanticContextGenerationV1({...args,queryable:pool});
}
export async function loadSignalSemanticContextDiffProductV1(args:Omit<Parameters<typeof loadSignalSemanticContextDiffV1>[0],"queryable">){
  const{pool}=await import("@/lib/db");return loadSignalSemanticContextDiffV1({...args,queryable:pool});
}
export async function loadSignalSemanticContextProposalPreflightProductV1(args:Omit<Parameters<typeof loadSignalSemanticContextProposalPreflightV1>[0],"queryable"|"configuration">){
  const [{pool},{loadSemanticContextProposalRuntimeReadiness}]=await Promise.all([
    import("@/lib/db"),import("@/lib/queue/data-os")]);
  return loadSignalSemanticContextProposalPreflightRuntimeV1({queryable:pool,
    workspace:proposalWorkspace(args.workspace),actor:proposalActor(args.actor),
    configuration:signalSemanticContextProposalRuntimeConfigurationFromEnvV1(),
    runtime:await loadSemanticContextProposalRuntimeReadiness()});
}

export async function startSignalSemanticContextProposalRunProductV1(args:{
  workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;idempotencyKey:string;
  generationKey:string;preflightDigest:string;confirmation:string;hardCapMicroUsd:bigint;
}){
  const[{pool},{loadSemanticContextProposalRuntimeReadiness}]=await Promise.all([
    import("@/lib/db"),import("@/lib/queue/data-os")]);
  return startSignalSemanticContextProposalRunV1({pool,workspace:proposalWorkspace(args.workspace),
    actor:proposalActor(args.actor),idempotency_key:args.idempotencyKey,
    generation_key:args.generationKey,preflight_digest:args.preflightDigest,
    confirmation:args.confirmation,hard_cap_micro_usd:args.hardCapMicroUsd,
    configuration:signalSemanticContextProposalRuntimeConfigurationFromEnvV1(),
    runtime:await loadSemanticContextProposalRuntimeReadiness()});
}

export async function loadSignalSemanticContextProposalRunProductV1(args:{
  workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;runKey:string;
}){
  const{pool}=await import("@/lib/db");return loadSignalSemanticContextProposalRunV1({queryable:pool,
    workspace:proposalWorkspace(args.workspace),actor:proposalActor(args.actor),run_key:args.runKey});
}

export async function retrySignalSemanticContextProposalRunProductV1(args:{
  workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;idempotencyKey:string;runKey:string;
}){
  const{pool}=await import("@/lib/db");return retrySignalSemanticContextProposalRunV1({pool,
    workspace:proposalWorkspace(args.workspace),actor:proposalActor(args.actor),
    idempotency_key:args.idempotencyKey,run_key:args.runKey});
}

export async function revalidateSignalSemanticContextPaidResponseProductV1(args:{
  workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;idempotencyKey:string;
  runKey:string;confirmation:string;
}){
  return withSignalAcquisitionTransactionV1(async(queryable)=>{
    const diff=await loadSignalSemanticContextDiffV1({queryable,workspace:args.workspace,actor:args.actor});
    if(diff.drift_state!=="current")throw new SignalSemanticContextPackError(
      "semantic_context_paid_response_authority_drift",409
    );
    return revalidateSignalSemanticContextPaidResponseV1({queryable:queryable as never,
      workspace:proposalWorkspace(args.workspace),actor:proposalActor(args.actor),
      idempotency_key:args.idempotencyKey,run_key:args.runKey,confirmation:args.confirmation});
  });
}

function proposalWorkspace(workspace:ResolvedSignalWorkspace){
  if(workspace.subject.type!=="brand")throw new SignalSemanticContextPackError("brand_workspace_required",422);
  return{id:workspace.id,organization_id:workspace.organizationId,brand_id:workspace.subject.id};
}
function proposalActor(actor:SignalWorkspaceUser){
  if(actor.userType!=="noisia_internal")throw new SignalSemanticContextPackError("semantic_context_forbidden",403);
  return{id:actor.id,user_type:"noisia_internal" as const};
}

async function resolveLiveAuthorityV1(args:{queryable:SignalBrandPolicyQueryable;workspace:ResolvedSignalWorkspace}):Promise<Authority>{
  if(args.workspace.subject.type!=="brand")throw new SignalSemanticContextPackError("brand_workspace_required",422);
  const profile=await args.queryable.query<{id:string;version:number;digest:string|null}>(`
    SELECT profile.id::text,profile.version,(profile.metadata->>'snapshot_hash')::text digest
    FROM brand_os_profiles profile WHERE profile.brand_id=$1::uuid AND profile.status='active'
    ORDER BY profile.version DESC LIMIT 1`,[args.workspace.subject.id]);
  const active=profile.rows[0];if(!active||!digestPattern.test(active.digest??"")){
    throw new SignalSemanticContextPackError("brand_os_snapshot_required",409);
  }
  const plan=await args.queryable.query<{brief:Record<string,unknown>}>(`
    SELECT acquisition_brief brief FROM signal_acquisition_plans
    WHERE workspace_id=$1::uuid AND acquisition_brief IS NOT NULL
      AND status IN ('current','draft')
    ORDER BY CASE status WHEN 'current' THEN 0 ELSE 1 END,plan_version DESC LIMIT 1`,[args.workspace.id]);
  const brief=plan.rows[0]?.brief;if(!brief)throw new SignalSemanticContextPackError("acquisition_brief_required",409);
  const locales=normalizeStrings(brief.languages);const markets=normalizeStrings(brief.countries);
  const primaryLocale=typeof brief.primary_locale==="string"?brief.primary_locale:
    locales[0]?.includes("-")?locales[0]:markets[0]&&locales[0]?`${locales[0].slice(0,2).toLowerCase()}-${markets[0]}`:"";
  const timezone=typeof brief.timezone==="string"?brief.timezone:args.workspace.timezone;
  if(!localePattern.test(primaryLocale)||locales.length<1||markets.length<1||!timezone){
    throw new SignalSemanticContextPackError("locale_market_authority_required",409);
  }
  const localeVariants=[...new Set([primaryLocale,...locales.filter((value)=>localePattern.test(value))])].sort();
  const sources=await args.queryable.query<{id:string;source_kind:string;file_hash:string|null;
    content_digest:string;updated_at:Date|string}>(`
    SELECT source.id::text,source.source_kind,source.file_hash,
      'sha256:'||encode(digest(COALESCE(source.raw_text,'')||source.extracted_payload::text,'sha256'),'hex') content_digest,
      source.updated_at
    FROM brand_knowledge_sources source
    WHERE source.organization_id=$1::uuid AND source.brand_id=$2::uuid
      AND source.study_corpus_id IS NULL AND source.status IN ('processed','profiled','active')
    ORDER BY source.id`,[args.workspace.organizationId,args.workspace.subject.id]);
  const chunks=await args.queryable.query<{id:string;source_id:string;content_digest:string}>(`
    SELECT chunk.id::text,chunk.knowledge_source_id::text source_id,
      'sha256:'||encode(digest(chunk.chunk_text,'sha256'),'hex') content_digest
    FROM knowledge_chunks chunk JOIN brand_knowledge_sources source ON source.id=chunk.knowledge_source_id
    WHERE source.organization_id=$1::uuid AND source.brand_id=$2::uuid
      AND source.study_corpus_id IS NULL AND source.status IN ('processed','profiled','active')
    ORDER BY chunk.id`,[args.workspace.organizationId,args.workspace.subject.id]);
  const knowledgeDigest=sha256(stableJson({sources:sources.rows.map((row)=>({id:row.id,kind:row.source_kind,
      digest:digestPattern.test(row.file_hash??"")?row.file_hash:row.content_digest})),chunks:chunks.rows}));
  const knowledgeGenerationKey=`knowledge-${knowledgeDigest.slice(7,23)}`;
  const localeContextDigest=sha256(stableJson({primary_locale:primaryLocale,locale_variants:localeVariants,
    markets:[...markets].sort(),timezone}));
  const sourceAuthorityDigest=sha256(stableJson({brand_os_profile_id:active.id,
    brand_os_profile_version:active.version,brand_os_digest:active.digest,knowledge_generation_key:knowledgeGenerationKey,
    knowledge_digest:knowledgeDigest,locale_context_digest:localeContextDigest}));
  return{brandOsProfileId:active.id,brandOsProfileVersion:active.version,brandOsDigest:active.digest!,
    knowledgeGenerationKey,knowledgeDigest,localeContextDigest,primaryLocale,localeVariants,
    markets:[...markets].sort(),timezone,sourceAuthorityDigest};
}

const generationSelect=`SELECT generation.id::text,generation.artifact_id::text,generation.generation_key,
  generation.generation_version,generation.status,generation.supersedes_generation_id::text,
  generation.supersession_reason,
  generation.brand_os_profile_id::text,generation.brand_os_profile_version,generation.brand_os_digest,
  generation.knowledge_generation_key,generation.knowledge_digest,generation.locale_context_digest,
  generation.primary_locale,generation.locale_variants,generation.markets,generation.timezone,
  generation.draft_digest,generation.pack_digest,generation.created_at,generation.published_at,
  generation.proposal_model,generation.proposal_model_version,generation.proposal_prompt_digest,
  generation.proposal_pricing_version
  FROM signal_semantic_context_generations generation`;

async function loadGeneration(queryable:SignalBrandPolicyQueryable,workspaceId:string,
  generationKey?:string,status?:"draft"|"published",effectiveOnly=generationKey===undefined){
  const result=await queryable.query<GenerationRow>(`${generationSelect}
    WHERE generation.workspace_id=$1::uuid
      AND ($2::text IS NULL OR generation.generation_key=$2)
      AND ($3::text IS NULL OR generation.status=$3)
      AND (NOT $4::boolean OR NOT EXISTS(
        SELECT 1 FROM signal_semantic_context_generations successor
        WHERE successor.supersedes_generation_id=generation.id))
    ORDER BY generation.generation_version DESC LIMIT 1`,[workspaceId,generationKey??null,
      status??null,effectiveOnly]);
  return result.rows[0]??null;
}
async function requireDraft(queryable:SignalBrandPolicyQueryable,workspaceId:string,generationKey:string){
  const generation=await loadGeneration(queryable,workspaceId,generationKey,"draft",true);
  if(!generation)throw new SignalSemanticContextPackError("semantic_context_draft_not_found",404);return generation;
}
async function loadCurrentElements(queryable:SignalBrandPolicyQueryable,generationId:string){
  const result=await queryable.query<ElementRow>(`${elementSelect}
    WHERE element.generation_id=$1::uuid AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions successor
      WHERE successor.supersedes_element_id=element.id)
    ORDER BY element.element_key`,[generationId]);return result.rows;
}
async function loadCurrentElement(queryable:SignalBrandPolicyQueryable,generationId:string,elementKey:string){
  const result=await queryable.query<ElementRow>(`${elementSelect}
    WHERE element.generation_id=$1::uuid AND element.element_key=$2 AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions successor
      WHERE successor.supersedes_element_id=element.id) LIMIT 1`,[generationId,elementKey]);return result.rows[0]??null;
}
const elementSelect=`SELECT element.id::text,element.artifact_id::text,element.evidence_group_id::text,
  element.element_key,element.element_version,element.element_kind,element.canonical_key,element.display_text,
  element.scope,element.entity_type,element.entity_id::text,element.locale,element.relation_kind,
  element.relation_target_key,element.confidence::text,element.disposition,element.origin_kind,
  element.supersedes_element_id::text,element.original_proposal_element_id::text,
  element.source_refs_digest,element.element_digest,element.proposed_by_user_id::text,
  element.decided_by_user_id::text,element.proposed_at,element.decided_at,element.created_at,
  (SELECT count(*)::int FROM analysis_evidence_links link
    WHERE link.evidence_group_id=element.evidence_group_id) source_ref_count
  FROM signal_semantic_context_element_versions element`;

async function createElementGraph(queryable:SignalBrandPolicyQueryable,args:{workspaceId:string;generation:GenerationRow;
  proposal:Omit<SignalSemanticContextProposalV1,"source_refs"|"origin_kind">;version:number;disposition:"pending"|"approved"|"rejected";
  originKind:string;supersedes:string|null;originalProposal:string|null;sourceRefsDigest:string;elementDigest:string;
  operationId:string;actorId:string;sourceRefs:SignalSemanticContextSourceRefV1[]}){
  const artifact=await queryable.query<{id:string}>(`INSERT INTO analysis_artifacts(
    workspace_id,workspace_artifact_kind,workspace_authority_digest,artifact_key,artifact_type,
    content,confidence,review_status,revision,metadata)
    VALUES($1::uuid,'semantic_context',$2,$3,'semantic_context_element',$4::jsonb,$5,$6,$7,$8::jsonb)
    RETURNING id::text`,[args.workspaceId,args.elementDigest,args.proposal.element_key,
      JSON.stringify({element_kind:args.proposal.element_kind,canonical_key:args.proposal.canonical_key,
        display_text:args.proposal.display_text,scope:args.proposal.scope,locale:args.proposal.locale,
        relation_kind:args.proposal.relation_kind,relation_target_key:args.proposal.relation_target_key}),
      args.proposal.confidence===null?null:String(args.proposal.confidence),
      args.disposition==="pending"?"needs_review":args.disposition==="approved"?"accepted":"rejected",
      args.version,JSON.stringify({authority_only:true,confidence_authoritative:false})]);
  const group=await queryable.query<{id:string}>(`INSERT INTO analysis_evidence_groups(
    artifact_id,group_key,role,label,summary,position,metadata)
    VALUES($1::uuid,'source-authority','supporting','Source authority',NULL,0,$2::jsonb) RETURNING id::text`,
  [artifact.rows[0]!.id,JSON.stringify({source_refs_digest:args.sourceRefsDigest})]);
  await queryable.query(`INSERT INTO analysis_evidence_links(evidence_group_id,source_type,source_id,
    relation_type,evidence_role,quote,locator,position,metadata)
    SELECT $1::uuid,input.source_type,input.source_id,input.relation_type,'supporting',NULL,
      '{}'::jsonb,input.position,'{}'::jsonb FROM unnest($2::text[],$3::uuid[],$4::text[],$5::int[])
      AS input(source_type,source_id,relation_type,position)`,[group.rows[0]!.id,
      args.sourceRefs.map((ref)=>ref.source_type),args.sourceRefs.map((ref)=>ref.source_id),
      args.sourceRefs.map((ref)=>ref.relation_type),args.sourceRefs.map((_,position)=>position)]);
  const inserted=await queryable.query<{id:string}>(`INSERT INTO signal_semantic_context_element_versions(
    workspace_id,generation_id,artifact_id,evidence_group_id,element_key,element_version,element_kind,
    canonical_key,display_text,scope,entity_type,entity_id,locale,relation_kind,relation_target_key,
    confidence,disposition,origin_kind,supersedes_element_id,original_proposal_element_id,
    source_refs_digest,element_digest,operation_id,proposed_by_user_id,decided_by_user_id,decided_at)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12::uuid,$13,$14,$15,
      $16,$17,$18,$19::uuid,$20::uuid,$21,$22,$23::uuid,$24::uuid,$25::uuid,
      CASE WHEN $17='pending' THEN NULL ELSE clock_timestamp() END) RETURNING id::text`,[
      args.workspaceId,args.generation.id,artifact.rows[0]!.id,group.rows[0]!.id,args.proposal.element_key,
      args.version,args.proposal.element_kind,args.proposal.canonical_key,args.proposal.display_text,
      args.proposal.scope,args.proposal.entity_type,args.proposal.entity_id,args.proposal.locale,
      args.proposal.relation_kind,args.proposal.relation_target_key,args.proposal.confidence,
      args.disposition,args.originKind,args.supersedes,args.originalProposal,args.sourceRefsDigest,
      args.elementDigest,args.operationId,args.actorId,args.disposition==="pending"?null:args.actorId]);
  return inserted.rows[0]!;
}

async function createDecisionSuccessor(queryable:SignalBrandPolicyQueryable,args:{workspaceId:string;
  generation:GenerationRow;current:ElementRow;action:"approve"|"reject"|"edit";
  edit?:{canonical_key:string;display_text:string;scope?:string|null;entity_type?:string|null;entity_id?:string|null;
    locale:string|null;relation_kind:SignalSemanticContextRelationKindV1|null;relation_target_key:string|null};
  operationId:string;actorId:string}){
  const refs=await queryable.query<SignalSemanticContextSourceRefV1>(`SELECT source_type,
    source_id::text source_id,relation_type FROM analysis_evidence_links
    WHERE evidence_group_id=$1::uuid ORDER BY position,id`,[args.current.evidence_group_id]);
  const proposal={element_key:args.current.element_key,element_kind:args.current.element_kind,
    canonical_key:args.edit?.canonical_key??args.current.canonical_key,
    display_text:args.edit?.display_text??args.current.display_text,
    scope:args.edit&&"scope" in args.edit?args.edit.scope??null:args.current.scope,
    entity_type:args.edit&&"entity_type" in args.edit?args.edit.entity_type??null:args.current.entity_type,
    entity_id:args.edit&&"entity_id" in args.edit?args.edit.entity_id??null:args.current.entity_id,
    locale:args.edit?.locale??args.current.locale,relation_kind:args.edit?.relation_kind??args.current.relation_kind,
    relation_target_key:args.edit?.relation_target_key??args.current.relation_target_key,
    confidence:args.current.confidence===null?null:Number(args.current.confidence)};
  validateProposalShape({...proposal,origin_kind:"server_projection",source_refs:refs.rows});
  const disposition=args.action==="edit"?"pending":args.action==="approve"?"approved":"rejected";
  const version=args.current.element_version+1;
  const elementDigest=elementDefinitionDigest({proposal,version,disposition,
    sourceRefsDigest:args.current.source_refs_digest});
  const created=await createElementGraph(queryable,{workspaceId:args.workspaceId,generation:args.generation,
    proposal,version,disposition,originKind:args.action==="edit"?"operator_correction":"operator_decision",
    supersedes:args.current.id,originalProposal:args.current.original_proposal_element_id??args.current.id,
    sourceRefsDigest:args.current.source_refs_digest,elementDigest,operationId:args.operationId,
    actorId:args.actorId,sourceRefs:refs.rows});
  return{...created,elementDigest,disposition};
}

async function refreshDraftDigest(queryable:SignalBrandPolicyQueryable,generation:GenerationRow){
  const elements=await loadCurrentElements(queryable,generation.id);
  const draftDigest=sha256(stableJson({contract_version:SIGNAL_SEMANTIC_CONTEXT_PACK_CONTRACT_VERSION,
    generation_key:generation.generation_key,source_authority:{brand_os_digest:generation.brand_os_digest,
      knowledge_digest:generation.knowledge_digest,locale_context_digest:generation.locale_context_digest},
    elements:elements.sort(elementSort).map((element)=>({key:element.element_key,version:element.element_version,
      digest:element.element_digest,disposition:element.disposition}))}));
  const updated=await queryable.query(`UPDATE signal_semantic_context_generations
    SET draft_digest=$2 WHERE id=$1::uuid AND status='draft'`,[generation.id,draftDigest]);
  if(updated.rowCount!==1)throw new SignalSemanticContextPackError("semantic_context_draft_conflict");
  return draftDigest;
}

async function loadCurrentCounts(queryable:SignalBrandPolicyQueryable,generationId:string){
  const result=await queryable.query<{pending:number;approved:number;rejected:number}>(`SELECT
    count(*) FILTER(WHERE element.disposition='pending')::int pending,
    count(*) FILTER(WHERE element.disposition='approved')::int approved,
    count(*) FILTER(WHERE element.disposition='rejected')::int rejected
    FROM signal_semantic_context_element_versions element WHERE element.generation_id=$1::uuid
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor
        WHERE successor.supersedes_element_id=element.id)`,[generationId]);return result.rows[0]??emptyCounts();
}
function countRows(rows:ElementRow[]){return{pending:rows.filter((row)=>row.disposition==="pending").length,
  approved:rows.filter((row)=>row.disposition==="approved").length,
  rejected:rows.filter((row)=>row.disposition==="rejected").length};}
function emptyCounts(){return{pending:0,approved:0,rejected:0};}
function compareAuthority(generation:GenerationRow,live:Authority){const drift:string[]=[];
  if(generation.brand_os_digest!==live.brandOsDigest)drift.push("brand_os_drift");
  if(generation.knowledge_digest!==live.knowledgeDigest)drift.push("knowledge_drift");
  if(generation.locale_context_digest!==live.localeContextDigest)drift.push("locale_market_drift");return drift;}
function publicGeneration(row:GenerationRow,counts:ReturnType<typeof emptyCounts>){return{
  generation_key:row.generation_key,generation_version:row.generation_version,lifecycle_state:row.status,
  semantic_context_pack_digest:row.pack_digest,counts,primary_locale:row.primary_locale,
  locale_variants:row.locale_variants,markets:row.markets,timezone:row.timezone,
  created_at:new Date(row.created_at).toISOString(),published_at:row.published_at?new Date(row.published_at).toISOString():null};}
function publicElement(row:ElementRow,sourceRefs:Array<{source_type:string;source_ref:string;relation_type:string}>){return{element_key:row.element_key,element_version:row.element_version,
  element_kind:row.element_kind,canonical_key:row.canonical_key,display_text:row.display_text,
  scope:row.scope,entity_type:row.entity_type,entity_ref:row.entity_id?sha256(row.entity_id):null,
  locale:row.locale,relation_kind:row.relation_kind,
  relation_target_key:row.relation_target_key,confidence:row.confidence===null?null:Number(row.confidence),
  confidence_authoritative:false,disposition:row.disposition,origin:row.origin_kind,
  lineage:{supersedes_element_ref:row.supersedes_element_id?sha256(row.supersedes_element_id):null,
    original_proposal_ref:row.original_proposal_element_id?sha256(row.original_proposal_element_id):null},
  provenance:{proposed_by_ref:row.proposed_by_user_id?sha256(row.proposed_by_user_id):null,
    decided_by_ref:row.decided_by_user_id?sha256(row.decided_by_user_id):null,
    proposed_at:new Date(row.proposed_at).toISOString(),
    decided_at:row.decided_at?new Date(row.decided_at).toISOString():null,
    created_at:new Date(row.created_at).toISOString()},source_refs:sourceRefs,
  source_ref_count:row.source_ref_count};}
function packElement(row:ElementRow){return{element_key:row.element_key,element_kind:row.element_kind,
  canonical_key:row.canonical_key,display_text:row.display_text,scope:row.scope,entity_type:row.entity_type,
  entity_ref:row.entity_id?sha256(row.entity_id):null,locale:row.locale,relation_kind:row.relation_kind,
  relation_target_key:row.relation_target_key,source_refs_digest:row.source_refs_digest};}
function elementSort(a:ElementRow,b:ElementRow){return a.element_key.localeCompare(b.element_key)||a.element_version-b.element_version;}
function elementDefinitionDigest(args:{proposal:Omit<SignalSemanticContextProposalV1,"source_refs"|"origin_kind">;
  version:number;disposition:string;sourceRefsDigest:string}){return sha256(stableJson({
    contract_version:"signal-semantic-context-element-v1",...args.proposal,element_version:args.version,
    disposition:args.disposition,source_refs_digest:args.sourceRefsDigest,confidence_authoritative:false}));}
function validateProposals(proposals:SignalSemanticContextProposalV1[]){if(proposals.length<1||proposals.length>250)
  throw new SignalSemanticContextPackError("semantic_context_proposal_scope_invalid",422);
  const keys=new Set<string>();for(const proposal of proposals){validateProposalShape(proposal);
    if(keys.has(proposal.element_key))throw new SignalSemanticContextPackError("semantic_context_duplicate_element_key",422);
    keys.add(proposal.element_key);}}
function validateProposalShape(proposal:SignalSemanticContextProposalV1){
  if(!keyPattern.test(proposal.element_key)||!keyPattern.test(proposal.canonical_key)
      ||!SIGNAL_SEMANTIC_CONTEXT_ELEMENT_KINDS.includes(proposal.element_kind)
      ||proposal.display_text.trim().length<1||proposal.display_text.length>500
      ||proposal.source_refs.length<1||proposal.source_refs.length>50)
    throw new SignalSemanticContextPackError("semantic_context_proposal_invalid",422);
  if(proposal.confidence!==null&&(!Number.isFinite(proposal.confidence)||proposal.confidence<0||proposal.confidence>1))
    throw new SignalSemanticContextPackError("semantic_context_confidence_invalid",422);
  if((proposal.entity_type===null)!==(proposal.entity_id===null))
    throw new SignalSemanticContextPackError("semantic_context_entity_pair_invalid",422);
  const relation=proposal.element_kind==="typed_relation";
  if(relation!==Boolean(proposal.relation_kind&&proposal.relation_target_key)
      ||(proposal.relation_kind&&!SIGNAL_SEMANTIC_CONTEXT_RELATION_KINDS.includes(proposal.relation_kind)))
    throw new SignalSemanticContextPackError("semantic_context_relation_invalid",422);
  for(const ref of proposal.source_refs)if(!SIGNAL_SEMANTIC_CONTEXT_SOURCE_TYPES.includes(ref.source_type)
      ||!uuidPattern.test(ref.source_id)||!["supports","limits","contradicts"].includes(ref.relation_type))
    throw new SignalSemanticContextPackError("semantic_context_source_ref_invalid",422);
}
async function insertEvent(queryable:SignalBrandPolicyQueryable,args:{workspaceId:string;generationId:string;
  elementId?:string;operationId:string;eventIndex:number;eventKind:string;previous:string|null;next:string;actorId:string}){
  await queryable.query(`INSERT INTO signal_semantic_context_events(workspace_id,generation_id,element_id,
    operation_id,event_index,event_kind,previous_state_digest,next_state_digest,actor_user_id)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9::uuid)`,[args.workspaceId,args.generationId,
      args.elementId??null,args.operationId,args.eventIndex,args.eventKind,args.previous,args.next,args.actorId]);}
async function lockWorkspace(queryable:SignalBrandPolicyQueryable,workspaceId:string){await queryable.query(
  "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`signal-semantic-context:${workspaceId}`]);}
function assertInternal(actor:SignalWorkspaceUser){if(actor.userType!=="noisia_internal")
  throw new SignalSemanticContextPackError("semantic_context_forbidden",403);}
function validateProviderConfiguration(value:SignalSemanticContextProviderConfigurationV1){
  if(!value.provider.trim()||[value.max_input_tokens,value.max_output_tokens,value.input_usd_per_million_tokens,
    value.output_usd_per_million_tokens,value.hard_cap_usd].some((entry)=>!Number.isFinite(entry)||entry<0))
    throw new SignalSemanticContextPackError("semantic_context_provider_configuration_invalid",500);
  if(value.available&&(!value.model.trim()||!value.model_version.trim()||!value.pricing_version.trim()
      ||!digestPattern.test(value.prompt_template_digest)||value.max_input_tokens<=0
      ||value.max_output_tokens<=0||value.hard_cap_usd<=0))
    throw new SignalSemanticContextPackError("semantic_context_provider_configuration_invalid",500);
  return value;}
function normalizeStrings(value:unknown){return Array.isArray(value)?[...new Set(value.filter((entry):entry is string=>
  typeof entry==="string"&&entry.trim().length>0).map((entry)=>entry.trim()))].sort():[];}
function sha256(value:string){return`sha256:${createHash("sha256").update(value,"utf8").digest("hex")}`;}
function stableJson(value:unknown):string{if(Array.isArray(value))return`[${value.map(stableJson).join(",")}]`;
  if(value&&typeof value==="object")return`{${Object.entries(value as Record<string,unknown>)
    .sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>`${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  return JSON.stringify(value);}
const digestPattern=/^sha256:[0-9a-f]{64}$/u;
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const keyPattern=/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u;
const localePattern=/^[a-z]{2,3}(?:-[A-Z]{2})?$/u;
