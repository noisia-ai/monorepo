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
 createNativeDmlPlanClientGuardV1,nativeDmlPlanOwnerOutcomeV1,nativeDmlLateGrowthLimitV1,
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
function harness(operation:NativeDmlPlanOperationV1,problem?:'rollback'|'release'|'explain'|'snapshot'|'size'|'trigger',phase:'base'|'late-consumer'='base'){
 const observer=createNativeDmlPlanObserverV1();observer.arm(phase,keys);
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
async function realOwnerWithLostAck(loss:'savepoint'|'rollback'|'release'|'commit'|'nested_settings'|'nested_restore'|'nested_context_restore'){
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
 const callIds=proposals.map(()=>randomUUID());let originals=0,settingsReads=0;
 const metadata=(status:string)=>proposals.map((proposal,i)=>({id:callIds[i],run_id:run.id,workspace_id:run.workspace_id,provider:'typesafe',model:'jev-1.13.0',transport:'sync',
  provider_batch_id:null,custom_id:proposal.custom_id,request_digest:proposal.request_digest,request_storage_key:null,retry_depth:0,status,
  reserved_micro_usd:'1000',settled_micro_usd:null,usage:null,raw_sha256:null,raw_storage_key:null,stop_reason:null,refusal_category:null,
  results_applied:false,results:null,budget_date:'2026-11-20',budget_timezone:'UTC',created_at:new Date('2026-11-20T00:00:00Z'),updated_at:new Date('2026-11-20T00:00:00Z'),
  raw_storage_verified_at:null,raw_storage_verified_key:null,raw_size_bytes:null,terminal_exposure_micro_usd:'0',payload_matches:true}));
 const query=(async(sql:string)=>{
  commands.push(sql);
  if(sql.includes('r16_nested_settings')){settingsReads++;return{rows:[{backend_pid:42,server_version_num:170000,settings:{
   'auto_explain.log_min_duration':'-1','auto_explain.log_nested_statements':'off','auto_explain.log_format':'text',
   'auto_explain.log_level':'log','auto_explain.log_analyze':(loss==='nested_restore'||loss==='nested_context_restore')&&settingsReads>2?'on':'off',
   'auto_explain.log_buffers':'off','auto_explain.log_timing':'on','auto_explain.log_parameter_max_length':'-1',
   'auto_explain.sample_rate':'1','client_min_messages':'notice'}}]};}
  if(loss==='nested_settings'&&sql.startsWith('SET LOCAL auto_explain'))throw primary;
  if(loss==='savepoint'&&sql.startsWith('SAVEPOINT'))throw primary;
  if(loss==='rollback'&&sql.startsWith('ROLLBACK TO SAVEPOINT'))throw primary;
  if(loss==='release'&&sql.startsWith('RELEASE SAVEPOINT'))throw primary;
  if(loss==='commit'&&sql==='COMMIT')throw primary;
  if(sql.startsWith('EXPLAIN')){
   if(loss==='nested_restore'||loss==='nested_context_restore')raw.emit('notice',loss==='nested_context_restore'?nestedNoticeWithContext('x'.repeat(8193)+nestedFunctionContext):nestedNotice());
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
 const nestedRecorder=createNativeDmlNestedRecorderV1({money:nestedSql,answer_guard:''});
 const guard=createNativeDmlPlanClientGuardV1(raw,({sql,values,normal,markUnknown})=>observer.query({client:raw,sql,values,
  snapshot:async()=>({raw:'same_mocked_business_state',counts:{calls:32}}),normal,onUnknown:markUnknown,
  ...(loss==='nested_settings'||loss==='nested_restore'||loss==='nested_context_restore'?{instrumentation:(identity:Parameters<typeof nestedRecorder.probe>[1])=>nestedRecorder.probe(raw,identity)}:{})}));
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
 assert.ok(failure.cause instanceof AggregateError);
 if(loss==='nested_restore'||loss==='nested_context_restore')assert.match(String(failure.cause.cause),/nested_settings_not_restored/u);
 else assert.equal(failure.cause.cause,primary,'actual owner retains original primary error');
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

// Nested capture acceptance: fixtures are notices, not SQL replicas; no socket opens.
import {createNativeDmlNestedCollectorV1,NATIVE_DML_NESTED_LIMITS_V1,
 createNativeDmlNestedRecorderV1,nativeDmlPlanShaV1,type NativeDmlNestedClientV1} from './signal-listening-native-dml-plan.test-support';
const nestedSql='SELECT receipt FROM synthetic_receipts WHERE id=$1';
const nestedNotice=(sql=nestedSql,duration='0.125')=>({message:'duration: '+duration+' ms  plan:\n'+JSON.stringify({'Query Text':sql,Plan:{'Node Type':'Index Scan','Relation Name':'synthetic_receipts'}}),
 severity:'NOTICE',where:'PL/pgSQL function signal_listening_statement_money_v1() line 1 at SQL statement'});
test('nested notices retain one raw JSON sample while counting repeated inclusive durations and excluding EXPLAIN outer',()=>{
 const c=createNativeDmlNestedCollectorV1({sql:'INSERT synthetic',protectedSources:{money:nestedSql,answer_guard:''}});
 c.arm();c.notice(nestedNotice());c.notice(nestedNotice(nestedSql,'0.250'));
 c.notice(nestedNotice('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) INSERT synthetic','1.000'));c.disarm();
 c.assertComplete('money');const r=c.report;assert.equal(r.types.length,2);assert.equal(r.internal_events,2);
 assert.equal(r.types[0]!.events,2);assert.equal(r.types[0]!.duration_inclusive_ms.sum,.375);
 assert.equal(r.types[0]!.sample_sha256,nativeDmlPlanShaV1(r.types[0]!.sample_json));
 assert.equal(r.types[0]!.sample_bytes,Buffer.byteLength(r.types[0]!.sample_json));
 assert.equal(r.types[1]!.is_outer,true);assert.deepEqual(r.types[1]!.attribution,[]);
});
for(const problem of ['parse','event','sample','retained','types','context','parameters']as const)test(problem==='context'?'nested collector explicitly omits optional oversized context without dropping the plan':'nested collector fails closed without emitter exceptions after '+problem,()=>{
 const limits={...NATIVE_DML_NESTED_LIMITS_V1,...(problem==='event'?{event_bytes:2}:{}),...(problem==='sample'?{sample_bytes:2}:{}),
  ...(problem==='retained'?{retained_bytes:2}:{}),...(problem==='types'?{unique_types:1}:{}),...(problem==='context'?{context_bytes:2}:{})};
 const c=createNativeDmlNestedCollectorV1({sql:'INSERT synthetic',protectedSources:{money:nestedSql,answer_guard:''},limits});c.arm();
 const msg=problem==='parse'?{message:'duration: 1 ms  plan: {broken'}:problem==='parameters'?{message:'duration: 1 ms  plan: '+JSON.stringify({'Query Text':nestedSql,'Query Parameters':'$1=secret',Plan:{}})}:nestedNotice();
 assert.doesNotThrow(()=>c.notice(msg));if(problem==='types')assert.doesNotThrow(()=>c.notice(nestedNotice('SELECT second')));
 if(problem==='context'){assert.equal(c.report.failed,false);assert.equal(c.report.counts.dropped,0);
  assert.equal(c.report.types[0]!.context_omitted,true);assert.equal(c.report.context_omissions.events,1);c.assertComplete('money');return;}
 assert.equal(c.report.failed,true);assert.ok(c.report.counts.dropped>0);assert.throws(()=>c.assertComplete('money'));
 assert.doesNotThrow(()=>c.notice(nestedNotice()));c.disarm();
});
test('nested collector does not mistake a different EXPLAIN hash for a useful internal plan',()=>{
 const c=createNativeDmlNestedCollectorV1({sql:'INSERT synthetic',protectedSources:{money:'',answer_guard:''}});c.arm();
 c.notice(nestedNotice('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) INSERT synthetic'));c.disarm();
 assert.equal(c.report.internal_events,0);assert.throws(()=>c.assertComplete('money'));
});
function nestedClient(loss?:'settings'|'restore'|'capture'|'large_context'){
 const client=new Client();const commands:string[]=[];let configured=false,reads=0;
 const settings:Record<string,string>={'auto_explain.log_min_duration':'-1','auto_explain.log_nested_statements':'off','auto_explain.log_format':'text',
  'auto_explain.log_level':'log','auto_explain.log_analyze':'off','auto_explain.log_buffers':'off','auto_explain.log_timing':'on',
  'auto_explain.log_parameter_max_length':'-1','auto_explain.sample_rate':'1','client_min_messages':'notice'};
 const query=async(sql:string)=>{commands.push(sql);
  if(sql.includes('r16_nested_settings')){reads++;return{rows:[{backend_pid:42,server_version_num:170000,settings:{...settings,...(loss==='restore'&&reads>2?{'auto_explain.log_analyze':'on'}:{})}}]};}
  if(sql.startsWith('SET LOCAL')){if(loss==='settings')throw Error('synthetic_settings_ack_lost');configured=true;}
  if(sql.startsWith('ROLLBACK TO'))configured=false;
  if(sql.startsWith('EXPLAIN')){assert.equal(configured,true);client.emit('notice',loss==='capture'?{message:'duration: 1 ms  plan: {broken'}:loss==='large_context'?nestedNoticeWithContext('x'.repeat(8193)+nestedFunctionContext):nestedNotice());return{rows:[{'QUERY PLAN':[{Plan:{'Node Type':'ModifyTable',Operation:'Insert','Relation Name':'signal_labeling_calls'},Triggers:[{'Trigger Name':'listening_statement_money_insert',Calls:1}]}]}]};}
  return{rows:[]};};
 const diagnostic:NativeDmlNestedClientV1=Object.assign(client,{query});return{client:diagnostic,commands};
}
test('nested lifecycle restores settings and removes its listener before the real observer launches normal SQL',async()=>{
 const h=nestedClient(),recorder=createNativeDmlNestedRecorderV1({money:nestedSql,answer_guard:''});
 const observer=createNativeDmlPlanObserverV1();observer.arm('base',keys);let normals=0;
 const args=await argumentsFor('insert');await observer.query({...args,client:h.client,snapshot:async()=>({raw:'same',counts:{calls:32}}),
  instrumentation:identity=>recorder.probe(h.client,identity),normal:async()=>{normals++;assert.equal(h.client.listenerCount('notice'),0);
   assert.equal(recorder.probes[0]!.settings_restored,true);return{rows:[]};}});
 assert.equal(normals,1);assert.equal(recorder.probes[0]!.listener_detached,true);
 assert.equal(h.commands.filter(sql=>sql.startsWith('EXPLAIN')).length,1);
});
for(const loss of ['settings','restore']as const)test('nested lifecycle '+loss+' failure blocks normal SQL, preserves UNKNOWN, and never retries',async()=>{
 const h=nestedClient(loss),recorder=createNativeDmlNestedRecorderV1({money:nestedSql,answer_guard:''});
 const observer=createNativeDmlPlanObserverV1();observer.arm('base',keys);let normals=0,unknown=0;
 const args=await argumentsFor('insert');await assert.rejects(observer.query({...args,client:h.client,snapshot:async()=>({raw:'same',counts:{calls:32}}),
  instrumentation:identity=>recorder.probe(h.client,identity),onUnknown:()=>{unknown++;},normal:async()=>{normals++;return{rows:[]};}}));
 assert.equal(normals,0);assert.equal(unknown,1);assert.equal(h.client.listenerCount('notice'),0);
 assert.ok(h.commands.filter(sql=>sql.startsWith('ROLLBACK TO')).length<=1);
});

for(const loss of ['nested_settings','nested_restore']as const)test('real Native owner preserves '+loss+' uncertainty through global rollback and forced discard',()=>realOwnerWithLostAck(loss));

test('nested capture failure rolls back once with known ACKs and blocks normal SQL',async()=>{
 const h=nestedClient('capture'),recorder=createNativeDmlNestedRecorderV1({money:nestedSql,answer_guard:''});
 const observer=createNativeDmlPlanObserverV1();observer.arm('base',keys);let normals=0,unknown=0;
 const args=await argumentsFor('insert');await assert.rejects(observer.query({...args,client:h.client,snapshot:async()=>({raw:'same',counts:{calls:32}}),
  instrumentation:identity=>recorder.probe(h.client,identity),onUnknown:()=>{unknown++;},normal:async()=>{normals++;return{rows:[]};}}));
 assert.equal(normals,0);assert.equal(unknown,0);assert.equal(observer.observations[0]!.unknown_ack,false);
 assert.equal(recorder.probes[0]!.capture.counts.parse_failures,1);assert.equal(recorder.probes[0]!.settings_restored,true);
 assert.equal(h.commands.filter(sql=>sql.startsWith('ROLLBACK TO')).length,1);assert.equal(h.client.listenerCount('notice'),0);
});
test('nested byte budgets accept the exact boundary and hostile notice getters never escape',()=>{
 const message=nestedNotice(),first=createNativeDmlNestedCollectorV1({sql:'INSERT synthetic',protectedSources:{money:nestedSql,answer_guard:''}});
 first.arm();first.notice(message);const retained=first.report.counts.retained_bytes;
 const exact=createNativeDmlNestedCollectorV1({sql:'INSERT synthetic',protectedSources:{money:nestedSql,answer_guard:''},
  limits:{...NATIVE_DML_NESTED_LIMITS_V1,event_bytes:Buffer.byteLength(message.message)+Buffer.byteLength(message.where),sample_bytes:retained,retained_bytes:retained,unique_types:1}});
 exact.arm();exact.notice(message);exact.assertComplete('money');assert.equal(exact.report.counts.retained_bytes,retained);
 const hostile=Object.defineProperty({},'message',{get(){throw Error('synthetic_getter');}});
 assert.doesNotThrow(()=>exact.notice(hostile));assert.equal(exact.report.failed,true);assert.equal(exact.report.counts.handler_exceptions,1);
});

// V2 acceptance: optional context omission never changes raw plan bytes or ACK authority.
const nestedFunctionContext='PL/pgSQL function signal_listening_statement_money_v1() line 1 at SQL statement';
const nestedNoticeWithContext=(where:string)=>({...nestedNotice(),where});
test('nested V2 retains context8192 and omits8193 with exact metadata and unchanged raw sample',()=>{
 const reports=[8192,8193].map(bytes=>{const c=createNativeDmlNestedCollectorV1({sql:'INSERT synthetic',protectedSources:{money:'',answer_guard:''}});
  const where=nestedFunctionContext+'x'.repeat(bytes-Buffer.byteLength(nestedFunctionContext));c.arm();c.notice(nestedNoticeWithContext(where));c.assertComplete('money');return{report:c.report,where};});
 const retained=reports[0]!,omitted=reports[1]!,a=retained.report.types[0]!,b=omitted.report.types[0]!;
 assert.equal(a.context,retained.where);assert.equal(a.context_omitted,false);assert.equal(a.context_bytes,8192);
 assert.equal(a.context_sha256,nativeDmlPlanShaV1(retained.where));assert.equal(retained.report.context_omissions.events,0);
 assert.equal(b.context,null);assert.equal(b.context_omitted,true);assert.equal(b.context_bytes,8193);
 assert.equal(b.context_sha256,nativeDmlPlanShaV1(omitted.where));assert.equal(omitted.report.context_omissions.events,1);
 assert.equal(omitted.report.context_omissions.bytes,8193);assert.equal(omitted.report.counts.dropped,0);
 assert.equal(a.sample_json,b.sample_json);assert.equal(a.sample_sha256,b.sample_sha256);
});
test('nested V2 derives declared attribution from complete transient context beyond8192 without retaining a prefix',()=>{
 const where='x'.repeat(8193)+nestedFunctionContext,c=createNativeDmlNestedCollectorV1({sql:'INSERT synthetic',protectedSources:{money:'',answer_guard:''}});
 c.arm();c.notice(nestedNoticeWithContext(where));c.assertComplete('money');const row=c.report.types[0]!;
 assert.equal(row.context,null);assert.equal(row.context_sha256,nativeDmlPlanShaV1(where));assert.deepEqual(row.attribution,['money']);
 assert.deepEqual(row.attribution_evidence,{basis:'context',context_functions:['money'],source_functions:[]});
 assert.equal(c.report.context_omissions.first?.context_sha256,row.context_sha256);
});
test('nested V2 distinguishes absent and present empty context without omission',()=>{
 const reports=[{message:nestedNotice().message},nestedNoticeWithContext('')].map(notice=>{
  const c=createNativeDmlNestedCollectorV1({sql:'INSERT synthetic',protectedSources:{money:nestedSql,answer_guard:''}});c.arm();c.notice(notice);c.assertComplete('money');return c.report;});
 assert.equal(reports[0]!.types[0]!.context_sha256,null);assert.equal(reports[0]!.types[0]!.context,null);
 assert.equal(reports[1]!.types[0]!.context_sha256,nativeDmlPlanShaV1(''));assert.equal(reports[1]!.types[0]!.context,'');
 assert.ok(reports.every(r=>r.context_omissions.events===0&&r.types[0]!.context_omitted===false));
});
test('nested V2 reports oversized context on later repetitions without replacing first sample',()=>{
 const c=createNativeDmlNestedCollectorV1({sql:'INSERT synthetic',protectedSources:{money:'',answer_guard:''}}),where='x'.repeat(8193)+nestedFunctionContext;
 c.arm();c.notice(nestedNotice());const sample=c.report.types[0]!.sample_json;c.notice(nestedNoticeWithContext(where));c.notice(nestedNoticeWithContext(where));c.assertComplete('money');
 assert.equal(c.report.types.length,1);assert.equal(c.report.types[0]!.sample_json,sample);assert.equal(c.report.types[0]!.context_omitted,false);
 assert.equal(c.report.types[0]!.events,3);assert.equal(c.report.context_omissions.events,2);assert.equal(c.report.context_omissions.bytes,2*Buffer.byteLength(where));
 assert.equal(c.report.context_omissions.max_bytes,Buffer.byteLength(where));assert.equal(c.report.context_omissions.first?.notice_ordinal,2);
 assert.equal(c.report.context_omissions.first?.query_raw_sha256,nativeDmlPlanShaV1(nestedSql));assert.equal(c.report.counts.dropped,0);
});
test('nested V2 shares512 type budget across captures, admits129 and rejects513 below byte caps',()=>{
 const budget={types:0,retained_bytes:0},make=()=>createNativeDmlNestedCollectorV1({sql:'INSERT synthetic',protectedSources:{money:'',answer_guard:''},budget});
 const first=make(),second=make();first.arm();second.arm();
 for(let i=0;i<256;i++)first.notice({message:nestedNotice('SELECT '+i).message});
 assert.equal(first.report.failed,false);assert.equal(first.report.types.length,256);
 for(let i=0;i<256;i++)second.notice({message:nestedNotice('SELECT '+i).message});
 assert.equal(budget.types,512);assert.equal(second.report.failed,false);assert.ok(budget.retained_bytes<NATIVE_DML_NESTED_LIMITS_V1.retained_bytes);
 second.notice({message:nestedNotice('SELECT 513').message});assert.equal(second.report.failed,true);assert.equal(second.report.drop_reasons.unique_types,1);
 assert.equal(budget.types,512);assert.equal(second.report.counts.valid_plans,256);assert.throws(()=>second.assertComplete());
});
test('nested V2 optional omission cannot bypass full1MiB event limit',()=>{
 const c=createNativeDmlNestedCollectorV1({sql:'INSERT synthetic',protectedSources:{money:'',answer_guard:''}});c.arm();
 c.notice(nestedNoticeWithContext('x'.repeat(NATIVE_DML_NESTED_LIMITS_V1.event_bytes)+nestedFunctionContext));
 assert.equal(c.report.failed,true);assert.equal(c.report.drop_reasons.event_bytes,1);assert.equal(c.report.context_omissions.events,0);
 assert.equal(c.report.types.length,0);assert.throws(()=>c.assertComplete());
});
test('nested V2 oversized optional context permits normal SQL once after restore and full snapshot',async()=>{
 const h=nestedClient('large_context'),recorder=createNativeDmlNestedRecorderV1({money:'',answer_guard:''}),observer=createNativeDmlPlanObserverV1();
 observer.arm('base',keys);let normals=0,snapshots=0;const args=await argumentsFor('insert');
 await observer.query({...args,client:h.client,snapshot:async()=>{snapshots++;return{raw:'same',counts:{calls:32}};},instrumentation:identity=>recorder.probe(h.client,identity),
  normal:async()=>{normals++;assert.equal(snapshots,2);assert.equal(h.client.listenerCount('notice'),0);assert.equal(recorder.probes[0]!.settings_restored,true);return{rows:[]};}});
 assert.equal(normals,1);assert.equal(recorder.probes[0]!.capture.counts.dropped,0);assert.equal(recorder.probes[0]!.capture.context_omissions.events,1);
 assert.equal(observer.observations[0]!.snapshot_equal,true);assert.equal(observer.observations[0]!.unknown_ack,false);
});
test('real Native owner retains UNKNOWN and forced discard after omitted context plus restore failure',()=>realOwnerWithLostAck('nested_context_restore'));

test('nested V2 keeps256KiB sample cap even when optional context would be omitted',()=>{
 const c=createNativeDmlNestedCollectorV1({sql:'INSERT synthetic',protectedSources:{money:'',answer_guard:''}});
 const sample=JSON.stringify({'Query Text':nestedSql,Plan:{'Node Type':'Result',padding:'x'.repeat(NATIVE_DML_NESTED_LIMITS_V1.sample_bytes)}});
 c.arm();c.notice({message:'duration: 1 ms  plan: '+sample,where:'x'.repeat(8193)+nestedFunctionContext});
 assert.equal(c.report.failed,true);assert.equal(c.report.drop_reasons.sample_bytes,1);assert.equal(c.report.types.length,0);
 assert.equal(c.report.context_omissions.events,0);
});
test('nested V2 keeps3MiB global sample budget below512 small types',()=>{
 const c=createNativeDmlNestedCollectorV1({sql:'INSERT synthetic',protectedSources:{money:'',answer_guard:''}});c.arm();
 for(let i=0;i<512&&!c.report.failed;i++)c.notice({message:'duration: 1 ms  plan: '+JSON.stringify({'Query Text':'SELECT '+i,Plan:{'Node Type':'Result',padding:'x'.repeat(10000)}})});
 assert.equal(c.report.failed,true);assert.equal(c.report.drop_reasons.retained_bytes,1);assert.ok(c.report.types.length<512);
 assert.ok(c.report.counts.retained_bytes<=NATIVE_DML_NESTED_LIMITS_V1.retained_bytes);assert.throws(()=>c.assertComplete());
});
test('nested V2 omitted ambiguous context stays unattributed and cannot satisfy the useful-plan gate',()=>{
 const c=createNativeDmlNestedCollectorV1({sql:'INSERT synthetic',protectedSources:{money:'',answer_guard:''}});c.arm();
 c.notice(nestedNoticeWithContext('x'.repeat(8193)+nestedFunctionContext+' PL/pgSQL function signal_listening_answer_guard_v1() line 1'));
 assert.equal(c.report.failed,false);assert.equal(c.report.types[0]!.context_omitted,true);
 assert.equal(c.report.types[0]!.attribution_evidence.basis,'ambiguous');assert.deepEqual(c.report.types[0]!.attribution,[]);
 assert.throws(()=>c.assertComplete('money'),/nested_target_not_attributable/u);
});

test('late Native emits safe exact SAVEPOINT, ROLLBACK and RELEASE identifiers without changing phase or plan filenames',async()=>{
 for(const operation of ['insert','mark','apply']as const){
  const h=harness(operation,undefined,'late-consumer'),args=await argumentsFor(operation);
  assert.equal(await h.run(args.sql,args.values),h.returned);
  const name='r16_native_dml_plan_late_consumer_'+operation;
  assert.deepEqual(h.commands.filter(sql=>/^(?:SAVEPOINT|ROLLBACK TO SAVEPOINT|RELEASE SAVEPOINT) /u.test(sql)),
   ['SAVEPOINT '+name,'ROLLBACK TO SAVEPOINT '+name,'RELEASE SAVEPOINT '+name]);
  assert.equal(h.normalCalls(),1);assert.equal(h.observer.observations[0]!.phase,'late-consumer');
  assert.equal(h.observer.observations[0]!.file,'plan-late-consumer-'+operation+'.json');
 }
});

// Independent model of the SQL root-page predicate: a root survives while any
// configured question is unsent. Two phases are represented by separate sets;
// base is preferred within the first4096 surviving root identities.
test('late growth preserves4096 pending roots by limiting the final consumer eviction to the unseen base tail',()=>{
 const simulate=(fixed:boolean)=>{
  const roots=Array.from({length:32768},(_,i)=>i),early=Array.from({length:752},(_,i)=>i*5);
  const base=new Set(early),consumer=new Set(early),calls=new Set(early.flatMap(id=>['base:'+id,'consumer:'+id]));
  const consumerBatches:number[]=[];let maxBatch=0,steps=0;
  while(base.size<roots.length||calls.size<60000){
   assert.ok(++steps<256);
   const frontier=roots.filter(id=>!consumer.has(id)).slice(0,4096),basePending=frontier.filter(id=>!base.has(id));
   const phase=basePending.length?'base':'consumer',candidates=basePending.length?basePending:frontier;
   const limit=fixed?nativeDmlLateGrowthLimitV1({remaining_base:roots.length-base.size,has_base_hints:basePending.length>0}):720;
   const selected=candidates.slice(0,limit);assert.ok(selected.length>0&&selected.length<=720);maxBatch=Math.max(maxBatch,selected.length);
   for(const id of selected){const key=phase+':'+id;assert.equal(calls.has(key),false,'no duplicate native call identity');
    if(phase==='base'){assert.equal(base.has(id),false);base.add(id);}
    else{assert.equal(base.has(id),true);assert.equal(consumer.has(id),false);consumer.add(id);}calls.add(key);}
   if(phase==='consumer')consumerBatches.push(selected.length);
   assert.equal(calls.size,base.size+consumer.size);
  }
  return{base:base.size,consumer:consumer.size,total:calls.size,pending:roots.filter(id=>!consumer.has(id)).length,maxBatch,lastConsumer:consumerBatches.at(-1)};
 };
 const before=simulate(false),after=simulate(true);
 assert.deepEqual(before,{base:32768,consumer:28832,total:61600,pending:3936,maxBatch:720,lastConsumer:720});
 assert.ok(before.pending<4096,'the old fill loop cannot satisfy the real Survey4096 argument contract');
 assert.deepEqual(after,{base:32768,consumer:28672,total:61440,pending:4096,maxBatch:720,lastConsumer:560});
 assert.equal(nativeDmlLateGrowthLimitV1({remaining_base:0,has_base_hints:false}),720,'all-base branch must not produce a zero-call loop');
});
