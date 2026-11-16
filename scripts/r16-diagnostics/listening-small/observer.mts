import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {fork,type ChildProcess} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {monitorEventLoopDelay,PerformanceObserver,performance} from 'node:perf_hooks';
import {join} from 'node:path';
export const STORE_OPERATIONS=new Set(['inputs','calls','reserve','markSubmitting','persistRawPage','persistRaw','settlePage','settle','apply','finish','claim','release']);
const INNER_PLAN_QUERY_LABELS=new Map([
 ['sha256:d0ecbbfdca3d93e069a3ca03367439fa25ce54164efaf3135c80b27c91ed2680','metadata'],
 ['sha256:82fa4fc106842d6422046aefb067a0a7dbaf5bb28de04c0b9147854091410c04','hydrate'],
]);
export const INNER_PLAN_CAPTURE_ORDINALS=[1,2,3,4,5,6,7,8] as const;
const PLAN_NUMBERS=['Plan Rows','Plan Width','Actual Rows','Actual Loops','Startup Cost','Total Cost','Actual Startup Time','Actual Total Time',
 'Shared Hit Blocks','Shared Read Blocks','Shared Dirtied Blocks','Shared Written Blocks','Temp Read Blocks','Temp Written Blocks'];
const PLAN_NAMES=['Node Type','Relation Name','Alias','Index Name','Join Type'];
const SAFE_CTE_NAMES=new Set(['allowed_roots','selected_items','items','prepared','qs']);
const MAX_INNER_PLANS_PER_QUERY=32;
export const INNER_PLAN_MIN_DURATION_MS=50;
export const DML_PLAN_MIN_DURATION_MS=50;
export const DML_PLAN_MIN_BATCH=256;
export const DML_PLAN_MAX_PLANS=8;
type DmlPlanUnitV1='call_ids'|'answer_rows'|'call_proposals';
type DmlPlanQuerySpecV1={label:string;batch_unit:DmlPlanUnitV1;values_count:number;batch_value_index:number;batch_kind:'array'|'json_array'};
const DML_PLAN_QUERY_SPECS=new Map<string,DmlPlanQuerySpecV1>([
 ['sha256:1e5b3d3837b8c7354d6c25d941461f0d36e55d5cc3d42cbd31c627ba0662859b',
  {label:'mark_submitting',batch_unit:'call_ids',values_count:2,batch_value_index:1,batch_kind:'array'}],
 ['sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7',
  {label:'listening_answers_insert',batch_unit:'answer_rows',values_count:4,batch_value_index:3,batch_kind:'json_array'}],
 ['sha256:4ece6654c82e3d48416690d80208f849288cd5cfed5e16f0464dd3accfba33dd',
  {label:'reserve_calls_insert',batch_unit:'call_proposals',values_count:8,batch_value_index:5,batch_kind:'json_array'}],
]);
const SAFE_DML_TRIGGER_NAMES=new Set(['aac_signal_study_call_guard','listening_human_new_call_guard','listening_statement_money_insert','listening_statement_money_update',
 'mass_labeling_call_root','mass_labeling_scoped_insert_total','mass_labeling_scoped_money','mass_labeling_scoped_update_total','signal_listening_answer_guard',
 'signal_listening_call_guard','signal_listening_link_call','signal_study_jev_link','z_listening_discovery_child_capacity']);
const DML_BASE_GUCS=['log_min_messages','client_min_messages','log_statement','log_parameter_max_length'];
const DML_AUTO_EXPLAIN_GUCS=['auto_explain.log_parameter_max_length','auto_explain.log_level','auto_explain.log_min_duration','auto_explain.log_nested_statements',
 'auto_explain.log_analyze','auto_explain.log_buffers','auto_explain.log_timing','auto_explain.log_format','auto_explain.log_verbose','auto_explain.log_triggers'];
const SAFE_NODE_TYPES=new Set(['Aggregate','Append','Bitmap Heap Scan','Bitmap Index Scan','CTE Scan','Custom Scan','Foreign Scan','Function Scan',
 'Gather','Gather Merge','GroupAggregate','Hash','HashAggregate','Hash Join','Incremental Sort','Index Only Scan','Index Scan','Limit','LockRows',
 'Materialize','Memoize','Merge Append','Merge Join','ModifyTable','Nested Loop','ProjectSet','Recursive Union','Result','Sample Scan','Seq Scan',
 'SetOp','Sort','Subquery Scan','Tid Scan','Unique','Values Scan','WindowAgg','WorkTable Scan']);
