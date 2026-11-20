import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {LabelingAdmissionFailureV1} from '../signal-labeling-runs';
import {NATIVE_LISTENING_ADMISSION_INSERT_SQL_V1,NATIVE_LISTENING_ADMISSION_MARK_SQL_V1} from '../signal-listening-native-admission';

export const NATIVE_DML_PLAN_TITLE_V1='native Listening32768 INSERT MARK APPLY plans preserve real guards in base and consumer cohorts';
export const NATIVE_DML_PLAN_BATCH_V1=720;
export const NATIVE_DML_PLAN_MAX_BYTES_V1=4*1024*1024;
export const NATIVE_DML_PLAN_APPLY_SHA_V1='7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7';
export type NativeDmlPlanPhaseV1='base'|'consumer';
export type NativeDmlPlanOperationV1='insert'|'mark'|'apply';
export type NativeDmlPlanClientV1={query(sql:string,values?:unknown[]):Promise<{rows:Record<string,unknown>[]}>};
export type NativeDmlPlanSnapshotV1={raw:string;counts:Record<string,number>};
export type NativeDmlPlanClientStateV1={unknown_ack:boolean;owner_rollback_sent:boolean;owner_rollback_ack:boolean;
 owner_commit_ack_unknown:boolean;released:boolean;forced_discard:boolean};
type ProbeQueryResultV1={rows:Record<string,unknown>[];rowCount?:number|null};
export function nativeDmlPlanOwnerOutcomeV1(error:unknown):'unknown'|'rolled_back'|null{
 const seen=new Set<object>();let visits=0;
 const visit=(value:unknown):'unknown'|'rolled_back'|null=>{
  if(!value||typeof value!=='object'||seen.has(value)||++visits>32)return null;seen.add(value);
  if(value instanceof LabelingAdmissionFailureV1)return value.outcome;
  const candidates:unknown[]=[];
  const cause=Object.getOwnPropertyDescriptor(value,'cause');if(cause&&'value'in cause)candidates.push(cause.value);
  if(value instanceof AggregateError){const errors=Object.getOwnPropertyDescriptor(value,'errors');
   if(errors&&'value'in errors&&Array.isArray(errors.value))candidates.push(...errors.value.slice(0,32));}
  let result:'rolled_back'|null=null;
  for(const candidate of candidates){const outcome=visit(candidate);if(outcome==='unknown')return'unknown';if(outcome==='rolled_back')result=outcome;}
  return result;
 };return visit(error);
}
/** The actual native owner must not convert an uncertain probe into a known
 * rollback and release(false). Only this diagnostic client is quarantined. */
