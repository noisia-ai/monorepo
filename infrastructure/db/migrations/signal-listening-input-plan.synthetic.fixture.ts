import {invertWirePopulationMetadataV1,wirePopulationMetadataV1} from './signal-listening-wire-population.oracle';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,mkdir,open,realpath,rm,lstat} from 'node:fs/promises';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {runR16ListeningBenchmarkV1} from '../../../scripts/r16/run-listening-benchmark';
import {createR16ListeningNativeFixtureV1} from '../../../scripts/r16/listening-native-fixture';
import {loadR16ListeningNativeCensusV1} from '../../../scripts/r16/listening-native-census';
import {assertR16ListeningCiEnvironmentV1} from '../../../scripts/r16/run-listening-ci';
import {R16QueryProfilerV1} from '../../../scripts/r16/query-profiler';
import {captureR16ExpectedGitProvenanceV1,captureR16SourceProvenanceV1} from '../../../scripts/r16/source-provenance';
import {openR16CiPostgresV1} from './signal-r16-local-pg.fixture';
import {startupErrorTreeV1} from './signal-listening-startup-prefix.synthetic.fixture';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const hash=(text:string)=>'sha256:'+createHash('sha256').update(text,'utf8').digest('hex');
export const INPUT_PLAN_LIMITS_V1=Object.freeze({ordinal:65,notice_bytes:4*1024*1024,input_bytes:64*1024*1024,
 templates:128,nodes:512,depth:64,output_bytes:4*1024*1024});
export const INPUT_PLAN_TARGET_SHA_V1='sha256:e2a1d2ae7cc6917e1b58de56e7d3a2ad108e902feeb46d5d1dd1559644421f42';
export const INPUT_PLAN_WIRE_E_TARGET_SHA_V1='sha256:b4e38b2486fca6e4025b361b9c47ba4ad79edd91294b2554ff8b93edd3ba2150';
export const INPUT_PLAN_CURRENT_PROFILE_V1='E' as const;
export type InputPlanTargetProfileV1='historical'|'E';
const targetShaV1=(profile:InputPlanTargetProfileV1)=>{known(profile==='historical'||profile==='E');return profile==='historical'?INPUT_PLAN_TARGET_SHA_V1:INPUT_PLAN_WIRE_E_TARGET_SHA_V1;};
export const inputPlanTemplateHashV1=(text:string)=>hash(text.replace(/\s+/gu,' ').trim());
function known(ok:unknown):asserts ok{if(!ok)throw Error('r16_input_plan_observer_invalid_or_incomplete');}

/** Resolve the same two literal substitutions as the production TypeScript.
 * Target versions use only the registered source inverse; no eval, replay,
 * bind values or SQL artifact is used. */
