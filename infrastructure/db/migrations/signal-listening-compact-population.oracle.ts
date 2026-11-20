import {sanitizeProjectionLinearPlanV1} from './signal-listening-projection-linear-joins.oracle';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {PoolClient} from 'pg';
import type {LabelingDatabaseV1} from '../signal-mention-facets';
export const compactRawNameV1='signal_listening_compact_population_roots_v1';
export const compactWrapperNameV1='signal_listening_compact_population_v1';
export const compactEffectiveNameV1='signal_listening_effective_compact_population_roots_v1';
export const compactReaderCallV1="signal_listening_compact_population_v1($1::uuid,$2::uuid,$3::uuid,$4::text)";
export const compactShaV1=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export const compactFullStreamMigrationV1='0338_signal_listening_compact_full_stream.sql';
export const compactFullStreamSourceShaV1='d709e7d0e8b4d742f476a799e434086b2af89ac985fdf9b5df1c187d3fb51fe9';
export const compactFullStreamProsrcShaV1='91192c5bf9d19e8b25ee745728236cdddba191255e93515964e11a4b714f4b6b';
/** Only the FULL selected_items materialization changes;0335 remains immutable. */
export function compactFullStreamSourceV1(previous:string,current:string){
 assert.equal(compactShaV1(previous),'4bae6e5d735cb1eec8d9395aa7578bc3fde6df20a347e2abf67445c8ff16ebdd');
 assert.equal(compactShaV1(current),compactFullStreamSourceShaV1);
 const oldRaw=previous.split('-- compact_raw_begin\n')[1]!.split('-- compact_raw_end\n')[0]!;
 assert.equal(compactShaV1(oldRaw),'8b3bcdeabc9c64f48fb626964a664c930fde262cbfffd22c9d9b27174b706dae');
 const declaration='CREATE FUNCTION '+compactRawNameV1+'(',replacement='CREATE OR REPLACE FUNCTION '+compactRawNameV1+'(';
 const before='selected_items AS MATERIALIZED(',after='selected_items AS NOT MATERIALIZED(';
 assert.equal(oldRaw.split(declaration).length,2);assert.equal(oldRaw.split(before).length,3);
 assert.equal(oldRaw.split('$population$')[1]!.split(before).length,2);
 const expected=oldRaw.replace(declaration,replacement).replace(before,after);assert.equal(current,expected,'only the first FULL materialization token and OR REPLACE are registered');
 assert.equal(current.split(after).length,2);assert.equal(current.split('$bounded$')[1],oldRaw.split('$bounded$')[1],'bounded SQL stays byte-identical');
 assert.equal(current.replace(replacement,declaration).replace(after,before),oldRaw,'closed inverse restores the complete0335 raw source');
 const oldBody=oldRaw.split('AS $function$')[1]!.split('$function$;')[0]!,body=current.split('AS $function$')[1]!.split('$function$;')[0]!;
 assert.equal(compactShaV1(oldBody),'195201b95ec8863e80d81d69ff7a87ce979e66e5c810f81a1ef0dee24bad91ee');assert.equal(compactShaV1(body),compactFullStreamProsrcShaV1);
 return{oldRaw,nextRaw:current,oldBody,body};
}
async function fullStreamSourcesV1(){const [old,next]=await Promise.all(['0335_signal_listening_compact_population.sql',compactFullStreamMigrationV1].map(name=>readFile(new URL('./'+name,import.meta.url),'utf8')));return compactFullStreamSourceV1(old!,next!);}
const rawRewritesV1=[
 [
  "-- The existing base_* barriers now select ALL configured raw answer digests,\n-- once per statement, for the same eligible roots, workspace and entity context.\n-- The materialized match/post-filter retains only exact current input identities.\n-- Voice/promotion still consume only their own digests; the final lookup reuses\n-- the full exact cache set. Cache PK has all five keys, with no configuration ID.\n-- Every surviving answer matches prepared x qs, so FULL adds no unmatched right\n-- row and equals LEFT. Question digests need not be unique: ANY does not expand\n-- the slice, while the final join preserves one result per question key, including\n-- different keys sharing a digest. Empty questions/missing answers retain NULLs.\n-- Raw fourteen fields, human/manual overlays, scope, rights and dispatch are exact.\n",
  "-- Compact native population: preserve0333 authority and fresh full input SHA.\n-- Width is reduced before the root/question result boundary; historical APIs stay unchanged.\n-- Base wildcards/platform reads retain the original invoker column ACL checks.\n-- Full text stops after fresh hashing in items; question payloads stay once in qs.\n",
  1
 ],
 [
  "CREATE OR REPLACE FUNCTION signal_listening_population_roots_v1(",
  "CREATE FUNCTION signal_listening_compact_population_roots_v1(",
  1
 ],
 [
  "RETURNS TABLE(root_id uuid,input_digest text,body text,published_at timestamptz,platform text,\n question_key text,question_digest text,definition jsonb,wire jsonb,candidate boolean,scope_state text,\n answer jsonb,cache_call_id uuid,scope_basis text)",
  "RETURNS TABLE(root_id uuid,input_digest text,published_at timestamptz,question_key text,question_digest text,\n body_chars integer,wire_chars integer,has_topic_source boolean,domain text,candidate boolean,scope_state text,answer jsonb)",
  1
 ],
 [
  "LANGUAGE plpgsql STABLE SET search_path=",
  "LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=",
  1
 ],
 [
  "qs AS MATERIALIZED(SELECT q.* FROM signal_listening_questions q JOIN config c ON c.id=q.configuration_id),",
  "qs AS MATERIALIZED(SELECT question.*,\n  question.definition->>'scope' question_scope,question.definition->>'topic_source' topic_source,\n  question.definition ? 'topic_source' has_topic_source,question.definition->>'domain' domain,length(question.wire::text) wire_chars\n  FROM signal_listening_questions question JOIN config c ON c.id=question.configuration_id),",
  2
 ],
 [
  "items AS MATERIALIZED(SELECT i.*,/* flat_input_begin */",
  "items AS MATERIALIZED(SELECT i.root_id,i.chunk_sha256,i.candidates,length(i.text) body_chars,/* flat_input_begin */",
  2
 ],
 [
  "prepared AS MATERIALIZED(SELECT i.*,v.answer voice,p.answer promotion,\n   /* flat_basis_begin */('sha256:'||encode(sha256(convert_to('{\"promotion\":'||COALESCE(to_jsonb(p.call_id)::text,'null')||',\"voice\":'||COALESCE(to_jsonb(v.call_id)::text,'null')||'}','UTF8')),'hex'))/* flat_basis_end */ basis,\n",
  "prepared AS MATERIALIZED(SELECT i.*,v.answer voice,p.answer promotion,\n",
  2
 ],
 [
  "SELECT i.root_id,i.listening_input_digest,i.text,i.published_at,i.platform,q.question_key,q.question_digest,q.definition,q.wire,",
  "SELECT i.root_id,i.listening_input_digest,i.published_at,q.question_key,q.question_digest,i.body_chars,q.wire_chars,q.has_topic_source,q.domain,",
  2
 ],
 [
  "COALESCE(CASE WHEN manual.id IS NOT NULL THEN jsonb_build_object('type','noul','noul',CASE WHEN manual.belongs THEN 1.0 ELSE 0.0 END) END,a.answer),CASE WHEN manual.id IS NULL THEN a.call_id END,CASE WHEN q.definition->>'scope'='consumer_category' THEN i.basis ELSE NULL END",
  "COALESCE(CASE WHEN manual.id IS NOT NULL THEN jsonb_build_object('type','noul','noul',CASE WHEN manual.belongs THEN 1.0 ELSE 0.0 END) END,a.answer)",
  2
 ],
 [
  "qs.definition->>'scope'",
  "qs.question_scope",
  4
 ],
 [
  "qs.definition->>'topic_source'",
  "qs.topic_source",
  6
 ],
 [
  "ranked.definition->>'topic_source'",
  "ranked.topic_source",
  2
 ],
 [
  "q.definition->>'topic_source'",
  "q.topic_source",
  2
 ],
 [
  "q.definition->>'scope'",
  "q.question_scope",
  2
 ],
 [
  "BEGIN\n IF roots IS NULL THEN",
  "BEGIN\n IF pg_catalog.has_function_privilege(current_user,'public.signal_listening_population_roots_v1(uuid,uuid,uuid,text,uuid[],text)'::pg_catalog.regprocedure,'EXECUTE') IS DISTINCT FROM true THEN\n  RAISE EXCEPTION 'permission denied for function signal_listening_population_roots_v1' USING ERRCODE='42501';\n END IF;\n IF roots IS NULL THEN",
  1
 ]
] as const;
const effectiveRewritesV1=[
 [
  "-- Read the current human revision once per statement, in the same STABLE snapshot.\n-- Membership precedence, raw classifier answers and all authorization bindings\n-- remain unchanged. This materialization is never shared across statements.\n",
  "-- Effective compact projection preserves0316 human revision and precedence.\n",
  1
 ],
 [
  "CREATE OR REPLACE FUNCTION signal_listening_effective_population_roots_v2(",
  "CREATE FUNCTION signal_listening_effective_compact_population_roots_v1(",
  1
 ],
 [
  "RETURNS TABLE(root_id uuid,input_digest text,body text,published_at timestamptz,platform text,\n question_key text,question_digest text,definition jsonb,wire jsonb,candidate boolean,scope_state text,\n answer jsonb,cache_call_id uuid,scope_basis text,effective_belongs boolean,human_belongs boolean,\n human_decision_id uuid,legacy_manual_id uuid,label_source text,human_edit_revision bigint)",
  "RETURNS TABLE(root_id uuid,published_at timestamptz,question_key text,has_topic_source boolean,domain text,\n candidate boolean,scope_state text,answer jsonb,human_belongs boolean,effective_belongs boolean)",
  1
 ],
 [
  "LANGUAGE sql STABLE SET search_path=",
  "LANGUAGE sql STABLE SECURITY INVOKER SET search_path=",
  1
 ],
 [
  "signal_listening_population_roots_v1(w,cid,mid,ctx,roots,purpose)",
  "signal_listening_compact_population_roots_v1(w,cid,mid,ctx,roots,purpose)",
  1
 ],
 [
  "SELECT p.root_id,p.input_digest,p.body,p.published_at,p.platform,p.question_key,p.question_digest,p.definition,p.wire,",
  "SELECT p.root_id,p.published_at,p.question_key,p.has_topic_source,p.domain,",
  1
 ],
 [
  "  CASE WHEN revision.n>0 THEN raw.call_id ELSE p.cache_call_id END,p.scope_basis,\n  CASE WHEN p.definition ? 'topic_source' THEN COALESCE(decision.belongs,legacy.belongs,(raw.answer->>'noul')::double precision>=0.7) END,\n  COALESCE(decision.belongs,legacy.belongs),decision.id,legacy.id,\n  CASE WHEN decision.id IS NOT NULL THEN 'human' WHEN legacy.id IS NOT NULL THEN 'legacy_human' WHEN raw.call_id IS NOT NULL THEN 'jev' ELSE 'pending' END,\n  decision.revision\n",
  "  COALESCE(decision.belongs,legacy.belongs),\n  CASE WHEN p.has_topic_source THEN COALESCE(decision.belongs,legacy.belongs,(raw.answer->>'noul')::double precision>=0.7) END\n",
  1
 ],
 [
  " WITH revision AS MATERIALIZED(SELECT signal_listening_human_revision_v1(cid) n),\n population AS MATERIALIZED(SELECT * FROM signal_listening_compact_population_roots_v1(w,cid,mid,ctx,roots,purpose))",
  " WITH execute_gate AS MATERIALIZED(\n  SELECT CASE WHEN pg_catalog.has_function_privilege(current_user,'public.signal_listening_effective_population_roots_v2(uuid,uuid,uuid,text,uuid[],text)'::pg_catalog.regprocedure,'EXECUTE') THEN true\n   ELSE(SELECT false FROM public.signal_listening_effective_population_roots_v2(NULL::uuid,NULL::uuid,NULL::uuid,NULL::text,NULL::uuid[],purpose) denied LIMIT 1) END allowed),\n revision AS MATERIALIZED(SELECT signal_listening_human_revision_v1(CASE WHEN(SELECT allowed FROM execute_gate) THEN cid END) n),\n population AS MATERIALIZED(SELECT * FROM signal_listening_compact_population_roots_v1(CASE WHEN(SELECT allowed FROM execute_gate) THEN w END,cid,mid,ctx,roots,purpose))",
  1
 ]
] as const;
export const compactBaselineListeningShaV1='bae111e2b80e75b291bd245d80442ded5092489c6d105db52b34e19f8dc7dc6c';
const oldRawShaV1='45666196078c2c0d130298863569b1a1a49c281bbcafe6a440c6cc1bbd42eb6f',oldEffectiveShaV1='84896d5d6938fac379861f06407b863e4ea0fd4462a699e79de5c86f5047a301';
const oldWrapperSourceShaV1='4d85c4c9619e3912edb95027e092b386e5760dc13e2994b0c76d77d797110dca';
const compactWrapperSourceShaV1='902d36ec52b9b2be9bb3853a47e2080f35edf74d5445203e467abcf4c458acea';
const occurrences=(text:string,part:string)=>text.split(part).length-1;
export function invertCompactListeningRunsV1(source:string){
 assert.equal(occurrences(source,compactReaderCallV1),2,'only pending and request stats change population');
 assert.equal(occurrences(source,'sum(body_chars+wire_chars+512)'),1,'one request stats formula');
 return source.split(compactReaderCallV1).join('${population}').replace('sum(body_chars+wire_chars+512)','sum(length(body)+length(wire::text)+512)');
}
function inverseV1(candidate:string,rewrites:ReadonlyArray<readonly[string,string,number]>){
 let value=candidate;for(const[old,next,count]of [...rewrites].reverse()){assert.ok(next.length);assert.equal(occurrences(value,next),count,'closed inverse: '+next.slice(0,80));value=value.split(next).join(old);}return value;
}
export function assertCompactProjectionSourceV1(oldRaw:string,oldEffective:string,migration:string){
 assert.equal(compactShaV1(oldRaw),oldRawShaV1);assert.equal(compactShaV1(oldEffective),oldEffectiveShaV1);
 const raw=migration.split('-- compact_raw_begin\n')[1]?.split('-- compact_raw_end\n')[0],effective=migration.split('-- compact_effective_begin\n')[1]?.split('-- compact_effective_end\n')[0],wrapper=migration.split('-- compact_wrapper_begin\n')[1]?.split('-- compact_wrapper_end\n')[0],acl=migration.split('-- compact_acl_begin\n')[1]?.split('-- compact_acl_end\n')[0];
 assert.ok(raw&&effective&&wrapper&&acl);assert.equal(compactShaV1(wrapper),compactWrapperSourceShaV1);assert.equal(migration,'-- compact_raw_begin\n'+raw+'-- compact_raw_end\n\n-- compact_effective_begin\n'+effective+'-- compact_effective_end\n\n-- compact_wrapper_begin\n'+wrapper+'-- compact_wrapper_end\n\n-- compact_acl_begin\n'+acl+'-- compact_acl_end\n','no unregistered statements outside the four closed blocks');
 assert.equal(inverseV1(raw,rawRewritesV1),oldRaw,'every0333 predicate survives exact inversion');assert.equal(inverseV1(effective,effectiveRewritesV1),oldEffective,'every0316 human predicate survives exact inversion');return{raw,effective,wrapper,acl};
}
export const compactOldRawProjectionV1="root_id,input_digest,published_at,question_key,question_digest,length(body) body_chars,length(wire::text) wire_chars,(definition ? 'topic_source') has_topic_source,definition->>'domain' domain,candidate,scope_state,answer";
export const compactOldEffectiveProjectionV1="root_id,published_at,question_key,(definition ? 'topic_source') has_topic_source,definition->>'domain' domain,candidate,scope_state,answer,human_belongs,effective_belongs";

