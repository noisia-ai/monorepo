import assert from "node:assert/strict";
import test from "node:test";

import { loadSignalTopicEvaluationV2CandidateDetail } from "./signal-topic-evaluation-v2";

const digest=`sha256:${"a".repeat(64)}`;
const otherDigest=`sha256:${"b".repeat(64)}`;
const scope={workspace_id:"00000000-0000-4000-8000-000000000001",
  run_key:"run.topic-eval",candidate_key:"topic.echo-deals"};
const actor={id:"00000000-0000-4000-8000-000000000002",user_type:"noisia_internal" as const};
const candidate={run_key:scope.run_key,candidate_key:scope.candidate_key,title:"Current title",
  description:"Current description",inclusion:["Echo"],exclusion:[],review_state:"pending",
  revision:2,version_digest:digest,state_token:digest,undo_target_revision:1,
  source_cluster_keys:["cluster.echo"],evidence_count:1,rank:1,
  updated_at:"2026-09-06T08:00:00+00:00",candidate_digest:digest,
  base_payload:{candidate_key:scope.candidate_key},base_payload_digest:digest,
  created_at:"2026-09-05T16:00:00+00:00"};
const savedProposal={display_name:"Suggested title",description:"Suggested description",
  rationale:"Bounded evidence supports this wording",evidence_refs:[digest],
  related_candidates:[{candidate_key:"topic.echo-news",title:"Edited related title"}],
  recommendation:"consider_merge",proposal_digest:otherDigest,
  created_at:"2026-09-06T03:10:00-06:00",source_revision:2,source_version_digest:digest};

function readerFixture(options:{proposal?:Record<string,unknown>|null;
  availability?:{proposals_available:boolean;sessions_available:boolean;archives_available?:boolean;imports_available?:boolean};
  origin?:Record<string,unknown>|null;
  failAt?:"availability"|"proposal";failure?:Error}={}){
  const queries:Array<{sql:string;values:unknown[]}> = [];
  const queryable={async query(sql:string,values:unknown[]=[]){
    queries.push({sql,values});
    assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|CALL)\b/iu);
    let rows:Record<string,unknown>[];
    if(sql.startsWith("SELECT run.run_key")){
      rows=JSON.stringify(values)===JSON.stringify(Object.values(scope))?[candidate]:[];
    }else if(sql.startsWith("SELECT evidence.evidence_ref")){
      rows=[{evidence_ref:digest,explanation_digest:digest,
        retrieval_operation:"representative_mentions",retrieval_index:0}];
    }else if(sql.includes("to_regclass")&&!sql.includes("sessions_available")){
      rows=[{imports_available:!!options.origin}];
    }else if(sql.startsWith("SELECT receipt.artifact")){
      rows=options.origin?[options.origin]:[];
    }else if(sql.includes("to_regclass")){
      if(options.failAt==="availability")throw options.failure;
      rows=[options.availability??{proposals_available:true,sessions_available:true}];
    }else if(sql.startsWith("WITH proposal_sources")){
      if(options.failAt==="proposal")throw options.failure;
      rows=options.proposal===null?[]:[options.proposal??savedProposal];
    }else throw new Error("unexpected_reader_query");
    return{rows,rowCount:rows.length};
  }};
  return{queries,queryable:queryable as Parameters<typeof loadSignalTopicEvaluationV2CandidateDetail>[0]["queryable"]};
}

async function read(fixture:ReturnType<typeof readerFixture>,overrides:Partial<typeof scope>={}){
  return loadSignalTopicEvaluationV2CandidateDetail({queryable:fixture.queryable,...scope,...overrides,actor});
}

test("candidate detail exposes one persisted proposal through an explicit safe projection",async()=>{
  const fixture=readerFixture({proposal:{...savedProposal,session_id:"private-session",
    actor_user_id:"private-actor",raw_provider_response:"private-response",expires_at:"2000-01-01"}});
  const result=await read(fixture);
  assert.deepEqual(result.refinement,{status:"available",proposal:{
    display_name:savedProposal.display_name,description:savedProposal.description,rationale:savedProposal.rationale,
    evidence_refs:[digest],related_candidates:savedProposal.related_candidates,recommendation:"consider_merge",
    proposal_digest:otherDigest,created_at:"2026-09-06T09:10:00.000Z",source_revision:2,is_stale:false}});
  assert.equal(result.candidate.title,candidate.title,"reading a draft never replaces editorial fields");
  assert.equal(result.topic_adoption,false);assert.equal(result.publication,false);assert.equal(result.serving,false);
  assert.doesNotMatch(JSON.stringify(result),/private-session|private-actor|private-response|source_version_digest/u);
  assert.equal(fixture.queries.length,5);
});