function extractHistoricalInputPlanQueryV1(source:string,expected=INPUT_PLAN_TARGET_SHA_V1){
 const scope=/const unresolvedScope="([^"\n]+)";/u.exec(source);
 const human=/const noHumanDecision=`([^`]+)`;/u.exec(source);
 const method=source.split('async function inputProjectionMetadata(');known(method.length===2);
 const template=/\(`(\/\* labeling_listening_input_metadata_v1 \*\/[\s\S]*?)`,\s*\[run\.workspace_id/u.exec(method[1]!);
 known(scope&&human&&template);
 const sql=template[1]!.replaceAll('${unresolvedScope}',scope[1]!).replaceAll('${noHumanDecision}',human[1]!);
 known(!sql.includes('${')&&inputPlanTemplateHashV1(sql)===expected);
 return{sql,template_sha256:expected};
}

/** Historical selector remains explicit; E must invert the complete registered
 * three-delta SQL back to that immutable query before matching its own pin. */
export function extractListeningInputPlanQueryOldV1(source:string){
 return extractHistoricalInputPlanQueryV1(source.includes('FROM signal_listening_wire_population_roots_v1')?invertWirePopulationMetadataV1(source):source);
}
export function extractListeningInputPlanQueryV1(source:string,profile:InputPlanTargetProfileV1=INPUT_PLAN_CURRENT_PROFILE_V1){
 if(profile==='historical')return{...extractListeningInputPlanQueryOldV1(source),profile,legacy_template_sha256:INPUT_PLAN_TARGET_SHA_V1};
 known(profile==='E');const oldSource=invertWirePopulationMetadataV1(source);known(wirePopulationMetadataV1(oldSource)===source);
 const old=extractHistoricalInputPlanQueryV1(oldSource);
 // Expand the SAME literal scope/human interpolations. The only SQL edits are
 // the closed reader and two octet columns already checked by the inverse.
 const {sql}=extractHistoricalInputPlanQueryV1(wirePopulationMetadataV1(oldSource),INPUT_PLAN_WIRE_E_TARGET_SHA_V1);known(old.template_sha256===INPUT_PLAN_TARGET_SHA_V1);
 known(inputPlanTemplateHashV1(sql)===INPUT_PLAN_WIRE_E_TARGET_SHA_V1);
 return{sql,template_sha256:INPUT_PLAN_WIRE_E_TARGET_SHA_V1,profile,legacy_template_sha256:INPUT_PLAN_TARGET_SHA_V1};
}

const nodeTypes=new Set(['Named Tuplestore Scan','Nested Loop','Hash Join','Merge Join','Aggregate','Group','Unique','SetOp','WindowAgg',
 'Seq Scan','Index Scan','Index Only Scan','Bitmap Heap Scan','Bitmap Index Scan','BitmapAnd','BitmapOr','Tid Scan','Tid Range Scan',
 'CTE Scan','Function Scan','Table Function Scan','Values Scan','Subquery Scan','WorkTable Scan','Foreign Scan','Custom Scan','Sample Scan',
 'Hash','Sort','Incremental Sort','Limit','Result','Materialize','Memoize','Append','Merge Append','Recursive Union','Gather','Gather Merge','ProjectSet','LockRows','ModifyTable']);
const metrics=new Set(['Startup Cost','Total Cost','Plan Rows','Plan Width','Actual Rows','Actual Loops','Rows Removed by Filter',
 'Rows Removed by Join Filter','Rows Removed by Index Recheck','Rows Removed by Conflict Filter','Heap Fetches','Shared Hit Blocks',
 'Shared Read Blocks','Shared Dirtied Blocks','Shared Written Blocks','Local Hit Blocks','Local Read Blocks','Local Dirtied Blocks',
 'Local Written Blocks','Temp Read Blocks','Temp Written Blocks','I/O Read Time','I/O Write Time','Shared I/O Read Time','Shared I/O Write Time',
 'Local I/O Read Time','Local I/O Write Time','Temp I/O Read Time','Temp I/O Write Time','Workers Planned','Workers Launched','Worker Number',
 'Hash Buckets','Original Hash Buckets','Hash Batches','Original Hash Batches','Peak Memory Usage','Memory Usage','Disk Usage','HashAgg Batches',
 'Sort Space Used','Cache Hits','Cache Misses','Cache Evictions','Cache Overflows','Exact Heap Blocks','Lossy Heap Blocks',
 'Planning Time','Execution Time','Tuples Inserted','Conflicting Tuples','Subplans Removed','Planned Partitions']);
const enums:Record<string,ReadonlySet<string>>={
 'Node Type':nodeTypes,'Parent Relationship':new Set(['Outer','Inner','InitPlan','SubPlan','Member','Subquery']),
 Strategy:new Set(['Plain','Sorted','Hashed','Mixed']),'Cache Mode':new Set(['logical','binary']),
 'Partial Mode':new Set(['Simple','Partial','Finalize']),'Join Type':new Set(['Inner','Left','Right','Full','Semi','Anti','Right Semi','Right Anti']),
 'Scan Direction':new Set(['Forward','Backward','NoMovement']),
 'Sort Method':new Set(['quicksort','top-N heapsort','external merge','external sort','still in progress']),
 'Sort Space Type':new Set(['Memory','Disk']),Operation:new Set(['Select','Insert','Update','Delete','Merge'])};
const expressions=new Set(['One-Time Filter','Filter','Output','Index Cond','Recheck Cond','Hash Cond','Merge Cond','Join Filter',
 'Sort Key','Presorted Key','Group Key','Hash Key','Run Condition','Cache Key','Function Call','Remote SQL','Conflict Filter','Query Identifier']);
const identifiers=new Set(['Relation Name','Index Name','Schema','CTE Name','Function Name','Alias','Subplan Name','Tuplestore Name']);
/** auto_explain JSON only. Identifiers are hashed and expression fields omitted.
 * Closed keys/enums, bounded own-data traversal; no raw plan or SQL is returned.
 * TIMING OFF means per-node elapsed timings remain UNKNOWN, not zero. */
export function sanitizeListeningInputPlanV1(document:unknown){
 let count=0;const visited=new WeakSet<object>();
 const own=(value:unknown)=>{known(value!==null&&typeof value==='object'&&!visited.has(value));visited.add(value);
  const p=Object.getPrototypeOf(value);known(p===Object.prototype||p===Array.prototype||p===null);
  const fields=Object.getOwnPropertyDescriptors(value);known(Reflect.ownKeys(fields).every(k=>typeof k==='string')&&Object.values(fields).every(d=>'value'in d));return fields;};
 const finite=(value:unknown)=>{known(typeof value==='number'&&Number.isFinite(value)&&value>=0);return value;};
 const integer=(value:unknown)=>{const n=finite(value);known(Number.isSafeInteger(n));return n;};
 const list=(value:unknown)=>{known(Array.isArray(value));const fields=own(value),length=fields.length?.value as unknown;
  known(typeof length==='number'&&Number.isSafeInteger(length)&&length>=0&&length<=512);
  known(Object.keys(fields).every(k=>k==='length'||/^(?:0|[1-9][0-9]*)$/u.test(k)));
  return Array.from({length},(_,i)=>{known(fields[String(i)]);return fields[String(i)]!.value as unknown;});};
 const stringHash=(value:unknown)=>{known(typeof value==='string'&&Buffer.byteLength(value)<=INPUT_PLAN_LIMITS_V1.notice_bytes);return hash(value);};
 const jit=(value:unknown)=>{const out:Record<string,unknown>={};for(const[k,d]of Object.entries(own(value))){
  if(k==='Functions')out[k]=integer(d.value);
  else if(k==='Options'){const options:Record<string,boolean>={};for(const[key,field]of Object.entries(own(d.value))){known(['Inlining','Optimization','Expressions','Deforming'].includes(key)&&typeof field.value==='boolean');options[key]=field.value;}out[k]=options;}
  else if(k==='Timing'){const timing:Record<string,unknown>={};for(const[key,field]of Object.entries(own(d.value))){known(['Generation','Inlining','Optimization','Emission','Total'].includes(key));
   if(key==='Generation'&&typeof field.value!=='number'){const g=own(field.value);known(!Array.isArray(field.value)&&Object.keys(g).length===2&&g.Deform&&g.Total);timing[key]={Deform:finite(g.Deform.value),Total:finite(g.Total.value)};}
   else timing[key]=finite(field.value);}out[k]=timing;}
  else known(false);
 }return out;};
 const groups=(value:unknown)=>{const fields=own(value),out:Record<string,unknown>={};known(!Array.isArray(value)&&fields['Group Count']&&fields['Sort Methods Used']);
  for(const[k,d]of Object.entries(fields)){
   if(k==='Group Count')out[k]=integer(d.value);
   else if(k==='Sort Methods Used'){const methods=list(d.value);known(methods.every(v=>typeof v==='string'&&enums['Sort Method']!.has(v))&&new Set(methods).size===methods.length);out[k]=methods;}
   else if(k==='Sort Space Memory'||k==='Sort Space Disk'){const f=own(d.value);known(!Array.isArray(d.value)&&Object.keys(f).length===2&&f['Average Sort Space Used']&&f['Peak Sort Space Used']);out[k]={'Average Sort Space Used':integer(f['Average Sort Space Used'].value),'Peak Sort Space Used':integer(f['Peak Sort Space Used'].value)};}
   else known(false);
  }return out;};
 const walk=(value:unknown,depth:number,kind:'node'|'worker'|'planning'='node',ownerType?:unknown):Record<string,unknown>=>{
  known(depth<=INPUT_PLAN_LIMITS_V1.depth);const fields=own(value),out:Record<string,unknown>={};known(!Array.isArray(value));
  const type=fields['Node Type']?.value as unknown;
  if(kind==='node')known(++count<=INPUT_PLAN_LIMITS_V1.nodes&&typeof type==='string'&&nodeTypes.has(type));
  for(const[k,d]of Object.entries(fields)){const x=d.value as unknown;
   if(expressions.has(k))continue;
   if(metrics.has(k))out[k]=finite(x);
   else if(enums[k]){known(typeof x==='string'&&enums[k]!.has(x));out[k]=x;}
   else if(['Parallel Aware','Async Capable','Inner Unique','Single Copy'].includes(k)){known(typeof x==='boolean');out[k]=x;}
   else if(identifiers.has(k))out[k+' SHA256']=stringHash(x);
   else if(k==='Plans')out[k]=list(x).map(child=>walk(child,depth+1));
   else if(k==='Workers')out[k]=list(x).map(child=>walk(child,depth+1,'worker',type));
   else if(k==='JIT')out[k]=jit(x);
   else if(k==='Full-sort Groups'||k==='Pre-sorted Groups'){known(kind==='node'&&type==='Incremental Sort'||kind==='worker'&&ownerType==='Incremental Sort');out[k]=groups(x);}
   else known(false);
  }return out;
 };
 const top=Array.isArray(document)?list(document):[document];known(top.length===1);
 const fields=own(top[0]),out:Record<string,unknown>={};known(!Array.isArray(top[0])&&fields['Query Text']&&fields.Plan);
 for(const[k,d]of Object.entries(fields)){
  if(k==='Query Text'){known(typeof d.value==='string');out.query_template_sha256=inputPlanTemplateHashV1(d.value);}
  else if(k==='Plan')out.Plan=walk(d.value,0);
  else if(k==='JIT')out.JIT=jit(d.value);
  else if(k==='Planning')out.Planning=walk(d.value,0,'planning');
  else if(k==='Planning Time'||k==='Execution Time')out[k]=finite(d.value);
  else if(k==='Triggers'){known(Array.isArray(d.value)&&list(d.value).length===0);out.Triggers=[];}
  else known(false);
 }
 known(count>0);const serialized=JSON.stringify(out),bytes=Buffer.byteLength(serialized);known(bytes<=INPUT_PLAN_LIMITS_V1.output_bytes);
 return{plan:out,nodes:count,bytes,sanitized_sha256:hash(serialized)};
}

type QueryResultV1={rows:unknown[];rowCount?:number|null};
export type InputPlanDatabaseV1={query:(...args:any[])=>any;connect:(...args:any[])=>any};
export type InputPlanClientV1={query:(...args:any[])=>Promise<QueryResultV1>;release:(destroy?:boolean)=>void;
 on:(event:string,handler:(notice:unknown)=>void)=>unknown;removeListener:(event:string,handler:(notice:unknown)=>void)=>unknown;listenerCount:(event:string)=>number};
export type InputPlanObservationV1={
 target_profile:InputPlanTargetProfileV1;target_template_sha256:string;legacy_template_sha256:string;
 status:'pending'|'observed'|'INCONCLUSIVE';ordinal_seen:number;selected_count:number;original_executions:number;
 original_succeeded:boolean;result_reference_preserved:boolean;returned_rows:number|null;root_argument_count:number|null;bind_count:number|null;
 query_raw_match:boolean;context_stable:boolean;rr_read_only:boolean;settings_restored:boolean;rollback_reset_confirmed:boolean;discarded:boolean;
 library_loaded:boolean;library_unloaded:false;notices:number;input_bytes:number;loss:boolean;
 failure_stage:'none'|'connect'|'load'|'context'|'settings'|'listener'|'original'|'notice'|'sanitize'|'restore'|'rollback'|'release';
 parent_present:boolean;nested_present:boolean;
 context:{backend_sha256:string;role_sha256:string;database_sha256:string;search_path_sha256:string;snapshot_sha256:string;transaction_id_assigned:boolean}|null;
 plans:Array<{query_template_sha256:string;occurrences:number;variants:'NOT_COLLECTED';first:ReturnType<typeof sanitizeListeningInputPlanV1>}>;
};
const settingsNames=['auto_explain.log_min_duration','auto_explain.log_analyze','auto_explain.log_timing','auto_explain.log_buffers',
 'auto_explain.log_format','auto_explain.log_level','auto_explain.log_nested_statements','auto_explain.sample_rate',
 'auto_explain.log_parameter_max_length','auto_explain.log_verbose','auto_explain.log_settings','auto_explain.log_triggers',
 'auto_explain.log_wal','client_min_messages','log_min_messages'] as const;
const settingsValues=['0','on','off','on','json','notice','on','1','0','off','off','off','off','notice','warning'];
const settingsSql="SELECT name,current_setting(name) value FROM unnest($1::text[]) WITH ORDINALITY s(name,n) ORDER BY n";
const contextSql=`SELECT pg_backend_pid()::int pid,current_user role,current_database() database,
 current_setting('search_path') search_path,current_setting('is_superuser') superuser,
 current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') readonly,
 pg_current_xact_id_if_assigned()::text xid,pg_current_snapshot()::text snapshot`;
type SessionV1={pid:number;role:string;database:string;search_path:string;superuser:string;isolation:string;readonly:string;xid:string|null;snapshot:string};
async function session(client:InputPlanClientV1):Promise<SessionV1>{
 const result=await client.query(contextSql);known(result.rows.length===1);const row=result.rows[0] as SessionV1;
 known(row&&Number.isSafeInteger(row.pid)&&row.pid>0&&typeof row.role==='string'&&typeof row.database==='string'&&
  typeof row.search_path==='string'&&typeof row.superuser==='string'&&typeof row.isolation==='string'&&typeof row.readonly==='string'&&
  (row.xid===null||typeof row.xid==='string')&&typeof row.snapshot==='string');return row;
}
async function readSettings(client:InputPlanClientV1){
 const result=await client.query(settingsSql,[settingsNames]);known(result.rows.length===settingsNames.length);
 return result.rows.map((value,index)=>{const row=value as {name:string;value:string};known(row.name===settingsNames[index]&&typeof row.value==='string');return row.value;});
}
/** All controls use the underlying client, outside the selected await/listener.
 * Added latency is intrusive. This is neither an uninstrumented timing nor CPU.
 * Each selected query is forwarded exactly once, with its original arguments. */
export function createListeningInputPlanObserverV1(options:{target_sql:string;profile?:InputPlanTargetProfileV1}){
 const profile=options.profile??INPUT_PLAN_CURRENT_PROFILE_V1,targetSha=targetShaV1(profile);
 known(inputPlanTemplateHashV1(options.target_sql)===targetSha);
 const report:InputPlanObservationV1={target_profile:profile,target_template_sha256:targetSha,legacy_template_sha256:INPUT_PLAN_TARGET_SHA_V1,status:'pending',ordinal_seen:0,selected_count:0,original_executions:0,
  original_succeeded:false,result_reference_preserved:false,returned_rows:null,root_argument_count:null,bind_count:null,
  query_raw_match:false,context_stable:false,rr_read_only:false,settings_restored:false,rollback_reset_confirmed:false,discarded:false,
  library_loaded:false,library_unloaded:false,notices:0,input_bytes:0,loss:false,failure_stage:'none',parent_present:false,nested_present:false,context:null,plans:[]};
 const pids=new Set<number>();let activeBorrowed=0,releaseFailures=0;
 const failure=(stage:InputPlanObservationV1['failure_stage'])=>{report.loss=true;if(report.failure_stage==='none')report.failure_stage=stage;};
 const collect=(notice:unknown)=>{
  report.notices++;
  let stage:'notice'|'sanitize'='notice';
  try{
   known(notice!==null&&typeof notice==='object');const message=Object.getOwnPropertyDescriptor(notice,'message');
   known(message&&'value'in message&&typeof message.value==='string');const bytes=Buffer.byteLength(message.value);
   report.input_bytes+=bytes;
   known(bytes<=INPUT_PLAN_LIMITS_V1.notice_bytes&&report.input_bytes<=INPUT_PLAN_LIMITS_V1.input_bytes);
   // PostgreSQL's duration prefix is consumed, never exported. JSON may be an
   // object or EXPLAIN's single-element array; neither raw representation stays.
   const prefix=/^duration: ([0-9]+(?:\.[0-9]+)?) ms\s+plan:\s*/u.exec(message.value);known(prefix);
   const elapsed=Number(prefix[1]);known(Number.isFinite(elapsed)&&elapsed>=0);
   stage='sanitize';const sanitized=sanitizeListeningInputPlanV1(JSON.parse(message.value.slice(prefix[0].length)));
   const sqlHash=sanitized.plan.query_template_sha256;known(typeof sqlHash==='string');
   const previous=report.plans.find(p=>p.query_template_sha256===sqlHash);
   if(previous){previous.occurrences++;return;}
   known(report.plans.length<INPUT_PLAN_LIMITS_V1.templates);
   const retainedPlan={...sanitized.plan,server_duration_ms:elapsed,node_elapsed_ms:'UNKNOWN'};
   const retainedJson=JSON.stringify(retainedPlan);
   const next={query_template_sha256:sqlHash,occurrences:1,variants:'NOT_COLLECTED' as const,
    first:{...sanitized,plan:retainedPlan,bytes:Buffer.byteLength(retainedJson),sanitized_sha256:hash(retainedJson)}};
   known(Buffer.byteLength(JSON.stringify({...report,plans:[...report.plans,next]}))<=INPUT_PLAN_LIMITS_V1.output_bytes);
   report.plans.push(next);
  }catch{failure(stage);}
 };
 const snapshot=():InputPlanObservationV1=>{
  report.parent_present=report.plans.some(p=>p.query_template_sha256===targetSha);
  report.nested_present=report.plans.some(p=>p.query_template_sha256!==targetSha);
  report.status=report.selected_count===1&&report.original_executions===1&&report.original_succeeded&&report.result_reference_preserved&&
   report.query_raw_match&&report.context_stable&&report.rr_read_only&&report.settings_restored&&!report.loss&&
   report.parent_present&&report.nested_present?'observed':'INCONCLUSIVE';
  // Snapshot is a JSON-owned copy; callers cannot mutate observer state.
  return JSON.parse(JSON.stringify(report)) as InputPlanObservationV1;
 };
 const borrowed=async(client:InputPlanClientV1):Promise<InputPlanClientV1>=>{
  let released=false,uncertain=false,inTransaction=false,aborted=false,selectedOnClient=false;
  let originalFailureKnown=false,originalFailure:unknown;
  const originalSecondaries:unknown[]=[];
  const rememberFailure=(error:unknown)=>{if(!originalFailureKnown){originalFailureKnown=true;originalFailure=error;}else originalSecondaries.push(error);};
  const originalQuery=client.query.bind(client),originalRelease=client.release.bind(client);
  const control:InputPlanClientV1={query:originalQuery,release:originalRelease,on:client.on.bind(client),
   removeListener:client.removeListener.bind(client),listenerCount:client.listenerCount.bind(client)};
  let baseline:string[]=[];
  try{
   if(control.listenerCount('notice')!==0){failure('listener');known(false);}
   const before=await session(control);known(before.superuser==='on');pids.add(before.pid);
   await originalQuery("LOAD 'auto_explain'");report.library_loaded=true;
   baseline=await readSettings(control);
  }catch(error){failure('load');try{originalRelease(true);}catch(cleanup){throw new AggregateError([error,cleanup],'r16_input_plan_checkout_cleanup_failed',{cause:error});}throw error;}
  activeBorrowed++;
  const release=(destroy?:boolean)=>{
   if(released){failure('release');known(false);}released=true;
   const discard=Boolean(destroy||uncertain||inTransaction||aborted);if(discard){report.discarded=true;if(selectedOnClient&&!report.settings_restored&&!report.rollback_reset_confirmed)failure('release');}
   try{return originalRelease(discard);}catch(error){releaseFailures++;failure('release');if(originalFailureKnown)throw new AggregateError([originalFailure,...originalSecondaries,error],'r16_input_plan_primary_and_release_failed',{cause:originalFailure});throw error;}
   finally{activeBorrowed--;}
  };
  const wrapQuery=async(...args:any[]):Promise<QueryResultV1>=>{
   const text=typeof args[0]==='string'?args[0]:args[0]&&typeof args[0].text==='string'?args[0].text:undefined;
   const normalized=text?.replace(/\s+/gu,' ').trim();
   const target=text!==undefined&&inputPlanTemplateHashV1(text)===targetSha;
   if(target)report.ordinal_seen++;
   if(!target||report.ordinal_seen!==INPUT_PLAN_LIMITS_V1.ordinal){
    try{
     const result=await originalQuery(...args);
     if(normalized==='BEGIN'||normalized?.startsWith('BEGIN ')){inTransaction=true;aborted=false;}
     if(normalized==='COMMIT'||normalized==='ROLLBACK'){
      inTransaction=false;aborted=false;
      if(normalized==='ROLLBACK'&&selectedOnClient&&!report.settings_restored){
       try{known(JSON.stringify(await readSettings(control))===JSON.stringify(baseline));report.rollback_reset_confirmed=true;}
       catch(error){rememberFailure(error);uncertain=true;failure('rollback');}
      }
     }
     return result;
    }catch(error){const priorKnown=originalFailureKnown;rememberFailure(error);aborted=inTransaction;
     if(normalized==='COMMIT'||normalized==='ROLLBACK'||normalized==='BEGIN'||normalized?.startsWith('BEGIN '))uncertain=true;
     if(normalized==='ROLLBACK'&&priorKnown)throw new AggregateError([originalFailure,...originalSecondaries],'r16_input_plan_primary_and_rollback_failed',{cause:originalFailure});
     throw error;}
   }
   report.selected_count++;selectedOnClient=true;
   let previous:string[]|null=null,listener=false,originalKnown=false,originalError:unknown,result:QueryResultV1|undefined;
   let controlStage:InputPlanObservationV1['failure_stage']='context';
   const secondary:unknown[]=[];
   try{
    report.query_raw_match=text===options.target_sql;known(report.query_raw_match&&inTransaction&&!aborted);
    controlStage='listener';known(control.listenerCount('notice')===0);controlStage='context';
    const binds=typeof args[0]==='string'?args[1]:args[0].values;
    known(Array.isArray(binds)&&binds.length===9&&Array.isArray(binds[7]));
    report.bind_count=binds.length;report.root_argument_count=binds[7].length;
    const before=await session(control);known(before.superuser==='on');
    report.rr_read_only=before.isolation==='repeatable read'&&before.readonly==='on';known(report.rr_read_only);
    report.context={backend_sha256:hash(String(before.pid)),role_sha256:hash(before.role),database_sha256:hash(before.database),
     search_path_sha256:hash(before.search_path),snapshot_sha256:hash(before.snapshot),transaction_id_assigned:before.xid!==null};
    controlStage='settings';previous=await readSettings(control);
    // Disable server NOTICE logging before enabling auto_explain. Activate its
    // duration last; all controls finish before the exclusive listener exists.
    for(const index of [14,13,1,2,3,4,5,6,7,8,9,10,11,12,0])await originalQuery('SELECT set_config($1,$2,true)',[settingsNames[index],settingsValues[index]]);
    controlStage='listener';known(control.listenerCount('notice')===0);control.on('notice',collect);listener=true;
    controlStage='original';report.original_executions++;
    try{result=await originalQuery(...args);report.original_succeeded=true;}
    catch(error){originalKnown=true;originalError=error;rememberFailure(error);aborted=true;failure('original');}
    finally{control.removeListener('notice',collect);listener=false;}
    if(!originalKnown){
     // No observation SQL runs in a transaction aborted by the original.
     controlStage='restore';await originalQuery('SELECT set_config($1,$2,true)',['auto_explain.log_min_duration','-1']);
     for(let i=1;i<settingsNames.length;i++)await originalQuery('SELECT set_config($1,$2,true)',[settingsNames[i],previous[i]]);
     await originalQuery('SELECT set_config($1,$2,true)',[settingsNames[0],previous[0]]);
     known(JSON.stringify(await readSettings(control))===JSON.stringify(previous));report.settings_restored=true;
     const after=await session(control);
     report.context_stable=after.pid===before.pid&&after.role===before.role&&after.database===before.database&&after.search_path===before.search_path&&
      after.isolation===before.isolation&&after.readonly===before.readonly&&after.snapshot===before.snapshot;
     known(report.context_stable&&result&&Array.isArray(result.rows));report.returned_rows=result.rows.length;
    }
   }catch(error){secondary.push(error);uncertain=true;failure(controlStage);}
   finally{
    if(listener){try{control.removeListener('notice',collect);}catch(error){secondary.push(error);uncertain=true;failure('listener');}}
   }
   if(originalKnown){if(secondary.length){for(const error of secondary)rememberFailure(error);throw new AggregateError([originalError,...secondary],'r16_input_plan_original_and_observer_failed',{cause:originalError});}throw originalError;}
   if(secondary.length){const error=secondary.length===1?secondary[0]:new AggregateError(secondary,'r16_input_plan_observer_controls_failed');rememberFailure(error);throw error;}
   known(result);report.result_reference_preserved=true;return result;
  };
  return new Proxy(client,{get(target,key){if(key==='query')return wrapQuery;if(key==='release')return release;
   const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
 };
 return{
  wrapDatabase<T extends InputPlanDatabaseV1>(database:T):T{return new Proxy(database,{get(target,key){
   if(key==='connect')return async(...args:any[])=>{known(args.length===0);return borrowed(await target.connect());};
   if(key==='query')return(...args:any[])=>{const text=typeof args[0]==='string'?args[0]:args[0]?.text;
    // The target must be the client's native RR transaction, never Pool.query.
    if(typeof text==='string'&&inputPlanTemplateHashV1(text)===targetSha){failure('context');known(false);}
    return target.query(...args);};
   const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});},snapshot,backendPids:()=>[...pids],
  lifecycle:()=>({active_borrowed:activeBorrowed,release_failures:releaseFailures}),
 };
}

export const INPUT_PLAN_GATES_V1=['original_query','parent_and_nested','rr_identity','controls_closed','source_binding','factory_closed','recording_complete'] as const;
type SourceV1=Awaited<ReturnType<typeof captureR16SourceProvenanceV1>>;
type ExpectedV1=ReturnType<typeof captureR16ExpectedGitProvenanceV1>;
function sameSource(a:SourceV1|ExpectedV1|null,b:SourceV1|ExpectedV1|null){return!!a&&!!b&&a.head_sha===b.head_sha&&a.source_tree_sha256===b.source_tree_sha256&&a.tree_status_sha256===b.tree_status_sha256&&a.file_count===b.file_count&&JSON.stringify(a.file_manifest)===JSON.stringify(b.file_manifest);}
export type InputPlanStorageV1={storage_owned:boolean;storage_closed:boolean|null;storage_absent:boolean|null};
/** Only a newly created UUID directory is owned. The body's normal return
 * acknowledges the benchmark's awaited HTTP finally. On rejection that ACK is
 * UNKNOWN, even if exact-directory removal succeeds. No parent/glob cleanup. */
export async function withListeningInputPlanStorageV1<T>(evidenceDirectory:string,state:InputPlanStorageV1,body:(directory:string)=>Promise<T>):Promise<T>{
 const parent=dirname(resolve(evidenceDirectory));known(await realpath(parent)===parent);
 const directory=join(parent,'input-plan-storage-'+randomUUID());let owned=false,primaryKnown=false,primary:unknown,value:T|undefined;
 try{
  await mkdir(directory,{mode:0o700});
  known(await realpath(directory)===directory&&await realpath(dirname(directory))===parent);
  owned=true;state.storage_owned=true;
  try{value=await body(directory);state.storage_closed=true;}
  catch(error){primaryKnown=true;primary=error;state.storage_closed=null;}
 }catch(error){primaryKnown=true;primary=error;}
 finally{
  if(owned){try{
   known(await realpath(directory)===directory&&await realpath(dirname(directory))===parent);
   await rm(directory,{recursive:true,force:false});
   try{await lstat(directory);known(false);}catch(error){known(error!==null&&typeof error==='object'&&Object.getOwnPropertyDescriptor(error,'code')?.value==='ENOENT');}
   state.storage_absent=true;
  }catch(error){state.storage_absent=false;if(primaryKnown)throw new AggregateError([primary,error],'r16_input_plan_storage_and_execution_failed',{cause:primary});throw error;}}
 }
 if(primaryKnown)throw primary;return value as T;
}
export type InputPlanProbeReceiptV1={
 contract:'r16-listening-input-plan-v1';status:'observed'|'failed'|'INCONCLUSIVE';findings:'INCONCLUSIVE';
 diagnostic_only:true;h1_accepted:false;cpu:'UNKNOWN';owned_scope:'accredited_ci_lab_database';
 provider_mode:'unmodified_driver_synthetic_transport';external_provider_spend_micro_usd:0;external_provider_requests:0;evidence_basis:string;storage:InputPlanStorageV1;
 gates:Record<typeof INPUT_PLAN_GATES_V1[number],boolean>;observation:InputPlanObservationV1|null;
 source:{expected_git:ExpectedV1|null;before:SourceV1|null;after:SourceV1|null};
 closure:{callback_entered:boolean;callback_complete:boolean;factory_returned_normally:boolean;observed_backends:number;
  observed_backends_absent:boolean|null;admin_closed:boolean;database_identity_matched:boolean;active_borrowed:number;release_failures:number};
 clock:{total_ms:number};error:ReturnType<typeof startupErrorTreeV1>|null;
 limitations:ReadonlyArray<string>;
};
/** Diagnostic runner, not the Full CLI: no fault pack and no H1 assertion.
 * Dataset, provider, admission clock, native guards, drain and serving checks
 * are all supplied by the unmodified benchmark and native fixture.
 * The native fixture owns the accredited CI database, NOT a disposable clone;
 * no database-absence or library-unload claim is made. */
export async function runR16ListeningInputPlanProbeV1(directory:string):Promise<InputPlanProbeReceiptV1>{
 const started=performance.now();
 const providerWitness={provider_mode:'unmodified_driver_synthetic_transport',external_provider_spend_micro_usd:0,external_provider_requests:0,
  evidence_basis:'immutable source of existing native synthetic fixture and benchmark with injected createSyntheticJevFetchV1; local Storage/PG/Redis; no external provider transport; guarantee by pinned source/configuration, not an observed network counter or cash receipt'} as const;
 const report:InputPlanProbeReceiptV1={contract:'r16-listening-input-plan-v1',status:'INCONCLUSIVE',findings:'INCONCLUSIVE',
  diagnostic_only:true,h1_accepted:false,cpu:'UNKNOWN',owned_scope:'accredited_ci_lab_database',
  ...providerWitness,
  storage:{storage_owned:false,storage_closed:null,storage_absent:null},
  gates:{original_query:false,parent_and_nested:false,rr_identity:false,controls_closed:false,source_binding:false,factory_closed:false,recording_complete:false},
  observation:null,source:{expected_git:null,before:null,after:null},
  closure:{callback_entered:false,callback_complete:false,factory_returned_normally:false,observed_backends:0,
   observed_backends_absent:null,admin_closed:false,database_identity_matched:false,active_borrowed:0,release_failures:0},
  clock:{total_ms:0},error:null,
  limitations:['diagnostic_only_not_H1','overhead_included_unsubtracted','server_wall_is_not_CPU',
   'node_elapsed_UNKNOWN_TIMING_OFF','original_query_snapshot_not_a_global_pipeline_snapshot',
   'first_representation_only_other_variants_NOT_COLLECTED','nested_callsite_attribution_UNOBSERVABLE',
   'post_receipt_caps_not_backend_or_node_RSS_bounds','library_stays_loaded_until_backend_end',
   'CI_database_exists_by_design_container_retirement_is_external']};
 let observer:ReturnType<typeof createListeningInputPlanObserverV1>|null=null;
 let primaryKnown=false,primary:unknown,callbackPrimaryKnown=false,callbackPrimary:unknown;
 let measurement:Awaited<ReturnType<typeof runR16ListeningBenchmarkV1>>|null=null;
 let preregistration:unknown=null,databaseOid:string|null=null;
 const failures:unknown[]=[];
 const retainFailure=(error:unknown)=>{if(!primaryKnown){primaryKnown=true;primary=error;}else failures.push(error);};
 const dir=resolve(repo,directory),underData=relative(join(repo,'.data'),dir);
 known(underData&&!underData.startsWith('..')&&!underData.startsWith('/'));
 await mkdir(dir,{recursive:true,mode:0o700});known(await realpath(dir)===dir);
 try{
  assertR16ListeningCiEnvironmentV1(process.env);known(process.env.NOISIA_R16_LISTENING_INPUT_PLAN_PG==='true');
  report.source.expected_git=captureR16ExpectedGitProvenanceV1(repo,process.env.GITHUB_SHA??'');
  report.source.before=await captureR16SourceProvenanceV1(repo);known(sameSource(report.source.before,report.source.expected_git));
  const extracted=extractListeningInputPlanQueryV1(await readFile(new URL('../signal-listening-runs.ts',import.meta.url),'utf8'));
  observer=createListeningInputPlanObserverV1({target_sql:extracted.sql});
  // The same accredited empty-lab preflight as the CI driver, without its fault
  // matrix. This pool is closed before the fixture opens its original pool.
  const preflight=await openR16CiPostgresV1();let preflightPrimaryKnown=false,preflightPrimary:unknown;
  try{
   const rows=(await preflight.query(`SELECT (SELECT count(*)::int FROM mentions) roots,
    (SELECT count(*)::int FROM signal_labeling_calls) calls,(SELECT count(*)::int FROM signal_listening_configurations) configurations`)).rows;
   known(rows.length===1&&rows[0].roots===0&&rows[0].calls===0&&rows[0].configurations===0);
  }catch(error){preflightPrimaryKnown=true;preflightPrimary=error;throw error;}
  finally{try{await preflight.end();}catch(error){if(preflightPrimaryKnown)throw new AggregateError([preflightPrimary,error],'r16_input_plan_preflight_close_failed',{cause:preflightPrimary});throw error;}}
  const queryProfiler=new R16QueryProfilerV1();
  const nativeFixture=createR16ListeningNativeFixtureV1({decorateDatabase:db=>observer!.wrapDatabase(queryProfiler.wrapDatabase(db)),
   loadNativeCensus:access=>loadR16ListeningNativeCensusV1(access)});
  const withNativeFixture:Parameters<typeof runR16ListeningBenchmarkV1>[0]['withNativeFixture']=async(context,run)=>{
   try{
    const value=await nativeFixture(context,async f=>{
     report.closure.callback_entered=true;
     try{
      // Identity belongs only to this accredited CI lab. No root/workspace/run
      // identifiers or credentials enter the receipt.
      const identity=(await f.access.database.query("SELECT current_database() database,(SELECT oid::text FROM pg_database WHERE datname=current_database()) oid")).rows[0];
      known(identity?.database==='noisia_mfp_ci'&&typeof identity.oid==='string'&&/^\d+$/u.test(identity.oid));databaseOid=identity.oid;
      const value=await run(f);report.closure.callback_complete=true;return value;
     }catch(error){callbackPrimaryKnown=true;callbackPrimary=error;throw error;}
    });report.closure.factory_returned_normally=true;return value;
   }catch(error){if(callbackPrimaryKnown&&error!==callbackPrimary)throw new AggregateError([callbackPrimary,error],'r16_input_plan_callback_and_factory_failed',{cause:callbackPrimary});throw error;}
  };
  measurement=await withListeningInputPlanStorageV1(dir,report.storage,objectDirectory=>runR16ListeningBenchmarkV1({arm:'defined_consumer_second_pass',object_directory:objectDirectory,
   redis_url:process.env.R16BENCH_REDIS_URL!,query_profiler:queryProfiler,withNativeFixture,
   writePreregistration:async value=>{preregistration={contract:'r16-input-plan-driver-registration-v1',
    registration:value.registration,workload_sha256:hash(JSON.stringify(value)),expected_source_tree_sha256:report.source.expected_git!.source_tree_sha256,
    target_profile:INPUT_PLAN_CURRENT_PROFILE_V1,target_template_sha256:INPUT_PLAN_WIRE_E_TARGET_SHA_V1,legacy_template_sha256:INPUT_PLAN_TARGET_SHA_V1,ordinal:INPUT_PLAN_LIMITS_V1.ordinal,limits:INPUT_PLAN_LIMITS_V1,
    note:'unmodified_driver_registration_not_H1_acceptance'};}}));
  known(measurement.fully_resolved_distinct_roots===32768&&measurement.requests===65536&&measurement.unresolved_roots===0&&
   measurement.capacity_gates.native_processing_complete===true&&measurement.capacity_gates.serving===true&&
   measurement.capacity_gates.expected_primary_request_count===true);
 }catch(error){retainFailure(callbackPrimaryKnown&&error!==callbackPrimary?new AggregateError([callbackPrimary,error],'r16_input_plan_callback_and_driver_failed',{cause:callbackPrimary}):error);}
 finally{
  if(observer){report.observation=observer.snapshot();const state=observer.lifecycle();
   report.closure.active_borrowed=state.active_borrowed;report.closure.release_failures=state.release_failures;
   const observed=observer.backendPids();report.closure.observed_backends=observed.length;
   // Only after the original factory returned normally. Pool.end inside that
   // factory is awaited, and this independent check also observes session end.
   if(report.closure.factory_returned_normally){
    let admin:Awaited<ReturnType<typeof openR16CiPostgresV1>>|null=null,adminPrimaryKnown=false,adminPrimary:unknown;
    try{
     known(observed.length>0&&state.active_borrowed===0&&state.release_failures===0);
     admin=await openR16CiPostgresV1();
     const identity=(await admin.query("SELECT current_database() database,(SELECT oid::text FROM pg_database WHERE datname=current_database()) oid")).rows[0];
     report.closure.database_identity_matched=identity?.database==='noisia_mfp_ci'&&databaseOid!==null&&identity.oid===databaseOid;known(report.closure.database_identity_matched);
     const remaining=(await admin.query<{n:number}>("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND pid=ANY($1::int[])",[observed])).rows[0];
     report.closure.observed_backends_absent=remaining?.n===0;known(report.closure.observed_backends_absent);
    }catch(error){adminPrimaryKnown=true;adminPrimary=error;retainFailure(error);}
    finally{if(admin){try{await admin.end();report.closure.admin_closed=true;}catch(error){retainFailure(adminPrimaryKnown?new AggregateError([adminPrimary,error],'r16_input_plan_postcheck_and_close_failed',{cause:adminPrimary}):error);}}}
   }
  }
  try{report.source.after=await captureR16SourceProvenanceV1(repo);}catch(error){retainFailure(error);}
  report.clock.total_ms=performance.now()-started;
 }
 const observation=report.observation;
 report.gates.original_query=!!observation&&observation.selected_count===1&&observation.original_executions===1&&
  observation.original_succeeded&&observation.query_raw_match&&observation.result_reference_preserved&&observation.bind_count===9&&
  Number.isSafeInteger(observation.root_argument_count)&&observation.root_argument_count!>0&&Number.isSafeInteger(observation.returned_rows)&&observation.returned_rows!>=0;
 report.gates.parent_and_nested=!!observation&&observation.parent_present&&observation.nested_present;
 report.gates.rr_identity=!!observation&&observation.rr_read_only&&observation.context_stable;
 report.gates.controls_closed=!!observation&&(observation.settings_restored||observation.rollback_reset_confirmed||observation.discarded)&&report.closure.active_borrowed===0&&report.closure.release_failures===0;
 report.gates.source_binding=sameSource(report.source.before,report.source.expected_git)&&sameSource(report.source.after,report.source.expected_git);
 report.gates.factory_closed=report.closure.callback_entered&&report.closure.callback_complete&&report.closure.factory_returned_normally&&
  report.closure.observed_backends>0&&report.closure.observed_backends_absent===true&&report.closure.admin_closed&&report.closure.database_identity_matched&&
  report.storage.storage_owned&&report.storage.storage_closed===true&&report.storage.storage_absent===true;
 report.gates.recording_complete=!!observation&&!observation.loss&&observation.status==='observed'&&measurement!==null&&
  measurement.fully_resolved_distinct_roots===32768&&measurement.requests===65536&&measurement.unresolved_roots===0&&
  measurement.capacity_gates.native_processing_complete===true&&measurement.capacity_gates.serving===true&&
  measurement.capacity_gates.expected_primary_request_count===true;
 report.status=primaryKnown?'failed':Object.values(report.gates).every(v=>v===true)?'observed':'INCONCLUSIVE';
 if(primaryKnown)report.error=startupErrorTreeV1(failures.length?new AggregateError([primary,...failures],'r16_input_plan_execution_failed',{cause:primary}):primary);
 // A compact, explicitly diagnostic projection of the original measurement.
 // Configuration/metric labels, request objects and storage bodies are omitted.
 const measurementReceipt={contract:'r16-listening-input-plan-measurement-v1',diagnostic_only:true,h1_accepted:false,cpu:'UNKNOWN',
  ...providerWitness,
  status:report.status,driver:'runR16ListeningBenchmarkV1',registration:preregistration,
  measurement:measurement?{original_measurement_sha256:hash(JSON.stringify(measurement)),
   source_tree_sha256:measurement.source_provenance.source_tree_sha256,roots:measurement.fully_resolved_distinct_roots,
   requests:measurement.requests,unresolved_roots:measurement.unresolved_roots,root_census_digest:measurement.root_census_digest,
   wall_elapsed_ms:measurement.wall_elapsed_ms,classification_wall_elapsed_ms:measurement.classification_wall_elapsed_ms,
   cold_elapsed_ms:measurement.cold_elapsed_ms,jobs:measurement.jobs,job_spans:measurement.job_spans,
   unmodified_driver_capacity_gates_not_acceptance:measurement.capacity_gates,
   sql_profile:measurement.sql_profile,resource_observation:measurement.resource_observation,
   runtime_witness_sha256:hash(JSON.stringify(measurement.runtime_witness))}:null};
 const files=[['input-plan-observer.json',report],['input-plan-measurement.json',measurementReceipt]] as const;
 const encoded=files.map(([name,value])=>({name,bytes:Buffer.from(JSON.stringify(value)+'\n')}));
 try{
  known(encoded.reduce((n,f)=>n+f.bytes.length,0)<=INPUT_PLAN_LIMITS_V1.output_bytes);
  for(const file of encoded){const handle=await open(join(dir,file.name),'wx',0o600);try{await handle.writeFile(file.bytes);await handle.sync();}finally{await handle.close();}}
 }catch(error){const safe=startupErrorTreeV1(primaryKnown?new AggregateError([primary,error],'r16_input_plan_execution_and_publication_failed',{cause:primary}):error);
  throw new Error('r16_input_plan_receipt_publication_failed',{cause:safe});}
 if(report.status!=='observed')throw new Error('r16_input_plan_method_not_observed',{cause:report.error??{status:report.status,stage:observation?.failure_stage??'none'}});
 return report;
}
