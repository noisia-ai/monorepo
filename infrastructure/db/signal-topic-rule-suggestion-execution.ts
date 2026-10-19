import {createHash,randomUUID} from "node:crypto";
import {prepareSignalTopicRuleSuggestionContextV1,adaptSignalTopicRuleSuggestionToDraftV1,
  signalTopicEvaluationDigestV2 as digest,parseSignalTopicEvidenceNavigationRequestV2,sanitizeSignalTopicEvidenceExcerptV2,
  signalTopicEvidenceNavigationDataSchemasV2,type SignalTopicRuleSuggestionContextV1,
  type SignalTopicEvidenceNavigationRequestV2} from "@noisia/query-engine";
import {signalTopicRuleDraftInternal as core,type SignalTopicContractDraftClient as Client} from "./signal-topic-contract-drafts";
import {signalTopicRuleSuggestionInternal as base} from "./signal-topic-rule-suggestions";
import {loadSignalTopicEvaluationV2CandidateDetail,navigateSignalTopicEvaluationEvidenceV2,
  type SignalTopicEvaluationActorV2} from "./signal-topic-evaluation-v2";

type Scope={workspace_id:string;actor:SignalTopicEvaluationActorV2;run_key:string;candidate_key:string};
type CAS={expected_candidate_revision:number;expected_candidate_state_token:string;expected_draft_revision:number;expected_draft_digest:string|null};
type Status="pending"|"claimed"|"completed"|"definitely_not_sent"|"outcome_unknown"|"failed";
type Call={call_index:number;prompt:string;prompt_digest:string;reserved_micro_usd:number;max_output_tokens:number;
  outcome:"pending"|"succeeded"|"definitely_not_sent"|"outcome_unknown"|"failed";response_text?:string;response_digest?:string;
  input_tokens?:number;output_tokens?:number;request_id?:string;cost_micro_usd?:number};
type Navigation={request:SignalTopicEvidenceNavigationRequestV2;next_cursor:string|null;result_digest:string};
type Row={id:string;workspace_id:string;actor_user_id:string;run_id:string;candidate_id:string;snapshot_id:string;
  request:CAS&{run_key:string;candidate_key:string;budget_micro_usd:number};request_digest:string;idempotency_key:string;
  status:Status;claim_token:string|null;context:SignalTopicRuleSuggestionContextV1;prepared_context:ReturnType<typeof prepareSignalTopicRuleSuggestionContextV1>;
  rights_digest:string;authority_digest:string;budget_micro_usd:number;calls:Call[];navigations:Navigation[];receipt_id:string|null;
  cost_micro_usd:number|null;provider_calls:number;input_tokens:number;output_tokens:number};
export type SignalTopicRuleSuggestionExecutionV1=CAS&{contract_version:"signal-topic-rule-suggestion-execution-v1";
  execution_id:string;workspace_id:string;run_key:string;candidate_key:string;idempotency_key:string;status:Status;receipt_id:string|null;
  budget_micro_usd:number;cost_micro_usd:number|null;provider_calls:number;input_tokens:number;output_tokens:number;idempotent_replay:boolean};
export type SignalTopicRuleSuggestionNavigationV1={operation:"representative_mentions"|"search_cluster";cluster_key:string;
  query?:string;limit?:number;filters?:Record<string,unknown>}|{operation:"continue";trace_index:number};
export class SignalTopicRuleSuggestionExecutionError extends Error {
  readonly code:string;readonly status:number;constructor(code:string){super(`topic_rule_suggestion_execution_${code}`);this.code=this.message;this.status=code==="not_found"?404:409;}
}
const fail=(code:string):never=>{throw new SignalTopicRuleSuggestionExecutionError(code);};
const bytes=(v:string)=>Buffer.byteLength(v,"utf8");
// Provider envelope hashes describe exact UTF-8 bytes, never a JSON string encoding.
const byteDigest=(value:string)=>`sha256:${createHash("sha256").update(value,"utf8").digest("hex")}`;
function callsDigest(calls:Call[]){return digest(calls.map(({prompt: _prompt,response_text: _response,...metadata})=>metadata));}
function project(row:Row,replay=false):SignalTopicRuleSuggestionExecutionV1{return{contract_version:"signal-topic-rule-suggestion-execution-v1",
  execution_id:row.id,workspace_id:row.workspace_id,run_key:row.request.run_key,candidate_key:row.request.candidate_key,
  ...base.requestCAS(row.request),idempotency_key:row.idempotency_key,status:row.status,receipt_id:row.receipt_id,
  budget_micro_usd:Number(row.budget_micro_usd),cost_micro_usd:row.cost_micro_usd===null?null:Number(row.cost_micro_usd),
  provider_calls:row.provider_calls,input_tokens:row.input_tokens,output_tokens:row.output_tokens,idempotent_replay:replay};}
