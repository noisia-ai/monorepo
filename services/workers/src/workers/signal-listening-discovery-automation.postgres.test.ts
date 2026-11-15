import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile,writeFile,open} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {withDiscoveryAdvanceFixtureV1} from '../../../../infrastructure/db/migrations/signal-listening-discovery-advance.synthetic.fixture';
import {drainSignalListeningDiscoveryAutomationOnceV1} from './signal-listening-discovery-automation';
import {buildWorkspaceEngineStorageKeyV1,type WorkspaceEngineStorageV1} from './signal-workspace-engine-storage';
const sha=(value:Buffer|string)=>'sha256:'+createHash('sha256').update(value).digest('hex');
test('native automation publishes a real numeric checkpoint and resumes its admitted parent without another admission',{
 skip:process.env.NOISIA_R16_DISCOVERY_AUTOMATION_PG!=='true',timeout:600000,
},async()=>withDiscoveryAdvanceFixtureV1(async f=>{
 let puts=0,gets=0;const remote=new Map<string,string>();
 // Private fsync/readback custody exercises the production numeric adapter;
 // this test makes no external Storage or provider requests.
 const storage:WorkspaceEngineStorageV1={async assertReady(){},async put(args){
  const body=await readFile(args.file);assert.equal(body.length,args.size_bytes);assert.equal(sha(body),args.sha256);
  const storage_key=buildWorkspaceEngineStorageKeyV1(args.workspace_id,args.execution_id,basename(args.file),args.sha256);
  const file=join(f.files,'runtime-'+sha(storage_key).slice(7));await writeFile(file,body,{mode:0o600});
  const handle=await open(file,'r+');try{await handle.sync();}finally{await handle.close();}
  remote.set(storage_key,file);puts++;return{storage_key,sha256:args.sha256,size_bytes:args.size_bytes,media_type:args.media_type};
 },async get(args){const file=remote.get(args.stored.storage_key);assert.ok(file);gets++;await writeFile(args.destination,await readFile(file),{mode:0o600});}};
 const options={database:f.database,storage,env:{NOISIA_LISTENING_DISCOVERY_ENABLED:'true',NOISIA_LISTENING_DISCOVERY_ANTHROPIC_API_KEY:'synthetic-no-http'}};
 const before=await f.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE workspace_id=$1',[f.workspace_id]);
 assert.deepEqual(await drainSignalListeningDiscoveryAutomationOnceV1(options),{candidates:1,advanced:1,failed:0});
 assert.equal(puts,2);assert.ok(gets>=2,'staged artifacts use the production readback verifier');
 const checkpoints=(await f.database.query('SELECT manifest_json,verification_status FROM signal_listening_discovery_numeric_checkpoints WHERE execution_id=$1',[f.execution.id])).rows;
 assert.equal(checkpoints.length,1);assert.equal(checkpoints[0].verification_status,'verified');
 const manifest=JSON.parse(checkpoints[0].manifest_json);assert.equal(manifest.status,'empty');assert.equal(manifest.root_count,0);
 assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_listening_discovery_rounds WHERE execution_id=$1',[f.execution.id])).rows[0].n,1);
 assert.equal((await f.database.query("SELECT count(*)::int n FROM signal_processing_admissions WHERE workspace_id=$1 AND action='listening_discovery_review'",[f.workspace_id])).rows[0].n,1);
 const writes=puts;assert.deepEqual(await drainSignalListeningDiscoveryAutomationOnceV1(options),{candidates:0,advanced:0,failed:0});assert.equal(puts,writes);
 assert.equal((await f.database.query('SELECT count(*)::int n FROM engine_cost_events WHERE listening_round_id IN(SELECT id FROM signal_listening_discovery_rounds WHERE execution_id=$1)',[f.execution.id])).rows[0].n,0,'enqueue is not a Sonnet send');
 assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE workspace_id=$1',[f.workspace_id])).rows[0].n,before.rows[0].n,'advance does not send or reclassify an initial root');
}));
