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
type DmlPlanQuerySpecV1={label:string;batch_unit:DmlPlanUnitV1;values_count:number;batch_value_index:number;batch_kind:'array'|'json_array';function_stats?:true};
const DML_PLAN_QUERY_SPECS=new Map<string,DmlPlanQuerySpecV1>([
 ['sha256:1e5b3d3837b8c7354d6c25d941461f0d36e55d5cc3d42cbd31c627ba0662859b',
  {label:'mark_submitting',batch_unit:'call_ids',values_count:2,batch_value_index:1,batch_kind:'array'}],
 ['sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7',
  {label:'listening_answers_insert',batch_unit:'answer_rows',values_count:4,batch_value_index:3,batch_kind:'json_array',function_stats:true}],
 ['sha256:4ece6654c82e3d48416690d80208f849288cd5cfed5e16f0464dd3accfba33dd',
  {label:'reserve_calls_insert',batch_unit:'call_proposals',values_count:8,batch_value_index:5,batch_kind:'json_array'}],
]);
const SAFE_DML_TRIGGER_NAMES=new Set(['aac_signal_study_call_guard','listening_human_new_call_guard','listening_statement_money_insert','listening_statement_money_update',
 'mass_labeling_call_root','mass_labeling_scoped_insert_total','mass_labeling_scoped_money','mass_labeling_scoped_update_total','signal_listening_answer_guard',
 'signal_listening_call_guard','signal_listening_link_call','signal_study_jev_link','z_listening_discovery_child_capacity']);
const SAFE_FUNCTION_STAT_SIGNATURES=[
 'public.signal_listening_answer_guard_v1()',
 'public.signal_listening_root_right_v1(uuid, uuid, text)',
 'public.signal_processing_lock_actor_v1(uuid, uuid, boolean)',
 'public.signal_processing_actor_v1(uuid, uuid)',
] as const;
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
type FunctionStatsDeltaV1={signature:string;status:'captured'|'function_absent'|'stats_unobserved'|'lookup_unobserved';
 baseline:'observed_before'|'transaction_local_row_absent_zero_before_dml'|null;calls:number|null;total_time_ms:number|null;self_time_ms:number|null};
type FunctionStatsArtifactV1={status:'captured'|'setup_unavailable';read_before_ms:number|null;read_after_ms:number|null;
 total_time_inclusive:true;self_time_excludes_nested_calls:true;overhead_measured:false;capacity_claim:false;deltas:FunctionStatsDeltaV1[]};
type ActorNestedPlanV1={query_text_sha256:string|null;planning_time_ms:number|null;execution_time_ms:number|null;plan:Record<string,unknown>};
type ActorQueryPhaseV1={query_hash:string;explain_plan:{planning_time_ms:number|null;execution_time_ms:number|null;plan:Record<string,unknown>}|null;
 nested_plans:ActorNestedPlanV1[];plan_notices_seen:number;plans_dropped:number;query_wall_ms:number};
type ActorFunctionDiagnosticV1={status:'captured'|'scope_unavailable';reason?:'call_scope_unavailable'|'transaction_scope_unverified';
 call_ids_count:number;calls_resolved_count:number;function_call:ActorQueryPhaseV1|null;equivalent_body:ActorQueryPhaseV1|null;
 setup_ms:number;scope_lookup_ms:number;cleanup_ms:number;lock_timeout_ms:1000;statement_timeout_ms:15000;nested_plan_limit:8;
 timing_on:true;query_wall_includes_nested:true;analyze_overhead_measured:false;capacity_claim:false};
