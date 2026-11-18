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
export function startupClientPidV1(client:object):number|'UNKNOWN'{
 try{const field=Object.getOwnPropertyDescriptor(client,'processID');return field&&'value'in field&&typeof field.value==='number'&&Number.isSafeInteger(field.value)&&field.value>0&&field.value<=2147483647?field.value:'UNKNOWN';}catch{return'UNKNOWN';}
}
/** Connection numbers identify JS clients, not backend PIDs. Pool.query is 0:
 * the driver's internal checkout is deliberately not intercepted a second time.
 * No SQL/binds/rows/error messages are retained. Observation never alters a result. */
export class StartupPrefixRecorderV1{
 private phase=0;private sequence=0;private nextConnection=0;private bytes=0;
 private readonly templates:string[]=[];private readonly templateIndex=new Map<string,number>();
 private readonly clients=new WeakMap<object,{id:number;proxy:object}>();
 private readonly backends=new Map<number,number|'UNKNOWN'>();
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
  }});this.clients.set(client,{id,proxy});const pid=startupClientPidV1(client);if(this.retain([id,pid]))this.backends.set(id,pid);return proxy;
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
  templates:[...this.templates],queries:[...this.queries].sort((a,b)=>a[0]-b[0]),connect_waits:[...this.connects].sort((a,b)=>a[0]-b[0]),spans:[...this.spans],connection_backends:[...this.backends],pool_query_backend:'UNKNOWN',initial_factory_raw_backend:'UNKNOWN',
  seen:this.seen,recorded:this.queries.length,dropped:this.dropped,pending:this.pending,connect_seen:this.connectSeen,connect_recorded:this.connects.length,connect_pending:this.connectPending,recorder_bytes:this.bytes,limits:this.limits,
  interpretation:'client wall spans overlap; connection0 is pool.query; no CPU or internal quote/continue/admit attribution'};}
}

const startupErrorPaths=new Set([
 'infrastructure/db/migrations/signal-listening-startup-prefix.synthetic.fixture.ts',
 'infrastructure/db/migrations/signal-listening-startup-prefix.postgres.test.ts',
 'infrastructure/db/migrations/signal-mass-labeling-acceptance.synthetic.fixture.ts',
 'infrastructure/db/migrations/signal-mass-labeling-concurrent.synthetic.fixture.ts',
 'infrastructure/db/migrations/signal-mass-labeling-product.synthetic.fixture.ts',
 'infrastructure/db/migrations/signal-r16-local-pg.fixture.ts',
 'infrastructure/db/migrations/signal-listening-statement-shared-wire.oracle.ts',
 'infrastructure/db/signal-listening-configuration.ts','infrastructure/db/signal-listening-preparation.ts',
 'infrastructure/db/signal-listening-runs.ts','infrastructure/db/signal-listening-serving.ts',
 'scripts/r16/listening-native-census.ts','scripts/r16/source-provenance.ts',
]);
/** Only own data properties are read: accessors are UNKNOWN, never invoked.
 * The object graph, stack scan and aggregate edge scan all have independent
 * bounds. This observer must not replace the original error with a serializer
 * exception; neither messages nor arbitrary class names leave the process. */
