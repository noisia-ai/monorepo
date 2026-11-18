import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,open,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Pool,PoolClient} from 'pg';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {flatPrefixLedgerSqlV1} from './signal-listening-flat-prefix.synthetic.fixture';
import {captureStartupCallbackV1,closeStartupFactoryV1,assertStartupOwnedAbsentV1,startupErrorTreeV1,type StartupCallbackStateV1} from './signal-listening-startup-prefix.synthetic.fixture';
import {withSharedWireDefaultPostcheckV1} from './signal-listening-statement-shared-wire.oracle';
import {openR16CiPostgresV1,assertR16LocalPostgresPoolV1} from './signal-r16-local-pg.fixture';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {prepareSignalListeningV1} from '../signal-listening-preparation';
import {createSignalListeningStoreV1} from '../signal-listening-runs';
import {r16ListeningWorkloadV2} from '../../../scripts/r16/listening-workload';
import {captureR16ExpectedGitProvenanceV1,captureR16SourceProvenanceV1} from '../../../scripts/r16/source-provenance';
import {startR16HttpFilesystemStorageV1} from '../../../scripts/r16/http-filesystem-storage';
import {createSyntheticJevFetchV1,deterministicR16LatencyV1} from '../../../scripts/r16/synthetic-jev';
import {createWorkspaceEngineStorageV1} from '../../../services/workers/src/workers/signal-workspace-engine-storage';
import {createLabelingRawPagesStorageV1} from '../../../services/workers/src/workers/signal-labeling-receipt-storage';
import {createCalibratedJevRuntimeProviderV2} from '../../../services/workers/src/providers/jev-streaming-runtime';
import {signalListeningJevJobV1} from '../../../services/workers/src/workers/signal-listening-jev';
import type {JevStreamingExecutionV2} from '../../../services/workers/src/workers/signal-jev-streaming-window';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const CAP=50_000n,ROOTS=240,MAX_JOBS=12,MAX_EVENTS=64,MAX_FETCHES=480,MAX_BYTES=2*1024*1024;
const execution:JevStreamingExecutionV2={max_in_flight:4,window_size:4096,max_buffered_bytes:512*1024*1024,flush_size:2,flush_interval_ms:250,max_flushes:2};
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
function known(ok:unknown,code:string):asserts ok{if(!ok)throw new Error(code);}
export function partialAdmissionAmountV1(v:unknown):bigint{known(typeof v==='string'&&v.length<=32&&/^(?:0|[1-9][0-9]*)$/u.test(v),'partial_admission_amount_invalid');return BigInt(v);}
export function partialAdmissionBudgetWitnessV1(args:{cap:string;settled:string;first:string;denied_exposure:string;denied_exposure_before:string;denied:string;action_cap:string|null;daily:string;daily_cap:string|null}){
 const c=partialAdmissionAmountV1(args.cap),s=partialAdmissionAmountV1(args.settled),first=partialAdmissionAmountV1(args.first),e=partialAdmissionAmountV1(args.denied_exposure),before=partialAdmissionAmountV1(args.denied_exposure_before),r=partialAdmissionAmountV1(args.denied),daily=partialAdmissionAmountV1(args.daily);
 return{first_fits:s+first<=c,denied_exceeds:e+r>c,exposure_nonincreasing:e<=before,action_not_blocking:args.action_cap===null||before+r<=partialAdmissionAmountV1(args.action_cap),daily_not_blocking:args.daily_cap===null||daily+r<=partialAdmissionAmountV1(args.daily_cap)};
}
export function partialAdmissionErrorKindV1(error:unknown):'labeling_cap_exhausted'|'other'{
 try{if(error&&typeof error==='object')for(const key of ['code','message']){const d=Object.getOwnPropertyDescriptor(error,key);if(d&&'value'in d&&d.value==='labeling_cap_exhausted')return'labeling_cap_exhausted';}}catch{/* No arbitrary error content leaves the observer. */}return'other';
}
type Money={cap:string;admission_cap:string;settled:string;reserved:string;unknown:string;exposure:string;calls:number;overage:number;daily:string;daily_cap:string|null;action_cap:string|null;budget_date:string;status:string;error_code:string|null;released:boolean};
async function money(c:PoolClient,workspace:string,run:string):Promise<Money>{
 const result=(await c.query<Money>(`WITH ledger AS(SELECT count(*)::int calls,
  COALESCE(sum(settled_micro_usd) FILTER(WHERE status IN('settled','failed')),0)::text settled,
  COALESCE(sum(reserved_micro_usd) FILTER(WHERE status IN('reserved','submitting','submitted')),0)::text reserved,
  (COALESCE(sum(reserved_micro_usd) FILTER(WHERE status='unknown'),0)+COALESCE(sum(terminal_exposure_micro_usd) FILTER(WHERE status IN('settled','failed')),0))::text unknown,
  COALESCE(sum(CASE WHEN status IN('settled','failed') THEN COALESCE(settled_micro_usd,0)+terminal_exposure_micro_usd ELSE reserved_micro_usd END),0)::text exposure,
  count(*) FILTER(WHERE COALESCE(settled_micro_usd,0)>reserved_micro_usd OR terminal_exposure_micro_usd>0)::int overage
  FROM signal_labeling_calls WHERE workspace_id=$1 AND run_id=$2)
 SELECT r.cap_micro_usd::text cap,ad.execution_cap_micro_usd::text admission_cap,l.*,
  p.daily_cap_micro_usd::text daily_cap,a.max_execution_micro_usd::text action_cap,
  (now() AT TIME ZONE p.budget_timezone)::date::text budget_date,
  (SELECT total_micro_usd::text FROM signal_processing_org_exposure_v1(p.organization_id,(now() AT TIME ZONE p.budget_timezone)::date,p.budget_timezone)) daily,
  r.status,r.error_code,r.lease_token IS NULL released
 FROM signal_labeling_runs r JOIN signal_processing_admissions ad ON ad.id=r.processing_admission_id AND ad.workspace_id=r.workspace_id
 JOIN signal_processing_policy_versions p ON p.id=ad.policy_version_id
 JOIN signal_processing_policy_actions a ON a.policy_version_id=p.id AND a.action=ad.action CROSS JOIN ledger l
 WHERE r.id=$2 AND r.workspace_id=$1`,[workspace,run])).rows[0];
 known(result,'partial_admission_money_missing');for(const key of ['cap','admission_cap','settled','reserved','unknown','exposure','daily'] as const)partialAdmissionAmountV1(result[key]);
 known(partialAdmissionAmountV1(result.cap)===CAP&&partialAdmissionAmountV1(result.admission_cap)===CAP,'partial_admission_cap_changed');
 known(partialAdmissionAmountV1(result.exposure)<=CAP,'partial_admission_exposure_over_cap');
 known(result.daily_cap===null||partialAdmissionAmountV1(result.daily)<=partialAdmissionAmountV1(result.daily_cap),'partial_admission_daily_over_cap');known(['queued','running','completed','failed','canceled'].includes(result.status),'partial_admission_status');result.error_code=result.error_code===null?null:result.error_code==='labeling_cap_exhausted'?'labeling_cap_exhausted':'OTHER';return result;
}
type ReserveEvent={warmup:boolean;count:number;amount:string;existing:number;before:Money;after:Money;outcome:'committed'|'labeling_cap_exhausted'};
export type PartialAdmissionReceiptV1={contract:'r16-listening-partial-admission-v1';status:'failed'|'INCONCLUSIVE'|'observed';diagnostic_only:true;h1_accepted:false;[key:string]:unknown};
function safeFailure(primary:unknown){return new Error('partial_admission_failed_see_safe_receipt',{cause:startupErrorTreeV1(primary)});}
async function publish(directory:string,report:PartialAdmissionReceiptV1){const dir=resolve(repo,directory),sub=relative(resolve(repo,'.data'),dir);known(sub&&!sub.startsWith('..')&&!isAbsolute(sub),'partial_admission_evidence_path');await mkdir(dir,{recursive:true,mode:0o700});known(await realpath(dir)===dir,'partial_admission_evidence_symlink');const bytes=Buffer.from(JSON.stringify(report)+'\n');known(bytes.length<=MAX_BYTES,'partial_admission_evidence_bytes');const file=await open(join(dir,'listening-partial-admission.json'),'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}}
export async function runListeningPartialAdmissionV1(directory:string):Promise<PartialAdmissionReceiptV1>{
 known(process.env.GITHUB_ACTIONS==='true'&&process.env.NOISIA_R16_LISTENING_PARTIAL_ADMISSION_PG==='true','partial_admission_ci_flag');
 known(process.env.NOISIA_SIGNAL_LISTENING_ENABLED==='true'&&process.env.NOISIA_JEV_PROVIDER_ENABLED==='true'&&process.env.NOISIA_R16_LOCAL_PG_LAB==='r16-benchmark-pg17','partial_admission_runtime_flags');
 const redis=process.env.R16BENCH_REDIS_URL;known(redis,'partial_admission_redis_missing');known(['127.0.0.1','localhost','[::1]'].includes(new URL(redis).hostname),'partial_admission_redis_loopback');
 const gates={source_binding:false,native_cap_interval:false,committed_before_fetch:false,delivered_drain:false,terminal_idempotency:false,closure_confirmed:false};
 const report:PartialAdmissionReceiptV1={contract:'r16-listening-partial-admission-v1',status:'failed',diagnostic_only:true,h1_accepted:false,scope:'functional240_not_H1_or_scale1024_4096',cap_micro_usd:String(CAP),execution,gates,source:{before:null,after:null,expected:null},claims:[],reserve_events:[],jobs:[],physical_fetches:[],recovery_execution_claimed:false,external_spend_micro_usd:'0'};
 const callback:StartupCallbackStateV1={entered:false,complete:false,failed:false};let own:{name:string;oid:string}|undefined,normal=false,absence=false,failed=false,primary:unknown;
 const expected=()=>{known(typeof process.env.GITHUB_SHA==='string','partial_admission_expected_sha');return captureR16ExpectedGitProvenanceV1(repo,process.env.GITHUB_SHA);};
 let bound:ReturnType<typeof captureR16ExpectedGitProvenanceV1>|undefined,before:Awaited<ReturnType<typeof captureR16SourceProvenanceV1>>|undefined;
 try{
  bound=expected();before=await captureR16SourceProvenanceV1(repo);report.source={expected:bound,before,after:null,external_root_binding:'Root_must_compare_preregistered_source'};known(JSON.stringify(before)===JSON.stringify(bound),'partial_admission_source_before');
  await closeStartupFactoryV1(callback,async()=>{await runMassLabelingAcceptanceFixtureV1('product',{population_count:ROOTS,beforeProcessing:ctx=>captureStartupCallbackV1(callback,async()=>{
   const database=ctx.database as Pool,observer=await database.connect();let observerOk=false;
   let dir:string|undefined,server:Awaited<ReturnType<typeof startR16HttpFilesystemStorageV1>>|undefined;
   await withSharedWireDefaultPostcheckV1(async()=>{await withSharedWireDefaultPostcheckV1(async()=>{
    dir=await mkdtemp(join(tmpdir(),'r16-partial-admission-'));const activeServer=server=await startR16HttpFilesystemStorageV1(dir);
    const identity=(await observer.query("SELECT current_database() name,(SELECT oid::text FROM pg_database WHERE datname=current_database()) oid,pg_backend_pid()::text backend,(SELECT datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user) FROM pg_database WHERE datname=current_database()) own_ci")).rows[0];
    known(identity&&/^noisia_mfp_recovery_[a-f0-9]{32}$/u.test(identity.name)&&identity.own_ci,'partial_admission_owned_identity');own={name:identity.name,oid:identity.oid};report.name_oid_sha256=hash(JSON.stringify(own));report.observer_backend_sha256=hash(identity.backend);
    const cancel=await database.query("UPDATE signal_labeling_runs r SET status='canceled' WHERE id=$1 AND workspace_id=$2 AND status='queued' AND NOT EXISTS(SELECT 1 FROM signal_labeling_calls WHERE run_id=r.id) RETURNING id",[ctx.run_id,ctx.workspace_id]);known(cancel.rows.length===1,'partial_admission_legacy_cancel');
    const access={database,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id},workload=r16ListeningWorkloadV2('defined_consumer_second_pass');
    const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:workload.configuration});
    const prepared=await prepareSignalListeningV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,idempotency_key:'r16-partial:'+randomUUID(),cap_micro_usd:Number(CAP),provider_available:true,prototype_provider_available:false});
    known(prepared.status==='labeling'&&prepared.run_id,'partial_admission_native_prepare');const runId=prepared.run_id;
    report.run_identity_sha256=hash(JSON.stringify([ctx.workspace_id,ctx.actor_user_id,runId,cfg.id,ctx.map_id]));
    const roster=(await observer.query('SELECT count(*)::int n FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$2',[ctx.workspace_id,ctx.map_id])).rows[0];known(roster?.n===ROOTS,'partial_admission_population_count');report.native_population_roots=roster.n;
    const storage=createWorkspaceEngineStorageV1({url:activeServer.base_url,service_role_key:'synthetic-local-only',bucket:'corpus-files'}),rawPages=createLabelingRawPagesStorageV1(storage);
    const runIdentity=async()=>{const row=(await observer.query(`SELECT r.id,r.workspace_id,r.actor_user_id,r.processing_admission_id,r.request_digest,r.entity_context_digest,r.cap_micro_usd::text,
      o.configuration_id,o.map_id,l.labeler_digest FROM signal_labeling_runs r JOIN signal_listening_runs o ON o.run_id=r.id AND o.workspace_id=r.workspace_id
      JOIN signal_labeler_versions l ON l.id=r.labeler_version_id WHERE r.workspace_id=$1 AND r.id=$2`,[ctx.workspace_id,runId])).rows[0];
     known(row&&row.configuration_id===cfg.id&&row.map_id===ctx.map_id&&row.actor_user_id===ctx.actor_user_id,'partial_admission_run_identity');return hash(JSON.stringify(row));};
    const originalIdentity=await runIdentity();report.native_run_identity_sha256=originalIdentity;
    const base=createSignalListeningStoreV1({database,page_size:4096,rawPages,assertRawReady:()=>storage.assertReady!(),storeRawVerified:true,storeRaw:async()=>{throw new Error('partial_admission_native_pages_required');}});
    const calls=new WeakMap<object,{id:string;digest:string}>(),dispatch=new AsyncLocalStorage<{id:string;digest:string}>(),fetched=new Set<string>(),events:ReserveEvent[]=[],claims:Array<{claimed:boolean;identity_exact:boolean}>=[];
    const fetchRows:Array<{call_sha256:string;request_digest_sha256:string}>=[],jobs:Array<{warmup:boolean;selected_roots:number;status:string}>=[];let warmup=true,selected=0,firstMeasuredIds:Set<string>|undefined;
    report.reserve_events=events;report.claims=claims;report.jobs=jobs;report.physical_fetches=fetchRows;
    const store={...base,async claim(id:string){const value=await base.claim(id);known(id===runId,'partial_admission_claim_identity');claims.push({claimed:!!value,identity_exact:!value||value.id===runId});return value;},async reserve(run:Parameters<typeof base.reserve>[0],proposals:Parameters<typeof base.reserve>[1]){
     known(events.length<MAX_EVENTS,'partial_admission_event_cap');const before=await money(observer,ctx.workspace_id,runId),amount=proposals.reduce((s,p)=>s+partialAdmissionAmountV1(String(p.reserved_micro_usd)),0n);
     const existing=(await observer.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1 AND custom_id=ANY($2::text[])',[runId,proposals.map(p=>p.custom_id)])).rows[0].n;
     try{const result=await base.reserve(run,proposals);if(!warmup&&!firstMeasuredIds&&result.length)firstMeasuredIds=new Set(result.map(call=>call.id));for(const call of result){known(call.request&&typeof call.request==='object','partial_admission_request_object');calls.set(call.request,{id:call.id,digest:call.request_digest});}
      const after=await money(observer,ctx.workspace_id,runId);events.push({warmup,count:proposals.length,amount:String(amount),existing,before,after,outcome:'committed'});return result;
     }catch(error){if(partialAdmissionErrorKindV1(error)!=='labeling_cap_exhausted')throw error;const after=await money(observer,ctx.workspace_id,runId);events.push({warmup,count:proposals.length,amount:String(amount),existing,before,after,outcome:'labeling_cap_exhausted'});throw error;}
    }};
    const synthetic=createSyntheticJevFetchV1({latencyForRequest:deterministicR16LatencyV1});
    const measured:typeof fetch=async(...args)=>{const call=dispatch.getStore();known(call&&!fetched.has(call.id)&&fetched.size<MAX_FETCHES,'partial_admission_duplicate_or_missing_dispatch');
     const body=args[1]?.body;known(typeof body==='string','partial_admission_fetch_body');
     const row=(await observer.query("SELECT request_digest,status,request=$4::jsonb body_exact,usage IS NULL unused,raw_storage_key IS NULL no_raw,results_applied FROM signal_labeling_calls WHERE id=$1 AND workspace_id=$2 AND run_id=$3",[call.id,ctx.workspace_id,runId,body])).rows[0];
     known(row&&row.status==='submitting'&&row.request_digest===call.digest&&row.body_exact&&row.unused&&row.no_raw&&!row.results_applied,'partial_admission_fetch_before_committed_mark');
     fetched.add(call.id);fetchRows.push({call_sha256:hash(call.id),request_digest_sha256:hash(call.digest)});return synthetic(...args);
    };
    const factory:typeof createCalibratedJevRuntimeProviderV2=options=>{const native=createCalibratedJevRuntimeProviderV2({...options,env:{...options.env,TYPESAFE_API_KEY:'synthetic-local-only',NOISIA_TYPESAFE_ACCOUNT_ID:'r16-partial:'+ctx.workspace_id,NOISIA_TYPESAFE_ACCOUNT_REDIS_URL:redis,NOISIA_TYPESAFE_ACCOUNT_RPS:'10000',NOISIA_TYPESAFE_ACCOUNT_INPUT_TPS:'10000000'},fetch:measured});return{...native,evaluate(request,settings){const call=calls.get(request);known(call,'partial_admission_unregistered_request');return dispatch.run(call,()=>native.evaluate(request,settings));}};};
    let capDenied=false;
    for(let i=0;i<MAX_JOBS;i++){
     const before=await money(observer,ctx.workspace_id,runId);let outcome:string;
     try{const value=await signalListeningJevJobV1(runId,{database,store,execution,preflight:()=>storage.assertReady!(),calibrated_provider_factory:factory,observe_calibration:event=>{warmup=event.warmup;selected=event.selected_roots;}});outcome=value.status;
     }catch(error){if(partialAdmissionErrorKindV1(error)!=='labeling_cap_exhausted')throw error;outcome='labeling_cap_exhausted';capDenied=true;}
     jobs.push({warmup,selected_roots:selected,status:outcome});const after=await money(observer,ctx.workspace_id,runId);
     if(capDenied||outcome==='completed')break;if(after.calls<=before.calls){report.inconclusive_reason='no_native_progress';break;}
    }
    const first=events.find(e=>!e.warmup&&e.outcome==='committed'),denied=events.find(e=>!e.warmup&&e.outcome==='labeling_cap_exhausted');
    report.reserve_events=events;report.claims=claims;report.jobs=jobs;report.physical_fetches=fetchRows;
    const final=await money(observer,ctx.workspace_id,runId);report.final_money=final;known(await runIdentity()===originalIdentity,'partial_admission_identity_changed');
    const verified=(await observer.query(flatPrefixLedgerSqlV1+' AND c.id=ANY($3::uuid[])',[ctx.workspace_id,runId,[...fetched]])).rows[0];report.delivered_raw={physical_fetch_count:fetched.size,verified_settled_applied:Number(verified.applied),unknown_exposure_micro_usd:verified.unknown_micro_usd};
    known(Number(verified.calls)===fetched.size&&Number(verified.applied)===fetched.size,'partial_admission_delivered_not_drained');gates.delivered_drain=true;gates.committed_before_fetch=fetched.size>0;
    const sent=(await observer.query('SELECT c.id,c.status,c.raw_storage_key,c.usage,c.settled_micro_usd::text,c.results_applied,c.results IS NULL no_results,NOT EXISTS(SELECT 1 FROM signal_listening_answers a WHERE a.call_id=c.id AND a.workspace_id=c.workspace_id AND a.run_id=c.run_id) no_answers FROM signal_labeling_calls c WHERE c.workspace_id=$1 AND c.run_id=$2',[ctx.workspace_id,runId])).rows;
    known(sent.filter(c=>!fetched.has(c.id)).every(c=>c.raw_storage_key===null&&c.usage===null&&(c.settled_micro_usd===null||c.settled_micro_usd==='0')&&c.results_applied===false&&c.no_results===true&&c.no_answers===true),'partial_admission_never_sent_fictitious_receipt');
    const measuredPaid=(await observer.query("SELECT count(*)::int calls,COALESCE(sum(settled_micro_usd),0)::text settled FROM signal_labeling_calls WHERE workspace_id=$1 AND run_id=$2 AND id=ANY($3::uuid[]) AND status='settled' AND results_applied",[ctx.workspace_id,runId,[...(firstMeasuredIds??[])]] )).rows[0];
    report.first_measured_paid={native_settled_applied_calls:measuredPaid.calls,settled_micro_usd:measuredPaid.settled,physical_fetches:[...(firstMeasuredIds??[])].filter(id=>fetched.has(id)).length};
    if(first&&denied){const witness=partialAdmissionBudgetWitnessV1({cap:String(CAP),settled:first.before.settled,first:first.amount,denied_exposure:denied.after.exposure,denied_exposure_before:denied.before.exposure,denied:denied.amount,action_cap:denied.before.action_cap,daily:denied.before.daily,daily_cap:denied.before.daily_cap});
     const warmups=events.filter(e=>e.warmup),warmupsFit=warmups.length>0&&warmups.every(e=>e.outcome==='committed'&&partialAdmissionAmountV1(e.before.exposure)+partialAdmissionAmountV1(e.amount)<=CAP);
     report.budget_witness={...witness,warmup_reservations_fit:warmupsFit,first_measured_count:first.count,first_settled_equals_exposure:first.before.settled===first.before.exposure,denied_fresh:denied.existing===0,denied_insert_rolled_back:denied.after.calls===denied.before.calls,monotone_synthetic_settlement:final.overage===0&&partialAdmissionAmountV1(denied.after.exposure)<=partialAdmissionAmountV1(denied.before.exposure),stable_budget_date:first.before.budget_date===denied.after.budget_date,native_error:'labeling_cap_exhausted',exposure_witness:'post_failure_lower_bound_under_monotone_synthetic_settlement'};
     gates.native_cap_interval=Object.values(witness).every(v=>v)&&warmupsFit&&warmups[0]?.count===32&&jobs.some(j=>j.warmup&&j.selected_roots===32)&&Number(measuredPaid.calls)>0&&partialAdmissionAmountV1(measuredPaid.settled)>0n&&first.count>0&&first.count<=4&&first.existing===0&&first.before.settled===first.before.exposure&&denied.existing===0&&denied.after.calls===denied.before.calls&&final.overage===0&&partialAdmissionAmountV1(denied.after.exposure)<=partialAdmissionAmountV1(denied.before.exposure)&&first.before.budget_date===denied.after.budget_date;
    }else report.inconclusive_reason='fixed_cap_interval_not_observed';
    if(capDenied){known(final.status==='failed'&&final.error_code==='labeling_cap_exhausted'&&final.released,'partial_admission_terminal_state');const n=fetched.size,k=claims.length,before=JSON.stringify(final);
     const restarted=await signalListeningJevJobV1(runId,{database,store,execution,preflight:()=>storage.assertReady!(),calibrated_provider_factory:factory});
     known(restarted.status==='not_claimed'&&claims.length===k+1&&!claims[k]!.claimed&&fetched.size===n,'partial_admission_terminal_duplicate');known(JSON.stringify(await money(observer,ctx.workspace_id,runId))===before,'partial_admission_terminal_money_changed');known(await runIdentity()===originalIdentity,'partial_admission_restart_identity_changed');gates.terminal_idempotency=true;report.terminal_restart={claim_attempted:true,claimed:false,status:'not_claimed',new_physical_fetches:0,recovery_execution_claimed:false};
    }
    report.storage_loopback_metrics=activeServer.metrics();observerOk=true;
   },async()=>{await withSharedWireDefaultPostcheckV1(()=>server?server.close():Promise.resolve(),()=>dir?rm(dir,{recursive:true,force:true}):Promise.resolve());});
   },async()=>{observer.release(!observerOk);report.observer_released=true;});
  })});normal=true;},async()=>{if(!own)return;const admin=await openR16CiPostgresV1();await withSharedWireDefaultPostcheckV1(async()=>{assertR16LocalPostgresPoolV1(admin);const c=await admin.connect();try{await assertStartupOwnedAbsentV1(c,own!,()=>undefined);absence=true;}finally{c.release();}},()=>admin.end());});
  gates.closure_confirmed=normal&&absence&&callback.complete;
 }catch(error){failed=true;primary=error;report.safe_error_tree=startupErrorTreeV1(error);}
 try{const after=await captureR16SourceProvenanceV1(repo);(report.source as Record<string,unknown>).after=after;gates.source_binding=!!bound&&!!before&&JSON.stringify(before)===JSON.stringify(bound)&&JSON.stringify(after)===JSON.stringify(bound);if(!gates.source_binding)throw new Error('partial_admission_source_after');}catch(error){primary=failed?new AggregateError([primary,error],'partial_admission_primary_and_source_failed',{cause:primary}):error;failed=true;report.safe_error_tree=startupErrorTreeV1(primary);}
 report.closure={callback_entered:callback.entered,callback_complete:callback.complete,factory_returned_normally:normal,own_database_absent:absence?true:'UNKNOWN'};
 report.status=failed?'failed':Object.values(gates).every(v=>v)?'observed':'INCONCLUSIVE';
 try{await publish(directory,report);}catch(error){throw safeFailure(failed?new AggregateError([primary,error],'partial_admission_primary_and_publication_failed',{cause:primary}):error);}
 if(failed)throw safeFailure(primary);return report;
}
