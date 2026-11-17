import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,mkdtemp,mkdir,open,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {join,resolve,relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import type {PoolClient} from 'pg';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {prepareSharedWireRawV1,type SharedWireFixtureV1} from './signal-listening-statement-shared-wire.fixture';
import {saveSignalListeningConfigurationV1,authorizeSignalListeningV1,loadSignalListeningConfigurationWithClientV1} from '../signal-listening-configuration';
import {assertMassLabelingMapCurrentV1} from '../signal-mass-labeling';
import {prepareSignalListeningV1} from '../signal-listening-preparation';
import {createSignalListeningStoreV1} from '../signal-listening-runs';
import {r16ListeningWorkloadV2} from '../../../scripts/r16/listening-workload';
import {startR16HttpFilesystemStorageV1} from '../../../scripts/r16/http-filesystem-storage';
import {createWorkspaceEngineStorageV1} from '../../../services/workers/src/workers/signal-workspace-engine-storage';
import {createLabelingRawPagesStorageV1} from '../../../services/workers/src/workers/signal-labeling-receipt-storage';
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const sourceUrl=new URL('./0326_signal_listening_final_answer_slice.sql',import.meta.url);
const sourceSha='7ee6911c892e8633725c5d1ad48d2f257b344d9d7a7a07f5346f9d4142e734ed';
const boundedSha='22aa122d25e9da2d9ba236527bb02e23053d296a83f9d53a1b5ba9096f8cb9a9';
const functionNames=['signal_labeling_digest_v1','signal_labeling_json_v1','signal_listening_input_digest_v1','signal_listening_root_right_v1',
 'signal_mass_labeling_category_pattern_v1','signal_mass_labeling_category_pattern_matches_v1','signal_mass_labeling_lexical_text_v1',
 'signal_mass_labeling_r13_hashtags_v1','signal_listening_discovery_candidates_v1'] as const;
const protectedNames=[...functionNames,'signal_listening_population_roots_v1','signal_listening_effective_population_roots_v2','signal_listening_statement_money_v1','signal_listening_call_guard_v1'];
export function extractPrefixBoundedV1(source:string){
 assert.equal(sha(source),sourceSha,'only the approved0326 literal is executable');
 const start='RETURN QUERY EXECUTE $bounded$',end='$bounded$ USING w,cid,mid,ctx,roots,purpose;';
 assert.equal(source.split(start).length,2);assert.equal(source.split(end).length,2);
 const sql=source.split(start)[1]!.split(end)[0]!;
 assert.equal(Buffer.byteLength(sql),8426);assert.equal(sha(sql),boundedSha);
 return{sql,sha256:sha(sql),body:source.split('AS $function$')[1]!.split('$function$;')[0]!,source_sha256:sha(source)};
}
export type PrefixCounterV1={funcid:string;schemaname:string;funcname:string;calls:string;total_time:number;self_time:number};
export function prefixFunctionDeltasV1(ids:ReadonlyArray<string>,before:ReadonlyArray<PrefixCounterV1>,after:ReadonlyArray<PrefixCounterV1>){
 const old=new Map(before.map(r=>[r.funcid,r])),next=new Map(after.map(r=>[r.funcid,r]));
 assert.equal(old.size,before.length);assert.equal(next.size,after.length);
 return [...new Set([...ids,...old.keys(),...next.keys()])].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1).map(funcid=>{
  const b=old.get(funcid)??null,a=next.get(funcid)??null;
  for(const row of [b,a])if(row){assert.ok(/^\d+$/u.test(row.calls));assert.ok(Number.isFinite(row.total_time)&&row.total_time>=0&&Number.isFinite(row.self_time)&&row.self_time>=0);}
  let delta:{calls:string;total_time_ms:number;self_time_ms:number}|null=null;
  if(b&&a){assert.ok(BigInt(a.calls)>=BigInt(b.calls)&&a.total_time>=b.total_time&&a.self_time>=b.self_time,'xact counters must be monotonic');
   delta={calls:String(BigInt(a.calls)-BigInt(b.calls)),total_time_ms:a.total_time-b.total_time,self_time_ms:a.self_time-b.self_time};}
  return{funcid,status:b&&a?'observed_delta':a?'entry_created_baseline_absent':b?'entry_missing_after_unknown':'unobserved_unknown',before:b,after:a,delta,
   // A new after entry belongs to the sole tracked phase; baseline absence is
   // retained, never converted into proof of no prior work or CPU zero.
   phase_counter:b?null:a,absence_interpretation:'untracked_or_inlined_or_branch_possible;not_CPU_zero'};
 });
}
const uncertainClients=new WeakSet<PoolClient>();
export function releasePrefixClientV1(c:PoolClient){c.release(uncertainClients.has(c));}
export async function withPrefixReadOnlyV1(c:PoolClient,body:()=>Promise<void>){
 let failed=false,primary:unknown;
 try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await body();}catch(error){failed=true;primary=error;}
 try{await c.query('ROLLBACK');}catch(rollback){uncertainClients.add(c);if(failed)throw new AggregateError([primary,rollback],'prefix body and rollback failed',{cause:primary});throw rollback;}
 if(failed)throw primary;
}
async function counters(c:PoolClient){return(await c.query<PrefixCounterV1>(`SELECT funcid::text,schemaname,funcname,calls::text,total_time,self_time
 FROM pg_catalog.pg_stat_xact_user_functions ORDER BY funcid`)).rows;}
