import { createHash } from "node:crypto";

import {
  buildSignalSemanticContextProviderLineageV1,
  parseSignalSemanticContextProviderLineageV1,
  signalSemanticContextProviderFullLineageMatchesV1,
  type SignalSemanticContextProviderLineageV1
} from "@noisia/query-engine";
import { signalSemanticContextProposalRuntimeConfigurationFromEnvV1 } from "@noisia/db";
import type { SignalBrandPolicyQueryable } from "@/lib/data-os/signal-governed-brand-policy";
import { withSignalAcquisitionTransactionV1 } from "@/lib/data-os/signal-acquisition-plan";
import {
  SignalSemanticContextPackError,
  SIGNAL_SEMANTIC_CONTEXT_RELATION_KINDS,
  resolveLiveSignalSemanticContextAuthorityV1
} from "@/lib/data-os/signal-semantic-context-pack";
import {
  beginSignalProductOperationV1,
  completeSignalProductOperationV1
} from "@/lib/data-os/signal-product-operation";
import type { ResolvedSignalWorkspace, SignalWorkspaceUser } from "@/lib/data-os/signal-workspace";

export const SIGNAL_SEMANTIC_CONTEXT_PUBLICATION_SCHEMA_V2 =
  "signal-semantic-context-publication-v2" as const;
export const SIGNAL_SEMANTIC_CONTEXT_PUBLICATION_CONFIRMATION_V2 =
  "publish_reviewed_semantic_context_v2" as const;
export const SIGNAL_SEMANTIC_CONTEXT_DECISION_CONTRACT_V2 =
  "signal-semantic-context-decision-v2" as const;
export const SIGNAL_SEMANTIC_CONTEXT_APPROVAL_CONFIRMATION_V2 =
  "approve_selected_semantic_context_element" as const;
export const SIGNAL_SEMANTIC_CONTEXT_BULK_APPROVAL_CONFIRMATION_V2 =
  "apply_shared_decision_basis_to_all_selected_elements" as const;
export const SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONTRACT_V1 =
  "signal-semantic-context-annotation-resolution-v1" as const;
export const SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONFIRMATION_V1 =
  "resolve_semantic_context_annotation_with_deliberate_basis" as const;
export const SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_REPAIR_CONFIRMATION_V1 =
  "repair_semantic_context_annotation_resolution_basis" as const;
export const SIGNAL_SEMANTIC_CONTEXT_REVIEW_REASONS_V2 = [
  "duplicate_same_concept","alias_or_variant","canonicalization","semantic_boundary",
  "locale_resolution","competitive_unit_resolution","insufficient_context","operator_correction"
] as const;
export const SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_TYPES_V2 = [
  "uncertain","needs_more_context","near_duplicate","locale_unresolved",
  "competitive_unit_unresolved"
] as const;
export const SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTIONS_V2 = [
  "merged","kept_distinct","context_sufficient","not_supported","governed_locale",
  "global","canonical_unit","not_applicable"
] as const;

export type SignalSemanticContextReviewReasonV2=typeof SIGNAL_SEMANTIC_CONTEXT_REVIEW_REASONS_V2[number];
type ReasonV2=SignalSemanticContextReviewReasonV2;
export type SignalSemanticContextDecisionBasisV2={
  contract_version:typeof SIGNAL_SEMANTIC_CONTEXT_DECISION_CONTRACT_V2;
  reason:ReasonV2;rationale:string;
};
export type SignalSemanticContextAnnotationResolutionBasisV1={
  contract_version:typeof SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONTRACT_V1;
  annotation_type:AnnotationTypeV2;resolution:AnnotationResolutionV2;
  reason:ReasonV2;rationale:string;
};
type AnnotationTypeV2=typeof SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_TYPES_V2[number];
type AnnotationResolutionV2=typeof SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTIONS_V2[number];
type DispositionV2="pending"|"approved"|"rejected"|"merged";
type GenerationRow={id:string;generation_key:string;generation_version:number;status:"draft"|"published";
  brand_os_digest:string;knowledge_digest:string;locale_context_digest:string;
  proposal_model:string|null;proposal_model_version:string|null;proposal_prompt_digest:string|null;
  proposal_pricing_version:string|null;proposal_provider_lineage:unknown|null;
  proposal_provider_lineage_digest:string|null;draft_digest:string;
  published_operation_id:string|null};
type ElementRow={id:string;artifact_id:string;evidence_group_id:string;element_key:string;element_version:number;
  element_kind:string;canonical_key:string;display_text:string;scope:string|null;entity_type:string|null;
  entity_id:string|null;locale:string|null;relation_kind:string|null;relation_target_key:string|null;
  confidence:string|null;disposition:DispositionV2;origin_kind:string;supersedes_element_id:string|null;
  original_proposal_element_id:string|null;source_refs_digest:string;element_digest:string};
type SourceRef={source_type:string;source_id:string;relation_type:"supports"|"limits"|"contradicts"};
type AnnotationRow={id:string;annotation_key:string;annotation_version:number;annotation_type:AnnotationTypeV2;
  state:"open"|"resolved";resolution:AnnotationResolutionV2|null;subject_element_id:string;
  related_element_ids:string[];reason_code:ReasonV2;rationale:string;
  resolution_contract_version:string|null;resolution_basis_digest:string|null;
  resolution_input_digest:string|null;resolution_authority_snapshot:unknown|null;
  resolution_authority_digest:string|null;resolution_prestate_digest:string|null;
  resolution_poststate_digest:string|null};
type Snapshot={candidate_pack_digest:string;evidence_graph_digest:string;review_graph_digest:string;
  publication_authority_digest:string;semantic_context_pack_digest:string;publish_preflight_digest:string;
  counts:Record<string,number>;collisions:string[][];blockers:string[];publishable:boolean;preflight:unknown};

export function canonicalJsonV2(value:unknown):string{
  if(value===null)return"null";
  if(typeof value==="string")return escapeCanonicalStringV2(value);
  if(typeof value==="boolean")return value?"true":"false";
  if(typeof value==="number"){
    if(!Number.isSafeInteger(value))throw new SignalSemanticContextPackError("canonical_json_v2_integer_required",422);
    return String(value);
  }
  if(Array.isArray(value))return`[${value.map(canonicalJsonV2).join(",")}]`;
  if(value&&typeof value==="object"){
    const normalized=new Map<string,unknown>();
    for(const[key,entry]of Object.entries(value as Record<string,unknown>)){
      const normalizedKey=normalizeScalarString(key);
      if(normalized.has(normalizedKey))throw new SignalSemanticContextPackError("canonical_json_v2_key_collision",422);
      normalized.set(normalizedKey,entry);
    }
    const keys=[...normalized.keys()].sort(compareUtf8);
    return`{${keys.map((key)=>`${escapeCanonicalStringV2(key)}:${canonicalJsonV2(normalized.get(key))}`).join(",")}}`;
  }
  throw new SignalSemanticContextPackError("canonical_json_v2_value_invalid",422);
}

export function digestCanonicalJsonV2(value:unknown){
  return`sha256:${createHash("sha256").update(canonicalJsonV2(value),"utf8").digest("hex")}`;
}

export function normalizeSignalSemanticContextDecisionBasisV2(args:{reason:ReasonV2;rationale:string}):
  SignalSemanticContextDecisionBasisV2{
  if(!SIGNAL_SEMANTIC_CONTEXT_REVIEW_REASONS_V2.includes(args.reason))
    throw new SignalSemanticContextPackError("semantic_context_decision_reason_invalid",422);
  return{contract_version:SIGNAL_SEMANTIC_CONTEXT_DECISION_CONTRACT_V2,
    reason:args.reason,rationale:normalizeRationale(args.rationale)};
}

export function normalizeSignalSemanticContextAnnotationResolutionBasisV1(args:{
  annotationType:AnnotationTypeV2;resolution:AnnotationResolutionV2;reason:ReasonV2;rationale:string;
}):SignalSemanticContextAnnotationResolutionBasisV1{
  if(!SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_TYPES_V2.includes(args.annotationType))
    throw new SignalSemanticContextPackError("semantic_context_annotation_type_invalid",422);
  if(!SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTIONS_V2.includes(args.resolution))
    throw new SignalSemanticContextPackError("semantic_context_annotation_resolution_invalid",422);
  if(!SIGNAL_SEMANTIC_CONTEXT_REVIEW_REASONS_V2.includes(args.reason))
    throw new SignalSemanticContextPackError("semantic_context_decision_reason_invalid",422);
  validateResolution(args.annotationType,args.resolution,null,[],"annotation");
  return{contract_version:SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONTRACT_V1,
    annotation_type:args.annotationType,resolution:args.resolution,reason:args.reason,
    rationale:normalizeRationale(args.rationale)};
}

export function signalSemanticContextAnnotationStateDigestV1(args:{annotation_key:string;
  annotation_version:number;annotation_type:AnnotationTypeV2;state:"open"|"resolved";
  resolution:AnnotationResolutionV2|null;subject_element_id:string;related_element_ids:string[];
  reason_code:ReasonV2;rationale:string;resolution_contract_version:string|null;
  resolution_basis_digest:string|null;resolution_input_digest:string|null;
  resolution_authority_digest:string|null}){
  return digestCanonicalJsonV2({contract_version:"signal-semantic-context-annotation-state-v1",
    annotation_key:args.annotation_key,annotation_version:args.annotation_version,
    annotation_type:args.annotation_type,state:args.state,resolution:args.resolution,
    subject_element_id:args.subject_element_id.toLowerCase(),
    related_element_ids:[...args.related_element_ids].map((value)=>value.toLowerCase()).sort(compareUtf8),
    reason_code:args.reason_code,rationale:args.rationale,
    resolution_contract_version:args.resolution_contract_version,
    resolution_basis_digest:args.resolution_basis_digest,
    resolution_input_digest:args.resolution_input_digest,
    resolution_authority_digest:args.resolution_authority_digest});
}

