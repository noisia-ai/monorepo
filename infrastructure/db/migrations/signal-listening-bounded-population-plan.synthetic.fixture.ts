import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdir,open,readFile,realpath} from 'node:fs/promises';
import {dirname,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {PoolClient} from 'pg';
import {flatPrefixLedgerSqlV1,withFlatPrefixFullFixtureV1} from './signal-listening-flat-prefix.synthetic.fixture';
import {assertSharedWireDefaultRuntimeV1,withSharedWireDefaultPostcheckV1} from './signal-listening-statement-shared-wire.oracle';
import {captureStartupCallbackV1,closeStartupFactoryV1,assertStartupOwnedAbsentV1,startupErrorTreeV1,type StartupCallbackStateV1} from './signal-listening-startup-prefix.synthetic.fixture';
import {openR16CiPostgresV1,assertR16LocalPostgresPoolV1} from './signal-r16-local-pg.fixture';
import {captureR16SourceProvenanceV1} from '../../../scripts/r16/source-provenance';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
function requireKnown(ok:unknown,code:string):asserts ok{if(!ok)throw new Error(code);}
const sourceUrl=new URL('./0332_signal_listening_flat_prefix_preimages.sql',import.meta.url);
const sourceSha='f981643c8f7f76f576b2d0a54920cb3107d8d9c50b8eab9a882f9d323aedc5c2';
const boundedSha='85840aacf572aac049341aced0901252701f7b09042b5fef75ffec48d12d397a';
const publicRead='SELECT * FROM public.signal_listening_population_roots_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid[],$6::text)';
const columns='root_id,input_digest,body,published_at,platform,question_key,question_digest,definition,wire,candidate,scope_state,answer,cache_call_id,scope_basis';
export function extractCurrentBoundedPopulationV1(source:string){
 requireKnown(sha(source)===sourceSha,'bounded_population_source_mismatch');
 const start='RETURN QUERY EXECUTE $bounded$',end='$bounded$ USING w,cid,mid,ctx,roots,purpose;';
 requireKnown(source.split(start).length===2&&source.split(end).length===2,'bounded_population_source_markers');
 const sql=source.split(start)[1]!.split(end)[0]!;
 requireKnown(Buffer.byteLength(sql)===8859&&sha(sql)===boundedSha,'bounded_population_literal_mismatch');
 const parts=source.split('AS $function$');requireKnown(parts.length===2,'bounded_population_body_marker');
 return{sql,body:parts[1]!.split('$function$;')[0]!,source_sha256:sourceSha,sql_sha256:boundedSha};
}
export function boundedPopulationRootSetHashV1(roots:ReadonlyArray<string>):string{
 requireKnown(Array.isArray(roots)&&roots.length>0&&roots.length<=32768,'bounded_population_root_count');
 requireKnown(roots.every(x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(x)),'bounded_population_root_type');
 requireKnown(new Set(roots).size===roots.length,'bounded_population_root_duplicates');return sha(JSON.stringify([...roots].sort()));
}
export type BoundedPopulationCounterV1={funcid:string;schemaname:string;funcname:string;calls:string;total_time:number;self_time:number};
export function boundedPopulationCounterDeltaV1(before:ReadonlyArray<BoundedPopulationCounterV1>,after:ReadonlyArray<BoundedPopulationCounterV1>){
 const index=(rows:ReadonlyArray<BoundedPopulationCounterV1>)=>{
  const result=new Map<string,BoundedPopulationCounterV1>();
  for(const row of rows){requireKnown(/^\d+$/u.test(row.funcid)&&/^\d+$/u.test(row.calls)&&Number.isFinite(row.total_time)&&row.total_time>=0&&Number.isFinite(row.self_time)&&row.self_time>=0,'bounded_population_counter_invalid');requireKnown(!result.has(row.funcid),'bounded_population_counter_duplicate');result.set(row.funcid,row);}return result;
 };
 const old=index(before),next=index(after);
 return[...new Set([...old.keys(),...next.keys()])].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1).map(funcid=>{
  const b=old.get(funcid)??null,a=next.get(funcid)??null;let delta:{calls:string;total_time_ms:number;self_time_ms:number}|null=null;
  if(b&&a){requireKnown(a.schemaname===b.schemaname&&a.funcname===b.funcname,'bounded_population_counter_identity');requireKnown(BigInt(a.calls)>=BigInt(b.calls)&&a.total_time>=b.total_time&&a.self_time>=b.self_time,'bounded_population_counter_regression');delta={calls:String(BigInt(a.calls)-BigInt(b.calls)),total_time_ms:a.total_time-b.total_time,self_time_ms:a.self_time-b.self_time};}
  return{funcid,before:b,after:a,status:b&&a?'observed_delta':a?'entry_created_baseline_absent':'entry_missing_after_unknown',delta};
 });
}
const staticSql=readFileSync(sourceUrl,'utf8');
const sourceIdentifiers=new Set([...staticSql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gu),...staticSql.matchAll(/\b([a-z_][a-z0-9_]*) AS(?: MATERIALIZED)?\(/gu),...staticSql.matchAll(/\b([a-z_][a-z0-9_]*)\(/gu)].map(m=>m[1]!));
const planNodeTypes=['Named Tuplestore Scan','Nested Loop','Hash Join','Merge Join','Aggregate','Group','Unique','SetOp','WindowAgg','Seq Scan','Index Scan','Index Only Scan','Bitmap Heap Scan','Bitmap Index Scan','BitmapAnd','BitmapOr','Tid Scan','Tid Range Scan','CTE Scan','Function Scan','Table Function Scan','Values Scan','Subquery Scan','WorkTable Scan','Foreign Scan','Custom Scan','Sample Scan','Hash','Sort','Incremental Sort','Limit','Result','Materialize','Memoize','Append','Merge Append','Recursive Union','Gather','Gather Merge','ProjectSet','LockRows','ModifyTable'] as const;
const nodes=new Set<string>(planNodeTypes);
const numbers=new Set(['Startup Cost','Total Cost','Plan Rows','Plan Width','Actual Startup Time','Actual Total Time','Actual Rows','Actual Loops','Rows Removed by Filter','Rows Removed by Join Filter','Rows Removed by Index Recheck','Rows Removed by Conflict Filter','Heap Fetches','Shared Hit Blocks','Shared Read Blocks','Shared Dirtied Blocks','Shared Written Blocks','Local Hit Blocks','Local Read Blocks','Local Dirtied Blocks','Local Written Blocks','Temp Read Blocks','Temp Written Blocks','I/O Read Time','I/O Write Time','Temp I/O Read Time','Temp I/O Write Time','Workers Planned','Workers Launched','Worker Number','Hash Buckets','Original Hash Buckets','Hash Batches','Original Hash Batches','Peak Memory Usage','Memory Usage','Disk Usage','HashAgg Batches','Sort Space Used','Cache Hits','Cache Misses','Cache Evictions','Cache Overflows','Exact Heap Blocks','Lossy Heap Blocks','Planning Time','Execution Time','Tuples Inserted','Conflicting Tuples','Subplans Removed','Planned Partitions']);
const enums:Record<string,ReadonlySet<string>>={
 'Node Type':nodes,'Parent Relationship':new Set(['Outer','Inner','InitPlan','SubPlan','Member','Subquery']),Strategy:new Set(['Plain','Sorted','Hashed','Mixed']),
 'Cache Mode':new Set(['logical','binary']),'Partial Mode':new Set(['Simple','Partial','Finalize']),'Join Type':new Set(['Inner','Left','Right','Full','Semi','Anti','Right Semi','Right Anti']),
 'Scan Direction':new Set(['Forward','Backward','NoMovement']),'Sort Method':new Set(['quicksort','top-N heapsort','external merge','external sort','still in progress']),
 'Sort Space Type':new Set(['Memory','Disk']),Operation:new Set(['Select','Insert','Update','Delete','Merge'])};
const redacted=new Set(['One-Time Filter','Filter','Output','Index Cond','Recheck Cond','Hash Cond','Merge Cond','Join Filter','Sort Key','Presorted Key','Group Key','Hash Key','Run Condition','Cache Key','Function Call','Remote SQL','Conflict Filter','Alias','Query Identifier']);
const rejectionCodes=['bounded_population_plan_object','bounded_population_plan_prototype','bounded_population_plan_accessor','bounded_population_plan_number','bounded_population_plan_array','bounded_population_plan_array_property','bounded_population_plan_array_hole','bounded_population_plan_expression_depth','bounded_population_jit_functions','bounded_population_jit_option','bounded_population_jit_timing','bounded_population_jit_generation','bounded_population_jit_structure','bounded_population_plan_depth','bounded_population_plan_node','bounded_population_plan_enum','bounded_population_plan_boolean','bounded_population_plan_tuplestore','bounded_population_plan_identifier','bounded_population_plan_subplan','bounded_population_plan_structure','bounded_population_plan_document','bounded_population_plan_select_trigger','bounded_population_plan_document_structure','bounded_population_plan_missing_root','bounded_population_plan_bytes','bounded_population_plan_invalid_or_over_limit'] as const;
const diagnosticProperties=['root','node','Node Type','Plan','Plans','Workers','Planning','JIT','Relation Name','Index Name','CTE Name','Function Name','Subplan Name','Tuplestore Name','Functions','Options','Timing','Generation','Deform','Total','Full-sort Groups','Pre-sorted Groups','Group Count','Sort Methods Used','Sort Space Memory','Sort Space Disk','Average Sort Space Used','Peak Sort Space Used','Shared I/O Read Time','Shared I/O Write Time','Local I/O Read Time','Local I/O Write Time','numeric_metric','closed_enum','boolean_metric','redacted_expression','UNRECOGNIZED_KEY','UNKNOWN'] as const;
export type BoundedPopulationPlanRejectionV1={reason_code:typeof rejectionCodes[number]|'UNKNOWN';location:'document'|'node'|'worker'|'planning'|'jit'|'jit_options'|'jit_timing'|'jit_generation'|'redacted_expression'|'UNKNOWN';property:typeof diagnosticProperties[number];value_type:'number'|'string'|'boolean'|'null'|'array'|'object'|'undefined'|'unsafe';identifier_class:'relation'|'index'|'cte'|'function'|'subplan'|'none'|'UNKNOWN';identifier_membership:'allowed'|'not_allowlisted'|'non_string'|'not_checked'|'UNKNOWN';node_type:typeof planNodeTypes[number]|'UNRECOGNIZED'|'UNKNOWN';nodes_seen:number;depth_bucket:'within32'|'above32'|'UNKNOWN';array_size_bucket:'within512'|'above512'|'UNKNOWN'};
/** Plain EXPLAIN JSON only. No messages, expressions or arbitrary identifiers
 * are emitted. Unknown structure is a static failure, never a partial plan. */
export function sanitizeBoundedPopulationPlanV1(plan:unknown,identifiers:ReadonlySet<string>=sourceIdentifiers,observeRejection?:(reason:BoundedPopulationPlanRejectionV1)=>void){
 let count=0,jitSeen=false,workersPlanned=0,workersLaunched=0;const seen=new WeakSet<object>();
 let checkpoint:Omit<BoundedPopulationPlanRejectionV1,'reason_code'|'nodes_seen'>={location:'UNKNOWN',property:'UNKNOWN',value_type:'undefined',identifier_class:'none',identifier_membership:'not_checked',node_type:'UNKNOWN',depth_bucket:'UNKNOWN',array_size_bucket:'UNKNOWN'};
 const at=(location:BoundedPopulationPlanRejectionV1['location'],key:string,value:unknown,depth?:number,nodeType?:unknown)=>{
  if(!observeRejection)return;try{
   const property=diagnosticProperties.find(p=>p===key)??(numbers.has(key)?'numeric_metric':Object.hasOwn(enums,key)?'closed_enum':redacted.has(key)?'redacted_expression':['Parallel Aware','Async Capable','Inner Unique','Single Copy'].includes(key)?'boolean_metric':'UNRECOGNIZED_KEY');
   const array=Array.isArray(value);const value_type:BoundedPopulationPlanRejectionV1['value_type']=value===null?'null':array?'array':typeof value==='string'?'string':typeof value==='number'?'number':typeof value==='boolean'?'boolean':typeof value==='object'?'object':typeof value==='undefined'?'undefined':'unsafe';
   const identifier_class:BoundedPopulationPlanRejectionV1['identifier_class']=key==='Relation Name'?'relation':key==='Index Name'?'index':key==='CTE Name'?'cte':key==='Function Name'?'function':key==='Subplan Name'?'subplan':'none';
   let array_size_bucket:BoundedPopulationPlanRejectionV1['array_size_bucket']='UNKNOWN',unsafe=false;if(array){try{const length=Object.getOwnPropertyDescriptor(value,'length');if(length&&'value'in length&&typeof length.value==='number'&&Number.isSafeInteger(length.value)&&length.value>=0)array_size_bucket=length.value<=512?'within512':'above512';else unsafe=true;}catch{unsafe=true;}}
   checkpoint={location,property,value_type:unsafe?'unsafe':value_type,identifier_class,identifier_membership:'not_checked',node_type:typeof nodeType==='string'&&nodes.has(nodeType)?nodeType as typeof planNodeTypes[number]:nodeType===undefined?'UNKNOWN':'UNRECOGNIZED',depth_bucket:depth===undefined?'UNKNOWN':depth<=32?'within32':'above32',array_size_bucket};
  }catch{checkpoint={...checkpoint,value_type:'unsafe'};}
 };
 const own=(value:unknown)=>{requireKnown(value!==null&&typeof value==='object'&&!seen.has(value),'bounded_population_plan_object');seen.add(value);const prototype=Object.getPrototypeOf(value);requireKnown(prototype===Object.prototype||prototype===Array.prototype||prototype===null,'bounded_population_plan_prototype');const fields=Object.getOwnPropertyDescriptors(value);requireKnown(Object.values(fields).every(d=>'value'in d),'bounded_population_plan_accessor');return fields;};
 const finite=(value:unknown)=>{requireKnown(typeof value==='number'&&Number.isFinite(value)&&value>=0,'bounded_population_plan_number');return value;};
 const boundedArray=(value:unknown)=>{requireKnown(Array.isArray(value)&&value.length<=512,'bounded_population_plan_array');const fields=own(value);requireKnown(Object.keys(fields).every(k=>k==='length'||/^(?:0|[1-9][0-9]*)$/u.test(k)),'bounded_population_plan_array_property');return Array.from({length:value.length},(_,i)=>{const d=fields[String(i)];requireKnown(d&&'value'in d,'bounded_population_plan_array_hole');return d.value as unknown;});};
 const expression=(value:unknown,depth=0):void=>{at('redacted_expression','redacted_expression',value);requireKnown(depth<=8,'bounded_population_plan_expression_depth');if(typeof value==='string')return;if(typeof value==='number'){finite(value);return;}for(const child of boundedArray(value))expression(child,depth+1);};
 const jit=(value:unknown)=>{at('jit','JIT',value);jitSeen=true;const result:Record<string,unknown>={};for(const[k,d]of Object.entries(own(value))){at('jit',k,d.value);
  if(k==='Functions'){const n=finite(d.value);requireKnown(Number.isSafeInteger(n),'bounded_population_jit_functions');result[k]=n;}
  else if(k==='Options'){const options:Record<string,boolean>={};for(const[name,field]of Object.entries(own(d.value))){at('jit_options','Options',field.value);requireKnown(['Inlining','Optimization','Expressions','Deforming'].includes(name)&&typeof field.value==='boolean','bounded_population_jit_option');options[name]=field.value;}result[k]=options;}
  else if(k==='Timing'){
   const timing:Record<string,number|{Deform:number;Total:number}>={};
   for(const[name,field]of Object.entries(own(d.value))){
    at('jit_timing',name,field.value);requireKnown(['Generation','Inlining','Optimization','Emission','Total'].includes(name),'bounded_population_jit_timing');
    if(name==='Generation'&&typeof field.value!=='number'){
     at('jit_generation','Generation',field.value);const generation=own(field.value);
     requireKnown(!Array.isArray(field.value)&&Reflect.ownKeys(generation).length===2&&Object.hasOwn(generation,'Deform')&&Object.hasOwn(generation,'Total'),'bounded_population_jit_generation');
     timing[name]={Deform:finite(generation.Deform!.value),Total:finite(generation.Total!.value)};
    }else timing[name]=finite(field.value);
   }
   result[k]=timing;
  }
  else throw new Error('bounded_population_jit_structure');
 }return result;};
 const incrementalSortGroup=(value:unknown,kind:'node'|'worker',depth:number)=>{
  const fields=own(value),keys=Reflect.ownKeys(fields);requireKnown(!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)&&keys.every(k=>typeof k==='string'&&['Group Count','Sort Methods Used','Sort Space Memory','Sort Space Disk'].includes(k))&&Object.hasOwn(fields,'Group Count')&&Object.hasOwn(fields,'Sort Methods Used'),'bounded_population_plan_structure');
  const result:Record<string,unknown>={};
  for(const[k,d]of Object.entries(fields)){at(kind,k,d.value,depth,'Incremental Sort');
   if(k==='Group Count'){const n=finite(d.value);requireKnown(Number.isInteger(n),'bounded_population_plan_number');result[k]=n;}
   else if(k==='Sort Methods Used'){const methods=boundedArray(d.value);requireKnown(methods.every(m=>typeof m==='string'&&enums['Sort Method']!.has(m))&&new Set(methods).size===methods.length,'bounded_population_plan_enum');result[k]=methods;}
   else{
    const space=own(d.value),spaceKeys=Reflect.ownKeys(space);requireKnown(!Array.isArray(d.value)&&(Object.getPrototypeOf(d.value)===Object.prototype||Object.getPrototypeOf(d.value)===null)&&spaceKeys.length===2&&Object.hasOwn(space,'Average Sort Space Used')&&Object.hasOwn(space,'Peak Sort Space Used'),'bounded_population_plan_structure');
    const metrics:Record<string,number>={};for(const[name,field]of Object.entries(space)){at(kind,name,field.value,depth,'Incremental Sort');const n=finite(field.value);requireKnown(Number.isInteger(n),'bounded_population_plan_number');metrics[name]=n;}result[k]=metrics;
   }
  }return result;
 };
 const walk=(value:unknown,depth:number,kind:'node'|'worker'|'planning'='node',workerOwnerType?:unknown):Record<string,unknown>=>{
  at(kind,'node',value,depth);requireKnown(depth<=32,'bounded_population_plan_depth');const fields=own(value),result:Record<string,unknown>={};
  at(kind,'Node Type',fields['Node Type']?.value,depth,fields['Node Type']?.value);
  if(kind==='node'){requireKnown(++count<=512&&typeof fields['Node Type']?.value==='string'&&nodes.has(fields['Node Type'].value),'bounded_population_plan_node');}
  for(const[k,d]of Object.entries(fields)){const x=d.value as unknown;at(kind,k,x,depth,fields['Node Type']?.value);
   if(redacted.has(k)){expression(x);continue;}
   if(numbers.has(k)){const n=finite(x);result[k]=n;if(k==='Workers Planned')workersPlanned=Math.max(workersPlanned,n);if(k==='Workers Launched')workersLaunched=Math.max(workersLaunched,n);}
   else if(enums[k]){requireKnown(typeof x==='string'&&enums[k]!.has(x),'bounded_population_plan_enum');result[k]=x;}
   else if(['Parallel Aware','Async Capable','Inner Unique','Single Copy'].includes(k)){requireKnown(typeof x==='boolean','bounded_population_plan_boolean');result[k]=x;}
   else if(k==='Tuplestore Name'){requireKnown(x==='listening_old_calls'||x==='listening_new_calls','bounded_population_plan_tuplestore');result[k]=x;}
   else if(['Relation Name','Index Name','CTE Name','Function Name'].includes(k)){requireKnown(typeof x==='string'&&identifiers.has(x),'bounded_population_plan_identifier');result[k]=x;}
   else if(k==='Subplan Name'){requireKnown(typeof x==='string'&&(x.startsWith('CTE ')&&identifiers.has(x.slice(4))||/^(?:SubPlan|InitPlan) \d+(?: \(returns \$\d+\))?$/u.test(x)),'bounded_population_plan_subplan');result[k]=x;}
   else if(k==='Plans')result[k]=boundedArray(x).map(child=>walk(child,depth+1));
   else if(k==='Workers')result[k]=boundedArray(x).map(child=>walk(child,depth+1,'worker',kind==='node'?fields['Node Type']?.value:undefined));
   else if(k==='JIT')result[k]=jit(x);
   else if(k==='Full-sort Groups'||k==='Pre-sorted Groups'){requireKnown(kind==='node'&&fields['Node Type']?.value==='Incremental Sort'||kind==='worker'&&workerOwnerType==='Incremental Sort','bounded_population_plan_structure');result[k]=incrementalSortGroup(x,kind as 'node'|'worker',depth);}
   else throw new Error('bounded_population_plan_structure');
  }return result;
 };
 try{
  at('document','root',plan,0);const top=boundedArray(plan);requireKnown(top.length===1,'bounded_population_plan_document');const document:Record<string,unknown>={};
  for(const[k,d]of Object.entries(own(top[0]))){at('document',k,d.value,0);
   if(k==='Plan')document[k]=walk(d.value,0);
   else if(k==='JIT')document[k]=jit(d.value);
   else if(k==='Planning')document[k]=walk(d.value,0,'planning');
   else if(k==='Planning Time'||k==='Execution Time')document[k]=finite(d.value);
   else if(k==='Triggers'){requireKnown(Array.isArray(d.value)&&d.value.length===0,'bounded_population_plan_select_trigger');document[k]=[];}
   else throw new Error('bounded_population_plan_document_structure');
  }
  requireKnown(document.Plan&&count>0,'bounded_population_plan_missing_root');const serialized=JSON.stringify(document),bytes=Buffer.byteLength(serialized);requireKnown(bytes<=1024*1024,'bounded_population_plan_bytes');
  return{plan:document,nodes:count,bytes,plan_sha256:sha(JSON.stringify(plan)),sanitized_sha256:sha(serialized),jit:jitSeen?'observed' as const:'UNKNOWN' as const,parallel:{workers_planned:workersPlanned,workers_launched:workersLaunched,coverage:workersLaunched?'leader_only_workers_UNKNOWN':'no_workers_observed'}};
 }catch(error){
  if(observeRejection){try{let reason_code:BoundedPopulationPlanRejectionV1['reason_code']='UNKNOWN';const message=error!==null&&typeof error==='object'?Object.getOwnPropertyDescriptor(error,'message'):undefined;if(message&&'value'in message&&typeof message.value==='string'&&rejectionCodes.some(code=>code===message.value))reason_code=message.value as typeof rejectionCodes[number];const identifier_membership=reason_code==='bounded_population_plan_identifier'?checkpoint.value_type==='string'?'not_allowlisted':'non_string':checkpoint.identifier_membership;observeRejection({...checkpoint,reason_code,identifier_membership,nodes_seen:count});}catch{/* Observation cannot replace the original rejection. */}}
  throw new Error('bounded_population_plan_invalid_or_over_limit');
 }
}
const protectedNames=['signal_listening_population_roots_v1','signal_listening_effective_population_roots_v2','signal_listening_statement_money_v1','signal_listening_call_guard_v1','signal_labeling_json_v1','signal_labeling_digest_v1','signal_listening_input_digest_v1','signal_mass_labeling_lexical_text_v1','signal_mass_labeling_category_pattern_v1','signal_mass_labeling_category_pattern_matches_v1','signal_mass_labeling_r13_hashtags_v1','signal_listening_root_right_v1','signal_listening_discovery_candidates_v1'];
async function catalog(c:PoolClient,extracted:ReturnType<typeof extractCurrentBoundedPopulationV1>){
 const rows=(await c.query(`SELECT p.oid::text,p.proname,p.prosrc,p.proowner::text,p.proacl::text,p.proconfig,p.provolatile,p.prosecdef,p.proisstrict,p.proparallel,p.proleakproof,p.prokind,p.proargtypes::text,p.prorettype::text,p.proretset,l.lanname
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname='public' AND p.proname=ANY($1::text[]) ORDER BY p.oid`,[protectedNames])).rows;
 const raw=rows.filter(r=>r.proname==='signal_listening_population_roots_v1');requireKnown(raw.length===1&&raw[0].prosrc===extracted.body,'bounded_population_native_body');
 requireKnown(raw[0].lanname==='plpgsql'&&raw[0].provolatile==='s'&&raw[0].prosecdef===false&&raw[0].proisstrict===false&&raw[0].proparallel==='u'&&raw[0].proretset===true&&JSON.stringify(raw[0].proconfig)===JSON.stringify(['search_path=public, extensions, pg_temp'])&&raw[0].proacl!==null,'bounded_population_native_attributes');
 requireKnown(protectedNames.every(n=>rows.filter(r=>r.proname===n).length===1),'bounded_population_catalogue_coverage');
 await assertSharedWireDefaultRuntimeV1(c);
 return rows.map(({prosrc,...r})=>({...r,prosrc_sha256:sha(prosrc as string)}));
}
const counters=async(c:PoolClient)=>(await c.query<BoundedPopulationCounterV1>('SELECT funcid::text,schemaname,funcname,calls::text,total_time,self_time FROM pg_catalog.pg_stat_xact_user_functions ORDER BY funcid')).rows;
async function session(c:PoolClient){return(await c.query(`SELECT pg_backend_pid()::text backend,current_user role,current_database() database,
 current_setting('search_path') search_path,current_setting('track_functions') track_functions,current_setting('transaction_isolation') isolation,
 current_setting('transaction_read_only') readonly,current_setting('is_superuser') superuser,current_setting('server_version_num')::int version,
 current_setting('jit') jit,current_setting('jit_above_cost') jit_above_cost,current_setting('jit_inline_above_cost') jit_inline_above_cost,current_setting('jit_optimize_above_cost') jit_optimize_above_cost,
 pg_current_snapshot()::text snapshot`)).rows[0];}
