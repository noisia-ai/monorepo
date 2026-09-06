import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {signalTopicEvaluationDigestV2 as digest,sanitizeSignalTopicEvidenceExcerptV2,
  prepareSignalTopicRuleSuggestionContextV1} from "@noisia/query-engine";
import {receiveSimulatedSignalTopicRuleSuggestionV1 as receive,
  loadSignalTopicRuleSuggestionV1 as load,saveSignalTopicRuleSuggestionDraftV1 as save}
  from "./signal-topic-rule-suggestions";
import type {SignalTopicContractDraftClient} from "./signal-topic-contract-drafts";

const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const scope={workspace_id:uuid(1),actor:{id:uuid(2),user_type:"noisia_internal" as const},
  run_key:"topic-rule-unit-run",candidate_key:"topic.football"};
const cas={expected_candidate_revision:1,expected_candidate_state_token:digest("candidate"),
  expected_draft_revision:0,expected_draft_digest:null};
const lexical={any:["Alexa","Echo"],all:[],not:[]};
const filters={languages:[],markets:["MX"],scopes:[]};
const fixture={status:"suggested",lexical,filters,explanation:"Local fixture, not provider output.",citation_count:1};
type Query={sql:string;values:unknown[]};
function probe(options:{authorized?:boolean;active?:boolean;isolation?:string;
  resolve?:(sql:string,values:unknown[])=>Record<string,unknown>[]}={}){
  const queries:Query[]=[];
  const client={async query(sql:string,values:unknown[]=[]){
    queries.push({sql,values});let rows:Record<string,unknown>[]=[];
    if(sql.startsWith("SAVEPOINT")){
      if(options.active===false)throw Object.assign(new Error("No local transaction"),{code:"25P01"});
    }else if(sql.startsWith("ROLLBACK TO SAVEPOINT")||sql.startsWith("RELEASE SAVEPOINT")){}
    else if(sql.startsWith("SELECT current_setting"))rows=[{value:options.isolation??"serializable"}];
    else if(sql.startsWith("SELECT EXISTS"))rows=[{authorized:options.authorized??false}];
    else if(sql.startsWith("SELECT pg_advisory")){}
    else if(options.resolve)rows=options.resolve(sql,values);
    else throw new Error("Unexpected query in bounded unit probe");
    return{rows,rowCount:rows.length};
  }} as SignalTopicContractDraftClient;
  return{client,queries};
}
const args=(p:ReturnType<typeof probe>)=>({...scope,...cas,client:p.client,idempotency_key:"suggestion-unit:receive",fixture});
const noWrites=(queries:Query[])=>assert.doesNotMatch(queries.map(q=>q.sql).join("\n"),/\b(?:INSERT|UPDATE|DELETE|BEGIN|COMMIT|to_tsvector|tsquery)\b/u);

