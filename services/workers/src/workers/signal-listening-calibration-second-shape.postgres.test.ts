import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {runMassLabelingAcceptanceFixtureV1} from '../../../../infrastructure/db/migrations/signal-mass-labeling-acceptance.synthetic.fixture';
import {saveSignalListeningConfigurationV1,requestSignalListeningV1,loadSignalListeningCalibrationV1} from '@noisia/db';
import {buildSignalListeningJevRequestV1,signalListeningCalibrationShapeV1,signalWorkspaceEmbeddingDigestV1 as digest,type SignalListeningCalibrationProfileV1} from '@noisia/query-engine';
import {r16ListeningWorkloadV2} from '../../../../scripts/r16/listening-workload';
import {captureR16SourceProvenanceV1} from '../../../../scripts/r16/source-provenance';
import {startR16HttpFilesystemStorageV1} from '../../../../scripts/r16/http-filesystem-storage';
import {createWorkspaceEngineStorageV1} from './signal-workspace-engine-storage';
import {createSignalListeningRuntimeStoreV1,signalListeningJevJobV1} from './signal-listening-jev';
import {planSignalListeningCalibrationV1,createSignalListeningCalibratedProviderV1} from './signal-listening-calibration';
import type {JevProviderV1} from '../providers/typesafe-jev';
const enabled=process.env.NOISIA_R16_LISTENING_SECOND_SHAPE_PG==='true';
test('native existing consumer profile extends an absent base-plan Map with exact verified32 source identities and no provider attempt',{
 skip:!enabled,timeout:600000,
},async()=>{
 assert.equal(process.env.GITHUB_ACTIONS,'true','native second-shape proof is CI-only; never start local Docker');
 for(const key of ['ANTHROPIC_API_KEY','TYPESAFE_API_KEY','VOYAGE_API_KEY'])assert.ok(!process.env[key]?.trim(),'real provider credentials are forbidden');
 const repository=resolve(fileURLToPath(new URL('../../../../',import.meta.url))),source=await captureR16SourceProvenanceV1(repository);
 const flags=['NOISIA_SIGNAL_LISTENING_ENABLED','NOISIA_JEV_PROVIDER_ENABLED'] as const,previous=flags.map(key=>process.env[key]);
 for(const key of flags)process.env[key]='true';
 try{await runMassLabelingAcceptanceFixtureV1('product',{population_count:64,beforeProcessing:async f=>{
  const canceled=await f.database.query(`UPDATE signal_labeling_runs r SET status='canceled' WHERE r.id=$1 AND r.workspace_id=$2
   AND r.status='queued' AND NOT EXISTS(SELECT 1 FROM signal_labeling_calls c WHERE c.run_id=r.id) RETURNING id`,[f.run_id,f.workspace_id]);assert.equal(canceled.rows.length,1);
  const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
  const configuration=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:r16ListeningWorkloadV2('defined_consumer_second_pass').configuration});
  const admitted=await requestSignalListeningV1({...access,configuration_id:configuration.id,map_id:f.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true});
  const execution={max_in_flight:32,flush_size:32,max_flushes:1,max_buffered_bytes:64*1024*1024,flush_interval_ms:5,window_size:64};
  const files=await mkdtemp(join(tmpdir(),'r16-second-shape-native-')),server=await startR16HttpFilesystemStorageV1(files);
  try{
   const storage=createWorkspaceEngineStorageV1({url:server.base_url,service_role_key:'synthetic-local-only',bucket:'corpus-files'});
   const store=createSignalListeningRuntimeStoreV1(f.database,{execution,storage});let physical=0;
   const provider:JevProviderV1={max_response_bytes:16384,max_concurrency:32,async evaluate(request){
    physical++;return{http_status:200,latency_ms:100,body:JSON.stringify({model:request.model,usage:{input_tokens:120,output_tokens:0},
     answers:Object.fromEntries(Object.entries(request.questions).map(([key,q])=>[key,q.type==='noul'?{type:'noul',noul:key==='promotion'?.1:.9}:
      {type:'choice',choice:'individual',confidence:.9,probabilities:Object.fromEntries(Object.keys(q.criteria).map(option=>[option,option==='individual'?.9:.1/(Object.keys(q.criteria).length-1)]))}]))})};}};
   const warmups:Array<{physical:number;warmup:boolean;selected_roots:number}>=[];
   for(let i=0;i<2;i++){
    let observed:{warmup:boolean;selected_roots:number}|undefined;const before=physical;
    await signalListeningJevJobV1(admitted.run_id,{database:f.database,store,execution,provider,preflight:async()=>{},observe_calibration:event=>{observed=event;}});
    assert.ok(observed?.warmup);assert.equal(observed.selected_roots,32);assert.equal(physical-before,32);warmups.push({physical:physical-before,...observed});
   }
   assert.equal(physical,64,'the two warmups are ordinary native reusable labels, not probes');
   const run=await store.claim(admitted.run_id);assert.ok(run);
   try{
    const inputs=await store.inputs(run,{max_rows:64,max_working_bytes:execution.max_buffered_bytes,on_oversize:'error'});
    assert.equal(inputs.length,32);assert.ok(inputs.every(input=>input.question_keys.every(key=>key==='voice'||key==='promotion')));
    const load=(shape_digest:string)=>loadSignalListeningCalibrationV1({...access,configuration_digest:configuration.configuration_digest,model:configuration.configuration.model,shape_digest});
    const plan=await planSignalListeningCalibrationV1({workspace_id:f.workspace_id,configuration_digest:configuration.configuration_digest,configuration:configuration.configuration,inputs,execution,loadProfile:load});
    assert.equal(plan.warmup,false);
    // Use one real paid-synthetic consumer receipt only as a readonly validation
    // carrier. The proof cannot construct a client, reserve or evaluate it.
    const consumer=(await f.database.query(`SELECT call.id,call.request,call.inputs FROM signal_labeling_calls call
     WHERE call.run_id=$1 AND call.results_applied AND call.status='settled'
      AND NOT (call.request->'questions' ? 'voice') ORDER BY call.id LIMIT 1`,[run.id])).rows[0]!;assert.ok(consumer);
    const request=buildSignalListeningJevRequestV1(consumer.inputs[0],configuration.configuration);
    assert.ok(digest(request)===digest(consumer.request),'actual receipt request identity must match the canonical compiler');
    const shape=signalListeningCalibrationShapeV1(configuration.configuration,consumer.inputs[0]);
    assert.equal(plan.profiles.has(shape.shape_digest),false);
    const runtime=createSignalListeningCalibratedProviderV1({plan,factory:()=>{throw Error('readonly native proof cannot construct a transport');}});
    assert.equal(runtime.prepareMeasuredRequests([request]),false);
    const beforeLedger=(await f.database.query('SELECT * FROM signal_labeling_calls WHERE run_id=$1 ORDER BY id',[run.id])).rows;
    const beforeProfileCount=(await f.database.query('SELECT count(*)::int n FROM signal_listening_calibrations WHERE source_run_id=$1',[run.id])).rows[0]!.n;
    const bounds={execution:{...plan.execution},response_bound_bytes:plan.response_bound_bytes},requestDigest=digest(request),wire=JSON.stringify(request);
    const wireSha='sha256:'+createHash('sha256').update(wire).digest('hex');
    let loaded:SignalListeningCalibrationProfileV1|null=null,loads=0;
    assert.equal(await runtime.prepareMeasuredRequestsWithProfiles([request],async id=>{loads++;assert.ok(id===shape.shape_digest);loaded=await load(id);return loaded;}),true);
    assert.equal(loads,1);const profile=plan.profiles.get(shape.shape_digest);assert.ok(profile);assert.equal(profile.sample_count,32);
    assert.ok(loaded&&digest(profile)===digest(loaded),'the accepted profile must be the exact fresh native DB record');
    assert.ok(profile.scope.workspace_id===f.workspace_id&&profile.scope.configuration_digest===configuration.configuration_digest
     &&profile.scope.model===configuration.configuration.model&&profile.scope.shape_digest===shape.shape_digest&&profile.scope.phase===shape.phase
     &&profile.scope.compiler_version===shape.compiler_version&&profile.source_run_id===run.id,'scope must match the actual native owner');
    const evidence=(await f.database.query('SELECT signal_listening_calibration_evidence_v1($1,$2,$3) profile',[f.workspace_id,run.id,shape.shape_digest])).rows[0]!.profile;
    assert.ok(evidence&&digest(evidence)===digest(profile),'native evidence must reproduce the exact source digest and all32 call identities');
    const sources=(await f.database.query(`SELECT id,workspace_id,run_id,status,results_applied,raw_sha256,raw_storage_key,raw_storage_verified_at,settled_micro_usd::text
     FROM signal_labeling_calls WHERE id=ANY($1::uuid[]) ORDER BY id`,[profile.source_call_ids])).rows;
    assert.equal(sources.length,32);assert.ok(sources.every(row=>row.workspace_id===f.workspace_id&&row.run_id===run.id&&row.status==='settled'&&row.results_applied
     &&row.raw_sha256&&row.raw_storage_key&&row.raw_storage_verified_at&&BigInt(row.settled_micro_usd)>0n),'every exact source must own verified durable applied paid-synthetic evidence');
    assert.ok(digest((await f.database.query('SELECT * FROM signal_labeling_calls WHERE run_id=$1 ORDER BY id',[run.id])).rows)===digest(beforeLedger));
    assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_listening_calibrations WHERE source_run_id=$1',[run.id])).rows[0]!.n,beforeProfileCount);
    assert.equal(physical,64);assert.equal(digest(request),requestDigest);assert.ok(JSON.stringify(request)===wire,'prefetch validation cannot change the UTF8 transport bytes');assert.ok(digest({execution:plan.execution,response_bound_bytes:plan.response_bound_bytes})===digest(bounds));
    assert.equal(runtime.prepareMeasuredRequests([request]),true);
    const directory=join(repository,'.data/piloto-masivo/r16/listening-second-shape-native');await mkdir(directory,{recursive:true,mode:0o700});
    await writeFile(join(directory,randomUUID()+'.json'),JSON.stringify({contract_version:'r16-native-existing-second-shape-proof-v1',source,warmups,
     map_absent_before:true,old_sync_accepted:false,new_async_accepted:true,profile,evidence,sources,request_digest:requestDigest,request_utf8_bytes:Buffer.byteLength(wire),request_wire_sha256_before:wireSha,request_wire_sha256_after:'sha256:'+createHash('sha256').update(JSON.stringify(request)).digest('hex'),
     bounds_unchanged:true,ledger_unchanged:true,profile_count_unchanged:true,provider_attempts_during_proof:0,real_provider_calls:0,
     acceptance:'component_proof_only_not_capacity'},null,2)+'\n',{flag:'wx',mode:0o600});
   }finally{await store.release(run);}
  }finally{await server.close();await rm(files,{recursive:true,force:true});}
 }});
 assert.ok((await captureR16SourceProvenanceV1(repository)).source_tree_sha256===source.source_tree_sha256,'source must remain unchanged');
 }finally{flags.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];});}
});
