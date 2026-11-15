import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runMassLabelingAcceptanceFixtureV1} from '../../infrastructure/db/migrations/signal-mass-labeling-acceptance.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../../infrastructure/db/signal-listening-configuration';
import {prepareSignalListeningV1} from '../../infrastructure/db/signal-listening-preparation';
import {signalListeningJevJobV1,createSignalListeningRuntimeStoreV1} from '../../services/workers/src/workers/signal-listening-jev';
import {createCalibratedJevRuntimeProviderV2} from '../../services/workers/src/providers/jev-streaming-runtime';
import {createWorkspaceEngineStorageV1,type WorkspaceEngineStorageV1} from '../../services/workers/src/workers/signal-workspace-engine-storage';
import {createLabelingRawPagesStorageV1} from '../../services/workers/src/workers/signal-labeling-receipt-storage';
import {createSyntheticJevFetchV1,deterministicR16LatencyV1} from './synthetic-jev';
import {startR16HttpFilesystemStorageV1} from './http-filesystem-storage';
import {assertR16ListeningSyntheticPreflightV1} from './listening-preflight';
import {r16ListeningWorkloadV1,R16_LISTENING_PREREGISTRATION_V1 as registration} from './listening-workload';
import {loadR16ListeningNativeCensusV1} from './listening-native-census';
import {captureR16SourceProvenanceV1,r16PolicyConfigurationDigestV1} from './source-provenance';
import type {R16ListeningFaultKindV1} from './listening-fault-plan';

type Database=Parameters<typeof createSignalListeningRuntimeStoreV1>[0];
type Store=ReturnType<typeof createSignalListeningRuntimeStoreV1>;
type CallRow={id:string;request_digest:string;status:string;results_applied:boolean;settled_micro_usd:string|null;
 reserved_micro_usd:string;raw_storage_key:string|null;results:Array<{status:string}>|null};
const execution={max_in_flight:3,flush_size:3,max_flushes:1,max_buffered_bytes:16*1024*1024,flush_interval_ms:20,window_size:3};
const ownedLab=()=>{
 if(process.env.NOISIA_R16_LOCAL_PG_LAB!=='r16-benchmark-pg17'||process.env.NOISIA_R16_NATIVE_FIXTURE_PG!=='true')
  throw Error('r16_listening_fault_owned_native_lab_required');
};
/** Faults use isolated three-root native clones. No CLI, environment loading or
 * implicit execution: the orchestrator schedules the approved quiet-lab window. */
