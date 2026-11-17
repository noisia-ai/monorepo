import{signalStudyQueryMetadataAggregateSqlV1}from'../signal-study-query-metadata';
import assert from'node:assert/strict';
import test from'node:test';
import{createHash,randomUUID}from'node:crypto';
import{signalWorkspaceEmbeddingDigestV1 as digest,SIGNAL_STUDY_BOUNDARY_RULE_VERSION_V1,SIGNAL_STUDY_EDITORIAL_COMPILER_V2,type SignalStudyEditorialFormatStopV1}from'@noisia/query-engine';
import type{StudyRuntimeLeaseV1,StudyRuntimeStepPlanV1}from'../../../services/workers/src/workers/signal-study-runtime';
import{withSignalStudyFixtureV1}from'./signal-study.synthetic.fixture';
import{withStudyNativeRuntimeV1}from'./signal-study-runtime.synthetic.fixture';
import{claimSignalStudyExecutionV1,pendingSignalStudyExecutionsV1}from'../signal-study-executions';
import{readSignalStudyOutputV1}from'../signal-study-serving';
import{readSignalStudyStabilityProofV1}from'../signal-study-replay';
const enabled=process.env.NOISIA_R16_STUDY_PG==='true',sha=(s:string)=>'sha256:'+createHash('sha256').update(s).digest('hex');

test('native V2 batches retain full 35+5 samples, exact requests, independent blind passes and settled page lineage',{
 skip:!enabled,timeout:1200000,
},async()=>withSignalStudyFixtureV1(async f=>withStudyNativeRuntimeV1(f.database,async runtime=>{
 const sent:StudyRuntimeStepPlanV1[]=[],send=runtime.drivers.send;runtime.drivers.send=async(plan,signal)=>{sent.push(plan);return send(plan,signal);};
 const execution=await f.request(),result=await runtime.run(execution.id);assert.equal(result.status,'completed');
 const parent=(await f.database.query('SELECT source_header FROM signal_study_executions WHERE id=$1',[execution.id])).rows[0];assert.equal(parent.source_header.editorial_compiler_version,SIGNAL_STUDY_EDITORIAL_COMPILER_V2);
 assert.ok(sent.every(plan=>Buffer.byteLength(plan.request_body)<=524288&&sha(plan.request_body)===plan.request_sha256));
 const payloads=sent.map(plan=>JSON.parse(JSON.parse(plan.request_body).messages[0].content).untrusted_data),local=payloads.filter(p=>p.groups),global=payloads.filter(p=>p.contract_version==='signal-study-reconciliation-input-v2'),layers=payloads.filter(p=>p.diagnostics);
 assert.ok(local.length>=1);assert.equal(global.length,1,'a real global reconciliation is separate from local judgments');assert.ok(layers.length>=4,'output and input bounds split both blind passes without truncating samples');
 const numeric=(await f.database.query('SELECT value,manifest_json FROM signal_study_numeric_checkpoints WHERE execution_id=$1',[execution.id])).rows[0],groups=numeric.value.groups.map((g:{key:string})=>g.key).sort();
 assert.deepEqual(local.flatMap(p=>p.groups.map((g:{group_key:string})=>g.group_key)).sort(),groups,'each actual BERTopic group is covered exactly once');
 for(const p of local)for(const group of p.groups){assert.equal(group.rows.length,40);assert.equal(group.rows.filter((r:{source:string})=>r.source==='random').length,35);assert.equal(group.rows.filter((r:{source:string})=>r.source==='far').length,5);for(const row of group.rows){assert.ok(row.text.length>=3900);assert.equal(sha(row.text),row.text_sha256);}}
 const passes=new Map<string,Set<string>[]>();for(const p of layers)for(const motive of p.motives){assert.equal(motive.sample.length,40);passes.set(motive.key,[...(passes.get(motive.key)??[]),new Set(motive.sample.map((r:{root_id:string})=>r.root_id))]);}
 for(const pair of passes.values()){assert.equal(pair.length,2);assert.equal([...pair[0]!].filter(id=>pair[1]!.has(id)).length,0,'the two paid blind passes keep independent disjoint rows');}
 const calls=(await f.database.query(`SELECT s.id,s.status,s.mode,s.value_digest,c.call_state,c.settled_micro_usd,c.response_sha256 FROM signal_study_steps s JOIN engine_cost_events c ON c.study_step_id=s.id WHERE s.execution_id=$1`,[execution.id])).rows;assert.equal(calls.length,sent.length);assert.ok(calls.every(row=>row.status==='committed'&&row.call_state==='settled'&&BigInt(row.settled_micro_usd)>0n&&row.response_sha256));assert.equal(calls.filter(row=>row.mode==='reconciliation').length,1);
 const report=await readSignalStudyOutputV1({...f,execution_id:execution.id});assert.ok(report);assert.equal(report.output.summary.denominator,240);assert.equal(report.output.stability?.kappa,1);
 const audit=await readSignalStudyStabilityProofV1({...f,execution_id:execution.id});assert.ok(audit);assert.deepEqual(audit.stability,report.output.stability);assert.equal(audit.output_digest,report.output_digest);assert.equal(await readSignalStudyStabilityProofV1({...f,execution_id:randomUUID()}),null);
 const chunks=(await f.database.query(`SELECT min(jsonb_array_length(asset.chunks->'chunks'))::int n FROM signal_study_source_roots root JOIN signal_corpus_text_assets asset ON asset.workspace_id=root.workspace_id AND asset.text_sha256=root.asset_sha256 AND asset.chunk_policy_version=root.chunk_policy_version WHERE root.execution_id=$1`,[execution.id])).rows[0].n;assert.ok(chunks>1,'long source documents use real prepared multi-chunk assets');
 assert.equal(Number((await f.database.query('SELECT count(*)::int n FROM signal_study_format_stops WHERE execution_id=$1',[execution.id])).rows[0].n),0);
 const before=runtime.metrics();assert.equal((await runtime.run(execution.id)).status,'not_claimed');assert.deepEqual(runtime.metrics(),before);assert.equal(new Set(runtime.sentStepKeys()).size,runtime.sentStepKeys().length);
 const previous=runtime.metrics(),second=await f.request();assert.equal((await runtime.run(second.id)).status,'completed');assert.equal(runtime.metrics().jevCalls,previous.jevCalls,'unchanged semantic questions reuse native cache across executions');
}),{population_count:240,study_text_length:3962}));

