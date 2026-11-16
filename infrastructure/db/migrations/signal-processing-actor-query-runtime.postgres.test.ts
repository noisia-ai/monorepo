import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {after,before,test} from 'node:test';
import type {Pool,PoolClient} from 'pg';
import {createProcessingPolicyIdentitiesV1} from './signal-processing-policy.fixture';
import {createMassLabelingConcurrencyDatabaseV1} from './signal-mass-labeling-concurrent.synthetic.fixture';
const enabled=process.env.NOISIA_R16_ACTOR_QUERY_RUNTIME_PG==='true';
let admin:Pool|undefined,isolated:Awaited<ReturnType<typeof createMassLabelingConcurrencyDatabaseV1>>|undefined;
before(async()=>{
 if(!enabled)return;
 const {openDatabase}=await import(new URL('../../../scripts/dev-corpus/guard.mjs',import.meta.url).href);
 const parent:Pool=await openDatabase();admin=parent;isolated=await createMassLabelingConcurrencyDatabaseV1(parent);
},{timeout:180000});
after(async()=>{try{await isolated?.cleanup();}finally{await admin?.end();}},{timeout:30000});
type ActorFixture=Awaited<ReturnType<typeof createProcessingPolicyIdentitiesV1>>&{pool:Pool;raw:PoolClient};
async function fixture(body:(f:ActorFixture)=>Promise<void>){
 assert.ok(isolated);const pool=isolated.pool,raw=await pool.connect();
 try{
  await raw.query('BEGIN');const f=await createProcessingPolicyIdentitiesV1({database:pool,scoped:raw});await raw.query('COMMIT');
  // These committed invented identities exist only in this owned disposable DB.
  // No corpus, policy, admission, provider call or paid transport is created.
  await raw.query('CREATE TEMP TABLE IF NOT EXISTS r16_actor_oracle_probe(probe boolean)');
  const source=await readFile(new URL('./0218_signal_processing_internal_admin_actor.sql',import.meta.url),'utf8');
  await raw.query(source.slice(source.indexOf('CREATE OR REPLACE FUNCTION')).replace(
   'CREATE OR REPLACE FUNCTION signal_processing_actor_v1(','CREATE OR REPLACE FUNCTION pg_temp.r16_actor_before_0324('));
  await body({...f,pool,raw});
  const money=(await raw.query(`WITH scope AS(SELECT id FROM signal_workspaces WHERE organization_id=ANY($1::uuid[])) SELECT
   (SELECT count(*)::int FROM signal_processing_admissions WHERE organization_id=ANY($1::uuid[])) admissions,
   (SELECT count(*)::int FROM signal_labeling_calls WHERE workspace_id IN(SELECT id FROM scope)) labeling,
   (SELECT count(*)::int FROM signal_workspace_embedding_calls WHERE workspace_id IN(SELECT id FROM scope)) embeddings,
   (SELECT count(*)::int FROM engine_cost_events WHERE workspace_id IN(SELECT id FROM scope)) engine,
   (SELECT count(*)::int FROM signal_semantic_context_budget_reservations WHERE workspace_id IN(SELECT id FROM scope)) semantic`,
   [[f.first.organization_id,f.foreign.organization_id]])).rows[0];
  assert.deepEqual(money,{admissions:0,labeling:0,embeddings:0,engine:0,semantic:0},'permission checks create no money or provider attempts');
 }finally{await raw.query('ROLLBACK').catch(()=>{});raw.release();}
}
async function equal(f:ActorFixture,workspace:string|null,actor:string|null,expected:boolean,label:string){
 const row=(await f.raw.query(`SELECT pg_temp.r16_actor_before_0324($1::uuid,$2::uuid) prior,
  public.signal_processing_actor_v1($1::uuid,$2::uuid) current`,[workspace,actor])).rows[0];
 assert.deepEqual(row,{prior:expected,current:expected},label);
}
async function changed(f:ActorFixture,mutate:()=>Promise<unknown>,check:()=>Promise<void>){
 await f.raw.query('SAVEPOINT actor_variant');try{await mutate();await check();}
 finally{await f.raw.query('ROLLBACK TO SAVEPOINT actor_variant');await f.raw.query('RELEASE SAVEPOINT actor_variant');}
}
test('prepared actor query preserves native roles, grants, NULLs, states, metadata and changes between statements',{
 skip:!enabled,timeout:180000,
},async()=>fixture(async f=>{
 const metadata=(fn:string)=>f.raw.query(`SELECT l.lanname language,p.pronargs argument_count,p.proargnames argument_names,
  oidvectortypes(p.proargtypes) argument_types,p.prorettype::regtype::text result_type,p.proretset set_returning,
  p.provolatile volatility,p.proisstrict strict,p.prosecdef definer,p.proleakproof leakproof,p.proparallel parallel,
  p.procost cost,p.pronargdefaults defaults,p.proconfig config FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=$1::regprocedure`,[fn]);
 const old=(await metadata('pg_temp.r16_actor_before_0324(uuid,uuid)')).rows[0],next=(await metadata('public.signal_processing_actor_v1(uuid,uuid)')).rows[0];
 assert.equal(old.language,'sql');assert.equal(next.language,'plpgsql');
 const {language:_old,...oldContract}=old,{language:_next,...nextContract}=next;assert.deepEqual(nextContract,oldContract);
 assert.equal(next.argument_types,'uuid, uuid');assert.deepEqual(next.argument_names,['target_workspace','target_actor']);
 assert.equal(next.result_type,'boolean');assert.equal(next.volatility,'s');assert.equal(next.strict,false);assert.equal(next.definer,false);
 const privileges=(await f.raw.query(`SELECT
  NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
   WHERE p.oid='signal_processing_actor_v1(uuid,uuid)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') private,
  has_function_privilege((SELECT proowner FROM pg_proc WHERE oid='signal_processing_actor_v1(uuid,uuid)'::regprocedure),'signal_processing_actor_v1(uuid,uuid)','EXECUTE') owner_execute,
  (SELECT count(*)::int FROM pg_roles WHERE rolname IN('anon','authenticated')) app_roles,
  NOT EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN('anon','authenticated') AND has_function_privilege(r.oid,'signal_processing_actor_v1(uuid,uuid)','EXECUTE')) app_denied`)).rows[0];
 assert.deepEqual(privileges,{private:true,owner_execute:true,app_roles:2,app_denied:true});
 await f.raw.query('BEGIN');try{
  await equal(f,f.first.workspace_id,f.actors.internal,true,'internal administrator');
  await equal(f,f.foreign.workspace_id,f.actors.internal,true,'internal administrator of a different organization needs no brand grant');
  await changed(f,()=>f.raw.query('UPDATE users SET organization_id=NULL WHERE id=$1',[f.actors.internal]),
   ()=>equal(f,f.first.workspace_id,f.actors.internal,true,'internal administrator without an organization'));
  for(const role of ['founder','admin','analyst','kam','insights_manager','ux_data_specialist'])await changed(f,
   ()=>f.raw.query('UPDATE users SET primary_role=$2 WHERE id=$1',[f.actors.internal,role]),
   ()=>equal(f,f.first.workspace_id,f.actors.internal,false,'internal '+role+' has no processing authority'));
  await equal(f,f.first.workspace_id,f.actors.firstAdmin,true,'client administrator with exact admin grant');
  await equal(f,f.foreign.workspace_id,f.actors.foreignAdmin,true,'foreign administrator in its own organization');
  for(const key of ['noGrant','readGrant','commentGrant','alias','manager','viewer','suspended','foreignAdmin','secondAdmin']as const)
   await equal(f,f.first.workspace_id,f.actors[key],false,key+' is not authorized for this workspace');
  await changed(f,()=>f.raw.query("INSERT INTO user_brand_access(user_id,brand_id,access_level) VALUES($1,$2,'admin')",[f.actors.foreignAdmin,f.first.brand_id]),
   ()=>equal(f,f.first.workspace_id,f.actors.foreignAdmin,false,'a local grant cannot authorize a foreign client organization'));
  for(const role of ['client_owner','client_viewer','brand_manager','agency_insights'])await changed(f,
   ()=>f.raw.query('UPDATE users SET primary_role=$2 WHERE id=$1',[f.actors.firstAdmin,role]),
   ()=>equal(f,f.first.workspace_id,f.actors.firstAdmin,false,'wrong client role with admin grant: '+role));
  for(const [table,id]of [['users',f.actors.internal],['organizations',f.first.organization_id],['brands',f.first.brand_id],['signal_workspaces',f.first.workspace_id]])
   await changed(f,()=>f.raw.query(`UPDATE ${table} SET status=$2 WHERE id=$1`,[id,table==='users'?'suspended':'archived']),
    ()=>equal(f,f.first.workspace_id,f.actors.internal,false,table+' is inactive'));
  await changed(f,()=>f.raw.query('UPDATE brands SET organization_id=$2 WHERE id=$1',[f.first.brand_id,f.foreign.organization_id]),
   ()=>equal(f,f.first.workspace_id,f.actors.internal,false,'brand and workspace organization disagreement'));
  // A workspace cannot be forged against a brand of another organization.
  await f.raw.query('SAVEPOINT impossible_scope');await assert.rejects(f.raw.query('UPDATE signal_workspaces SET brand_id=$2 WHERE id=$1',
   [f.first.workspace_id,f.foreign.brand_id]),/Signal workspace subject must belong to its organization/);
  await f.raw.query('ROLLBACK TO SAVEPOINT impossible_scope');await f.raw.query('RELEASE SAVEPOINT impossible_scope');
  const theme=randomUUID(),themeWorkspace=randomUUID();
  await f.raw.query("INSERT INTO themes(id,organization_id,slug,name,status) VALUES($1,$2,$3,'Synthetic permission theme','active')",[theme,f.first.organization_id,'actor-theme-'+theme]);
  await f.raw.query("INSERT INTO signal_workspaces(id,organization_id,theme_id,slug,status) VALUES($1,$2,$3,$4,'active')",[themeWorkspace,f.first.organization_id,theme,'actor-theme-'+theme]);
  await equal(f,themeWorkspace,f.actors.internal,false,'theme-only workspace has no brand authority');
  for(const [workspace,actor]of [[null,f.actors.internal],[f.first.workspace_id,null],[null,null],[randomUUID(),f.actors.internal],[f.first.workspace_id,randomUUID()]]as const)
   await equal(f,workspace,actor,false,'missing or NULL identity is false, never NULL');
  for(let n=0;n<6;n++)await equal(f,f.first.workspace_id,f.actors.firstAdmin,true,'warm call '+n);
  await f.raw.query("UPDATE users SET primary_role='client_viewer' WHERE id=$1",[f.actors.firstAdmin]);
  await equal(f,f.first.workspace_id,f.actors.firstAdmin,false,'role change is observed by the next statement');
  await f.raw.query("UPDATE users SET primary_role='client_admin' WHERE id=$1",[f.actors.firstAdmin]);
  await equal(f,f.first.workspace_id,f.actors.firstAdmin,true,'restored role is observed');
  await f.raw.query('UPDATE user_brand_access SET revoked_at=clock_timestamp() WHERE user_id=$1 AND brand_id=$2',[f.actors.firstAdmin,f.first.brand_id]);
  await equal(f,f.first.workspace_id,f.actors.firstAdmin,false,'revoked grant is observed after warm calls');
  await f.raw.query('UPDATE user_brand_access SET revoked_at=NULL WHERE user_id=$1 AND brand_id=$2',[f.actors.firstAdmin,f.first.brand_id]);
  await equal(f,f.first.workspace_id,f.actors.firstAdmin,true,'restored grant is observed');
 }finally{await f.raw.query('ROLLBACK');}
}));
async function waitForBlock(pool:Pool,blocked:number,blocker:number){
 const deadline=Date.now()+3000;while(Date.now()<deadline){
  if((await pool.query('SELECT $2::int=ANY(pg_blocking_pids($1::int)) blocked',[blocked,blocker])).rows[0].blocked)return;
  await delay(10);
 }assert.fail('native actor lock did not wait for the exact competing backend');
}
for(const mutation of ['actor','grant']as const)test('native '+mutation+' revocation remains fresh after a lock wait and waits for an existing SHARE fence',{
 skip:!enabled,timeout:180000,
},async()=>fixture(async f=>{
 const actor=f.actors.firstAdmin,workspace=f.first.workspace_id,holder=await f.pool.connect(),contender=await f.pool.connect();
 let pending:Promise<{error?:Error;value?:unknown}>|undefined,phase:1|2=1;
 const revoke=()=>mutation==='actor'?holder.query("UPDATE users SET primary_role='client_viewer' WHERE id=$1",[actor]):
  holder.query('UPDATE user_brand_access SET revoked_at=clock_timestamp() WHERE user_id=$1 AND brand_id=$2',[actor,f.first.brand_id]);
 const restore=()=>mutation==='actor'?f.raw.query("UPDATE users SET primary_role='client_admin' WHERE id=$1",[actor]):
  f.raw.query('UPDATE user_brand_access SET revoked_at=NULL WHERE user_id=$1 AND brand_id=$2',[actor,f.first.brand_id]);
 try{
  const holderPid=Number((await holder.query('SELECT pg_backend_pid() pid')).rows[0].pid),contenderPid=Number((await contender.query('SELECT pg_backend_pid() pid')).rows[0].pid);
  await holder.query('BEGIN');await contender.query('BEGIN');await holder.query("SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='8s'");await contender.query("SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='8s'");
  await revoke();pending=contender.query('SELECT signal_processing_lock_actor_v1($1::uuid,$2::uuid,true)',[workspace,actor]).then(value=>({value}),error=>({error}));
  await waitForBlock(f.pool,contenderPid,holderPid);await holder.query('COMMIT');
  const denied=await pending;assert.equal((denied.error as Error&{code?:string})?.code,'42501');assert.match(denied.error?.message??'',/processing_forbidden/);
  await contender.query('ROLLBACK');await equal(f,workspace,actor,false,'old and new see the committed revocation');await restore();
  await equal(f,workspace,actor,true,'restore before the converse lock test');
  phase=2;await holder.query('BEGIN');await contender.query('BEGIN');await holder.query("SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='8s'");await contender.query("SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='8s'");
  await contender.query('SELECT signal_processing_lock_actor_v1($1::uuid,$2::uuid,true)',[workspace,actor]);
  pending=revoke().then(value=>({value}),error=>({error}));await waitForBlock(f.pool,holderPid,contenderPid);
  await contender.query('COMMIT');const revoked=await pending;assert.equal(revoked.error,undefined);await holder.query('COMMIT');
  await equal(f,workspace,actor,false,'SHARE protects the authorized transaction until COMMIT, then revocation is visible');
 }finally{
  // Release the actual blocker before awaiting the other session's queued SQL.
  await (phase===1?holder:contender).query('ROLLBACK').catch(()=>{});await pending;
  await (phase===1?contender:holder).query('ROLLBACK').catch(()=>{});holder.release();contender.release();
 }
}));
