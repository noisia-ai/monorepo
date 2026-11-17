import assert from 'node:assert/strict';
import test,{before,after} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {dirname,resolve,join,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import type {PoolClient} from 'pg';
import {signalListeningBaseTemplateV1,buildSignalListeningJevRequestV1,signalListeningRequestDigestV1,type SignalListeningConfigurationV1} from '@noisia/query-engine';
import {r16ListeningWorkloadV2} from '../../../scripts/r16/listening-workload';
import {requestSignalListeningV1} from '../signal-listening-runs';
import {readSignalLabelingRunExposureV1} from '../signal-labeling-runs';
import {withSharedWireFixtureV1,withSharedWireTxV1,sharedWireProposalsV1,insertSharedWireCallsV1,type SharedWireFixtureV1} from './signal-listening-statement-shared-wire.fixture';
import {sharedWireValidationV1,assertSharedWireDefaultRuntimeV1,withSharedWireDefaultPostcheckV1} from './signal-listening-statement-shared-wire.oracle';
import {anchorListeningStatementOracleParametersV1} from './signal-listening-statement-validator.oracle';
import {statementFrameSourceV1,restoreStatementFrameSourceV1,compareStatementFrameValidationV1,statementFrameKernelV1,statementFrameDimensionsV1,
 STATEMENT_FRAME_C_SHA_V1,STATEMENT_FRAME_ORDER_V1,drainStatementFrameReservationsV1} from './signal-listening-statement-frame.oracle';
const enabled=process.env.NOISIA_R16_STATEMENT_FRAME_PG==='true';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const git=(dir:string,args:string[])=>execFileSync('git',args,{cwd:dir,encoding:'utf8',timeout:2000,maxBuffer:65536,stdio:['ignore','pipe','ignore']}).trim();
const report:any={contract:'r16-statement-frame-native-oracle-v1',status:'running',test_only:true,h1_accepted:false,gain_claim:false,migration_created:false,
 base_source:'b95a87a8e15343ba25d742c6fdcd97c3a7fbdec1',source:null,probe:null,source6:[],new_files:[],source_c_sha256:null,source_d_sha256:null,
 inverse_restores_C:false,defaults:[],byte_oracle:null,all_attempts:[],prior:null,paired:[],concurrent:[],failures:[],hz_before:null,hz_after:null,
 cpu_scope:'leader_backend_brackets_include_probes',workers_cpu:'unknown',sql_function_cpu:'unknown',control_subtracted:false,
 memory_claim:false,capacity_claim:false,physical_http_attempts:0};
let sourceC='',sourceD='',cpu:any,profiler:any,markerWriter:any,owned:any,probeRoot='',probeSha='',sequence=0;
const failed=(phase:string,error:any)=>{report.failures.push({phase,code:/^[0-9A-Z]{5}$/.test(error?.code??'')?error.code:null,reason:'native_oracle_or_identity_failure'});};
async function checked(phase:string,body:()=>Promise<void>){try{await body();}catch(e){failed(phase,e);throw e;}}
async function hz(){const collector=await profiler.startPgCpuProfileV1({targetRoot:root,targetSha:report.source,intervalMs:0,maxDurationMs:30000});
 const receipt=await collector.stop();assert.ok(receipt.ownership);assert.equal(receipt.cleanup.status,'completed');assert.deepEqual(receipt.reason_codes,[]);
 assert.equal(receipt.snapshots.length,2);const value=receipt.snapshots[0].postgres.clk_tck;assert.match(value,/^[1-9][0-9]*$/);
 assert.ok(receipt.snapshots.every((s:any)=>s.postgres.clk_tck===value));
 const first=receipt.snapshots[0].postgres,postmaster=first.pids.find((p:any)=>p.pid===first.postmaster_pid);assert.ok(postmaster);
 assert.ok(receipt.snapshots.every((s:any)=>s.postgres.postmaster_pid===postmaster.pid&&s.postgres.pids.find((p:any)=>p.pid===postmaster.pid)?.starttime_ticks===postmaster.starttime_ticks));
 return{clk_tck:value,ownership:receipt.ownership,collector:receipt.collector,interval_ms:0,stopped_before_queries:true,
  postmaster:{pid:postmaster.pid,starttime_ticks:postmaster.starttime_ticks},brackets:receipt.snapshots.map((s:any)=>({label:s.label,bracket:s.bracket}))};}
before(async()=>{if(!enabled)return;await checked('setup',async()=>{
 assert.equal(process.platform,'linux');assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.CI,'true');assert.equal(process.env.GITHUB_EVENT_NAME,'workflow_dispatch');
 assert.equal(process.env.NOISIA_R16_LOCAL_PG_LAB,'r16-benchmark-pg17');
 for(const name of Object.keys(process.env))assert.ok(!/(ANTHROPIC|SONNET|VOYAGE|TYPESAFE|OPENAI).*?(API_KEY|TOKEN)/.test(name));
 const workspace=await realpath(process.env.GITHUB_WORKSPACE!);assert.ok(root.startsWith(workspace+sep));assert.equal(await realpath(root),root);
 probeRoot=process.env.R16_FRAME_PROBE_ROOT!;probeSha=process.env.R16_FRAME_PROBE_SHA!;
 assert.ok(probeRoot&&probeRoot.startsWith(workspace+sep)&&probeRoot!==root);assert.equal(await realpath(probeRoot),probeRoot);assert.match(probeSha,/^[0-9a-f]{40}$/);
 assert.equal(git(probeRoot,['rev-parse','HEAD']),probeSha);assert.equal(git(probeRoot,['status','--porcelain','--untracked-files=all']),'');
 report.source=git(root,['rev-parse','HEAD']);report.probe=probeSha;assert.equal(git(root,['status','--porcelain','--untracked-files=all']),'');
 const load=(relative:string)=>import(pathToFileURL(join(probeRoot,relative)).href);
 cpu=await load('scripts/r16-diagnostics/listening-small/query-cpu-oracle.mjs');
 profiler=await load('scripts/r16-diagnostics/listening-small/profile-pg-cpu.mjs');
 markerWriter=await load('scripts/r16-diagnostics/listening-small/run.mts');
 for(const d of cpu.SOURCE_DECLARATIONS_V1){const body=await readFile(new URL('./'+d.file,import.meta.url),'utf8');assert.equal(hash(body),d.sha256);report.source6.push({...d});}
 for(const file of ['signal-listening-statement-frame.oracle.ts','signal-listening-statement-frame.test.ts','signal-listening-statement-frame.postgres.test.ts'])
  report.new_files.push({file,sha256:hash(await readFile(new URL('./'+file,import.meta.url),'utf8'))});
 sourceC=await readFile(new URL('./0331_signal_listening_statement_payload.sql',import.meta.url),'utf8');assert.equal(hash(sourceC),STATEMENT_FRAME_C_SHA_V1);
 sourceD=statementFrameSourceV1(sourceC);assert.equal(restoreStatementFrameSourceV1(sourceD),sourceC);
 report.source_c_sha256=hash(sourceC);report.source_d_sha256=hash(sourceD);report.inverse_restores_C=true;
 const local=await import('./signal-r16-local-pg.fixture');const pool=await local.openR16CiPostgresV1();
 try{await markerWriter.writeProfileOnlyPgOwnershipMarkerV1({targetRoot:root,targetSha:report.source,pool,localPg:local,env:process.env,inspectFormat:profiler.PG_CPU_INSPECT_FORMAT_V1});
  owned=await hz();report.hz_before=owned;
 }finally{await pool.end();}
 });});
