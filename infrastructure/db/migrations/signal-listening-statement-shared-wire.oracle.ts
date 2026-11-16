import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {anchorListeningStatementOracleParametersV1,listeningExpectedProjectionOracleSqlV1} from './signal-listening-statement-validator.oracle';
import type {PoolClient} from 'pg';
export const sharedWireMigrationV1='0330_signal_listening_statement_shared_wire.sql';
export const sharedWirePayloadMigrationV1='0331_signal_listening_statement_payload.sql';
export const sharedWireShaV1=(s:string)=>createHash('sha256').update(s).digest('hex');
const frozenSharedWireSourceShaV1='94fb81156f9ba8aa8faf3dc3502195998e701dc76e12a636418d8ef0df502305';
function canonicalRegion(source:string){
 const begin='/* statement_shared_wire_canonical_begin */',end='/* statement_shared_wire_canonical_end */';
 assert.equal(source.split(begin).length,2);assert.equal(source.split(end).length,2);
 const start=source.indexOf(begin)+begin.length,stop=source.indexOf(end,start);assert.ok(stop>start);
 return{start,stop,value:source.slice(start,stop)};
}
// Test-only source variant. It never writes a migration or changes the CASE,
// compiler, hash, transition tables, authority, caps or surrounding function.
export function sharedWirePayloadBarrierSourceV1(source:string){
 assert.equal(sharedWireShaV1(source),frozenSharedWireSourceShaV1,'C requires exact frozen0330');
 const region=canonicalRegion(source),parts=/^\(SELECT (CASE[\s\S]*\n      END) FROM \((SELECT [\s\S]*)\) native\)$/.exec(region.value);assert.ok(parts);
 return source.slice(0,region.start)+`(WITH native AS MATERIALIZED(${parts[2]}) SELECT ${parts[1]} FROM native)`+source.slice(region.stop);
}
export function restoreSharedWirePayloadSourceV1(source:string){
 const region=canonicalRegion(source),parts=/^\(WITH native AS MATERIALIZED\((SELECT [\s\S]*)\) SELECT (CASE[\s\S]*\n      END) FROM native\)$/.exec(region.value);assert.ok(parts);
 const restored=source.slice(0,region.start)+`(SELECT ${parts[2]} FROM (${parts[1]}) native)`+source.slice(region.stop);
 assert.equal(sharedWireShaV1(restored),frozenSharedWireSourceShaV1,'C inversion must restore all0330 bytes');return restored;
}
export function sharedWireVariantsV1(oldSource:string,newSource:string){return[['before',oldSource],['after',newSource],['variant',sharedWirePayloadBarrierSourceV1(newSource)]]as const;}
export function sharedWireValidationV1(source:string){const matches=[...source.matchAll(/EXECUTE format\(\$validation\$([\s\S]*?)\$validation\$,batch_sql\)/g)];assert.equal(matches.length,1);const sql=matches[0]![1]!;assert.equal((sql.match(/%s/g)??[]).length,1);return sql.replace('%s','SELECT n.* FROM jsonb_populate_recordset(NULL::signal_labeling_calls,$8::jsonb) n');}
export async function sharedWireSourcesV1(){return Promise.all(['0329_signal_listening_expected_projection.sql',sharedWireMigrationV1].map(n=>readFile(new URL('./'+n,import.meta.url),'utf8')));}
export function sharedWireDefaultContractFromSourcesV1(sourceB:string,sourceC?:string){
 assert.equal(sharedWireShaV1(sourceB),frozenSharedWireSourceShaV1);
 if(sourceC!==undefined)assert.equal(sourceC,sharedWirePayloadBarrierSourceV1(sourceB),'0331 must be all exact proved C bytes');
 const source=sourceC??sourceB,match=/CREATE OR REPLACE FUNCTION signal_listening_statement_money_v1\(\) RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS \$\$([\s\S]*)\$\$;\n$/.exec(source);assert.ok(match);
 const prosrc=match[1]!;
 return{contract:'r16-statement-shared-wire-default-contract-v1',default_arm:sourceC===undefined?'B':'C',migration:sourceC===undefined?sharedWireMigrationV1:sharedWirePayloadMigrationV1,source_sha256:sharedWireShaV1(source),prosrc,prosrc_sha256:sharedWireShaV1(prosrc),metadata:{proconfig:['search_path=public, extensions, pg_temp'],lanname:'plpgsql',prosecdef:false,return_type:'trigger',pronargs:0,proretset:false,provolatile:'v',proisstrict:false,proparallel:'u',proleakproof:false,prokind:'f'}};
}
export async function sharedWireDefaultContractV1(){
 const [,sourceB]=await sharedWireSourcesV1();assert.ok(sourceB);let sourceC:string|undefined;
 try{sourceC=await readFile(new URL('./'+sharedWirePayloadMigrationV1,import.meta.url),'utf8');}
 catch(error){if(!(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT'))throw error;}
 return sharedWireDefaultContractFromSourcesV1(sourceB,sourceC);
}
export function assertSharedWireDefaultRowV1(row:Record<string,unknown>|undefined,expected:ReturnType<typeof sharedWireDefaultContractFromSourcesV1>){
 assert.ok(row&&typeof row.prosrc==='string','actual native function must exist');
 assert.equal(sharedWireShaV1(row.prosrc),expected.prosrc_sha256,'actual pg_proc.prosrc SHA must match source-aware default');
 assert.ok(row.prosrc===expected.prosrc,'actual pg_proc.prosrc bytes must match source-aware default');
 const {prosrc,...metadata}=row;assert.deepEqual(metadata,expected.metadata,'actual native language/config/security/return metadata must match');
 return{contract:'r16-statement-shared-wire-default-row-v1',default_arm:expected.default_arm,migration:expected.migration,source_sha256:expected.source_sha256,prosrc_sha256:sharedWireShaV1(prosrc as string),metadata};
}
export const sharedWireDefaultRuntimeSqlV1=`SELECT p.prosrc,p.proconfig,l.lanname,p.prosecdef,p.prorettype::regtype::text return_type,
  p.pronargs,p.proretset,p.provolatile,p.proisstrict,p.proparallel,p.proleakproof,p.prokind
  FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
  WHERE p.oid='public.signal_listening_statement_money_v1()'::regprocedure`;
export async function assertSharedWireDefaultRuntimeV1(c:Pick<PoolClient,'query'>){
 const expected=await sharedWireDefaultContractV1();
 const rows=(await c.query(sharedWireDefaultRuntimeSqlV1)).rows;
 assert.equal(rows.length,1);const checked=assertSharedWireDefaultRowV1(rows[0],expected);
 return{...checked,contract:'r16-statement-shared-wire-default-runtime-v1',target:'public.signal_listening_statement_money_v1()',runtime_kind:checked.default_arm,observed_via:'pg_proc',actual_prosrc_sha256:checked.prosrc_sha256,actual_pg_proc_checked:true};
}
export async function withSharedWireDefaultPostcheckV1<T>(body:()=>Promise<T>,postcheck:()=>Promise<void>):Promise<T>{
 let bodyFailed=false,primary:unknown;
 try{return await body();}catch(error){bodyFailed=true;primary=error;throw error;}
 finally{
  try{await postcheck();}catch(after){
   if(bodyFailed)throw new AggregateError([primary,after],'shared_wire_default_body_and_postcheck_failed',{cause:primary});
   throw after;
  }
 }
}
export function sharedWireCanonicalPartsV1(oldSource:string,newSource:string){
 const old=sharedWireValidationV1(oldSource),next=sharedWireValidationV1(newSource);
 const preimage=/signal_labeling_digest_v1\((jsonb_build_object\('request_version','listening-jev-v1',[\s\S]*?'request',expected_request\))\)/.exec(old)?.[1];assert.ok(preimage);
 const start=next.indexOf('/* statement_shared_wire_hash_begin */'),end=next.indexOf('/* statement_shared_wire_hash_end */',start);assert.ok(start>=0&&end>start);
 const hash=next.slice(start+'/* statement_shared_wire_hash_begin */'.length,end).trim();
 const a=hash.indexOf('/* statement_shared_wire_canonical_begin */'),b=hash.indexOf('/* statement_shared_wire_canonical_end */');assert.ok(a>=0&&b>a);
 const canonical=hash.slice(a+'/* statement_shared_wire_canonical_begin */'.length,b).trim();
 const c=next.indexOf('statement_wire_values AS MATERIALIZED('),d=next.indexOf('/* statement_shared_wire_fragments_end */',c);assert.ok(c>=0&&d>c);
 const wires=next.slice(c,d).trim().replace(/,$/,'');return{old,next,preimage,hash,canonical,wires};
}
export function sharedWireCanonicalProjectionV1(oldSource:string,newSource:string,arm:'before'|'after'|'variant'){
 const p=sharedWireCanonicalPartsV1(oldSource,arm==='variant'?sharedWirePayloadBarrierSourceV1(newSource):newSource),sql=arm==='before'?p.old:p.next,end=sql.indexOf('\n   SELECT COALESCE(');assert.ok(end>=0);
 const canonical=arm==='before'?`public.signal_labeling_json_v1(${p.preimage})`:p.canonical;
 return anchorListeningStatementOracleParametersV1(sql.slice(0,end)+`,serialized AS MATERIALIZED(SELECT id,${canonical} canonical FROM expected)\n SELECT id,encode(convert_to(canonical,'UTF8'),'hex') bytes,'sha256:'||encode(sha256(convert_to(canonical,'UTF8')),'hex') digest FROM serialized e ORDER BY id`);
}
export async function compareSharedWireValidationV1(c:PoolClient,oldSource:string,newSource:string,params:unknown[]){
 const all=[];for(const [arm,source]of sharedWireVariantsV1(oldSource,newSource)){const sql=sharedWireValidationV1(source);
  const flags=(await c.query(anchorListeningStatementOracleParametersV1(sql),params)).rows[0];
  const projected=await c.query(listeningExpectedProjectionOracleSqlV1(sql),params);
  const exact=(await c.query(listeningExpectedProjectionOracleSqlV1(sql,true),params)).rows;
  const canonical=(await c.query(sharedWireCanonicalProjectionV1(oldSource,newSource,arm),params)).rows;
  all.push({flags,fields:projected.fields.map(f=>[f.name,f.dataTypeID]),exact,canonical});
 }for(const result of all.slice(1))assert.deepEqual(result,all[0],'A/B/C 3flags/8typedfields/multiplicity/SQLtext/UTF8/fullSHA equal in same native snapshot');return all[0]!;
}
// Kernel tests feed representation probes as PostgreSQL JSON text, never JS
// numbers. It executes the actual0330 fragments and canonical expression.
export function sharedWireRepresentationKernelV1(oldSource:string,newSource:string){const p=sharedWireCanonicalPartsV1(oldSource,newSource),variant=sharedWireCanonicalPartsV1(oldSource,sharedWirePayloadBarrierSourceV1(newSource));
 const prefix=`WITH selected AS MATERIALIZED(SELECT id,native_questions questions FROM jsonb_to_recordset($8::jsonb) e(id uuid,native_questions jsonb)),expected AS MATERIALIZED(SELECT id,i,digests,basis,expected_request FROM jsonb_to_recordset($8::jsonb) e(id uuid,i jsonb,digests jsonb,basis jsonb,expected_request jsonb)),${p.wires}`;
 return anchorListeningStatementOracleParametersV1(prefix+`,serialized AS MATERIALIZED(SELECT id,public.signal_labeling_json_v1(${p.preimage}) before_canonical,${p.canonical} after_canonical,${variant.canonical} variant_canonical FROM expected) SELECT id,encode(convert_to(before_canonical,'UTF8'),'hex') before_bytes,encode(convert_to(after_canonical,'UTF8'),'hex') after_bytes,encode(convert_to(variant_canonical,'UTF8'),'hex') variant_bytes,ARRAY(SELECT jsonb_object_keys(value) FROM statement_native_fragments) fragment_keys FROM serialized ORDER BY id`);
}

// Only bounded structure/counters and expression hashes leave the plan reader.
// Raw Output/Filter text may contain native input text or IDs: never log it.
export function sharedWirePlanSummaryV1(value:unknown){
 const document=(Array.isArray(value)?value[0]:value)as Record<string,unknown>;assert.ok(document&&typeof document==='object');
 const roles=new Set(['native','batch','population','requested','selected','expected','statement_wire_values','statement_native_fragments','r16_oracle_parameter_types']);
 const nodes:Array<{path:string;node_type:string;role:string;actual_rows:number|null;actual_loops:number|null;temp_read_blocks:number|null;temp_written_blocks:number|null;expression_sha256:string;jsonb_build_object_static_refs:number;native_payload_static_refs:number}>=[];
 let total=0;const number=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0?n:null;
 function visit(raw:unknown,path:string){
  assert.ok(raw&&typeof raw==='object');const n=raw as Record<string,unknown>;total++;
  const cte=String(n['CTE Name']??''),sub=String(n['Subplan Name']??'');
  const role=roles.has(cte)?'scan '+cte:sub.startsWith('CTE ')&&roles.has(sub.slice(4))?sub:/^(?:SubPlan|InitPlan) \d+/.test(sub)?sub.split(' ')[0]!:'other';
  const expressions=['Output','Filter','One-Time Filter','Join Filter','Hash Cond','Merge Cond','Index Cond','Recheck Cond'].flatMap(k=>Array.isArray(n[k])?(n[k]as unknown[]).filter((x):x is string=>typeof x==='string'):typeof n[k]==='string'?[n[k]as string]:[]).join('\n');
  const builds=(expressions.match(/jsonb_build_object\s*\(/g)??[]).length,refs=(expressions.match(/native\.payload\b/g)??[]).length;
  if(path==='0'||role!=='other'||builds||refs)nodes.push({path,node_type:typeof n['Node Type']==='string'&&/^[A-Za-z ]{1,64}$/.test(n['Node Type'])?n['Node Type']:'other',role,actual_rows:number(n['Actual Rows']),actual_loops:number(n['Actual Loops']),temp_read_blocks:number(n['Temp Read Blocks']),temp_written_blocks:number(n['Temp Written Blocks']),expression_sha256:sharedWireShaV1(expressions),jsonb_build_object_static_refs:builds,native_payload_static_refs:refs});
  const children=n.Plans;if(Array.isArray(children))children.forEach((child,i)=>visit(child,path+'.'+i));
 }
 visit(document.Plan,'0');
 // Preserve the focal native producer/scans even if earlier CTEs have many
 // SubPlans; truncating in traversal order could hide the very barrier tested.
 const priority=(n:typeof nodes[number])=>n.path==='0'?0:n.role==='CTE native'||n.role==='scan native'?1:n.jsonb_build_object_static_refs||n.native_payload_static_refs?2:3;
 const bounded=nodes.sort((a,b)=>priority(a)-priority(b)).slice(0,64);
 const nativeCount=nodes.filter(n=>n.role==='CTE native'||n.role==='scan native').length,nativeSelected=bounded.filter(n=>n.role==='CTE native'||n.role==='scan native').length;
 return{total_nodes:total,focal_nodes:nodes.length,selection_count:bounded.length,emitted_nodes:bounded.length,omitted_focal_nodes:nodes.length-bounded.length,omitted_nonfocal_nodes:total-nodes.length,maximum_emitted_nodes:64,selection_policy:'declared before native data: root; native CTE producer/scans; payload expressions; other CTE/SubPlans, at most64; not a complete plan',omission_reason:nodes.length>bounded.length?'configured_focal_summary_limit64':'none_focal',native_focal_total:nativeCount,native_focal_selected:nativeSelected,native_focal_present:nativeCount>0,native_focal_complete:nativeCount===nativeSelected,nodes:bounded,planning_ms:number(document['Planning Time']),execution_ms:number(document['Execution Time']),expression_counts:'static plan text only, not runtime call counts',loop_scope:'correlated native producer/scan may have N global loops; zero means not demanded'};
}
export async function sharedWireFunctionStatsV1(c:PoolClient){
 const tracking=String((await c.query("SELECT current_setting('track_functions') tracking")).rows[0].tracking);
 if(tracking!=='all'&&tracking!=='pl')return{status:'unavailable_not_enabled' as const,tracking,rows:[]as Array<{name:string;calls:number;total_ms:number;self_ms:number}>};
 const rows=(await c.query(`SELECT p.proname name,s.calls::float8 calls,s.total_time total_ms,s.self_time self_ms
  FROM pg_stat_xact_user_functions s JOIN pg_proc p ON p.oid=s.funcid JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname=ANY($1::text[]) ORDER BY p.proname`,[['signal_labeling_json_v1','signal_labeling_digest_v1','signal_listening_statement_money_v1','signal_listening_call_authority_v1']])).rows as Array<{name:string;calls:number;total_ms:number;self_ms:number}>;
 return{status:'observed' as const,tracking,rows};
}
export function sharedWireFunctionDeltaV1(before:Awaited<ReturnType<typeof sharedWireFunctionStatsV1>>,after:Awaited<ReturnType<typeof sharedWireFunctionStatsV1>>){
 if(before.status!=='observed'||after.status!=='observed'||before.tracking!==after.tracking)return{status:'unavailable',rows:[]};
 const rows=after.rows.map(row=>{const prior=before.rows.find(r=>r.name===row.name);return{name:row.name,calls:row.calls-(prior?.calls??0),total_ms:row.total_ms-(prior?.total_ms??0),self_ms:row.self_ms-(prior?.self_ms??0)};});
 if(rows.some(row=>[row.calls,row.total_ms,row.self_ms].some(n=>!Number.isFinite(n)||n<0)))return{status:'unavailable_counter_regressed',rows:[]};
 return{status:'observed',tracking:after.tracking,rows,limitations:'only observed non-inlined public functions; absent rows/builtins are not a zero-cost proof; elapsed not CPU'};
}
