import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {signalListeningBaseTemplateV1,buildSignalListeningJevRequestV1,signalListeningRequestDigestV1} from '@noisia/query-engine';
import {requestSignalListeningV1,createSignalListeningStoreV1} from '../signal-listening-runs';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import type {LabelingRunV1} from '../signal-labeling-runs';
import {readSignalLabelingRunExposureV1} from '../signal-labeling-runs';
import {r16ListeningWorkloadV2} from '../../../scripts/r16/listening-workload';
import type {LabelingDatabaseV1} from '../signal-mention-facets';
import {withSharedWireFixtureV1 as unverifiedSharedWireFixtureV1,withSharedWireTxV1,sharedWireProposalsV1,insertSharedWireCallsV1,prepareSharedWireRawV1,type SharedWireFixtureV1} from './signal-listening-statement-shared-wire.fixture';
import {sharedWireNativeSourcesV1,sharedWireValidationV1,compareSharedWireValidationV1,sharedWireRepresentationKernelV1,sharedWireShaV1,sharedWirePayloadBarrierSourceV1,sharedWireNativeVariantsV1,statementNativeRepresentationKernelV1,sharedWirePlanSummaryV1,sharedWireFunctionStatsV1,sharedWireFunctionDeltaV1,assertSharedWireDefaultRuntimeV1,withSharedWireDefaultPostcheckV1,assertStatementNativeCatalogReplacementV1,assertStatementNativeColumnACLAndRevokeV1} from './signal-listening-statement-shared-wire.oracle';
import {anchorListeningStatementOracleParametersV1} from './signal-listening-statement-validator.oracle';
const enabled=process.env.NOISIA_R16_STATEMENT_SHARED_WIRE_PG==='true';
let defaultFixtureSequence=0;
async function withSharedWireFixtureV1(...args:Parameters<typeof unverifiedSharedWireFixtureV1>){
 const [body,configuration,options]=args,fixture_ordinal=++defaultFixtureSequence;
 await unverifiedSharedWireFixtureV1(async f=>{
  const before=await assertSharedWireDefaultRuntimeV1(f.database);
  console.log('# statement shared wire DEFAULT '+JSON.stringify({receipt_id:`shared-wire-default-${fixture_ordinal}-before`,fixture_ordinal,phase:'before',...before}));
  await withSharedWireDefaultPostcheckV1(()=>body(f),async()=>{
   const after=await assertSharedWireDefaultRuntimeV1(f.database);assert.deepEqual(after,before,'all temporary oracle sources must roll back to the actual default');
   console.log('# statement shared wire DEFAULT '+JSON.stringify({receipt_id:`shared-wire-default-${fixture_ordinal}-after`,fixture_ordinal,phase:'after',...after}));
  });
 },configuration,options);
}
const snapshot=async(c:PoolClient,f:SharedWireFixtureV1)=>(await c.query("SELECT jsonb_build_object('calls',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM signal_labeling_calls c WHERE run_id=$1),'links',(SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY call_id,question_key),'[]') FROM signal_listening_call_questions q WHERE run_id=$1),'answers',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY root_id,question_key),'[]') FROM signal_listening_answers a WHERE run_id=$1)) value",[f.run.id])).rows[0].value;
async function params(c:PoolClient,f:SharedWireFixtureV1,rows:unknown[],target=f.run.id){const owner=(await c.query('SELECT configuration_id,map_id,configuration_digest FROM signal_listening_runs WHERE run_id=$1',[f.run.id])).rows[0];return[target,f.run.workspace_id,owner.configuration_id,owner.map_id,f.run.entity_context_digest,f.inputs.map(i=>i.root_id),owner.configuration_digest,JSON.stringify(rows)];}
const rich=()=>{const b=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']});return{...b,instructions:b.instructions+' é é 😀 "quoted" \\ \n',questions:[...b.questions,...Array.from({length:254},(_,i)=>({key:'detail_'+String(i).padStart(3,'0'),type:'noul' as const,text:'Café 😀?',positive:'sí 漢字',negative:'no',scope:'all' as const,origin:'brand_os' as const,human_locked:false}))]};};
test('0330 native same-snapshot validators preserve32shapes256keys UTF8 precision and mixed-wire fallback',{skip:!enabled,timeout:600000},async()=>withSharedWireFixtureV1(async f=>{
 const [old,next,projection]=await sharedWireNativeSourcesV1();assert.ok(old&&next);
 await withSharedWireTxV1(f,async c=>{
  const rows=sharedWireProposalsV1(f);assert.equal(rows[0]!.inputs[0]!.question_keys.length,256);
  assert.deepEqual((await compareSharedWireValidationV1(c,old,next,await params(c,f,rows),projection)).flags,{invalid_questions:false,invalid_request:false,invalid_prior:false});
  assert.equal((await compareSharedWireValidationV1(c,old,next,await params(c,f,[]),projection)).canonical.length,0);
  assert.equal((await compareSharedWireValidationV1(c,old,next,await params(c,f,[...rows,rows[0]!]),projection)).canonical.length,rows.length+1,'duplicate IDs retain the expected-row bag');
  const nullRequest=structuredClone(rows)as unknown as Array<Record<string,unknown>>;nullRequest[0]!.request=null;
  assert.equal((await compareSharedWireValidationV1(c,old,next,await params(c,f,nullRequest),projection)).flags.invalid_request,true);
  const missing=structuredClone(rows);missing[0]!.inputs[0]!.root_id=randomUUID();
  const absent=await compareSharedWireValidationV1(c,old,next,await params(c,f,missing),projection);assert.equal(absent.flags.invalid_questions,true);
  const shapes=Array.from({length:32},(_,mask)=>{const input=structuredClone(f.inputs[0]!);input.question_keys=input.question_keys.filter(k=>k==='voice'||k==='promotion'||Array.from({length:5},(_,i)=>'detail_'+String(i).padStart(3,'0')).some((k2,i)=>k2===k&&(mask&(1<<i))!==0));input.question_digests=Object.fromEntries(input.question_keys.map(k=>[k,input.question_digests[k]!]));const request=buildSignalListeningJevRequestV1(input,f.configuration),request_digest=signalListeningRequestDigestV1(f.run,input,request);return{id:randomUUID(),inputs:[input],request,request_digest};});
  assert.deepEqual((await compareSharedWireValidationV1(c,old,next,await params(c,f,shapes),projection)).flags,{invalid_questions:false,invalid_request:false,invalid_prior:false});
  const cases=['{"same":{"n":1.23}}','{"same":{"n":1.2300}}','{"same":{"s":"é"}}','{"same":{"s":"é"}}','{}','{"criteria_probe":{"criteria":{"positive":{"description":"é"},"negative":null}}}','{"criteria_array":{"criteria":["x",null,1.2300]}}','{"null_wire":null}','{"escape":{"s":"\\n\\t\\\"\\\\😀"}}'];
  // Same key with different numeric representations/configuration wires occurs
  // IN THIS ONE statement; ambiguity must use complete original fallback.
  const json='['+cases.map((q,i)=>'{"id":"'+randomUUID()+'","native_questions":'+q+',"i":{"root_id":"'+f.inputs[i%3]!.root_id+'","input_digest":"sha256:x"},"digests":'+(i%2?'null':'{"q":1234567890.1234567890123456789}')+',"basis":{},"expected_request":{"model":"jev-1.13.0","state":"é é 😀\\n","questions":'+q+'}}').join(',')+']';
  const values=await params(c,f,[]);values[7]=json;const out=(await c.query(sharedWireRepresentationKernelV1(old,next),values)).rows;assert.equal(out.length,cases.length);const native=(await c.query(statementNativeRepresentationKernelV1(old,next,projection),values)).rows;assert.equal(native.length,out.length);for(const[index,row]of native.entries()){assert.equal(row.native_bytes,out[index]!.before_bytes);assert.deepEqual(row.fragment_keys,[...out[index]!.fragment_keys].sort());}assert.ok(out.every(r=>r.before_bytes===r.after_bytes&&r.before_bytes===r.variant_bytes));assert.ok(out.every(r=>!r.fragment_keys.includes('same')&&r.fragment_keys.includes('null_wire')&&r.fragment_keys.includes('escape')),'ambiguous same-key exact UTF8 patterns are excluded, while unambiguous wires really compile');
  // Unique native keys still must reject a different UTF8 representation in
  // the payload; JSONB numerical equality is not representation equality.
  const mismatches=[['{"wire_scale":{"n":1.23}}','{"wire_scale":{"n":1.2300}}'],['{"wire_unicode":{"s":"é"}}','{"wire_unicode":{"s":"é"}}']]as const;
  values[7]='['+mismatches.map(([actual,expected],index)=>'{"id":"'+randomUUID()+'","native_questions":'+actual+',"i":{"root_id":"'+f.inputs[index]!.root_id+'","input_digest":"sha256:x"},"digests":{},"basis":{},"expected_request":{"model":"jev-1.13.0","state":"x","questions":'+expected+'}}').join(',')+']';
  const mismatchRows=(await c.query(statementNativeRepresentationKernelV1(old,next,projection),values)).rows;assert.equal(mismatchRows.length,2);assert.ok(mismatchRows.every(row=>row.before_bytes===row.native_bytes),'unique-key mismatched numeric scale/Unicode falls back to full legacy bytes');
  for(const altered of ['null','[]','{"model":"jev-1.13.0","questions":[],"state":"x"}','{"model":"jev-1.13.0","questions":null,"state":"x"}','{"model":"jev-1.13.0","questions":{"missing_wire":{}},"state":"x"}','{"model":"other","questions":null,"state":null}','{"model":"jev-1.13.0","questions":{},"state":"x","extra":1}']){
   const kernel='[{"id":"'+randomUUID()+'","native_questions":{},"i":{},"digests":null,"basis":null,"expected_request":'+altered+'}]';values[7]=kernel;assert.ok((await c.query(sharedWireRepresentationKernelV1(old,next),values)).rows.every(r=>r.before_bytes===r.after_bytes&&r.before_bytes===r.variant_bytes));const native=(await c.query(statementNativeRepresentationKernelV1(old,next,projection),values)).rows;assert.ok(native.every(r=>r.before_bytes===r.native_bytes));assert.equal(native.length,1);
   // Keep the historical invalid-scalar probe above, then make all required
   // identity scalars valid so each request/null/array/missing-wire guard itself is reached.
   values[7]=kernel.replace('"i":{}','"i":{"root_id":"'+f.inputs[0]!.root_id+'","input_digest":"sha256:x"}');
   const exactLegacy=(await c.query(sharedWireRepresentationKernelV1(old,next),values)).rows,exactNative=(await c.query(statementNativeRepresentationKernelV1(old,next,projection),values)).rows;assert.equal(exactLegacy.length,1);assert.equal(exactNative.length,1);assert.ok(exactLegacy.every(r=>r.before_bytes===r.after_bytes&&r.before_bytes===r.variant_bytes));assert.equal(exactNative[0]!.id,exactLegacy[0]!.id);assert.equal(exactNative[0]!.native_bytes,exactLegacy[0]!.before_bytes);
  }
 },true);
},rich()));

test('0330 native reserve Mark bad-mixed rollback and deferred pre-owner forged hash stay enforced',{skip:!enabled,timeout:600000},async()=>withSharedWireFixtureV1(async f=>{
 const [old,next,projection]=await sharedWireNativeSourcesV1();assert.ok(old&&next);
 for(const [,source]of sharedWireNativeVariantsV1(old,next,projection))for(const defect of ['text','digest','question_digest','duplicate','input','map','configuration','basis','empty']){
  const rows=sharedWireProposalsV1(f),bad=rows[1]!,i=bad.inputs[0]!;
  if(defect==='text'){i.text+=' forged';bad.request={...bad.request,state:i.text};}if(defect==='question_digest')i.question_digests.voice='sha256:'+'f'.repeat(64);
  if(defect==='duplicate')i.question_keys=['voice','voice'];if(defect==='input')i.input_digest='sha256:'+'0'.repeat(64);if(defect==='map')i.map_id=randomUUID();if(defect==='configuration')i.configuration_digest='sha256:'+'1'.repeat(64);if(defect==='basis')i.scope_basis={voice:'forged'};if(defect==='empty')i.question_keys=[];
  bad.request_digest=signalListeningRequestDigestV1(f.run,i,bad.request);if(defect==='digest')bad.request_digest='sha256:'+'e'.repeat(64);bad.custom_id='listening_'+bad.request_digest.slice(7,67);
  await assert.rejects(withSharedWireTxV1(f,async c=>{await c.query(source);await insertSharedWireCallsV1(c,f,rows);}),defect==='text'||defect==='digest'?/listening_request_invalid/:/listening_call_questions_invalid/);
 }
 assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[f.run.id])).rows[0].n,0);
 assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_listening_call_questions WHERE run_id=$1',[f.run.id])).rows[0].n,0,'no valid sibling links survive any forged mixed statement');
 // A direct native request inserts the run and its immutable owner in one TX.
 // Interpose BEFORE that real owner INSERT, never delete/alter an owner or guard.
 await f.store.release(f.run);assert.equal((await f.database.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM signal_labeling_calls WHERE run_id=$1) RETURNING id",[f.run.id])).rows.length,1);
 let injected=false,runId='',callId='';
 const database={query:f.database.query.bind(f.database),connect:async()=>{const c=await f.database.connect();return new Proxy(c,{get(target,key){if(key==='query')return async(sql:string,values?:unknown[])=>{
  if(sql.startsWith('INSERT INTO signal_listening_runs(')&&!injected){injected=true;runId=String(values![0]);
   const actual=(await target.query("UPDATE signal_labeling_runs SET status='running',lease_token=$2,lease_until=clock_timestamp()+interval '5 minutes' WHERE id=$1 AND status='queued' RETURNING processing_admission_id",[runId,randomUUID()])).rows[0];assert.ok(actual);
   assert.equal((await target.query('SELECT count(*)::int n FROM signal_listening_runs WHERE run_id=$1',[runId])).rows[0].n,0);
   const provisional={...f,run:{...f.run,id:runId,processing_admission_id:actual.processing_admission_id}};const rows=sharedWireProposalsV1(provisional).slice(0,1);rows[0]!.request_digest='sha256:'+'d'.repeat(64);rows[0]!.custom_id='listening_'+rows[0]!.request_digest.slice(7,67);callId=rows[0]!.id;
   await insertSharedWireCallsV1(target,provisional,rows);
  }return target.query(sql,values);
 };const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});}} as LabelingDatabaseV1;
 await requestSignalListeningV1({database,workspace_id:f.run.workspace_id,actor_user_id:f.run.actor_user_id,configuration_id:f.configuration_id,map_id:f.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true});assert.equal(injected,true);
 assert.equal((await f.database.query('SELECT status FROM signal_labeling_calls WHERE id=$1',[callId])).rows[0].status,'reserved');
 for(const [,source]of sharedWireNativeVariantsV1(old,next,projection))await assert.rejects(withSharedWireTxV1(f,async c=>{await c.query(source);await c.query("UPDATE signal_labeling_calls SET status='submitting' WHERE id=$1",[callId]);}),/listening_request_invalid/);
 assert.equal((await f.database.query('SELECT status FROM signal_labeling_calls WHERE id=$1',[callId])).rows[0].status,'reserved');
}));

