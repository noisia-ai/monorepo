import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {signalTopicEvaluationDigestV2 as digest} from "@noisia/query-engine";
import {createSignalTopicContractDraftV1 as create,loadSignalTopicContractDraftV1 as load,
  runSignalTopicContractDraftTrialV1 as trial,type SignalTopicContractDraftClient} from "./signal-topic-contract-drafts";
const scope={workspace_id:"11111111-1111-4111-8111-111111111111",run_key:"topic-run-original",candidate_key:"topic.original"};
const actor={id:"22222222-2222-4222-8222-222222222222",user_type:"noisia_internal" as const};
const spec={contract_version:"signal-topic-rule-spec-v1",kind:"topic",label:"Football experiences",
  definition:"A deliberate operator-authored lexical experiment, not semantic approval.",
  lexical:{any:["echo football"],all:[],not:["customer service"]},filters:{languages:[],markets:[],scopes:[]}};
const initial={candidate_id:"33333333-3333-4333-8333-333333333333",run_id:"44444444-4444-4444-8444-444444444444",
  snapshot_id:"55555555-5555-4555-8555-555555555555",base_revision_id:"66666666-6666-4666-8666-666666666666",
  editorial_revision_id:null,revision:1,version_digest:digest("source"),state_token:digest("state"),review_state:"pending",
  run_key:scope.run_key,candidate_key:scope.candidate_key,snapshot_digest:digest("snapshot"),population_digest:digest("population")};
type RecordRow=Record<string,any>;
function fixture(){
  const state={active:true,authorized:true,source:{...initial} as RecordRow,drafts:[] as RecordRow[],trials:[] as RecordRow[],
    measuredCalls:0,failMeasurement:false,editWhileWaiting:false,currentExample:"available" as "available"|"unavailable"|"missing"};
  const queries:Array<{sql:string;values:unknown[]}>=[];let saved:{drafts:RecordRow[];trials:RecordRow[]}|null=null;
  const client={async query(sql:string,values:unknown[]=[]){
    queries.push({sql,values});let rows:RecordRow[]=[];
    if(sql.startsWith("SAVEPOINT")){if(!state.active)throw Object.assign(new Error("no transaction"),{code:"25P01"});
      saved=structuredClone({drafts:state.drafts,trials:state.trials});}
    else if(sql.startsWith("ROLLBACK TO")){state.drafts=saved!.drafts;state.trials=saved!.trials;}
    else if(sql.startsWith("RELEASE SAVEPOINT"))saved=null;
    else if(sql.startsWith("SELECT EXISTS"))rows=[{authorized:state.authorized}];
    else if(sql.startsWith("SELECT pg_advisory")){}
    else if(sql.startsWith("SELECT candidate.id FROM")){if(state.editWhileWaiting){
      state.source.revision=2;state.source.version_digest=digest("concurrent edit");state.source.state_token=digest("concurrent token");}}
    else if(sql.startsWith("SELECT candidate.id::text candidate_id"))rows=values[0]===scope.workspace_id
      &&values[1]===scope.run_key&&values[2]===scope.candidate_key?[state.source]:[];
    else if(sql.startsWith("SELECT draft.*")){
      rows=sql.includes("idempotency_key=$2")?state.drafts.filter((row)=>row.workspace_id===values[0]&&row.key===values[1]):
        state.drafts.filter((row)=>row.id===values[0]&&row.workspace_id===values[1]);
    }else if(sql.startsWith("SELECT COALESCE(max(revision)"))rows=[{revision:state.drafts.at(-1)?.revision??0}];
    else if(sql.includes("FROM signal_topic_contract_draft_versions")&&sql.includes("ORDER BY revision DESC"))rows=state.drafts.slice(-1);
    else if(sql.startsWith("INSERT INTO signal_topic_contract_draft_versions")){
      const row={id:values[0],workspace_id:values[1],run_id:values[2],candidate_id:values[3],snapshot_id:values[4],
        source_revision:values[7],source_version_digest:values[8],revision:values[10],predecessor_id:values[11],
        rule_spec:JSON.parse(values[13] as string),spec_digest:values[14],draft_digest:values[15],actor_user_id:values[16],
        key:values[17],request:JSON.parse(values[18] as string),request_digest:values[19],
        run_key:scope.run_key,candidate_key:scope.candidate_key,created_at:"2026-09-06T20:00:00Z"};
      state.drafts.push(row);rows=[row];
    }else if(sql.includes("FROM signal_topic_contract_draft_trial_receipts"))rows=state.trials.filter((row)=>row.workspace_id===values[0]&&row.key===values[1]);
    else if(sql.startsWith("SELECT current_setting"))rows=[{value:"0"}];
    else if(sql.startsWith("SELECT set_config")){}
    else if(sql.startsWith("WITH requested_examples AS MATERIALIZED")){
      rows=state.currentExample==="missing"?[]:(values[3] as string[]).map((evidence_ref)=>({evidence_ref,
        available:state.currentExample==="available"}));
    }
    else if(sql.startsWith("WITH population AS MATERIALIZED")){
      state.measuredCalls++;if(state.failMeasurement)throw Object.assign(new Error("timeout"),{code:"57014"});
      const cap=values[2] as number,considered=Math.min(4,cap);
      rows=[{counts:{total:4,considered,not_tested:4-considered,unavailable:0,filter_excluded:0,matched:considered,abstained:0},
        considered_digest:digest({considered}),examples:[{member_ref:digest("member"),source_record_digest:digest("source-record"),
          outcome:"matched",text_clean:"Echo football @person https://example.com test@example.com",language:null,
          market:null,scope:null,published_month:"2026-05"}].slice(0,values.at(-1) as number)}];
    }else if(sql.startsWith("INSERT INTO signal_topic_contract_draft_trial_receipts")){
      const row={id:values[0],workspace_id:values[1],draft_id:values[2],actor_user_id:values[3],key:values[4],
        request:JSON.parse(values[5] as string),request_digest:values[6],result:JSON.parse(values[7] as string),
        result_digest:values[8],created_at:"2026-09-06T20:00:01Z"};state.trials.push(row);rows=[row];
    }else throw new Error(`unexpected SQL: ${sql.slice(0,90)}`);
    return{rows,rowCount:rows.length};
  }};
  return{state,queries,client:client as SignalTopicContractDraftClient};
}
function createArgs(f:ReturnType<typeof fixture>,extra:RecordRow={}){return{client:f.client,...scope,actor,
  expected_candidate_revision:1,expected_candidate_state_token:initial.state_token,expected_draft_revision:0,
  expected_draft_digest:null,idempotency_key:"draft-proof:initial",rule_spec:spec,...extra};}
