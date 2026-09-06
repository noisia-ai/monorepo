import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { signalTopicEvaluationDigestV2 as digest, SIGNAL_TOPIC_EVALUATION_V2_OUTPUT } from "@noisia/query-engine";
import { importSignalTopicEvaluationV2HistoricalResult, SIGNAL_TOPIC_EVALUATION_V2_RESULT_IMPORT_CONTRACT,
  validateSignalTopicEvaluationV2HistoricalResultArtifact, type SignalTopicEvaluationV2HistoricalResultArtifact }
  from "./signal-topic-evaluation-v2-result-import";

const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const created="2026-09-05T10:00:00.123456Z";
const scope={workspace_id:uuid(900),actor:{id:uuid(901),user_type:"noisia_internal" as const},
  idempotency_key:"result-import-test-v1"};

function fixture():SignalTopicEvaluationV2HistoricalResultArtifact{
  const snapshot={snapshot_digest:digest("snapshot"),rights_digest:digest("rights"),
    semantic_context_authority_digest:digest("semantic"),artifact_binding_digest:digest("artifact"),
    membership_binding_digest:digest("members")};
  const candidates=Array.from({length:10},(_,i)=>({id:uuid(i+1),candidate_key:`candidate.${i+1}`,
    candidate_digest:"",source_cluster_keys:[`cluster.${i+1}`],created_at:created}));
  const retrievals=Array.from({length:11},(_,i)=>({id:uuid(i+101),retrieval_index:i,
    operation:i===0?"evaluation_brief":"representative_mentions",tool_input_digest:digest({input:i}),
    result_digest:digest({result:i}),result_bytes:100,created_at:created}));
  const retrieved=candidates.flatMap((_,i)=>Array.from({length:3},(_,j)=>({retrieval_id:retrievals[i+1]!.id,
    member_ref:`member.${i}.${j}`,evidence_ref:digest({snapshot:snapshot.snapshot_digest,member:i*3+j})})));
  const revisions=candidates.map((c,i)=>{
    const payload={candidate_key:c.candidate_key,title:`Useful candidate ${i+1}`,description:"An evidence-linked draft topic.",
      inclusion:["Specific inclusion"],exclusion:["Specific exclusion"],explanation:"Three independently linked mentions.",
      source_cluster_keys:c.source_cluster_keys,evidence_refs:retrieved.slice(i*3,i*3+3).map(e=>e.evidence_ref),status:"pending" as const};
    c.candidate_digest=digest(payload);
    return{id:uuid(i+201),candidate_id:c.id,payload,payload_digest:c.candidate_digest,created_at:created};
  });
  const rankings=candidates.map((c,i)=>{const value={rank:i+1,candidate_key:c.candidate_key,ranking_reason:"Supported by relevant evidence."};
    return{candidate_id:c.id,rank:i+1,ranking_reason:value.ranking_reason,ranking_digest:digest(value),created_at:created};});
  const output={contract_version:SIGNAL_TOPIC_EVALUATION_V2_OUTPUT,candidates:revisions.map(r=>r.payload),
    ranking:rankings.map((r,i)=>({rank:r.rank,candidate_key:candidates[i]!.candidate_key,ranking_reason:r.ranking_reason}))};
  const turns=Array.from({length:12},(_,i)=>({turn_index:i,turn_kind:i===11?"final" as const:"tool" as const,
    input_digest:digest({turn:i,input:true}),output_digest:i===11?digest(output):digest({turn:i,output:true}),
    input_tokens:100,output_tokens:10,created_at:created}));
  const card={contract_version:"signal-topic-evaluation-full-evidence-v2",execution_enabled:true,provider_calls_allowed:12};
  const refinement={candidate_id:candidates[0]!.id,source_session_id:uuid(501),source_session_digest:digest("session"),
    source_proposal_id:uuid(502),source_proposal_digest:"",source_revision:1,
    source_version_digest:revisions[0]!.payload_digest,source_brand_os_authority_digest:snapshot.semantic_context_authority_digest,
    session_created_at:"2026-09-06T10:00:00.123456Z",session_expires_at:"2026-09-06T10:15:00.123456Z",
    created_at:"2026-09-06T10:02:00.123456Z",display_name:"More specific draft",description:"Refined evidence-backed description.",
    rationale:"The citations support a narrower interpretation.",evidence_refs:[retrieved[0]!.evidence_ref],
    related_candidate_keys:[candidates[1]!.candidate_key],recommendation:"consider_merge" as const,
    evidence:[{member_ref:retrieved[0]!.member_ref,evidence_ref:retrieved[0]!.evidence_ref}]};
  refinement.source_proposal_digest=digest({contract_version:"signal-topic-candidate-refinement-v1",
    session_id:refinement.source_session_id,session_digest:refinement.source_session_digest,display_name:refinement.display_name,
    description:refinement.description,evidence_refs:refinement.evidence_refs,related_candidate_keys:refinement.related_candidate_keys,
    recommendation:refinement.recommendation,rationale:refinement.rationale});
  return{contract_version:SIGNAL_TOPIC_EVALUATION_V2_RESULT_IMPORT_CONTRACT,snapshot,
    source_run:{id:uuid(700),run_key:"topic-v2-lab-run-source",flight_card:card,flight_card_digest:digest(card),
      provider_call_count:12,reserved_micro_usd:"2100000",settled_micro_usd:"396885",model_turn_count:12,tool_call_count:11,
      total_input_tokens:1200,total_output_tokens:120,total_tool_result_bytes:1100,output_digest:digest(output),
      created_at:created,completed_at:"2026-09-05T10:05:00.123456Z"},
    model_turns:turns,retrievals,retrieval_evidence:retrieved,candidates,candidate_revisions:revisions,
    candidate_evidence:retrieved.map((e,i)=>({candidate_id:candidates[Math.floor(i/3)]!.id,retrieval_id:e.retrieval_id,
      evidence_ref:e.evidence_ref,explanation_digest:digest(revisions[Math.floor(i/3)]!.payload.explanation)})),rankings,refinement};
}