test('0330 native real prior unknown is true and target ownership never becomes a cached authority',{skip:!enabled,timeout:600000},async()=>withSharedWireFixtureV1(async f=>{
 const [old,next,projection]=await sharedWireNativeSourcesV1();assert.ok(old&&next);const calls=await f.store.reserve(f.run,sharedWireProposalsV1(f));await f.store.markSubmitting(f.run,calls);await f.store.markFailed(f.run,calls,true);
 await withSharedWireTxV1(f,async c=>{const rows=sharedWireProposalsV1(f),values=await params(c,f,rows,randomUUID());const result=await compareSharedWireValidationV1(c,old,next,values,projection);assert.equal(result.flags.invalid_prior,true,'genuine native unknown transport from OTHERrun is not0');},true);
 await assert.rejects(requestSignalListeningV1({database:f.database,workspace_id:f.run.workspace_id,actor_user_id:f.run.actor_user_id,configuration_id:f.configuration_id,map_id:f.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true}),/prior_outcome_unresolved|run_busy|already_running|labeling_already_active/);
}));

test('0330 preserves answer BEFORE attempts including conflict-suppressed bad tuples and native source bytes',{skip:!enabled,timeout:600000},async()=>withSharedWireFixtureV1(async f=>{
 const outcomes=await prepareSharedWireRawV1(f),observer=await f.database.connect();let answer:Record<string,unknown>;
 try{await observer.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  assert.equal((await observer.query('SELECT count(*)::int n FROM signal_listening_answers WHERE run_id=$1',[f.run.id])).rows[0].n,0);
  await f.store.apply(f.run,outcomes.map(o=>({call:o.call,results:[o.result]})));
  answer=(await f.database.query('SELECT to_jsonb(a) value FROM signal_listening_answers a WHERE run_id=$1 ORDER BY root_id,question_key LIMIT 1',[f.run.id])).rows[0].value;
  assert.equal((await observer.query('SELECT count(*)::int n FROM signal_listening_answers WHERE run_id=$1',[f.run.id])).rows[0].n,0,'conflicting committed rows are genuinely invisible to this pre-existing RR');
  await assert.rejects(observer.query('INSERT INTO signal_listening_answers SELECT * FROM jsonb_populate_record(NULL::signal_listening_answers,$1::jsonb) ON CONFLICT DO NOTHING',[JSON.stringify({...answer,raw_sha256:'forged'})]),/listening_answer_receipt_invalid/);
 }finally{await observer.query('ROLLBACK');observer.release();}
 for(const patch of [{raw_sha256:'sha256:'+'f'.repeat(64)},{request_digest:'forged'},{input_digest:'stale'},{answer:{type:'noul',noul:2}}])await assert.rejects(withSharedWireTxV1(f,c=>c.query('INSERT INTO signal_listening_answers SELECT * FROM jsonb_populate_record(NULL::signal_listening_answers,$1::jsonb) ON CONFLICT DO NOTHING',[JSON.stringify({...answer,...patch})]).then(()=>{})),/listening_answer_receipt_invalid|listening_answer_invalid/);
 await assert.rejects(withSharedWireTxV1(f,c=>c.query('UPDATE signal_listening_answers SET answer=answer WHERE run_id=$1',[f.run.id]).then(()=>{})),/listening_history_immutable/);
 assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_listening_answers WHERE run_id=$1',[f.run.id])).rows[0].n,6);

}));

