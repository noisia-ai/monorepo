import {randomUUID} from "node:crypto";
import {adaptSignalTopicRuleSuggestionToDraftV1,prepareSignalTopicRuleSuggestionContextV1,
  parseSignalTopicRuleSuggestionV1,parseSignalTopicRuleSpecV1,sanitizeSignalTopicEvidenceExcerptV2,
  signalTopicEvidenceNavigationDataSchemasV2,signalTopicEvaluationDigestV2 as digest,
  type SignalTopicRuleSuggestionContextV1,type SignalTopicRuleSuggestionDraftV1,type SignalTopicRuleSpecV1}
  from "@noisia/query-engine";
import {createSignalTopicContractDraftV1,signalTopicRuleDraftInternal as core,
  type SignalTopicContractDraftClient,type SignalTopicContractDraftV1} from "./signal-topic-contract-drafts";
import {loadSignalTopicEvaluationV2CandidateDetail,navigateSignalTopicEvaluationEvidenceV2,
  type SignalTopicEvaluationActorV2} from "./signal-topic-evaluation-v2";

type Client=SignalTopicContractDraftClient;
type Scope={workspace_id:string;actor:SignalTopicEvaluationActorV2;run_key:string;candidate_key:string};
type CAS={expected_candidate_revision:number;expected_candidate_state_token:string;
  expected_draft_revision:number;expected_draft_digest:string|null};
export type SignalTopicRuleSuggestionFixtureV1={status:"suggested";lexical:SignalTopicRuleSpecV1["lexical"];
  filters:SignalTopicRuleSpecV1["filters"];explanation:string;citation_count:number}
  |{status:"insufficient_evidence";explanation:string};
type BoundSource=Awaited<ReturnType<typeof core.sourceFor>>&{rights_digest:string;authority_digest:string;authority_current:boolean};
type ReceiptRow={id:string;workspace_id:string;run_id:string;candidate_id:string;snapshot_id:string;
  source_revision:number;source_version_digest:string;source_state_token:string;rights_digest:string;
  authority_digest:string;context:SignalTopicRuleSuggestionContextV1;adaptation:SignalTopicRuleSuggestionDraftV1;
  fixture_digest:string;output_digest:string;context_digest:string;prepared_context_digest:string;receipt_digest:string;created_at:string;
  actor_user_id:string;request_digest:string};
type LinkRow={id:string;receipt_id:string;draft_id:string;action:"save"|"restore";request:Record<string,unknown>;
  request_digest:string;actor_user_id:string;draft_key:string;draft_request:Parameters<typeof createSignalTopicContractDraftV1>[0]};
export type SignalTopicRuleSuggestionReceiptV1={contract_version:"signal-topic-rule-suggestion-receipt-v1";
  receipt_id:string;origin:"local_fixture";fixture_digest:string;output_digest:string;context_digest:string;prepared_context_digest:string;
  receipt_digest:string;adaptation:SignalTopicRuleSuggestionDraftV1;created_at:string;is_stale:boolean;
  stale_reasons:Array<"candidate_changed"|"brand_os_changed"|"evidence_unavailable">;
  current_draft:{revision:number;digest:string|null};draft_changed:boolean;
  evidence:{stored:number;available:number;unavailable:number};
  latest_link:null|{link_id:string;draft_id:string;action:"save"|"restore"};
  provider_execution:false;provider_calls:0;input_tokens:0;output_tokens:0;cost_micro_usd:0;idempotent_replay:boolean};
export type SignalTopicRuleSuggestionBridgeV1={link_id:string;receipt_id:string;action:"save"|"restore";
  draft:SignalTopicContractDraftV1;idempotent_replay:boolean};
