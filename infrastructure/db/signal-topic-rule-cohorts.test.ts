import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {signalTopicEvaluationDigestV2 as digest,type SignalTopicRuleSpecV1} from "@noisia/query-engine";
import {createSignalTopicRuleCohortV1 as create,runSignalTopicRuleCohortTrialV1 as trial,
  loadSignalTopicRuleCohortV1 as load,loadSignalTopicRuleCohortLatestTrialV1 as loadTrial} from "./signal-topic-rule-cohorts";
import type {SignalTopicContractDraftClient} from "./signal-topic-contract-drafts";
type Row=Record<string,any>;
const uuid=(n:number)=>`00000000-0000-4000-8000-${n.toString().padStart(12,"0")}`;
const context={workspace_id:uuid(1),run_key:"topic-original-run",actor:{id:uuid(2),user_type:"noisia_internal" as const}};
const snap={run_id:uuid(3),snapshot_id:uuid(4),snapshot_digest:digest("snapshot"),population_digest:digest("population"),
  rights_digest:digest("rights"),semantic_context_authority_digest:digest("semantic"),artifact_binding_digest:digest("artifacts")};
function fixture(){
  const sources=["topic.alpha","topic.beta"].map((candidate_key,index)=>({candidate_key,candidate_id:uuid(10+index),...snap,
    revision:1,version_digest:digest(`source-${index}`),state_token:digest(`state-${index}`),review_state:"pending"}));
  const drafts=sources.map((source,index)=>{const rule_spec:SignalTopicRuleSpecV1={contract_version:"signal-topic-rule-spec-v1",kind:"topic",
    label:source.candidate_key,definition:"D".repeat(1500),lexical:{any:[index?"campaign":"football"],all:[],not:[]},
    filters:{languages:[],markets:[],scopes:[]}};return{id:uuid(20+index),candidate_id:source.candidate_id,revision:1,
      draft_digest:digest(`draft-${index}`),rule_spec,spec_digest:digest(rule_spec),source_revision:1,source_version_digest:source.version_digest};});
  const state={authorized:true,active:true,found:true,profileChanged:false,sourceDuringLock:false,examplesAvailable:true,
    failMeasurement:false,measurements:0,globalVersion:8,sources,drafts,cohorts:[] as Row[],trials:[] as Row[],terms:[] as unknown[][]};
  const queries:Array<{sql:string;values:unknown[]}>=[],saves=new Map<string,Pick<typeof state,"cohorts"|"trials"|"terms"|"globalVersion">>();
  const client={async query(sql:string,values:unknown[]=[]){queries.push({sql,values});let rows:Row[]=[];const q=sql.trim();
    if(q.startsWith("SAVEPOINT")){if(!state.active)throw Object.assign(new Error("no transaction"),{code:"25P01"});
      saves.set(q.split(" ")[1]!,structuredClone({cohorts:state.cohorts,trials:state.trials,terms:state.terms,globalVersion:state.globalVersion}));}
    else if(q.startsWith("ROLLBACK TO SAVEPOINT"))Object.assign(state,structuredClone(saves.get(q.split(" ")[3]!)!));
    else if(q.startsWith("RELEASE SAVEPOINT"))saves.delete(q.split(" ")[2]!);
    else if(q.startsWith("SELECT EXISTS"))rows=[{authorized:state.authorized}];
    else if(q.startsWith("SELECT pg_advisory")){}
    else if(q.startsWith("SELECT run.id::text"))rows=state.found&&values[0]===context.workspace_id&&values[1]===context.run_key?[snap]:[];
    else if(q.startsWith("SELECT candidate.id FROM")){if(state.sourceDuringLock)state.sources[0]!.revision=2;}
    else if(q.startsWith("SELECT candidate.id::text"))rows=state.sources.filter(source=>source.candidate_key===values[2]);
    else if(q.includes("FROM signal_topic_contract_draft_versions"))rows=state.drafts.filter(draft=>draft.candidate_id===values[0]);
    else if(q.startsWith("SELECT COALESCE(MAX(version)"))rows=[{version:state.globalVersion+1}];
    else if(q.startsWith("INSERT INTO taxonomies"))rows=[{id:uuid(100+state.globalVersion)}];
    else if(q.startsWith("INSERT INTO taxonomy_terms"))state.terms.push(values);
    else if(q.startsWith("INSERT INTO tagging_rule_sets"))rows=[{id:uuid(200+state.globalVersion)}];
    else if(q.startsWith("INSERT INTO tagging_model_versions"))rows=[{id:uuid(300+state.globalVersion)}];
    else if(q.startsWith("INSERT INTO signal_taxonomy_profiles")){state.globalVersion=values[3] as number;rows=[{id:uuid(400+state.globalVersion)}];}
    else if(q.startsWith("INSERT INTO lineage_edges")){}
    else if(q.startsWith("SELECT signal_topic_rule_cohort_profile_digest"))rows=[{digest:digest("profile"),draft:!state.profileChanged}];
    else if(q.includes("FROM signal_taxonomy_profiles profile"))rows=[{digest:digest(state.profileChanged?"changed-profile":"profile"),draft:!state.profileChanged}];
    else if(q.startsWith("INSERT INTO signal_topic_rule_cohort_versions")){
      const row={id:values[0],workspace_id:values[1],run_id:values[2],snapshot_id:values[3],cohort_revision:values[4],predecessor_id:values[5],
        binding:JSON.parse(values[6] as string),cohort_digest:values[7],profile_id:values[8],profile_version:values[9],profile_binding_digest:values[10],
        actor_user_id:values[11],key:values[12],request:JSON.parse(values[13] as string),request_digest:values[14],created_at:"2026-09-06T10:00:00Z"};
      state.cohorts.push(row);rows=[row];
    }else if(q.includes("FROM signal_topic_rule_cohort_versions")){
      rows=q.includes("idempotency_key=$2")?state.cohorts.filter(row=>row.workspace_id===values[0]&&row.key===values[1]):
        q.includes("WHERE id=$1")?state.cohorts.filter(row=>row.id===values[0]&&row.workspace_id===values[1]&&row.run_id===values[2]):
          state.cohorts.filter(row=>row.workspace_id===values[0]&&row.binding.run_key===values[1]).slice(-1);
    }else if(q.includes("FROM signal_topic_rule_cohort_trial_receipts"))rows=q.includes("idempotency_key=$2")?
      state.trials.filter(row=>row.workspace_id===values[0]&&row.key===values[1]):state.trials.filter(row=>row.workspace_id===values[0]&&row.cohort_id===values[1]).slice(-1);
    else if(q.startsWith("SELECT current_setting"))rows=[{value:"0"}];
    else if(q.startsWith("SELECT set_config")){}
    else if(q.startsWith("WITH requested_examples"))rows=(values[3] as string[]).map(evidence_ref=>({evidence_ref,available:state.examplesAvailable}));
    else if(q.startsWith("WITH population")){
      state.measurements++;if(state.failMeasurement)throw Object.assign(new Error("timeout"),{code:"57014"});
      const histogram=[{available:false,filter_mask:0,match_mask:0,count:1},{available:true,filter_mask:0,match_mask:0,count:1},
        {available:true,filter_mask:3,match_mask:0,count:1},{available:true,filter_mask:3,match_mask:1,count:1},
        {available:true,filter_mask:3,match_mask:3,count:1}].slice(0,values[2] as number);
      rows=[{total:5,histogram,considered_digest:digest(histogram),examples:[3,0,1].slice(0,values.at(-1) as number).map((match_mask,index)=>({
        member_ref:digest(`member-${index}`),source_record_digest:digest(`record-${index}`),match_mask,
        text_clean:"Football campaign https://example.test @user",language:"en",market:"MX",scope:"primary_brand",published_month:"2026-05"}))}];
    }else if(q.startsWith("INSERT INTO signal_topic_rule_cohort_trial_receipts")){
      const row={id:values[0],workspace_id:values[1],cohort_id:values[2],actor_user_id:values[3],key:values[4],request:JSON.parse(values[5] as string),
        request_digest:values[6],result:JSON.parse(values[7] as string),result_digest:values[8],created_at:"2026-09-06T10:00:01Z"};state.trials.push(row);rows=[row];
    }else throw new Error(`Unhandled query: ${q.slice(0,120)}`);
    return{rows,rowCount:rows.length};}} as SignalTopicContractDraftClient;
  const selected=()=>state.sources.map((source,index)=>({candidate_key:source.candidate_key,draft_id:state.drafts[index]!.id,
    expected_candidate_revision:source.revision,expected_candidate_state_token:source.state_token,
    expected_draft_revision:state.drafts[index]!.revision,expected_draft_digest:state.drafts[index]!.draft_digest}));
  return{state,queries,client,selected};
}
function createArgs(f:ReturnType<typeof fixture>){return{...context,client:f.client,sources:f.selected(),
  expected_cohort_revision:0,expected_cohort_digest:null,idempotency_key:"cohort-proof:initial"};}