test('a valid paid prefix survives a future indivisible format stop, native CAS races and restart without extra HTTP',{
 skip:!enabled,timeout:1200000,
},async()=>withSignalStudyFixtureV1(async f=>withStudyNativeRuntimeV1(f.database,async runtime=>{
 runtime.setLongDefinitions(true);const record=runtime.store.recordFormatStop;assert.ok(record);let captured:{lease:StudyRuntimeLeaseV1;stop:SignalStudyEditorialFormatStopV1}|undefined;
 runtime.store.recordFormatStop=async(lease,stop)=>{captured={lease,stop};throw Error('pause before native format journal');};const execution=await f.request();
 try{await assert.rejects(runtime.run(execution.id),/pause before native format journal/);}finally{runtime.store.recordFormatStop=record;}
 assert.ok(captured);assert.equal(captured.stop.status,'format_stop');assert.equal(captured.stop.compiler_version,SIGNAL_STUDY_EDITORIAL_COMPILER_V2);assert.equal(captured.stop.reason,'request_bytes');assert.ok(captured.stop.observed>524288);
 assert.ok(runtime.metrics().sonnetCalls>=2,'local judgments and their global reconciliation are actual paid-prefix native receipts');
 const prefix=(await f.database.query(`SELECT s.*,c.call_state,c.settled_micro_usd FROM signal_study_steps s JOIN engine_cost_events c ON c.study_step_id=s.id WHERE s.execution_id=$1 ORDER BY s.created_at,s.id`,[execution.id])).rows;assert.ok(prefix.length>=2);assert.ok(prefix.every(row=>row.status==='committed'&&row.call_state==='settled'&&BigInt(row.settled_micro_usd)>0n));
 assert.equal(Number((await f.database.query('SELECT count(*)::int n FROM signal_study_format_stops WHERE execution_id=$1',[execution.id])).rows[0].n),0);
 const lease=await claimSignalStudyExecutionV1({database:f.database,execution_id:execution.id});assert.ok(lease);
 for(const bad of[{...lease,workspace_id:randomUUID()},{...lease,execution_token:randomUUID()},{...lease,human_revision_digest:digest('foreign human')},{...lease,source_digest:digest('foreign source')}])await assert.rejects(record(bad,captured.stop),/study_(execution_unavailable|lease_lost)/);
 await assert.rejects(record(lease,{...captured.stop,observed:captured.stop.observed+1}),/study_format_stop_not_derived/);
 await f.database.query("UPDATE users SET status='suspended' WHERE id=$1",[f.actor_user_id]);try{await assert.rejects(record(lease,captured.stop),/study_forbidden/);}finally{await f.database.query("UPDATE users SET status='active' WHERE id=$1",[f.actor_user_id]);}
 await Promise.all([record(lease,captured.stop),record(lease,captured.stop)]);await runtime.store.release(lease);await record(lease,captured.stop);
 const parent=(await f.database.query('SELECT status,error_code FROM signal_study_executions WHERE id=$1',[execution.id])).rows[0];assert.equal(parent.status,'failed');assert.equal(parent.error_code,'study_editorial_format_stop');
 const rows=(await f.database.query('SELECT * FROM signal_study_format_stops WHERE execution_id=$1',[execution.id])).rows;assert.equal(rows.length,1);assert.deepEqual(rows[0].stop_json,captured.stop);assert.equal(rows[0].stop_digest,digest(captured.stop));assert.ok(Buffer.byteLength(JSON.stringify(rows[0].stop_json))<=8192);
 assert.deepEqual((await f.database.query(`SELECT s.*,c.call_state,c.settled_micro_usd FROM signal_study_steps s JOIN engine_cost_events c ON c.study_step_id=s.id WHERE s.execution_id=$1 ORDER BY s.created_at,s.id`,[execution.id])).rows,prefix,'no valid paid interpretation or cost is rolled back by a future format error');
 const allocation=(await f.database.query(`SELECT signal_study_exposure_v1($1)::text spent,
  signal_listening_study_policy_exposure_v1(binding.scope_id)::text held
  FROM signal_listening_study_policy_bindings binding WHERE binding.policy_id=$2`,[execution.id,f.policy.id])).rows[0]!;
 assert.ok(BigInt(allocation.spent)>0n&&BigInt(allocation.spent)<BigInt(execution.cap_micro_usd));
 assert.equal(BigInt(allocation.held),BigInt(f.execution.cap_micro_usd)+BigInt(allocation.spent),'a definitively closed paid prefix keeps its actual cost and releases only unused Study capacity; Listening stays fully reserved');
 const before=runtime.metrics();assert.equal((await runtime.run(execution.id)).status,'not_claimed');assert.deepEqual(runtime.metrics(),before);assert.equal(await readSignalStudyOutputV1({...f,execution_id:execution.id}),null);assert.equal((await pendingSignalStudyExecutionsV1({database:f.database})).some(row=>row.execution_id===execution.id),false);
 await assert.rejects(f.database.query('DELETE FROM signal_study_format_stops WHERE execution_id=$1',[execution.id]),/study_format_stop_immutable/);await assert.rejects(f.database.query('TRUNCATE signal_study_format_stops'),/study_history_retained/);
 assert.equal(new Set(runtime.sentStepKeys()).size,runtime.sentStepKeys().length);
}),{population_count:240,study_text_length:12500}));