export class SignalTopicRuleSuggestionError extends Error{
  constructor(public readonly code:string,public readonly status=409){super(code);}
}
const fail=(code:string,status=409):never=>{throw new SignalTopicRuleSuggestionError(`topic_rule_suggestion_${code}`,status);};
const digestPattern=/^sha256:[0-9a-f]{64}$/u;
function closed(value:unknown,keys:string[]):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value))return fail("request_invalid",422);
  const row=value as Record<string,unknown>;
  if(Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key)))return fail("request_invalid",422);
  return row;
}
function strings(value:unknown):string[]{if(!Array.isArray(value)||value.some(item=>typeof item!=="string"))return fail("source_invalid");return value;}
function fixtureInput(value:unknown):SignalTopicRuleSuggestionFixtureV1{
  const status=(value as{status?:unknown})?.status;
  if(status==="insufficient_evidence"){
    const row=closed(value,["status","explanation"]);
    const parsed=parseSignalTopicRuleSuggestionV1({contract_version:"signal-topic-rule-suggestion-v1",...row});
    return{status:"insufficient_evidence",explanation:parsed.explanation};
  }
  const row=closed(value,["status","lexical","filters","explanation","citation_count"]);
  if(status!=="suggested"||!Number.isSafeInteger(row.citation_count)||Number(row.citation_count)<1||Number(row.citation_count)>12){
    return fail("fixture_invalid",422);
  }
  const parsed=parseSignalTopicRuleSuggestionV1({contract_version:"signal-topic-rule-suggestion-v1",status,
    lexical:row.lexical,filters:row.filters,explanation:row.explanation,evidence_refs:[digest("fixture-shape-only")]});
  if(parsed.status!=="suggested")return fail("fixture_invalid",422);
  const spec=parseSignalTopicRuleSpecV1({contract_version:"signal-topic-rule-spec-v1",kind:"topic",label:"Fixture",
    definition:"Simulated output shape, not a generated identity.",lexical:parsed.lexical,filters:parsed.filters});
  return{status,lexical:spec.lexical,filters:spec.filters,explanation:parsed.explanation,citation_count:Number(row.citation_count)};
}
function validate(scope:Scope&CAS&{idempotency_key:string}){
  if(!/^[a-z0-9][a-z0-9._:-]{7,199}$/u.test(scope.run_key)||! /^[a-z0-9][a-z0-9._:-]{0,179}$/u.test(scope.candidate_key)
    ||! /^[A-Za-z0-9._:-]{8,200}$/u.test(scope.idempotency_key)||!Number.isSafeInteger(scope.expected_candidate_revision)
    ||scope.expected_candidate_revision<1||!digestPattern.test(scope.expected_candidate_state_token)
    ||!Number.isSafeInteger(scope.expected_draft_revision)||scope.expected_draft_revision<0
    ||(scope.expected_draft_revision===0?scope.expected_draft_digest!==null:!digestPattern.test(scope.expected_draft_digest??""))){
    fail("request_invalid",422);
  }
}
function requestCAS(args:CAS){return{expected_candidate_revision:args.expected_candidate_revision,
  expected_candidate_state_token:args.expected_candidate_state_token,expected_draft_revision:args.expected_draft_revision,
  expected_draft_digest:args.expected_draft_digest};}
function replay(row:{actor_user_id:string;request_digest:string},actor:string,requestDigest:string){
  if(row.actor_user_id!==actor||row.request_digest!==requestDigest)fail("idempotency_conflict");
}
async function transaction<T>(client:Client,body:()=>Promise<T>){
  try{await client.query("SAVEPOINT topic_rule_suggestion_v1");}catch(error){
    if((error as{code?:string}).code==="25P01")fail("transaction_required");throw error;
  }
  try{
    const isolation=(await client.query<{value:string}>("SELECT current_setting('transaction_isolation') value")).rows[0]?.value;
    if(isolation!=="serializable")fail("serializable_required");
    const result=await body();await client.query("RELEASE SAVEPOINT topic_rule_suggestion_v1");return result;
  }catch(error){await client.query("ROLLBACK TO SAVEPOINT topic_rule_suggestion_v1");
    await client.query("RELEASE SAVEPOINT topic_rule_suggestion_v1");throw error;}
}
async function lock(client:Client,workspace:string,key:string){await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
  [`${workspace}:topic-rule-suggestion:${key}`]);}