after(async()=>{if(!enabled)return;
 if(owned)try{report.hz_after=await hz();assert.equal(report.hz_after.clk_tck,owned.clk_tck);assert.deepEqual(report.hz_after.ownership,owned.ownership);assert.deepEqual(report.hz_after.postmaster,owned.postmaster);}catch(e){failed('final_owned',e);}
 try{assert.equal(git(root,['rev-parse','HEAD']),report.source);assert.equal(git(root,['status','--porcelain','--untracked-files=all']),'');
  assert.equal(git(probeRoot,['rev-parse','HEAD']),probeSha);assert.equal(git(probeRoot,['status','--porcelain','--untracked-files=all']),'');
 }catch(e){failed('final_sources',e);}
 report.proc_reads_observed=sequence;report.status=report.failures.length?'failed':'observed';
 const json=JSON.stringify(report);assert.ok(Buffer.byteLength(json)<=256*1024,'bounded frame result receipt');console.log('# statement frame RESULT '+json);
 if(report.failures.length)throw Error('statement_frame_native_failed');
});
async function fixture(body:(f:SharedWireFixtureV1)=>Promise<void>,configuration?:SignalListeningConfigurationV1,options?:{mode?:'scaled_recovery';consumer_category?:boolean}){
 await withSharedWireFixtureV1(async f=>{const before=await assertSharedWireDefaultRuntimeV1(f.database);assert.equal(before.runtime_kind,'C');
  await withSharedWireDefaultPostcheckV1(()=>body(f),async()=>{const after=await assertSharedWireDefaultRuntimeV1(f.database);assert.deepEqual(after,before);
   report.defaults.push({before,after});});
 },configuration,options);
}
async function params(raw:PoolClient,f:SharedWireFixtureV1,rows:unknown[],target=f.run.id){const owner=(await raw.query('SELECT configuration_id,map_id,configuration_digest FROM signal_listening_runs WHERE run_id=$1',[f.run.id])).rows[0];
 return[target,f.run.workspace_id,owner.configuration_id,owner.map_id,f.run.entity_context_digest,f.inputs.map(i=>i.root_id),owner.configuration_digest,JSON.stringify(rows)];}
