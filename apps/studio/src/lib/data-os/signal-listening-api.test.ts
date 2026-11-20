import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import {createSignalListeningApiV1,type ListeningApiDependenciesV1} from './signal-listening-api';
const workspace='10000000-0000-4000-8000-000000000001',configuration='10000000-0000-4000-8000-000000000002';
function harness(denied=false){
  const calls:Array<Record<string,unknown>>=[];
  const deps:ListeningApiDependenciesV1={load:async id=>denied?{response:Response.json({error:'forbidden'},{status:403})}:{workspace_id:id,actor_user_id:'session-actor'},
    status:async scope=>{calls.push(scope);return{configuration:null,map:null,run:null};},
    save:async(scope,args)=>{calls.push({...scope,...args});return{id:configuration};},
    start:async(scope,args)=>{calls.push({...scope,...args});return{id:'run'};},metrics:async(scope,args)=>{calls.push({...scope,...args});return{counts:{asked:0}};},
    lexicon:async(scope,args)=>{calls.push({...scope,...args});return{items:[]};}};
  const api=createSignalListeningApiV1(deps),exports:Record<string,unknown>={};
  const source=readFileSync(new URL('../../app/api/data-os/signal/[workspaceId]/listening/route.ts',import.meta.url),'utf8');
  new Function('require','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(()=>({loadSignalWorkspaceContextForListening:async()=>({api})}),exports);
  const invoke=(method:'GET'|'PUT'|'POST',body?:unknown,key='stable-listening-key')=>(exports[method]as (request:Request,context:{params:Promise<{workspaceId:string}>})=>Promise<Response>)(new Request('https://studio.invalid/listening',{
    method,...(body===undefined?{}:{body:JSON.stringify(body)}),headers:{'Content-Type':'application/json','Idempotency-Key':key}}),{params:Promise.resolve({workspaceId:workspace})});
  return{calls,invoke,api};
}
test('mounted listening routes retain session authority, exact CAS and one initial full-corpus budget',async()=>{
  const f=harness();assert.equal((await f.invoke('GET')).status,200);
  assert.equal((await f.invoke('PUT',{expected_revision:0,category:'tea',lexicon_terms:['tea']})).status,200);
  assert.equal(f.calls[1]!.actor_user_id,'session-actor');assert.equal(f.calls[1]!.expected_revision,0);
  assert.equal(f.calls[1]!.provenance,'human');
  assert.equal((await f.invoke('POST',{configuration_id:configuration,cap_micro_usd:1000000})).status,202);
  assert.deepEqual(f.calls[2],{workspace_id:workspace,actor_user_id:'session-actor',configuration_id:configuration,cap_micro_usd:1000000,idempotency_key:'stable-listening-key'});
  for(const extra of [{actor_user_id:'other'},{map_id:configuration},{admission_id:configuration},{provider_available:true}])
    assert.equal((await f.invoke('POST',{configuration_id:configuration,cap_micro_usd:1000000,...extra})).status,422);
  assert.equal(f.calls.length,3);
});
test('free lexicon evidence accepts only current configuration and bounded filters after session scope',async()=>{
  const f=harness();
  const url='https://studio.invalid/lexicon?configuration_id='+configuration;
  const response=await f.api.lexicon(workspace,new Request(url+'&limit=10'));
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  assert.deepEqual(f.calls,[{workspace_id:workspace,actor_user_id:'session-actor',configuration_id:configuration,limit:10}]);
  for(const suffix of ['&limit=201','&limit=0','&actor_user_id=other','&configuration_id='+configuration])
    assert.equal((await f.api.lexicon(workspace,new Request(url+suffix))).status,422);
  const denied=harness(true);assert.equal((await denied.api.lexicon(workspace,new Request(url))).status,403);
  assert.equal(denied.calls.length,0);assert.equal(f.calls.length,1);
});
test('initial discovery opt-in retains the same session, cap and idempotency with no browser-supplied origin or authority',async()=>{
  const f=harness();
  assert.equal((await f.invoke('POST',{configuration_id:configuration,cap_micro_usd:1000000,auto_discovery:true})).status,202);
  assert.deepEqual(f.calls[0],{workspace_id:workspace,actor_user_id:'session-actor',configuration_id:configuration,cap_micro_usd:1000000,auto_discovery:true,idempotency_key:'stable-listening-key'});
  for(const extra of [{origin:'discovery_child'},{automatic:true},{initial_intent_id:configuration},{auto_discovery:'true'}])
    assert.equal((await f.invoke('POST',{configuration_id:configuration,cap_micro_usd:1000000,auto_discovery:true,...extra})).status,422);
  assert.equal(f.calls.length,1);
});
test('revoked access and malformed filters cannot reach listening stores',async()=>{
  const f=harness(true);assert.equal((await f.invoke('POST',{configuration_id:configuration,cap_micro_usd:1000000})).status,403);assert.equal(f.calls.length,0);
  const allowed=harness();assert.equal((await allowed.invoke('POST',{configuration_id:configuration,cap_micro_usd:1},'short')).status,422);
  assert.equal((await allowed.api.metrics(workspace,new Request('https://studio.invalid/metrics?question_key=voice&actor_user_id=other'))).status,422);
  assert.equal((await allowed.api.metrics(workspace,new Request('https://studio.invalid/metrics?question_key=voice&question_key=promotion'))).status,422);
  assert.equal(allowed.calls.length,0);
});
