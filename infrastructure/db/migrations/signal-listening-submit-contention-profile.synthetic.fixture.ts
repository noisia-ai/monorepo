import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdir,open,realpath} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import type {PoolClient} from 'pg';
import {createSignalListeningStoreV1} from '../signal-listening-runs';
import {withFlatPrefixFullFixtureV1,readFlatPrefixSetupStateV1,type FlatPrefixReadyFixtureV1} from './signal-listening-flat-prefix.synthetic.fixture';
import {sharedWireProposalsV1} from './signal-listening-statement-shared-wire.fixture';
import {withSharedWireDefaultPostcheckV1} from './signal-listening-statement-shared-wire.oracle';
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
export const submitSqlHashV1=(sql:string)=>sha(sql.replace(/\s+/gu,' ').trim());
const HASH={policy:'734790f8a7aea5164a6f60034ca5cbb053614ae18b1f7b8f23bd6a17265867f6',reserve:'4ece6654c82e3d48416690d80208f849288cd5cfed5e16f0464dd3accfba33dd',mark:'1e5b3d3837b8c7354d6c25d941461f0d36e55d5cc3d42cbd31c627ba0662859b',commit:'79663c1d3b43ceaf9ee728e501c64b57ae2e4d6cb36ff5c65eddcda1de27342f'};
const statsSQL=`SELECT funcid::text,schemaname,funcname,calls::text,total_time,self_time FROM pg_stat_xact_user_functions ORDER BY funcid`;
type Counter={funcid:string;schemaname:string;funcname:string;calls:string;total_time:number;self_time:number};
export function submitCounterDeltaV1(before:Counter[],after:Counter[]){
 const old=new Map(before.map(r=>[r.funcid,r]));return after.map(r=>{assert.match(r.calls,/^\d+$/u);assert.ok(Number.isFinite(r.total_time)&&r.total_time>=0&&Number.isFinite(r.self_time)&&r.self_time>=0);const b=old.get(r.funcid);
  if(!b)return{funcid:r.funcid,status:'baseline_absent_unknown',delta:null,phase_counter:r};
  assert.ok(BigInt(r.calls)>=BigInt(b.calls)&&r.total_time>=b.total_time&&r.self_time>=b.self_time);
  return{funcid:r.funcid,status:'observed_elapsed_delta',delta:{calls:String(BigInt(r.calls)-BigInt(b.calls)),total_time_ms:r.total_time-b.total_time,self_time_ms:r.self_time-b.self_time},phase_counter:null};});
}
export class SubmitWorkerGateV1{private active=new Set<string>();enter(name:string){assert.ok(!this.active.has(name)&&this.active.size<2,'only two logical writers');this.active.add(name);let released=false;return()=>{assert.equal(released,false);released=true;assert.ok(this.active.delete(name));};}}
type Phase={phase:string;seq:number;hash:string|null};
type Writer={transaction_role:string;label:'A'|'B';pid:number|null;state:Phase;spans:Array<Record<string,unknown>>;snapshots:Array<{label:string;rows:Counter[];start_ms:number;end_ms:number}>;deltas:ReturnType<typeof submitCounterDeltaV1>[];error:unknown;discard:boolean};
export function submitBlockingEvidenceV1(rows:Array<{pid:number;wait_event_type:string|null;wait_event:string|null;blockers:number[];state?:string;query_start?:unknown}>,aPid:number|null,bPid:number|null,before:Record<string,Phase>,after:Record<string,Phase>){
 if(aPid===null||bPid===null||aPid===bPid)return{supported:false,reason:'owned_pids_not_ready'};
 const a=before.A,b=before.B;if(!a||!b||!after.A||!after.B||a.seq!==after.A.seq||b.seq!==after.B.seq)return{supported:false,reason:'phase_changed_during_sample'};
 const workerA=rows.find(r=>r.pid===aPid);if(workerA?.state!=='active')return{supported:false,reason:'A_idle_client_or_unknown'};
 const wait=rows.find(r=>r.pid===bPid);if(wait?.wait_event_type!=='Lock'||wait.wait_event!=='advisory'||!wait.blockers.includes(aPid))return{supported:false,reason:'no_owned_advisory_edge'};
 if(b.phase!=='policy_lock')return{supported:false,reason:'B_not_in_policy_lock'};
 if(!['policy_lock','native_query','dml','commit','call_locks'].includes(a.phase))return{supported:false,reason:a.phase==='diagnostic_stats'?'blocked_during_diagnostic_stats':'A_not_in_native_phase'};
 return{supported:true,reason:'owned_B_to_A_advisory_edge_in_stable_native_phase',A_phase:a.phase,A_hash:a.hash};
}
async function sources(c:PoolClient){
 const rows=(await c.query(`SELECT p.oid::text,p.proname,p.prosrc,p.proconfig,p.proacl::text,p.proowner::text,p.provolatile,p.proisstrict,p.prosecdef,p.proparallel,p.proleakproof,p.proargtypes::text,p.proallargtypes::text,p.proargnames,p.proargmodes,p.proretset FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('signal_listening_statement_money_v1','signal_listening_population_roots_v1','signal_listening_call_guard_v1','signal_listening_answer_guard_v1','guard_signal_labeling_page_mutation_fence_v1') ORDER BY p.oid`)).rows;assert.equal(rows.length,5);
 for(const [file,name,tag]of [['0331_signal_listening_statement_payload.sql','signal_listening_statement_money_v1','$$'],['0332_signal_listening_flat_prefix_preimages.sql','signal_listening_population_roots_v1','$function$']]){const source=await readFile(new URL('./'+file,import.meta.url),'utf8');assert.equal(rows.find(r=>r.proname===name)!.prosrc,source.split('AS '+tag)[1]!.split(tag+';')[0]);}
 return rows.map(({prosrc,...r})=>({...r,body_sha256:sha(prosrc)}));
}
async function ledger(c:PoolClient,f:FlatPrefixReadyFixtureV1,runId:string){return(await c.query(`SELECT count(*)::int calls,count(DISTINCT inputs->0->>'root_id')::int roots,
 count(*) FILTER(WHERE status='reserved')::int reserved,count(*) FILTER(WHERE status='submitting')::int submitting,
 count(*) FILTER(WHERE status='settled' AND results_applied)::int applied,
 COALESCE(sum(settled_micro_usd),0)::text spend,COALESCE(sum(CASE WHEN status IN('settled','failed') THEN COALESCE(settled_micro_usd,0)+terminal_exposure_micro_usd ELSE reserved_micro_usd END),0)::text run_exposure,
 (SELECT total_micro_usd::text FROM signal_processing_org_exposure_v1(w.organization_id,(now() AT TIME ZONE p.budget_timezone)::date,p.budget_timezone)) org_exposure
 FROM signal_labeling_calls c JOIN signal_workspaces w ON w.id=c.workspace_id JOIN signal_processing_admissions a ON a.id=$3 JOIN signal_processing_policy_versions p ON p.id=a.policy_version_id WHERE c.workspace_id=$1 AND c.run_id=$2 GROUP BY w.organization_id,p.budget_timezone`,[f.run.workspace_id,runId,f.run.processing_admission_id])).rows[0];}
