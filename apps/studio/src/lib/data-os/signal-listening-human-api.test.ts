import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createSignalListeningHumanApiV1,type SignalListeningHumanApiDependenciesV1} from './signal-listening-human-api';
const workspace='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002',sha='sha256:'+'a'.repeat(64);
const expected={base_snapshot_id:id,configuration_id:id,configuration_digest:sha,source_generation_id:id,source_generation_digest:sha,map_id:id,
 source_digest:sha,policy_version_id:id,policy_digest:sha,human_revision_digest:sha,edit_revision:0,previous_edit_id:null};
function harness(denied=false){
 const calls:Array<Record<string,unknown>>=[];let nativeError:unknown;
 const deps:SignalListeningHumanApiDependenciesV1={load:async requested=>denied?{response:Response.json({error:'forbidden'},{status:403})}:{workspace_id:requested,actor_user_id:'session-actor'},
  context:async scope=>{calls.push({operation:'context',...scope});return{can_edit:true,expected};},
  membership:async(scope,args)=>{calls.push({operation:'membership',...scope,...args});if(nativeError)throw nativeError;return{operation:args.to_question_key?'move':'remove'};},
  merge:async(scope,args)=>{calls.push({operation:'merge',...scope,...args});if(nativeError)throw nativeError;return{operation:'merge'};}};
 const api=createSignalListeningHumanApiV1(deps),exports:Record<string,unknown>={};
 const source=readFileSync(new URL('../../app/api/data-os/signal/[workspaceId]/listening/human-edits/route.ts',import.meta.url),'utf8');
 new Function('require','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(()=>({loadSignalWorkspaceContextForListeningHumanV1:async()=>({api})}),exports);
 const invoke=(method:'GET'|'POST',body?:unknown,key='stable-edit-key')=>(exports[method]as(request:Request,context:{params:Promise<{workspaceId:string}>})=>Promise<Response>)(
  new Request('https://studio.invalid/human-edits',{method,headers:{'Content-Type':'application/json','Idempotency-Key':key},...(body===undefined?{}:{body:JSON.stringify(body)})}),{params:Promise.resolve({workspaceId:workspace})});
 return{calls,invoke,setError:(error:unknown)=>{nativeError=error;}};
}
test('mounted human edit routes bind session scope and exact snapshot expectations without provider or processing authority',async()=>{
 const f=harness();assert.equal((await f.invoke('GET')).status,200);
 const body={operation:'membership',expected,root_id:id,from_question_key:'topic_one'};
 assert.equal((await f.invoke('POST',body)).status,200);
 assert.deepEqual(f.calls[1],{...body,workspace_id:workspace,actor_user_id:'session-actor',idempotency_key:'stable-edit-key'});
 assert.equal((await f.invoke('POST',{...body,to_question_key:'topic_two'})).status,200);
 const merged={operation:'merge',expected,source_question_keys:['topic_one','topic_two'],target_question_key:'topic_two'};
 assert.equal((await f.invoke('POST',merged)).status,200);
 assert.deepEqual(f.calls[3],{...merged,workspace_id:workspace,actor_user_id:'session-actor',idempotency_key:'stable-edit-key'});
 assert.equal((await f.invoke('GET')).headers.get('Cache-Control'),'private, no-store');
});
test('forged authority, malformed scopes, duplicate keys and invalid idempotency never reach native mutations',async()=>{
 const f=harness(),base={operation:'membership',expected,root_id:id,from_question_key:'topic_one'};
 for(const extra of [{actor_user_id:id},{workspace_id:id},{map_id:id},{provider_available:true},{cap_micro_usd:1},{processing_admission_id:id}])
  assert.equal((await f.invoke('POST',{...base,...extra})).status,422);
 for(const patch of [{expected:{...expected,edit_revision:-1}},{expected:{...expected,provider:'anthropic'}},{root_id:'invalid'},{operation:'start'}])
  assert.equal((await f.invoke('POST',{...base,...patch})).status,422);
 for(const keys of [['topic_one','topic_one'],['topic_one']])assert.equal((await f.invoke('POST',{operation:'merge',expected,source_question_keys:keys,target_question_key:'topic_one'})).status,422);
 assert.equal((await f.invoke('POST',{operation:'merge',expected,source_question_keys:['topic_one','topic_two'],target_question_key:'unrelated'})).status,422);
 assert.equal((await f.invoke('POST',base,'invalid key')).status,422);assert.equal(f.calls.length,0);
});
test('revoked session prevents reads and edits while native CAS and rights conflicts remain authoritative',async()=>{
 const denied=harness(true);assert.equal((await denied.invoke('GET')).status,403);
 assert.equal((await denied.invoke('POST',{operation:'membership',expected,root_id:id,from_question_key:'topic_one'})).status,403);assert.equal(denied.calls.length,0);
 const f=harness();f.setError(Object.assign(Error('stale'),{code:'listening_human_context_changed',status:409}));
 const response=await f.invoke('POST',{operation:'membership',expected,root_id:id,from_question_key:'topic_one'});
 assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:'listening_human_context_changed'});
 f.setError(Object.assign(Error('revoked'),{code:'listening_forbidden',status:403}));
 assert.equal((await f.invoke('POST',{operation:'membership',expected,root_id:id,from_question_key:'topic_one'})).status,403);
});
