/** Private runner schedule only; direct leased driver continues, shared drainers cannot claim this run. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
// @ts-expect-error guarded private runner JavaScript
import {main,openDatabase} from '../dev-corpus/guard.mjs';
import {loadMfpEvalIdentity} from './fixture-identity';
const directory='.data/dev-corpus/voyage-real/standard-v2-r11';
export async function configureStandardV2Calendar(pool:any,workspace_id:string,run_id:string,teardown=false){
 const identity={workspace_id},manifest={run_id};
 if(!/^[a-f0-9-]{36}$/.test(run_id))throw new Error('mfp_v2_calendar_run_invalid');
 const client=await pool.connect();
 const fn='mfp_harness.standard_v2_r11_calendar',trigger='mfp_standard_v2_r11_calendar';
 const body=`BEGIN IF NEW.id='${manifest.run_id}'::uuid AND NEW.workspace_id='${identity.workspace_id}'::uuid THEN NEW.next_poll_at='infinity'::timestamptz; END IF; RETURN NEW; END`;
 const ddl=`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $calendar$${body}$calendar$; CREATE TRIGGER ${trigger} BEFORE INSERT OR UPDATE ON signal_labeling_runs FOR EACH ROW EXECUTE FUNCTION ${fn}(); REVOKE ALL ON FUNCTION ${fn}() FROM PUBLIC;`;
 try{
  await client.query('BEGIN');
  const run=(await client.query(`SELECT status FROM signal_labeling_runs WHERE id=$1 AND workspace_id=$2 AND membership_snapshot->>'evaluation_judge_version'='2' FOR UPDATE`,[manifest.run_id,identity.workspace_id])).rows[0];assert.ok(run);
  const existing=(await client.query('SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure($1)',[fn+'()'])).rows[0];
  if(existing)assert.equal(existing.prosrc,body);
  if(teardown){
   const others=(await client.query('SELECT id,next_poll_at::text FROM signal_labeling_runs WHERE id<>$1 ORDER BY id',[manifest.run_id])).rows;
   assert.equal(run.status,'completed');
   assert.equal((await client.query(`SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1 AND status IN('reserved','submitting','submitted','unknown')`,[manifest.run_id])).rows[0].n,0);
   if(existing){await client.query(`DROP TRIGGER ${trigger} ON signal_labeling_runs; DROP FUNCTION ${fn}();`);await client.query('UPDATE signal_labeling_runs SET next_poll_at=now() WHERE id=$1',[manifest.run_id]);}
   assert.deepEqual((await client.query('SELECT id,next_poll_at::text FROM signal_labeling_runs WHERE id<>$1 ORDER BY id',[manifest.run_id])).rows,others);
   const postimage=(await client.query(`SELECT to_regprocedure($1) IS NULL function_removed,NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname=$2 AND tgrelid='signal_labeling_runs'::regclass) trigger_removed,(SELECT next_poll_at<>'infinity'::timestamptz FROM signal_labeling_runs WHERE id=$3) schedule_restored`,[fn+'()',trigger,manifest.run_id])).rows[0];
   assert.deepEqual(postimage,{function_removed:true,trigger_removed:true,schedule_restored:true});
   await client.query('COMMIT');
   const receipt={stage:'standard_v2_calendar_removed',passed:true,provider_calls:0,postimage,other_runs_unchanged:true,at:new Date().toISOString()};
   await writeFile(`${directory}/calendar-removed.json`,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(receipt));return;
  }
  const before=(await client.query('SELECT id,next_poll_at::text FROM signal_labeling_runs WHERE id<>$1 ORDER BY id',[manifest.run_id])).rows;
  if(!existing){
   await client.query('SAVEPOINT acceptance');await client.query(ddl);await client.query('UPDATE signal_labeling_runs SET next_poll_at=now() WHERE id=$1',[manifest.run_id]);
   assert.equal((await client.query('SELECT next_poll_at::text FROM signal_labeling_runs WHERE id=$1',[manifest.run_id])).rows[0].next_poll_at,'infinity');
   assert.deepEqual((await client.query('SELECT id,next_poll_at::text FROM signal_labeling_runs WHERE id<>$1 ORDER BY id',[manifest.run_id])).rows,before);
   await client.query('ROLLBACK TO SAVEPOINT acceptance');await client.query(ddl);
  }
  await client.query('UPDATE signal_labeling_runs SET next_poll_at=now() WHERE id=$1',[manifest.run_id]);await client.query('COMMIT');
  const receipt={stage:'standard_v2_calendar_installed',passed:true,ddl_sha256:createHash('sha256').update(ddl).digest('hex'),run_id:manifest.run_id,provider_calls:0,checks:['exact_run_workspace','drainer_schedule_excluded','other_runs_unchanged','rollback'],at:new Date().toISOString()};
  await writeFile(`${directory}/calendar.json`,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(receipt));
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
if(process.argv[1]?.endsWith('/scripts/eval/standard-v2-calendar.ts'))void main(async()=>{
 const identity=await loadMfpEvalIdentity(),manifest=JSON.parse(await readFile(`${directory}/run-manifest.json`,'utf8')),pool=await openDatabase();
 try{await configureStandardV2Calendar(pool,identity.workspace_id,manifest.run_id,process.argv.includes('--teardown'));}finally{await pool.end();}
});
