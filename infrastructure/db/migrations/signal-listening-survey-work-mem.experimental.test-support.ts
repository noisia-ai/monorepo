// Diagnostic only: identical Q8 Survey SQL under one bounded transaction-local work_mem arm.
// No provider, product setting, SQL replacement, function proconfig change, or capacity claim.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import type {PoolClient} from 'pg';
import type {SignalListeningInputV1} from '@noisia/query-engine';
import {hydrateListeningInputProjectionV1,type ListeningInputProjectionRowV1} from '../signal-listening-input-projection';
import {projectionHelperPartsV1,projectionShaV1,projectionSurveyMetadataBeforeLinearV1,
 sanitizeProjectionLinearPlanV1,assertProjectionSurveyLinearPlanV1,type ProjectionPlanV1} from './signal-listening-projection-linear-joins.oracle';

const PRODUCT_SHA='97a7d61e77268524ba1f9d1557f54ffa0ba2dc9b154ab256ac683b81aa86a469';
const SQL_SHA='739613a2fceb44f3c00aa9b8b114efe3fd81a6bd76975841cc725773a2419e24';
const SOURCE1DD_SQL_SHA='275ecac70aae04661a936a7c152c59a530ddb831ac1fb3ace81197d005f64758';
const CANDIDATE_BYTES=32*1024*1024;
const SAVEPOINT='r16_survey_work_mem_probe';
type Arm='baseline'|'work_mem_32MiB';
type Metadata=ListeningInputProjectionRowV1&{state_json_bytes:string|null};
type Identity={isolation:string;readonly:string;pid:number;snapshot:string;server_version_num:string;work_mem:string;work_mem_bytes:string;hash_mem_multiplier:string};
type Args={sql:string;params:unknown[];actual:Metadata[];
 scope:{workspace_id:string;map_id:string;configuration_digest:string};expectedInputs:SignalListeningInputV1[];
 markConnectionUncertain:()=>void};
type ProbeRecord={arm:Arm;work_mem_before:string;work_mem_during:string;work_mem_after:string;
 work_mem_bytes_before:string;work_mem_bytes_during:string;work_mem_bytes_after:string;hash_mem_multiplier:string;
 savepoint_ack:boolean;rollback_to_ack:boolean;release_ack:boolean;settings_restored:boolean;snapshot_preserved:boolean;
 query_wall_ms:number;arm_wall_ms:number};
const identitySql="SELECT current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') readonly,pg_backend_pid() pid,pg_current_snapshot()::text snapshot,current_setting('server_version_num') server_version_num,current_setting('work_mem') work_mem,pg_size_bytes(current_setting('work_mem'))::text work_mem_bytes,current_setting('hash_mem_multiplier') hash_mem_multiplier";

