import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
const enabled=process.env.NOISIA_R16_HUMAN_EDITS_PG==='true';
test('human edits are additive private snapshots and never a provider probability',{
 skip:!enabled,timeout:600000,
},async()=>runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async f=>{
 for(const name of ['signal_listening_human_edits','signal_listening_human_memberships','signal_listening_human_aliases','signal_listening_human_configuration_bindings']){
  assert.equal(Boolean((await f.database.query('SELECT to_regclass($1) name',[name])).rows[0].name),true,name+' requires the additive human-edit migration');
  const row=(await f.database.query('SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass($1)',[name])).rows[0];assert.equal(row.relrowsecurity,true);
  for(const role of ['anon','authenticated'])assert.equal((await f.database.query("SELECT has_table_privilege($1,$2,'SELECT') allowed",[role,name])).rows[0]!.allowed,false,'human audit tables are not a public client surface');
 }
 const columns=(await f.database.query("SELECT column_name FROM information_schema.columns WHERE table_name='signal_listening_human_memberships'")).rows.map(row=>row.column_name);
 assert.equal(columns.includes('probability'),false,'human decisions must not fabricate a provider probability');
 assert.ok(columns.includes('belongs'));assert.ok(columns.includes('input_digest'));assert.ok(columns.includes('question_digest'));
}}));

