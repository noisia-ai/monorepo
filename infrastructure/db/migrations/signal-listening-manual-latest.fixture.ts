import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,mkdir,open,realpath} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import type {PoolClient} from 'pg';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {requestSignalListeningV1} from '../signal-listening-runs';
import {signalListeningBaseTemplateV1} from '@noisia/query-engine';
import {localizeSyntheticListeningConfigurationV1} from './signal-listening-localized.synthetic.fixture';
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const sourceUrl=new URL('./0326_signal_listening_final_answer_slice.sql',import.meta.url);
const candidateUrl=new URL('./signal-listening-manual-latest.candidate.sql',import.meta.url);
const oldJoin=` LEFT JOIN LATERAL(SELECT d.* FROM signal_listening_discovery_manual d WHERE d.workspace_id=$1 AND d.root_id=i.root_id AND d.input_digest=i.listening_input_digest
  AND d.entity_context_digest=$4 AND d.question_digest=q.question_digest ORDER BY d.created_at DESC,d.id DESC LIMIT 1) manual ON true`;
const newJoin=` LEFT JOIN manual_latest manual ON manual.root_id=i.root_id AND manual.input_digest=i.listening_input_digest
  AND manual.question_digest=q.question_digest`;
const names=['signal_listening_population_roots_v1','signal_listening_call_guard_v1','signal_listening_statement_money_v1','signal_listening_effective_population_roots_v2'];
async function defaults(c:PoolClient){return(await c.query(`SELECT p.oid::text,p.proname,p.prosrc,p.provolatile,p.prosecdef,p.proconfig,p.prorettype::text,p.proretset,p.proargtypes::text,p.proallargtypes::text,p.proargmodes,p.proargnames,p.proacl::text
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND (p.proname=ANY($1::text[]) OR p.proname LIKE 'signal_listening%statement%') ORDER BY p.oid`,[names])).rows;}
const installations=new WeakMap<PoolClient,{defaults:Awaited<ReturnType<typeof defaults>>;source_sha256:string;candidate_sha256:string;body_sha256:string}>();
export async function installManualLatestV1(c:PoolClient){
 assert.equal((await c.query('SELECT current_setting(\'transaction_read_only\') readonly')).rows[0].readonly,'off','DDL aliases precede RRRO');
 const source=await readFile(sourceUrl,'utf8'),candidate=await readFile(candidateUrl,'utf8');
 assert.equal(sha(source),'7ee6911c892e8633725c5d1ad48d2f257b344d9d7a7a07f5346f9d4142e734ed');
 const invert=candidate.replace('CREATE FUNCTION pg_temp.r16_manual_new(','CREATE OR REPLACE FUNCTION signal_listening_population_roots_v1(')
  .replace(/ -- manual_latest_begin\n[\s\S]*? -- manual_latest_end\n/gu,'').replaceAll(newJoin,oldJoin);
 assert.equal((candidate.match(/ -- manual_latest_begin/gu)??[]).length,2);assert.equal(invert,source,'candidate inverse is byte-exact0326');
 const before=await defaults(c),body=source.split('AS $function$')[1]!.split('$function$;')[0]!;
 const installed=before.find(r=>r.proname==='signal_listening_population_roots_v1');assert.ok(installed);assert.equal(installed.prosrc,body,'real installed default matches0326, not a caller flag');
 await c.query('CREATE TEMP TABLE r16_manual_latest_alias_lifetime(probe boolean)');
 await c.query(source.replace('CREATE OR REPLACE FUNCTION signal_listening_population_roots_v1(','CREATE FUNCTION pg_temp.r16_manual_old('));
 await c.query(candidate);
 const effective=await readFile(new URL('./0316_signal_listening_human_revision_plan.sql',import.meta.url),'utf8');
 assert.equal(before.find(r=>r.proname==='signal_listening_effective_population_roots_v2')?.prosrc,effective.split('AS $$')[1]!.split('$$;')[0]!);
 for(const arm of ['old','new'])await c.query(effective.replace('CREATE OR REPLACE FUNCTION signal_listening_effective_population_roots_v2(',`CREATE FUNCTION pg_temp.r16_manual_effective_${arm}(`)
  .replace('signal_listening_population_roots_v1(w,cid,mid,ctx,roots,purpose)',`pg_temp.r16_manual_${arm}(w,cid,mid,ctx,roots,purpose)`));
 assert.deepEqual(await defaults(c),before,'install never replaces public population or Mark guards');
 installations.set(c,{defaults:before,source_sha256:sha(source),candidate_sha256:sha(candidate),body_sha256:sha(body)});
}
const uncertainClients=new WeakSet<PoolClient>();
export function releaseManualLatestClientV1(c:PoolClient){c.release(uncertainClients.has(c));}
export async function manualLatestReadOnlyTransactionV1(c:PoolClient,body:()=>Promise<void>){
 let failed=false,primary:unknown;
 try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await body();}
 catch(error){failed=true;primary=error;}
 try{await c.query('ROLLBACK');}catch(rollback){
  uncertainClients.add(c);
  if(failed)throw new AggregateError([primary,rollback],'manual latest body and rollback failed',{cause:primary});
  throw rollback;
 }
 if(failed)throw primary;
}
export async function withManualLatestSnapshotV1(c:PoolClient,body:()=>Promise<void>){
 const installed=installations.get(c);assert.ok(installed);
 await manualLatestReadOnlyTransactionV1(c,async()=>{
  assert.deepEqual((await c.query("SELECT current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') readonly")).rows[0],{isolation:'repeatable read',readonly:'on'});
  await body();assert.deepEqual(await defaults(c),installed.defaults,'defaultC/Mark metadata preserved within snapshot');
 });
 assert.deepEqual(await defaults(c),installed.defaults,'defaultC/Mark metadata preserved after rollback');
}
export async function manualLatestReadV1(c:PoolClient,scope:unknown[],roots:Array<string|null>|null,effective=false){
 const prefix=effective?'r16_manual_effective_':'r16_manual_',args=[...scope,roots,'client-derived-metrics'];
 const query=(arm:string)=>`SELECT * FROM pg_temp.${prefix}${arm}($1,$2,$3,$4,$5::uuid[],$6)`;
 const diff=await c.query(`WITH old AS MATERIALIZED(${query('old')}),new AS MATERIALIZED(${query('new')})
 SELECT (SELECT count(*) FROM((TABLE old EXCEPT ALL TABLE new) UNION ALL(TABLE new EXCEPT ALL TABLE old)) d)::int n`,args);
 assert.equal(diff.rows[0].n,0,'all native fields and bag multiplicity equal by independent EXCEPT ALL');
 const bytes=async(arm:string)=>(await c.query(`SELECT encode(record_send(ROW(p.*)),'hex') bytes FROM (${query(arm)}) p ORDER BY root_id,question_key,encode(record_send(ROW(p.*)),'hex')`,args)).rows.map(r=>r.bytes as string);
 const old=await bytes('old'),after=await bytes('new');
 if(effective){const native=(await c.query("SELECT encode(record_send(ROW(p.*)),'hex') bytes FROM signal_listening_effective_population_roots_v2($1,$2,$3,$4,$5::uuid[],$6) p ORDER BY root_id,question_key,encode(record_send(ROW(p.*)),'hex')",args)).rows.map(r=>r.bytes);assert.deepEqual(native,old,'real serving/effective wrapper matches unchanged alias composition');}
 assert.deepEqual(after,old,'native ordered bytes preserve numeric scale, NULLs, Unicode and timestamp microseconds');
 if(after.length){const columns=(await c.query(`SELECT to_jsonb(p) value FROM (${query('new')}) p LIMIT 1`,args)).rows[0].value;assert.equal(Object.keys(columns).length,effective?20:14);}
 return{rows:old.length,sha256:sha(old.join('\n'))};
}
/** Isolated relational kernel, not synthetic authority: native product writers
 * include key in question_digest, so a shared digest across distinct keys cannot
 * be manufactured through that API. This bag case tests the SQL transformation
 * without bypassing or modifying those production guards. */