type Prior={id:string;run_id:string;artifact_digest:string;actor_user_id:string;idempotency_key?:string};
function client(options:{prior?:Prior;priors?:Prior[];
  snapshot?:boolean;authorized?:boolean;failAt?:string}={}){
  const queries:{sql:string;values:unknown[]|undefined}[]=[];
  return{queries,async query<T=Record<string,unknown>>(sql:string,values?:unknown[]):Promise<{rows:T[];rowCount:number|null}>{
    queries.push({sql,values});
    if(options.failAt&&sql.includes(options.failAt))throw Object.assign(new Error("sql_test_failure"),{code:"42501"});
    let rows:unknown[]=[];
    if(sql.includes("SELECT EXISTS(SELECT 1 FROM users"))rows=[{allowed:options.authorized!==false}];
    else if(sql.includes("artifact_digest=$3")){
      const prior=options.priors?.find(p=>p.idempotency_key===values?.[1])
        ??options.priors?.find(p=>p.artifact_digest===values?.[2])??options.prior;
      rows=prior?[prior]:[];
    }
    else if(sql.includes("FROM signal_topic_evaluation_v2_snapshots"))rows=options.snapshot===false?[]:[{id:uuid(902)}];
    return{rows:rows as T[],rowCount:rows.length};
  }};
}
function args(artifact=fixture(),database=client()){
  return{...scope,client:database,artifact,expected_artifact_digest:digest(artifact)};
}

test("portable artifact is complete, bounded and preserves historical microsecond timestamps",()=>{
  const artifact=fixture();assert.equal(validateSignalTopicEvaluationV2HistoricalResultArtifact(artifact),artifact);
  assert.equal(artifact.candidates.length,10);assert.equal(artifact.candidate_evidence.length,30);
  assert.equal(artifact.source_run.created_at,created);
});

test("strict portable shape rejects extra raw fields and oversized packages",()=>{
  assert.throws(()=>validateSignalTopicEvaluationV2HistoricalResultArtifact({...fixture(),raw_mentions:["not allowed"]}));
  const artifact=fixture();Object.assign(artifact.retrievals[0]!,{prompt:"not allowed"});
  assert.throws(()=>validateSignalTopicEvaluationV2HistoricalResultArtifact(artifact));
  assert.throws(()=>validateSignalTopicEvaluationV2HistoricalResultArtifact({padding:"x".repeat(524289)}),/artifact_too_large/);
});

test("historical source run keys satisfy the same run and product-origin DTO contract",()=>{
  for(const runKey of ["INVALID KEY","UPPERCASE-RUN", "short", "run/invalid", "a".repeat(201)]){
    const artifact=fixture();artifact.source_run.run_key=runKey;
    assert.throws(()=>validateSignalTopicEvaluationV2HistoricalResultArtifact(artifact));
  }
});

