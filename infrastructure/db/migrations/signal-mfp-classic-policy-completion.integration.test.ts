import assert from 'node:assert/strict';
import test from 'node:test';
import type {Pool} from 'pg';
import {completeSignalClassicPolicyV1} from '../signal-classic-policy-completion';
import {provisionSignalBrandContextPolicyV1} from '../signal-brand-context-policy-provisioning';
import {createProcessingPolicyIdentitiesV1} from './signal-processing-policy.fixture';

test('explicit classic completion preserves a sibling policy and live actor authority in PostgreSQL',{
 skip:process.env.NOISIA_MFP_PG_CI!=='true',timeout:120_000
},async()=>{
 const {openDatabase}=await import(new URL('../../../scripts/dev-corpus/guard.mjs',import.meta.url).href);
 const pool:Pool=await openDatabase(),raw=await pool.connect();
 const census=`SELECT jsonb_build_object('policies',(SELECT count(*) FROM signal_processing_policy_versions),
  'actions',(SELECT count(*) FROM signal_processing_policy_actions),'features',(SELECT count(*) FROM signal_workspace_features),
  'admissions',(SELECT count(*) FROM signal_processing_admissions),'runs',(SELECT count(*) FROM signal_labeling_runs),
  'organizations',(SELECT count(*) FROM organizations),'users',(SELECT count(*) FROM users),'brands',(SELECT count(*) FROM brands)) value`;
 const before=(await raw.query(census)).rows[0].value;
 try{
  await raw.query('BEGIN');
  const f=await createProcessingPolicyIdentitiesV1({database:pool,scoped:raw});
  for(const [scope,actor] of [[f.first,f.actors.firstAdmin],[f.second,f.actors.secondAdmin]] as const)
   await raw.query(`UPDATE signal_workspaces SET metadata=metadata||jsonb_build_object('created_by_user_id',$2::text,
    'creation_request_digest','sha256:'||repeat('a',64)) WHERE id=$1`,[scope.workspace_id,actor]);
  await raw.query("INSERT INTO signal_workspace_features(workspace_id,feature,enabled_by) VALUES($1,'mention_facets',$2)",[f.first.workspace_id,f.actors.internal]);
  const query=async(sql:string,params?:unknown[])=>{
   if(sql.startsWith('BEGIN'))return raw.query('SAVEPOINT classic_completion');
   if(sql==='COMMIT')return raw.query('RELEASE SAVEPOINT classic_completion');
   if(sql==='ROLLBACK'){await raw.query('ROLLBACK TO SAVEPOINT classic_completion');return raw.query('RELEASE SAVEPOINT classic_completion');}
   return raw.query(sql,params);
  };
  const database={connect:async()=>({query,release(){}})} as unknown as Pick<Pool,'connect'>;
  const env={NOISIA_MENTION_FACETS_ENABLED:'true',NOISIA_BRAND_CONTEXT_POLICY_CREATOR_USER_ID:f.actors.internal};
  assert.equal((await provisionSignalBrandContextPolicyV1({database,...{workspace_id:f.first.workspace_id,brand_id:f.first.brand_id},
   initiator_user_id:f.actors.firstAdmin,env})).status,'provisioned');
  const snapshotSql=`SELECT p.id::text,p.valid_until::text,p.daily_cap_micro_usd::text,p.budget_timezone,
   (SELECT jsonb_agg(to_jsonb(a)-'id'-'policy_version_id' ORDER BY action) FROM signal_processing_policy_actions a WHERE a.policy_version_id=p.id) actions
   FROM signal_processing_policy_versions p WHERE organization_id=$1 AND status='active'`;
  const original=(await raw.query(snapshotSql,[f.first.organization_id])).rows[0];
  assert.equal(original.actions.length,8);assert.equal(original.valid_until,'infinity');assert.equal(original.daily_cap_micro_usd,null);
  const invoke=(actor_user_id:string)=>completeSignalClassicPolicyV1({database,workspace_id:f.second.workspace_id,brand_id:f.second.brand_id,actor_user_id,env});
  for(const actor of [f.actors.noGrant,f.actors.firstAdmin,f.actors.foreignAdmin,f.actors.suspended,f.actors.viewer]){
   assert.equal((await invoke(actor)).status,'not_eligible');
   assert.deepEqual((await raw.query(snapshotSql,[f.first.organization_id])).rows[0],original);
  }
  assert.equal((await invoke(f.actors.secondAdmin)).status,'provisioned',
   'explicit completion adds the missing classic pair without enabling per-mention processing');
  const next=(await raw.query(snapshotSql,[f.first.organization_id])).rows[0];
  assert.notEqual(next.id,original.id);assert.equal(next.valid_until,original.valid_until);
  assert.equal(next.daily_cap_micro_usd,original.daily_cap_micro_usd);assert.equal(next.budget_timezone,original.budget_timezone);
  assert.equal(next.actions.length,10);
  for(const action of original.actions)assert.deepEqual(next.actions.find((a:{action:string})=>a.action===action.action),action);
  assert.equal((await raw.query('SELECT count(*)::int n FROM signal_workspace_features WHERE workspace_id=$1',[f.second.workspace_id])).rows[0].n,0);
  assert.equal((await invoke(f.actors.secondAdmin)).status,'existing_policy');
  assert.deepEqual((await raw.query(snapshotSql,[f.first.organization_id])).rows[0],next);
  await raw.query('ROLLBACK');
  assert.deepEqual((await pool.query(census)).rows[0].value,before);
 }finally{await raw.query('ROLLBACK').catch(()=>undefined);raw.release();await pool.end();}
});
