import assert from 'node:assert/strict';
import test from 'node:test';
import type {Pool} from 'pg';
import {loadSignalWorkspaceCapabilitiesStoreV1} from '../signal-workspace-capabilities';
import {randomUUID} from 'node:crypto';
import {SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1} from '@noisia/query-engine';
import {completeSignalClassicPolicyV1,readClassicPolicyActiveWorkV1} from '../signal-classic-policy-completion';
import {provisionSignalBrandContextPolicyV1} from '../signal-brand-context-policy-provisioning';
import {seedComposedFixture,quoteComposedFixture,startComposedFixture,semanticConfiguration} from './signal-brand-context-composed.fixture';
import {createProcessingPolicyIdentitiesV1} from './signal-processing-policy.fixture';

test('explicit classic completion preserves a sibling policy and live actor authority in PostgreSQL',{
 skip:process.env.NOISIA_MFP_PG_CI!=='true',timeout:120_000
},async()=>{
 const {openDatabase}=await import(new URL('../../../scripts/dev-corpus/guard.mjs',import.meta.url).href);
 const pool:Pool=await openDatabase(),raw=await pool.connect();
 const census=`SELECT jsonb_build_object('policies',(SELECT count(*) FROM signal_processing_policy_versions),
  'actions',(SELECT count(*) FROM signal_processing_policy_actions),'features',(SELECT count(*) FROM signal_workspace_features),
  'admissions',(SELECT count(*) FROM signal_processing_admissions),'runs',(SELECT count(*) FROM signal_labeling_runs),
  'organizations',(SELECT count(*) FROM organizations),'users',(SELECT count(*) FROM users),'brands',(SELECT count(*) FROM brands)) value`;
 const before=(await raw.query(census)).rows[0].value;
 try{
  await raw.query('BEGIN');
  const f=await createProcessingPolicyIdentitiesV1({database:pool,scoped:raw});
  for(const [scope,actor] of [[f.first,f.actors.firstAdmin],[f.second,f.actors.secondAdmin]] as const)
   await raw.query(`UPDATE signal_workspaces SET metadata=metadata||jsonb_build_object('created_by_user_id',$2::text,
    'creation_request_digest','sha256:'||repeat('a',64)) WHERE id=$1`,[scope.workspace_id,actor]);
  await raw.query("INSERT INTO signal_workspace_features(workspace_id,feature,enabled_by) VALUES($1,'mention_facets',$2)",[f.first.workspace_id,f.actors.internal]);
  let failAction=false;
  const query=async(sql:string,params?:unknown[])=>{
   if(failAction&&sql.includes('INSERT INTO signal_processing_policy_actions')&&params?.[1]==='topic_prototype_embeddings')throw Error('synthetic_action_failure');
   if(sql.startsWith('BEGIN'))return raw.query('SAVEPOINT classic_completion');
   if(sql==='COMMIT')return raw.query('RELEASE SAVEPOINT classic_completion');
   if(sql==='ROLLBACK'){await raw.query('ROLLBACK TO SAVEPOINT classic_completion');return raw.query('RELEASE SAVEPOINT classic_completion');}
   return raw.query(sql,params);
  };
  const database={connect:async()=>({query,release(){}})} as unknown as Pick<Pool,'connect'>;
  const env={NOISIA_MENTION_FACETS_ENABLED:'true',NOISIA_BRAND_CONTEXT_POLICY_CREATOR_USER_ID:f.actors.internal,
   NOISIA_SEMANTIC_CONTEXT_MODEL:'claude-sonnet-4-6',NOISIA_SEMANTIC_CONTEXT_MODEL_VERSION:'claude-sonnet-4-6',
   NOISIA_SEMANTIC_CONTEXT_PRICING_VERSION:'claude-sonnet-4-6-standard-global-usd-2026-09-09',
   NOISIA_SEMANTIC_CONTEXT_MAX_INPUT_TOKENS:'20000',NOISIA_SEMANTIC_CONTEXT_MAX_OUTPUT_TOKENS:'8192',
   NOISIA_SEMANTIC_CONTEXT_INPUT_USD_PER_MILLION_TOKENS:'3',NOISIA_SEMANTIC_CONTEXT_OUTPUT_USD_PER_MILLION_TOKENS:'15'};
  assert.equal((await provisionSignalBrandContextPolicyV1({database,...{workspace_id:f.first.workspace_id,brand_id:f.first.brand_id},
   initiator_user_id:f.actors.firstAdmin,env})).status,'provisioned');
  const snapshotSql=`SELECT p.id::text,p.valid_until::text,p.daily_cap_micro_usd::text,p.budget_timezone,
   (SELECT jsonb_agg(to_jsonb(a)-'id'-'policy_version_id' ORDER BY action) FROM signal_processing_policy_actions a WHERE a.policy_version_id=p.id) actions
   FROM signal_processing_policy_versions p WHERE organization_id=$1 AND status='active'`;
  const original=(await raw.query(snapshotSql,[f.first.organization_id])).rows[0];
  assert.equal(original.actions.length,8);assert.equal(original.valid_until,'infinity');assert.equal(original.daily_cap_micro_usd,null);
  assert.equal((await loadSignalWorkspaceCapabilitiesStoreV1({queryable:raw,workspace_id:f.second.workspace_id,actor_user_id:f.actors.secondAdmin})).can_request_processing,true,
   'a client admin may request processing but cannot replace an organization-wide policy');
  const invoke=(actor_user_id:string,configuration:Record<string,string>=env)=>completeSignalClassicPolicyV1({database,workspace_id:f.second.workspace_id,brand_id:f.second.brand_id,actor_user_id,env:configuration});
  for(const actor of [f.actors.noGrant,f.actors.firstAdmin,f.actors.secondAdmin,f.actors.foreignAdmin,f.actors.suspended,f.actors.viewer]){
   assert.equal((await invoke(actor)).status,'not_eligible');
   assert.deepEqual((await raw.query(snapshotSql,[f.first.organization_id])).rows[0],original);
  }
  await raw.query('SAVEPOINT sibling_preparation');
  const preparationId=randomUUID();
  const admission=(await raw.query<{result:{receipt:{id:string}}}>(`SELECT admit_signal_processing_v1(
   $1::uuid,$2::uuid,'corpus_preparation',$3::uuid,$4,'sha256:'||repeat('a',64),0,false) result`,
   [f.first.workspace_id,f.actors.firstAdmin,preparationId,randomUUID()])).rows[0]!.result.receipt;
  await raw.query(`INSERT INTO signal_corpus_preparation_runs(id,workspace_id,actor_user_id,processing_admission_id,worker_job_id,status)
   VALUES($1,$2,$3,$4,$5,'queued')`,[preparationId,f.first.workspace_id,f.actors.firstAdmin,admission.id,`classic-${preparationId}`]);
  for(const status of ['queued','running']){
   await raw.query('UPDATE signal_corpus_preparation_runs SET status=$2 WHERE id=$1',[preparationId,status]);
   assert.equal((await invoke(f.actors.internal)).status,'active_work',`${status} sibling owner blocks policy replacement`);
   assert.deepEqual((await raw.query(snapshotSql,[f.first.organization_id])).rows[0],original);
  }
  await raw.query('ROLLBACK TO SAVEPOINT sibling_preparation');await raw.query('RELEASE SAVEPOINT sibling_preparation');
  await raw.query('SAVEPOINT sibling_embeddings');
  const embeddingPrep=randomUUID(),embeddingRun=randomUUID();
  await raw.query(`INSERT INTO signal_corpus_preparation_runs(id,workspace_id,actor_user_id,worker_job_id,status)
   VALUES($1,$2,$3,$4,'failed')`,[embeddingPrep,f.first.workspace_id,f.actors.firstAdmin,`classic-${embeddingPrep}`]);
  const embeddingAdmission=(await raw.query<{result:{receipt:{id:string}}}>(`SELECT admit_signal_processing_v1(
   $1::uuid,$2::uuid,'corpus_embeddings',$3::uuid,$4,'sha256:'||repeat('a',64),NULL,false) result`,
   [f.first.workspace_id,f.actors.firstAdmin,embeddingRun,randomUUID()])).rows[0]!.result.receipt;
  await raw.query(`INSERT INTO signal_workspace_embedding_runs(id,workspace_id,preparation_run_id,actor_user_id,
   input_revision,profile,config_digest,quote_digest,request_keys,hard_cap_micro_usd,estimated_upper_micro_usd,
   status,counts,worker_job_id,input_contract,processing_admission_id)
   VALUES($1,$2,$3,$4,1,$5::jsonb,$6,$6,'{}',NULL,0,'queued','{}',$7,'corpus',$8)`,
   [embeddingRun,f.first.workspace_id,embeddingPrep,f.actors.firstAdmin,JSON.stringify(SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1),
    SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1.config_digest,`classic-${embeddingRun}`,embeddingAdmission.id]);
  for(const status of ['queued','running','outcome_unknown']){
   await raw.query('UPDATE signal_workspace_embedding_runs SET status=$2 WHERE id=$1',[embeddingRun,status]);
   assert.equal((await invoke(f.actors.internal)).status,'active_work',`${status} sibling embeddings block replacement`);
   assert.deepEqual((await raw.query(snapshotSql,[f.first.organization_id])).rows[0],original);
  }
  await raw.query('ROLLBACK TO SAVEPOINT sibling_embeddings');await raw.query('RELEASE SAVEPOINT sibling_embeddings');
  // A failed sibling run can still own already-paid raw results. No transport
  // is used: real ledger rows establish the policy-replacement barrier.
  await raw.query('SAVEPOINT sibling_raw');
  const prep=randomUUID(),labeler=randomUUID(),run=randomUUID(),call=randomUUID();
  const hash=`sha256:${'1'.repeat(64)}`;
  await raw.query(`INSERT INTO signal_corpus_preparation_runs(id,workspace_id,actor_user_id,worker_job_id,status)
   VALUES($1,$2,$3,$4,'failed')`,[prep,f.first.workspace_id,f.actors.firstAdmin,`classic-${prep}`]);
  await raw.query(`INSERT INTO signal_labeler_versions(id,kind,provider,model,prompt_digest,schema_digest,labeler_digest,identity)
   VALUES($1,'facets','anthropic','claude-sonnet-5-5',$2,$2,$3,'{}')`,[labeler,hash,`sha256:${labeler.replaceAll('-','').padEnd(64,'0')}`]);
  await raw.query(`INSERT INTO signal_entity_context_versions(workspace_id,version_no,digest,context,diff,affected_mode,affected_count)
   VALUES($1,1,$2,'{}','{}','targeted',0)`,[f.first.workspace_id,hash]);
  await raw.query(`INSERT INTO signal_labeling_runs(id,workspace_id,kind,labeler_version_id,preparation_run_id,
   entity_context_digest,entity_context_version_no,status,estimated_micro_usd,idempotency_key,request_digest,actor_user_id,error_code)
   VALUES($1,$2,'facets',$3,$4,$5,1,'failed',0,$6,$5,$7,'invalid_facets')`,
   [run,f.first.workspace_id,labeler,prep,hash,`classic-${run}`,f.actors.firstAdmin]);
  await raw.query(`INSERT INTO signal_labeling_calls(id,run_id,workspace_id,provider,model,transport,custom_id,request_digest,
   request,inputs,status,reserved_micro_usd,settled_micro_usd,raw_sha256,raw_storage_key,raw_size_bytes,budget_date,budget_timezone)
   VALUES($1,$2,$3,'anthropic','claude-sonnet-5-5','batch',$4,$5,'{}','[]','failed',1,1,$5,$6,4,current_date,'UTC')`,
   [call,run,f.first.workspace_id,`classic-${call}`,hash,`private/${call}`]);
  assert.equal((await invoke(f.actors.internal)).status,'active_work','sibling stored raw must be applied before policy replacement');
  assert.deepEqual((await raw.query(snapshotSql,[f.first.organization_id])).rows[0],original);
  await raw.query('ROLLBACK TO SAVEPOINT sibling_raw');await raw.query('RELEASE SAVEPOINT sibling_raw');
  await raw.query('SAVEPOINT revoked_grant');
  await raw.query('UPDATE user_brand_access SET revoked_at=clock_timestamp() WHERE user_id=$1 AND brand_id=$2',[f.actors.secondAdmin,f.second.brand_id]);
  assert.equal((await invoke(f.actors.secondAdmin)).status,'not_eligible');
  assert.deepEqual((await raw.query(snapshotSql,[f.first.organization_id])).rows[0],original);
  await raw.query('ROLLBACK TO SAVEPOINT revoked_grant');await raw.query('RELEASE SAVEPOINT revoked_grant');
  await raw.query('SAVEPOINT sibling_semantic');
  const scopedPool={query:raw.query.bind(raw),connect:database.connect} as unknown as Pool;
  const semanticFixture=await seedComposedFixture(scopedPool,'classic-completion',{optionalStrictCaps:true});
  const quote=await quoteComposedFixture(scopedPool,semanticFixture);
  assert.equal(quote.quote_status,'quoted');assert.ok(quote.quote_digest);
  const semanticRun=await startComposedFixture(scopedPool,semanticFixture,quote.quote_digest!,`classic-${randomUUID()}`,
   {...semanticConfiguration,platform_hard_cap_micro_usd:null});
  await raw.query('SET CONSTRAINTS ALL IMMEDIATE');await raw.query('SET CONSTRAINTS ALL DEFERRED');
  // Simulate an admitted historical owner under a prior policy. All inserts,
  // admission and transitions use the real schema/guards; no trigger is disabled.
  const semanticPrior=(await raw.query<{id:string}>(`SELECT id::text FROM signal_processing_policy_versions
   WHERE organization_id=$1 AND status='active'`,[semanticFixture.organizationId])).rows[0]!;
  for(const status of ['queued','processing','validating']){
   await raw.query('SAVEPOINT semantic_status');
   await raw.query('UPDATE signal_semantic_context_proposal_runs SET status=$2 WHERE id=$1',[semanticRun.run_id,status]);
  const partial=(await raw.query<{id:string}>(`INSERT INTO signal_processing_policy_versions(organization_id,version,status,
   valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
   SELECT organization_id,version+1,'draft',clock_timestamp(),valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id
   FROM signal_processing_policy_versions WHERE id=$1 RETURNING id::text`,[semanticPrior.id])).rows[0]!;
  await raw.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,
   configuration_digest,max_execution_micro_usd,automatic_allowed)
   SELECT $1,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed
   FROM signal_processing_policy_actions WHERE policy_version_id=$2 AND action='brand_context_proposal'`,[partial.id,semanticPrior.id]);
  await raw.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[semanticPrior.id]);
  await raw.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[partial.id]);
   assert.equal(await readClassicPolicyActiveWorkV1(raw,semanticFixture.organizationId),true);
   assert.equal((await completeSignalClassicPolicyV1({database,workspace_id:semanticFixture.workspaceId,
    brand_id:semanticFixture.brandId,actor_user_id:semanticFixture.internalActorId,env})).status,'active_work',
    `${status} semantic owner blocks replacement even when its original policy is historical`);
   assert.equal((await raw.query("SELECT count(*)::int n FROM signal_processing_policy_versions WHERE organization_id=$1",[semanticFixture.organizationId])).rows[0].n,2);
   await raw.query('ROLLBACK TO SAVEPOINT semantic_status');await raw.query('RELEASE SAVEPOINT semantic_status');
  }
  await raw.query('ROLLBACK TO SAVEPOINT sibling_semantic');await raw.query('RELEASE SAVEPOINT sibling_semantic');
  await raw.query('SAVEPOINT future_policy');
  const future=(await raw.query<{id:string}>(`INSERT INTO signal_processing_policy_versions(organization_id,version,status,
   valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
   SELECT organization_id,version+1,'draft',clock_timestamp()+interval '1 hour',valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id
   FROM signal_processing_policy_versions WHERE id=$1 RETURNING id::text`,[original.id])).rows[0]!;
  await raw.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,
   configuration_digest,max_execution_micro_usd,automatic_allowed)
   SELECT $1,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed
   FROM signal_processing_policy_actions WHERE policy_version_id=$2`,[future.id,original.id]);
  await raw.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[original.id]);
  await raw.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[future.id]);
  assert.equal((await invoke(f.actors.internal)).status,'configuration_required','a future policy cannot be completed early');
  assert.equal((await raw.query('SELECT count(*)::int n FROM signal_processing_policy_versions WHERE organization_id=$1',[f.first.organization_id])).rows[0].n,2);
  await raw.query('ROLLBACK TO SAVEPOINT future_policy');await raw.query('RELEASE SAVEPOINT future_policy');
  assert.equal((await invoke(f.actors.internal,{})).status,'configuration_required');
  assert.deepEqual((await raw.query(snapshotSql,[f.first.organization_id])).rows[0],original);
  failAction=true;
  await assert.rejects(invoke(f.actors.internal),/synthetic_action_failure/u);
  failAction=false;
  assert.deepEqual((await raw.query(snapshotSql,[f.first.organization_id])).rows[0],original,'partial pair insertion rolls back');
  assert.equal((await raw.query('SELECT count(*)::int n FROM signal_processing_policy_versions WHERE organization_id=$1',[f.first.organization_id])).rows[0].n,1);
  assert.equal((await invoke(f.actors.internal)).status,'provisioned',
   'explicit completion adds the missing classic pair without enabling per-mention processing');
  const next=(await raw.query(snapshotSql,[f.first.organization_id])).rows[0];
  assert.notEqual(next.id,original.id);assert.equal(next.valid_until,original.valid_until);
  assert.equal(next.daily_cap_micro_usd,original.daily_cap_micro_usd);assert.equal(next.budget_timezone,original.budget_timezone);
  assert.equal(next.actions.length,10);
  for(const action of original.actions)assert.deepEqual(next.actions.find((a:{action:string})=>a.action===action.action),action);
  assert.equal((await raw.query('SELECT count(*)::int n FROM signal_workspace_features WHERE workspace_id=$1',[f.second.workspace_id])).rows[0].n,0);
  const newWork=(await raw.query<{work:number}>(`SELECT
   (SELECT count(*) FROM signal_processing_admissions WHERE organization_id=$1)+
   (SELECT count(*) FROM signal_labeling_runs r JOIN signal_workspaces w ON w.id=r.workspace_id WHERE w.organization_id=$1)+
   (SELECT count(*) FROM signal_semantic_context_proposal_runs r JOIN signal_workspaces w ON w.id=r.workspace_id WHERE w.organization_id=$1)+
   (SELECT count(*) FROM signal_workspace_embedding_runs r JOIN signal_workspaces w ON w.id=r.workspace_id WHERE w.organization_id=$1) work`,[f.first.organization_id])).rows[0]!;
  assert.equal(Number(newWork.work),0,'completion creates no admission, run or paid work');
  assert.equal((await invoke(f.actors.internal)).status,'existing_policy');
  assert.deepEqual((await raw.query(snapshotSql,[f.first.organization_id])).rows[0],next);
  await raw.query('ROLLBACK');
  assert.deepEqual((await pool.query(census)).rows[0].value,before);
 }finally{await raw.query('ROLLBACK').catch(()=>undefined);raw.release();await pool.end();}
});