async function catalogue(c:PoolClient,ids?:string[]){
 const rows=(await c.query(`SELECT p.oid::text,p.proname,n.nspname,l.lanname,p.provolatile,p.proisstrict,p.proparallel,p.prosecdef,p.proconfig,p.proacl::text,p.proowner::text,
  p.proargtypes::text,p.prorettype::text,p.proretset,p.proallargtypes::text,p.proargmodes,p.proargnames,p.prosrc
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_language l ON l.oid=p.prolang
 WHERE ${ids?'p.oid=ANY($1::oid[])':"n.nspname='public' AND p.proname=ANY($1::text[])"} ORDER BY p.oid`,[ids??protectedNames])).rows;
 return rows.map(({prosrc,...row})=>({...row,body_sha256:sha(prosrc as string)}));
}
async function session(c:PoolClient){return(await c.query(`SELECT pg_backend_pid()::text backend,current_database() database,current_user role,
 current_setting('search_path') search_path,current_setting('track_functions') track_functions,current_setting('is_superuser') is_superuser,
 current_setting('server_version_num')::int postgres_version`)).rows[0];}
async function snapshot(c:PoolClient){return(await c.query("SELECT pg_current_snapshot()::text snapshot,current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') readonly")).rows[0];}
async function nativeGuard(c:PoolClient,extracted:ReturnType<typeof extractPrefixBoundedV1>){
 const rows=await catalogue(c);assert.equal(rows.length,protectedNames.length);const full=rows.find(r=>r.proname==='signal_listening_population_roots_v1');assert.ok(full);
 assert.equal(full.body_sha256,sha(extracted.body));assert.equal(full.lanname,'plpgsql');assert.equal(full.provolatile,'s');assert.equal(full.prosecdef,false);
 assert.deepEqual(full.proconfig,['search_path=public, extensions, pg_temp']);
 const markSource=await readFile(new URL('./0331_signal_listening_statement_payload.sql',import.meta.url),'utf8');
 assert.equal(rows.find(r=>r.proname==='signal_listening_statement_money_v1')?.body_sha256,sha(markSource.split('AS $$')[1]!.split('$$;')[0]!));
 for(const name of functionNames)assert.equal(rows.filter(r=>r.proname===name).length,1,'native function signature catalogue must be unambiguous: '+name);
 return rows;
}
const columns='root_id,input_digest,body,published_at,platform,question_key,question_digest,definition,wire,candidate,scope_state,answer,cache_call_id,scope_basis';
const publicRead="SELECT * FROM public.signal_listening_population_roots_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid[],$6::text)";
async function parity(c:PoolClient,sql:string,params:unknown[]){
 const definition=`WITH old AS MATERIALIZED(${publicRead}),probe(${columns}) AS MATERIALIZED(${sql})`;
 assert.equal((await c.query(`${definition} SELECT count(*)::int n FROM((TABLE old EXCEPT ALL TABLE probe) UNION ALL(TABLE probe EXCEPT ALL TABLE old)) d`,params)).rows[0].n,0);
 const bytes=async(part:string)=>(await c.query(`${definition} SELECT encode(record_send(ROW(p.*)),'hex') bytes FROM ${part} p ORDER BY root_id,question_key,encode(record_send(ROW(p.*)),'hex')`,params)).rows.map(r=>r.bytes as string);
 const before=await bytes('old'),after=await bytes('probe');assert.deepEqual(after,before,'all14 ordered native bytes and bag multiplicity');assert.equal(before.length,16384);
 return{rows:before.length,except_all:true,ordered_record_send:true,sha256:sha(before.join('\n'))};
}
async function setupState(c:PoolClient,params:unknown[],run_id:string){
 const ledger=(await c.query(`SELECT count(*)::int calls,count(*) FILTER(WHERE status='settled' AND results_applied AND raw_page_id IS NOT NULL AND raw_sha256 IS NOT NULL)::int applied,
  count(DISTINCT inputs->0->>'root_id')::int roots,COALESCE(sum(settled_micro_usd),0)::text synthetic_spend_micro_usd,
  COALESCE(sum(reserved_micro_usd) FILTER(WHERE status IN('reserved','submitting','submitted')),0)::text reserved_micro_usd,
  (COALESCE(sum(reserved_micro_usd) FILTER(WHERE status='unknown'),0)+COALESCE(sum(terminal_exposure_micro_usd) FILTER(WHERE status IN('settled','failed')),0))::text unknown_micro_usd
 FROM signal_labeling_calls WHERE workspace_id=$1 AND run_id=$2`,[params[0],run_id])).rows[0];
 assert.deepEqual(ledger,{calls:4096,applied:4096,roots:4096,synthetic_spend_micro_usd:'24576',reserved_micro_usd:'0',unknown_micro_usd:'0'});
 const state=(await c.query(`WITH population AS MATERIALIZED(${publicRead}),per_root AS(
  SELECT root_id,count(*)::int questions,count(*) FILTER(WHERE question_key IN('voice','promotion') AND answer IS NOT NULL AND cache_call_id IS NOT NULL)::int bases,
   count(*) FILTER(WHERE definition->>'topic_source'='defined' AND definition->>'scope'='consumer_category' AND candidate AND scope_state='included' AND answer IS NULL AND scope_basis IS NOT NULL)::int consumers
  FROM population GROUP BY root_id),basis AS(
   SELECT count(*)::int bad FROM population p JOIN population v ON v.root_id=p.root_id AND v.question_key='voice'
   JOIN population a ON a.root_id=p.root_id AND a.question_key='promotion'
   WHERE p.definition->>'scope'='consumer_category' AND p.scope_basis IS DISTINCT FROM public.signal_labeling_digest_v1(jsonb_build_object('voice',v.cache_call_id,'promotion',a.cache_call_id)))
 SELECT (SELECT count(*)::int FROM population) rows,(SELECT count(*)::int FROM per_root) roots,
  (SELECT bool_and(questions=4 AND bases=2 AND consumers=2) FROM per_root) exact,
  (SELECT bad FROM basis) stale_basis`,params)).rows[0];
 assert.deepEqual(state,{rows:16384,roots:4096,exact:true,stale_basis:0});
 const answers=(await c.query("SELECT count(*)::int n FROM signal_listening_answers WHERE workspace_id=$1 AND run_id=$2 AND question_key IN('voice','promotion')",[params[0],run_id])).rows[0].n;assert.equal(answers,8192);
 const run=(await c.query('SELECT status,lease_token IS NULL released FROM signal_labeling_runs WHERE id=$1',[run_id])).rows[0];assert.equal(run.status,'running');assert.equal(run.released,true,'setup releases its lease before measurement');
 return{...ledger,base_answers:answers,consumer_pending:8192,raw14_rows:state.rows,basis_fresh:true,run_status:run.status,open_exposure_micro_usd:String(BigInt(ledger.reserved_micro_usd)+BigInt(ledger.unknown_micro_usd)),external_spend_micro_usd:0};
}
export type PrefixFunctionProfileReceiptV1={contract:'r16-prefix-function-profile-v1';status:'observed';diagnostic_only:true;h1_accepted:false;speedup_claim:false;cpu:'UNKNOWN';
 source:Record<string,unknown>;setup:Record<string,unknown>;measurement:Record<string,unknown>;
 function_catalog:Awaited<ReturnType<typeof catalogue>>;function_before:PrefixCounterV1[];function_after:PrefixCounterV1[];function_deltas:ReturnType<typeof prefixFunctionDeltasV1>;
 default_witness:{before:Awaited<ReturnType<typeof catalogue>>;after:Awaited<ReturnType<typeof catalogue>>};session_restored:true;unknowns:string[]};
