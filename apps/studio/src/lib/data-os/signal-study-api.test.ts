import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createSignalStudyApiV1,type StudyApiDependenciesV1,type StudyCreateRequestV1} from './signal-study-api';
const workspace='10000000-0000-4000-8000-000000000001',study='10000000-0000-4000-8000-000000000002',cfgid='10000000-0000-4000-8000-000000000003',execution='10000000-0000-4000-8000-000000000004',snapshot='10000000-0000-4000-8000-000000000005',sha='sha256:'+'a'.repeat(64);
const create:StudyCreateRequestV1={source:{binding_kind:'serving',snapshot_id:snapshot,configuration_id:cfgid,configuration_digest:sha},subject:{kind:'category',name:'Beer',category:'Beer',own_brand:'Brand',competitors:[],alternatives:[]},business_question:'What motivates consumption?',cut:{start_at:'2026-10-01T00:00:00-03:00',end_at:'2026-11-01T00:00:00-03:00',timezone:'America/Sao_Paulo'}};
function harness(){
 const calls:Array<Record<string,unknown>>=[];let denied=false,ready=true,nativeError:unknown,statusStudy=study,statusConfig=cfgid;
 const configuration={id:cfgid,workspace_id:workspace,study_id:study,revision:1,envelope:{study:{...create,workspace_id:workspace,corpus_id:snapshot,methodology:{key:'triggers_barriers',version:'r16-v1',template_digest:sha},template_snapshot:{private:'template'}}},configuration_digest:sha,listening_snapshot_id:snapshot} as unknown as NonNullable<Awaited<ReturnType<StudyApiDependenciesV1['configuration']>>>;
 const status=()=>({id:execution,study_id:statusStudy,configuration_id:statusConfig,status:'completed'}) as NonNullable<Awaited<ReturnType<StudyApiDependenciesV1['status']>>>;
 const record=(operation:string,scope:unknown,args:unknown)=>{calls.push({operation,scope,args});if(nativeError)throw nativeError;};
 const deps:StudyApiDependenciesV1={load:async()=>denied?{response:Response.json({error:'forbidden'},{status:403})}:{workspace_id:workspace,actor_user_id:'session-user'},ready:()=>ready,canEdit:async()=>true,
  source:async()=>create.source as Awaited<ReturnType<StudyApiDependenciesV1['source']>>,list:async(s,a)=>{record('list',s,a);return{studies:[],next_after_study_id:null};},
  create:async(s,a,k)=>{record('create',s,{...a,idempotency_key:k});return{study_id:study}as Awaited<ReturnType<StudyApiDependenciesV1['create']>>;},
  configuration:async()=>configuration,executionConfiguration:async()=>({...configuration,id:statusConfig,revision:2}),latestExecution:async()=>status(),status:async()=>status(),
  overview:async()=>({execution_id:execution,listening_source_binding:{kind:'human_edit',id:snapshot,configuration_id:cfgid,generation_id:workspace,source_digest:sha,base_snapshot_id:study},configuration:{secret:'full-source-questions'},overview:{status:'directional'},section_counts:{motives:2,evidence:3}}as Awaited<ReturnType<StudyApiDependenciesV1['overview']>>),
  page:async(s,a)=>{record('page',s,a);return{rows:[],next_offset:null};},
  execute:async(s,a)=>{record('execute',s,a);return{id:execution,execution_token:'never-client',source_header:{private:'source'}};},
  promote:async(s,a)=>{record('promote',s,a);return{configuration_id:cfgid};},currentListeningRevision:async()=>7};
 const api=createSignalStudyApiV1(deps);
 function route(detail:boolean){const out:Record<string,unknown>={},source=readFileSync(new URL(`../../app/api/data-os/signal/[workspaceId]/studies/${detail?'[studyId]/':''}route.ts`,import.meta.url),'utf8');
  new Function('require','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(()=>({loadSignalWorkspaceContextForStudyV1:async()=>({api})}),out);return out;
 }
 const collection=route(false),detail=route(true);
 const invoke=(which:'collection'|'detail',method:'GET'|'POST',body?:unknown,query='',key='study-stable-key')=>((which==='collection'?collection:detail)[method]as(request:Request,ctx:unknown)=>Promise<Response>)(new Request('https://studio.invalid/studies'+query,{method,headers:{'Content-Type':'application/json','Idempotency-Key':key},...(body===undefined?{}:{body:JSON.stringify(body)})}),{params:Promise.resolve({workspaceId:workspace,studyId:study})});
 return{calls,invoke,setDenied:()=>{denied=true;},setReady:()=>{ready=false;},setError:(e:unknown)=>{nativeError=e;},setOtherStudy:()=>{statusStudy=cfgid;},setOldExecution:()=>{statusConfig=snapshot;}};
}
test('mounted Study routes keep session authority, native source CAS and stable idempotency',async()=>{
 const f=harness();assert.equal((await f.invoke('collection','POST',create)).status,201);
 assert.deepEqual(f.calls[0]!,{operation:'create',scope:{workspace_id:workspace,actor_user_id:'session-user'},args:{...create,idempotency_key:'study-stable-key'}});
 const r=await f.invoke('detail','POST',{operation:'execute',configuration_id:cfgid,cap_micro_usd:2000000});assert.equal(r.status,202);assert.deepEqual(await r.json(),{execution_id:execution});
 assert.equal(r.headers.get('Cache-Control'),'private, no-store');
 assert.deepEqual(f.calls[1]!.args,{configuration_id:cfgid,cap_micro_usd:2000000,idempotency_key:'study-stable-key'});
});
test('source and report GETs cannot enqueue, promote, hydrate raw outputs or leak full configuration',async()=>{
 const f=harness();for(const query of ['', '?context=true'])assert.equal((await f.invoke('collection','GET',undefined,query)).status,200);
 const r=await f.invoke('detail','GET'),body=await r.json();assert.equal(r.status,200);assert.equal('configuration'in body.overview,false);assert.deepEqual(body.overview.listening_source_binding,{kind:'human_edit',id:snapshot,configuration_id:cfgid,generation_id:workspace,source_digest:sha,base_snapshot_id:study});
 assert.equal('template_snapshot'in body.configuration.study,false);assert.equal(JSON.stringify(body).includes('full-source-questions'),false);
 assert.equal(f.calls.some(c=>['execute','promote','create'].includes(String(c.operation))),false);
});
test('report pagination is bounded and native output is bound to this study before reads or promotions',async()=>{
 const f=harness();assert.equal((await f.invoke('detail','GET',undefined,`?execution_id=${execution}&section=evidence&offset=30&limit=30`)).status,200);
 assert.deepEqual(f.calls[0]!.args,{execution_id:execution,section:'evidence',offset:30,limit:30});
 for(const query of [`?execution_id=${execution}&section=evidence&limit=101`,`?execution_id=${execution}&section=evidence&offset=-1`,`?execution_id=${execution}&section=raw`])assert.equal((await f.invoke('detail','GET',undefined,query)).status,422);
 f.setOtherStudy();assert.equal((await f.invoke('detail','GET',undefined,`?execution_id=${execution}&section=evidence`)).status,404);
 assert.equal((await f.invoke('detail','POST',{operation:'promote',execution_id:execution,motive_keys:['motive_one'],expected_listening_revision:7})).status,404);assert.equal(f.calls.length,1);
});
test('historical execution metadata comes from its exact configuration, not the current study revision',async()=>{
 const f=harness();f.setOldExecution();const body=await(await f.invoke('detail','GET')).json();assert.equal(body.configuration.configuration_id,snapshot);assert.equal(body.configuration_is_latest,false);
});
test('forged authority, missing keys and malformed cap/cut never reach native writes',async()=>{
 const f=harness();for(const extra of [{actor_user_id:study},{workspace_id:study},{provider:'anthropic'},{model:'other'},{analysis_enabled:true},{methodology:{key:'other'}}])assert.equal((await f.invoke('collection','POST',{...create,...extra})).status,422);
 assert.equal((await f.invoke('collection','POST',create,'','bad key')).status,422);
 assert.equal((await f.invoke('collection','POST',{...create,cut:{...create.cut,timezone:'invalid'}})).status,422);
 assert.equal((await f.invoke('collection','POST',{...create,cut:{...create.cut,end_at:create.cut.start_at}})).status,422);
 for(const cap of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1])assert.equal((await f.invoke('detail','POST',{operation:'execute',configuration_id:cfgid,cap_micro_usd:cap})).status,422);
 assert.equal((await f.invoke('detail','POST',{operation:'execute',configuration_id:snapshot,cap_micro_usd:1})).status,409);assert.equal(f.calls.length,0);
});
test('readiness blocks processing only; promotion is explicit, CAS-bound and does not use paid admission',async()=>{
 const f=harness();f.setReady();assert.equal((await f.invoke('detail','POST',{operation:'execute',configuration_id:cfgid,cap_micro_usd:1})).status,503);
 const body={operation:'promote',execution_id:execution,motive_keys:['motive_one'],expected_listening_revision:7};assert.equal((await f.invoke('detail','POST',body)).status,200);
 assert.deepEqual(f.calls[0]!.args,{execution_id:execution,motive_keys:['motive_one'],expected_listening_revision:7,idempotency_key:'study-stable-key'});
 assert.equal((await f.invoke('detail','POST',{...body,motive_keys:['motive_one','motive_one']})).status,422);
 assert.equal(f.calls.some(c=>c.operation==='execute'),false);
});
test('revoked session and native permission/CAS errors remain authoritative',async()=>{
 const f=harness();f.setDenied();for(const which of ['collection','detail']as const){assert.equal((await f.invoke(which,'GET')).status,403);assert.equal((await f.invoke(which,'POST',create)).status,403);}assert.equal(f.calls.length,0);
 for(const status of [403,409,422]){const h=harness();h.setError(Object.assign(Error('native'),{code:'study_native_guard',status}));const r=await h.invoke('collection','POST',create);assert.equal(r.status,status);assert.deepEqual(await r.json(),{error:'study_native_guard'});}
});