export type DmlPlanObservationV1=({query_hash:string;label:string;batch_size:number;batch_unit:DmlPlanUnitV1;status:'setup_unavailable';
 reason:'transaction_scope_unverified'|'auto_explain_load_unavailable'|'capture_setup_unavailable';plans:DmlPlanV1[];plan_notices_seen:number;plans_dropped:number;
 triggers_omitted_count:number;triggers_unknown_time_count:number;analyze_timing_enabled:false;function_stats?:FunctionStatsArtifactV1}&DmlPlanTimingV1)|({query_hash:string;label:string;batch_size:number;batch_unit:DmlPlanUnitV1;status:'captured'|'plan_notice_unavailable';
 plans:DmlPlanV1[];plan_notices_seen:number;plans_dropped:number;triggers_omitted_count:number;triggers_unknown_time_count:number;analyze_timing_enabled:true;
 function_stats?:FunctionStatsArtifactV1;actor_function_diagnostic?:ActorFunctionDiagnosticV1;analyze_timing_overhead_measured:false}&DmlPlanTimingV1);
function dmlCaptureGucs(prior:Map<string,string>){
 return[
  ['auto_explain.log_min_duration','-1'],
  ...DML_AUTO_EXPLAIN_GUCS.filter(name=>name!=='auto_explain.log_min_duration').map(name=>[name,prior.get(name)!] as const),
  ...DML_BASE_GUCS.map(name=>[name,prior.get(name)!] as const),
  ...(['lock_timeout','statement_timeout'] as const).filter(name=>prior.has(name)).map(name=>[name,prior.get(name)!] as const),
  ...(prior.has('track_functions')?[['track_functions',prior.get('track_functions')!] as const]:[]),
  ['auto_explain.log_min_duration',prior.get('auto_explain.log_min_duration')!],
 ] as const;
}
type FunctionStatsRowV1={function_present:boolean|null;stats_observed:boolean;calls:number|null;total_time_ms:number|null;self_time_ms:number|null};
async function readFunctionStatsV1(client:any):Promise<Map<string,FunctionStatsRowV1>>{
 const result=await client.query(`WITH requested(signature) AS (SELECT unnest($1::text[])),
  resolved AS (SELECT signature,to_regprocedure(signature)::oid AS function_oid FROM requested)
  SELECT r.signature,(p.oid IS NOT NULL) AS function_present,(f.funcid IS NOT NULL) AS stats_observed,
   f.calls::float8 AS calls,f.total_time::float8 AS total_time_ms,f.self_time::float8 AS self_time_ms
  FROM resolved r LEFT JOIN pg_proc p ON p.oid=r.function_oid
  LEFT JOIN pg_stat_xact_user_functions f ON f.funcid=r.function_oid`,[SAFE_FUNCTION_STAT_SIGNATURES]);
 const stats=new Map<string,FunctionStatsRowV1>();
 for(const row of result.rows??[]){
  if(typeof row?.signature!=='string')continue;
  const signature=row.signature;
  if(!(SAFE_FUNCTION_STAT_SIGNATURES as readonly string[]).includes(signature))continue;
  const function_present=typeof row.function_present==='boolean'?row.function_present:null;
  const calls=Number(row.calls),total_time_ms=Number(row.total_time_ms),self_time_ms=Number(row.self_time_ms);
  const stats_observed=row.stats_observed===true&&row.calls!==null&&row.total_time_ms!==null&&row.self_time_ms!==null&&
   Number.isSafeInteger(calls)&&Number.isFinite(total_time_ms)&&Number.isFinite(self_time_ms);
  stats.set(signature,{function_present,stats_observed,calls:stats_observed?calls:null,total_time_ms:stats_observed?total_time_ms:null,self_time_ms:stats_observed?self_time_ms:null});
 }
 return stats;
}
function functionStatsDeltaV1(before:Map<string,FunctionStatsRowV1>,after:Map<string,FunctionStatsRowV1>):FunctionStatsDeltaV1[]{
 return SAFE_FUNCTION_STAT_SIGNATURES.map(signature=>{const prior=before.get(signature),next=after.get(signature);
  if(!prior||!next||prior.function_present===null||next.function_present===null)
   return{signature,status:'lookup_unobserved',baseline:null,calls:null,total_time_ms:null,self_time_ms:null};
  if(!prior.function_present||!next.function_present)
   return{signature,status:'function_absent',baseline:null,calls:null,total_time_ms:null,self_time_ms:null};
  if(!next.stats_observed||next.calls===null||next.total_time_ms===null||next.self_time_ms===null)
   return{signature,status:'stats_unobserved',baseline:null,calls:null,total_time_ms:null,self_time_ms:null};
  const base:{calls:number;total_time_ms:number;self_time_ms:number}=prior.stats_observed&&prior.calls!==null&&prior.total_time_ms!==null&&prior.self_time_ms!==null
   ?{calls:prior.calls,total_time_ms:prior.total_time_ms,self_time_ms:prior.self_time_ms}:{calls:0,total_time_ms:0,self_time_ms:0};
  return{signature,status:'captured',baseline:prior.stats_observed?'observed_before':'transaction_local_row_absent_zero_before_dml',
   calls:next.calls-base.calls,total_time_ms:next.total_time_ms-base.total_time_ms,self_time_ms:next.self_time_ms-base.self_time_ms};});
}
const ACTOR_FUNCTION_EXPLAIN_SQL='EXPLAIN (ANALYZE,BUFFERS,TIMING ON,FORMAT JSON) SELECT 1 WHERE public.signal_processing_actor_v1($1::uuid,$2::uuid)';
const ACTOR_BODY_EXPLAIN_SQL=`EXPLAIN (ANALYZE,BUFFERS,TIMING ON,FORMAT JSON)
SELECT EXISTS(SELECT 1 FROM public.signal_workspaces w
 JOIN public.brands b ON b.id=w.brand_id AND b.organization_id=w.organization_id
 JOIN public.organizations o ON o.id=w.organization_id
 JOIN public.users u ON u.id=$2::uuid AND u.status='active'
 WHERE w.id=$1::uuid AND w.status='active' AND b.status='active' AND o.status='active'
  AND ((u.user_type='noisia_internal' AND u.primary_role='noisia_admin')
   OR (u.user_type='client' AND u.organization_id=o.id AND u.primary_role='client_admin'
    AND EXISTS(SELECT 1 FROM public.user_brand_access a WHERE a.brand_id=b.id AND a.user_id=u.id
     AND a.revoked_at IS NULL AND a.access_level='admin'))))`;
