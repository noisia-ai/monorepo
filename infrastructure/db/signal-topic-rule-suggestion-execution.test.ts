import test from "node:test";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import {prepareSignalTopicRuleSuggestionContextV1,signalTopicEvaluationDigestV2 as digest} from "@noisia/query-engine";
import {claimSignalTopicRuleSuggestionExecutionV1 as claim,beginSignalTopicRuleSuggestionCallV1 as begin,
  completeSignalTopicRuleSuggestionCallV1 as complete,finishSignalTopicRuleSuggestionExecutionV1 as finish,
  launchSignalTopicRuleSuggestionExecutionV1 as launch,navigateSignalTopicRuleSuggestionExecutionV1 as navigate}
  from "./signal-topic-rule-suggestion-execution";
import type {SignalTopicContractDraftClient} from "./signal-topic-contract-drafts";
const byteDigest=(text:string)=>`sha256:${createHash("sha256").update(text,"utf8").digest("hex")}`;
const id="00000000-0000-4000-8000-000000000001",token="00000000-0000-4000-8000-000000000002",d=digest("source");
const request={run_key:"unit-rule-run",candidate_key:"candidate.one",expected_candidate_revision:1,expected_candidate_state_token:d,
  expected_draft_revision:0,expected_draft_digest:null,budget_micro_usd:1000000};
const source={workspace_id:id,run_key:request.run_key,candidate_key:request.candidate_key,snapshot_digest:d,session_key:`topic-rule-execution:${id}`,
  candidate_revision:1,candidate_state_token:d,candidate_version_digest:d};
const context={source,candidate:{label:"Alexa",definition:"Alexa discussions",inclusion:[],exclusion:[],source_cluster_keys:["cluster.one"],historical_evidence_refs:[]},
  draft:{revision:0,digest:null},brand_os:{source,status:"empty",authority_digest:d,elements:[]},traces:[]};
