import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,open,readFile,realpath} from 'node:fs/promises';
import {dirname,extname,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {PoolClient,QueryResult} from 'pg';
import {captureR16SourceProvenanceV1} from '../../../scripts/r16/source-provenance';
import {runListeningStartupPrefixV1,startupErrorTreeV1,type StartupRosterObserverV1} from './signal-listening-startup-prefix.synthetic.fixture';
import {sanitizeBoundedPopulationPlanV1,type BoundedPopulationPlanRejectionV1} from './signal-listening-bounded-population-plan.synthetic.fixture';
import {createMassLabelingConcurrencyDatabaseV1} from './signal-mass-labeling-concurrent.synthetic.fixture';
import {openR16CiPostgresV1,assertR16LocalPostgresPoolV1} from './signal-r16-local-pg.fixture';
import {assertStartupOwnedAbsentV1} from './signal-listening-startup-prefix.synthetic.fixture';
import {withSharedWireDefaultPostcheckV1} from './signal-listening-statement-shared-wire.oracle';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const sha=(v:string|Uint8Array)=>'sha256:'+createHash('sha256').update(v).digest('hex');
function known(ok:unknown,code:string):asserts ok{if(!ok)throw new Error(code);}
export const rosterExactSqlV1='SELECT root_id FROM signal_mention_facets_current_v1 WHERE workspace_id=$1';
const rosterTemplate='sha256:0e4f7d9708942def156838e598672ee5302c8932e332c3378b42c70dff3bd4f2';
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(v);
export function rosterQueryMatchesV1(text:unknown,values:unknown,workspace:string):boolean{
 try{if(text!==rosterExactSqlV1||!uuid(workspace)||!Array.isArray(values))return false;const length=Object.getOwnPropertyDescriptor(values,'length'),first=Object.getOwnPropertyDescriptor(values,'0');return length?.value===1&&!!first&&'value'in first&&first.value===workspace;}catch{return false;}
}
const paths=['infrastructure/db','services/workers/src/providers','services/workers/src/workers','packages/query-engine/src','scripts/r16','.github/workflows/r16-h1-benchmark.yml'];
const extensions=new Set(['.cjs','.js','.json','.mjs','.sh','.sql','.ts','.tsx','.yaml','.yml']);
export type RosterStaticSourceV1={head_sha:string;source_tree_sha256:string;tree_status_sha256:string;file_manifest:Array<{path:string;sha256:string}>};
export function rosterStaticBindingV1(expected:RosterStaticSourceV1,actual:RosterStaticSourceV1):boolean{
 return /^[a-f0-9]{40}$/u.test(expected.head_sha)&&actual.head_sha===expected.head_sha&&actual.tree_status_sha256===sha('')&&actual.source_tree_sha256===expected.source_tree_sha256&&JSON.stringify(actual.file_manifest)===JSON.stringify(expected.file_manifest);
}
async function expectedStatic(){
 const head=process.env.GITHUB_SHA;known(process.env.GITHUB_ACTIONS==='true'&&typeof head==='string'&&/^[a-f0-9]{40}$/u.test(head),'roster_expected_ci_sha');
 const git=(args:string[])=>execFileSync('git',args,{cwd:repo,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});
 known(git(['rev-parse','--verify',head+'^{commit}']).toString('utf8').trim()===head,'roster_expected_git_object');
 const files=git(['ls-tree','-r','--name-only','-z',head,'--',...paths]).toString('utf8').split('\0').filter(p=>p&&extensions.has(extname(p))).sort();known(files.length>0,'roster_expected_manifest_empty');
 const file_manifest=files.map(path=>({path,sha256:sha(git(['show',head+':'+path]))}));
 return{head_sha:head,source_tree_sha256:sha(JSON.stringify(file_manifest.map(r=>[r.path,r.sha256]))),tree_status_sha256:sha(''),file_manifest};
}
function staticSummary(source:RosterStaticSourceV1){
 const migration38=source.file_manifest.filter(r=>/^infrastructure\/db\/migrations\/(?:029[5-9]|03[0-2][0-9]|033[0-2])_.+\.sql$/u.test(r.path));known(migration38.length===38,'roster_static_sql38');
 const harness=source.file_manifest.filter(r=>r.path.startsWith('scripts/r16/')||/^services\/workers\/src\/(?:workers\/signal-(?:jev|listening)|providers\/jev-streaming)/u.test(r.path));
 return{head_sha:source.head_sha,source_tree_sha256:source.source_tree_sha256,tree_status_sha256:source.tree_status_sha256,file_manifest:source.file_manifest,migration38,harness,sql38_manifest_sha256:sha(JSON.stringify(migration38)),harness_manifest_sha256:sha(JSON.stringify(harness))};
}
export type RosterFunctionNameV1='signal_labeling_json_v1'|'signal_labeling_digest_v1';
export type RosterFunctionIdentityV1={oid:string;function:RosterFunctionNameV1};
export type RosterFunctionRowV1={oid:string;function:RosterFunctionNameV1;calls:number;total_time_ms:number;self_time_ms:number};
export function rosterFunctionDeltasV1(before:ReadonlyArray<RosterFunctionRowV1>,after:ReadonlyArray<RosterFunctionRowV1>,identities:ReadonlyArray<RosterFunctionIdentityV1>){
 const valid=(rows:ReadonlyArray<RosterFunctionRowV1>)=>{known(rows.length<=2&&new Set(rows.map(r=>r.oid)).size===rows.length,'roster_stats_identity');for(const r of rows)known(identities.some(i=>i.oid===r.oid&&i.function===r.function)&&Number.isSafeInteger(r.calls)&&r.calls>=0&&[r.total_time_ms,r.self_time_ms].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0),'roster_stats_number');};valid(before);valid(after);
 known(identities.length===2&&new Set(identities.map(i=>i.oid)).size===2,'roster_stats_catalog');
 return identities.map(i=>{const b=before.find(r=>r.oid===i.oid),a=after.find(r=>r.oid===i.oid);const present=!!b&&!!a,monotone=present&&a.calls>=b.calls&&a.total_time_ms>=b.total_time_ms&&a.self_time_ms>=b.self_time_ms;return{...i,status:monotone?'known' as const:'UNKNOWN' as const,calls:monotone?a.calls-b.calls:null,total_time_ms:monotone?a.total_time_ms-b.total_time_ms:null,self_time_ms:monotone?a.self_time_ms-b.self_time_ms:null};});
}
export function rosterFindingsV1(usable:boolean,visibility:'expanded'|'partly_opaque'|'opaque'|'UNKNOWN',serializer:'known'|'UNKNOWN',digest:'known'|'UNKNOWN'){
 return{status:usable?'INCONCLUSIVE' as const:'UNKNOWN' as const,view_plan_visibility:visibility,serializer_delta_status:serializer,digest_delta_status:digest,input_digest_callsite_attribution:'UNOBSERVABLE',callsites_resolution:'unresolved',interpretation:usable?'partial_method_data_not_enough_to_establish_repetition':'no_usable_observation'};
}
type Queryable={query:(...args:any[])=>any};
const contextSql="SELECT pg_backend_pid()::text backend,pg_current_xact_id_if_assigned()::text transaction_id,pg_current_snapshot()::text snapshot,current_user invoker,session_user session_user,current_setting('role') role,current_setting('search_path') search_path,current_setting('track_functions') track_functions,current_setting('transaction_isolation') isolation";
const viewSql="SELECT c.oid::text,c.relowner::text,c.relkind,c.reloptions,c.relacl::text,pg_get_viewdef(c.oid,true) definition,(SELECT jsonb_agg(jsonb_build_array(a.attnum,a.attacl::text) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) column_acls FROM pg_class c WHERE c.oid='public.signal_mention_facets_current_v1'::regclass";
const functionSql="SELECT p.oid::text,p.proname,p.prosrc,p.proowner::text,p.proacl::text,p.proconfig,p.prosecdef,p.provolatile,p.proisstrict,p.proparallel,p.proargtypes::text,l.lanname FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=ANY(ARRAY['public.signal_labeling_json_v1(jsonb)'::regprocedure::oid,'public.signal_labeling_digest_v1(jsonb)'::regprocedure::oid]) ORDER BY p.proname";
async function catalog(client:Queryable){
 const views=(await client.query(viewSql)).rows,functions=(await client.query(functionSql)).rows;known(views.length===1&&views[0].relkind==='v'&&functions.length===2,'roster_native_catalog');
 const sql=await readFile(new URL('./0223_signal_mention_facets.sql',import.meta.url),'utf8');
 const identities:RosterFunctionIdentityV1[]=functions.map((f:any)=>{known(f.proname==='signal_labeling_json_v1'||f.proname==='signal_labeling_digest_v1','roster_native_function');const match=new RegExp('CREATE FUNCTION '+f.proname+'\\(value jsonb\\)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;','u').exec(sql);known(match&&f.prosrc===match[1]&&!f.prosecdef&&f.provolatile==='i'&&f.proisstrict===true&&f.lanname===(f.proname==='signal_labeling_json_v1'?'plpgsql':'sql'),'roster_native_function_source');return{oid:f.oid,function:f.proname};});
 const v=views[0];return{identities,view:{oid:v.oid,owner_oid_sha256:sha(v.relowner),relkind:v.relkind,reloptions_sha256:sha(JSON.stringify(v.reloptions)),acl_sha256:sha(String(v.relacl)),definition_sha256:sha(v.definition),column_acl_sha256:sha(JSON.stringify(v.column_acls))},functions:functions.map((f:any)=>({oid:f.oid,function:f.proname,body_sha256:sha(f.prosrc),owner_oid_sha256:sha(f.proowner),acl_sha256:sha(String(f.proacl)),proconfig:f.proconfig,prosecdef:f.prosecdef,provolatile:f.provolatile,proisstrict:f.proisstrict,proparallel:f.proparallel,proargtypes:f.proargtypes,language:f.lanname}))};
}
async function readStats(client:Queryable,identities:RosterFunctionIdentityV1[]){
 const rows=(await client.query('SELECT funcid::text oid,calls::text,total_time::float8 total_time_ms,self_time::float8 self_time_ms FROM pg_stat_xact_user_functions WHERE funcid=ANY($1::oid[]) ORDER BY funcid',[identities.map(i=>i.oid)])).rows;
 return rows.map((r:any)=>{const identity=identities.find(i=>i.oid===r.oid);known(identity,'roster_stats_unexpected_oid');return{...identity,calls:Number(r.calls),total_time_ms:r.total_time_ms,self_time_ms:r.self_time_ms};}) as RosterFunctionRowV1[];
}
async function rosterPlanIdentifiersV1(client:Queryable){
 const viewSource=await readFile(new URL('./0258_signal_membership_context_review.sql',import.meta.url),'utf8'),identifiers=new Set([...viewSource.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gu),...viewSource.matchAll(/\b([a-z_][a-z0-9_]*)\s+AS\s+(?:MATERIALIZED\s*)?\(/gu),...viewSource.matchAll(/\b([a-z_][a-z0-9_]*)\(/gu)].map(m=>m[1]!));
 const catalogNames=(await client.query("SELECT c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND (c.relname=ANY($1::text[]) OR c.oid IN(SELECT i.indexrelid FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid WHERE t.relname=ANY($1::text[]) AND t.relnamespace=n.oid))",[[...identifiers]])).rows;for(const r of catalogNames)identifiers.add(r.name);
 return identifiers;
}
export const rosterFormatPlaceholderV1='00000000-0000-4000-8000-000000000000';
/** Format smoke only: no ANALYZE, seed, admitted workspace or runtime claim. */
export async function readRosterFormatPlanV1(client:Pick<PoolClient,'query'>,observeRejection?:(reason:BoundedPopulationPlanRejectionV1)=>void,clock:()=>number=()=>performance.now()){
 const started=clock();const explained=await client.query<Record<string,unknown>>('EXPLAIN (FORMAT JSON) '+rosterExactSqlV1,[rosterFormatPlaceholderV1]);
 known(explained.rows.length===1&&Array.isArray(explained.rows[0]!['QUERY PLAN']),'roster_format_explain_document');
 const explain_elapsed_ms=clock()-started,identifiers=await rosterPlanIdentifiersV1(client);
 const sanitized=sanitizeBoundedPopulationPlanV1(explained.rows[0]!['QUERY PLAN'],identifiers,observeRejection);
 return{status:'observed' as const,format_only:true as const,analyze:false as const,placeholder_not_admitted:true as const,query_template_sha256:rosterTemplate,bind_count:1,explain_count:1,explain_elapsed_ms,sanitized};
}
export type RosterFormatPreflightV1=Record<string,unknown>&{status:'not_started'|'running'|'observed'|'failed';format_only:true;analyze:false;seeded_roots:0};
export async function runRosterFormatPreflightV1(clock:()=>number=()=>performance.now(),observe?:(value:RosterFormatPreflightV1)=>void):Promise<RosterFormatPreflightV1>{
 const started=clock(),result:RosterFormatPreflightV1={status:'not_started',format_only:true,analyze:false,seeded_roots:0,placeholder_not_admitted:true,provider_http_calls:0,explain_count:0,sanitizer_rejection:null,own_name_oid_sha256:'UNKNOWN',own_database_absent:'UNKNOWN',admin_end_awaited:false,elapsed_ms:0,explain_elapsed_ms:null};
 const publish=()=>{try{observe?.(result);}catch{/* Metadata cannot replace method failure. */}};publish();
 let own:{name:string;oid:string}|undefined,created:Awaited<ReturnType<typeof createMassLabelingConcurrencyDatabaseV1>>|undefined,failed=false,primary:unknown;
 try{
  known(process.env.GITHUB_ACTIONS==='true','roster_format_owned_ci');const admin=await openR16CiPostgresV1();
  await withSharedWireDefaultPostcheckV1(async()=>{
   assertR16LocalPostgresPoolV1(admin);result.status='running';created=await createMassLabelingConcurrencyDatabaseV1(admin);
   await withSharedWireDefaultPostcheckV1(async()=>{
    const client=await created!.pool.connect();let uncertain=false;
    await withSharedWireDefaultPostcheckV1(async()=>{try{
     const row=(await client.query("SELECT current_database() name,(SELECT oid::text FROM pg_database WHERE datname=current_database()) oid,(SELECT count(*)::int FROM signal_workspaces) workspaces,(SELECT count(*)::int FROM mentions) mentions,(SELECT count(*)::int FROM signal_labeling_calls) calls")).rows[0];
     known(/^noisia_mfp_recovery_[a-f0-9]{32}$/u.test(row.name)&&/^\d+$/u.test(row.oid),'roster_format_owned_database');own={name:row.name,oid:row.oid};result.own_name_oid_sha256=sha(JSON.stringify(own));known(row.workspaces===0&&row.mentions===0&&row.calls===0,'roster_format_database_not_empty');const beforeCatalog=await catalog(client);result.catalog_binding={before_sha256:sha(JSON.stringify(beforeCatalog)),after_sha256:'UNKNOWN',unchanged:false,source_declared_bodies_and_attrs_match:false};
     const begin=clock();result.explain_count=1;try{const plan=await readRosterFormatPlanV1(client,reason=>{if(result.sanitizer_rejection===null)result.sanitizer_rejection=reason;},clock);result.explain_elapsed_ms=plan.explain_elapsed_ms;result.plan={format_only:true,query_template_sha256:plan.query_template_sha256,bind_count:plan.bind_count,explain_count:plan.explain_count,nodes:plan.sanitized.nodes,bytes:plan.sanitized.bytes,raw_sha256:plan.sanitized.plan_sha256,sanitized_sha256:plan.sanitized.sanitized_sha256,jit:plan.sanitized.jit,parallel:plan.sanitized.parallel};}finally{result.format_read_elapsed_ms=clock()-begin;}
     const afterCatalog=await catalog(client);known(JSON.stringify(afterCatalog)===JSON.stringify(beforeCatalog),'roster_format_catalog_changed');Object.assign(result.catalog_binding as object,{after_sha256:sha(JSON.stringify(afterCatalog)),unchanged:true,source_declared_bodies_and_attrs_match:true});
    }catch(error){uncertain=true;throw error;}},async()=>{client.release(uncertain);});
   },async()=>{
    const errors:unknown[]=[];try{await created!.cleanup();}catch(error){errors.push(error);}
    if(own){let client:PoolClient|undefined;try{client=await admin.connect();await assertStartupOwnedAbsentV1(client,own,()=>undefined);result.own_database_absent=true;}catch(error){errors.push(error);}finally{try{client?.release();}catch(error){errors.push(error);}}}
    if(errors.length===1)throw errors[0];if(errors.length>1)throw new AggregateError(errors,'roster_format_cleanup_and_absence_failed',{cause:errors[0]});
   });
  },async()=>{await admin.end();result.admin_end_awaited=true;});
  known(result.own_database_absent===true&&result.admin_end_awaited===true,'roster_format_cleanup_unconfirmed');result.status='observed';
 }catch(error){failed=true;primary=error;result.status='failed';result.error_tree=startupErrorTreeV1(error);}
 result.elapsed_ms=clock()-started;publish();if(failed)throw primary;return result;
}
/** One exact interception in the existing native transaction. Auxiliary queries
 * use that original client directly, so they cannot recursively hit this hook. */
export function createRosterQueryObserverV1(clock:()=>number=()=>performance.now()){
 let workspace:string|undefined,selected:object|undefined,matches=0,primary:unknown,sticky=false,stage='setup',primaryStage='UNKNOWN',captured:Record<string,unknown>|undefined,commitAck=false,released=false,discarded=false,rollbackReset=false;
 const states=new WeakMap<object,{active:boolean;uncertain:boolean;terminal_uncertain:boolean}>(),times:Record<string,number>={},original:Record<string,unknown>={template_sha256:rosterTemplate,raw_sql_match:false,one_bind_match:false,call_count:0,success:false,same_result_reference:false,roster_count:null,ordered_root_sha256:null,bag_root_sha256:null};
 let plan:Record<string,unknown>={status:'UNKNOWN',explain_count:0},stats:Record<string,unknown>={status:'UNKNOWN',before:[],after:[],deltas:[],baseline_required_present:false,backend_same:false,transaction_same:false,interpretation:'elapsed query-level function counters, not CPU or callsite attribution'},context:Record<string,unknown>={snapshot_original:'UNOBSERVABLE'},nativeCatalog:Record<string,unknown>={before:null,after:null,unchanged:false,source_declared_bodies_and_attrs_match:false};
 const fail=(error:unknown)=>{if(!sticky){primary=error;primaryStage=stage;}sticky=true;};
 const measure=async<T>(name:string,body:()=>Promise<T>)=>{const start=clock();try{return await body();}finally{times[name]=clock()-start;}};
 const observe=async(client:Queryable,args:any[],forward:()=>any)=>{
  stage='query_match';known(!sticky&&matches===0&&workspace&&rosterQueryMatchesV1(args[0],args[1],workspace)&&args.length===2,'roster_exact_query_once');matches++;selected=client;original.raw_sql_match=true;original.one_bind_match=true;original.call_count=matches;
  const state=states.get(client);known(state?.active&&!state.uncertain,'roster_native_transaction');
  try{
   stage='context_before';const before=(await client.query(contextSql)).rows[0],catBefore=await catalog(client);nativeCatalog.before=catBefore;known(before.isolation==='read committed'&&['none','pl','all'].includes(before.track_functions),'roster_context_before');
   context={...context,backend_sha256:sha(before.backend),transaction_sha256:before.transaction_id===null?'UNKNOWN':sha(before.transaction_id),invoker_role_sha256:sha(before.invoker),session_user_sha256:sha(before.session_user),view_owner_oid_sha256:catBefore.view.owner_oid_sha256,search_path_sha256:sha(before.search_path),original_isolation:before.isolation,track_functions_before:before.track_functions,track_functions_during:'all',track_functions_after:'UNKNOWN',local_setting_restored:false,rollback_reset_confirmed:false,snapshot_before_explain_sample_sha256:sha(before.snapshot),snapshot_after_explain_sample_sha256:'UNKNOWN'};
   stage='tracking_enable';await client.query("SET LOCAL track_functions='all'");
   stage='original_query';const result=await measure('original_roster_instrumented_ms',()=>Promise.resolve(forward()));known(result&&Array.isArray(result.rows)&&result.rows.length<=32768,'roster_original_rows');const roots=result.rows.map((r:any)=>r.root_id);known(roots.every(uuid),'roster_original_root');original.success=true;original.roster_count=roots.length;original.ordered_root_sha256=sha(JSON.stringify(roots));original.bag_root_sha256=sha(JSON.stringify([...roots].sort()));
   stage='counter_before';const beforeStats=await measure('diagnostic_counter_before_ms',()=>readStats(client,catBefore.identities));
   stage='explain';plan.explain_count=1;const explained=await measure<QueryResult<Record<string,unknown>>>('diagnostic_explain_ms',()=>client.query('EXPLAIN (ANALYZE,BUFFERS,TIMING ON,FORMAT JSON) '+rosterExactSqlV1,args[1]));
   stage='counter_after';const afterStats=await measure('diagnostic_counter_after_ms',()=>readStats(client,catBefore.identities));
   const deltas=rosterFunctionDeltasV1(beforeStats,afterStats,catBefore.identities);stats={...stats,status:deltas.every(d=>d.status==='known')?'known':'UNKNOWN',before:beforeStats,after:afterStats,deltas,baseline_required_present:catBefore.identities.every(i=>beforeStats.some(r=>r.oid===i.oid)),backend_same:false,transaction_same:false};
   stage='plan_sanitize';known(explained.rows.length===1&&Array.isArray(explained.rows[0]!['QUERY PLAN']),'roster_explain_document');
   const identifiers=await rosterPlanIdentifiersV1(client);
   const sanitized=sanitizeBoundedPopulationPlanV1(explained.rows[0]!['QUERY PLAN'],identifiers,reason=>{if(!plan.sanitizer_rejection)plan.sanitizer_rejection=reason;});plan={status:'observed',explain_count:1,sanitized,nodes:sanitized.nodes,bytes:sanitized.bytes,raw_sha256:sanitized.plan_sha256,sanitized_sha256:sanitized.sanitized_sha256,jit:sanitized.jit,parallel:sanitized.parallel};
   const after=(await client.query(contextSql)).rows[0],catAfter=await catalog(client);nativeCatalog.after=catAfter;known(JSON.stringify(catAfter)===JSON.stringify(catBefore),'roster_catalog_changed');nativeCatalog.unchanged=true;nativeCatalog.source_declared_bodies_and_attrs_match=true;
   known(after.backend===before.backend&&after.transaction_id===before.transaction_id&&after.invoker===before.invoker&&after.session_user===before.session_user&&after.role===before.role&&after.search_path===before.search_path&&after.isolation===before.isolation&&after.track_functions==='all','roster_context_changed');context.snapshot_after_explain_sample_sha256=sha(after.snapshot);stats.backend_same=true;stats.transaction_same=true;
   stage='tracking_restore';await measure('diagnostic_restore_ms',()=>client.query("SET LOCAL track_functions='"+before.track_functions+"'"));const restored=(await client.query("SELECT current_setting('track_functions') value")).rows[0];known(restored.value===before.track_functions,'roster_tracking_not_restored');context.track_functions_after=restored.value;context.local_setting_restored=true;
   stage='original_continuation';original.same_result_reference=true;return result;
  }catch(error){fail(error);state.uncertain=true;throw error;}
 };
 const hook:StartupRosterObserverV1={kind:'roster_exact_query_observer',bindWorkspace(value){known(!workspace&&uuid(value),'roster_workspace_binding');workspace=value;},
  query(client,args,forward,borrowedClient){
   const text=typeof args[0]==='string'?args[0]:undefined,isRoster=text===rosterExactSqlV1||typeof text==='string'&&sha(text.replace(/\s+/gu,' ').trim())===rosterTemplate;
   if(isRoster){try{known(borrowedClient,'roster_requires_original_client');return observe(client,args,forward).catch(error=>{fail(error);throw error;});}catch(error){fail(error);throw error;}}
   if(!borrowedClient)return forward();const control=typeof text==='string'?text.trim().toUpperCase():'';let state=states.get(client);if(!state){state={active:false,uncertain:false,terminal_uncertain:false};states.set(client,state);}
   if(sticky&&client===selected&&control!=='ROLLBACK')throw primary;
   if(control==='BEGIN'||control==='COMMIT'||control==='ROLLBACK'){
    try{return Promise.resolve(forward()).then(result=>{if(control==='BEGIN'){state!.active=true;}else{state!.active=false;if(client===selected&&control==='COMMIT')commitAck=true;if(client===selected&&control==='ROLLBACK'){rollbackReset=true;context.rollback_reset_confirmed=true;state!.uncertain=false;}}return result;},error=>{state!.uncertain=true;if(control==='BEGIN'||control==='COMMIT')state!.terminal_uncertain=true;if(client===selected)fail(error);throw error;});}catch(error){state.uncertain=true;if(control==='BEGIN'||control==='COMMIT')state.terminal_uncertain=true;if(client===selected)fail(error);throw error;}
   }return forward();
  },
  release(client,args,forward){const state=states.get(client);if(client===selected)released=true;if(state?.uncertain||state?.terminal_uncertain||state?.active){if(client===selected)discarded=true;return forward([true]);}return forward(args);},
  capture(value){captured=value;}
 };
 return{...hook,snapshot(){return{original,plan,function_stats:stats,context,native_catalog:nativeCatalog,clock:{...times},sticky_failure:sticky,primary_stage:primaryStage,commit_ack:commitAck,client_released:released,uncertain_client_discarded:discarded,rollback_reset_confirmed:rollbackReset,original_matches:matches};},getPrimary:()=>primary,getCapturedNative:()=>captured};
}
export const rosterGateNamesV1=['source_binding','exact_original_call_once','native_context_preserved','one_complete_plan','original_flow_committed','closure_confirmed'] as const;
export type RosterExactQueryReceiptV1=Record<string,unknown>&{contract:'r16-roster-query-plan-v2';status:'observed'|'failed';diagnostic_only:true;h1_accepted:false;cpu:'UNKNOWN';speedup_claim:false;gates:Record<typeof rosterGateNamesV1[number],boolean>};
function safeFailure(primary:unknown){const tree=startupErrorTreeV1(primary);return new Error('roster_exact_plan_failed_see_safe_evidence',{cause:Buffer.byteLength(JSON.stringify(tree))<=24576?tree:{truncated:true,root:{omitted:'safe_tree_limit'}}});}
async function write(directory:string,report:RosterExactQueryReceiptV1){const dir=resolve(repo,directory),sub=relative(resolve(repo,'.data'),dir);known(sub&&!sub.startsWith('..')&&!sub.startsWith('/'),'roster_evidence_path');const bytes=JSON.stringify(report)+'\n';known(Buffer.byteLength(bytes)<=2097152,'roster_evidence_bytes');await mkdir(dir,{recursive:true,mode:0o700});known(await realpath(dir)===dir,'roster_evidence_symlink');const file=await open(resolve(dir,'roster-exact-plan.json'),'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}}
export async function runRosterExactQueryObserverV1(directory:string):Promise<RosterExactQueryReceiptV1>{
 const start=performance.now(),clock=()=>performance.now()-start,observer=createRosterQueryObserverV1(clock);
 const report:RosterExactQueryReceiptV1={contract:'r16-roster-query-plan-v2',status:'failed',diagnostic_only:true,h1_accepted:false,cpu:'UNKNOWN',speedup_claim:false,gates:Object.fromEntries(rosterGateNamesV1.map(k=>[k,false])) as RosterExactQueryReceiptV1['gates'],findings:rosterFindingsV1(false,'UNKNOWN','UNKNOWN','UNKNOWN'),source:{expected_binding_status:'PENDING',before:null,after:null},native_catalog:null,original:null,plan:null,function_stats:null,context:null,error:{primary_stage:'UNKNOWN',safe_tree:null,secondary_safe_tree:null,sticky_failure:false,primary_preserved:false},clock:{},native_state:null,closure:null,format_preflight:{status:'not_started'},bounds:{setup_observed_ms:1800000,prefix_instrumented_observed_ms:120000,total_observed_ms:1920000,job_hard_minutes:40,plan_nodes:512,plan_depth:32,plan_bytes:1048576,receipt_json_bytes:2097152,tap_bytes:1048576,artifact_zip_bytes:4194304,artifact_expanded_bytes:3145728,artifact_file_count_exact:2}};
 let expected:RosterStaticSourceV1|undefined,before:RosterStaticSourceV1|undefined,failed=false,primary:unknown,runnerStage='source_before',runtime_started_at_ms:number|null=null,combined_setup_ms:number|null=null;
 try{
  expected=await expectedStatic();before=await captureR16SourceProvenanceV1(repo);known(rosterStaticBindingV1(expected,before),'roster_source_before');const summary=staticSummary(expected);report.source={expected_binding_status:'bound_to_immutable_ci_git_object',expected_head_sha:expected.head_sha,expected_static_manifest_sha256:expected.source_tree_sha256,expected_sql38_manifest_sha256:summary.sql38_manifest_sha256,expected_harness_manifest_sha256:summary.harness_manifest_sha256,before:staticSummary(before),after:null,before_after_exact:false,matches_expected_static:false,external_prereg_binding_status:'Root_postrun_reader_must_compare_external_freeze'};
  runnerStage='format_preflight';const preflight=await runRosterFormatPreflightV1(clock,value=>{report.format_preflight={...value,source_binding:{expected_head_sha:expected!.head_sha,expected_static_manifest_sha256:expected!.source_tree_sha256,matches_before:true}};});known(preflight.status==='observed'&&preflight.own_database_absent===true&&preflight.admin_end_awaited===true,'roster_format_preflight_incomplete');known(clock()<=1800000,'roster_preflight_setup_soft_cap');
  runnerStage='runtime';runtime_started_at_ms=clock();await runListeningStartupPrefixV1(directory,observer);const native=observer.getCapturedNative(),o=observer.snapshot();known(native&&native.status==='observed'&&!o.sticky_failure,'roster_original_flow_failed');
  const runtime_setup_ms=native.setup_ms;known(Number.isFinite(runtime_started_at_ms)&&runtime_started_at_ms>=0&&typeof runtime_setup_ms==='number'&&Number.isFinite(runtime_setup_ms)&&runtime_setup_ms>=0,'roster_combined_setup_clock_invalid');combined_setup_ms=runtime_started_at_ms+runtime_setup_ms;known(Number.isFinite(combined_setup_ms)&&combined_setup_ms<=1800000,'roster_combined_setup_soft_cap');
  known(o.original_matches===1&&o.original.same_result_reference===true&&o.original.success===true&&o.original.roster_count===32768,'roster_original_call_incomplete');report.gates.exact_original_call_once=true;
  known(o.native_catalog.unchanged===true&&o.context.local_setting_restored===true&&o.commit_ack&&o.client_released,'roster_native_context_incomplete');report.gates.native_context_preserved=true;
  known(o.plan.status==='observed'&&o.plan.explain_count===1,'roster_missing_plan');report.gates.one_complete_plan=true;
  const n=native.native as any;known(n&&n.census_roots===32768&&n.question_pairs===131072&&n.state.calls===0&&n.state.answers===0&&n.state.calibrations===0&&n.state.call_money==='0'&&n.state.unleased&&n.provider_calls===0,'roster_initial_state');report.native_state={corpus_roots:32768,initial_census_roots:n.census_roots,initial_census_rows:n.question_pairs,listening_calls:n.state.calls,listening_answers:n.state.answers,calibration_profiles:n.state.calibrations,open_exposure_micro_usd:0,lease_absent:n.state.unleased,provider_http_calls:n.provider_calls};report.gates.original_flow_committed=true;
  const c=native.closure as any;known(c&&c.callback_entered&&c.callback_complete&&c.factory_returned_normally&&c.own_database_absent===true,'roster_closure_unconfirmed');report.gates.closure_confirmed=true;
  const after=await captureR16SourceProvenanceV1(repo);known(rosterStaticBindingV1(expected,after),'roster_source_after');Object.assign(report.source as object,{after:staticSummary(after),before_after_exact:JSON.stringify(before)===JSON.stringify(after),matches_expected_static:true});known(JSON.stringify(before)===JSON.stringify(after),'roster_source_changed');report.gates.source_binding=true;
  known(clock()<=1920000&&Object.values(report.gates).every(v=>v===true),'roster_total_or_gate_incomplete');report.status='observed';
 }catch(error){failed=true;const retained=observer.getPrimary();primary=retained&&retained!==error?new AggregateError([retained,error],'roster_primary_and_outer_failure',{cause:retained}):error;report.error={primary_stage:observer.snapshot().primary_stage==='UNKNOWN'?runnerStage:observer.snapshot().primary_stage,safe_tree:startupErrorTreeV1(primary),secondary_safe_tree:null,sticky_failure:observer.snapshot().sticky_failure,primary_preserved:!!retained};}
 if(expected&&before&&!(report.source as any).after){try{const after=await captureR16SourceProvenanceV1(repo);Object.assign(report.source as object,{after:staticSummary(after),before_after_exact:JSON.stringify(before)===JSON.stringify(after),matches_expected_static:rosterStaticBindingV1(expected,after)});}catch(error){primary=failed?new AggregateError([primary,error],'roster_primary_and_source_failure',{cause:primary}):error;failed=true;report.status='failed';(report.error as any).safe_tree=startupErrorTreeV1(primary);}}
 const o=observer.snapshot(),native=observer.getCapturedNative(),closure=native?.closure as any;report.original=o.original;report.plan=o.plan;report.function_stats=o.function_stats;report.context=o.context;report.native_catalog=o.native_catalog;
 const deltas=(o.function_stats.deltas??[]) as Array<{function:string;status:'known'|'UNKNOWN'}>;const serializer=deltas.find(d=>d.function==='signal_labeling_json_v1')?.status??'UNKNOWN',digest=deltas.find(d=>d.function==='signal_labeling_digest_v1')?.status??'UNKNOWN';report.findings=rosterFindingsV1(report.status==='observed'&&o.plan.status==='observed',o.plan.status==='observed'?'partly_opaque':'UNKNOWN',serializer,digest);
 const captured_setup_ms=native?.setup_ms,combined_setup_observed=typeof runtime_started_at_ms==='number'&&Number.isFinite(runtime_started_at_ms)&&runtime_started_at_ms>=0&&typeof captured_setup_ms==='number'&&Number.isFinite(captured_setup_ms)&&captured_setup_ms>=0?runtime_started_at_ms+captured_setup_ms:null;
 combined_setup_ms=combined_setup_observed!==null&&Number.isFinite(combined_setup_observed)?combined_setup_observed:null;
 report.clock={runtime_started_at_ms,combined_setup_ms,preflight_ms:(report.format_preflight as RosterFormatPreflightV1).elapsed_ms??null,preflight_explain_ms:(report.format_preflight as RosterFormatPreflightV1).explain_elapsed_ms??null,runtime_setup_ms:native?.setup_ms??null,setup_ms:native?.setup_ms??null,prefix_instrumented_ms:native?.prefix_elapsed_ms??null,...o.clock,total_ms:clock()};report.closure={callback_entered:closure?.callback_entered??false,callback_complete:closure?.callback_complete??false,factory_returned_normally:closure?.factory_returned_normally??false,client_released_or_discarded:o.client_released,uncertain_client_discarded:o.uncertain_client_discarded,own_name_oid_sha256:closure?.own_database&&closure.own_database!=='UNKNOWN'?sha(JSON.stringify(closure.own_database)):'UNKNOWN',own_database_absent:closure?.own_database_absent??'UNKNOWN',admin_end_awaited:closure?.own_database_absent===true};
 try{await write(directory,report);}catch(publication){throw safeFailure(failed?new AggregateError([primary,publication],'roster_primary_and_publication_failure',{cause:primary}):publication);}
 if(failed)throw safeFailure(primary);return report;
}
