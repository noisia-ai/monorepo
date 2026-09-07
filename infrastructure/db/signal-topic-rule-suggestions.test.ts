import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {signalTopicEvaluationDigestV2 as digest,sanitizeSignalTopicEvidenceExcerptV2,
  prepareSignalTopicRuleSuggestionContextV1} from "@noisia/query-engine";
import {receiveSimulatedSignalTopicRuleSuggestionV1 as receive,
  loadSignalTopicRuleSuggestionV1 as load,saveSignalTopicRuleSuggestionDraftV1 as save,
  loadSignalTopicRuleSuggestionEvidenceV1 as evidence,loadSignalTopicRuleSuggestionPriorDraftV1 as priorDraft}
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

function readerProbe(options:{count?:number;available?:boolean;missing?:boolean;prior?:boolean;
  contextChange?:(context:Record<string,any>)=>void}={}){
  const refs=Array.from({length:options.count??3},(_,index)=>digest(`reader-ref-${index}`));
  const source={workspace_id:scope.workspace_id,run_key:scope.run_key,candidate_key:scope.candidate_key,snapshot_digest:digest("snapshot")};
  const context={source,candidate:{historical_evidence_refs:[digest("historical-only")]},traces:[{mentions:refs.map(evidence_ref=>({
    evidence_ref,status:"available",source_digest:digest("source"),excerpt:"Alexa at https://example.test/secret by @private_name",
    language:"en",market:"MX",scope:"primary_brand",month:"2026-05",mention_id:uuid(55)}))}]};
  options.contextChange?.(context);
  const row={id:uuid(8),workspace_id:scope.workspace_id,run_id:uuid(3),candidate_id:uuid(4),snapshot_id:uuid(5),context,
    adaptation:{provenance:{source,evidence:refs.map(evidence_ref=>({evidence_ref,source_digest:digest("source")}))}}};
  const rule_spec={contract_version:"signal-topic-rule-spec-v1",kind:"topic",label:"Old label",definition:"Old definition",lexical,filters};
  const p=probe({authorized:true,resolve(sql,values){
    if(sql.includes("SELECT candidate.id::text candidate_id"))return[{candidate_id:row.candidate_id,run_id:row.run_id,
      snapshot_id:row.snapshot_id,snapshot_digest:source.snapshot_digest}];
    if(sql.includes("SELECT snapshot.rights_digest"))return[{rights_digest:digest("rights"),authority_digest:digest("authority"),authority_current:true}];
    if(sql.includes("FROM signal_topic_rule_suggestion_receipts"))return options.missing?[]:[row];
    if(sql.startsWith("WITH requested_examples"))return (values[3] as string[]).map(evidence_ref=>({evidence_ref,available:options.available??true}));
    if(sql.includes("FROM signal_topic_contract_draft_versions prior"))return options.prior?[{draft_id:uuid(9),revision:2,rule_spec,
      created_at:"2026-09-06T00:00:00Z"}]:[];
    throw new Error("Unexpected reader query");
  }});
  return{...p,refs,row,readArgs:{...scope,queryable:p.client,receipt_id:row.id}};
}