test('native boundary rewrite is settled and replayed before the single blind recode pair',{
 skip:!enabled,timeout:1200000,
},async()=>withSignalStudyFixtureV1(async f=>withStudyNativeRuntimeV1(f.database,async runtime=>{
 for(const scenario of[
  {include:[['marca'],[]],unavailable:1,terms:['marca']},
  {include:[['marca'],['categoría']],unavailable:0,terms:['categoría','marca']},
  {include:[[],[]],unavailable:2,terms:[]},
 ]){
  const rows=scenario.include.map((include,index)=>({id:index+1,query_id:index+1,structured_terms:{include}}));
  const coverage=(await f.database.query(`WITH linked AS(SELECT * FROM jsonb_to_recordset($1::jsonb) r(id int,query_id int,structured_terms jsonb)),${signalStudyQueryMetadataAggregateSqlV1}`,[JSON.stringify(rows)])).rows[0];
  assert.deepEqual(coverage,{source_batches:2,unavailable_batches:scenario.unavailable,terms:scenario.terms},'native SQL covers EACH batch, not any term in the union');
 }
 runtime.setBoundaryDisagreement(true);const sent:StudyRuntimeStepPlanV1[]=[],send=runtime.drivers.send;
 runtime.drivers.send=async(plan,signal)=>{sent.push(plan);return send(plan,signal);};
 const execution=await f.request(),result=await runtime.run(execution.id);assert.equal(result.status,'completed');
 const parent=(await f.database.query('SELECT source_header FROM signal_study_executions WHERE id=$1',[execution.id])).rows[0];
 assert.equal(parent.source_header.layer_boundary_rule_version,SIGNAL_STUDY_BOUNDARY_RULE_VERSION_V1);
 assert.equal(parent.source_header.acquisition_query_metadata.contract_version,'signal-study-acquisition-query-metadata-v1');
 const payloads=sent.map(plan=>JSON.parse(JSON.parse(plan.request_body).messages[0].content).untrusted_data),rewrites=payloads.filter(p=>p.purpose==='rewrite_layer_boundary_rules');
 assert.equal(rewrites.length,1);assert.equal(rewrites[0].boundary_keys.length,1);
 const repaired=payloads.filter(p=>p.contrast_rule);assert.equal(repaired.length,2);
 assert.ok(repaired.every(p=>JSON.parse(p.contrast_rule).rules.every((rule:object)=>!('reason'in rule)&&!('initial_assessments'in rule))));
 const settled=(await f.database.query(`SELECT count(*)::int n FROM signal_study_steps s JOIN signal_study_receipts r ON r.step_id=s.id
 JOIN engine_cost_events e ON e.study_step_id=s.id WHERE s.execution_id=$1 AND s.mode='contrast' AND s.status='committed'
 AND r.verification_status='verified' AND e.call_state='settled'`,[execution.id])).rows[0].n;
 assert.equal(settled,1);const proof=await readSignalStudyStabilityProofV1({...f,execution_id:execution.id});
 assert.ok(proof);assert.equal(proof.layer_agreement.boundary_recoded_count,1);assert.equal(proof.layer_agreement.kappa,1);assert.equal(proof.layer_agreement.coverage,1);
 const count=sent.length;assert.equal((await runtime.run(execution.id)).status,'not_claimed');assert.equal(sent.length,count);
})));