export function queryHash(value:unknown){const sql=typeof value==='string'?value:(value as {text?:unknown})?.text;return typeof sql==='string'?'sha256:'+createHash('sha256').update(sql.replace(/\s+/gu,' ').trim()).digest('hex'):null;}
export function dmlPlanQuerySpec(hash:string|null){return hash?DML_PLAN_QUERY_SPECS.get(hash)??null:null;}
export function dmlPlanBatchSize(hash:string|null,args:unknown[]){
 const spec=dmlPlanQuerySpec(hash);if(!spec||args.length!==2||!Array.isArray(args[1])||args[1].length!==spec.values_count)return null;
 const value=(args[1] as unknown[])[spec.batch_value_index];
 if(spec.batch_kind==='array')return Array.isArray(value)?value.length:null;
 if(typeof value!=='string')return null;
 try{const rows=JSON.parse(value);return Array.isArray(rows)?rows.length:null;}catch{return null;}
}
export function dmlPlanCaptureEnvironmentAllowed(env:NodeJS.ProcessEnv){
 if(env.GITHUB_ACTIONS!=='true'||env.NOISIA_R16_SMALL_DIAGNOSTIC!=='true'||env.NOISIA_R16_LISTENING_DML_PLAN_PG!=='true'
  ||env.NOISIA_R16_LOCAL_PG_LAB!=='r16-benchmark-pg17')return false;
 try{const url=new URL(env.DATABASE_URL??'');return url.protocol==='postgresql:'&&url.hostname==='127.0.0.1'&&url.pathname==='/noisia_mfp_ci'
   &&url.username==='postgres'&&!!url.port&&!url.search&&!url.hash;}catch{return false;}
}
function safeName(value:unknown){return typeof value==='string'&&/^[A-Za-z_][A-Za-z0-9_$]{0,127}$/u.test(value)?value:'redacted';}
function safePlanNode(value:any):any{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const result:Record<string,unknown>={};
 for(const key of PLAN_NAMES)if(value[key]!==undefined)result[key]=key==='Node Type'
  ?(typeof value[key]==='string'&&SAFE_NODE_TYPES.has(value[key])?value[key]:'redacted'):safeName(value[key]);
 for(const key of ['CTE Name','Subplan Name'])if(typeof value[key]==='string'&&SAFE_CTE_NAMES.has(value[key]))result[key]=value[key];
 for(const key of PLAN_NUMBERS)if(typeof value[key]==='number'&&Number.isFinite(value[key]))result[key]=value[key];
 for(const key of ['Parallel Aware','Async Capable'])if(typeof value[key]==='boolean')result[key]=value[key];
 if(Array.isArray(value.Plans))result.Plans=value.Plans.map(safePlanNode).filter(Boolean);
 return result;
}
/** Parses the NOTICE only in memory. Raw PostgreSQL messages and text fields are never retained. */
export function safeAutoExplainNotice(notice:unknown){
 const message=(notice as {message?:unknown}|null)?.message;
 if(typeof message!=='string'||message.length>1_000_000)return null;
 const start=message.indexOf('{');if(start<0)return null;
 try{
  const parsed=JSON.parse(message.slice(start));
  const plan=safePlanNode(parsed?.Plan);if(!plan)return null;
  const queryText=typeof parsed['Query Text']==='string'?parsed['Query Text']:null;
  return{query_text_sha256:queryText?`sha256:${createHash('sha256').update(queryText,'utf8').digest('hex')}`:null,
    planning_time_ms:typeof parsed['Planning Time']==='number'&&Number.isFinite(parsed['Planning Time'])?parsed['Planning Time']:null,
    execution_time_ms:typeof parsed['Execution Time']==='number'&&Number.isFinite(parsed['Execution Time'])?parsed['Execution Time']:null,plan};
 }catch{return null;}
}
function autoExplainPayload(notice:unknown){
 const message=(notice as {message?:unknown}|null)?.message;if(typeof message!=='string'||message.length>1_000_000)return null;
 const start=message.indexOf('{');if(start<0)return null;try{return JSON.parse(message.slice(start));}catch{return null;}
}
export function safeDmlAutoExplainNotice(notice:unknown){
 const base=safeAutoExplainNotice(notice),payload=autoExplainPayload(notice);if(!base||!payload)return null;
 const source=Array.isArray(payload.Triggers)?payload.Triggers:[];let omitted=0,unknownTime=0;
 const triggers:Array<{name:string;relation:string|null;time_ms:number|null;calls:number}>=[];
 for(const row of source){
  if(!row||typeof row!=='object'||typeof row['Trigger Name']!=='string'||!SAFE_DML_TRIGGER_NAMES.has(row['Trigger Name'])
   ||typeof row.Calls!=='number'||!Number.isSafeInteger(row.Calls)||row.Calls<0){omitted++;continue;}
  const time=typeof row.Time==='number'&&Number.isFinite(row.Time)?row.Time:null;if(time===null)unknownTime++;
  triggers.push({name:row['Trigger Name'],relation:row.Relation===undefined?null:safeName(row.Relation),time_ms:time,calls:row.Calls});
 }
 return{...base,triggers,triggers_seen:source.length,triggers_omitted:omitted,triggers_unknown_time:unknownTime};
}
export function innerPlanQueryLabel(hash:string|null){return hash?INNER_PLAN_QUERY_LABELS.get(hash)??null:null;}
export function nextInnerPlanQueryOrdinalV1(hash:string|null,eligible:boolean,ordinals:Map<string,number>){
 if(!eligible||!hash||!innerPlanQueryLabel(hash))return null;
 const next=(ordinals.get(hash)??0)+1;ordinals.set(hash,next);return next;
}
export function shouldCaptureInnerPlanOrdinalV1(ordinal:number|null){return ordinal!==null&&(INNER_PLAN_CAPTURE_ORDINALS as readonly number[]).includes(ordinal);}
export function assertInnerPlanCaptureGuard(env:NodeJS.ProcessEnv,database:string,role:string){
 if(env.GITHUB_ACTIONS!=='true'||env.NOISIA_R16_SMALL_DIAGNOSTIC!=='true'||database!=='noisia_mfp_ci'||role!=='postgres')
  throw Error('observer_inner_plan_capture_denied');
 const url=new URL(env.DATABASE_URL??'');
 if(url.protocol!=='postgresql:'||url.hostname!=='127.0.0.1'||url.pathname!=='/noisia_mfp_ci'||url.username!=='postgres'||!url.port||url.search||url.hash)
  throw Error('observer_inner_plan_capture_denied');
}
export function verifiedInnerPlanScopeV1(identity:any,database:string,role:string){
 return identity?.database===database&&identity?.role===role&&identity?.isolation==='repeatable read'&&identity?.read_only==='on'&&identity?.superuser===true;
}
type InnerPlanTimingV1={capture_wall_ms:number;setup_ms:number;query_wall_ms:number;cleanup_ms:number;setup_cleanup_wall_ms:number;analyze_overhead_measured:false};
export type InnerPlanObservationV1=
 |({query_hash:string;label:string;query_ordinal:number;status:'inner_plan_unavailable';reason:'transaction_scope_unverified'|'auto_explain_load_unavailable'|'capture_setup_unavailable'}&InnerPlanTimingV1)
 |({query_hash:string;label:string;query_ordinal:number;status:'captured'|'plan_notice_unavailable';plans:Array<{sequence:number;query_text_sha256:string|null;planning_time_ms:number|null;execution_time_ms:number|null;plan:Record<string,unknown>}>;plan_notices_seen:number;plans_dropped:number}&InnerPlanTimingV1);
