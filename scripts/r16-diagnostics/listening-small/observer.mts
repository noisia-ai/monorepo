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
 ['sha256:8ea420589c30b27ac581ade8d7fe31c467e50d5b96abc4a96358a3133b517a66','metadata'],
 ['sha256:8fdf796e82ccd9b4528996c607536f72bd5992946d6d3c21f0daf1700ea97d84','hydrate'],
]);
export const INNER_PLAN_CAPTURE_ORDINALS=[1,2,3,4,5,6,7,8] as const;
const PLAN_NUMBERS=['Plan Rows','Plan Width','Actual Rows','Actual Loops','Startup Cost','Total Cost','Actual Startup Time','Actual Total Time',
 'Shared Hit Blocks','Shared Read Blocks','Shared Dirtied Blocks','Shared Written Blocks','Temp Read Blocks','Temp Written Blocks'];
const PLAN_NAMES=['Node Type','Relation Name','Alias','Index Name','Join Type'];
const SAFE_CTE_NAMES=new Set(['allowed_roots','selected_items','items','prepared','qs','raw_lock_page']);
const PROJECTION_SAFE_CTE_NAMES=new Set(['candidates','sent','reservation_matches','pending','root_metadata','prefix','fitting','fit_matches','projections','projection_rows']);
const MAX_INNER_PLANS_PER_QUERY=32;
export const INNER_PLAN_MIN_DURATION_MS=50;
export const DML_PLAN_MIN_DURATION_MS=50;
export const DML_PLAN_MIN_BATCH=256;
export const DML_PLAN_MAX_PLANS=8;
type FunctionStatsGroupV1='answers'|'canonical'|'raw_pages';
type DmlPlanUnitV1='call_ids'|'answer_rows'|'call_proposals'|'raw_page_members';
type DmlPlanQuerySpecV1={label:string;batch_unit:DmlPlanUnitV1;values_count:number;batch_value_index:number;batch_kind:'array'|'json_array'|'raw_page_context';function_stats?:FunctionStatsGroupV1;min_duration_ms?:0|50};
const DML_PLAN_QUERY_SPECS=new Map<string,DmlPlanQuerySpecV1>([
 ['sha256:1e5b3d3837b8c7354d6c25d941461f0d36e55d5cc3d42cbd31c627ba0662859b',
  {label:'mark_submitting',batch_unit:'call_ids',values_count:2,batch_value_index:1,batch_kind:'array',function_stats:'canonical'}],
 ['sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7',
  {label:'listening_answers_insert',batch_unit:'answer_rows',values_count:4,batch_value_index:3,batch_kind:'json_array',function_stats:'answers'}],
 ['sha256:4ece6654c82e3d48416690d80208f849288cd5cfed5e16f0464dd3accfba33dd',
  {label:'reserve_calls_insert',batch_unit:'call_proposals',values_count:8,batch_value_index:5,batch_kind:'json_array',function_stats:'canonical'}],
 ['sha256:b8180180dfc8340b89511bb2ecf806c6f7bc811c7c257d2a7409915751ec5670',
  {label:'raw_attach_call_lock',batch_unit:'raw_page_members',values_count:3,batch_value_index:-1,batch_kind:'raw_page_context',function_stats:'raw_pages',min_duration_ms:0}],
 ['sha256:92e110090281de57fbeb89a78954883ea71ce54d36e0d871469c34692568e474',
  {label:'raw_attach_call_lock',batch_unit:'raw_page_members',values_count:3,batch_value_index:-1,batch_kind:'raw_page_context',function_stats:'raw_pages',min_duration_ms:0}],
 ['sha256:99746d65e4fad037daa0402f77a11a5677c191c74ef01741a1182cf05e201d20',
  {label:'raw_attach_call_update',batch_unit:'raw_page_members',values_count:3,batch_value_index:-1,batch_kind:'raw_page_context',function_stats:'raw_pages'}],
 ['sha256:f3a9ed08bf4b11ed5ec2a22e8c26663fbf14b2424d0bae8f425036338025cd35',
  {label:'raw_attach_call_update',batch_unit:'raw_page_members',values_count:3,batch_value_index:-1,batch_kind:'raw_page_context',function_stats:'raw_pages'}],
]);
const LEGACY_DML_PLAN_QUERY_HASHES=new Set([
 'sha256:1e5b3d3837b8c7354d6c25d941461f0d36e55d5cc3d42cbd31c627ba0662859b',
 'sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7',
 'sha256:4ece6654c82e3d48416690d80208f849288cd5cfed5e16f0464dd3accfba33dd',
]);
export const SQL_FRONTIER_DML_CAPTURE_LIMIT=5;
export const SQL_FRONTIER_DML_BATCH_LIMIT=4096;
const SAFE_DML_TRIGGER_NAMES=new Set(['aac_signal_study_call_guard','listening_human_new_call_guard','listening_statement_money_insert','listening_statement_money_update',
 'mass_labeling_call_root','mass_labeling_scoped_insert_total','mass_labeling_scoped_money','mass_labeling_scoped_update_total','signal_listening_answer_guard',
 'signal_labeling_raw_page_guard','signal_labeling_raw_page_member_guard','signal_labeling_raw_page_call_guard',
 'signal_listening_call_guard','signal_listening_link_call','signal_study_jev_link','z_listening_discovery_child_capacity']);
const ANSWER_FUNCTION_STAT_SIGNATURES=[
 'public.signal_listening_answer_guard_v1()',
 'public.signal_listening_root_right_v1(uuid, uuid, text)',
 'public.signal_processing_lock_actor_v1(uuid, uuid, boolean)',
 'public.signal_processing_actor_v1(uuid, uuid)',
] as const;
const CANONICAL_FUNCTION_STAT_SIGNATURES=[
 'public.signal_labeling_digest_v1(jsonb)',
 'public.signal_labeling_json_v1(jsonb)',
 'public.signal_listening_statement_roots_v1(uuid[])',
] as const;
const RAW_PAGE_FUNCTION_STAT_SIGNATURES=[
 'public.signal_labeling_raw_page_guard_v1()',
 'public.signal_labeling_raw_page_member_guard_v1()',
 'public.signal_labeling_raw_page_call_guard_v1()',
 'public.signal_listening_call_guard_v1()',
 'public.signal_listening_statement_money_v1()',
 'public.guard_mass_labeling_scoped_money_v1()',
 'public.guard_mass_labeling_scoped_money_total_v1()',
 'public.signal_study_jev_call_guard_v1()',
 'public.signal_listening_discovery_child_capacity_v1()',
] as const;
const functionStatSignatures=(group:FunctionStatsGroupV1):readonly string[]=>group==='answers'?ANSWER_FUNCTION_STAT_SIGNATURES
 :group==='raw_pages'?RAW_PAGE_FUNCTION_STAT_SIGNATURES:CANONICAL_FUNCTION_STAT_SIGNATURES;