function configuration(details:number){const base=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']});return{...base,instructions:base.instructions+' é é 😀 "quoted" \\ \n',
 questions:[...base.questions,...Array.from({length:details},(_,i)=>({key:'detail_'+String(i).padStart(3,'0'),type:'noul' as const,text:'Synthetic category detail '+i+' café 😀?',positive:'Synthetic detail present 漢字',negative:'Synthetic detail absent',scope:'all' as const,origin:'brand_os' as const,human_locked:false}))]};}
test('D frame native bytes preserve every shape and malformed mixed all-attempt guards',{skip:!enabled,timeout:600000},async()=>checked('bytes_all_attempts',async()=>fixture(async f=>{
 await withSharedWireTxV1(f,async raw=>{
  const full=sharedWireProposalsV1(f),shapes=Array.from({length:32},(_,mask)=>{const input=structuredClone(f.inputs[0]!);
   input.question_keys=input.question_keys.filter(k=>k==='voice'||k==='promotion'||Array.from({length:5},(_,i)=>'detail_'+String(i).padStart(3,'0')).some((key,i)=>key===k&&(mask&(1<<i))!==0));
   input.question_digests=Object.fromEntries(input.question_keys.map(k=>[k,input.question_digests[k]!]));const request=buildSignalListeningJevRequestV1(input,f.configuration);
   return{id:randomUUID(),request,inputs:[input],request_digest:signalListeningRequestDigestV1(f.run,input,request)};});
  const compared=await compareStatementFrameValidationV1(raw,sourceC,await params(raw,f,[...full,...shapes]));assert.equal(compared.canonical.length,35);
  const bag=await compareStatementFrameValidationV1(raw,sourceC,await params(raw,f,[...full,...shapes,full[0]!]));
  assert.equal(bag.canonical.length,36,'complete independent C validator preserves the duplicate expected-row bag');
  const cases=['{"same":{"n":1.23}}','{"same":{"n":1.2300}}','{"same":{"s":"é"}}','{"same":{"s":"é"}}','{}','{"null_wire":null}','{"arr":{"x":[3,2,1],"s":"\\n\\t\\\"\\\\😀"}}','{"é":{"a":1},"é":{"a":2},"Z":{},"a":{}}'];
  const kernels=cases.map((q,i)=>'{"id":"'+randomUUID()+'","native_questions":'+q+',"native_digests":{"q":"digest"},"i":{"root_id":"'+f.inputs[i%3]!.root_id+'","input_digest":"sha256:x"},"digests":{"q":"digest"},"basis":{"dynamic":"'+i+'"},"expected_request":{"model":"jev-1.13.0","state":"é é 😀 '+i+'","questions":'+q+'}}');
  for(const altered of ['null','[]','{"model":"other","questions":{},"state":"x"}','{"model":"jev-1.13.0","questions":{},"state":null}','{"model":"jev-1.13.0","questions":{},"state":"x","extra":1}'])
   kernels.push('{"id":"'+randomUUID()+'","native_questions":{},"native_digests":{},"i":{"root_id":null,"input_digest":"x"},"digests":{},"basis":null,"expected_request":'+altered+'}');
  for(const basis of ['null','[]','"dynamic scalar"','{"precise":1234567890.12345678901234567890}'])
   kernels.push('{"id":"'+randomUUID()+'","native_questions":{},"native_digests":{},"i":{"root_id":"'+f.inputs[0]!.root_id+'","input_digest":"x"},"digests":{},"basis":'+basis+',"expected_request":{"model":"jev-1.13.0","questions":{},"state":"x"}}');
  for(const digest of ['a','b'])kernels.push('{"id":"'+randomUUID()+'","native_questions":{"digest_probe":{}},"native_digests":{"digest_probe":"'+digest+'"},"i":{"root_id":"'+f.inputs[0]!.root_id+'","input_digest":"x"},"digests":{"digest_probe":"'+digest+'"},"basis":{},"expected_request":{"model":"jev-1.13.0","questions":{"digest_probe":{}},"state":"x"}}');
  const values=await params(raw,f,[]);values[7]='['+kernels.join(',')+']';const result=(await raw.query(statementFrameKernelV1(sourceC),values)).rows;
  assert.equal(result.length,kernels.length);assert.ok(result.every(r=>r.c_bytes===r.d_bytes&&r.c_digest===r.d_digest));
  assert.ok(result.some(r=>r.frame_used));assert.ok(result.some(r=>!r.frame_used));
  await raw.query('SAVEPOINT frame_kernel_unique_ids');
  const duplicate=JSON.parse(kernels[0]!);values[7]='['+kernels[0]+','+JSON.stringify(duplicate)+']';
  await assert.rejects(raw.query(statementFrameKernelV1(sourceC),values),(e:any)=>e.code==='22012');
  await raw.query('ROLLBACK TO SAVEPOINT frame_kernel_unique_ids');await raw.query('RELEASE SAVEPOINT frame_kernel_unique_ids');
  await raw.query('SAVEPOINT frame_kernel_nonnull_ids');duplicate.id=null;values[7]='['+JSON.stringify(duplicate)+']';
  await assert.rejects(raw.query(statementFrameKernelV1(sourceC),values),(e:any)=>e.code==='22012');
  await raw.query('ROLLBACK TO SAVEPOINT frame_kernel_nonnull_ids');await raw.query('RELEASE SAVEPOINT frame_kernel_nonnull_ids');
  values[7]='['+kernels.join(',')+']';
  const changed=[...values];changed[0]=randomUUID();changed[4]='sha256:'+'d'.repeat(64);
  const rebound=(await raw.query(statementFrameKernelV1(sourceC),changed)).rows;
  assert.equal(rebound.length,result.length);assert.ok(rebound.every((r,index)=>r.c_bytes===r.d_bytes&&r.c_digest===r.d_digest&&r.c_digest!==result[index]!.c_digest));
  const distinct=Array.from({length:1000},(_,i)=>'{"id":"'+randomUUID()+'","native_questions":{"q":{"text":"unique '+i+'"}},"native_digests":{"q":"digest_'+i+'"},"i":{"root_id":"'+f.inputs[0]!.root_id+'","input_digest":"sha256:'+i+'"},"digests":{"q":"digest_'+i+'"},"basis":{"dynamic":"'+i+'"},"expected_request":{"model":"jev-1.13.0","state":"root '+i+'","questions":{"q":{"text":"unique '+i+'"}}}}');
  values[7]='['+distinct.join(',')+']';const diverse=(await raw.query(statementFrameKernelV1(sourceC),values)).rows;
  assert.equal(diverse.length,1000);assert.ok(diverse.every(r=>r.c_bytes===r.d_bytes&&r.c_digest===r.d_digest&&!r.frame_used));
  report.byte_oracle={native_rows:compared.canonical.length,subsets:32,maximum_question_keys:256,representation_rows:result.length,
   fast_path_rows:result.filter(r=>r.frame_used).length,fallback_rows:result.filter(r=>!r.frame_used).length,
   every_shape_distinct_rows:diverse.length,every_shape_distinct_fallback_rows:diverse.filter(r=>!r.frame_used).length,
   bytes_equal:true,full_sha_equal:true,eight_typed_fields_equal:true,multiplicity_equal:true,independent_complete_validator_bag_rows:bag.canonical.length,
   representation_ids_unique_enforced:true,dynamic_run_context_rebound_equal:true};
 },true);
 for(const [arm,source]of [['C',sourceC],['D',sourceD]]as const)for(const defect of ['text','digest','question_digest','duplicate','input','map','configuration','basis','empty']){
  const rows=sharedWireProposalsV1(f),bad=rows[1]!,i=bad.inputs[0]!;
  if(defect==='text'){i.text+=' forged';bad.request={...bad.request,state:i.text};}if(defect==='question_digest')i.question_digests.voice='sha256:'+'f'.repeat(64);
  if(defect==='duplicate')i.question_keys=['voice','voice'];if(defect==='input')i.input_digest='sha256:'+'0'.repeat(64);if(defect==='map')i.map_id=randomUUID();
  if(defect==='configuration')i.configuration_digest='sha256:'+'1'.repeat(64);if(defect==='basis')i.scope_basis={voice:'forged'};if(defect==='empty')i.question_keys=[];
  bad.request_digest=signalListeningRequestDigestV1(f.run,i,bad.request);if(defect==='digest')bad.request_digest='sha256:'+'e'.repeat(64);bad.custom_id='listening_'+bad.request_digest.slice(7,67);
  await assert.rejects(withSharedWireTxV1(f,async raw=>{await raw.query(source);await insertSharedWireCallsV1(raw,f,rows);}),/listening_request_invalid|listening_call_questions_invalid/);
  report.all_attempts.push({arm,defect,rejected:true});
 }
 assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[f.run.id])).rows[0].n,0);
 assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_listening_call_questions WHERE run_id=$1',[f.run.id])).rows[0].n,0);
 for(const [arm,source]of [['C',sourceC],['D',sourceD]]as const){
  await assert.rejects(withSharedWireTxV1(f,async raw=>{await raw.query(source);
   await raw.query("UPDATE signal_labeling_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[f.run.id]);
   await insertSharedWireCallsV1(raw,f,sharedWireProposalsV1(f));}),/labeling_lease_lost/);
  report.all_attempts.push({arm,defect:'physical_lease_expired',rejected:true});
 }
},configuration(254))));
test('D frame native prior unknown and freshness remain authoritative',{skip:!enabled,timeout:600000},async()=>checked('prior_freshness',async()=>fixture(async f=>{
 const calls=await f.store.reserve(f.run,sharedWireProposalsV1(f));await f.store.markSubmitting(f.run,calls);await f.store.markFailed(f.run,calls,true);
 await withSharedWireTxV1(f,async raw=>{const result=await compareStatementFrameValidationV1(raw,sourceC,await params(raw,f,sharedWireProposalsV1(f),randomUUID()));assert.equal(result.flags.invalid_prior,true);},true);
 await assert.rejects(requestSignalListeningV1({database:f.database,workspace_id:f.run.workspace_id,actor_user_id:f.run.actor_user_id,configuration_id:f.configuration_id,map_id:f.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true}),/prior_outcome_unresolved|run_busy|already_running|labeling_already_active/);
 report.prior={real_unknown:true,invalid_prior_equal:true,new_request_rejected:true};
})));
async function readCPU(raw:PoolClient){const start=process.hrtime.bigint(),out=await raw.query(cpu.CPU_READ_SQL_V1),end=process.hrtime.bigint();assert.equal(out.rows.length,1);
 return cpu.parseQueryCpuSampleV1(out.rows[0],{start_ns:String(start),end_ns:String(end)},sequence++);}