const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
export async function runSubmitContentionProfileV1(){
 let receipt:Record<string,unknown>|undefined;
 await withFlatPrefixFullFixtureV1({afterSetup:async f=>{
  f.deadline();assert.equal((f.database as unknown as {options:{max:number}}).options.max,8,'existing clone pool remains max8');
  let run:FlatPrefixReadyFixtureV1['run']|null=null;const observer=await f.database.connect();let observerDiscard=false;
  try{const identity=(await observer.query("SELECT pg_backend_pid()::int pid,current_database() database,current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') readonly")).rows[0];assert.match(identity.database,/^noisia_mfp_recovery_[a-f0-9]{32}$/u);assert.equal(identity.isolation,'read committed');assert.equal(identity.readonly,'off');
   const sourceBefore=await sources(observer),setupState=await readFlatPrefixSetupStateV1(observer,f.params,f.run.id);run=await f.store.claim(f.run.id);assert.ok(run);const held=run;const initial=await ledger(observer,f,held.id);assert.equal(initial.applied,4096);assert.equal(initial.spend,'24576');
   const inputs=await f.store.inputs(held,{max_rows:4096,max_working_bytes:512*1024*1024,on_oversize:'error'});assert.equal(inputs.length,4096);assert.ok(inputs.every(i=>i.question_keys.length===2&&Object.keys(i.scope_basis).length===2));
   const cohorts=[0,1,2,3].map(n=>inputs.slice(n*1000,(n+1)*1000));assert.equal(new Set(cohorts.flatMap(x=>x.map(i=>i.root_id))).size,4000);
   const proposals=(n:number)=>sharedWireProposalsV1({run:held,inputs:cohorts[n]!,configuration:f.configuration},500);
   const Bserial=await f.store.reserve(held,proposals(1)),Bconcurrent=await f.store.reserve(held,proposals(3));assert.equal(Bserial.length,1000);assert.equal(Bconcurrent.length,1000);await f.store.renew(held);f.deadline();
   const gate=new SubmitWorkerGateV1(),samples:Array<Record<string,unknown>>=[],modes:Array<Record<string,unknown>>=[],writers:Writer[]=[];
   const origin=process.hrtime.bigint(),clock=()=>Number(process.hrtime.bigint()-origin)/1e6;let done=false,ticks=0,mode='serial';
   const live=()=>assert.ok(clock()<=120000,'joint measurement bracket exceeds120s');
   let readyResolve:()=>void=()=>{},readyReject:(e:unknown)=>void=()=>{};const ready=new Promise<void>((r,j)=>{readyResolve=r;readyReject=j;});void ready.catch(()=>undefined);
   function writer(label:'A'|'B',signalPolicy=false){
    const w:Writer={transaction_role:mode+':'+label,label,pid:null,state:{phase:'idle',seq:0,hash:null},spans:[],snapshots:[],deltas:[],error:null,discard:false};writers.push(w);
    const phase=(kind:string,hash:string|null=null)=>{w.state={phase:kind,seq:w.state.seq+1,hash};};
    const database={query:f.database.query.bind(f.database),connect:async()=>{const leave=gate.enter(label);let raw:PoolClient;try{raw=await f.database.connect();}catch(e){leave();throw e;}
     const query=raw.query.bind(raw)as(...a:any[])=>Promise<any>;let busy=false,released=false,transaction=false;
     let id:any;try{id=(await query("SELECT pg_backend_pid()::int pid,current_database() database,current_setting('track_functions') tracking")).rows[0];assert.equal(id.database,identity.database);w.pid=id.pid;}catch(e){raw.release(true);leave();throw e;}
     const stats=async(name:string)=>{phase('diagnostic_stats');const start_ms=clock(),rows=(await query(statsSQL)).rows as Counter[];const snapshot={label:name,rows,start_ms,end_ms:clock()};const prior=w.snapshots.at(-1);if(prior)w.deltas.push(submitCounterDeltaV1(prior.rows,rows));w.snapshots.push(snapshot);w.spans.push({phase:'diagnostic_stats',label:name,start_ms,end_ms:clock()});phase('between_native');};
     return new Proxy(raw,{get:(target,key)=>{
      if(key==='release')return(destroy=false)=>{if(released)return;released=true;if(transaction)w.discard=true;raw.release(destroy||w.discard);leave();phase('released');};
      if(key!=='query'){const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}
      return async(...args:any[])=>{assert.equal(busy,false,'one original client query at a time');busy=true;
       const sql=typeof args[0]==='string'?args[0]:args[0]?.text;assert.equal(typeof sql,'string');const hash=submitSqlHashV1(sql);const kind=hash===HASH.policy?'policy_lock':hash===HASH.reserve||hash===HASH.mark?'dml':hash===HASH.commit?'commit':'native_query';
       try{if(sql!=='ROLLBACK')live();if(hash===HASH.reserve||hash===HASH.mark)await stats('before_dml');if(sql==='COMMIT')await stats('before_commit');phase(kind,hash);const start_ms=clock();const value=await query(...args);const end_ms=clock();w.spans.push({phase:kind,sql_template_sha256:hash,start_ms,end_ms});phase('between_native');
        if(sql==='BEGIN'){transaction=true;phase('diagnostic_stats');await query("SET LOCAL track_functions='all'");await stats('baseline');}
        else if(sql==='COMMIT'||sql==='ROLLBACK'){transaction=false;phase('diagnostic_stats');assert.equal((await query("SELECT current_setting('track_functions') tracking")).rows[0].tracking,id.tracking);phase('between_native');}
        else if(hash===HASH.policy){if(signalPolicy)readyResolve();await stats('after_policy');}
        else if(hash===HASH.reserve||hash===HASH.mark)await stats('after_dml');
        return value;
       }catch(e){if(sql==='ROLLBACK')w.discard=true;w.error??=e;phase('failed');throw e;}finally{busy=false;}
      };
     }});
    }};
    return{w,store:createSignalListeningStoreV1({database:database as FlatPrefixReadyFixtureV1['database'],page_size:4096,rawPages:f.rawPages,assertRawReady:f.assertRawReady,storeRawVerified:true,storeRaw:async()=>{throw Error('native pages only');}})};
   }
   let active:Record<string,Writer>={},sampleInFlight:Promise<void>|undefined;
   const sampleTask=(async()=>{while(!done){live();assert.ok(++ticks<=1200,'sample cap1200');const sampleMode=mode,states=Object.fromEntries(Object.entries(active).map(([k,w])=>[k,{...w.state}]));const ids=Object.values(active).flatMap(w=>w.pid===null?[]:[w.pid]);
     if(ids.length&&Object.values(active).some(w=>!['idle','released'].includes(w.state.phase))){sampleInFlight=(async()=>{const start_ms=clock(),rows=(await observer.query(`SELECT pid,state,query_start,wait_event_type,wait_event,pg_blocking_pids(pid) blockers FROM pg_stat_activity WHERE datname=current_database() AND pid=ANY($1::int[]) ORDER BY pid`,[ids])).rows;const after=Object.fromEntries(Object.entries(active).map(([k,w])=>[k,{...w.state}]));samples.push({mode:sampleMode,start_ms,end_ms:clock(),states_before:states,states_after:after,rows,evidence:submitBlockingEvidenceV1(rows,active.A?.pid??null,active.B?.pid??null,states,after)});})();await sampleInFlight;sampleInFlight=undefined;}
     await sleep(100);
    }})();void sampleTask.catch(()=>{done=true;observerDiscard=true;});
   await withSharedWireDefaultPostcheckV1(async()=>{
    for(const [name,aIndex,bCalls]of [['serial',0,Bserial],['concurrent',2,Bconcurrent]]as const){await sampleInFlight;mode=name;await f.store.renew(held);const before=await ledger(observer,f,held.id),A=writer('A',name==='concurrent'),B=writer('B');active={A:A.w,B:B.w};let selected=0;
     const mark=()=>B.store.markSubmittingSelected!(held,()=>{selected++;assert.equal(selected,1);return bCalls;});
     if(name==='serial'){const result=await A.store.reserve(held,proposals(aIndex));assert.equal(result.length,1000);const marked=await mark();assert.deepEqual(marked,bCalls);}
     else{const reserve=A.store.reserve(held,proposals(aIndex)).catch(e=>{readyReject(e);throw e;});const marking=(async()=>{await ready;return mark();})();const results=await Promise.allSettled([reserve,marking]);const errors=results.filter((r):r is PromiseRejectedResult=>r.status==='rejected').map(r=>r.reason);if(errors.length)throw new AggregateError(errors,'native concurrent operations failed');assert.equal((results[0]as PromiseFulfilledResult<any[]>).value.length,1000);assert.deepEqual((results[1]as PromiseFulfilledResult<any[]>).value,bCalls);}
     assert.equal(selected,1);await sampleInFlight;const after=await ledger(observer,f,held.id);assert.equal(after.calls-before.calls,1000);assert.equal(BigInt(after.run_exposure)-BigInt(before.run_exposure),500000n);assert.equal(BigInt(after.org_exposure)-BigInt(before.org_exposure),500000n);assert.equal(after.spend,before.spend);
     const state=(await observer.query(`SELECT count(*)::int n,count(*) FILTER(WHERE status='submitting' AND raw_sha256 IS NULL AND raw_storage_key IS NULL AND settled_micro_usd IS NULL AND NOT results_applied)::int unsent FROM signal_labeling_calls WHERE run_id=$1 AND id=ANY($2::uuid[])`,[held.id,bCalls.map(c=>c.id)])).rows[0];assert.deepEqual(state,{n:1000,unsent:1000});
     modes.push({mode:name,ledger_before:before,ledger_after:after,selector_calls:selected,B_committed_submitting:1000,ledger_growth_is_confound:true});await f.store.requeueUnsent!(held,bCalls);live();
    }
   },async()=>{done=true;await sampleTask;});
   const bracketEnd=clock();live();
   for(const w of writers){assert.equal(w.spans.filter(s=>s.phase==='dml').length,1);assert.equal(w.spans.filter(s=>s.phase==='commit').length,1);assert.equal(w.spans.filter(s=>s.phase==='policy_lock').length,w.label==='A'?2:1);}
   assert.deepEqual(await sources(observer),sourceBefore);const final=await ledger(observer,f,held.id);assert.equal(final.calls,8096);assert.equal(final.applied,4096);assert.equal(final.submitting,0);assert.equal(final.reserved,4000);assert.equal(final.spend,'24576');
   const catalog=(await observer.query(`SELECT p.oid::text,p.proname,p.prosrc,p.provolatile,p.prosecdef,p.proconfig FROM pg_proc p WHERE p.oid=ANY($1::oid[]) ORDER BY p.oid`,[[...new Set(writers.flatMap(w=>w.snapshots.flatMap(s=>s.rows.map(r=>r.funcid))))]])).rows.map(({prosrc,...r})=>({...r,body_sha256:sha(prosrc)}));
   receipt={contract:'r16-submit-contention-profile-v1',status:'observed',diagnostic_only:true,h1_accepted:false,cpu:'UNKNOWN',diagnosis:samples.some(s=>s.mode==='concurrent'&&(s.evidence as {supported:boolean}).supported)?'supported':'inconclusive',source_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:fileURLToPath(new URL('../../../',import.meta.url)),encoding:'utf8',timeout:5000}).trim(),source_witness:sourceBefore,setup:{...setupState,roots:4096,questions:4,base_calls:4096,base_answers:8192,consumer_calls_reserved_before_bracket:2000,cohorts:4,cohort_size:1000,disjoint_roots:4000,clone_pool_max_unchanged:8,logical_writer_gate:2,observer_pool:'same_owned_clone',observer_autocommit:true,memory_cap_bytes:512*1024*1024,execution_cap_micro_usd:20000000},modes,final_ledger:final,writers:writers.map(({error,discard,...w})=>({...w,discarded:discard})),function_catalog:catalog,samples,sample_ticks:ticks,bracket_ms:bracketEnd,unknowns:['ledger grows between modes; no speedup comparison','diagnostic_stats extends lock hold; not native DML or COMMIT cost','sample phase boundaries ambiguous if seq changed','function total/self are elapsed not CPU; missing rows UNKNOWN','COMMIT deferred functions not measured by precommit xact counters','no JEV HTTP/provider sends; loopback RAW storage setup only; no H1 claim']};
  }catch(e){observerDiscard=true;throw e;}finally{await withSharedWireDefaultPostcheckV1(async()=>{if(run)await f.store.release(run);},async()=>observer.release(observerDiscard));}
 }});assert.ok(receipt);return receipt;
}
export async function writeSubmitContentionProfileV1(receipt:Record<string,unknown>){
 const configured=process.env.R16_SUBMIT_CONTENTION_EVIDENCE_DIR;assert.ok(configured);const root=await realpath(fileURLToPath(new URL('../../../',import.meta.url))),dir=resolve(root,configured),sub=relative(join(root,'.data'),dir);assert.ok(sub&&!sub.startsWith('..')&&!sub.startsWith('/'));await mkdir(dir,{recursive:true,mode:0o700});assert.equal(await realpath(dir),dir);const bytes=Buffer.from(JSON.stringify(receipt)+'\n');assert.ok(bytes.length<=2*1024*1024);const fd=await open(join(dir,'submit-contention-profile.json'),'wx',0o600);try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}
}