test("cohort limits, contiguous indexes and uniqueness are mandatory",()=>{
  for(const mutate of [
    (a:ReturnType<typeof fixture>)=>a.candidates.pop(),
    (a:ReturnType<typeof fixture>)=>a.candidate_evidence.pop(),
    (a:ReturnType<typeof fixture>)=>{a.model_turns[1]!.turn_index=0;},
    (a:ReturnType<typeof fixture>)=>{a.retrievals[1]!.id=a.retrievals[0]!.id;},
    (a:ReturnType<typeof fixture>)=>{a.rankings[1]!.rank=1;},
    (a:ReturnType<typeof fixture>)=>{a.source_run.total_input_tokens++;}
  ]){const a=fixture();mutate(a);assert.throws(()=>validateSignalTopicEvaluationV2HistoricalResultArtifact(a));}
});

test("candidate, explanation, ranking and final-turn digests cannot drift",()=>{
  for(const mutate of [
    (a:ReturnType<typeof fixture>)=>{a.candidate_revisions[0]!.payload.title="Forged";},
    (a:ReturnType<typeof fixture>)=>{a.candidate_evidence[0]!.explanation_digest=digest("forged");},
    (a:ReturnType<typeof fixture>)=>{a.candidate_evidence[0]!.retrieval_id=uuid(999);},
    (a:ReturnType<typeof fixture>)=>{a.rankings[0]!.ranking_reason="Forged";},
    (a:ReturnType<typeof fixture>)=>{a.model_turns[11]!.output_digest=digest("forged");},
    (a:ReturnType<typeof fixture>)=>{a.candidate_revisions.reverse();},
    (a:ReturnType<typeof fixture>)=>{a.source_run.flight_card.execution_enabled=false;}
  ]){const a=fixture();mutate(a);assert.throws(()=>validateSignalTopicEvaluationV2HistoricalResultArtifact(a));}
});

test("expired historical refinement is readable but original expiry, revision and evidence remain binding",()=>{
  assert.doesNotThrow(()=>validateSignalTopicEvaluationV2HistoricalResultArtifact(fixture()));
  for(const mutate of [
    (a:ReturnType<typeof fixture>)=>{a.refinement.created_at="2026-09-06T10:16:00Z";},
    (a:ReturnType<typeof fixture>)=>{a.refinement.source_revision=2;},
    (a:ReturnType<typeof fixture>)=>{a.refinement.source_version_digest=digest("stale");},
    (a:ReturnType<typeof fixture>)=>{a.refinement.source_brand_os_authority_digest=digest("foreign");},
    (a:ReturnType<typeof fixture>)=>{a.refinement.evidence[0]!.evidence_ref=digest("foreign");},
    (a:ReturnType<typeof fixture>)=>{a.refinement.related_candidate_keys=[a.candidates[0]!.candidate_key];},
    (a:ReturnType<typeof fixture>)=>{a.refinement.source_proposal_digest=digest("forged");}
  ]){const a=fixture();mutate(a);assert.throws(()=>validateSignalTopicEvaluationV2HistoricalResultArtifact(a));}
});

test("wrong expected artifact digest fails before SQL",async()=>{
  const database=client();await assert.rejects(importSignalTopicEvaluationV2HistoricalResult({...args(fixture(),database),
    expected_artifact_digest:digest("wrong")}),/artifact_digest_mismatch/);assert.equal(database.queries.length,0);
});

test("import remaps source IDs, appends complete rows, and cannot authorize or charge a flight",async()=>{
  const artifact=fixture(),database=client();const result=await importSignalTopicEvaluationV2HistoricalResult(args(artifact,database));
  assert.notEqual(result.run_id,artifact.source_run.id);assert.match(result.run_key,/^topic-v2-import-/);
  assert.equal(result.replayed,false);
  const inserts=database.queries.filter(q=>q.sql.startsWith("INSERT INTO"));
  assert.equal(inserts.length,116); // receipt + run + 11 retrievals + 30 evidence + 12 turns + 10 + 10 + 30 + 10 + archive
  const run=inserts.find(q=>q.sql.includes("INSERT INTO signal_topic_evaluation_v2_runs("))!;
  assert.match(run.sql,/'completed',false,0,12,11/);assert.match(run.sql,/,0,0,\$12/);
  const card=JSON.parse(run.values![6] as string);assert.equal(card.execution_enabled,false);
  assert.equal(card.provider_calls_allowed,0);assert.equal(card.origin,"imported_result");
  for(const q of inserts)assert.doesNotMatch(q.sql,/execution_authorizations|execution_outbox|refinement_sessions|flight_dispatch/);
  assert.equal(database.queries.at(-1)!.sql,"RELEASE SAVEPOINT topic_result_import_v1");
  assert(!database.queries.some(q=>/^COMMIT|^BEGIN/u.test(q.sql)));
  const duplicate=await importSignalTopicEvaluationV2HistoricalResult(args(artifact,client()));
  assert.equal(duplicate.run_id,result.run_id,"mapping is deterministic");
});