async function completed(fn:(f:Awaited<ReturnType<typeof seed>>)=>Promise<void>){
 const {withDiscoveryAdvanceFixtureV1}=await import('./signal-listening-discovery-advance.synthetic.fixture');
 await withDiscoveryAdvanceFixtureV1(async f=>fn(await seed(f)),{additional_defined_topic:true});
}
async function seed(f:Parameters<Parameters<typeof import('./signal-listening-discovery-advance.synthetic.fixture')['withDiscoveryAdvanceFixtureV1']>[0]>[0]){
 const {createSignalListeningDiscoveryAdvanceStoreV1}=await import('../signal-listening-discovery-advance');
 const {activateSignalListeningServingSnapshotV1}=await import('../signal-listening-discovery-money');
 const store=createSignalListeningDiscoveryAdvanceStoreV1({database:f.database,numeric_storage:f.storage});
 for(let i=1;i<=3;i++){
  const lease=await store.claim({database:f.database,execution_id:f.execution.id});assert.ok(lease,'completed fixture requires the next native advance');
  const subset=await store.ensureSubset({database:f.database,lease,generation_id:lease.source_generation_id});const numeric=await f.emptyNumeric(subset);
  await store.persistNumeric({database:f.database,lease,subset_id:subset.id,numeric});
  const round=await store.enqueue({database:f.database,lease,generation_id:lease.source_generation_id,expected_ordinal:lease.next_ordinal,
   expected_policy_version_id:lease.policy_version_id,expected_policy_digest:lease.policy_digest,expected_human_revision_digest:lease.human_revision_digest,numeric_manifest_sha256:numeric.manifest_sha256,provider_available:true});
  if(!round||round.status==='budget_exhausted')throw Error('fixture native round missing');
  await store.release({database:f.database,lease});await f.finishRound(round);await activateSignalListeningServingSnapshotV1({...f,round_id:round.id});
  const p=(await f.database.query('SELECT status FROM signal_listening_discovery_executions WHERE id=$1',[f.execution.id])).rows[0];if(p.status==='completed')break;
 }
 assert.equal((await f.database.query('SELECT status FROM signal_listening_discovery_executions WHERE id=$1',[f.execution.id])).rows[0].status,'completed');return f;
}
async function history(f:{database:import('../signal-mention-facets').LabelingDatabaseV1;workspace_id:string}){
 return(await f.database.query(`SELECT
  (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM signal_labeling_calls c WHERE workspace_id=$1) calls,
  (SELECT jsonb_agg(to_jsonb(a) ORDER BY root_id,question_digest) FROM signal_listening_answers a WHERE workspace_id=$1) answers,
  (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM engine_cost_events e WHERE workspace_id=$1) costs,
  (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM signal_processing_admissions a WHERE workspace_id=$1) admissions`,[f.workspace_id])).rows[0];
}
test('remove, move and merge preserve model probabilities, human history, memberships and monetary receipts',{
 skip:!enabled,timeout:600000,
},async()=>completed(async f=>{
 const api=await import('../signal-listening-human-edits');const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
 let ctx=await api.getSignalListeningHumanEditContextV1(access);assert.equal(ctx.can_edit,true);
 const before=await history(f),keys=ctx.configuration.questions.filter(q=>q.topic_source).sort((a,b)=>Number(a.topic_source==='discovered')-Number(b.topic_source==='discovered')).map(q=>q.key);assert.ok(keys.length>=2,'requires defined and discovered topics');
 const removeFrom=keys[1]!;
 const legacyProof=(await f.database.query(`SELECT p.proof=a.proof same FROM signal_listening_discovery_root_proofs_v1($1,NULL::uuid[]) p JOIN signal_listening_discovery_root_proofs_before_human_v1($1,NULL::uuid[]) a USING(root_id)`,[ctx.expected.source_generation_id])).rows;assert.ok(legacyProof.every(r=>r.same),'legacy root proofs remain byte identical');
 const root=f.roots[0]!,labels=await api.readSignalListeningEffectiveTopicLabelsV1({...access,configuration_id:ctx.expected.configuration_id,map_id:f.map_id,root_ids:[root],question_keys:keys.slice(0,2)});
 assert.equal(labels.find(r=>r.question_key===removeFrom)!.effective_belongs,true);
 const original=labels.find(r=>r.question_key===removeFrom)!;
 const removeArgs={...access,expected:ctx.expected,root_id:root,from_question_key:removeFrom,idempotency_key:randomUUID()};
 const removed=await api.correctSignalListeningTopicMembershipV1(removeArgs);assert.equal(removed.decision_count,1);
 assert.equal((await api.correctSignalListeningTopicMembershipV1(removeArgs)).replayed,true);
 const afterRemove=(await api.readSignalListeningEffectiveTopicLabelsV1({...access,configuration_id:removed.configuration_id,map_id:f.map_id,root_ids:[root],question_keys:[removeFrom]}))[0]!;
 assert.deepEqual(afterRemove.answer,original.answer);assert.equal(afterRemove.cache_call_id,original.cache_call_id);assert.equal(afterRemove.effective_belongs,false);assert.equal(afterRemove.human_belongs,false);assert.equal(afterRemove.label_source,'human');
 const metrics=await import('../signal-listening-serving');const metric=await metrics.readSignalListeningQuestionMetricsV1({...access,configuration_id:removed.configuration_id,map_id:f.map_id,question_key:removeFrom});
 assert.equal(metric.counts.human_resolved,1);assert.equal(metric.counts.human_negative,1);assert.equal(metric.distribution.find(d=>d.option_key==='positive')!.count,2);
 const effectiveProof=(await f.database.query('SELECT proof FROM signal_listening_discovery_roots WHERE generation_id=$1 AND root_id=$2',[removed.generation_id,root])).rows[0]!.proof;
 assert.equal(effectiveProof.evaluations.find((e:{question_key:string})=>e.question_key===removeFrom).probability,.9);assert.equal(effectiveProof.evaluations.find((e:{question_key:string})=>e.question_key===removeFrom).human_belongs,false);assert.ok(effectiveProof.evaluations.find((e:{question_key:string})=>e.question_key===removeFrom).human_decision_id);
 const discovery=await import('../signal-listening-discovery');const nextRound=Number((await f.database.query('SELECT round FROM signal_listening_discovery_generations WHERE id=$1',[removed.generation_id])).rows[0]!.round)+1;
 const refreshed=await discovery.refreshSignalListeningDiscoveryV1({...access,configuration_id:removed.configuration_id,map_id:f.map_id,round:nextRound,source_generation_id:removed.generation_id});
 assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_listening_discovery_members WHERE generation_id=$1 AND root_id=$2',[refreshed.id,root])).rows[0]!.n,0,'future native refresh cannot restore raw-positive human removal');
 const decision=afterRemove;const match=(await f.database.query(`SELECT signal_listening_human_decision_exists_v1($1,$2,$3,$4,$5,$6,$7) exact,signal_listening_human_decision_exists_v1($1,$2,$3,$4,$8,$6,$7) other_input`,[f.workspace_id,removed.configuration_id,f.map_id,root,decision.input_digest,(await f.database.query('SELECT entity_context_digest FROM signal_mass_labeling_maps WHERE id=$1',[f.map_id])).rows[0]!.entity_context_digest,decision.question_digest,'sha256:'+'0'.repeat(64)])).rows[0]!;
 assert.equal(match.exact,true);assert.equal(match.other_input,false,'manual override must not block a new input identity');
 const oldProof=(await f.database.query('SELECT proof,proof_digest FROM signal_listening_discovery_roots WHERE generation_id=$1 ORDER BY root_id',[removed.generation_id])).rows;
 ctx=await api.getSignalListeningHumanEditContextV1(access);
 await f.database.query("UPDATE users SET primary_role='analyst' WHERE id=$1",[f.actor_user_id]);
 const moved=await api.correctSignalListeningTopicMembershipV1({...access,expected:ctx.expected,root_id:f.roots[1]!,from_question_key:keys[0]!,to_question_key:keys[1]!,idempotency_key:randomUUID()});assert.equal(moved.decision_count,2);
 const movedLabels=await api.readSignalListeningEffectiveTopicLabelsV1({...access,configuration_id:moved.configuration_id,map_id:f.map_id,root_ids:[f.roots[1]!],question_keys:keys.slice(0,2)});
 assert.equal(movedLabels.find(r=>r.question_key===keys[0])!.effective_belongs,false);assert.equal(movedLabels.find(r=>r.question_key===keys[1])!.effective_belongs,true);
 const money=await import('../signal-listening-discovery-money');
 await assert.rejects(money.startSignalListeningDiscoveryExecutionV1({...access,generation_id:moved.generation_id,classification_run_id:(await api.getSignalListeningEffectiveServingSnapshotV1(access))!.classification_run_id,cap_micro_usd:1000000,idempotency_key:randomUUID()}),/forbidden/);
 await f.database.query("UPDATE users SET primary_role='noisia_admin' WHERE id=$1",[f.actor_user_id]);
 ctx=await api.getSignalListeningHumanEditContextV1(access);const merged=await api.mergeSignalListeningTopicsV1({...access,expected:ctx.expected,source_question_keys:keys.slice(0,2),target_question_key:keys[1]!,idempotency_key:randomUUID()});
 const final=await api.getSignalListeningHumanEditContextV1(access);assert.ok(final.configuration.retired_question_keys.includes(keys[0]!));assert.equal(final.configuration.questions.find(q=>q.key===keys[1])!.human_locked,true);
 assert.equal((await f.database.query('SELECT signal_listening_human_alias_v1($1,$2,$3) value',[f.workspace_id,merged.configuration_id,keys[0]])).rows[0].value,keys[1]);
 assert.deepEqual((await f.database.query('SELECT proof,proof_digest FROM signal_listening_discovery_roots WHERE generation_id=$1 ORDER BY root_id',[removed.generation_id])).rows,oldProof);
 assert.equal((await api.getSignalListeningEffectiveServingSnapshotV1({...access,human_snapshot_id:removed.id}))!.configuration_id,removed.configuration_id);
 assert.equal((await api.getSignalListeningEffectiveServingSnapshotV1(access))!.configuration_id,merged.configuration_id);
 assert.deepEqual(await history(f),before,'manual edits never rewrite the classifier or money ledgers');
 for(const name of ['signal_listening_human_edits','signal_listening_human_memberships','signal_listening_human_aliases','signal_listening_human_configuration_bindings']){
  await assert.rejects(f.database.query('DELETE FROM '+name),/human_history_immutable/);
  await assert.rejects(f.database.query('TRUNCATE '+name),/human_history_immutable|foreign key constraint/);
 }
}));

