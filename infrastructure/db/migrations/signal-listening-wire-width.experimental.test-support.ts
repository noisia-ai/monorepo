// TEST ONLY. A separately owned shadow producer; no original function is replaced.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {PoolClient,QueryResult} from 'pg';
import type {LabelingDatabaseV1} from '../signal-mention-facets';
import type {SignalListeningInputV1} from '@noisia/query-engine';
import {hydrateListeningInputProjectionV1,type ListeningInputProjectionRowV1} from '../signal-listening-input-projection';
import {wirePopulationPartsV1,wirePopulationColumnsV1,wirePopulationSourceShaV1} from './signal-listening-wire-population.oracle';
import {projectionHelperPartsV1,sanitizeProjectionLinearPlanV1,assertProjectionSurveyLinearPlanV1,type ProjectionPlanV1} from './signal-listening-projection-linear-joins.oracle';

const NAME='r16_wire_width_q13_shadow_v1';
const SIX='uuid,uuid,uuid,text,uuid[],text';
const ORIGINAL='signal_listening_wire_population_roots_v1';
const ORIGINAL_SIGNATURE='public.'+ORIGINAL+'('+SIX+')';
const SIGNATURE='public.'+NAME+'('+SIX+')';
const BINDS='($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid[],$6::text)';
const PRODUCT_SHA='97a7d61e77268524ba1f9d1557f54ffa0ba2dc9b154ab256ac683b81aa86a469';
const SURVEY_SQL_SHA='739613a2fceb44f3c00aa9b8b114efe3fd81a6bd76975841cc725773a2419e24';
const FETCH_ROWS=16,MAX_HEX_ROW=2*1024*1024;
const originalSignatures=[ORIGINAL_SIGNATURE,'public.signal_listening_population_roots_v1('+SIX+')',
 'public.signal_listening_statement_money_v1()','public.signal_listening_compact_population_roots_v1('+SIX+')',
 'public.signal_listening_answer_guard_v1()']as const;
type Catalog=Record<string,unknown>&{oid:string;proname:string;namespace:string;proowner:string;owner_name:string;prosrc:string;
 acl:Array<{grantor:string;grantee:string;privilege_type:string;is_grantable:boolean}>;proacl_raw:string|null};
type Scope={oid:string;catalog:Catalog;before:Catalog[];uncertain:boolean;functional:Array<Record<string,unknown>>;
 setup:Record<string,unknown>;null_protocol_checked:boolean;arrays_checked:boolean;permissions_checked:boolean};