export function signalSemanticContextDecisionElementDigestV2(args:{
  definition:{element_key:string;element_kind:string;canonical_key:string;display_text:string;
    scope:string|null;entity_type:string|null;entity_id:string|null;locale:string|null;
    relation_kind:string|null;relation_target_key:string|null};
  elementVersion:number;disposition:"approved"|"rejected";sourceRefsDigest:string;
  basis:SignalSemanticContextDecisionBasisV2;
}){
  return digestCanonicalJsonV2({contract_version:"signal-semantic-context-element-v3",
    ...args.definition,element_version:args.elementVersion,disposition:args.disposition,
    source_refs_digest:args.sourceRefsDigest,decision_basis:args.basis});
}

export async function decideSignalSemanticContextElementV2(args:{
  queryable:SignalBrandPolicyQueryable;workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;
  idempotencyKey:string;generationKey:string;elementKey:string;action:"approve"|"reject";
  reason:ReasonV2;rationale:string;confirmation:typeof SIGNAL_SEMANTIC_CONTEXT_APPROVAL_CONFIRMATION_V2|
    "reject_selected_semantic_context_element";
}){
  assertInternal(args.actor);
  if(args.action==="approve"&&args.confirmation!==SIGNAL_SEMANTIC_CONTEXT_APPROVAL_CONFIRMATION_V2)
    throw new SignalSemanticContextPackError("semantic_context_approval_confirmation_required",422);
  if(args.action==="reject"&&args.confirmation!=="reject_selected_semantic_context_element")
    throw new SignalSemanticContextPackError("semantic_context_rejection_confirmation_required",422);
  const basis=normalizeSignalSemanticContextDecisionBasisV2(args);
  const operationInput={contract_version:SIGNAL_SEMANTIC_CONTEXT_DECISION_CONTRACT_V2,
    generation_key:args.generationKey,element_key:args.elementKey,action:args.action,
    decision_basis:basis,confirmation:args.confirmation};
  await lockWorkspace(args.queryable,args.workspace.id);
  const operation=await beginSignalProductOperationV1<{element_key:string;element_version:number;
    disposition:"approved"|"rejected";draft_digest_ref:string}>({...args,
    action:"decide-semantic-context-element",input:operationInput,
    semanticContextDecisionInput:{payload:operationInput,digest:digestCanonicalJsonV2(operationInput)}});
  if(operation.replay)return operation.replay;
  const generation=await requireEffectiveDraft(args.queryable,args.workspace.id,args.generationKey);
  await assertNoActiveRun(args.queryable,generation.id);
  await assertGenerationAuthorityCurrent(args.queryable,args.workspace,generation);
  const current=await requireCurrentElement(args.queryable,generation.id,args.elementKey,true);
  if(current.disposition!=="pending")
    throw new SignalSemanticContextPackError("semantic_context_element_not_pending");
  const created=await createDecisionElementV2(args.queryable,{workspaceId:args.workspace.id,generation,current,
    disposition:args.action==="approve"?"approved":"rejected",basis,operationId:operation.operationId,
    actorId:args.actor.id});
  const draftDigest=await refreshDraftDigestV2(args.queryable,generation.id);
  await insertEventV2(args.queryable,{workspaceId:args.workspace.id,generationId:generation.id,
    elementId:created.id,operationId:operation.operationId,eventIndex:0,
    eventKind:args.action==="approve"?"element_approved":"element_rejected",
    previous:current.element_digest,next:created.elementDigest,actorId:args.actor.id});
  const result={element_key:current.element_key,element_version:current.element_version+1,
    disposition:args.action==="approve"?"approved" as const:"rejected" as const,
    draft_digest_ref:shortDigest(draftDigest)};
  await completeSignalProductOperationV1({queryable:args.queryable,workspaceId:args.workspace.id,
    key:operation.key,result});return result;
}

export async function bulkApproveSignalSemanticContextElementsV2(args:{
  queryable:SignalBrandPolicyQueryable;workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;
  idempotencyKey:string;generationKey:string;elementKeys:string[];reason:ReasonV2;rationale:string;
  confirmation:typeof SIGNAL_SEMANTIC_CONTEXT_BULK_APPROVAL_CONFIRMATION_V2;
}){
  assertInternal(args.actor);
  if(args.confirmation!==SIGNAL_SEMANTIC_CONTEXT_BULK_APPROVAL_CONFIRMATION_V2)
    throw new SignalSemanticContextPackError("semantic_context_bulk_approval_confirmation_required",422);
  const keys=uniqueKeys(args.elementKeys,15);if(keys.length<2)
    throw new SignalSemanticContextPackError("semantic_context_bulk_scope_invalid",422);
  const basis=normalizeSignalSemanticContextDecisionBasisV2(args);
  const operationInput={contract_version:SIGNAL_SEMANTIC_CONTEXT_DECISION_CONTRACT_V2,
    generation_key:args.generationKey,element_keys:keys,decision_basis:basis,confirmation:args.confirmation};
  await lockWorkspace(args.queryable,args.workspace.id);
  const operation=await beginSignalProductOperationV1<{generation_key:string;approved:number;
    draft_digest_ref:string}>({...args,action:"bulk-approve-semantic-context-elements",
    input:operationInput,semanticContextDecisionInput:{payload:operationInput,
      digest:digestCanonicalJsonV2(operationInput)}});
  if(operation.replay)return operation.replay;
  const generation=await requireEffectiveDraft(args.queryable,args.workspace.id,args.generationKey);
  await assertNoActiveRun(args.queryable,generation.id);
  await assertGenerationAuthorityCurrent(args.queryable,args.workspace,generation);
  const current:ElementRow[]=[];
  for(const key of keys){const element=await requireCurrentElement(args.queryable,generation.id,key,true);
    if(element.disposition!=="pending")throw new SignalSemanticContextPackError("semantic_context_bulk_element_invalid");
    current.push(element);}
  if(new Set(current.map((element)=>element.element_kind)).size!==1)
    throw new SignalSemanticContextPackError("semantic_context_bulk_kind_mismatch",422);
  for(const element of current)await createDecisionElementV2(args.queryable,{workspaceId:args.workspace.id,
    generation,current:element,disposition:"approved",basis,operationId:operation.operationId,
    actorId:args.actor.id});
  const draftDigest=await refreshDraftDigestV2(args.queryable,generation.id);
  await insertEventV2(args.queryable,{workspaceId:args.workspace.id,generationId:generation.id,
    operationId:operation.operationId,eventIndex:0,eventKind:"elements_bulk_approved",
    previous:generation.draft_digest,next:draftDigest,actorId:args.actor.id});
  const result={generation_key:generation.generation_key,approved:current.length,
    draft_digest_ref:shortDigest(draftDigest)};
  await completeSignalProductOperationV1({queryable:args.queryable,workspaceId:args.workspace.id,
    key:operation.key,result});return result;
}

/** Rejection is the same first-class decision boundary as approval; annotations are separate evidence. */
export async function rejectSignalSemanticContextElementV2(args:{
  queryable:SignalBrandPolicyQueryable;workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;
  idempotencyKey:string;generationKey:string;elementKey:string;reason:ReasonV2;rationale:string;
}){
  return decideSignalSemanticContextElementV2({...args,action:"reject",
    confirmation:"reject_selected_semantic_context_element"});
}

export async function rejectSignalSemanticContextElementProductV2(args:Omit<
  Parameters<typeof rejectSignalSemanticContextElementV2>[0],"queryable">){
  return withSignalAcquisitionTransactionV1((queryable)=>rejectSignalSemanticContextElementV2({...args,queryable}));
}

function escapeCanonicalStringV2(value:string){
  const normalized=normalizeScalarString(value);let result='"';
  for(const character of normalized){
    const code=character.codePointAt(0)!;
    if(character==='"')result+='\\"';
    else if(character==='\\')result+='\\\\';
    else if(code<=0x1f)result+=`\\u00${code.toString(16).toUpperCase().padStart(2,"0")}`;
    else if(code===0x2028)result+="\\u2028";
    else if(code===0x2029)result+="\\u2029";
    else result+=character;
  }
  return result+'"';
}
function normalizeScalarString(value:string){
  for(let index=0;index<value.length;index++){
    const code=value.charCodeAt(index);
    if(code>=0xd800&&code<=0xdbff){const next=value.charCodeAt(index+1);
      if(!(next>=0xdc00&&next<=0xdfff))throw new SignalSemanticContextPackError("canonical_json_v2_lone_surrogate",422);
      index++;continue;}
    if(code>=0xdc00&&code<=0xdfff)throw new SignalSemanticContextPackError("canonical_json_v2_lone_surrogate",422);
  }
  return value.normalize("NFC");
}
function compareUtf8(left:string,right:string){return Buffer.compare(Buffer.from(left,"utf8"),Buffer.from(right,"utf8"));}