test('0330 native DML ABBA keeps full guards and fresh transactions and rejects expiry with atomic rollback',{skip:!enabled,timeout:600000},async()=>{
 const [old,next,projection]=await sharedWireNativeSourcesV1();assert.ok(old&&next);const variant=sharedWirePayloadBarrierSourceV1(next);
 // Native 1002-root clone, never the global benchmark Pool. Complete real base
 // first, then measure1000 consumer calls with actual nonempty scope_basis.
 await withSharedWireFixtureV1(async fixture=>{
  assert.equal(fixture.inputs.length,1002);const f={...fixture,inputs:fixture.inputs.slice(0,1000)},fixed=sharedWireProposalsV1(f,500);
  const observations:Array<{arm:string;wall_ms:number;result_sha256:string;result_count:number;transaction_isolation:string;transaction_read_only:boolean;function_stats:ReturnType<typeof sharedWireFunctionDeltaV1>}>=[];let baseline:string|undefined;
  await withSharedWireTxV1(f,async c=>{
   assert.deepEqual((await c.query("SELECT current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') read_only")).rows[0],{isolation:'repeatable read',read_only:'on'});
   assert.equal(await readSignalLabelingRunExposureV1(c,f.run.id),'6012','1002 native base calls settled6 each; no reservation is hidden');
   const caps=(await c.query(`SELECT r.cap_micro_usd::text run_cap,a.execution_cap_micro_usd::text admission_cap,pa.max_execution_micro_usd::text action_cap
    FROM signal_labeling_runs r JOIN signal_processing_admissions a ON a.id=r.processing_admission_id
    JOIN signal_processing_policy_actions pa ON pa.policy_version_id=a.policy_version_id AND pa.action=a.action WHERE r.id=$1`,[f.run.id])).rows[0];
   for(const cap of [caps.run_cap,caps.admission_cap,caps.action_cap])assert.ok(cap===null||BigInt(cap)>=506012n,'500000consumer reservation+6012existing cost fits the unchanged native caps');
   const result=await compareSharedWireValidationV1(c,old,next,await params(c,f,fixed),projection);assert.deepEqual(result.flags,{invalid_questions:false,invalid_request:false,invalid_prior:false});
   assert.equal(result.canonical.length,1000);assert.ok(f.inputs.every(i=>Object.keys(i.scope_basis).length===2));
   const validationValues=await params(c,f,fixed),selectObservations=[];
   const balanced=[...sharedWireNativeVariantsV1(old,next,projection),...[...sharedWireNativeVariantsV1(old,next,projection)].reverse()];
   // Time the actual complete three-flag validator, not the byte oracle which
   // deliberately materializes canonical equally in all three arms.
   for(const [arm,source]of balanced){
    const sql=anchorListeningStatementOracleParametersV1(sharedWireValidationV1(source)),beforeStats=await sharedWireFunctionStatsV1(c),started=process.hrtime.bigint();
    const flags=(await c.query(sql,validationValues)).rows[0],wall_ms=Number(process.hrtime.bigint()-started)/1e6;
    const afterStats=await sharedWireFunctionStatsV1(c);assert.deepEqual(flags,result.flags);
    selectObservations.push({arm,wall_ms,result_count:1,validated_calls:1000,result_sha256:sharedWireShaV1(JSON.stringify(flags)),validation_sql_sha256:sharedWireShaV1(sql),function_stats:sharedWireFunctionDeltaV1(beforeStats,afterStats)});
   }
   console.log('# statement payload native SELECT '+JSON.stringify({contract:'r16-statement-payload-select-v1',order:'ABCD-DCBA',transaction_isolation:'repeatable read',transaction_read_only:true,same_snapshot:true,calls_per_arm:1000,binds_sha256:sharedWireShaV1(JSON.stringify(validationValues)),byte_oracle_timed:false,arms:selectObservations,cpu_claim:false,gain_claim:false}));
   // A real32-call consumer slice bounds verbose plan construction/output.
   // The independently measured DML cohort remains1000 calls per arm.
   const planFixture={...f,inputs:f.inputs.slice(0,32)},planValues=await params(c,planFixture,fixed.slice(0,32));
   assert.equal((await compareSharedWireValidationV1(c,old,next,planValues,projection)).canonical.length,32);
   for(const [arm,source]of sharedWireNativeVariantsV1(old,next,projection)){
    const sql=anchorListeningStatementOracleParametersV1(sharedWireValidationV1(source));
    const raw=(await c.query('EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON, TIMING OFF) '+sql,planValues)).rows[0]['QUERY PLAN'];
    console.log('# statement payload native PLAN '+JSON.stringify({contract:'r16-statement-payload-plan-v1',arm,source_sha256:sharedWireShaV1(source),validation_sql_sha256:sharedWireShaV1(sql),binds_sha256:sharedWireShaV1(JSON.stringify(planValues)),requested_roots:32,expected_rows_verified:32,question_keys_per_row:2,transaction_isolation:'repeatable read',transaction_read_only:true,same_snapshot:true,plan:sharedWirePlanSummaryV1(raw),cpu_claim:false,gain_claim:false}));
   }
  },true);
  // Fresh RC/RW transactions are required by native capacity admissions; the
  // equal restored prestate is compared per arm, not claimed as one RR snapshot.
  for(const [arm,source]of [...sharedWireNativeVariantsV1(old,next,projection),...[...sharedWireNativeVariantsV1(old,next,projection)].reverse()]){await withSharedWireTxV1(f,async c=>{
   const transaction=(await c.query("SELECT current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') read_only")).rows[0];
   assert.deepEqual(transaction,{isolation:'read committed',read_only:'off'});
   const before=JSON.stringify(await snapshot(c,f));baseline??=before;assert.equal(before,baseline);await c.query(source);const beforeStats=await sharedWireFunctionStatsV1(c);
   const started=process.hrtime.bigint();const inserted=await insertSharedWireCallsV1(c,f,fixed);assert.equal(inserted.rows.length,1000);
   await c.query("UPDATE signal_labeling_calls SET status='submitting' WHERE id=ANY($1::uuid[])",[fixed.map(r=>r.id)]);
   await c.query('SET CONSTRAINTS ALL IMMEDIATE');const wall_ms=Number(process.hrtime.bigint()-started)/1e6;
   const afterStats=await sharedWireFunctionStatsV1(c),result=(await c.query('SELECT id,status,request_digest,reserved_micro_usd::text FROM signal_labeling_calls WHERE id=ANY($1::uuid[]) ORDER BY id',[fixed.map(row=>row.id)])).rows;
   assert.equal(result.length,1000);assert.ok(result.every(row=>row.status==='submitting'));assert.equal(await readSignalLabelingRunExposureV1(c,f.run.id),'506012');
   observations.push({arm,wall_ms,result_count:result.length,result_sha256:sharedWireShaV1(JSON.stringify(result)),transaction_isolation:transaction.isolation,transaction_read_only:transaction.read_only==='on',function_stats:sharedWireFunctionDeltaV1(beforeStats,afterStats)});
  });}
  assert.equal(new Set(observations.map(o=>o.result_sha256)).size,1);
  assert.deepEqual(observations.map(o=>o.arm),['before','after','variant','native','native','variant','after','before']);
  assert.deepEqual(observations.filter(o=>o.arm==='before'||o.arm==='after').map(o=>o.arm),['before','after','after','before']);
  console.log('# statement shared wire native DML '+JSON.stringify({contract:'r16-statement-shared-wire-dml-pair-v4',order:'ABCD-DCBA',arm_definitions:{before:'0329',after:'0330 frozen historical B',variant:'frozen0331 C payload',native:'0336 relational projection D'},source_sha256:Object.fromEntries(sharedWireNativeVariantsV1(old,next,projection).map(([arm,source])=>[arm,sharedWireShaV1(source)])),fixed_rows_sha256:sharedWireShaV1(JSON.stringify(fixed)),population:1002,calls_per_arm:1000,reservation_per_call_micro_usd:500,existing_base_micro_usd:'6012',scope:'genuine consumer2 with native nonempty scope_basis',baseline_sha256:sharedWireShaV1(baseline!),arms:observations,committed:false,guard_checks:'native constraints forced immediate before rollback; not deferredCOMMIT timing',fresh_transactions:true,dml_same_snapshot:false,select_comparison:{transaction_isolation:'repeatable read',transaction_read_only:true,same_snapshot:true},cpu_claim:false,h1_claim:false,gain_claim:false}));
 },r16ListeningWorkloadV2('defined_consumer_second_pass').configuration,{mode:'scaled_recovery',consumer_category:true});
 // Separate small3-root fixture: never allow the large SQL to consume the
 // lease before reaching the deliberately delayed native COMMIT.
 await withSharedWireFixtureV1(async f=>{
  assert.equal(f.inputs.length,3);const calls=await f.store.reserve(f.run,sharedWireProposalsV1(f));
  for(const source of [old,next,variant,projection]){
   await f.database.query("UPDATE signal_labeling_runs SET lease_until=clock_timestamp()+interval '1500 milliseconds' WHERE id=$1",[f.run.id]);let delayed=false;
   const database={query:f.database.query.bind(f.database),connect:async()=>{const c=await f.database.connect();return new Proxy(c,{get(target,key){if(key==='query')return async(sql:string,values?:unknown[])=>{
    if(sql==='COMMIT'){delayed=true;await new Promise(resolve=>setTimeout(resolve,1700));}
    const result=await target.query(sql,values);if(sql==='BEGIN')await target.query(source);return result;
   };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}} as LabelingDatabaseV1;
   const store=createSignalListeningStoreV1({database,rawPages:f.rawPages,storeRaw:async()=>{throw Error('no provider');}});
   await assert.rejects(store.markSubmitting(f.run,calls),/labeling_lease_lost/);assert.equal(delayed,true,'real deferred constraint rejects actualCOMMIT, not an earlier fence');
   const c=await f.database.connect();try{const state=await snapshot(c,f);assert.ok(state.calls.every((row:{status:string})=>row.status==='reserved'));assert.equal(state.answers.length,0);
    assert.equal((await c.query('SELECT count(*)::int n FROM signal_labeling_page_mutation_fences WHERE run_id=$1',[f.run.id])).rows[0].n,0);
   }finally{c.release();}
  }
 });
});

test('0336 retains native function OID/owner/ACL and fresh nonowner column/EXECUTE gates',{skip:!enabled,timeout:600000},async()=>withSharedWireFixtureV1(async f=>{
 const [old,next,projection]=await sharedWireNativeSourcesV1();assert.ok(old&&next);const sourceC=sharedWirePayloadBarrierSourceV1(next);
 await withSharedWireTxV1(f,async c=>{
  await assertStatementNativeCatalogReplacementV1(c,sourceC,projection);
  const values=await params(c,f,sharedWireProposalsV1(f));await assertStatementNativeColumnACLAndRevokeV1(c,sourceC,projection,values);
 });
}));
