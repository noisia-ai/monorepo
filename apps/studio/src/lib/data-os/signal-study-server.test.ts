import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as query from '@noisia/query-engine';
import * as api from './signal-study-api';
const workspace='10000000-0000-4000-8000-000000000001',actor='10000000-0000-4000-8000-000000000002',cfg='10000000-0000-4000-8000-000000000003',snapshot='10000000-0000-4000-8000-000000000004',corpus='10000000-0000-4000-8000-000000000005',study='10000000-0000-4000-8000-000000000006';
const listening=query.signalListeningBaseTemplateV1({category:'beer',lexicon_terms:['beer']}),digest=query.signalWorkspaceEmbeddingDigestV1(listening);
const body={source:{binding_kind:'serving',snapshot_id:snapshot,configuration_id:cfg,configuration_digest:digest},subject:{kind:'category',name:'Beer',category:'beer',own_brand:'Brand',competitors:[],alternatives:[]},business_question:'Why?',cut:{start_at:'2026-10-01T00:00:00-03:00',end_at:'2026-11-01T00:00:00-03:00',timezone:'America/Sao_Paulo'}};
function harness(denied=false){
 const calls:Array<{name:string;args:Record<string,unknown>}>=[],native:Record<string,unknown>={};let currentSource=snapshot,humanSource=false,canProcess=true;
 const wrap=(name:string,value:(args:Record<string,unknown>)=>unknown)=>{native[name]=async(args:Record<string,unknown>)=>{calls.push({name,args});return value(args);};};
 wrap('getSignalListeningServingSnapshotV1',()=>({id:snapshot,configuration_id:cfg,configuration_is_latest:true}));
 wrap('getSignalListeningEffectiveServingSnapshotV1',()=>({id:currentSource,configuration_id:cfg,configuration_is_latest:true,binding_kind:humanSource?'human':'native'}));
 wrap('getSignalListeningConfigurationV1',()=>({id:cfg,revision:3,configuration_digest:digest,configuration:listening}));
 wrap('getSignalListeningStatusV1',()=>({capabilities:{can_request_processing:canProcess}}));
 wrap('getSignalListeningHumanEditContextV1',()=>({can_edit:true}));
 wrap('ensureSignalStudyCorpusV1',()=>({id:corpus,workspace_id:workspace}));
 wrap('saveSignalStudyConfigurationV1',args=>({id:cfg,study_id:study,revision:1,envelope:args.configuration,configuration_digest:'sha256:'+'b'.repeat(64),listening_snapshot_id:snapshot,listening_source_id:args.listening_snapshot_id,listening_source_kind:args.listening_source_kind}));
 const exports:Record<string,unknown>={},source=readFileSync(new URL('./signal-study-server.ts',import.meta.url),'utf8');
 new Function('require','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)((name:string)=>{
  if(name==='@noisia/db')return native;if(name==='@noisia/query-engine')return query;if(name==='./signal-study-api')return api;if(name==='@/lib/db')return{pool:'private-db-handle'};
  if(name.includes('/topics/_lib'))return{loadSignalWorkspaceContextForTopics:async()=>denied?{response:Response.json({error:'forbidden'},{status:403})}:{workspace:{id:workspace},session:{appUser:{id:actor}}}};throw Error(name);
 },exports);
 return{calls,setCanExecute:(value:boolean)=>{canProcess=value;},useHumanSource:()=>{humanSource=true;currentSource=study;},changeCurrentSource:()=>{currentSource=study;},load:exports.loadSignalWorkspaceContextForStudyV1 as(id:string)=>Promise<{response?:Response;api?:ReturnType<typeof api.createSignalStudyApiV1>}>};
}
async function withFlags(fn:()=>Promise<void>){const old=[process.env.NOISIA_SIGNAL_STUDY_ENABLED,process.env.NOISIA_SIGNAL_LISTENING_ENABLED,process.env.NOISIA_STUDY_SCOPED_PROVIDER_READY];process.env.NOISIA_SIGNAL_STUDY_ENABLED='true';process.env.NOISIA_SIGNAL_LISTENING_ENABLED='true';delete process.env.NOISIA_STUDY_SCOPED_PROVIDER_READY;try{await fn();}finally{for(const [i,key]of ['NOISIA_SIGNAL_STUDY_ENABLED','NOISIA_SIGNAL_LISTENING_ENABLED','NOISIA_STUDY_SCOPED_PROVIDER_READY'].entries()){if(old[i]===undefined)delete process.env[key];else process.env[key]=old[i];}}}
test('server creation binds native workspace actor, immutable DATA template, exact source and zero processing',()=>withFlags(async()=>{
 const f=harness(),loaded=await f.load(workspace);assert.ok(loaded.api);
 const r=await loaded.api.create(workspace,new Request('https://studio.invalid',{method:'POST',headers:{'Idempotency-Key':'native-save-key'},body:JSON.stringify(body)}));assert.equal(r.status,201);
 const save=f.calls.find(c=>c.name==='saveSignalStudyConfigurationV1')!.args;assert.equal(save.workspace_id,workspace);assert.equal(save.actor_user_id,actor);assert.equal(save.database,'private-db-handle');assert.equal(save.listening_snapshot_id,snapshot);assert.equal(save.expected_revision,0);assert.equal(save.idempotency_key,'native-save-key');
 const envelope=query.validateSignalStudyExecutionConfigurationV1(save.configuration);assert.equal(envelope.study.corpus_id,corpus);assert.equal(envelope.source_listening.configuration_id,cfg);assert.equal(envelope.source_listening.configuration_digest,digest);assert.deepEqual(envelope.source_listening.configuration,listening);assert.equal(envelope.template_snapshot.template_digest,query.SIGNAL_STUDY_TB_TEMPLATE_DIGEST_V1);assert.equal(envelope.question_configuration.human_locked,true);
 assert.equal(f.calls.some(c=>/request|promote|provider|Storage/u.test(c.name)),false);
}));
test('source digest mismatch and a controller reused with a different workspace cannot write',()=>withFlags(async()=>{
 const f=harness(),loaded=await f.load(workspace);const r=await loaded.api!.create(workspace,new Request('https://studio.invalid',{method:'POST',headers:{'Idempotency-Key':'native-save-key'},body:JSON.stringify({...body,source:{...body.source,configuration_digest:'sha256:'+'c'.repeat(64)}})}));assert.equal(r.status,409);assert.equal(f.calls.some(c=>c.name==='ensureSignalStudyCorpusV1'||c.name==='saveSignalStudyConfigurationV1'),false);
 const n=f.calls.length;assert.equal((await loaded.api!.list(study,new Request('https://studio.invalid?context=true'))).status,403);assert.equal(f.calls.length,n);
}));
test('authentication precedes flags and native reads; default readiness is false without reading a provider secret',()=>withFlags(async()=>{
 const denied=harness(true);assert.equal((await denied.load(workspace)).response?.status,403);assert.equal(denied.calls.length,0);
 process.env.NOISIA_SIGNAL_STUDY_ENABLED='false';const disabled=harness();assert.equal((await disabled.load(workspace)).response?.status,404);assert.equal(disabled.calls.length,0);
 process.env.NOISIA_SIGNAL_STUDY_ENABLED='true';const f=harness(),loaded=await f.load(workspace),r=await loaded.api!.list(workspace,new Request('https://studio.invalid?context=true'));assert.equal((await r.json()).processing_ready,false);assert.ok(f.calls.every(c=>!['ensureSignalStudyCorpusV1','saveSignalStudyConfigurationV1'].includes(c.name)));
}));