// Counts cover this backend's original DML and its triggers, not only expected.
// SQL inlining can hide digest calls; JSON recursion counts are not mention counts.
const FUNCTION_STATS_SCOPE={view:'pg_stat_xact_user_functions',scope:'same_backend_current_transaction_delta',
 measured_work:'original_dml_and_all_triggers',cpu_time:false,sql_inlined_function_tracking:'may_be_unobserved',recursive_calls_are_mentions:false} as const;
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
 if(spec.batch_kind==='raw_page_context')return null;
 const value=(args[1] as unknown[])[spec.batch_value_index];
 if(spec.batch_kind==='array')return Array.isArray(value)?value.length:null;
 if(typeof value!=='string')return null;
 try{const rows=JSON.parse(value);return Array.isArray(rows)?rows.length:null;}catch{return null;}
}
export type RawPageDmlContextV1={operation:string;run_id:string;workspace_id:string;batch_size:number};
export function rawPageDmlContextFromStoreArgsV1(args:unknown[]):RawPageDmlContextV1|null{
 if(args.length!==2||!args[0]||typeof args[0]!=='object'||!Array.isArray(args[1]))return null;
 const run=args[0] as {id?:unknown;workspace_id?:unknown},rows=args[1];
 if(typeof run.id!=='string'||!UUID_PATTERN.test(run.id)||typeof run.workspace_id!=='string'||!UUID_PATTERN.test(run.workspace_id)
  ||rows.length<1||rows.length>SQL_FRONTIER_DML_BATCH_LIMIT)return null;
 const calls=new Set<string>();
 for(const row of rows){const id=(row as {call?:{id?:unknown}}|null)?.call?.id;
  if(typeof id!=='string'||!UUID_PATTERN.test(id)||calls.has(id))return null;calls.add(id);}
 return{operation:'persistRawPage',run_id:run.id,workspace_id:run.workspace_id,batch_size:rows.length};
}
export function rawPageDmlBatchSizeV1(hash:string|null,args:unknown[],context:RawPageDmlContextV1|null|undefined){
 const spec=dmlPlanQuerySpec(hash);if(!spec||spec.batch_kind!=='raw_page_context'||!context||context.operation!=='persistRawPage'
  ||!Number.isSafeInteger(context.batch_size)||context.batch_size<1||context.batch_size>SQL_FRONTIER_DML_BATCH_LIMIT
  ||args.length!==2||queryHash(args[0])!==hash||!Array.isArray(args[1])||args[1].length!==3)return null;
 const [pageId,workspaceId,runId]=args[1];
 if(typeof pageId!=='string'||!UUID_PATTERN.test(pageId)||typeof workspaceId!=='string'||!UUID_PATTERN.test(workspaceId)
  ||typeof runId!=='string'||!UUID_PATTERN.test(runId)||workspaceId!==context.workspace_id||runId!==context.run_id)return null;
 return context.batch_size;
}
export function dmlPlanCaptureEnvironmentAllowed(env:NodeJS.ProcessEnv){
 if(env.GITHUB_ACTIONS!=='true'||env.NOISIA_R16_SMALL_DIAGNOSTIC!=='true'||env.NOISIA_R16_LISTENING_DML_PLAN_PG!=='true'
  ||env.NOISIA_R16_LOCAL_PG_LAB!=='r16-benchmark-pg17')return false;
 try{const url=new URL(env.DATABASE_URL??'');return url.protocol==='postgresql:'&&url.hostname==='127.0.0.1'&&url.pathname==='/noisia_mfp_ci'
   &&url.username==='postgres'&&!!url.port&&!url.search&&!url.hash;}catch{return false;}
}
function safeName(value:unknown){return typeof value==='string'&&/^[A-Za-z_][A-Za-z0-9_$]{0,127}$/u.test(value)?value:'redacted';}
function safePlanNode(value:any,depth=0,extraCteNames:ReadonlySet<string>=new Set()):any{
 if(depth>128)return null;
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const result:Record<string,unknown>={};
 for(const key of PLAN_NAMES)if(value[key]!==undefined)result[key]=key==='Node Type'
  ?(typeof value[key]==='string'&&SAFE_NODE_TYPES.has(value[key])?value[key]:'redacted'):safeName(value[key]);
 for(const key of ['CTE Name','Subplan Name'])if(typeof value[key]==='string'&&(SAFE_CTE_NAMES.has(value[key])||extraCteNames.has(value[key])))result[key]=value[key];
 for(const key of PLAN_NUMBERS)if(typeof value[key]==='number'&&Number.isFinite(value[key]))result[key]=value[key];
 for(const key of ['Parallel Aware','Async Capable'])if(typeof value[key]==='boolean')result[key]=value[key];
 if(Array.isArray(value.Plans)){const children=value.Plans.map((child:any)=>safePlanNode(child,depth+1,extraCteNames));if(children.some((child:any)=>!child))return null;result.Plans=children;}
 return result;
}
export type AutoExplainNoticeRejectReasonV1='message_missing'|'message_too_large'|'payload_missing'|'invalid_json'|'plan_invalid';
export type AutoExplainNoticeParseV1={status:'accepted';query_text_sha256:string|null;planning_time_ms:number|null;execution_time_ms:number|null;plan:Record<string,unknown>}|{status:'rejected';reason:AutoExplainNoticeRejectReasonV1};
/** Parses the NOTICE only in memory. Raw PostgreSQL messages and text fields are never retained. */
export function classifyAutoExplainNoticeV1(notice:unknown,extraCteNames:ReadonlySet<string>=new Set()):AutoExplainNoticeParseV1{
 const message=(notice as {message?:unknown}|null)?.message;
 if(typeof message!=='string')return{status:'rejected',reason:'message_missing'};
 if(message.length>1_000_000)return{status:'rejected',reason:'message_too_large'};
 const start=message.indexOf('{');if(start<0)return{status:'rejected',reason:'payload_missing'};
 let parsed:unknown;
 try{
  parsed=JSON.parse(message.slice(start));
 }catch{return{status:'rejected',reason:'invalid_json'};}
 try{
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return{status:'rejected',reason:'plan_invalid'};
  const payload=parsed as Record<string,unknown>,plan=safePlanNode(payload.Plan,0,extraCteNames);if(!plan)return{status:'rejected',reason:'plan_invalid'};
  const queryText=typeof payload['Query Text']==='string'?payload['Query Text']:null;
  return{status:'accepted',query_text_sha256:queryText?`sha256:${createHash('sha256').update(queryText,'utf8').digest('hex')}`:null,
   planning_time_ms:typeof payload['Planning Time']==='number'&&Number.isFinite(payload['Planning Time'])?payload['Planning Time']:null,
   execution_time_ms:typeof payload['Execution Time']==='number'&&Number.isFinite(payload['Execution Time'])?payload['Execution Time']:null,plan};
 }catch{return{status:'rejected',reason:'plan_invalid'};}
}
export function safeAutoExplainNotice(notice:unknown){
 const classified=classifyAutoExplainNoticeV1(notice);if(classified.status==='rejected')return null;
 return{query_text_sha256:classified.query_text_sha256,planning_time_ms:classified.planning_time_ms,execution_time_ms:classified.execution_time_ms,plan:classified.plan};
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
type DmlPlanV1={sequence:number;query_text_sha256:string|null;planning_time_ms:number|null;execution_time_ms:number|null;frontier_role?:'outer'|'nested';
 plan:Record<string,unknown>;triggers:Array<{name:string;relation:string|null;time_ms:number|null;calls:number}>;triggers_seen:number;triggers_omitted:number;triggers_unknown_time:number};
type DmlPlanTimingV1={setup_ms:number;query_wall_ms:number;cleanup_ms:number;setup_cleanup_wall_ms:number;analyze_timing_overhead_measured:false};
type FunctionStatsDeltaV1={signature:string;status:'captured'|'function_absent'|'stats_unobserved'|'lookup_unobserved'|'counter_invalid';
 baseline:'observed_before'|'transaction_local_row_absent_zero_before_dml'|null;calls:number|null;total_time_ms:number|null;self_time_ms:number|null};
type FunctionStatsArtifactV1=typeof FUNCTION_STATS_SCOPE&{status:'captured'|'setup_unavailable';read_before_ms:number|null;read_after_ms:number|null;
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
 triggers_omitted_count:number;triggers_unknown_time_count:number;analyze_timing_enabled:false;function_stats?:FunctionStatsArtifactV1;outer_plan_status?:'captured'|'unknown';nested_plan_limit?:8}&DmlPlanTimingV1&Partial<DmlNoticeDiagnosticsV1>)|({query_hash:string;label:string;batch_size:number;batch_unit:DmlPlanUnitV1;status:'captured'|'plan_notice_unavailable';
 plans:DmlPlanV1[];plan_notices_seen:number;plans_dropped:number;triggers_omitted_count:number;triggers_unknown_time_count:number;analyze_timing_enabled:true;
 function_stats?:FunctionStatsArtifactV1;actor_function_diagnostic?:ActorFunctionDiagnosticV1;outer_plan_status?:'captured'|'unknown';nested_plan_limit?:8;analyze_timing_overhead_measured:false}&DmlPlanTimingV1&Partial<DmlNoticeDiagnosticsV1>);