async function source(client:Client,args:Scope,forUpdate=false):Promise<BoundSource>{
  const current=await core.sourceFor(client,args,forUpdate);
  const anchor=(await client.query<{rights_digest:string;authority_digest:string;authority_current:boolean}>(`SELECT snapshot.rights_digest,
    snapshot.semantic_context_authority_digest authority_digest,
    COALESCE(generation.status='draft' AND generation.workspace_id=snapshot.workspace_id
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_generations successor
        WHERE successor.workspace_id=generation.workspace_id AND successor.supersedes_generation_id=generation.id)
      AND signal_topic_evaluation_v2_semantic_authority_digest_v1(generation.id)=snapshot.semantic_context_authority_digest,false) authority_current
    FROM signal_topic_evaluation_v2_snapshots snapshot LEFT JOIN signal_semantic_context_generations generation
      ON generation.id=snapshot.semantic_context_generation_id
    WHERE snapshot.id=$1::uuid AND snapshot.workspace_id=$2::uuid`,[current.snapshot_id,args.workspace_id])).rows[0];
  if(!anchor)fail("source_stale");return{...current,...anchor!};
}
async function currentDraft(client:Client,candidateId:string){
  const row=(await client.query<{revision:number;digest:string}>(`SELECT revision,draft_digest digest
    FROM signal_topic_contract_draft_versions WHERE candidate_id=$1::uuid ORDER BY revision DESC LIMIT 1`,[candidateId])).rows[0];
  return row??{revision:0,digest:null};
}
function candidateCAS(bound:BoundSource,args:CAS){if(bound.revision!==args.expected_candidate_revision
  ||bound.state_token!==args.expected_candidate_state_token||bound.review_state!=="pending")fail("source_stale");}
async function assertDraftCAS(client:Client,bound:BoundSource,args:CAS){const prior=await currentDraft(client,bound.candidate_id);
  if(prior.revision!==args.expected_draft_revision||prior.digest!==args.expected_draft_digest)fail("draft_stale");return prior;}