test('lost save acknowledgement is replayable with the same exact source even after current source changes',()=>withFlags(async()=>{
 const f=harness(),loaded=await f.load(workspace);const request=()=>new Request('https://studio.invalid',{method:'POST',headers:{'Idempotency-Key':'lost-ack-stable-key'},body:JSON.stringify({...body,source:{...body.source,snapshot_id:study,binding_kind:'human_edit'}})});
 const first=await loaded.api!.create(workspace,request());assert.equal(first.status,201);assert.deepEqual((await first.json()).listening_source,{kind:'human_edit',id:study,base_snapshot_id:snapshot});f.changeCurrentSource();assert.equal((await loaded.api!.create(workspace,request())).status,201);
 const saves=f.calls.filter(c=>c.name==='saveSignalStudyConfigurationV1');assert.equal(saves.length,2);assert.deepEqual(saves[0]!.args,saves[1]!.args);assert.equal(saves[0]!.args.listening_snapshot_id,study);assert.equal(saves[0]!.args.listening_source_kind,'human_edit');
 assert.equal(f.calls.some(c=>c.name==='getSignalListeningServingSnapshotV1'||c.name==='getSignalListeningEffectiveServingSnapshotV1'),false,'the native store owns current-source CAS after idempotency recovery');
}));

test('source context maps the current effective human snapshot into the native Study binding namespace',()=>withFlags(async()=>{
 const f=harness();f.useHumanSource();const loaded=await f.load(workspace),r=await loaded.api!.list(workspace,new Request('https://studio.invalid?context=true'));assert.equal(r.status,200);
 const context=await r.json();assert.equal(context.source.binding_kind,'human_edit');assert.equal(context.source.snapshot_id,study);assert.equal(context.source.configuration_id,cfg);assert.equal(context.source.category,'beer');assert.equal(f.calls.some(c=>c.name==='getSignalListeningServingSnapshotV1'),false);
}));
test('native processing capability is exposed separately from edit permission and operational readiness',()=>withFlags(async()=>{
 const f=harness();f.setCanExecute(false);process.env.NOISIA_STUDY_SCOPED_PROVIDER_READY='true';const loaded=await f.load(workspace);
 const r=await loaded.api!.list(workspace,new Request('https://studio.invalid?context=true')),context=await r.json();assert.equal(context.processing_ready,true);assert.equal(context.can_edit,true);assert.equal(context.can_execute,false);
 const read=f.calls.find(c=>c.name==='getSignalListeningStatusV1');assert.ok(read);assert.deepEqual(read.args,{database:'private-db-handle',workspace_id:workspace,actor_user_id:actor});
 f.setCanExecute(true);assert.equal((await(await loaded.api!.list(workspace,new Request('https://studio.invalid?context=true'))).json()).can_execute,true);
 assert.equal(f.calls.some(c=>/request|save|promote/iu.test(c.name)),false);
}));