async function parity(c:PoolClient,sql:string,params:unknown[]){
 const prefix=`WITH old AS MATERIALIZED(${publicRead}),probe(${columns}) AS MATERIALIZED(${sql})`;
 requireKnown((await c.query(`${prefix} SELECT count(*)::int n FROM((TABLE old EXCEPT ALL TABLE probe)UNION ALL(TABLE probe EXCEPT ALL TABLE old))d`,params)).rows[0].n===0,'bounded_population_bag_mismatch');
 const bytes=async(name:'old'|'probe')=>(await c.query(`${prefix} SELECT encode(record_send(ROW(p.*)),'hex') bytes FROM ${name} p ORDER BY root_id,question_key,encode(record_send(ROW(p.*)),'hex')`,params)).rows.map(r=>r.bytes as string);
 const a=await bytes('old'),b=await bytes('probe');requireKnown(a.length===4000&&b.length===4000&&a.every((v,i)=>v===b[i]),'bounded_population_bytes_mismatch');return{rows:4000,except_all:true,ordered_record_send:true,bytes:a.reduce((n,v)=>n+v.length/2,0),sha256:sha(a.join('\n'))};
}
async function nativeState(c:PoolClient,params:unknown[],run_id:string,rootHash:string){
 requireKnown(Array.isArray(params[4])&&params[4].length===1000&&boundedPopulationRootSetHashV1(params[4])===rootHash,'bounded_population_roster_changed');
 const ledger=(await c.query(flatPrefixLedgerSqlV1,[params[0],run_id])).rows[0];
 requireKnown(JSON.stringify(ledger)===JSON.stringify({calls:1000,applied:1000,roots:1000,synthetic_spend_micro_usd:'6000',reserved_micro_usd:'0',unknown_micro_usd:'0'}),'bounded_population_native_raw_ledger');
 const state=(await c.query(`WITH population AS MATERIALIZED(${publicRead}),per_root AS(
 SELECT root_id,count(*)::int questions,count(*) FILTER(WHERE question_key IN('voice','promotion') AND answer IS NOT NULL AND cache_call_id IS NOT NULL)::int bases,
 count(*) FILTER(WHERE definition->>'topic_source'='defined' AND definition->>'scope'='consumer_category' AND candidate AND scope_state='included' AND answer IS NULL AND scope_basis IS NOT NULL)::int consumers
 FROM population GROUP BY root_id),basis AS(
 SELECT count(*)::int bad FROM population p JOIN population v ON v.root_id=p.root_id AND v.question_key='voice' JOIN population a ON a.root_id=p.root_id AND a.question_key='promotion'
 WHERE p.definition->>'scope'='consumer_category' AND p.scope_basis IS DISTINCT FROM public.signal_labeling_digest_v1(jsonb_build_object('voice',v.cache_call_id,'promotion',a.cache_call_id)))
 SELECT (SELECT count(*)::int FROM population) rows,(SELECT count(*)::int FROM per_root) roots,
 (SELECT bool_and(questions=4 AND bases=2 AND consumers=2) FROM per_root) exact,(SELECT bad FROM basis) stale_basis`,params)).rows[0];
 requireKnown(state.rows===4000&&state.roots===1000&&state.exact===true&&state.stale_basis===0,'bounded_population_native_scope');
 const a=(await c.query(`SELECT count(*)::int answers,count(DISTINCT a.root_id)::int roots,
 count(*) FILTER(WHERE a.question_key NOT IN('voice','promotion') OR NOT(a.root_id=ANY($3::uuid[])))::int outside,
 array_agg(DISTINCT a.root_id ORDER BY a.root_id) roots_set
 FROM signal_listening_answers a WHERE a.workspace_id=$1 AND a.run_id=$2`,[params[0],run_id,params[4]])).rows[0];
 const calls=(await c.query("SELECT array_agg(DISTINCT (c.inputs->0->>'root_id')::uuid ORDER BY (c.inputs->0->>'root_id')::uuid) roots FROM signal_labeling_calls c WHERE c.workspace_id=$1 AND c.run_id=$2",[params[0],run_id])).rows[0];
 requireKnown(a.answers===2000&&a.roots===1000&&a.outside===0&&boundedPopulationRootSetHashV1(a.roots_set)===rootHash&&boundedPopulationRootSetHashV1(calls.roots)===rootHash,'bounded_population_answer_roster');
 const corpus=(await c.query(`SELECT count(*)::int roots,count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM signal_listening_answers a
 WHERE a.workspace_id=i.workspace_id AND a.run_id=$3 AND a.root_id=i.root_id AND a.question_key IN('voice','promotion')))::int no_base
 FROM signal_mass_labeling_items i WHERE i.workspace_id=$1 AND i.map_id=$2`,[params[0],params[2],run_id])).rows[0];
 const run=(await c.query('SELECT status,lease_token IS NULL AND lease_until IS NULL released FROM signal_labeling_runs WHERE id=$1 AND workspace_id=$2',[run_id,params[0]])).rows[0];
 requireKnown(corpus.roots===32768&&corpus.no_base===31768&&run.status==='running'&&run.released===true,'bounded_population_corpus_or_lease');
 return{...ledger,corpus_roots:32768,remaining_no_base_this_run:31768,base_answers:2000,consumer_pending_selected:2000,consumer_reserved:0,raw14_rows:4000,basis_fresh:true,selected_root_set_sha256:rootHash,base_call_root_set_sha256:boundedPopulationRootSetHashV1(calls.roots),base_answer_root_set_sha256:boundedPopulationRootSetHashV1(a.roots_set),base_answers_outside_selected:0,run_status:run.status,lease_released:true,provider_http:0,external_spend_micro_usd:0,not_actual_mark_cohort:true};
}
async function sources(){const all=await captureR16SourceProvenanceV1(repo),migration38=all.file_manifest.filter(r=>/^infrastructure\/db\/migrations\/(?:029[5-9]|03[0-2][0-9]|033[0-2])_.+\.sql$/u.test(r.path));requireKnown(migration38.length===38,'bounded_population_migration_inventory');return{head_sha:all.head_sha,source_tree_sha256:all.source_tree_sha256,tree_status_sha256:all.tree_status_sha256,migration38,harness:all.file_manifest.filter(r=>r.path.startsWith('scripts/r16/')||/^services\/workers\/src\/(?:workers\/signal-(?:jev|listening)|providers\/jev-streaming)/u.test(r.path))};}
export type BoundedPopulationPlanReceiptV1={contract:'r16-bounded-population-plan-v1';status:'failed'|'observed';diagnostic_only:true;h1_accepted:false;cpu:'UNKNOWN';speedup_claim:false;gates:Record<'source_binding'|'native_state'|'projection_parity'|'snapshot_binding'|'plan_complete'|'closure_confirmed',boolean>}&Record<string,unknown>;
// A publication failure may leave no JSON. Expose only the existing bounded,
// plain error tree as cause; never attach the original Error or its messages.
function safeFailure(message:string,error:unknown){
 const tree=startupErrorTreeV1(error),cause=Buffer.byteLength(JSON.stringify(tree))<=24576?tree:{truncated:true,root:{omitted:'safe_error_tree_over_limit'}};
 return new Error(message,{cause});
}
async function writeEvidence(directory:string,report:BoundedPopulationPlanReceiptV1){
 const dir=resolve(repo,directory),sub=relative(resolve(repo,'.data'),dir);requireKnown(sub&&!sub.startsWith('..')&&!sub.startsWith('/'),'bounded_population_evidence_path');
 const bytes=JSON.stringify(report)+'\n';requireKnown(Buffer.byteLength(bytes)<=2*1024*1024,'bounded_population_evidence_bytes');
 await mkdir(dir,{recursive:true,mode:0o700});requireKnown(await realpath(dir)===dir,'bounded_population_evidence_symlink');const fd=await open(resolve(dir,'bounded-population-plan.json'),'wx',0o600);try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}
}
export async function runBoundedPopulation32kPlanV1(directory:string):Promise<BoundedPopulationPlanReceiptV1>{
 requireKnown(process.env.GITHUB_ACTIONS==='true','bounded_population_owned_ci_only');
 const started=performance.now(),clock=()=>performance.now()-started,callback:StartupCallbackStateV1={entered:false,complete:false,failed:false};
 let own:{name:string;oid:string}|null=null,absence:'UNKNOWN'|true='UNKNOWN',normal=false,rootHash='',targetRunId='',readStart:number|undefined;
 const report:BoundedPopulationPlanReceiptV1={contract:'r16-bounded-population-plan-v1',status:'failed',diagnostic_only:true,h1_accepted:false,cpu:'UNKNOWN',speedup_claim:false,
 gates:{source_binding:false,native_state:false,projection_parity:false,snapshot_binding:false,plan_complete:false,closure_confirmed:false},bounds:{setup_ms:1800000,read_ms:120000,total_ms:1920000,external_job_minutes:40,maximum_nodes:512,maximum_depth:32,plan_bytes:1048576,json_bytes:2097152},unknowns:['No actual consumer Mark or full statement_money plan','No CPU, throughput, H1, causal wait or speedup claim','Missing JIT or function rows are UNKNOWN, not zero','TIMING ON and tracking overhead are not subtracted; elapsed includes possible planning','Function children must not be added to parents; workers are not fully covered']};
 let failed=false,primary:unknown;
 try{
  const sourceBefore=await sources(),extracted=extractCurrentBoundedPopulationV1(await readFile(sourceUrl,'utf8'));report.source_before=sourceBefore;
  await closeStartupFactoryV1(callback,async()=>{
   await withFlatPrefixFullFixtureV1({
    bounded:{
     async callback(database,body){await captureStartupCallbackV1(callback,async()=>{
      const identity=(await database.query("SELECT current_database() name,(SELECT oid::text FROM pg_database WHERE datname=current_database()) oid")).rows[0];
      requireKnown(/^noisia_mfp_recovery_[a-f0-9]{32}$/u.test(identity.name)&&/^\d+$/u.test(identity.oid),'bounded_population_owned_identity');own={name:identity.name,oid:identity.oid};
      await withSharedWireDefaultPostcheckV1(body,async()=>{if(readStart!==undefined){report.read_ms=clock()-readStart;requireKnown(Number(report.read_ms)<=120000,'bounded_population_read_soft_cap');}});
     });},
     roster(roots){requireKnown(roots.length===1000,'bounded_population_initial_roster');rootHash=boundedPopulationRootSetHashV1(roots);report.initial_base_roots=1000;report.initial_root_set_sha256=rootHash;},
     async state(c,params,run_id){requireKnown(!targetRunId||targetRunId===run_id,'bounded_population_run_binding');targetRunId=run_id;return nativeState(c,params,run_id,rootHash);}
    },
    async install(){report.setup_ms=clock();requireKnown(Number(report.setup_ms)<=1800000,'bounded_population_setup_soft_cap');readStart=clock();},
    async read({c,params,setup}){
     const phases:Array<{phase:string;elapsed_ms:number}>=[];
     const phase=async<T>(name:string,body:()=>Promise<T>)=>{const start=clock();try{return await body();}finally{phases.push({phase:name,elapsed_ms:clock()-start});}};
     await c.query("SET LOCAL track_functions='none'");const original=await session(c);
     requireKnown(original.isolation==='repeatable read'&&original.readonly==='on'&&original.superuser==='on'&&original.search_path==='public, extensions, pg_temp'&&original.version>=170000&&original.version<180000,'bounded_population_read_session');
     requireKnown(params.length===6&&params[5]==='llm-processing'&&boundedPopulationRootSetHashV1(params[4] as string[])===rootHash,'bounded_population_parameter_binding');
     const paramsHash=sha(JSON.stringify(params)),before=await catalog(c,extracted);report.default_before=before;
     const indexRows=(await c.query(`SELECT c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND
      (c.relname=ANY($1::text[]) OR c.oid IN(SELECT i.indexrelid FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid WHERE t.relname=ANY($1::text[]) AND t.relnamespace=n.oid))`,[[...sourceIdentifiers]])).rows;
     const identifiers=new Set([...sourceIdentifiers,...indexRows.map(r=>r.name as string)]);
     const parityBefore=await phase('parity_before',()=>parity(c,extracted.sql,params));
     await c.query("SET LOCAL track_functions='all'");
     await phase('plain_literal_warmup',async()=>{const warm=await c.query(extracted.sql,params);requireKnown(warm.rows.length===4000,'bounded_population_warmup_rows');});
     const counterBefore=await phase('diagnostic_stats_before',()=>counters(c));
     const start=clock(),explained=await c.query('EXPLAIN(ANALYZE,BUFFERS,TIMING ON,FORMAT JSON) '+extracted.sql,params),clientWall=clock()-start;
     const counterAfter=await phase('diagnostic_stats_after',()=>counters(c));
     await c.query("SET LOCAL track_functions='none'");
     const sanitized=sanitizeBoundedPopulationPlanV1(explained.rows[0]?.['QUERY PLAN'],identifiers),root=sanitized.plan.Plan as Record<string,unknown>;
     requireKnown(root['Actual Rows']===4000&&root['Node Type']!=='Function Scan','bounded_population_visible_plan');
     const parityAfter=await phase('parity_after',()=>parity(c,extracted.sql,params));requireKnown(JSON.stringify(parityAfter)===JSON.stringify(parityBefore),'bounded_population_parity_changed');
     const after=await catalog(c,extracted),ending=await session(c);requireKnown(JSON.stringify(after)===JSON.stringify(before),'bounded_population_catalogue_changed');
     requireKnown(JSON.stringify(ending)===JSON.stringify(original)&&sha(JSON.stringify(params))===paramsHash,'bounded_population_snapshot_or_session_changed');
     const stateAfter=await nativeState(c,params,targetRunId,rootHash);
     const {raw_storage,...baseSetup}=setup;
     requireKnown(JSON.stringify(stateAfter)===JSON.stringify(baseSetup),'bounded_population_native_state_changed');
     report.default_after=after;report.native_state=setup;report.loopback_storage={metrics:raw_storage,scope:'object PUT/GET and byte counters only; health checks not counted; not provider HTTP'};report.parity={before:parityBefore,after:parityAfter};report.phases=phases;
     report.measurement={query:'current0332_bounded_literal14',explain_count:1,plain_warmups:1,explain:'ANALYZE,BUFFERS,TIMING ON,FORMAT JSON',client_wall_ms:clientWall,...sanitized,counter_before:counterBefore,counter_after:counterAfter,counter_deltas:boundedPopulationCounterDeltaV1(counterBefore,counterAfter),counter_scope:'same leader backend/RR transaction; elapsed includes possible planning; not CPU',snapshot_sha256:sha(original.snapshot),backend:original.backend,role_sha256:sha(original.role),params_sha256:paramsHash,param_types:['uuid','uuid','uuid','text','uuid[]','text'],purpose:'llm-processing',selected_root_set_sha256:rootHash,settings:{jit:original.jit,jit_above_cost:original.jit_above_cost,jit_inline_above_cost:original.jit_inline_above_cost,jit_optimize_above_cost:original.jit_optimize_above_cost},source_file_sha256:extracted.source_sha256,literal_sha256:extracted.sql_sha256,literal_bytes:Buffer.byteLength(extracted.sql)};
     report.gates.native_state=true;report.gates.projection_parity=true;report.gates.snapshot_binding=true;report.gates.plan_complete=true;
    }
   },'bounded_1000_of_32768');normal=true;
  },async()=>{
   if(!own)return;const admin=await openR16CiPostgresV1();
   await withSharedWireDefaultPostcheckV1(async()=>{assertR16LocalPostgresPoolV1(admin);const client=await admin.connect();await withSharedWireDefaultPostcheckV1(async()=>{await assertStartupOwnedAbsentV1(client,own!,value=>{report.cleanup_observation=value;});absence=true;},async()=>{client.release();});},()=>admin.end());
  });
  const sourceAfter=await sources();report.source_after=sourceAfter;requireKnown(JSON.stringify(sourceAfter)===JSON.stringify(sourceBefore),'bounded_population_source_changed');report.gates.source_binding=true;
  requireKnown((absence as 'UNKNOWN'|true)===true&&normal&&callback.complete,'bounded_population_cleanup_unconfirmed');report.gates.closure_confirmed=true;
  requireKnown(clock()<=1920000,'bounded_population_total_soft_cap');requireKnown(Object.values(report.gates).every(x=>x===true),'bounded_population_gate_incomplete');report.status='observed';
 }catch(error){failed=true;primary=error;report.failure={error_tree:startupErrorTreeV1(error),callback_primary_preserved:callback.failed,setup_before_callback_unknown:!callback.entered};}
 report.total_ms=clock();report.closure={callback_entered:callback.entered,callback_complete:callback.complete,factory_returned_normally:normal,own_database:own??'UNKNOWN',own_database_absent:absence};
 try{await writeEvidence(directory,report);}catch(publication){const combined=failed?new AggregateError([primary,publication],'bounded population failure and publication failed',{cause:primary}):publication;throw safeFailure('bounded_population_diagnostic_or_publication_failed',combined);}
 if(failed)throw safeFailure('bounded_population_diagnostic_failed_see_evidence',primary);
 return report;
}
