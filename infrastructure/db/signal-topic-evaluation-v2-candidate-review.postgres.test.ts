import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { signalTopicEvaluationDigestV2,signalTopicEvaluationFlightCardV2,
  type SignalTopicEvaluationTraceV2 } from "@noisia/query-engine";
import pg from "pg";

import { loadSignalTopicEvaluationV2CandidateDetail,loadSignalTopicEvaluationV2CandidateManagement,
  persistOfflineSignalTopicEvaluationTraceV2,reviewSignalTopicEvaluationV2Candidate }
  from "./signal-topic-evaluation-v2";

const DATABASE_URL=process.env.NOISIA_TOPIC_EVALUATION_V2_REVIEW_URL;
const APPROVED=process.env.NOISIA_TOPIC_EVALUATION_V2_REVIEW_APPROVED==="true";

test("0115 keeps V2 source provenance immutable and appends reversible candidate-only review",{
  skip:!DATABASE_URL||!APPROVED,timeout:90_000
},async()=>{
  assert.ok(DATABASE_URL);assert.match(DATABASE_URL,
    /^(?:postgres(?:ql)?:\/\/)?(?:[^@/]+@)?(?:127\.0\.0\.1|localhost)(?::\d+)?\//u,
  "candidate review integration is local-only");
  const pool=new pg.Pool({connectionString:DATABASE_URL,ssl:false,max:4});
  try{
    await install0115(pool);
    const first=await seedCompletedRun(pool,"first","candidate.shared");
    const second=await seedCompletedRun(pool,"second","candidate.shared");
    const actor={id:second.actor_id,user_type:"noisia_internal" as const};
    const immutableBefore=await sourceAuthorityDigest(pool,second.workspace_id,second.run_id);

    const page=await loadSignalTopicEvaluationV2CandidateManagement({queryable:pool,
      workspace_id:second.workspace_id,actor,limit:20});
    assert.equal(page.run_key,second.run_key,"the newest completed run is selected deterministically");
    assert.equal(page.items.length,1);assert.equal(page.items[0]!.candidate_key,"candidate.shared");
    assert.match(page.items[0]!.updated_at,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
      "management timestamps are normalized to RFC3339");
    assert.deepEqual({total:page.total,pending:page.pending,rejected:page.rejected,
      adoption:page.topic_adoption,publication:page.publication,serving:page.serving},
    {total:1,pending:1,rejected:0,adoption:false,publication:false,serving:false});
    const firstDetail=await loadSignalTopicEvaluationV2CandidateDetail({queryable:pool,
      workspace_id:first.workspace_id,actor,run_key:first.run_key,candidate_key:"candidate.shared"});
    const secondDetail=await loadSignalTopicEvaluationV2CandidateDetail({queryable:pool,
      workspace_id:second.workspace_id,actor,run_key:second.run_key,candidate_key:"candidate.shared"});
    assert.notEqual(firstDetail.run_key,secondDetail.run_key,
      "same candidate_key in distinct runs cannot alias management authority");
    assert.equal(secondDetail.candidate.evidence.length,1);

    const original=secondDetail.candidate;
    const saveCommand={action:"save" as const,run_key:second.run_key,candidate_key:"candidate.shared",
      expected_revision:original.revision,state_token:original.state_token,values:{title:"Edited candidate",
        description:original.description,inclusion:original.inclusion as string[],
        exclusion:original.exclusion as string[]}};
    const saved=await reviewSignalTopicEvaluationV2Candidate({pool,workspace_id:second.workspace_id,actor,
      idempotency_key:`r34-save-${randomUUID()}`,command:saveCommand});
    assert.deepEqual({revision:saved.revision,state:saved.review_state,replay:saved.idempotent_replay,
      adoption:saved.topic_adoption,publication:saved.publication,serving:saved.serving},
    {revision:2,state:"pending",replay:false,adoption:false,publication:false,serving:false});
    const replayKey=`r34-replay-${randomUUID()}`;
    const replaySource=await reviewSignalTopicEvaluationV2Candidate({pool,workspace_id:second.workspace_id,actor,
      idempotency_key:replayKey,command:{action:"reject",run_key:second.run_key,
        candidate_key:"candidate.shared",expected_revision:saved.revision,state_token:saved.state_token}});
    const replay=await reviewSignalTopicEvaluationV2Candidate({pool,workspace_id:second.workspace_id,actor,
      idempotency_key:replayKey,command:{action:"reject",run_key:second.run_key,
        candidate_key:"candidate.shared",expected_revision:saved.revision,state_token:saved.state_token}});
    assert.equal(replaySource.review_state,"rejected");assert.equal(replay.idempotent_replay,true);
    await assert.rejects(reviewSignalTopicEvaluationV2Candidate({pool,workspace_id:second.workspace_id,actor,
      idempotency_key:replayKey,command:{action:"restore",run_key:second.run_key,
        candidate_key:"candidate.shared",expected_revision:replay.revision,state_token:replay.state_token}}),
    /topic_evaluation_v2_candidate_idempotency_conflict/u);
    await assert.rejects(reviewSignalTopicEvaluationV2Candidate({pool,workspace_id:second.workspace_id,actor,
      idempotency_key:`r34-stale-${randomUUID()}`,command:{action:"restore",run_key:second.run_key,
        candidate_key:"candidate.shared",expected_revision:saved.revision,state_token:saved.state_token}}),
    /topic_evaluation_v2_candidate_stale/u);
    const restored=await reviewSignalTopicEvaluationV2Candidate({pool,workspace_id:second.workspace_id,actor,
      idempotency_key:`r34-restore-${randomUUID()}`,command:{action:"restore",run_key:second.run_key,
        candidate_key:"candidate.shared",expected_revision:replay.revision,state_token:replay.state_token}});
    const undone=await reviewSignalTopicEvaluationV2Candidate({pool,workspace_id:second.workspace_id,actor,
      idempotency_key:`r34-undo-${randomUUID()}`,command:{action:"undo",run_key:second.run_key,
        candidate_key:"candidate.shared",expected_revision:restored.revision,state_token:restored.state_token,
        target_revision:replay.revision}});
    assert.equal(undone.review_state,"rejected","undo restores only the immediate predecessor revision");
    await assert.rejects(reviewSignalTopicEvaluationV2Candidate({pool,workspace_id:second.workspace_id,actor,
      idempotency_key:`r34-old-undo-${randomUUID()}`,command:{action:"undo",run_key:second.run_key,
        candidate_key:"candidate.shared",expected_revision:undone.revision,state_token:undone.state_token,
        target_revision:1}}),/topic_evaluation_v2_candidate_undo_target_invalid/u);
    const finalRestore=await reviewSignalTopicEvaluationV2Candidate({pool,workspace_id:second.workspace_id,actor,
      idempotency_key:`r34-final-${randomUUID()}`,command:{action:"restore",run_key:second.run_key,
        candidate_key:"candidate.shared",expected_revision:undone.revision,state_token:undone.state_token}});
    assert.equal(finalRestore.review_state,"pending");
    const competing=(label:string)=>reviewSignalTopicEvaluationV2Candidate({pool,
      workspace_id:second.workspace_id,actor,idempotency_key:`r34-race-${label}-${randomUUID()}`,
      command:{action:"save",run_key:second.run_key,candidate_key:"candidate.shared",
        expected_revision:finalRestore.revision,state_token:finalRestore.state_token,values:{
          title:`Race ${label}`,description:original.description,
          inclusion:original.inclusion as string[],exclusion:original.exclusion as string[]}}});
    const race=await Promise.allSettled([competing("one"),competing("two")]);
    assert.equal(race.filter((item)=>item.status==="fulfilled").length,1,
      "optimistic concurrency permits exactly one successor");
    assert.equal(race.filter((item)=>item.status==="rejected").length,1);
    assert.match(String((race.find((item)=>item.status==="rejected") as PromiseRejectedResult).reason),
      /topic_evaluation_v2_candidate_stale/u);
    const afterRace=(await loadSignalTopicEvaluationV2CandidateDetail({queryable:pool,
      workspace_id:second.workspace_id,actor,run_key:second.run_key,
      candidate_key:"candidate.shared"})).candidate;

    const latestOperation=(await pool.query<{id:string}>(`SELECT id::text FROM
      signal_topic_evaluation_v2_candidate_review_operations WHERE workspace_id=$1::uuid
      ORDER BY created_at DESC,id DESC LIMIT 1`,[second.workspace_id])).rows[0]!;
    await assertImmediateRejected(pool,async(client)=>{await client.query(`INSERT INTO
      signal_topic_evaluation_v2_candidate_review_events(id,operation_id,candidate_id,run_id,workspace_id,
        event_kind,previous_version_digest,current_version_digest)
      SELECT gen_random_uuid(),operation_id,candidate_id,run_id,workspace_id,event_kind,
        previous_version_digest,current_version_digest FROM signal_topic_evaluation_v2_candidate_review_events
      WHERE operation_id=$1::uuid`,[latestOperation.id]);},/duplicate key|unique/u);
    await assertPartialCohortRejected(pool,second,afterRace);
    await assertCrossWorkspaceRejected(pool,second,afterRace);
    await assertForgedInputRejected(pool,second,afterRace);
    await assertClientActorRejected(pool,second,afterRace);
    await assertInactiveInternalActorRejected(pool,second,afterRace);
    await assertNonCompletedRunRejected(pool,second);
    await assertWrongRunKeyCollisionRejected(pool,first,second,actor,afterRace);
    await assertFakeActionRejected(pool,second,afterRace);
    await assertEditorialRevisionWithoutOperationRejected(pool,second,afterRace);

    for(const [table,predicate,assignment,value] of [
      ["signal_topic_evaluation_v2_snapshots","workspace_id=$1::uuid","snapshot_digest=snapshot_digest",
        second.workspace_id],
      ["signal_topic_evaluation_v2_clusters",
        "snapshot_id=(SELECT id FROM signal_topic_evaluation_v2_snapshots WHERE workspace_id=$1::uuid LIMIT 1)",
        "profile_digest=profile_digest",second.workspace_id],
      ["signal_topic_evaluation_v2_cluster_memberships",
        "snapshot_id=(SELECT id FROM signal_topic_evaluation_v2_snapshots WHERE workspace_id=$1::uuid LIMIT 1)",
        "source_record_digest=source_record_digest",second.workspace_id],
      ["signal_topic_evaluation_v2_retrievals","run_id=$1::uuid","result_digest=result_digest",second.run_id],
      ["signal_topic_evaluation_v2_retrieval_evidence",
        "retrieval_id=(SELECT id FROM signal_topic_evaluation_v2_retrievals WHERE run_id=$1::uuid LIMIT 1)",
        "evidence_ref=evidence_ref",second.run_id],
      ["signal_topic_evaluation_v2_model_turns","run_id=$1::uuid","output_digest=output_digest",second.run_id],
      ["signal_topic_evaluation_v2_runs","id=$1::uuid","completed_at=completed_at",second.run_id],
      ["signal_topic_evaluation_v2_candidates","run_id=$1::uuid","candidate_digest=candidate_digest",second.run_id],
      ["signal_topic_evaluation_v2_candidate_revisions","run_id=$1::uuid","payload_digest=payload_digest",second.run_id],
      ["signal_topic_evaluation_v2_candidate_evidence",
        "candidate_id=(SELECT id FROM signal_topic_evaluation_v2_candidates WHERE run_id=$1::uuid LIMIT 1)",
        "evidence_ref=evidence_ref",second.run_id],
      ["signal_topic_evaluation_v2_rankings","run_id=$1::uuid","ranking_reason=ranking_reason",second.run_id]
    ] as const){
      await assert.rejects(pool.query(`UPDATE ${table} SET ${assignment} WHERE ${predicate}`,[value]),
      /append-only/u,`${table} UPDATE remains protected by 0112`);
      await assert.rejects(pool.query(`DELETE FROM ${table} WHERE ${predicate}`,[value]),
      /append-only/u,`${table} DELETE remains protected by 0112`);
    }
    assert.deepEqual(await sourceAuthorityDigest(pool,second.workspace_id,second.run_id),immutableBefore,
      "editorial revisions never alter original model output, evidence, ranking or source lineage");
    const cohort=(await pool.query<{operations:number;revisions:number;events:number}>(`SELECT
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_review_operations
        WHERE workspace_id=$1::uuid) operations,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_editorial_revisions
        WHERE workspace_id=$1::uuid) revisions,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_review_events
        WHERE workspace_id=$1::uuid) events`,[second.workspace_id])).rows[0]!;
    assert.equal(cohort.operations,cohort.revisions);assert.equal(cohort.operations,cohort.events);
    const sourceFlags=(await pool.query<{invalid:number}>(`SELECT count(*) FILTER(
      WHERE status<>'pending' OR adopted OR published OR serving)::int invalid
      FROM signal_topic_evaluation_v2_candidates WHERE workspace_id=$1::uuid`,[second.workspace_id])).rows[0]!;
    assert.equal(sourceFlags.invalid,0,"review cannot adopt, publish, serve or rewrite source candidate state");
    const sourceCandidate=(await pool.query<{id:string}>(`SELECT id::text FROM
      signal_topic_evaluation_v2_candidates WHERE run_id=$1::uuid LIMIT 1`,[second.run_id])).rows[0]!;
    for(const column of ["adopted","published","serving"] as const){
      await assert.rejects(pool.query(`UPDATE signal_topic_evaluation_v2_candidates SET ${column}=true
        WHERE id=$1::uuid`,[sourceCandidate.id]),/append-only/u,
      `direct ${column}=true remains blocked by immutable source provenance`);
    }
  }finally{await pool.end();}
});

