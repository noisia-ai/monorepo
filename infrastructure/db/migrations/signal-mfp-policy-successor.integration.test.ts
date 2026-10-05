import assert from "node:assert/strict";
import test from "node:test";
import type {Pool} from "pg";
import {provisionSignalBrandContextPolicyV1} from "../signal-brand-context-policy-provisioning";

test("MFP policy successor keeps existing actions and caps inside a rolled-back PG fixture",{
  skip:process.env.NOISIA_MFP_POLICY_SUCCESSOR_PG_TEST!=="true",timeout:120_000
},async()=>{
  const {openDatabase}=await import(new URL("../../../scripts/dev-corpus/guard.mjs",import.meta.url).href);
  const pool:Pool=await openDatabase(),raw=await pool.connect();
  try{
    await raw.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    const fixture=(await raw.query<{workspace_id:string;brand_id:string;initiator_id:string;creator_id:string;
      policy_id:string;version:string;valid_until:string;budget_timezone:string;daily_cap_micro_usd:string|null}>(`
      SELECT w.id::text workspace_id,w.brand_id::text brand_id,u.id::text initiator_id,
        p.created_by_user_id::text creator_id,p.id::text policy_id,p.version::text,
        p.valid_until::text,p.budget_timezone,p.daily_cap_micro_usd::text
      FROM signal_workspaces w JOIN users u ON u.id=(w.metadata->>'created_by_user_id')::uuid
      JOIN user_brand_access grant_access ON grant_access.user_id=u.id AND grant_access.brand_id=w.brand_id
        AND grant_access.access_level='admin' AND grant_access.revoked_at IS NULL
      JOIN signal_processing_policy_versions p ON p.organization_id=w.organization_id AND p.status='active'
      WHERE w.status='active' AND u.status='active' AND u.user_type='client' AND u.primary_role='client_admin'
        AND NOT EXISTS(SELECT 1 FROM signal_workspace_features f WHERE f.workspace_id=w.id AND f.feature='mention_facets')
        AND NOT EXISTS(SELECT 1 FROM signal_processing_policy_actions a WHERE a.policy_version_id=p.id AND a.action='topic_fit_incremental')
      ORDER BY w.id LIMIT 1`)).rows[0];
    assert.ok(fixture,"requires a sealed client workspace with an active partial/legacy policy and no opt-in");
    const before=(await raw.query<{action:string}>("SELECT action FROM signal_processing_policy_actions WHERE policy_version_id=$1 ORDER BY action",[fixture.policy_id])).rows.map(r=>r.action);
    await raw.query(`INSERT INTO signal_workspace_features(workspace_id,feature,enabled_by)
      VALUES($1::uuid,'mention_facets',$2::uuid)`,[fixture.workspace_id,fixture.creator_id]);
    let inSavepoint=false;
    const query=async(sql:string,params?:unknown[])=>{
      if(sql.startsWith("BEGIN")){assert.equal(inSavepoint,false);inSavepoint=true;return raw.query("SAVEPOINT mfp_policy_successor");}
      if(sql==="COMMIT"){assert.equal(inSavepoint,true);inSavepoint=false;return raw.query("RELEASE SAVEPOINT mfp_policy_successor");}
      if(sql==="ROLLBACK"){assert.equal(inSavepoint,true);inSavepoint=false;await raw.query("ROLLBACK TO SAVEPOINT mfp_policy_successor");
        return raw.query("RELEASE SAVEPOINT mfp_policy_successor");}
      return raw.query(sql,params);
    };
    const database={connect:async()=>({query,release(){}})} as unknown as Parameters<typeof provisionSignalBrandContextPolicyV1>[0]["database"];
    assert.equal((await provisionSignalBrandContextPolicyV1({database,workspace_id:fixture.workspace_id,
      brand_id:fixture.brand_id,initiator_user_id:fixture.initiator_id,env:{
        NOISIA_MENTION_FACETS_ENABLED:"true",NOISIA_BRAND_CONTEXT_POLICY_CREATOR_USER_ID:fixture.creator_id
      }})).status,"provisioned");
    const successor=(await raw.query<{id:string;version:string;valid_until:string;budget_timezone:string;daily_cap_micro_usd:string|null}>(`
      SELECT id::text,version::text,valid_until::text,budget_timezone,daily_cap_micro_usd::text
      FROM signal_processing_policy_versions WHERE id<>$1 AND organization_id=(SELECT organization_id FROM signal_processing_policy_versions WHERE id=$1)
        AND status='active'`,[fixture.policy_id])).rows[0];
    assert.ok(successor);
    assert.equal(Number(successor.version),Number(fixture.version)+1);
    assert.equal(successor.valid_until,fixture.valid_until);
    assert.equal(successor.budget_timezone,fixture.budget_timezone);
    assert.equal(successor.daily_cap_micro_usd,fixture.daily_cap_micro_usd);
    const after=(await raw.query<{action:string}>("SELECT action FROM signal_processing_policy_actions WHERE policy_version_id=$1 ORDER BY action",[successor.id])).rows.map(r=>r.action);
    for(const action of before)assert.ok(after.includes(action),`prior action removed: ${action}`);
    for(const action of ["corpus_preparation","corpus_embeddings","topic_fit_incremental","topic_interpretation",
      "topic_consolidation_numeric","topic_consolidation","mention_facets","concept_membership"])
      assert.ok(after.includes(action),`MFP action missing: ${action}`);
    assert.equal((await raw.query("SELECT status FROM signal_processing_policy_versions WHERE id=$1",[fixture.policy_id])).rows[0].status,"revoked");
    await raw.query("ROLLBACK");
    assert.equal((await pool.query("SELECT status FROM signal_processing_policy_versions WHERE id=$1",[fixture.policy_id])).rows[0].status,"active");
    assert.equal((await pool.query("SELECT count(*)::int n FROM signal_workspace_features WHERE workspace_id=$1 AND feature='mention_facets'",[fixture.workspace_id])).rows[0].n,0);
  }finally{await raw.query("ROLLBACK").catch(()=>undefined);raw.release();await pool.end();}
});
