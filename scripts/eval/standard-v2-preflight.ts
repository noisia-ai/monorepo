/** Private acceptance first; snapshots cover the same frozen roots without changing default. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
// @ts-expect-error guarded private runner JavaScript
import {main,openDatabase} from '../dev-corpus/guard.mjs';
import {loadMfpEvalIdentity} from './fixture-identity';
import {requestConceptMembershipsV1,loadMembershipConceptsV1} from '../../infrastructure/db/signal-concept-memberships';
import {membershipLabelerIdentityV2,labelerDigestV1} from '../../packages/query-engine/src/index';
const directory='.data/dev-corpus/voyage-real/standard-v2-r11';
const baselineRun='ecc15a26-c1a5-46be-894f-ed333571fa14';
void main(async()=>{
 const identity=await loadMfpEvalIdentity(),pool=await openDatabase();
 await mkdir(directory,{recursive:true,mode:0o700});
 const stage=process.argv.includes('--capture')?'capture':process.argv.includes('--acceptance')?'acceptance':'invalid';
 try{
  const census=async(c:any)=>(await c.query(`SELECT
   (SELECT coalesce(jsonb_agg(w ORDER BY workspace_id,kind),'[]') FROM signal_workspace_labelers w) selectors,
   (SELECT count(*)::int FROM signal_labeling_calls) calls,
   (SELECT count(*)::int FROM signal_concept_memberships) memberships,
   (SELECT count(*)::int FROM signal_labeling_runs WHERE status IN('queued','running')) active`)).rows[0];
  if(stage==='capture'){
   const before=await census(pool);assert.equal(before.active,0);
   const roots=(await pool.query(`SELECT root_id,input_digest,full_text text,title,platform,content_type,facets,relevance,status,requires_context_review FROM signal_mention_facets_current_v1 WHERE workspace_id=$1 ORDER BY root_id`,[identity.workspace_id])).rows;
   assert.equal(roots.length,1086);assert.equal(new Set(roots.map((r:any)=>r.root_id)).size,1086);
   const run=(await pool.query(`SELECT r.*,l.identity,l.labeler_digest,ce.context FROM signal_labeling_runs r JOIN signal_labeler_versions l ON l.id=r.labeler_version_id JOIN signal_entity_context_versions ce ON ce.workspace_id=r.workspace_id AND ce.version_no=r.entity_context_version_no WHERE r.id=$1 AND r.workspace_id=$2`,[baselineRun,identity.workspace_id])).rows[0];
   assert.equal(run.status,'completed');assert.equal(run.identity.params.standard_judge_version,undefined);
   const calls=(await pool.query(`SELECT id,request_digest,raw_sha256,raw_storage_key,raw_size_bytes,status,results_applied,inputs,results,usage,settled_micro_usd::text FROM signal_labeling_calls WHERE run_id=$1 ORDER BY created_at,id`,[baselineRun])).rows;
   assert.ok(calls.length);assert.ok(calls.every((c:any)=>c.status==='settled'&&c.results_applied&&c.raw_sha256));
   for(const call of calls)for(const input of call.inputs){const root=roots.find((r:any)=>r.root_id===input.root_id);assert.equal(root?.input_digest,input.input_digest);assert.equal(root?.text,input.text);}
   const payload=JSON.stringify({roots,run,calls,before,root_input_sha256:createHash('sha256').update(JSON.stringify(roots.map((r:any)=>[r.root_id,r.input_digest]))).digest('hex')},null,2)+'\n';
   await writeFile(`${directory}/baseline.json`,payload,{flag:'wx',mode:0o600});
   console.log(JSON.stringify({stage:'standard_v2_baseline',roots:roots.length,calls:calls.length,run_id:run.id,baseline_sha256:createHash('sha256').update(payload).digest('hex'),provider_calls:0}));return;
  }
  if(stage!=='acceptance')throw new Error('mfp_standard_v2_stage_invalid');
  const baseline=JSON.parse(await readFile(`${directory}/baseline.json`,'utf8'));
  const before=await census(pool);assert.equal(before.active,0);
  const client=await pool.connect();await client.query('BEGIN');
  const query=async(sql:any,args?:any)=>{const command=typeof sql==='string'?sql.trim().toUpperCase():'';
   if(command==='BEGIN')return client.query('SAVEPOINT mfp_v2_product');
   if(command==='COMMIT')return client.query('RELEASE SAVEPOINT mfp_v2_product');
   if(command==='ROLLBACK')return client.query('ROLLBACK TO SAVEPOINT mfp_v2_product');return client.query(sql,args);};
  const database={query,connect:async()=>({query,release(){}})} as any;
  let estimate:any;
  try{
   const args={database,workspace_id:identity.workspace_id,actor_user_id:identity.internal_user_id,idempotency_key:'mfp-standard-v2-r11',provider_available:true,evaluation_judge_version:2 as const,evaluation_root_ids:baseline.roots.map((r:any)=>r.root_id),full_recalculation:true};
   const receipt=await requestConceptMembershipsV1(args);estimate=receipt.estimated_micro_usd;
   const replay=await requestConceptMembershipsV1(args);assert.equal(replay.run_id,receipt.run_id);assert.equal(replay.replayed,true);
   const run=(await client.query(`SELECT r.*,l.labeler_digest FROM signal_labeling_runs r JOIN signal_labeler_versions l ON l.id=r.labeler_version_id WHERE r.id=$1`,[receipt.run_id])).rows[0];
   assert.equal(run.membership_snapshot.preview,true);assert.equal(run.membership_snapshot.sample_root_ids.length,1086);
   assert.equal(run.labeler_digest,labelerDigestV1(membershipLabelerIdentityV2()));
   assert.deepEqual((await census(database)).selectors,before.selectors);assert.equal((await census(database)).calls,before.calls);
   assert.equal((await census(database)).memberships,before.memberships);
   assert.deepEqual(run.membership_snapshot.concepts,await loadMembershipConceptsV1(database,identity.workspace_id));
  }finally{await client.query('ROLLBACK');client.release();}
  assert.deepEqual(await census(pool),before);
  const receipt={stage:'standard_v2_postgres_acceptance',passed:true,roots:1086,estimated_micro_usd:estimate,provider_calls:0,checks:['exact_population','new_identity','all_catalog_concepts','preview_no_serving_writes','default_unchanged','idempotent_replay','rollback'],at:new Date().toISOString()};
  await writeFile(`${directory}/acceptance.json`,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(receipt));
 }finally{await pool.end();}
});