export async function runSurveyWorkMemExperimentV1(c:PoolClient,args:Args){
 assert.equal(args.params.length,9);assert.ok(Array.isArray(args.params[7])&&args.params[7].length===4096);
 assert.equal(args.actual.length,4096);assert.equal(args.expectedInputs.length,4096);
 const roots=args.params[7];assert.ok(Array.isArray(roots)&&roots.every(root=>typeof root==='string'));
 assert.deepEqual(roots,[...new Set(roots)].sort());assert.deepEqual(args.actual.map(row=>row.root_id),roots);
 assert.deepEqual(args.expectedInputs.map(input=>input.root_id),roots);
 assert.ok(args.actual.every(row=>row.projection!==null&&row.projection.question_keys.length===2),'the measured domain is4096 roots with two questions');
 const source=await readFile(new URL('../signal-listening-runs.ts',import.meta.url),'utf8');
 assert.equal(projectionShaV1(source),PRODUCT_SHA,'diagnostic accepts only unchanged Q8 product source');
 const sql=projectionHelperPartsV1(source,'survey').sql;
 assert.equal(projectionShaV1(sql),SQL_SHA);assert.equal(args.sql,sql,'both arms use the actual API SQL literally');
 assert.equal(projectionShaV1(projectionSurveyMetadataBeforeLinearV1),SOURCE1DD_SQL_SHA);
 const paramsJson=JSON.stringify(args.params),actualReference=args.actual;
 const identity=async():Promise<Identity>=>{
  const result=await c.query<Identity>(identitySql);assert.equal(result.rows.length,1);
  const row=result.rows[0]!;assert.equal(row.isolation,'repeatable read');assert.equal(row.readonly,'on');
  assert.ok(Number.isSafeInteger(row.pid)&&row.pid>0&&row.snapshot.length>0);
  assert.match(row.server_version_num,/^\d+$/u);assert.ok(Number(row.server_version_num)>=170000&&Number(row.server_version_num)<180000);
  assert.match(row.work_mem_bytes,/^\d+$/u);assert.ok(BigInt(row.work_mem_bytes)>0n);
  assert.ok(row.work_mem.length>0&&row.hash_mem_multiplier.length>0);return row;
 };
 const anchor=await identity();
 assert.ok(BigInt(anchor.work_mem_bytes)<BigInt(CANDIDATE_BYTES),'no comparison if the effective baseline is already >=32MiB');
 assert.ok(Number.isFinite(Number(anchor.hash_mem_multiplier))&&Number(anchor.hash_mem_multiplier)>0&&Number(anchor.hash_mem_multiplier)<=2,'single candidate is bounded to an observed hash multiplier <=2');
 const sameIdentity=(row:Identity)=>{
  assert.equal(row.pid,anchor.pid);assert.equal(row.snapshot,anchor.snapshot);
  assert.equal(row.isolation,anchor.isolation);assert.equal(row.readonly,anchor.readonly);
  assert.equal(row.server_version_num,anchor.server_version_num);
  assert.equal(row.hash_mem_multiplier,anchor.hash_mem_multiplier);
 };
 const sameBaseline=async()=>{try{const row=await identity();sameIdentity(row);assert.deepEqual(row,anchor);return row;}
  catch(error){args.markConnectionUncertain();throw error;}};
 // The real API result is immutable input to this diagnostic, never substituted.
 assert.deepEqual((await c.query<Metadata>(projectionSurveyMetadataBeforeLinearV1,args.params)).rows,args.actual);
 await sameBaseline();

 // Each arm owns a savepoint. A restoration/ACK failure latches the enclosing
 // physical PoolClient for discard; no subsequent query arm or body read runs.
 async function probe<T>(arm:Arm,operation:()=>Promise<T>):Promise<{value:T;receipt:ProbeRecord}>{
  const before=await sameBaseline();assert.equal(JSON.stringify(args.params),paramsJson);
  const started=process.hrtime.bigint();let savepointAck=false,rollbackAck=false,releaseAck=false;
  let primaryKnown=false,primary:unknown;let outcome:{value:T}|undefined,during:Identity|undefined,queryMs=0;
  const cleanupErrors:unknown[]=[];
  try{
   await c.query('SAVEPOINT '+SAVEPOINT);savepointAck=true;
   if(arm==='work_mem_32MiB')await c.query("SET LOCAL work_mem='32MB'");
   during=await identity();sameIdentity(during);
   assert.equal(during.work_mem_bytes,arm==='work_mem_32MiB'?String(CANDIDATE_BYTES):anchor.work_mem_bytes);
   const queryStarted=process.hrtime.bigint();outcome={value:await operation()};queryMs=Number(process.hrtime.bigint()-queryStarted)/1e6;
   assert.equal(JSON.stringify(args.params),paramsJson);
  }catch(error){primaryKnown=true;primary=error;}
  if(savepointAck){
   try{await c.query('ROLLBACK TO SAVEPOINT '+SAVEPOINT);rollbackAck=true;}
   catch(error){args.markConnectionUncertain();cleanupErrors.push(error);}
   if(rollbackAck){
    try{await c.query('RELEASE SAVEPOINT '+SAVEPOINT);releaseAck=true;}
    catch(error){args.markConnectionUncertain();cleanupErrors.push(error);}
   }
  }else{args.markConnectionUncertain();cleanupErrors.push(Error('survey_work_mem_savepoint_ack_unknown'));}
  let after:Identity|undefined;
  if(rollbackAck&&releaseAck){
   try{after=await sameBaseline();}
   catch(error){args.markConnectionUncertain();cleanupErrors.push(error);}
  }
  if(cleanupErrors.length)throw new AggregateError(primaryKnown?[primary,...cleanupErrors]:cleanupErrors,'survey_work_mem_restore_uncertain');
  if(primaryKnown)throw primary;
  assert.ok(savepointAck&&rollbackAck&&releaseAck&&during&&after&&outcome);
  return{value:outcome.value,receipt:{arm,work_mem_before:before.work_mem,work_mem_during:during.work_mem,work_mem_after:after.work_mem,
   work_mem_bytes_before:before.work_mem_bytes,work_mem_bytes_during:during.work_mem_bytes,work_mem_bytes_after:after.work_mem_bytes,
   hash_mem_multiplier:before.hash_mem_multiplier,savepoint_ack:savepointAck,rollback_to_ack:rollbackAck,release_ack:releaseAck,
   settings_restored:true,snapshot_preserved:true,query_wall_ms:queryMs,arm_wall_ms:Number(process.hrtime.bigint()-started)/1e6}};
 }
 const query=(arm:Arm,params=args.params)=>probe(arm,async()=>(await c.query<Metadata>(sql,params)).rows);
 const timings:Array<ProbeRecord&{rows:number;metadata_sha256:string}>=[];
 for(const arm of ['baseline','work_mem_32MiB','work_mem_32MiB','baseline']as const){
  const result=await query(arm);assert.deepEqual(result.value,args.actual,'same SQL/binds produce all ordered metadata, byte weights, NULLs, and sentinels');
  timings.push({...result.receipt,rows:result.value.length,metadata_sha256:projectionShaV1(JSON.stringify(result.value))});
 }
 // Equal SQL does not waive observed prefix/NULL edge verification.
 const total=args.actual.reduce((sum,row)=>sum+BigInt(row.working_bytes),0n);
 const prefixChecks:Array<{budget:string;rows:number;fitting:number;metadata_sha256:string;probes:ProbeRecord[]}>=[];
 for(const budget of [...new Set(['1',(total-1n).toString(),total.toString()])]){
  const params=[...args.params];params[8]=budget;
  const before=await query('baseline',params),after=await query('work_mem_32MiB',params);
  assert.deepEqual(after.value,before.value,'global contiguous prefix and NULL sentinels stay exact under32MiB');
  assert.equal(after.value.length,4096);
  prefixChecks.push({budget,rows:after.value.length,fitting:after.value.filter(row=>row.projection!==null).length,
   metadata_sha256:projectionShaV1(JSON.stringify(after.value)),probes:[before.receipt,after.receipt]});
 }
 const experimental=await query('work_mem_32MiB');assert.deepEqual(experimental.value,args.actual);
 let unicodeInputs=0,nullFields=0;
 // All body reads run only AFTER the candidate setting has restored to baseline.
 for(let offset=0;offset<args.actual.length;offset+=1024){
  await sameBaseline();const bounds={max_rows:1024,max_working_bytes:Number(args.params[8])};
  const before=await hydrateListeningInputProjectionV1(c,args.scope,args.actual.slice(offset,offset+1024),bounds);
  await sameBaseline();const after=await hydrateListeningInputProjectionV1(c,args.scope,experimental.value.slice(offset,offset+1024),bounds);
  assert.deepEqual(after,before);assert.deepEqual(after,args.expectedInputs.slice(offset,offset+1024));
  unicodeInputs+=after.filter(input=>/[^\u0000-\u007f]/u.test(input.text)).length;
  nullFields+=after.reduce((sum,input)=>sum+Object.values(input).filter(value=>value===null).length,0);await sameBaseline();
 }
 type PlanReceipt={sql_sha256:string;planning_ms:number|null;execution_ms:number|null;plan_sha256:string;plan:ProjectionPlanV1;probe:ProbeRecord};
 const plans:Partial<Record<Arm,PlanReceipt>>={};
 for(const arm of ['baseline','work_mem_32MiB']as const){
  const observed=await probe(arm,async()=>(await c.query<{['QUERY PLAN']:Array<{Plan:ProjectionPlanV1;'Planning Time'?:number;'Execution Time'?:number}>}>(
   'EXPLAIN (ANALYZE,BUFFERS,TIMING OFF,FORMAT JSON) '+sql,args.params)).rows[0]!['QUERY PLAN'][0]!);
  const plan=sanitizeProjectionLinearPlanV1(observed.value.Plan);assertProjectionSurveyLinearPlanV1(plan);
  let nodeCount=0;const visit=(node:ProjectionPlanV1)=>{nodeCount++;for(const child of node.Plans??[])visit(child);};visit(plan);
  assert.ok(nodeCount>0&&nodeCount<=512);assert.ok(Buffer.byteLength(JSON.stringify(plan))<=512*1024);
  plans[arm]={sql_sha256:SQL_SHA,planning_ms:observed.value['Planning Time']??null,execution_ms:observed.value['Execution Time']??null,
   plan_sha256:projectionShaV1(JSON.stringify(plan)),plan,probe:observed.receipt};
 }
 await sameBaseline();assert.equal(args.actual,actualReference);assert.equal(JSON.stringify(args.params),paramsJson);
 const baselineMean=(timings[0]!.query_wall_ms+timings[3]!.query_wall_ms)/2;
 const candidateMean=(timings[1]!.query_wall_ms+timings[2]!.query_wall_ms)/2;
 const receipt={contract:'r16-survey-work-mem-Q8-test-only-ABBA-v1',experimental:true,product_adopted:false,
  product_source_sha256:PRODUCT_SHA,sql_sha256:SQL_SHA,original_Source1dd_sql_sha256:SOURCE1DD_SQL_SHA,
  helper_sha256:projectionShaV1(await readFile(new URL('./signal-listening-survey-work-mem.experimental.test-support.ts',import.meta.url),'utf8')),
  baseline_settings:{server_version_num:anchor.server_version_num,work_mem:anchor.work_mem,work_mem_bytes:anchor.work_mem_bytes,hash_mem_multiplier:anchor.hash_mem_multiplier},
  candidate_work_mem_bytes:CANDIDATE_BYTES,setting_scope:'SET LOCAL after per-arm SAVEPOINT; ROLLBACK TO + RELEASE and effective-setting equality before another SQL arm/body read',
  params:args.params,params_sha256:projectionShaV1(paramsJson),bind_count:9,selected_id_count:4096,
  root_ids_sha256:projectionShaV1(JSON.stringify(args.params[7])),snapshot_sha256:projectionShaV1(anchor.snapshot),
  metadata_sha256:projectionShaV1(JSON.stringify(args.actual)),output_count:args.actual.length,actual_rows_reference_preserved:true,
  timings,prefixChecks,additional_candidate_probe:experimental.receipt,plans,
  observed:{baseline_query_mean_ms:baselineMean,candidate_query_mean_ms:candidateMean,candidate_over_baseline:baselineMean>0?candidateMean/baselineMean:null,
   unicode_input_count:unicodeInputs,null_DTO_fields:nullFields,question_counts:[...new Set(args.actual.map(row=>row.projection?.question_keys.length??0))]},
  equal:true,settings_restored:true,connection_uncertainty:false,
  memory_scope:'32MiB is per PostgreSQL work_mem operation; hash_mem_multiplier may multiply a hash allowance; not a total PG/RSS cap and not worker logical512MiB',
  buffer_scope:'Per-node parent counters can contain descendants. Never sum parent and child buffer/time counters.',
  nested_function_plan_scope:'Direct EXPLAIN may expose only a Function Scan for a non-inlined function. Missing inner hash batches are UNKNOWN, never inferred from outer counters.',
  timing_scope:'Query wall excludes diagnostic savepoint/GUC/restore controls; arm wall includes them. Neither is pipeline throughput.',
  capacity_claim:false,gain_claim:false,promotion_decision:'Root review after actual paired wall, plan spill, semantics and resource evidence; unchanged Full H1 required'};
 assert.ok(Buffer.byteLength(JSON.stringify(receipt))<=1024*1024,'bounded diagnostic receipt');return receipt;
}