export async function runR16ListeningFaultMatrixV1(args:{object_directory:string;redis_url:string;
 cases?:R16ListeningFaultKindV1[];writeArtifact(value:unknown):Promise<void>}){
 ownedLab();const redis=new URL(args.redis_url);
 if(!['127.0.0.1','localhost','[::1]'].includes(redis.hostname)||!['redis:','rediss:'].includes(redis.protocol))throw Error('r16_listening_fault_local_redis_required');
 const cases=args.cases??[...registration.faults];
 assert.ok(cases.length>0&&new Set(cases).size===cases.length&&cases.every(c=>registration.faults.includes(c)));
 const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),source=await captureR16SourceProvenanceV1(repo);
 const storageServer=await startR16HttpFilesystemStorageV1(args.object_directory),results:unknown[]=[];
 try{
  for(const kind of cases)await runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async ctx=>{
   const original=ctx.database,workload=r16ListeningWorkloadV1('defined_consumer_second_pass');
   const canceled=await original.query(`UPDATE signal_labeling_runs r SET status='canceled' WHERE r.id=$1 AND r.workspace_id=$2
    AND r.status='queued' AND NOT EXISTS(SELECT 1 FROM signal_labeling_calls c WHERE c.run_id=r.id) RETURNING r.id`,[ctx.run_id,ctx.workspace_id]);
   assert.equal(canceled.rows.length,1);
   const access={database:original,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id};
   const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:workload.configuration});
   assert.equal(cfg.configuration_digest,workload.configuration_digest);assert.deepEqual(cfg.configuration,workload.configuration);
   const admission_started_at_ms=performance.now();
   const prepared=await prepareSignalListeningV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,idempotency_key:randomUUID(),
    cap_micro_usd:20000000,provider_available:true,prototype_provider_available:false});
   assert.ok(prepared.status==='labeling'&&prepared.run_id);
   const run_id=prepared.run_id,binding={...access,configuration_id:cfg.id,map_id:ctx.map_id,run_id};
   const census=await loadR16ListeningNativeCensusV1(binding,3);assert.deepEqual(await census.readResolvedRootIds(),[]);
   const identity=(await original.query(`SELECT current_database() database_name,(SELECT system_identifier::text FROM pg_control_system()) system_identifier,
    a.id admission_id,a.action,a.provider,a.model,a.configuration,a.configuration_digest,a.execution_cap_micro_usd::text execution_cap,
    a.policy_version_id,p.policy_digest,p.daily_cap_micro_usd::text daily_cap,pa.max_execution_micro_usd::text action_cap,
    a.budget_date::text budget_date,p.budget_timezone,l.identity#>>'{params,request_version}' request_version
    FROM signal_labeling_runs r JOIN signal_labeler_versions l ON l.id=r.labeler_version_id
    JOIN signal_processing_admissions a ON a.id=r.processing_admission_id JOIN signal_processing_policy_versions p ON p.id=a.policy_version_id
    JOIN signal_processing_policy_actions pa ON pa.policy_version_id=p.id AND pa.action=a.action WHERE r.id=$1`,[run_id])).rows[0];
   assert.ok(identity);assert.match(identity.database_name,/^noisia_mfp_recovery_[a-f0-9]{32}$/);
   assert.equal(identity.request_version,'listening-jev-v1');assert.equal(identity.action,'mass_labeling_jev');
   const policy_configuration_digest=r16PolicyConfigurationDigestV1({action:identity.action,configuration:identity.configuration,
    configuration_digest:identity.configuration_digest,model:identity.model,provider:identity.provider,policy_version_id:identity.policy_version_id,
    policy_digest:identity.policy_digest,policy_daily_cap_micro_usd:identity.daily_cap,policy_max_execution_micro_usd:identity.action_cap});
   let armed=false,injected=false,expiry=false,storageAck=false;
   // Only apply's REAL transaction is armed. Throw AFTER its actual COMMIT,
   // never fabricate a commit or mutate a ledger to make recovery succeed.
   const database=Object.assign(Object.create(original),{query:original.query.bind(original),connect:async()=>{
    const client=await original.connect();return Object.assign(Object.create(client),{release:()=>client.release(),query:async(sql:string,values?:unknown[])=>{
     const value=await client.query(sql,values);
     if(kind==='postgres_commit'&&armed&&!injected&&sql.trim().toUpperCase()==='COMMIT'){injected=true;throw Error('r16_listening_native_commit_ack_lost');}
     return value;
    }});
   }}) as Database;
   const physical:Array<{call_id:string;request_digest:string;body:string}>=[],statuses:number[]=[],retry_after_ms:number[]=[];
   let expiryWork:Promise<void>|undefined;
   const expire=()=>expiryWork??=(async()=>{
    if(expiry)return;const changed=await original.query(`UPDATE signal_labeling_runs SET lease_until=clock_timestamp()-interval '1 second'
     WHERE id=$1 AND workspace_id=$2 AND lease_token IS NOT NULL AND lease_until>clock_timestamp() RETURNING id`,[run_id,ctx.workspace_id]);
    assert.equal(changed.rows.length,1,'only this fixture-owned active lease may be expired');expiry=true;
   })();
   const synthetic=createSyntheticJevFetchV1({latencyForRequest:deterministicR16LatencyV1,
    responseForRequest:index=>index===0&&(kind==='429'||kind==='529')?{status:Number(kind),retry_after_ms:1000}:{status:200},
    onRequest:async({body})=>{
     const rows=(await original.query('SELECT id,request_digest FROM signal_labeling_calls WHERE run_id=$1 AND request=$2::jsonb',[run_id,body])).rows;
     assert.equal(rows.length,1,'every physical send must already own exactly one native request reservation');
     physical.push({call_id:rows[0].id,request_digest:rows[0].request_digest,body});if(kind==='lease_expiry')await expire();
    },onResponse:event=>{statuses.push(event.http_status);}});
   const factory:typeof createCalibratedJevRuntimeProviderV2=opts=>createCalibratedJevRuntimeProviderV2({...opts,
    env:{...opts.env,TYPESAFE_API_KEY:'synthetic-local-only',NOISIA_TYPESAFE_ACCOUNT_ID:`r16-listening:${census.organization_id}`,
     NOISIA_TYPESAFE_ACCOUNT_REDIS_URL:args.redis_url,NOISIA_TYPESAFE_ACCOUNT_RPS:'10000',NOISIA_TYPESAFE_ACCOUNT_INPUT_TPS:'10000000'},
    fetch:async(...params)=>{const response=await synthetic(...params);const value=response.headers.get('retry-after');if(value)retry_after_ms.push(Number(value)*1000);return response;}});
   const baseStorage=createWorkspaceEngineStorageV1({url:storageServer.base_url,service_role_key:'synthetic-local-only',bucket:'corpus-files'});
   const storage:WorkspaceEngineStorageV1={...baseStorage,async put(...params){const stored=await baseStorage.put(...params);
    if(kind==='raw_page_write'&&!storageAck){storageAck=true;throw Error('r16_listening_storage_ack_lost');}return stored;}};
   const base=createSignalListeningRuntimeStoreV1(database,{execution,storage});
   const store:Store={...base,
    async apply(...params){if(kind==='lease_expiry_after_durable')await expire();armed=true;try{return await base.apply(...params);}finally{armed=false;}},
    async settlePage(...params){const result=await base.settlePage(...params);if(kind==='settlement_ack_lost'&&!injected){injected=true;throw Error('r16_listening_settlement_ack_lost');}return result;},
    async persistRawPage(...params){const result=await base.persistRawPage(...params);if(kind==='worker_restart_after_page'&&!injected){injected=true;throw Error('r16_listening_restart_after_page');}return result;},
   };
   // Foreign actor and over-cap admission must fail before physical I/O, through
   // the normal native request API. No synthetic policy row is inserted here.
   await assert.rejects(prepareSignalListeningV1({...binding,actor_user_id:randomUUID(),idempotency_key:randomUUID(),cap_micro_usd:20000000,provider_available:true}));
   const actionCap=Number(identity.action_cap);assert.ok(Number.isSafeInteger(actionCap)&&actionCap>0);
   const over=actionCap+1;assert.ok(Number.isSafeInteger(over));
   await assert.rejects(prepareSignalListeningV1({...binding,idempotency_key:randomUUID(),cap_micro_usd:over,provider_available:true}));assert.equal(physical.length,0);
   const invoke=()=>signalListeningJevJobV1(run_id,{database,store,execution,calibrated_provider_factory:factory,
    preflight:()=>assertR16ListeningSyntheticPreflightV1({storage,storage_url:storageServer.base_url,...workload,env:process.env})});
   const calls=async()=>(await original.query<CallRow>('SELECT id,request_digest,status,results_applied,settled_micro_usd::text,reserved_micro_usd::text,raw_storage_key,results FROM signal_labeling_calls WHERE run_id=$1 ORDER BY id',[run_id])).rows;
   const attempts:Array<{status?:string;error?:string}>=[];
   for(let attempt=0;attempt<12;attempt++){
    try{const result=await invoke();attempts.push({status:result.status});}catch(error){attempts.push({error:error instanceof Error?error.message:String(error)});}
    const rows=await calls();if(rows.some(c=>c.status==='unknown'&&!c.raw_storage_key)||['429','529','lease_expiry'].includes(kind)&&attempt>=1)break;
    if((await census.readResolvedRootIds()).length===3)break;
   }
   const first=await calls(),physicalBefore=physical.length;
   // Fresh job, same native identity: all durable raw recovery is replayed
   // before missing eligible work; ambiguous physical calls cannot be resent.
   try{const result=await invoke();attempts.push({status:result.status});}catch(error){attempts.push({error:error instanceof Error?error.message:String(error)});}
   const final=await calls(),resolved=await census.readResolvedRootIds(),unknown=final.filter(c=>c.status==='unknown');
   const physicalIds=new Set(physical.map(c=>c.call_id));
   assert.equal(physicalIds.size,physical.length,'no native request identity may be physically replayed');
   assert.ok(final.filter(c=>!physicalIds.has(c.id)).every(c=>!c.results_applied&&!c.raw_storage_key&&c.settled_micro_usd===null),'never-sent reservations cannot receive technical results or money');
   assert.ok(final.filter(c=>c.settled_micro_usd!==null).every(c=>c.status==='settled'&&c.raw_storage_key),'money requires native durable receipt');
   const pages=(await original.query<{id:string;storage_key:string;sha256:string;size_bytes:string;status:string}>('SELECT id,storage_key,sha256,size_bytes::text,status FROM signal_labeling_raw_pages WHERE run_id=$1 ORDER BY id',[run_id])).rows;
   const rawPages=createLabelingRawPagesStorageV1(baseStorage);
   for(const page of pages.filter(p=>p.status==='verified'))await rawPages.load({workspace_id:ctx.workspace_id,run_id,page_id:page.id,storage_key:page.storage_key,sha256:page.sha256,size_bytes:Number(page.size_bytes)});
   const budget=(await original.query(`SELECT COALESCE((SELECT sum(settled_micro_usd) FROM signal_labeling_calls WHERE run_id=$1),0)::text settled,
    e.total_micro_usd::text exposure FROM signal_processing_org_exposure_v1($2::uuid,$3::date,$4::text) e`,[run_id,census.organization_id,identity.budget_date,identity.budget_timezone])).rows[0];
   assert.ok(BigInt(budget.settled)<=BigInt(identity.execution_cap));assert.ok(BigInt(budget.exposure)<=BigInt(identity.daily_cap));
   const contained=['429','529','lease_expiry'].includes(kind);
   if(contained){assert.ok(unknown.length>0);assert.equal(physical.length,physicalBefore,'unknown recovery must not admit new physical work');
    assert.ok(unknown.every(c=>c.settled_micro_usd===null&&BigInt(c.reserved_micro_usd)>0));assert.ok(resolved.length<3);
   }else{assert.equal(resolved.length,3,`${kind} must resolve all four questions per root after native restart`);assert.equal(unknown.length,0);
    assert.equal(final.length,6);assert.ok(final.every(c=>c.status==='settled'&&c.results_applied&&c.raw_storage_key));}
   if(kind==='429'||kind==='529'){assert.ok(statuses.includes(Number(kind)));assert.ok(retry_after_ms.some(ms=>ms>=1000));}
   if(kind==='lease_expiry'||kind==='lease_expiry_after_durable')assert.ok(expiry);
   if(kind==='raw_page_write')assert.ok(storageAck);
   if(['postgres_commit','settlement_ack_lost','worker_restart_after_page'].includes(kind))assert.ok(injected);
   results.push({kind,outcome:contained?'contained_unknown':'recovered',run_id,configuration_digest:workload.configuration_digest,
    admission_started_at_ms,elapsed_ms:performance.now()-admission_started_at_ms,source,identity,policy_configuration_digest,
    native_root_census:{population:3,resolved:resolved.length,root_ids:census.root_ids},before_recovery:first,after_recovery:final,
    native_money:budget,raw_pages:pages,physical,statuses,retry_after_ms,attempts,physical_replays:0,
    guard_denials:{actor:1,budget:1,physical_requests:0}});
  }});
  assert.equal((await captureR16SourceProvenanceV1(repo)).source_tree_sha256,source.source_tree_sha256);
  const artifact={contract_version:'r16-listening-native-fault-matrix-v1',completed_at:new Date().toISOString(),source,
   diagnostic_subset:cases.length!==8,configuration_digest:r16ListeningWorkloadV1('defined_consumer_second_pass').configuration_digest,
   results,storage:storageServer.metrics()};await args.writeArtifact(artifact);return artifact;
 }finally{await storageServer.close();}
}