export async function correctSignalSemanticContextElementV2(args:{queryable:SignalBrandPolicyQueryable;
  workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;idempotencyKey:string;generationKey:string;
  elementKey:string;reason:ReasonV2;rationale:string;correction:{canonical_key:string;display_text:string;
    scope:string|null;locale:string|null;relation_kind:typeof SIGNAL_SEMANTIC_CONTEXT_RELATION_KINDS[number]|null;
    relation_target_key:string|null};annotation_resolutions?:Array<{annotation_key:string;resolution:AnnotationResolutionV2}>}){
  assertInternal(args.actor);const rationale=normalizeRationale(args.rationale);
  assertUniqueAnnotationResolutions(args.annotation_resolutions??[]);
  validateCorrection(args.correction);await lockWorkspace(args.queryable,args.workspace.id);
  const operationInput={generation_key:args.generationKey,element_key:args.elementKey,
    reason:args.reason,rationale,correction:args.correction,annotation_resolutions:args.annotation_resolutions??[]};
  const resolutionInput=(args.annotation_resolutions?.length??0)>0
    ?{payload:operationInput,digest:digestCanonicalJsonV2(operationInput)}:undefined;
  const operation=await beginSignalProductOperationV1<{generation_key:string;element_key:string;
    element_version:number;disposition:"pending";draft_digest_ref:string}>({...args,
    action:"correct-semantic-context-element",input:operationInput,semanticContextDecisionInput:resolutionInput});
  if(operation.replay)return operation.replay;
  const generation=await requireEffectiveDraft(args.queryable,args.workspace.id,args.generationKey);
  await assertNoActiveRun(args.queryable,generation.id);
  const currentAuthority=await assertGenerationAuthorityCurrent(args.queryable,args.workspace,generation);
  const resolutionAuthority=await resolveAnnotationResolutionAuthority(args.queryable,
    currentAuthority.authority,args.actor.id);
  const current=await requireCurrentElement(args.queryable,generation.id,args.elementKey,true);
  if(current.disposition==="merged")throw new SignalSemanticContextPackError("semantic_context_merged_terminal");
  const refs=await loadRefs(args.queryable,current.evidence_group_id);const version=current.element_version+1;
  const proposal={...definition(current),...args.correction,entity_type:current.entity_type,entity_id:current.entity_id};
  const created=await createElement(args.queryable,{workspaceId:args.workspace.id,generation,proposal,version,
    disposition:"pending",originKind:"operator_correction",supersedes:current.id,
    originalProposal:current.original_proposal_element_id??current.id,operationId:operation.operationId,
    actorId:args.actor.id,sourceRefs:refs});
  const annotations=await loadOpenAnnotations(args.queryable,generation.id,[current.id],true);
  const resolutions=new Map((args.annotation_resolutions??[]).map((entry)=>[entry.annotation_key,entry.resolution]));
  rejectUnknownResolutionKeys(resolutions,annotations);
  let eventIndex=1;
  for(const annotation of annotations){await createAnnotationSuccessor(args.queryable,{workspaceId:args.workspace.id,
    generationId:generation.id,predecessor:annotation,subjectId:created.id,resolution:resolutions.get(annotation.annotation_key),
    rationale,reason:args.reason,operationId:operation.operationId,actorId:args.actor.id,
    resolutionContext:"correction",eventIndex,resolutionAuthority,
    resolutionInputDigest:resolutionInput?.digest??null});eventIndex++;}
  const draftDigest=await refreshDraftDigestV2(args.queryable,generation.id);
  await insertEventV2(args.queryable,{workspaceId:args.workspace.id,generationId:generation.id,elementId:created.id,
    operationId:operation.operationId,eventIndex:0,eventKind:"element_corrected",previous:current.element_digest,
    next:created.elementDigest,actorId:args.actor.id});
  const result={generation_key:generation.generation_key,element_key:current.element_key,
    element_version:version,disposition:"pending" as const,draft_digest_ref:shortDigest(draftDigest)};
  await completeSignalProductOperationV1({queryable:args.queryable,workspaceId:args.workspace.id,
    key:operation.key,result});return result;
}

export async function annotateSignalSemanticContextElementV2(args:{queryable:SignalBrandPolicyQueryable;
  workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;idempotencyKey:string;generationKey:string;
  elementKey:string;annotationKey:string;annotationType:AnnotationTypeV2;reason:ReasonV2;rationale:string;
  relatedElementKeys:string[]}){
  assertInternal(args.actor);const rationale=normalizeRationale(args.rationale);assertKey(args.annotationKey);
  if(!SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_TYPES_V2.includes(args.annotationType))
    throw new SignalSemanticContextPackError("semantic_context_annotation_type_invalid",422);
  const relatedKeys=uniqueKeys(args.relatedElementKeys,100,true);await lockWorkspace(args.queryable,args.workspace.id);
  const operation=await beginSignalProductOperationV1<{annotation_key:string;annotation_version:number;
    state:"open"|"resolved";resolution:AnnotationResolutionV2|null}>({...args,
    action:"annotate-semantic-context-element",input:{generation_key:args.generationKey,element_key:args.elementKey,
      annotation_key:args.annotationKey,annotation_type:args.annotationType,reason:args.reason,rationale,
      related_element_keys:relatedKeys}});
  if(operation.replay)return operation.replay;
  const generation=await requireEffectiveDraft(args.queryable,args.workspace.id,args.generationKey);
  await assertNoActiveRun(args.queryable,generation.id);
  await assertGenerationAuthorityCurrent(args.queryable,args.workspace,generation);
  const subject=await requireCurrentElement(args.queryable,generation.id,args.elementKey,true);
  if(subject.disposition!=="pending")throw new SignalSemanticContextPackError("semantic_context_annotation_requires_pending");
  const related:ElementRow[]=[];
  for(const key of relatedKeys)related.push(await requireCurrentElement(args.queryable,generation.id,key,true));
  const current=await loadCurrentAnnotation(args.queryable,generation.id,args.annotationKey,true);
  if(current&&current.state!=="open")throw new SignalSemanticContextPackError("semantic_context_annotation_closed");
  if(current&&(current.annotation_type!==args.annotationType||current.subject_element_id!==subject.id))
    throw new SignalSemanticContextPackError("semantic_context_annotation_cas_conflict");
  const inserted=await args.queryable.query<{id:string}>(`INSERT INTO signal_semantic_context_review_annotations(
    workspace_id,generation_id,annotation_key,annotation_version,annotation_type,state,resolution,
    subject_element_id,related_element_ids,reason_code,rationale,supersedes_annotation_id,
    operation_id,actor_user_id) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8::uuid,$9::uuid[],$10,$11,
      $12::uuid,$13::uuid,$14::uuid) RETURNING id::text`,[args.workspace.id,generation.id,args.annotationKey,
    (current?.annotation_version??0)+1,args.annotationType,"open",null,
    subject.id,related.map((entry)=>entry.id),args.reason,rationale,current?.id??null,operation.operationId,args.actor.id]);
  const state="open" as const;
  await insertEventV2(args.queryable,{workspaceId:args.workspace.id,generationId:generation.id,
    elementId:subject.id,operationId:operation.operationId,eventIndex:0,eventKind:current
      ?"review_annotation_updated":"review_annotation_created",previous:current?digestCanonicalJsonV2(current):null,
    next:digestCanonicalJsonV2({id:inserted.rows[0]!.id,state}),actorId:args.actor.id});
  const result={annotation_key:args.annotationKey,annotation_version:(current?.annotation_version??0)+1,
    state,resolution:null};
  await completeSignalProductOperationV1({queryable:args.queryable,workspaceId:args.workspace.id,
    key:operation.key,result});return result;
}

export async function resolveSignalSemanticContextAnnotationV1(args:{queryable:SignalBrandPolicyQueryable;
  workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;idempotencyKey:string;generationKey:string;
  elementKey:string;annotationKey:string;resolution:AnnotationResolutionV2;reason:ReasonV2;rationale:string;
  confirmation:typeof SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONFIRMATION_V1}){
  if(args.confirmation!==SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONFIRMATION_V1)
    throw new SignalSemanticContextPackError("semantic_context_annotation_resolution_confirmation_required",422);
  return writeSignalSemanticContextAnnotationResolutionV1({...args,intent:"resolve"});
}

export async function repairSignalSemanticContextAnnotationResolutionV1(args:{queryable:SignalBrandPolicyQueryable;
  workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;idempotencyKey:string;generationKey:string;
  elementKey:string;annotationKey:string;resolution:AnnotationResolutionV2;reason:ReasonV2;rationale:string;
  confirmation:typeof SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_REPAIR_CONFIRMATION_V1}){
  if(args.confirmation!==SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_REPAIR_CONFIRMATION_V1)
    throw new SignalSemanticContextPackError("semantic_context_annotation_repair_confirmation_required",422);
  return writeSignalSemanticContextAnnotationResolutionV1({...args,intent:"repair"});
}

async function writeSignalSemanticContextAnnotationResolutionV1(args:{queryable:SignalBrandPolicyQueryable;
  workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;idempotencyKey:string;generationKey:string;
  elementKey:string;annotationKey:string;resolution:AnnotationResolutionV2;reason:ReasonV2;rationale:string;
  confirmation:string;intent:"resolve"|"repair"}){
  assertInternal(args.actor);assertKey(args.annotationKey);assertKey(args.elementKey);
  await lockWorkspace(args.queryable,args.workspace.id);
  const generation=await requireEffectiveDraft(args.queryable,args.workspace.id,args.generationKey);
  await assertNoActiveRun(args.queryable,generation.id);
  const predecessor=await loadCurrentAnnotation(args.queryable,generation.id,args.annotationKey,true);
  if(!predecessor)throw new SignalSemanticContextPackError("semantic_context_annotation_not_found",404);
  const subject=await args.queryable.query<{element_key:string}>(`SELECT element_key FROM
    signal_semantic_context_element_versions WHERE id=$1::uuid AND generation_id=$2::uuid`,
  [predecessor.subject_element_id,generation.id]);
  if(subject.rows[0]?.element_key!==args.elementKey)
    throw new SignalSemanticContextPackError("semantic_context_annotation_cas_conflict",409);
  const basis=normalizeSignalSemanticContextAnnotationResolutionBasisV1({annotationType:predecessor.annotation_type,
    resolution:args.resolution,reason:args.reason,rationale:args.rationale});
  const operationInput={contract_version:SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONTRACT_V1,
    generation_key:generation.generation_key,element_key:args.elementKey,annotation_key:args.annotationKey,
    action:args.intent,annotation_type:predecessor.annotation_type,resolution:args.resolution,
    decision_basis:basis,confirmation:args.confirmation};
  const inputDigest=digestCanonicalJsonV2(operationInput);
  const operation=await beginSignalProductOperationV1<{annotation_key:string;annotation_version:number;
    state:"resolved";resolution:AnnotationResolutionV2;resolution_basis:"complete"}>({...args,
    action:args.intent==="resolve"?"resolve-semantic-context-annotation":
      "repair-semantic-context-annotation-resolution",input:operationInput,
    semanticContextDecisionInput:{payload:operationInput,digest:inputDigest}});
  if(operation.replay)return operation.replay;
  if(args.intent==="resolve"&&predecessor.state!=="open")
    throw new SignalSemanticContextPackError("semantic_context_annotation_closed",409);
  if(args.intent==="repair"){
    if(predecessor.state!=="resolved"||predecessor.resolution!==args.resolution)
      throw new SignalSemanticContextPackError("semantic_context_annotation_repair_not_eligible",409);
    if(annotationResolutionBasisComplete(predecessor))
      throw new SignalSemanticContextPackError("semantic_context_annotation_resolution_basis_complete",409);
  }
  const currentAuthority=await assertGenerationAuthorityCurrent(args.queryable,args.workspace,generation);
  const authoritySnapshot=await resolveAnnotationResolutionAuthority(args.queryable,
    currentAuthority.authority,args.actor.id);
  const authorityDigest=digestCanonicalJsonV2(authoritySnapshot);
  const basisDigest=digestCanonicalJsonV2(basis);
  const prestateDigest=signalSemanticContextAnnotationStateDigestV1(predecessor);
  const successorState={annotation_key:predecessor.annotation_key,
    annotation_version:predecessor.annotation_version+1,annotation_type:predecessor.annotation_type,
    state:"resolved" as const,resolution:args.resolution,subject_element_id:predecessor.subject_element_id,
    related_element_ids:predecessor.related_element_ids,reason_code:basis.reason,rationale:basis.rationale,
    resolution_contract_version:basis.contract_version,resolution_basis_digest:basisDigest,
    resolution_input_digest:inputDigest,resolution_authority_digest:authorityDigest};
  const poststateDigest=signalSemanticContextAnnotationStateDigestV1(successorState);
  await args.queryable.query(`INSERT INTO signal_semantic_context_review_annotations(workspace_id,generation_id,
    annotation_key,annotation_version,annotation_type,state,resolution,subject_element_id,related_element_ids,
    reason_code,rationale,supersedes_annotation_id,operation_id,actor_user_id,resolution_contract_version,
    resolution_basis_digest,resolution_input_digest,resolution_authority_snapshot,resolution_authority_digest,
    resolution_prestate_digest,resolution_poststate_digest)
    VALUES($1::uuid,$2::uuid,$3,$4,$5,'resolved',$6,$7::uuid,$8::uuid[],$9,$10,$11::uuid,$12::uuid,$13::uuid,
      $14,$15,$16,$17::jsonb,$18,$19,$20)`,[args.workspace.id,generation.id,predecessor.annotation_key,
    predecessor.annotation_version+1,predecessor.annotation_type,args.resolution,predecessor.subject_element_id,
    predecessor.related_element_ids,basis.reason,basis.rationale,predecessor.id,operation.operationId,args.actor.id,
    basis.contract_version,basisDigest,inputDigest,JSON.stringify(authoritySnapshot),authorityDigest,
    prestateDigest,poststateDigest]);
  await insertEventV2(args.queryable,{workspaceId:args.workspace.id,generationId:generation.id,
    elementId:predecessor.subject_element_id,operationId:operation.operationId,eventIndex:0,
    eventKind:"review_annotation_resolved",previous:prestateDigest,next:poststateDigest,actorId:args.actor.id});
  const result={annotation_key:predecessor.annotation_key,annotation_version:predecessor.annotation_version+1,
    state:"resolved" as const,resolution:args.resolution,resolution_basis:"complete" as const};
  await completeSignalProductOperationV1({queryable:args.queryable,workspaceId:args.workspace.id,
    key:operation.key,result});return result;
}