const oldRawNameV1='signal_listening_population_roots_v1',oldEffectiveNameV1='signal_listening_effective_population_roots_v2',oldWrapperNameV1='signal_listening_population_v1';
const functionNamesV1=[oldRawNameV1,oldEffectiveNameV1,oldWrapperNameV1,compactRawNameV1,compactEffectiveNameV1,compactWrapperNameV1];
const catalogSqlV1=`SELECT p.oid::text,p.proname,p.prosrc,p.proowner::text,p.proacl::text,p.provolatile,p.prosecdef,p.proconfig,p.proisstrict,p.proparallel,p.proleakproof,p.prokind,p.pronargs,p.proargtypes::text,p.pronargdefaults,pg_catalog.pg_get_expr(p.proargdefaults,0) default_arguments,p.prorettype::text,p.proallargtypes::text,p.proargmodes,p.proargnames,p.proretset,p.procost,p.prorows,p.prosupport::text,l.lanname
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE n.nspname='public' AND p.proname=ANY($1::text[]) ORDER BY p.proname`;
const aclSqlV1=`SELECT p.proname,a.grantor::text,a.grantee::text,a.privilege_type,a.is_grantable FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE n.nspname='public' AND p.proname=ANY($1::text[]) ORDER BY p.proname,a.grantor,a.grantee,a.privilege_type,a.is_grantable`;
async function catalogV1(c:PoolClient){return{functions:(await c.query(catalogSqlV1,[functionNamesV1])).rows,acl:(await c.query(aclSqlV1,[functionNamesV1])).rows};}
export async function assertCompactCatalogV1(c:PoolClient){
 const snapshot=await catalogV1(c);assert.equal(snapshot.functions.length,6);
 const current=await fullStreamSourcesV1();assert.equal(snapshot.functions.find(r=>r.proname===compactRawNameV1)!.prosrc,current.body,'current Native requires0338, never an easier0335 default');
 for(const[old,next]of [[oldRawNameV1,compactRawNameV1],[oldEffectiveNameV1,compactEffectiveNameV1],[oldWrapperNameV1,compactWrapperNameV1]]as const){
  const a=snapshot.functions.find(r=>r.proname===old)!,b=snapshot.functions.find(r=>r.proname===next)!;assert.ok(a&&b);
  for(const field of ['proowner','provolatile','prosecdef','proconfig','proisstrict','proparallel','proleakproof','prokind','pronargs','proargtypes','pronargdefaults','default_arguments','proretset','procost','prorows','prosupport','lanname'])assert.deepEqual(b[field],a[field],field+' native compact attribute');
  assert.equal(b.prosecdef,false);assert.equal(b.provolatile,'s');
  const acl=(name:string)=>snapshot.acl.filter(r=>r.proname===name).map(r=>({grantor:r.grantor,grantee:r.grantee,privilege_type:r.privilege_type,is_grantable:r.is_grantable}));assert.deepEqual(acl(next),acl(old),'EXECUTE, owner grantor and grant option are identical; no new principals');
 }
 return snapshot;
}
async function installCompactReferenceV1(c:PoolClient){
 assert.equal((await c.query("SELECT current_setting('transaction_read_only') value")).rows[0].value,'off','install aliases before RR/RO');
 const [raw,effective,migration]=await Promise.all(['0333_signal_listening_bounded_mentions.sql','0316_signal_listening_human_revision_plan.sql','0335_signal_listening_compact_population.sql'].map(name=>readFile(new URL('./'+name,import.meta.url),'utf8')));
 const parts=assertCompactProjectionSourceV1(raw!,effective!,migration!),stream=await fullStreamSourcesV1();const historicalWrapper=await readFile(new URL('./0298_signal_listening_bounded_validation.sql',import.meta.url),'utf8');const wrapperStart=historicalWrapper.indexOf('CREATE OR REPLACE FUNCTION '+oldWrapperNameV1+'('),wrapperEnd=historicalWrapper.indexOf('CREATE OR REPLACE FUNCTION signal_listening_call_guard_v1(',wrapperStart);assert.ok(wrapperStart>=0&&wrapperEnd>wrapperStart);const originalWrapper=historicalWrapper.slice(wrapperStart,wrapperEnd);assert.equal(compactShaV1(originalWrapper),oldWrapperSourceShaV1);const before=await assertCompactCatalogV1(c);
 for(const[name,source,delimiter]of [[oldRawNameV1,raw!,'$function$'],[oldEffectiveNameV1,effective!,'$$'],[compactRawNameV1,stream.nextRaw,'$function$'],[compactEffectiveNameV1,parts.effective,'$$'],[oldWrapperNameV1,originalWrapper,'$$'],[compactWrapperNameV1,parts.wrapper,'$compact_wrapper$']]as const)assert.equal(before.functions.find(r=>r.proname===name)!.prosrc,source.split('AS '+delimiter)[1]!.split(delimiter+';')[0],'native body matches pinned source '+name);
 const found=(await c.query("SELECT to_regprocedure('pg_temp.r16_compact_raw_reference(uuid,uuid,uuid,text,uuid[],text)') present")).rows[0].present;
 if(!found){
  await c.query('CREATE TEMP TABLE r16_compact_alias_lifetime(probe boolean)');
  await c.query(raw!.replace('CREATE OR REPLACE FUNCTION '+oldRawNameV1,'CREATE FUNCTION pg_temp.r16_compact_raw_reference')+'\nREVOKE ALL ON FUNCTION pg_temp.r16_compact_raw_reference(uuid,uuid,uuid,text,uuid[],text) FROM PUBLIC;');
  await c.query(effective!.replace('CREATE OR REPLACE FUNCTION '+oldEffectiveNameV1,'CREATE FUNCTION pg_temp.r16_compact_effective_reference').replace(oldRawNameV1+'(w,cid,mid,ctx,roots,purpose)','pg_temp.r16_compact_raw_reference(w,cid,mid,ctx,roots,purpose)')+'\nREVOKE ALL ON FUNCTION pg_temp.r16_compact_effective_reference(uuid,uuid,uuid,text,uuid[],text) FROM PUBLIC;');
  await c.query(parts.raw.replace('CREATE FUNCTION '+compactRawNameV1,'CREATE FUNCTION pg_temp.r16_compact_full_raw_reference')+'\nREVOKE ALL ON FUNCTION pg_temp.r16_compact_full_raw_reference(uuid,uuid,uuid,text,uuid[],text) FROM PUBLIC;');
  await c.query(parts.wrapper.replace('CREATE FUNCTION '+compactWrapperNameV1,'CREATE FUNCTION pg_temp.r16_compact_full_reference').replace('FROM '+compactRawNameV1+'(','FROM pg_temp.r16_compact_full_raw_reference(')+'\nREVOKE ALL ON FUNCTION pg_temp.r16_compact_full_reference(uuid,uuid,uuid,text,text) FROM PUBLIC;');
 }
 for(const [signature,expectedBody]of [
  ['pg_temp.r16_compact_full_raw_reference(uuid,uuid,uuid,text,uuid[],text)',stream.oldBody],
  ['pg_temp.r16_compact_full_reference(uuid,uuid,uuid,text,text)',parts.wrapper.replace('FROM '+compactRawNameV1+'(','FROM pg_temp.r16_compact_full_raw_reference(').split('AS $compact_wrapper$')[1]!.split('$compact_wrapper$;')[0]!],
 ]as const){
  const rows=(await c.query("SELECT prosrc,provolatile,prosecdef,proconfig FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure($1)",[signature])).rows;assert.equal(rows.length,1,'both pinned0335 profile aliases must exist before RR/RO');
  assert.equal(rows[0].prosrc,expectedBody);assert.equal(rows[0].provolatile,'s');assert.equal(rows[0].prosecdef,false);assert.deepEqual(rows[0].proconfig,['search_path=public, extensions, pg_temp']);
 }
 assert.deepEqual(await catalogV1(c),before,'installing private aliases changes no public OID/owner/ACL/body/attributes');return before;
}
export async function assertCompactFullReplacementV1(database:LabelingDatabaseV1){
 const sources=await fullStreamSourcesV1(),c=await database.connect();let inTx=false,primary=false,destroy=false;
 try{const own=(await c.query("SELECT current_database() name,current_setting('server_version_num')::int version,(SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user) super")).rows[0];
  assert.match(own.name,/^noisia_mfp_recovery_[a-f0-9]{32}$/u);assert.ok(own.version>=170000&&own.version<180000);assert.equal(own.super,true,'replacement proof is restricted to the existing owned CI clone');
  const before=await assertCompactCatalogV1(c);await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');inTx=true;
  await c.query(sources.oldRaw.replace('CREATE FUNCTION '+compactRawNameV1+'(','CREATE OR REPLACE FUNCTION '+compactRawNameV1+'('));
  const historical=await catalogV1(c);assert.deepEqual(historical,{...before,functions:before.functions.map(row=>row.proname===compactRawNameV1?{...row,prosrc:sources.oldBody}:row)},'OLD0335 replacement changes only prosrc: OID/owner/ACL/signature/attributes stay exact');
  await c.query(sources.nextRaw);assert.deepEqual(await assertCompactCatalogV1(c),before,'forward0338 restores the exact current catalog without new grants');
  await c.query('ROLLBACK');inTx=false;assert.deepEqual(await assertCompactCatalogV1(c),before,'all replacement probes roll back to strict0338');
 }catch(error){primary=true;throw error;}finally{try{if(inTx){await c.query('ROLLBACK');inTx=false;}}catch(error){destroy=true;if(!primary)throw error;}finally{c.release(destroy||inTx);}}
}
export async function withCompactReadOnlyV1<T>(database:LabelingDatabaseV1,fn:(c:PoolClient)=>Promise<T>):Promise<T>{
 const c=await database.connect();let inTx=false,primary=false;
 try{const before=await installCompactReferenceV1(c);await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');inTx=true;
  assert.deepEqual((await c.query("SELECT current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') readonly")).rows[0],{isolation:'repeatable read',readonly:'on'});
  const value=await fn(c);assert.deepEqual(await catalogV1(c),before,'original and compact catalog unchanged');await c.query('ROLLBACK');inTx=false;return value;
 }catch(error){primary=true;throw error;}finally{try{if(inTx)await c.query('ROLLBACK');}catch(error){if(!primary)throw error;}finally{c.release();}}
}
const wrapperParamsSqlV1='$1::uuid,$2::uuid,$3::uuid,$4::text,$5::text';
const wrapperParamsV1=(params:unknown[])=>[...params.slice(0,4),params[5]];
const paramsSqlV1='$1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid[],$6::text';
const populationPairV1=(effective=false)=>({old:`SELECT ${effective?compactOldEffectiveProjectionV1:compactOldRawProjectionV1} FROM pg_temp.r16_compact_${effective?'effective':'raw'}_reference(${paramsSqlV1})`,next:`SELECT * FROM public.${effective?compactEffectiveNameV1:compactRawNameV1}(${paramsSqlV1})`});
async function exactPairV1(c:PoolClient,old:string,next:string,params:unknown[]){
 const different=(await c.query(`WITH a AS MATERIALIZED(${old}),b AS MATERIALIZED(${next}) SELECT count(*)::int n FROM((TABLE a EXCEPT ALL TABLE b) UNION ALL(TABLE b EXCEPT ALL TABLE a)) d`,params)).rows[0].n;assert.equal(different,0,'complete projected multiset parity');
 const bytes=async(sql:string)=>(await c.query(`SELECT encode(record_send(ROW(p.*)),'hex') value FROM(${sql}) p ORDER BY root_id,question_key,encode(record_send(ROW(p.*)),'hex')`,params)).rows.map(r=>r.value as string);
 const a=await bytes(old),b=await bytes(next);assert.deepEqual(b,a,'ordered native record_send preserves every byte, NULL and duplicate');return{rows:a.length,except_all:true,record_send:true};
}
export async function compareCompactPopulationV1(c:PoolClient,params:unknown[]){assert.equal(params.length,6);const raw=populationPairV1(),effective=populationPairV1(true);const result={raw12:await exactPairV1(c,raw.old,raw.next,params),effective10:await exactPairV1(c,effective.old,effective.next,params)};if(params[4]===null)await exactPairV1(c,`SELECT ${compactOldRawProjectionV1} FROM public.${oldWrapperNameV1}(${wrapperParamsSqlV1})`,`SELECT * FROM public.${compactWrapperNameV1}(${wrapperParamsSqlV1})`,wrapperParamsV1(params));return result;}
export async function compareCompactAggregateV1(c:PoolClient,params:unknown[],kind:'quote'|'request_stats',profile=false){
 const pair={old:`SELECT ${compactOldRawProjectionV1} FROM public.${oldWrapperNameV1}(${wrapperParamsSqlV1})`,next:`SELECT * FROM public.${compactWrapperNameV1}(${wrapperParamsSqlV1})`};const values=wrapperParamsV1(params);const human="NOT signal_listening_human_decision_exists_v1($1::uuid,$2::uuid,$3::uuid,p.root_id,p.input_digest,$4::text,p.question_digest)";
 const predicate=kind==='quote'?"p.scope_state<>'excluded' AND p.answer IS NULL":`p.candidate AND p.scope_state<>'excluded' AND p.answer IS NULL AND ${human}`;
 const select=kind==='quote'?"COALESCE(sum(body_chars+wire_chars+512),0)::text bytes":"count(DISTINCT root_id)::int roots,COALESCE(sum(body_chars+wire_chars+512),0)::text chars";
 const read=(sql:string)=>`SELECT ${select} FROM(${sql}) p WHERE ${predicate}`;
 const old=(await c.query(read(pair.old),values)).rows,next=(await c.query(read(pair.next),values)).rows;assert.deepEqual(next,old,kind+' retains its own predicate, nulls, character units and exact cost input');
 if(profile){
  assert.equal(params[4],null,'profile is the existing FULL aggregate path');
  const identity=async()=>(await c.query("SELECT pg_backend_pid() pid,current_user role,pg_current_snapshot()::text snapshot,current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') readonly")).rows[0];
  const anchor=await identity();assert.equal(anchor.isolation,'repeatable read');assert.equal(anchor.readonly,'on');
  const queries={old:read(`SELECT * FROM pg_temp.r16_compact_full_reference(${wrapperParamsSqlV1})`),next:read(pair.next)};
  const observations=[];
  for(const arm of ['old','next','next','old']as const){
   const begin=process.hrtime.bigint(),rows=(await c.query(queries[arm],values)).rows,wall_ms=Number(process.hrtime.bigint()-begin)/1e6;
   assert.deepEqual(rows,next,'complete OLD0335/NEW0338 aggregate equality in one RR snapshot');assert.deepEqual(await identity(),anchor);
   observations.push({arm,wall_ms,result_sha256:compactShaV1(JSON.stringify(rows))});
  }
  const plans:Record<string,unknown>={};for(const arm of ['old','next']as const){
   const plan=(await c.query('EXPLAIN (ANALYZE,BUFFERS,TIMING OFF,FORMAT JSON) '+queries[arm],values)).rows[0]['QUERY PLAN'][0];
   plans[arm]={planning_ms:plan['Planning Time']??null,execution_ms:plan['Execution Time']??null,plan:sanitizeProjectionLinearPlanV1(plan.Plan)};assert.deepEqual(await identity(),anchor);
  }
  console.log('# compact FULL aggregate ABBA '+JSON.stringify({contract:'r16-compact-full-aggregate-pair-v1',kind,order:'OLD-NEW-NEW-OLD',old_source_sha256:'8b3bcdeabc9c64f48fb626964a664c930fde262cbfffd22c9d9b27174b706dae',new_source_sha256:compactFullStreamSourceShaV1,params_sha256:compactShaV1(JSON.stringify(values)),snapshot_sha256:compactShaV1(String(anchor.snapshot)),observations,plans,internal_selected_items_plan:'NOT_COLLECTED: PLpgSQL exterior remains opaque',cpu_claim:false,gain_claim:false,h1_accepted:false}));
 }
 return next[0];
}
export async function compareCompactDeniedRoleV1(c:PoolClient,params:unknown[]){
 async function code(name:string,wrapper=false){await c.query('SAVEPOINT compact_denied_role');let roleApplied=false;try{await c.query('SET LOCAL ROLE anon');roleApplied=true;await c.query(`SELECT * FROM public.${name}(${wrapper?wrapperParamsSqlV1:paramsSqlV1})`,wrapper?wrapperParamsV1(params):params);return null;}catch(error){assert.equal(roleApplied,true,'Native must actually enter anon before measuring function denial');return(error as {code?:string}).code;}finally{await c.query('ROLLBACK TO SAVEPOINT compact_denied_role');await c.query('RELEASE SAVEPOINT compact_denied_role');}}
 for(const[a,b]of [[oldRawNameV1,compactRawNameV1],[oldEffectiveNameV1,compactEffectiveNameV1],[oldWrapperNameV1,compactWrapperNameV1]]as const){const wrapped=a===oldWrapperNameV1,old=await code(a,wrapped);assert.equal(old,'42501','original anonymous denial remains applicable');assert.equal(await code(b,wrapped),old,'compact may not bypass native EXECUTE/table authorization');}
}

