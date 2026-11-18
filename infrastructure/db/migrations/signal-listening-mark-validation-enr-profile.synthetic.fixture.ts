import {createHash} from 'node:crypto';
import {mkdir,open,readFile,realpath} from 'node:fs/promises';
import {dirname,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {PoolClient} from 'pg';
import {flatPrefixLedgerSqlV1,withFlatPrefixFullFixtureV1} from './signal-listening-flat-prefix.synthetic.fixture';
import {sharedWireProposalsV1,type SharedWireFixtureV1} from './signal-listening-statement-shared-wire.fixture';
import {assertSharedWireDefaultRuntimeV1,withSharedWireDefaultPostcheckV1} from './signal-listening-statement-shared-wire.oracle';
import {boundedPopulationRootSetHashV1,sanitizeBoundedPopulationPlanV1} from './signal-listening-bounded-population-plan.synthetic.fixture';
import {captureStartupCallbackV1,closeStartupFactoryV1,assertStartupOwnedAbsentV1,startupErrorTreeV1,type StartupCallbackStateV1} from './signal-listening-startup-prefix.synthetic.fixture';
import {openR16CiPostgresV1,assertR16LocalPostgresPoolV1} from './signal-r16-local-pg.fixture';
import {captureR16SourceProvenanceV1} from '../../../scripts/r16/source-provenance';
export {sanitizeBoundedPopulationPlanV1};
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
function known(ok:unknown,code:string):asserts ok{if(!ok)throw new Error(code);}
const sourceSha='cabed81234f56cf2647368aab03be14817d8de99073929f0d255b2a1f1153cf5';
const functionName='r16_mark_validation_enr_probe_v1',triggerName='aaa_r16_mark_validation_probe',captureName='r16_mark_validation_enr_capture_v1';
export function extractMarkValidationEnrSourceV1(source:string){
 known(sha(source)===sourceSha,'mark_enr_source_mismatch');
 const batch=source.match(/batch_sql:=\$transition_batch\$([\s\S]*?)\$transition_batch\$/u);
 const validation=source.match(/EXECUTE format\(\$validation\$([\s\S]*?)\$validation\$,batch_sql\) INTO checked USING ([^;]+);/u);
 known(batch&&validation&&(validation[1]!.match(/%s/gu)??[]).length===1,'mark_enr_source_regions');
 const start=source.indexOf('WITH target_matches AS MATERIALIZED('),end=source.indexOf('\n END IF;',start);
 known(start>=0&&end>start,'mark_enr_targets_region');
 const binds=['target','r.workspace_id','owner.configuration_id','owner.map_id','r.entity_context_digest','root_ids','c.configuration_digest'] as const;
 known(validation[2]===binds.join(','),'mark_enr_bind_order');
 const batch_sql=batch[1]!,validation_sql=validation[1]!,targets_sql=source.slice(start,end),query_sql=validation_sql.replace('%s',batch_sql);
 known(batch_sql.includes('FULL JOIN listening_old_calls')&&batch_sql.includes("matched.old_status='reserved'")&&batch_sql.includes("(matched.new_call).status='submitting'")&&targets_sql.includes('call_owner.workspace_id=matched.workspace_id'),'mark_enr_native_transition_source');
 return{source_sha256:sourceSha,batch_sql,validation_sql,targets_sql,query_sql,query_sha256:sha(query_sql),binds};
}
/** The original store, Pool and concrete client retain their identities. Only
 * connect/release descriptors are temporarily replaced for ONE exclusive loan.
 * No SQL/driver result is intercepted and no caller receives a new authority. */
export function retainMarkValidationClientV1(database:{connect:unknown},client:{release(error?:Error|boolean):void}){
 const connectOwn=Object.getOwnPropertyDescriptor(database,'connect'),releaseOwn=Object.getOwnPropertyDescriptor(client,'release');
 known(!connectOwn||'value'in connectOwn,'mark_enr_connect_accessor');known(releaseOwn&&'value'in releaseOwn&&typeof releaseOwn.value==='function','mark_enr_release_descriptor');
 const originalRelease=releaseOwn.value as (error?:Error|boolean)=>void;
 let connectCalls=0,releaseRequests=0,ownerReleases=0,uncertain=false,active=false,borrowed=false,violation=false;
 let running:Promise<unknown>|undefined;
 const snapshot=()=>({connect_calls:connectCalls,release_requests:releaseRequests,owner_releases:ownerReleases,uncertain,active});
 const restore=()=>{if(connectOwn)Object.defineProperty(database,'connect',connectOwn);else Reflect.deleteProperty(database,'connect');Object.defineProperty(client,'release',releaseOwn);};
 return{
  snapshot,
  async run<T>(body:()=>Promise<T>):Promise<T>{
   known(!active&&connectCalls===0&&ownerReleases===0,'mark_enr_pin_reentry');active=true;
   let failed=false,primary:unknown,value:T|undefined;
   try{
    Object.defineProperty(database,'connect',{configurable:true,writable:true,value:(...args:unknown[])=>{
     if(args.length!==0||borrowed||connectCalls!==0){violation=true;uncertain=true;throw new Error('mark_enr_unexpected_connect');}connectCalls++;borrowed=true;return Promise.resolve(client);
    }});
    Object.defineProperty(client,'release',{...releaseOwn,value:(error?:Error|boolean)=>{releaseRequests++;if(!borrowed||releaseRequests!==1)violation=true;borrowed=false;if(error)uncertain=true;}});
    const execution:Promise<T>=Promise.resolve().then(body);running=execution;value=await execution;
    const completed=snapshot();known(completed.connect_calls===1&&completed.release_requests===1&&!borrowed&&!violation&&!uncertain,'mark_enr_pin_incomplete');
   }catch(error){uncertain=true;failed=true;primary=error;}
   try{restore();}catch(cleanup){uncertain=true;active=false;if(failed)throw new AggregateError([primary,cleanup],'mark_enr_pin_body_and_restore_failed',{cause:primary});throw cleanup;}
   active=false;if(failed)throw primary;return value as T;
  },
  async release(destroy=false){
   if(active&&running)await running.catch(()=>undefined);
   known(!active&&ownerReleases===0,'mark_enr_owner_release_invalid');ownerReleases++;originalRelease.call(client,destroy||uncertain);
  }
 };
}
export function markValidationSafeFailureV1(error:unknown):Error{
 const tree=startupErrorTreeV1(error),cause=Buffer.byteLength(JSON.stringify(tree))<=24576?tree:{truncated:true,root:{omitted:'safe_error_tree_over_limit'}};
 return new Error('mark_validation_enr_diagnostic_failed_see_safe_evidence',{cause});
}
const observationStages=['source_binding','fixture_setup','consumer_reserve','catalog_before','probe_install','probe_catalog','zero_target_control','native_mark','post_commit_state','capture_read','capture_identity','catalog_names','sanitizer','enr_scans','probe_summary','probe_cleanup','catalog_restore','requeue','requeue_state','client_release','lease_release','factory_cleanup','source_after','complete'] as const;
type MarkValidationObservationStageV1=typeof observationStages[number];
export function createMarkValidationObservationV1(){
 let stage:MarkValidationObservationStageV1='source_binding',failure:MarkValidationObservationStageV1|null=null;
 return{enter(next:MarkValidationObservationStageV1){known(observationStages.includes(next),'mark_enr_observation_stage');stage=next;},fail(){failure??=stage;},snapshot(){return{observation_stage:stage,failure_stage:failure};}};
}
/** Classify only the root JIT Generation shape; never read getters or emit values. */
export function markValidationRootGenerationKindV1(plan:unknown):'missing'|'number'|'object'|'other'|'unsafe'{
 try{
  if(!Array.isArray(plan)||Object.getPrototypeOf(plan)!==Array.prototype)return'unsafe';
  let value:unknown=plan;
  for(const key of ['0','JIT','Timing','Generation']){
   if(value===null||typeof value!=='object')return'other';
   const prototype=Object.getPrototypeOf(value);if(prototype!==Object.prototype&&prototype!==Array.prototype&&prototype!==null)return'unsafe';
   const field=Object.getOwnPropertyDescriptor(value,key);if(!field)return'missing';if(!('value'in field))return'unsafe';value=field.value;
  }
  if(typeof value==='number')return'number';
  if(value!==null&&typeof value==='object'&&!Array.isArray(value)){
   const prototype=Object.getPrototypeOf(value);return prototype===Object.prototype||prototype===null?'object':'unsafe';
  }
  return'other';
 }catch{return'unsafe';}
}
function probeFunctionSql(extracted:ReturnType<typeof extractMarkValidationEnrSourceV1>){
 return `CREATE FUNCTION public.${functionName}() RETURNS trigger LANGUAGE plpgsql VOLATILE SET search_path=public,extensions,pg_temp AS $r16_probe$
DECLARE targets uuid[];target uuid;r signal_labeling_runs;owner signal_listening_runs;c signal_listening_configurations;
 root_ids uuid[];batch_sql text;plan_json json;old_count integer;new_count integer;batch_count integer;
BEGIN
 ${extracted.targets_sql}
 IF targets IS NULL THEN RETURN NULL;END IF;
 IF cardinality(targets)<>1 THEN RAISE EXCEPTION 'mark_enr_target_count' USING ERRCODE='22023';END IF;
 SELECT count(*)::int INTO old_count FROM listening_old_calls;
 SELECT count(*)::int INTO new_count FROM listening_new_calls;
 IF old_count<>1000 OR new_count<>1000 THEN RAISE EXCEPTION 'mark_enr_transition_count' USING ERRCODE='22023';END IF;
 FOR target IN SELECT unnest(targets) LOOP
  SELECT * INTO r FROM signal_labeling_runs WHERE id=target;
  SELECT * INTO owner FROM signal_listening_runs WHERE run_id=target AND workspace_id=r.workspace_id;
  SELECT * INTO c FROM signal_listening_configurations WHERE id=owner.configuration_id;
  batch_sql:=$r16_batch$${extracted.batch_sql}$r16_batch$;
  EXECUTE format('SELECT count(*)::int,signal_listening_statement_roots_v1(array_agg((n.inputs->0->>''root_id'')::uuid)) FROM (%s) n',batch_sql)
   INTO batch_count,root_ids USING target;
  IF batch_count<>1000 OR cardinality(root_ids)<>1000 THEN RAISE EXCEPTION 'mark_enr_batch_count' USING ERRCODE='22023';END IF;
  EXECUTE 'EXPLAIN (ANALYZE,BUFFERS,TIMING ON,FORMAT JSON) '||format($r16_validation$${extracted.validation_sql}$r16_validation$,batch_sql)
   INTO plan_json USING ${extracted.binds.join(',')};
  INSERT INTO pg_temp.${captureName}(target,old_count,new_count,batch_count,root_count,query_sha256,plan_json,backend,transaction_id,statement_at,probe_snapshot)
   VALUES(target,old_count,new_count,batch_count,cardinality(root_ids),'${extracted.query_sha256}',plan_json,pg_backend_pid(),txid_current()::text,statement_timestamp(),pg_current_snapshot()::text);
 END LOOP;
 RETURN NULL;
END
$r16_probe$`;
}
const triggerSql=`CREATE TRIGGER ${triggerName} AFTER UPDATE ON public.signal_labeling_calls REFERENCING OLD TABLE AS listening_old_calls NEW TABLE AS listening_new_calls FOR EACH STATEMENT EXECUTE FUNCTION public.${functionName}()`;
const captureSql=`CREATE TEMP TABLE ${captureName}(target uuid PRIMARY KEY,old_count integer NOT NULL CHECK(old_count=1000),new_count integer NOT NULL CHECK(new_count=1000),batch_count integer NOT NULL CHECK(batch_count=1000),root_count integer NOT NULL CHECK(root_count=1000),query_sha256 text NOT NULL,plan_json json NOT NULL CHECK(octet_length(plan_json::text) BETWEEN 1 AND 1048576),backend integer NOT NULL,transaction_id text NOT NULL,statement_at timestamptz NOT NULL,probe_snapshot text NOT NULL) ON COMMIT PRESERVE ROWS`;
const triggerCatalogSql=`SELECT t.oid::text,t.tgfoid::text,t.tgname,t.tgenabled,t.tgtype,t.tgconstraint::text,t.tgdeferrable,t.tginitdeferred,t.tgattr::text,t.tgoldtable,t.tgnewtable,pg_get_triggerdef(t.oid) definition,
 p.prosrc,p.proowner::text,p.proacl::text,p.proconfig,p.prosecdef,p.provolatile
 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='public.signal_labeling_calls'::regclass ORDER BY t.tgname::text COLLATE "C"`;
async function triggerCatalog(c:PoolClient){const rows=(await c.query(triggerCatalogSql)).rows;return rows.map(({definition,prosrc,...r})=>({...r,definition_sha256:sha(definition),function_body_sha256:sha(prosrc)}));}
async function defaultCatalog(c:PoolClient){
 const checked=await assertSharedWireDefaultRuntimeV1(c);
 const rows=(await c.query(`SELECT p.oid::text,p.proname,p.prosrc,p.proowner::text,p.proacl::text,p.proconfig,p.prosecdef,p.provolatile,p.proisstrict,p.proparallel,p.proleakproof,p.proargtypes::text,p.prorettype::text,p.proretset
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.oid`)).rows;
 const functions=rows.filter(r=>r.proname!==functionName).map(({prosrc,...r})=>({...r,prosrc_sha256:sha(prosrc)}));
 return{checked,functions_sha256:sha(JSON.stringify(functions)),function_count:functions.length};
}
const same=(a:unknown,b:unknown,code:string)=>known(JSON.stringify(a)===JSON.stringify(b),code);
const gateNames=['source_binding','original_catalog_unchanged_on_install','probe_catalog_order','same_client_pin','selector_once','zero_target_control','cohort_transition_exact','probe_plan_once','enr_scans_exact','original_guard_commit_ack','post_commit_state_exact','catalog_restored','requeue_open_exposure_preserved','closure_confirmed'] as const;
export type MarkValidationEnrReceiptV1={contract:'r16-listening-mark-validation-enr-v1';status:'observed'|'failed';diagnostic_only:true;h1_accepted:false;cpu:'UNKNOWN';speedup_claim:false;gates:Record<typeof gateNames[number],boolean>}&Record<string,unknown>;
async function cohortStamp(c:PoolClient,f:SharedWireFixtureV1,ids:ReadonlyArray<string>){
 const row=(await c.query(`SELECT count(*)::int n,count(DISTINCT c.id)::int unique_ids,
 array_agg(c.id ORDER BY c.id) ids,array_agg(DISTINCT (c.inputs->0->>'root_id')::uuid ORDER BY (c.inputs->0->>'root_id')::uuid) roots,
 count(*) FILTER(WHERE c.provider_batch_id IS NOT NULL OR c.raw_sha256 IS NOT NULL OR c.raw_storage_key IS NOT NULL OR c.raw_size_bytes IS NOT NULL OR c.raw_storage_verified_at IS NOT NULL OR c.raw_storage_verified_key IS NOT NULL OR c.usage IS NOT NULL OR c.settled_micro_usd IS NOT NULL OR c.terminal_exposure_micro_usd<>0 OR c.results_applied OR c.results IS NOT NULL OR jsonb_array_length(c.inputs)<>1 OR jsonb_array_length(c.inputs->0->'question_keys')<>2)::int invalid,
 encode(sha256(convert_to(jsonb_agg(DISTINCT(c.inputs->0->>'input_digest') ORDER BY(c.inputs->0->>'input_digest'))::text,'UTF8')),'hex') input_digest_set_sha256,
 encode(sha256(convert_to(jsonb_agg(DISTINCT c.request_digest ORDER BY c.request_digest)::text,'UTF8')),'hex') request_digest_set_sha256,
 encode(sha256(convert_to(jsonb_agg(jsonb_build_array(c.id,c.inputs->0->'question_keys',c.inputs->0->'question_digests') ORDER BY c.id)::text,'UTF8')),'hex') selected_question_tuple_set_sha256,
 encode(sha256(convert_to(jsonb_agg(jsonb_build_array(c.id,c.inputs->0->'configuration_digest',c.inputs->0->'map_id',r.entity_context_digest) ORDER BY c.id)::text,'UTF8')),'hex') configuration_map_context_set_sha256,
 encode(sha256(convert_to(jsonb_agg(jsonb_build_array(c.id,c.run_id,c.workspace_id,c.request_digest,c.request,c.inputs,c.reserved_micro_usd,c.budget_date,c.budget_timezone) ORDER BY c.id)::text,'UTF8')),'hex') immutable_tuple_sha256
 FROM signal_labeling_calls c JOIN signal_labeling_runs r ON r.id=c.run_id AND r.workspace_id=c.workspace_id
 WHERE c.workspace_id=$1 AND c.run_id=$2 AND c.id=ANY($3::uuid[])`,[f.run.workspace_id,f.run.id,ids])).rows[0];
 known(row.n===1000&&row.unique_ids===1000&&row.invalid===0&&row.roots.length===1000,'mark_enr_cohort_shape');
 const statuses=Object.fromEntries((await c.query('SELECT status,count(*)::int n FROM signal_labeling_calls WHERE workspace_id=$1 AND run_id=$2 AND id=ANY($3::uuid[]) GROUP BY status ORDER BY status',[f.run.workspace_id,f.run.id,ids])).rows.map(r=>[r.status,r.n]));
 return{selected_call_count:row.n,call_set_sha256:boundedPopulationRootSetHashV1(row.ids),root_set_sha256:boundedPopulationRootSetHashV1(row.roots),input_digest_set_sha256:row.input_digest_set_sha256,request_digest_set_sha256:row.request_digest_set_sha256,selected_question_tuple_set_sha256:row.selected_question_tuple_set_sha256,configuration_map_context_set_sha256:row.configuration_map_context_set_sha256,immutable_tuple_sha256:row.immutable_tuple_sha256,statuses};
}
async function ledgerState(c:PoolClient,f:SharedWireFixtureV1,roots:ReadonlyArray<string>,consumers:boolean){
 const ledger=(await c.query(flatPrefixLedgerSqlV1,[f.run.workspace_id,f.run.id])).rows[0];
 same(ledger,{calls:consumers?2000:1000,applied:1000,roots:1000,synthetic_spend_micro_usd:'6000',reserved_micro_usd:consumers?'500000':'0',unknown_micro_usd:'0'},'mark_enr_ledger_state');
 const bases=(await c.query(`SELECT count(*)::int n,count(DISTINCT a.root_id)::int roots,
 count(*) FILTER(WHERE a.question_key NOT IN('voice','promotion') OR NOT(a.root_id=ANY($3::uuid[])))::int invalid,
 encode(sha256(convert_to(jsonb_agg(to_jsonb(a) ORDER BY a.root_id,a.question_key)::text,'UTF8')),'hex') answers_sha256
 FROM signal_listening_answers a WHERE a.workspace_id=$1 AND a.run_id=$2`,[f.run.workspace_id,f.run.id,roots])).rows[0];
 known(bases.n===2000&&bases.roots===1000&&bases.invalid===0,'mark_enr_base_answers');
 const corpus=(await c.query(`SELECT count(*)::int n,count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM signal_listening_answers a WHERE a.workspace_id=i.workspace_id AND a.run_id=$3 AND a.root_id=i.root_id AND a.question_key IN('voice','promotion')))::int no_base FROM signal_mass_labeling_items i WHERE i.workspace_id=$1 AND i.map_id=$2`,[f.run.workspace_id,f.map_id,f.run.id])).rows[0];
 known(corpus.n===32768&&corpus.no_base===31768,'mark_enr_corpus_state');
 const run=(await c.query('SELECT status,lease_token=$3::uuid AND lease_until>clock_timestamp() fresh FROM signal_labeling_runs WHERE workspace_id=$1 AND id=$2',[f.run.workspace_id,f.run.id,f.run.lease_token])).rows[0];
 known(run?.status==='running'&&run.fresh===true,'mark_enr_lease_state');
 return{base_calls:1000,base_answers:2000,base_answers_sha256:bases.answers_sha256,corpus_roots:32768,remaining_no_base_this_run:31768,settled_micro_usd_synthetic:6000,open_reserved_micro_usd:consumers?500000:0,unknown_exposure_micro_usd:0,total_settled_plus_open_micro_usd:consumers?506000:6000,run_status:'running'};
}
async function sourceWitness(){
 const all=await captureR16SourceProvenanceV1(repo),migrations=all.file_manifest.filter(r=>/^infrastructure\/db\/migrations\/(?:029[5-9]|03[0-2][0-9]|033[0-2])_.+\.sql$/u.test(r.path));
 known(migrations.length===38,'mark_enr_migration_inventory');return{head_sha:all.head_sha,source_tree_sha256:all.source_tree_sha256,tree_status_sha256:all.tree_status_sha256,migration38:migrations,harness:all.file_manifest.filter(r=>r.path.startsWith('scripts/r16/')||/^services\/workers\/src\/(?:workers\/signal-(?:jev|listening)|providers\/jev-streaming)/u.test(r.path))};
}
async function writeReceipt(directory:string,value:MarkValidationEnrReceiptV1){
 const dir=resolve(repo,directory),sub=relative(resolve(repo,'.data'),dir);known(sub&&!sub.startsWith('..')&&!sub.startsWith('/'),'mark_enr_evidence_path');
 const bytes=JSON.stringify(value)+'\n';known(Buffer.byteLength(bytes)<=2097152,'mark_enr_evidence_bytes');
 await mkdir(dir,{recursive:true,mode:0o700});known(await realpath(dir)===dir,'mark_enr_evidence_symlink');const file=await open(resolve(dir,'mark-validation-enr.json'),'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
}
export async function runMarkValidationEnrProfileV1(directory:string):Promise<MarkValidationEnrReceiptV1>{
 known(process.env.GITHUB_ACTIONS==='true','mark_enr_owned_ci_only');
 const start=performance.now(),clock=()=>performance.now()-start,callback:StartupCallbackStateV1={entered:false,complete:false,failed:false};
 const report:MarkValidationEnrReceiptV1={contract:'r16-listening-mark-validation-enr-v1',status:'failed',diagnostic_only:true,h1_accepted:false,cpu:'UNKNOWN',speedup_claim:false,gates:Object.fromEntries(gateNames.map(n=>[n,false])) as MarkValidationEnrReceiptV1['gates'],synthetic_native_mark_executed:false,actual_full_workload_cohort:false,assert_raw_ready_original_preserved:false,provider_http_calls:0,safe_failure_code_tree:null,function_counters:'UNKNOWN_not_collected',
 unknowns:['Probe is a separate pre-guard reexecution and warms the original','Original guard snapshot is UNOBSERVABLE; no same-snapshot claim','EXPLAIN does not return either validation flag values','All instrumented time is elapsed, not CPU or original Mark/FULL attribution','No throughput, H1, causal subtraction, speedup or optimization acceptance'],bounds:{setup_ms:1800000,mark_read_ms:120000,total_ms:1920000,job_minutes:40,plan_nodes:512,plan_depth:32,plan_bytes:1048576,json_bytes:2097152}};
 let own:{name:string;oid:string}|null=null,absence:'UNKNOWN'|true='UNKNOWN',normal=false,failed=false,primary:unknown,rootHash='',runBinding:{workspace:string;id:string}|undefined;
 let boundSource:Awaited<ReturnType<typeof sourceWitness>>|undefined,markReadStarted:number|undefined;
 const observation=createMarkValidationObservationV1();
 const observeFailure=()=>{observation.fail();if(markReadStarted!==undefined&&report.mark_read_ms===undefined)report.mark_read_ms=clock()-markReadStarted;};
 try{
  const beforeSource=await sourceWitness(),source=await readFile(new URL('./0331_signal_listening_statement_payload.sql',import.meta.url),'utf8'),extracted=extractMarkValidationEnrSourceV1(source);
  boundSource=beforeSource;report.source_before=beforeSource;report.source0331_sha256=extracted.source_sha256;
  const storeSource=await readFile(new URL('../signal-labeling-runs.ts',import.meta.url),'utf8'),methodStart=storeSource.indexOf('async markSubmittingSelected('),methodEnd=storeSource.indexOf('\n    }:{}),',methodStart),method=storeSource.slice(methodStart,methodEnd);
  known(methodStart>=0&&methodEnd>methodStart&&method.indexOf('await options.assertRawReady?.();')>=0&&method.indexOf('await options.assertRawReady?.();')<method.indexOf('const c=await db.connect()'),'mark_enr_original_raw_ready_source');
  const update="UPDATE signal_labeling_calls SET status='submitting',updated_at=now() WHERE run_id=$1 AND id=ANY($2::uuid[]) AND status='reserved' RETURNING id";
  known(method.includes('`'+update+'`'),'mark_enr_original_update_source');report.node_store_source_sha256=sha(storeSource);report.original_update_sha256=sha(update);
  observation.enter('fixture_setup');await closeStartupFactoryV1(callback,async()=>{
   await withFlatPrefixFullFixtureV1({
    bounded:{
     async callback(database,body){await captureStartupCallbackV1(callback,async()=>{
      const row=(await database.query('SELECT current_database() name,(SELECT oid::text FROM pg_database WHERE datname=current_database()) oid')).rows[0];
      known(/^noisia_mfp_recovery_[a-f0-9]{32}$/u.test(row.name)&&/^\d+$/u.test(row.oid),'mark_enr_owned_database');own={name:row.name,oid:row.oid};await body();
      observation.enter('lease_release');known(runBinding,'mark_enr_missing_run_binding');const released=(await database.query('SELECT status,lease_token IS NULL AND lease_until IS NULL released FROM signal_labeling_runs WHERE workspace_id=$1 AND id=$2',[runBinding.workspace,runBinding.id])).rows[0];known(released?.status==='running'&&released.released===true,'mark_enr_lease_release_unconfirmed');report.lease_release_confirmed=true;observation.enter('factory_cleanup');
     });},
     roster(roots){known(roots.length===1000,'mark_enr_base_roster');rootHash=boundedPopulationRootSetHashV1(roots);},
     async state(){throw new Error('mark_enr_unexpected_readonly_state');}
    },
    async install(){throw new Error('mark_enr_unexpected_population_install');},
    async read(){throw new Error('mark_enr_unexpected_population_read');},
    async markValidation(f,storageMetrics){
     known(clock()<=1800000,'mark_enr_base_setup_soft_cap');runBinding={workspace:f.run.workspace_id,id:f.run.id};
     const roots=f.inputs.map(i=>i.root_id);known(boundedPopulationRootSetHashV1(roots)===rootHash,'mark_enr_base_roster_changed');
     const raw=await f.database.connect();let pin:ReturnType<typeof retainMarkValidationClientV1>|undefined,released=false;
     try{
      pin=retainMarkValidationClientV1(f.database,raw);
      observation.enter('consumer_reserve');const baseState=await ledgerState(raw,f,roots,false);report.base_state=baseState;
      const inputs=await f.store.inputs(f.run,{max_rows:1000,max_working_bytes:512*1024*1024,on_oversize:'error'});
      const expectedKeys=f.configuration.questions.filter(q=>q.scope==='consumer_category').map(q=>q.key).sort();
      known(inputs.length===1000&&expectedKeys.length===2&&boundedPopulationRootSetHashV1(inputs.map(i=>i.root_id))===rootHash&&inputs.every(i=>JSON.stringify([...i.question_keys].sort())===JSON.stringify(expectedKeys)&&Object.keys(i.scope_basis).length===2),'mark_enr_native_consumer_inputs');
      const calls=await f.store.reserve(f.run,sharedWireProposalsV1({...f,inputs},500));known(calls.length===1000&&calls.every(c=>c.status==='reserved')&&new Set(calls.map(c=>c.id)).size===1000,'mark_enr_native_reservations');
      const ids=calls.map(c=>c.id),pre=await cohortStamp(raw,f,ids),preLedger=await ledgerState(raw,f,roots,true);same(pre.statuses,{reserved:1000},'mark_enr_pre_status');known(pre.root_set_sha256===rootHash&&preLedger.base_answers_sha256===baseState.base_answers_sha256,'mark_enr_reserve_changed_base');
      report.setup_ms=clock();known(Number(report.setup_ms)<=1800000,'mark_enr_setup_soft_cap');const markStart=clock();markReadStarted=markStart;
      observation.enter('catalog_before');const defaultBefore=await defaultCatalog(raw),triggersBefore=await triggerCatalog(raw);report.catalog_before_sha256=sha(JSON.stringify({defaults:defaultBefore,triggers:triggersBefore}));
      known(!triggersBefore.some(t=>t.tgname===triggerName)&&(await raw.query('SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=\'public\' AND p.proname=$1',[functionName])).rows[0].n===0,'mark_enr_probe_name_collision');
      known((await raw.query('SELECT count(*)::int n FROM pg_class WHERE relnamespace=pg_my_temp_schema() AND relname=$1',[captureName])).rows[0].n===0,'mark_enr_capture_collision');
      known(triggersBefore.length>0&&triggersBefore.every(t=>t.tgenabled==='O'),'mark_enr_original_trigger_enablement');
      const originalStatements=triggersBefore.filter(t=>t.tgtype===16&&t.tgenabled==='O').map(t=>t.tgname);same(originalStatements,['listening_statement_money_update','mass_labeling_scoped_update_total'],'mark_enr_original_statement_order');
      observation.enter('probe_install');const ddl=probeFunctionSql(extracted);await raw.query(captureSql);await raw.query(ddl);await raw.query(`REVOKE ALL ON FUNCTION public.${functionName}() FROM PUBLIC`);await raw.query(triggerSql);
      observation.enter('probe_catalog');const installed=await triggerCatalog(raw),probe=installed.filter(t=>t.tgname===triggerName);same(installed.filter(t=>t.tgname!==triggerName),triggersBefore,'mark_enr_original_triggers_changed');same(await defaultCatalog(raw),defaultBefore,'mark_enr_original_functions_changed');report.gates.original_catalog_unchanged_on_install=true;
      known(probe.length===1&&probe[0].tgtype===16&&probe[0].tgenabled==='O'&&probe[0].tgconstraint==='0'&&!probe[0].tgdeferrable&&!probe[0].tginitdeferred&&probe[0].tgattr===''&&probe[0].tgoldtable==='listening_old_calls'&&probe[0].tgnewtable==='listening_new_calls'&&!probe[0].prosecdef&&probe[0].provolatile==='v'&&JSON.stringify(probe[0].proconfig)===JSON.stringify(['search_path=public, extensions, pg_temp']),'mark_enr_probe_attributes');
      const privateFn=(await raw.query(`SELECT p.prosrc,p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) owner_ci,
       (SELECT bool_and(a.grantee=p.proowner AND a.grantor=p.proowner AND a.privilege_type='EXECUTE' AND NOT a.is_grantable) FROM aclexplode(p.proacl) a) private_acl
       FROM pg_proc p WHERE p.oid=$1::oid`,[probe[0].tgfoid])).rows[0];
      known(privateFn.owner_ci===true&&privateFn.private_acl===true&&privateFn.prosrc===ddl.split('AS $r16_probe$')[1]!.split('$r16_probe$')[0],'mark_enr_probe_function_identity');
      same(installed.filter(t=>t.tgtype===16&&t.tgenabled==='O').map(t=>t.tgname),[triggerName,...originalStatements],'mark_enr_probe_order');report.catalog_installed_sha256=sha(JSON.stringify(installed));report.gates.probe_catalog_order=true;
      observation.enter('zero_target_control');await raw.query('UPDATE public.signal_labeling_calls SET updated_at=updated_at WHERE false');known((await raw.query(`SELECT count(*)::int n FROM pg_temp.${captureName}`)).rows[0].n===0,'mark_enr_zero_target_captured');report.gates.zero_target_control=true;
      const sessionBefore=(await raw.query("SELECT pg_backend_pid()::text backend,current_setting('session_replication_role') replication_role,current_setting('jit') jit,current_setting('jit_above_cost') jit_above_cost,current_setting('jit_inline_above_cost') jit_inline_above_cost,current_setting('jit_optimize_above_cost') jit_optimize_above_cost")).rows[0],backend=sessionBefore.backend;
      known(sessionBefore.replication_role==='origin'&&['on','off'].includes(sessionBefore.jit)&&['jit_above_cost','jit_inline_above_cost','jit_optimize_above_cost'].every(k=>/^-?\d+(?:\.\d+)?$/u.test(sessionBefore[k])),'mark_enr_session_settings');await f.store.renew(f.run);
      known(typeof f.store.markSubmittingSelected==='function','mark_enr_native_mark_missing');let selected=0;
      observation.enter('native_mark');const returned=await pin.run(()=>f.store.markSubmittingSelected!(f.run,()=>{selected++;known(selected===1,'mark_enr_selector_replayed');return calls;}));
      report.gates.original_guard_commit_ack=true;report.synthetic_native_mark_executed=true;report.assert_raw_ready_original_preserved=true;report.pool_connect_borrow_count=pin.snapshot().connect_calls;
      known(selected===1&&returned.length===calls.length&&returned.every((c,i)=>c===calls[i]&&c.status==='reserved'),'mark_enr_selector_return');report.gates.selector_once=true;report.selector_return_statuses={reserved:returned.length};
      observation.enter('post_commit_state');const sessionAfter=(await raw.query("SELECT pg_backend_pid()::text backend,current_setting('session_replication_role') replication_role,current_setting('jit') jit,current_setting('jit_above_cost') jit_above_cost,current_setting('jit_inline_above_cost') jit_inline_above_cost,current_setting('jit_optimize_above_cost') jit_optimize_above_cost")).rows[0];same(sessionAfter,sessionBefore,'mark_enr_backend_or_settings_changed');report.gates.same_client_pin=true;
      const post=await cohortStamp(raw,f,ids),postLedger=await ledgerState(raw,f,roots,true);const {statuses:preStatus,...preIdentity}=pre,{statuses:postStatus,...postIdentity}=post;same(postIdentity,preIdentity,'mark_enr_transition_identity');same(postStatus,{submitting:1000},'mark_enr_post_status');same(postLedger,preLedger,'mark_enr_post_ledger');report.gates.cohort_transition_exact=true;report.gates.post_commit_state_exact=true;report.post_commit_status_counts=postStatus;
      observation.enter('capture_read');const capture=(await raw.query(`SELECT target,old_count,new_count,batch_count,root_count,query_sha256,plan_json,backend::text,transaction_id,statement_at,probe_snapshot FROM pg_temp.${captureName}`)).rows;
      report.capture_context={capture_count:capture.length,expected_query_sha256:extracted.query_sha256,root_jit_generation_kind:capture.length===1?markValidationRootGenerationKindV1(capture[0].plan_json):'missing'};
      observation.enter('capture_identity');known(capture.length===1&&capture[0].target===f.run.id&&capture[0].old_count===1000&&capture[0].new_count===1000&&capture[0].batch_count===1000&&capture[0].root_count===1000&&capture[0].query_sha256===extracted.query_sha256&&capture[0].backend===backend,'mark_enr_capture_identity');
      observation.enter('catalog_names');const identifiers=new Set([...source.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gu),...source.matchAll(/\b([a-z_][a-z0-9_]*) AS(?: MATERIALIZED)?\(/gu),...source.matchAll(/\b([a-z_][a-z0-9_]*)\(/gu)].map(m=>m[1]!));
      const catalogNames=(await raw.query(`SELECT c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND
       (c.relname=ANY($1::text[]) OR c.oid IN(SELECT i.indexrelid FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid WHERE t.relname=ANY($1::text[]) AND t.relnamespace=n.oid))`,[[...identifiers]])).rows;for(const r of catalogNames)identifiers.add(r.name);
      observation.enter('sanitizer');const sanitized=sanitizeBoundedPopulationPlanV1(capture[0].plan_json,identifiers),enrCounts=new Map<string,number>(),enrScans:Array<Record<string,unknown>>=[];
      observation.enter('enr_scans');const visit=(node:Record<string,unknown>)=>{if(node['Node Type']==='Named Tuplestore Scan'){const name=node['Tuplestore Name'] as string;known(name==='listening_old_calls'||name==='listening_new_calls','mark_enr_scan_name');enrCounts.set(name,(enrCounts.get(name)??0)+1);enrScans.push({name,actual_rows:node['Actual Rows']??'UNKNOWN',actual_loops:node['Actual Loops']??'UNKNOWN',execution:node['Actual Loops']===0?'not_executed':typeof node['Actual Loops']==='number'?'observed':'UNKNOWN'});}for(const child of(node.Plans as Record<string,unknown>[]|undefined)??[])visit(child);};visit(sanitized.plan.Plan as Record<string,unknown>);
      known(enrCounts.size===2&&enrCounts.get('listening_old_calls')===1&&enrCounts.get('listening_new_calls')===1,'mark_enr_scans_not_exact');report.gates.enr_scans_exact=true;report.gates.probe_plan_once=true;
      observation.enter('probe_summary');report.probe={target_count:1,batch_transition_count:1000,old_count:1000,new_count:1000,root_count:1000,old_status:'reserved',new_status:'submitting',explain_count:1,plain_warmups:0,enr_node_type:'Named Tuplestore Scan',enr_names_exactly_once:['listening_old_calls','listening_new_calls'],enr_scans:enrScans,query_sha256:extracted.query_sha256,...sanitized,backend_sha256:sha(backend),transaction_id_sha256:sha(capture[0].transaction_id),probe_snapshot_sha256:sha(capture[0].probe_snapshot),original_guard_snapshot:'UNOBSERVABLE',settings:{jit:sessionBefore.jit,jit_above_cost:sessionBefore.jit_above_cost,jit_inline_above_cost:sessionBefore.jit_inline_above_cost,jit_optimize_above_cost:sessionBefore.jit_optimize_above_cost,session_replication_role:'origin'}};
      observation.enter('probe_cleanup');await raw.query(`DROP TRIGGER ${triggerName} ON public.signal_labeling_calls`);await raw.query(`DROP FUNCTION public.${functionName}()`);await raw.query(`DROP TABLE pg_temp.${captureName}`);
      observation.enter('catalog_restore');const restored=await triggerCatalog(raw),defaultsAfter=await defaultCatalog(raw);same(restored,triggersBefore,'mark_enr_triggers_not_restored');same(defaultsAfter,defaultBefore,'mark_enr_functions_not_restored');
      known((await raw.query('SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=\'public\' AND p.proname=$1',[functionName])).rows[0].n===0,'mark_enr_function_not_removed');report.catalog_after_restore_sha256=sha(JSON.stringify({defaults:defaultsAfter,triggers:restored}));same(report.catalog_after_restore_sha256,report.catalog_before_sha256,'mark_enr_catalogue_restore_hash');report.gates.catalog_restored=true;
      observation.enter('requeue');await f.store.renew(f.run);await f.store.requeueUnsent!(f.run,calls);observation.enter('requeue_state');const requeued=await cohortStamp(raw,f,ids);same(requeued.statuses,{reserved:1000},'mark_enr_requeue_status');const {statuses:requeueStatus,...requeueIdentity}=requeued;same(requeueIdentity,preIdentity,'mark_enr_requeue_identity');same(await ledgerState(raw,f,roots,true),preLedger,'mark_enr_requeue_exposure');report.gates.requeue_open_exposure_preserved=true;
      report.requeue_status_counts=requeueStatus;report.selected_call_count=pre.selected_call_count;report.root_set_sha256=pre.root_set_sha256;report.input_digest_set_sha256=pre.input_digest_set_sha256;report.request_digest_set_sha256=pre.request_digest_set_sha256;report.selected_question_tuple_set_sha256=pre.selected_question_tuple_set_sha256;report.configuration_map_context_set_sha256=pre.configuration_map_context_set_sha256;
      report.settled_micro_usd_synthetic=postLedger.settled_micro_usd_synthetic;report.open_reserved_micro_usd=postLedger.open_reserved_micro_usd;report.unknown_exposure_micro_usd=postLedger.unknown_exposure_micro_usd;report.loopback_storage_metrics=storageMetrics();report.pin=pin.snapshot();
      report.mark_read_ms=clock()-markStart;known(Number(report.mark_read_ms)<=120000,'mark_enr_read_soft_cap');
     }catch(error){observeFailure();observation.enter('client_release');await withSharedWireDefaultPostcheckV1(async()=>{throw error;},async()=>{released=true;if(pin)await pin.release(true);else raw.release(true);});}
     finally{if(!released){observation.enter('client_release');released=true;if(pin)await pin.release();else raw.release(true);}}
     known(pin&&pin.snapshot().owner_releases===1,'mark_enr_release_count');report.pin=pin.snapshot();observation.enter('lease_release');
    }
   },'mark_validation_enr_1000_of_32768');normal=true;
  },async()=>{
   if(!normal)observeFailure();observation.enter('factory_cleanup');if(!own)return;const admin=await openR16CiPostgresV1();await withSharedWireDefaultPostcheckV1(async()=>{assertR16LocalPostgresPoolV1(admin);const c=await admin.connect();await withSharedWireDefaultPostcheckV1(async()=>{await assertStartupOwnedAbsentV1(c,own!,()=>undefined);absence=true;},async()=>{c.release();});},()=>admin.end());
  });
  observation.enter('source_after');report.source_after=await sourceWitness();same(report.source_after,beforeSource,'mark_enr_source_changed');report.gates.source_binding=true;known((absence as true|'UNKNOWN')===true&&normal&&callback.complete,'mark_enr_cleanup_unconfirmed');report.gates.closure_confirmed=true;
  known(clock()<=1920000,'mark_enr_total_soft_cap');known(Object.values(report.gates).every(value=>value===true),'mark_enr_gate_incomplete');report.status='observed';observation.enter('complete');
 }catch(error){observeFailure();failed=true;primary=error;report.safe_failure_code_tree=startupErrorTreeV1(error);}
 if(!report.source_after){try{observation.enter('source_after');const after=await sourceWitness();report.source_after=after;if(boundSource){same(after,boundSource,'mark_enr_source_changed_after_failure');report.gates.source_binding=true;}}catch(afterError){observeFailure();if(failed)primary=new AggregateError([primary,afterError],'mark_enr_primary_and_source_postcheck_failed',{cause:primary});else{failed=true;primary=afterError;report.status='failed';}report.safe_failure_code_tree=startupErrorTreeV1(primary);}}
 Object.assign(report,observation.snapshot());report.total_ms=clock();report.callback_complete=callback.complete;report.factory_returned_normally=normal;report.own_database_absent=absence;report.name_oid_sha256=own?sha(JSON.stringify(own)):'UNKNOWN';
 try{await writeReceipt(directory,report);}catch(publication){throw markValidationSafeFailureV1(failed?new AggregateError([primary,publication],'mark_enr_primary_and_publication_failed',{cause:primary}):publication);}
 if(failed)throw markValidationSafeFailureV1(primary);return report;
}
