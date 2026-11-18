import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,mkdir,open} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg,{type PoolClient} from 'pg';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {openR16CiPostgresV1,assertR16LocalPostgresPoolV1} from './signal-r16-local-pg.fixture';
import {assertSharedWireDefaultRuntimeV1,withSharedWireDefaultPostcheckV1} from './signal-listening-statement-shared-wire.oracle';
import {captureStartupCallbackV1,closeStartupFactoryV1,assertStartupOwnedAbsentV1,startupErrorTreeV1,type StartupCallbackStateV1} from './signal-listening-startup-prefix.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {prepareSignalListeningV1} from '../signal-listening-preparation';
import {registerFacetContextV1,overrideMentionFacetsBatchV1,loadFacetEntityContextV1} from '../signal-mention-facets';
import {requestMentionFacetsV1} from '../signal-labeling-runs';
import {facetLabelerIdentityV1,labelerDigestV1} from '@noisia/query-engine';
import {loadR16ListeningNativeCensusV1} from '../../../scripts/r16/listening-native-census';
import {r16ListeningWorkloadV2} from '../../../scripts/r16/listening-workload';
import {captureR16SourceProvenanceV1} from '../../../scripts/r16/source-provenance';

const hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
export const FACET_ROSTER_SQL='SELECT root_id FROM signal_mention_facets_current_v1 WHERE workspace_id=$1';
const aliases={old:'pg_temp.r16_facet_input_old',new:'pg_temp.r16_facet_input_new'} as const;
type Arm=keyof typeof aliases;
const publicView='public.signal_mention_facets_current_v1';
const author='(CASE WHEN m.source_author_label_recorded THEN m.source_author_label ELSE COALESCE(author.handle,author.display_name) END)';
const oldExpression="signal_labeling_digest_v1(jsonb_build_object('text_sha256',i.asset_sha256,'title',m.title,'platform',m.platform,'content_type',m.content_type,'author',"+author+'))';
const header='-- TEST ONLY: temporary view; not a numbered migration.\n';
export function facetInputSourcesV1(old:string,candidate:string){
 assert.equal(hash(old),'d73389e6ea40334c2fe905906746ee23333b77822930bbf0a5c68b79f03df135');assert.ok(candidate.startsWith(header));
 const match=/\/\* flat_facet_input_begin \*\/([\s\S]*?)\/\* flat_facet_input_end \*\//.exec(candidate);assert.ok(match);assert.equal(candidate.split('/* flat_facet_input_begin */').length,2);
 const inverse=candidate.slice(header.length).replace('CREATE OR REPLACE VIEW '+aliases.new+' AS','CREATE OR REPLACE VIEW signal_mention_facets_current_v1 AS').replace(match[0],oldExpression);
 assert.equal(inverse,old,'only the one proven expression may change');
 return{old:old.replace('CREATE OR REPLACE VIEW signal_mention_facets_current_v1 AS','CREATE OR REPLACE VIEW '+aliases.old+' AS'),candidate,canonical:match[1]!,source_sha256:hash(old),candidate_sha256:hash(candidate)};
}
export function facetCallerRouteV1(query:PoolClient['query'],workspace:string,arm:Arm){
 let redirected=0;
 const routed=async(sql:string,values?:unknown[])=>{
  if(sql===FACET_ROSTER_SQL){assert.deepEqual(values,[workspace]);assert.equal(++redirected,1,'caller roster must be selected exactly once');return query(sql.replace('signal_mention_facets_current_v1',aliases[arm]),values);}
  return query(sql,values);
 };
 return{client:{query:routed} as Pick<PoolClient,'query'>,assertComplete(){assert.equal(redirected,1,'NEW caller must actually use its alias');}};
}
export function facetPairVerdictV1(rows:Array<{arm:Arm;ms:number}>){
 assert.deepEqual(rows.map(r=>r.arm),['old','new','new','old']);assert.ok(rows.every(r=>Number.isFinite(r.ms)&&r.ms>0));
 const oldMedian=(rows[0]!.ms+rows[3]!.ms)/2,newMedian=(rows[1]!.ms+rows[2]!.ms)/2;
 return{old_median_ms:oldMedian,new_median_ms:newMedian,median_ratio:newMedian/oldMedian,pair_ratios:[rows[1]!.ms/rows[0]!.ms,rows[2]!.ms/rows[3]!.ms],passed:newMedian<=.90*oldMedian&&rows[1]!.ms<=1.10*rows[0]!.ms&&rows[2]!.ms<=1.10*rows[3]!.ms};
}
type FunctionCounter={funcid:string;calls:string;total_time:number;self_time:number};
export function facetCounterDeltaV1(before:FunctionCounter[],after:FunctionCounter[],oid:string){
 const b=before.find(r=>r.funcid===oid),a=after.find(r=>r.funcid===oid);
 if(!a||!b)return{known:false,calls:null,reason:'absent_UNKNOWN'};
 assert.match(a.calls,/^\d+$/u);assert.match(b.calls,/^\d+$/u);assert.ok(BigInt(a.calls)>=BigInt(b.calls)&&a.total_time>=b.total_time&&a.self_time>=b.self_time);
 return{known:true,calls:String(BigInt(a.calls)-BigInt(b.calls)),total_elapsed_ms:a.total_time-b.total_time,self_elapsed_ms:a.self_time-b.self_time,not_cpu:true};
}
const contractualState=(value:unknown)=>typeof value==='string'&&(/^(?:22[A-Z0-9]{3}|42501|23514|P0001|55000)$/u.test(value));
export function facetOutcomesEqualV1(values:Array<Record<string,unknown>>){
 return values.length===3&&values.every(value=>value.known===true&&(value.ok===true||value.ok===false&&contractualState(value.sqlstate)))&&values.every(value=>JSON.stringify(value)===JSON.stringify(values[0]));
}
const uncertain=new WeakSet<PoolClient>();
async function transaction<T>(c:PoolClient,mode:'READ COMMITTED'|'REPEATABLE READ READ ONLY',body:()=>Promise<T>):Promise<T>{
 let failed=false,primary:unknown,value:T|undefined;
 try{try{await c.query('BEGIN ISOLATION LEVEL '+mode);}catch(error){uncertain.add(c);throw error;}value=await body();}catch(error){failed=true;primary=error;}
 try{await c.query('ROLLBACK');}catch(rollback){uncertain.add(c);if(failed)throw new AggregateError([primary,rollback],'facet body and rollback failed',{cause:primary});throw rollback;}
 if(failed)throw primary;return value as T;
}
function release(c:PoolClient){c.release(uncertain.has(c));}
const viewSql=(arm:Arm,projection:'root'|'full')=>`SELECT ${projection==='root'?'root_id':'*'} FROM ${aliases[arm]} WHERE workspace_id=$1`;
async function softRead(c:PoolClient,sql:string,binds:unknown[]=[]){const start=performance.now(),result=await c.query(sql,binds),ms=performance.now()-start;assert.ok(ms<=120000,'facet read soft cap120s exceeded');return{result,ms};}
async function viewMetadata(c:PoolClient,view:string){
 const row=(await c.query(`SELECT v.oid::text oid,v.relowner::text owner,v.relkind,v.reloptions,pg_get_viewdef(v.oid,true) definition,
  COALESCE((SELECT jsonb_agg(jsonb_build_array(x.grantor::text,x.grantee::text,x.privilege_type,x.is_grantable) ORDER BY x.grantor,x.grantee,x.privilege_type,x.is_grantable) FROM aclexplode(COALESCE(v.relacl,acldefault('r',v.relowner))) x),'[]'::jsonb) acl,
  (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',a.atttypid::text,'mod',a.atttypmod,'collation',a.attcollation::text,'acl',COALESCE((SELECT jsonb_agg(jsonb_build_array(x.grantor::text,x.grantee::text,x.privilege_type,x.is_grantable) ORDER BY x.grantor,x.grantee,x.privilege_type,x.is_grantable) FROM aclexplode(a.attacl) x),'[]'::jsonb)) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=v.oid AND a.attnum>0 AND NOT a.attisdropped) columns
  FROM pg_class v WHERE v.oid=$1::regclass`,[view])).rows[0];assert.ok(row);return row;
}
async function udfMetadata(c:PoolClient){return(await c.query(`SELECT p.oid::text oid,p.proname,p.prosrc,p.provolatile,p.proisstrict,p.prosecdef,p.proconfig,l.lanname,p.proacl::text acl
 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=ANY(ARRAY['public.signal_labeling_json_v1(jsonb)'::regprocedure,'public.signal_labeling_digest_v1(jsonb)'::regprocedure]) ORDER BY p.proname`)).rows;}
