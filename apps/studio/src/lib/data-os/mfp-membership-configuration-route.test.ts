import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
type Handler=(request:Request,context:{params:Promise<{workspaceId:string}>})=>Promise<Response>;
const workspace='10000000-0000-4000-8000-000000000001';
class Failure extends Error{constructor(readonly code:string,readonly status=409){super(code);}}
function harness(denied=false,failure?:Failure){
 const calls:Array<unknown>=[];
 const dependencies:Record<string,unknown>={
  '../../topics/_lib':{loadSignalWorkspaceContextForTopics:async()=>denied?{response:Response.json({error:'forbidden'},{status:403})}:{workspace:{id:workspace},session:{appUser:{id:'authenticated-actor'}}}},
  '@/lib/data-os/mfp-membership-configuration':{
   loadMembershipConfigurationForActorV1:async(args:unknown)=>{calls.push(args);if(failure)throw failure;return{route:'standard',route_digest:null,can_configure:true,unknown_calls:0,reserved_exposure_micro_usd:'0'};},
   configureMembershipForActorV1:async(args:unknown)=>{calls.push(args);if(failure)throw failure;return{route:'hybrid_h1',route_digest:'current'};}
  },
  '@noisia/db':{SignalLabelingError:Failure},zod:null
 };
 const source=readFileSync(new URL('../../app/api/data-os/signal/[workspaceId]/memberships/configuration/route.ts',import.meta.url),'utf8');
 const exports:Record<string,unknown>={};
 new Function('require','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(
  (name:string)=>{if(name==='zod')return requireZod;assert.ok(name in dependencies);return dependencies[name];},exports);
 const context={params:Promise.resolve({workspaceId:workspace})};
 return{calls,get:()=> (exports.GET as Handler)(new Request('https://noisia.invalid/configuration'),context) as Promise<Response>,
  patch:(body:unknown)=> (exports.PATCH as Handler)(new Request('https://noisia.invalid/configuration',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),context) as Promise<Response>};
}
import * as requireZod from 'zod';
test('configuration uses session identity and forwards exact CAS; ignores no client authority fields',async()=>{
 const f=harness();assert.equal((await f.get()).status,200);
 assert.equal((await f.patch({route:'hybrid_h1',expected_route_digest:null})).status,200);
 assert.deepEqual(f.calls[1],{workspace_id:workspace,actor_user_id:'authenticated-actor',route:'hybrid_h1',expected_route_digest:null});
 for(const extra of [{actor_user_id:'other'},{provider_available:true},{workspace_id:'other'}])assert.equal((await f.patch({route:'hybrid_h1',expected_route_digest:null,...extra})).status,400);
 assert.equal((await f.patch({route:'hybrid_h1'})).status,400);assert.equal(f.calls.length,2);
});
test('revoked access never reaches stores; changed route and unconfirmed rollback remain409',async()=>{
 const denied=harness(true);assert.equal((await denied.patch({route:'standard',expected_route_digest:'current'})).status,403);assert.equal(denied.calls.length,0);
 for(const code of ['hybrid_route_changed','hybrid_unknown_confirmation_required']){
  const f=harness(false,new Failure(code));const response=await f.patch({route:'standard',expected_route_digest:'current'});
  assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:code});
 }
});

test('server selection requires both providers and H1 ledger gates; provider shutdown leaves rollback reachable',()=>{
 const source=readFileSync(new URL('./mfp-membership-configuration.ts',import.meta.url),'utf8');
 const flags=['NOISIA_CONCEPT_MEMBERSHIP_PROVIDER_ENABLED','NOISIA_JEV_PROVIDER_ENABLED','NOISIA_MFP_HYBRID_ENABLED','NOISIA_MFP_HYBRID_LEDGER_READY'];
 type Selection={route:'standard'|'hybrid_h1';provider_available:boolean};
 const load=(env:Record<string,string>)=>{
  const exports:Record<string,unknown>={};const calls:Selection[]=[];
  new Function('require','exports','process',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(
   (name:string)=>name==='@noisia/db'?{configureHybridMembershipRouteV1:(args:Selection)=>{calls.push(args);return args;}}:{pool:{}},exports,{env});
  const configure=exports.configureMembershipForActorV1 as (args:{workspace_id:string;actor_user_id:string;route:'standard'|'hybrid_h1';expected_route_digest:string|null})=>Selection;
  return{calls,configure};
 };
 const complete=Object.fromEntries(flags.map(key=>[key,'true']));
 const args={workspace_id:workspace,actor_user_id:'session-actor',route:'hybrid_h1' as const,expected_route_digest:null};
 assert.equal(load(complete).configure(args).provider_available,true);
 for(const missing of flags){const f=load({...complete,[missing]:'false'});assert.equal(f.configure(args).provider_available,false);}
 const off=load({});assert.equal(off.configure({...args,route:'standard'}).route,'standard');
 assert.equal(off.calls.length,1);const rollback=off.calls[0];assert.ok(rollback);assert.equal(rollback.provider_available,false);
});
