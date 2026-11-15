import assert from 'node:assert/strict';
import test from 'node:test';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
const enabled=process.env.NOISIA_R16_STUDY_PG==='true';
test('Study has a private native owner distinct from Listening and the paused engine',{
 skip:!enabled,timeout:600000,
},async()=>runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async ctx=>{
 const codec={contract_version:'signal-study-receipt-v1',body_base64:'e30=',body_bytes:2,sha256:'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',complete:true,http_status:200,provider_request_id:null};
 assert.equal((await ctx.database.query('SELECT signal_study_receipt_v1($1) r',[JSON.stringify(codec)])).rows[0].r.utf8_valid,true);
 for(const invalid of [JSON.stringify({...codec,body_base64:'e30=\n'}),JSON.stringify({...codec,body_bytes:3}),JSON.stringify({...codec,contract_version:null}),JSON.stringify(codec).replace('{','{\"complete\":true,')])await assert.rejects(ctx.database.query('SELECT signal_study_receipt_v1($1)',[invalid]),/study_receipt_invalid/);
 for(const table of ['signal_studies','signal_study_configurations','signal_study_executions','signal_study_steps','signal_study_jev_batches','signal_study_jev_members']){
  assert.equal(Boolean((await ctx.database.query('SELECT to_regclass($1) name',[table])).rows[0].name),true,'the Study owner requires '+table);
  assert.equal((await ctx.database.query('SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass($1)',[table])).rows[0].relrowsecurity,true);
 }
}}));
import{randomUUID}from'node:crypto';
import{withSignalStudyFixtureV1}from'./signal-study.synthetic.fixture';
import{claimSignalStudyExecutionV1,readSignalStudyRuntimeSourceV1,releaseSignalStudyExecutionV1}from'../signal-study-executions';
import{readSignalStudyConfigurationV1,saveSignalStudyConfigurationV1}from'../signal-study-configuration';
import{listSignalStudiesV1,readSignalStudyExecutionStatusV1,readLatestSignalStudyConfigurationV1,readLatestSignalStudyExecutionStatusV1}from'../signal-study-status';
import{readSignalStudyReportOverviewV1,readSignalStudyReportPageV1}from'../signal-study-serving';
import{promoteSignalStudyMotivesV1}from'../signal-study-promotion';
test('Study freezes only its native consumer cut and exact external configuration, with no import, Voyage or provider admission',{
 skip:!enabled,timeout:600000,
},async()=>withSignalStudyFixtureV1(async f=>{
 const sources:Array<Awaited<ReturnType<typeof readSignalStudyRuntimeSourceV1>>>=[];try{
 const before=(await f.database.query('SELECT (SELECT count(*) FROM signal_workspace_embedding_calls)::int embedding_calls,(SELECT count(*) FROM engine_cost_events)::int editorial_calls,(SELECT count(*) FROM signal_processing_admissions)::int admissions')).rows[0];
 const configurationKey=randomUUID(),configArgs={...f,expected_revision:0,configuration:f.envelope,listening_snapshot_id:f.listeningSnapshot.id,provenance:'human' as const,idempotency_key:configurationKey},created=await saveSignalStudyConfigurationV1(configArgs);
 assert.equal((await saveSignalStudyConfigurationV1(configArgs)).id,created.id,'lost configuration ACK does not create a second Study');
 const conflicting=structuredClone(f.envelope);conflicting.question_configuration.instructions+=' Conflict.';conflicting.question_configuration_digest=f.digest(conflicting.question_configuration);await assert.rejects(saveSignalStudyConfigurationV1({...configArgs,configuration:conflicting}),/study_idempotency_conflict/);
 const listing=await listSignalStudiesV1({...f,limit:1});assert.equal(listing.studies.length,1);assert.ok(listing.next_after_study_id);assert.equal((await listSignalStudiesV1({...f,limit:1,after_study_id:listing.next_after_study_id})).studies.length,1);assert.equal((await readLatestSignalStudyConfigurationV1({...f,study_id:created.study_id}))?.id,created.id);
 const key=randomUUID(),run=await f.request(4000000,key),same=await f.request(4000000,key);assert.equal(same.id,run.id);
 assert.equal((await readSignalStudyExecutionStatusV1({...f,execution_id:run.id}))?.status,'queued');assert.equal((await readLatestSignalStudyExecutionStatusV1({...f,study_id:run.study_id}))?.id,run.id);
 assert.equal(await readSignalStudyExecutionStatusV1({...f,workspace_id:randomUUID(),execution_id:run.id}).catch(()=>null),null);
 assert.notEqual(run.configuration_id,f.listening.id);assert.equal(run.source_roots,3);assert.equal(run.status,'queued');
 const lease=await claimSignalStudyExecutionV1({database:f.database,execution_id:run.id});assert.ok(lease);
 const source=await readSignalStudyRuntimeSourceV1({database:f.database,lease});assert.ok(source);sources.push(source);
 assert.deepEqual(source.configuration,f.envelope);assert.deepEqual(source.configuration.source_listening.configuration,f.listening.configuration);
 assert.equal(source.selection.scope,'listening_consumer_cut');assert.equal(source.selection.eligible_roots,3);assert.equal(source.selection.pending_base_roots,0);assert.equal(source.source_digest,run.source_digest);
 for(const root of source.roots){assert.equal(root.selected_fragment!.text,root.text.slice(root.selected_fragment!.start,root.selected_fragment!.end));assert.equal(root.vector.length,1024);assert.ok(root.embedding_proof.proof_json);assert.ok(root.base_answers.voice);assert.ok(root.base_answers.promotion);}
 await releaseSignalStudyExecutionV1({database:f.database,lease});
 const again=await claimSignalStudyExecutionV1({database:f.database,execution_id:run.id});assert.ok(again);const replayed=await readSignalStudyRuntimeSourceV1({database:f.database,lease:again});sources.push(replayed);assert.deepEqual(replayed,source);
 await releaseSignalStudyExecutionV1({database:f.database,lease:again});
 assert.deepEqual((await f.database.query('SELECT (SELECT count(*) FROM signal_workspace_embedding_calls)::int embedding_calls,(SELECT count(*) FROM engine_cost_events)::int editorial_calls,(SELECT count(*) FROM signal_processing_admissions)::int admissions')).rows[0],before);
 assert.equal(await readSignalStudyConfigurationV1({...f,workspace_id:randomUUID(),configuration_id:f.cfg.id}).catch(()=>null),null);
 await assert.rejects(f.request(4000001,key),/study_idempotency_conflict/);
}finally{for(const source of sources)await disposeStudySourcePagesV1(source);}
}));
import{withStudyNativeRuntimeV1}from'./signal-study-runtime.synthetic.fixture';
import{assertSignalStudyMoneyV1,assertSignalStudyDailyMoneyRaceV1}from'./signal-study-money.assertions';
import{readSignalStudyOutputV1}from'../signal-study-serving';
import{pendingSignalStudyExecutionsV1}from'../signal-study-executions';
import{disposeStudySourcePagesV1}from'../../../services/workers/src/workers/signal-study-source-pages';
test('Study stop retains uncertain admitted siblings and never resends them after reactivation',{
 skip:!enabled,timeout:600000,
},async()=>withSignalStudyFixtureV1(async f=>withStudyNativeRuntimeV1(f.database,async runtime=>{
 const execution=await f.request();runtime.setAnalysisEnabled(false);assert.equal((await runtime.run(execution.id)).status,'not_claimed');assert.equal(runtime.metrics().jevCalls,0);runtime.setAnalysisEnabled(true);runtime.setSonnetAvailable(false);assert.equal((await runtime.run(execution.id)).status,'not_claimed');assert.equal(runtime.metrics().jevCalls,0);runtime.setSonnetAvailable(true);
 let flip=true;runtime.onJev(async()=>{if(flip){flip=false;runtime.setAnalysisEnabled(false);}});await runtime.run(execution.id).catch(error=>assert.match(error.message,/study_analysis_disabled|jev_stopped/));runtime.onJev(undefined);assert.equal(runtime.metrics().jevCalls,1);assert.equal((await runtime.run(execution.id)).status,'not_claimed');assert.equal(runtime.metrics().jevCalls,1);assert.equal(Number((await f.database.query('SELECT count(*)::int n FROM signal_study_answers a JOIN signal_study_jev_batches b ON b.id=a.batch_id WHERE b.execution_id=$1',[execution.id])).rows[0].n),0);runtime.setAnalysisEnabled(true);
 assert.equal((await runtime.run(execution.id)).status,'outcome_unknown');
 const census=async()=>(await f.database.query(`SELECT count(*)::int calls,
  count(*) FILTER(WHERE c.status='unknown')::int unknown_calls,
  count(*) FILTER(WHERE c.status='settled' AND c.results_applied AND c.raw_storage_verified_at IS NOT NULL)::int known_applied,
  COALESCE(sum(c.reserved_micro_usd) FILTER(WHERE c.status='unknown'),0)::text unknown_reserved
  FROM signal_study_jev_batches b JOIN signal_labeling_calls c ON c.run_id=b.run_id WHERE b.execution_id=$1`,[execution.id])).rows[0]!;
 const contained=await census();assert.equal(contained.calls,3);assert.equal(contained.unknown_calls,2);assert.equal(contained.known_applied,1);assert.ok(BigInt(contained.unknown_reserved)>0n);
 const before=runtime.metrics();assert.equal(before.jevCalls,1);assert.equal(before.fitCalls,0);assert.equal(before.sonnetCalls,0);
 assert.equal((await runtime.run(execution.id)).status,'outcome_unknown');
 assert.deepEqual(await census(),contained);assert.equal(runtime.metrics().jevCalls,before.jevCalls);assert.equal(runtime.metrics().fitCalls,0);assert.equal(runtime.metrics().sonnetCalls,0);
 assert.equal((await f.database.query('SELECT status FROM signal_study_executions WHERE id=$1',[execution.id])).rows[0].status,'outcome_unknown');
})),);
test('Study native runtime commits a real insufficient-population artifact, H1 pages and directional output without a Sonnet call',{
 skip:!enabled,timeout:600000,
},async()=>withSignalStudyFixtureV1(async f=>withStudyNativeRuntimeV1(f.database,async runtime=>{
 const persist=runtime.store.persistNumeric;let lost=true;runtime.store.persistNumeric=async(...args)=>{const value=await persist(...args);if(lost){lost=false;throw Error('lost native numeric ACK');}return value;};
 const execution=await f.request();
 await assert.rejects(runtime.run(execution.id),/lost native numeric ACK/);assert.equal(runtime.metrics().fitCalls,1);
 const result=await runtime.run(execution.id);assert.equal(result.status,'completed');
 const counts=runtime.metrics();assert.equal(counts.jevCalls,3);assert.equal(counts.fitCalls,1);assert.equal(counts.sonnetCalls,0);
 const numeric=(await f.database.query('SELECT * FROM signal_study_numeric_checkpoints WHERE execution_id=$1',[execution.id])).rows[0];assert.equal(numeric.verification_status,'verified');assert.equal(JSON.parse(numeric.manifest_json).status,'insufficient_population');assert.deepEqual(numeric.value.groups,[]);
 assert.ok(Number((await f.database.query('SELECT count(*)::int n FROM signal_study_numeric_artifacts WHERE checkpoint_id=$1',[numeric.id])).rows[0].n)>8);
 const report=await readSignalStudyOutputV1({...f,execution_id:execution.id});assert.ok(report);assert.equal(report.output.status,'directional');assert.equal(report.configuration_is_latest,true);assert.equal(report.output.query_bias.status,'unknown_query_metadata');
 const before=runtime.metrics();assert.equal((await runtime.run(execution.id)).status,'not_claimed');assert.deepEqual(runtime.metrics(),before);
 assert.equal((await pendingSignalStudyExecutionsV1({database:f.database})).some(p=>p.execution_id===execution.id),false);
})),);
test('Study full native pipeline uses real BERTopic groups, native Sonnet money, blind literal evidence and question-level cached JEV',{
 skip:!enabled,timeout:1200000,
},async()=>withSignalStudyFixtureV1(async f=>withStudyNativeRuntimeV1(f.database,async runtime=>{
 const beforeEmbedding=Number((await f.database.query('SELECT count(*)::int n FROM signal_workspace_embedding_calls')).rows[0].n);
 const execution=await f.request(),result=await runtime.run(execution.id);assert.equal(result.status,'completed');
 const metrics=runtime.metrics();assert.equal(metrics.jevCalls,480);assert.equal(metrics.fitCalls,1);assert.ok(metrics.sonnetCalls>=3);
 const numeric=(await f.database.query('SELECT * FROM signal_study_numeric_checkpoints WHERE execution_id=$1',[execution.id])).rows[0],manifest=JSON.parse(numeric.manifest_json);assert.equal(manifest.status,'completed');assert.ok(manifest.groups.length>=2,'actual BERTopic must produce groups, never test-authored artifacts');
 assert.equal(beforeEmbedding,Number((await f.database.query('SELECT count(*)::int n FROM signal_workspace_embedding_calls')).rows[0].n));
 const calls=(await f.database.query(`SELECT c.* FROM engine_cost_events c JOIN signal_study_steps s ON s.id=c.study_step_id WHERE s.execution_id=$1`,[execution.id])).rows;assert.equal(calls.length,metrics.sonnetCalls);assert.ok(calls.every(c=>c.workspace_contract==='signal-study-step-v1'&&c.catalog_execution_id===null&&c.listening_round_id===null&&c.call_state==='settled'&&BigInt(c.settled_micro_usd)>0n));
 const reported=await readSignalStudyOutputV1({...f,execution_id:execution.id});assert.ok(reported);assert.equal(reported.output.stability?.estimation_status,'complete');assert.equal(reported.output.stability?.kappa,1);assert.ok(reported.output.verified_evidence.length>=4);
 assert.equal(reported.output.promotion.automatic,false);
 assert.equal(Number((await f.database.query(`SELECT count(*)::int n FROM signal_study_jev_batches b JOIN signal_labeling_calls c ON c.run_id=b.run_id WHERE b.execution_id=$1 AND(c.request->'questions'?'voice' OR c.request->'questions'?'promotion')`,[execution.id])).rows[0].n),0);
 const pageRows=(await f.database.query(`SELECT p.id,p.member_count,p.status FROM signal_study_jev_batches b JOIN signal_labeling_raw_pages p ON p.run_id=b.run_id WHERE b.execution_id=$1`,[execution.id])).rows;assert.ok(pageRows.length>1);assert.ok(pageRows.every(p=>p.status==='verified'));assert.ok(pageRows.some(p=>p.member_count>1));
 const exposure=BigInt((await f.database.query('SELECT signal_study_exposure_v1($1)::text v',[execution.id])).rows[0].v);assert.ok(exposure>0n&&exposure<=BigInt(execution.cap_micro_usd));
 const second=await f.request(),again=await runtime.run(second.id);assert.equal(again.status,'completed');assert.equal(runtime.metrics().jevCalls,metrics.jevCalls,'a separate execution reuses exact model/state/target/question/instructions cache');
 assert.equal(Number((await f.database.query('SELECT count(*)::int n FROM signal_study_jev_batches WHERE execution_id=$1',[second.id])).rows[0].n),0);
 const overview=await readSignalStudyReportOverviewV1({...f,execution_id:execution.id});assert.ok(overview);assert.equal('motives'in overview.overview.summary,false);assert.equal('series'in overview.overview.summary,false);assert.equal('verified_evidence'in overview.overview,false);assert.equal(overview.section_counts.motives,reported.output.summary.motives.length);
 const page=await readSignalStudyReportPageV1({...f,execution_id:execution.id,section:'evidence',limit:1});assert.ok(page);assert.equal(page.rows.length,1);assert.equal(page.total,reported.output.verified_evidence.length);assert.deepEqual(page.rows,reported.output.verified_evidence.slice(0,1));assert.equal(page.next_offset,1);
 await assert.rejects(readSignalStudyReportPageV1({...f,execution_id:execution.id,section:'evidence',limit:101}),/study_pagination_invalid/);
 const listeningBefore=(await f.database.query("SELECT * FROM signal_listening_configurations WHERE workspace_id=$1 AND state='published' ORDER BY revision DESC LIMIT 1",[f.workspace_id])).rows[0],promoteArgs={...f,execution_id:execution.id,motive_keys:[reported.output.summary.motives[0]!.key],expected_listening_revision:listeningBefore.revision,idempotency_key:randomUUID()},beforePromotion=runtime.metrics();
 const promoted=await promoteSignalStudyMotivesV1(promoteArgs);assert.deepEqual(await promoteSignalStudyMotivesV1(promoteArgs),promoted,'promotion ACK lost returns its exact prior publication');assert.deepEqual(runtime.metrics(),beforePromotion,'explicit promotion neither sends nor classifies');
 const promotedConfiguration=(await f.database.query('SELECT configuration,revision FROM signal_listening_configurations WHERE id=$1',[promoted.configuration_id])).rows[0];assert.equal(promotedConfiguration.revision,listeningBefore.revision+1);const added=promotedConfiguration.configuration.questions.filter((q:{key:string})=>q.key.startsWith('study_'));assert.equal(added.length,1);assert.equal(added[0].human_locked,true);assert.equal(added[0].topic_source,'defined');
 await assert.rejects(promoteSignalStudyMotivesV1({...promoteArgs,motive_keys:['missing_motive']}),/study_idempotency_conflict/);
 assert.equal((await readSignalStudyOutputV1({...f,execution_id:execution.id}))?.output_digest,reported.output_digest,'explicit promotion never mutates the completed Study');
}),{population_count:240}));