async function trialArgs(f:ReturnType<typeof fixture>){const row=await create(createArgs(f));return{...context,client:f.client,
  expected_cohort_revision:row.cohort_revision,expected_cohort_digest:row.cohort_digest,idempotency_key:"cohort-trial:initial"};}
test("one draft catalog uses global profile version independently from family revision and preserves full definitions",async()=>{
  const f=fixture(),args=createArgs(f),first=await create({...args,sources:[...args.sources].reverse()});
  assert.equal(first.cohort_revision,1);assert.equal(first.profile_version,9);assert.equal(first.cohort_digest,digest(first.binding));
  assert.deepEqual(first.binding.rules.map(rule=>rule.candidate_key),["topic.alpha","topic.beta"]);
  assert.equal(f.state.terms.length,2);assert.ok(f.state.terms.every(term=>(term[3] as string).length===1500));
  const locks=f.queries.filter(({sql})=>sql.startsWith("SELECT candidate.id FROM"));assert.deepEqual(locks.map(row=>row.values[2]),["topic.alpha","topic.beta"]);
  const all=f.queries.map(row=>row.sql).join("\n");assert.doesNotMatch(all,/\bBEGIN\b|\bCOMMIT\b|LIMIT 100|INSERT INTO signal_classification|record_tags/u);
  const second=await create({...args,expected_cohort_revision:1,expected_cohort_digest:first.cohort_digest,idempotency_key:"cohort-proof:second"});
  assert.equal(second.cohort_revision,2);assert.equal(second.profile_version,10);assert.notEqual(second.cohort_digest,first.cohort_digest);
});
test("create replay does not consume versions; exact actor and sorted payload own the key",async()=>{
  const f=fixture(),args=createArgs(f),first=await create(args),replay=await create({...args,sources:[...args.sources].reverse()});
  assert.equal(first.cohort_id,replay.cohort_id);assert.equal(replay.idempotent_replay,true);assert.equal(f.state.globalVersion,9);
  await assert.rejects(create({...args,actor:{...context.actor,id:uuid(8)}}),{code:"topic_rule_cohort_idempotency_conflict"});
  await assert.rejects(create({...args,expected_cohort_revision:1,expected_cohort_digest:first.cohort_digest}),{code:"topic_rule_cohort_idempotency_conflict"});
  assert.equal(f.state.cohorts.length,1);
});
test("current source, latest draft and predecessor CAS reject before allocating another profile",async()=>{
  for(const mutation of ["candidate","draft","digest","waiting"]){const f=fixture(),args=createArgs(f);
    if(mutation==="candidate")f.state.sources[0]!.revision++;
    if(mutation==="draft")f.state.drafts[0]!.revision++;
    if(mutation==="digest")f.state.drafts[0]!.source_version_digest=digest("changed");
    if(mutation==="waiting")f.state.sourceDuringLock=true;
    await assert.rejects(create(args),{code:mutation==="candidate"||mutation==="waiting"?"topic_rule_cohort_source_stale":"topic_rule_cohort_draft_stale"});
    assert.equal(f.state.globalVersion,8);assert.equal(f.state.cohorts.length,0);
  }
  const f=fixture(),args=createArgs(f);await create(args);
  await assert.rejects(create({...args,idempotency_key:"cohort-proof:stale"}),{code:"topic_rule_cohort_stale"});
  assert.equal(f.state.globalVersion,9);
});
test("authority, run scope, selection closure and outer transaction are checked",async()=>{
  const f=fixture(),args=createArgs(f);f.state.authorized=false;
  await assert.rejects(create(args),{code:"topic_rule_draft_forbidden"});f.state.authorized=true;
  for(const extra of [{workspace_id:uuid(90)},{run_key:"foreign-run"}])await assert.rejects(create({...args,...extra}),{code:"topic_rule_cohort_run_not_found"});
  await assert.rejects(create({...args,sources:[args.sources[0]!,args.sources[0]!]}),{code:"topic_rule_cohort_selection_duplicate"});
  await assert.rejects(create({...args,sources:[{...args.sources[0]!,sql:"select"},args.sources[1]!] as any}),{code:"topic_rule_cohort_selection_invalid"});
  f.state.active=false;await assert.rejects(create(args),{code:"topic_rule_draft_transaction_required"});
});
test("joint counts count a membership once, preserve pairs, use one cap and balanced total diagnostics",async()=>{
  const f=fixture(),args=await trialArgs(f),result=await trial(args);
  assert.deepEqual(result.counts,{total:5,considered:5,not_tested:0,unavailable:1,excluded_by_all_filters:1,abstained:1,single_match:1,multiple_match:1,covered:2});
  assert.deepEqual(result.per_rule,[{candidate_key:"topic.alpha",matched:2,exclusive:1,shared:1},{candidate_key:"topic.beta",matched:1,exclusive:0,shared:1}]);
  assert.equal(result.pairs[0]!.intersection,1);assert.equal(result.examples.length,3);
  assert.deepEqual(result.examples.map(row=>row.outcome),["multiple_match","abstained","single_match"]);
  assert.ok(result.examples.every(row=>!row.excerpt.includes("https://")&&!row.excerpt.includes("@user")));
  const query=f.queries.find(({sql})=>sql.startsWith("WITH population"))!;
  assert.deepEqual(query.values.slice(0,3),[context.workspace_id,snap.snapshot_id,25000]);
  assert.match(query.sql,/selected AS MATERIALIZED\(SELECT \* FROM population ORDER BY assignment_index,member_ref LIMIT \$3/u);
  assert.match(query.sql,/CASE WHEN available THEN \(/u);assert.match(query.sql,/ELSE 0 END match_mask/u);
  assert.equal((query.sql.match(/to_tsvector\(/gu)??[]).length,1);assert.match(query.sql,/eligible\.search_vector/u);
  assert.match(query.sql,/to_tsvector\('simple',CASE WHEN available THEN COALESCE\(text_clean,''\) ELSE '' END\) search_vector/u);
  assert.match(query.sql,/row_number\(\) OVER\(PARTITION BY category ORDER BY assignment_index,member_ref\)/u);
  assert.match(query.sql,/ORDER BY category_index,category,assignment_index,member_ref LIMIT \$6/u);
  assert.doesNotMatch(query.sql,/source_cluster_keys/u);
});
test("bounded denominator is explicit, invalid limits and timeout do not append receipts",async()=>{
  const f=fixture(),args=await trialArgs(f),bounded=await trial({...args,max_memberships:2,example_limit:0});
  assert.equal(bounded.counts.considered,2);assert.equal(bounded.counts.not_tested,3);assert.deepEqual(bounded.examples,[]);
  for(const extra of [{max_memberships:50001},{example_limit:11},{timeout_ms:15001}])await assert.rejects(trial({...args,...extra}),{code:"topic_rule_cohort_limits_invalid"});
  f.state.failMeasurement=true;await assert.rejects(trial({...args,idempotency_key:"cohort-trial:timeout"}),{code:"57014"});
  assert.equal(f.state.trials.length,1);assert.match(f.queries.at(-2)!.sql,/ROLLBACK TO SAVEPOINT/u);
});
test("replay and GET project current rights but never remeasure historical counts",async()=>{
  const f=fixture(),args=await trialArgs(f),first=await trial(args),stored=structuredClone(f.state.trials);
  f.state.examplesAvailable=false;f.state.sources[0]!.version_digest=digest("changed");
  const start=f.queries.length,loaded=await loadTrial({...context,queryable:f.client});assert.ok(loaded);
  assert.equal(loaded.trial_id,first.trial_id);assert.equal(loaded.is_stale,true);assert.deepEqual(loaded.examples,[]);
  assert.deepEqual(loaded.example_availability,{stored:3,available:0,unavailable:3});
  assert.deepEqual(loaded.counts,first.counts);assert.deepEqual(f.state.trials,stored);
  assert.doesNotMatch(f.queries.slice(start).map(q=>q.sql).join("\n"),/\b(?:INSERT|UPDATE|DELETE|SAVEPOINT|COMMIT|BEGIN|set_config|pg_advisory|tsquery|to_tsvector)\b/u);
  const replay=await trial(args);assert.equal(replay.trial_id,first.trial_id);assert.equal(replay.idempotent_replay,true);
  assert.equal(f.state.measurements,1);assert.equal(replay.examples.length,0);
});
test("latest untested cohort has no inherited trial and profile graph drift becomes stale",async()=>{
  const f=fixture(),read={...context,queryable:f.client};assert.equal(await load(read),null);assert.equal(await loadTrial(read),null);
  const args=await trialArgs(f),first=await trial(args);f.state.profileChanged=true;
  assert.deepEqual((await load(read))!.stale_reasons,["profile_changed"]);
  await assert.rejects(trial({...args,idempotency_key:"cohort-trial:graph"}),{code:"topic_rule_cohort_source_stale"});
  assert.equal((await loadTrial(read))!.is_stale,true);f.state.profileChanged=false;
  await create({...createArgs(f),expected_cohort_revision:args.expected_cohort_revision,
    expected_cohort_digest:args.expected_cohort_digest,idempotency_key:"cohort-proof:untested"});
  assert.equal(await loadTrial(read),null);const replay=await trial(args);
  assert.equal(replay.trial_id,first.trial_id);assert.equal(replay.is_latest_cohort,false);
});
test("migration closes appended projections and retains existing activation contracts",()=>{
  const sql=readFileSync(new URL("./migrations/0124_signal_topic_rule_cohorts.sql",import.meta.url),"utf8");
  assert.equal((sql.match(/CREATE TABLE /gu)??[]).length,2);
  for(const message of ["pair intersection is invalid","rule plan is invalid","example matched keys are invalid","example outcome is invalid"])
    assert.ok(sql.includes(message));
  assert.match(sql,/BEFORE UPDATE OR DELETE/);assert.match(sql,/signal_topic_rule_cohort_profile_digest_v1/);
  assert.match(sql,/IS DISTINCT FROM \(CASE jsonb_array_length\(item->'matched_candidate_keys'\)[\s\S]+END\) THEN/u);
  for(const alias of ["profile","taxonomy","rules","model","term"])assert.ok(sql.includes(`to_jsonb(${alias}.*)`));
  assert.doesNotMatch(sql,/to_jsonb\(rules\)/u);
  assert.doesNotMatch(sql,/DROP |ALTER TABLE |DISABLE TRIGGER|INSERT INTO signal_classification|record_tags/);
});
