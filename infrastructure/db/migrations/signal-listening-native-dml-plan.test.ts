import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Client,type PoolClient} from 'pg';
import test from 'node:test';
import {signalListeningBaseTemplateV1,signalListeningJevIdentityV1,buildSignalListeningJevRequestV1,
 signalListeningRequestDigestV1,signalListeningCalibrationShapeV1,canonicalEntityContextV1,entityContextDigestV1,
 type SignalListeningInputV1} from '@noisia/query-engine';
import {createSignalLabelingStoreV1,LabelingAdmissionFailureV1,type LabelingRunV1} from '../signal-labeling-runs';
import {NATIVE_LISTENING_ADMISSION_INSERT_SQL_V1,NATIVE_LISTENING_ADMISSION_MARK_SQL_V1} from '../signal-listening-native-admission';
import {createNativeDmlPlanObserverV1,NATIVE_DML_PLAN_APPLY_SHA_V1,nativeDmlPlanNormalizedShaV1,
 createNativeDmlPlanClientGuardV1,nativeDmlPlanOwnerOutcomeV1,
 type NativeDmlPlanClientV1,type NativeDmlPlanOperationV1} from './signal-listening-native-dml-plan.test-support';

// Value: protects=probe never launches normal DML after failed/unknown rollback;
// fails_when=normal runs before proven restoration; why_new=new test observer;
// seam=none (test-only helper); no_claim=real PostgreSQL plans/ACKs (mocked here).
const keys=['promotion','voice'];
const packet=JSON.stringify({rows:Array.from({length:720},(_,i)=>({custom_id:'call_'+i,inputs:[{root_id:'root_'+i}],question_keys:keys}))});
async function argumentsFor(operation:NativeDmlPlanOperationV1){
 if(operation==='insert')return{sql:NATIVE_LISTENING_ADMISSION_INSERT_SQL_V1,values:['run','workspace','typesafe','jev-1.13.0','sync',packet,'2026-11-20','UTC']};
 if(operation==='mark')return{sql:NATIVE_LISTENING_ADMISSION_MARK_SQL_V1,values:['run','workspace',Array.from({length:720},(_,i)=>'id_'+i),packet]};
 const source=await readFile(new URL('../signal-listening-runs.ts',import.meta.url),'utf8');
 const matches=[...source.matchAll(/await c\.query\(`(INSERT INTO signal_listening_answers[\s\S]*?)`/gu)];
 assert.equal(matches.length,1);const sql=matches[0]![1]!;assert.equal(nativeDmlPlanNormalizedShaV1(sql),NATIVE_DML_PLAN_APPLY_SHA_V1);
 return{sql,values:['workspace','context','run',JSON.stringify(Array.from({length:720},(_,i)=>keys.map(question_key=>({call_id:'id_'+i,question_key}))).flat())]};
}
function harness(operation:NativeDmlPlanOperationV1,problem?:'rollback'|'release'|'explain'|'snapshot'|'size'|'trigger'){
 const observer=createNativeDmlPlanObserverV1();observer.arm('base',keys);
 if(operation==='apply')observer.bindApplyRoster(Array.from({length:720},(_,i)=>'id_'+i));
 const commands:string[]=[];let normalCalls=0,snapshots=0;
 const plan=[{Plan:{'Node Type':'ModifyTable',Operation:operation==='mark'?'Update':'Insert',
  'Relation Name':operation==='apply'?'signal_listening_answers':'signal_labeling_calls'},
  Triggers:problem==='trigger'?[]:[{'Trigger Name':operation==='apply'?'signal_listening_answer_guard':'listening_statement_money_'+(operation==='mark'?'update':'insert'),Calls:operation==='apply'?1440:1}],
  ...(problem==='size'?{oversized:'x'.repeat(4*1024*1024)}:{})}];
 const client:NativeDmlPlanClientV1={async query(sql){commands.push(sql);
  if(problem==='rollback'&&sql.startsWith('ROLLBACK TO'))throw Error('synthetic_lost_rollback_ack');
  if(problem==='release'&&sql.startsWith('RELEASE'))throw Error('synthetic_lost_release_ack');
  if(sql.startsWith('EXPLAIN')){if(problem==='explain')throw Error('synthetic_explain_failure');return{rows:[{'QUERY PLAN':plan}]};}
  return{rows:[]};
 }};
 const returned={rows:[{original:true}]};
 return{observer,commands,normalCalls:()=>normalCalls,returned,
  run:async(sql:string,values:unknown[])=>observer.query({client,sql,values,
   snapshot:async()=>({raw:problem==='snapshot'&&snapshots++>0?'changed':'unchanged',counts:{calls:32}}),
   normal:async()=>{normalCalls++;commands.push('ORIGINAL');return returned;}})};
}
for(const operation of ['insert','mark','apply']as const)test('DML plan observer preserves original '+operation+' result only after acknowledged byte-exact restore',async()=>{
 const h=harness(operation),args=await argumentsFor(operation);assert.equal(await h.run(args.sql,args.values),h.returned);
 assert.equal(h.normalCalls(),1);assert.deepEqual(h.commands.map(sql=>sql.split(' ')[0]),['SAVEPOINT','EXPLAIN','ROLLBACK','RELEASE','ORIGINAL']);
 const row=h.observer.observations[0]!;assert.equal(row.snapshot_equal,true);assert.equal(row.normal_original_succeeded,true);assert.equal(row.unknown_ack,false);
 assert.equal(row.calls,720);assert.equal(row.answers,operation==='apply'?1440:null);
});
for(const problem of ['rollback','release','explain','snapshot','size','trigger']as const)test('DML plan observer blocks normal DML after '+problem+' failure, with no probe retry',async()=>{
 const h=harness('insert',problem),args=await argumentsFor('insert');await assert.rejects(h.run(args.sql,args.values));
 assert.equal(h.normalCalls(),0);const row=h.observer.observations[0]!;
 assert.equal(row.normal_original_sent,false);assert.equal(row.unknown_ack,problem==='rollback'||problem==='release');
 assert.equal(h.commands.filter(sql=>sql.startsWith('EXPLAIN')).length,1);
 assert.equal(h.commands.filter(sql=>sql.startsWith('ROLLBACK TO')).length,1);
 await assert.rejects(h.run(args.sql,args.values),/duplicate_observation/u);assert.equal(h.normalCalls(),0);
});
test('DML plan observer rejects changed SQL, wrong APPLY count and 720 foreign IDs before a savepoint',async()=>{
 const changed=harness('insert'),insert=await argumentsFor('insert');await assert.rejects(changed.run(insert.sql+' /* changed */',insert.values),/original_SQL_changed/u);
 assert.deepEqual(changed.commands,[]);assert.equal(changed.normalCalls(),0);
 const wrong=harness('apply'),apply=await argumentsFor('apply');apply.values[3]='[]';await assert.rejects(wrong.run(apply.sql,apply.values),/answer_count/u);
 assert.deepEqual(wrong.commands,[]);assert.equal(wrong.normalCalls(),0);
 const foreign=harness('apply'),sameCount=await argumentsFor('apply');
 sameCount.values[3]=JSON.stringify(Array.from({length:720},(_,i)=>keys.map(question_key=>({call_id:'foreign_'+i,question_key}))).flat());
 await assert.rejects(foreign.run(sameCount.sql,sameCount.values),/actual_admission_roster_changed/u);
 assert.deepEqual(foreign.commands,[]);assert.equal(foreign.normalCalls(),0);
});

/** Exercise the ORIGINAL native owner's catch/rollback/release, not a local
 * imitation of its transaction. Authority/data are mocked; no socket opens. */
async function realOwnerWithLostAck(loss:'savepoint'|'rollback'|'release'|'commit'){
 const configuration=signalListeningBaseTemplateV1({category:'synthetic bicycles',lexicon_terms:['synthetic']});
 const identity=signalListeningJevIdentityV1(configuration),context=canonicalEntityContextV1({entities:[]});
 const run:LabelingRunV1={id:randomUUID(),workspace_id:randomUUID(),actor_user_id:randomUUID(),kind:'mass_labeling',identity,
  labeler_digest:'sha256:'+'a'.repeat(64),entity_context_digest:entityContextDigestV1(context),entity_context_version_no:1,
  context,lease_token:randomUUID(),cursor_root_id:null,cap_micro_usd:'20000000',processing_admission_id:randomUUID(),status:'running'};
 const mapId=randomUUID();
 const inputs:SignalListeningInputV1[]=Array.from({length:720},(_,i)=>({root_id:randomUUID(),input_digest:'sha256:'+'b'.repeat(64),
  text:'Synthetic bicycle '+i,title:null,platform:'synthetic',content_type:null,author:null,published_at:'2026-11-20T00:00:00.000Z',language:null,
  map_id:mapId,configuration_digest:String(identity.params.configuration_digest),question_keys:keys,
  question_digests:{promotion:'sha256:'+'c'.repeat(64),voice:'sha256:'+'d'.repeat(64)},scope_basis:{}}));
 const proposals=inputs.map(input=>{const request=buildSignalListeningJevRequestV1(input,configuration),request_digest=signalListeningRequestDigestV1(run,input,request);
  return{custom_id:'listening_'+request_digest.slice(7,67),request_digest,request,inputs:[input],reserved_micro_usd:1000};});
 const sizes=proposals.map(p=>Buffer.byteLength(JSON.stringify(p.request))),shape=signalListeningCalibrationShapeV1(configuration,inputs[0]!);
 const profile={scope:{workspace_id:run.workspace_id,configuration_digest:String(identity.params.configuration_digest),model:configuration.model,
  compiler_version:'listening-jev-v1',shape_digest:shape.shape_digest,phase:shape.phase},scope_digest:'sha256:'+'e'.repeat(64),source_digest:'sha256:'+'f'.repeat(64),
  source_call_ids:Array.from({length:32},()=>randomUUID()),source_run_id:run.id,request_min_bytes:Math.min(...sizes),request_max_bytes:Math.max(...sizes),
  max_input_tokens_per_byte:2,sample_count:32,status:'measured'};
 const commands:string[]=[],released:Array<Error|boolean|undefined>=[],primary=Error('synthetic_lost_'+loss+'_ack');
 const callIds=proposals.map(()=>randomUUID());let originals=0;
 const metadata=(status:string)=>proposals.map((proposal,i)=>({id:callIds[i],run_id:run.id,workspace_id:run.workspace_id,provider:'typesafe',model:'jev-1.13.0',transport:'sync',
  provider_batch_id:null,custom_id:proposal.custom_id,request_digest:proposal.request_digest,request_storage_key:null,retry_depth:0,status,
  reserved_micro_usd:'1000',settled_micro_usd:null,usage:null,raw_sha256:null,raw_storage_key:null,stop_reason:null,refusal_category:null,
  results_applied:false,results:null,budget_date:'2026-11-20',budget_timezone:'UTC',created_at:new Date('2026-11-20T00:00:00Z'),updated_at:new Date('2026-11-20T00:00:00Z'),
  raw_storage_verified_at:null,raw_storage_verified_key:null,raw_size_bytes:null,terminal_exposure_micro_usd:'0',payload_matches:true}));
 const query=(async(sql:string)=>{
  commands.push(sql);
  if(loss==='savepoint'&&sql.startsWith('SAVEPOINT'))throw primary;
  if(loss==='rollback'&&sql.startsWith('ROLLBACK TO SAVEPOINT'))throw primary;
  if(loss==='release'&&sql.startsWith('RELEASE SAVEPOINT'))throw primary;
  if(loss==='commit'&&sql==='COMMIT')throw primary;
  if(sql.startsWith('EXPLAIN')){
   const marking=sql.includes('labeling_native_covered_mark_v1');
   return{rows:[{'QUERY PLAN':[{Plan:{'Node Type':'ModifyTable',Operation:marking?'Update':'Insert','Relation Name':'signal_labeling_calls'},
    Triggers:[{'Trigger Name':'listening_statement_money_'+(marking?'update':'insert'),Calls:1}]}]}]};
  }
  if(sql===NATIVE_LISTENING_ADMISSION_INSERT_SQL_V1){originals++;return{rows:metadata('reserved')};}
  if(sql===NATIVE_LISTENING_ADMISSION_MARK_SQL_V1){originals++;return{rows:metadata('submitting')};}
  if(sql.includes('workspace.status workspace_status'))return{rows:[{workspace_status:'active',brand_status:'active',actor_status:'active',
   user_type:'noisia_internal',primary_role:'founder',organization_status:'active',brand_same_organization:true,same_organization:true,brand_access_level:'admin'}]};
  if(sql.includes('signal_workspace_features'))return{rows:[{enabled:true}]};
  if(sql.includes('AS workspace_id, brand.id::text AS brand_id'))return{rows:[{workspace_id:run.workspace_id,brand_id:mapId,
   brand_name:'Synthetic',brand_slug:'synthetic',brand_handles:[],description:null,industry:null,industry_sub:null,countries:[]}]};
  if(sql.includes('SELECT context,digest,version_no'))return{rows:[{context,digest:run.entity_context_digest,version_no:1}]};
  if(sql.includes('signal_processing_org_exposure_v1'))return{rows:[{total_micro_usd:'0'}]};
  if(sql.includes('COALESCE(sum(CASE WHEN status'))return{rows:[{total:'0'}]};
  if(sql.includes('WITH raw_run_fence')||sql.includes('JOIN signal_corpus_preparation_runs'))return{rows:[{id:run.id}]};
  if(sql.includes('labeling_native_covered_profiles_v1'))return{rows:[{profile}]};
  if(sql.includes('SELECT id FROM signal_labeling_calls'))return{rows:callIds.map(id=>({id}))};
  return{rows:[]};
 }) as PoolClient['query'];
 const raw=Object.assign(new Client(),{query,release:(error?:Error|boolean)=>{released.push(error);}});
 const observer=createNativeDmlPlanObserverV1();observer.arm('base',keys);
 const guard=createNativeDmlPlanClientGuardV1(raw,({sql,values,normal,markUnknown})=>observer.query({client:raw,sql,values,
  snapshot:async()=>({raw:'same_mocked_business_state',counts:{calls:32}}),normal,onUnknown:markUnknown}));
 const database={query:guard.client.query.bind(guard.client),connect:async()=>guard.client} as Parameters<typeof createSignalLabelingStoreV1>[0]['database'];
 const store=createSignalLabelingStoreV1<SignalListeningInputV1>({database,page_size:1024,storeRaw:async()=>{throw Error('no raw I/O in owner unit test');},
  rawPages:{reference:()=>({storage_key:'unused'}),store:async()=>{throw Error('no raw I/O');},load:async()=>{throw Error('no raw I/O');}},
  adapter:{kind:'mass_labeling',reserve_selection:'native_listening_pending',parallel_native_pages:true,feature:'mass_labeling',policy_action:'mass_labeling_jev',
   policy:async()=>({organization_id:mapId,budget_date:'2026-11-20',budget_timezone:'UTC',daily_cap_micro_usd:'100000000',max_execution_micro_usd:'20000000',provider:'typesafe',model:'jev-1.13.0',action:'mass_labeling_jev'}),
   inputs:async()=>[],write:async()=>{},pending:async()=>0}});
 assert.ok(store.admitAndMarkSelected);let failure:unknown;
 try{await store.admitAndMarkSelected(run,proposals,{selectFresh:rows=>rows,validateBeforeCommit:calls=>{assert.equal(calls.length,720);}});}
 catch(error){failure=error;}
 assert.ok(failure instanceof LabelingAdmissionFailureV1,'must reach actual owner post-DML catch');
 assert.equal(failure.outcome,'unknown');assert.equal(nativeDmlPlanOwnerOutcomeV1(failure),'unknown');
 assert.ok(failure.cause instanceof AggregateError);assert.equal(failure.cause.cause,primary,'actual owner retains original primary error');
 assert.equal(guard.state.unknown_ack,true);assert.equal(guard.state.owner_rollback_sent,true);assert.equal(guard.state.owner_rollback_ack,true);
 assert.equal(guard.state.forced_discard,true);assert.equal(guard.state.released,true);assert.deepEqual(released,[true]);
 assert.equal(commands.filter(sql=>sql==='ROLLBACK').length,1,'one real global rollback, never a retry');
 assert.equal(originals,loss==='commit'?2:0,'no normal DML after an uncertain probe');
 assert.equal(guard.state.owner_commit_ack_unknown,loss==='commit');
 const before=commands.length;await assert.rejects(guard.client.query('SELECT 1'),/client_ack_unknown/u);assert.equal(commands.length,before,'discarded client cannot execute another statement');
}
for(const loss of ['savepoint','rollback','release','commit']as const)test('real Native owner keeps '+loss+' ACK loss UNKNOWN and discards its guarded client despite global rollback ACK',()=>realOwnerWithLostAck(loss));
test('owner uncertainty is retained through postcheck AggregateErrors even when every probe succeeded',()=>{
 const owner=new LabelingAdmissionFailureV1(Error('synthetic_lost_commit'),'unknown',[],[]);
 assert.equal(nativeDmlPlanOwnerOutcomeV1(new AggregateError([owner,Error('postcheck')],'both')),'unknown');
 assert.equal(nativeDmlPlanOwnerOutcomeV1(new LabelingAdmissionFailureV1(Error('known'),'rolled_back',[],[])),'rolled_back');
 assert.equal(nativeDmlPlanOwnerOutcomeV1(Error('unrelated')),null);
});
