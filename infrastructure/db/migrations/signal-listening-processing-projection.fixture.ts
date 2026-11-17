import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,mkdir,open,realpath} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import type {PoolClient} from 'pg';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {hydrateListeningInputProjectionV1,type ListeningInputProjectionRowV1} from '../signal-listening-input-projection';
import {requestSignalListeningV1} from '../signal-listening-runs';
import {signalListeningBaseTemplateV1} from '@noisia/query-engine';
import {localizeSyntheticListeningConfigurationV1} from './signal-listening-localized.synthetic.fixture';
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const sourceUrl=new URL('./0326_signal_listening_final_answer_slice.sql',import.meta.url);
const candidateUrl=new URL('./signal-listening-processing-projection.candidate.sql',import.meta.url);
/** Static inverse proof: one native0326 decision body, constant projections. */
export function assertProcessingProjectionSourceV1(source:string,candidate:string){
 const get=(tag:string)=>{const parts=candidate.split('$'+tag+'$');assert.equal(parts.length,3,'one constant '+tag);return parts[1]!;};
 const original=source.split('RETURN QUERY EXECUTE $population$')[1]!.split('$population$ USING')[0]!;
 const bounded=source.split('RETURN QUERY EXECUTE $bounded$')[1]!.split('$bounded$ USING')[0]!;
 const begin=original.indexOf(' SELECT i.root_id,i.listening_input_digest,i.text,');
 const from=original.indexOf('\n FROM prepared i CROSS JOIN qs q',begin),oldSelect=original.slice(begin,from),oldFrom=original.slice(from);
 const candidateSql=oldSelect.slice(oldSelect.indexOf('  CASE ')+2).split(',\n  CASE WHEN q.definition')[0]!;
 const scopeSql='CASE WHEN q.definition'+oldSelect.split(',\n  CASE WHEN q.definition')[1]!.split(',\n  COALESCE(')[0]!;
 assert.equal(get('candidate'),candidateSql);assert.equal(get('scope'),scopeSql);assert.equal(get('joins'),oldFrom.trimEnd());
 assert.equal(get('full_answer'),'COALESCE('+oldSelect.split(',\n  COALESCE(')[1]!);
 const invert=(prefix:string)=>prefix.replace("q.*,CASE WHEN $7='processing' THEN octet_length(q.wire::text)::bigint END wire_bytes",'q.*')
  .replace(",\n  CASE WHEN $7='processing' THEN octet_length(i.text)::bigint END text_bytes,\n  CASE WHEN $7='processing' THEN octet_length(COALESCE(m.platform,''))::bigint END platform_bytes",'');
 assert.equal(invert(get('full_prefix')).trim(),original.slice(0,begin).trim());
 assert.equal(invert(get('bounded_prefix')).trim(),bounded.slice(0,bounded.indexOf(' SELECT i.root_id,i.listening_input_digest,i.text,')).trim());
 assert.match(candidate,/projection_mode NOT IN\('full','processing','census'\)/u);
 assert.equal((candidate.match(/RETURN QUERY EXECUTE/gu)??[]).length,1);
 assert.ok(!candidate.includes('manual_latest'),'the rejected manual slice is absent');
}
const names=['signal_listening_population_roots_v1','signal_listening_call_guard_v1','signal_listening_statement_money_v1','signal_listening_effective_population_roots_v2'];
async function defaults(c:PoolClient){return(await c.query(`SELECT p.oid::text,p.proname,p.prosrc,p.provolatile,p.prosecdef,p.proconfig,p.prorettype::text,p.proretset,p.proargtypes::text,p.proallargtypes::text,p.proargmodes,p.proargnames,p.proacl::text
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND (p.proname=ANY($1::text[]) OR p.proname LIKE 'signal_listening%statement%') ORDER BY p.oid`,[names])).rows;}
const installations=new WeakMap<PoolClient,{defaults:Awaited<ReturnType<typeof defaults>>;source_sha256:string;candidate_sha256:string;body_sha256:string}>();
type EffectiveReferenceAclV1={role:string|null;is_owner:boolean;is_public:boolean;grantor_is_owner:boolean;privilege_type:string;is_grantable:boolean};
export function assertProcessingProjectionEffectiveAclV1(rows:ReadonlyArray<EffectiveReferenceAclV1>){
 assert.equal(rows.length,2,'effective reference must expose exactly owner and service_role EXECUTE');
 assert.ok(rows.every(r=>!r.is_public&&!r.is_grantable&&r.grantor_is_owner&&r.privilege_type==='EXECUTE'),'no PUBLIC, grant option or delegated privileges');
 assert.equal(rows.filter(r=>r.is_owner).length,1);
 const reader=rows.filter(r=>!r.is_owner);assert.equal(reader.length,1);assert.equal(reader[0]!.role,'service_role');
}
export async function installProcessingProjectionV1(c:PoolClient){
 assert.equal((await c.query('SELECT current_setting(\'transaction_read_only\') readonly')).rows[0].readonly,'off','DDL aliases precede RRRO');
 const source=await readFile(sourceUrl,'utf8'),candidate=await readFile(candidateUrl,'utf8');
 assert.equal(sha(source),'7ee6911c892e8633725c5d1ad48d2f257b344d9d7a7a07f5346f9d4142e734ed');
 assertProcessingProjectionSourceV1(source,candidate);
 const before=await defaults(c),body=source.split('AS $function$')[1]!.split('$function$;')[0]!;
 const installed=before.find(r=>r.proname==='signal_listening_population_roots_v1');assert.ok(installed);assert.equal(installed.prosrc,body,'real installed default matches0326, not a caller flag');
 await c.query('CREATE TEMP TABLE r16_processing_projection_alias_lifetime(probe boolean)');
 await c.query(source.replace('CREATE OR REPLACE FUNCTION signal_listening_population_roots_v1(','CREATE FUNCTION pg_temp.r16_projection_old(')
  +'\nREVOKE ALL ON FUNCTION pg_temp.r16_projection_old(uuid,uuid,uuid,text,uuid[],text) FROM PUBLIC;');
 await c.query(candidate);
 const effective=await readFile(new URL('./0316_signal_listening_human_revision_plan.sql',import.meta.url),'utf8');
 const effectiveInstalled=before.find(r=>r.proname==='signal_listening_effective_population_roots_v2');assert.ok(effectiveInstalled);
 assert.equal(effectiveInstalled.prosrc,effective.split('AS $$')[1]!.split('$$;')[0]!);
 assert.notEqual(effectiveInstalled.proacl,null,'effective reference ACL must already be explicit');
 const effectiveAcl=(await c.query<EffectiveReferenceAclV1>(`SELECT grantee.rolname role,acl.grantee=p.proowner is_owner,acl.grantee=0 is_public,
  acl.grantor=p.proowner grantor_is_owner,acl.privilege_type,acl.is_grantable
  FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) acl
  LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=acl.grantee
  WHERE p.oid='public.signal_listening_effective_population_roots_v2(uuid,uuid,uuid,text,uuid[],text)'::pg_catalog.regprocedure
  ORDER BY acl.grantee`)).rows;
 assertProcessingProjectionEffectiveAclV1(effectiveAcl);

 for(const arm of ['old','new'])await c.query(effective.replace('CREATE OR REPLACE FUNCTION signal_listening_effective_population_roots_v2(',`CREATE FUNCTION pg_temp.r16_projection_effective_${arm}(`)
  .replace('signal_listening_population_roots_v1(w,cid,mid,ctx,roots,purpose)',`pg_temp.r16_projection_${arm==='old'?'old':'full'}(w,cid,mid,ctx,roots,purpose)`)
  +`\nREVOKE ALL ON FUNCTION pg_temp.r16_projection_effective_${arm}(uuid,uuid,uuid,text,uuid[],text) FROM PUBLIC;`);
 // Fixed aliases/role only, after proving the native reference already owns
 // this exact reader privilege. Core/full/processing/census/raw OLD stay owner-only.
 await c.query(`GRANT EXECUTE ON FUNCTION pg_temp.r16_projection_effective_old(uuid,uuid,uuid,text,uuid[],text) TO service_role;
GRANT EXECUTE ON FUNCTION pg_temp.r16_projection_effective_new(uuid,uuid,uuid,text,uuid[],text) TO service_role;`);
 const helpers=(await c.query("SELECT proname,prosecdef,provolatile,proconfig,proacl::text FROM pg_proc WHERE pronamespace=pg_my_temp_schema() AND proname IN('r16_projection_core','r16_projection_full','r16_projection_processing','r16_projection_census','r16_projection_old','r16_projection_effective_old','r16_projection_effective_new') ORDER BY proname")).rows;
 assert.equal(helpers.length,7);for(const helper of helpers){
  const reference=helper.proname.startsWith('r16_projection_effective_')?effectiveInstalled:installed;
  assert.equal(helper.prosecdef,false);assert.equal(helper.provolatile,reference.provolatile);assert.deepEqual(helper.proconfig,reference.proconfig);
  assert.notEqual(helper.proacl,null,'helper ACL must be explicit, never default PUBLIC');
  assert.equal(helper.proacl,reference.proacl,'no additional helper ACL');
 }
 assert.deepEqual(await defaults(c),before,'install never replaces public population or Mark guards');
 installations.set(c,{defaults:before,source_sha256:sha(source),candidate_sha256:sha(candidate),body_sha256:sha(body)});
}
const uncertainClients=new WeakSet<PoolClient>();
export function releaseProcessingProjectionClientV1(c:PoolClient){c.release(uncertainClients.has(c));}
export async function processingProjectionReadOnlyTransactionV1(c:PoolClient,body:()=>Promise<void>){
 let failed=false,primary:unknown;
 try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await body();}
 catch(error){failed=true;primary=error;}
 try{await c.query('ROLLBACK');}catch(rollback){
  uncertainClients.add(c);
  if(failed)throw new AggregateError([primary,rollback],'processing projection body and rollback failed',{cause:primary});
  throw rollback;
 }
 if(failed)throw primary;
}
export async function withProcessingProjectionSnapshotV1(c:PoolClient,body:()=>Promise<void>){
 const installed=installations.get(c);assert.ok(installed);
 await processingProjectionReadOnlyTransactionV1(c,async()=>{
  assert.deepEqual((await c.query("SELECT current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') readonly")).rows[0],{isolation:'repeatable read',readonly:'on'});
  await body();assert.deepEqual(await defaults(c),installed.defaults,'defaultC/Mark metadata preserved within snapshot');
 });
 assert.deepEqual(await defaults(c),installed.defaults,'defaultC/Mark metadata preserved after rollback');
}
const processingFields="root_id,input_digest,question_key,question_digest,scope_basis,candidate,scope_state,answer IS NOT NULL answered,octet_length(body)::bigint text_bytes,octet_length(wire::text)::bigint wire_bytes,octet_length(COALESCE(platform,''))::bigint platform_bytes";
const censusFields='root_id,question_key,candidate,scope_state,answer IS NOT NULL answered';
async function equalNative(c:PoolClient,old:string,next:string,args:unknown[],columns:number){
 const difference=(await c.query(`WITH old AS MATERIALIZED(${old}),new AS MATERIALIZED(${next})
 SELECT count(*)::int n FROM((TABLE old EXCEPT ALL TABLE new) UNION ALL(TABLE new EXCEPT ALL TABLE old)) d`,args)).rows[0].n;
 assert.equal(difference,0,'independent OLD versus NEW native bag');
 const bytes=async(sql:string)=>(await c.query(`SELECT encode(record_send(ROW(p.*)),'hex') bytes FROM (${sql}) p ORDER BY root_id,question_key,encode(record_send(ROW(p.*)),'hex')`,args)).rows.map(r=>r.bytes as string);
 const before=await bytes(old),after=await bytes(next);assert.deepEqual(after,before,'ordered native bytes, types, NULLs, numeric scale and microseconds');
 if(after.length)assert.equal(Object.keys((await c.query(`SELECT to_jsonb(p) value FROM (${next}) p LIMIT 1`,args)).rows[0].value).length,columns);
 return{rows:before.length,sha256:sha(before.join('\n'))};
}
export async function processingProjectionReadV1(c:PoolClient,scope:unknown[],roots:Array<string|null>|null,effective=false){
 const args=[...scope,roots,'client-derived-metrics'];
 const call=(name:string)=>`pg_temp.${name}($1,$2,$3,$4,$5::uuid[],$6)`;
 if(effective){const result=await equalNative(c,`SELECT * FROM ${call('r16_projection_effective_old')}`,`SELECT * FROM ${call('r16_projection_effective_new')}`,args,20);
  await equalNative(c,`SELECT * FROM ${call('r16_projection_effective_old')}`,'SELECT * FROM signal_listening_effective_population_roots_v2($1,$2,$3,$4,$5::uuid[],$6)',args,20);return result;}
 const old=call('r16_projection_old'),full=await equalNative(c,`SELECT * FROM ${old}`,`SELECT * FROM ${call('r16_projection_full')}`,args,14);
 const processing=await equalNative(c,`SELECT ${processingFields} FROM ${old}`,`SELECT * FROM ${call('r16_projection_processing')}`,args,11);
 const census=await equalNative(c,`SELECT ${censusFields} FROM ${old}`,`SELECT * FROM ${call('r16_projection_census')}`,args,5);
 assert.equal(processing.rows,full.rows);assert.equal(census.rows,full.rows);return full;
}
/** Packet/kernel cases are not admitted product rows. Native question hashes
 * include key; shared digests across distinct keys cannot be fabricated via API. */