test("an installed refinement plane without a saved proposal returns none",async()=>{
  const fixture=readerFixture({proposal:null});
  assert.deepEqual((await read(fixture)).refinement,{status:"none",proposal:null});
  assert.equal(fixture.queries.length,5);
});

test("both proposal and session tables must exist before reading refinement storage",async()=>{
  for(const availability of[
    {proposals_available:false,sessions_available:false},
    {proposals_available:false,sessions_available:true},
    {proposals_available:true,sessions_available:false}
  ]){
    const fixture=readerFixture({availability});
    assert.deepEqual((await read(fixture)).refinement,{status:"unavailable",proposal:null});
    assert.equal(fixture.queries.length,4);
    const sql=fixture.queries[2]!.sql;
    assert.match(sql,/to_regclass\('public\.signal_topic_evaluation_v2_candidate_refinement_proposals'\)/u);
    assert.match(sql,/to_regclass\('public\.signal_topic_evaluation_v2_candidate_refinement_sessions'\)/u);
  }
});

test("expired navigation sessions do not hide historical proposals or open new sessions",async()=>{
  const fixture=readerFixture({proposal:{...savedProposal,expires_at:"2000-01-01T00:00:00Z"}});
  assert.equal((await read(fixture)).refinement.status,"available");
  const sql=fixture.queries[3]!.sql;
  assert.doesNotMatch(sql,/expires_at|clock_timestamp|now\(|navigation_traces|flight_dispatch|FOR UPDATE/iu);
  assert.deepEqual(fixture.queries[3]!.values,Object.values(scope));
});

test("proposal staleness compares both source revision and exact source version digest",async()=>{
  for(const[source_revision,source_version_digest,is_stale]of[
    [2,digest,false],[1,digest,true],[2,otherDigest,true],[1,otherDigest,true]
  ] as const){
    const fixture=readerFixture({proposal:{...savedProposal,source_revision,source_version_digest}});
    const result=await read(fixture);
    assert.equal(result.refinement.status,"available");
    if(result.refinement.status==="available")assert.equal(result.refinement.proposal.is_stale,is_stale);
  }
});

test("missing or cross-scope candidates stop before schema or proposal reads",async()=>{
  for(const override of[
    {workspace_id:"00000000-0000-4000-8000-000000000099"},
    {run_key:"run.other"},{candidate_key:"topic.other"}
  ]){
    const fixture=readerFixture();
    await assert.rejects(read(fixture,override),{code:"topic_evaluation_v2_candidate_not_found",status:404});
    assert.equal(fixture.queries.length,1);
  }
  const fixture=readerFixture();
  await assert.rejects(loadSignalTopicEvaluationV2CandidateDetail({...scope,queryable:fixture.queryable,
    actor:{...actor,user_type:"client"} as never}),{status:403});
  assert.equal(fixture.queries.length,0);
});

test("proposal and related-candidate SQL retain exact scope, eligibility and current editorial titles",async()=>{
  const fixture=readerFixture();await read(fixture);
  const sql=fixture.queries[3]!.sql;
  assert.deepEqual(fixture.queries[3]!.values,Object.values(scope));
  for(const fragment of[
    "session.workspace_id=proposal.workspace_id","session.run_id=proposal.run_id",
    "session.snapshot_id=proposal.snapshot_id","session.candidate_id=proposal.candidate_id",
    "candidate.workspace_id=proposal.workspace_id","candidate.run_id=proposal.run_id",
    "run.workspace_id=candidate.workspace_id","run.snapshot_id=proposal.snapshot_id",
    "run.status='completed'","candidate.workspace_id=$1::uuid AND run.run_key=$2 AND candidate.candidate_key=$3",
    "candidate.status='pending' AND NOT candidate.adopted AND NOT candidate.published AND NOT candidate.serving",
    "candidate.id<>proposal.candidate_id","COALESCE(editorial.title,base.payload->>'title') title",
    "COALESCE(editorial.review_state,'pending')='pending'"
  ])assert.ok(sql.includes(fragment),`missing reader predicate: ${fragment}`);
  assert.doesNotMatch(sql,/SELECT\s+(?:\w+\.)?\*/iu);
});

test("reader query bounds latest proposal, evidence references and related candidate projections",async()=>{
  const fixture=readerFixture({proposal:{...savedProposal,
    evidence_refs:Array.from({length:48},()=>digest),related_candidates:Array.from({length:8},(_,index)=>({
      candidate_key:`topic.related-${index}`,title:`Related ${index}`}))}});
  const result=await read(fixture);
  assert.equal(result.refinement.status,"available");
  if(result.refinement.status==="available"){
    assert.equal(result.refinement.proposal.evidence_refs.length,48);
    assert.equal(result.refinement.proposal.related_candidates.length,8);
  }
  const sql=fixture.queries[3]!.sql;
  assert.match(sql,/ORDER BY proposal\.created_at DESC,proposal\.id DESC LIMIT 1/u);
  assert.match(sql,/ORDER BY ordinal LIMIT 48/u);
  assert.match(sql,/ORDER BY keys\.ordinal LIMIT 8/u);
  assert.match(sql,/ORDER BY revision\.revision DESC LIMIT 1/u);
});

test("SQL and permission errors are propagated, never reported as unavailable",async()=>{
  for(const failAt of["availability","proposal"] as const){
    for(const code of["42501","42P01","08006"]){
      const failure=Object.assign(new Error("database_operation_failed"),{code});
      const fixture=readerFixture({failAt,failure});
      await assert.rejects(read(fixture),(error)=>error===failure);
    }
  }
});

test("imported refinement reads without live-session tables and retains imported composite scope",async()=>{
  const fixture=readerFixture({availability:{proposals_available:false,sessions_available:false,
    archives_available:true,imports_available:true}});
  assert.equal((await read(fixture)).refinement.status,"available");
  const sql=fixture.queries[3]!.sql;
  assert.doesNotMatch(sql,/FROM public\.signal_topic_evaluation_v2_candidate_refinement_proposals|expires_at/u);
  for(const clause of["receipt.id=proposal.import_receipt_id","receipt.workspace_id=proposal.workspace_id",
    "receipt.run_id=proposal.run_id","receipt.snapshot_id=proposal.snapshot_id",
    "run.import_receipt_id=receipt.id AND run.origin='imported_result'",
    "proposal.source_proposal_digest proposal_digest","proposal.source_created_at created_at"]){
    assert.ok(sql.includes(clause),clause);
  }
});

test("mixed installation selects latest source proposal timestamp, not latest import time",async()=>{
  const fixture=readerFixture({availability:{proposals_available:true,sessions_available:true,
    archives_available:true,imports_available:true}});
  await read(fixture);
  const sql=fixture.queries[3]!.sql;
  assert.match(sql,/UNION ALL/u);
  assert.match(sql,/proposal\.source_created_at created_at/u);
  assert.match(sql,/ORDER BY proposal\.created_at DESC,proposal\.id DESC LIMIT 1/u);
});

test("origin metadata is allowlisted historical telemetry and scoped to the completed imported run",async()=>{
  const fixture=readerFixture({origin:{source_run_key:"source.lab-run",source_output_digest:digest,
    source_completed_at:"2026-09-05T20:00:00+00:00",imported_at:"2026-09-06T08:00:00+00:00",
    source_provider_calls:"12",source_cost_micro_usd:"396885",artifact:"private",actor_user_id:"private"}});
  const result=await read(fixture);
  assert.deepEqual(result.result_origin,{kind:"imported_result",source_run_key:"source.lab-run",
    source_output_digest:digest,source_completed_at:"2026-09-05T20:00:00.000Z",
    imported_at:"2026-09-06T08:00:00.000Z",source_provider_calls:12,source_cost_micro_usd:396885});
  assert.doesNotMatch(JSON.stringify(result.result_origin),/private|actor|artifact/u);
  const query=fixture.queries.at(-1)!;
  assert.deepEqual(query.values,[scope.workspace_id,scope.run_key]);
  for(const clause of["run.import_receipt_id=receipt.id","run.workspace_id=receipt.workspace_id",
    "run.snapshot_id=receipt.snapshot_id","run.status='completed'","run.origin='imported_result'"]){
    assert.ok(query.sql.includes(clause),clause);
  }
});