type DmlPlanV1={sequence:number;query_text_sha256:string|null;planning_time_ms:number|null;execution_time_ms:number|null;
 plan:Record<string,unknown>;triggers:Array<{name:string;relation:string|null;time_ms:number|null;calls:number}>;triggers_seen:number;triggers_omitted:number;triggers_unknown_time:number};
type DmlPlanTimingV1={setup_ms:number;query_wall_ms:number;cleanup_ms:number;setup_cleanup_wall_ms:number;analyze_timing_overhead_measured:false};
export type DmlPlanObservationV1=({query_hash:string;label:string;batch_size:number;batch_unit:DmlPlanUnitV1;status:'setup_unavailable';
 reason:'transaction_scope_unverified'|'auto_explain_load_unavailable'|'capture_setup_unavailable';plans:DmlPlanV1[];plan_notices_seen:number;plans_dropped:number;
 triggers_omitted_count:number;triggers_unknown_time_count:number;analyze_timing_enabled:false}&DmlPlanTimingV1)|({query_hash:string;label:string;batch_size:number;batch_unit:DmlPlanUnitV1;status:'captured'|'plan_notice_unavailable';
 plans:DmlPlanV1[];plan_notices_seen:number;plans_dropped:number;triggers_omitted_count:number;triggers_unknown_time_count:number;analyze_timing_enabled:true;analyze_timing_overhead_measured:false}&DmlPlanTimingV1);