export async function manualLatestKernelV1(c:PoolClient){
 const sentinel=(await c.query(`SELECT '{"n":1.2300}'::jsonb='{"n":1.23}'::jsonb semantic_equal,
 record_send(ROW('{"n":1.2300}'::jsonb))<>record_send(ROW('{"n":1.23}'::jsonb)) byte_different,
 to_jsonb('2026-01-01 00:00:00.123456+00'::timestamptz)#>>'{}' microseconds`)).rows[0];
 assert.equal(sentinel.semantic_equal,true);assert.equal(sentinel.byte_different,true);assert.match(sentinel.microseconds,/\.123456/u);
 const result=await c.query(`WITH items(root_id,input_digest) AS(VALUES('root','input'),('absent','input')),
 qs(question_key,question_digest) AS(VALUES('one','shared'),('two','shared'),('missing','absent')),
 decisions(workspace,context,root_id,input_digest,question_digest,created_at,id,belongs) AS(VALUES
 ('w','ctx','root','input','shared','2026-01-01 00:00:00.123456+00'::timestamptz,1,true),
 ('w','ctx','root','input','shared','2026-01-01 00:00:00.123456+00'::timestamptz,2,false),
 ('w','ctx','root','old','shared','2100-01-01'::timestamptz,3,true),
 ('other','ctx','root','input','shared','2100-01-01'::timestamptz,4,true),
 ('w','other','root','input','shared','2100-01-01'::timestamptz,5,true)),
 latest AS MATERIALIZED(SELECT DISTINCT ON(d.root_id,d.input_digest,d.question_digest) d.root_id,d.input_digest,d.question_digest,d.id,d.belongs FROM decisions d
 WHERE d.workspace='w' AND d.context='ctx' AND EXISTS(SELECT 1 FROM items i WHERE i.root_id=d.root_id AND i.input_digest=d.input_digest)
 AND d.question_digest=ANY(ARRAY(SELECT q.question_digest FROM qs q)) ORDER BY d.root_id,d.input_digest,d.question_digest,d.created_at DESC,d.id DESC),
 old AS MATERIALIZED(SELECT i.*,q.*,m.id,m.belongs,'{"n":1.2300,"unicode":"Café é 漢字 😀"}'::jsonb payload
 FROM items i CROSS JOIN qs q LEFT JOIN LATERAL(SELECT d.* FROM decisions d WHERE d.workspace='w' AND d.context='ctx' AND d.root_id=i.root_id AND d.input_digest=i.input_digest AND d.question_digest=q.question_digest ORDER BY d.created_at DESC,d.id DESC LIMIT 1)m ON true),
 new AS MATERIALIZED(SELECT i.*,q.*,m.id,m.belongs,'{"n":1.2300,"unicode":"Café é 漢字 😀"}'::jsonb payload
 FROM items i CROSS JOIN qs q LEFT JOIN latest m ON m.root_id=i.root_id AND m.input_digest=i.input_digest AND m.question_digest=q.question_digest)
 SELECT (SELECT count(*) FROM((TABLE old EXCEPT ALL TABLE new) UNION ALL(TABLE new EXCEPT ALL TABLE old)) d)::int difference,
 (SELECT array_agg(encode(record_send(ROW(o.*)),'hex') ORDER BY root_id,question_key) FROM old o) old_bytes,
 (SELECT array_agg(encode(record_send(ROW(n.*)),'hex') ORDER BY root_id,question_key) FROM new n) new_bytes,
 (SELECT count(*) FROM new WHERE id=2 AND belongs=false)::int shared_false,
 (SELECT count(*) FROM new WHERE id IS NULL)::int absent`);
 const row=result.rows[0];assert.equal(row.difference,0);assert.deepEqual(row.new_bytes,row.old_bytes);assert.equal(row.shared_false,2);assert.equal(row.absent,4);
}