async function pair(fixtureValue:SharedWireFixtureV1,scenario:string,distinct=false){
 const f={...fixtureValue,inputs:fixtureValue.inputs.slice(0,1000).map((input,index)=>{
  if(!distinct)return input;const i=structuredClone(input);i.question_keys=i.question_keys.filter(k=>k==='voice'||k==='promotion'||Array.from({length:10},(_,n)=>'detail_'+String(n).padStart(3,'0')).some((key,n)=>key===k&&(index&(1<<n))!==0));
  i.question_digests=Object.fromEntries(i.question_keys.map(k=>[k,i.question_digests[k]!]));return i;})};
 const fixed=sharedWireProposalsV1(f,500),expectedBefore=distinct?'0':'6012',expectedAfter=distinct?'500000':'506012';assert.equal(fixed.length,1000);
 const observation:any={scenario,configured_questions:f.configuration.questions.length,dimensions:statementFrameDimensionsV1(fixed),fixed_rows_sha256:hash(JSON.stringify(fixed)),order:STATEMENT_FRAME_ORDER_V1,
  SELECT:[],DML:[],controls:[],same_select_snapshot:true,fresh_dml_transactions:true,dml_same_snapshot:false,committed:false,existing_exposure_micro_usd:expectedBefore};
 if(distinct)assert.equal(observation.dimensions.distinct_exact_shapes,1000);else assert.deepEqual(observation.dimensions.selected_question_counts,[2]);
 const txIdentity=async(raw:PoolClient,readOnly:boolean)=>{const row=(await raw.query("SELECT current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') ro,pg_current_snapshot()::text snapshot")).rows[0];
  assert.equal(row.isolation,readOnly?'repeatable read':'read committed');assert.equal(row.ro,readOnly?'on':'off');return row;};
 const driver=(raw:PoolClient,sql:string,values?:unknown[])=>cpu.createQueryCpuDriverForTestV1({hz:owned.clk_tck,nowNs:()=>process.hrtime.bigint(),read:()=>readCPU(raw),
  validator:async()=>(await raw.query(sql,values)).rows[0],insert:async()=>{const inserted=await insertSharedWireCallsV1(raw,f,fixed);assert.equal(inserted.rows.length,1000);return inserted.rows.length;},
  mark:async()=>{await raw.query("UPDATE signal_labeling_calls SET status='submitting' WHERE id=ANY($1::uuid[])",[fixed.map(r=>r.id)]);},constraints:async()=>{await raw.query('SET CONSTRAINTS ALL IMMEDIATE');}});
 await withSharedWireTxV1(f,async raw=>{
  const identity=await txIdentity(raw,true),values=await params(raw,f,fixed),reference=await compareStatementFrameValidationV1(raw,sourceC,values);
  assert.deepEqual(reference.flags,{invalid_questions:false,invalid_request:false,invalid_prior:false});assert.equal(reference.canonical.length,1000);
  observation.binds_sha256=hash(JSON.stringify(values));observation.select_snapshot_sha256=hash(identity.snapshot);
  observation.controls.push({phase:'select_before',...await driver(raw,'').control()});
  for(const arm of STATEMENT_FRAME_ORDER_V1){const sql=anchorListeningStatementOracleParametersV1(sharedWireValidationV1(arm==='C'?sourceC:sourceD));
   const measured=await driver(raw,sql,values).selectC();assert.deepEqual(measured.flags,reference.flags);observation.SELECT.push({arm,...measured,stage:'validator_'+arm,result_sha256:hash(JSON.stringify(measured.flags)),validated_calls:fixed.length});}
  observation.controls.push({phase:'select_after',...await driver(raw,'').control()});assert.deepEqual(await txIdentity(raw,true),identity);
 },true);
 let baseline:string|undefined;for(const arm of STATEMENT_FRAME_ORDER_V1)await withSharedWireTxV1(f,async raw=>{
  await txIdentity(raw,false);assert.equal(await readSignalLabelingRunExposureV1(raw,f.run.id),expectedBefore);
  const caps=(await raw.query(`SELECT r.cap_micro_usd::text run_cap,a.execution_cap_micro_usd::text admission_cap,pa.max_execution_micro_usd::text action_cap
   FROM signal_labeling_runs r JOIN signal_processing_admissions a ON a.id=r.processing_admission_id JOIN signal_processing_policy_actions pa ON pa.policy_version_id=a.policy_version_id AND pa.action=a.action WHERE r.id=$1`,[f.run.id])).rows[0];
  for(const cap of [caps.run_cap,caps.admission_cap,caps.action_cap])assert.ok(cap===null||BigInt(cap)>=BigInt(expectedAfter));
  const prior=JSON.stringify((await raw.query("SELECT jsonb_build_object('calls',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM signal_labeling_calls c WHERE run_id=$1),'links',(SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY call_id,question_key),'[]') FROM signal_listening_call_questions q WHERE run_id=$1),'answers',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY root_id,question_key),'[]') FROM signal_listening_answers a WHERE run_id=$1)) value",[f.run.id])).rows[0].value);
  baseline??=prior;assert.equal(prior,baseline);await raw.query(arm==='C'?sourceC:sourceD);const ownedDriver=driver(raw,'');
  observation.controls.push({phase:'dml_before',arm,...await ownedDriver.control()});const measured=await ownedDriver.dmlC();
  observation.controls.push({phase:'dml_after',arm,...await ownedDriver.control()});
  const result=(await raw.query('SELECT id,status,request_digest,reserved_micro_usd::text FROM signal_labeling_calls WHERE id=ANY($1::uuid[]) ORDER BY id',[fixed.map(r=>r.id)])).rows;
  assert.equal(result.length,1000);assert.ok(result.every(r=>r.status==='submitting'));const exposure=await readSignalLabelingRunExposureV1(raw,f.run.id);assert.equal(exposure,expectedAfter);
  observation.DML.push({arm,...measured,result_count:result.length,result_sha256:hash(JSON.stringify(result)),baseline_sha256:hash(prior),exposure_micro_usd:exposure,caps,
   constraints_forced_before_rollback:true,committed:false});
 });
 assert.equal(new Set(observation.DML.map((r:any)=>r.result_sha256)).size,1);assert.equal(new Set(observation.DML.map((r:any)=>r.baseline_sha256)).size,1);
 report.paired.push(observation);
}
test('D frame native CDDC compares 1000 consumer calls with complete CPU brackets',{skip:!enabled,timeout:600000},async()=>checked('paired',async()=>{
 await fixture(f=>pair(f,'main_defined_consumer_4_configured_2_selected'),r16ListeningWorkloadV2('defined_consumer_second_pass').configuration,{mode:'scaled_recovery',consumer_category:true});
 await fixture(f=>pair(f,'1000_distinct_fresh_subsets_12_configured',true),configuration(10),{mode:'scaled_recovery'});
}));
test('D frame native concurrent same-key reservations remain idempotent',{skip:!enabled,timeout:600000},async()=>checked('concurrent',async()=>{
 for(const arm of ['C','D']as const)await fixture(async whole=>{
  const f={...whole,inputs:whole.inputs.slice(0,1000)},fixed=sharedWireProposalsV1(f,500);
  // This isolated native clone alone sees the committed test function, allowing
  // two real backend sessions to execute D. Always restore installed C.
  await withSharedWireDefaultPostcheckV1(async()=>{if(arm==='D')await f.database.query(sourceD);
   const result=await drainStatementFrameReservationsV1([f.store.reserve(f.run,fixed),f.store.reserve(f.run,fixed)]);
   assert.equal(result[0].length,1000);assert.equal(result[1].length,1000);
   assert.deepEqual(result[0].map(r=>r.id).sort(),result[1].map(r=>r.id).sort());
   const raw=await f.database.connect();try{
    assert.equal(await readSignalLabelingRunExposureV1(raw,f.run.id),'506012');
    const ids=result[0].map(r=>r.id),count=(await raw.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1 AND id=ANY($2::uuid[])',[f.run.id,ids])).rows[0].n;
    assert.equal(count,1000);
   }finally{raw.release();}
   const marks=await Promise.allSettled([f.store.markSubmitting(f.run,result[0]),f.store.markSubmitting(f.run,result[1])]);
   assert.equal(marks.filter(r=>r.status==='fulfilled').length,1);const denied=marks.find(r=>r.status==='rejected');assert.ok(denied&&denied.status==='rejected');
   assert.match(String(denied.reason?.message),/labeling_submission_conflict/);
   report.concurrent.push({arm,calls:result[0].length,reserve_attempts:result.length,same_durable_ids:true,exposure_micro_usd:'506012',
    mark_attempts:marks.length,mark_successes:marks.filter(r=>r.status==='fulfilled').length,second_mark_rejected:true,no_provider_attempts:true});
  },async()=>{if(arm==='D')await f.database.query(sourceC);});
 },r16ListeningWorkloadV2('defined_consumer_second_pass').configuration,{mode:'scaled_recovery',consumer_category:true});
}));
