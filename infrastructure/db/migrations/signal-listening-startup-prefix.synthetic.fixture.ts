import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {openR16CiPostgresV1,assertR16LocalPostgresPoolV1} from './signal-r16-local-pg.fixture';
import {assertSharedWireDefaultRuntimeV1,withSharedWireDefaultPostcheckV1} from './signal-listening-statement-shared-wire.oracle';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {prepareSignalListeningV1} from '../signal-listening-preparation';
import {getSignalListeningStatusV1} from '../signal-listening-serving';
import {loadR16ListeningNativeCensusV1} from '../../../scripts/r16/listening-native-census';
import {r16ListeningWorkloadV2} from '../../../scripts/r16/listening-workload';
import {captureR16SourceProvenanceV1} from '../../../scripts/r16/source-provenance';
import {signalWorkspaceEmbeddingDigestV1 as digest} from '@noisia/query-engine';

const hash=(value:string)=>'sha256:'+createHash('sha256').update(value).digest('hex');
export const STARTUP_PHASES=['setup','prepare','census','witness_before','status','oracles','witness_after'] as const;
type Phase=typeof STARTUP_PHASES[number];
type QueryTuple=[number,number,number,number,number,number,0|1];
type ConnectTuple=[number,number,number,number,number,0|1];
type Queryable={query:(...args:any[])=>any;connect?: (...args:any[])=>any};
/** Connection numbers identify JS clients, not backend PIDs. Pool.query is 0:
 * the driver's internal checkout is deliberately not intercepted a second time.
 * No SQL/binds/rows/error messages are retained. Observation never alters a result. */
export class StartupPrefixRecorderV1{
 private phase=0;private sequence=0;private nextConnection=0;private bytes=0;
 private readonly templates:string[]=[];private readonly templateIndex=new Map<string,number>();
 private readonly clients=new WeakMap<object,{id:number;proxy:object}>();
 private readonly queries:QueryTuple[]=[];private readonly connects:ConnectTuple[]=[];
 private seen=0;private dropped=0;private pending=0;private connectSeen=0;private connectPending=0;
 readonly spans:Array<[number,number,number,0|1]>=[];
 constructor(private readonly clock:()=>number,private readonly limits={queries:16000,templates:1024,bytes:8*1024*1024}){}
 private retain(value:unknown){const bytes=Buffer.byteLength(JSON.stringify(value));if(this.bytes+bytes>this.limits.bytes){this.dropped++;return false;}this.bytes+=bytes;return true;}
 async measure<T>(phase:Phase,body:()=>Promise<T>):Promise<T>{
  const previous=this.phase,index=STARTUP_PHASES.indexOf(phase),start=this.clock();this.phase=index;
  let ok:0|1=0;try{const value=await body();ok=1;return value;}finally{this.phase=previous;const span:[number,number,number,0|1]=[index,start,this.clock(),ok];if(this.retain(span))this.spans.push(span);}
 }
 private query(target:Queryable,id:number,args:any[]){
  const seq=++this.sequence,phase=this.phase,start=this.clock();this.seen++;
  const text=typeof args[0]==='string'?args[0]:args[0]&&typeof args[0].text==='string'?args[0].text:undefined;
  const key=text===undefined?undefined:hash(text.replace(/\s+/gu,' ').trim());
  let index=key===undefined?undefined:this.templateIndex.get(key);
  if(key!==undefined&&index===undefined&&this.templates.length<this.limits.templates&&this.retain(key)){
   index=this.templates.length;this.templates.push(key);this.templateIndex.set(key,index);
  }
  const record=index!==undefined&&this.queries.length+this.pending<this.limits.queries;
  if(!record)this.dropped++;
  else this.pending++;
  let finished=false;const finish=(ok:0|1)=>{if(finished)return;finished=true;if(record){this.pending--;const tuple:QueryTuple=[seq,id,phase,index!,start,this.clock(),ok];if(this.retain(tuple))this.queries.push(tuple);}};
  const forwarded=[...args],callback=forwarded.at(-1);
  if(typeof callback==='function')forwarded[forwarded.length-1]=function(this:unknown,...values:any[]){finish(values[0]?0:1);return callback.apply(this,values);};
  try{
   const result=target.query.apply(target,forwarded);
   if(typeof callback==='function')return result;
   if(result&&typeof result.then==='function')return result.then((value:unknown)=>{finish(1);return value;},(error:unknown)=>{finish(0);throw error;});
   // Current public entrypoints use promises. Preserve any other driver return
   // unchanged, but do not call that incomplete event a successful observation.
   finish(0);return result;
  }catch(error){finish(0);throw error;}
 }
 private client<T extends object>(client:T):T{
  const cached=this.clients.get(client);if(cached)return cached.proxy as T;
  const id=++this.nextConnection,proxy=new Proxy(client,{get:(target,key)=>{
   const value=Reflect.get(target,key,target);
   if(key==='query')return(...args:any[])=>this.query(target as T&Queryable,id,args);
   return typeof value==='function'?value.bind(target):value;
  }});this.clients.set(client,{id,proxy});return proxy;
 }
 wrap<T extends Queryable>(pool:T):T{return new Proxy(pool,{get:(target,key)=>{
  const value=Reflect.get(target,key,target);
  if(key==='query')return(...args:any[])=>this.query(target,0,args);
  if(key==='connect'&&typeof value==='function')return(...args:any[])=>{
   const seq=++this.sequence,phase=this.phase,start=this.clock();this.connectSeen++;this.connectPending++;let done=false;
   const finish=(client:object|undefined,ok:0|1)=>{if(done)return;done=true;this.connectPending--;const wrapped=client?this.client(client):undefined,id=client?this.clients.get(client)!.id:0;
    const tuple:ConnectTuple=[seq,id,phase,start,this.clock(),ok];if(this.connects.length<this.limits.queries&&this.retain(tuple))this.connects.push(tuple);else this.dropped++;return wrapped;};
   const forwarded=[...args],callback=forwarded.at(-1);
   if(typeof callback==='function')forwarded[forwarded.length-1]=function(this:unknown,error:unknown,client:object|undefined,release:unknown){const wrapped=finish(client,error?0:1);return callback.call(this,error,wrapped,release);};
   try{const result=value.apply(target,forwarded);if(typeof callback==='function')return result;
    return result.then((client:object)=>finish(client,1),(error:unknown)=>{finish(undefined,0);throw error;});
   }catch(error){finish(undefined,0);throw error;}
  };
  return typeof value==='function'?value.bind(target):value;
 }});}
 snapshot(){return{phases:STARTUP_PHASES,query_columns:['seq','connection','phase','template','start_ms','end_ms','ok'],connect_columns:['seq','connection','phase','start_ms','end_ms','ok'],
  templates:[...this.templates],queries:[...this.queries].sort((a,b)=>a[0]-b[0]),connect_waits:[...this.connects].sort((a,b)=>a[0]-b[0]),spans:[...this.spans],
  seen:this.seen,recorded:this.queries.length,dropped:this.dropped,pending:this.pending,connect_seen:this.connectSeen,connect_recorded:this.connects.length,connect_pending:this.connectPending,recorder_bytes:this.bytes,limits:this.limits,
  interpretation:'client wall spans overlap; connection0 is pool.query; no CPU or internal quote/continue/admit attribution'};}
}