export async function processingProjectionKernelV1(c:PoolClient){
 const row=(await c.query(`WITH packets(k,digest,manual_id,belongs,cache) AS(VALUES
 ('one','shared',NULL::integer,NULL::boolean,NULL::jsonb),('two','shared',NULL,NULL,'null'::jsonb),
 ('three','other',1,false,NULL),('four','other',2,true,'{"n":1.2300}'::jsonb))
 SELECT bool_and((COALESCE(CASE WHEN manual_id IS NOT NULL THEN jsonb_build_object('type','noul','noul',CASE WHEN belongs THEN 1.0 ELSE 0.0 END) END,cache) IS NOT NULL)
  =(manual_id IS NOT NULL OR cache IS NOT NULL)) presence_equal,
 count(*)::int bag_rows,count(DISTINCT digest)::int digests,
 '{"n":1.2300}'::jsonb='{"n":1.23}'::jsonb semantic_equal,
 record_send(ROW('{"n":1.2300}'::jsonb))<>record_send(ROW('{"n":1.23}'::jsonb)) byte_different,
 record_send(ROW('Café é 漢字 😀'::text))<>record_send(ROW('Café é 漢字 😀'::text)) unicode_different,
 to_jsonb('2026-01-01 00:00:00.123456+00'::timestamptz)#>>'{}' microseconds FROM packets`)).rows[0];
 assert.equal(row.presence_equal,true);assert.equal(row.bag_rows,4);assert.equal(row.digests,2);assert.equal(row.semantic_equal,true);assert.equal(row.byte_different,true);assert.equal(row.unicode_different,true);assert.match(row.microseconds,/\.123456/u);
}
async function queryTemplates(){
 const censusFile=await readFile(new URL('../../../scripts/r16/listening-native-census.ts',import.meta.url),'utf8');
 const censusStart=censusFile.indexOf('/* r16_listening_native_complete_roots_v1 */');assert.ok(censusStart>0);
 const census=censusFile.slice(censusStart,censusFile.indexOf('`',censusStart));assert.match(census,/GROUP BY root_id ORDER BY root_id/u);
 const storeFile=await readFile(new URL('../signal-listening-runs.ts',import.meta.url),'utf8');
 const metadataStart=storeFile.indexOf('/* labeling_listening_input_metadata_v1 */',storeFile.indexOf('async function inputProjectionMetadata'));assert.ok(metadataStart>0);
 const metadata=storeFile.slice(metadataStart,storeFile.indexOf('`,',metadataStart))
  .replace('${unresolvedScope}',"p.candidate AND p.scope_state='included' AND p.answer IS NULL")
  .replace('${noHumanDecision}',"NOT signal_listening_human_decision_exists_v1($1::uuid,$2::uuid,$3::uuid,p.root_id,p.input_digest,$4::text,p.question_digest)");
 assert.ok(!metadata.includes('${'));assert.match(metadata,/projection_rows/u);
 const old=(sql:string)=>sql.replaceAll('signal_listening_population_roots_v1','pg_temp.r16_projection_old');
 const narrowMetadata=metadata.replaceAll('signal_listening_population_roots_v1','pg_temp.r16_projection_processing')
  .replace('octet_length(p.body)::bigint text_bytes','p.text_bytes').replace('octet_length(p.wire::text)::bigint wire_bytes','p.wire_bytes')
  .replace("octet_length(COALESCE(p.platform,''))::bigint platform_bytes",'p.platform_bytes').replace('p.answer IS NULL','NOT p.answered');
 const narrowCensus=census.replaceAll('signal_listening_population_roots_v1','pg_temp.r16_projection_census').replace('answer IS NOT NULL','answered');
 assert.ok(!narrowMetadata.includes('p.body')&&!narrowMetadata.includes('p.wire::')&&!narrowMetadata.includes('p.answer IS'));
 return{source:{census,metadata},old:{census:old(census),metadata:old(metadata)},new:{census:narrowCensus,metadata:narrowMetadata}};
}
async function metadataParams(c:PoolClient,scope:unknown[],run_id:string,roots:string[],limit=4096,budget=String(512*1024*1024)){
 const row=(await c.query(`SELECT r.entity_context_digest,l.identity,ce.context FROM signal_labeling_runs r
 JOIN signal_labeler_versions l ON l.id=r.labeler_version_id JOIN signal_entity_context_versions ce ON ce.workspace_id=r.workspace_id AND ce.version_no=r.entity_context_version_no WHERE r.id=$1`,[run_id])).rows[0];assert.ok(row);
 const fixed=Buffer.byteLength(JSON.stringify(row.identity))+Buffer.byteLength(JSON.stringify(row.context))+Buffer.byteLength(JSON.stringify(row.identity.params.configuration));
 return[...scope,run_id,limit,fixed,roots,budget];
}
export async function compareProcessingProjectionBudgetsV1(c:PoolClient,scope:unknown[],run_id:string,roots:string[]){
 const sql=await queryTemplates(),args=await metadataParams(c,scope,run_id,roots),before=(await c.query<ListeningInputProjectionRowV1>(sql.old.metadata,args)).rows;
 const budgets=[String(512*1024*1024)];
 if(before.length){const first=BigInt(before[0]!.working_bytes);budgets.push(String(first-1n),String(first));if(before[1])budgets.push(String(first+BigInt(before[1].working_bytes)-1n),String(first+BigInt(before[1].working_bytes)));}
 for(const budget of budgets){
  const bound=[...args.slice(0,8),budget],old=(await c.query<ListeningInputProjectionRowV1>(sql.old.metadata,bound)).rows,next=(await c.query<ListeningInputProjectionRowV1>(sql.new.metadata,bound)).rows;
  assert.deepEqual(next,old,'same working_bytes, global prefix, sentinel and projections');
  const difference=(await c.query(`WITH old AS MATERIALIZED(${sql.old.metadata}),new AS MATERIALIZED(${sql.new.metadata}) SELECT count(*)::int n FROM((TABLE old EXCEPT ALL TABLE new) UNION ALL(TABLE new EXCEPT ALL TABLE old)) d`,bound)).rows[0].n;assert.equal(difference,0);
  const bytes=async(q:string)=>(await c.query(`SELECT encode(record_send(ROW(p.*)),'hex') bytes FROM (${q}) p ORDER BY root_id`,bound)).rows;
  assert.deepEqual(await bytes(sql.new.metadata),await bytes(sql.old.metadata),'exact budget/projection bytes');
  const bounds={max_rows:4096,max_working_bytes:Number(budget),on_oversize:'empty' as const};
  const cfg=(await c.query('SELECT configuration_digest FROM signal_listening_configurations WHERE workspace_id=$1 AND id=$2',scope.slice(0,2))).rows[0];assert.ok(cfg);
  const context={workspace_id:scope[0] as string,map_id:scope[2] as string,configuration_digest:cfg.configuration_digest as string};
  assert.deepEqual(await hydrateListeningInputProjectionV1(c,context,next,bounds),await hydrateListeningInputProjectionV1(c,context,old,bounds),'same existing JS prefix validator and native body hydration');
  if(before.length&&budget===String(BigInt(before[0]!.working_bytes)-1n))assert.equal(next[0]?.projection,null,'first oversize remains a non-fitting sentinel');
 }
 const limitOne=[...args];limitOne[5]=1;
 assert.deepEqual((await c.query(sql.new.metadata,limitOne)).rows,(await c.query(sql.old.metadata,limitOne)).rows,'row limit stays exact');
}
export const PROCESSING_PROJECTION_QUERY_ORDER_V1=['census','metadata','full14','full14_bounded'] as const;
const preregistration={narrow_timings:16,full_timings:16,total_timings:32,scenarios:['empty','historical'],narrow_queries:['census','metadata'],full_controls:{full14:{roots:null,purpose:'client-derived-metrics',observations:8},full14_bounded:{roots:4096,purpose:'llm-processing',observations:8}},order:['old','new','new','old'],narrow_strata:4,full_strata:4,median_ratio_max:.9,paired_ratio_max:1.1,pairing:'old_first:new_first;old_last:new_second',timing:'client_hrtime_query_only;EXPLAIN_and_parity_outside',cpu:'UNKNOWN'} as const;
type Observation={scenario:'empty'|'historical';query:typeof PROCESSING_PROJECTION_QUERY_ORDER_V1[number];arm:'old'|'new';position:number;wall_ms:number;rows:number;result_sha256:string;snapshot_sha256:string};
export function assertProcessingProjectionMeasurementCountsV1(rows:ReadonlyArray<Pick<Observation,'scenario'|'query'|'arm'|'position'>>){
 assert.equal(rows.length,32,'16 narrow +8 fullNULL +8 fullbounded');
 for(const query of PROCESSING_PROJECTION_QUERY_ORDER_V1){
  const stratum=rows.filter(r=>r.query===query);assert.equal(stratum.length,8,'each query has eight observations');
  for(const scenario of ['empty','historical'] as const){
   const paired=stratum.filter(r=>r.scenario===scenario);assert.equal(paired.length,4);
   assert.deepEqual(paired.map(r=>r.arm),['old','new','new','old']);assert.deepEqual(paired.map(r=>r.position),[0,1,2,3]);
  }
 }
}
type PairGate={scenario:string;query:string;old_median_ms:number;new_median_ms:number;median_ratio:number;max_paired_ratio:number;no_regression_10pct:boolean};
export type ProcessingProjectionEvidenceV1={contract:'r16-processing-projection-oracle-v1';status:'observed';query_only:true;h1_accepted:false;cpu:'UNKNOWN';inner_cost:'UNKNOWN';
 preregistration:typeof preregistration;source_sha256:string;candidate_sha256:string;source_body_sha256:string;mark_body_sha256:string;oracle_sha256:string;acceptance_sha256:string;target_sha:string;
 query_sha256:{census_old:string;census_new:string;metadata_old:string;metadata_new:string;full_old:string;full_new:string};runtime:{postgres_version:number;database:'owned_isolated_clone';database_sha256:string;system_identifier_sha256:string};
 fixture:{roots:4096;questions:4;base_questions:2;discovered_questions:2;scope_all_questions:4;history_roots:256;history_rows:1536;text_bytes_min:number;text_bytes_max:number};
 parity:{full14:true;processing11:true;census5:true;effective20:true;except_all:true;record_send:true;metadata_budget:true};shared_digest_coverage:'isolated_packet_kernel_not_admitted_API';
 narrow_measurements:Observation[];full_measurements:Observation[];narrow_gates:Array<PairGate&{median_10pct:boolean}>;full_gates:PairGate[];plans:Array<{scenario:string;query:string;arm:string;plan:unknown}>;
 primary_candidate:boolean;diagnosis:'eligible_query_only'|'rejected_query_only';default_unchanged:true};