function scope(row:Row):Scope{return{workspace_id:row.workspace_id,actor:{id:row.actor_user_id,user_type:"noisia_internal"},
  run_key:row.request.run_key,candidate_key:row.request.candidate_key};}
async function rowFor(client:Client,id:string){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id))fail("id_invalid");const row=(await client.query<Row>(
  "SELECT * FROM signal_topic_rule_suggestion_executions WHERE id=$1::uuid FOR UPDATE",[id])).rows[0];return row??fail("not_found");}
async function claimed(client:Client,id:string,token:string,authorize=true){const row=await rowFor(client,id);
  if(row.status!=="claimed"||row.claim_token!==token)fail("claim_mismatch");if(authorize)await core.authorize(client,scope(row));return row;}
async function current(client:Client,row:Row){const bound=await base.source(client,scope(row),true);base.candidateCAS(bound,row.request);
  if(bound.snapshot_id!==row.snapshot_id||bound.authority_digest!==row.authority_digest||bound.rights_digest!==row.rights_digest||!bound.authority_current)fail("source_stale");
  await base.assertDraftCAS(client,bound,row.request);return bound;}
/** Caller commits before queue dispatch. The same row is the durable pending dispatch. */
export async function launchSignalTopicRuleSuggestionExecutionV1(args:Scope&CAS&{client:Client;idempotency_key:string;budget_micro_usd:number}){
  base.validate(args);if(!Number.isSafeInteger(args.budget_micro_usd)||args.budget_micro_usd<1||args.budget_micro_usd>1000000)fail("budget_invalid");
  return base.transaction(args.client,async()=>{
    await core.authorize(args.client,args);
    await args.client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${args.workspace_id}:topic-rule-suggestion-execution`]);
    const request={run_key:args.run_key,candidate_key:args.candidate_key,...base.requestCAS(args),budget_micro_usd:args.budget_micro_usd};
    const prior=(await args.client.query<Row>("SELECT * FROM signal_topic_rule_suggestion_executions WHERE workspace_id=$1::uuid AND idempotency_key=$2",[args.workspace_id,args.idempotency_key])).rows[0];
    if(prior){if(prior.actor_user_id!==args.actor.id||prior.request_digest!==digest(request))fail("idempotency_conflict");return project(prior,true);}
    // This cut has one remaining authorized experiment. A failed/ambiguous row still consumes it.
    if((await args.client.query("SELECT id FROM signal_topic_rule_suggestion_executions WHERE workspace_id=$1::uuid LIMIT 1",[args.workspace_id])).rows.length)fail("experiment_limit");
    const bound=await base.source(args.client,args,true);base.candidateCAS(bound,args);const draft=await base.assertDraftCAS(args.client,bound,args);
    if(!bound.authority_current)fail("source_stale");
    const candidate=(await loadSignalTopicEvaluationV2CandidateDetail({queryable:args.client,...args})).candidate;
    const id=randomUUID(),source={workspace_id:args.workspace_id,run_key:args.run_key,candidate_key:args.candidate_key,
      snapshot_digest:bound.snapshot_digest,session_key:`topic-rule-execution:${id}`,candidate_revision:bound.revision,
      candidate_state_token:bound.state_token,candidate_version_digest:bound.version_digest};
    const keys=(await args.client.query<{element_key:string}>(`SELECT element.element_key FROM signal_semantic_context_element_versions element
      WHERE element.generation_id=(SELECT semantic_context_generation_id FROM signal_topic_evaluation_v2_snapshots WHERE id=$1::uuid)
      AND element.workspace_id=$2::uuid AND element.disposition='approved' AND element.lifecycle_state='active'
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions newer WHERE newer.supersedes_element_id=element.id)
      ORDER BY element.element_key LIMIT 40`,[bound.snapshot_id,args.workspace_id])).rows.map(r=>r.element_key);
    let elements:SignalTopicRuleSuggestionContextV1['brand_os']['elements']=[];
    if(keys.length){const brand=await navigateSignalTopicEvaluationEvidenceV2({queryable:args.client,workspace_id:args.workspace_id,actor:args.actor,
      request:{operation:"brand_os_context",element_keys:keys}});if(brand.snapshot_digest!==bound.snapshot_digest)fail("snapshot_mismatch");
      elements=signalTopicEvidenceNavigationDataSchemasV2.brand_os_context.parse(brand.data).elements.sort((a,b)=>a.element_key<b.element_key?-1:a.element_key>b.element_key?1:0);}
    const context:SignalTopicRuleSuggestionContextV1={source,candidate:{label:candidate.title.trim(),definition:candidate.description.trim(),
      inclusion:candidate.inclusion as string[],exclusion:candidate.exclusion as string[],source_cluster_keys:[...candidate.source_cluster_keys].sort(),
      historical_evidence_refs:candidate.evidence.map(r=>r.evidence_ref).sort()},draft,
      brand_os:{source,status:elements.length?"available":"empty",authority_digest:bound.authority_digest,elements},traces:[]};
    const prepared=prepareSignalTopicRuleSuggestionContextV1(context);
    const row=(await args.client.query<Row>(`INSERT INTO signal_topic_rule_suggestion_executions(id,workspace_id,actor_user_id,run_id,candidate_id,snapshot_id,
      request,request_digest,idempotency_key,context,prepared_context,rights_digest,authority_digest,budget_micro_usd)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::jsonb,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14) RETURNING *`,
      [id,args.workspace_id,args.actor.id,bound.run_id,bound.candidate_id,bound.snapshot_id,JSON.stringify(request),digest(request),args.idempotency_key,
        JSON.stringify(context),JSON.stringify(prepared),bound.rights_digest,bound.authority_digest,args.budget_micro_usd])).rows[0]!;return project(row);
  });
}
export async function loadSignalTopicRuleSuggestionExecutionV1(args:Scope&{queryable:Client;execution_id?:string;idempotency_key?:string}){
  await core.authorize(args.queryable,args);const row=(await args.queryable.query<Row>(`SELECT * FROM signal_topic_rule_suggestion_executions
    WHERE workspace_id=$1::uuid AND actor_user_id=$2::uuid AND request->>'run_key'=$3 AND request->>'candidate_key'=$4
      AND ($5::uuid IS NULL OR id=$5::uuid) AND ($6::text IS NULL OR idempotency_key=$6) ORDER BY created_at DESC LIMIT 1`,
    [args.workspace_id,args.actor.id,args.run_key,args.candidate_key,args.execution_id??null,args.idempotency_key??null])).rows[0];return row?project(row):null;
}
export async function claimSignalTopicRuleSuggestionExecutionV1(args:{client:Client;execution_id:string}){
  return base.transaction(args.client,async()=>{const row=await rowFor(args.client,args.execution_id);if(row.status!=="pending")return null;
    await core.authorize(args.client,scope(row));await current(args.client,row);const token=randomUUID();
    await args.client.query("UPDATE signal_topic_rule_suggestion_executions SET status='claimed',claim_token=$2::uuid WHERE id=$1::uuid",[row.id,token]);
    return{execution_id:row.id,claim_token:token,...scope(row),context:row.context,prepared:row.prepared_context,
      model:"claude-haiku-4-5-20251001" as const,budget_micro_usd:Number(row.budget_micro_usd),navigation_count:2};});
}
export async function navigateSignalTopicRuleSuggestionExecutionV1(args:{client:Client;execution_id:string;claim_token:string;request:SignalTopicRuleSuggestionNavigationV1}){
  return base.transaction(args.client,async()=>{const row=await claimed(args.client,args.execution_id,args.claim_token);await current(args.client,row);
    if(row.navigations.length>=10||row.calls.some(c=>c.outcome==="pending"||c.outcome==="outcome_unknown"))fail("navigation_blocked");
    const raw=args.request;let request:SignalTopicEvidenceNavigationRequestV2;
    if(raw.operation==="continue"){
      if(Object.keys(raw).some(k=>!["operation","trace_index"].includes(k))||!Number.isInteger(raw.trace_index)||raw.trace_index<3||raw.trace_index>12)return fail("request_invalid");
      const previous=row.navigations[raw.trace_index-3];if(!previous||previous.request.operation!=="search_cluster"||!previous.next_cursor)return fail("cursor_unavailable");
      request={...previous.request,cursor:previous.next_cursor};
    }else{
      if(Object.keys(raw).some(k=>!["operation","cluster_key","query","limit","filters"].includes(k)))return fail("request_invalid");
      request=parseSignalTopicEvidenceNavigationRequestV2({operation:raw.operation,cluster_key:raw.cluster_key,limit:raw.limit??(raw.operation==="search_cluster"?20:12),
        filters:{...raw.filters,...(raw.query?{query:raw.query}:{})},...(raw.operation==="search_cluster"?{cursor:null}:{})});
    }
    if(!('cluster_key'in request)||!row.context.candidate.source_cluster_keys.includes(request.cluster_key))fail("cluster_scope");
    const navigation=await navigateSignalTopicEvaluationEvidenceV2({queryable:args.client,...scope(row),request});
    if(navigation.snapshot_digest!==row.context.source.snapshot_digest)fail("snapshot_mismatch");
    if(request.operation!=="representative_mentions"&&request.operation!=="search_cluster")return fail("operation_invalid");
    const data=signalTopicEvidenceNavigationDataSchemasV2[request.operation].parse(navigation.data);
    const refs=await base.currentReferences(args.client,{workspace_id:row.workspace_id,snapshot_id:row.snapshot_id},row.context.source.snapshot_digest,data.mentions.map(m=>m.evidence_ref));
    const context={...row.context,traces:[...row.context.traces,{source:row.context.source,trace_index:row.navigations.length+3,
      operation:request.operation,cluster_key:request.cluster_key,result_digest:navigation.result_digest,
      mentions:data.mentions.map(m=>refs.has(m.evidence_ref)?{...m,excerpt:sanitizeSignalTopicEvidenceExcerptV2(m.excerpt),status:"available" as const}:{evidence_ref:m.evidence_ref,status:"unavailable" as const,reason:"source_changed" as const})
        .sort((a,b)=>a.evidence_ref<b.evidence_ref?-1:1)}]};
    const prepared=prepareSignalTopicRuleSuggestionContextV1(context),navigations=[...row.navigations,{request,next_cursor:navigation.next_cursor,result_digest:navigation.result_digest}];
    await args.client.query("UPDATE signal_topic_rule_suggestion_executions SET context=$2::jsonb,prepared_context=$3::jsonb,navigations=$4::jsonb WHERE id=$1::uuid",
      [row.id,JSON.stringify(context),JSON.stringify(prepared),JSON.stringify(navigations)]);return{context,prepared,navigation_count:navigations.length+2,continuation_trace_indexes:navigations.flatMap((n,i)=>n.next_cursor&&n.request.operation==="search_cluster"?[i+3]:[])};});
}
export async function beginSignalTopicRuleSuggestionCallV1(args:{client:Client;execution_id:string;claim_token:string;prompt:string;max_output_tokens:number}){
  if(bytes(args.prompt)>22528||!Number.isSafeInteger(args.max_output_tokens)||args.max_output_tokens<1||args.max_output_tokens>2000)fail("call_invalid");
  return base.transaction(args.client,async()=>{const row=await claimed(args.client,args.execution_id,args.claim_token);await current(args.client,row);
    if(row.calls.length>=12||row.calls.some(c=>c.outcome==="pending"||c.outcome==="outcome_unknown"))fail("call_blocked");
    const visibleRefs=[...new Set(prepareSignalTopicRuleSuggestionContextV1(row.context).history.flatMap(t=>t.mentions.filter(m=>m.status==="available").map(m=>m.evidence_ref)))];
    if((await base.currentReferences(args.client,{workspace_id:row.workspace_id,snapshot_id:row.snapshot_id},row.context.source.snapshot_digest,visibleRefs)).size!==visibleRefs.length)fail("evidence_unavailable");
    let supplied:unknown;try{supplied=JSON.parse(args.prompt.slice(args.prompt.lastIndexOf("\n")+1));}catch{fail("prompt_context_mismatch");}
    if(digest(supplied)!==digest(prepareSignalTopicRuleSuggestionContextV1(row.context)))fail("prompt_context_mismatch");
    // Includes conservative SDK structured-output schema overhead beyond the prompt.
    const reserved=bytes(args.prompt)+8192+args.max_output_tokens*5;
    if(row.calls.reduce((n,c)=>n+(c.cost_micro_usd??c.reserved_micro_usd),0)+reserved>Number(row.budget_micro_usd))fail("budget_exhausted");
    const call:Call={call_index:row.calls.length+1,prompt:args.prompt,prompt_digest:byteDigest(args.prompt),reserved_micro_usd:reserved,
      max_output_tokens:args.max_output_tokens,outcome:"pending"};
    await args.client.query("UPDATE signal_topic_rule_suggestion_executions SET calls=$2::jsonb,provider_calls=$3,cost_micro_usd=NULL WHERE id=$1::uuid",
      [row.id,JSON.stringify([...row.calls,call]),row.calls.length+1]);return{call_index:call.call_index,max_output_tokens:call.max_output_tokens};});
}
export async function completeSignalTopicRuleSuggestionCallV1(args:{client:Client;execution_id:string;claim_token:string;call_index:number;
  outcome:"succeeded"|"definitely_not_sent"|"outcome_unknown"|"failed";input_tokens?:number;output_tokens?:number;request_id?:string;response_text?:string}){
  return base.transaction(args.client,async()=>{// The sealed claim may settle already-sent usage even when actor rights were withdrawn in flight.
    const row=await claimed(args.client,args.execution_id,args.claim_token,false),call=row.calls.at(-1);
    if(!call||call.call_index!==args.call_index||call.outcome!=="pending")return fail("call_mismatch");
    if(args.response_text!==undefined&&bytes(args.response_text)>16384)fail("response_too_large");
    const known=Number.isSafeInteger(args.input_tokens)&&args.input_tokens!>=0&&Number.isSafeInteger(args.output_tokens)&&args.output_tokens!>=0;
    if(args.outcome==="succeeded"&&(!known||args.response_text===undefined))fail("usage_missing");
    const cost=args.outcome==="definitely_not_sent"?0:known?args.input_tokens!+args.output_tokens!*5:undefined;
    const updated:Call={...call,outcome:args.outcome,...(known?{input_tokens:args.input_tokens,output_tokens:args.output_tokens}:{}),
      ...(args.request_id?{request_id:args.request_id.slice(0,200)}:{}),...(args.response_text!==undefined?{response_text:args.response_text,response_digest:byteDigest(args.response_text)}:{}),
      ...(cost!==undefined?{cost_micro_usd:cost}:{})};
    const calls=[...row.calls.slice(0,-1),updated],total=calls.every(c=>c.cost_micro_usd!==undefined)?calls.reduce((n,c)=>n+c.cost_micro_usd!,0):null;
    await args.client.query("UPDATE signal_topic_rule_suggestion_executions SET calls=$2::jsonb,cost_micro_usd=$3,input_tokens=$4,output_tokens=$5 WHERE id=$1::uuid",
      [row.id,JSON.stringify(calls),total,calls.reduce((n,c)=>n+(c.input_tokens??0),0),calls.reduce((n,c)=>n+(c.output_tokens??0),0)]);
  });
}
export async function finishSignalTopicRuleSuggestionExecutionV1(args:{client:Client;execution_id:string;claim_token:string;output_text?:string;
  outcome:"completed"|"definitely_not_sent"|"outcome_unknown"|"failed"}){
  return base.transaction(args.client,async()=>{const row=await rowFor(args.client,args.execution_id);
    if(row.claim_token!==args.claim_token)fail("claim_mismatch");if(row.status!=="claimed")return project(row,true);
    if(args.outcome!=="completed"){
      const outcome=row.calls.some(c=>c.outcome==="pending"||c.outcome==="outcome_unknown")?"outcome_unknown":args.outcome;
      if(outcome==="definitely_not_sent"&&row.calls.some(c=>c.outcome!=="definitely_not_sent"))fail("sent_not_zero");
      const result=(await args.client.query<Row>("UPDATE signal_topic_rule_suggestion_executions SET status=$2,terminal_at=clock_timestamp() WHERE id=$1::uuid RETURNING *",[row.id,outcome])).rows[0]!;return project(result);
    }
    await core.authorize(args.client,scope(row));await current(args.client,row);const last=row.calls.at(-1);
    if(!last||last.outcome!=="succeeded"||last.response_text!==args.output_text||last.response_digest!==byteDigest(args.output_text??"")
      ||row.calls.some(c=>c.cost_micro_usd===undefined||c.outcome!=="succeeded")||row.cost_micro_usd===null)fail("terminal_unproven");
    const prepared=prepareSignalTopicRuleSuggestionContextV1(row.context);
    if(digest(prepared)!==digest(row.prepared_context))fail("prepared_mismatch");
    const adaptation=adaptSignalTopicRuleSuggestionToDraftV1({suggestion:JSON.parse(args.output_text!),context:row.context});
    const visible=new Set(prepared.history.flatMap(t=>t.mentions.filter(m=>m.status==="available").map(m=>m.evidence_ref)));
    const refs=adaptation.provenance.evidence.map(e=>e.evidence_ref);if(refs.some(ref=>!visible.has(ref)))fail("citation_not_visible");
    const available=await base.currentReferences(args.client,{workspace_id:row.workspace_id,snapshot_id:row.snapshot_id},row.context.source.snapshot_digest,refs);
    if(available.size!==refs.length)fail("evidence_unavailable");
    const receiptId=randomUUID(),descriptor={execution_id:row.id,purpose:"topic_rule_suggestion_v1"},contextDigest=digest(row.context),outputDigest=digest(adaptation.suggestion);
    const receiptDigest=digest({origin:"provider",execution_id:row.id,request_digest:row.request_digest,output_digest:outputDigest,
      context_digest:contextDigest,prepared_context_digest:digest(prepared),calls_digest:callsDigest(row.calls),adaptation_digest:digest(adaptation)});
    await args.client.query(`UPDATE signal_topic_rule_suggestion_executions SET status='completed',receipt_id=$2::uuid,terminal_at=clock_timestamp(),
      output_text=$3,output_digest=$4,adaptation=$5::jsonb,receipt_digest=$6 WHERE id=$1::uuid`,[row.id,receiptId,args.output_text,outputDigest,JSON.stringify(adaptation),receiptDigest]);
    await args.client.query(`INSERT INTO signal_topic_rule_suggestion_receipts(id,workspace_id,run_id,candidate_id,snapshot_id,source_revision,
      source_version_digest,source_state_token,rights_digest,authority_digest,origin,provider_execution,provider_calls,input_tokens,output_tokens,cost_micro_usd,
      fixture,fixture_digest,context,context_digest,prepared_context,prepared_context_digest,adaptation,output_digest,receipt_digest,
      actor_user_id,idempotency_key,request,request_digest,execution_id)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,'provider',true,$11,$12,$13,$14,$15::jsonb,$16,$17::jsonb,$18,
        $19::jsonb,$20,$21::jsonb,$22,$23,$24::uuid,$25,$26::jsonb,$27,$28::uuid)`,
      [receiptId,row.workspace_id,row.run_id,row.candidate_id,row.snapshot_id,row.context.source.candidate_revision,row.context.source.candidate_version_digest,
        row.context.source.candidate_state_token,row.rights_digest,row.authority_digest,row.provider_calls,row.input_tokens,row.output_tokens,row.cost_micro_usd,
        JSON.stringify(descriptor),digest(descriptor),JSON.stringify(row.context),contextDigest,JSON.stringify(prepared),digest(prepared),JSON.stringify(adaptation),
        outputDigest,receiptDigest,row.actor_user_id,`topic-rule-execution:${row.id}`,JSON.stringify(row.request),row.request_digest,row.id]);
    return project({...row,status:"completed",receipt_id:receiptId});
  });
}