test("idempotent repeat revalidates its cohort without appending or copying historical spend",async()=>{
  const artifact=fixture(),first=await importSignalTopicEvaluationV2HistoricalResult(args(artifact));
  const database=client({prior:{id:first.import_receipt_id,run_id:first.run_id,artifact_digest:digest(artifact),actor_user_id:scope.actor.id}});
  const result=await importSignalTopicEvaluationV2HistoricalResult(args(artifact,database));
  assert.equal(result.replayed,true);assert.equal(result.run_id,first.run_id);
  assert(!database.queries.some(q=>q.sql.startsWith("INSERT")));
  assert(database.queries.some(q=>q.sql.includes("assert_result_import_v1")));
});

test("same-key divergence, foreign actor and missing snapshot fail atomically",async()=>{
  const artifact=fixture();
  for(const database of [client({authorized:false}),client({snapshot:false}),client({prior:{id:uuid(801),
    run_id:uuid(802),artifact_digest:digest("different"),actor_user_id:scope.actor.id}}),client({prior:{id:uuid(801),
    run_id:uuid(802),artifact_digest:digest(artifact),actor_user_id:uuid(999)}})]){
    await assert.rejects(importSignalTopicEvaluationV2HistoricalResult(args(artifact,database)));
    assert(!database.queries.some(q=>q.sql.startsWith("INSERT")));
    assert.equal(database.queries.at(-2)!.sql,"ROLLBACK TO SAVEPOINT topic_result_import_v1");
  }
});

test("an older duplicate artifact cannot hide a newer receipt bound to the requested idempotency key",async()=>{
  const artifact=fixture(),database=client({priors:[
    {id:uuid(801),run_id:uuid(802),idempotency_key:"other-key-v1",artifact_digest:digest(artifact),actor_user_id:scope.actor.id},
    {id:uuid(803),run_id:uuid(804),idempotency_key:scope.idempotency_key,artifact_digest:digest("different"),actor_user_id:scope.actor.id}
  ]});
  await assert.rejects(importSignalTopicEvaluationV2HistoricalResult(args(artifact,database)),/idempotency_conflict/);
  assert(database.queries.some(q=>/ORDER BY \(idempotency_key=\$2\) DESC,created_at LIMIT 1/u.test(q.sql)));
  assert(!database.queries.some(q=>q.sql.startsWith("INSERT")));
});

test("arbitrary SQL/AuthZ failure is not masked and partial writes roll back",async()=>{
  const database=client({failAt:"INSERT INTO signal_topic_evaluation_v2_candidate_revisions"});
  await assert.rejects(importSignalTopicEvaluationV2HistoricalResult(args(fixture(),database)),
    (e:unknown)=>(e as {code:string}).code==="42501");
  assert.equal(database.queries.at(-2)!.sql,"ROLLBACK TO SAVEPOINT topic_result_import_v1");
  assert(!database.queries.some(q=>q.sql.startsWith("COMMIT")));
});

test("0122 is product-independent, additive to execution and retains database-enforced complete cohorts",async()=>{
  const sql=await readFile(new URL("./migrations/0122_signal_topic_evaluation_v2_historical_result_import.sql",import.meta.url),"utf8");
  assert.doesNotMatch(sql,/session_replication_role|DISABLE TRIGGER|SECURITY DEFINER|DROP.*signal_topic_evaluation_v2_run_bounds/u);
  assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION.*(?:execution|protect_signal_topic_evaluation_v2_run)/u);
  assert.doesNotMatch(sql,/REFERENCES signal_topic_evaluation_v2_candidate_refinement_(?:sessions|flights)/u);
  assert.match(sql,/execution_authorization_id IS NULL/u);assert.match(sql,/provider_call_count=0 AND reserved_micro_usd=0 AND settled_micro_usd=0/u);
  assert.match(sql,/signal_topic_evaluation_v2_semantic_authority_digest_v1/u);
  assert.match(sql,/packet.rights_digest=snapshot.rights_digest/u);
  assert.match(sql,/canonical_binding_digest,E'\\n' ORDER BY assignment_index/u);
  assert.match(sql,/DEFERRABLE INITIALLY DEFERRED FOR EACH ROW/u);
  assert.match(sql,/BEFORE UPDATE OR DELETE ON signal_topic_evaluation_v2_result_import_receipts/u);
  assert.match(sql,/FOREIGN KEY\(candidate_id,run_id,workspace_id\)/u);
});