export async function mergeSignalSemanticContextElementsV2(args:{queryable:SignalBrandPolicyQueryable;
  workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;idempotencyKey:string;generationKey:string;
  targetElementKey:string;sourceElementKeys:string[];reason:ReasonV2;rationale:string;
  targetCorrection:{canonical_key:string;display_text:string;scope:string|null;locale:string|null;
    relation_kind:typeof SIGNAL_SEMANTIC_CONTEXT_RELATION_KINDS[number]|null;relation_target_key:string|null};
  targetAnnotationResolutions?:Array<{annotation_key:string;resolution:AnnotationResolutionV2}>}){
  assertInternal(args.actor);const rationale=normalizeRationale(args.rationale);
  assertUniqueAnnotationResolutions(args.targetAnnotationResolutions??[]);
  const sourceKeys=uniqueKeys(args.sourceElementKeys,100);assertKey(args.targetElementKey);
  if(sourceKeys.includes(args.targetElementKey))throw new SignalSemanticContextPackError("semantic_context_merge_self",422);
  validateCorrection(args.targetCorrection);await lockWorkspace(args.queryable,args.workspace.id);
  const operationInput={generation_key:args.generationKey,target_element_key:args.targetElementKey,
    source_element_keys:sourceKeys,reason:args.reason,rationale,target_correction:args.targetCorrection,
    target_annotation_resolutions:args.targetAnnotationResolutions??[]};
  const resolutionInput={payload:operationInput,digest:digestCanonicalJsonV2(operationInput)};
  const operation=await beginSignalProductOperationV1<{generation_key:string;target_element_key:string;
    source_element_keys:string[];merged:number;target_disposition:"pending";draft_digest_ref:string;
    annotation_reconciliation:Record<string,number>}>({...args,action:"merge-semantic-context-elements",
    input:operationInput,semanticContextDecisionInput:resolutionInput});
  if(operation.replay)return operation.replay;
  const generation=await requireEffectiveDraft(args.queryable,args.workspace.id,args.generationKey);
  await assertNoActiveRun(args.queryable,generation.id);
  const currentAuthority=await assertGenerationAuthorityCurrent(args.queryable,args.workspace,generation);
  const resolutionAuthority=await resolveAnnotationResolutionAuthority(args.queryable,
    currentAuthority.authority,args.actor.id);
  const target=await requireCurrentElement(args.queryable,generation.id,args.targetElementKey,true);
  const sources:ElementRow[]=[];
  for(const key of sourceKeys)sources.push(await requireCurrentElement(args.queryable,generation.id,key,true));
  if(target.disposition==="merged"||sources.some((entry)=>entry.disposition==="merged"))
    throw new SignalSemanticContextPackError("semantic_context_merged_terminal");
  if(sources.some((entry)=>entry.element_kind!==target.element_kind))
    throw new SignalSemanticContextPackError("semantic_context_merge_kind_mismatch",422);
  await assertNoMergeCycle(args.queryable,generation.id,target.element_key,sourceKeys);
  const sourceAnnotations=await loadOpenAnnotations(args.queryable,generation.id,sources.map((entry)=>entry.id),true);
  for(const source of sources){const owned=sourceAnnotations.filter((entry)=>entry.subject_element_id===source.id);
    const matching=owned.filter((entry)=>entry.annotation_type==="near_duplicate"
      &&entry.related_element_ids.includes(target.id));
    if(matching.length<1)throw new SignalSemanticContextPackError("semantic_context_merge_annotation_required");
    if(owned.length!==matching.length)throw new SignalSemanticContextPackError("semantic_context_merge_source_annotation_blocked");}
  const targetAnnotations=await loadOpenAnnotations(args.queryable,generation.id,[target.id],true);
  const targetResolutions=new Map((args.targetAnnotationResolutions??[]).map((entry)=>[entry.annotation_key,entry.resolution]));
  rejectUnknownResolutionKeys(targetResolutions,targetAnnotations);
  const refGroups:SourceRef[][]=[];
  for(const entry of [target,...sources])refGroups.push(await loadRefs(args.queryable,entry.evidence_group_id));
  const union=sortAndDedupeRefs(refGroups.flat());const targetVersion=target.element_version+1;
  const targetSuccessor=await createElement(args.queryable,{workspaceId:args.workspace.id,generation,
    proposal:{...definition(target),...args.targetCorrection,entity_type:target.entity_type,entity_id:target.entity_id},
    version:targetVersion,disposition:"pending",originKind:"operator_correction",supersedes:target.id,
    originalProposal:target.original_proposal_element_id??target.id,operationId:operation.operationId,
    actorId:args.actor.id,sourceRefs:union});
  const mergedSuccessors:Array<{source:ElementRow;successor:{id:string;elementDigest:string}}>=[];
  for(let index=0;index<sources.length;index++){const source=sources[index]!;
    const successor=await createElement(args.queryable,{workspaceId:args.workspace.id,generation,
      proposal:definition(source),version:source.element_version+1,disposition:"merged",originKind:"operator_merge",
      supersedes:source.id,originalProposal:source.original_proposal_element_id??source.id,
      operationId:operation.operationId,actorId:args.actor.id,sourceRefs:refGroups[index+1]!});
    mergedSuccessors.push({source,successor});
  }
  for(const entry of mergedSuccessors){await args.queryable.query(`INSERT INTO signal_semantic_context_merge_edges(
    workspace_id,generation_id,operation_id,source_predecessor_id,source_element_key,source_element_version,
    source_merged_successor_id,target_predecessor_id,target_element_key,target_element_version,
    target_pending_successor_id,reason_code,rationale,actor_user_id)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7::uuid,$8::uuid,$9,$10,$11::uuid,$12,$13,$14::uuid)`,
    [args.workspace.id,generation.id,operation.operationId,entry.source.id,entry.source.element_key,
      entry.source.element_version,entry.successor.id,target.id,target.element_key,target.element_version,
      targetSuccessor.id,args.reason,rationale,args.actor.id]);}
  let sourceResolved=0,targetRebound=0,targetResolved=0,eventIndex=1;
  for(const annotation of sourceAnnotations){await createAnnotationSuccessor(args.queryable,{workspaceId:args.workspace.id,
    generationId:generation.id,predecessor:annotation,subjectId:annotation.subject_element_id,resolution:"merged",
    rationale,reason:args.reason,operationId:operation.operationId,actorId:args.actor.id,
    resolutionContext:"merge",eventIndex,resolutionAuthority,
    resolutionInputDigest:resolutionInput.digest});sourceResolved++;eventIndex++;}
  for(const annotation of targetAnnotations){const resolution=targetResolutions.get(annotation.annotation_key);
    await createAnnotationSuccessor(args.queryable,{workspaceId:args.workspace.id,generationId:generation.id,
      predecessor:annotation,subjectId:targetSuccessor.id,resolution,rationale,reason:args.reason,
      operationId:operation.operationId,actorId:args.actor.id,
      resolutionContext:"correction",eventIndex,resolutionAuthority,
      resolutionInputDigest:resolutionInput.digest});targetRebound++;if(resolution)targetResolved++;eventIndex++;}
  const openOnMerged=await args.queryable.query<{count:number}>(`SELECT count(*)::int count
    FROM signal_semantic_context_review_annotations annotation
    WHERE annotation.subject_element_id=ANY($1::uuid[]) AND annotation.state='open' AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_review_annotations successor
      WHERE successor.supersedes_annotation_id=annotation.id)`,[mergedSuccessors.map((entry)=>entry.successor.id)]);
  if(openOnMerged.rows[0]?.count!==0)throw new SignalSemanticContextPackError("semantic_context_merge_annotation_equation_failed");
  const draftDigest=await refreshDraftDigestV2(args.queryable,generation.id);
  await insertEventV2(args.queryable,{workspaceId:args.workspace.id,generationId:generation.id,
    elementId:targetSuccessor.id,operationId:operation.operationId,eventIndex:0,eventKind:"elements_merged",
    previous:generation.draft_digest,next:draftDigest,actorId:args.actor.id});
  const result={generation_key:generation.generation_key,target_element_key:target.element_key,
    source_element_keys:sourceKeys,merged:sources.length,target_disposition:"pending" as const,
    draft_digest_ref:shortDigest(draftDigest),
    annotation_reconciliation:{source_count:sources.length,
      source_matching_near_duplicate_resolved:sourceResolved,source_other_open_annotations:0,
      target_open_annotations_before:targetAnnotations.length,
      target_annotations_rebound_open:targetRebound-targetResolved,
      target_annotations_resolved_in_merge:targetResolved,merged_successor_open_annotations:0,
      open_annotations_before:sourceAnnotations.length+targetAnnotations.length,
      open_annotations_after:targetRebound-targetResolved}};
  await completeSignalProductOperationV1({queryable:args.queryable,workspaceId:args.workspace.id,
    key:operation.key,result});return result;
}

