import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,open,readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve,join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import type {loadSignalListeningConfigurationWithClientV1} from '../../infrastructure/db/signal-listening-configuration';
import {openR16CiPostgresV1} from '../../infrastructure/db/migrations/signal-r16-local-pg.fixture';
import {runMassLabelingAcceptanceFixtureV1} from '../../infrastructure/db/migrations/signal-mass-labeling-acceptance.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../../infrastructure/db/signal-listening-configuration';
import {quoteSignalListeningPreparationV1} from '../../infrastructure/db/signal-listening-preparation';
import {r16ListeningWorkloadV2} from '../r16/listening-workload';
import {captureR16SourceProvenanceV1} from '../r16/source-provenance';

const columns=['root_id','input_digest','body','published_at','platform','question_key','question_digest','definition','wire','candidate','scope_state','answer','cache_call_id','scope_basis'];
const relations=['mentions','signal_mention_import_memberships','signal_mass_labeling_items','signal_listening_configurations','signal_listening_questions','signal_listening_answers'];
export function coldListeningDiagnosticModeV1(roots:number){
 assert.ok(roots===1002||roots===32768,'r16_cold_plan_root_count_invalid');
 return roots===1002?'controlled_before_after_analyze' as const:'plan_only_before_quote' as const;
}
export function assertColdListeningDiagnosticEnvironmentV1(env:NodeJS.ProcessEnv){
 assert.equal(env.GITHUB_ACTIONS,'true','r16_cold_plan_requires_real_ci');
 assert.equal(env.NOISIA_R16_LOCAL_PG_LAB,'r16-benchmark-pg17','r16_cold_plan_owned_lab_required');
 assert.equal(env.NOISIA_R16_NATIVE_FIXTURE_PG,'true','r16_cold_plan_native_fixture_required');
 assert.equal(env.NOISIA_SIGNAL_LISTENING_ENABLED,'true','r16_cold_plan_listening_required');
 const url=new URL(env.DATABASE_URL??'');
 assert.equal(url.protocol,'postgresql:');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/noisia_mfp_ci');
 assert.equal(url.username,'postgres');assert.ok(url.port);assert.equal(url.search,'');assert.equal(url.hash,'');
 for(const key of ['ANTHROPIC_API_KEY','TYPESAFE_API_KEY','VOYAGE_API_KEY'])assert.ok(!env[key]?.trim(),'r16_cold_plan_real_provider_key_forbidden');
}
/** Read the actual deployed full arm, rather than a historical SQL fixture. */
export function extractColdListeningFullArmV1(source:string){
 const body=/RETURN QUERY EXECUTE \$population\$\s*([\s\S]*?)\$population\$ USING w,cid,mid,ctx,roots,purpose;/u.exec(source)?.[1];
 assert.ok(body&&body.trimStart().startsWith('WITH eligible_batches AS MATERIALIZED('),'r16_cold_plan_full_arm_unrecognized');
 const types=['uuid','uuid','uuid','text','uuid[]','text'];
 // EXPLAIN utility parameters do not inherit the native function signature.
 return body.replace(/\$([1-6])(?![0-9:]|\s*::)/gu,(_match,index:string)=>`$${index}::${types[Number(index)-1]}`);
}
const instrumentFiles=['scripts/r16-diagnostics/cold-listening-plan-diagnostic.mts','scripts/r16-diagnostics/cold-listening-plan-diagnostic.test.mts','.github/workflows/r16-cold-plan-diagnostic.yml'];
const execute=promisify(execFile);
export async function captureColdDiagnosticInstrumentV1(repository:string){
 const git=async(args:string[])=>(await execute('git',args,{cwd:repository})).stdout.trimEnd();
 const head=await git(['rev-parse','HEAD']),status=await git(['status','--porcelain=v1','--untracked-files=all','--',...instrumentFiles]);
 const files=await Promise.all(instrumentFiles.map(async path=>{
  const tracked=await git(['ls-files','--error-unmatch','--',path]).then(()=>true,()=>false);
  const bytes=await readFile(join(repository,path)).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  return{path,tracked,exists:bytes!==null,sha256:bytes===null?null:'sha256:'+createHash('sha256').update(bytes).digest('hex')};
 }));
 return{contract_version:'r16-cold-diagnostic-instrument-v1',head,status,files};
}
export function assertColdDiagnosticInstrumentCleanV1(manifest:Awaited<ReturnType<typeof captureColdDiagnosticInstrumentV1>>){
 assert.equal(manifest.status,'','r16_cold_plan_instrument_dirty');
 assert.ok(manifest.files.every(file=>file.tracked&&file.exists),'r16_cold_plan_instrument_untracked_or_missing');
}
export function assertColdDiagnosticInstrumentUnchangedV1(before:Awaited<ReturnType<typeof captureColdDiagnosticInstrumentV1>>,after:Awaited<ReturnType<typeof captureColdDiagnosticInstrumentV1>>){
 assertColdDiagnosticInstrumentCleanV1(before);assertColdDiagnosticInstrumentCleanV1(after);
 assert.deepEqual(after,before,'r16_cold_plan_instrument_changed');
}
export type ColdDiagnosticObservationV1<T>={state:'complete';elapsed_ms:number;value:T}|{state:'censored';elapsed_ms:number;sqlstate:'57014';statement_timeout_ms:15000};
export async function observeColdDiagnosticV1<T>(run:()=>Promise<T>):Promise<ColdDiagnosticObservationV1<T>>{
 const started=performance.now();try{const value=await run();return{state:'complete',elapsed_ms:performance.now()-started,value};}
 catch(error){if(typeof error==='object'&&error!==null&&'code'in error&&error.code==='57014')return{state:'censored',elapsed_ms:performance.now()-started,sqlstate:'57014',statement_timeout_ms:15000};throw error;}
}
export function compareColdDiagnosticObservationsV1<T>(observations:Array<{label:string;observation:ColdDiagnosticObservationV1<T>}>){
 const complete=observations.filter(item=>item.observation.state==='complete');
 for(const item of complete.slice(1))assert.deepEqual(item.observation.state==='complete'?item.observation.value:undefined,complete[0]!.observation.state==='complete'?complete[0]!.observation.value:undefined,'r16_cold_plan_complete_observation_changed');
 return{status:complete.length>=2?'verified_complete_observations':'unavailable_censored',equal:complete.length>=2?true:null,
  compared_labels:complete.map(item=>item.label),censored_labels:observations.filter(item=>item.observation.state==='censored').map(item=>item.label)};
}
const hash=(value:unknown)=>'sha256:'+createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function writePrivate(path:string,value:unknown){const f=await open(path,'wx',0o600);try{await f.writeFile(JSON.stringify(value,null,2)+'\n');await f.sync();}finally{await f.close();}}
const safeError=(error:unknown)=>({code:typeof error==='object'&&error!==null&&'code'in error&&typeof error.code==='string'&&/^[a-zA-Z0-9_]{1,120}$/u.test(error.code)?error.code:'r16_cold_plan_diagnostic_failed'});
function progress(roots:number,phase:string){process.stdout.write(JSON.stringify({contract_version:'r16-cold-listening-plan-diagnostic-v1',roots,phase})+'\n');}
async function stats(c:Parameters<typeof loadSignalListeningConfigurationWithClientV1>[0]){
 return{captured_at:(await c.query('SELECT clock_timestamp()::text at')).rows[0]!.at,settings:(await c.query(`SELECT name,setting FROM pg_settings WHERE name IN('jit','jit_above_cost','jit_inline_above_cost','jit_optimize_above_cost','plan_cache_mode','default_statistics_target','enable_mergejoin','enable_hashjoin','enable_nestloop','work_mem') ORDER BY name`)).rows,
 tables:(await c.query(`SELECT stat.relname,rel.reltuples,rel.relpages,stat.n_live_tup,stat.n_mod_since_analyze,stat.last_analyze,stat.last_autoanalyze
  FROM pg_stat_user_tables stat JOIN pg_class rel ON rel.oid=stat.relid WHERE stat.schemaname='public' AND stat.relname=ANY($1::text[]) ORDER BY stat.relname`,[relations])).rows};
}
export async function runColdListeningPlanDiagnosticV1(args:{root_count:number;output_directory:string}){
 const mode=coldListeningDiagnosticModeV1(args.root_count);assertColdListeningDiagnosticEnvironmentV1(process.env);
 const output=resolve(args.output_directory);assert.match(output,/\/\.data\/piloto-masivo\/r16(?:\/|$)/u,'r16_cold_plan_private_output_required');
 const repository=resolve(fileURLToPath(new URL('../..',import.meta.url))),instrument=await captureColdDiagnosticInstrumentV1(repository);assertColdDiagnosticInstrumentCleanV1(instrument);
 const source=await captureR16SourceProvenanceV1(repository);
 assert.equal(source.tree_status_sha256,'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855','r16_cold_plan_source_must_be_clean');
 const admin=await openR16CiPostgresV1();try{
  const counts=(await admin.query(`SELECT (SELECT count(*)::int FROM mentions) roots,(SELECT count(*)::int FROM signal_labeling_calls) calls,
   (SELECT count(*)::int FROM signal_listening_configurations) configurations`)).rows[0];
  assert.deepEqual(counts,{roots:0,calls:0,configurations:0},'r16_cold_plan_requires_separate_empty_lab');
 }finally{await admin.end();}
 const directory=join(output,'cold-listening-plan-diagnostic-'+randomUUID());await mkdir(directory,{recursive:true,mode:0o700});
 await writePrivate(join(directory,'preregistration.json'),{source,instrument,root_count:args.root_count,mode,statement_timeout_ms:15000,real_provider_calls:0,
  acceptance:'diagnostic_only_not_capacity',analyze_relations:mode==='controlled_before_after_analyze'?relations.slice(0,3):[],
  limitations:['This separate fresh CI lab is not a calibration or capacity run.','32768 mode stops before the first native full quote or row census.','ANALYZE changes only planner statistics in this new synthetic lab, never production.']});
 progress(args.root_count,'fixture_start');
 try{await runMassLabelingAcceptanceFixtureV1('product-recovery',{benchmark:{root_count:args.root_count,execution_cap_micro_usd:20000000,
  import_batch_size:512,preparation_page_size:100,embedding_page_limit:264,beforeProcessing:async f=>{
   // Match H1's fixture-owned zero-call legacy cancellation, never another run.
   const canceled=await f.database.query(`UPDATE signal_labeling_runs r SET status='canceled' WHERE r.id=$1 AND r.workspace_id=$2
    AND r.status='queued' AND NOT EXISTS(SELECT 1 FROM signal_labeling_calls c WHERE c.run_id=r.id) RETURNING r.id`,[f.run_id,f.workspace_id]);assert.equal(canceled.rows.length,1);
   const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
   const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:r16ListeningWorkloadV2('defined_consumer_second_pass').configuration});
   const context=(await f.database.query('SELECT entity_context_digest FROM signal_mass_labeling_maps WHERE id=$1 AND workspace_id=$2',[f.map_id,f.workspace_id])).rows[0]!.entity_context_digest;
   const scope=[f.workspace_id,cfg.id,f.map_id,context],parameters=[...scope,null,'llm-processing'];
   const c=await f.database.connect();try{
    await c.query('SET statement_timeout=15000');
    const deployed=(await c.query(`SELECT oid::text,prosrc,provolatile,prosecdef,proconfig,proacl FROM pg_proc
     WHERE oid='signal_listening_population_roots_v1(uuid,uuid,uuid,text,uuid[],text)'::regprocedure`)).rows[0]!;
    const expanded=extractColdListeningFullArmV1(deployed.prosrc);
    const expansion=`SELECT * FROM (${expanded}) population(${columns.join(',')})`;
    const native='SELECT * FROM signal_listening_population_roots_v1($1::uuid,$2::uuid,$3::uuid,$4::text,NULL::uuid[],\'llm-processing\') ORDER BY root_id,question_key';
    const quote='SELECT COALESCE(sum(length(p.body)+length(p.wire::text)+512),0)::text bytes FROM signal_listening_population_v1($1,$2,$3,$4) p WHERE p.scope_state<>\'excluded\' AND p.answer IS NULL';
    const expandedQuote=`SELECT COALESCE(sum(length(p.body)+length(p.wire::text)+512),0)::text bytes FROM (${expansion}) p WHERE p.scope_state<>'excluded' AND p.answer IS NULL`;
    const capturePlan=async(label:string)=>{
     const snapshot=await stats(c),caller=(await c.query('EXPLAIN (FORMAT JSON) '+quote,scope)).rows[0]!['QUERY PLAN'];
     const full=(await c.query('EXPLAIN (FORMAT JSON) '+expandedQuote,parameters)).rows[0]!['QUERY PLAN'];
     await writePrivate(join(directory,label+'-plans.json'),{snapshot,caller_plan:caller,expanded_native_full_plan:full,
      deployed_function:{...deployed,prosrc:undefined,body_sha256:hash(deployed.prosrc)},source,root_count:args.root_count});
     progress(args.root_count,label+'_plans_captured');
    };
    await capturePlan('cold');
    if(mode==='plan_only_before_quote'){await writePrivate(join(directory,'plan-only-terminal.json'),{mode,stopped_before_quote:true,analyze_performed:false});return;}
    // Public API first: do not warm the full reader with an EXPLAIN ANALYZE or
    // baseline census before measuring its actual first quote.
    const database=new Proxy(f.database,{get(target,key){if(key==='connect')return async()=>{const client=await target.connect();try{await client.query('SET statement_timeout=15000');return client;}catch(error){client.release();throw error;}};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
    const measureQuote=async(label:string)=>{
     const observation=await observeColdDiagnosticV1(()=>quoteSignalListeningPreparationV1({...access,database,configuration_id:cfg.id,map_id:f.map_id}));
     await writePrivate(join(directory,label+'-quote.json'),observation);return observation;
    };
    const readRows=async(label:string,text:string,values:unknown[])=>{
     const observation=await observeColdDiagnosticV1(async()=>{const rows=(await c.query({text,values,rowMode:'array'})).rows;
      assert.equal(rows.length,args.root_count*4);assert.ok(rows.every(row=>row.length===14));return rows;});
     await writePrivate(join(directory,label+'-rows.json'),observation.state==='complete'?{state:observation.state,elapsed_ms:observation.elapsed_ms,rows:observation.value.length,fields:14,native_sha256:hash(observation.value)}:observation);
     return observation;
    };
    const beforeQuote=await measureQuote('cold');
    const before=await readRows('native-before-analyze',native,scope);
    const direct=await readRows('expanded-before-analyze',expansion+' ORDER BY root_id,question_key',parameters);
    const expansionParity=compareColdDiagnosticObservationsV1([{label:'native-before',observation:before},{label:'expanded-before',observation:direct}]);
    await writePrivate(join(directory,'before-analyze-parity.json'),{expansion_parity:expansionParity,statistics_immediately_before_intervention:await stats(c)});
    // Keep a warm baseline even when an earlier observation was censored.
    await capturePlan('warm-before-analyze');
    const warmQuote=await measureQuote('warm-before-analyze');
    // Censored observations are durable too; the controlled intervention must
    // remain reachable when the cold query exceeds its unchanged 15 s bound.
    for(const relation of ['mentions','signal_mention_import_memberships','signal_mass_labeling_items'])await c.query('ANALYZE public.'+relation);
    await capturePlan('after-analyze');
    const afterQuote=await measureQuote('after-analyze');
    const after=await readRows('native-after-analyze',native,scope);
    const quotes=[{label:'cold',observation:beforeQuote},{label:'warm-before-analyze',observation:warmQuote},{label:'after-analyze',observation:afterQuote}];
    const quoteParity=compareColdDiagnosticObservationsV1(quotes),nativeParity=compareColdDiagnosticObservationsV1([{label:'native-before',observation:before},{label:'native-after',observation:after}]);
    const censored=quotes.some(item=>item.observation.state==='censored')||[before,direct,after].some(item=>item.state==='censored');
    assert.equal(hash((await c.query("SELECT prosrc FROM pg_proc WHERE oid='signal_listening_population_roots_v1(uuid,uuid,uuid,text,uuid[],text)'::regprocedure")).rows[0]!.prosrc),hash(deployed.prosrc));
    await writePrivate(join(directory,'terminal.json'),{mode,diagnostic_status:censored?'censored':'complete',
     expansion_parity:expansionParity,native_before_after_parity:nativeParity,quote_parity:quoteParity,
     function_body_unchanged:true,real_provider_calls:0,acceptance:'diagnostic_only_not_capacity',
     limitations:censored?['Timeouts are censored observations, not measured execution times or proof of equality.','Causal conclusions and row equality are limited to the complete observations explicitly identified.']:[]});
    progress(args.root_count,censored?'control_censored':'control_complete');
   }finally{await c.query('RESET statement_timeout').catch(()=>undefined);c.release();}
  }}});
  const after=await captureR16SourceProvenanceV1(repository);assert.equal(after.source_tree_sha256,source.source_tree_sha256);
  return{root_count:args.root_count,mode,artifact_tag:basename(directory),acceptance:'diagnostic_only_not_capacity'};
 }catch(error){await writePrivate(join(directory,'failure.json'),{error:safeError(error),real_provider_calls:0,acceptance:'diagnostic_only_not_capacity'});throw error;}
 finally{const instrumentAfter=await captureColdDiagnosticInstrumentV1(repository);await writePrivate(join(directory,'instrument-after.json'),instrumentAfter);assertColdDiagnosticInstrumentUnchangedV1(instrument,instrumentAfter);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=process.argv.slice(2);assert.ok(args.length===4&&args[0]==='--roots'&&args[2]==='--output-directory','r16_cold_plan_arguments_invalid');
  process.stdout.write(JSON.stringify(await runColdListeningPlanDiagnosticV1({root_count:Number(args[1]),output_directory:args[3]!}))+'\n');
 }catch{process.stderr.write('r16_cold_plan_diagnostic_failed; inspect private synthetic artifacts\n');process.exitCode=1;}
}