test('native human CAS, workspace boundaries, revoked actor and immutable event identity reject without spend',{
 skip:!enabled,timeout:600000,
},async()=>completed(async f=>{
 const api=await import('../signal-listening-human-edits'),configuration=await import('../signal-listening-configuration');
 const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
 let ctx=await api.getSignalListeningHumanEditContextV1(access);const key=ctx.configuration.questions.find(q=>q.topic_source==='discovered')!.key;
 const original=structuredClone(ctx.configuration),before=await history(f);
 const args={...access,expected:ctx.expected,root_id:f.roots[0]!,from_question_key:key,idempotency_key:randomUUID()};
 await assert.rejects(api.correctSignalListeningTopicMembershipV1({...args,root_id:randomUUID()}),/membership_unavailable/);
 await assert.rejects(api.correctSignalListeningTopicMembershipV1({...args,expected:{...ctx.expected,policy_digest:'sha256:'+'0'.repeat(64)}}),/context_changed/);
 await assert.rejects(api.correctSignalListeningTopicMembershipV1({...args,workspace_id:randomUUID()}),/forbidden/);
 await assert.rejects(api.mergeSignalListeningTopicsV1({...access,expected:ctx.expected,source_question_keys:[key,'foreign_topic'],target_question_key:key,idempotency_key:randomUUID()}),/topic_unavailable/);
 await f.database.query("UPDATE users SET status='suspended' WHERE id=$1",[f.actor_user_id]);
 await assert.rejects(api.correctSignalListeningTopicMembershipV1(args),/forbidden/);
 await f.database.query("UPDATE users SET status='active' WHERE id=$1",[f.actor_user_id]);
 const results=await Promise.allSettled([api.correctSignalListeningTopicMembershipV1(args),api.correctSignalListeningTopicMembershipV1({...args,root_id:f.roots[1]!,idempotency_key:randomUUID()})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const success=results.find(r=>r.status==='fulfilled');assert.ok(success&&success.status==='fulfilled','one real concurrent edit wins');const saved=success.value;
 await assert.rejects(api.correctSignalListeningTopicMembershipV1({...args,idempotency_key:saved.id}),/context_changed/);
 if(saved.id===((await f.database.query('SELECT id FROM signal_listening_human_edits WHERE idempotency_key=$1',[args.idempotency_key])).rows[0]?.id))
  await assert.rejects(api.correctSignalListeningTopicMembershipV1({...args,root_id:f.roots[2]!}),/idempotency_conflict/);
 await f.database.query("UPDATE users SET status='suspended' WHERE id=$1",[f.actor_user_id]);
 await assert.rejects(api.correctSignalListeningTopicMembershipV1(args),/forbidden/);
 await f.database.query("UPDATE users SET status='active' WHERE id=$1",[f.actor_user_id]);
 ctx=await api.getSignalListeningHumanEditContextV1(access);
 const current=(await configuration.getSignalListeningConfigurationV1(access))!;
 const changed=structuredClone(current.configuration);changed.questions=changed.questions.map(q=>q.key===key&&q.type==='noul'?{...q,positive:q.positive+' Agent attempted overwrite.'}:q);
 await assert.rejects(configuration.saveSignalListeningConfigurationV1({...access,expected_revision:current.revision,configuration:changed,provenance:'agent',source_digest:ctx.expected.source_digest}),/human_edit_frozen/);
 const client=await f.database.connect();try{
  await client.query('BEGIN');await client.query("SELECT set_config('noisia.listening_human_edit_v1',$1,true)",[JSON.stringify({edit_id:saved.id,actor_user_id:f.actor_user_id})]);
  await assert.rejects(client.query(`INSERT INTO signal_listening_discovery_generations(id,workspace_id,configuration_id,map_id,preparation_run_id,input_revision,embedding_config_digest,entity_context_digest,configuration_digest,round,kind,source_generation_id,created_by_user_id,human_edit_id)
   SELECT gen_random_uuid(),workspace_id,configuration_id,map_id,preparation_run_id,input_revision,embedding_config_digest,entity_context_digest,configuration_digest,round,kind,source_generation_id,created_by_user_id,human_edit_id FROM signal_listening_discovery_generations WHERE id=$1`,[saved.generation_id]),/human_generation_forbidden/);
 }finally{await client.query('ROLLBACK');client.release();}
 assert.deepEqual(await history(f),before,'rejected edits and actor changes do not alter financial history');
 assert.deepEqual(original.questions.filter(q=>q.key===key).map(q=>q.human_locked),[false]);
}));

test('a native agent publication racing a human edit shares configuration CAS and never overwrites human decisions',{
 skip:!enabled,timeout:600000,
},async()=>completed(async f=>{
 const api=await import('../signal-listening-human-edits'),configuration=await import('../signal-listening-configuration');
 const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id},ctx=await api.getSignalListeningHumanEditContextV1(access),current=(await configuration.getSignalListeningConfigurationV1(access))!;
 const before=await history(f),key=ctx.configuration.questions.find(q=>q.topic_source==='discovered')!.key;
 const results=await Promise.allSettled([configuration.saveSignalListeningConfigurationV1({...access,expected_revision:current.revision,configuration:current.configuration,provenance:'agent',source_digest:ctx.expected.source_digest}),
  api.correctSignalListeningTopicMembershipV1({...access,expected:ctx.expected,root_id:f.roots[0]!,from_question_key:key,idempotency_key:randomUUID()})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const next=(await configuration.getSignalListeningConfigurationV1(access))!;
 if(results[1]!.status==='fulfilled'){
  assert.equal(next.configuration.questions.find(q=>q.key===key)!.human_locked,true);
  const label=(await api.readSignalListeningEffectiveTopicLabelsV1({...access,configuration_id:next.id,map_id:f.map_id,root_ids:[f.roots[0]!],question_keys:[key]}))[0]!;
  assert.equal(label.human_belongs,false);assert.equal(label.effective_belongs,false);
 }else assert.equal((await api.getSignalListeningHumanEditContextV1(access)).can_edit,false,'agent result needs a legitimate new native execution before editing');
 assert.deepEqual(await history(f),before);
}));
