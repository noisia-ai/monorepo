// Pure protocol tests only. Native semantics remain in the existing owned Native fixture.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {signalListeningQuestionDigestV1,type SignalListeningInputV1} from '@noisia/query-engine';
import type {SignalListeningInputSurveyV1} from '../signal-listening-runs';
import type {LabelingRunV1} from '../signal-labeling-runs';
import {captureR16ExpectedGitProvenanceV1,captureR16SourceProvenanceV1} from '../../../scripts/r16/source-provenance';
import {r16ListeningWorkloadV2} from '../../../scripts/r16/listening-workload';
import {extractListeningInputPlanQueryV1,createListeningInputPlanObserverV1,inputPlanTemplateHashV1,INPUT_PLAN_LIMITS_V1,
 INPUT_PLAN_SURVEY_Q8_RAW_SHA_V1,INPUT_PLAN_SURVEY_Q8_TARGET_SHA_V1,type InputPlanDatabaseV1} from './signal-listening-input-plan.synthetic.fixture';
import {observeNativeLateSurveyV1,NativeLateSurveyObservationErrorV1,NATIVE_LATE_SURVEY_LIMITS_V1} from './signal-listening-native-late-survey.test-support';
import {projectionShaV1} from './signal-listening-projection-linear-joins.oracle';
const pure=process.env.NOISIA_R16_LISTENING_INPUT_PLAN_PURE==='true';
const hash=(s:string)=>'sha256:'+projectionShaV1(s);
const target=async()=>extractListeningInputPlanQueryV1(await readFile(new URL('../signal-listening-runs.ts',import.meta.url),'utf8'),'survey-Q8');
const uuid=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const roots=Array.from({length:4096},(_,i)=>uuid(i+1));
const configuration=r16ListeningWorkloadV2('defined_consumer_second_pass').configuration;
const consumerKeys=configuration.questions.filter(q=>q.scope==='consumer_category').map(q=>q.key).sort();
const run={id:uuid(6001),workspace_id:uuid(6002),entity_context_digest:'sha256:'+'1'.repeat(64),identity:{params:{configuration}}} as unknown as LabelingRunV1;
const params=[run.workspace_id,uuid(6003),uuid(6004),run.entity_context_digest,run.id,4096,2048,roots,String(512*1024*1024)];
const hintRows=roots.slice(0,720).map(root_id=>({root_id,input_digest:'sha256:'+'2'.repeat(64),working_bytes:'1024',state_json_bytes:Buffer.byteLength(JSON.stringify('Café 😀 漢字')),
 question_keys:consumerKeys,question_digests:Object.fromEntries(configuration.questions.filter(q=>q.scope==='consumer_category').map(q=>[q.key,signalListeningQuestionDigestV1(configuration,q)])),
 scope_basis:Object.fromEntries(consumerKeys.map(key=>[key,'sha256:'+'3'.repeat(64)]))}));
const inputs:SignalListeningInputV1[]=hintRows.map(h=>({root_id:h.root_id,input_digest:h.input_digest,text:'Café 😀 漢字',title:null,platform:null,content_type:null,author:null,
 published_at:'2026-01-01T00:00:00.123Z',language:null,map_id:uuid(6004),configuration_digest:'sha256:'+'4'.repeat(64),question_keys:h.question_keys,question_digests:h.question_digests,scope_basis:h.scope_basis}));