const ACTOR_NESTED_PLAN_LIMIT=8,ACTOR_CALL_IDS_LIMIT=8192;
const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
function answerCallIdsV1(values:unknown):string[]|null{
 if(!Array.isArray(values)||values.length!==4||typeof values[3]!=='string')return null;
 try{const rows=JSON.parse(values[3]);if(!Array.isArray(rows)||rows.length<1||rows.length>ACTOR_CALL_IDS_LIMIT*2)return null;
  const ids=new Set<string>();for(const row of rows){if(!row||typeof row.call_id!=='string'||!UUID_PATTERN.test(row.call_id))return null;ids.add(row.call_id);}
  return ids.size>0&&ids.size<=ACTOR_CALL_IDS_LIMIT?[...ids]:null;
 }catch{return null;}
}
function safeExplainPlanResult(result:any){
 try{let raw=result?.rows?.[0]?.['QUERY PLAN']??result?.rows?.[0]?.query_plan;if(typeof raw==='string')raw=JSON.parse(raw);const first=Array.isArray(raw)?raw[0]:null;
  const plan=safePlanNode(first?.Plan);if(!plan)return null;
  return{planning_time_ms:typeof first['Planning Time']==='number'&&Number.isFinite(first['Planning Time'])?first['Planning Time']:null,
   execution_time_ms:typeof first['Execution Time']==='number'&&Number.isFinite(first['Execution Time'])?first['Execution Time']:null,plan};
 }catch{return null;}
}
function actorDiagnosticRestoreSettings(prior:Map<string,string>){
 return[['auto_explain.log_min_duration','-1'] as const,
  ...DML_AUTO_EXPLAIN_GUCS.filter(name=>name!=='auto_explain.log_min_duration').map(name=>[name,prior.get(name)!] as const),
  ...DML_BASE_GUCS.map(name=>[name,prior.get(name)!] as const),
  ['lock_timeout',prior.get('lock_timeout')!] as const,['statement_timeout',prior.get('statement_timeout')!] as const,
  ['auto_explain.log_min_duration',prior.get('auto_explain.log_min_duration')!] as const];
}
async function captureActorFunctionDiagnosticV1(args:{client:any;callIds:string[];prior:Map<string,string>;database:string;role:string;env:NodeJS.ProcessEnv;clock:()=>number}):Promise<ActorFunctionDiagnosticV1>{
 const {client,callIds,prior,database,role,env,clock}=args;
 const base={call_ids_count:callIds.length,calls_resolved_count:0,function_call:null,equivalent_body:null,
  setup_ms:0,scope_lookup_ms:0,cleanup_ms:0,lock_timeout_ms:1000 as const,statement_timeout_ms:15000 as const,nested_plan_limit:ACTOR_NESTED_PLAN_LIMIT as 8,
  timing_on:true as const,query_wall_includes_nested:true as const,analyze_overhead_measured:false as const,capacity_claim:false as const};
 if(!dmlPlanCaptureEnvironmentAllowed(env)||database!=='noisia_mfp_ci'||role!=='postgres')return{...base,status:'scope_unavailable',reason:'transaction_scope_unverified'};
 const identity=await client.query(`SELECT current_database() AS database,current_user AS role,
  current_setting('transaction_read_only') AS read_only,r.rolsuper AS superuser
  FROM pg_roles r WHERE r.rolname=current_user`);
 const scope=identity.rows?.[0];if(scope?.database!==database||scope?.role!==role||scope?.read_only!=='off'||scope?.superuser!==true)
  return{...base,status:'scope_unavailable',reason:'transaction_scope_unverified'};
 let primaryError:unknown,restoreError:unknown,lookupMs=0,setupMs=0,cleanupMs=0,context:{workspace_id:string;actor_user_id:string}|null=null;
 let scopeUnavailable=false;
 let functionCall:ActorQueryPhaseV1|null=null,equivalentBody:ActorQueryPhaseV1|null=null,listenerAttached=false;
 const setupStarted=clock();
 const diagnosticSettings:Array<[string,string]>=[
  ['lock_timeout','1s'],['statement_timeout','15s'],['log_min_messages','WARNING'],['client_min_messages','NOTICE'],['log_statement','none'],
  ['log_parameter_max_length','0'],['auto_explain.log_parameter_max_length','0'],['auto_explain.log_level','NOTICE'],['auto_explain.log_min_duration','0'],
  ['auto_explain.log_nested_statements','on'],['auto_explain.log_analyze','on'],['auto_explain.log_buffers','on'],['auto_explain.log_timing','on'],
  ['auto_explain.log_format','json'],['auto_explain.log_verbose','off'],['auto_explain.log_triggers','off'],
 ];
 let planNotices=0,droppedNotices=0;const nestedPlans:ActorNestedPlanV1[]=[];
 const listener=(notice:unknown)=>{const plan=safeAutoExplainNotice(notice);if(!plan)return;planNotices++;
  if(nestedPlans.length<ACTOR_NESTED_PLAN_LIMIT)nestedPlans.push(plan);else droppedNotices++;};
 const runPhase=async(sql:string,values:string[]):Promise<ActorQueryPhaseV1>=>{
  planNotices=0;droppedNotices=0;nestedPlans.length=0;client.on('notice',listener);listenerAttached=true;
  const queryStarted=clock();let result:any;
  try{result=await client.query(sql,values);}finally{client.off('notice',listener);listenerAttached=false;}
  return{query_hash:queryHash(sql)!,explain_plan:safeExplainPlanResult(result),nested_plans:[...nestedPlans],
   plan_notices_seen:planNotices,plans_dropped:droppedNotices,query_wall_ms:clock()-queryStarted};
 };
 try{
  for(const [name,value] of diagnosticSettings)await client.query(`SET LOCAL ${name} = '${value}'`);
  setupMs=clock()-setupStarted;
  const lookupStarted=clock();const resolved=await client.query(`SELECT c.workspace_id::text AS workspace_id,r.actor_user_id::text AS actor_user_id
   FROM signal_labeling_calls c JOIN signal_labeling_runs r ON r.run_id=c.run_id AND r.workspace_id=c.workspace_id
   WHERE c.id=ANY($1::uuid[])
   GROUP BY c.workspace_id,r.actor_user_id,c.run_id
   HAVING count(DISTINCT c.id)=cardinality($1::uuid[]) AND count(DISTINCT c.workspace_id)=1
    AND count(DISTINCT r.actor_user_id)=1 AND count(DISTINCT c.run_id)=1`,[callIds]);
  lookupMs=clock()-lookupStarted;const owner=resolved.rows?.[0];
  if(resolved.rows?.length!==1||!UUID_PATTERN.test(owner?.workspace_id??'')||!UUID_PATTERN.test(owner?.actor_user_id??'')){
   context=null;
  }else context={workspace_id:owner.workspace_id,actor_user_id:owner.actor_user_id};
  if(!context){scopeUnavailable=true;}
  else{
   functionCall=await runPhase(ACTOR_FUNCTION_EXPLAIN_SQL,[context.workspace_id,context.actor_user_id]);
   equivalentBody=await runPhase(ACTOR_BODY_EXPLAIN_SQL,[context.workspace_id,context.actor_user_id]);
  }
 }catch(error){primaryError=error;}
 finally{
  if(listenerAttached)client.off('notice',listener);
  const cleanupStarted=clock();let firstRestoreError:unknown;
  for(const [name,value] of actorDiagnosticRestoreSettings(prior)){try{await client.query('SELECT set_config($1,$2,true)',[name,value]);}catch(error){firstRestoreError??=error;}}
  cleanupMs=clock()-cleanupStarted;restoreError=firstRestoreError;
 }
 const output={...base,calls_resolved_count:context?callIds.length:0,function_call:functionCall,equivalent_body:equivalentBody,
  setup_ms:setupMs,scope_lookup_ms:lookupMs,cleanup_ms:cleanupMs};
 if(primaryError&&restoreError)throw new AggregateError([primaryError,restoreError],'actor_function_diagnostic_and_restore_failed');
 if(primaryError)throw primaryError;if(restoreError)throw restoreError;
 if(!context||scopeUnavailable)return{...output,status:'scope_unavailable',reason:'call_scope_unavailable'};
 return{...output,status:'captured'};
}
/** Instruments one already-issued write only after setup is complete. The setup savepoint is released before the original DML and is never rolled back afterward. */
export async function captureDmlPlanQueryV1(args:{client:any;query:()=>Promise<any>;query_hash:string;batch_size:number;database:string;role:string;env:NodeJS.ProcessEnv;query_values?:unknown;clock?:()=>number}):Promise<{result:any;observation:DmlPlanObservationV1|null}>{
 const {client,query,query_hash,batch_size,database,role,env}=args,spec=dmlPlanQuerySpec(query_hash),clock=args.clock??(()=>performance.now());
 if(!spec||batch_size<DML_PLAN_MIN_BATCH||!dmlPlanCaptureEnvironmentAllowed(env)||database!=='noisia_mfp_ci'||role!=='postgres')
  return{result:await query(),observation:null};
 const plans:DmlPlanV1[]=[];let planNoticesSeen=0,plansDropped=0,triggersOmittedCount=0,triggersUnknownTimeCount=0;
 let savepoint=false,dmlStarted=false,setupStage='savepoint',setupMs=0,queryWallMs=0,cleanupMs=0,prior=new Map<string,string>(),detached=false;
 let functionStatsBefore:Map<string,FunctionStatsRowV1>|null=null,functionStatsReadBeforeMs:number|null=null,functionStatsReadAfterMs:number|null=null;
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
   const captureGucNames=[...DML_BASE_GUCS,...DML_AUTO_EXPLAIN_GUCS,...(spec.function_stats?['track_functions','lock_timeout','statement_timeout']:[])];
   const settings=await client.query(`SELECT name,current_setting(name,true) AS value
    FROM unnest($1::text[]) AS settings(name)`,[captureGucNames]);
   for(const setting of settings.rows??[]){if(typeof setting.name!=='string'||typeof setting.value!=='string')throw Error('dml_capture_settings_unavailable');prior.set(setting.name,setting.value);}
   if(prior.size!==captureGucNames.length)throw Error('dml_capture_settings_unavailable');
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
   if(spec.function_stats){
    setupStage='enable_function_stats';await client.query("SET LOCAL track_functions = 'all'");
    await client.query('SET LOCAL auto_explain.log_min_duration = -1');
    setupStage='read_function_stats_before';const statsStarted=clock();
    try{functionStatsBefore=await readFunctionStatsV1(client);}finally{functionStatsReadBeforeMs=clock()-statsStarted;}
    await client.query(`SET LOCAL auto_explain.log_min_duration = ${DML_PLAN_MIN_DURATION_MS}`);
   }
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
    ...(spec.function_stats?{function_stats:{status:'setup_unavailable' as const,read_before_ms:functionStatsReadBeforeMs,read_after_ms:null,
     total_time_inclusive:true as const,self_time_excludes_nested_calls:true as const,overhead_measured:false as const,capacity_claim:false as const,deltas:[]}}:{}),
    setup_ms:setupMs,query_wall_ms:queryWallMs,cleanup_ms:cleanupMs,setup_cleanup_wall_ms:setupMs+cleanupMs,analyze_timing_overhead_measured:false}};
  }
  setupMs=clock()-setupStarted;dmlStarted=true;
  const queryStarted=clock();const result=await query();queryWallMs=clock()-queryStarted;
  detach();let functionStats:FunctionStatsArtifactV1|undefined,statsReadError:unknown;
  if(spec.function_stats){
   const statsStarted=clock();
   try{const after=await readFunctionStatsV1(client);functionStats={status:'captured',read_before_ms:functionStatsReadBeforeMs,read_after_ms:null,
    total_time_inclusive:true,self_time_excludes_nested_calls:true,overhead_measured:false,capacity_claim:false,deltas:functionStatsDeltaV1(functionStatsBefore!,after)};}
   catch(error){statsReadError=error;}
   finally{functionStatsReadAfterMs=clock()-statsStarted;if(functionStats)functionStats.read_after_ms=functionStatsReadAfterMs;}
  }
  let restoreError:unknown;try{await restoreSettings();}catch(error){restoreError=error;}
  if(statsReadError&&restoreError)throw new AggregateError([statsReadError,restoreError],'function_stats_read_and_restore_failed');
  if(statsReadError)throw statsReadError;
  if(restoreError)throw restoreError;
  let actorFunctionDiagnostic:ActorFunctionDiagnosticV1|undefined;
  if(spec.function_stats&&functionStats&&args.query_values!==undefined){
   const callIds=answerCallIdsV1(args.query_values);
   actorFunctionDiagnostic=callIds?await captureActorFunctionDiagnosticV1({client,callIds,prior,database,role,env,clock}):{
    status:'scope_unavailable',reason:'call_scope_unavailable',call_ids_count:0,calls_resolved_count:0,function_call:null,equivalent_body:null,
    setup_ms:0,scope_lookup_ms:0,cleanup_ms:0,lock_timeout_ms:1000,statement_timeout_ms:15000,nested_plan_limit:8,
    timing_on:true,query_wall_includes_nested:true,analyze_overhead_measured:false,capacity_claim:false};
  }
  return{result,observation:{query_hash,label:spec.label,batch_size,batch_unit:spec.batch_unit,
   status:plans.length?'captured':'plan_notice_unavailable',plans,plan_notices_seen:planNoticesSeen,plans_dropped:plansDropped,triggers_omitted_count:triggersOmittedCount,
   triggers_unknown_time_count:triggersUnknownTimeCount,analyze_timing_enabled:true,...(functionStats?{function_stats:functionStats}:{}),
   ...(actorFunctionDiagnostic?{actor_function_diagnostic:actorFunctionDiagnostic}:{}),
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
   const captured=await captureDmlPlanQueryV1({client:owner,query:()=>owner.query(...args),query_hash:hash!,batch_size:dmlBatch,database:'noisia_mfp_ci',role:'postgres',env:process.env,query_values:args[1]});
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
