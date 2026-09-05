import assert from "node:assert/strict";
import test from "node:test";

import { createAndClaimSignalTopicEvaluationLabExecutionV2,
  navigateSignalTopicEvaluationEvidenceV2,persistSignalTopicEvaluationProviderTraceV2,
  SIGNAL_TOPIC_EVALUATION_LAB_EXECUTION_CONFIRMATION } from "@noisia/db";
import { buildSignalTopicEvaluationExecutionFlightCardV2,runOfflineSignalTopicEvaluationV2,
  signalTopicEvaluationDigestV2 } from "@noisia/query-engine";

import { createSignalTopicEvaluationLabDockerWritePoolV2 } from
  "./signal-topic-evaluation-lab-docker-write-pool-v2";
import { verifyFixedSignalTopicEvaluationLabHostReceiptV1 } from
  "./signal-topic-evaluation-lab-host-provenance-v2";

const enabled=process.env.NOISIA_TOPIC_EVALUATION_LAB_EXECUTION_POSTGRES_TEST_ENABLED==="true";
const digest=(value:string)=>signalTopicEvaluationDigestV2(value);

test("0116 seals one direct disposable Lab flight and preserves UAT/outbox separation",
  {skip:!enabled},async()=>{
  const {receipt}=await verifyFixedSignalTopicEvaluationLabHostReceiptV1();
  const pool=createSignalTopicEvaluationLabDockerWritePoolV2(receipt);
  const source=await pool.query<{snapshot_digest:string;cluster_key:string}>(`SELECT
    snapshot.snapshot_digest,cluster.cluster_key FROM signal_topic_evaluation_v2_snapshots snapshot
    JOIN signal_topic_evaluation_v2_clusters cluster ON cluster.snapshot_id=snapshot.id
    WHERE snapshot.state='frozen' AND cluster.member_count>0 ORDER BY cluster.cluster_key LIMIT 1`);
  const snapshotDigest=source.rows[0]!.snapshot_digest;const clusterKey=source.rows[0]!.cluster_key;
  const input={idempotency_key:"lab2a.pg.valid.0001",expected_snapshot_digest:snapshotDigest,
    host_receipt_digest:receipt.receipt_digest,
    container_identity_digest:signalTopicEvaluationDigestV2({container_id:receipt.container_id,
      image_id:receipt.image_id}),confirmation:SIGNAL_TOPIC_EVALUATION_LAB_EXECUTION_CONFIRMATION};

  const valid=await pool.connect();
  try{
    await valid.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const claimed=await createAndClaimSignalTopicEvaluationLabExecutionV2({queryable:valid,...input});
    const cohort=(await valid.query<{runtime_profile:string;authority_channel:string;authority_valid:boolean;
      outboxes:number;actor_derived:boolean;status:string;run_status:string}>(`SELECT authority.runtime_profile,
      authority.authority_channel,signal_topic_evaluation_v2_lab_authority_valid_v1(authority.id) authority_valid,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_execution_outbox outbox
        WHERE outbox.execution_authorization_id=authority.id) outboxes,
      authority.requested_by_user_id=snapshot.created_by_user_id actor_derived,authority.status,
      run.status run_status FROM signal_topic_evaluation_v2_execution_authorizations authority
      JOIN signal_topic_evaluation_v2_snapshots snapshot ON snapshot.id=authority.snapshot_id
      JOIN signal_topic_evaluation_v2_runs run ON run.execution_authorization_id=authority.id
      WHERE authority.id=$1::uuid`,[claimed.execution_authorization_id])).rows[0]!;
    assert.deepEqual(cohort,{runtime_profile:"local_disposable_lab_v1",
      authority_channel:"local_disposable_lab_runner_v1",authority_valid:true,outboxes:0,
      actor_derived:true,status:"claimed",run_status:"in_progress"});
    await assert.rejects(valid.query(`INSERT INTO signal_topic_evaluation_v2_execution_outbox(
      run_id,workspace_id,execution_authorization_id,outbox_key) VALUES($1::uuid,$2::uuid,$3::uuid,$4)`,
    [claimed.run_id,claimed.workspace_id,claimed.execution_authorization_id,"topic-v2-outbox-forged"]));
  }finally{valid.release();}

  for(const forged of [
    {...input,idempotency_key:"lab2a.pg.extra.0001",workspace_id:"00000000-0000-4000-8000-000000000000"},
    {...input,idempotency_key:"lab2a.pg.stale.0001",expected_snapshot_digest:digest("stale")},
    {...input,idempotency_key:"lab2a.pg.confirm.0001",confirmation:"wrong"},null]){
    const client=await pool.connect();try{await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await assert.rejects(client.query("SELECT signal_topic_evaluation_v2_lab_create_and_claim_v1($1::jsonb)",
        [JSON.stringify(forged)]));}finally{client.release();}
  }

  for(const mode of ["forged_authority","second_flight"] as const){
    const client=await pool.connect();try{await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const claimed=await createAndClaimSignalTopicEvaluationLabExecutionV2({queryable:client,
        ...input,idempotency_key:`lab2a.pg.${mode}.0001`});
      if(mode==="forged_authority")await assert.rejects(client.query(`UPDATE
        signal_topic_evaluation_v2_execution_authorizations SET authority_input=jsonb_set(
        authority_input,'{snapshot_digest}',to_jsonb($2::text)) WHERE id=$1::uuid`,
      [claimed.execution_authorization_id,digest("forged")]));
      else await assert.rejects(createAndClaimSignalTopicEvaluationLabExecutionV2({queryable:client,
        ...input,idempotency_key:"lab2a.pg.second.0002"}));
    }finally{client.release();}
  }

  for(const outcome of ["failed","outcome_unknown"] as const){
    const client=await pool.connect();try{await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const claimed=await createAndClaimSignalTopicEvaluationLabExecutionV2({queryable:client,
        ...input,idempotency_key:`lab2a.pg.terminal.${outcome}`});
      await client.query(`UPDATE signal_topic_evaluation_v2_runs SET provider_call_count=1,
        status=$2,error_code=$3,settled_micro_usd=$4,completed_at=clock_timestamp() WHERE id=$1::uuid`,
      [claimed.run_id,outcome,outcome==="failed"?"topic_evaluation_v2_provider_pretransport_failed":
        "topic_evaluation_v2_provider_outcome_unknown",outcome==="failed"?0:null]);
      await client.query(`UPDATE signal_topic_evaluation_v2_execution_authorizations SET
        provider_call_count=1,status=$2,error_code=$3,settled_micro_usd=$4,completed_at=clock_timestamp()
        WHERE id=$1::uuid`,[claimed.execution_authorization_id,outcome,
        outcome==="failed"?"topic_evaluation_v2_provider_pretransport_failed":
          "topic_evaluation_v2_provider_outcome_unknown",outcome==="failed"?0:null]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      const terminal=(await client.query<{run_status:string;authority_status:string;settled:string|null}>(
        `SELECT run.status run_status,authority.status authority_status,run.settled_micro_usd::text settled
        FROM signal_topic_evaluation_v2_runs run JOIN signal_topic_evaluation_v2_execution_authorizations
        authority ON authority.id=run.execution_authorization_id WHERE run.id=$1::uuid`,
      [claimed.run_id])).rows[0]!;
      assert.deepEqual(terminal,{run_status:outcome,authority_status:outcome,
        settled:outcome==="failed"?"0":null});await client.query("ROLLBACK");
    }finally{client.release();}
  }

  const persistence=await pool.connect();
  try{
    await persistence.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const claimed=await createAndClaimSignalTopicEvaluationLabExecutionV2({queryable:persistence,
      ...input,idempotency_key:"lab2a.pg.persist.0001"});
    const trace=await runOfflineSignalTopicEvaluationV2({snapshot_digest:claimed.snapshot_digest,
      provider_calls_on_completion:"model_turns",limits:claimed.configuration.flight_card,
      navigate:(request)=>navigateSignalTopicEvaluationEvidenceV2({queryable:persistence,
        workspace_id:claimed.workspace_id,actor:{id:claimed.requested_by_user_id,
          user_type:"noisia_internal"},request}),model:{next:async(modelInput)=>{
        if(modelInput.turn_index===0)return{kind:"tool" as const,request:{operation:"evaluation_brief" as const}};
        if(modelInput.turn_index===1){
          const brief=modelInput.prior_results[0] as {data:{brand_os:{elements:unknown[]};shortlist:{clusters:unknown[]}}};
          assert.equal(brief.data.brand_os.elements.length>0,true);
          assert.equal(brief.data.shortlist.clusters.length>0&&brief.data.shortlist.clusters.length<=24,true);
          return{kind:"tool" as const,request:{operation:"representative_mentions" as const,
            cluster_key:clusterKey,limit:3,filters:{}}};
        }
        const prior=modelInput.prior_results[1] as {evidence_refs:string[]};const evidence=prior.evidence_refs[0]!;
        return{kind:"final" as const,json:JSON.stringify({
          contract_version:"signal-topic-evaluation-full-evidence-output-v2",
          candidates:[{candidate_key:"candidate.lab-proof",title:"Lab proof",
            description:"Pending editable local candidate",inclusion:["bounded evidence"],exclusion:[],
            explanation:"Derived only from the cited bounded evidence.",source_cluster_keys:[clusterKey],
            evidence_refs:[evidence],status:"pending"}],ranking:[{rank:1,
            candidate_key:"candidate.lab-proof",ranking_reason:"Bounded evidence proof"}]})};}}});
    await persistence.query(`UPDATE signal_topic_evaluation_v2_runs SET provider_call_count=$2
      WHERE id=$1::uuid`,[claimed.run_id,trace.provider_calls]);
    await persistence.query(`UPDATE signal_topic_evaluation_v2_execution_authorizations
      SET provider_call_count=$2 WHERE id=$1::uuid`,[claimed.execution_authorization_id,trace.provider_calls]);
    await persistSignalTopicEvaluationProviderTraceV2({client:persistence as never,run_id:claimed.run_id,
      workspace_id:claimed.workspace_id,snapshot_id:claimed.snapshot_id,
      execution_authorization_id:claimed.execution_authorization_id,trace});
    await persistence.query("SET CONSTRAINTS ALL IMMEDIATE");
    const result=(await persistence.query<{candidates:number;evidence:number;rankings:number;
      pending:number;adopted:number;published:number;serving:number}>(`SELECT
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE run_id=$1::uuid) candidates,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_evidence evidence
        JOIN signal_topic_evaluation_v2_candidates candidate ON candidate.id=evidence.candidate_id
        WHERE candidate.run_id=$1::uuid) evidence,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_rankings WHERE run_id=$1::uuid) rankings,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE run_id=$1::uuid
        AND status='pending') pending,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE run_id=$1::uuid
        AND adopted) adopted,(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates
        WHERE run_id=$1::uuid AND published) published,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE run_id=$1::uuid
        AND serving) serving`,[claimed.run_id])).rows[0]!;
    assert.deepEqual(result,{candidates:1,evidence:1,rankings:1,pending:1,adopted:0,published:0,serving:0});
    await persistence.query("ROLLBACK");
  }finally{persistence.release();}

  // The historical UAT profile still requires exactly one pending outbox and passes unchanged.
  const uat=await pool.connect();try{await uat.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const base=(await uat.query<{snapshot_id:string;workspace_id:string;actor_id:string}>(`SELECT
      snapshot.id::text snapshot_id,snapshot.workspace_id::text,
      snapshot.created_by_user_id::text actor_id FROM signal_topic_evaluation_v2_snapshots snapshot
      WHERE snapshot.state='frozen'`)).rows[0]!;
    const ids=(await uat.query<{authority_id:string;run_id:string}>(`SELECT gen_random_uuid()::text
      authority_id,gen_random_uuid()::text run_id`)).rows[0]!;
    const card=buildSignalTopicEvaluationExecutionFlightCardV2({provider_calls_allowed:1,
      max_model_turns:1,max_tool_calls:1,max_tool_result_bytes:32768,
      max_total_tool_result_bytes:32768,max_total_input_tokens:1000,max_total_output_tokens:100,
      hard_cap_micro_usd:4500});
    await uat.query(`INSERT INTO signal_topic_evaluation_v2_execution_authorizations(id,workspace_id,
      snapshot_id,requested_by_user_id,idempotency_key,authorization_key,confirmation,runtime_profile,
      provider,model,pricing_version,input_micro_usd_per_token,output_micro_usd_per_token,flight_card,
      flight_card_digest,reserved_micro_usd) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,
      'lab2a.uat.control','topic-v2-uat-control','AUTHORIZE_BOUNDED_FULL_EVIDENCE_TOPIC_EVALUATION',
      'uat','anthropic','claude-sonnet-5','fixture-v1',3,15,$5::jsonb,
      signal_semantic_context_digest_json_v2($5::jsonb),4500)`,[ids.authority_id,base.workspace_id,
      base.snapshot_id,base.actor_id,JSON.stringify(card)]);
    await uat.query(`INSERT INTO signal_topic_evaluation_v2_runs(id,workspace_id,snapshot_id,
      execution_authorization_id,requested_by_user_id,idempotency_key,run_key,confirmation,flight_card,
      flight_card_digest,provider_execution_enabled,reserved_micro_usd) VALUES($1::uuid,$2::uuid,$3::uuid,
      $4::uuid,$5::uuid,'lab2a.uat.control','topic-v2-uat-control-run',
      'AUTHORIZE_BOUNDED_FULL_EVIDENCE_TOPIC_EVALUATION',$6::jsonb,
      signal_semantic_context_digest_json_v2($6::jsonb),true,4500)`,[ids.run_id,base.workspace_id,
      base.snapshot_id,ids.authority_id,base.actor_id,JSON.stringify(card)]);
    await uat.query(`INSERT INTO signal_topic_evaluation_v2_execution_outbox(run_id,workspace_id,
      execution_authorization_id,outbox_key) VALUES($1::uuid,$2::uuid,$3::uuid,
      'topic-v2-uat-control-outbox')`,[ids.run_id,base.workspace_id,ids.authority_id]);
    await uat.query("SET CONSTRAINTS ALL IMMEDIATE");
    assert.equal((await uat.query<{count:number}>(`SELECT count(*)::int count FROM
      signal_topic_evaluation_v2_execution_outbox WHERE run_id=$1::uuid`,[ids.run_id])).rows[0]!.count,1);
    await uat.query("ROLLBACK");
  }finally{uat.release();}

  const after=await pool.query<{authorities:number;runs:number;outboxes:number;candidates:number}>(`SELECT
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_execution_authorizations) authorities,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_runs) runs,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_execution_outbox) outboxes,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates) candidates`);
  assert.deepEqual(after.rows[0],{authorities:0,runs:0,outboxes:0,candidates:0});
});