export async function assertCompactACLNegativeV1(c:PoolClient){
 const migration=await readFile(new URL('./0335_signal_listening_compact_population.sql',import.meta.url),'utf8');const acl=migration.split('-- compact_acl_begin\n')[1]!.split('-- compact_acl_end\n')[0]!;const before=await catalogV1(c);
 const validation='SELECT a.* FROM pg_catalog.aclexplode(source_acl) a UNION ALL SELECT a.* FROM pg_catalog.aclexplode(destination_acl) a';assert.equal(occurrences(acl,validation),1);
 const variants=[
  [acl.replace("('signal_listening_population_roots_v1','signal_listening_compact_population_roots_v1','uuid,uuid,uuid,text,uuid[],text')","('signal_listening_population_roots_v1','signal_listening_population_roots_v1','uuid,uuid,uuid,text,uuid[],text')"),'listening_compact_destination_unexpected'],
  [acl.replace(validation,"SELECT source.proowner grantor,source.proowner grantee,'SELECT'::text privilege_type,false is_grantable"),'listening_compact_acl_unexpected'],
  [acl.replace('IF destination.proowner<>source.proowner THEN','source.proowner:=0;\n  IF destination.proowner<>source.proowner THEN'),'listening_compact_owner_mismatch'],
 ]as const;
 for(const[sql,guard]of variants){assert.notEqual(sql,acl);await c.query('SAVEPOINT compact_acl_rejection');try{await assert.rejects(c.query(sql!),error=>(error as {code?:string}).code==='P0001'&&(error as Error).message===guard,guard);}finally{await c.query('ROLLBACK TO SAVEPOINT compact_acl_rejection');await c.query('RELEASE SAVEPOINT compact_acl_rejection');}}
 assert.deepEqual(await catalogV1(c),before,'negative ACL cases reject before touching any public grant or owner');
}