/** Exact references only; this read never returns stored or current mention text. */
async function availability(client:Client,bound:{workspace_id:string;snapshot_id:string},snapshotDigest:string,refs:string[]){
  if(refs.length>12)fail("evidence_invalid");
  const available=await currentReferences(client,bound,snapshotDigest,refs);
  return{stored:refs.length,available:available.size,unavailable:refs.length-available.size};
}
async function currentReferences(client:Client,bound:{workspace_id:string;snapshot_id:string},snapshotDigest:string,refs:string[]){
  const available=new Set<string>();
  for(let offset=0;offset<refs.length;offset+=10){const projected=await core.projectCurrentExamples(client,bound,
    {snapshot_digest:snapshotDigest,examples:refs.slice(offset,offset+10).map(evidence_ref=>({evidence_ref}))});
    projected.examples.forEach(row=>available.add(row.evidence_ref));}
  return available;
}
async function freshContext(client:Client,args:Scope,bound:BoundSource,prior:{revision:number;digest:string|null},sessionKey:string){
  if(!bound.authority_current)fail("brand_os_stale");
  const detail=await loadSignalTopicEvaluationV2CandidateDetail({queryable:client,...args});
  const candidate=detail.candidate;
  const sourceBinding={workspace_id:args.workspace_id,run_key:args.run_key,candidate_key:args.candidate_key,
    snapshot_digest:bound.snapshot_digest,session_key:sessionKey,candidate_revision:bound.revision,
    candidate_state_token:bound.state_token,candidate_version_digest:bound.version_digest};
  const keys=(await client.query<{element_key:string}>(`SELECT element.element_key
    FROM signal_semantic_context_element_versions element JOIN signal_topic_evaluation_v2_snapshots snapshot
      ON snapshot.semantic_context_generation_id=element.generation_id
    WHERE snapshot.id=$1::uuid AND snapshot.workspace_id=$2::uuid AND element.workspace_id=$2::uuid
      AND element.disposition='approved' AND element.lifecycle_state='active'
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions newer WHERE newer.supersedes_element_id=element.id)
      AND position(lower(element.display_text) in lower($3))>0 ORDER BY element.element_key LIMIT 40`,
    [bound.snapshot_id,args.workspace_id,`${candidate.title}\n${candidate.description}\n${JSON.stringify(candidate.inclusion)}`])).rows.map(row=>row.element_key);
  let elements:SignalTopicRuleSuggestionContextV1["brand_os"]["elements"]=[];
  if(keys.length){const brand=await navigateSignalTopicEvaluationEvidenceV2({queryable:client,workspace_id:args.workspace_id,actor:args.actor,
    request:{operation:"brand_os_context",element_keys:keys}});
    if(brand.snapshot_digest!==bound.snapshot_digest||brand.operation!=="brand_os_context")fail("snapshot_mismatch");
    elements=signalTopicEvidenceNavigationDataSchemasV2.brand_os_context.parse(brand.data).elements
      .sort((a,b)=>a.element_key<b.element_key?-1:a.element_key>b.element_key?1:0);
  }
  // One genuinely fresh bounded navigation, not the candidate's historical citation list.
  const clusterKey=[...candidate.source_cluster_keys].sort()[0]!;
  const navigation=await navigateSignalTopicEvaluationEvidenceV2({queryable:client,workspace_id:args.workspace_id,actor:args.actor,
    request:{operation:"representative_mentions",cluster_key:clusterKey,limit:12,filters:{}}});
  if(navigation.snapshot_digest!==bound.snapshot_digest||navigation.operation!=="representative_mentions")fail("snapshot_mismatch");
  const mentionData=signalTopicEvidenceNavigationDataSchemasV2.representative_mentions.parse(navigation.data);
  const available=await currentReferences(client,{workspace_id:args.workspace_id,snapshot_id:bound.snapshot_id},
    bound.snapshot_digest,mentionData.mentions.map(row=>row.evidence_ref));
  const mentions=mentionData.mentions.map(mention=>available.has(mention.evidence_ref)
    ?{...mention,excerpt:sanitizeSignalTopicEvidenceExcerptV2(mention.excerpt),status:"available" as const}
    :{evidence_ref:mention.evidence_ref,status:"unavailable" as const,reason:"source_changed" as const});
  const context:SignalTopicRuleSuggestionContextV1={source:sourceBinding,candidate:{label:candidate.title.trim(),definition:candidate.description.trim(),
    inclusion:strings(candidate.inclusion),exclusion:strings(candidate.exclusion),
    source_cluster_keys:[...candidate.source_cluster_keys].sort(),
    historical_evidence_refs:candidate.evidence.map(row=>row.evidence_ref).sort()},draft:prior,
    brand_os:{source:sourceBinding,status:elements.length?"available":"empty",authority_digest:bound.authority_digest,elements},
    traces:[{source:sourceBinding,trace_index:3,operation:"representative_mentions",cluster_key:clusterKey,
      result_digest:navigation.result_digest,mentions:mentions.sort((a,b)=>a.evidence_ref<b.evidence_ref?-1:a.evidence_ref>b.evidence_ref?1:0)}]};
  const prepared=prepareSignalTopicRuleSuggestionContextV1(context);
  if(digest(context)!==prepared.context_digest)fail("context_not_canonical");
  return{context,prepared};
}