export function createNativeDmlPlanClientGuardV1(client:PoolClient,intercept:(args:{sql:string;values?:unknown[];
 normal:()=>Promise<ProbeQueryResultV1>;markUnknown:(primary:unknown)=>void})=>Promise<ProbeQueryResultV1>){
 const state:NativeDmlPlanClientStateV1={unknown_ack:false,owner_rollback_sent:false,owner_rollback_ack:false,
  owner_commit_ack_unknown:false,released:false,forced_discard:false};
 let firstUnknown:unknown;
 const markUnknown=(primary:unknown)=>{if(!state.unknown_ack){state.unknown_ack=true;firstUnknown=primary;}};
 const uncertain=()=>new Error('native_dml_plan_client_ack_unknown',{cause:firstUnknown});
 const decorated=new Proxy(client,{get(target,key){
  if(key==='query')return async(sql:string,values?:unknown[])=>{
   if(state.unknown_ack){
    if(sql==='ROLLBACK'&&!state.owner_rollback_sent){
     state.owner_rollback_sent=true;
     try{await target.query(sql,values);state.owner_rollback_ack=true;}catch{/* Remains UNKNOWN; never retry. */}
    }
    // Even a later global ACK cannot downgrade an already uncertain probe.
    // Throwing here keeps the real owner's rollbackAck=false/discard=true.
    throw uncertain();
   }
   try{return await intercept({sql,values,normal:()=>target.query(sql,values),markUnknown});}
   catch(primary){if(sql==='COMMIT'){state.owner_commit_ack_unknown=true;markUnknown(primary);}
    else if(sql==='BEGIN')markUnknown(primary);throw primary;}
  };
  if(key==='release')return(error?:Error|boolean)=>{state.released=true;state.forced_discard=state.unknown_ack||Boolean(error);
   target.release(state.unknown_ack?true:error);};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 return{client:decorated,state,markUnknown};
}
export const nativeDmlPlanShaV1=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export const nativeDmlPlanNormalizedShaV1=(sql:string)=>nativeDmlPlanShaV1(sql.replace(/\s+/gu,' ').trim());
export type NativeDmlPlanObservationV1={
 phase:NativeDmlPlanPhaseV1;operation:NativeDmlPlanOperationV1;calls:720;answers:number|null;
 query_raw_sha256:string;query_normalized_sha256:string;file:string;
 plan_bytes:number|null;plan_sha256:string|null;plan:unknown|null;
 snapshot_before_sha256:string|null;snapshot_after_sha256:string|null;snapshot_counts:Record<string,number>|null;
 savepoint_ack:boolean;rollback_sent:boolean;rollback_ack:boolean;release_ack:boolean;snapshot_equal:boolean;
 normal_original_sent:boolean;normal_original_succeeded:boolean;unknown_ack:boolean;
 apply_roster_sha256:string|null;
};
function object(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function array(value:unknown):unknown[]{assert.ok(Array.isArray(value),'native_dml_plan_array_required');return value;}
function queryOperation(sql:string):NativeDmlPlanOperationV1|null{
 if(sql===NATIVE_LISTENING_ADMISSION_INSERT_SQL_V1)return'insert';
 if(sql===NATIVE_LISTENING_ADMISSION_MARK_SQL_V1)return'mark';
 if(nativeDmlPlanNormalizedShaV1(sql)===NATIVE_DML_PLAN_APPLY_SHA_V1)return'apply';
 assert.ok(!sql.includes('labeling_native_covered_insert_v1')&&!sql.includes('labeling_native_covered_mark_v1')
  &&!/^\s*INSERT INTO signal_listening_answers\b/u.test(sql),'native_dml_plan_original_SQL_changed');
 return null;
}
function assertPacket(values:unknown[],operation:NativeDmlPlanOperationV1,keys:readonly string[],expectedApplyIds:readonly string[]|null){
 if(operation==='apply'){
  assert.equal(typeof values[3],'string');const rows:unknown[]=array(JSON.parse(values[3] as string));
  assert.equal(rows.length,NATIVE_DML_PLAN_BATCH_V1*2,'native_dml_plan_answer_count');
  const calls=new Map<string,Set<string>>();
  for(const row of rows){assert.ok(object(row)&&typeof row.call_id==='string'&&typeof row.question_key==='string');
   const set=calls.get(row.call_id)??new Set<string>();assert.ok(!set.has(row.question_key));set.add(row.question_key);calls.set(row.call_id,set);}
  assert.equal(calls.size,NATIVE_DML_PLAN_BATCH_V1);
  for(const set of calls.values())assert.deepEqual([...set].sort(),[...keys].sort());
  assert.ok(expectedApplyIds,'native_dml_plan_actual_admission_roster_missing');
  assert.deepEqual([...calls.keys()].sort(),[...expectedApplyIds].sort(),'native_dml_plan_actual_admission_roster_changed');
  return;
 }
 const index=operation==='insert'?5:3;assert.equal(typeof values[index],'string');
 const packet:unknown=JSON.parse(values[index] as string);assert.ok(object(packet));
 const rows=array(packet.rows);assert.equal(rows.length,NATIVE_DML_PLAN_BATCH_V1);
 const roots=new Set<string>(),customIds=new Set<string>();
 for(const row of rows){assert.ok(object(row)&&typeof row.custom_id==='string');customIds.add(row.custom_id);
  const inputs=array(row.inputs);assert.equal(inputs.length,1);const input=inputs[0];assert.ok(object(input)&&typeof input.root_id==='string');roots.add(input.root_id);
  assert.deepEqual(array(row.question_keys).slice().sort(),[...keys].sort());}
 assert.equal(customIds.size,NATIVE_DML_PLAN_BATCH_V1);assert.equal(roots.size,NATIVE_DML_PLAN_BATCH_V1);
 if(operation==='mark'){const ids=array(values[2]);assert.equal(ids.length,NATIVE_DML_PLAN_BATCH_V1);assert.equal(new Set(ids).size,ids.length);}
}
/** This is a test-only observation of the real DML, including triggers. It
 * executes once in a savepoint, verifies rollback, then runs the original
 * command normally. It must never be installed in a capacity measurement. */
export function createNativeDmlPlanObserverV1(){
 const observations:NativeDmlPlanObservationV1[]=[];
 let phase:NativeDmlPlanPhaseV1|null=null,keys:readonly string[]=[],expectedApplyIds:readonly string[]|null=null;
 const seen=new Set<string>();
 return{
  observations,
  arm(next:NativeDmlPlanPhaseV1,questionKeys:readonly string[]){
   assert.equal(phase,null,'native_dml_plan_previous_phase_not_closed');assert.equal(questionKeys.length,2);
   assert.equal(new Set(questionKeys).size,2);phase=next;keys=[...questionKeys];expectedApplyIds=null;
  },
  bindApplyRoster(ids:readonly string[]){
   assert.ok(phase);assert.equal(expectedApplyIds,null);assert.equal(ids.length,720);assert.equal(new Set(ids).size,720);
   assert.ok(ids.every(id=>typeof id==='string'&&id.length>0));expectedApplyIds=[...ids];
  },
  finishPhase(){
   assert.ok(phase);for(const operation of ['insert','mark','apply'])assert.ok(seen.has(phase+':'+operation));phase=null;keys=[];expectedApplyIds=null;
  },
  async query<T>(args:{client:NativeDmlPlanClientV1;sql:string;values?:unknown[];
   snapshot:()=>Promise<NativeDmlPlanSnapshotV1>;normal:()=>Promise<T>;beforeProbe?:(operation:NativeDmlPlanOperationV1)=>Promise<void>;
   onUnknown?:(primary:unknown)=>void;instrumentation?:(identity:NativeDmlProbeIdentityV1)=>NativeDmlProbeInstrumentationV1}):Promise<T>{
   if(!phase)return args.normal();
   const operation=queryOperation(args.sql);if(!operation)return args.normal();
   const identity=phase+':'+operation;assert.ok(!seen.has(identity),'native_dml_plan_duplicate_observation');seen.add(identity);
   const values=args.values??[];assertPacket(values,operation,keys,expectedApplyIds);
   const row:NativeDmlPlanObservationV1={phase,operation,calls:720,answers:operation==='apply'?1440:null,
    query_raw_sha256:nativeDmlPlanShaV1(args.sql),query_normalized_sha256:nativeDmlPlanNormalizedShaV1(args.sql),file:'plan-'+phase+'-'+operation+'.json',
    plan_bytes:null,plan_sha256:null,plan:null,snapshot_before_sha256:null,snapshot_after_sha256:null,snapshot_counts:null,
    savepoint_ack:false,rollback_sent:false,rollback_ack:false,release_ack:false,snapshot_equal:false,normal_original_sent:false,normal_original_succeeded:false,unknown_ack:false,
    apply_roster_sha256:operation==='apply'?nativeDmlPlanShaV1(JSON.stringify([...expectedApplyIds!].sort())):null};
   observations.push(row);await args.beforeProbe?.(operation);
   const instrumentation=args.instrumentation?.({phase,operation,sql:args.sql});let restorationAttempted=false;
   const before=await args.snapshot();row.snapshot_before_sha256=nativeDmlPlanShaV1(before.raw);row.snapshot_counts=before.counts;
   const name='r16_native_dml_plan_'+phase+'_'+operation;
   try{
    await instrumentation?.beforeSavepoint();
    await args.client.query('SAVEPOINT '+name);row.savepoint_ack=true;await instrumentation?.afterSavepoint();
    const result=await(async()=>{instrumentation?.explainStarted();
     try{return await args.client.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+args.sql,values);}
     finally{instrumentation?.explainFinished();}})();
    assert.equal(result.rows.length,1);const plan=result.rows[0]?.['QUERY PLAN'];
    assert.ok(Array.isArray(plan)&&plan.length===1&&object(plan[0]),'native_dml_plan_JSON_missing');
    const bytes=JSON.stringify(plan);assert.ok(Buffer.byteLength(bytes)<=NATIVE_DML_PLAN_MAX_BYTES_V1,'native_dml_plan_bytes_exceeded');
    const target=operation==='apply'?'signal_listening_answers':'signal_labeling_calls',opcode=operation==='mark'?'Update':'Insert';
    let matched=false,nodes=0;
    const walk=(value:unknown,depth=0)=>{
     assert.ok(depth<=128&&++nodes<=16384,'native_dml_plan_graph_exceeded');
     if(Array.isArray(value)){for(const child of value)walk(child,depth+1);}
     else if(object(value)){if(value['Node Type']==='ModifyTable'&&value.Operation===opcode&&value['Relation Name']===target)matched=true;
      for(const child of Object.values(value))if(child&&typeof child==='object')walk(child,depth+1);}
    };walk(plan);
    assert.ok(matched,'native_dml_plan_real_ModifyTable_missing');
    const trigger=operation==='apply'?'signal_listening_answer_guard':'listening_statement_money_'+(operation==='mark'?'update':'insert');
    const triggers=array(plan[0].Triggers);assert.ok(triggers.some(t=>object(t)&&t['Trigger Name']===trigger
     &&typeof t.Calls==='number'&&t.Calls===(operation==='apply'?1440:1)),'native_dml_plan_real_trigger_missing');
    row.plan=plan;row.plan_bytes=Buffer.byteLength(bytes);row.plan_sha256=nativeDmlPlanShaV1(bytes);
    row.rollback_sent=true;await args.client.query('ROLLBACK TO SAVEPOINT '+name);row.rollback_ack=true;
    await args.client.query('RELEASE SAVEPOINT '+name);row.release_ack=true;
    restorationAttempted=true;await instrumentation?.afterRestore();instrumentation?.assertCapture();
    const after=await args.snapshot();row.snapshot_after_sha256=nativeDmlPlanShaV1(after.raw);
    assert.equal(before.raw===after.raw,true,'native_dml_plan_business_snapshot_changed');row.snapshot_equal=true;
   }catch(primary){
    // Do not retry an unacknowledged savepoint/rollback/release. The owning
    // native transaction still handles its own rollback/discard semantics.
    if(!row.savepoint_ack||row.rollback_sent&&!row.rollback_ack||row.rollback_ack&&!row.release_ack)row.unknown_ack=true;
    else if(!row.rollback_sent){
     row.rollback_sent=true;
     try{await args.client.query('ROLLBACK TO SAVEPOINT '+name);row.rollback_ack=true;
      await args.client.query('RELEASE SAVEPOINT '+name);row.release_ack=true;}
     catch{row.unknown_ack=true;}
    }
    if(instrumentation){
     if(row.rollback_ack&&row.release_ack&&!restorationAttempted){restorationAttempted=true;
      try{await instrumentation.afterRestore();}catch(restoreError){primary=new AggregateError([primary,restoreError],'nested_restore_failed',{cause:primary});}}
     if(instrumentation.uncertainty)row.unknown_ack=true;
    }
    if(row.unknown_ack)args.onUnknown?.(primary);throw primary;
   }finally{instrumentation?.finish();}
   row.normal_original_sent=true;const result=await args.normal();row.normal_original_succeeded=true;return result;
  },
 };
}

/** Diagnostic-only auto_explain. Raw JSON samples are hashed without numeric reserialization. */
export const NATIVE_DML_NESTED_FILE_V1='native-dml-nested-plans.json';
export const NATIVE_DML_NESTED_LIMITS_V1={event_bytes:1048576,sample_bytes:262144,retained_bytes:3145728,file_bytes:4194304,
 unique_types:128,context_bytes:8192,depth:128,nodes:16384,preflight_sample_bytes:16384}as const;
export const NATIVE_DML_NESTED_PREFLIGHT_SQL_V1='SELECT 1 /* r16_auto_explain_preflight */';
export const NATIVE_DML_NESTED_SETTING_KEYS_V1=['auto_explain.log_min_duration','auto_explain.log_nested_statements',
 'auto_explain.log_format','auto_explain.log_level','auto_explain.log_analyze','auto_explain.log_buffers',
 'auto_explain.log_timing','auto_explain.log_parameter_max_length','auto_explain.sample_rate','client_min_messages']as const;
type NestedLimitsV1={-readonly[K in keyof typeof NATIVE_DML_NESTED_LIMITS_V1]:number};
type NestedAttributionV1='money'|'answer_guard';
export type NativeDmlNestedClientV1=NativeDmlPlanClientV1&{
 on(event:'notice',listener:(message:unknown)=>void):unknown;
 removeListener(event:'notice',listener:(message:unknown)=>void):unknown;
 listenerCount(event:'notice'):number;
};
export type NativeDmlProbeIdentityV1={phase:NativeDmlPlanPhaseV1|'preflight';operation:NativeDmlPlanOperationV1|'select';sql:string};
export type NativeDmlProbeInstrumentationV1={beforeSavepoint():Promise<void>;afterSavepoint():Promise<void>;
 explainStarted():void;explainFinished():void;afterRestore():Promise<void>;finish():void;assertCapture():void;
 uncertainty:boolean};
type NestedSampleV1={query_raw_sha256:string;query_normalized_sha256:string;query_text:string;is_outer:boolean;
 attribution:NestedAttributionV1[];sample_json:string;sample_sha256:string;sample_bytes:number;sample_retained_bytes:number;
 sample_ordinal:number;context:string|null;events:number;duration_inclusive_ms:{count:number;min:number;max:number;sum:number}};
type NestedCaptureV1={query_raw_sha256:string;query_normalized_sha256:string;explain_normalized_sha256:string;failed:boolean;
 counts:{notices:number;notice_bytes:number;valid_plans:number;non_plan_notices:number;parse_failures:number;handler_exceptions:number;
  dropped:number;out_of_window:number;retained_bytes:number};drop_reasons:Record<string,number>;internal_events:number;
 attribution_events:{money:number;answer_guard:number};types:NestedSampleV1[]};
export type NativeDmlNestedProbeV1={phase:NativeDmlProbeIdentityV1['phase'];operation:NativeDmlProbeIdentityV1['operation'];
 session_id:string|null;backend_pid:number|null;load_ack:boolean;settings_before:Record<string,string>|null;settings_after:Record<string,string>|null;
 settings_restored:boolean;listener_before:number|null;listener_after:number|null;listener_detached:boolean;capture:NestedCaptureV1;
 outer?:{calls:720;answers:number|null;query_raw_sha256:string;query_normalized_sha256:string;plan_sha256:string|null;apply_roster_sha256:string|null};
 close_ack?:boolean};
export function createNativeDmlNestedCollectorV1(args:{sql:string;protectedSources:Record<NestedAttributionV1,string>;
 limits?:NestedLimitsV1;budget?:{types:number;retained_bytes:number};preflight?:boolean}){
 const limits=args.limits??NATIVE_DML_NESTED_LIMITS_V1,budget=args.budget??{types:0,retained_bytes:0};
 const report:NestedCaptureV1={query_raw_sha256:nativeDmlPlanShaV1(args.sql),query_normalized_sha256:nativeDmlPlanNormalizedShaV1(args.sql),
  explain_normalized_sha256:nativeDmlPlanNormalizedShaV1('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+args.sql),failed:false,
  counts:{notices:0,notice_bytes:0,valid_plans:0,non_plan_notices:0,parse_failures:0,handler_exceptions:0,dropped:0,out_of_window:0,retained_bytes:0},
  drop_reasons:{},internal_events:0,attribution_events:{money:0,answer_guard:0},types:[]};
 const types=new Map<string,NestedSampleV1>();let active=false;
 const increment=(n:number,by=1)=>{assert.ok(Number.isSafeInteger(n)&&Number.isSafeInteger(by)&&by>=0&&n<=Number.MAX_SAFE_INTEGER-by,'nested_counter_overflow');return n+by;};
 const reject=(reason:string)=>{report.failed=true;report.counts.dropped=increment(report.counts.dropped);
  report.drop_reasons[reason]=increment(report.drop_reasons[reason]??0);};
 const normalize=(sql:string)=>sql.replace(/\s+/gu,' ').trim();
 const sources={money:normalize(args.protectedSources.money),answer_guard:normalize(args.protectedSources.answer_guard)};
 const notice=(unknownNotice:unknown)=>{
  // Nothing, including hostile getters or parser failures, may escape an EventEmitter callback.
  let classified=false;
  try{
   report.counts.notices=increment(report.counts.notices);
   assert.ok(object(unknownNotice)&&typeof unknownNotice.message==='string','nested_notice_shape');
   const message=unknownNotice.message,context=typeof unknownNotice.where==='string'?unknownNotice.where:null;
   const contextBytes=context===null?0:Buffer.byteLength(context),bytes=Buffer.byteLength(message)+contextBytes;
   report.counts.notice_bytes=increment(report.counts.notice_bytes,bytes);
   if(bytes>limits.event_bytes){reject('event_bytes');classified=true;return;}
   if(contextBytes>limits.context_bytes){reject('context_bytes');classified=true;return;}
   const match=/^duration: ([0-9]+(?:\.[0-9]+)?) ms\s+plan:\s*([\s\S]+)$/u.exec(message);
   if(!match){
    if(/^duration:/u.test(message)){report.counts.parse_failures=increment(report.counts.parse_failures);reject('prefix');}
    else report.counts.non_plan_notices=increment(report.counts.non_plan_notices);
    classified=true;return;
   }
   if(!active){report.counts.out_of_window=increment(report.counts.out_of_window);reject('out_of_window');classified=true;return;}
   const duration=Number(match[1]);assert.ok(Number.isFinite(duration)&&duration>=0,'nested_duration');
   const sample_json=match[2]!.trim();let parsed:unknown;
   try{parsed=JSON.parse(sample_json);}catch{report.counts.parse_failures=increment(report.counts.parse_failures);reject('json');classified=true;return;}
   let nodes=0,graphFailure:string|null=null;const walk=(value:unknown,depth=0)=>{
    if(graphFailure)return;if(depth>limits.depth||++nodes>limits.nodes){graphFailure='graph_cap';return;}
    if(Array.isArray(value)){for(const child of value)walk(child,depth+1);}
    else if(object(value)){if(Object.hasOwn(value,'Query Parameters')){graphFailure='parameters';return;}
     for(const child of Object.values(value))if(child&&typeof child==='object')walk(child,depth+1);}};walk(parsed);
   if(graphFailure){reject(graphFailure);classified=true;return;}
   const entry=Array.isArray(parsed)?parsed.length===1?parsed[0]:null:parsed;
   if(!object(entry)||typeof entry['Query Text']!=='string'||!object(entry.Plan)){
    report.counts.parse_failures=increment(report.counts.parse_failures);reject('plan_shape');classified=true;return;}
   const sql=entry['Query Text'],raw=nativeDmlPlanShaV1(sql),normalized=nativeDmlPlanNormalizedShaV1(sql),key=raw+':'+normalized;
   const is_outer=normalized===report.query_normalized_sha256||normalized===report.explain_normalized_sha256||/^\s*EXPLAIN\b/iu.test(sql);
   let type=types.get(key);
   if(!type){
    const attribution:NestedAttributionV1[]=[],contextTargets:NestedAttributionV1[]=[],sourceTargets:NestedAttributionV1[]=[];
    if(!is_outer)for(const target of ['money','answer_guard']as const){
     const functionName=target==='money'?'signal_listening_statement_money_v1':'signal_listening_answer_guard_v1';
     if(context!==null&&new RegExp('PL/pgSQL function (?:public\\.)?'+functionName+'\\(').test(context))contextTargets.push(target);
     if(sources[target].length>0&&sources[target].includes(normalize(sql)))sourceTargets.push(target);
    }
    const targets=contextTargets.length>0?contextTargets:sourceTargets;if(targets.length===1)attribution.push(targets[0]!);
    const sample_retained_bytes=Buffer.byteLength(JSON.stringify({query_text:sql,sample_json,context}));
    const sampleCap=args.preflight?limits.preflight_sample_bytes:limits.sample_bytes;
    if(sample_retained_bytes>sampleCap){reject('sample_bytes');classified=true;return;}
    if(!args.preflight&&budget.types>=limits.unique_types){reject('unique_types');classified=true;return;}
    if(budget.retained_bytes+sample_retained_bytes>limits.retained_bytes){reject('retained_bytes');classified=true;return;}
    type={query_raw_sha256:raw,query_normalized_sha256:normalized,query_text:sql,is_outer,attribution,sample_json,
     sample_sha256:nativeDmlPlanShaV1(sample_json),sample_bytes:Buffer.byteLength(sample_json),sample_retained_bytes,
     sample_ordinal:report.counts.notices,context,events:0,duration_inclusive_ms:{count:0,min:duration,max:duration,sum:0}};
    types.set(key,type);report.types.push(type);if(!args.preflight)budget.types++;
    budget.retained_bytes+=sample_retained_bytes;report.counts.retained_bytes+=sample_retained_bytes;
   }
   const sum=type.duration_inclusive_ms.sum+duration;assert.ok(Number.isFinite(sum),'nested_duration_overflow');
   type.events=increment(type.events);type.duration_inclusive_ms={count:type.events,min:Math.min(type.duration_inclusive_ms.min,duration),
    max:Math.max(type.duration_inclusive_ms.max,duration),sum};
   report.counts.valid_plans=increment(report.counts.valid_plans);if(!is_outer)report.internal_events=increment(report.internal_events);
   for(const target of type.attribution)report.attribution_events[target]=increment(report.attribution_events[target]);classified=true;
  }catch{
   // Keep a bounded fixed reason even after a getter, graph-cap or counter failure.
   report.failed=true;if(report.counts.handler_exceptions<Number.MAX_SAFE_INTEGER)report.counts.handler_exceptions++;
   if(!classified&&report.counts.dropped<Number.MAX_SAFE_INTEGER)report.counts.dropped++;
   report.drop_reasons.handler=Math.min(Number.MAX_SAFE_INTEGER,(report.drop_reasons.handler??0)+1);
  }
 };
 return{report,notice,arm(){assert.equal(active,false);active=true;},disarm(){active=false;},
  assertComplete(required?:NestedAttributionV1){assert.equal(report.failed,false,'nested_capture_incomplete');
   assert.ok(report.counts.valid_plans>0,'nested_no_plan_notice');
   if(required){assert.ok(report.internal_events>0,'nested_no_internal_plan');assert.ok(report.attribution_events[required]>0,'nested_target_not_attributable');}
   if(args.preflight){assert.equal(report.types.length,1);assert.equal(report.types[0]!.query_text,args.sql);assert.equal(report.types[0]!.events,1);}
  }};
}
const nestedSettingsSqlV1="/* r16_nested_settings */ SELECT pg_backend_pid()::int AS backend_pid,current_setting('server_version_num')::int AS server_version_num,jsonb_build_object("+
 NATIVE_DML_NESTED_SETTING_KEYS_V1.map(key=>"'"+key+"',current_setting('"+key+"',true)").join(',')+') AS settings';
const nestedEnableSqlV1="SET LOCAL auto_explain.log_nested_statements=on; SET LOCAL auto_explain.log_format=json; "+
 "SET LOCAL auto_explain.log_level=NOTICE; SET LOCAL auto_explain.log_analyze=on; SET LOCAL auto_explain.log_buffers=on; "+
 "SET LOCAL auto_explain.log_timing=off; SET LOCAL auto_explain.log_parameter_max_length=0; SET LOCAL auto_explain.sample_rate=1; "+
 "SET LOCAL client_min_messages=NOTICE; SET LOCAL auto_explain.log_min_duration=0";
export function createNativeDmlNestedRecorderV1(protectedSources:Record<NestedAttributionV1,string>){
 const sessions=new WeakMap<object,{id:string;pid:number}>(),budget={types:0,retained_bytes:0};let sequence=0;
 const probes:NativeDmlNestedProbeV1[]=[];let preflight:NativeDmlNestedProbeV1|null=null;
 return{probes,get preflight(){return preflight;},
  probe(client:NativeDmlNestedClientV1,identity:NativeDmlProbeIdentityV1):NativeDmlProbeInstrumentationV1{
   const isPreflight=identity.phase==='preflight';
   const capture=createNativeDmlNestedCollectorV1({sql:identity.sql,protectedSources,budget,preflight:isPreflight});
   const row:NativeDmlNestedProbeV1={phase:identity.phase,operation:identity.operation,session_id:null,backend_pid:null,load_ack:false,
    settings_before:null,settings_after:null,settings_restored:false,listener_before:null,listener_after:null,listener_detached:false,capture:capture.report};
   if(isPreflight){assert.equal(preflight,null);row.close_ack=false;preflight=row;}else probes.push(row);
   let attached=false;
   const readSettings=async()=>{const result=await client.query(nestedSettingsSqlV1);assert.equal(result.rows.length,1);
    const r=result.rows[0]!;assert.ok(typeof r.server_version_num==='number'&&r.server_version_num>=170000&&r.server_version_num<180000,'nested_requires_pg17');
    assert.ok(Number.isSafeInteger(r.backend_pid)&&Number(r.backend_pid)>0&&object(r.settings));
    assert.deepEqual(Object.keys(r.settings).sort(),[...NATIVE_DML_NESTED_SETTING_KEYS_V1].sort());
    for(const value of Object.values(r.settings))assert.equal(typeof value,'string');
    return{pid:Number(r.backend_pid),settings:r.settings as Record<string,string>};};
   const lifecycle:NativeDmlProbeInstrumentationV1={uncertainty:false,
    async beforeSavepoint(){
     try{
      if(!sessions.has(client)){await client.query("LOAD 'auto_explain'");const before=await readSettings();
       assert.equal(before.settings['auto_explain.log_min_duration'],'-1','nested_inherited_instrumentation');
       assert.equal(before.settings['auto_explain.log_analyze'],'off','nested_inherited_analyze');
       sessions.set(client,{id:'nested_session_'+(++sequence),pid:before.pid});}
      row.load_ack=true;const session=sessions.get(client)!;row.session_id=session.id;row.backend_pid=session.pid;
      const before=await readSettings();assert.equal(before.pid,session.pid);row.settings_before=before.settings;
      assert.equal(before.settings['auto_explain.log_min_duration'],'-1');assert.equal(before.settings['auto_explain.log_analyze'],'off');
      row.listener_before=client.listenerCount('notice');
     }catch(error){lifecycle.uncertainty=true;throw error;}
    },
    async afterSavepoint(){try{await client.query(nestedEnableSqlV1);client.on('notice',capture.notice);attached=true;}
     catch(error){lifecycle.uncertainty=true;throw error;}},
    explainStarted(){capture.arm();},explainFinished(){capture.disarm();},
    async afterRestore(){
     try{const after=await readSettings();row.settings_after=after.settings;assert.equal(after.pid,row.backend_pid);
      assert.deepEqual(row.settings_after,row.settings_before,'nested_settings_not_restored');row.settings_restored=true;}
     catch(error){lifecycle.uncertainty=true;throw error;}
     finally{lifecycle.finish();}
    },
    finish(){capture.disarm();if(attached){client.removeListener('notice',capture.notice);attached=false;}
     row.listener_after=client.listenerCount('notice');row.listener_detached=!attached;
     if(row.listener_before!==null&&row.listener_after!==row.listener_before)lifecycle.uncertainty=true;},
    assertCapture(){assert.equal(row.settings_restored,true,'nested_restore_unproven');assert.equal(row.listener_detached,true);
     assert.equal(row.listener_after,row.listener_before,'nested_listener_count_changed');
     capture.assertComplete(isPreflight?undefined:identity.operation==='apply'?'answer_guard':'money');},
   };return lifecycle;
  },
 };
}