test('Study money and custody retain five funded uncertainties after native races and ACK recovery',{
 skip:!enabled,timeout:1800000,
},async()=>withSignalStudyFixtureV1(async f=>withStudyNativeRuntimeV1(f.database,async runtime=>{
 const initial=await f.request();assert.equal((await runtime.run(initial.id)).status,'completed');
 await assertSignalStudyMoneyV1(f,runtime);
}),{population_count:240}));

test('Study organization/day reservations race independently after a conservative quiescent policy inheritance',{
 skip:!enabled,timeout:1200000,
},async()=>withSignalStudyFixtureV1(async f=>withStudyNativeRuntimeV1(f.database,async runtime=>{
 const reference=await f.request();assert.equal((await runtime.run(reference.id)).status,'completed');
 await assertSignalStudyDailyMoneyRaceV1(f,runtime,reference.id);
}),{population_count:240,complete_listening:true}));

import{buildSignalStudyExecutionConfigurationV1}from'@noisia/query-engine';
test('Study cache keys change only with the individual question, instructions, model or target',{
 skip:!enabled,timeout:600000,
},async()=>withSignalStudyFixtureV1(async f=>withStudyNativeRuntimeV1(f.database,async runtime=>{
 const first=await f.request();assert.equal((await runtime.run(first.id)).status,'completed');assert.equal(runtime.metrics().jevCalls,3);const original=await readSignalStudyOutputV1({...f,execution_id:first.id});assert.ok(original);
 const changed=structuredClone(f.envelope);changed.study.revision=2;changed.study_digest=f.digest(changed.study);changed.question_configuration.study_digest=changed.study_digest;changed.question_configuration.revision=2;changed.question_configuration.questions[0]!.text+=' One human clarification.';changed.question_configuration.questions[0]!.human_locked=true;changed.question_configuration_digest=f.digest(changed.question_configuration);
 const secondCfg=await saveSignalStudyConfigurationV1({...f,study_id:f.cfg.study_id,configuration:changed,expected_revision:1,listening_snapshot_id:f.listeningSnapshot.id,provenance:'human'});const requests:Array<Record<string,unknown>>=[];runtime.onJev(async request=>{requests.push((request as{questions:Record<string,unknown>}).questions);});
 const second=await import('../signal-study-executions').then(m=>m.requestSignalStudyExecutionV1({...f,configuration_id:secondCfg.id,cap_micro_usd:4000000,idempotency_key:randomUUID()}));assert.equal((await runtime.run(second.id)).status,'completed');assert.equal(runtime.metrics().jevCalls,6);assert.ok(requests.every(q=>Object.keys(q).length===1&&Object.keys(q)[0]===changed.question_configuration.questions[0]!.key));assert.equal((await readSignalStudyOutputV1({...f,execution_id:first.id}))?.configuration_is_latest,false);
 const third=structuredClone(changed);third.study.revision=3;third.study_digest=f.digest(third.study);third.question_configuration.study_digest=third.study_digest;third.question_configuration.revision=3;third.question_configuration.instructions+=' Human instruction.';third.question_configuration.human_locked=true;third.question_configuration_digest=f.digest(third.question_configuration);
 const thirdCfg=await saveSignalStudyConfigurationV1({...f,study_id:f.cfg.study_id,configuration:third,expected_revision:2,listening_snapshot_id:f.listeningSnapshot.id,provenance:'human'});requests.length=0;const thirdExecution=await import('../signal-study-executions').then(m=>m.requestSignalStudyExecutionV1({...f,configuration_id:thirdCfg.id,cap_micro_usd:4000000,idempotency_key:randomUUID()}));assert.equal((await runtime.run(thirdExecution.id)).status,'completed');assert.equal(runtime.metrics().jevCalls,9);assert.ok(requests.every(q=>Object.keys(q).length===3));
 const altered=buildSignalStudyExecutionConfigurationV1({study:{...f.study,subject:{...f.study.subject,name:'Another configured category target'}},template_snapshot:f.template_snapshot,source_listening:f.envelope.source_listening});const targetCfg=await saveSignalStudyConfigurationV1({...f,configuration:altered,expected_revision:0,listening_snapshot_id:f.listeningSnapshot.id,provenance:'human'});requests.length=0;const targetExecution=await import('../signal-study-executions').then(m=>m.requestSignalStudyExecutionV1({...f,configuration_id:targetCfg.id,cap_micro_usd:4000000,idempotency_key:randomUUID()}));assert.equal((await runtime.run(targetExecution.id)).status,'completed');assert.equal(runtime.metrics().jevCalls,12);assert.ok(requests.every(q=>Object.keys(q).length===3));
 const wrongModel=structuredClone(altered)as unknown as{question_configuration:{model:string}};wrongModel.question_configuration.model='unsupported-model';await assert.rejects(saveSignalStudyConfigurationV1({...f,configuration:wrongModel,expected_revision:0,listening_snapshot_id:f.listeningSnapshot.id,provenance:'human'}),/study_configuration_invalid/);assert.equal(runtime.metrics().sonnetCalls,0);
})));
