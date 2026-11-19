import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {anchorListeningStatementOracleParametersV1,listeningExpectedProjectionOracleSqlV1} from './signal-listening-statement-validator.oracle';
import type {PoolClient} from 'pg';
export const sharedWireMigrationV1='0330_signal_listening_statement_shared_wire.sql';
export const sharedWirePayloadMigrationV1='0331_signal_listening_statement_payload.sql';
export const statementNativeProjectionMigrationV1='0336_signal_listening_statement_native_projection.sql';
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
export function sharedWireDefaultContractFromSourcesV1(sourceB:string,sourceC?:string,sourceD?:string){
 assert.equal(sharedWireShaV1(sourceB),frozenSharedWireSourceShaV1);
 if(sourceC!==undefined)assert.equal(sourceC,sharedWirePayloadBarrierSourceV1(sourceB),'0331 must be all exact proved C bytes');
 if(sourceD!==undefined){assert.ok(sourceC!==undefined);statementNativeProjectionSourceV1(sourceC,sourceD);}
 const source=sourceD??sourceC??sourceB,match=/CREATE OR REPLACE FUNCTION signal_listening_statement_money_v1\(\) RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS \$\$([\s\S]*)\$\$;\n$/.exec(source);assert.ok(match);
 const prosrc=match[1]!;
 return{contract:'r16-statement-shared-wire-default-contract-v1',default_arm:sourceD!==undefined?'D':sourceC===undefined?'B':'C',migration:sourceD!==undefined?statementNativeProjectionMigrationV1:sourceC===undefined?sharedWireMigrationV1:sharedWirePayloadMigrationV1,source_sha256:sharedWireShaV1(source),prosrc,prosrc_sha256:sharedWireShaV1(prosrc),metadata:{proconfig:['search_path=public, extensions, pg_temp'],lanname:'plpgsql',prosecdef:false,return_type:'trigger',pronargs:0,proretset:false,provolatile:'v',proisstrict:false,proparallel:'u',proleakproof:false,prokind:'f'}};
}
export async function sharedWireDefaultContractV1(){
 const [,sourceB]=await sharedWireSourcesV1();assert.ok(sourceB);
 // Current runtime is strictD: a missing0336 is never an easier B/C default.
 const [sourceC,sourceD]=await Promise.all([sharedWirePayloadMigrationV1,statementNativeProjectionMigrationV1].map(n=>readFile(new URL('./'+n,import.meta.url),'utf8')));assert.ok(sourceC&&sourceD);
 return sharedWireDefaultContractFromSourcesV1(sourceB,sourceC,sourceD);
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
export async function compareSharedWireValidationV1(c:PoolClient,oldSource:string,newSource:string,params:unknown[],sourceD?:string){
 const all=[];for(const [arm,source]of sourceD===undefined?sharedWireVariantsV1(oldSource,newSource):sharedWireNativeVariantsV1(oldSource,newSource,sourceD)){const sql=sharedWireValidationV1(source);
  const flags=(await c.query(anchorListeningStatementOracleParametersV1(sql),params)).rows[0];
  const projected=await c.query(listeningExpectedProjectionOracleSqlV1(sql),params);
  const exact=(await c.query(listeningExpectedProjectionOracleSqlV1(sql,true),params)).rows;
  const canonical=(await c.query(arm==='native'?statementNativeCanonicalProjectionV1(oldSource,sourceD!):sharedWireCanonicalProjectionV1(oldSource,newSource,arm),params)).rows;
  all.push({flags,fields:projected.fields.map(f=>[f.name,f.dataTypeID]),exact,canonical});
 }for(const result of all.slice(1))assert.deepEqual(result,all[0],'frozen A/B/C plus optionalD:3flags/8typedfields/multiplicity/SQLtext/UTF8/fullSHA equal in same native snapshot');return all[0]!;
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
 const roles=new Set(['native','batch','population','requested','selected','expected','statement_wire_values','statement_native_fragments','native_question_fragments','r16_oracle_parameter_types']);
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

const frozenPayloadSourceShaV1='cabed81234f56cf2647368aab03be14817d8de99073929f0d255b2a1f1153cf5';
const statementNativeProjectionSourceShaV1='64cb14b3ce2bb47d984f5984bd20980f9d2233a51d90c053a6cc7201c05f0a07';
const statementNativeProjectionPrefixV1='-- Project only the nine consumed native population columns.\n-- Relational statement-local fragments retain binary UTF8 identity and legacy fallback.\n';
const statementNativeProjectionColumnsV1=['root_id','input_digest','question_key','question_digest','wire','scope_basis','candidate','scope_state','answer']as const;
function fragmentRegionV1(source:string){const begin='/* statement_shared_wire_fragments_begin */',end='/* statement_shared_wire_fragments_end */';assert.equal(source.split(begin).length,2);assert.equal(source.split(end).length,2);const start=source.indexOf(begin)+begin.length,stop=source.indexOf(end,start);assert.ok(stop>start);return{start,stop,value:source.slice(start,stop)};}
export function restoreStatementNativeProjectionV1(sourceC:string,sourceD:string){
 assert.equal(sharedWireShaV1(sourceC),frozenPayloadSourceShaV1,'exact frozen0331 required');assert.equal(sharedWireShaV1(sourceD),statementNativeProjectionSourceShaV1,'exact approved0336 required');assert.ok(sourceD.startsWith(statementNativeProjectionPrefixV1));
 let inverse=sourceD.slice(statementNativeProjectionPrefixV1.length);
 for(const region of [fragmentRegionV1,canonicalRegion]){const old=region(sourceC),next=region(inverse);inverse=inverse.slice(0,next.start)+old.value+inverse.slice(next.stop);}
 const projected='SELECT '+statementNativeProjectionColumnsV1.map(k=>'p.'+k).join(',')+' FROM signal_listening_population_roots_v1';assert.equal(inverse.split(projected).length,2);inverse=inverse.replace(projected,'SELECT p.* FROM signal_listening_population_roots_v1');
 assert.equal(inverse,sourceC,'0336 inverse must recover every0331 byte, including all authority/flags/caps/BEFORE behavior');return inverse;
}
export function statementNativeProjectionSourceV1(sourceC:string,sourceD:string){
 restoreStatementNativeProjectionV1(sourceC,sourceD);const canonical=canonicalRegion(sourceD).value,fragments=fragmentRegionV1(sourceD).value;
 assert.equal(sourceD.split('CREATE OR REPLACE FUNCTION ').length,2);assert.ok(!/\b(?:GRANT|REVOKE|ALTER|SECURITY\s+DEFINER|CREATE\s+(?:TABLE|INDEX))\b/u.test(sourceD));
 assert.ok(fragments.includes('HAVING count(*)=1')&&fragments.includes('w.wire_utf8'));assert.ok(!fragments.includes('encode(')&&!fragments.includes('jsonb_object_agg'));
 assert.ok(canonical.includes("fragment.wire_utf8 IS NOT DISTINCT FROM convert_to(q.value::text,'UTF8')"));assert.ok(canonical.includes('q.wire_match IS DISTINCT FROM true OR q.canonical IS NULL'));assert.ok(!canonical.includes('decode(')&&!canonical.includes('native.fragments'));
 return{source_sha256:sharedWireShaV1(sourceD),prosrc_sha256:sharedWireShaV1(sourceD.split('AS $$')[1]!.split('$$;')[0]!),population_columns:statementNativeProjectionColumnsV1,canonical,fragments};
}
export async function sharedWireNativeSourcesV1(){
 const [old,next]=await sharedWireSourcesV1();assert.ok(old&&next);
 const sourceC=await readFile(new URL('./'+sharedWirePayloadMigrationV1,import.meta.url),'utf8'),sourceD=await readFile(new URL('./'+statementNativeProjectionMigrationV1,import.meta.url),'utf8');assert.equal(sourceC,sharedWirePayloadBarrierSourceV1(next));statementNativeProjectionSourceV1(sourceC,sourceD);return[old,next,sourceD]as const;
}
export function sharedWireNativeVariantsV1(oldSource:string,newSource:string,sourceD:string){statementNativeProjectionSourceV1(sharedWirePayloadBarrierSourceV1(newSource),sourceD);return[...sharedWireVariantsV1(oldSource,newSource),['native',sourceD]as const]as const;}
export function statementNativeCanonicalProjectionV1(oldSource:string,sourceD:string){
 const p=sharedWireCanonicalPartsV1(oldSource,sourceD),end=p.next.indexOf('\n   SELECT COALESCE(');assert.ok(end>=0);
 return anchorListeningStatementOracleParametersV1(p.next.slice(0,end)+`,serialized AS MATERIALIZED(SELECT id,${p.canonical} canonical FROM expected)\n SELECT id,encode(convert_to(canonical,'UTF8'),'hex') bytes,'sha256:'||encode(sha256(convert_to(canonical,'UTF8')),'hex') digest FROM serialized e ORDER BY id`);
}
export function statementNativeRepresentationKernelV1(oldSource:string,newSource:string,sourceD:string){
 statementNativeProjectionSourceV1(sharedWirePayloadBarrierSourceV1(newSource),sourceD);const p=sharedWireCanonicalPartsV1(oldSource,sourceD);
 const prefix=`WITH selected AS MATERIALIZED(SELECT id,native_questions questions FROM jsonb_to_recordset($8::jsonb) e(id uuid,native_questions jsonb)),expected AS MATERIALIZED(SELECT id,i,digests,basis,expected_request FROM jsonb_to_recordset($8::jsonb) e(id uuid,i jsonb,digests jsonb,basis jsonb,expected_request jsonb)),${p.wires}`;
 return anchorListeningStatementOracleParametersV1(prefix+`,serialized AS MATERIALIZED(SELECT id,public.signal_labeling_json_v1(${p.preimage}) before_canonical,${p.canonical} native_canonical FROM expected) SELECT id,encode(convert_to(before_canonical,'UTF8'),'hex') before_bytes,encode(convert_to(native_canonical,'UTF8'),'hex') native_bytes,ARRAY(SELECT key FROM statement_native_fragments ORDER BY key COLLATE "C") fragment_keys FROM serialized ORDER BY id`);
}

export async function statementNativeFunctionCatalogV1(c:PoolClient){return(await c.query<Record<string,unknown>>(`SELECT p.oid::text,p.proowner::text,p.proacl::text,p.proargtypes::text,p.proallargtypes::text,p.proargmodes::text,p.proargnames::text,
 p.proretset,p.proisstrict,p.prosecdef,p.provolatile,p.proparallel,p.proleakproof,p.prokind,p.procost,p.prorows,p.prosupport::text,l.lanname,p.proconfig,p.prorettype::regtype::text return_type,p.pronargs,p.pronargdefaults,p.proargdefaults::text,p.prosrc
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE p.oid='public.signal_listening_statement_money_v1()'::regprocedure`)).rows;}
export async function assertStatementNativeCatalogReplacementV1(c:PoolClient,sourceC:string,sourceD:string){
 const proof=statementNativeProjectionSourceV1(sourceC,sourceD);await c.query(sourceC);const before=await statementNativeFunctionCatalogV1(c);assert.equal(before.length,1);assert.equal(sharedWireShaV1(String(before[0]!.prosrc)),'5ed4fa353803122208408b1f66a29b9fdea8599b86d0d0b8de3bb18d5b2155fa');
 await c.query(sourceD);const after=await statementNativeFunctionCatalogV1(c);assert.equal(after.length,1);assert.equal(sharedWireShaV1(String(after[0]!.prosrc)),proof.prosrc_sha256);
 const withoutBody=({prosrc,...row}:Record<string,unknown>)=>row;assert.deepEqual(after.map(withoutBody),before.map(withoutBody),'CREATE OR REPLACE retains exact native OID/owner/ACL/signature/attrs');
}
/** Only the owned synthetic CI clone may create this uncommitted probe role.
 * BYPASSRLS isolates column/EXECUTE ACL; it is not evidence of RLS coverage. */
export async function assertStatementNativeColumnACLAndRevokeV1(c:PoolClient,sourceC:string,sourceD:string,params:unknown[]){
 statementNativeProjectionSourceV1(sourceC,sourceD);const role='r16_statement_acl_'+randomUUID().replaceAll('-',''),quoted='"'+role+'"';
 const own=(await c.query("SELECT current_database() name,current_user owner,(SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user) super")).rows[0];assert.match(own.name,/^noisia_mfp_recovery_[a-f0-9]{32}$/u);assert.equal(own.super,true);
 const raw='signal_listening_population_roots_v1(uuid,uuid,uuid,text,uuid[],text)',helpers=[raw,'signal_labeling_json_v1(jsonb)','signal_labeling_digest_v1(jsonb)','signal_mass_labeling_lexical_text_v1(text)','signal_mass_labeling_category_pattern_v1(text[])','signal_mass_labeling_category_pattern_matches_v1(text,text)','signal_mass_labeling_r13_hashtags_v1(text)','signal_listening_discovery_candidates_v1(uuid,uuid,uuid,uuid,uuid)'];
 const aclState=async()=>(await c.query(`SELECT jsonb_build_object('functions',(SELECT jsonb_agg(jsonb_build_array(p.oid::text,p.proowner::text,p.proacl::text) ORDER BY p.oid) FROM pg_catalog.pg_proc p WHERE p.oid IN(SELECT pg_catalog.to_regprocedure(x)::oid FROM unnest($1::text[]) x)),
  'tables',(SELECT jsonb_agg(jsonb_build_array(cl.oid::text,cl.relowner::text,cl.relacl::text) ORDER BY cl.oid) FROM pg_catalog.pg_class cl JOIN pg_catalog.pg_namespace n ON n.oid=cl.relnamespace WHERE n.nspname='public'),
  'columns',(SELECT jsonb_agg(jsonb_build_array(a.attnum,a.attacl::text) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid='public.mentions'::regclass)) value`,[helpers.map(x=>'public.'+x)])).rows[0].value;
 const baseline=await aclState(),prepared=new Set<string>();await c.query('SAVEPOINT statement_acl_scope');
 try{
  await c.query('CREATE ROLE '+quoted+' NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS');
  for(const schema of['public','extensions'])await c.query('GRANT USAGE ON SCHEMA "'+schema+'" TO '+quoted);
  await c.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO '+quoted);for(const signature of helpers)await c.query('GRANT EXECUTE ON FUNCTION public.'+signature+' TO '+quoted);
  const probe=async(source:string):Promise<{rows?:Array<Record<string,unknown>>;code?:string;message?:string}>=>{await c.query('SAVEPOINT statement_acl_probe');try{await c.query('SET LOCAL ROLE '+quoted);const name=role+(source===sourceC?'_C':'_D'),result=await c.query<Record<string,unknown>>({name,text:anchorListeningStatementOracleParametersV1(sharedWireValidationV1(source)),values:params});prepared.add(name);return{rows:result.rows};}catch(error){return{code:(error as {code?:string}).code,message:(error as Error).message};}finally{await c.query('ROLLBACK TO SAVEPOINT statement_acl_probe');await c.query('RESET ROLE');await c.query('RELEASE SAVEPOINT statement_acl_probe');}};
  const positive=async()=>{for(const source of[sourceC,sourceD]){const result=await probe(source);assert.equal(result.code,undefined,result.message);assert.deepEqual(result.rows,[{invalid_questions:false,invalid_request:false,invalid_prior:false}],'nonowner has sufficient SELECT/helper rights before revocation');}assert.equal(prepared.size,2,'the same named C/D statements are cached before each permission change');};
  const denied=async(gate:string)=>{for(const source of[sourceC,sourceD]){const result=await probe(source);assert.equal(result.code,'42501');assert.ok(result.message?.includes(gate),'denial names the intended gate, not another helper/RLS');}};
  const identity=(await c.query("SET LOCAL ROLE "+quoted).then(()=>c.query("SELECT current_user name,(SELECT oid::text FROM pg_catalog.pg_roles WHERE rolname=current_user) oid,(SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user) super,(SELECT rolbypassrls FROM pg_catalog.pg_roles WHERE rolname=current_user) bypass"))).rows[0];await c.query('RESET ROLE');assert.equal(identity.name,role);assert.equal(identity.super,false);assert.equal(identity.bypass,true);assert.notEqual(identity.oid,(await statementNativeFunctionCatalogV1(c))[0]!.proowner);
  await positive();await c.query('SAVEPOINT statement_column_phase');
  try{
   await c.query('REVOKE SELECT ON public.mentions FROM PUBLIC,'+quoted);await c.query('REVOKE SELECT(platform) ON public.mentions FROM PUBLIC,'+quoted);
   const columns=(await c.query("SELECT attname FROM pg_catalog.pg_attribute WHERE attrelid='public.mentions'::regclass AND attnum>0 AND NOT attisdropped AND attname<>'platform' ORDER BY attnum")).rows.map(r=>String(r.attname));assert.ok(columns.length>0&&columns.every(x=>/^[a-z_][a-z_0-9]*$/u.test(x)));await c.query('GRANT SELECT('+columns.map(x=>'"'+x+'"').join(',')+') ON public.mentions TO '+quoted);
   const gate=(await c.query("SELECT pg_catalog.has_table_privilege($1::name,'public.mentions','SELECT') whole,pg_catalog.has_column_privilege($1::name,'public.mentions','platform','SELECT') platform",[role])).rows[0];assert.equal(gate.whole,false);assert.equal(gate.platform,false);await denied('mentions');
  }finally{await c.query('ROLLBACK TO SAVEPOINT statement_column_phase');await c.query('RELEASE SAVEPOINT statement_column_phase');}
  await positive();await c.query('SAVEPOINT statement_execute_phase');
  try{await c.query('REVOKE EXECUTE ON FUNCTION public.'+raw+' FROM PUBLIC,'+quoted);assert.equal((await c.query("SELECT pg_catalog.has_function_privilege($1::name,$2::regprocedure,'EXECUTE') allowed",[role,'public.'+raw])).rows[0].allowed,false);await denied('signal_listening_population_roots_v1');}
  finally{await c.query('ROLLBACK TO SAVEPOINT statement_execute_phase');await c.query('RELEASE SAVEPOINT statement_execute_phase');}
  await positive();
 }finally{await c.query('ROLLBACK TO SAVEPOINT statement_acl_scope');await c.query('RESET ROLE');for(const name of prepared)await c.query('DEALLOCATE "'+name+'"');await c.query('RELEASE SAVEPOINT statement_acl_scope');}
 assert.equal((await c.query('SELECT pg_catalog.to_regrole($1) role',[role])).rows[0].role,null);assert.deepEqual(await aclState(),baseline,'all CI-only role/grants/column ACL changes roll back exactly');
}