test("lazy receipt readers validate exact receipt IDs and enforce core authorization before evidence reads",async()=>{
  for(const read of [evidence,priorDraft]){
    const invalid=probe();await assert.rejects(read({...scope,queryable:invalid.client,receipt_id:"foreign-text"}),
      {code:"topic_rule_suggestion_request_invalid"});assert.equal(invalid.queries.length,0);
    const denied=probe();await assert.rejects(read({...scope,queryable:denied.client,receipt_id:uuid(8)}),
      {code:"topic_rule_draft_forbidden"});noWrites(denied.queries);
    assert.equal(denied.queries.length,1);
  }
});
test("receipt evidence projects only its own citations, removes identifiers, and uses current core content/rights checks",async()=>{
  const p=readerProbe({count:12}),result=(await evidence(p.readArgs))!;
  assert.equal(result.origin,"local_fixture");assert.deepEqual(result.availability,{stored:12,available:12,unavailable:0});
  assert.deepEqual(result.citations.map(row=>row.evidence_ref),p.refs);
  assert.doesNotMatch(JSON.stringify(result),/historical-only|example\.test|private_name|mention_id|source_digest/u);
  const queries=p.queries.filter(row=>row.sql.startsWith("WITH requested_examples"));
  assert.deepEqual(queries.map(row=>(row.values[3] as string[]).length),[10,2]);
  for(const query of queries){assert.deepEqual(query.values.slice(0,3),[scope.workspace_id,p.row.snapshot_id,digest("snapshot")]);
    assert.match(query.sql,/source.status='active'/u);assert.match(query.sql,/mention\.text_hash=selected\.canonical_text_hash/u);
    assert.match(query.sql,/selected\.source_content_hash/u);}
  noWrites(p.queries);
});
test("withdrawn or changed current evidence never returns a retained excerpt",async()=>{
  const p=readerProbe({available:false}),result=(await evidence(p.readArgs))!;
  assert.deepEqual(result.availability,{stored:3,available:0,unavailable:3});
  assert.deepEqual(result.citations,p.refs.map(evidence_ref=>({evidence_ref,status:"unavailable",reason:"source_changed"})));
  assert.doesNotMatch(JSON.stringify(result),/excerpt|language|market|month/u);noWrites(p.queries);
});
test("an unavailable trace vetoes a stored citation even if another trace had text",async()=>{
  const p=readerProbe({contextChange(context){context.traces.push({mentions:[{evidence_ref:context.traces[0].mentions[0].evidence_ref,
    status:"unavailable",reason:"rights_changed"}]});}});
  const result=(await evidence(p.readArgs))!;
  assert.equal(result.citations[0]!.status,"unavailable");assert.equal(result.availability.available,2);
  const sent=p.queries.filter(row=>row.sql.startsWith("WITH requested_examples")).flatMap(row=>row.values[3] as string[]);
  assert.ok(!sent.includes(p.refs[0]!));noWrites(p.queries);
});
test("reader bound is twelve unique receipt references; a missing receipt never falls back to naming evidence",async()=>{
  const over=readerProbe({count:13});await assert.rejects(evidence(over.readArgs),{code:"topic_rule_suggestion_evidence_invalid"});
  assert.ok(!over.queries.some(row=>row.sql.startsWith("WITH requested_examples")));
  const duplicate=readerProbe();duplicate.row.adaptation.provenance.evidence.push(duplicate.row.adaptation.provenance.evidence[0]!);
  await assert.rejects(evidence(duplicate.readArgs),{code:"topic_rule_suggestion_evidence_invalid"});
  for(const read of [evidence,priorDraft]){const absent=readerProbe({missing:true});assert.equal(await read(absent.readArgs),null);
    assert.ok(!absent.queries.some(row=>row.sql.startsWith("WITH requested_examples")||row.sql.includes("FROM signal_topic_contract_draft_versions prior")));
    const lookup=absent.queries.find(row=>row.sql.includes("FROM signal_topic_rule_suggestion_receipts"))!;
    assert.deepEqual(lookup.values,[scope.workspace_id,absent.row.run_id,absent.row.candidate_id,absent.row.snapshot_id,uuid(8)]);
    noWrites(absent.queries);}
});
test("receipt context from another scope fails without projecting its text",async()=>{
  for(const key of ["workspace_id","run_key","candidate_key"]){
    const p=readerProbe({contextChange(context){context.source={...context.source,[key]:"foreign"};}});
    await assert.rejects(evidence(p.readArgs),{code:"topic_rule_suggestion_source_invalid"});
    assert.ok(!p.queries.some(row=>row.sql.startsWith("WITH requested_examples")));noWrites(p.queries);
  }
});
test("prior rule is a single earlier ordinary revision scoped to workspace, run, candidate and snapshot",async()=>{
  const p=readerProbe({prior:true}),result=(await priorDraft(p.readArgs))!;
  assert.deepEqual(result,{draft_id:uuid(9),revision:2,lexical,filters,created_at:"2026-09-06T00:00:00.000Z"});
  assert.doesNotMatch(JSON.stringify(result),/label|definition|provider|actor/u);
  const query=p.queries.find(row=>row.sql.includes("FROM signal_topic_contract_draft_versions prior"))!;
  assert.deepEqual(query.values,[scope.workspace_id,p.row.run_id,p.row.candidate_id,p.row.snapshot_id]);
  assert.match(query.sql,/prior\.revision<\(SELECT max\(current\.revision\)/u);
  for(const name of ["workspace_id","run_id","candidate_id","snapshot_id"]){
    assert.match(query.sql,new RegExp(`prior\\.${name}=\\$[1-4]::uuid`,"u"));
    assert.match(query.sql,new RegExp(`current\\.${name}=\\$[1-4]::uuid`,"u"));}
  assert.match(query.sql,/ORDER BY prior\.revision DESC LIMIT 1/u);noWrites(p.queries);
  const empty=readerProbe();assert.equal(await priorDraft(empty.readArgs),null);noWrites(empty.queries);
});