export async function loadSignalSemanticContextPublicationPreflightV2(args:{queryable:SignalBrandPolicyQueryable;
  workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;generationKey:string}){
  assertInternal(args.actor);const generation=await loadGeneration(args.queryable,args.workspace.id,args.generationKey);
  if(!generation)throw new SignalSemanticContextPackError("semantic_context_generation_not_found",404);
  const currentAuthority=await resolveCurrentPublicationAuthority(args.queryable,args.workspace,generation);
  const result=await args.queryable.query<{snapshot:Snapshot}>(
    `SELECT signal_semantic_context_publication_snapshot_v2($1::uuid,$2::jsonb) snapshot`,
    [generation.id,JSON.stringify(currentAuthority.authority)]);
  const snapshot=result.rows[0]!.snapshot;
  return{contract_version:"signal-semantic-context-publish-preflight-v2" as const,
    generation_key:generation.generation_key,generation_version:generation.generation_version,
    counts:snapshot.counts,collisions:snapshot.collisions,blockers:snapshot.blockers,
    publishable:snapshot.publishable,
    digest_refs:{candidate:shortDigest(snapshot.candidate_pack_digest),evidence:shortDigest(snapshot.evidence_graph_digest),
      review:shortDigest(snapshot.review_graph_digest),authority:shortDigest(snapshot.publication_authority_digest),
      pack:shortDigest(snapshot.semantic_context_pack_digest)},preflight_digest:snapshot.publish_preflight_digest,
    writes_performed:false,provider_calls:0};
}

export async function publishSignalSemanticContextGenerationV2(args:{queryable:SignalBrandPolicyQueryable;
  workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;idempotencyKey:string;generationKey:string;
  preflightDigest:string;confirmation:typeof SIGNAL_SEMANTIC_CONTEXT_PUBLICATION_CONFIRMATION_V2}){
  assertInternal(args.actor);if(args.confirmation!==SIGNAL_SEMANTIC_CONTEXT_PUBLICATION_CONFIRMATION_V2)
    throw new SignalSemanticContextPackError("semantic_context_publish_v1_retired",410);
  if(!digestPattern.test(args.preflightDigest))throw new SignalSemanticContextPackError("semantic_context_preflight_invalid",422);
  await lockWorkspace(args.queryable,args.workspace.id);
  const operationInput={generation_key:args.generationKey,preflight_digest:args.preflightDigest,
    confirmation:args.confirmation};
  const replay=await loadPublicationReplay<{generation_key:string;generation_version:number;
    lifecycle_state:"published";semantic_context_pack_digest:string}>(args.queryable,args.workspace.id,args.actor.id,args.idempotencyKey,
    operationRequestDigest(args.workspace.id,"publish-semantic-context-generation",operationInput));
  if(replay)return replay;
  const generation=await requireEffectiveDraft(args.queryable,args.workspace.id,args.generationKey);
  await assertNoActiveRun(args.queryable,generation.id);
  const currentAuthority=await resolveCurrentPublicationAuthority(args.queryable,args.workspace,generation);
  if(currentAuthority.blockers.includes("authority_drift"))
    throw new SignalSemanticContextPackError("semantic_context_authority_drift");
  if(currentAuthority.blockers.includes("provider_lineage_not_current"))
    throw new SignalSemanticContextPackError("semantic_context_provider_lineage_drift");
  const snapshotResult=await args.queryable.query<{snapshot:Snapshot}>(
    `SELECT signal_semantic_context_publication_snapshot_v2($1::uuid,$2::jsonb) snapshot`,
    [generation.id,JSON.stringify(currentAuthority.authority)]);
  const snapshot=snapshotResult.rows[0]!.snapshot;
  if(snapshot.publish_preflight_digest!==args.preflightDigest)
    throw new SignalSemanticContextPackError("semantic_context_stale_preflight");
  if(!snapshot.publishable)throw new SignalSemanticContextPackError("semantic_context_not_publishable");
  const operation=await beginSignalProductOperationV1<{generation_key:string;generation_version:number;
    lifecycle_state:"published";semantic_context_pack_digest:string}>({...args,
    action:"publish-semantic-context-generation",input:operationInput});
  if(operation.replay)return operation.replay;
  const updated=await args.queryable.query(`UPDATE signal_semantic_context_generations SET
    status='published',pack_digest=$3,publication_schema_version=$4,candidate_pack_digest=$5,
    evidence_graph_digest=$6,review_graph_digest=$7,publication_authority_digest=$8,
    publication_authority_snapshot=$9::jsonb,semantic_context_pack_digest=$10,
    publish_preflight_digest=$11,publication_counts=$12::jsonb,
    published_operation_id=$13::uuid,published_by_user_id=$14::uuid,published_at=clock_timestamp()
    WHERE id=$1::uuid AND workspace_id=$2::uuid AND status='draft'`,[generation.id,args.workspace.id,
    snapshot.semantic_context_pack_digest,SIGNAL_SEMANTIC_CONTEXT_PUBLICATION_SCHEMA_V2,
    snapshot.candidate_pack_digest,snapshot.evidence_graph_digest,snapshot.review_graph_digest,
    snapshot.publication_authority_digest,JSON.stringify(currentAuthority.authority),
    snapshot.semantic_context_pack_digest,snapshot.publish_preflight_digest,
    JSON.stringify(snapshot.counts),operation.operationId,args.actor.id]);
  if(updated.rowCount!==1)throw new SignalSemanticContextPackError("semantic_context_publish_conflict");
  await insertEventV2(args.queryable,{workspaceId:args.workspace.id,generationId:generation.id,
    operationId:operation.operationId,eventIndex:0,eventKind:"generation_published",previous:generation.draft_digest,
    next:snapshot.semantic_context_pack_digest,actorId:args.actor.id});
  const result={generation_key:generation.generation_key,generation_version:generation.generation_version,
    lifecycle_state:"published" as const,semantic_context_pack_digest:snapshot.semantic_context_pack_digest};
  await completeSignalProductOperationV1({queryable:args.queryable,workspaceId:args.workspace.id,
    key:operation.key,result});return result;
}

export async function mergeSignalSemanticContextElementsProductV2(args:Omit<Parameters<typeof mergeSignalSemanticContextElementsV2>[0],"queryable">){
  return withSignalAcquisitionTransactionV1((queryable)=>mergeSignalSemanticContextElementsV2({...args,queryable}));}
export async function decideSignalSemanticContextElementProductV2(args:Omit<Parameters<typeof decideSignalSemanticContextElementV2>[0],"queryable">){
  return withSignalAcquisitionTransactionV1((queryable)=>decideSignalSemanticContextElementV2({...args,queryable}));}
export async function bulkApproveSignalSemanticContextElementsProductV2(args:Omit<Parameters<typeof bulkApproveSignalSemanticContextElementsV2>[0],"queryable">){
  return withSignalAcquisitionTransactionV1((queryable)=>bulkApproveSignalSemanticContextElementsV2({...args,queryable}));}
export async function correctSignalSemanticContextElementProductV2(args:Omit<Parameters<typeof correctSignalSemanticContextElementV2>[0],"queryable">){
  return withSignalAcquisitionTransactionV1((queryable)=>correctSignalSemanticContextElementV2({...args,queryable}));}
export async function annotateSignalSemanticContextElementProductV2(args:Omit<Parameters<typeof annotateSignalSemanticContextElementV2>[0],"queryable">){
  return withSignalAcquisitionTransactionV1((queryable)=>annotateSignalSemanticContextElementV2({...args,queryable}));}
export async function resolveSignalSemanticContextAnnotationProductV1(args:Omit<Parameters<typeof resolveSignalSemanticContextAnnotationV1>[0],"queryable">){
  return withSignalAcquisitionTransactionV1((queryable)=>resolveSignalSemanticContextAnnotationV1({...args,queryable}));}
export async function repairSignalSemanticContextAnnotationResolutionProductV1(args:Omit<Parameters<typeof repairSignalSemanticContextAnnotationResolutionV1>[0],"queryable">){
  return withSignalAcquisitionTransactionV1((queryable)=>repairSignalSemanticContextAnnotationResolutionV1({...args,queryable}));}
export async function publishSignalSemanticContextGenerationProductV2(args:Omit<Parameters<typeof publishSignalSemanticContextGenerationV2>[0],"queryable">){
  return withSignalAcquisitionTransactionV1((queryable)=>publishSignalSemanticContextGenerationV2({...args,queryable}));}
export async function loadSignalSemanticContextPublicationPreflightProductV2(args:Omit<Parameters<typeof loadSignalSemanticContextPublicationPreflightV2>[0],"queryable">){
  const{pool}=await import("@/lib/db");const client=await pool.connect();
  try{
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result=await loadSignalSemanticContextPublicationPreflightV2({...args,queryable:client});
    await client.query("COMMIT");return result;
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();}}

