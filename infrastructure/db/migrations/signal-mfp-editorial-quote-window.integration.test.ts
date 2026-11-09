import assert from "node:assert/strict";
import test from "node:test";
import type {Pool} from "pg";
import {buildSignalTopicEditorialBatchPlanFromPreparedInputV2} from "@noisia/query-engine";
import {loadSignalTopicConsolidationEditorialInputV1} from "../signal-topic-consolidation-editorial-input";
import {quoteSignalTopicEditorialChunkedAdmissionV3} from "../signal-topic-editorial-admission-v3";
import {seedSignalTopicEditorialRenewalSourceV1} from "./signal-topic-editorial-renewal.synthetic.fixture";
import {loadSyntheticSiblingEditorialDeadlineV1,seedMassLabelingSiblingEditorialV1} from "./signal-mfp-mass-labeling-sibling.synthetic.fixture";

test("synthetic editorial quote respects the native budget midnight and policy expiry under a controlled clock", {
  skip:process.env.NOISIA_MFP_PG_CI!=="true",timeout:180_000,
},async()=>{
  const {openDatabase}=await import(new URL("../../../scripts/dev-corpus/guard.mjs",import.meta.url).href);
  const pool:Pool=await openDatabase(),raw=await pool.connect();
  let original:string|undefined;
  try{
    await raw.query("BEGIN");
    let sequence=0;const stack:string[]=[];
    const query=async(sql:string,values?:unknown[])=>{
      if(sql.startsWith("BEGIN")){const save=`quote_window_${++sequence}`;stack.push(save);return raw.query(`SAVEPOINT ${save}`);}
      if(sql==="COMMIT")return raw.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
      if(sql==="ROLLBACK"){const save=stack.pop()!;await raw.query(`ROLLBACK TO SAVEPOINT ${save}`);return raw.query(`RELEASE SAVEPOINT ${save}`);}
      if(sql.startsWith("SET TRANSACTION"))return raw.query("SELECT 1");
      return raw.query(sql,values);
    };
    const scoped=Object.assign(Object.create(raw),{query,release(){}});
    const database=Object.assign(Object.create(pool),{query,connect:async()=>scoped}) as Pool;
    const seed=await seedSignalTopicEditorialRenewalSourceV1({database,scoped,query,cleanup:async()=>{}});
    const policyUntil=(await query("SELECT (clock_timestamp()+interval '2 days')::text until")).rows[0]!.until;
    const owner=await seedMassLabelingSiblingEditorialV1({database,scoped,query,cleanup:async()=>{},identity:seed.identity,
      policy_valid_until:policyUntil});
    const numeric=(await query("SELECT numeric_run_id FROM signal_topic_editorial_executions WHERE id=$1",[owner.execution_id])).rows[0]!.numeric_run_id;
    const scope={database,workspace_id:owner.workspace_id,actor_user_id:owner.actor_user_id,numeric_run_id:numeric};
    const input=await loadSignalTopicConsolidationEditorialInputV1(scope);
    const plan=buildSignalTopicEditorialBatchPlanFromPreparedInputV2({input,run_id:numeric});
    const signature="signal_topic_editorial_quote_fast_v2(uuid,uuid,uuid,text,integer,bigint)";
    original=(await query("SELECT pg_get_functiondef($1::regprocedure) definition",[signature])).rows[0]!.definition;
    assert.ok(original?.includes("clock_timestamp()"));
    // Only this rolled-back synthetic transaction replaces the quote's clock.
    // Its native source, actor, policy, cap, day and expiry predicates stay intact.
    const freeze=async(epoch:number)=>{
      assert.ok(Number.isSafeInteger(epoch));
      await query(original!.replaceAll("clock_timestamp()",`to_timestamp(${epoch})`));
    };
    const window=(await query(`WITH bounds AS (
      SELECT p.*,(((p.valid_from AT TIME ZONE p.budget_timezone)::date+1)::timestamp AT TIME ZONE p.budget_timezone)-interval '18 minutes' first_clock
      FROM signal_processing_policy_versions p WHERE p.id=$1
    ) SELECT floor(extract(epoch FROM CASE WHEN first_clock<=valid_from THEN first_clock+interval '1 day' ELSE first_clock END))::bigint::text midnight_clock,
      floor(extract(epoch FROM valid_until))::bigint::text policy_end FROM bounds`,[owner.policy_id])).rows[0]!;
    const midnightClock=Number(window.midnight_clock),policyEnd=Number(window.policy_end);
    const quote=(deadline:number)=>quoteSignalTopicEditorialChunkedAdmissionV3({...scope,plan,deadline});
    await freeze(midnightClock);
    const dayEnd=Number((await query(`SELECT floor(extract(epoch FROM (((to_timestamp($2) AT TIME ZONE budget_timezone)::date+1)::timestamp AT TIME ZONE budget_timezone)))::bigint::text epoch
      FROM signal_processing_policy_versions WHERE id=$1`,[owner.policy_id,midnightClock])).rows[0]!.epoch);
    assert.equal(dayEnd-midnightClock,18*60,"the controlled clock reproduces the final half-hour of the policy's local day");
    assert.equal((await quote(midnightClock+1800)).status,"quote_expired","the original fixture deadline crosses midnight and remains rejected");
    const bounded=await loadSyntheticSiblingEditorialDeadlineV1({query,policy_id:owner.policy_id,at:new Date(midnightClock*1000).toISOString()});
    assert.equal(bounded,Math.min(midnightClock+1800,policyEnd,dayEnd));
    const accepted=await quote(bounded);
    assert.equal(accepted.status,"ready_to_authorize");assert.equal(accepted.provider_execution_enabled,false);
    assert.equal((await quote(dayEnd+1)).status,"quote_expired");
    assert.equal((await quote(midnightClock)).status,"quote_expired","a non-future deadline never obtains a quote");
    await freeze(dayEnd);
    assert.equal((await quote(bounded)).status,"quote_expired","the previously valid deadline expires at the budget rollover");
    await freeze(policyEnd-1);
    const expiryBound=await loadSyntheticSiblingEditorialDeadlineV1({query,policy_id:owner.policy_id,at:new Date((policyEnd-1)*1000).toISOString()});
    assert.ok(expiryBound<=policyEnd);assert.equal((await quote(expiryBound)).status,"ready_to_authorize");
    assert.equal((await quote(policyEnd+1)).status,"quote_expired","the policy expiry is not extended for the synthetic owner");
    await freeze(policyEnd+1);
    assert.equal((await quote(policyEnd+2)).status,"policy_required");
    await assert.rejects(loadSyntheticSiblingEditorialDeadlineV1({query,policy_id:owner.policy_id,at:new Date((policyEnd+1)*1000).toISOString()}),/requires a live policy/);
    assert.equal((await query("SELECT count(*)::int n FROM signal_topic_editorial_calls WHERE execution_id=$1",[owner.execution_id])).rows[0]!.n,0);
  }finally{
    try{
      await raw.query("ROLLBACK");
      if(original)assert.equal((await raw.query("SELECT pg_get_functiondef('signal_topic_editorial_quote_fast_v2(uuid,uuid,uuid,text,integer,bigint)'::regprocedure) definition")).rows[0]!.definition,original,
        "the controlled clock and every synthetic row are physically rolled back");
    }finally{raw.release();await pool.end();}
  }
});
