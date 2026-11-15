import assert from'node:assert/strict';
import{createHash,randomUUID}from'node:crypto';
import{mkdtemp,mkdir,open,readFile,rm}from'node:fs/promises';
import{createServer}from'node:http';
import{tmpdir}from'node:os';
import{fileURLToPath}from'node:url';
import{join,resolve}from'node:path';
import{signalWorkspaceEmbeddingDigestV1 as digest}from'@noisia/query-engine';
import{startR16HttpFilesystemStorageV1}from'../../../scripts/r16/http-filesystem-storage';
import{createWorkspaceEngineStorageV1,buildWorkspaceEngineStorageKeyV1}from'../../../services/workers/src/workers/signal-workspace-engine-storage';
import{createLabelingRawPagesStorageV1}from'../../../services/workers/src/workers/signal-labeling-receipt-storage';
import{createCalibratedJevRuntimeProviderV2}from'../../../services/workers/src/providers/jev-streaming-runtime';
import{createSignalStudyJevDriverV1}from'../../../services/workers/src/workers/signal-study-jev';
import{createSignalStudyNumericDriverV1,createSignalStudyNumericStorageBindingsV1}from'../../../services/workers/src/workers/signal-study-numeric';
import{signalStudyRuntimeJobV1,type StudyRuntimeDriversV1,type StudyRuntimeStepPlanV1}from'../../../services/workers/src/workers/signal-study-runtime';
import{createSignalStudyRuntimeStoreV1}from'../signal-study-runtime-store';
import{createSignalStudyJevNativeAdapterV1}from'../signal-study-jev-store';
import{createSignalStudyNumericNativeAdapterV1}from'../signal-study-numeric-source';
import type{SignalStudyRawStorageV1}from'../signal-study-steps';
import type{StudyDatabaseV1}from'../signal-study-core';
const sha=(body:string|Buffer)=>'sha256:'+createHash('sha256').update(body).digest('hex');
async function redisUrl(){let value=process.env.NOISIA_R16_STUDY_REDIS_URL??process.env.R16BENCH_REDIS_URL;
 if(!value&&process.env.NOISIA_R16_STUDY_REDIS_ENV_PATH){const text=await readFile(process.env.NOISIA_R16_STUDY_REDIS_ENV_PATH,'utf8');value=/^R16BENCH_REDIS_URL=(.*)$/mu.exec(text)?.[1]?.replace(/^(['"])(.*)\1$/u,'$2');}
 assert.ok(value,'the native Study gate requires its explicit owned local Redis URL');const u=new URL(value);assert.ok(u.protocol==='redis:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname),'synthetic Redis must remain loopback');return value;
}
export async function withStudyNativeRuntimeV1<T>(database:StudyDatabaseV1,fn:(f:Awaited<ReturnType<typeof setup>>)=>Promise<T>){
 const f=await setup(database);try{return await fn(f);}finally{await f.cleanup();}
}
async function setup(database:StudyDatabaseV1){
 const directory=await mkdtemp(join(tmpdir(),'r16-study-native-')),objectRoot=join(directory,'objects');await mkdir(objectRoot,{mode:0o700});
 const custody=await startR16HttpFilesystemStorageV1(objectRoot),httpStorage=createWorkspaceEngineStorageV1({url:custody.base_url,service_role_key:'synthetic-private-key',bucket:'private-study'}),raw_pages=createLabelingRawPagesStorageV1(httpStorage);
 const raw_storage:SignalStudyRawStorageV1={reference:d=>({storage_key:buildWorkspaceEngineStorageKeyV1(d.workspace_id,d.execution_id,d.name,d.raw_sha256)}),
  async store(d){const temp=await mkdtemp(join(directory,'receipt-'));try{const file=join(temp,d.name),h=await open(file,'wx',0o600);try{await h.writeFile(d.raw_text);await h.sync();}finally{await h.close();}const stored=await httpStorage.put({workspace_id:d.workspace_id,execution_id:d.execution_id,file,sha256:d.raw_sha256,size_bytes:d.size_bytes,media_type:'application/json'});return{...stored,verified:true};}finally{await rm(temp,{recursive:true,force:true});}},
  async load(d){const parts=d.storage_key.split('/'),temp=await mkdtemp(join(directory,'read-'));try{const file=join(temp,'receipt.json');await httpStorage.get({workspace_id:parts[1]!,execution_id:parts[2]!,stored:{...d,media_type:'application/json'},destination:file});return await readFile(file,'utf8');}finally{await rm(temp,{recursive:true,force:true});}}};
 let jevCalls=0,sonnetCalls=0,fitCalls=0,dominant=false,analysisEnabled=true,sonnetAvailable=true;const sentStepKeys:string[]=[];
 let jevMode:'normal'|'incomplete'|'http429'='normal',sonnetMode:'normal'|'incomplete'|'http529'|'invalid_usage'|'invalid_utf8'='normal';
 let onSonnet:((plan:StudyRuntimeStepPlanV1)=>Promise<void>)|undefined,onJev:((request:unknown)=>Promise<void>)|undefined;
 const motiveGroups=new Map<string,number>();
 const server=createServer(async(req,res)=>{try{let bytes=Buffer.alloc(0);for await(const chunk of req){bytes=Buffer.concat([bytes,Buffer.from(chunk)]);assert.ok(bytes.length<=2*1024*1024);}const body=JSON.parse(bytes.toString('utf8'));
  let response:unknown;if(req.url==='/jev'){
   jevCalls++;await onJev?.(body);if(jevMode==='http429'){res.statusCode=429;res.end('{"error":"synthetic quota"}');return;}if(jevMode==='incomplete'){res.end('{"model":"jev-1.13.0","usage":');return;}
   const idx=Number(/root ([0-9]+)/u.exec(body.state)?.[1]??0),answers=Object.fromEntries(Object.entries(body.questions as Record<string,{type:string;criteria:Record<string,string>}>).map(([key,q])=>{
    if(q.type==='noul')return[key,{type:'noul',noul:dominant||motiveGroups.get(key)===idx%3?.9:.1}];
    const selected=key.includes('direction')?(idx%2?'barrier':'trigger'):key.includes('target')?'category':'literal';return[key,{type:'choice',choice:selected,confidence:1,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===selected?1:0]))}];}));response={model:'jev-1.13.0',answers,usage:{input_tokens:120,output_tokens:20}};
  }else if(req.url==='/sonnet'){
   sonnetCalls++;if(sonnetMode==='invalid_utf8'){res.end(Buffer.from([255]));return;}if(sonnetMode==='http529'){res.statusCode=529;res.end('{"error":"synthetic overloaded"}');return;}if(sonnetMode==='incomplete'){res.end('{"model":"claude-sonnet-4-6","usage":');return;}
   const payload=JSON.parse(body.messages[0].content).untrusted_data,input_digest=digest(payload);let value:unknown;
   if(payload.groups){const grouped=new Map<number,Array<{group_key:string;rows:Array<{root_id:string;text:string}>;insufficient_sample:boolean}>>();const insufficient:string[]=[];
    for(const g of payload.groups){if(g.insufficient_sample){insufficient.push(g.group_key);continue;}const n=Number(/root ([0-9]+)/u.exec(g.rows[0].text)?.[1]??0)%3;grouped.set(n,[...(grouped.get(n)??[]),g]);}
    value={contract_version:'signal-study-motive-output-v1',input_digest,insufficient_group_keys:insufficient,motives:[...grouped].sort(([a],[b])=>a-b).map(([n,groups])=>{const key='motive_g'+n;motiveGroups.set(key,n);return{key,name:'Synthetic force '+n,definition:'Synthetic force for cloud '+n,group_keys:groups.map(g=>g.group_key),evidence_root_ids:groups.map(g=>g.rows[0]!.root_id)};})};
   }else if(payload.affected_keys){dominant=false;value={contract_version:'signal-study-contrast-output-v1',input_digest,definitions:payload.motives.map((m:{key:string;sample:Array<{root_id:string}>})=>({key:m.key,name:'Contrasted '+m.key,definition:'Narrow synthetic force '+m.key,contrast_reason:'Separate the configured synthetic clouds.',evidence_root_ids:[m.sample[0]!.root_id]}))};
   }else{value={contract_version:'signal-study-layer-output-v1',input_digest,motives:payload.motives.map((m:{key:string;sample:Array<{root_id:string;text:string}>})=>{const n=motiveGroups.get(m.key)!;const key='force_g'+n;motiveGroups.set(key,n);const layer=['psychological','personal','social'][n]!;return{motive_key:m.key,partitions:[{key,name:'Native synthetic '+key,definition:'Synthetic force '+n,sample_root_ids:m.sample.map(r=>r.root_id),layer,
     diagnostics:payload.diagnostics.map((d:{key:string;layer:string})=>({key:d.key,result:d.layer===layer?'yes':'no',force_disappears_without:d.layer===layer,reason:'Synthetic counterfactual from the frozen diagnostic.'})),evidence:{root_id:m.sample[0]!.root_id,quote:m.sample[0]!.text,private_person_names:[]},normative_evidence:null,permission_override:null}]};})};}
   response={model:'claude-sonnet-4-6',stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(value)}],usage:sonnetMode==='invalid_usage'?{}:{input_tokens:100,output_tokens:20}};
  }else{res.statusCode=404;res.end();return;}res.setHeader('content-type','application/json');res.setHeader('request-id','synthetic-'+(jevCalls+sonnetCalls));res.end(JSON.stringify(response));
 }catch{res.statusCode=500;res.end('{"error":"synthetic contract failure"}');}});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const address=server.address();assert.ok(address&&typeof address==='object');const endpoint='http://127.0.0.1:'+address.port;
 const env={TYPESAFE_API_KEY:'synthetic-http-only',NOISIA_JEV_STREAMING_V2_ENABLED:'true',NOISIA_JEV_PROVIDER_ENABLED:'true',NOISIA_TYPESAFE_ACCOUNT_ID:'synthetic-study-'+randomUUID(),
  NOISIA_TYPESAFE_ACCOUNT_REDIS_URL:await redisUrl(),NOISIA_TYPESAFE_ACCOUNT_RPS:'100',NOISIA_TYPESAFE_ACCOUNT_INPUT_TPS:'100000'};
 const adapter=createSignalStudyJevNativeAdapterV1({database,page_size:4096,analysis_enabled:()=>analysisEnabled,sonnet_provider_available:()=>sonnetAvailable}),execution={max_in_flight:32,window_size:4096,flush_size:128,max_flushes:2,max_buffered_bytes:64*1024*1024,flush_interval_ms:250};
 const runJevBatch=createSignalStudyJevDriverV1({adapter,storage:httpStorage,env,execution,provider_factory:args=>createCalibratedJevRuntimeProviderV2({...args,fetch:(_url,init)=>fetch(endpoint+'/jev',init)})});
 const numeric=createSignalStudyNumericNativeAdapterV1({database}),fit=createSignalStudyNumericDriverV1({adapter:numeric,python:process.env.NOISIA_WORKSPACE_ENGINE_PYTHON,module_root:fileURLToPath(new URL('../../../tools/signal-semantic-lab/src',import.meta.url)),storage_root:directory});
 const store=createSignalStudyRuntimeStoreV1({database,raw_storage,raw_pages,...createSignalStudyNumericStorageBindingsV1(httpStorage),sonnet_provider_available:()=>sonnetAvailable,jev_provider_available:()=>true,analysis_enabled:()=>analysisEnabled});
 const drivers:StudyRuntimeDriversV1={runJevBatch,fit:async args=>{fitCalls++;return fit(args);},preflight:async()=>{await httpStorage.assertReady!();},send:async plan=>{
  assert.equal(JSON.parse(plan.request_body).model,'claude-sonnet-4-6');sentStepKeys.push(plan.key);const response=await fetch(endpoint+'/sonnet',{method:'POST',body:plan.request_body}),bytes=Buffer.from(await response.arrayBuffer());await onSonnet?.(plan);
  return{body_base64:bytes.toString('base64'),body_bytes:bytes.length,sha256:sha(bytes),http_status:response.status,provider_request_id:response.headers.get('request-id'),complete:sonnetMode!=='incomplete'};}};
 async function run(execution_id:string){let result:Awaited<ReturnType<typeof signalStudyRuntimeJobV1>>|undefined;for(let i=0;i<100;i++){result=await signalStudyRuntimeJobV1(execution_id,{store,drivers,should_stop:()=>!analysisEnabled||!sonnetAvailable});if(result.status!=='waiting_batch')return result;}throw Error('synthetic_study_runtime_did_not_finish');}
 return{store,drivers,adapter,numeric,raw_storage,raw_pages,httpStorage,run,metrics:()=>({jevCalls,sonnetCalls,fitCalls,storage:custody.metrics()}),sentStepKeys:()=>[...sentStepKeys],
  setAnalysisEnabled:(value:boolean)=>{analysisEnabled=value;},setSonnetAvailable:(value:boolean)=>{sonnetAvailable=value;},setJevMode:(v:typeof jevMode)=>{jevMode=v;},setSonnetMode:(v:typeof sonnetMode)=>{sonnetMode=v;},setDominant:(v:boolean)=>{dominant=v;},onSonnet:(fn:typeof onSonnet)=>{onSonnet=fn;},onJev:(fn:typeof onJev)=>{onJev=fn;},
  async cleanup(){await new Promise<void>((done,reject)=>server.close(e=>e?reject(e):done()));await custody.close();await rm(directory,{recursive:true,force:true});}};
}
export type StudyNativeRuntimeFixtureV1=Awaited<ReturnType<typeof setup>>;