const preregistration={timings:16,scenarios:['empty','historical'],queries:['census','metadata'],order:['old','new','new','old'],strata:4,median_ratio_max:0.9,paired_ratio_max:1.1,pairing:'old_first:new_first;old_last:new_second',timing:'client_hrtime_query_only;EXPLAIN_and_parity_outside',cpu:'UNKNOWN',manual_probes:'UNKNOWN'} as const;
type Measurement={scenario:'empty'|'historical';query:'census'|'metadata';arm:'old'|'new';position:number;wall_ms:number;rows:number;bytes_sha256:string;snapshot_sha256:string};
export type ManualLatestEvidenceV1={contract:'r16-manual-latest-oracle-v1';status:'observed';query_only:true;h1_accepted:false;cpu:'UNKNOWN';manual_probes:'UNKNOWN';
 preregistration:typeof preregistration;shared_digest_coverage:'isolated_sql_kernel_only_not_admitted_API';effective_coverage:'unchanged_public_wrapper_and_temp_composition';oracle_sha256:string;acceptance_sha256:string;
 source_sha256:string;candidate_sha256:string;source_body_sha256:string;mark_body_sha256:string;census_sql_sha256:string;metadata_sql_sha256:string;target_sha:string;
 runtime:{postgres_version:number;database:'owned_isolated_clone';database_sha256:string;system_identifier_sha256:string};fixture:{roots:4096;questions:4;base_questions:2;discovered_questions:2;scope_all_questions:4;history_roots:number;history_rows:number;text_bytes_min:number;text_bytes_max:number};
 parity:{raw14:true;effective20:true;except_all:true;record_send:true};measurements:Measurement[];plans:Array<{scenario:string;query:string;arm:string;plan:unknown}>;
 gates:Array<{scenario:string;query:string;old_median_ms:number;new_median_ms:number;median_ratio:number;max_paired_ratio:number;median_10pct:boolean;no_regression_10pct:boolean}>;
 primary_candidate:boolean;diagnosis:'eligible_query_only'|'rejected_query_only';default_unchanged:true};