async function setupTrial(f:ReturnType<typeof fixture>){const draft=await create(createArgs(f));
  return{client:f.client,workspace_id:scope.workspace_id,actor,draft_id:draft.draft_id,
    expected_draft_revision:draft.revision,expected_draft_digest:draft.draft_digest,
    expected_candidate_revision:1,expected_candidate_state_token:initial.state_token,idempotency_key:"trial-proof:initial"};}

test("draft binds exact candidate source and stores a normalized immutable spec without catalog writes",async()=>{
  const f=fixture(),draft=await create(createArgs(f));assert.equal(draft.revision,1);assert.equal(draft.is_stale,false);
  assert.equal(draft.spec_digest,digest(draft.rule_spec));assert.equal(draft.predecessor_draft_id,null);
  assert.deepEqual(draft.source,{run_key:scope.run_key,candidate_key:scope.candidate_key,revision:1,
    version_digest:initial.version_digest,snapshot_digest:initial.snapshot_digest});
  assert.equal(f.queries[0]!.sql,"SAVEPOINT topic_rule_draft_v1");assert.match(f.queries.at(-1)!.sql,/RELEASE SAVEPOINT/u);
  assert.doesNotMatch(f.queries.map((row)=>row.sql).join("\n"),/\b(?:COMMIT|CREATE|ALTER|DELETE)\b|INSERT INTO (?:taxonom|signal_classification|record_tags|.*outbox)/u);
});
test("caller-owned transaction is mandatory, and SQL errors preserve the outer transaction",async()=>{
  const f=fixture();f.state.active=false;await assert.rejects(create(createArgs(f)),{code:"topic_rule_draft_transaction_required"});
  assert.equal(f.queries.length,1);assert.equal(f.state.drafts.length,0);
  const g=fixture(),args=await setupTrial(g);g.state.failMeasurement=true;
  await assert.rejects(trial(args),{code:"57014"});assert.equal(g.state.drafts.length,1);assert.equal(g.state.trials.length,0);
  assert.match(g.queries.at(-2)!.sql,/ROLLBACK TO SAVEPOINT/u);
});
test("same actor/request replays original draft even after source and later draft revisions change",async()=>{
  const f=fixture(),args=createArgs(f),first=await create(args);
  await create(createArgs(f,{idempotency_key:"draft-proof:second",expected_draft_revision:1,
    expected_draft_digest:first.draft_digest,rule_spec:{...spec,label:"Second wording"}}));
  f.state.source.revision=2;f.state.source.version_digest=digest("edited source");
  const replay=await create(args);assert.equal(replay.draft_id,first.draft_id);assert.equal(replay.idempotent_replay,true);
  assert.equal(replay.is_stale,true);assert.equal(replay.is_latest,false);assert.equal(f.state.drafts.length,2);
});
test("same-key actor or payload divergence rejects without extra rows",async()=>{
  const f=fixture(),args=createArgs(f);await create(args);
  await assert.rejects(create({...args,rule_spec:{...spec,label:"Divergent"}}),{code:"topic_rule_draft_idempotency_conflict"});
  await assert.rejects(create({...args,actor:{...actor,id:"77777777-7777-4777-8777-777777777777"}}),{code:"topic_rule_draft_idempotency_conflict"});
  assert.equal(f.state.drafts.length,1);
});
test("candidate revision/state or predecessor drift rejects new drafts and retains history",async()=>{
  for(const change of [{revision:2},{state_token:digest("changed")},{review_state:"rejected"}]){
    const f=fixture();Object.assign(f.state.source,change);await assert.rejects(create(createArgs(f)),{code:"topic_rule_candidate_stale"});
  }
  const f=fixture(),first=await create(createArgs(f));
  await assert.rejects(create(createArgs(f,{idempotency_key:"draft-proof:concurrent"})),{code:"topic_rule_draft_stale"});
  await assert.rejects(create(createArgs(f,{idempotency_key:"draft-proof:wrong",expected_draft_revision:1,
    expected_draft_digest:digest("wrong")})),{code:"topic_rule_draft_stale"});
  assert.equal(f.state.drafts[0]!.draft_digest,first.draft_digest);
});
test("candidate state is read after acquiring its shared editor lock, including a concurrent completed edit",async()=>{
  const f=fixture();f.state.editWhileWaiting=true;
  await assert.rejects(create(createArgs(f)),{code:"topic_rule_candidate_stale"});
  const lock=f.queries.findIndex(({sql})=>sql.startsWith("SELECT candidate.id FROM"));
  const read=f.queries.findIndex(({sql})=>sql.startsWith("SELECT candidate.id::text candidate_id"));
  assert.ok(lock>=0&&read>lock);assert.equal(f.state.drafts.length,0);
});
test("load reports null or latest draft and source staleness without writes",async()=>{
  const f=fixture();assert.equal(await load({queryable:f.client,...scope,actor}),null);
  const first=await create(createArgs(f));f.state.source.version_digest=digest("changed without number");
  const result=await load({queryable:f.client,...scope,actor});assert.equal(result!.draft_id,first.draft_id);assert.equal(result!.is_stale,true);
});
test("DB authorization, foreign workspace/candidate and malformed inputs fail closed",async()=>{
  const f=fixture();f.state.authorized=false;await assert.rejects(create(createArgs(f)),{status:403});
  const g=fixture();await assert.rejects(create(createArgs(g,{candidate_key:"topic.foreign"})),{status:404});
  await assert.rejects(create(createArgs(g,{workspace_id:"77777777-7777-4777-8777-777777777777"})),{status:404});
  await assert.rejects(create(createArgs(g,{expected_draft_revision:-1})),{status:422});
  await assert.rejects(create(createArgs(g,{rule_spec:{...spec,sql:"SELECT *"}})));
  assert.equal(g.state.drafts.length,0);
});
test("trial measures server-bound population, reconciles cap honestly and returns only bounded sanitized examples",async()=>{
  const f=fixture(),args=await setupTrial(f),result=await trial({...args,max_memberships:2,example_limit:1});
  assert.deepEqual(result.counts,{total:4,considered:2,not_tested:2,unavailable:0,filter_excluded:0,matched:2,abstained:0});
  assert.equal(result.population_kind,"frozen_snapshot_memberships");assert.equal(result.is_stale,false);
  assert.match(result.examples[0]!.excerpt,/\[handle\] \[url\] \[email\]/u);
  assert.doesNotMatch(JSON.stringify(result),/@person|example\.com|member_ref|text_clean|statement_timeout/u);
  assert.equal(result.examples[0]!.market,null);assert.equal(result.serving,false);
  const query=f.queries.find((row)=>row.sql.startsWith("WITH population"))!;
  assert.deepEqual(query.values.slice(0,3),[scope.workspace_id,initial.snapshot_id,2]);
  assert.match(query.sql,/mention\.id=mention\.canonical_mention_id/u);assert.match(query.sql,/source\.status='active'/u);
  assert.match(query.sql,/=selected\.source_content_hash/u);assert.match(query.sql,/CASE WHEN available THEN text_clean ELSE NULL/u);
  assert.match(query.sql,/ORDER BY assignment_index,member_ref LIMIT \$3/u);
  assert.match(query.sql,/WHERE outcome IN\('matched','abstained'\)\s+ORDER BY CASE outcome WHEN 'matched' THEN 0 ELSE 1 END,assignment_index,member_ref/u);
  assert.deepEqual(f.queries.filter((row)=>row.sql.startsWith("SELECT set_config")).map((row)=>row.values),[["15000ms"],["0"]]);
});
test("trial replay does not measure again and returns original receipt with current stale metadata",async()=>{
  const f=fixture(),args=await setupTrial(f),first=await trial(args);f.state.source.revision=2;
  const replayed=await trial(args);assert.equal(replayed.trial_id,first.trial_id);assert.equal(replayed.idempotent_replay,true);
  assert.equal(replayed.is_stale,true);assert.deepEqual(replayed.counts,first.counts);assert.equal(f.state.measuredCalls,1);
  assert.deepEqual(replayed.example_availability,{stored:1,available:1,unavailable:0});
  await assert.rejects(trial({...args,max_memberships:1}),{code:"topic_rule_draft_idempotency_conflict"});
});
test("trial replay rechecks exact current rights/content and hides unavailable cached examples without remeasurement",async()=>{
  for(const unavailable of ["unavailable","missing"] as const){
    const f=fixture(),args=await setupTrial(f),first=await trial(args),stored=structuredClone(f.state.trials[0]);
    f.state.currentExample=unavailable;const replayed=await trial(args);
    assert.deepEqual(replayed.examples,[]);assert.deepEqual(replayed.example_availability,{stored:1,available:0,unavailable:1});
    assert.deepEqual(replayed.counts,first.counts);assert.equal(replayed.considered_digest,first.considered_digest);
    assert.equal(replayed.trial_id,first.trial_id);assert.equal(replayed.is_stale,false);
    assert.equal(f.state.measuredCalls,1);assert.equal(f.state.trials.length,1);assert.deepEqual(f.state.trials[0],stored);
    const check=f.queries.find(({sql})=>sql.startsWith("WITH requested_examples"))!;
    assert.deepEqual(check.values,[scope.workspace_id,initial.snapshot_id,initial.snapshot_digest,[first.examples[0]!.evidence_ref]]);
    assert.match(check.sql,/membership.workspace_id=\$1::uuid AND membership.snapshot_id=\$2::uuid/u);
    assert.match(check.sql,/evidence_ref=ANY\(\$4::text\[\]\)/u);
    assert.match(check.sql,/mention\.id=mention\.canonical_mention_id/u);assert.match(check.sql,/source\.status='active'/u);
    assert.match(check.sql,/mention\.inclusion_status='included'/u);assert.match(check.sql,/=selected\.source_content_hash/u);
    assert.doesNotMatch(check.sql,/tsquery|to_tsvector/u);
    assert.match(check.sql,/SELECT selected.evidence_ref,COALESCE/u,"never return raw unavailable source content");
  }
});
test("fresh trials reject stale source, stale draft or foreign draft; limits cannot be widened",async()=>{
  const f=fixture(),args=await setupTrial(f);f.state.source.version_digest=digest("changed");
  await assert.rejects(trial(args),{code:"topic_rule_draft_source_stale"});
  f.state.source={...initial};await create(createArgs(f,{idempotency_key:"draft-proof:next",expected_draft_revision:1,
    expected_draft_digest:args.expected_draft_digest}));
  await assert.rejects(trial(args),{code:"topic_rule_draft_stale"});
  await assert.rejects(trial({...args,draft_id:"77777777-7777-4777-8777-777777777777"}),{status:404});
  for(const options of [{max_memberships:50001},{max_memberships:0},{max_memberships:1.5},{example_limit:11},{timeout_ms:15001}]){
    await assert.rejects(trial({...args,...options}),{status:422});
  }
  assert.equal(f.state.measuredCalls,0);
});
test("0123 has exactly two append-only tables and no classifier/profile/assignment changes",()=>{
  const sql=readFileSync(new URL("./migrations/0123_signal_topic_contract_drafts.sql",import.meta.url),"utf8");
  assert.equal((sql.match(/CREATE TABLE /gu)??[]).length,2);
  assert.doesNotMatch(sql,/ALTER TABLE|INSERT INTO (?:taxonom|signal_classification|record_tags)|011[6-9]|012[0-2]/u);
  assert.match(sql,/BEFORE UPDATE OR DELETE\s+ON signal_topic_contract_draft_versions/u);
  assert.match(sql,/BEFORE UPDATE OR DELETE\s+ON signal_topic_contract_draft_trial_receipts/u);
  assert.match(sql,/FOR UPDATE/u);assert.match(sql,/NEW\.request IS DISTINCT FROM jsonb_build_object/u);
  assert.match(sql,/\(NEW\.rule_spec->'lexical'\)-\(ARRAY/u);
  assert.match(sql,/\(NEW\.rule_spec->'filters'\)-\(ARRAY/u);
  assert.doesNotMatch(sql,/->'[^']+'-\(ARRAY/u,"JSON extraction must precede key subtraction (PostgreSQL22P02 regression)");
});