export function startupErrorTreeV1(error:unknown,repoRoot=repo){
 const limits={nodes:16,frames_per_node:4,depth:4,stack_chars_per_node:8192,stack_prefix_utf8_bytes_at_most:24576,stack_lines_per_node:128,aggregate_edges_per_node:16,format_prototype_depth:8};
 const nodes:Array<Record<string,unknown>>=[],seen=new WeakSet<object>(),ids=new WeakMap<object,number>();let truncated=false,references=0;
 const own=(object:object,key:string)=>{
  try{const descriptor=Object.getOwnPropertyDescriptor(object,key);if(!descriptor)return{present:false};
   if(!('value'in descriptor)){truncated=true;return{present:true,unreadable:true};}
   return{present:true,value:descriptor.value as unknown};
  }catch{truncated=true;return{present:true,unreadable:true};}
 };
 const safeFormat=(object:object,key:string)=>{
  try{let current:object|null=object;
   for(let i=0;current&&i<limits.format_prototype_depth;i++,current=Object.getPrototypeOf(current)){
    const field=Object.getOwnPropertyDescriptor(current,key);if(!field)continue;
    return'value'in field&&(field.value===undefined||typeof field.value==='string'&&field.value.length<=limits.stack_chars_per_node);
   }
   return current===null;
  }catch{return false;}
 };
 const edge=(value:unknown,depth:number):Record<string,unknown>=>{
  const object=(typeof value==='object'&&value!==null)||typeof value==='function'?value as object:undefined;
  if(object&&seen.has(object)){references++;return{ref:ids.get(object)!};}
  if(depth>limits.depth||nodes.length>=limits.nodes){truncated=true;return{omitted:depth>limits.depth?'depth_limit':'node_limit'};}
  const id=nodes.length,node:Record<string,unknown>={id,kind:object?'non_error':'primitive'};nodes.push(node);
  if(!object)return{ref:id};seen.add(object);ids.set(object,id);
  let isError=false,isAggregate=false,inferred='UNKNOWN';
  try{const prototypes=new WeakSet<object>();let current:object|null=Object.getPrototypeOf(object);
   const known=[[AggregateError.prototype,'AggregateError'],[TypeError.prototype,'TypeError'],[RangeError.prototype,'RangeError'],[SyntaxError.prototype,'SyntaxError'],[ReferenceError.prototype,'ReferenceError'],[URIError.prototype,'URIError'],[EvalError.prototype,'EvalError'],[Error.prototype,'Error']] as const;
   for(let i=0;current&&i<limits.format_prototype_depth;i++,current=Object.getPrototypeOf(current)){
    if(prototypes.has(current)){truncated=true;node.kind='unreadable';return{ref:id};}prototypes.add(current);
    const match=known.find(([prototype])=>prototype===current);if(match){isError=true;inferred=match[1];isAggregate=inferred==='AggregateError';break;}
   }
   if(current&&!isError){truncated=true;node.kind='unreadable';return{ref:id};}
  }catch{truncated=true;node.kind='unreadable';return{ref:id};}
  if(!isError)return{ref:id};node.kind=isAggregate?'aggregate':'error';
  // V8 may materialize a lazy stack using name/message. Do not request that
  // descriptor when either own property is an accessor or unreadable.
  const unreadable:string[]=[],name=own(object,'name'),code=own(object,'code'),message=own(object,'message');
  const safeStackFormat=safeFormat(object,'name')&&safeFormat(object,'message');
  if(!safeStackFormat)truncated=true;
  const stack=name.unreadable||message.unreadable||!safeStackFormat?{present:true,unreadable:true}:own(object,'stack');
  const names=new Set(['Error','AggregateError','AssertionError','TypeError','RangeError','SyntaxError','ReferenceError','URIError','EvalError','AbortError']);
  node.name=name.unreadable?'UNKNOWN':name.present?typeof name.value==='string'&&name.value.length<=32&&names.has(name.value)?name.value:'UNKNOWN':inferred;
  node.code=!code.unreadable&&typeof code.value==='string'&&(/^[A-Z0-9]{5}$/u.test(code.value)||code.value==='ERR_ASSERTION')?code.value:'UNKNOWN';
  for(const [key,field]of [['name',name],['code',code],['message',message],['stack',stack]] as const)if(field.unreadable)unreadable.push(key);
  const frames:Array<{path:string;line:number;column:number}>=[];node.frames=frames;
  if(typeof stack.value==='string'){
   const raw=stack.value;if(raw.length>limits.stack_chars_per_node)truncated=true;
   const bounded=raw.slice(0,limits.stack_chars_per_node),marker=repoRoot.replace(/\/$/u,'')+'/';
   // Skip the complete first line (the message), including a very long one.
   const first=bounded.indexOf('\n');let offset=first<0?bounded.length:first+1,lines=0;
   while(offset<bounded.length&&lines++<limits.stack_lines_per_node){
    const end=bounded.indexOf('\n',offset),line=bounded.slice(offset,end<0?bounded.length:end);offset=end<0?bounded.length:end+1;
    if(!/^\s+at\s/u.test(line))continue;const start=line.indexOf(marker);if(start<0)continue;
    const match=/^([A-Za-z0-9_./-]+):(\d{1,8}):(\d{1,8})\)?$/u.exec(line.slice(start+marker.length));
    if(!match||!startupErrorPaths.has(match[1]!))continue;
    const row={path:match[1]!,line:Number(match[2]),column:Number(match[3])};if(row.line<1||row.column<1)continue;
    if(frames.length<limits.frames_per_node)frames.push(row);else truncated=true;
   }
   if(offset<bounded.length)truncated=true;
  }
  if(isAggregate){
   const errors=own(object,'errors');
   if(errors.unreadable)unreadable.push('errors');
   else{
    let array=false;try{array=Array.isArray(errors.value);}catch{truncated=true;unreadable.push('errors');}
    if(array){const aggregate=errors.value as object,length=own(aggregate,'length');
     if(length.unreadable||typeof length.value!=='number'||!Number.isSafeInteger(length.value)||length.value<0){truncated=true;unreadable.push('errors.length');}
     else{const children:Array<Record<string,unknown>>=[];node.errors=children;
      if(length.value>limits.aggregate_edges_per_node)truncated=true;
      for(let i=0;i<Math.min(length.value,limits.aggregate_edges_per_node);i++){
       const child=own(aggregate,String(i));if(child.unreadable){unreadable.push('errors['+i+']');children.push({omitted:'unreadable'});}else children.push(edge(child.value,depth+1));
      }
     }
    }else if(!errors.unreadable){truncated=true;unreadable.push('errors');}
   }
  }
  const cause=own(object,'cause');if(cause.unreadable)unreadable.push('cause');else if(cause.present)node.cause=edge(cause.value,depth+1);
  if(unreadable.length)node.unreadable=unreadable;return{ref:id};
 };
 try{return{root:edge(error,0),nodes,limits,truncated,references};}
 catch{return{root:{omitted:'serializer_failure'},nodes:[],limits,truncated:true,references:0};}
}