const privilegeNames=new Set(['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']);
async function mirrorAliases(c:PoolClient,reference:Awaited<ReturnType<typeof viewMetadata>>){
 const current=(await c.query('SELECT current_user role,(SELECT oid::text FROM pg_roles WHERE rolname=current_user) oid')).rows[0];assert.equal(reference.owner,current.oid,'CI owner must match public view owner');
 const grants=(await c.query(`SELECT x.grantor::text grantor,x.grantee::text grantee,CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE r.rolname END role,x.privilege_type privilege,x.is_grantable,
  NULL::text column_name FROM pg_class v CROSS JOIN LATERAL aclexplode(COALESCE(v.relacl,acldefault('r',v.relowner))) x LEFT JOIN pg_roles r ON r.oid=x.grantee WHERE v.oid=$1::regclass
  UNION ALL SELECT x.grantor::text,x.grantee::text,CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE r.rolname END,x.privilege_type,x.is_grantable,a.attname
  FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x LEFT JOIN pg_roles r ON r.oid=x.grantee WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped`,[publicView])).rows;
 for(const alias of Object.values(aliases)){
  const existing=(await c.query(`SELECT DISTINCT CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE r.rolname END role FROM pg_class v CROSS JOIN LATERAL aclexplode(COALESCE(v.relacl,acldefault('r',v.relowner))) x LEFT JOIN pg_roles r ON r.oid=x.grantee WHERE v.oid=$1::regclass`,[alias])).rows;
  for(const row of existing)await c.query(`REVOKE ALL ON TABLE ${alias} FROM ${row.role==='PUBLIC'?'PUBLIC':pg.escapeIdentifier(row.role)}`);
  await c.query(`REVOKE ALL ON TABLE ${alias} FROM PUBLIC`);
  for(const row of grants){assert.equal(row.grantor,reference.owner);assert.ok(privilegeNames.has(row.privilege));assert.equal(typeof row.role,'string');
   const role=row.grantee==='0'?'PUBLIC':pg.escapeIdentifier(row.role),column=row.column_name?` (${pg.escapeIdentifier(row.column_name)})`:'';
   await c.query(`GRANT ${row.privilege}${column} ON TABLE ${alias} TO ${role}${row.is_grantable?' WITH GRANT OPTION':''}`);
  }
  const meta=await viewMetadata(c,alias);assert.deepEqual({owner:meta.owner,relkind:meta.relkind,reloptions:meta.reloptions,acl:meta.acl,columns:meta.columns},{owner:reference.owner,relkind:reference.relkind,reloptions:reference.reloptions,acl:reference.acl,columns:reference.columns});
 }
 const temp=(await c.query('SELECT nspname FROM pg_namespace WHERE oid=pg_my_temp_schema()')).rows[0].nspname;assert.match(temp,/^pg_temp_\d+$/u);
 const roles=(await c.query(`SELECT r.oid::text oid,r.rolname role,has_schema_privilege(r.oid,'public','USAGE') public_usage,has_schema_privilege(r.oid,pg_my_temp_schema(),'USAGE') temp_usage
  FROM pg_roles r WHERE r.oid=$1::oid OR r.rolname IN('anon','authenticated','service_role','pg_read_all_data')
   OR has_table_privilege(r.oid,$2::regclass,'SELECT') OR has_any_column_privilege(r.oid,$2::regclass,'SELECT') ORDER BY r.rolname`,[reference.owner,publicView])).rows;
 for(const role of roles)if(role.public_usage&&!role.temp_usage)await c.query(`GRANT USAGE ON SCHEMA ${pg.escapeIdentifier(temp)} TO ${pg.escapeIdentifier(role.role)}`);
 return{roles,temp};
}
async function parity(c:PoolClient,workspace:string){
 const row=(await softRead(c,`WITH old AS MATERIALIZED(SELECT * FROM ${aliases.old} WHERE workspace_id=$1),new AS MATERIALIZED(SELECT * FROM ${aliases.new} WHERE workspace_id=$1),
  delta AS((SELECT * FROM old EXCEPT ALL SELECT * FROM new) UNION ALL (SELECT * FROM new EXCEPT ALL SELECT * FROM old)),
  old_bytes AS(SELECT encode(record_send(ROW(o.*)),'hex') bytes FROM old o),new_bytes AS(SELECT encode(record_send(ROW(n.*)),'hex') bytes FROM new n)
 SELECT (SELECT count(*)::int FROM old) rows,(SELECT count(*)::int FROM new) new_rows,(SELECT count(*)::int FROM delta) differences,
 (SELECT encode(sha256(convert_to(string_agg(bytes,'' ORDER BY bytes),'UTF8')),'hex') FROM old_bytes) old_bytes_sha,
 (SELECT encode(sha256(convert_to(string_agg(bytes,'' ORDER BY bytes),'UTF8')),'hex') FROM new_bytes) new_bytes_sha`,[workspace])).result.rows[0];
 return{...row,equal:row.rows===32768&&row.new_rows===32768&&row.differences===0&&row.old_bytes_sha===row.new_bytes_sha};
}
async function outcome(c:PoolClient,sql:string,workspace:string){
 await c.query('SAVEPOINT facet_outcome');try{const {result}=await softRead(c,sql,[workspace]);
  const bytes=(await softRead(c,`SELECT count(*)::int rows,encode(sha256(convert_to(string_agg(bytes,'' ORDER BY bytes),'UTF8')),'hex') sha FROM(SELECT encode(record_send(ROW(v.*)),'hex') bytes FROM (${sql}) v) q`,[workspace])).result.rows[0];
  return{known:true,ok:true,rows:result.rows.length,native_bytes_sha:bytes.sha};
 }catch(error){const code=error&&typeof error==='object'&&'code'in error?String(error.code):'UNKNOWN';return{known:contractualState(code),ok:false,sqlstate:/^[A-Z0-9]{5}$/u.test(code)?code:'UNKNOWN'};}
 finally{await c.query('ROLLBACK TO SAVEPOINT facet_outcome');await c.query('RELEASE SAVEPOINT facet_outcome');}
}
async function rolesOracle(c:PoolClient,workspace:string,roles:Array<{role:string;public_usage:boolean}>,temp:string){
 const rows=[];let equal=true;
 for(const role of roles)for(const projection of ['root','full'] as const){await c.query('SAVEPOINT facet_role');
  try{await c.query('SET LOCAL ROLE '+pg.escapeIdentifier(role.role));
   const columns=projection==='root'?'root_id':'*',base=await outcome(c,`SELECT ${columns} FROM ${publicView} WHERE workspace_id=$1`,workspace),old=await outcome(c,`SELECT ${columns} FROM ${pg.escapeIdentifier(temp)}.r16_facet_input_old WHERE workspace_id=$1`,workspace),next=await outcome(c,`SELECT ${columns} FROM ${pg.escapeIdentifier(temp)}.r16_facet_input_new WHERE workspace_id=$1`,workspace);
   const same=facetOutcomesEqualV1([base,old,next]);equal&&=same;rows.push({role:role.role,projection,public:base,old,new:next,equal:same,namespace_reference_usage:role.public_usage});
  }finally{await c.query('ROLLBACK TO SAVEPOINT facet_role');await c.query('RELEASE SAVEPOINT facet_role');}
 }
 return{equal,rows};
}
async function callerOracle(c:PoolClient,workspace:string){
 const before=(await c.query('SELECT count(*)::int n,max(version_no)::int version FROM signal_entity_context_versions WHERE workspace_id=$1',[workspace])).rows[0];
 const results:Array<{arm:Arm;affected_count:number;affected_bag_sha:string;context_digest:string;diff:unknown;persisted:Record<string,unknown>}>=[];
 await c.query("SELECT pg_advisory_xact_lock(hashtextextended('mfp-labeling:'||$1,0))",[workspace]);
 for(const arm of ['old','new'] as const){await c.query('SAVEPOINT facet_caller');try{
  const route=facetCallerRouteV1(c.query.bind(c),workspace,arm),value=await registerFacetContextV1(route.client,workspace,true);route.assertComplete();
  const persisted=(await c.query(`SELECT version_no,digest,parent_digest,affected_mode,affected_count,encode(sha256(record_send(ROW(context,diff))),'hex') bytes FROM signal_entity_context_versions WHERE workspace_id=$1 ORDER BY version_no DESC LIMIT 1`,[workspace])).rows[0];
  results.push({arm,affected_count:value.affected.length,affected_bag_sha:hash(JSON.stringify([...value.affected].sort())),context_digest:value.digest,diff:value.diff,persisted});
 }finally{await c.query('ROLLBACK TO SAVEPOINT facet_caller');await c.query('RELEASE SAVEPOINT facet_caller');}}
 const after=(await c.query('SELECT count(*)::int n,max(version_no)::int version FROM signal_entity_context_versions WHERE workspace_id=$1',[workspace])).rows[0];assert.deepEqual(after,before);
 const strip=({arm:_arm,...value}:typeof results[number])=>value;
 return{equal:JSON.stringify(strip(results[0]!))===JSON.stringify(strip(results[1]!)),baseline_restored:true,results,claim:'real registerFacetContext only; no new end-to-end admission/authorization claim'};
}
async function stats(c:PoolClient):Promise<FunctionCounter[]>{return(await c.query('SELECT funcid::text,calls::text,total_time,self_time FROM pg_stat_xact_user_functions ORDER BY funcid')).rows as FunctionCounter[];}
async function counterWindow(c:PoolClient,workspace:string,arm:Arm,projection:'root'|'full',oids:{json:string;digest:string}){
 await c.query("SET LOCAL track_functions='all'");
 await softRead(c,viewSql('old',projection),[workspace]);await softRead(c,viewSql('new',projection),[workspace]);
 const before=await stats(c);await softRead(c,viewSql(arm,projection),[workspace]);const after=await stats(c);
 return{arm,projection,before,after,json:facetCounterDeltaV1(before,after,oids.json),digest:facetCounterDeltaV1(before,after,oids.digest)};
}
async function paired(c:PoolClient,workspace:string,projection:'root'|'full'){
 await c.query("SET LOCAL track_functions='none'");const warms=[];
 for(const arm of ['old','new'] as const){const value=await softRead(c,viewSql(arm,projection),[workspace]);assert.equal(value.result.rows.length,32768);warms.push({arm,rows:value.result.rows.length});}
 const observations=[];for(const arm of ['old','new','new','old'] as const){const value=await softRead(c,viewSql(arm,projection),[workspace]);assert.equal(value.result.rows.length,32768);observations.push({arm,ms:value.ms,rows:value.result.rows.length});}
 return{warmups:warms,observations,verdict:facetPairVerdictV1(observations)};
}
async function representationKernel(c:PoolClient,expression:string){
 const match=/^\('sha256:'\|\|encode\(sha256\(convert_to\(([\s\S]*),'UTF8'\)\),'hex'\)\)$/u.exec(expression);assert.ok(match);
 const seed={asset_sha256:'sha256:'+'a'.repeat(64),title:'synthetic',platform:'facebook',content_type:'post',source_author_label_recorded:false,source_author_label:null,handle:'synthetic',display_name:'Synthetic'};
 const probes:Record<string,unknown>[]=[];
 for(let mask=0;mask<32;mask++){const value:Record<string,unknown>={...seed};for(const[key,bit]of [['title',0],['platform',1],['content_type',2],['asset_sha256',3],['handle',4]]as const)if(mask&(1<<bit))value[key]=null;value.display_name=null;probes.push(value);}
 for(const title of ['', 'null','1.23','1.2300','"quote"\\slash\n\t\r\b\f','\u0001','é','e\u0301','😀','x'.repeat(65536)])probes.push({...seed,title});
 probes.push({...seed,source_author_label_recorded:true,source_author_label:null},{...seed,source_author_label_recorded:true,source_author_label:'"native"\nlabel'},{...seed,handle:null,display_name:'Fallback'});
 const object=oldExpression.slice('signal_labeling_digest_v1('.length,-1);
 const row=(await softRead(c,`WITH probes AS(SELECT value FROM jsonb_array_elements($1::jsonb)),encoded_values AS(
  SELECT signal_labeling_json_v1(${object}) old_bytes,${match[1]} new_bytes,${oldExpression} old_digest,${expression} new_digest
  FROM probes CROSS JOIN LATERAL jsonb_populate_record(NULL::mentions,probes.value) m
  CROSS JOIN LATERAL jsonb_populate_record(NULL::signal_corpus_preparation_items,probes.value) i
  CROSS JOIN LATERAL jsonb_populate_record(NULL::authors,probes.value) author)
 SELECT count(*)::int cases,bool_and(convert_to(old_bytes,'UTF8')=convert_to(new_bytes,'UTF8') AND old_digest=new_digest) equal,
  max(octet_length(old_bytes))::int maximum_preimage_bytes FROM encoded_values`,[JSON.stringify(probes)])).result.rows[0];
 return{...row,isolated_representation_kernel:true,not_native_admitted_null_rows:true,case_author_recorded_true_null_included:true};
}
async function history(database:Parameters<typeof overrideMentionFacetsBatchV1>[0]['database'],workspace:string,actor:string,roots:string[]){
 const overrides=roots.slice(0,126).map(root_id=>({root_id,dimension:'voice',value:{value:'individual',confidence:'high',abstained:false}}));
 await overrideMentionFacetsBatchV1({database,workspace_id:workspace,actor_user_id:actor,overrides});
 await overrideMentionFacetsBatchV1({database,workspace_id:workspace,actor_user_id:actor,overrides:overrides.slice(0,32).map(value=>({...value,value:{value:'media',confidence:'high',abstained:false}}))});
 const context=await loadFacetEntityContextV1(database,workspace),entity=context.entities[0];assert.ok(entity);
 await overrideMentionFacetsBatchV1({database,workspace_id:workspace,actor_user_id:actor,overrides:[{root_id:roots[128]!,dimension:'entities',value:{value:[{entity_id:entity.entity_id,kind:entity.kind,salience:'main'}],confidence:'high',abstained:false}}]});
 const availability=(await database.query(`SELECT EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=$1 AND feature='mention_facets') feature_row,
  EXISTS(SELECT 1 FROM signal_processing_policy_versions p JOIN signal_processing_policy_actions a ON a.policy_version_id=p.id JOIN signal_workspaces w ON w.organization_id=p.organization_id WHERE w.id=$1 AND p.status='active' AND a.action='mention_facets') policy_action`,[workspace])).rows[0];
 let denial='UNKNOWN';
 try{await requestMentionFacetsV1({database,workspace_id:workspace,actor_user_id:actor,idempotency_key:'facet-history-availability:'+randomUUID(),provider_available:true,identity:facetLabelerIdentityV1(),cap_micro_usd:1000000});}
 catch(error){const code=error&&typeof error==='object'&&'code'in error?error.code:undefined;if(code==='labeling_not_enabled'||code==='labeling_policy_unavailable')denial=code;else throw error;}
 assert.notEqual(denial,'UNKNOWN','if the existing fixture admits genuine facet work, add its real receipt path before claiming this history oracle complete');
 const identity=facetLabelerIdentityV1(),ld=labelerDigestV1(identity);
 const labeler=(await database.query(`INSERT INTO signal_labeler_versions(kind,provider,model,prompt_digest,schema_digest,labeler_digest,identity)
  VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(labeler_digest) DO UPDATE SET labeler_digest=excluded.labeler_digest RETURNING id,status`,[identity.kind,identity.provider,identity.model,identity.prompt_digest,identity.schema_digest,ld,JSON.stringify(identity)])).rows[0];assert.notEqual(labeler.status,'retired');
 await database.query(`INSERT INTO signal_workspace_labelers(workspace_id,kind,labeler_version_id) VALUES($1,'facets',$2) ON CONFLICT(workspace_id,kind) DO UPDATE SET labeler_version_id=excluded.labeler_version_id`,[workspace,labeler.id]);
 const c=await database.connect();let ce:Record<string,unknown>|undefined;
 await withSharedWireDefaultPostcheckV1(async()=>{
  try{try{await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');}catch(error){uncertain.add(c);throw error;}
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('mfp-labeling:'||$1,0))",[workspace]);const registered=await registerFacetContextV1(c,workspace,true);assert.equal(registered.affected.length,32768);
   ce=(await c.query("SELECT count(*)::int versions,count(*) FILTER(WHERE affected_mode='full')::int full_fences,max(version_no)::int latest FROM signal_entity_context_versions WHERE workspace_id=$1",[workspace])).rows[0];
   try{await c.query('COMMIT');}catch(error){uncertain.add(c);throw error;}
  }catch(primary){try{await c.query('ROLLBACK');}catch(rollback){uncertain.add(c);throw new AggregateError([primary,rollback],'facet history and rollback failed',{cause:primary});}throw primary;}
 },async()=>{release(c);});
 const row=(await database.query(`SELECT count(*)::int total,count(*) FILTER(WHERE superseded_at IS NULL)::int current,count(*) FILTER(WHERE superseded_at IS NOT NULL)::int superseded FROM signal_mention_facet_overrides WHERE workspace_id=$1`,[workspace])).rows[0];
 assert.equal(row.current,128);assert.equal(row.superseded,32);
 return{...row,voice_current:126,entities_current:1,unrelated_reason_current:1,source:'overrideMentionFacetsBatchV1 native API',ce,
  chosen_labeler_status:labeler.status,provider_labels:{native_admitted:false,availability,writer:'requestMentionFacetsV1',guard_code:denial,scope:'this unchanged fixture only, not product impossibility'},technical_receipts:'not synthesized without admitted facet work',waiting_confirmation:'not exercised without admitted facet run'};
}
async function malformedOracle(c:PoolClient,workspace:string,actor:string,root:string){
 const cases=[{name:'override_entities_scalar',sql:"INSERT INTO signal_mention_facet_overrides(workspace_id,root_id,dimension,value,actor_user_id) VALUES($1,$2,'entities','{\"value\":1}'::jsonb,$3)",binds:[workspace,root,actor]},
  {name:'context_entities_scalar',sql:"UPDATE signal_entity_context_versions SET context=jsonb_set(context,'{entities}','1'::jsonb) WHERE workspace_id=$1 AND version_no=(SELECT max(version_no) FROM signal_entity_context_versions WHERE workspace_id=$1)",binds:[workspace]}];
 const results=[];let equal=true;
 for(const item of cases){await c.query('SAVEPOINT facet_malformed');try{
  let admitted=true,writeCode:string|undefined;
  try{await c.query(item.sql,item.binds);}catch(error){writeCode=error&&typeof error==='object'&&'code'in error?String(error.code):'UNKNOWN';if(!['23514','42501','P0001','55000'].includes(writeCode))throw error;admitted=false;await c.query('ROLLBACK TO SAVEPOINT facet_malformed');}
  if(!admitted){results.push({case:item.name,native_admitted:false,write_sqlstate:writeCode,no_view_equivalence_claim:true});continue;}
  const projections=[];for(const projection of ['root','full'] as const){const columns=projection==='root'?'root_id':'*';
   const pub=await outcome(c,`SELECT ${columns} FROM ${publicView} WHERE workspace_id=$1`,workspace),old=await outcome(c,viewSql('old',projection),workspace),next=await outcome(c,viewSql('new',projection),workspace);
   const same=facetOutcomesEqualV1([pub,old,next]);equal&&=same;projections.push({projection,public:pub,old,new:next,equal:same});
  }results.push({case:item.name,native_admitted:true,projections});
 }finally{await c.query('ROLLBACK TO SAVEPOINT facet_malformed');await c.query('RELEASE SAVEPOINT facet_malformed');}}
 return{equal,cases:results,results_scalar:'not synthesized without a genuine facet receipt; no admitted claim'};
}
async function retiredOracle(c:PoolClient,workspace:string){
 await c.query('SAVEPOINT facet_retired');try{
  assert.equal((await c.query(`UPDATE signal_labeler_versions l SET status='retired' FROM signal_workspace_labelers chosen WHERE chosen.workspace_id=$1 AND chosen.kind='facets' AND l.id=chosen.labeler_version_id RETURNING l.id`,[workspace])).rows.length,1);
  const par=await parity(c,workspace),outcomes=[];let equal=par.equal;
  for(const projection of ['root','full'] as const){const columns=projection==='root'?'root_id':'*',pub=await outcome(c,`SELECT ${columns} FROM ${publicView} WHERE workspace_id=$1`,workspace),old=await outcome(c,viewSql('old',projection),workspace),next=await outcome(c,viewSql('new',projection),workspace),same=facetOutcomesEqualV1([pub,old,next]);equal&&=same;outcomes.push({projection,public:pub,old,new:next,equal:same});}
  return{equal,parity:par,outcomes,native_metadata_only:true,provider_judgments:0};
 }finally{await c.query('ROLLBACK TO SAVEPOINT facet_retired');await c.query('RELEASE SAVEPOINT facet_retired');}
}
async function postWaitFresh(database:Parameters<typeof history>[0],c:PoolClient,workspace:string){
 const b=await database.connect();let pending:Promise<unknown>|undefined,failed=false,primary:unknown,result:Record<string,unknown>|undefined;
 const boundary=async(client:PoolClient,sql:string)=>{try{return await client.query(sql);}catch(error){uncertain.add(client);throw error;}};
 try{
  await boundary(b,'BEGIN ISOLATION LEVEL READ COMMITTED');await boundary(c,'BEGIN ISOLATION LEVEL READ COMMITTED');
  await b.query("SELECT pg_advisory_xact_lock(hashtextextended('mfp-labeling:'||$1,0))",[workspace]);
  const before=(await b.query('SELECT max(version_no)::int version FROM signal_entity_context_versions WHERE workspace_id=$1',[workspace])).rows[0].version;
  await registerFacetContextV1(b,workspace,true);
  const pid=(await c.query('SELECT pg_backend_pid() pid')).rows[0].pid;
  pending=c.query("SELECT pg_advisory_xact_lock(hashtextextended('mfp-labeling:'||$1,0))",[workspace]);pending.catch(()=>{});
  let blocked=false;for(let i=0;i<100&&!blocked;i++){blocked=(await b.query('SELECT pg_backend_pid()=ANY(pg_blocking_pids($1)) blocked',[pid])).rows[0].blocked;if(!blocked)await b.query('SELECT pg_sleep(0.01)');}
  assert.equal(blocked,true,'NEW caller must wait behind the real workspace lock');
  await boundary(b,'COMMIT');await pending;pending=undefined;
  const route=facetCallerRouteV1(c.query.bind(c),workspace,'new'),value=await registerFacetContextV1(route.client,workspace,true);route.assertComplete();
  assert.equal(value.previous?.version_no,before+1);assert.equal(value.affected.length,32768);
  result={blocked_observed:true,read_committed_fresh:true,previous_version:value.previous!.version_no,writer_committed_versions:1,caller_version_rolled_back:true,affected_count:value.affected.length};
 }catch(error){failed=true;primary=error;}
 const cleanup:unknown[]=[];
 try{await b.query('ROLLBACK');}catch(error){uncertain.add(b);cleanup.push(error);}
 // Destroy an uncertain writer before draining its blocked reader; otherwise
 // queuing reader ROLLBACK behind the advisory wait could deadlock cleanup.
 try{release(b);}catch(error){cleanup.push(error);}
 if(pending)try{await pending;}catch(error){cleanup.push(error);}
 try{await c.query('ROLLBACK');}catch(error){uncertain.add(c);cleanup.push(error);}
 if(failed&&cleanup.length)throw new AggregateError([primary,...cleanup],'facet postwait and rollback failed',{cause:primary});if(failed)throw primary;if(cleanup.length)throw new AggregateError(cleanup,'facet postwait rollback failed');return result!;
}
export async function writeFacetInputEvidenceV1(directory:string,value:unknown){
 const bytes=JSON.stringify(value)+'\n';assert.ok(Buffer.byteLength(bytes)<=2*1024*1024,'facet evidence exceeds2MiB');await mkdir(directory,{recursive:true,mode:0o700});
 const file=await open(resolve(directory,'facet-input-preimage.json'),'wx',0o600);try{await file.writeFile(bytes);}finally{await file.close();}
}
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
async function sourceBinding(){const value=await captureR16SourceProvenanceV1(repo);const migrations=value.file_manifest.filter(row=>/^infrastructure\/db\/migrations\/(?:029[5-9]|03[0-2][0-9]|033[0-2])_.+\.sql$/u.test(row.path));assert.equal(migrations.length,38);return{head_sha:value.head_sha,source_tree_sha256:value.source_tree_sha256,tree_status_sha256:value.tree_status_sha256,migrations};}
export async function runFacetInputPreimageV1(directory:string):Promise<Record<string,unknown>>{
 assert.equal(process.env.GITHUB_ACTIONS,'true','owned CI only');const started=performance.now(),elapsed=()=>performance.now()-started;
 const setupDeadline=()=>assert.ok(elapsed()<=1800000,'facet setup soft cap1800s exceeded');
 const report:Record<string,any>={contract:'r16-facet-input-preimage-v1',status:'failed',diagnostic_only:true,h1_accepted:false,cpu:'UNKNOWN',candidate_accepted:false,
  gates:{semantics:false,roles_errors:false,native_counters:false,paired_wall:false,catalog_unchanged:false,closure_confirmed:false,source_binding:false},bounds:{setup_ms:1800000,total_ms:1920000,read_ms:120000,job_watchdog_minutes:40}};
 const state:StartupCallbackStateV1={entered:false,complete:false,failed:false};let own:{name:string;oid:string}|null=null,absence:'UNKNOWN'|true='UNKNOWN',failed=false,primary:unknown;
 try{
  const before=await sourceBinding();report.source_before=before;
  const [old,candidate]=await Promise.all([readFile(new URL('./0258_signal_membership_context_review.sql',import.meta.url),'utf8'),readFile(new URL('./signal-facet-input-preimage.candidate.sql',import.meta.url),'utf8')]);const source=facetInputSourcesV1(old,candidate);report.sql_source={old_sha256:source.source_sha256,candidate_sha256:source.candidate_sha256,original_query_sha256:hash(FACET_ROSTER_SQL)};
  await closeStartupFactoryV1(state,async()=>{
   await runMassLabelingAcceptanceFixtureV1('product-recovery',{benchmark:{isolated:true,root_count:32768,execution_cap_micro_usd:20000000,import_batch_size:512,preparation_page_size:100,embedding_page_limit:264,beforeProcessing:ctx=>captureStartupCallbackV1(state,async()=>{
    setupDeadline();const database=ctx.database,access={database,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id};
    const identity=(await database.query("SELECT current_database() name,(SELECT oid::text FROM pg_database WHERE datname=current_database()) oid")).rows[0];assert.match(identity.name,/^noisia_mfp_recovery_[a-f0-9]{32}$/u);own={name:identity.name,oid:identity.oid};
    assert.equal((await database.query("UPDATE signal_labeling_runs r SET status='canceled' WHERE r.id=$1 AND r.workspace_id=$2 AND r.status='queued' AND NOT EXISTS(SELECT 1 FROM signal_labeling_calls c WHERE c.run_id=r.id) RETURNING r.id",[ctx.run_id,ctx.workspace_id])).rows.length,1);
    const workload=r16ListeningWorkloadV2('defined_consumer_second_pass'),cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:workload.configuration});assert.equal(cfg.configuration_digest,workload.configuration_digest);
    const prepared=await prepareSignalListeningV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,idempotency_key:'facet-input-preimage:'+randomUUID(),cap_micro_usd:20000000,provider_available:true,prototype_provider_available:false});assert.ok(prepared.status==='labeling'&&prepared.run_id);
    const census=await loadR16ListeningNativeCensusV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,run_id:prepared.run_id!},32768);setupDeadline();report.setup_ms=elapsed();
    const c=await database.connect();try{
     const publicBefore=await viewMetadata(c,publicView),udfBefore=await udfMetadata(c),witness=await assertSharedWireDefaultRuntimeV1(c);report.native_before={view:{...publicBefore,definition_sha256:hash(publicBefore.definition),definition:undefined},udfs:udfBefore.map(({prosrc,...row})=>({...row,prosrc_sha256:hash(prosrc)})),witness};
     await c.query(source.old);await c.query(source.candidate);const permissions=await mirrorAliases(c,publicBefore);
     assert.equal((await viewMetadata(c,aliases.old)).definition,publicBefore.definition,'public OLD and TEMP OLD definitions must agree');
     const json=udfBefore.find(row=>row.proname==='signal_labeling_json_v1'),digest=udfBefore.find(row=>row.proname==='signal_labeling_digest_v1');assert.ok(json&&digest);assert.equal(json.lanname,'plpgsql');assert.equal(json.provolatile,'i');assert.equal(json.proisstrict,true);assert.equal(json.prosecdef,false);assert.equal(digest.lanname,'sql');
     report.kernel=await transaction(c,'REPEATABLE READ READ ONLY',()=>representationKernel(c,source.canonical));assert.equal(report.kernel.equal,true);
     const strata:Array<Record<string,any>>=[];report.strata=strata;let semantic=true,rolesErrors=true,physical=true,wall=true;
     for(const scenario of ['fresh','history'] as const){
      if(scenario==='history')report.history=await history(database,ctx.workspace_id,ctx.actor_user_id,census.root_ids);
      const role=await transaction(c,'REPEATABLE READ READ ONLY',()=>rolesOracle(c,ctx.workspace_id,permissions.roles,permissions.temp));rolesErrors&&=role.equal;report['roles_'+scenario]=role;
      const caller=await transaction(c,'READ COMMITTED',()=>callerOracle(c,ctx.workspace_id));semantic&&=caller.equal;report['caller_'+scenario]=caller;
      for(const projection of ['root','full'] as const){
       const item:Record<string,any>={scenario,projection};strata.push(item);
       item.parity_before=await transaction(c,'REPEATABLE READ READ ONLY',()=>parity(c,ctx.workspace_id));semantic&&=item.parity_before.equal;
       item.paired=await transaction(c,'REPEATABLE READ READ ONLY',()=>paired(c,ctx.workspace_id,projection));wall&&=item.paired.verdict.passed;
       item.counters=[];for(const arm of ['old','new'] as const)item.counters.push(await transaction(c,'REPEATABLE READ READ ONLY',()=>counterWindow(c,ctx.workspace_id,arm,projection,{json:json.oid,digest:digest.oid})));
       const [a,b]=item.counters;const known=a.json.known&&b.json.known&&a.json.calls!==null&&b.json.calls!==null;const reduced=known&&BigInt(a.json.calls)>BigInt(b.json.calls)&&BigInt(b.json.calls)>=0n;item.native_counter_passed=Boolean(reduced);physical&&=Boolean(reduced);
       item.parity_after=await transaction(c,'REPEATABLE READ READ ONLY',()=>parity(c,ctx.workspace_id));semantic&&=item.parity_after.equal&&JSON.stringify(item.parity_before)===JSON.stringify(item.parity_after);
      }
     }
     report.retired=await transaction(c,'READ COMMITTED',()=>retiredOracle(c,ctx.workspace_id));semantic&&=report.retired.equal;
     report.errors=await transaction(c,'READ COMMITTED',()=>malformedOracle(c,ctx.workspace_id,ctx.actor_user_id,census.root_ids[512]!));rolesErrors&&=report.errors.equal;
     report.post_wait=await postWaitFresh(database,c,ctx.workspace_id);report.gates.semantics=semantic;report.gates.roles_errors=rolesErrors;report.gates.native_counters=physical;report.gates.paired_wall=wall;
     assert.ok(semantic&&rolesErrors&&physical,'facet semantic/role/counter oracle rejected candidate');
     const publicAfter=await viewMetadata(c,publicView),udfAfter=await udfMetadata(c);assert.deepEqual(publicAfter,publicBefore);assert.deepEqual(udfAfter,udfBefore);assert.deepEqual(await assertSharedWireDefaultRuntimeV1(c),witness);report.gates.catalog_unchanged=true;
     const untouched=(await database.query(`SELECT (SELECT count(*)::int FROM signal_labeling_calls WHERE run_id=$1) calls,(SELECT count(*)::int FROM signal_listening_answers WHERE run_id=$1) answers,(SELECT count(*)::int FROM signal_listening_calibrations WHERE source_run_id=$1) calibrations,(SELECT lease_token IS NULL FROM signal_labeling_runs WHERE id=$1) unleased`,[prepared.run_id])).rows[0];assert.deepEqual(untouched,{calls:0,answers:0,calibrations:0,unleased:true});report.listening_untouched=untouched;
    }finally{release(c);}
   })}});
  },async()=>{
   if(!own)return;const admin=await openR16CiPostgresV1();await withSharedWireDefaultPostcheckV1(async()=>{assertR16LocalPostgresPoolV1(admin);const c=await admin.connect();await withSharedWireDefaultPostcheckV1(async()=>{await assertStartupOwnedAbsentV1(c,own!,value=>{report.cleanup_observation=value;});absence=true;},async()=>{c.release();});},()=>admin.end());
  });report.gates.closure_confirmed=true;
  const after=await sourceBinding();report.source_after=after;assert.deepEqual(after,before);report.gates.source_binding=true;assert.ok(elapsed()<=1920000,'facet total soft cap1920s exceeded');
  assert.equal(report.strata.length,4);assert.equal(report.strata.flatMap((s:any)=>s.paired.observations).length,16);assert.equal(report.strata.flatMap((s:any)=>s.paired.warmups).length,8);assert.equal(report.strata.flatMap((s:any)=>s.counters).length,8);
  report.status='observed';report.candidate_accepted=Object.values(report.gates).every(value=>value===true);
 }catch(error){failed=true;primary=error;report.failure={error_tree:startupErrorTreeV1(error),callback_primary_preserved:state.failed};}
 report.total_ms=elapsed();report.closure={callback_entered:state.entered,callback_complete:state.complete,own_database:own??'UNKNOWN',own_database_absent:absence};
 try{await writeFacetInputEvidenceV1(directory,report);}catch(publication){if(failed)throw new AggregateError([primary,publication],'facet failure and publication failed',{cause:primary});throw publication;}
 if(failed)throw primary;return report;
}
