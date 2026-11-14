import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {signalListeningBaseTemplateV1,SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 as profile} from '@noisia/query-engine';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {prepareSignalListeningV1,continueSignalListeningPreparationV1,quoteSignalListeningPreparationV1} from '../signal-listening-preparation';
import {createBrandContextSyntheticVoyageProviderV1} from './signal-brand-context.synthetic.fixture';
import {signalWorkspaceEmbeddingsJobV1} from '../../../services/workers/src/workers/signal-workspace-embeddings';

test('listening prototypes use governed Voyage receipts and share one total execution cap with JEV',{
 skip:process.env.NOISIA_R16_LISTENING_PROTOTYPES_PG!=='true',timeout:600000,
},async()=>{
 await runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async context=>{
  const access={database:context.database,workspace_id:context.workspace_id,actor_user_id:context.actor_user_id};
  const database=access.database;
  for(const name of ['signal_listening_preparations','signal_listening_prototype_runs','signal_listening_question_vectors','signal_listening_calibrations'])
   assert.ok((await database.query('SELECT to_regclass($1) relation',[name])).rows[0].relation,`${name} must exist on migrated PostgreSQL`);
  await database.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1",[context.run_id]);
  const legacy=(await database.query('SELECT to_jsonb(m) row FROM signal_mass_labeling_runs m WHERE run_id=$1',[context.run_id])).rows;
  const base=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']});
  const configuration=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:{...base,questions:[...base.questions,
   ...Array.from({length:9},(_,i)=>({key:'defined_'+i,type:'noul' as const,text:'Topic '+i,positive:'Exact bicycle positive '+(i===8?0:i)+' é',negative:'Other content',
    scope:'all' as const,origin:'brand_os' as const,human_locked:false,topic_source:'defined' as const}))]}});
  const scope={...access,configuration_id:configuration.id,map_id:context.map_id};
  await assert.rejects(quoteSignalListeningPreparationV1(scope),/prototype_policy_unavailable/,'the runtime never grants itself a missing provider permission');
  // This invented policy is fixture setup, through the native draft/publish guards.
  const policyId=randomUUID();
  await database.query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
   SELECT $2,p.organization_id,p.version+1,'draft',transaction_timestamp(),p.valid_until,p.budget_timezone,p.daily_cap_micro_usd,$3
   FROM signal_processing_policy_versions p JOIN signal_workspaces w ON w.organization_id=p.organization_id WHERE w.id=$1 AND p.status='active'`,[access.workspace_id,policyId,access.actor_user_id]);
  await database.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
   SELECT $2,a.action,a.kind,a.provider,a.model,a.configuration,a.configuration_digest,a.max_execution_micro_usd,a.automatic_allowed
   FROM signal_processing_policy_actions a JOIN signal_processing_policy_versions p ON p.id=a.policy_version_id
   JOIN signal_workspaces w ON w.organization_id=p.organization_id WHERE w.id=$1 AND p.status='active'`,[access.workspace_id,policyId]);
  await database.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
   VALUES($1,'topic_prototype_embeddings','provider','voyage','voyage-4-large',$2::jsonb,signal_semantic_context_digest_json_v2($2::jsonb),100000,false)`,[policyId,JSON.stringify(profile)]);
  await database.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE organization_id=(SELECT organization_id FROM signal_workspaces WHERE id=$1) AND status='active'",[access.workspace_id]);
  await database.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[policyId]);
  const quote=await quoteSignalListeningPreparationV1(scope);assert.equal(quote.prototype_quote.missing_inputs,8);
  assert.equal(Object.keys(quote.prototype_plan.texts).length,8,'equal positive bytes deduplicate one physical vector');
  await assert.rejects(prepareSignalListeningV1({...scope,idempotency_key:randomUUID(),cap_micro_usd:1,provider_available:true}),/cap_exhausted/);
  await assert.rejects(prepareSignalListeningV1({...scope,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:false}),/prototype_provider_unavailable/);
  await assert.rejects(prepareSignalListeningV1({...scope,workspace_id:randomUUID(),idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true,prototype_provider_available:true}),/policy_changed|forbidden/);
  const request={...scope,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true,prototype_provider_available:true};
  assert.equal((await database.query('SELECT signal_listening_prototype_plan_valid_v1($1,$2,$3::jsonb) ok',[access.workspace_id,configuration.id,JSON.stringify(quote.prototype_plan)])).rows[0].ok,true);
  const pending=await prepareSignalListeningV1(request);assert.equal(pending.status,'waiting_prototypes');assert.ok(pending.prototype_run_id);assert.equal(pending.run_id,null);
  assert.equal((await prepareSignalListeningV1(request)).preparation_id,pending.preparation_id);
  const voyage=createBrandContextSyntheticVoyageProviderV1(),row=(await database.query('SELECT worker_job_id FROM signal_workspace_embedding_runs WHERE id=$1',[pending.prototype_run_id])).rows[0]!;
  const done=await signalWorkspaceEmbeddingsJobV1({id:row.worker_job_id,data:{run_id:pending.prototype_run_id!},updateProgress:async()=>{}},{database,provider:voyage.provider});
  assert.equal('status' in done&&done.status,'completed');assert.equal(voyage.calls.flatMap(c=>c.input_sha256).length,8);
  const admitted=await continueSignalListeningPreparationV1({...access,preparation_id:pending.preparation_id,provider_available:true});
  assert.equal(admitted.status,'labeling');assert.ok(admitted.run_id);
  const binding=(await database.query(`SELECT r.cap_micro_usd::text jev_cap,p.settled_micro_usd::text voyage_cost,p.hard_cap_micro_usd::text prototype_cap,
   p.taxonomy_profile_id,p.input_contract,p.topic_input_snapshot->>'contract_version' owner_contract FROM signal_listening_preparations f
   JOIN signal_labeling_runs r ON r.id=f.listening_run_id JOIN signal_workspace_embedding_runs p ON p.id=f.prototype_run_id WHERE f.id=$1`,[pending.preparation_id])).rows[0]!;
  assert.equal(Number(binding.jev_cap)+Number(binding.voyage_cost),1000000);assert.equal(binding.taxonomy_profile_id,null);assert.equal(binding.owner_contract,'listening-prototype-v1');
  assert.equal((await database.query('SELECT count(*)::int n FROM signal_listening_question_vectors WHERE configuration_id=$1',[configuration.id])).rows[0].n,9);
  assert.equal((await database.query('SELECT signal_listening_vectors_ready_v1($1,$2,$3) ready',[access.workspace_id,configuration.id,context.map_id])).rows[0].ready,true);
  assert.equal((await quoteSignalListeningPreparationV1(scope)).prototype_quote.missing_inputs,0);
  assert.deepEqual((await database.query('SELECT to_jsonb(m) row FROM signal_mass_labeling_runs m WHERE run_id=$1',[context.run_id])).rows,legacy);
  await database.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1",[admitted.run_id]);
  await continueSignalListeningPreparationV1({...access,preparation_id:pending.preparation_id,provider_available:true});
  const changed=await saveSignalListeningConfigurationV1({...access,expected_revision:configuration.revision,provenance:'human',configuration:{...configuration.configuration,
   questions:configuration.configuration.questions.map(q=>q.key==='defined_1'&&q.type==='noul'?{...q,positive:q.positive+' changed'}:q)}});
  const changedScope={...access,configuration_id:changed.id,map_id:context.map_id};
  assert.equal((await quoteSignalListeningPreparationV1(changedScope)).prototype_quote.missing_inputs,1,'editing one definition keeps every unrelated paid vector');
  const changedFlow=await prepareSignalListeningV1({...changedScope,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true,prototype_provider_available:true});
  assert.ok(changedFlow.prototype_run_id);const changedJob=(await database.query('SELECT worker_job_id FROM signal_workspace_embedding_runs WHERE id=$1',[changedFlow.prototype_run_id])).rows[0]!;
  let unknownSends=0;
  await assert.rejects(signalWorkspaceEmbeddingsJobV1({id:changedJob.worker_job_id,data:{run_id:changedFlow.prototype_run_id!},updateProgress:async()=>{}},
   {database,provider:{embedBatch:async()=>{unknownSends++;throw Error('simulated response lost after transport began');}}}),/workspace_embedding/);
  assert.equal(unknownSends,1);
  const failed=await continueSignalListeningPreparationV1({...access,preparation_id:changedFlow.preparation_id,provider_available:true});
  assert.equal(failed.status,'failed');assert.equal(failed.run_id,null);
  await assert.rejects(prepareSignalListeningV1({...changedScope,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true,prototype_provider_available:true}),/prior_outcome_unresolved/);
  assert.equal(unknownSends,1,'a new workflow key cannot resend a Voyage input with an unknown paid outcome');
  assert.equal((await database.query('SELECT count(*)::int n FROM signal_listening_question_vectors WHERE configuration_id=$1',[configuration.id])).rows[0].n,9,'original vectors remain immutable');
  assert.equal(profile.model,'voyage-4-large');
 }});
});