async function install0115(pool:pg.Pool){
  const exists=(await pool.query<{present:boolean}>(`SELECT to_regclass(
    'signal_topic_evaluation_v2_candidate_review_operations') IS NOT NULL present`)).rows[0]!.present;
  if(exists)return;
  await pool.query(await readFile(new URL("./migrations/0115_signal_topic_evaluation_v2_candidate_review.sql",
    import.meta.url),"utf8"));
}

async function seedCompletedRun(pool:pg.Pool,suffix:string,candidateKey:string){
  const authority=(await pool.query<{snapshot_id:string;workspace_id:string;actor_id:string;
    snapshot_digest:string;cluster_key:string;member_ref:string;source_record_digest:string}>(`SELECT
      snapshot.id::text snapshot_id,snapshot.workspace_id::text,
      (SELECT actor.id::text FROM users actor WHERE actor.status='active'
        AND actor.user_type='noisia_internal'
        AND signal_data_governance_actor_is_valid(snapshot.workspace_id,actor.id) LIMIT 1) actor_id,
      snapshot.snapshot_digest,membership.cluster_key,membership.member_ref,membership.source_record_digest
    FROM signal_topic_evaluation_v2_snapshots snapshot
    JOIN LATERAL(SELECT item.cluster_key,item.member_ref,item.source_record_digest
      FROM signal_topic_evaluation_v2_cluster_memberships item WHERE item.snapshot_id=snapshot.id
      ORDER BY item.assignment_index LIMIT 1) membership ON true
    WHERE snapshot.state='frozen' ORDER BY snapshot.created_at DESC LIMIT 1`)).rows[0]!;
  assert.ok(authority?.actor_id,"fixture needs a frozen snapshot and an active governance actor");
  const runId=randomUUID(),runKey=`r34-${suffix}-${randomUUID()}`,card=signalTopicEvaluationFlightCardV2();
  const evidenceRef=signalTopicEvaluationDigestV2({snapshot:authority.snapshot_digest,
    member_ref:authority.member_ref,source:authority.source_record_digest});
  const resultDigest=signalTopicEvaluationDigestV2({suffix,evidenceRef});
  const output={contract_version:"signal-topic-evaluation-full-evidence-output-v2" as const,
    candidates:[{candidate_key:candidateKey,title:`Candidate ${suffix}`,description:"Editable pending candidate",
      inclusion:["In scope"],exclusion:[],explanation:"Bounded evidence",
      source_cluster_keys:[authority.cluster_key],evidence_refs:[evidenceRef],status:"pending" as const}],
    ranking:[{rank:1,candidate_key:candidateKey,ranking_reason:"Fixture relevance"}]};
  const outputDigest=signalTopicEvaluationDigestV2(output);
  const trace:SignalTopicEvaluationTraceV2={turns:[{turn_index:0,kind:"tool",input_digest:
      signalTopicEvaluationDigestV2({operation:"representative_mentions"}),output_digest:resultDigest,
      tool_operation:"representative_mentions",result_bytes:128,input_tokens:0,output_tokens:0,
      cost_micro_usd:0},{turn_index:1,kind:"final",input_digest:signalTopicEvaluationDigestV2({resultDigest}),
      output_digest:outputDigest,tool_operation:null,result_bytes:256,input_tokens:0,output_tokens:0,
      cost_micro_usd:0}],retrievals:[{retrieval_index:0,tool_input_digest:
      signalTopicEvaluationDigestV2({operation:"representative_mentions"}),result_digest:resultDigest,
      evidence_refs:[evidenceRef],result_bytes:128}],output,total_tool_result_bytes:128,total_input_tokens:0,
    total_output_tokens:0,total_cost_micro_usd:0,provider_calls:0};
  const client=await pool.connect();
  try{await client.query("BEGIN");
    await client.query(`INSERT INTO signal_topic_evaluation_v2_runs(id,workspace_id,snapshot_id,
      requested_by_user_id,idempotency_key,run_key,confirmation,flight_card,flight_card_digest,
      reserved_micro_usd) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,
      'RUN_BOUNDED_FULL_EVIDENCE_TOPIC_EVALUATION',$7::jsonb,$8,0)`,[runId,authority.workspace_id,
      authority.snapshot_id,authority.actor_id,`r34-${suffix}-${randomUUID()}`,runKey,JSON.stringify(card),
      signalTopicEvaluationDigestV2(card)]);
    await client.query(`UPDATE signal_topic_evaluation_v2_runs SET status='in_progress'
      WHERE id=$1::uuid`,[runId]);
    await persistOfflineSignalTopicEvaluationTraceV2({client,run_id:runId,
      workspace_id:authority.workspace_id,snapshot_id:authority.snapshot_id,trace});
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{client.release();}
  return{...authority,run_id:runId,run_key:runKey};
}

async function sourceAuthorityDigest(pool:pg.Pool,workspaceId:string,runId:string){
  return(await pool.query<{candidate_digest:string;revision_digest:string;evidence_digest:string;
    ranking_digest:string}>(`SELECT
      signal_semantic_context_digest_json_v2(COALESCE((SELECT jsonb_agg(to_jsonb(item) ORDER BY item.id)
        FROM signal_topic_evaluation_v2_candidates item
        WHERE item.workspace_id=$1::uuid AND item.run_id=$2::uuid),'[]'::jsonb)) candidate_digest,
      signal_semantic_context_digest_json_v2(COALESCE((SELECT jsonb_agg(to_jsonb(item) ORDER BY item.id)
        FROM signal_topic_evaluation_v2_candidate_revisions item
        WHERE item.workspace_id=$1::uuid AND item.run_id=$2::uuid),'[]'::jsonb)) revision_digest,
      signal_semantic_context_digest_json_v2(COALESCE((SELECT jsonb_agg(to_jsonb(item) ORDER BY item.candidate_id,item.evidence_ref)
        FROM signal_topic_evaluation_v2_candidate_evidence item JOIN signal_topic_evaluation_v2_candidates candidate
          ON candidate.id=item.candidate_id
        WHERE candidate.workspace_id=$1::uuid AND candidate.run_id=$2::uuid),'[]'::jsonb)) evidence_digest,
      signal_semantic_context_digest_json_v2(COALESCE((SELECT jsonb_agg(to_jsonb(item) ORDER BY item.run_id,item.rank)
        FROM signal_topic_evaluation_v2_rankings item JOIN signal_topic_evaluation_v2_runs run
          ON run.id=item.run_id
        WHERE run.workspace_id=$1::uuid AND run.id=$2::uuid),'[]'::jsonb)) ranking_digest`,
  [workspaceId,runId])).rows[0]!;
}

async function currentRaw(pool:pg.Pool,fixture:{workspace_id:string;run_id:string;run_key:string}){
  return(await pool.query<{candidate_id:string;base_id:string;editorial_id:string;candidate_key:string;
    revision:number;review_state:"pending"|"rejected";title:string;description:string;inclusion:unknown;
    exclusion:unknown;version_digest:string;state_token:string}>(`SELECT candidate.id::text candidate_id,
      base.id::text base_id,editorial.id::text editorial_id,candidate.candidate_key,
      COALESCE(editorial.revision,1)::int revision,COALESCE(editorial.review_state,'pending') review_state,
      COALESCE(editorial.title,base.payload->>'title') title,
      COALESCE(editorial.description,base.payload->>'description') description,
      COALESCE(editorial.inclusion,base.payload->'inclusion') inclusion,
      COALESCE(editorial.exclusion,base.payload->'exclusion') exclusion,
      COALESCE(editorial.version_digest,base.payload_digest) version_digest,
      signal_topic_evaluation_v2_candidate_state_token_v1(candidate.id,COALESCE(editorial.revision,1),
        COALESCE(editorial.version_digest,base.payload_digest)) state_token
    FROM signal_topic_evaluation_v2_candidates candidate
    JOIN signal_topic_evaluation_v2_candidate_revisions base
      ON base.candidate_id=candidate.id AND base.revision=1
    LEFT JOIN LATERAL(SELECT item.* FROM signal_topic_evaluation_v2_candidate_editorial_revisions item
      WHERE item.candidate_id=candidate.id ORDER BY item.revision DESC LIMIT 1) editorial ON true
    WHERE candidate.workspace_id=$1::uuid AND candidate.run_id=$2::uuid`,
  [fixture.workspace_id,fixture.run_id])).rows[0]!;
}

async function assertPartialCohortRejected(pool:pg.Pool,fixture:{workspace_id:string;run_id:string;run_key:string;
  actor_id:string},result:{revision:number;state_token:string}){const current=await currentRaw(pool,fixture);
  await assertRejected(pool,async(client)=>{const input={action:"reject",run_key:fixture.run_key,
    candidate_key:current.candidate_key,expected_revision:result.revision,state_token:result.state_token};
    await client.query(`INSERT INTO signal_topic_evaluation_v2_candidate_review_operations(id,workspace_id,
      run_id,candidate_id,actor_user_id,idempotency_key,action,expected_revision,expected_state_token,input,
      input_digest,result_revision_id,result_revision,result_version_digest) VALUES(gen_random_uuid(),$1::uuid,
      $2::uuid,$3::uuid,$4::uuid,$5,'reject',$6,$7,$8::jsonb,
      signal_semantic_context_digest_json_v2($8::jsonb),gen_random_uuid(),$9,$10)`,[fixture.workspace_id,
      fixture.run_id,current.candidate_id,fixture.actor_id,`r34-partial-${randomUUID()}`,result.revision,
      result.state_token,JSON.stringify(input),result.revision+1,signalTopicEvaluationDigestV2("unused")]);
  },/operation is incomplete|foreign key/u);}

async function assertCrossWorkspaceRejected(pool:pg.Pool,fixture:{workspace_id:string;run_id:string;run_key:string;
  actor_id:string},result:{revision:number;state_token:string}){const current=await currentRaw(pool,fixture);
  await assertImmediateRejected(pool,async(client)=>{await client.query(`INSERT INTO
    signal_topic_evaluation_v2_candidate_review_operations(id,workspace_id,run_id,candidate_id,actor_user_id,
      idempotency_key,action,expected_revision,expected_state_token,input,input_digest,result_revision_id,
      result_revision,result_version_digest) VALUES(gen_random_uuid(),gen_random_uuid(),$1::uuid,$2::uuid,$3::uuid,
      $4,'reject',$5,$6,'{}'::jsonb,$7,gen_random_uuid(),$8,$9)`,[fixture.run_id,current.candidate_id,
      fixture.actor_id,`r34-cross-${randomUUID()}`,result.revision,result.state_token,
      signalTopicEvaluationDigestV2({}),result.revision+1,signalTopicEvaluationDigestV2("unused")]);
  },/foreign key/u);}

async function assertForgedInputRejected(pool:pg.Pool,fixture:{workspace_id:string;run_id:string;run_key:string;
  actor_id:string},result:{revision:number;state_token:string}){const current=await currentRaw(pool,fixture);
  await assertRevisionRejected(pool,fixture,current,result,fixture.actor_id,{action:"reject",run_key:fixture.run_key,
    candidate_key:"candidate.forged",expected_revision:result.revision,state_token:result.state_token},
  /reject input is invalid/u);}

async function assertClientActorRejected(pool:pg.Pool,fixture:{workspace_id:string;run_id:string;run_key:string;
  actor_id:string},result:{revision:number;state_token:string}){const current=await currentRaw(pool,fixture);
  const organization=(await pool.query<{organization_id:string}>(`SELECT organization_id::text FROM signal_workspaces
    WHERE id=$1::uuid`,[fixture.workspace_id])).rows[0]!.organization_id;
  const actorId=randomUUID();await pool.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,
    organization_id,status) VALUES($1::uuid,$2,'R34 client','client','brand_manager',$3::uuid,'active')`,
  [actorId,`r34-${actorId.slice(0,8)}@example.test`,organization]);
  await assertRevisionRejected(pool,fixture,current,result,actorId,{action:"reject",run_key:fixture.run_key,
    candidate_key:current.candidate_key,expected_revision:result.revision,state_token:result.state_token},
  /review authority is invalid/u);}

async function assertInactiveInternalActorRejected(pool:pg.Pool,fixture:{workspace_id:string;run_id:string;
  run_key:string;actor_id:string},result:{revision:number;state_token:string}){
  const current=await currentRaw(pool,fixture);
  const actorId=randomUUID();
  await pool.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,status)
    VALUES($1::uuid,$2,'R34 inactive internal','noisia_internal','platform_admin','inactive')`,
  [actorId,`r34-${actorId.slice(0,8)}@example.test`]);
  await assertRevisionRejected(pool,fixture,current,result,actorId,{action:"reject",run_key:fixture.run_key,
    candidate_key:current.candidate_key,expected_revision:result.revision,state_token:result.state_token},
  /review authority is invalid/u);
}