type NoticePhaseV1='setup'|'original_query'|'after_query'|'cleanup';
type DmlNoticeDiagnosticsV1={raw_notice_count_by_phase:Record<NoticePhaseV1,number>;rejected_notice_count_by_phase:Record<NoticePhaseV1,Partial<Record<AutoExplainNoticeRejectReasonV1,number>>>;
 accepted_outer_count_by_phase:Record<NoticePhaseV1,number>;accepted_nested_count_by_phase:Record<NoticePhaseV1,number>;accepted_unattributed_count_by_phase:Record<NoticePhaseV1,number>;
 capped_notice_count_by_phase:Record<NoticePhaseV1,number>;after_query_drain_ms:number;guc_readback:{status:'captured'|'unknown';settings:Record<string,string|null>}};
const DML_NOTICE_READBACK_GUCS=['client_min_messages','log_statement','log_parameter_max_length','auto_explain.log_parameter_max_length','auto_explain.log_level',
 'auto_explain.log_min_duration','auto_explain.log_nested_statements','auto_explain.log_analyze','auto_explain.log_buffers','auto_explain.log_timing',
 'auto_explain.log_format','auto_explain.log_verbose','auto_explain.log_triggers','auto_explain.sample_rate'] as const;
function safeGucReadbackValue(name:string,value:unknown):string|null{
 if(typeof value!=='string')return null;
 const lower=value.toLowerCase();
 if(name.endsWith('log_level')||name==='client_min_messages'||name==='log_min_messages')return /^(debug5|debug4|debug3|debug2|debug1|log|notice|warning|error|fatal|panic)$/u.test(lower)?lower:null;
 if(name.endsWith('log_format'))return /^(text|xml|json|yaml)$/u.test(lower)?lower:null;
 if(name.endsWith('log_statement'))return /^(none|ddl|mod|all)$/u.test(lower)?lower:null;
 if(name.endsWith('log_nested_statements')||name.endsWith('log_analyze')||name.endsWith('log_buffers')||name.endsWith('log_timing')
  ||name.endsWith('log_verbose')||name.endsWith('log_triggers'))return /^(on|off|true|false|1|0)$/u.test(lower)?lower:null;
 if(name.endsWith('sample_rate')){const n=Number(value);return Number.isFinite(n)&&n>=0&&n<=1?String(n):null;}
 if(name.endsWith('log_min_duration'))return /^-?\d+(?:\.\d+)?(?:ms|s|min|h|d)?$/u.test(lower)?lower:null;
 if(name.endsWith('log_parameter_max_length'))return /^-?\d+$/u.test(lower)?lower:null;
 return null;
}
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
type FunctionStatsRowV1={function_present:boolean|null;stats_observed:boolean;counter_invalid:boolean;calls:number|null;total_time_ms:number|null;self_time_ms:number|null};
async function readFunctionStatsV1(client:any,group:FunctionStatsGroupV1):Promise<Map<string,FunctionStatsRowV1>>{
 const signatures=functionStatSignatures(group);
 const result=await client.query(`WITH requested(signature) AS (SELECT unnest($1::text[])),
  resolved AS (SELECT signature,to_regprocedure(signature)::oid AS function_oid FROM requested)
  SELECT r.signature,(p.oid IS NOT NULL) AS function_present,(f.funcid IS NOT NULL) AS stats_observed,
   f.calls::float8 AS calls,f.total_time::float8 AS total_time_ms,f.self_time::float8 AS self_time_ms
  FROM resolved r LEFT JOIN pg_proc p ON p.oid=r.function_oid
  LEFT JOIN pg_stat_xact_user_functions f ON f.funcid=r.function_oid`,[signatures]);
 const stats=new Map<string,FunctionStatsRowV1>();
 for(const row of result.rows??[]){
  if(typeof row?.signature!=='string')continue;
  const signature=row.signature;
  if(!signatures.includes(signature))continue;
  const function_present=typeof row.function_present==='boolean'?row.function_present:null;
  const calls=Number(row.calls),total_time_ms=Number(row.total_time_ms),self_time_ms=Number(row.self_time_ms);
  const stats_observed=row.stats_observed===true&&row.calls!==null&&row.total_time_ms!==null&&row.self_time_ms!==null&&
   Number.isSafeInteger(calls)&&calls>=0&&Number.isFinite(total_time_ms)&&total_time_ms>=0&&Number.isFinite(self_time_ms)&&self_time_ms>=0;
  stats.set(signature,{function_present,stats_observed,counter_invalid:row.stats_observed===true&&!stats_observed,calls:stats_observed?calls:null,total_time_ms:stats_observed?total_time_ms:null,self_time_ms:stats_observed?self_time_ms:null});
 }
 return stats;
}
function functionStatsDeltaV1(before:Map<string,FunctionStatsRowV1>,after:Map<string,FunctionStatsRowV1>,group:FunctionStatsGroupV1):FunctionStatsDeltaV1[]{
 return functionStatSignatures(group).map(signature=>{const prior=before.get(signature),next=after.get(signature);
  if(!prior||!next||prior.function_present===null||next.function_present===null)
   return{signature,status:'lookup_unobserved',baseline:null,calls:null,total_time_ms:null,self_time_ms:null};
  if(!prior.function_present||!next.function_present)
   return{signature,status:'function_absent',baseline:null,calls:null,total_time_ms:null,self_time_ms:null};
  if(prior.counter_invalid||next.counter_invalid)
   return{signature,status:'counter_invalid',baseline:null,calls:null,total_time_ms:null,self_time_ms:null};
  if(!next.stats_observed||next.calls===null||next.total_time_ms===null||next.self_time_ms===null)
   return{signature,status:'stats_unobserved',baseline:null,calls:null,total_time_ms:null,self_time_ms:null};
  const base:{calls:number;total_time_ms:number;self_time_ms:number}=prior.stats_observed&&prior.calls!==null&&prior.total_time_ms!==null&&prior.self_time_ms!==null
   ?{calls:prior.calls,total_time_ms:prior.total_time_ms,self_time_ms:prior.self_time_ms}:{calls:0,total_time_ms:0,self_time_ms:0};
  if(next.calls<base.calls||next.total_time_ms<base.total_time_ms||next.self_time_ms<base.self_time_ms)
   return{signature,status:'counter_invalid',baseline:null,calls:null,total_time_ms:null,self_time_ms:null};
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
export const PROJECTION_METADATA_QUERY_HASH_V1='sha256:623ea62b8c7f51acab4551632bfd2518d58ed70cce110afce59914d175981bd3';
export const PROJECTION_LINEAR_METADATA_QUERY_HASH_V1='sha256:e2a1d2ae7cc6917e1b58de56e7d3a2ad108e902feeb46d5d1dd1559644421f42';
export const PROJECTION_METADATA_MIN_BATCH_V1=1024;
export const PROJECTION_METADATA_MAX_BATCH_V1=4096;
/** Read only the shape of the real nine-bind input projection query; never retain its binds. */
export function projectionMetadataBatchSizeV1(hash:string|null,args:unknown[],allowLinear=false){
 if((hash!==PROJECTION_METADATA_QUERY_HASH_V1&&(!allowLinear||hash!==PROJECTION_LINEAR_METADATA_QUERY_HASH_V1))
  ||args.length!==2||queryHash(args[0])!==hash||!Array.isArray(args[1]))return null;
 const values=args[1] as unknown[];
 if(values.length!==9||![0,1,2,4].every(index=>typeof values[index]==='string'&&UUID_PATTERN.test(values[index] as string))
  ||typeof values[3]!=='string'||values[3].length<1||values[3].length>256
  ||!Number.isSafeInteger(values[5])||Number(values[5])<PROJECTION_METADATA_MIN_BATCH_V1||Number(values[5])>PROJECTION_METADATA_MAX_BATCH_V1
  ||!Number.isSafeInteger(values[6])||Number(values[6])<1||!Array.isArray(values[7])
  ||typeof values[8]!=='string'||!/^\d{1,30}$/u.test(values[8]))return null;
 const ids=values[7] as unknown[];
 if(ids.length<PROJECTION_METADATA_MIN_BATCH_V1||ids.length>PROJECTION_METADATA_MAX_BATCH_V1)return null;
 const seen=new Set<string>();for(const id of ids){if(typeof id!=='string'||!UUID_PATTERN.test(id)||seen.has(id))return null;seen.add(id);}
 try{if(BigInt(values[8] as string)<0n)return null;}catch{return null;}
 return ids.length;
}
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
   FROM signal_labeling_calls c JOIN signal_labeling_runs r ON r.id=c.run_id AND r.workspace_id=c.workspace_id
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
export async function captureDmlPlanQueryV1(args:{client:any;query:()=>Promise<any>;query_hash:string;batch_size:number;database:string;role:string;env:NodeJS.ProcessEnv;query_values?:unknown;sql_frontier_only?:boolean;outer_query_text?:string;clock?:()=>number}):Promise<{result:any;observation:DmlPlanObservationV1|null}>{
 const {client,query,query_hash,batch_size,database,role,env}=args,spec=dmlPlanQuerySpec(query_hash),clock=args.clock??(()=>performance.now());
 if(!spec||batch_size<DML_PLAN_MIN_BATCH||!dmlPlanCaptureEnvironmentAllowed(env)||database!=='noisia_mfp_ci'||role!=='postgres')
  return{result:await query(),observation:null};
 const minDurationMs=spec.min_duration_ms??DML_PLAN_MIN_DURATION_MS;
 const plans:DmlPlanV1[]=[];let planNoticesSeen=0,plansDropped=0,triggersOmittedCount=0,triggersUnknownTimeCount=0,nestedPlansStored=0,outerPlanCaptured=false;
 let noticePhase:NoticePhaseV1='setup',afterQueryDrainMs=0;const phases:NoticePhaseV1[]=['setup','original_query','after_query','cleanup'];
 const rawNoticeCountByPhase=Object.fromEntries(phases.map(phase=>[phase,0])) as Record<NoticePhaseV1,number>;
 const rejectedNoticeCountByPhase=Object.fromEntries(phases.map(phase=>[phase,{}])) as DmlNoticeDiagnosticsV1['rejected_notice_count_by_phase'];
 const acceptedOuterCountByPhase=Object.fromEntries(phases.map(phase=>[phase,0])) as Record<NoticePhaseV1,number>;
 const acceptedNestedCountByPhase=Object.fromEntries(phases.map(phase=>[phase,0])) as Record<NoticePhaseV1,number>;
 const acceptedUnattributedCountByPhase=Object.fromEntries(phases.map(phase=>[phase,0])) as Record<NoticePhaseV1,number>;
 const cappedNoticeCountByPhase=Object.fromEntries(phases.map(phase=>[phase,0])) as Record<NoticePhaseV1,number>;
 const gucReadback:{status:'captured'|'unknown';settings:Record<string,string|null>}={status:'unknown',settings:Object.fromEntries(DML_NOTICE_READBACK_GUCS.map(name=>[name,null]))};
 const noticeDiagnostics=():DmlNoticeDiagnosticsV1=>({raw_notice_count_by_phase:{...rawNoticeCountByPhase},rejected_notice_count_by_phase:Object.fromEntries(phases.map(phase=>[phase,{...rejectedNoticeCountByPhase[phase]}])) as DmlNoticeDiagnosticsV1['rejected_notice_count_by_phase'],
  accepted_outer_count_by_phase:{...acceptedOuterCountByPhase},accepted_nested_count_by_phase:{...acceptedNestedCountByPhase},accepted_unattributed_count_by_phase:{...acceptedUnattributedCountByPhase},
  capped_notice_count_by_phase:{...cappedNoticeCountByPhase},after_query_drain_ms:afterQueryDrainMs,guc_readback:{status:gucReadback.status,settings:{...gucReadback.settings}}});
 const outerQueryTextHash=args.sql_frontier_only&&args.outer_query_text?`sha256:${createHash('sha256').update(args.outer_query_text,'utf8').digest('hex')}`:null;
 let savepoint=false,dmlStarted=false,setupStage='savepoint',setupMs=0,queryWallMs=0,cleanupMs=0,prior=new Map<string,string>(),detached=false;
 let functionStatsBefore:Map<string,FunctionStatsRowV1>|null=null,functionStatsReadBeforeMs:number|null=null,functionStatsReadAfterMs:number|null=null;
 const onNotice=(notice:unknown)=>{const phase=noticePhase;rawNoticeCountByPhase[phase]++;
  const parsed=classifyAutoExplainNoticeV1(notice);if(parsed.status==='rejected'){
   const counts=rejectedNoticeCountByPhase[phase];counts[parsed.reason]=(counts[parsed.reason]??0)+1;return;}
  const plan=safeDmlAutoExplainNotice(notice);if(!plan){const counts=rejectedNoticeCountByPhase[phase];counts.plan_invalid=(counts.plan_invalid??0)+1;return;}
  planNoticesSeen++;triggersOmittedCount+=plan.triggers_omitted;triggersUnknownTimeCount+=plan.triggers_unknown_time;
  const isOuter=outerQueryTextHash!==null&&plan.query_text_sha256===outerQueryTextHash;
  if(phase==='after_query'&&isOuter){acceptedOuterCountByPhase[phase]++;if(outerPlanCaptured){plansDropped++;cappedNoticeCountByPhase[phase]++;return;}
   outerPlanCaptured=true;plans.push({sequence:planNoticesSeen,...plan,frontier_role:'outer'});return;}
  if(phase!=='original_query'){acceptedUnattributedCountByPhase[phase]++;return;}
  if(isOuter){acceptedOuterCountByPhase[phase]++;if(outerPlanCaptured){plansDropped++;cappedNoticeCountByPhase[phase]++;return;}
   outerPlanCaptured=true;plans.push({sequence:planNoticesSeen,...plan,frontier_role:'outer'});return;}
  if(args.sql_frontier_only){acceptedNestedCountByPhase[phase]++;if(nestedPlansStored<DML_PLAN_MAX_PLANS){nestedPlansStored++;plans.push({sequence:planNoticesSeen,...plan,frontier_role:'nested'});}else{plansDropped++;cappedNoticeCountByPhase[phase]++;}return;}
  acceptedUnattributedCountByPhase[phase]++;if(plans.length<DML_PLAN_MAX_PLANS)plans.push({sequence:planNoticesSeen,...plan});else{plansDropped++;cappedNoticeCountByPhase[phase]++;}};
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
   const captureGucNames=[...DML_BASE_GUCS,...DML_AUTO_EXPLAIN_GUCS,...(args.sql_frontier_only?['auto_explain.sample_rate']:[]),...(spec.function_stats?['track_functions','lock_timeout','statement_timeout']:[])];
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
   await client.query(`SET LOCAL auto_explain.log_min_duration = ${minDurationMs}`);
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
    try{functionStatsBefore=await readFunctionStatsV1(client,spec.function_stats);}finally{functionStatsReadBeforeMs=clock()-statsStarted;}
    await client.query(`SET LOCAL auto_explain.log_min_duration = ${minDurationMs}`);
   }
   await client.query('RELEASE SAVEPOINT r16_dml_plan_capture_v1');savepoint=false;
   if(args.sql_frontier_only)try{
    await client.query('SAVEPOINT r16_dml_guc_readback_v1');
    const settings:Record<string,string|null>={};
    for(const name of DML_NOTICE_READBACK_GUCS){const shown=await client.query(`SHOW ${name}`);const row=shown.rows?.[0];
     const value=row&&typeof row==='object'?Object.values(row)[0]:null;settings[name]=safeGucReadbackValue(name,value);gucReadback.settings[name]=settings[name]!;}
    await client.query('RELEASE SAVEPOINT r16_dml_guc_readback_v1');
    gucReadback.settings=settings;gucReadback.status=Object.values(settings).every(value=>value!==null)?'captured':'unknown';
   }catch{gucReadback.status='unknown';try{await client.query('ROLLBACK TO SAVEPOINT r16_dml_guc_readback_v1');await client.query('RELEASE SAVEPOINT r16_dml_guc_readback_v1');}catch{}}
  }catch{
   setupMs=clock()-setupStarted;
   await rollbackSetup();detach();
   const queryStarted=clock();const original=await query();queryWallMs=clock()-queryStarted;
   const reason=setupStage==='verify_transaction_scope'?'transaction_scope_unverified':setupStage==='load_auto_explain'
    ?'auto_explain_load_unavailable':'capture_setup_unavailable';
   return{result:original,observation:{query_hash,label:spec.label,batch_size,batch_unit:spec.batch_unit,
    status:'setup_unavailable',reason,plans,plan_notices_seen:planNoticesSeen,plans_dropped:plansDropped,triggers_omitted_count:triggersOmittedCount,
    triggers_unknown_time_count:triggersUnknownTimeCount,analyze_timing_enabled:false,
    ...(args.sql_frontier_only?{outer_plan_status:'unknown' as const,nested_plan_limit:DML_PLAN_MAX_PLANS as 8}:{}),
    ...(spec.function_stats?{function_stats:{...FUNCTION_STATS_SCOPE,status:'setup_unavailable' as const,read_before_ms:functionStatsReadBeforeMs,read_after_ms:null,
     total_time_inclusive:true as const,self_time_excludes_nested_calls:true as const,overhead_measured:false as const,capacity_claim:false as const,deltas:[]}}:{}),
   setup_ms:setupMs,query_wall_ms:queryWallMs,cleanup_ms:cleanupMs,setup_cleanup_wall_ms:setupMs+cleanupMs,analyze_timing_overhead_measured:false,...(args.sql_frontier_only?noticeDiagnostics():{})}};
  }
  setupMs=clock()-setupStarted;dmlStarted=true;
  noticePhase='original_query';const queryStarted=clock();let result:any;
  try{result=await query();}finally{queryWallMs=clock()-queryStarted;noticePhase=args.sql_frontier_only?'after_query':'cleanup';}
  if(args.sql_frontier_only){const noticeDrainStarted=clock();await new Promise<void>(resolve=>setImmediate(resolve));afterQueryDrainMs=clock()-noticeDrainStarted;}
  else detach();
  let functionStats:FunctionStatsArtifactV1|undefined,statsReadError:unknown;
  if(spec.function_stats){
   noticePhase='cleanup';
   const statsStarted=clock();
   try{const after=await readFunctionStatsV1(client,spec.function_stats);functionStats={...FUNCTION_STATS_SCOPE,status:'captured',read_before_ms:functionStatsReadBeforeMs,read_after_ms:null,
    total_time_inclusive:true,self_time_excludes_nested_calls:true,overhead_measured:false,capacity_claim:false,deltas:functionStatsDeltaV1(functionStatsBefore!,after,spec.function_stats)};}
   catch(error){statsReadError=error;}
   finally{functionStatsReadAfterMs=clock()-statsStarted;if(functionStats)functionStats.read_after_ms=functionStatsReadAfterMs;}
  }
  noticePhase='cleanup';detach();
  let restoreError:unknown;try{await restoreSettings();}catch(error){restoreError=error;}
  if(statsReadError&&restoreError)throw new AggregateError([statsReadError,restoreError],'function_stats_read_and_restore_failed');
  if(statsReadError)throw statsReadError;
  if(restoreError)throw restoreError;
  let actorFunctionDiagnostic:ActorFunctionDiagnosticV1|undefined;
  if(spec.function_stats==='answers'&&functionStats&&args.query_values!==undefined){
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
   ...(args.sql_frontier_only?{outer_plan_status:outerPlanCaptured?'captured' as const:'unknown' as const,nested_plan_limit:DML_PLAN_MAX_PLANS as 8}:{}),
   setup_ms:setupMs,query_wall_ms:queryWallMs,cleanup_ms:cleanupMs,setup_cleanup_wall_ms:setupMs+cleanupMs,analyze_timing_overhead_measured:false,...(args.sql_frontier_only?noticeDiagnostics():{})}};
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
type ProjectionNoticePhaseV1='setup'|'original_query'|'after_query'|'cleanup';
type ProjectionPlanV1={sequence:number;query_text_sha256:string|null;planning_time_ms:number|null;execution_time_ms:number|null;
 frontier_role:'outer'|'nested';plan:Record<string,unknown>};
type ProjectionGucReadbackV1={status:'captured'|'unknown';settings:Record<string,string|null>};
type ProjectionPlanObservationV1={query_hash:string;label:'bounded_input_projection_metadata';batch_size:number;status:'captured'|'capture_unknown'|'setup_unavailable';
 reason?:'transaction_scope_unverified'|'auto_explain_load_unavailable'|'capture_setup_unavailable'|'guc_readback_unavailable'|'outer_plan_unobserved';plans:ProjectionPlanV1[];plan_notices_seen:number;plans_dropped:number;
 raw_notice_count_by_phase:Record<ProjectionNoticePhaseV1,number>;
 rejected_notice_count_by_phase:Record<ProjectionNoticePhaseV1,Partial<Record<AutoExplainNoticeRejectReasonV1,number>>>;
 accepted_outer_count_by_phase:Record<ProjectionNoticePhaseV1,number>;accepted_nested_count_by_phase:Record<ProjectionNoticePhaseV1,number>;
 accepted_unattributed_count_by_phase:Record<ProjectionNoticePhaseV1,number>;capped_notice_count_by_phase:Record<ProjectionNoticePhaseV1,number>;
 after_query_drain_ms:number;guc_readback:ProjectionGucReadbackV1;setup_ms:number;query_wall_ms:number;cleanup_ms:number;
 analyze_timing_overhead_measured:false;capacity_claim:false};
const PROJECTION_READBACK_GUCS=['log_min_messages','client_min_messages','log_statement','log_parameter_max_length','auto_explain.log_parameter_max_length',
 'auto_explain.log_level','auto_explain.log_min_duration','auto_explain.log_nested_statements','auto_explain.log_analyze',
 'auto_explain.log_buffers','auto_explain.log_timing','auto_explain.log_format','auto_explain.log_verbose','auto_explain.sample_rate'] as const;
const PROJECTION_EXPECTED_GUCS:Record<string,string>={log_min_messages:'warning',client_min_messages:'notice',log_statement:'none',log_parameter_max_length:'0',
 'auto_explain.log_parameter_max_length':'0','auto_explain.log_level':'notice','auto_explain.log_min_duration':'50ms',
 'auto_explain.log_nested_statements':'on','auto_explain.log_analyze':'on','auto_explain.log_buffers':'on','auto_explain.log_timing':'off',
 'auto_explain.log_format':'json','auto_explain.log_verbose':'off','auto_explain.sample_rate':'1'};
/** One exact, bounded RR/RO projection SELECT. Setup/readback failure falls back to its original call exactly once. */
export async function captureReadonlyProjectionPlanV1(args:{client:any;query:()=>Promise<any>;query_hash:string;batch_size:number;outer_query_text:string;
 database:string;role:string;env:NodeJS.ProcessEnv;clock?:()=>number}):Promise<{result:any;observation:ProjectionPlanObservationV1|null}>{
 const {client,query,query_hash,batch_size,outer_query_text,database,role,env}=args,clock=args.clock??(()=>performance.now());
 const targetRef=env.R16_DIAGNOSTIC_TARGET_REF_REQUESTED??'';
 const linearEvidence=env.R16_DIAGNOSTIC_PROJECTION_LINEAR_ORACLE==='true'&&env.LINEAR_ACCEPTANCE_SELECTED_PASS==='3'
  &&/^[0-9a-f]{40}$/u.test(targetRef)&&env.LINEAR_ACCEPTANCE_TARGET_SHA===targetRef;
 if((query_hash!==PROJECTION_METADATA_QUERY_HASH_V1&&!(query_hash===PROJECTION_LINEAR_METADATA_QUERY_HASH_V1&&linearEvidence))
  ||batch_size<PROJECTION_METADATA_MIN_BATCH_V1||batch_size>PROJECTION_METADATA_MAX_BATCH_V1
  ||!dmlPlanCaptureEnvironmentAllowed(env)||database!=='noisia_mfp_ci'||role!=='postgres'
  ||env.R16_DIAGNOSTIC_MODE!=='sql_frontier_only'||env.R16_DIAGNOSTIC_CAPTURE_PROJECTION_PLAN!=='true'
  ||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||env.R16_DIAGNOSTIC_TARGET_LABEL!=='candidate'||env.RESERVE_SHARED_SMOKE!=='true'
  ||env.RAW_ACCEPTANCE_SELECTED_PASS!=='6'||!/^[0-9a-f]{40}$/u.test(targetRef)||env.RAW_ACCEPTANCE_TARGET_SHA!==targetRef)
  return{result:await query(),observation:null};
 assertInnerPlanCaptureGuard(env,database,role);
 const phases:ProjectionNoticePhaseV1[]=['setup','original_query','after_query','cleanup'];
 const raw=Object.fromEntries(phases.map(phase=>[phase,0])) as Record<ProjectionNoticePhaseV1,number>;
 const rejected=Object.fromEntries(phases.map(phase=>[phase,{}])) as Record<ProjectionNoticePhaseV1,Partial<Record<AutoExplainNoticeRejectReasonV1,number>>>;
 const outer=Object.fromEntries(phases.map(phase=>[phase,0])) as Record<ProjectionNoticePhaseV1,number>;
 const nested=Object.fromEntries(phases.map(phase=>[phase,0])) as Record<ProjectionNoticePhaseV1,number>;
 const unattributed=Object.fromEntries(phases.map(phase=>[phase,0])) as Record<ProjectionNoticePhaseV1,number>;
 const capped=Object.fromEntries(phases.map(phase=>[phase,0])) as Record<ProjectionNoticePhaseV1,number>;
 const gucSettings=Object.fromEntries(PROJECTION_READBACK_GUCS.map(name=>[name,null])) as Record<(typeof PROJECTION_READBACK_GUCS)[number],string|null>;
 const gucReadback:ProjectionGucReadbackV1={status:'unknown',settings:gucSettings};
 const outerTextHash=`sha256:${createHash('sha256').update(outer_query_text,'utf8').digest('hex')}`;
 const plans:ProjectionPlanV1[]=[];let phase:ProjectionNoticePhaseV1='setup',accepted=0,dropped=0,savepoint=false,listenerAttached=false;
 let setupMs=0,queryWallMs=0,cleanupMs=0,afterQueryDrainMs=0,setupStage='savepoint',queryError:unknown,cleanupError:unknown;
 const listener=(notice:unknown)=>{
  raw[phase]++;const classified=classifyAutoExplainNoticeV1(notice,PROJECTION_SAFE_CTE_NAMES);
  if(classified.status==='rejected'){const counts=rejected[phase];counts[classified.reason]=(counts[classified.reason]??0)+1;return;}
  accepted++;const isOuter=classified.query_text_sha256===outerTextHash;
  if(phase==='after_query'&&!isOuter){unattributed[phase]++;return;}
  // PostgreSQL 17 §53.2.3: https://www.postgresql.org/docs/17/protocol-flow.html#PROTOCOL-FLOW-EXT-QUERY
  // Sync does not close the unnamed portal, so the outer plan may arrive during rollback.
  if(phase==='cleanup'&&!isOuter){unattributed[phase]++;return;}
  if(phase!=='original_query'&&phase!=='after_query'&&phase!=='cleanup'){unattributed[phase]++;return;}
  if(isOuter){outer[phase]++;if(plans.some(plan=>plan.frontier_role==='outer')||plans.length>=8){dropped++;capped[phase]++;return;}
   plans.push({sequence:accepted,...classified,frontier_role:'outer'});return;}
  if(phase==='original_query'&&classified.query_text_sha256!==null){nested[phase]++;if(plans.filter(plan=>plan.frontier_role==='nested').length<7&&plans.length<8)
    plans.push({sequence:accepted,...classified,frontier_role:'nested'});else{dropped++;capped[phase]++;}return;}
  unattributed[phase]++;
 };
 const detach=()=>{if(listenerAttached){client.off('notice',listener);listenerAttached=false;}};
 client.on('notice',listener);listenerAttached=true;
 const rollback=async(savepointName:string)=>{
  const cleanupStart=clock();try{await client.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);await client.query(`RELEASE SAVEPOINT ${savepointName}`);}
  finally{cleanupMs+=clock()-cleanupStart;}
 };
 try{
  const setupStart=clock();
  try{
   await client.query('SAVEPOINT r16_projection_plan_capture_v1');savepoint=true;
   setupStage='verify_transaction_scope';
   const identity=await client.query(`SELECT current_database() AS database,current_user AS role,
    current_setting('transaction_isolation') AS isolation,current_setting('transaction_read_only') AS read_only,
    r.rolsuper AS superuser FROM pg_roles r WHERE r.rolname=current_user`);
   if(!verifiedInnerPlanScopeV1(identity.rows?.[0],database,role))throw Error('projection_scope_unverified');
   setupStage='logging_configuration';
   await client.query("SET LOCAL log_min_messages = 'WARNING'");await client.query("SET LOCAL client_min_messages = 'NOTICE'");
   await client.query("SET LOCAL log_statement = 'none'");await client.query('SET LOCAL log_parameter_max_length = 0');
   setupStage='load_auto_explain';await client.query("LOAD 'auto_explain'");
   setupStage='auto_explain_configuration';
   await client.query('SET LOCAL auto_explain.log_parameter_max_length = 0');await client.query("SET LOCAL auto_explain.log_level = 'NOTICE'");
   await client.query("SET LOCAL auto_explain.log_min_duration = '50ms'");await client.query('SET LOCAL auto_explain.log_nested_statements = on');
   await client.query('SET LOCAL auto_explain.log_analyze = on');await client.query('SET LOCAL auto_explain.log_buffers = on');
   await client.query('SET LOCAL auto_explain.log_timing = off');await client.query("SET LOCAL auto_explain.log_format = 'json'");
   await client.query('SET LOCAL auto_explain.log_verbose = off');
   setupStage='guc_readback';
   await client.query('SAVEPOINT r16_projection_guc_readback_v1');
   try{
    const observed:typeof gucSettings={...gucSettings};
    for(const name of PROJECTION_READBACK_GUCS){const result=await client.query(`SHOW ${name}`),row=result.rows?.[0];
     observed[name]=safeGucReadbackValue(name,row&&typeof row==='object'?Object.values(row)[0]:null);}
    gucReadback.settings=observed;
    gucReadback.status=PROJECTION_READBACK_GUCS.every(name=>observed[name]===PROJECTION_EXPECTED_GUCS[name])?'captured':'unknown';
    await client.query('RELEASE SAVEPOINT r16_projection_guc_readback_v1');
   }catch{
    gucReadback.status='unknown';await client.query('ROLLBACK TO SAVEPOINT r16_projection_guc_readback_v1');
    await client.query('RELEASE SAVEPOINT r16_projection_guc_readback_v1');
   }
  }catch(error){
   setupMs=clock()-setupStart;
   if(savepoint){await rollback('r16_projection_plan_capture_v1');savepoint=false;}
   const queryStart=clock();let result:any;try{result=await query();}catch(queryFailure){throw queryFailure;}finally{queryWallMs=clock()-queryStart;}
   const reason=setupStage==='verify_transaction_scope'?'transaction_scope_unverified':setupStage==='load_auto_explain'
    ?'auto_explain_load_unavailable':'capture_setup_unavailable';
   return{result,observation:{query_hash,label:'bounded_input_projection_metadata',batch_size,status:'setup_unavailable',reason,plans,plan_notices_seen:accepted,plans_dropped:dropped,
    raw_notice_count_by_phase:raw,rejected_notice_count_by_phase:rejected,accepted_outer_count_by_phase:outer,accepted_nested_count_by_phase:nested,
    accepted_unattributed_count_by_phase:unattributed,capped_notice_count_by_phase:capped,after_query_drain_ms:afterQueryDrainMs,guc_readback:gucReadback,
    setup_ms:setupMs,query_wall_ms:queryWallMs,cleanup_ms:cleanupMs,analyze_timing_overhead_measured:false,capacity_claim:false}};
  }
  setupMs=clock()-setupStart;
  phase='original_query';const queryStart=clock();let result:any;
  try{result=await query();}catch(error){queryError=error;}finally{queryWallMs=clock()-queryStart;phase='after_query';}
  const drainStart=clock();await new Promise<void>(resolve=>setImmediate(resolve));afterQueryDrainMs=clock()-drainStart;
  phase='cleanup';
  if(savepoint){try{await rollback('r16_projection_plan_capture_v1');savepoint=false;}catch(error){cleanupError=error;}}
  detach();
  if(queryError&&cleanupError)throw new AggregateError([queryError,cleanupError],'projection_query_and_restore_failed');
  if(queryError)throw queryError;if(cleanupError)throw cleanupError;
  const reason=gucReadback.status!=='captured'?'guc_readback_unavailable':!plans.some(plan=>plan.frontier_role==='outer')?'outer_plan_unobserved':undefined;
  return{result,observation:{query_hash,label:'bounded_input_projection_metadata',batch_size,status:reason?'capture_unknown':'captured',...(reason?{reason}:{}),plans,
   plan_notices_seen:accepted,plans_dropped:dropped,raw_notice_count_by_phase:raw,rejected_notice_count_by_phase:rejected,
   accepted_outer_count_by_phase:outer,accepted_nested_count_by_phase:nested,accepted_unattributed_count_by_phase:unattributed,
   capped_notice_count_by_phase:capped,after_query_drain_ms:afterQueryDrainMs,guc_readback:gucReadback,setup_ms:setupMs,query_wall_ms:queryWallMs,
   cleanup_ms:cleanupMs,analyze_timing_overhead_measured:false,capacity_claim:false}};
 }finally{detach();if(savepoint){try{await rollback('r16_projection_plan_capture_v1');savepoint=false;}catch{}}}
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
export function projectObserverTimeToPerformanceRangeV1(anchor:{performance_before_ms:number;performance_after_ms:number},eventOffsetMs:number){
 if(!Number.isFinite(anchor.performance_before_ms)||!Number.isFinite(anchor.performance_after_ms)
  ||anchor.performance_after_ms<anchor.performance_before_ms||!Number.isFinite(eventOffsetMs)||eventOffsetMs<0)
  throw Error('observer_clock_anchor_invalid');
 return{start_performance_ms:anchor.performance_before_ms+eventOffsetMs,
  end_performance_ms:anchor.performance_after_ms+eventOffsetMs,
  uncertainty_ms:anchor.performance_after_ms-anchor.performance_before_ms};
}
type ListeningObserverScopeV1={operation:string;sequence:number;job:number;raw_page?:RawPageDmlContextV1|null};
export function createListeningObserver(options:{neutral_only?:boolean;sql_frontier_only?:boolean;projection_plan_only?:boolean;projection_linear_oracle?:boolean}={}){
 const performanceBefore=performance.now(),origin=process.hrtime.bigint(),performanceAfter=performance.now();
 const performanceOrigin=performanceBefore,now=()=>Number(process.hrtime.bigint()-origin)/1e6,events=boundedEvents(),scope=new AsyncLocalStorage<ListeningObserverScopeV1>();
 let storeSequence=0,querySequence=0,streamSequence=0,jobSequence=0,jobStreamStart=0,invalidStream=0;
 type StreamState={sequence:number;at_ms:number;job:number;in_flight:number;reserved_working_bytes:number;buffered_responses:number;active_flushes:number};
 let lastStream:StreamState|null=null;
 const activeStores=new Map<string,number>();
 const streamSnapshot=()=>lastStream?{...lastStream}:null;
 const clockAnchor={hrtime_origin_ns:origin.toString(),hrtime_origin_unit:'nanoseconds',event_offset_unit:'milliseconds',
  performance_axis:'performance.now milliseconds since runner process start',performance_time_origin_unix_ms:performance.timeOrigin,
  performance_before_ms:performanceBefore,performance_after_ms:performanceAfter,
  uncertainty_ms:performanceAfter-performanceBefore,projection:'[performance_before_ms + event_offset_ms, performance_after_ms + event_offset_ms]'};
 const delay=monitorEventLoopDelay({resolution:20});delay.enable();
 let previous=now();const heartbeat=setInterval(()=>{const at=now();events.push({kind:'heartbeat',at_ms:at,gap_ms:at-previous,heap:process.memoryUsage(),resource:process.resourceUsage()});previous=at;},250);
 const gc=new PerformanceObserver(list=>{for(const entry of list.getEntries())events.push({kind:'gc',at_ms:now(),start_ms:entry.startTime-performanceOrigin,end_ms:entry.startTime-performanceOrigin+entry.duration,duration_ms:entry.duration,gc_kind:(entry as any).detail?.kind??null});});gc.observe({entryTypes:['gc']});
 let closing=false;const detach:Array<()=>void>=[];let child:ChildProcess|undefined;const pids=new Set<number>();let samplerStatus='not_started';
 let planRootCount=0;const planQueryOrdinals=new Map<string,number>(),planObservations:unknown[]=[];
 const dmlPlanCounts=new Map<string,number>(),dmlPlanObservations:unknown[]=[],projectionPlanObservations:ProjectionPlanObservationV1[]=[];
 let sqlFrontierCaptureCount=0,projectionCaptureCount=0;
 function pid(value:any){if(Number.isSafeInteger(value?.processID)&&value.processID>0&&!pids.has(value.processID)){pids.add(value.processID);if(child?.connected)child.send({kind:'pids',pids:[...pids]},()=>{});}}
 function query(owner:any){return async(...args:any[])=>{pid(owner);const start=now(),context=scope.getStore(),op=context?.operation??'unlabeled',job=context?.job??jobSequence,sequence=++querySequence,hash=queryHash(args[0]);
  const label=innerPlanQueryLabel(hash),queryOrdinal=options.neutral_only||options.sql_frontier_only?null:
   nextInnerPlanQueryOrdinalV1(hash,label!==null&&planRootCount>=1024,planQueryOrdinals);try{
  const projectionBatch=options.sql_frontier_only&&options.projection_plan_only?projectionMetadataBatchSizeV1(hash,args,options.projection_linear_oracle===true):null;
  if(projectionBatch!==null&&projectionCaptureCount<1&&dmlPlanCaptureEnvironmentAllowed(process.env)
   &&typeof owner.on==='function'&&typeof owner.off==='function'){
   projectionCaptureCount++;
   const originalSql=typeof args[0]==='string'?args[0]:typeof args[0]?.text==='string'?args[0].text:undefined;
   if(originalSql){const captured=await captureReadonlyProjectionPlanV1({client:owner,query:()=>owner.query(...args),query_hash:hash!,batch_size:projectionBatch,
    outer_query_text:originalSql,database:'noisia_mfp_ci',role:'postgres',env:process.env});
    if(captured.observation)projectionPlanObservations.push(captured.observation);return captured.result;}
  }
  const dmlSpec=options.neutral_only||options.projection_plan_only?null:dmlPlanQuerySpec(hash);
  const rawPageBatch=options.sql_frontier_only&&dmlSpec?.batch_kind==='raw_page_context'
   ?rawPageDmlBatchSizeV1(hash,args,context?.raw_page):null;
  const dmlBatch=dmlSpec?.batch_kind==='raw_page_context'?rawPageBatch:dmlSpec?dmlPlanBatchSize(hash,args):null;
  const dmlProfileAllowed=options.sql_frontier_only?Boolean(dmlSpec):Boolean(hash&&LEGACY_DML_PLAN_QUERY_HASHES.has(hash));
  const profileCaptureLimit=options.sql_frontier_only?SQL_FRONTIER_DML_CAPTURE_LIMIT:Number.POSITIVE_INFINITY;
  if(!options.neutral_only&&!options.projection_plan_only&&dmlProfileAllowed&&dmlSpec&&dmlBatch!==null&&dmlBatch>=DML_PLAN_MIN_BATCH
   &&(!options.sql_frontier_only||dmlBatch<=SQL_FRONTIER_DML_BATCH_LIMIT)
   &&(dmlPlanCounts.get(hash!)??0)<1&&sqlFrontierCaptureCount<profileCaptureLimit
   &&dmlPlanCaptureEnvironmentAllowed(process.env)&&typeof owner.on==='function'&&typeof owner.off==='function'){
   dmlPlanCounts.set(hash!,1);
   if(options.sql_frontier_only)sqlFrontierCaptureCount++;
   const originalSql=typeof args[0]==='string'?args[0]:typeof args[0]?.text==='string'?args[0].text:undefined;
   const captured=await captureDmlPlanQueryV1({client:owner,query:()=>owner.query(...args),query_hash:hash!,batch_size:dmlBatch,database:'noisia_mfp_ci',role:'postgres',env:process.env,
    ...(!options.sql_frontier_only?{query_values:args[1]}:{}),...(options.sql_frontier_only?{sql_frontier_only:true,outer_query_text:originalSql}:{})});
   if(captured.observation)dmlPlanObservations.push(captured.observation);return captured.result;
  }
  if(!options.neutral_only&&!options.sql_frontier_only&&label&&shouldCaptureInnerPlanOrdinalV1(queryOrdinal)&&typeof owner.on==='function'&&typeof owner.off==='function'){
   const captured=await captureInnerPlanQueryV1({client:owner,query:()=>owner.query(...args),query_hash:hash!,query_ordinal:queryOrdinal!,root_count:planRootCount,database:'noisia_mfp_ci',role:'postgres'});
   if(captured.observation)planObservations.push(captured.observation);return captured.result;
  }
  return await owner.query(...args);
 }finally{events.push({kind:'query',operation:op,sequence,store_sequence:context?.sequence??null,job,hash,pid:Number.isSafeInteger(owner.processID)?owner.processID:null,
  ...(queryOrdinal===null?{}:{query_ordinal:queryOrdinal}),start_ms:start,end_ms:now()});}};}
 return{
 wrapDatabase(database:any){database.on?.('acquire',pid);detach.push(()=>database.off?.('acquire',pid));return new Proxy(database,{get(target,key){if(key==='query')return query(target);if(key==='connect')return async()=>{
 const start=now(),context=scope.getStore(),job=context?.job??jobSequence;let c:any,status='failed';
 try{c=await target.connect();pid(c);status='acquired';return new Proxy(c,{get(t,k){if(k==='query')return query(t);const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v;}});}
 finally{const end=now();events.push({kind:'connect',operation:context?.operation??'unlabeled',store_sequence:context?.sequence??null,job,start_ms:start,end_ms:end,wait_ms:end-start,wait_scope:'connect_promise_wall_including_connection_setup',status,pid:Number.isSafeInteger(c?.processID)?c.processID:null});}
 };const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});},
 wrapStore(store:any){return new Proxy(store,{get(t,k){const value=Reflect.get(t,k);if(typeof k!=='string'||!STORE_OPERATIONS.has(k)||typeof value!=='function')return typeof value==='function'?value.bind(t):value;return async(...args:any[])=>{
 const operation=k==='calls'&&Array.isArray(args[1]?.call_ids)?'hydrate':k,sequence=++storeSequence,job=jobSequence,start=now(),streamBefore=streamSnapshot();
 const rawPage=operation==='persistRawPage'?rawPageDmlContextFromStoreArgsV1(args):null;
 const active=(activeStores.get(operation)??0)+1;activeStores.set(operation,active);
 let result:unknown,status='failed';
 const suppliedBatch=Array.isArray(args[1])?args[1].length:null;
 events.push({kind:'store_start',operation,sequence,job,start_ms:start,batch_size:suppliedBatch,active_same_operation:active,last_stream:streamBefore});
 try{result=await scope.run({operation,sequence,job,...(rawPage?{raw_page:rawPage}:{})},()=>value.apply(t,args));status='complete';return result;}
 finally{
  activeStores.set(operation,(activeStores.get(operation)??1)-1);
  const returnedBatch=(operation==='inputs'||operation==='calls'||operation==='hydrate')&&Array.isArray(result)?result.length:null;
  events.push({kind:'store',operation,sequence,job,start_ms:start,end_ms:now(),status,batch_size:returnedBatch??suppliedBatch,
   batch_unit:returnedBatch!==null?'returned_rows':suppliedBatch!==null?'argument_rows':'unavailable',active_same_operation_at_start:active,last_stream_before:streamBefore,last_stream_after:streamSnapshot()});
 }
 };}});},
 beginJob(sequence:number){if(!Number.isSafeInteger(sequence)||sequence<1)throw Error('observer_job_sequence_invalid');jobSequence=sequence;jobStreamStart=streamSequence;lastStream=null;},
 observeStream(metrics:unknown){
  const m=metrics as Record<string,unknown>|null,keys=['in_flight','reserved_working_bytes','buffered_responses','active_flushes'] as const;
  if(!m||keys.some(k=>!Number.isSafeInteger(m[k])||Number(m[k])<0)){invalidStream++;return;}
  lastStream={sequence:++streamSequence,at_ms:now(),job:jobSequence,in_flight:Number(m.in_flight),reserved_working_bytes:Number(m.reserved_working_bytes),buffered_responses:Number(m.buffered_responses),active_flushes:Number(m.active_flushes)};
  events.push({kind:'stream',...lastStream});
 },
 assertStreamObserved(){if(streamSequence<=jobStreamStart||invalidStream)throw Error('listening_stream_hook_unobserved_or_invalid');},

 async startSampler(args:{target:string;url:string;database:string}){
  if(process.env.GITHUB_ACTIONS!=='true'||process.env.NOISIA_R16_SMALL_DIAGNOSTIC!=='true')throw Error('observer_sampler_ci_only');
  const url=new URL(args.url);if(url.hostname!=='127.0.0.1'||url.protocol!=='postgresql:'||!/^noisia_[a-z0-9_]+$/u.test(args.database))throw Error('observer_sampler_target_invalid');
  samplerStatus='starting';child=fork(fileURLToPath(import.meta.url),['--sampler'],{stdio:['ignore','ignore','ignore','ipc'],env:{PATH:process.env.PATH,GITHUB_ACTIONS:'true',NOISIA_R16_SMALL_DIAGNOSTIC:'true'},execArgv:process.execArgv});
  child.on('message',(m:any)=>{if(m?.kind==='waits'&&Array.isArray(m.rows)){try{events.push({kind:'pg_waits',at_ms:m.at_ms,rows:m.rows.map(safeWaitRow)});}catch{samplerStatus='invalid_sample';}}else if(m?.kind==='ready')samplerStatus='ready';else if(m?.kind==='failed')samplerStatus='failed';});
  child.on('error',()=>{samplerStatus='failed';});child.on('exit',()=>{if(!closing)samplerStatus='exited_early';});child.send({kind:'init',...args,origin:String(origin),pids:[...pids]},()=>{});
 },
 setInnerPlanRootCount(value:number){if(!Number.isSafeInteger(value)||value<0)throw Error('observer_invalid_root_count');planRootCount=value;},
 snapshot(){return{contract_version:'r16-neutral-observer-v1',...events.snapshot(),clock_anchor:clockAnchor,sampler_status:samplerStatus,sampler_process_pid:child?.pid??null,fixture_pids:[...pids],neutral_only:options.neutral_only===true,sql_frontier_only:options.sql_frontier_only===true,connection_observation_scope:'explicit database.connect only; Pool.query internal checkout unobserved',stream_metrics_source:'native observe_stream; working bytes are reservation, not RSS',stream_observations:streamSequence,invalid_stream_observations:invalidStream,last_stream:streamSnapshot(),inner_plan_observations:[...planObservations],
  ...(options.projection_plan_only?{projection_plan_capture:{enabled:true,scope:'one_source_whitelisted_bounded_input_metadata_select',max_captures:1,min_batch_size:PROJECTION_METADATA_MIN_BATCH_V1,max_batch_size:PROJECTION_METADATA_MAX_BATCH_V1,max_plans:8,nested_plan_limit:7,captures_started:projectionCaptureCount,cpu_profiling_enabled:false,heap_profiling_enabled:false,dml_plan_capture_enabled:false,actor_post_diagnostic_enabled:false,capacity_claim:false,observations:[...projectionPlanObservations]}}:{}),
  sql_frontier_capture:{enabled:options.sql_frontier_only===true&&!options.projection_plan_only,
   scope:options.projection_plan_only?'disabled_by_readonly_projection_capture':options.sql_frontier_only?'five_capture_slots_over_source_whitelisted_DML_hash_variants':null,
   max_captures:options.sql_frontier_only&&!options.projection_plan_only?SQL_FRONTIER_DML_CAPTURE_LIMIT:0,
   max_batch_size:options.sql_frontier_only&&!options.projection_plan_only?SQL_FRONTIER_DML_BATCH_LIMIT:0,captures_started:sqlFrontierCaptureCount,
   cpu_profiling_enabled:false,heap_profiling_enabled:false,inner_plan_ordinals_enabled:false,inner_plan_captures_enabled:false,actor_post_diagnostic_enabled:false,capacity_claim:false},
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