/** Fixed local simulation only. No callbacks, caller context/refs/origin or provider edge. */
export async function receiveSimulatedSignalTopicRuleSuggestionV1(args:Scope&CAS&{client:Client;idempotency_key:string;fixture:unknown}
):Promise<SignalTopicRuleSuggestionReceiptV1>{
  validate(args);const fixture=fixtureInput(args.fixture);
  const request={run_key:args.run_key,candidate_key:args.candidate_key,...requestCAS(args),fixture},requestDigest=digest(request);
  return transaction(args.client,async()=>{
    await core.authorize(args.client,args);await lock(args.client,args.workspace_id,args.idempotency_key);
    const existing=(await args.client.query<ReceiptRow>(`SELECT * FROM signal_topic_rule_suggestion_receipts
      WHERE workspace_id=$1::uuid AND idempotency_key=$2`,[args.workspace_id,args.idempotency_key])).rows[0];
    if(existing){replay(existing,args.actor.id,requestDigest);return project(args.client,args,existing,true);}
    const bound=await source(args.client,args,true);candidateCAS(bound,args);
    const prior=await assertDraftCAS(args.client,bound,args);
    const {context,prepared}=await freshContext(args.client,args,bound,prior,`topic-rule-fixture:${digest({requestDigest,key:args.idempotency_key}).slice(7,39)}`);
    const available=[...new Set(prepared.history.flatMap(trace=>trace.mentions.filter(mention=>mention.status==="available")
      .map(mention=>mention.evidence_ref)))].sort();
    if(fixture.status==="suggested"&&available.length<fixture.citation_count)fail("evidence_unavailable");
    const suggestion=fixture.status==="suggested"?{contract_version:"signal-topic-rule-suggestion-v1",status:fixture.status,
      lexical:fixture.lexical,filters:fixture.filters,explanation:fixture.explanation,evidence_refs:available.slice(0,fixture.citation_count)}
      :{contract_version:"signal-topic-rule-suggestion-v1",status:fixture.status,explanation:fixture.explanation};
    const adaptation=adaptSignalTopicRuleSuggestionToDraftV1({suggestion,context});
    const fixtureDigest=digest(fixture),outputDigest=digest(adaptation.suggestion),contextDigest=digest(context);
    const receiptDigest=digest({origin:"local_fixture",request_digest:requestDigest,fixture_digest:fixtureDigest,
      output_digest:outputDigest,context_digest:contextDigest,suggestion_digest:adaptation.suggestion_digest,
      prepared_context_digest:digest(prepared),rights_digest:bound.rights_digest,authority_digest:bound.authority_digest});
    const row=(await args.client.query<ReceiptRow>(`INSERT INTO signal_topic_rule_suggestion_receipts(
      id,workspace_id,run_id,candidate_id,snapshot_id,source_revision,source_version_digest,source_state_token,
      rights_digest,authority_digest,fixture,fixture_digest,context,context_digest,adaptation,output_digest,receipt_digest,
      actor_user_id,idempotency_key,request,request_digest,prepared_context,prepared_context_digest)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::jsonb,$14,
        $15::jsonb,$16,$17,$18::uuid,$19,$20::jsonb,$21,$22::jsonb,$23) RETURNING *,created_at::text`,
    [randomUUID(),args.workspace_id,bound.run_id,bound.candidate_id,bound.snapshot_id,bound.revision,bound.version_digest,bound.state_token,
      bound.rights_digest,bound.authority_digest,JSON.stringify(fixture),fixtureDigest,JSON.stringify(context),contextDigest,
      JSON.stringify(adaptation),outputDigest,receiptDigest,args.actor.id,args.idempotency_key,JSON.stringify(request),requestDigest,
      JSON.stringify(prepared),digest(prepared)])).rows[0]!;
    return project(args.client,args,row,false);
  });
}
async function selectedReceipt(client:Client,args:Scope&{receipt_id?:string}){
  const bound=await source(client,args);
  const row=(await client.query<ReceiptRow>(`SELECT receipt.*,receipt.created_at::text FROM signal_topic_rule_suggestion_receipts receipt
    WHERE receipt.workspace_id=$1::uuid AND receipt.run_id=$2::uuid AND receipt.candidate_id=$3::uuid AND receipt.snapshot_id=$4::uuid
      AND ($5::uuid IS NULL OR receipt.id=$5::uuid) ORDER BY receipt.created_at DESC,receipt.id DESC LIMIT 1`,
  [args.workspace_id,bound.run_id,bound.candidate_id,bound.snapshot_id,args.receipt_id??null])).rows[0];return row;
}
/** Caller composes this with other readers in RRRO. No contexts/excerpts, FTS or writes returned. */
export async function loadSignalTopicRuleSuggestionV1(args:Scope&{queryable:Client;receipt_id?:string}){
  await core.authorize(args.queryable,args);const row=await selectedReceipt(args.queryable,args);
  return row?project(args.queryable,args,row,false):null;
}
async function project(client:Client,args:Scope,row:ReceiptRow,replayed:boolean):Promise<SignalTopicRuleSuggestionReceiptV1>{
  const bound=await source(client,args),prior=await currentDraft(client,bound.candidate_id);
  const refs=row.adaptation.provenance.evidence.map(item=>item.evidence_ref);
  const evidence=await availability(client,{workspace_id:args.workspace_id,snapshot_id:row.snapshot_id},bound.snapshot_digest,refs);
  const stale:SignalTopicRuleSuggestionReceiptV1["stale_reasons"]=[];
  if(bound.candidate_id!==row.candidate_id||bound.run_id!==row.run_id||bound.snapshot_id!==row.snapshot_id
    ||bound.revision!==row.source_revision||bound.version_digest!==row.source_version_digest||bound.state_token!==row.source_state_token
    ||bound.review_state!=="pending")stale.push("candidate_changed");
  if(!bound.authority_current||bound.authority_digest!==row.authority_digest||bound.rights_digest!==row.rights_digest)stale.push("brand_os_changed");
  if(evidence.unavailable)stale.push("evidence_unavailable");
  const link=(await client.query<{id:string;draft_id:string;action:"save"|"restore"}>(`SELECT id::text,draft_id::text,action
    FROM signal_topic_rule_suggestion_draft_links WHERE receipt_id=$1::uuid AND workspace_id=$2::uuid ORDER BY created_at DESC,id DESC LIMIT 1`,
  [row.id,args.workspace_id])).rows[0];
  return{contract_version:"signal-topic-rule-suggestion-receipt-v1",receipt_id:row.id,origin:"local_fixture",
    fixture_digest:row.fixture_digest,output_digest:row.output_digest,context_digest:row.context_digest,
    prepared_context_digest:row.prepared_context_digest,receipt_digest:row.receipt_digest,
    adaptation:row.adaptation,created_at:new Date(row.created_at).toISOString(),is_stale:stale.length>0,stale_reasons:stale,
    current_draft:prior,draft_changed:prior.revision!==row.context.draft.revision||prior.digest!==row.context.draft.digest,evidence,
    latest_link:link?{link_id:link.id,draft_id:link.draft_id,action:link.action}:null,
    provider_execution:false,provider_calls:0,input_tokens:0,output_tokens:0,cost_micro_usd:0,idempotent_replay:replayed};
}