const prepared=prepareSignalTopicRuleSuggestionContextV1(context);
function probe(overrides:Record<string,unknown>={}){
  const row={id,workspace_id:id,actor_user_id:id,run_id:id,candidate_id:id,snapshot_id:id,request,request_digest:digest(request),idempotency_key:"unit-execution-key",
    status:"claimed",claim_token:token,context,prepared_context:prepared,rights_digest:d,authority_digest:d,budget_micro_usd:1000000,calls:[],navigations:[],
    receipt_id:null,cost_micro_usd:0,provider_calls:0,input_tokens:0,output_tokens:0,...overrides};
  const queries:Array<{sql:string;values:unknown[]}>=[];
  const client={async query(sql:string,values:unknown[]=[]){queries.push({sql,values});
    if(/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/u.test(sql))return{rows:[],rowCount:0};
    if(sql.startsWith("SELECT current_setting"))return{rows:[{value:"serializable"}],rowCount:1};
    if(sql.startsWith("SELECT EXISTS"))return{rows:[{authorized:true}],rowCount:1};
    if(sql.includes("FROM signal_topic_rule_suggestion_executions"))return{rows:[row],rowCount:1};
    if(sql.includes("snapshot.rights_digest"))return{rows:[{rights_digest:d,authority_digest:d,authority_current:true}],rowCount:1};
    if(sql.includes("FROM signal_topic_contract_draft_versions"))return{rows:[],rowCount:0};
    if(sql.includes("FROM signal_topic_evaluation_v2_candidates"))return{rows:[{candidate_id:id,run_id:id,snapshot_id:id,revision:1,version_digest:d,state_token:d,
      review_state:"pending",snapshot_digest:d}],rowCount:1};
    if(sql.startsWith("SELECT pg_advisory"))return{rows:[],rowCount:0};
    if(sql.startsWith("INSERT INTO signal_topic_rule_suggestion_receipts"))return{rows:[],rowCount:1};
    if(sql.startsWith("UPDATE"))return{rows:[{...row,status:values[1]}],rowCount:1};
    throw new Error(`Unexpected SQL: ${sql.slice(0,80)}`);
  }} as SignalTopicContractDraftClient;
  return{client,row,queries,args:{client,execution_id:id,claim_token:token}};
}
test("a repeated job never reacquires a claim or mutates the paid execution",async()=>{
  for(const status of ["claimed","completed","failed","outcome_unknown"]){const p=probe({status});assert.equal(await claim(p.args),null);
    assert.equal(p.queries.some(q=>q.sql.startsWith("UPDATE")),false);}
});
test("launch with same key replays exact actor/CAS/budget and rejects conflicts",async()=>{
  const p=probe();const args={client:p.client,workspace_id:id,actor:{id,user_type:"noisia_internal" as const},...request,idempotency_key:"unit-execution-key"};
  assert.equal((await launch(args)).idempotent_replay,true);
  await assert.rejects(launch({...args,budget_micro_usd:999999}),{code:"topic_rule_suggestion_execution_idempotency_conflict"});
  await assert.rejects(launch({...args,budget_micro_usd:1000001}),{code:"topic_rule_suggestion_execution_budget_invalid"});
  assert.equal(p.queries.some(q=>q.sql.startsWith("INSERT")),false);
});
test("wrong claim cannot reserve, navigate, settle or finish",async()=>{
  const p=probe();const bad={...p.args,claim_token:id};
  for(const call of [()=>begin({...bad,prompt:"x",max_output_tokens:100}),()=>navigate({...bad,request:{operation:"continue",trace_index:3}}),
    ()=>complete({...bad,call_index:1,outcome:"definitely_not_sent"}),()=>finish({...bad,outcome:"failed"})])
    await assert.rejects(call(),{code:"topic_rule_suggestion_execution_claim_mismatch"});
  assert.equal(p.queries.some(q=>q.sql.startsWith("UPDATE")),false);
});
test("pending provider outcome cannot be overwritten by a fresh reserve or navigation",async()=>{
  for(const outcome of ["pending","outcome_unknown"]){const p=probe({calls:[{outcome}]});
    await assert.rejects(begin({...p.args,prompt:`Instructions\n${JSON.stringify(prepared)}`,max_output_tokens:100}),{code:"topic_rule_suggestion_execution_call_blocked"});
    await assert.rejects(navigate({...p.args,request:{operation:"continue",trace_index:3}}),{code:"topic_rule_suggestion_execution_navigation_blocked"});}
});
test("prompt context verifies canonical JSON despite jsonb key order; reserve precedes transport",async()=>{
  const p=probe({prepared_context:Object.fromEntries(Object.entries(prepared).reverse())});
  assert.deepEqual(await begin({...p.args,prompt:`Instructions\n${JSON.stringify(prepared)}`,max_output_tokens:100}),{call_index:1,max_output_tokens:100});
  const write=p.queries.find(q=>q.sql.startsWith("UPDATE"))!;const stored=JSON.parse(String(write.values[1]))[0];
  assert.equal(stored.outcome,"pending");assert.equal(stored.prompt_digest,byteDigest(stored.prompt));
  assert.equal(stored.reserved_micro_usd,Buffer.byteLength(stored.prompt)+8192+500);
  await assert.rejects(begin({...p.args,prompt:'Instructions\n{}',max_output_tokens:100}),{code:"topic_rule_suggestion_execution_prompt_context_mismatch"});
});
test("server cap is conservative and settled usage reconciles exact microdollars",async()=>{
  const p=probe({budget_micro_usd:1});await assert.rejects(begin({...p.args,prompt:`Instructions\n${JSON.stringify(prepared)}`,max_output_tokens:100}),{code:"topic_rule_suggestion_execution_budget_exhausted"});
  const q=probe({calls:[{call_index:1,outcome:"pending",prompt:"x",prompt_digest:digest("x"),reserved_micro_usd:1000,max_output_tokens:100}]});
  await complete({...q.args,call_index:1,outcome:"succeeded",input_tokens:12,output_tokens:7,response_text:'{}',request_id:'req-unit'});
  const write=q.queries.find(x=>x.sql.startsWith("UPDATE"))!;assert.equal(write.values[2],47);assert.equal(write.values[3],12);assert.equal(write.values[4],7);
  assert.equal(JSON.parse(String(write.values[1]))[0].response_digest,byteDigest('{}'));
});
test("terminal cannot accept caller context or invented response bytes",async()=>{
  const p=probe({calls:[{call_index:1,outcome:"succeeded",response_text:'{}',response_digest:byteDigest('{}'),cost_micro_usd:0}]});
  await assert.rejects(finish({...p.args,outcome:"completed",output_text:'{"invented":true}'}),{code:"topic_rule_suggestion_execution_terminal_unproven"});
  assert.equal(p.queries.some(q=>q.sql.startsWith("UPDATE")||q.sql.startsWith("INSERT")),false);
});
test("unresolved send is terminal unknown, never silently zero-spend",async()=>{
  const p=probe({calls:[{outcome:"pending"}],cost_micro_usd:null,provider_calls:1});
  const result=await finish({...p.args,outcome:"definitely_not_sent"});assert.equal(result.status,"outcome_unknown");assert.equal(result.cost_micro_usd,null);
});