// Keep native EXPLAIN shape/cost estimates, strip predicate/SQL strings and binds.
function planSummary(v:unknown):unknown{
 if(Array.isArray(v))return v.map(planSummary);if(v===null||typeof v!=='object')return v;
 const allowed=new Set(['Plan','Plans','Node Type','Parent Relationship','Join Type','Strategy','Partial Mode','Parallel Aware','Async Capable','Startup Cost','Total Cost','Plan Rows','Plan Width','Function Name','Subplan Name']);
 return Object.fromEntries(Object.entries(v).filter(([k])=>allowed.has(k)).map(([k,value])=>[k,planSummary(value)]));
}
function median(a:number[]){assert.equal(a.length,2);return(a[0]!+a[1]!)/2;}
export async function runManualLatest4096V1():Promise<ManualLatestEvidenceV1>{
 assert.equal(process.env.GITHUB_ACTIONS,'true','measurement only in existing owned CI lab');
 let receipt:ManualLatestEvidenceV1|undefined;
 await runMassLabelingAcceptanceFixtureV1('product-recovery',{seed_published_at:'2026-01-01T00:00:00.123456Z',benchmark:{isolated:true,root_count:4096,execution_cap_micro_usd:1000000,import_batch_size:256,preparation_page_size:100,embedding_page_limit:264,beforeProcessing:async f=>{
  const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
  assert.equal((await f.database.query("UPDATE signal_labeling_runs r SET status='canceled' WHERE id=$1 AND workspace_id=$2 AND status='queued' AND NOT EXISTS(SELECT 1 FROM signal_labeling_calls WHERE run_id=r.id) RETURNING id",[f.run_id,f.workspace_id])).rows.length,1);
  const base=signalListeningBaseTemplateV1({category:'synthetic fixture category',lexicon_terms:['synthetic']});
  const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:localizeSyntheticListeningConfigurationV1({...base,
   questions:[...base.questions,...[1,2].map(n=>({key:'manual_topic_'+n,type:'noul' as const,text:'Does this discuss synthetic topic '+n+'?',positive:'Synthetic topic '+n,negative:'Other text',scope:'all' as const,origin:'brand_os' as const,human_locked:true,topic_source:'discovered' as const}))]})});
  const requested=await requestSignalListeningV1({...access,configuration_id:cfg.id,map_id:f.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true});
  const c=await f.database.connect();try{
   await installManualLatestV1(c);const installed=installations.get(c)!;
   const owner=(await c.query('SELECT r.entity_context_digest,ce.context FROM signal_labeling_runs r JOIN signal_entity_context_versions ce ON ce.workspace_id=r.workspace_id AND ce.version_no=r.entity_context_version_no WHERE r.id=$1',[requested.run_id])).rows[0];
   // The run stores labeler identity in its immutable version; read it using the
   // same native owner join as the census, never an invented request envelope.
   const identity=(await c.query('SELECT l.identity FROM signal_labeling_runs r JOIN signal_labeler_versions l ON l.id=r.labeler_version_id WHERE r.id=$1',[requested.run_id])).rows[0].identity;
   const scope=[f.workspace_id,cfg.id,f.map_id,owner.entity_context_digest];
   const roots=(await c.query('SELECT root_id FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$2 ORDER BY root_id',[f.workspace_id,f.map_id])).rows.map(r=>r.root_id as string);assert.equal(roots.length,4096);
   assert.equal((await c.query('SELECT count(*)::int n FROM signal_listening_questions WHERE configuration_id=$1',[cfg.id])).rows[0].n,4);
   const lengths=(await c.query('SELECT min(octet_length(text))::int minimum,max(octet_length(text))::int maximum FROM signal_mass_labeling_items WHERE map_id=$1',[f.map_id])).rows[0];
   const censusFile=await readFile(new URL('../../../scripts/r16/listening-native-census.ts',import.meta.url),'utf8');
   const censusStart=censusFile.indexOf('/* r16_listening_native_complete_roots_v1 */');assert.ok(censusStart>0);
   const census=censusFile.slice(censusStart,censusFile.indexOf('`',censusStart));assert.match(census,/GROUP BY root_id ORDER BY root_id/u);
   const storeFile=await readFile(new URL('../signal-listening-runs.ts',import.meta.url),'utf8');
   const metadataStart=storeFile.indexOf('/* labeling_listening_input_metadata_v1 */',storeFile.indexOf('async function inputProjectionMetadata'));
   assert.ok(metadataStart>0);const metadata=storeFile.slice(metadataStart,storeFile.indexOf('`,',metadataStart))
    .replace('${unresolvedScope}',"p.candidate AND p.scope_state='included' AND p.answer IS NULL")
    .replace('${noHumanDecision}',"NOT signal_listening_human_decision_exists_v1($1::uuid,$2::uuid,$3::uuid,p.root_id,p.input_digest,$4::text,p.question_digest)");
   assert.ok(!metadata.includes('${'));assert.match(metadata,/projection_rows/u);
   const fixed=Buffer.byteLength(JSON.stringify(identity))+Buffer.byteLength(JSON.stringify(owner.context))+Buffer.byteLength(JSON.stringify(cfg.configuration));
   const params={census:[...scope,roots],metadata:[...scope,requested.run_id,4096,fixed,roots,String(512*1024*1024)]};
   const runtime=(await c.query('SELECT current_database() database,current_setting(\'server_version_num\')::int postgres_version,system_identifier::text FROM pg_control_system()')).rows[0];
   assert.match(runtime.database,/^noisia_mfp_recovery_[a-f0-9]{32}$/u,'existing fixture owns a migrated template0 clone');
   assert.notEqual(runtime.database,new URL(process.env.DATABASE_URL!).pathname.slice(1),'admin base is never the seeded/measured database');
   const mark=installed.defaults.find(r=>r.proname==='signal_listening_statement_money_v1');assert.ok(mark);
   const markSource=await readFile(new URL('./0331_signal_listening_statement_payload.sql',import.meta.url),'utf8');
   assert.equal(mark.prosrc,markSource.split('AS $$')[1]!.split('$$;')[0]!,'installed Mark stays exact0331');
   const targetRoot=fileURLToPath(new URL('../../../',import.meta.url));
   const targetSha=execFileSync('git',['rev-parse','HEAD'],{cwd:targetRoot,encoding:'utf8',timeout:5000,maxBuffer:1024}).trim();assert.match(targetSha,/^[a-f0-9]{40}$/u);
   receipt={contract:'r16-manual-latest-oracle-v1',status:'observed',query_only:true,h1_accepted:false,cpu:'UNKNOWN',manual_probes:'UNKNOWN',
    preregistration,shared_digest_coverage:'isolated_sql_kernel_only_not_admitted_API',effective_coverage:'unchanged_public_wrapper_and_temp_composition',oracle_sha256:sha(await readFile(fileURLToPath(import.meta.url))),acceptance_sha256:sha(await readFile(new URL('./signal-listening-manual-latest.postgres.test.ts',import.meta.url))),
    source_sha256:installed.source_sha256,candidate_sha256:installed.candidate_sha256,source_body_sha256:installed.body_sha256,mark_body_sha256:sha(mark.prosrc),
    census_sql_sha256:sha(census),metadata_sql_sha256:sha(metadata),target_sha:targetSha,runtime:{postgres_version:runtime.postgres_version,database:'owned_isolated_clone',database_sha256:sha(runtime.database),system_identifier_sha256:sha(runtime.system_identifier)},
    fixture:{roots:4096,questions:4,base_questions:2,discovered_questions:2,scope_all_questions:4,history_roots:256,history_rows:1536,text_bytes_min:lengths.minimum,text_bytes_max:lengths.maximum},
    parity:{raw14:true,effective20:true,except_all:true,record_send:true},measurements:[],plans:[],gates:[],primary_candidate:false,diagnosis:'rejected_query_only',default_unchanged:true};
   for(const scenario of ['empty','historical'] as const){
    if(scenario==='empty')assert.equal((await c.query('SELECT count(*)::int n FROM signal_listening_discovery_manual WHERE workspace_id=$1',[f.workspace_id])).rows[0].n,0);
    else{
     // Each row passes the genuine BEFORE guard; three versions per exact key,
     // two questions and256 roots. Ties are resolved solely by native UUID DESC.
     await c.query(`INSERT INTO signal_listening_discovery_manual(workspace_id,configuration_id,map_id,question_key,question_digest,root_id,input_digest,entity_context_digest,belongs,created_by_user_id,created_at)
      SELECT $1,$2,$3,q.question_key,q.question_digest,i.root_id,signal_listening_input_digest_v1(i),$4,v.belongs,$5,v.at
      FROM signal_mass_labeling_items i CROSS JOIN signal_listening_questions q CROSS JOIN(VALUES
       (true,'2026-01-01 00:00:00.123456+00'::timestamptz),(false,'2026-01-02 00:00:00.123456+00'::timestamptz),(true,'2026-01-02 00:00:00.123456+00'::timestamptz))v(belongs,at)
      WHERE i.map_id=$3 AND i.workspace_id=$1 AND i.root_id=ANY($6::uuid[]) AND q.configuration_id=$2 AND q.definition->>'topic_source'='discovered'`,[...scope,f.actor_user_id,roots.slice(0,256)]);
     assert.equal((await c.query('SELECT count(*)::int n FROM signal_listening_discovery_manual WHERE workspace_id=$1',[f.workspace_id])).rows[0].n,1536);
    }
    await withManualLatestSnapshotV1(c,async()=>{
     await manualLatestReadV1(c,scope,null);await manualLatestReadV1(c,scope,roots);await manualLatestReadV1(c,scope,roots,true);
     const snapshot=sha((await c.query('SELECT pg_current_snapshot()::text snapshot')).rows[0].snapshot);
     for(const [query,template] of [['census',census],['metadata',metadata]] as const){
      const measured:Measurement[]=[];
      for(const [position,arm]of (['old','new','new','old'] as const).entries()){
       const sql=template.replaceAll('signal_listening_population_roots_v1',`pg_temp.r16_manual_${arm}`),started=process.hrtime.bigint();
       const result=await c.query(sql,params[query]),wall=Number(process.hrtime.bigint()-started)/1e6;
       const observation={scenario,query,arm,position,wall_ms:wall,rows:result.rows.length,bytes_sha256:sha(JSON.stringify(result.rows)),snapshot_sha256:snapshot};
       measured.push(observation);receipt!.measurements.push(observation);
      }
      assert.ok(measured.every(m=>m.bytes_sha256===measured[0]!.bytes_sha256&&m.rows===measured[0]!.rows),'actual caller rows identical independently of raw14 oracle');
      const old=measured.filter(m=>m.arm==='old'),next=measured.filter(m=>m.arm==='new'),om=median(old.map(m=>m.wall_ms)),nm=median(next.map(m=>m.wall_ms));
      const maxRatio=Math.max(next[0]!.wall_ms/old[0]!.wall_ms,next[1]!.wall_ms/old[1]!.wall_ms);
      receipt!.gates.push({scenario,query,old_median_ms:om,new_median_ms:nm,median_ratio:nm/om,max_paired_ratio:maxRatio,median_10pct:nm<=.9*om,no_regression_10pct:maxRatio<=1.1});
      // EXPLAIN caller only, outside the timed query brackets. No nested-plan or
      // physical manual-loop claim can be derived from an opaque Function Scan.
      for(const arm of ['old','new'])receipt!.plans.push({scenario,query,arm,plan:planSummary((await c.query('EXPLAIN(FORMAT JSON) '+template.replaceAll('signal_listening_population_roots_v1',`pg_temp.r16_manual_${arm}`),params[query])).rows[0]['QUERY PLAN'])});
     }
    });
   }
   receipt.primary_candidate=receipt.gates.every(g=>g.median_10pct&&g.no_regression_10pct);receipt.diagnosis=receipt.primary_candidate?'eligible_query_only':'rejected_query_only';
   assert.deepEqual(await defaults(c),installed.defaults);
  }finally{releaseManualLatestClientV1(c);}
 }}});
 assert.ok(receipt);return receipt;
}
export async function writeManualLatestEvidenceV1(receipt:ManualLatestEvidenceV1){
 const destination=process.env.R16_MANUAL_LATEST_EVIDENCE_DIR;assert.ok(destination,'evidence directory required, no silent stdout-only success');
 const root=await realpath(fileURLToPath(new URL('../../../',import.meta.url))),dir=resolve(root,destination),rel=relative(join(root,'.data'),dir);
 assert.ok(rel&&!rel.startsWith('..')&&!rel.startsWith('/'),'evidence stays under checkout .data');
 await mkdir(dir,{recursive:true,mode:0o700});assert.equal(await realpath(dir),dir,'no symlink evidence destination');
 const bytes=Buffer.from(JSON.stringify(receipt)+'\n');assert.ok(bytes.length<=256*1024,'bounded flat evidence');
 const fd=await open(join(dir,'manual-latest.json'),'wx',0o600);try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}
 console.log('# manual latest RESULT '+JSON.stringify({contract:receipt.contract,status:receipt.status,primary_candidate:receipt.primary_candidate,diagnosis:receipt.diagnosis,evidence_bytes:bytes.length,evidence_sha256:sha(bytes)}));
}
