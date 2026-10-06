/** Runner-only acceptance: real labeling store SQL on disposable PostgreSQL temp tables. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createSignalLabelingStoreV1, type LabelingRunV1, type LabelingCallV1 } from "../../infrastructure/db/signal-labeling-runs";
import {runMentionFacetsTickV1} from "../../services/workers/src/workers/signal-mention-facets-batch";
import {runConceptMembershipTickV1} from "../../services/workers/src/workers/signal-concept-membership-batch";
import { main, openDatabase } from "./guard.mjs";

await main(async()=>{
  const pool=await openDatabase(),client=await pool.connect();
  let stage="setup";
  try{
    await client.query("SET search_path TO pg_temp,public");
    await client.query(`CREATE TEMP TABLE signal_labeling_runs (
      id uuid PRIMARY KEY,lease_token uuid,lease_until timestamptz,status text,error_code text,
      kind text NOT NULL DEFAULT 'membership',waiting_full_confirmation boolean NOT NULL DEFAULT false,
      labeler_version_id uuid,workspace_id uuid,entity_context_version_no integer DEFAULT 1,
      next_poll_at timestamptz,cursor_root_id uuid,counts jsonb DEFAULT '{}'::jsonb,
      completed_at timestamptz,updated_at timestamptz DEFAULT now())`);
    await client.query(`CREATE TEMP TABLE signal_labeler_versions (id uuid PRIMARY KEY,labeler_digest text,identity jsonb)`);
    await client.query(`CREATE TEMP TABLE signal_entity_context_versions (workspace_id uuid,version_no integer,context jsonb)`);
    await client.query(`CREATE TEMP TABLE signal_labeling_calls (
      id uuid PRIMARY KEY,run_id uuid,status text NOT NULL,results_applied boolean NOT NULL DEFAULT false,
      results jsonb,raw_storage_key text,stop_reason text,reserved_micro_usd bigint NOT NULL,
      settled_micro_usd bigint,provider_batch_id text,custom_id text,created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now())`);
    const {rows:[fixture]}=await client.query(`SELECT 'signal_labeling_calls'::regclass='pg_temp.signal_labeling_calls'::regclass isolated`);
    assert.equal(fixture.isolated,true);
    const database={connect:async()=>({query:client.query.bind(client),release(){}}),query:client.query.bind(client)};
    const store=createSignalLabelingStoreV1({database:database as never,storeRaw:async()=>"unused",
      adapter:{kind:"membership",inputs:async()=>[],pending:async()=>0,write:async()=>{}}});
    for(const error of ["provider_usage_invalid","provider_result_missing"]){
      stage=`finish_${error}`;
      const id=randomUUID(),lease=randomUUID(),callId=randomUUID();
      await client.query(`INSERT INTO signal_labeling_runs(id,lease_token,lease_until,status,error_code)
        VALUES($1,$2,now()+interval '5 minutes','running','labeling_outcome_unknown')`,[id,lease]);
      await client.query(`INSERT INTO signal_labeling_calls(id,run_id,status,results_applied,results,reserved_micro_usd,custom_id)
        VALUES($1,$2,'unknown',true,$3::jsonb,83,$4)`,[callId,id,JSON.stringify([{error_code:error}]),`fixture-${callId}`]);
      const run={id,lease_token:lease,workspace_id:randomUUID()} as LabelingRunV1;
      assert.equal(await store.finish(run),"failed");
      const {rows:[call]}=await client.query(`SELECT status,stop_reason,settled_micro_usd::text FROM signal_labeling_calls WHERE id=$1`,[callId]);
      assert.deepEqual(call,{status:"failed",stop_reason:error,settled_micro_usd:"83"});
      const {rows:[state]}=await client.query(`SELECT status,error_code FROM signal_labeling_runs WHERE id=$1`,[id]);
      assert.deepEqual(state,{status:"failed",error_code:`labeling_${error}`});
    }
    const id=randomUUID(),lease=randomUUID(),callId=randomUUID();
    stage="release_unknown";
    await client.query(`INSERT INTO signal_labeling_runs(id,lease_token,lease_until,status,error_code)
      VALUES($1,$2,now()+interval '5 minutes','running','labeling_outcome_unknown')`,[id,lease]);
    await client.query(`INSERT INTO signal_labeling_calls(id,run_id,status,reserved_micro_usd,custom_id)
      VALUES($1,$2,'unknown',17,$3)`,[callId,id,`fixture-${callId}`]);
    const run={id,lease_token:lease} as LabelingRunV1,call={id:callId} as LabelingCallV1;
    await store.releaseUnknown(run,[call],"unresolvable_after_window");
    const refreshed=await store.refresh(run);
    assert.deepEqual(refreshed,{status:"running",error_code:"labeling_unresolvable_after_window"});
    const {rows:[released]}=await client.query(`SELECT status,results_applied FROM signal_labeling_calls WHERE id=$1`,[callId]);
    assert.deepEqual(released,{status:"failed",results_applied:true});
    for(const kind of ["facets","membership"] as const){
      stage=`tick_${kind}`;
      const tickId=randomUUID(),workspaceId=randomUUID(),labelerId=randomUUID(),tickCallId=randomUUID();
      await client.query(`INSERT INTO signal_labeler_versions(id,labeler_digest,identity)
        VALUES($1,'fixture-labeler','{}'::jsonb)`,[labelerId]);
      await client.query(`INSERT INTO signal_entity_context_versions(workspace_id,version_no,context)
        VALUES($1,1,'{"entities":[]}'::jsonb)`,[workspaceId]);
      await client.query(`INSERT INTO signal_labeling_runs(id,status,kind,labeler_version_id,workspace_id,entity_context_version_no)
        VALUES($1,'queued',$2,$3,$4,1)`,[tickId,kind,labelerId,workspaceId]);
      await client.query(`INSERT INTO signal_labeling_calls(id,run_id,status,reserved_micro_usd,custom_id,created_at,updated_at)
        VALUES($1,$2,'unknown',17,$3,now()-interval '27 hours',now()-interval '26 hours')`,
        [tickCallId,tickId,`fixture-${tickCallId}`]);
      const tickStore=createSignalLabelingStoreV1({database:database as never,storeRaw:async()=>"unused",
        adapter:{kind,inputs:async()=>[{root_id:randomUUID(),input_digest:"fixture",text:"fixture"}] as never,
          pending:async()=>1,write:async()=>{}}});
      let providerCalls=0;
      const provider={list:async()=>({data:[],has_more:false,last_id:null}),
        get:async()=>{providerCalls++;throw new Error("unexpected_get");},
        create:async()=>{providerCalls++;throw new Error("unexpected_create");},
        results:async function*(){providerCalls++;throw new Error("unexpected_results");}};
      const tick=kind==="facets"
        ?await runMentionFacetsTickV1({run_id:tickId,store:tickStore as never,provider:provider as never})
        :await runConceptMembershipTickV1({run_id:tickId,store:tickStore as never,provider:provider as never});
      assert.equal(tick.status,"running");
      assert.equal(providerCalls,0);
      const {rows:[tickCalls]}=await client.query(`SELECT count(*)::int n,count(*) FILTER(WHERE status='failed')::int failed
        FROM signal_labeling_calls WHERE run_id=$1`,[tickId]);
      assert.deepEqual(tickCalls,{n:1,failed:1});
    }
    console.log(JSON.stringify({status:"passed",cases:5,provider_calls:0,cost_micro_usd:0}));
  }catch(error){
    console.error(JSON.stringify({status:"check_failed",stage,code:(error as {code?:string}).code??null,
      message:error instanceof Error?error.message.slice(0,180):"unknown"}));
    throw error;
  }finally{client.release();await pool.end();}
});