test("sealed claim can settle known provider usage after authorization is withdrawn in flight",async()=>{
  const p=probe({calls:[{call_index:1,outcome:"pending",prompt:"x",prompt_digest:digest("x"),reserved_micro_usd:10000,max_output_tokens:100}]});
  await complete({...p.args,call_index:1,outcome:"failed",input_tokens:19,output_tokens:3});
  assert.equal(p.queries.some(q=>q.sql.startsWith("SELECT EXISTS")),false);
  assert.equal(p.queries.find(q=>q.sql.startsWith("UPDATE"))!.values[2],34);
  const q=probe({calls:[{outcome:"pending"}],cost_micro_usd:null,provider_calls:1});
  await finish({...q.args,outcome:"outcome_unknown"});assert.equal(q.queries.some(r=>r.sql.startsWith("SELECT EXISTS")),false);
});

test("provider envelope hashes exact UTF-8 including newline and Unicode, not JSON escaping",async()=>{
  const p=probe();const prompt=`Instrucciones\nTexto acentuado á y separador \u2028.\n${JSON.stringify(prepared)}`;
  await begin({...p.args,prompt,max_output_tokens:100});
  const stored=JSON.parse(String(p.queries.find(q=>q.sql.startsWith("UPDATE"))!.values[1]))[0];
  assert.equal(stored.prompt_digest,byteDigest(prompt));assert.notEqual(stored.prompt_digest,digest(prompt));
  const q=probe({calls:[stored]});const response='{"explanation":"línea\\nsegunda"}';
  await complete({...q.args,call_index:1,outcome:"succeeded",input_tokens:10,output_tokens:5,response_text:response});
  const settled=JSON.parse(String(q.queries.find(r=>r.sql.startsWith("UPDATE"))!.values[1]))[0];
  assert.equal(settled.response_digest,byteDigest(response));assert.equal(settled.response_text,response);
});

test("terminal preserves multiline and decomposed-Unicode explanation in adaptation and raw bytes",async()=>{
  const explanation="Primera línea\nSegunda cafe\u0301 y separador \u2028 final.";
  const output={contract_version:"signal-topic-rule-suggestion-v1",status:"insufficient_evidence",explanation};
  const raw=JSON.stringify(output),p=probe({calls:[{call_index:1,outcome:"succeeded",response_text:raw,response_digest:byteDigest(raw),cost_micro_usd:20}],
    cost_micro_usd:20,provider_calls:1,input_tokens:10,output_tokens:2});
  const result=await finish({...p.args,outcome:"completed",output_text:raw});assert.equal(result.status,"completed");
  const terminal=p.queries.find(q=>q.sql.startsWith("UPDATE"))!;
  assert.equal(terminal.values[2],raw);const adaptation=JSON.parse(String(terminal.values[4]));
  assert.equal(adaptation.suggestion.explanation,explanation);assert.notEqual(explanation,explanation.normalize("NFC"));
  assert.equal(terminal.values[3],digest(adaptation.suggestion));
});
