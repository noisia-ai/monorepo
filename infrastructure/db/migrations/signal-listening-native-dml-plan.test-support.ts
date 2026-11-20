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
   onUnknown?:(primary:unknown)=>void}):Promise<T>{
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
   const before=await args.snapshot();row.snapshot_before_sha256=nativeDmlPlanShaV1(before.raw);row.snapshot_counts=before.counts;
   const name='r16_native_dml_plan_'+phase+'_'+operation;
   try{
    await args.client.query('SAVEPOINT '+name);row.savepoint_ack=true;
    const result=await args.client.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+args.sql,values);
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
    if(row.unknown_ack)args.onUnknown?.(primary);throw primary;
   }
   row.normal_original_sent=true;const result=await args.normal();row.normal_original_succeeded=true;return result;
  },
 };
}
