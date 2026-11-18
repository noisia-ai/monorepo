import {Session} from 'node:inspector/promises';
import {createHash} from 'node:crypto';
import {readFile,open,realpath,lstat,readdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';

// Diagnostic-only: these are retention/observed-duration bounds, not V8 memory
// bounds or a hard interrupt of the observed JavaScript thread.
export const CONSUMER_CPU_LIMITS_V1={observed_ms:60_000,sampling_interval_us:2_000,
 nodes:8192,samples:65536,depth:256,profile_bytes:1048576,summary_bytes:131072,
 receipt_bytes:1179648,combined_artifact_bytes:2097152} as const;
const sourcePaths=[
 'infrastructure/db/migrations/signal-listening-pipeline-profile.synthetic.fixture.ts',
 'infrastructure/db/signal-listening-runs.ts','infrastructure/db/signal-listening-calibration.ts',
 'scripts/r16/synthetic-jev.ts',
 'services/workers/src/workers/signal-listening-jev.ts',
 'services/workers/src/workers/signal-listening-calibration.ts',
 'services/workers/src/workers/signal-jev-labeling-page.ts',
 'services/workers/src/workers/signal-jev-streaming-window.ts',
 'services/workers/src/workers/signal-labeling-receipt-storage.ts',
 'services/workers/src/providers/jev-streaming-runtime.ts','services/workers/src/providers/typesafe-jev.ts',
 'packages/query-engine/src/signal-listening-contracts.ts','packages/query-engine/src/signal-listening-calibration.ts',
 'packages/query-engine/src/signal-mention-labeler-v1.ts',
 'infrastructure/db/migrations/signal-listening-consumer-main-thread-cpu.synthetic.fixture.ts',
] as const;
export type ConsumerCpuSourceV1={path:typeof sourcePaths[number];sha256:string};
export type ConsumerCpuBackendV1={connect():void;enable():Promise<void>;setSamplingInterval(interval:number):Promise<void>;
 start():Promise<void>;stop():Promise<unknown>;disable():Promise<void>;disconnect():void};
type FailureCode='connect'|'enable'|'sampling_interval'|'start'|'watchdog_arm'|'watchdog_clear'|'stop'|'sanitize'|'disable'|'disconnect';
type Category='repo'|'unknown'|'idle'|'gc'|'program'|'root';
type SafeFrame={category:Category;position_kind:'GENERATED'|'NONE';source_index:number|null;line_number:number|null;column_number:number|null};
type SafeNode={id:number;frame:SafeFrame;children:number[]};
export type ConsumerCpuProfileV1={profile:{nodes:SafeNode[];samples:number[];time_deltas_us:number[];duration_us:number};
 summary:{sample_count:number;leaf_samples:Array<{frame:SafeFrame;samples:number}>;categories:Record<Category,number>;
 attribution:'main_thread_samples_not_exact_cpu';inclusive_samples:'NOT_COMPUTED';positions:'GENERATED_NO_SOURCE_MAP'};profile_bytes:number;summary_bytes:number};
const invalid=()=>new Error('consumer_cpu_profile_invalid_or_over_limit');
function known(condition:unknown):asserts condition{if(!condition)throw invalid();}
function record(value:unknown):Record<string,unknown>{known(value!==null&&typeof value==='object'&&!Array.isArray(value));
 const proto=Object.getPrototypeOf(value);known(proto===Object.prototype||proto===null);return value as Record<string,unknown>;}
function own(value:unknown,key:string):unknown{const d=Object.getOwnPropertyDescriptor(record(value),key);known(d&&'value'in d);return d.value;}
function array(value:unknown,cap:number):unknown[]{known(Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype);
 const d=Object.getOwnPropertyDescriptor(value,'length');known(d&&'value'in d);const length=integer(d.value);known(length<=cap);
 const dense:unknown[]=[];for(let i=0;i<length;i++){const field=Object.getOwnPropertyDescriptor(value,String(i));known(field&&'value'in field);dense.push(field.value);}return dense;}
function item(value:unknown[],index:number):unknown{const d=Object.getOwnPropertyDescriptor(value,String(index));known(d&&'value'in d);return d.value;}
function number(value:unknown,min=0):number{known(typeof value==='number'&&Number.isFinite(value)&&value>=min);return value;}
function integer(value:unknown,min=0):number{const n=number(value,min);known(Number.isSafeInteger(n));return n;}
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
function validateSources(sources:readonly ConsumerCpuSourceV1[]){known(sources.length===sourcePaths.length);
 for(let i=0;i<sourcePaths.length;i++){const row=sources[i];known(row&&row.path===sourcePaths[i]&&/^[a-f0-9]{64}$/.test(row.sha256));}}
export async function loadConsumerCpuSourcesV1(repoRoot:string):Promise<ConsumerCpuSourceV1[]>{
 try{const root=await realpath(repoRoot);return await Promise.all(sourcePaths.map(async path=>({path,sha256:hash(await readFile(resolve(root,path)))})));}
 catch{throw new Error('consumer_cpu_static_sources_unavailable');}
}
function safeFrame(raw:unknown,root:string,sources:readonly ConsumerCpuSourceV1[]):SafeFrame{
 const url=own(raw,'url'),name=own(raw,'functionName'),line=integer(own(raw,'lineNumber'),-1),column=integer(own(raw,'columnNumber'),-1);
 known(typeof url==='string'&&url.length<=2048&&typeof name==='string'&&name.length<=2048);
 const unknown:SafeFrame={category:'unknown',position_kind:'NONE',source_index:null,line_number:null,column_number:null};
 if(url===''){
  const pseudo:Record<string,Category>={'(root)':'root','(idle)':'idle','(garbage collector)':'gc','(program)':'program'};
  const category=Object.prototype.hasOwnProperty.call(pseudo,name)?pseudo[name]!:undefined;
  return category?{...unknown,category}:unknown;
 }
 let path:string;try{path=url.startsWith('file:')?fileURLToPath(url):url;}catch{return unknown;}
 if(!isAbsolute(path))return unknown;
 const rel=relative(root,path),index=sources.findIndex(s=>s.path===rel);
 if(index<0||line<0||column<0)return unknown;
 // V8 reports generated positions even when the URL names a .ts source file.
 return{category:'repo',position_kind:'GENERATED',source_index:index,line_number:line,column_number:column};
}
function sanitizeProfile(raw:unknown,repoRoot:string,sources:readonly ConsumerCpuSourceV1[]):ConsumerCpuProfileV1{
 validateSources(sources);const root=resolve(repoRoot),rawNodes=array(own(raw,'nodes'),CONSUMER_CPU_LIMITS_V1.nodes);
 const rawSamples=array(own(raw,'samples'),CONSUMER_CPU_LIMITS_V1.samples),rawDeltas=array(own(raw,'timeDeltas'),CONSUMER_CPU_LIMITS_V1.samples);
 known(rawNodes.length>0&&rawSamples.length>0&&rawSamples.length===rawDeltas.length);
 const start=number(own(raw,'startTime')),end=number(own(raw,'endTime'));known(end>=start&&end-start<=CONSUMER_CPU_LIMITS_V1.observed_ms*1000);
 const nodes:SafeNode[]=[],byId=new Map<number,SafeNode>();let edges=0;
 for(let i=0;i<rawNodes.length;i++){
  const n=item(rawNodes,i),id=integer(own(n,'id'),1);known(!byId.has(id));
  const childDescriptor=Object.getOwnPropertyDescriptor(record(n),'children');let children:number[]=[];
  if(childDescriptor){known('value'in childDescriptor);const rows=array(childDescriptor.value,CONSUMER_CPU_LIMITS_V1.nodes);edges+=rows.length;known(edges<=CONSUMER_CPU_LIMITS_V1.nodes);
   children=Array.from({length:rows.length},(_,j)=>integer(item(rows,j),1));known(new Set(children).size===children.length);}
  const node={id,frame:safeFrame(own(n,'callFrame'),root,sources),children};nodes.push(node);byId.set(id,node);
 }
 const seen=new Set<number>(),stack:Array<{id:number;depth:number}>=[{id:nodes[0]!.id,depth:0}];
 while(stack.length){const next=stack.pop()!;known(next.depth<=CONSUMER_CPU_LIMITS_V1.depth&&!seen.has(next.id));seen.add(next.id);
  const n=byId.get(next.id);known(n);for(const id of n.children){known(byId.has(id));stack.push({id,depth:next.depth+1});}}
 known(seen.size===nodes.length);
 const samples:number[]=[],time_deltas_us:number[]=[],leaf=new Map<string,{frame:SafeFrame;samples:number}>();
 const categories:Record<Category,number>={repo:0,unknown:0,idle:0,gc:0,program:0,root:0};
 for(let i=0;i<rawSamples.length;i++){const id=integer(item(rawSamples,i),1),n=byId.get(id);known(n);samples.push(id);
  time_deltas_us.push(number(item(rawDeltas,i)));categories[n.frame.category]++;
  const key=JSON.stringify(n.frame),prior=leaf.get(key);if(prior)prior.samples++;else leaf.set(key,{frame:n.frame,samples:1});}
 const profile={nodes,samples,time_deltas_us,duration_us:end-start};
 const summary:ConsumerCpuProfileV1['summary']={sample_count:samples.length,leaf_samples:[...leaf.values()],categories,
  attribution:'main_thread_samples_not_exact_cpu',inclusive_samples:'NOT_COMPUTED',positions:'GENERATED_NO_SOURCE_MAP'};
 const profile_bytes=Buffer.byteLength(JSON.stringify(profile)),summary_bytes=Buffer.byteLength(JSON.stringify(summary));
 known(profile_bytes<=CONSUMER_CPU_LIMITS_V1.profile_bytes&&summary_bytes<=CONSUMER_CPU_LIMITS_V1.summary_bytes);
 return{profile,summary,profile_bytes,summary_bytes};
}
export function sanitizeConsumerCpuProfileV1(raw:unknown,repoRoot:string,sources:readonly ConsumerCpuSourceV1[]):ConsumerCpuProfileV1{
 try{return sanitizeProfile(raw,repoRoot,sources);}catch{throw invalid();}
}
function localBackend():ConsumerCpuBackendV1{const session=new Session();return{connect:()=>session.connect(),enable:()=>session.post('Profiler.enable'),
 setSamplingInterval:interval=>session.post('Profiler.setSamplingInterval',{interval}),start:()=>session.post('Profiler.start'),
 stop:()=>session.post('Profiler.stop'),disable:()=>session.post('Profiler.disable'),disconnect:()=>session.disconnect()};}
export type ConsumerCpuObserverOptionsV1={repoRoot:string;sourceManifest:readonly ConsumerCpuSourceV1[];
 backend?:ConsumerCpuBackendV1;clock?:()=>number;watchdog?:(stop:()=>void)=>()=>void};
export function createConsumerMainThreadCpuObserverV1(options:ConsumerCpuObserverOptionsV1){
 validateSources(options.sourceManifest);const sources=options.sourceManifest.map(s=>({...s})),backend=options.backend??localBackend(),clock=options.clock??(()=>performance.now());
 const errors:FailureCode[]=[],marks:Record<string,number|null>={start_request_ms:null,start_ack_ms:null,stop_request_ms:null,stop_ack_ms:null};
 const cleanup={disable_attempted:false,disable_confirmed:false,disconnect_attempted:false,disconnect_confirmed:false,watchdog_cleared:false};
 let invoked=false,connectAttempted=false,enableAttempted=false,startAttempted=false,stopCommands=0,connected=false,enabled=false,started=false,worker:'not_started'|'running'|'drained'|'failed'='not_started';
 let stopPromise:Promise<void>|undefined,reason:'job_drained'|'watchdog'|'worker_failed'|null=null,sanitized:ConsumerCpuProfileV1|null=null;
 let clearWatchdog:(()=>void)|undefined,status:'not_started'|'running'|'observed'|'INCONCLUSIVE'='not_started';
 const fail=(code:FailureCode)=>{if(!errors.includes(code))errors.push(code);status='INCONCLUSIVE';};
 const mark=(key:string)=>{const value=clock();known(Number.isFinite(value)&&value>=0);marks[key]=value;};
 function stopOnce(why:NonNullable<typeof reason>):Promise<void>{
  if(stopPromise)return stopPromise;reason=why;
  stopPromise=Promise.resolve().then(async()=>{
   if(!startAttempted)return;
   let stopped:unknown;try{mark('stop_request_ms');stopCommands++;stopped=await backend.stop();mark('stop_ack_ms');}catch{fail('stop');return;}
   try{sanitized=sanitizeConsumerCpuProfileV1(own(stopped,'profile'),options.repoRoot,sources);}catch{fail('sanitize');}
  });return stopPromise;
 }
 function snapshot(){return{contract:'r16-consumer-main-thread-cpu-v1' as const,status,diagnostic_only:true,h1_accepted:false,
  scope:'main_thread_isolate_including_observer_not_exclusive_async_worker',cpu:'SAMPLED_NOT_EXACT',worker,
  generated_positions:true,source_map_verified:false,stop_reason:reason,stop_latch_created:!!stopPromise,stop_commands:stopCommands,errors:[...errors],cleanup:{...cleanup},
  clock:{...marks},limits:CONSUMER_CPU_LIMITS_V1,overhead:'UNKNOWN_INCLUDED_UNSUBTRACTED',
  hard_duration_bound:false,internal_profiler_memory_bound:'UNKNOWN',io_wait:'UNKNOWN',db_server_cpu:'UNKNOWN',
  source_manifest:sources.map(s=>({...s})),capture:sanitized};}
 return{snapshot,
  async run<T>(body:()=>Promise<T>):Promise<T>{
   known(!invoked);invoked=true;status='running';let primary:unknown,bodyFailed=false,result:T|undefined;
   try{connectAttempted=true;backend.connect();connected=true;}catch{fail('connect');}
   if(connected){try{enableAttempted=true;await backend.enable();enabled=true;}catch{fail('enable');}}
   if(enabled){try{await backend.setSamplingInterval(CONSUMER_CPU_LIMITS_V1.sampling_interval_us);}catch{fail('sampling_interval');}
    if(!errors.length){try{mark('start_request_ms');startAttempted=true;await backend.start();started=true;mark('start_ack_ms');}catch{fail('start');}}}
   if(started){try{const arm=options.watchdog??((stop:()=>void)=>{const timer=setTimeout(stop,CONSUMER_CPU_LIMITS_V1.observed_ms);return()=>clearTimeout(timer);});
     clearWatchdog=arm(()=>{void stopOnce('watchdog');});}catch{fail('watchdog_arm');}}
   try{worker='running';result=await body();worker='drained';}catch(error){primary=error;bodyFailed=true;worker='failed';}
   finally{
    try{clearWatchdog?.();cleanup.watchdog_cleared=true;}catch{fail('watchdog_clear');}
    await stopOnce(bodyFailed?'worker_failed':'job_drained');
    if(enableAttempted){cleanup.disable_attempted=true;try{await backend.disable();cleanup.disable_confirmed=true;}catch{fail('disable');}}
    if(connectAttempted){cleanup.disconnect_attempted=true;try{backend.disconnect();cleanup.disconnect_confirmed=true;}catch{fail('disconnect');}}
   }
   if(!errors.length&&sanitized&&worker==='drained')status='observed';else status='INCONCLUSIVE';
   if(bodyFailed)throw primary;
   if(status!=='observed')throw new Error('consumer_cpu_observation_incomplete');
   return result as T;
  },
  async publish(directory:string):Promise<void>{
   // The caller must preserve a worker primary if this separate publication fails.
   // The original pipeline timeline is never trimmed or overwritten to fit CPU.
   try{const root=await realpath(options.repoRoot),dir=resolve(root,directory),sub=relative(resolve(root,'.data'),dir);
   known(sub&&!sub.startsWith('..')&&!isAbsolute(sub)&&await realpath(dir)===dir);
   const names=await readdir(dir);known(names.length===1&&names[0]==='listening-pipeline-profile.json');
   const existing=await lstat(resolve(dir,'listening-pipeline-profile.json'));known(existing.isFile()&&!existing.isSymbolicLink());
   const bytes=Buffer.from(JSON.stringify(snapshot())+'\n');known(bytes.length<=CONSUMER_CPU_LIMITS_V1.receipt_bytes&&
    existing.size+bytes.length<=CONSUMER_CPU_LIMITS_V1.combined_artifact_bytes);
   const file=await open(resolve(dir,'listening-main-thread-cpu.json'),'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
   }catch{throw new Error('consumer_cpu_publication_failed');}
  },
 };
}
