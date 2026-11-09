import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import type {Pool} from "pg";
import {buildSignalTopicEditorialBatchPlanFromPreparedInputV2} from "@noisia/query-engine";
import {loadSignalTopicConsolidationEditorialInputV1} from "../signal-topic-consolidation-editorial-input";
import {quoteSignalTopicEditorialChunkedAdmissionV3,requestSignalTopicEditorialChunkedAdmissionV3} from "../signal-topic-editorial-admission-v3";
import {loadSyntheticBudgetTimezoneV1} from "./signal-workspace-topic-projection.fixture";
import {seedSignalTopicEditorialRenewalSourceV1} from "./signal-topic-editorial-renewal.synthetic.fixture";
import {loadSyntheticSiblingEditorialDeadlineV1,prepareSyntheticSiblingEditorialPolicyV1} from "./signal-mfp-mass-labeling-sibling.synthetic.fixture";

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
    // The primary context, embedding and engine admissions already use the
    // stable synthetic zone, before any downstream policy or sibling is made.
    const primary=(await query(`SELECT budget_timezone,extract(epoch FROM
      ((((created_at AT TIME ZONE budget_timezone)::date+1)::timestamp AT TIME ZONE 'America/Mexico_City')-created_at)) seconds_left
      FROM signal_processing_policy_versions WHERE organization_id=$1 ORDER BY version LIMIT 1`,[seed.identity.organization_id])).rows[0]!;
    assert.ok(Number(primary.seconds_left)>10*3600);
    assert.equal(seed.projection.budget.timezone,primary.budget_timezone);
    assert.equal((await query("SELECT count(*)::int n FROM signal_processing_admissions WHERE workspace_id=$1 AND budget_timezone<>$2",[seed.identity.workspace_id,primary.budget_timezone])).rows[0]!.n,0);
    assert.equal((await query("SELECT count(*)::int n FROM engine_cost_events WHERE workspace_id=$1 AND budget_timezone<>$2",[seed.identity.workspace_id,primary.budget_timezone])).rows[0]!.n,0);
    for(let hour=0;hour<24;hour++){
      const before=`2026-11-09T${String(hour).padStart(2,"0")}:59:59.900Z`;
      const timezone=await loadSyntheticBudgetTimezoneV1({query,at:before});
      const dates=(await query(`SELECT ($1::timestamptz AT TIME ZONE $2)::date::text before,
        (($1::timestamptz+interval '200 milliseconds') AT TIME ZONE $2)::date::text after,
        ($1::timestamptz AT TIME ZONE 'America/Mexico_City')::date::text mexico_before,
        (($1::timestamptz+interval '200 milliseconds') AT TIME ZONE 'America/Mexico_City')::date::text mexico_after`,[before,timezone])).rows[0]!;
      assert.equal(dates.before,dates.after,"the chosen fixed zone spans the complete setup across every UTC hour boundary");
      if(hour===5)assert.notEqual(dates.mexico_before,dates.mexico_after,"the old Mexico fixture really crosses a budget date at this boundary");
    }
    const policyUntil=(await query("SELECT (clock_timestamp()+interval '2 days')::text until")).rows[0]!.until;
    const policyId=await prepareSyntheticSiblingEditorialPolicyV1({database,scoped,query,cleanup:async()=>{},identity:seed.identity,
      policy_valid_until:policyUntil});
    const numeric=seed.scope.numeric_run_id;
    const scope=seed.scope;
    const input=await loadSignalTopicConsolidationEditorialInputV1(scope);
    const plan=buildSignalTopicEditorialBatchPlanFromPreparedInputV2({input,run_id:numeric});
    const signature="signal_topic_editorial_quote_fast_v2(uuid,uuid,uuid,text,integer,bigint)";
    original=(await query("SELECT pg_get_functiondef($1::regprocedure) definition",[signature])).rows[0]!.definition;
    assert.ok(original?.includes("clock_timestamp()"));
    // Only this rolled-back transaction controls the quote's clock and local
    // timezone input. The real source, actor, policy/cap and expiry predicates
    // stay intact; no persisted policy is retimed and no positive admission is
    // made from the simulated Mexico quote. The actual setup uses its stable zone.
    const freeze=async(epoch:number)=>{
      assert.ok(Number.isSafeInteger(epoch*1000));
      const timezoneAnchor="cap:=a.max_execution_micro_usd;day:=";
      assert.ok(original!.includes(timezoneAnchor));
      await query(original!.replaceAll("clock_timestamp()",`to_timestamp(${epoch.toFixed(3)})`)
        .replace(timezoneAnchor,"p.budget_timezone:='America/Mexico_City';"+timezoneAnchor));
    };
    const window=(await query(`WITH bounds AS (
      SELECT p.*,(((p.valid_from AT TIME ZONE 'America/Mexico_City')::date+1)::timestamp AT TIME ZONE 'America/Mexico_City')-interval '18 minutes' first_clock
      FROM signal_processing_policy_versions p WHERE p.id=$1
    ) SELECT floor(extract(epoch FROM CASE WHEN first_clock<=valid_from THEN first_clock+interval '1 day' ELSE first_clock END))::bigint::text midnight_clock,
      floor(extract(epoch FROM valid_until))::bigint::text policy_end FROM bounds`,[policyId])).rows[0]!;
    const midnightClock=Number(window.midnight_clock),policyEnd=Number(window.policy_end);
    const quote=(deadline:number)=>quoteSignalTopicEditorialChunkedAdmissionV3({...scope,plan,deadline});
    await freeze(midnightClock);
    const dayEnd=Number((await query(`SELECT floor(extract(epoch FROM (((to_timestamp($2) AT TIME ZONE 'America/Mexico_City')::date+1)::timestamp AT TIME ZONE 'America/Mexico_City')))::bigint::text epoch
      FROM signal_processing_policy_versions WHERE id=$1`,[policyId,midnightClock])).rows[0]!.epoch);
    assert.equal(dayEnd-midnightClock,18*60,"the controlled clock reproduces the final half-hour of the policy's local day");
    assert.equal((await quote(midnightClock+1800)).status,"quote_expired","the original fixture deadline crosses midnight and remains rejected");
    const bounded=await loadSyntheticSiblingEditorialDeadlineV1({query,policy_id:policyId,budget_timezone:"America/Mexico_City",at:new Date(midnightClock*1000).toISOString()});
    assert.equal(bounded,Math.min(midnightClock+1800,policyEnd,dayEnd));
    const accepted=await quote(bounded);
    assert.equal(accepted.status,"ready_to_authorize");assert.equal(accepted.provider_execution_enabled,false);
    assert.equal((await quote(dayEnd+1)).status,"quote_expired");
    assert.equal((await quote(midnightClock)).status,"quote_expired","a non-future deadline never obtains a quote");
    await freeze(dayEnd-.25);
    const justBefore=await quote(dayEnd);assert.equal(justBefore.status,"ready_to_authorize");
    const admissionsBefore=(await query("SELECT count(*)::int n FROM signal_processing_admissions WHERE workspace_id=$1",[scope.workspace_id])).rows[0]!.n;
    await freeze(dayEnd+.001);
    assert.equal((await quote(bounded)).status,"quote_expired","the previously valid deadline expires at the budget rollover");
    await assert.rejects(requestSignalTopicEditorialChunkedAdmissionV3({...scope,plan,idempotency_key:randomUUID(),quote_reference:justBefore.quote_reference!}),/topic_editorial_quote_stale/,
      "a quote issued 250ms before midnight cannot create an admission after midnight");
    assert.equal((await query("SELECT count(*)::int n FROM signal_processing_admissions WHERE workspace_id=$1",[scope.workspace_id])).rows[0]!.n,admissionsBefore);
    await freeze(policyEnd-1);
    const expiryBound=await loadSyntheticSiblingEditorialDeadlineV1({query,policy_id:policyId,budget_timezone:"America/Mexico_City",at:new Date((policyEnd-1)*1000).toISOString()});
    assert.ok(expiryBound<=policyEnd);assert.equal((await quote(expiryBound)).status,"ready_to_authorize");
    assert.equal((await quote(policyEnd+1)).status,"quote_expired","the policy expiry is not extended for the synthetic owner");
    await freeze(policyEnd+1);
    assert.equal((await quote(policyEnd+2)).status,"policy_required");
    await assert.rejects(loadSyntheticSiblingEditorialDeadlineV1({query,policy_id:policyId,budget_timezone:"America/Mexico_City",at:new Date((policyEnd+1)*1000).toISOString()}),/requires a live policy/);
    assert.equal((await query("SELECT count(*)::int n FROM signal_topic_editorial_calls WHERE workspace_id=$1",[scope.workspace_id])).rows[0]!.n,0);
  }finally{
    try{
      await raw.query("ROLLBACK");
      if(original)assert.equal((await raw.query("SELECT pg_get_functiondef('signal_topic_editorial_quote_fast_v2(uuid,uuid,uuid,text,integer,bigint)'::regprocedure) definition")).rows[0]!.definition,original,
        "the controlled clock and every synthetic row are physically rolled back");
    }finally{raw.release();await pool.end();}
  }
});