export async function runPrefixFunctionProfileV1():Promise<PrefixFunctionProfileReceiptV1>{
 assert.equal(process.env.GITHUB_ACTIONS,'true','owned CI only');
 const extracted=extractPrefixBoundedV1(await readFile(sourceUrl,'utf8'));
 const workload=r16ListeningWorkloadV2('defined_consumer_second_pass'),started=process.hrtime.bigint();
 const elapsed=()=>Number(process.hrtime.bigint()-started)/1e6;
 const deadline=()=>assert.ok(elapsed()<=600000,'prefix setup deadline600s exceeded; no measurement');
 const {withSharedWireDefaultPostcheckV1}=await import('./signal-listening-statement-shared-wire.oracle');
 let receipt:PrefixFunctionProfileReceiptV1|undefined;
 await runMassLabelingAcceptanceFixtureV1('product-recovery',{benchmark:{isolated:true,root_count:4096,execution_cap_micro_usd:20000000,
  import_batch_size:256,preparation_page_size:100,embedding_page_limit:264,beforeProcessing:async ctx=>{
   deadline();const database=ctx.database,access={database,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id};
   assert.equal((await database.query("UPDATE signal_labeling_runs r SET status='canceled' WHERE id=$1 AND workspace_id=$2 AND status='queued' AND NOT EXISTS(SELECT 1 FROM signal_labeling_calls WHERE run_id=r.id) RETURNING id",[ctx.run_id,ctx.workspace_id])).rows.length,1);
   const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:workload.configuration});assert.equal(cfg.configuration_digest,workload.configuration_digest);
   const prepared=await prepareSignalListeningV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,idempotency_key:'prefix-function-profile:'+randomUUID(),cap_micro_usd:20000000,provider_available:true,prototype_provider_available:false});
   assert.equal(prepared.status,'labeling');assert.ok(prepared.run_id);deadline();
   const directory=await mkdtemp(join(tmpdir(),'r16-prefix-function-profile-'));
   const server=await startR16HttpFilesystemStorageV1(directory);
   await withSharedWireDefaultPostcheckV1(async()=>{
    const storage=createWorkspaceEngineStorageV1({url:server.base_url,service_role_key:'synthetic-local-only',bucket:'corpus-files'}),rawPages=createLabelingRawPagesStorageV1(storage);
    const store=createSignalListeningStoreV1({database,page_size:4096,rawPages,assertRawReady:()=>storage.assertReady!(),storeRawVerified:true,storeRaw:async()=>{throw Error('diagnostic requires native multipart RAW');}});
    const run=await store.claim(prepared.run_id!);assert.ok(run);
    const initial=await withSharedWireDefaultPostcheckV1(async()=>{
     deadline();const inputs=await store.inputs(run,{max_rows:4096,max_working_bytes:512*1024*1024,on_oversize:'error'});deadline();
     assert.equal(inputs.length,4096);assert.equal(new Set(inputs.map(i=>i.root_id)).size,4096);
     assert.ok(inputs.every(i=>i.question_keys.length===2&&[...i.question_keys].sort().join(',')==='promotion,voice'),'capture the entire base roster before applying any chunk');
     for(let offset=0;offset<inputs.length;offset+=1024){
      await store.renew(run);deadline();
      const f:SharedWireFixtureV1={database,run,inputs:inputs.slice(offset,offset+1024),configuration:cfg.configuration,configuration_id:cfg.id,map_id:ctx.map_id,store,rawPages};
      const outcomes=await prepareSharedWireRawV1(f,500);deadline();
      assert.equal(outcomes.length,1024);await store.apply(run,outcomes.map(o=>({call:o.call,results:[o.result]})));deadline();
     }
     return inputs;
    },()=>store.release(run));
    // Every setup promise and the normal lease release have completed. The
    // original roster, not a new consumer read, supplies the one fixed scope.
    deadline();const setupElapsed=elapsed(),roots=Object.freeze(initial.map(i=>i.root_id));
    const params:unknown[]=[access.workspace_id,cfg.id,ctx.map_id,run.entity_context_digest,roots,'llm-processing'];
    const paramsSha=sha(JSON.stringify(params)),c=await database.connect();
    try{
     const originalSession=await session(c);assert.equal(originalSession.is_superuser,'on');assert.ok(originalSession.postgres_version>=170000&&originalSession.postgres_version<180000);
     assert.match(originalSession.database,/^noisia_mfp_recovery_[a-f0-9]{32}$/u);assert.notEqual(originalSession.database,new URL(process.env.DATABASE_URL!).pathname.slice(1));
     let observation:Omit<PrefixFunctionProfileReceiptV1,'session_restored'>|undefined;
     await withSharedWireDefaultPostcheckV1(()=>withPrefixReadOnlyV1(c,async()=>{
      await c.query('SET LOCAL search_path=public,extensions,pg_temp');await c.query("SET LOCAL track_functions='none'");
      const activeSession=await session(c);assert.equal(activeSession.search_path,'public, extensions, pg_temp');assert.equal(activeSession.track_functions,'none');
      const snap=await snapshot(c);assert.equal(snap.isolation,'repeatable read');assert.equal(snap.readonly,'on');
      await authorizeSignalListeningV1(c,access,'view');
      await assertMassLabelingMapCurrentV1(c,access.workspace_id,ctx.map_id);
      assert.equal((await c.query('SELECT digest FROM signal_entity_context_versions WHERE workspace_id=$1 ORDER BY version_no DESC LIMIT 1',[access.workspace_id])).rows[0].digest,run.entity_context_digest);
      const current=await loadSignalListeningConfigurationWithClientV1(c,access.workspace_id);assert.equal(current?.id,cfg.id);assert.equal(current.configuration_digest,workload.configuration_digest);
      const witnessBefore=await nativeGuard(c,extracted),state=await setupState(c,params,run.id),packetParity=await parity(c,extracted.sql,params);
      const baseCatalog=witnessBefore.filter(r=>functionNames.some(n=>n===r.proname));assert.equal(baseCatalog.length,9);
      const identity=(await c.query('SELECT system_identifier::text FROM pg_catalog.pg_control_system()')).rows[0].system_identifier as string;
      await c.query("SET LOCAL track_functions='all'");assert.equal((await c.query("SELECT current_setting('track_functions') value")).rows[0].value,'all');
      // The bracket has only xact-stat reads and ONE literal EXPLAIN. No parity,
      // source hashing, metadata, setup, observer or business query inside it.
      const before=await counters(c),queryStarted=process.hrtime.bigint();
      const explained=await c.query('EXPLAIN(ANALYZE,BUFFERS,TIMING OFF,FORMAT JSON) '+extracted.sql,params);
      const clientWall=Number(process.hrtime.bigint()-queryStarted)/1e6,after=await counters(c);
      const plan=explained.rows[0]?.['QUERY PLAN'];assert.ok(Array.isArray(plan)&&plan.length===1);assert.equal(plan[0].Plan['Actual Rows'],16384);assert.notEqual(plan[0].Plan['Node Type'],'Function Scan','the prefix must be visible, not a wrapper plan');
      const snapAfter=await snapshot(c);assert.deepEqual(snapAfter,snap);assert.equal(sha(JSON.stringify(params)),paramsSha);
      const witnessAfter=await nativeGuard(c,extracted);assert.deepEqual(witnessAfter,witnessBefore);
      const currentAfter=await loadSignalListeningConfigurationWithClientV1(c,access.workspace_id);assert.equal(currentAfter?.id,cfg.id);assert.equal(currentAfter.configuration_digest,workload.configuration_digest);
      await assertMassLabelingMapCurrentV1(c,access.workspace_id,ctx.map_id);
      assert.equal((await c.query('SELECT digest FROM signal_entity_context_versions WHERE workspace_id=$1 ORDER BY version_no DESC LIMIT 1',[access.workspace_id])).rows[0].digest,run.entity_context_digest);
      assert.deepEqual(await setupState(c,params,run.id),state,'no exposure/corpus mutation during the read-only measurement');
      const ids=[...new Set([...baseCatalog.map(r=>r.oid as string),...before.map(r=>r.funcid),...after.map(r=>r.funcid)])],allCatalog=await catalogue(c,ids);assert.equal(allCatalog.length,ids.length);
      const deltas=prefixFunctionDeltasV1(ids,before,after);
      const nodes:Record<string,unknown>[]=[];const visit=(v:unknown)=>{if(!v||typeof v!=='object')return;if(Array.isArray(v)){for(const x of v)visit(x);return;}const o=v as Record<string,unknown>;if(o['Node Type'])nodes.push(o);for(const child of Object.values(o))if(typeof child==='object')visit(child);};visit(plan);
      const workers=Math.max(0,...nodes.map(n=>Number(n['Workers Launched']??0))),planned=Math.max(0,...nodes.map(n=>Number(n['Workers Planned']??0)));
      const root=fileURLToPath(new URL('../../../',import.meta.url)),target=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',timeout:5000,maxBuffer:1024}).trim();assert.match(target,/^[a-f0-9]{40}$/u);
      observation={contract:'r16-prefix-function-profile-v1',status:'observed',diagnostic_only:true,h1_accepted:false,speedup_claim:false,cpu:'UNKNOWN',
       source:{target_sha:target,source0326_sha256:sourceSha,bounded_bytes:8426,bounded_sha256:extracted.sha256,oracle_sha256:sha(await readFile(fileURLToPath(import.meta.url))),acceptance_sha256:sha(await readFile(new URL('./signal-listening-prefix-function-profile.postgres.test.ts',import.meta.url))),configuration_digest:workload.configuration_digest,params_sha256:paramsSha,params_types:['uuid','uuid','uuid','text','uuid[]','text'],purpose:'llm-processing',root_count:4096,system_identifier_sha256:sha(identity),database_sha256:sha(originalSession.database),backend:originalSession.backend,postgres_version:originalSession.postgres_version},
       setup:{...state,setup_elapsed_ms:setupElapsed,setup_deadline_ms:600000,total_test_deadline_ms:900000,configuration_source:'r16ListeningWorkloadV2:defined_consumer_second_pass',configured_questions:4,base_questions:2,defined_consumer_questions:2,discovered_questions:0,initial_base_inputs:4096,chunks:4,chunk_size:1024,selection_memory_cap_bytes:512*1024*1024,execution_cap_micro_usd:20000000,raw_storage:server.metrics(),lease_released_before_rr:true},
       measurement:{count:1,query:'bounded0326_literal_select14',snapshot_sha256:sha(snap.snapshot),parity:packetParity,client_wall_ms:clientWall,plan,track_functions:'all',search_path:activeSession.search_path,counter_scope:'same_backend_same_transaction',time_scope:'elapsed_function_time_including_possible_planning;not_CPU',parallel:{workers_planned:planned,workers_launched:workers,coverage:workers?'client_xact_only_workers_UNKNOWN':'no_workers_observed'}},
       function_catalog:allCatalog,function_before:before,function_after:after,function_deltas:deltas,default_witness:{before:witnessBefore,after:witnessAfter},
       unknowns:['missing_function_rows_are_UNKNOWN_not_zero;inlining_or_branch_possible','total_time_includes_children_do_not_sum_parents_and_children','self_time_and_total_time_are_elapsed_not_CPU','EXPLAIN_and_tracking_overhead_not_subtracted','planning_constant_folding_may_contribute_function_calls','TIMING_OFF_has_no_per_node_elapsed_times','no_H1_or_throughput_or_optimization_acceptance']};
     }),async()=>{if(!uncertainClients.has(c))assert.deepEqual(await session(c),originalSession,'ROLLBACK restores all SET LOCAL state');});
     assert.ok(observation);receipt={...observation,session_restored:true};
    }finally{releasePrefixClientV1(c);}
   },async()=>{await withSharedWireDefaultPostcheckV1(()=>server.close(),()=>rm(directory,{recursive:true,force:true}));});
  }}});
 assert.ok(receipt);return receipt;
}
export async function writePrefixFunctionProfileV1(receipt:PrefixFunctionProfileReceiptV1){
 const configured=process.env.R16_PREFIX_FUNCTION_PROFILE_EVIDENCE_DIR;assert.ok(configured,'evidence directory required');
 const root=await realpath(fileURLToPath(new URL('../../../',import.meta.url))),dir=resolve(root,configured),sub=relative(join(root,'.data'),dir);assert.ok(sub&&!sub.startsWith('..')&&!sub.startsWith('/'));
 await mkdir(dir,{recursive:true,mode:0o700});assert.equal(await realpath(dir),dir,'no evidence path symlink');
 const bytes=Buffer.from(JSON.stringify(receipt)+'\n');assert.ok(bytes.length<=1024*1024,'complete plan/counters receipt exceeds1MiB; no truncation');
 const fd=await open(join(dir,'prefix-function-profile.json'),'wx',0o600);try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}
 console.log('# prefix function profile RESULT '+JSON.stringify({contract:receipt.contract,status:receipt.status,diagnostic_only:true,h1_accepted:false,bytes:bytes.length,sha256:sha(bytes)}));
}
