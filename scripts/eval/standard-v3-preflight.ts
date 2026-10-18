/** PostgreSQL acceptance uses exact historic roots and rolls back every product mutation. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
// @ts-expect-error guarded private runner JavaScript
import {main,openDatabase} from '../dev-corpus/guard.mjs';
import {loadMfpEvalIdentity} from './fixture-identity';
import {requestConceptMembershipsV1} from '../../infrastructure/db/signal-concept-memberships';
import {membershipLabelerIdentityV3,labelerDigestV1} from '../../packages/query-engine/src/index';
const directory='.data/dev-corpus/voyage-real/standard-v3-r12';
void main(async()=>{
 const identity=await loadMfpEvalIdentity(),pool=await openDatabase();
 try{
  const baseline=JSON.parse(await readFile('.data/dev-corpus/voyage-real/standard-v2-r11/baseline.json','utf8'));
  const installed=JSON.parse(await readFile(`${directory}/v5-data-installed.json`,'utf8'));assert.equal(installed.passed,true);
  const census=async(db:any)=>(await db.query(`SELECT
   (SELECT coalesce(jsonb_agg(w ORDER BY kind),'[]') FROM signal_workspace_labelers w WHERE workspace_id=$1) selectors,
   (SELECT count(*)::int FROM signal_labeling_calls WHERE workspace_id=$1) calls,
   (SELECT count(*)::int FROM signal_concept_memberships WHERE workspace_id=$1) serving,
   (SELECT count(*)::int FROM signal_entity_context_versions WHERE workspace_id=$1) contexts`,[identity.workspace_id])).rows[0];
  const current=(await pool.query('SELECT root_id,input_digest FROM signal_mention_facets_current_v1 WHERE workspace_id=$1 ORDER BY root_id',[identity.workspace_id])).rows;
  assert.equal(current.length,1086);assert.equal(createHash('sha256').update(JSON.stringify(current.map((r:any)=>[r.root_id,r.input_digest]))).digest('hex'),baseline.root_input_sha256);
  const before=await census(pool),estimates:Record<string,number>={};
  const c=await pool.connect();await c.query('BEGIN');let seq=0;const stack:string[]=[];
  const query=async(sql:string,args?:unknown[])=>{
   if(sql==='BEGIN'){const sp=`v3_${++seq}`;stack.push(sp);return c.query(`SAVEPOINT ${sp}`);}
   if(sql==='COMMIT')return c.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
   if(sql==='ROLLBACK'){const sp=stack.pop()!;await c.query(`ROLLBACK TO SAVEPOINT ${sp}`);return c.query(`RELEASE SAVEPOINT ${sp}`);}
   return c.query(sql,args);
  };
  const db={query,connect:async()=>({query,release(){}})} as any;
  try{
   for(const effort of ['low','medium'] as const){
    const args={database:db,workspace_id:identity.workspace_id,actor_user_id:identity.internal_user_id,idempotency_key:`mfp-standard-v3-r12-${effort}`,provider_available:true,evaluation_judge_version:3 as const,evaluation_effort:effort,evaluation_root_ids:current.map((r:any)=>r.root_id)};
    const receipt=await requestConceptMembershipsV1(args);estimates[effort]=receipt.estimated_micro_usd!;
    assert.equal((await requestConceptMembershipsV1(args)).run_id,receipt.run_id);
    const row=(await c.query(`SELECT r.membership_snapshot,r.waiting_full_confirmation,r.next_poll_at::text,l.labeler_digest FROM signal_labeling_runs r JOIN signal_labeler_versions l ON l.id=r.labeler_version_id WHERE r.id=$1`,[receipt.run_id])).rows[0];
    assert.equal(row.labeler_digest,labelerDigestV1(membershipLabelerIdentityV3(effort)));assert.equal(row.membership_snapshot.preview,true);
    assert.deepEqual(row.membership_snapshot.sample_root_ids,current.map((r:any)=>r.root_id));assert.equal(row.waiting_full_confirmation,false);assert.equal(row.next_poll_at,'infinity');
    assert.deepEqual(await census(db),before);
    await c.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1",[receipt.run_id]);
   }
  }finally{await c.query('ROLLBACK');c.release();}
  assert.deepEqual(await census(pool),before);await mkdir(directory,{recursive:true,mode:0o700});
  const result={stage:'v3_postgres_acceptance',passed:true,roots:1086,root_input_sha256:baseline.root_input_sha256,definitions_sha256:installed.input_sha256,estimates,provider_calls:0,before,at:new Date().toISOString()};
  await writeFile(`${directory}/acceptance.json`,JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({...result,before:undefined}));
 }finally{await pool.end();}
});