export function extractCompactExecuteReaderSqlV1(runs:string,preparation:string,serving:string){
 const extract=(source:string,pattern:RegExp)=>{const all=[...source.matchAll(pattern)];assert.equal(all.length,1);const sql=all[0]?.[1];assert.ok(sql);return sql;};
 const unanswered=extract(runs,/const unansweredScope=\x60([\s\S]*?)\x60;/gu);
 const pending=extract(runs,/c\.query<\{pending:number;available:boolean\}>\(\x60([\s\S]*?)\x60,/gu).replace('${unansweredScope}',unanswered);
 const quote=extract(preparation,/c\.query<\{bytes:string\}>\(\x60([\s\S]*?)\x60,/gu),stats=extract(runs,/c\.query<\{roots:number;chars:string\}>\(\x60([\s\S]*?)\x60,/gu);
 const metrics=extract(serving,/>\(\x60(WITH requested AS MATERIALIZED\([\s\S]*?)\x60,/gu);
 return{pending,quote,stats,metrics};
}

/** Real non-owner EXECUTE regression, only inside the existing owned CI fixture.
 * ACL perturbations need RR READ WRITE; the entire role/grant/revoke transaction
 * rolls back. The population and financial oracles above remain RR READ ONLY. */
export async function assertCompactExecuteCompositionV1(database:LabelingDatabaseV1,params:unknown[]){
 assert.equal(params.length,6);const c=await database.connect();let inTx=false,primary=false,destroy=false;
 const role='r16_compact_acl_'+randomUUID().replaceAll('-',''),quotedRole='"'+role+'"';assert.match(role,/^r16_compact_acl_[a-f0-9]{32}$/u);
 const six='uuid,uuid,uuid,text,uuid[],text',five='uuid,uuid,uuid,text,text';
 const pairs=[{kind:'raw',old:oldRawNameV1,next:compactRawNameV1,signature:six,binds:paramsSqlV1,values:params},
  {kind:'effective',old:oldEffectiveNameV1,next:compactEffectiveNameV1,signature:six,binds:paramsSqlV1,values:params},
  {kind:'wrapper',old:oldWrapperNameV1,next:compactWrapperNameV1,signature:five,binds:wrapperParamsSqlV1,values:wrapperParamsV1(params)}]as const;
 const helpers=['signal_mass_labeling_lexical_text_v1(text)','signal_mass_labeling_category_pattern_v1(text[])','signal_mass_labeling_category_pattern_matches_v1(text,text)','signal_mass_labeling_r13_hashtags_v1(text)',
  'signal_listening_discovery_candidates_v1(uuid,uuid,uuid,uuid,uuid)','signal_listening_human_revision_v1(uuid)','signal_listening_human_decision_exists_v1(uuid,uuid,uuid,uuid,text,text,text)'];
 let before:Awaited<ReturnType<typeof catalogV1>>|undefined;
 const prepared=new Map<string,string>(),preparedUses=new Map<string,number>();
 const columnCatalog=async()=>(await c.query(`SELECT c.oid::text,c.relname,c.relacl::text,
  (SELECT COALESCE(jsonb_agg(jsonb_build_array(a.attnum,a.attacl::text) ORDER BY a.attnum),'[]'::jsonb) FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL) columns
  FROM pg_catalog.pg_class c WHERE c.oid=ANY(ARRAY['public.signal_mass_labeling_items'::regclass,'public.mentions'::regclass]) ORDER BY c.oid`)).rows;
 let columnsBefore:Awaited<ReturnType<typeof columnCatalog>>|undefined;
 type Probe={rows?:Array<Record<string,unknown>>;code?:string;message?:string};
 const probe=async(sql:string,values:unknown[]):Promise<Probe>=>{
  await c.query('SAVEPOINT compact_execute_probe');try{await c.query('SET LOCAL ROLE '+quotedRole);
   let name=prepared.get(sql);if(!name){name=role+'_p'+prepared.size;prepared.set(sql,name);}preparedUses.set(sql,(preparedUses.get(sql)??0)+1);
   return{rows:(await c.query<Record<string,unknown>>({name,text:sql,values})).rows};}
  catch(error){return{code:(error as {code?:string}).code,message:(error as Error).message};}
  finally{await c.query('ROLLBACK TO SAVEPOINT compact_execute_probe');await c.query('RELEASE SAVEPOINT compact_execute_probe');}
 };
 const successful=async(sql:string,values:unknown[])=>{const result=await probe(sql,values);assert.equal(result.code,undefined,result.message);assert.ok(Array.isArray(result.rows),'a setup/transport denial cannot count as successful execution');return result.rows;};
 const denied=async(sql:string,values:unknown[],gate:string)=>{const result=await probe(sql,values);assert.equal(result.code,'42501','expected the specific historical EXECUTE denial');assert.ok(result.message?.includes(gate),'denial must name '+gate+', not another helper/table/RLS gate');};
 const count=(name:string,binds:string)=>`SELECT count(*)::int n FROM public.${name}(${binds})`;
 const positive=async(pair:typeof pairs[number])=>{const a=await successful(count(pair.old,pair.binds),pair.values),b=await successful(count(pair.next,pair.binds),pair.values);assert.deepEqual(b,a);const n=a[0]?.n;assert.ok(typeof n==='number'&&Number.isInteger(n)&&n>0,'real rows must establish SELECT/RLS/helper access before revocation');};
 try{
  const own=(await c.query("SELECT current_database() name,current_user owner,current_setting('server_version_num')::int version,(SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user) super")).rows[0];
  assert.match(own.name,/^noisia_mfp_recovery_[a-f0-9]{32}$/u);assert.ok(own.version>=170000&&own.version<180000);assert.equal(own.super,true,'role-creation test is restricted to the existing owned CI admin');before=await assertCompactCatalogV1(c);columnsBefore=await columnCatalog();
  const [runs,preparation,serving]=await Promise.all(['signal-listening-runs.ts','signal-listening-preparation.ts','signal-listening-serving.ts'].map(file=>readFile(new URL('../'+file,import.meta.url),'utf8')));
  const {pending,quote,stats,metrics}=extractCompactExecuteReaderSqlV1(runs!,preparation!,serving!);
  const values=params.slice(0,4),metricValues=[...values,['voice'],null,null,'UTC','day',null,false],pendingValues=[...values,randomUUID()];
  const oldReader=(sql:string)=>sql.replace(compactWrapperNameV1,oldWrapperNameV1).replace('p.body_chars+p.wire_chars','length(p.body)+length(p.wire::text)').replace('body_chars+wire_chars','length(body)+length(wire::text)');
  const readers=[{sql:quote,values},{sql:stats,values},{sql:pending,values:pendingValues}];for(const read of readers)assert.ok(!read.sql.includes('${'),'probe must execute the exact fully bound reader query');
  const oldMetrics=metrics.replace(compactEffectiveNameV1,oldEffectiveNameV1).replace('SELECT root_id,question_key,has_topic_source,',"SELECT root_id,question_key,(definition ? 'topic_source') has_topic_source,").replace("COALESCE(domain,'category')","COALESCE(definition->>'domain','category')");
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');inTx=true;
  await c.query('CREATE ROLE '+quotedRole+' NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS');
  // Only this uncommitted, non-login probe role receives sufficient read access.
  // BYPASSRLS isolates EXECUTE composition from unrelated RLS zero/denial.
  for(const schema of(await c.query("SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname IN('public','extensions')")).rows){assert.ok(['public','extensions'].includes(schema.nspname));await c.query('GRANT USAGE ON SCHEMA "'+schema.nspname+'" TO '+quotedRole);}
  await c.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO '+quotedRole);
  for(const pair of pairs)for(const name of[pair.old,pair.next])await c.query('GRANT EXECUTE ON FUNCTION public.'+name+'('+pair.signature+') TO '+quotedRole);
  for(const signature of helpers)await c.query('GRANT EXECUTE ON FUNCTION public.'+signature+' TO '+quotedRole);
  const identity=(await successful("SELECT current_user name,(SELECT oid::text FROM pg_catalog.pg_roles WHERE rolname=current_user) oid,(SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user) super,(SELECT rolbypassrls FROM pg_catalog.pg_roles WHERE rolname=current_user) bypass",[]))[0]!;
  assert.equal(identity.name,role);assert.equal(identity.super,false);assert.equal(identity.bypass,true);assert.ok(before.functions.every(f=>f.proowner!==identity.oid),'probe must own none of the six functions');
  for(const pair of pairs)await positive(pair);
  for(const read of readers)assert.deepEqual(await successful(read.sql,read.values),await successful(oldReader(read.sql),read.values),'both real aggregate readers execute before permission perturbation');
  const metricBefore=await successful(metrics,metricValues),oldMetricBefore=await successful(oldMetrics,metricValues);assert.equal(metricBefore.length,1,'the real metrics SELECT must produce its requested question');assert.deepEqual(metricBefore,oldMetricBefore);
  // Drop table SELECT, then grant every column except one historical wildcard
  // dependency. No inherited table grant may disguise the missing column.
  for(const [table,column]of [['signal_mass_labeling_items','ordinal'],['mentions','platform'],['mentions','published_at']]as const){
   for(const pair of pairs)await positive(pair);
   await c.query('SAVEPOINT compact_column_phase');try{
    await c.query('REVOKE SELECT ON TABLE public.'+table+' FROM PUBLIC,'+quotedRole);
    assert.equal((await c.query("SELECT pg_catalog.has_table_privilege($1::name,$2::regclass,'SELECT') value",[role,'public.'+table])).rows[0].value,false);
    const columns=(await c.query("SELECT attname FROM pg_catalog.pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum",['public.'+table])).rows.map(row=>String(row.attname));assert.ok(columns.includes(column));
    await c.query('GRANT SELECT('+columns.filter(name=>name!==column).map(name=>'"'+name.replaceAll('"','""')+'"').join(',')+') ON TABLE public.'+table+' TO '+quotedRole);
    assert.equal((await c.query("SELECT pg_catalog.has_column_privilege($1::name,$2::regclass,$3::text,'SELECT') value",[role,'public.'+table,column])).rows[0].value,false);
    for(const pair of pairs){for(const name of[pair.old,pair.next]){
     const deniedColumn=await probe(count(name,pair.binds),pair.values);assert.equal(deniedColumn.code,'42501');assert.ok(deniedColumn.message?.includes(table),'only the revoked column/table may explain denial');
    }}
   }finally{await c.query('ROLLBACK TO SAVEPOINT compact_column_phase');await c.query('RELEASE SAVEPOINT compact_column_phase');}
   for(const pair of pairs)await positive(pair);
  }
  // Force already-executed/cached plans to re-evaluate current historical ACLs.
  for(const changed of pairs){
   await c.query('SAVEPOINT compact_execute_phase');try{
    await c.query('REVOKE EXECUTE ON FUNCTION public.'+changed.old+'('+changed.signature+') FROM PUBLIC,'+quotedRole);
    const gates=(await c.query("SELECT pg_catalog.has_function_privilege($1::name,$2::regprocedure,'EXECUTE') old,pg_catalog.has_function_privilege($1::name,$3::regprocedure,'EXECUTE') next",[role,'public.'+changed.old+'('+changed.signature+')','public.'+changed.next+'('+changed.signature+')'])).rows[0];assert.equal(gates.old,false);assert.equal(gates.next,true,'new ACL remains granted; only the historical gate was revoked');
    for(const pair of pairs){
     if(changed.kind==='raw'||pair.kind===changed.kind){await denied(count(pair.old,pair.binds),pair.values,changed.old);await denied(count(pair.next,pair.binds),pair.values,changed.old);}
     else await positive(pair);
    }
    if(changed.kind==='wrapper'){
     for(const read of readers){await denied(oldReader(read.sql),read.values,oldWrapperNameV1);await denied(read.sql,read.values,oldWrapperNameV1);}
     assert.deepEqual(await successful(metrics,metricValues),await successful(oldMetrics,metricValues),'metrics must remain independent of the historical wrapper');
     const empty=[null,...wrapperParamsV1(params).slice(1)];await denied(count(oldWrapperNameV1,wrapperParamsSqlV1),empty,oldWrapperNameV1);await denied(count(compactWrapperNameV1,wrapperParamsSqlV1),empty,oldWrapperNameV1);
    }else if(changed.kind==='effective'){await denied(oldMetrics,metricValues,oldEffectiveNameV1);await denied(metrics,metricValues,oldEffectiveNameV1);for(const read of readers)assert.deepEqual(await successful(read.sql,read.values),await successful(oldReader(read.sql),read.values));}
    else{await denied(oldMetrics,metricValues,oldRawNameV1);await denied(metrics,metricValues,oldRawNameV1);}
   }finally{await c.query('ROLLBACK TO SAVEPOINT compact_execute_phase');await c.query('RELEASE SAVEPOINT compact_execute_phase');}
  }
  for(const pair of pairs)assert.ok((preparedUses.get(count(pair.next,pair.binds))??0)>1,'the same named current query is reused across revocation phases');
  const retained=(await c.query('SELECT name FROM pg_catalog.pg_prepared_statements WHERE name=ANY($1::text[]) ORDER BY name',[[...prepared.values()]])).rows.map(row=>String(row.name));assert.deepEqual(retained,[...prepared.values()].sort(),'named statements really remain prepared after reuse');
  await c.query('ROLLBACK');inTx=false;assert.equal((await c.query('SELECT pg_catalog.to_regrole($1) role',[role])).rows[0].role,null);assert.deepEqual(await catalogV1(c),before,'all temporary grants, revokes and the probe role roll back exactly');assert.deepEqual(await columnCatalog(),columnsBefore,'table/column ACL probes restore the complete original catalog');
 }catch(error){primary=true;throw error;}
 finally{try{if(inTx){await c.query('ROLLBACK');inTx=false;}}catch(error){destroy=true;if(!primary)throw error;}finally{c.release(destroy||inTx||prepared.size>0);}}
}