let binding:Promise<{expected_git:ReturnType<typeof captureR16ExpectedGitProvenanceV1>;runtime_before:Awaited<ReturnType<typeof captureR16SourceProvenanceV1>>}>|undefined;
const sources=()=>binding??=captureR16SourceProvenanceV1(process.cwd()).then(runtime_before=>({runtime_before,expected_git:captureR16ExpectedGitProvenanceV1(process.cwd(),runtime_before.head_sha)}));
function fakeDatabase(sql:string,options:{ordinal?:number;throwSelected?:unknown;missingParent?:boolean;oversized?:boolean;restoreFailure?:boolean}={}){
 const listeners=new Set<(n:unknown)=>void>(),settings=new Map<string,string>();let pendingParent:string|null=null,calls=0,released=false,discarded=false;
 const original={rows:roots.map(root_id=>({root_id})),rowCount:4096};
 const document=(text:string)=>JSON.stringify({'Query Text':text,Plan:{'Node Type':'Function Scan','Actual Rows':4096,'Actual Loops':1}});
 const client={async query(text:string,values?:unknown[]){
  if(pendingParent!==null&&values!==undefined){const parent=pendingParent;pendingParent=null;for(const f of listeners)f({message:'duration: 2.5 ms plan: '+parent});}
  if(text.startsWith('SELECT pg_backend_pid()::int pid'))return{rows:[{pid:1234,role:'fixture',database:'fixture',search_path:'public',superuser:'on',isolation:'repeatable read',readonly:'on',xid:null,snapshot:'fixture-snapshot'}]};
  if(text.startsWith('SELECT name,current_setting(name) value'))return{rows:(values![0] as string[]).map(name=>({name,value:settings.get(name)??'baseline:'+name}))};
  if(text==='SELECT set_config($1,$2,true)'){
   if(calls>0&&values![0]==='auto_explain.log_min_duration'&&values![1]==='-1'&&options.restoreFailure)throw Error('restore failed');
   settings.set(String(values![0]),String(values![1]));return{rows:[]};
  }
  if(text.startsWith('LOAD ')||text==='BEGIN'||text.startsWith('SET TRANSACTION')||text==='COMMIT'||text==='/* fake hydration read */')return{rows:[]};
  if(text==='ROLLBACK'){settings.clear();return{rows:[]};}
  if(text===sql){calls++;if(calls!==(options.ordinal??1))return{rows:[]};
   if(Object.hasOwn(options,'throwSelected'))throw options.throwSelected;
   if(!options.missingParent)pendingParent=document(text);
   for(const f of listeners)f({message:options.oversized?'duration: 1 ms plan: '+' '.repeat(INPUT_PLAN_LIMITS_V1.notice_bytes):'duration: 1 ms plan: '+document('SELECT 1 /* fixture nested */')});
   return original;
  }
  throw Error('unexpected fake query');
 },release(destroy?:boolean){released=true;discarded=Boolean(destroy);},on(_event:string,f:(n:unknown)=>void){listeners.add(f);},removeListener(_event:string,f:(n:unknown)=>void){listeners.delete(f);},listenerCount(){return listeners.size;}};
 const database={query:client.query.bind(client),connect:async()=>client} as InputPlanDatabaseV1;
 return{database,original,get calls(){return calls;},get released(){return released;},get discarded(){return discarded;},get listeners(){return listeners.size;}};
}
function mockStore(db:InputPlanDatabaseV1,sql:string){return{async withInputSurvey<T>(_run:LabelingRunV1,_bounds:unknown,body:(scope:SignalListeningInputSurveyV1)=>Promise<T>){
 const c=await db.connect();try{await c.query('BEGIN');await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');await c.query(sql,params);
  const result=await body({hints:hintRows,retained_bytes:1024,async hydrate(ids,bounds){assert.equal(bounds.max_working_bytes,512*1024*1024-1024);assert.deepEqual(ids,roots.slice(0,720));await c.query('/* fake hydration read */');return{kind:'ready',inputs,retained_bytes:1024};}});
  await c.query('COMMIT');return result;
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}};}
if(pure){
 test('Survey Q8 selector keeps raw and normalized pins distinct and old defaults closed',async()=>{
  const selected=await target();assert.equal(selected.profile,'survey-Q8');assert.equal(hash(selected.sql),INPUT_PLAN_SURVEY_Q8_RAW_SHA_V1);
  assert.equal(inputPlanTemplateHashV1(selected.sql),INPUT_PLAN_SURVEY_Q8_TARGET_SHA_V1);assert.equal(INPUT_PLAN_LIMITS_V1.ordinal,65);
  assert.throws(()=>createListeningInputPlanObserverV1({target_sql:selected.sql}),'default E cannot silently become Survey');
  assert.throws(()=>createListeningInputPlanObserverV1({target_sql:' '+selected.sql,profile:'survey-Q8',ordinal:1}),'raw SQL stays pinned even under identical normalized SHA');
  for(const ordinal of [0,-1,1.5,66,Number.NaN])assert.throws(()=>createListeningInputPlanObserverV1({target_sql:selected.sql,profile:'survey-Q8',ordinal}));
 });
 test('Survey observer forwards once, preserves result reference and deferred parent at ordinal1 and default65',async()=>{
  const {sql}=await target();for(const ordinal of [1,65]){
   const f=fakeDatabase(sql,{ordinal}),observer=createListeningInputPlanObserverV1({target_sql:sql,profile:'survey-Q8',...(ordinal===1?{ordinal}:{} )});
   const c=await observer.wrapDatabase(f.database).connect();await c.query('BEGIN');let result;
   for(let n=0;n<ordinal;n++)result=await c.query(sql,params);
   await c.query('COMMIT');c.release();assert.equal(result,f.original);assert.equal(f.calls,ordinal);assert.equal(f.listeners,0);
   assert.equal(observer.snapshot().status,'observed');assert.equal(observer.snapshot().selected_count,1);assert.equal(observer.snapshot().original_executions,1);
   assert.equal(observer.snapshot().settings_restored,true);assert.deepEqual(observer.lifecycle(),{active_borrowed:0,release_failures:0});
  }
 });
 test('late Survey adapter binds full sources, all9 parameters,720 Unicode DTOs and separate plans without replay',async()=>{
  const {sql}=await target(),f=fakeDatabase(sql);
  const result=await observeNativeLateSurveyV1({database:f.database,run,consumerKeys,phase:'late-consumer',sourceBinding:await sources(),createStore:db=>mockStore(db,sql)});
  assert.deepEqual(result.inputs,inputs);assert.equal(f.calls,1);assert.equal(f.released,true);assert.equal(f.discarded,false);
  assert.deepEqual(result.receipt.sample.parameters,params);assert.equal(result.receipt.status,'observed');assert.equal(result.receipt.rr_closed_and_restored,true);
  assert.deepEqual(result.receipt.source!.shared_native,await sources());assert.equal(result.plans.selected_hints.length,720);
  assert.equal(result.receipt.shape.selected_hints_sha256,hash(JSON.stringify(result.plans.selected_hints)));
  assert.equal(result.receipt.plans_reference!.sha256,hash(JSON.stringify(result.plans)+'\n'));
  assert.ok(Buffer.byteLength(JSON.stringify(result.receipt)+'\n')<=NATIVE_LATE_SURVEY_LIMITS_V1.receipt_bytes);
  assert.ok(Buffer.byteLength(JSON.stringify(result.plans)+'\n')<=NATIVE_LATE_SURVEY_LIMITS_V1.plans_bytes);
 });
 test('late Survey adapter keeps original failures and incomplete capture evidence fail closed',async()=>{
  const {sql}=await target(),sourceBinding=await sources(),primary=Error('original selected query failed');
  for(const options of [{throwSelected:primary},{missingParent:true},{oversized:true},{restoreFailure:true}]){
   const f=fakeDatabase(sql,options);let failure:unknown;
   try{await observeNativeLateSurveyV1({database:f.database,run,consumerKeys,phase:'late-consumer',sourceBinding,createStore:db=>mockStore(db,sql)});}catch(error){failure=error;}
   assert.ok(failure instanceof NativeLateSurveyObservationErrorV1);assert.equal(failure.receipt.status,'INCONCLUSIVE');assert.equal(failure.plans.status,'INCONCLUSIVE');
   assert.equal(f.calls,1);assert.equal(f.listeners,0);assert.equal(f.released,true);
   if('throwSelected'in options)assert.equal(failure.cause,primary);
   if('restoreFailure'in options)assert.equal(f.discarded,true);
  }
 });
}