async function assertNonCompletedRunRejected(pool:pg.Pool,source:{workspace_id:string;run_id:string;
  actor_id:string}){
  const fixture=await seedPlannedRunWithCandidate(pool,source);
  const current=await currentRaw(pool,fixture);
  await assertRevisionRejected(pool,fixture,current,{revision:current.revision,state_token:current.state_token},
    fixture.actor_id,{action:"reject",run_key:fixture.run_key,candidate_key:current.candidate_key,
      expected_revision:current.revision,state_token:current.state_token},/review authority is invalid/u);
}

async function seedPlannedRunWithCandidate(pool:pg.Pool,source:{workspace_id:string;run_id:string;
  actor_id:string}){
  const runId=randomUUID(),runKey=`r34-planned-${randomUUID()}`,candidateId=randomUUID(),revisionId=randomUUID();
  const client=await pool.connect();
  try{await client.query("BEGIN");
    await client.query(`INSERT INTO signal_topic_evaluation_v2_runs(id,workspace_id,snapshot_id,
      requested_by_user_id,idempotency_key,run_key,confirmation,flight_card,flight_card_digest)
      SELECT $1::uuid,workspace_id,snapshot_id,$2::uuid,$3,$4,confirmation,flight_card,flight_card_digest
      FROM signal_topic_evaluation_v2_runs WHERE id=$5::uuid`,[runId,source.actor_id,
      `r34-planned-${randomUUID()}`,runKey,source.run_id]);
    await client.query(`INSERT INTO signal_topic_evaluation_v2_candidates(id,run_id,workspace_id,
      candidate_key,candidate_digest,source_cluster_keys)
      SELECT $1::uuid,$2::uuid,workspace_id,candidate_key,candidate_digest,source_cluster_keys
      FROM signal_topic_evaluation_v2_candidates WHERE run_id=$3::uuid LIMIT 1`,
    [candidateId,runId,source.run_id]);
    await client.query(`INSERT INTO signal_topic_evaluation_v2_candidate_revisions(id,candidate_id,run_id,
      workspace_id,revision,payload,payload_digest)
      SELECT $1::uuid,$2::uuid,$3::uuid,workspace_id,1,payload,payload_digest
      FROM signal_topic_evaluation_v2_candidate_revisions WHERE run_id=$4::uuid AND revision=1 LIMIT 1`,
    [revisionId,candidateId,runId,source.run_id]);
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{client.release();}
  return{workspace_id:source.workspace_id,run_id:runId,run_key:runKey,actor_id:source.actor_id};
}

async function assertWrongRunKeyCollisionRejected(pool:pg.Pool,wrongRun:{run_key:string},
  fixture:{workspace_id:string;run_id:string;run_key:string},actor:{id:string;user_type:"noisia_internal"},
  result:{revision:number;state_token:string}){
  const before=(await pool.query<{count:number}>(`SELECT count(*)::int count FROM
    signal_topic_evaluation_v2_candidate_review_operations WHERE workspace_id=$1::uuid`,
  [fixture.workspace_id])).rows[0]!.count;
  await assert.rejects(reviewSignalTopicEvaluationV2Candidate({pool,workspace_id:fixture.workspace_id,actor,
    idempotency_key:`r34-wrong-run-${randomUUID()}`,command:{action:"save",run_key:wrongRun.run_key,
      candidate_key:"candidate.shared",expected_revision:result.revision,state_token:result.state_token,
      values:{title:"Wrong run",description:"Must not alias",inclusion:["No write"],exclusion:[]}}}),
  /topic_evaluation_v2_candidate_stale/u);
  const after=(await pool.query<{count:number}>(`SELECT count(*)::int count FROM
    signal_topic_evaluation_v2_candidate_review_operations WHERE workspace_id=$1::uuid`,
  [fixture.workspace_id])).rows[0]!.count;
  assert.equal(after,before,"a colliding candidate key under the wrong run key writes nothing");
}

async function assertFakeActionRejected(pool:pg.Pool,fixture:{workspace_id:string;run_id:string;run_key:string},
  result:{revision:number;state_token:string}){const current=await currentRaw(pool,fixture);
  await assertImmediateRejected(pool,async(client)=>{await client.query(`INSERT INTO
    signal_topic_evaluation_v2_candidate_review_operations(id,workspace_id,run_id,candidate_id,actor_user_id,
      idempotency_key,action,expected_revision,expected_state_token,input,input_digest,result_revision_id,
      result_revision,result_version_digest) VALUES(gen_random_uuid(),$1::uuid,$2::uuid,$3::uuid,
      (SELECT requested_by_user_id FROM signal_topic_evaluation_v2_runs WHERE id=$2::uuid),$4,'approve',
      $5,$6,'{}'::jsonb,$7,gen_random_uuid(),$8,$9)`,[fixture.workspace_id,fixture.run_id,
      current.candidate_id,`r34-fake-${randomUUID()}`,result.revision,result.state_token,
      signalTopicEvaluationDigestV2({}),result.revision+1,signalTopicEvaluationDigestV2("unused")]);
  },/review_operation_shape|check constraint/u);}

async function assertEditorialRevisionWithoutOperationRejected(pool:pg.Pool,
  fixture:{workspace_id:string;run_id:string;run_key:string},result:{revision:number;state_token:string}){
  const current=await currentRaw(pool,fixture);
  await assertImmediateRejected(pool,async(client)=>{await client.query(`INSERT INTO
    signal_topic_evaluation_v2_candidate_editorial_revisions(id,candidate_id,run_id,workspace_id,revision,
      base_model_revision_id,predecessor_editorial_revision_id,operation_id,action,review_state,title,
      description,inclusion,exclusion,version_digest) VALUES(gen_random_uuid(),$1::uuid,$2::uuid,$3::uuid,
      $4,$5::uuid,$6::uuid,gen_random_uuid(),'save','pending',$7,$8,$9::jsonb,$10::jsonb,$11)`,
    [current.candidate_id,fixture.run_id,fixture.workspace_id,result.revision+1,current.base_id,
      current.editorial_id,current.title,current.description,JSON.stringify(current.inclusion),
      JSON.stringify(current.exclusion),signalTopicEvaluationDigestV2("unused")]);
  },/review authority is invalid|foreign key/u);
}

async function assertRevisionRejected(pool:pg.Pool,fixture:{workspace_id:string;run_id:string},current:Awaited<
  ReturnType<typeof currentRaw>>,result:{revision:number;state_token:string},actorId:string,input:unknown,
  expected:RegExp){const client=await pool.connect();try{await client.query("BEGIN");
    const operationId=randomUUID(),revisionId=randomUUID(),nextRevision=result.revision+1;
    const digest=(await client.query<{value:string}>(`SELECT
      signal_topic_evaluation_v2_candidate_editorial_digest_v1($1::uuid,$2,$3,'reject','rejected',$4,$5,
        $6::jsonb,$7::jsonb,$8) value`,[current.candidate_id,nextRevision,current.version_digest,current.title,
      current.description,JSON.stringify(current.inclusion),JSON.stringify(current.exclusion),
      (await client.query<{payload_digest:string}>(`SELECT payload_digest FROM
        signal_topic_evaluation_v2_candidate_revisions WHERE id=$1::uuid`,[current.base_id])).rows[0]!.payload_digest])).rows[0]!.value;
    await client.query(`INSERT INTO signal_topic_evaluation_v2_candidate_review_operations(id,workspace_id,
      run_id,candidate_id,actor_user_id,idempotency_key,action,expected_revision,expected_state_token,input,
      input_digest,result_revision_id,result_revision,result_version_digest) VALUES($1::uuid,$2::uuid,$3::uuid,
      $4::uuid,$5::uuid,$6,'reject',$7,$8,$9::jsonb,signal_semantic_context_digest_json_v2($9::jsonb),
      $10::uuid,$11,$12)`,[operationId,fixture.workspace_id,fixture.run_id,current.candidate_id,actorId,
      `r34-forged-${randomUUID()}`,result.revision,result.state_token,JSON.stringify(input),revisionId,nextRevision,digest]);
    await assert.rejects(client.query(`INSERT INTO signal_topic_evaluation_v2_candidate_editorial_revisions(
      id,candidate_id,run_id,workspace_id,revision,base_model_revision_id,predecessor_editorial_revision_id,
      operation_id,action,review_state,title,description,inclusion,exclusion,version_digest) VALUES($1::uuid,
      $2::uuid,$3::uuid,$4::uuid,$5,$6::uuid,$7::uuid,$8::uuid,'reject','rejected',$9,$10,$11::jsonb,
      $12::jsonb,$13)`,[revisionId,current.candidate_id,fixture.run_id,fixture.workspace_id,nextRevision,
      current.base_id,current.editorial_id,operationId,current.title,current.description,
      JSON.stringify(current.inclusion),JSON.stringify(current.exclusion),digest]),expected);
  }finally{await client.query("ROLLBACK").catch(()=>undefined);client.release();}}

async function assertRejected(pool:pg.Pool,operation:(client:pg.PoolClient)=>Promise<void>,expected:RegExp){
  const client=await pool.connect();try{await client.query("BEGIN");await operation(client);
    await assert.rejects(client.query("SET CONSTRAINTS ALL IMMEDIATE"),expected);
  }finally{await client.query("ROLLBACK").catch(()=>undefined);client.release();}
}

async function assertImmediateRejected(pool:pg.Pool,operation:(client:pg.PoolClient)=>Promise<void>,
  expected:RegExp){const client=await pool.connect();try{await client.query("BEGIN");
    await assert.rejects(operation(client),expected);
  }finally{await client.query("ROLLBACK").catch(()=>undefined);client.release();}}