export type StartupCallbackStateV1={entered:boolean;complete:boolean;failed:boolean;primary?:unknown};
export async function captureStartupCallbackV1<T>(state:StartupCallbackStateV1,body:()=>Promise<T>){state.entered=true;try{const value=await body();state.complete=true;return value;}catch(error){state.failed=true;state.primary=error;throw error;}}
/** Factory finally can mask the callback error. Keep the original privately and
 * aggregate distinct cleanup errors; a postcheck is still attempted afterwards. */
export async function closeStartupFactoryV1(state:StartupCallbackStateV1,factory:()=>Promise<void>,postcheck:()=>Promise<void>){
 const errors:unknown[]=[];let returned=false;
 try{await factory();returned=true;}catch(error){if(state.failed)errors.push(state.primary);if(!state.failed||error!==state.primary)errors.push(error);}
 try{await postcheck();}catch(error){errors.push(error);}
 if(errors.length===1)throw errors[0];if(errors.length>1)throw new AggregateError(errors,'startup callback/factory/postcheck failed',{cause:errors[0]});
 assert.ok(state.entered&&state.complete&&returned,'startup requires normal callback and factory completion');
}
export async function writeStartupPrefixEvidenceV1(directory:string,value:unknown){
 const bytes=JSON.stringify(value)+'\n';assert.ok(Buffer.byteLength(bytes)<=2*1024*1024,'startup evidence exceeds2MiB');
 await mkdir(directory,{recursive:true,mode:0o700});const f=await open(resolve(directory,'listening-startup-prefix.json'),'wx',0o600);
 try{await f.writeFile(bytes);}finally{await f.close();}
}
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
async function sources(){
 const all=await captureR16SourceProvenanceV1(repo),migrations=all.file_manifest.filter(row=>/^infrastructure\/db\/migrations\/(?:029[5-9]|03[0-2][0-9]|033[0-2])_.+\.sql$/u.test(row.path));
 assert.equal(migrations.length,38);return{head_sha:all.head_sha,source_tree_sha256:all.source_tree_sha256,tree_status_sha256:all.tree_status_sha256,file_count:all.file_count,
  migration38:migrations,harness:all.file_manifest.filter(row=>row.path.startsWith('scripts/r16/')||/^services\/workers\/src\/(?:workers\/signal-(?:jev|listening)|providers\/jev-streaming)/u.test(row.path))};
}
export async function runListeningStartupPrefixV1(directory:string){
 assert.equal(process.env.GITHUB_ACTIONS,'true','owned CI only');
 const started=performance.now(),clock=()=>performance.now()-started,recorder=new StartupPrefixRecorderV1(clock),workload=r16ListeningWorkloadV2('defined_consumer_second_pass');
 const callback:StartupCallbackStateV1={entered:false,complete:false,failed:false};
 let own:{name:string;oid:string}|null=null,absence:'UNKNOWN'|true='UNKNOWN',normalFactory=false;
 const report:Record<string,unknown>={contract:'r16-listening-startup-prefix-v1',status:'failed',diagnostic_only:true,h1_accepted:false,cpu:'UNKNOWN',
  bounds:{setup_ms:1800000,prefix_ms:120000,total_ms:1920000,semantics:'observed soft caps; no autonomous SQL cancellation; external job40min is the watchdog'},internal_phases:{quote:'UNKNOWN',continue:'UNKNOWN',admit:'UNKNOWN'},
  gates:{source_binding:false,initial_census:false,zero_provider_calls:false,zero_listening_calls:false,no_recording_loss:false,cleanup_confirmed:false}};
 const gates=report.gates as Record<string,boolean>;
 let failed=false,primary:unknown;
 try{
  const before=await sources();report.source_before=before;
  await closeStartupFactoryV1(callback,async()=>{
   await runMassLabelingAcceptanceFixtureV1('product-recovery',{benchmark:{isolated:true,root_count:32768,execution_cap_micro_usd:20000000,
    import_batch_size:512,preparation_page_size:100,embedding_page_limit:264,beforeProcessing:ctx=>captureStartupCallbackV1(callback,async()=>{
     assert.ok(clock()<=1800000,'startup setup soft cap exceeded');report.setup_ms=clock();
     const database=recorder.wrap(ctx.database);
     const identity=(await database.query("SELECT current_database() name,(SELECT oid::text FROM pg_database WHERE datname=current_database()) oid")).rows[0];
     assert.match(identity.name,/^noisia_mfp_recovery_[a-f0-9]{32}$/u);assert.match(identity.oid,/^\d+$/u);own={name:identity.name,oid:identity.oid};
     assert.equal((await database.query(`UPDATE signal_labeling_runs r SET status='canceled' WHERE r.id=$1
      AND r.workspace_id=$2 AND r.status='queued' AND NOT EXISTS(SELECT 1 FROM signal_labeling_calls c WHERE c.run_id=r.id) RETURNING r.id`,[ctx.run_id,ctx.workspace_id])).rows.length,1);
     const access={database,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id};
     const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:workload.configuration});
     assert.equal(cfg.configuration_digest,workload.configuration_digest);
     const t0=clock();assert.ok(t0<=1800000,'startup setup soft cap exceeded');report.setup_ms=t0;report.admission_started_at_ms=t0;
     const prepared=await recorder.measure('prepare',()=>prepareSignalListeningV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,
      idempotency_key:'r16-listening-benchmark:'+randomUUID(),cap_micro_usd:20000000,provider_available:true,prototype_provider_available:false}));
     assert.ok(prepared.status==='labeling'&&prepared.run_id,'native preparation must admit Listening');
     const binding={...access,configuration_id:cfg.id,map_id:ctx.map_id,question_key:'voice'};
     const census=await recorder.measure('census',()=>loadR16ListeningNativeCensusV1({...binding,run_id:prepared.run_id!},32768));
     const witnessBefore=await recorder.measure('witness_before',()=>assertSharedWireDefaultRuntimeV1(database));
     const status=await recorder.measure('status',()=>getSignalListeningStatusV1(binding));
     assert.equal(status.configuration?.id,binding.configuration_id);assert.equal(status.map?.id,binding.map_id);assert.equal(status.run?.id,prepared.run_id);
     assert.equal(status.map?.root_count,32768);assert.equal(digest(status.configuration?.configuration),workload.configuration_digest);
     assert.equal(census.root_ids.length,32768);assert.equal(new Set(census.root_ids).size,32768);
     const jobStart=clock();report.job_start_equivalent_ms=jobStart;report.prefix_elapsed_ms=jobStart-t0;
     assert.ok(Number(report.prefix_elapsed_ms)<=120000,'startup prefix soft cap exceeded');
     const state=await recorder.measure('oracles',async()=>{
      const row=(await database.query(`SELECT r.status,r.lease_token IS NULL AND r.lease_until IS NULL unleased,
       r.workspace_id=o.workspace_id AND r.actor_user_id=$3 AND o.configuration_id=$4 AND o.map_id=$5
        AND o.configuration_digest=$6 AND r.concept_set_digest=$6 owner_bound,
       a.id IS NOT NULL AND a.workspace_id=r.workspace_id AND a.target_id=r.id AND a.actor_user_id=r.actor_user_id AND a.action='mass_labeling_jev' admission_bound,
       (SELECT count(*)::int FROM signal_labeling_calls c WHERE c.workspace_id=r.workspace_id AND c.run_id=r.id) calls,
       (SELECT count(*)::int FROM signal_listening_answers answer WHERE answer.workspace_id=r.workspace_id AND answer.run_id=r.id) answers,
       (SELECT count(*)::int FROM signal_listening_calibrations calibration WHERE calibration.workspace_id=r.workspace_id AND calibration.source_run_id=r.id) calibrations,
       COALESCE((SELECT sum(c.reserved_micro_usd+c.settled_micro_usd+c.terminal_exposure_micro_usd) FROM signal_labeling_calls c WHERE c.workspace_id=r.workspace_id AND c.run_id=r.id),0)::text call_money
       FROM signal_labeling_runs r JOIN signal_listening_runs o ON o.run_id=r.id AND o.workspace_id=r.workspace_id
       LEFT JOIN signal_processing_admissions a ON a.id=r.processing_admission_id WHERE r.id=$1 AND r.workspace_id=$2`,
       [prepared.run_id,ctx.workspace_id,ctx.actor_user_id,cfg.id,ctx.map_id,cfg.configuration_digest])).rows[0];
      assert.deepEqual(row,{status:'queued',unleased:true,owner_bound:true,admission_bound:true,calls:0,answers:0,calibrations:0,call_money:'0'});
      assert.equal(status.run?.confirmed_micro_usd,'0');assert.equal(status.run?.reserved_micro_usd,'0');assert.equal(status.run?.unknown_micro_usd,'0');
      return row;
     });
     const witnessAfter=await recorder.measure('witness_after',()=>assertSharedWireDefaultRuntimeV1(database));assert.deepEqual(witnessAfter,witnessBefore);
     assert.equal(workload.configuration.questions.length,4);gates.initial_census=true;gates.zero_listening_calls=true;gates.zero_provider_calls=true;
     report.native={census_roots:32768,questions_per_root:4,question_pairs:131072,owner_admission_checked:true,configuration_digest:workload.configuration_digest,state,
      witness_before:witnessBefore,witness_after:witnessAfter,provider_calls:0,jobs:0,drainer_calls:0,external_spend_micro_usd:0};
    })}});
   normalFactory=true;
  },async()=>{
   if(!own)return;
   const admin=await openR16CiPostgresV1();
   await withSharedWireDefaultPostcheckV1(async()=>{
    assertR16LocalPostgresPoolV1(admin);
    // Autocommit SELECT only; the factory exclusively owns CREATE/DROP.
    const rows=(await admin.query('SELECT oid::text FROM pg_database WHERE datname=$1 OR oid=$2::oid',[own!.name,own!.oid])).rows;
    assert.equal(rows.length,0,'owned clone must be absent after factory cleanup');absence=true;
   },()=>admin.end());
  });
  const after=await sources();report.source_after=after;assert.deepEqual(after,before,'source/38SQL/harness changed during diagnostic');gates.source_binding=true;
  const recorded=recorder.snapshot();assert.equal(recorded.dropped,0);assert.equal(recorded.pending,0);assert.equal(recorded.connect_pending,0);assert.equal(recorded.seen,recorded.recorded);assert.equal(recorded.connect_seen,recorded.connect_recorded);assert.ok(recorded.seen>0);
  assert.ok(recorded.queries.every(row=>row[6]===1)&&recorded.connect_waits.every(row=>row[5]===1),'unexpected query/checkout error');gates.no_recording_loss=true;
  assert.ok(clock()<=1920000,'startup total soft cap exceeded');assert.equal(absence,true);gates.cleanup_confirmed=true;assert.ok(Object.values(gates).every(value=>value===true));report.status='observed';
 }catch(error){failed=true;primary=error;report.failure={kind:error instanceof AggregateError?'aggregate':error instanceof Error?'error':'unknown',callback_primary_preserved:callback.failed,setup_before_callback_unknown:!callback.entered};}
 report.total_ms=clock();report.observation=recorder.snapshot();report.closure={callback_entered:callback.entered,callback_complete:callback.complete,factory_returned_normally:normalFactory,own_database:own??'UNKNOWN',own_database_absent:absence};
 try{await writeStartupPrefixEvidenceV1(directory,report);}catch(publication){if(failed)throw new AggregateError([primary,publication],'startup failure and evidence publication failed',{cause:primary});throw publication;}
 if(failed)throw primary;return report;
}