export const startupOwnPresenceSqlV1=`SELECT datname name,oid::text oid,
 datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user) owner_ci
 FROM pg_database WHERE datname=$1 OR oid=$2::oid`;
export const startupOwnSessionsSqlV1=`SELECT activity.pid,activity.backend_start,activity.state,activity.xact_start
 FROM pg_stat_activity activity JOIN pg_database database ON database.oid=activity.datid
 WHERE activity.datid=$1::oid AND activity.datname=$2 AND database.datname=$2
  AND database.datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user)
  AND activity.usesysid=(SELECT oid FROM pg_roles WHERE rolname=current_user)
  AND activity.backend_type='client backend' ORDER BY activity.pid LIMIT 16`;
/** Extra context only after the unchanged absence assertion has already failed.
 * Both SELECTs use the same borrowed admin client in autocommit, never the clone.
 * Observational failure does not replace the actual absence error. */
export async function assertStartupOwnedAbsentV1(c:Queryable,own:{name:string;oid:string},observe:(value:Record<string,unknown>)=>void){
 const emit=(value:Record<string,unknown>)=>{try{observe(value);}catch{/* Observation must not replace the absence error. */}};
 const rows=(await c.query(startupOwnPresenceSqlV1,[own.name,own.oid])).rows;
 let primary:unknown;try{assert.equal(rows.length,0,'owned clone must be absent after factory cleanup');emit({status:'not_needed_absent'});return;}catch(error){primary=error;}
 const data=(object:object,key:string):unknown=>{try{const field=Object.getOwnPropertyDescriptor(object,key);return field&&'value'in field?field.value:undefined;}catch{return undefined;}};
 const row=rows.length===1?rows[0]:undefined;
 if(!row||data(row,'name')!==own.name||data(row,'oid')!==own.oid||data(row,'owner_ci')!==true){emit({status:'UNKNOWN',reason:'identity_or_owner_mismatch'});throw primary;}
 try{
  const sessions=(await c.query(startupOwnSessionsSqlV1,[own.oid,own.name])).rows;
  assert.ok(Array.isArray(sessions)&&sessions.length<=16);
  const time=(value:unknown)=>{if(value===null)return null;try{return Date.prototype.toISOString.call(value);}catch{return'UNKNOWN';}};
  const states=new Set(['active','idle','idle in transaction','idle in transaction (aborted)','fastpath function call','disabled']);
  emit({status:'observed',possibly_truncated:sessions.length===16,scope:'exact owned database/current CI role/client backend; not all roles or a causal proof',sessions:sessions.map((session:object)=>{
   const pid=data(session,'pid'),state=data(session,'state');return{pid:typeof pid==='number'&&Number.isSafeInteger(pid)&&pid>0&&pid<=2147483647?pid:'UNKNOWN',backend_start:time(data(session,'backend_start')),state:typeof state==='string'&&state.length<=32&&states.has(state)?state:'UNKNOWN',xact_start:time(data(session,'xact_start'))};
  })});
 }catch(error){emit({status:'UNKNOWN',reason:'session_observation_failed',error_tree:startupErrorTreeV1(error)});}
 throw primary;
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
    const client=await admin.connect();
    await withSharedWireDefaultPostcheckV1(async()=>{
     await assertStartupOwnedAbsentV1(client,own!,value=>{report.cleanup_observation=value;});absence=true;
    },async()=>{client.release();});
   },()=>admin.end());
  });
  const after=await sources();report.source_after=after;assert.deepEqual(after,before,'source/38SQL/harness changed during diagnostic');gates.source_binding=true;
  const recorded=recorder.snapshot();assert.equal(recorded.dropped,0);assert.equal(recorded.pending,0);assert.equal(recorded.connect_pending,0);assert.equal(recorded.seen,recorded.recorded);assert.equal(recorded.connect_seen,recorded.connect_recorded);assert.ok(recorded.seen>0);
  assert.ok(recorded.queries.every(row=>row[6]===1)&&recorded.connect_waits.every(row=>row[5]===1),'unexpected query/checkout error');gates.no_recording_loss=true;
  assert.ok(clock()<=1920000,'startup total soft cap exceeded');assert.equal(absence,true);gates.cleanup_confirmed=true;assert.ok(Object.values(gates).every(value=>value===true));report.status='observed';
 }catch(error){failed=true;primary=error;const tree=startupErrorTreeV1(error),kind=tree.nodes[0]?.kind;report.failure={kind:kind==='aggregate'?'aggregate':kind==='error'?'error':'unknown',error_tree:tree,callback_primary_preserved:callback.failed,setup_before_callback_unknown:!callback.entered};}
 report.total_ms=clock();report.observation=recorder.snapshot();report.closure={callback_entered:callback.entered,callback_complete:callback.complete,factory_returned_normally:normalFactory,own_database:own??'UNKNOWN',own_database_absent:absence};
 try{await writeStartupPrefixEvidenceV1(directory,report);}catch(publication){if(failed)throw new AggregateError([primary,publication],'startup failure and evidence publication failed',{cause:primary});throw publication;}
 if(failed)throw primary;return report;
}