function dmlCaptureGucs(prior:Map<string,string>){
 const names=['auto_explain.log_min_duration',...DML_AUTO_EXPLAIN_GUCS.filter(name=>name!=='auto_explain.log_min_duration'),
  'log_statement','log_parameter_max_length','client_min_messages','log_min_messages','auto_explain.log_min_duration'];
 const values=['-1',...names.slice(1,-2).map(name=>prior.get(name)!),prior.get('log_min_messages')!,prior.get('auto_explain.log_min_duration')!];
 return names.map((name,index)=>[name,values[index]!] as const);
}
/** Instruments one already-issued write only after setup is complete. The setup savepoint is released before the original DML and is never rolled back afterward. */
export async function captureDmlPlanQueryV1(args:{client:any;query:()=>Promise<any>;query_hash:string;batch_size:number;database:string;role:string;env:NodeJS.ProcessEnv;clock?:()=>number}):Promise<{result:any;observation:DmlPlanObservationV1|null}>{
 const {client,query,query_hash,batch_size,database,role,env}=args,spec=dmlPlanQuerySpec(query_hash),clock=args.clock??(()=>performance.now());
 if(!spec||batch_size<DML_PLAN_MIN_BATCH||!dmlPlanCaptureEnvironmentAllowed(env)||database!=='noisia_mfp_ci'||role!=='postgres')
  return{result:await query(),observation:null};
 const plans:DmlPlanV1[]=[];let planNoticesSeen=0,plansDropped=0,triggersOmittedCount=0,triggersUnknownTimeCount=0;
 let savepoint=false,dmlStarted=false,setupStage='savepoint',setupMs=0,queryWallMs=0,cleanupMs=0,prior=new Map<string,string>(),detached=false;
 const onNotice=(notice:unknown)=>{const plan=safeDmlAutoExplainNotice(notice);if(!plan)return;planNoticesSeen++;
  triggersOmittedCount+=plan.triggers_omitted;triggersUnknownTimeCount+=plan.triggers_unknown_time;
  if(plans.length<DML_PLAN_MAX_PLANS)plans.push({sequence:planNoticesSeen,...plan});else plansDropped++;};
 const detach=()=>{if(!detached){detached=true;client.off('notice',onNotice);}};
 const rollbackSetup=async()=>{if(savepoint){const cleanupStarted=clock();try{
   await client.query('ROLLBACK TO SAVEPOINT r16_dml_plan_capture_v1');await client.query('RELEASE SAVEPOINT r16_dml_plan_capture_v1');savepoint=false;
  }finally{cleanupMs+=clock()-cleanupStarted;}}};
 const restoreSettings=async()=>{
  const cleanupStarted=clock();
  let firstError:unknown;
  try{for(const [name,value] of dmlCaptureGucs(prior)){try{await client.query('SELECT set_config($1,$2,true)',[name,value]);}catch(error){firstError??=error;}}if(firstError)throw firstError;}
  finally{cleanupMs+=clock()-cleanupStarted;}
 };
 client.on('notice',onNotice);
 try{
  const setupStarted=clock();
  try{
   await client.query('SAVEPOINT r16_dml_plan_capture_v1');savepoint=true;
   setupStage='verify_transaction_scope';
   const identity=await client.query(`SELECT current_database() AS database,current_user AS role,
    current_setting('transaction_read_only') AS read_only,r.rolsuper AS superuser
    FROM pg_roles r WHERE r.rolname=current_user`);
   const row=identity.rows?.[0];
   if(row?.database!==database||row?.role!==role||row?.read_only!=='off'||row?.superuser!==true)throw Error('dml_capture_scope_unverified');
   setupStage='load_auto_explain';
   await client.query("LOAD 'auto_explain'");
   setupStage='read_prior_settings';
   const settings=await client.query(`SELECT name,current_setting(name,true) AS value
    FROM unnest($1::text[]) AS settings(name)`,[[...DML_BASE_GUCS,...DML_AUTO_EXPLAIN_GUCS]]);
   for(const setting of settings.rows??[]){if(typeof setting.name!=='string'||typeof setting.value!=='string')throw Error('dml_capture_settings_unavailable');prior.set(setting.name,setting.value);}
   if(prior.size!==DML_BASE_GUCS.length+DML_AUTO_EXPLAIN_GUCS.length)throw Error('dml_capture_settings_unavailable');
   setupStage='configure_auto_explain';
   await client.query("SET LOCAL log_min_messages = 'WARNING'");
   await client.query("SET LOCAL client_min_messages = 'NOTICE'");
   await client.query("SET LOCAL log_statement = 'none'");
   await client.query('SET LOCAL log_parameter_max_length = 0');
   await client.query('SET LOCAL auto_explain.log_parameter_max_length = 0');
   await client.query("SET LOCAL auto_explain.log_level = 'NOTICE'");
   await client.query(`SET LOCAL auto_explain.log_min_duration = ${DML_PLAN_MIN_DURATION_MS}`);
   await client.query('SET LOCAL auto_explain.log_nested_statements = on');
   await client.query('SET LOCAL auto_explain.log_analyze = on');
   await client.query('SET LOCAL auto_explain.log_buffers = on');
   await client.query('SET LOCAL auto_explain.log_timing = on');
   await client.query("SET LOCAL auto_explain.log_format = 'json'");
   await client.query('SET LOCAL auto_explain.log_verbose = off');
   await client.query('SET LOCAL auto_explain.log_triggers = on');
   await client.query('RELEASE SAVEPOINT r16_dml_plan_capture_v1');savepoint=false;
  }catch{
   setupMs=clock()-setupStarted;
   await rollbackSetup();detach();
   const queryStarted=clock();const original=await query();queryWallMs=clock()-queryStarted;
   const reason=setupStage==='verify_transaction_scope'?'transaction_scope_unverified':setupStage==='load_auto_explain'
    ?'auto_explain_load_unavailable':'capture_setup_unavailable';
   return{result:original,observation:{query_hash,label:spec.label,batch_size,batch_unit:spec.batch_unit,
    status:'setup_unavailable',reason,plans,plan_notices_seen:planNoticesSeen,plans_dropped:plansDropped,triggers_omitted_count:triggersOmittedCount,
    triggers_unknown_time_count:triggersUnknownTimeCount,analyze_timing_enabled:false,
    setup_ms:setupMs,query_wall_ms:queryWallMs,cleanup_ms:cleanupMs,setup_cleanup_wall_ms:setupMs+cleanupMs,analyze_timing_overhead_measured:false}};
  }
  setupMs=clock()-setupStarted;dmlStarted=true;
  const queryStarted=clock();const result=await query();queryWallMs=clock()-queryStarted;
  detach();await restoreSettings();
  return{result,observation:{query_hash,label:spec.label,batch_size,batch_unit:spec.batch_unit,
   status:plans.length?'captured':'plan_notice_unavailable',plans,plan_notices_seen:planNoticesSeen,plans_dropped:plansDropped,triggers_omitted_count:triggersOmittedCount,
   triggers_unknown_time_count:triggersUnknownTimeCount,analyze_timing_enabled:true,
   setup_ms:setupMs,query_wall_ms:queryWallMs,cleanup_ms:cleanupMs,setup_cleanup_wall_ms:setupMs+cleanupMs,analyze_timing_overhead_measured:false}};
 }finally{
  try{if(savepoint&&!dmlStarted)await rollbackSetup();}finally{detach();}
 }
}
/** Capture a single original SELECT inside a verified RR/RO transaction. Setup failures roll back to the owned savepoint and do not retry setup. */
export async function captureInnerPlanQueryV1(args:{client:any;query:()=>Promise<any>;query_hash:string;query_ordinal:number;root_count:number;database:string;role:string}):Promise<{result:any;observation:InnerPlanObservationV1|null}>{
 const {client,query,query_hash,query_ordinal,root_count,database,role}=args;
 const label=innerPlanQueryLabel(query_hash);
 if(!label||root_count<1024)return{result:await query(),observation:null};
 assertInnerPlanCaptureGuard(process.env,database,role);
 const started=performance.now(),plans:Array<{sequence:number;query_text_sha256:string|null;planning_time_ms:number|null;execution_time_ms:number|null;plan:Record<string,unknown>}>=[];
 let planNoticesSeen=0,plansDropped=0,savepoint=false,setupStage='savepoint',result:any,queryError:unknown,setupMs=0,queryWallMs=0,cleanupMs=0;
 const onNotice=(notice:unknown)=>{const plan=safeAutoExplainNotice(notice);if(!plan)return;planNoticesSeen++;
  if(plans.length<MAX_INNER_PLANS_PER_QUERY)plans.push({sequence:planNoticesSeen,...plan});else plansDropped++;};
 client.on('notice',onNotice);
 const rollback=async()=>{if(savepoint){const cleanupStarted=performance.now();try{
   await client.query('ROLLBACK TO SAVEPOINT r16_inner_plan_capture_v1');await client.query('RELEASE SAVEPOINT r16_inner_plan_capture_v1');savepoint=false;
  }finally{cleanupMs+=performance.now()-cleanupStarted;}}};
 try{
  const setupStarted=performance.now();
  try{
   await client.query('SAVEPOINT r16_inner_plan_capture_v1');savepoint=true;
   setupStage='verify_transaction_scope';
   const verified=await client.query(`SELECT current_database() AS database,current_user AS role,
    current_setting('transaction_isolation') AS isolation,current_setting('transaction_read_only') AS read_only,
    r.rolsuper AS superuser FROM pg_roles r WHERE r.rolname=current_user`);
   if(!verifiedInnerPlanScopeV1(verified.rows?.[0],database,role))throw Error('capture_scope_unverified');
   setupStage='logging_configuration';
   await client.query("SET LOCAL log_min_messages = 'WARNING'");
   await client.query("SET LOCAL client_min_messages = 'NOTICE'");
   await client.query("SET LOCAL log_statement = 'none'");
   await client.query('SET LOCAL log_parameter_max_length = 0');
   setupStage='load_auto_explain';
   await client.query("LOAD 'auto_explain'");
   setupStage='auto_explain_configuration';
   await client.query('SET LOCAL auto_explain.log_parameter_max_length = 0');
   await client.query("SET LOCAL auto_explain.log_level = 'NOTICE'");
   await client.query(`SET LOCAL auto_explain.log_min_duration = ${INNER_PLAN_MIN_DURATION_MS}`);
   await client.query('SET LOCAL auto_explain.log_nested_statements = on');
   await client.query('SET LOCAL auto_explain.log_analyze = on');
   await client.query('SET LOCAL auto_explain.log_buffers = on');
   await client.query('SET LOCAL auto_explain.log_timing = off');
   await client.query("SET LOCAL auto_explain.log_format = 'json'");
   await client.query('SET LOCAL auto_explain.log_verbose = off');
  }catch{
   setupMs=performance.now()-setupStarted;
   await rollback();
   const queryStarted=performance.now();const original=await query();queryWallMs=performance.now()-queryStarted;
   const captureWall=performance.now()-started;
   const reason=setupStage==='verify_transaction_scope'?'transaction_scope_unverified':setupStage==='load_auto_explain'
    ?'auto_explain_load_unavailable':'capture_setup_unavailable';
   return{result:original,observation:{query_hash,label,query_ordinal,status:'inner_plan_unavailable',reason,capture_wall_ms:captureWall,setup_ms:setupMs,query_wall_ms:queryWallMs,
    cleanup_ms:cleanupMs,setup_cleanup_wall_ms:setupMs+cleanupMs,analyze_overhead_measured:false}};
  }
  setupMs=performance.now()-setupStarted;
  const queryStarted=performance.now();try{result=await query();}catch(error){queryError=error;}finally{queryWallMs=performance.now()-queryStarted;}
  await rollback();
  if(queryError)throw queryError;
  const captureWall=performance.now()-started;
  return{result,observation:{query_hash,label,query_ordinal,status:plans.length?'captured':'plan_notice_unavailable',plans,plan_notices_seen:planNoticesSeen,plans_dropped:plansDropped,
    capture_wall_ms:captureWall,setup_ms:setupMs,query_wall_ms:queryWallMs,cleanup_ms:cleanupMs,setup_cleanup_wall_ms:setupMs+cleanupMs,analyze_overhead_measured:false}};
 }finally{
  try{if(savepoint)await rollback();}finally{client.off('notice',onNotice);}
 }
}
export function safeWaitRow(row:any){
 if(!Number.isSafeInteger(row.pid)||row.pid<1)throw Error('observer_invalid_pid');
 const event=(x:unknown)=>x===null?null:typeof x==='string'&&/^[a-zA-Z0-9_]{1,80}$/u.test(x)?x:'redacted';
 return{pid:row.pid,wait_event_type:event(row.wait_event_type),wait_event:event(row.wait_event),blocking_pids:Array.isArray(row.blocking_pids)?row.blocking_pids.filter((x:unknown)=>Number.isSafeInteger(x)&&Number(x)>0):[]};
}
export function boundedEvents(limit=200000){const events:unknown[]=[];let dropped=0;return{push(event:unknown){if(events.length<limit)events.push(event);else dropped++;},snapshot:()=>({events:[...events],dropped,limit})};}
export async function closeOwnedChild(child:ChildProcess){
 if(child.exitCode!==null||child.signalCode!==null)return;
 await new Promise<void>(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);resolve();};
 const timer=setTimeout(()=>{child.kill('SIGKILL');},3000);child.once('exit',finish);child.once('error',finish);
 if(child.connected)child.send({kind:'stop'},()=>{});else child.kill('SIGTERM');});
}
export async function finishListeningObserver<T>(observer:{close():Promise<void>;snapshot():T}){await observer.close();return observer.snapshot();}
export function createListeningObserver(){
 const performanceOrigin=performance.now(),origin=process.hrtime.bigint(),now=()=>Number(process.hrtime.bigint()-origin)/1e6,events=boundedEvents(),scope=new AsyncLocalStorage<string>();
 const delay=monitorEventLoopDelay({resolution:20});delay.enable();
 let previous=now();const heartbeat=setInterval(()=>{const at=now();events.push({kind:'heartbeat',at_ms:at,gap_ms:at-previous,heap:process.memoryUsage(),resource:process.resourceUsage()});previous=at;},250);
 const gc=new PerformanceObserver(list=>{for(const entry of list.getEntries())events.push({kind:'gc',at_ms:now(),start_ms:entry.startTime-performanceOrigin,end_ms:entry.startTime-performanceOrigin+entry.duration,duration_ms:entry.duration,gc_kind:(entry as any).detail?.kind??null});});gc.observe({entryTypes:['gc']});
 let closing=false;const detach:Array<()=>void>=[];let child:ChildProcess|undefined;const pids=new Set<number>();let samplerStatus='not_started';
 let planRootCount=0;const planQueryOrdinals=new Map<string,number>(),planObservations:unknown[]=[];
 const dmlPlanCounts=new Map<string,number>(),dmlPlanObservations:unknown[]=[];
 function pid(value:any){if(Number.isSafeInteger(value?.processID)&&value.processID>0&&!pids.has(value.processID)){pids.add(value.processID);if(child?.connected)child.send({kind:'pids',pids:[...pids]},()=>{});}}
 function query(owner:any){return async(...args:any[])=>{pid(owner);const start=now(),op=scope.getStore()??'unlabeled',hash=queryHash(args[0]);
  const label=innerPlanQueryLabel(hash),queryOrdinal=nextInnerPlanQueryOrdinalV1(hash,label!==null&&planRootCount>=1024,planQueryOrdinals);try{
  const dmlSpec=dmlPlanQuerySpec(hash),dmlBatch=dmlSpec?dmlPlanBatchSize(hash,args):null;
  if(dmlSpec&&dmlBatch!==null&&dmlBatch>=DML_PLAN_MIN_BATCH&&(dmlPlanCounts.get(hash!)??0)<1
   &&dmlPlanCaptureEnvironmentAllowed(process.env)&&typeof owner.on==='function'&&typeof owner.off==='function'){
   dmlPlanCounts.set(hash!,1);
   const captured=await captureDmlPlanQueryV1({client:owner,query:()=>owner.query(...args),query_hash:hash!,batch_size:dmlBatch,database:'noisia_mfp_ci',role:'postgres',env:process.env});
   if(captured.observation)dmlPlanObservations.push(captured.observation);return captured.result;
  }
  if(label&&shouldCaptureInnerPlanOrdinalV1(queryOrdinal)&&typeof owner.on==='function'&&typeof owner.off==='function'){
   const captured=await captureInnerPlanQueryV1({client:owner,query:()=>owner.query(...args),query_hash:hash!,query_ordinal:queryOrdinal!,root_count:planRootCount,database:'noisia_mfp_ci',role:'postgres'});
   if(captured.observation)planObservations.push(captured.observation);return captured.result;
  }
  return await owner.query(...args);
 }finally{events.push({kind:'query',operation:op,hash,pid:Number.isSafeInteger(owner.processID)?owner.processID:null,
  ...(queryOrdinal===null?{}:{query_ordinal:queryOrdinal}),start_ms:start,end_ms:now()});}};}
 return{
 wrapDatabase(database:any){database.on?.('acquire',pid);detach.push(()=>database.off?.('acquire',pid));return new Proxy(database,{get(target,key){if(key==='query')return query(target);if(key==='connect')return async()=>{const c=await target.connect();pid(c);return new Proxy(c,{get(t,k){if(k==='query')return query(t);const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v;}});};const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});},
 wrapStore(store:any){return new Proxy(store,{get(t,k){const value=Reflect.get(t,k);if(typeof k!=='string'||!STORE_OPERATIONS.has(k)||typeof value!=='function')return typeof value==='function'?value.bind(t):value;return async(...args:any[])=>{const operation=k==='calls'&&Array.isArray(args[1]?.call_ids)?'hydrate':k;const start=now();try{return await scope.run(operation,()=>value.apply(t,args));}finally{events.push({kind:'store',operation,start_ms:start,end_ms:now()});}};}});},
 async startSampler(args:{target:string;url:string;database:string}){
  if(process.env.GITHUB_ACTIONS!=='true'||process.env.NOISIA_R16_SMALL_DIAGNOSTIC!=='true')throw Error('observer_sampler_ci_only');
  const url=new URL(args.url);if(url.hostname!=='127.0.0.1'||url.protocol!=='postgresql:'||!/^noisia_[a-z0-9_]+$/u.test(args.database))throw Error('observer_sampler_target_invalid');
  samplerStatus='starting';child=fork(fileURLToPath(import.meta.url),['--sampler'],{stdio:['ignore','ignore','ignore','ipc'],env:{PATH:process.env.PATH,GITHUB_ACTIONS:'true',NOISIA_R16_SMALL_DIAGNOSTIC:'true'},execArgv:process.execArgv});
  child.on('message',(m:any)=>{if(m?.kind==='waits'&&Array.isArray(m.rows)){try{events.push({kind:'pg_waits',at_ms:m.at_ms,rows:m.rows.map(safeWaitRow)});}catch{samplerStatus='invalid_sample';}}else if(m?.kind==='ready')samplerStatus='ready';else if(m?.kind==='failed')samplerStatus='failed';});
  child.on('error',()=>{samplerStatus='failed';});child.on('exit',()=>{if(!closing)samplerStatus='exited_early';});child.send({kind:'init',...args,origin:String(origin),pids:[...pids]},()=>{});
 },
 setInnerPlanRootCount(value:number){if(!Number.isSafeInteger(value)||value<0)throw Error('observer_invalid_root_count');planRootCount=value;},
 snapshot(){return{contract_version:'r16-neutral-observer-v1',...events.snapshot(),sampler_status:samplerStatus,fixture_pids:[...pids],inner_plan_observations:[...planObservations],
  dml_plan_observations:[...dmlPlanObservations],event_loop_delay_ms:{min:delay.count?delay.min/1e6:0,max:delay.max/1e6,mean:delay.count?delay.mean/1e6:0,p50:delay.percentile(50)/1e6,p99:delay.percentile(99)/1e6},diagnostic_only:true,h1_accepted:false};},
 async close(){closing=true;clearInterval(heartbeat);gc.disconnect();delay.disable();for(const remove of detach)remove();if(child)await closeOwnedChild(child);},
 };
}
async function sampler(){
 let pool:any,stopped=false,ids:number[]=[],origin=0n,timer:ReturnType<typeof setTimeout>|undefined;
 const send=(m:unknown)=>{if(process.connected)process.send?.(m);};
 async function close(){if(stopped)return;stopped=true;clearTimeout(timer);await pool?.end().catch(()=>{});if(process.connected)process.disconnect?.();}
 process.on('disconnect',()=>{void close();});
 process.on('message',async(m:any)=>{try{
  if(m?.kind==='stop'){await close();return;}
  if(m?.kind==='pids'){ids=m.pids.filter((x:unknown)=>Number.isSafeInteger(x)&&Number(x)>0);return;}
  if(m?.kind!=='init'||pool)return;
  if(process.env.GITHUB_ACTIONS!=='true'||process.env.NOISIA_R16_SMALL_DIAGNOSTIC!=='true')throw Error('denied');
  const url=new URL(m.url);if(url.protocol!=='postgresql:'||url.hostname!=='127.0.0.1'||!/^noisia_[a-z0-9_]+$/u.test(m.database))throw Error('denied');url.pathname='/'+m.database;
  const require=createRequire(join(m.target,'infrastructure/db/package.json'));const {Pool}=require('pg');
  pool=new Pool({connectionString:url.href,ssl:false,max:1,connectionTimeoutMillis:2000,statement_timeout:1000,application_name:'r16-neutral-wait-sampler'});
  origin=BigInt(m.origin);ids=m.pids;const check=await pool.query('SELECT current_database() database');if(check.rows[0]?.database!==m.database)throw Error('denied');send({kind:'ready'});
  const sample=async()=>{if(stopped)return;try{const result=await pool.query(`SELECT pid,wait_event_type,wait_event,pg_blocking_pids(pid) blocking_pids FROM pg_stat_activity WHERE datname=$1 AND pid=ANY($2::int[])`,[m.database,ids]);send({kind:'waits',at_ms:Number(process.hrtime.bigint()-origin)/1e6,rows:result.rows.map(safeWaitRow)});}catch{send({kind:'failed'});}if(!stopped)timer=setTimeout(()=>{void sample();},250);};void sample();
 }catch{send({kind:'failed'});await close();}});
}
if(process.argv.includes('--sampler'))await sampler();