function median(a:number[]){assert.equal(a.length,2);return(a[0]!+a[1]!)/2;}
function planSummary(v:unknown):unknown{if(Array.isArray(v))return v.map(planSummary);if(v===null||typeof v!=='object')return v;
 const allowed=new Set(['Plan','Plans','Node Type','Parent Relationship','Join Type','Strategy','Partial Mode','Parallel Aware','Async Capable','Startup Cost','Total Cost','Plan Rows','Plan Width','Function Name','Subplan Name']);
 return Object.fromEntries(Object.entries(v).filter(([k])=>allowed.has(k)).map(([k,value])=>[k,planSummary(value)]));}
export async function runProcessingProjection4096V1():Promise<ProcessingProjectionEvidenceV1>{
 assert.equal(process.env.GITHUB_ACTIONS,'true','measurement only in existing owned CI lab');let receipt:ProcessingProjectionEvidenceV1|undefined;
 await runMassLabelingAcceptanceFixtureV1('product-recovery',{seed_published_at:'2026-01-01T00:00:00.123456Z',benchmark:{isolated:true,root_count:4096,execution_cap_micro_usd:1000000,import_batch_size:256,preparation_page_size:100,embedding_page_limit:264,beforeProcessing:async f=>{
  const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
  assert.equal((await f.database.query("UPDATE signal_labeling_runs r SET status='canceled' WHERE id=$1 AND workspace_id=$2 AND status='queued' AND NOT EXISTS(SELECT 1 FROM signal_labeling_calls WHERE run_id=r.id) RETURNING id",[f.run_id,f.workspace_id])).rows.length,1);
  const base=signalListeningBaseTemplateV1({category:'synthetic fixture category',lexicon_terms:['synthetic']});
  const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:localizeSyntheticListeningConfigurationV1({...base,questions:[...base.questions,...[1,2].map(n=>({key:'projection_topic_'+n,type:'noul' as const,text:'Does this discuss synthetic topic '+n+'?',positive:'Synthetic topic '+n,negative:'Other text',scope:'all' as const,origin:'brand_os' as const,human_locked:true,topic_source:'discovered' as const}))]})});
  const requested=await requestSignalListeningV1({...access,configuration_id:cfg.id,map_id:f.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true});
  const c=await f.database.connect();try{
   await installProcessingProjectionV1(c);const installed=installations.get(c)!;
   const owner=(await c.query('SELECT entity_context_digest FROM signal_labeling_runs WHERE id=$1',[requested.run_id])).rows[0],scope=[f.workspace_id,cfg.id,f.map_id,owner.entity_context_digest];
   const roots=(await c.query('SELECT root_id FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$2 ORDER BY root_id',[f.workspace_id,f.map_id])).rows.map(r=>r.root_id as string);assert.equal(roots.length,4096);
   assert.equal((await c.query('SELECT count(*)::int n FROM signal_listening_questions WHERE configuration_id=$1',[cfg.id])).rows[0].n,4);
   const lengths=(await c.query('SELECT min(octet_length(text))::int minimum,max(octet_length(text))::int maximum FROM signal_mass_labeling_items WHERE map_id=$1',[f.map_id])).rows[0];
   const templates=await queryTemplates(),fullOld='SELECT * FROM pg_temp.r16_projection_old($1,$2,$3,$4,$5::uuid[],$6) ORDER BY root_id,question_key',fullNew=fullOld.replace('r16_projection_old','r16_projection_full');
   const params={census:[...scope,roots],metadata:await metadataParams(c,scope,requested.run_id,roots),full14:[...scope,null,'client-derived-metrics'],full14_bounded:[...scope,roots,'llm-processing']};
   const runtime=(await c.query("SELECT current_database() database,current_setting('server_version_num')::int postgres_version,system_identifier::text FROM pg_control_system()")).rows[0];
   assert.match(runtime.database,/^noisia_mfp_recovery_[a-f0-9]{32}$/u);assert.notEqual(runtime.database,new URL(process.env.DATABASE_URL!).pathname.slice(1));
   const mark=installed.defaults.find(r=>r.proname==='signal_listening_statement_money_v1');assert.ok(mark);
   const markSource=await readFile(new URL('./0331_signal_listening_statement_payload.sql',import.meta.url),'utf8');assert.equal(mark.prosrc,markSource.split('AS $$')[1]!.split('$$;')[0]!);
   const targetRoot=fileURLToPath(new URL('../../../',import.meta.url)),targetSha=execFileSync('git',['rev-parse','HEAD'],{cwd:targetRoot,encoding:'utf8',timeout:5000,maxBuffer:1024}).trim();assert.match(targetSha,/^[a-f0-9]{40}$/u);
   receipt={contract:'r16-processing-projection-oracle-v1',status:'observed',query_only:true,h1_accepted:false,cpu:'UNKNOWN',inner_cost:'UNKNOWN',preregistration,source_sha256:installed.source_sha256,candidate_sha256:installed.candidate_sha256,source_body_sha256:installed.body_sha256,mark_body_sha256:sha(mark.prosrc),oracle_sha256:sha(await readFile(fileURLToPath(import.meta.url))),acceptance_sha256:sha(await readFile(new URL('./signal-listening-processing-projection.postgres.test.ts',import.meta.url))),target_sha:targetSha,
    query_sha256:{census_old:sha(templates.old.census),census_new:sha(templates.new.census),metadata_old:sha(templates.old.metadata),metadata_new:sha(templates.new.metadata),full_old:sha(fullOld),full_new:sha(fullNew)},runtime:{postgres_version:runtime.postgres_version,database:'owned_isolated_clone',database_sha256:sha(runtime.database),system_identifier_sha256:sha(runtime.system_identifier)},
    fixture:{roots:4096,questions:4,base_questions:2,discovered_questions:2,scope_all_questions:4,history_roots:256,history_rows:1536,text_bytes_min:lengths.minimum,text_bytes_max:lengths.maximum},parity:{full14:true,processing11:true,census5:true,effective20:true,except_all:true,record_send:true,metadata_budget:true},shared_digest_coverage:'isolated_packet_kernel_not_admitted_API',narrow_measurements:[],full_measurements:[],narrow_gates:[],full_gates:[],plans:[],primary_candidate:false,diagnosis:'rejected_query_only',default_unchanged:true};
   for(const scenario of ['empty','historical'] as const){
    if(scenario==='empty')assert.equal((await c.query('SELECT count(*)::int n FROM signal_listening_discovery_manual WHERE workspace_id=$1',[f.workspace_id])).rows[0].n,0);
    else{
     await c.query(`INSERT INTO signal_listening_discovery_manual(workspace_id,configuration_id,map_id,question_key,question_digest,root_id,input_digest,entity_context_digest,belongs,created_by_user_id,created_at)
      SELECT $1,$2,$3,q.question_key,q.question_digest,i.root_id,signal_listening_input_digest_v1(i),$4,v.belongs,$5,v.at
      FROM signal_mass_labeling_items i CROSS JOIN signal_listening_questions q CROSS JOIN(VALUES
       (true,'2026-01-01 00:00:00.123456+00'::timestamptz),(false,'2026-01-02 00:00:00.123456+00'::timestamptz),(true,'2026-01-02 00:00:00.123456+00'::timestamptz))v(belongs,at)
      WHERE i.map_id=$3 AND i.workspace_id=$1 AND i.root_id=ANY($6::uuid[]) AND q.configuration_id=$2 AND q.definition->>'topic_source'='discovered'`,[...scope,f.actor_user_id,roots.slice(0,256)]);
     assert.equal((await c.query('SELECT count(*)::int n FROM signal_listening_discovery_manual WHERE workspace_id=$1',[f.workspace_id])).rows[0].n,1536);
    }
    await withProcessingProjectionSnapshotV1(c,async()=>{
     await processingProjectionReadV1(c,scope,null);await processingProjectionReadV1(c,scope,roots);await processingProjectionReadV1(c,scope,roots,true);
     await compareProcessingProjectionBudgetsV1(c,scope,requested.run_id,roots);
     await equalNative(c,fullOld,fullNew,params.full14_bounded,14);
     const snapshot=sha((await c.query('SELECT pg_current_snapshot()::text snapshot')).rows[0].snapshot);
     for(const query of PROCESSING_PROJECTION_QUERY_ORDER_V1){
      const isFull=query==='full14'||query==='full14_bounded';
      const measured:Observation[]=[];
      for(const [position,arm]of (['old','new','new','old'] as const).entries()){
       const sql=isFull?(arm==='old'?fullOld:fullNew):templates[arm][query],started=process.hrtime.bigint();
       const result=await c.query(sql,params[query]),wall=Number(process.hrtime.bigint()-started)/1e6;
       const observation={scenario,query,arm,position,wall_ms:wall,rows:result.rows.length,result_sha256:sha(JSON.stringify(result.rows)),snapshot_sha256:snapshot};measured.push(observation);
       (isFull?receipt!.full_measurements:receipt!.narrow_measurements).push(observation);
      }
      assert.ok(measured.every(m=>m.result_sha256===measured[0]!.result_sha256&&m.rows===measured[0]!.rows),'timed native caller outputs agree independently of packet parity');
      const old=measured.filter(m=>m.arm==='old'),next=measured.filter(m=>m.arm==='new'),om=median(old.map(m=>m.wall_ms)),nm=median(next.map(m=>m.wall_ms));
      const maxRatio=Math.max(next[0]!.wall_ms/old[0]!.wall_ms,next[1]!.wall_ms/old[1]!.wall_ms),gate={scenario,query,old_median_ms:om,new_median_ms:nm,median_ratio:nm/om,max_paired_ratio:maxRatio,no_regression_10pct:maxRatio<=1.1};
      if(isFull)receipt!.full_gates.push(gate);else receipt!.narrow_gates.push({...gate,median_10pct:nm<=.9*om});
      for(const arm of ['old','new'] as const){const sql=isFull?(arm==='old'?fullOld:fullNew):templates[arm][query];receipt!.plans.push({scenario,query,arm,plan:planSummary((await c.query('EXPLAIN(FORMAT JSON) '+sql,params[query])).rows[0]['QUERY PLAN'])});}
     }
    });
   }
   assertProcessingProjectionMeasurementCountsV1([...receipt.narrow_measurements,...receipt.full_measurements]);assert.equal(receipt.narrow_measurements.length,16);assert.equal(receipt.full_measurements.length,16);assert.equal(receipt.narrow_gates.length,4);assert.equal(receipt.full_gates.length,4);
   receipt.primary_candidate=receipt.narrow_gates.every(g=>g.median_10pct&&g.no_regression_10pct)&&receipt.full_gates.every(g=>g.no_regression_10pct);receipt.diagnosis=receipt.primary_candidate?'eligible_query_only':'rejected_query_only';
   assert.deepEqual(await defaults(c),installed.defaults);
  }finally{releaseProcessingProjectionClientV1(c);}
 }}});assert.ok(receipt);return receipt;
}
export async function writeProcessingProjectionEvidenceV1(receipt:ProcessingProjectionEvidenceV1){
 const destination=process.env.R16_PROCESSING_PROJECTION_EVIDENCE_DIR;assert.ok(destination);
 const root=await realpath(fileURLToPath(new URL('../../../',import.meta.url))),dir=resolve(root,destination),rel=relative(join(root,'.data'),dir);assert.ok(rel&&!rel.startsWith('..')&&!rel.startsWith('/'));
 await mkdir(dir,{recursive:true,mode:0o700});assert.equal(await realpath(dir),dir);
 const bytes=Buffer.from(JSON.stringify(receipt)+'\n');assert.ok(bytes.length<=256*1024);
 const fd=await open(join(dir,'processing-projection.json'),'wx',0o600);try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}
 console.log('# processing projection RESULT '+JSON.stringify({contract:receipt.contract,status:receipt.status,primary_candidate:receipt.primary_candidate,diagnosis:receipt.diagnosis,evidence_bytes:bytes.length,evidence_sha256:sha(bytes)}));
}