async function loadGeneration(queryable:SignalBrandPolicyQueryable,workspaceId:string,generationKey:string){
  const result=await queryable.query<GenerationRow>(`SELECT id::text,generation_key,generation_version,status,
    brand_os_digest,knowledge_digest,locale_context_digest,proposal_model,proposal_model_version,proposal_prompt_digest,
    proposal_pricing_version,proposal_provider_lineage,
    proposal_provider_lineage_digest,draft_digest,
    published_operation_id::text FROM signal_semantic_context_generations
    WHERE workspace_id=$1::uuid AND generation_key=$2 LIMIT 1`,[workspaceId,generationKey]);return result.rows[0]??null;}
async function requireEffectiveDraft(queryable:SignalBrandPolicyQueryable,workspaceId:string,generationKey:string){
  const generation=await loadGeneration(queryable,workspaceId,generationKey);
  if(!generation||generation.status!=="draft"||await hasGenerationSuccessor(queryable,generation.id))
    throw new SignalSemanticContextPackError("semantic_context_draft_not_found",404);return generation;}
async function hasGenerationSuccessor(queryable:SignalBrandPolicyQueryable,generationId:string){const result=await queryable.query<{exists:boolean}>(
  `SELECT EXISTS(SELECT 1 FROM signal_semantic_context_generations WHERE supersedes_generation_id=$1::uuid) exists`,[generationId]);return result.rows[0]?.exists===true;}
async function requireCurrentElement(queryable:SignalBrandPolicyQueryable,generationId:string,elementKey:string,lock:boolean){
  const result=await queryable.query<ElementRow>(`SELECT id::text,artifact_id::text,evidence_group_id::text,element_key,
    element_version,element_kind,canonical_key,display_text,scope,entity_type,entity_id::text,locale,relation_kind,
    relation_target_key,confidence::text,disposition,origin_kind,supersedes_element_id::text,
    original_proposal_element_id::text,source_refs_digest,element_digest
    FROM signal_semantic_context_element_versions element WHERE generation_id=$1::uuid AND element_key=$2
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor
        WHERE successor.supersedes_element_id=element.id) ${lock?"FOR UPDATE":""}`,[generationId,elementKey]);
  if(result.rows.length!==1)throw new SignalSemanticContextPackError("semantic_context_element_cas_conflict",409);
  return result.rows[0]!;}
async function loadRefs(queryable:SignalBrandPolicyQueryable,evidenceGroupId:string){const result=await queryable.query<SourceRef>(
  `SELECT source_type,lower(source_id::text) source_id,relation_type FROM analysis_evidence_links
   WHERE evidence_group_id=$1::uuid ORDER BY convert_to(source_type,'UTF8'),convert_to(lower(source_id::text),'UTF8'),
   convert_to(relation_type,'UTF8')`,[evidenceGroupId]);if(result.rows.length<1)
  throw new SignalSemanticContextPackError("semantic_context_evidence_invalid");return sortAndDedupeRefs(result.rows);}
function sortAndDedupeRefs(refs:SourceRef[]){const map=new Map<string,SourceRef>();for(const ref of refs){const normalized={...ref,source_id:ref.source_id.toLowerCase()};
  map.set(`${ref.source_type}\u001f${normalized.source_id}\u001f${ref.relation_type}`,normalized);}return[...map.values()].sort((a,b)=>
    compareUtf8(a.source_type,b.source_type)||compareUtf8(a.source_id,b.source_id)||compareUtf8(a.relation_type,b.relation_type));}
function definition(element:ElementRow){return{element_key:element.element_key,element_kind:element.element_kind,
  canonical_key:element.canonical_key,display_text:element.display_text,scope:element.scope,
  entity_type:element.entity_type,entity_id:element.entity_id,locale:element.locale,
  relation_kind:element.relation_kind,relation_target_key:element.relation_target_key,
  confidence:element.confidence===null?null:Number(element.confidence)};}
function withoutConfidence<T extends{confidence:unknown}>(value:T):Omit<T,"confidence">{
  const result={...value} as T&{confidence?:unknown};delete result.confidence;return result;}
async function createElement(queryable:SignalBrandPolicyQueryable,args:{workspaceId:string;generation:GenerationRow;
  proposal:ReturnType<typeof definition>;version:number;disposition:DispositionV2;originKind:"operator_correction"|"operator_merge";
  supersedes:string;originalProposal:string;operationId:string;actorId:string;sourceRefs:SourceRef[]}){
  const refs=sortAndDedupeRefs(args.sourceRefs);const sourceRefsDigest=digestCanonicalJsonV2(refs);
  const authoritativeProposal=withoutConfidence(args.proposal);
  const elementDigest=digestCanonicalJsonV2({contract_version:"signal-semantic-context-element-v2",
    ...authoritativeProposal,element_version:args.version,disposition:args.disposition,source_refs_digest:sourceRefsDigest});
  const artifact=await queryable.query<{id:string}>(`INSERT INTO analysis_artifacts(workspace_id,
    workspace_artifact_kind,workspace_authority_digest,artifact_key,artifact_type,content,confidence,
    review_status,revision,metadata) VALUES($1::uuid,'semantic_context',$2,$3,'semantic_context_element',$4::jsonb,
    $5,$6,$7,$8::jsonb) RETURNING id::text`,[args.workspaceId,elementDigest,args.proposal.element_key,
    JSON.stringify({element_kind:args.proposal.element_kind,canonical_key:args.proposal.canonical_key,
      display_text:args.proposal.display_text,scope:args.proposal.scope,locale:args.proposal.locale,
      relation_kind:args.proposal.relation_kind,relation_target_key:args.proposal.relation_target_key}),
    args.proposal.confidence===null?null:String(args.proposal.confidence),args.disposition==="pending"?"needs_review":"corrected",
    args.version,JSON.stringify({authority_only:true,confidence_authoritative:false})]);
  const group=await queryable.query<{id:string}>(`INSERT INTO analysis_evidence_groups(artifact_id,group_key,role,
    label,summary,position,metadata) VALUES($1::uuid,'source-authority','supporting','Source authority',NULL,0,$2::jsonb)
    RETURNING id::text`,[artifact.rows[0]!.id,JSON.stringify({source_refs_digest:sourceRefsDigest})]);
  await queryable.query(`INSERT INTO analysis_evidence_links(evidence_group_id,source_type,source_id,relation_type,
    evidence_role,quote,locator,position,metadata) SELECT $1::uuid,input.source_type,input.source_id,input.relation_type,
    'supporting',NULL,'{}'::jsonb,input.position,'{}'::jsonb FROM unnest($2::text[],$3::uuid[],$4::text[],$5::int[])
    input(source_type,source_id,relation_type,position)`,[group.rows[0]!.id,refs.map((ref)=>ref.source_type),
    refs.map((ref)=>ref.source_id),refs.map((ref)=>ref.relation_type),refs.map((_,index)=>index)]);
  const inserted=await queryable.query<{id:string}>(`INSERT INTO signal_semantic_context_element_versions(
    workspace_id,generation_id,artifact_id,evidence_group_id,element_key,element_version,element_kind,canonical_key,
    display_text,scope,entity_type,entity_id,locale,relation_kind,relation_target_key,confidence,disposition,origin_kind,
    supersedes_element_id,original_proposal_element_id,source_refs_digest,element_digest,operation_id,proposed_by_user_id,
    decided_by_user_id,decided_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12::uuid,$13,
    $14,$15,$16,$17,$18,$19::uuid,$20::uuid,$21,$22,$23::uuid,$24::uuid,$25::uuid,
    CASE WHEN $17='pending' THEN NULL ELSE clock_timestamp() END) RETURNING id::text`,[args.workspaceId,args.generation.id,
    artifact.rows[0]!.id,group.rows[0]!.id,args.proposal.element_key,args.version,args.proposal.element_kind,
    args.proposal.canonical_key,args.proposal.display_text,args.proposal.scope,args.proposal.entity_type,args.proposal.entity_id,
    args.proposal.locale,args.proposal.relation_kind,args.proposal.relation_target_key,args.proposal.confidence,args.disposition,
    args.originKind,args.supersedes,args.originalProposal,sourceRefsDigest,elementDigest,args.operationId,args.actorId,
    args.disposition==="pending"?null:args.actorId]);return{...inserted.rows[0]!,elementDigest};}

