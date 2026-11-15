import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile,writeFile,open} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {withInitialDiscoveryFixtureV1} from '../../../../infrastructure/db/migrations/signal-listening-discovery-initial.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../../../../infrastructure/db/signal-listening-configuration';
import {signalListeningBaseTemplateV1} from '@noisia/query-engine';
import {drainSignalListeningDiscoveryAutomationOnceV1} from './signal-listening-discovery-automation';
import {buildWorkspaceEngineStorageKeyV1,type WorkspaceEngineStorageV1} from './signal-workspace-engine-storage';
const sha=(value:Buffer|string)=>'sha256:'+createHash('sha256').update(value).digest('hex');
const enabled=process.env.NOISIA_R16_DISCOVERY_INITIAL_NUMERIC_PG==='true';

for(const {defined,count}of [{defined:false,count:3},{defined:true,count:3},{defined:false,count:240}])test('native base'+(defined?' and defined topics':' only')+' with '+count+' roots automatically reuses real vectors and enqueues its first review',{
 skip:!enabled,timeout:600000,
},async()=>withInitialDiscoveryFixtureV1(async f=>{
 assert.ok(process.env.NOISIA_WORKSPACE_ENGINE_PYTHON,'a real numerical Python runtime is required');
 assert.ok(process.env.NOISIA_WORKSPACE_ENGINE_MODULE_ROOT,'the exact numerical source must be explicit');
 const template=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']});
 const cfg=await saveSignalListeningConfigurationV1({...f,expected_revision:f.cfg.revision,provenance:'human',configuration:{...template,
  retired_question_keys:f.cfg.configuration.questions.filter(q=>q.topic_source==='discovered').map(q=>q.key),
  questions:[...template.questions,...(defined?[{key:'defined_interest',type:'noul' as const,text:'Is this about bicycle maintenance?',positive:'Bicycle maintenance',negative:'Other topics',scope:'all' as const,origin:'brand_os' as const,human_locked:false,topic_source:'defined' as const}]:[])]}});
 const {result,intent}=await f.request({configuration_id:cfg.id});assert.ok(intent);assert.ok(result.run_id);await f.classify(result.run_id,cfg.configuration);
 const remote=new Map<string,string>();
 const storage:WorkspaceEngineStorageV1={async assertReady(){},async put(args){
  const body=await readFile(args.file);assert.equal(body.length,args.size_bytes);assert.equal(sha(body),args.sha256);
  const storage_key=buildWorkspaceEngineStorageKeyV1(args.workspace_id,args.execution_id,basename(args.file),args.sha256);
  const file=join(f.files,'base-initial-'+sha(storage_key).slice(7));await writeFile(file,body,{mode:0o600});
  const handle=await open(file,'r+');try{await handle.sync();}finally{await handle.close();}
  remote.set(storage_key,file);return{storage_key,sha256:args.sha256,size_bytes:args.size_bytes,media_type:args.media_type};
 },async get(args){const file=remote.get(args.stored.storage_key);assert.ok(file);await writeFile(args.destination,await readFile(file),{mode:0o600});}};
 const before=(await f.database.query('SELECT count(*)::int n FROM signal_workspace_embedding_calls WHERE workspace_id=$1',[f.workspace_id])).rows[0].n;
 const options={database:f.database,storage,env:{NOISIA_LISTENING_DISCOVERY_ENABLED:'true',NOISIA_LISTENING_DISCOVERY_ANTHROPIC_API_KEY:'synthetic-no-http'}};
 const drained=await drainSignalListeningDiscoveryAutomationOnceV1(options);assert.deepEqual(drained,{candidates:2,advanced:2,failed:0});
 const initial=(await f.database.query('SELECT execution_id,status FROM signal_listening_discovery_initial_intents WHERE id=$1',[intent.id])).rows[0];assert.equal(initial.status,'started');
 const checkpoint=(await f.database.query('SELECT manifest_json,verification_status FROM signal_listening_discovery_numeric_checkpoints WHERE execution_id=$1',[initial.execution_id])).rows[0];
 assert.equal(checkpoint.verification_status,'verified');const manifest=JSON.parse(checkpoint.manifest_json);
 if(!defined){assert.ok(manifest.root_count>0);assert.ok(manifest.cached_count>0);
  if(count===3)assert.equal(manifest.status,'insufficient_population');
  else{assert.equal(manifest.root_count,count);assert.equal(manifest.status,'completed');assert.ok(manifest.groups.length>0);assert.ok(manifest.grouped_count>0);}
 }
 assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_workspace_embedding_calls WHERE workspace_id=$1',[f.workspace_id])).rows[0].n,before);
 const round=(await f.database.query('SELECT status FROM signal_listening_discovery_rounds WHERE execution_id=$1',[initial.execution_id])).rows[0];assert.equal(round.status,'queued');
 assert.equal((await f.database.query("SELECT count(*)::int n FROM engine_cost_events WHERE workspace_id=$1 AND workspace_contract='listening-discovery-round-v1'",[f.workspace_id])).rows[0].n,0);
 assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_processing_admissions WHERE target_id=$1',[result.run_id])).rows[0].n,1);
 assert.deepEqual(await drainSignalListeningDiscoveryAutomationOnceV1(options),{candidates:0,advanced:0,failed:0});
},{...(count===3?{}:{population_count:count})}));