test("fixture is data only: rejects caller authority, refs, callback and paid metadata before SQL",async()=>{
  for(const extra of [{origin:"provider"},{provider_execution:true},{provider_calls:1},{verified:true},
    {context:{}},{evidence_refs:[digest("foreign")]},{callback:()=>({})},{input_tokens:100},{cost_micro_usd:1}]){
    const p=probe();await assert.rejects(receive({...args(p),fixture:{...fixture,...extra}}));assert.equal(p.queries.length,0);
  }
});
test("fixture status, citation count, explanation and closed RuleSpec bounds reject before SQL",async()=>{
  for(const value of [null,[],{}, {...fixture,status:"completed"}, {...fixture,citation_count:0},
    {...fixture,citation_count:13},{...fixture,citation_count:1.1},{...fixture,explanation:" "},
    {...fixture,explanation:"x".repeat(601)},{...fixture,lexical:{any:[],all:[],not:["Alexa"]}},
    {...fixture,filters:{...filters,markets:["worldwide"]}},{...fixture,lexical:{...lexical,sql:"SELECT 1"}}]){
    const p=probe();await assert.rejects(receive({...args(p),fixture:value}));assert.equal(p.queries.length,0);
  }
});
test("insufficient evidence is a closed no-matcher branch, not an empty rule",async()=>{
  const p=probe();await assert.rejects(receive({...args(p),fixture:{status:"insufficient_evidence",explanation:"Not enough evidence."}}),
    {code:"topic_rule_draft_forbidden"});noWrites(p.queries);
  for(const extra of [{lexical},{filters},{citation_count:1},{evidence_refs:[]}]){
    const q=probe();await assert.rejects(receive({...args(q),fixture:{status:"insufficient_evidence",explanation:"None.",...extra}}));
    assert.equal(q.queries.length,0);
  }
});
test("candidate, draft CAS and request keys reject invalid inputs without touching SQL",async()=>{
  for(const change of [{run_key:"bad"},{candidate_key:"Invalid key"},{idempotency_key:"short"},
    {expected_candidate_revision:0},{expected_candidate_revision:1.5},{expected_candidate_state_token:"sha256"},
    {expected_draft_revision:-1},{expected_draft_revision:1,expected_draft_digest:null},
    {expected_draft_revision:0,expected_draft_digest:digest("unexpected")}]){
    const p=probe();await assert.rejects(receive({...args(p),...change}),{code:"topic_rule_suggestion_request_invalid"});
    assert.equal(p.queries.length,0);
  }
});
test("receiver requires caller transaction and serializable isolation without creating an outer transaction",async()=>{
  const absent=probe({active:false});await assert.rejects(receive(args(absent)),{code:"topic_rule_suggestion_transaction_required"});
  for(const isolation of ["read committed","repeatable read"]){const p=probe({isolation});
    await assert.rejects(receive(args(p)),{code:"topic_rule_suggestion_serializable_required"});
    assert.ok(p.queries.some(q=>q.sql.startsWith("ROLLBACK TO SAVEPOINT")));noWrites(p.queries);
  }
});
test("DB authorization applies to receive, GET and bridge; denial never writes or measures",async()=>{
  for(const operation of ["receive","get","save"]){const p=probe();
    const promise=operation==="receive"?receive(args(p)):operation==="get"?load({...scope,queryable:p.client})
      :save({...scope,...cas,client:p.client,receipt_id:uuid(8),idempotency_key:"suggestion-unit:save",action:"save",lexical,filters});
    await assert.rejects(promise,{code:"topic_rule_draft_forbidden"});noWrites(p.queries);
    const auth=p.queries.find(q=>q.sql.startsWith("SELECT EXISTS"));assert.deepEqual(auth?.values,[scope.workspace_id,scope.actor.id]);
    if(operation==="get")assert.doesNotMatch(p.queries.map(q=>q.sql).join("\n"),/SAVEPOINT|pg_advisory/u);
  }
});
test("an arbitrary SQL failure is preserved, not converted to an empty receipt or a successful fixture",async()=>{
  const failure=Object.assign(new Error("Injected bounded SQL failure"),{code:"XX000"});
  const p=probe({authorized:true,resolve(){throw failure;}});
  await assert.rejects(load({...scope,queryable:p.client}),error=>error===failure);noWrites(p.queries);
});
test("receipt replay checks the original actor and canonical fixture request before reading source",async()=>{
  const request={run_key:scope.run_key,candidate_key:scope.candidate_key,...cas,fixture};
  const reached=new Error("Canonical replay reached source projection");
  for(const actorId of [scope.actor.id,uuid(99)]){
    const p=probe({authorized:true,resolve(sql){
      if(sql.includes("FROM signal_topic_rule_suggestion_receipts"))return[{actor_user_id:actorId,request_digest:digest(request)}];
      throw reached;
    }});
    const promise=receive({...args(p),fixture:{...fixture,lexical:{any:["Echo"," Alexa ","Echo"],all:[],not:[]},
      filters:{...filters,markets:["MX","MX"]}}});
    await assert.rejects(promise,actorId===scope.actor.id?(error:unknown)=>error===reached:{code:"topic_rule_suggestion_idempotency_conflict"});
    noWrites(p.queries);
  }
});
test("bridge canonicalizes ordinary edits before its replay digest, preserving same-key intent",async()=>{
  const edit={action:"save" as const,lexical,filters},receipt_id=uuid(8),idempotency_key="suggestion-unit:save";
  const request={run_key:scope.run_key,candidate_key:scope.candidate_key,receipt_id,...cas,...edit};
  const reached=new Error("Canonical bridge replay reached existing ordinary writer");
  const p=probe({authorized:true,resolve(sql){
    if(sql.includes("FROM signal_topic_rule_suggestion_draft_links"))return[{actor_user_id:scope.actor.id,request_digest:digest(request),
      draft_key:"topic-suggestion-draft:"+"a".repeat(64),draft_request:{run_key:scope.run_key,candidate_key:scope.candidate_key,...cas,
        rule_spec:{contract_version:"signal-topic-rule-spec-v1",kind:"topic",label:"Topic",definition:"Stored candidate identity.",lexical,filters}}}];
    throw reached;
  }});
  await assert.rejects(save({...scope,...cas,client:p.client,receipt_id,idempotency_key,action:"save",
    lexical:{any:["Echo"," Alexa ","Echo"],all:[],not:[]},filters:{...filters,markets:["MX","MX"]}}),error=>error===reached);
  noWrites(p.queries);
});
test("canonical context accounts for a trailing space at the navigation excerpt's 600-character boundary",()=>{
  const observed=sanitizeSignalTopicEvidenceExcerptV2("a".repeat(599)+" "+"x");
  const normalized=sanitizeSignalTopicEvidenceExcerptV2(observed);
  assert.equal(observed.length,600);assert.equal(normalized.length,599);
  const source={workspace_id:scope.workspace_id,run_key:scope.run_key,candidate_key:scope.candidate_key,
    snapshot_digest:digest("snapshot"),session_key:"topic-rule-fixture:canonical",
    candidate_revision:1,candidate_state_token:cas.expected_candidate_state_token,candidate_version_digest:digest("version")};
  const context={source,candidate:{label:"Football",definition:"Saved identity.",inclusion:[],exclusion:[],
    source_cluster_keys:["cluster.football"],historical_evidence_refs:[]},draft:{revision:0,digest:null},
    brand_os:{source,status:"empty",authority_digest:digest("brand"),elements:[]},
    traces:[{source,trace_index:3,operation:"representative_mentions",cluster_key:"cluster.football",result_digest:digest("original navigation"),
      mentions:[{status:"available",evidence_ref:digest("ref"),source_digest:digest("member"),excerpt:observed,
        language:"en",market:null,scope:null,month:"2026-05",stratum:"central"}]}]};
  assert.notEqual(digest(context),prepareSignalTopicRuleSuggestionContextV1(context).context_digest);
  context.traces[0]!.mentions[0]!.excerpt=normalized;
  assert.equal(digest(context),prepareSignalTopicRuleSuggestionContextV1(context).context_digest);
  assert.equal(context.traces[0]!.result_digest,digest("original navigation"));
});
test("0125 is two scoped append-only tables, no existing schema rewrite, execution or activation lane",()=>{
  const sql=readFileSync(new URL("./migrations/0125_signal_topic_rule_suggestions.sql",import.meta.url),"utf8");
  assert.equal((sql.match(/CREATE TABLE /gu)??[]).length,2);
  assert.equal((sql.match(/BEFORE UPDATE OR DELETE/gu)??[]).length,2);
  assert.match(sql,/CHECK\(origin='local_fixture'\)/u);assert.match(sql,/CHECK\(provider_calls=0\)/u);
  assert.match(sql,/prepared_context_digest/u);assert.match(sql,/FOREIGN KEY\(candidate_id,run_id,workspace_id\)/u);
  assert.match(sql,/FOREIGN KEY\(draft_id,workspace_id\)/u);
  assert.doesNotMatch(sql,/\b(?:ALTER TABLE|DROP TABLE|DISABLE TRIGGER|COMMIT)\b|INSERT INTO (?:signal_classification|record_tags)/u);
  const source=readFileSync(new URL("./signal-topic-rule-suggestions.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/process\.env|new Pool\(|new Client\(|generateAnthropic|fetch\(/u);
});