async function createDecisionElementV2(queryable:SignalBrandPolicyQueryable,args:{workspaceId:string;
  generation:GenerationRow;current:ElementRow;disposition:"approved"|"rejected";
  basis:SignalSemanticContextDecisionBasisV2;operationId:string;actorId:string}){
  const proposal=definition(args.current);const refs=await loadRefs(queryable,args.current.evidence_group_id);
  const sourceRefsDigest=digestCanonicalJsonV2(refs);const version=args.current.element_version+1;
  const elementDigest=signalSemanticContextDecisionElementDigestV2({definition:withoutConfidence(proposal),
    elementVersion:version,disposition:args.disposition,sourceRefsDigest,basis:args.basis});
  const basisDigest=digestCanonicalJsonV2(args.basis);
  const artifact=await queryable.query<{id:string}>(`INSERT INTO analysis_artifacts(workspace_id,
    workspace_artifact_kind,workspace_authority_digest,artifact_key,artifact_type,content,confidence,
    review_status,revision,metadata) VALUES($1::uuid,'semantic_context',$2,$3,'semantic_context_element',$4::jsonb,
    $5,$6,$7,$8::jsonb) RETURNING id::text`,[args.workspaceId,elementDigest,proposal.element_key,
    JSON.stringify({element_kind:proposal.element_kind,canonical_key:proposal.canonical_key,
      display_text:proposal.display_text,scope:proposal.scope,locale:proposal.locale,
      relation_kind:proposal.relation_kind,relation_target_key:proposal.relation_target_key}),
    proposal.confidence===null?null:String(proposal.confidence),args.disposition==="approved"?"accepted":"rejected",
    version,JSON.stringify({authority_only:true,confidence_authoritative:false,decision_basis_digest:basisDigest})]);
  const group=await queryable.query<{id:string}>(`INSERT INTO analysis_evidence_groups(artifact_id,group_key,role,
    label,summary,position,metadata) VALUES($1::uuid,'source-authority','supporting','Source authority',NULL,0,$2::jsonb)
    RETURNING id::text`,[artifact.rows[0]!.id,JSON.stringify({source_refs_digest:sourceRefsDigest})]);
  await queryable.query(`INSERT INTO analysis_evidence_links(evidence_group_id,source_type,source_id,relation_type,
    evidence_role,quote,locator,position,metadata) SELECT $1::uuid,input.source_type,input.source_id,input.relation_type,
    'supporting',NULL,'{}'::jsonb,input.position,'{}'::jsonb FROM unnest($2::text[],$3::uuid[],$4::text[],$5::int[])
    input(source_type,source_id,relation_type,position)`,[group.rows[0]!.id,refs.map((ref)=>ref.source_type),
    refs.map((ref)=>ref.source_id),refs.map((ref)=>ref.relation_type),refs.map((_,index)=>index)]);
  const inserted=await queryable.query<{id:string}>(`INSERT INTO signal_semantic_context_element_versions(
    workspace_id,generation_id,artifact_id,evidence_group_id,element_key,element_version,element_kind,canonical_key,
    display_text,scope,entity_type,entity_id,locale,relation_kind,relation_target_key,confidence,disposition,origin_kind,
    supersedes_element_id,original_proposal_element_id,source_refs_digest,element_digest,operation_id,proposed_by_user_id,
    decided_by_user_id,decided_at,decision_contract_version,decision_reason_code,decision_rationale,decision_basis_digest)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12::uuid,$13,$14,$15,$16,$17,
      'operator_decision',$18::uuid,$19::uuid,$20,$21,$22::uuid,$23::uuid,$23::uuid,clock_timestamp(),$24,$25,$26,$27)
    RETURNING id::text`,[args.workspaceId,args.generation.id,artifact.rows[0]!.id,group.rows[0]!.id,
    proposal.element_key,version,proposal.element_kind,proposal.canonical_key,proposal.display_text,proposal.scope,
    proposal.entity_type,proposal.entity_id,proposal.locale,proposal.relation_kind,proposal.relation_target_key,
    proposal.confidence,args.disposition,args.current.id,args.current.original_proposal_element_id??args.current.id,
    sourceRefsDigest,elementDigest,args.operationId,args.actorId,args.basis.contract_version,args.basis.reason,
    args.basis.rationale,basisDigest]);
  return{...inserted.rows[0]!,elementDigest};
}
async function loadOpenAnnotations(queryable:SignalBrandPolicyQueryable,generationId:string,subjectIds:string[],lock:boolean){
  const result=await queryable.query<AnnotationRow>(`SELECT id::text,annotation_key,annotation_version,annotation_type,
    state,resolution,subject_element_id::text,related_element_ids::text[],reason_code,rationale,
    resolution_contract_version,resolution_basis_digest,resolution_input_digest,resolution_authority_snapshot,
    resolution_authority_digest,resolution_prestate_digest,resolution_poststate_digest
    FROM signal_semantic_context_review_annotations annotation WHERE generation_id=$1::uuid
      AND subject_element_id=ANY($2::uuid[]) AND state='open' AND NOT EXISTS(
        SELECT 1 FROM signal_semantic_context_review_annotations successor
        WHERE successor.supersedes_annotation_id=annotation.id) ORDER BY annotation_key ${lock?"FOR UPDATE":""}`,
    [generationId,subjectIds]);return result.rows;}
async function loadCurrentAnnotation(queryable:SignalBrandPolicyQueryable,generationId:string,annotationKey:string,lock:boolean){
  const result=await queryable.query<AnnotationRow>(`SELECT id::text,annotation_key,annotation_version,annotation_type,
    state,resolution,subject_element_id::text,related_element_ids::text[],reason_code,rationale,
    resolution_contract_version,resolution_basis_digest,resolution_input_digest,resolution_authority_snapshot,
    resolution_authority_digest,resolution_prestate_digest,resolution_poststate_digest
    FROM signal_semantic_context_review_annotations annotation WHERE generation_id=$1::uuid AND annotation_key=$2
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_review_annotations successor
        WHERE successor.supersedes_annotation_id=annotation.id) ${lock?"FOR UPDATE":""}`,[generationId,annotationKey]);
  if(result.rows.length>1)throw new SignalSemanticContextPackError("semantic_context_annotation_fork");return result.rows[0]??null;}
async function createAnnotationSuccessor(queryable:SignalBrandPolicyQueryable,args:{workspaceId:string;generationId:string;
  predecessor:AnnotationRow;subjectId:string;resolution?:AnnotationResolutionV2;rationale:string;reason:ReasonV2;
  operationId:string;actorId:string;resolutionContext:"merge"|"correction";eventIndex:number;
  resolutionAuthority:unknown;resolutionInputDigest:string|null}){
  validateResolution(args.predecessor.annotation_type,args.resolution??null,null,[],args.resolutionContext);
  const basis=args.resolution?{contract_version:SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONTRACT_V1,
    annotation_type:args.predecessor.annotation_type,resolution:args.resolution,reason:args.reason,
    rationale:normalizeRationale(args.rationale)} satisfies SignalSemanticContextAnnotationResolutionBasisV1:null;
  const basisDigest=basis?digestCanonicalJsonV2(basis):null;
  const authorityDigest=basis?digestCanonicalJsonV2(args.resolutionAuthority):null;
  if(basis&&!args.resolutionInputDigest)
    throw new SignalSemanticContextPackError("semantic_context_annotation_resolution_input_missing",422);
  const prestateDigest=basis?signalSemanticContextAnnotationStateDigestV1(args.predecessor):null;
  const successorState={annotation_key:args.predecessor.annotation_key,
    annotation_version:args.predecessor.annotation_version+1,annotation_type:args.predecessor.annotation_type,
    state:args.resolution?"resolved" as const:"open" as const,resolution:args.resolution??null,
    subject_element_id:args.subjectId,related_element_ids:args.predecessor.related_element_ids,
    reason_code:args.reason,rationale:args.rationale,
    resolution_contract_version:basis?.contract_version??null,resolution_basis_digest:basisDigest,
    resolution_input_digest:basis?args.resolutionInputDigest:null,resolution_authority_digest:authorityDigest};
  const poststateDigest=basis?signalSemanticContextAnnotationStateDigestV1(successorState):null;
  const inserted=await queryable.query<{id:string}>(`INSERT INTO signal_semantic_context_review_annotations(workspace_id,generation_id,
    annotation_key,annotation_version,annotation_type,state,resolution,subject_element_id,related_element_ids,reason_code,
    rationale,supersedes_annotation_id,operation_id,actor_user_id,resolution_contract_version,
    resolution_basis_digest,resolution_input_digest,resolution_authority_snapshot,resolution_authority_digest,
    resolution_prestate_digest,resolution_poststate_digest) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8::uuid,
    $9::uuid[],$10,$11,$12::uuid,$13::uuid,$14::uuid,$15,$16,$17,$18::jsonb,$19,$20,$21) RETURNING id::text`,[args.workspaceId,args.generationId,
    args.predecessor.annotation_key,args.predecessor.annotation_version+1,args.predecessor.annotation_type,
    args.resolution?"resolved":"open",args.resolution??null,args.subjectId,args.predecessor.related_element_ids,
    args.reason,args.rationale,args.predecessor.id,args.operationId,args.actorId,basis?.contract_version??null,
    basisDigest,basis?args.resolutionInputDigest:null,basis?JSON.stringify(args.resolutionAuthority):null,
    authorityDigest,prestateDigest,poststateDigest]);
  const state=args.resolution?"resolved" as const:"open" as const;
  await insertEventV2(queryable,{workspaceId:args.workspaceId,generationId:args.generationId,
    elementId:args.subjectId,operationId:args.operationId,eventIndex:args.eventIndex,
    eventKind:state==="resolved"?"review_annotation_resolved":"review_annotation_updated",
    previous:prestateDigest??digestCanonicalJsonV2(args.predecessor),
    next:poststateDigest??digestCanonicalJsonV2({id:inserted.rows[0]!.id,state,resolution:args.resolution??null}),
    actorId:args.actorId});}
function validateResolution(type:AnnotationTypeV2,resolution:AnnotationResolutionV2|null,
  subject:ElementRow|null,related:ElementRow[],context:"annotation"|"correction"|"merge"){
  if(resolution===null)return;
  const allowed:Record<AnnotationTypeV2,AnnotationResolutionV2[]>={uncertain:["context_sufficient","not_supported"],
    needs_more_context:["context_sufficient","not_supported"],near_duplicate:["merged","kept_distinct"],
    locale_unresolved:["governed_locale","global"],competitive_unit_unresolved:["canonical_unit","not_applicable"]};
  if(!allowed[type].includes(resolution))throw new SignalSemanticContextPackError("semantic_context_annotation_resolution_invalid",422);
  if(type==="near_duplicate"&&resolution==="merged"&&context!=="merge")
    throw new SignalSemanticContextPackError("semantic_context_merge_operation_required",422);
  if(type==="near_duplicate"&&resolution==="merged"&&subject&&related.some((entry)=>entry.element_kind!==subject.element_kind))
    throw new SignalSemanticContextPackError("semantic_context_merge_kind_mismatch",422);}
async function assertNoMergeCycle(queryable:SignalBrandPolicyQueryable,generationId:string,targetKey:string,sourceKeys:string[]){
  const result=await queryable.query<{cycle:boolean}>(`WITH RECURSIVE paths(source_key,target_key) AS (
    SELECT source_element_key,target_element_key FROM signal_semantic_context_merge_edges WHERE generation_id=$1::uuid
    UNION SELECT paths.source_key,edge.target_element_key FROM paths JOIN signal_semantic_context_merge_edges edge
      ON edge.generation_id=$1::uuid AND edge.source_element_key=paths.target_key)
    SELECT EXISTS(SELECT 1 FROM paths WHERE source_key=$2 AND target_key=ANY($3::text[])) cycle`,
    [generationId,targetKey,sourceKeys]);if(result.rows[0]?.cycle)throw new SignalSemanticContextPackError("semantic_context_merge_cycle");}
