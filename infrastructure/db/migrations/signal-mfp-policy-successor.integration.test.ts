import assert from "node:assert/strict";
import test from "node:test";
import type {Pool} from "pg";
import {randomUUID} from "node:crypto";
import {SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1} from "@noisia/query-engine";
import {provisionSignalBrandContextPolicyV1} from "../signal-brand-context-policy-provisioning";
import {createProcessingPolicyIdentitiesV1} from "./signal-processing-policy.fixture";

test("MFP policy successor keeps existing actions and caps inside a rolled-back PG fixture",{
  skip:process.env.NOISIA_MFP_POLICY_SUCCESSOR_PG_TEST!=="true",timeout:120_000
},async()=>{
  const {openDatabase}=await import(new URL("../../../scripts/dev-corpus/guard.mjs",import.meta.url).href);
  const pool:Pool=await openDatabase(),raw=await pool.connect();
  const censusSql=`SELECT jsonb_build_object(
    'organizations',(SELECT count(*) FROM organizations),
    'brands',(SELECT count(*) FROM brands),
    'workspaces',(SELECT count(*) FROM signal_workspaces),
    'users',(SELECT count(*) FROM users),
    'policies',(SELECT count(*) FROM signal_processing_policy_versions),
    'actions',(SELECT count(*) FROM signal_processing_policy_actions),
    'admissions',(SELECT count(*) FROM signal_processing_admissions),
    'preparation_runs',(SELECT count(*) FROM signal_corpus_preparation_runs),
    'features',(SELECT count(*) FROM signal_workspace_features)) census`;
  const censusBefore=(await raw.query(censusSql)).rows[0].census;
  try{
    await raw.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    const identities=await createProcessingPolicyIdentitiesV1({database:pool,scoped:raw});
    const fixture={workspace_id:identities.first.workspace_id,brand_id:identities.first.brand_id,
      initiator_id:identities.actors.firstAdmin,creator_id:identities.actors.internal,
      policy_id:randomUUID(),version:"1",valid_until:"infinity",budget_timezone:"UTC",daily_cap_micro_usd:"1100000"};
    await raw.query(`UPDATE signal_workspaces SET metadata=metadata||jsonb_build_object(
      'created_by_user_id',$2::text,'creation_request_digest','sha256:'||repeat('a',64)) WHERE id=$1::uuid`,
      [fixture.workspace_id,fixture.initiator_id]);
    await raw.query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,status,valid_from,valid_until,
      budget_timezone,daily_cap_micro_usd,created_by_user_id)
      VALUES($1,$2,1,'draft',clock_timestamp()-interval '1 minute',$3,'UTC',1100000,$4)`,
      [fixture.policy_id,identities.first.organization_id,fixture.valid_until,fixture.creator_id]);
    await raw.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,
      configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
      VALUES($1,'topic_prototype_embeddings','provider','voyage','voyage-4-large',$2::jsonb,
        signal_semantic_context_digest_json_v2($2::jsonb),100000,false)`,
      [fixture.policy_id,JSON.stringify(SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1)]);
    await raw.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,configuration,
      configuration_digest,max_execution_micro_usd,automatic_allowed)
      VALUES($1,'corpus_preparation','free','{}',signal_semantic_context_digest_json_v2('{}'::jsonb),0,false)`,[fixture.policy_id]);
    await raw.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[fixture.policy_id]);
    const before=(await raw.query<{action:string}>("SELECT action FROM signal_processing_policy_actions WHERE policy_version_id=$1 ORDER BY action",[fixture.policy_id])).rows.map(r=>r.action);
    const policyCount=(await raw.query("SELECT count(*)::int n FROM signal_processing_policy_versions WHERE organization_id=(SELECT organization_id FROM signal_processing_policy_versions WHERE id=$1)",[fixture.policy_id])).rows[0].n;
    let inSavepoint=false;
    const query=async(sql:string,params?:unknown[])=>{
      if(sql.startsWith("BEGIN")){assert.equal(inSavepoint,false);inSavepoint=true;return raw.query("SAVEPOINT mfp_policy_successor");}
      if(sql==="COMMIT"){assert.equal(inSavepoint,true);inSavepoint=false;return raw.query("RELEASE SAVEPOINT mfp_policy_successor");}
      if(sql==="ROLLBACK"){assert.equal(inSavepoint,true);inSavepoint=false;await raw.query("ROLLBACK TO SAVEPOINT mfp_policy_successor");
        return raw.query("RELEASE SAVEPOINT mfp_policy_successor");}
      return raw.query(sql,params);
    };
    const database={connect:async()=>({query,release(){}})} as unknown as Parameters<typeof provisionSignalBrandContextPolicyV1>[0]["database"];
    const invoke=(env:Record<string,string>)=>provisionSignalBrandContextPolicyV1({database,workspace_id:fixture.workspace_id,
      brand_id:fixture.brand_id,initiator_user_id:fixture.initiator_id,env:{NOISIA_MENTION_FACETS_ENABLED:"true",
        NOISIA_BRAND_CONTEXT_POLICY_CREATOR_USER_ID:fixture.creator_id,...env}});
    const policySnapshotSql=`SELECT to_jsonb(p) policy,
      (SELECT jsonb_agg(to_jsonb(a) ORDER BY action) FROM signal_processing_policy_actions a WHERE a.policy_version_id=p.id) actions
      FROM signal_processing_policy_versions p WHERE p.id=$1`;
    const policyBefore=(await raw.query(policySnapshotSql,[fixture.policy_id])).rows;
    assert.equal((await invoke({})).status,"existing_policy","a brand without workspace opt-in leaves the organization policy untouched");
    assert.equal((await raw.query("SELECT count(*)::int n FROM signal_processing_policy_versions WHERE organization_id=(SELECT organization_id FROM signal_processing_policy_versions WHERE id=$1)",[fixture.policy_id])).rows[0].n,policyCount);
    assert.deepEqual((await raw.query(policySnapshotSql,[fixture.policy_id])).rows,policyBefore);
    await raw.query(`INSERT INTO signal_workspace_features(workspace_id,feature,enabled_by)
      VALUES($1::uuid,'mention_facets',$2::uuid)`,[fixture.workspace_id,fixture.creator_id]);
    // Use the real provider-free admission path. Prototype embeddings require a
    // composed Brand Context receipt and are not a standalone admission action.
    // The in-flight work belongs to a sibling brand without MFP opt-in.
    const runId=randomUUID();
    const admissionResult=(await raw.query<{result:{receipt:{id:string;policy_version_id:string;target_id:string}}}>(`SELECT admit_signal_processing_v1(
      $1::uuid,$2::uuid,'corpus_preparation',$3::uuid,$4,'sha256:'||repeat('a',64),0,false) result`,
      [identities.second.workspace_id,identities.actors.secondAdmin,runId,randomUUID()])).rows[0]!.result;
    const admitted=admissionResult.receipt;
    assert.equal(admitted.policy_version_id,fixture.policy_id);
    assert.equal(admitted.target_id,runId);
    assert.equal((await raw.query("SELECT admission_not_after::text deadline FROM signal_processing_admissions WHERE id=$1",[admitted.id])).rows[0].deadline,
      "infinity","the real MFP admission inherits an unlimited policy window");
    await raw.query("SAVEPOINT ownerless_receipt");
    assert.equal((await invoke({})).status,"provisioned","an ownerless receipt does not block a successor");
    await raw.query("ROLLBACK TO SAVEPOINT ownerless_receipt");
    await raw.query("RELEASE SAVEPOINT ownerless_receipt");
    assert.deepEqual((await raw.query(policySnapshotSql,[fixture.policy_id])).rows,policyBefore);
    // A real owner exercises its admission/actor/capacity triggers too; no table
    // shadowing or synthetic owner bypasses the production contract.
    await raw.query(`INSERT INTO signal_corpus_preparation_runs(id,workspace_id,actor_user_id,
      processing_admission_id,status,worker_job_id)
      VALUES($1,$2,$3,$4,'running',$5)`,[runId,identities.second.workspace_id,identities.actors.secondAdmin,admitted.id,`mfp-policy-${runId}`]);
    assert.equal((await invoke({})).status,"configuration_required",
      "an active owner keeps the admitted policy in force");
    assert.deepEqual((await raw.query(policySnapshotSql,[fixture.policy_id])).rows,policyBefore);
    for(const terminal of ["failed","canceled"]){
      await raw.query(`SAVEPOINT terminal_owner_case`);
      await raw.query("UPDATE signal_corpus_preparation_runs SET status=$2 WHERE id=$1",[runId,terminal]);
      assert.equal((await invoke({})).status,"provisioned",
        `${terminal} work must not keep an infinite admission pending`);
      await raw.query("ROLLBACK TO SAVEPOINT terminal_owner_case");
      await raw.query("RELEASE SAVEPOINT terminal_owner_case");
      assert.deepEqual((await raw.query(policySnapshotSql,[fixture.policy_id])).rows,policyBefore);
    }
    await raw.query(`UPDATE signal_corpus_preparation_runs SET status='completed',phase='complete',
      input_revision=1,completed_at=clock_timestamp() WHERE id=$1`,[runId]);
    // The immutable receipt is unexpired, but its terminal owner permits a successor.
    assert.equal((await invoke({NOISIA_MFP_PROCESSING_DAILY_CAP_MICRO_USD:"1"})).status,"configuration_required",
      "a lower organization cap cannot strand the sibling's inherited prototype action");
    assert.equal((await invoke({NOISIA_MFP_PROCESSING_DAILY_CAP_MICRO_USD:"100000"})).status,"provisioned");
    const successor=(await raw.query<{id:string;version:string;valid_until:string;budget_timezone:string;daily_cap_micro_usd:string|null}>(`
      SELECT id::text,version::text,valid_until::text,budget_timezone,daily_cap_micro_usd::text
      FROM signal_processing_policy_versions WHERE id<>$1 AND organization_id=(SELECT organization_id FROM signal_processing_policy_versions WHERE id=$1)
        AND status='active'`,[fixture.policy_id])).rows[0];
    assert.ok(successor);
    assert.equal(Number(successor.version),Number(fixture.version)+1);
    assert.equal(successor.valid_until,fixture.valid_until);
    assert.equal(successor.budget_timezone,fixture.budget_timezone);
    assert.equal(successor.daily_cap_micro_usd,"100000","explicit strict cap applies without stranding an inherited action");
    const after=(await raw.query<{action:string}>("SELECT action FROM signal_processing_policy_actions WHERE policy_version_id=$1 ORDER BY action",[successor.id])).rows.map(r=>r.action);
    for(const action of before)assert.ok(after.includes(action),`prior action removed: ${action}`);
    for(const action of ["corpus_preparation","corpus_embeddings","topic_fit_incremental","topic_interpretation",
      "topic_consolidation_numeric","topic_consolidation","mention_facets","concept_membership"])
      assert.ok(after.includes(action),`MFP action missing: ${action}`);
    assert.equal((await raw.query("SELECT status FROM signal_processing_policy_versions WHERE id=$1",[fixture.policy_id])).rows[0].status,"revoked");
    await raw.query("ROLLBACK");
    assert.deepEqual((await pool.query(censusSql)).rows[0].census,censusBefore,"rollback restores the database census");
    assert.equal((await pool.query("SELECT count(*)::int n FROM signal_processing_policy_versions WHERE id=$1",[fixture.policy_id])).rows[0].n,0);
    assert.equal((await pool.query("SELECT count(*)::int n FROM signal_workspace_features WHERE workspace_id=$1 AND feature='mention_facets'",[fixture.workspace_id])).rows[0].n,0);
    console.log(JSON.stringify({status:"passed",gate:"mfp_policy_successor",real_admission:true,admission_deadline:"infinity",
      terminal_owners:["failed","canceled","completed"],rollback_census:"unchanged",provider_calls:0}));
  }finally{await raw.query("ROLLBACK").catch(()=>undefined);raw.release();await pool.end();}
});
