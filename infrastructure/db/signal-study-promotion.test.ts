import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as engine from '@noisia/query-engine';
import * as core from './signal-study-core';
import type * as store from './signal-study-promotion';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,workspace=id(1),execution=id(2);
const motive={key:'leisure',name:'Native leisure',definition:'The exact committed native force.',centroid:[1,0],layer:'personal' as const,human_locked:false};
const localization={original_language:'und',original:{name:motive.name,definition:motive.definition},en:{name:'Leisure',definition:'A leisure force.'},es:{name:'Ocio',definition:'Una fuerza de ocio.'}};
function fixture(options:{denied?:boolean;foreign?:boolean;stale?:boolean;oversize?:boolean;prior?:boolean}={}){
 const calls:string[]=[],current=engine.signalListeningBaseTemplateV1({category:'synthetic bikes',lexicon_terms:['bike']}),output={synthetic:'frozen'},output_digest=engine.signalWorkspaceEmbeddingDigestV1(output);
 const args={workspace_id:workspace,actor_user_id:id(3),execution_id:execution,motive_keys:[motive.key],expected_listening_revision:1,idempotency_key:'stable-promotion'};
 let saved:any,sourceReads=0;
 const client={query:async(sql:string,params:unknown[]=[])=>{sql=sql.trim();calls.push(sql);
  if(sql.includes('workspace.status workspace_status'))return{rows:options.denied?[]:[{workspace_status:'active',brand_status:'active',actor_status:'active',user_type:'noisia_internal',primary_role:'noisia_admin',same_organization:true,brand_access_level:null,organization_status:'active',brand_same_organization:true}]};
  if(sql.includes('SELECT EXISTS(SELECT 1 FROM signal_workspace_features'))return{rows:[{enabled:true}]};
  if(sql.startsWith('SELECT * FROM signal_study_promotions'))return{rows:options.prior?[{id:id(4),request_digest:engine.signalWorkspaceEmbeddingDigestV1({execution_id:execution,motive_keys:[motive.key],expected_listening_revision:1}),output_configuration_id:id(5),output_configuration_digest:output_digest}]:[]};
  if(sql.startsWith('SELECT * FROM signal_study_executions')){assert.deepEqual(params,[execution,workspace]);return{rows:options.foreign?[]:[{id:execution,workspace_id:workspace,study_id:id(6),status:'completed'}]};}
  if(sql.startsWith('SELECT o.output_digest')){assert.deepEqual(params,[execution,workspace]);return{rows:options.stale?[]:[{output_digest}]};}
  if(sql.startsWith('SELECT * FROM signal_listening_configurations'))return{rows:[{id:id(7),revision:1,configuration:current}]};
  if(sql.startsWith('INSERT INTO signal_study_promotions'))return{rows:[{id:id(8)}]};
  if(sql.startsWith('SELECT ')||sql.startsWith('SET ')||['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rows:[]};
  assert.fail('unexpected native-store test query');
 },release(){}};
 const study={contract_version:'signal-study-v1',workspace_id:workspace,corpus_id:id(9),listening_configuration_id:id(7),listening_configuration_digest:engine.signalWorkspaceEmbeddingDigestV1(current),methodology:{key:'triggers_barriers',version:'r16-v1',template_digest:engine.SIGNAL_STUDY_TB_TEMPLATE_DIGEST_V1},subject:{kind:'category',name:'bikes',category:'bikes',own_brand:'synthetic',competitors:[],alternatives:[]},business_question:'What moves the decision?',cut:{start_at:'2026-01-01T00:00:00Z',end_at:'2027-01-01T00:00:00Z',timezone:'UTC',voice:'individual',promotion_max:.7,exclude_hashtag_only:true,require_category_lexicon:true,filters:{}},provenance:'human',revision:1};
 const dependencies:Record<string,unknown>={'@noisia/query-engine':engine,'./signal-study-core':core,
 './signal-listening-configuration':{loadSignalListeningConfigurationWithClientV1:async()=>({id:id(7),revision:1,configuration:current}),saveSignalListeningConfigurationWithClientV1:async(_c:unknown,a:any)=>{engine.validateSignalListeningPublicationDeltaV1(a.configuration,current);saved=a.configuration;return{id:id(5),configuration_digest:output_digest};}},
 './signal-study-source':{withSignalStudySourceWithClientV1:async(_c:unknown,_p:unknown,fn:(source:unknown)=>unknown)=>{sourceReads++;return fn({configuration:{study}});}},
 './signal-study-replay':{replaySignalStudyWithClientV1:async()=>({operation:{kind:'output',output},resolved_motives:[{...motive,...(options.oversize?{definition:'漢'.repeat(100000)}:{})}]})}};
 const module={exports:{}};const compiled=ts.transpileModule(readFileSync(new URL('./signal-study-promotion.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',compiled)((name:string)=>{assert.ok(name in dependencies,name);return dependencies[name];},module,module.exports);
 const api=module.exports as typeof store,database={query:client.query,connect:async()=>client} as unknown as core.StudyDatabaseV1;
 return{args:{...args,database},api,calls,get saved(){return saved;},get sourceReads(){return sourceReads;}};
}
test('promotion context is an explicit authorized native replay read exposing only bounded original metadata',async()=>{
 const f=fixture(),value=await f.api.readSignalStudyPromotionContextV1(f.args);assert.deepEqual(value,{execution_id:execution,motives:[{key:motive.key,name:motive.name,definition:motive.definition,original_language:'und'}]});
 assert.equal(f.sourceReads,1);assert.equal(f.calls.some(sql=>sql.startsWith('INSERT')||sql.startsWith('UPDATE')),false);
 assert.ok(f.calls.some(sql=>sql.includes('signal_listening_root_right_v1')));
});
test('context rejects revoked/cross-workspace/stale source, forged or oversized keys and oversized metadata',async()=>{
 for(const [options,pattern]of [[{denied:true},/forbidden/],[{foreign:true},/completed_report_required/],[{stale:true},/source_changed/],[{oversize:true},/context_too_large/]]as const){const f=fixture(options);await assert.rejects(f.api.readSignalStudyPromotionContextV1(f.args),pattern);}
 for(const keys of [[],['missing'],['leisure','leisure'],['bad key'],Array.from({length:33},(_,i)=>'motive_'+i)]){const f=fixture();await assert.rejects(f.api.readSignalStudyPromotionContextV1({...f.args,motive_keys:keys}));assert.equal(f.calls.some(sql=>sql.startsWith('INSERT')),false);}
});
test('promotion rederives original metadata, requires actual localizations and binds them to idempotency',async()=>{
 for(const supplied of [undefined,{...localization,original:{...localization.original,name:'Forged'}},{...localization,original:{...localization.original,definition:'Forged'}}]){
  const f=fixture();await assert.rejects(f.api.promoteSignalStudyMotivesV1({...f.args,...(supplied?{localizations:{leisure:supplied}}:{})}),/localization_required|original_mismatch/);assert.equal(f.saved,undefined);
 }
 const f=fixture();await f.api.promoteSignalStudyMotivesV1({...f.args,localizations:{leisure:localization}});assert.deepEqual(f.saved.questions.find((q:any)=>q.origin==='methodology').localization,localization);
 const prior=fixture({prior:true});await prior.api.promoteSignalStudyMotivesV1(prior.args);assert.equal(prior.sourceReads,0,'an already-published historical ACK does not acquire new localization requirements');
 await assert.rejects(prior.api.promoteSignalStudyMotivesV1({...prior.args,localizations:{leisure:localization}}),/idempotency_conflict/);
});