async function assertNoActiveRun(queryable:SignalBrandPolicyQueryable,generationId:string){const result=await queryable.query<{blocked:boolean}>(
  `SELECT EXISTS(SELECT 1 FROM signal_semantic_context_proposal_runs WHERE generation_id=$1::uuid
    AND status IN ('queued','processing','validating')) OR EXISTS(SELECT 1 FROM signal_semantic_context_proposal_outbox outbox
    JOIN signal_semantic_context_proposal_runs run ON run.id=outbox.run_id WHERE run.generation_id=$1::uuid
      AND outbox.status IN ('pending','dispatching')) blocked`,[generationId]);if(result.rows[0]?.blocked)
  throw new SignalSemanticContextPackError("semantic_context_proposal_run_active");}
async function resolveCurrentPublicationAuthority(queryable:SignalBrandPolicyQueryable,
  workspace:ResolvedSignalWorkspace,generation:GenerationRow){
  const live=await resolveLiveSignalSemanticContextAuthorityV1({queryable,workspace});
  const blockers:string[]=[];
  if(generation.brand_os_digest!==live.brandOsDigest||generation.knowledge_digest!==live.knowledgeDigest
      ||generation.locale_context_digest!==live.localeContextDigest)blockers.push("authority_drift");
  let expectedLineage:SignalSemanticContextProviderLineageV1|null=null;
  try{
    const persisted=parseSignalSemanticContextProviderLineageV1(generation.proposal_provider_lineage);
    const config=signalSemanticContextProposalRuntimeConfigurationFromEnvV1();
    if(config.available){
      expectedLineage=buildSignalSemanticContextProviderLineageV1({provider:config.provider,model:config.model,
        model_version:config.model_version,pricing_version:config.pricing_version,
        input_usd_per_million_tokens:String(config.input_usd_per_million_tokens),
        output_usd_per_million_tokens:String(config.output_usd_per_million_tokens),
        max_input_tokens:config.max_input_tokens,configured_max_output_tokens:config.max_output_tokens,
        model_max_output_tokens:persisted.token_ceilings.model_max_output_tokens,
        platform_hard_cap_micro_usd:config.platform_hard_cap_micro_usd,
        capacity:{...persisted.capacity,contract_capacity_saturated:false,explanation:[]}});
    }
    if(!expectedLineage||!signalSemanticContextProviderFullLineageMatchesV1(generation,expectedLineage))
      blockers.push("provider_lineage_not_current");
  }catch{blockers.push("provider_lineage_not_current");}
  return{authority:{brand_os_digest:live.brandOsDigest,knowledge_digest:live.knowledgeDigest,
    locale_context_digest:live.localeContextDigest,proposal_provider_lineage:expectedLineage,
    proposal_provider_lineage_digest:expectedLineage?.lineage_digest??null},blockers};
}
async function assertGenerationAuthorityCurrent(queryable:SignalBrandPolicyQueryable,
  workspace:ResolvedSignalWorkspace,generation:GenerationRow){
  const current=await resolveCurrentPublicationAuthority(queryable,workspace,generation);
  if(current.blockers.includes("authority_drift"))
    throw new SignalSemanticContextPackError("semantic_context_authority_drift");
  if(current.blockers.includes("provider_lineage_not_current"))
    throw new SignalSemanticContextPackError("semantic_context_provider_lineage_drift");
  return current;
}
async function resolveAnnotationResolutionAuthority(queryable:SignalBrandPolicyQueryable,
  generationAuthority:unknown,actorId:string){
  const result=await queryable.query<{user_type:string;primary_role:string}>(`SELECT user_type,primary_role
    FROM users WHERE id=$1::uuid AND status='active'`,[actorId]);
  const actor=result.rows[0];
  if(!actor||actor.user_type!=="noisia_internal"||!actor.primary_role)
    throw new SignalSemanticContextPackError("semantic_context_forbidden",403);
  return{...(generationAuthority as Record<string,unknown>),actor:{id:actorId.toLowerCase(),
    user_type:actor.user_type,primary_role:actor.primary_role}};
}
async function refreshDraftDigestV2(queryable:SignalBrandPolicyQueryable,generationId:string){const rows=await queryable.query<{
  element_key:string;element_version:number;element_digest:string;disposition:string}>(`SELECT element_key,element_version,
  element_digest,disposition FROM signal_semantic_context_element_versions element WHERE generation_id=$1::uuid
  AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor WHERE successor.supersedes_element_id=element.id)
  ORDER BY convert_to(element_key,'UTF8')`,[generationId]);const digest=digestCanonicalJsonV2({contract_version:"signal-semantic-context-draft-v2",
  elements:rows.rows});await queryable.query(`UPDATE signal_semantic_context_generations SET draft_digest=$2
  WHERE id=$1::uuid AND status='draft'`,[generationId,digest]);return digest;}
async function insertEventV2(queryable:SignalBrandPolicyQueryable,args:{workspaceId:string;generationId:string;
  elementId?:string;operationId:string;eventIndex:number;eventKind:string;previous:string|null;next:string;actorId:string}){
  await queryable.query(`INSERT INTO signal_semantic_context_events(workspace_id,generation_id,element_id,operation_id,
    event_index,event_kind,previous_state_digest,next_state_digest,actor_user_id)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9::uuid)`,[args.workspaceId,args.generationId,
    args.elementId??null,args.operationId,args.eventIndex,args.eventKind,args.previous,args.next,args.actorId]);}
function normalizeRationale(value:string){const normalized=value.trim().normalize("NFC");const scalars=[...normalized].length;
  if(scalars<1||scalars>1000)throw new SignalSemanticContextPackError("semantic_context_rationale_invalid",422);return normalized;}
function validateCorrection(value:{canonical_key:string;display_text:string;scope:string|null;locale:string|null;
  relation_kind:string|null;relation_target_key:string|null}){assertKey(value.canonical_key);
  if(!value.display_text.trim()||[...value.display_text].length>500)throw new SignalSemanticContextPackError("semantic_context_correction_invalid",422);
  const relation=Boolean(value.relation_kind||value.relation_target_key);if(relation!==Boolean(value.relation_kind&&value.relation_target_key)
    ||(value.relation_kind&&!SIGNAL_SEMANTIC_CONTEXT_RELATION_KINDS.includes(value.relation_kind as never)))
    throw new SignalSemanticContextPackError("semantic_context_relation_invalid",422);}
function uniqueKeys(values:string[],max:number,allowEmpty=false){if((!allowEmpty&&values.length<1)||values.length>max)
  throw new SignalSemanticContextPackError("semantic_context_merge_scope_invalid",422);
  values.forEach(assertKey);const unique=[...new Set(values)].sort(compareUtf8);if(unique.length!==values.length)
  throw new SignalSemanticContextPackError("semantic_context_duplicate_key",422);return unique;}
function assertKey(value:string){if(!/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u.test(value)||value.length>200)
  throw new SignalSemanticContextPackError("semantic_context_key_invalid",422);}
function rejectUnknownResolutionKeys(resolutions:Map<string,unknown>,annotations:AnnotationRow[]){const known=new Set(annotations.map((entry)=>entry.annotation_key));
  for(const key of resolutions.keys())if(!known.has(key))throw new SignalSemanticContextPackError("semantic_context_annotation_resolution_stale",409);}
function assertUniqueAnnotationResolutions(values:Array<{annotation_key:string}>){
  const keys=values.map((entry)=>entry.annotation_key);if(new Set(keys).size!==keys.length)
    throw new SignalSemanticContextPackError("semantic_context_duplicate_annotation_resolution",422);
}
function annotationResolutionBasisComplete(annotation:AnnotationRow){return Boolean(
  annotation.resolution_contract_version&&annotation.resolution_basis_digest&&annotation.resolution_input_digest
  &&annotation.resolution_authority_snapshot&&annotation.resolution_authority_digest
  &&annotation.resolution_prestate_digest&&annotation.resolution_poststate_digest);}
function shortDigest(value:string){return`${value.slice(0,15)}…${value.slice(-8)}`;}
function assertInternal(actor:SignalWorkspaceUser){if(actor.userType!=="noisia_internal")
  throw new SignalSemanticContextPackError("semantic_context_forbidden",403);}
async function lockWorkspace(queryable:SignalBrandPolicyQueryable,workspaceId:string){await queryable.query(
  "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`signal-semantic-context:${workspaceId}`]);}
async function loadPublicationReplay<T>(queryable:SignalBrandPolicyQueryable,workspaceId:string,actorId:string,
  idempotencyKey:string,requestDigest:string){
  const normalized=productOperationKey(idempotencyKey);const result=await queryable.query<{actor_user_id:string;action:string;
    request_digest:string;status:string;result:T|null}>(`SELECT actor_user_id::text,action,request_digest,status,result FROM signal_governance_control_operations
    WHERE workspace_id=$1::uuid AND idempotency_key=$2`,[workspaceId,normalized]);const row=result.rows[0];
  if(!row)return null;if(row.actor_user_id!==actorId||row.action!=="publish-semantic-context-generation"
      ||row.request_digest!==requestDigest)
    throw new SignalSemanticContextPackError("semantic_context_idempotency_conflict");
  if(row.status==="completed"&&row.result)return row.result;throw new SignalSemanticContextPackError("semantic_context_operation_ambiguous");}
function productOperationKey(value:string){const normalized=value.trim();if(normalized.length<8||normalized.length>500)
  throw new SignalSemanticContextPackError("idempotency_key_required",400);return`sha256:${createHash("sha256")
    .update(`signal-product-operation-v1\u001f${normalized}`).digest("hex")}`;}
function operationRequestDigest(workspaceId:string,action:string,input:unknown){return`sha256:${createHash("sha256")
  .update(stableOperationJson({contract_version:"signal-product-operation-v1",workspace_id:workspaceId,action,input}))
  .digest("hex")}`;}
function stableOperationJson(value:unknown):string{if(Array.isArray(value))return`[${value.map(stableOperationJson).join(",")}]`;
  if(value&&typeof value==="object")return`{${Object.entries(value as Record<string,unknown>)
    .sort(([left],[right])=>left.localeCompare(right)).map(([key,entry])=>`${JSON.stringify(key)}:${stableOperationJson(entry)}`).join(",")}}`;
  return JSON.stringify(value);}
const digestPattern=/^sha256:[0-9a-f]{64}$/u;