type Edit={action:"save";lexical:SignalTopicRuleSpecV1["lexical"];filters:SignalTopicRuleSpecV1["filters"]}
  |{action:"restore";restore_draft_id:string};
export async function saveSignalTopicRuleSuggestionDraftV1(args:Scope&CAS&Edit&{client:Client;receipt_id:string;idempotency_key:string}
):Promise<SignalTopicRuleSuggestionBridgeV1>{
  validate(args);
  const canonical=args.action==="save"?parseSignalTopicRuleSpecV1({contract_version:"signal-topic-rule-spec-v1",kind:"topic",
    label:"Shape validation",definition:"Identity is loaded from the saved candidate before writing.",
    lexical:args.lexical,filters:args.filters}):null;
  const edit=args.action==="restore"?{action:args.action,restore_draft_id:args.restore_draft_id}
    :args.action==="save"?{action:args.action,lexical:canonical!.lexical,filters:canonical!.filters}:fail("request_invalid",422);
  const request={run_key:args.run_key,candidate_key:args.candidate_key,receipt_id:args.receipt_id,...requestCAS(args),...edit};
  const requestDigest=digest(request),draftKey=`topic-suggestion-draft:${digest({workspace:args.workspace_id,key:args.idempotency_key}).slice(7)}`;
  return transaction(args.client,async()=>{
    await core.authorize(args.client,args);await lock(args.client,args.workspace_id,args.idempotency_key);
    const previous=(await args.client.query<LinkRow>(`SELECT * FROM signal_topic_rule_suggestion_draft_links
      WHERE workspace_id=$1::uuid AND idempotency_key=$2`,[args.workspace_id,args.idempotency_key])).rows[0];
    if(previous){replay(previous,args.actor.id,requestDigest);
      const draft=await createSignalTopicContractDraftV1({...previous.draft_request,client:args.client,workspace_id:args.workspace_id,
        actor:args.actor,idempotency_key:previous.draft_key});
      return{link_id:previous.id,receipt_id:previous.receipt_id,action:previous.action,draft,idempotent_replay:true};}
    const bound=await source(args.client,args,true);candidateCAS(bound,args);await assertDraftCAS(args.client,bound,args);
    const receipt=await selectedReceipt(args.client,args);if(!receipt)fail("not_found",404);
    const current=await project(args.client,args,receipt!,false);if(current.is_stale)fail("source_stale");
    if(receipt!.adaptation.status!=="suggested")fail("insufficient_evidence");
    let lexical:unknown,filters:unknown;
    if(args.action==="restore"){
      const restored=(await args.client.query<{rule_spec:SignalTopicRuleSpecV1}>(`SELECT rule_spec FROM signal_topic_contract_draft_versions
        WHERE id=$1::uuid AND workspace_id=$2::uuid AND candidate_id=$3::uuid AND run_id=$4::uuid AND snapshot_id=$5::uuid
          AND revision<$6`,[args.restore_draft_id,args.workspace_id,bound.candidate_id,bound.run_id,bound.snapshot_id,args.expected_draft_revision])).rows[0];
      if(!restored)fail("restore_invalid",422);lexical=restored!.rule_spec.lexical;filters=restored!.rule_spec.filters;
    }else{lexical=canonical!.lexical;filters=canonical!.filters;}
    const detail=await loadSignalTopicEvaluationV2CandidateDetail({queryable:args.client,...args});
    const rule_spec=parseSignalTopicRuleSpecV1({contract_version:"signal-topic-rule-spec-v1",kind:"topic",label:detail.candidate.title,
      definition:detail.candidate.description,lexical,filters});
    const draftRequest={run_key:args.run_key,candidate_key:args.candidate_key,...requestCAS(args),rule_spec};
    const draft=await createSignalTopicContractDraftV1({client:args.client,workspace_id:args.workspace_id,actor:args.actor,
      idempotency_key:draftKey,...draftRequest});
    const link=(await args.client.query<{id:string}>(`INSERT INTO signal_topic_rule_suggestion_draft_links(
      id,workspace_id,receipt_id,draft_id,action,restore_draft_id,actor_user_id,idempotency_key,request,request_digest,draft_key,draft_request)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid,$7::uuid,$8,$9::jsonb,$10,$11,$12::jsonb) RETURNING id::text`,
    [randomUUID(),args.workspace_id,args.receipt_id,draft.draft_id,args.action,args.action==="restore"?args.restore_draft_id:null,
      args.actor.id,args.idempotency_key,JSON.stringify(request),requestDigest,draftKey,JSON.stringify(draftRequest)])).rows[0]!;
    return{link_id:link.id,receipt_id:args.receipt_id,action:args.action,draft,idempotent_replay:false};
  });
}