let active:Scope|undefined;
const uncertain=new WeakSet<PoolClient>();
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
function same(value:unknown):string{const encoded=JSON.stringify(value);assert.ok(typeof encoded==='string');return encoded;}
function mark(c:PoolClient){uncertain.add(c);if(active)active.uncertain=true;}
export function releaseWireWidthClientV1(c:PoolClient,error?:Error|boolean){
 try{c.release(uncertain.has(c)?true:error);}catch(failure){mark(c);throw failure;}
}
export async function rollbackReleaseWireWidthClientV1(c:PoolClient,primaryKnown=false,primary?:unknown){
 const failures:unknown[]=[];
 try{await c.query('ROLLBACK');}catch(error){failures.push(error);mark(c);}
 try{releaseWireWidthClientV1(c);}catch(error){failures.push(error);}
 if(failures.length)throw new AggregateError(primaryKnown?[primary,...failures]:failures,'wire_width_rollback_release_unknown');
}
async function closeClient(c:PoolClient,rollback:boolean,discard:boolean,primaryKnown:boolean,primary:unknown){
 const failures:unknown[]=[];
 if(rollback)try{await c.query('ROLLBACK');}catch(error){mark(c);failures.push(error);}
 try{releaseWireWidthClientV1(c,discard||uncertain.has(c)||failures.length>0?true:undefined);}catch(error){failures.push(error);}
 if(failures.length)throw new AggregateError(primaryKnown?[primary,...failures]:failures,'wire_width_client_close_unknown');
}
const catalogSql="SELECT p.oid::text,p.proname,n.nspname namespace,p.pronamespace::text namespace_oid,p.prolang::text language_oid,p.provariadic::text,p.protrftypes::text,p.prosqlbody::text,p.proowner::text,pg_get_userbyid(p.proowner) owner_name,p.prosrc,p.probin,p.proacl::text proacl_raw,p.proargtypes::text,p.proallargtypes::text,p.proargmodes::text,p.proargnames::text,p.prorettype::text,p.proretset,p.pronargs,p.pronargdefaults,p.proargdefaults::text,p.proisstrict,p.prosecdef,p.provolatile,p.proparallel,p.proleakproof,p.prokind,p.procost,p.prorows,p.prosupport::text,l.lanname,p.proconfig,COALESCE((SELECT jsonb_agg(jsonb_build_object('grantor',a.grantor::text,'grantee',a.grantee::text,'privilege_type',a.privilege_type,'is_grantable',a.is_grantable) ORDER BY a.grantor,a.grantee,a.privilege_type,a.is_grantable) FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a),'[]'::jsonb) acl FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE p.oid=pg_catalog.to_regprocedure($1)";
async function catalog(c:PoolClient,signature:string):Promise<Catalog|undefined>{
 const rows=(await c.query<Catalog>(catalogSql,[signature])).rows;assert.ok(rows.length<=1);return rows[0];
}
async function originals(c:PoolClient){const rows:Catalog[]=[];for(const signature of originalSignatures){const row=await catalog(c,signature);assert.ok(row);rows.push(row);}return rows;}
function properties(row:Catalog){return Object.fromEntries(Object.entries(row).filter(([key])=>!['oid','proname','prosrc','proacl_raw'].includes(key)));}
function body(sql:string){const start=sql.indexOf('AS $function$'),end=sql.lastIndexOf('$function$;');assert.ok(start>=0&&end>start);return sql.slice(start+'AS $function$'.length,end);}
export async function wireWidthShadowSourceV1(){
 const source=await readFile(new URL('./0337_signal_listening_wire_population.sql',import.meta.url),'utf8');
 assert.equal(sha(source),wirePopulationSourceShaV1);
 const raw=wirePopulationPartsV1(source).raw;
 const changes=[
  ['CREATE FUNCTION '+ORIGINAL+'(','CREATE FUNCTION public.'+NAME+'(',1],
  ['qs AS MATERIALIZED(SELECT q.* FROM signal_listening_questions q JOIN config c ON c.id=q.configuration_id),',
   "qs AS MATERIALIZED(SELECT q.* FROM signal_listening_questions q JOIN config c ON c.id=q.configuration_id),\n qs_output AS MATERIALIZED(SELECT question_key,question_digest,wire,definition->>'scope' question_scope,definition->>'topic_source' topic_source FROM qs),",2],
  ['prepared AS MATERIALIZED(SELECT i.*,v.answer voice,p.answer promotion,',
   'prepared AS MATERIALIZED(SELECT i.root_id,i.listening_input_digest,i.candidates,i.body_octets,i.platform_octets,\n   (v.answer IS NOT NULL AND p.answer IS NOT NULL) base_ready,',2],
  ["q.wire,CASE WHEN q.definition->>'scope'='consumer_category' THEN i.basis ELSE NULL END,",
   "q.wire,CASE WHEN q.question_scope='consumer_category' THEN i.basis ELSE NULL END,",2],
  ["CASE q.definition->>'topic_source' WHEN 'defined'","CASE q.topic_source WHEN 'defined'",2],
  ["CASE WHEN q.definition->>'scope'='all' THEN 'included' WHEN i.voice IS NULL OR i.promotion IS NULL THEN 'awaiting_base'",
   "CASE WHEN q.question_scope='all' THEN 'included' WHEN i.base_ready IS DISTINCT FROM true THEN 'awaiting_base'",2],
  ['FROM prepared i CROSS JOIN qs q FULL JOIN base_answers a','FROM prepared i CROSS JOIN qs_output q FULL JOIN base_answers a',2],
 ]as const;
 let candidate=raw;
 for(const[before,after,count]of changes){assert.equal(candidate.split(before).length-1,count);assert.ok(!candidate.includes(after));candidate=candidate.split(before).join(after);}
 let inverse=candidate;for(const[before,after,count]of [...changes].reverse()){assert.equal(inverse.split(after).length-1,count);inverse=inverse.split(after).join(before);}assert.equal(inverse,raw);
 assert.equal((candidate.match(/has_function_privilege/g)??[]).length,1);
 return{source,raw,candidate,original_body:body(raw),candidate_body:body(candidate)};
}
async function owned(c:PoolClient){
 assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.NOISIA_R16_LOCAL_PG_LAB,'r16-benchmark-pg17');
 const row=(await c.query<{name:string;version:number;super:boolean;readonly:string}>("SELECT current_database() name,current_setting('server_version_num')::int version,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) super,current_setting('transaction_read_only') readonly")).rows[0]!;
 assert.ok(row.name==='noisia_mfp_ci'||/^noisia_mfp_recovery_[a-f0-9]{32}$/u.test(row.name));
 assert.ok(row.version>=170000&&row.version<180000);assert.equal(row.super,true);assert.equal(row.readonly,'off');return row;
}
async function identity(c:PoolClient){
 const row=(await c.query<{pid:number;snapshot:string;readonly:string;isolation:string;work_mem:string;work_mem_bytes:string;hash_mem_multiplier:string}>("SELECT pg_backend_pid() pid,pg_current_snapshot()::text snapshot,current_setting('transaction_read_only') readonly,current_setting('transaction_isolation') isolation,current_setting('work_mem') work_mem,pg_size_bytes(current_setting('work_mem'))::text work_mem_bytes,current_setting('hash_mem_multiplier') hash_mem_multiplier")).rows[0]!;
 assert.equal(row.readonly,'on');assert.equal(row.isolation,'repeatable read');assert.equal(row.work_mem_bytes,'4194304');
 assert.ok(Number.isSafeInteger(row.pid)&&row.pid>0&&row.snapshot.length>0);return row;
}
async function unchanged(c:PoolClient){assert.ok(active&&!active.uncertain);assert.deepEqual(await originals(c),active.before);const row=await catalog(c,SIGNATURE);assert.deepEqual(row,active.catalog);}
async function setup(database:LabelingDatabaseV1):Promise<Scope>{
 assert.equal(active,undefined,'one fixture owns the shadow lifecycle');
 const c=await database.connect();let tx=false,commitAttempted=false,primaryKnown=false,primary:unknown;
 try{
  const target=await owned(c);const before=await originals(c),source=await wireWidthShadowSourceV1(),original=before[0]!;
  assert.equal(original.prosrc,source.original_body);assert.equal(await catalog(c,SIGNATURE),undefined,'never replace or adopt an existing shadow');
  await c.query('BEGIN');tx=true;
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('r16-wire-width-q13-shadow',0))");
  assert.equal(await catalog(c,SIGNATURE),undefined);
  await c.query(source.candidate);
  let created=await catalog(c,SIGNATURE);assert.ok(created&&created.prosrc===source.candidate_body&&created.oid!==original.oid);
  if(created.proowner!==original.proowner)await c.query('ALTER FUNCTION '+SIGNATURE+' OWNER TO '+quote(original.owner_name));
  created=await catalog(c,SIGNATURE);assert.ok(created);
  // Exact original owner/grantor/option set. Only the newly created object changes.
  for(const permission of original.acl)assert.equal(permission.grantor,original.proowner,'non-owner ACL grantor cannot be reproduced silently');
  for(const permission of created.acl){
   const grantee=permission.grantee==='0'?'PUBLIC':quote((await c.query<{name:string}>('SELECT rolname name FROM pg_roles WHERE oid=$1::oid',[permission.grantee])).rows[0]!.name);
   await c.query('REVOKE ALL ON FUNCTION '+SIGNATURE+' FROM '+grantee);
  }
  for(const permission of original.acl){
   assert.equal(permission.privilege_type,'EXECUTE');
   const grantee=permission.grantee==='0'?'PUBLIC':quote((await c.query<{name:string}>('SELECT rolname name FROM pg_roles WHERE oid=$1::oid',[permission.grantee])).rows[0]!.name);
   await c.query('GRANT EXECUTE ON FUNCTION '+SIGNATURE+' TO '+grantee+(permission.is_grantable?' WITH GRANT OPTION':''));
  }
  created=await catalog(c,SIGNATURE);assert.ok(created);
  assert.deepEqual(properties(created),properties(original),'eleven-output ABI, owner, invoker/STABLE/search_path and effective ACL exactly copied');
  assert.deepEqual(await originals(c),before,'all five original function catalogs unchanged by setup');
  commitAttempted=true;await c.query('COMMIT');tx=false;
  assert.deepEqual(await catalog(c,SIGNATURE),created);assert.deepEqual(await originals(c),before);
  return{oid:created.oid,catalog:created,before,uncertain:false,functional:[],null_protocol_checked:false,arrays_checked:false,permissions_checked:false,
   setup:{database:target.name,shadow_signature:SIGNATURE,shadow_oid:created.oid,original_signature:ORIGINAL_SIGNATURE,original_oid:original.oid,
    schema_equal:created.namespace===original.namespace,owner_equal:true,effective_acl_equal:true,
    raw_acl_representation:{original:original.proacl_raw,shadow:created.proacl_raw},
    original_source_sha256:wirePopulationSourceShaV1,original_body_sha256:sha(source.original_body),candidate_sql_sha256:sha(source.candidate),candidate_body_sha256:sha(source.candidate_body),
    properties_sha256:sha(same(properties(created))),original_catalog_sha256:sha(same(before)),create_commit_ack:true}};
 }catch(error){
  primaryKnown=true;primary=error;
  if(commitAttempted||!tx)mark(c);
  throw error;
 }finally{await closeClient(c,tx&&!commitAttempted,uncertain.has(c),primaryKnown,primary);}
}
async function cleanup(database:LabelingDatabaseV1,scope:Scope){
 if(scope.uncertain)throw Error('wire_width_cleanup_not_attempted_after_connection_uncertainty');
 const c=await database.connect();let tx=false,commitAttempted=false,primaryKnown=false,primary:unknown;
 try{
  await owned(c);await unchanged(c);await c.query('BEGIN');tx=true;
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('r16-wire-width-q13-shadow',0))");
  const row=await catalog(c,SIGNATURE);assert.ok(row);assert.deepEqual(row,scope.catalog);assert.equal(row.oid,scope.oid);
  await c.query('DROP FUNCTION '+SIGNATURE);
  assert.equal(await catalog(c,SIGNATURE),undefined);assert.deepEqual(await originals(c),scope.before);
  commitAttempted=true;await c.query('COMMIT');tx=false;
  assert.equal(await catalog(c,SIGNATURE),undefined);assert.deepEqual(await originals(c),scope.before);
  return{drop_signature:SIGNATURE,drop_oid:scope.oid,oid_and_signature_checked_before_drop:true,drop_commit_ack:true,absent_after_ack:true,original_catalog_unchanged:true};
 }catch(error){
  primaryKnown=true;primary=error;mark(c);
  throw error;
 }finally{await closeClient(c,tx&&!commitAttempted,uncertain.has(c),primaryKnown,primary);}
}
export async function withWireWidthShadowV1<T>(database:LabelingDatabaseV1,fn:()=>Promise<T>):Promise<T>{
 const scope=await setup(database);active=scope;let value:{result:T}|undefined,primaryKnown=false,primary:unknown,closed:unknown;
 try{value={result:await fn()};}catch(error){primaryKnown=true;primary=error;}
 try{closed=await cleanup(database,scope);}catch(error){active=undefined;if(primaryKnown)throw new AggregateError([primary,error],'wire_width_fixture_and_cleanup_failed');throw error;}
 active=undefined;
 const receipt={contract:'r16-wire-width-shadow-lifecycle-v1',experimental:true,product_adopted:false,setup:scope.setup,closure:closed,functional:scope.functional,
  null_protocol_checked:scope.null_protocol_checked,root_array_cases_checked:scope.arrays_checked,partial_column_roles_checked:scope.permissions_checked,
  original_functions_modified:false,external_provider_calls:0,H1_accepted:false,connection_uncertainty:false};
 assert.ok(Buffer.byteLength(same(receipt))<=1024*1024);console.log('# experimental wire width lifecycle '+same(receipt));
 if(primaryKnown)throw primary;assert.ok(value);return value.result;
}
const population=(name:string)=>'SELECT p.* FROM public.'+name+BINDS+' p';
async function binaryCompare(c:PoolClient,params:unknown[]){
 assert.equal(params.length,6);await unchanged(c);const anchor=await identity(c);
 const old=population(ORIGINAL),next=population(NAME);
 const a=await c.query('SELECT * FROM ('+old+') old LIMIT 0',params),b=await c.query('SELECT * FROM ('+next+') new LIMIT 0',params);
 assert.deepEqual(b.fields.map(f=>[f.name,f.dataTypeID]),a.fields.map(f=>[f.name,f.dataTypeID]));
 assert.deepEqual(a.fields.map(f=>f.name),[...wirePopulationColumnsV1]);
 const withBags='WITH old AS MATERIALIZED('+old+'),new AS MATERIALIZED('+next+') ';
 const delta=(await c.query<{n:string}>(withBags+'SELECT count(*)::text n FROM((TABLE old EXCEPT ALL TABLE new) UNION ALL(TABLE new EXCEPT ALL TABLE old)) delta',params)).rows[0]!;
 assert.equal(delta.n,'0','eleven typed fields and multiplicity must match');
 const hashes={old:createHash('sha256'),new:createHash('sha256')},counts={old:0,new:0};
 let cursor=false;
 try{
  await c.query('DECLARE r16_wire_width_binary NO SCROLL CURSOR FOR '+withBags+"SELECT side,bytes FROM(SELECT 'old' side,encode(pg_catalog.record_send(o),'hex') bytes FROM old o UNION ALL SELECT 'new' side,encode(pg_catalog.record_send(n),'hex') bytes FROM new n) ordered ORDER BY side,bytes",params);cursor=true;
  for(;;){const rows=(await c.query<{side:string;bytes:string}>('FETCH FORWARD '+FETCH_ROWS+' FROM r16_wire_width_binary')).rows;assert.ok(rows.length<=FETCH_ROWS);
   if(!rows.length)break;
   for(const row of rows){assert.ok(row.side==='old'||row.side==='new');assert.equal(typeof row.bytes,'string');assert.ok(row.bytes.length<=MAX_HEX_ROW);assert.match(row.bytes,/^(?:[a-f0-9]{2})+$/u);
    const side=row.side as 'old'|'new';if(counts[side]++)hashes[side].update('\n');hashes[side].update(row.bytes);}
  }
  await c.query('CLOSE r16_wire_width_binary');cursor=false;
 }catch(error){mark(c);throw error;}
 finally{if(cursor)mark(c);}
 const digests={old:hashes.old.digest('hex'),new:hashes.new.digest('hex')};assert.equal(counts.old,counts.new);assert.equal(digests.old,digests.new);
 assert.deepEqual(await identity(c),anchor);await unchanged(c);
 return{rows:counts.old,native_record_sha256:digests.old,fields:a.fields.map(f=>[f.name,f.dataTypeID]),typed_except_all_difference:0,cursor_fetch_max:FETCH_ROWS,cursor_close_ack:true};
}
async function nullProtocol(c:PoolClient){
 const sql="WITH prepared(id,voice,promotion,question_scope,included) AS(VALUES(1,NULL::jsonb,NULL::jsonb,'consumer_category'::text,false),(2,'null'::jsonb,'null'::jsonb,'consumer_category',false),(3,'{}'::jsonb,NULL::jsonb,'consumer_category',true),(4,'{}'::jsonb,'{}'::jsonb,'consumer_category',true),(5,NULL::jsonb,NULL::jsonb,'all',false)),right_side(id,answer) AS(VALUES(1,NULL::jsonb),(2,'null'::jsonb),(99,'1.00'::jsonb)),narrow AS MATERIALIZED(SELECT id,(voice IS NOT NULL AND promotion IS NOT NULL) base_ready,question_scope,included FROM prepared),old AS MATERIALIZED(SELECT COALESCE(p.id,a.id) id,CASE WHEN question_scope='all' THEN 'included' WHEN voice IS NULL OR promotion IS NULL THEN 'awaiting_base' WHEN included THEN 'included' ELSE 'excluded' END scope_state,a.answer FROM prepared p FULL JOIN right_side a ON a.id=p.id),new AS MATERIALIZED(SELECT COALESCE(p.id,a.id) id,CASE WHEN question_scope='all' THEN 'included' WHEN base_ready IS DISTINCT FROM true THEN 'awaiting_base' WHEN included THEN 'included' ELSE 'excluded' END scope_state,a.answer FROM narrow p FULL JOIN right_side a ON a.id=p.id) SELECT (SELECT count(*)::int FROM old) n,(SELECT count(*)::int FROM((TABLE old EXCEPT ALL TABLE new) UNION ALL(TABLE new EXCEPT ALL TABLE old)) delta) difference,(SELECT scope_state FROM new WHERE id=99) absent_scope,(SELECT scope_state FROM new WHERE id=2) json_null_scope,(SELECT scope_state FROM new WHERE id=5) all_scope";
 const row=(await c.query<{n:number;difference:number;absent_scope:string;json_null_scope:string;all_scope:string}>(sql)).rows[0]!;
 assert.deepEqual(row,{n:6,difference:0,absent_scope:'awaiting_base',json_null_scope:'excluded',all_scope:'included'});
 assert.ok(active);active.null_protocol_checked=true;
}
export async function compareWireWidthPopulationV1(c:PoolClient,params:unknown[]){
 try{
  if(!active?.null_protocol_checked)await nullProtocol(c);
  const result=await binaryCompare(c,params);assert.ok(active);
  active.functional.push({kind:'native_eleven_fields',params_sha256:sha(same(params)),...result});
  assert.ok(active.functional.length<=256);
  if(!active.arrays_checked){
   assert.ok(Array.isArray(params[4])&&params[4].length>0);const roots=params[4] as string[];
   const variants=[null,[],[null],[roots[0],roots[0],null],Array(4097).fill(roots[0])];
   for(const value of variants){const args=[...params];args[4]=value;const checked=await binaryCompare(c,args);active.functional.push({kind:'root_array',root_count:value?.length??null,params_sha256:sha(same(args)),...checked});}
   for(const purpose of ['client-derived-metrics','internal-qa']){const args=[...params];args[5]=purpose;const checked=await binaryCompare(c,args);active.functional.push({kind:'purpose',purpose,...checked});}
   active.arrays_checked=true;
  }
  return result;
 }catch(error){mark(c);throw error;}
}
function shadowSql(sql:string){const token=ORIGINAL+'(';assert.equal(sql.split(token).length-1,1);assert.ok(!sql.includes(NAME));return sql.replace(token,'public.'+NAME+'(');}
export async function compareWireWidthMetadataV1(c:PoolClient,sql:string,params:unknown[]|undefined,result:QueryResult){
 if(!sql.startsWith('/* labeling_listening_input_metadata_v1 */'))return;
 try{
  assert.ok(params&&params.length===9);const source=await readFile(new URL('../signal-listening-runs.ts',import.meta.url),'utf8');assert.equal(sha(source),PRODUCT_SHA);
  assert.ok(sql===projectionHelperPartsV1(source).sql||sql===projectionHelperPartsV1(source,'survey').sql);
  const anchor=await identity(c);await unchanged(c);const candidate=await c.query(shadowSql(sql),params);
  assert.deepEqual(candidate.fields.map(f=>[f.name,f.dataTypeID]),result.fields.map(f=>[f.name,f.dataTypeID]));assert.deepEqual(candidate.rows,result.rows);
  assert.deepEqual(await identity(c),anchor);await unchanged(c);assert.ok(active);active.functional.push({kind:'metadata',sql_sha256:sha(sql),params_sha256:sha(same(params)),rows:result.rows.length,rows_sha256:sha(same(result.rows)),equal:true});assert.ok(active.functional.length<=256);
 }catch(error){mark(c);throw error;}
}
export async function assertWireWidthPermissionsV1(database:LabelingDatabaseV1,params:unknown[]){
 const c=await database.connect();let tx=false,primaryKnown=false,primary:unknown;
 const role='r16_width_role_'+randomUUID().replaceAll('-',''),roleSql=quote(role);
 const tables=async()=>(await c.query("SELECT c.oid::text,c.relname,c.relacl::text,(SELECT COALESCE(jsonb_agg(jsonb_build_array(a.attnum,a.attacl::text) ORDER BY a.attnum),'[]'::jsonb) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL) columns FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p','v','m') ORDER BY c.oid")).rows;
 try{
  await owned(c);await unchanged(c);const before=await tables();await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');tx=true;
  const executeRole=(await c.query<{oid:string;name:string;super:boolean}>("SELECT oid::text,rolname name,rolsuper super FROM pg_roles WHERE rolname='service_role'")).rows[0];
  assert.ok(executeRole);assert.equal(executeRole.super,false);
  assert.ok(active&&active.before.every(row=>row.proowner!==executeRole.oid));
  await c.query('CREATE ROLE '+roleSql+' NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT BYPASSRLS');
  await c.query('GRANT '+quote(executeRole.name)+' TO '+roleSql);
  const schemas=(await c.query<{name:string}>("SELECT nspname name FROM pg_namespace WHERE nspname IN('public','extensions') ORDER BY nspname")).rows;
  assert.ok(schemas.some(row=>row.name==='public'));
  for(const row of schemas){assert.ok(['public','extensions'].includes(row.name));await c.query('GRANT USAGE ON SCHEMA '+quote(row.name)+' TO '+roleSql);}
  await c.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO '+roleSql);
  // Function ACLs are never changed. This uncommitted non-login role inherits
  // only already-existing EXECUTE rights; successful row-producing calls below
  // establish that another helper/RLS gate does not masquerade as column denial.
  for(const signature of [ORIGINAL_SIGNATURE,SIGNATURE,'public.signal_listening_population_roots_v1('+SIX+')'])
   assert.equal((await c.query<{allowed:boolean}>("SELECT has_function_privilege($1::name,$2::text,'EXECUTE') allowed",[role,signature])).rows[0]!.allowed,true,'the partial-column probe requires actual existing EXECUTE access');
  async function probe(name:string):Promise<{kind:'success';value:QueryResult}|{kind:'error';error:unknown}>{
   let primaryKnown=false,primary:unknown,value:QueryResult|undefined,save=false;
   try{await c.query('SAVEPOINT r16_width_role_probe');save=true;await c.query('SET LOCAL ROLE '+roleSql);value=await c.query('SELECT count(*)::int n FROM public.'+name+BINDS,params);}
   catch(error){primaryKnown=true;primary=error;}
   if(save)try{await c.query('ROLLBACK TO SAVEPOINT r16_width_role_probe');await c.query('RELEASE SAVEPOINT r16_width_role_probe');}catch(error){mark(c);throw new AggregateError(primaryKnown?[primary,error]:[error],'wire_width_role_restore_unknown');}
   else{mark(c);throw Error('wire_width_role_savepoint_unknown');}
   if(primaryKnown)return{kind:'error',error:primary};assert.ok(value);return{kind:'success',value};
  }
  async function positive(){for(const name of [ORIGINAL,NAME]){const result=await probe(name);assert.equal(result.kind,'success');if(result.kind!=='success')throw Error('wire_width_role_positive_missing');assert.ok(result.value.rows[0].n>0);}}
  await positive();
  const denied:Array<Record<string,string>>=[];
  for(const[table,column]of [['signal_listening_questions','workspace_id'],['signal_mass_labeling_items','ordinal'],['mentions','platform'],['mentions','published_at']]as const){
   await c.query('SAVEPOINT r16_width_column_phase');
   try{
    const owner=(await c.query<{owner:string}>('SELECT relowner::text owner FROM pg_class WHERE oid=$1::regclass',['public.'+table])).rows[0]!;
    assert.notEqual(owner.owner,executeRole.oid);
    await c.query('REVOKE SELECT ON TABLE public.'+table+' FROM PUBLIC,'+roleSql+','+quote(executeRole.name));
    assert.equal((await c.query<{allowed:boolean}>("SELECT has_table_privilege($1::name,$2::regclass,'SELECT') allowed",[role,'public.'+table])).rows[0]!.allowed,false);
    const columns=(await c.query<{name:string}>('SELECT attname name FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum',['public.'+table])).rows.map(row=>row.name);assert.ok(columns.includes(column));
    await c.query('REVOKE SELECT('+quote(column)+') ON TABLE public.'+table+' FROM PUBLIC,'+roleSql+','+quote(executeRole.name));
    await c.query('GRANT SELECT('+columns.filter(name=>name!==column).map(quote).join(',')+') ON TABLE public.'+table+' TO '+roleSql);
    assert.equal((await c.query<{allowed:boolean}>("SELECT has_column_privilege($1::name,$2::regclass,$3::text,'SELECT') allowed",[role,'public.'+table,column])).rows[0]!.allowed,false);
    for(const name of [ORIGINAL,NAME]){const result=await probe(name);assert.equal(result.kind,'error');if(result.kind!=='error')throw Error('wire_width_missing_column_was_accepted');const error=result.error as {code?:string;message?:string};assert.equal(error?.code,'42501');assert.ok(error.message?.includes(table));denied.push({table,column,producer:name,code:error.code!});}
   }finally{try{await c.query('ROLLBACK TO SAVEPOINT r16_width_column_phase');await c.query('RELEASE SAVEPOINT r16_width_column_phase');}catch(error){mark(c);throw error;}}
   await positive();await unchanged(c);
  }
  await c.query('ROLLBACK');tx=false;
  assert.equal((await c.query<{role:string|null}>('SELECT to_regrole($1)::text role',[role])).rows[0]!.role,null);assert.deepEqual(await tables(),before);await unchanged(c);assert.ok(active);active.permissions_checked=true;active.functional.push({kind:'partial_column_acl',role_rolled_back:true,table_column_acl_restored:true,original_function_acl_never_changed:true,denied});
 }catch(error){primaryKnown=true;primary=error;mark(c);throw error;}
 finally{await closeClient(c,tx,uncertain.has(c),primaryKnown,primary);}
}
type Metadata=ListeningInputProjectionRowV1&{state_json_bytes:string|null};
export async function runSurveyWireWidthExperimentV1(c:PoolClient,args:{sql:string;params:unknown[];actual:Metadata[];
 scope:{workspace_id:string;map_id:string;configuration_digest:string};expectedInputs:SignalListeningInputV1[]}){
 try{
  assert.equal(args.params.length,9);assert.ok(Array.isArray(args.params[7])&&args.params[7].length===4096);
  assert.equal(args.actual.length,4096);assert.equal(args.expectedInputs.length,4096);
  assert.equal(sha(args.sql),SURVEY_SQL_SHA);
  await compareWireWidthPopulationV1(c,[args.params[0],args.params[1],args.params[2],args.params[3],args.params[7],'llm-processing']);
  const candidateSql=shadowSql(args.sql),anchor=await identity(c);await unchanged(c);
  assert.deepEqual(args.actual.map(row=>row.root_id),args.params[7]);assert.deepEqual(args.expectedInputs.map(row=>row.root_id),args.params[7]);
  assert.ok(args.actual.every(row=>row.projection!==null&&row.projection.question_keys.length===2));
  const paramsJson=same(args.params),reference=args.actual,timings:Array<Record<string,unknown>>=[];
  async function query(arm:'baseline'|'shadow',params=args.params){
   assert.deepEqual(await identity(c),anchor);await unchanged(c);const start=process.hrtime.bigint();
   const result=await c.query<Metadata>(arm==='baseline'?args.sql:candidateSql,params),elapsed=Number(process.hrtime.bigint()-start)/1e6;
   assert.deepEqual(await identity(c),anchor);await unchanged(c);
   return{rows:result.rows,receipt:{arm,query_wall_ms:elapsed,rows:result.rows.length,rows_sha256:sha(same(result.rows)),effective_work_mem_bytes:anchor.work_mem_bytes}};
  }
  for(const arm of ['baseline','shadow','shadow','baseline']as const){const result=await query(arm);assert.deepEqual(result.rows,args.actual);timings.push(result.receipt);}
  const prefixChecks:Array<Record<string,unknown>>=[],total=args.actual.reduce((sum,row)=>sum+BigInt(row.working_bytes),0n);
  for(const amount of ['1',(total-1n).toString(),total.toString()]){const params=[...args.params];params[8]=amount;const a=await query('baseline',params),b=await query('shadow',params);assert.deepEqual(b.rows,a.rows);prefixChecks.push({budget:amount,rows:a.rows.length,fitting:a.rows.filter(row=>row.projection!==null).length,metadata_sha256:sha(same(a.rows))});}
  const shadow=await query('shadow');assert.deepEqual(shadow.rows,args.actual);
  for(let offset=0;offset<4096;offset+=1024){
   const bounds={max_rows:1024,max_working_bytes:Number(args.params[8])};
   const a=await hydrateListeningInputProjectionV1(c,args.scope,args.actual.slice(offset,offset+1024),bounds),b=await hydrateListeningInputProjectionV1(c,args.scope,shadow.rows.slice(offset,offset+1024),bounds);
   assert.deepEqual(b,a);assert.deepEqual(b,args.expectedInputs.slice(offset,offset+1024));assert.deepEqual(await identity(c),anchor);
  }
  const plans:Record<string,unknown>={};
  for(const[arm,sql]of [['baseline',args.sql],['shadow',candidateSql]]as const){
   assert.deepEqual(await identity(c),anchor);
   const raw=(await c.query<{['QUERY PLAN']:Array<{Plan:ProjectionPlanV1;'Planning Time'?:number;'Execution Time'?:number}>}>('EXPLAIN (ANALYZE,BUFFERS,TIMING OFF,FORMAT JSON) '+sql,args.params)).rows[0]!['QUERY PLAN'][0]!;
   const plan=sanitizeProjectionLinearPlanV1(raw.Plan),hashes:Array<Record<string,unknown>>=[];assertProjectionSurveyLinearPlanV1(plan);let nodes=0;
   const visit=(node:ProjectionPlanV1)=>{nodes++;if(node['Node Type']==='Hash')hashes.push(Object.fromEntries(['Node Type','Plan Width','Actual Rows','Actual Loops','Hash Batches','Peak Memory Usage','Temp Read Blocks','Temp Written Blocks'].filter(key=>Object.hasOwn(node,key)).map(key=>[key,node[key]])));for(const child of node.Plans??[])visit(child);};visit(plan);
   assert.ok(nodes>0&&nodes<=512);assert.ok(Buffer.byteLength(same(plan))<=512*1024);
   plans[arm]={sql_sha256:sha(sql),planning_ms:raw['Planning Time']??null,execution_ms:raw['Execution Time']??null,plan_sha256:sha(same(plan)),nodes,hashes,plan};assert.deepEqual(await identity(c),anchor);
  }
  assert.ok(Buffer.byteLength(same(plans))<=512*1024,'combined plans cap, never truncate');
  assert.equal(args.actual,reference);assert.equal(same(args.params),paramsJson);await unchanged(c);
  const baselineMean=(Number(timings[0]!.query_wall_ms)+Number(timings[3]!.query_wall_ms))/2,shadowMean=(Number(timings[1]!.query_wall_ms)+Number(timings[2]!.query_wall_ms))/2;
  assert.ok(active);
  const receipt={contract:'r16-survey-wire-width-Q13-test-only-ABBA-v1',experimental:true,product_adopted:false,
   product_source_sha256:PRODUCT_SHA,original_wire_source_sha256:wirePopulationSourceShaV1,baseline_sql_sha256:SURVEY_SQL_SHA,candidate_sql_sha256:sha(candidateSql),
   helper_sha256:sha(await readFile(new URL('./signal-listening-wire-width.experimental.test-support.ts',import.meta.url),'utf8')),
   shadow:active.setup,effective_settings:anchor,params:args.params,params_sha256:sha(paramsJson),bind_count:9,selected_id_count:4096,
   metadata_sha256:sha(same(args.actual)),output_count:4096,question_counts:[2],actual_rows_reference_preserved:true,timings,prefixChecks,plans,
   observed:{baseline_query_mean_ms:baselineMean,candidate_query_mean_ms:shadowMean,candidate_over_baseline:baselineMean>0?shadowMean/baselineMean:null},
   equal:true,work_mem_modified:false,settings_preserved:true,original_functions_modified:false,connection_uncertainty:false,
   nested_function_plan_scope:'Direct EXPLAIN may expose only Function Scan. Missing inner Hash Batches/Peak Memory Usage are UNKNOWN, not inferred.',
   timing_scope:'Query wall excludes diagnostic catalogue/settings controls; not pipeline throughput. Inclusive parent/child counters are not additive.',
   capacity_claim:false,gain_claim:false,H1_accepted:false};
  assert.ok(Buffer.byteLength(same(receipt))<=1024*1024);return receipt;
 }catch(error){mark(c);throw error;}
}
