import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import type {PoolClient} from 'pg';
import {signalRetentionPolicyDefinitionHashV1,signalLicensingPolicyDefinitionHashV1,signalProvenancePolicyBindingDefinitionHashV1,signalWorkspaceEmbeddingDigestV1 as digest} from '@noisia/query-engine';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {withSignalStudyFixtureV1} from './signal-study.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {r16ListeningWorkloadV1} from '../../../scripts/r16/listening-workload';
const enabled=process.env.NOISIA_R16_LISTENING_POPULATION_PG==='true';
async function installLegacy(c:PoolClient){
 const source=await readFile(new URL('./0300_signal_listening_discovery_generations.sql',import.meta.url),'utf8');
 const start=source.indexOf('CREATE OR REPLACE FUNCTION signal_listening_population_roots_v1(');
 assert.ok(start>=0);const end=source.indexOf('$$;',source.indexOf('AS $$',start))+3;
 const legacy=source.slice(start,end).replace('CREATE OR REPLACE FUNCTION signal_listening_population_roots_v1(',
  'CREATE FUNCTION pg_temp.r16_listening_population_legacy_0312(');
 await c.query('CREATE TEMP TABLE r16_population_probe_identity(probe boolean) ON COMMIT DROP');
 await c.query(legacy);
}
async function compare(c:PoolClient,scope:unknown[],roots:string[]|null,purpose='llm-processing'){
 const params=[...scope,roots,purpose];
 const query=(fn:string)=>`SELECT * FROM ${fn}($1,$2,$3,$4,$5::uuid[],$6) ORDER BY root_id,question_key`;
 const old=(await c.query(query('pg_temp.r16_listening_population_legacy_0312'),params)).rows;
 const current=(await c.query(query('signal_listening_population_roots_v1'),params)).rows;
 assert.deepEqual(current,old,'all original population fields, cache lineage, candidates and scope must be identical');
 return current;
}
/** Author new governed versions; never mutate an activated definition. */
async function denyWithSpecificBinding(c:PoolClient,workspace:string,change:'blocked'|'expired'|'prohibited'){
 const bindings=(await c.query("SELECT * FROM signal_provenance_policy_bindings WHERE workspace_id=$1 AND status='active' AND import_batch_id IS NULL",[workspace])).rows;
 assert.equal(bindings.length,1);const prior=bindings[0]!;
 const retention=(await c.query('SELECT * FROM signal_retention_policies WHERE id=$1',[prior.retention_policy_id])).rows[0];
 let retentionId=prior.retention_policy_id,licenseId=prior.licensing_policy_id;
 if(change==='prohibited'){
  const old=(await c.query('SELECT * FROM signal_licensing_policies WHERE id=$1',[licenseId])).rows[0];
  const usages=(await c.query('SELECT usage_purpose,decision FROM signal_licensing_policy_usages WHERE licensing_policy_id=$1 ORDER BY usage_purpose',[licenseId])).rows
   .map(u=>({...u,decision:u.usage_purpose==='llm-processing'?'prohibited':u.decision})) as Parameters<typeof signalLicensingPolicyDefinitionHashV1>[0]['usages'];
  const definition={workspace_id:workspace,policy_key:'r16-prohibited-override',policy_version:1,approval_evidence_hash:old.approval_evidence_hash,usages};
  licenseId=(await c.query(`INSERT INTO signal_licensing_policies(organization_id,workspace_id,policy_key,policy_version,status,approval_evidence_hash,
   definition_hash,created_by_user_id,creation_idempotency_key) VALUES($1,$2,$3,1,'draft',$4,$5,$6,$7) RETURNING id`,
   [old.organization_id,workspace,definition.policy_key,definition.approval_evidence_hash,signalLicensingPolicyDefinitionHashV1(definition),old.created_by_user_id,digest({probe:change,workspace})])).rows[0].id;
  for(const usage of usages)await c.query('INSERT INTO signal_licensing_policy_usages(workspace_id,licensing_policy_id,usage_purpose,decision) VALUES($1,$2,$3,$4)',[workspace,licenseId,usage.usage_purpose,usage.decision]);
  await c.query("UPDATE signal_licensing_policies SET status='active',approved_by_user_id=$2,approved_at=now() WHERE id=$1",[licenseId,old.approved_by_user_id]);
 }else{
  const definition={workspace_id:workspace,policy_key:'r16-'+change+'-override',policy_version:1,
   retention_state:change==='blocked'?'blocked' as const:'allowed' as const,
   retention_mode:change==='expired'?'until' as const:'indefinite' as const,
   retain_until:change==='expired'?new Date(Date.now()-60000).toISOString():null,
   expiry_action:'block_use' as const,approval_evidence_hash:retention.approval_evidence_hash};
  retentionId=(await c.query(`INSERT INTO signal_retention_policies(organization_id,workspace_id,policy_key,policy_version,status,retention_state,
   retention_mode,retain_until,expiry_action,approval_evidence_hash,definition_hash,created_by_user_id,approved_by_user_id,approved_at,creation_idempotency_key)
   VALUES($1,$2,$3,1,'active',$4,$5,$6,$7,$8,$9,$10,$11,now(),$12) RETURNING id`,
   [retention.organization_id,workspace,definition.policy_key,definition.retention_state,definition.retention_mode,definition.retain_until,
    definition.expiry_action,definition.approval_evidence_hash,signalRetentionPolicyDefinitionHashV1(definition),retention.created_by_user_id,retention.approved_by_user_id,digest({probe:change,workspace})])).rows[0].id;
 }
 const batches=(await c.query("SELECT id FROM import_batches WHERE workspace_id=$1 AND data_source_id=$2 AND status='completed' ORDER BY id",[workspace,prior.data_source_id])).rows;
 assert.ok(batches.length>0);
 for(const batch of batches){const definition={workspace_id:workspace,data_source_id:prior.data_source_id,import_batch_id:batch.id,binding_version:1,
  quality_policy_id:prior.quality_policy_id,retention_policy_id:retentionId,licensing_policy_id:licenseId};
  await c.query(`INSERT INTO signal_provenance_policy_bindings(workspace_id,data_source_id,import_batch_id,binding_version,status,quality_policy_id,
   retention_policy_id,licensing_policy_id,definition_hash,created_by_user_id,activated_by_user_id,activated_at,creation_idempotency_key)
   VALUES($1,$2,$3,1,'active',$4,$5,$6,$7,$8,$9,now(),$10)`,[workspace,prior.data_source_id,batch.id,prior.quality_policy_id,retentionId,licenseId,
   signalProvenancePolicyBindingDefinitionHashV1(definition),prior.created_by_user_id,prior.activated_by_user_id,digest({probe:change,workspace,batch:batch.id})]);
 }
}
test('batch provenance population preserves pending questions, purpose and exact root boundaries',{
 skip:!enabled,timeout:600000,
},async()=>runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async f=>{
 const cfg=await saveSignalListeningConfigurationV1({database:f.database,workspace_id:f.workspace_id,
  actor_user_id:f.actor_user_id,expected_revision:0,provenance:'human',configuration:r16ListeningWorkloadV1('defined_consumer_second_pass').configuration});
 const context=(await f.database.query('SELECT entity_context_digest FROM signal_mass_labeling_maps WHERE id=$1',[f.map_id])).rows[0].entity_context_digest;
 const c=await f.database.connect();try{await c.query('BEGIN');await installLegacy(c);
  const scope=[f.workspace_id,cfg.id,f.map_id,context],all=await compare(c,scope,null);
  assert.equal(all.length,12);const root=all[0]!.root_id;
  assert.equal((await compare(c,scope,[root,root])).length,4);
  assert.equal((await compare(c,scope,[])).length,0);
  assert.equal((await compare(c,scope,[randomUUID()])).length,0);
  assert.equal((await compare(c,scope,Array(4097).fill(root))).length,0);
  assert.equal((await compare(c,[randomUUID(),...scope.slice(1)],null)).length,0);
  assert.equal((await compare(c,scope,null,'invalid-purpose')).length,0);
  await compare(c,scope,null,'client-derived-metrics');
  for(const mutate of [
   async()=>denyWithSpecificBinding(c,f.workspace_id,'blocked'),
   async()=>denyWithSpecificBinding(c,f.workspace_id,'expired'),
   async()=>denyWithSpecificBinding(c,f.workspace_id,'prohibited'),
   async()=>{await c.query("UPDATE signal_licensing_policies SET status='retired',effective_to=clock_timestamp() WHERE workspace_id=$1",[f.workspace_id]);},
  ]){await c.query('SAVEPOINT revoked_policy');try{await mutate();
   assert.equal((await compare(c,scope,null)).length,0,'specific denied binding must not fall back to globally allowed policy');
  }finally{await c.query('ROLLBACK TO SAVEPOINT revoked_policy');await c.query('RELEASE SAVEPOINT revoked_policy');}}
  await c.query("UPDATE data_sources SET status='archived' WHERE workspace_id=$1",[f.workspace_id]);
  assert.equal((await compare(c,scope,null)).length,0,'revocation denies the same roots in both readers');
 }finally{await c.query('ROLLBACK');c.release();}
}}));
test('batch provenance population preserves exact observed base answers and frozen Study source',{
 skip:!enabled,timeout:600000,
},async()=>withSignalStudyFixtureV1(async f=>{
 const c=await f.database.connect();try{await c.query('BEGIN');await installLegacy(c);
  const snapshot=(await c.query('SELECT s.map_id,m.entity_context_digest FROM signal_listening_serving_snapshots s JOIN signal_mass_labeling_maps m ON m.id=s.map_id AND m.workspace_id=s.workspace_id WHERE s.id=$1 AND s.workspace_id=$2',[f.listeningSnapshot.id,f.workspace_id])).rows[0];
  const scope=[f.workspace_id,f.listening.id,snapshot.map_id,snapshot.entity_context_digest];
  const all=await compare(c,scope,null);assert.ok(all.length>=6);
  assert.ok(all.some(r=>r.question_key==='voice'&&r.answer?.choice==='individual'&&r.cache_call_id));
  assert.ok(all.some(r=>r.question_key==='promotion'&&r.answer!==null&&r.cache_call_id));
  await compare(c,scope,[all[0]!.root_id]);await compare(c,scope,null,'client-derived-metrics');
 }finally{await c.query('ROLLBACK');c.release();}
}));
