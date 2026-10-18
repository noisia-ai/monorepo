import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {prepareWorkspaceCorpusTextChunksV1,SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 as profile} from '@noisia/query-engine';
import {createProcessingPolicyIdentitiesV1} from './signal-processing-policy.fixture';
import {requestSignalWorkspaceEmbeddingsStoreV1} from '../signal-workspace-embeddings-management';
import {withBrandContextSyntheticRollbackV1} from './signal-brand-context.rollback.fixture';


test('classic corpus admits PostgreSQL quote above USD5 with no feature and respects explicit maxima',{
 skip:process.env.NOISIA_MFP_PG_CI!=='true',timeout:120_000,
},async()=>{
 const {quoteWorkspaceCorpusEmbeddingsForActorV1,requestWorkspaceCorpusEmbeddingsForActorV1}=await import(new URL('../../../apps/studio/src/lib/data-os/workspace-corpus-embeddings.ts',import.meta.url).href);
 const physical=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='true'}),client=await physical.connect();
 const keys=['NOISIA_MENTION_FACETS_ENABLED','NOISIA_WORKSPACE_EMBEDDINGS_MAX_COST_MICRO_USD','NOISIA_WORKSPACE_EMBEDDINGS_PROVIDER_ENABLED','VOYAGE_API_KEY'] as const;
 const prior=Object.fromEntries(keys.map(key=>[key,process.env[key]]));let baseline:unknown;
 process.env.NOISIA_MENTION_FACETS_ENABLED='false';delete process.env.NOISIA_WORKSPACE_EMBEDDINGS_MAX_COST_MICRO_USD;
 process.env.NOISIA_WORKSPACE_EMBEDDINGS_PROVIDER_ENABLED='true';process.env.VOYAGE_API_KEY='synthetic-never-transmitted';
 try{await withBrandContextSyntheticRollbackV1({client,verify:async(c,phase)=>{
  const census=(await c.query('SELECT (SELECT count(*) FROM organizations) orgs,(SELECT count(*) FROM signal_processing_admissions) admissions,(SELECT count(*) FROM signal_workspace_embedding_calls) calls')).rows[0];
  if(phase==='before')baseline=census;else assert.deepEqual(census,baseline);
 },run:async({database,scoped})=>{
  assert.equal((await scoped.query('SELECT current_database() name')).rows[0].name,'noisia_mfp_ci');
  const f=await createProcessingPolicyIdentitiesV1({database,scoped});
  const {workspace_id:workspace,organization_id:org}=f.first,actor=f.actors.internal,prep=randomUUID(),policy=randomUUID();
  const text='Synthetic corpus for an optional strict maximum. '.repeat(350_000);
  const sha=`sha256:${createHash('sha256').update(text).digest('hex')}`,chunks=prepareWorkspaceCorpusTextChunksV1(text,sha);
  const revision=(await scoped.query('SELECT input_revision::text FROM signal_corpus_preparation_input_state WHERE workspace_id=$1',[workspace])).rows[0].input_revision;
  await scoped.query(`INSERT INTO signal_corpus_preparation_runs(id,workspace_id,actor_user_id,status,phase,input_revision,completed_at,worker_job_id)
   VALUES($1::uuid,$2::uuid,$3::uuid,'completed','complete',$4,clock_timestamp(),$1::uuid::text)`,[prep,workspace,actor,revision]);
  await scoped.query(`INSERT INTO signal_corpus_text_assets(workspace_id,text_sha256,chunk_policy_version,full_text,chunks,prepared_at)
   VALUES($1,$2,'corpus-text-chunks-v1',$3,$4::jsonb,clock_timestamp())`,[workspace,sha,text,JSON.stringify(chunks)]);
  await scoped.query(`INSERT INTO signal_corpus_preparation_items(workspace_id,run_id,root_id,asset_sha256,disposition,root_metadata,provenance,semantic_eligible,fingerprint)
   VALUES($1,$2,$3,$4,'eligible','{}','[]',true,$4)`,[workspace,prep,randomUUID(),sha]);
  await scoped.query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
   VALUES($1,$2,1,'draft',clock_timestamp()-interval '1 minute','infinity','UTC',20000000,$3)`,[policy,org,actor]);
  await scoped.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd)
   VALUES($1,'corpus_embeddings','provider','voyage','voyage-4-large',$2::jsonb,signal_semantic_context_digest_json_v2($2::jsonb),NULL)`,[policy,JSON.stringify(profile)]);
  await scoped.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[policy]);
  const args={database,workspaceId:workspace,actorUserId:actor};
  const quote=await quoteWorkspaceCorpusEmbeddingsForActorV1(args);
  assert.ok(quote.estimated_upper_micro_usd>5_000_000);
  assert.equal(quote.optional_strict_cap,true);assert.equal(quote.max_run_cost_micro_usd,null);assert.equal(quote.can_execute,true);
  assert.equal((await scoped.query('SELECT count(*)::int n FROM signal_workspace_features WHERE workspace_id=$1',[workspace])).rows[0].n,0);
  await client.query('SAVEPOINT strict_policy');
  try{
    const strictPolicy=randomUUID();
    await scoped.query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
      VALUES($1,$2,2,'draft',clock_timestamp()-interval '1 minute','infinity','UTC',NULL,$3)`,[strictPolicy,org,actor]);
    await scoped.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd)
      SELECT $1,action,kind,provider,model,configuration,configuration_digest,5000000 FROM signal_processing_policy_actions WHERE policy_version_id=$2`,[strictPolicy,policy]);
    await scoped.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[policy]);
    await scoped.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[strictPolicy]);
    const bounded=await quoteWorkspaceCorpusEmbeddingsForActorV1(args);assert.equal(bounded.max_run_cost_micro_usd,5_000_000);
    await assert.rejects(requestWorkspaceCorpusEmbeddingsForActorV1({...args,idempotencyKey:'classic-policy-null',body:{preparation_run_id:prep,quote_digest:bounded.quote_digest,hard_cap_micro_usd:null}}),/budget_exceeds_limit/u);
    await assert.rejects(requestSignalWorkspaceEmbeddingsStoreV1({database,workspace_id:workspace,actor_user_id:actor,profile,
      preparation_run_id:prep,quote_digest:bounded.quote_digest,idempotency_key:'classic-policy-over',hard_cap_micro_usd:bounded.estimated_upper_micro_usd,provider_available:true}),/budget_exceeds_limit/u);
    assert.equal((await scoped.query('SELECT count(*)::int n FROM signal_workspace_embedding_runs WHERE workspace_id=$1',[workspace])).rows[0].n,0);
  }finally{await client.query('ROLLBACK TO SAVEPOINT strict_policy');await client.query('RELEASE SAVEPOINT strict_policy');}
  await requestWorkspaceCorpusEmbeddingsForActorV1({...args,idempotencyKey:'classic-over-five',body:{preparation_run_id:prep,quote_digest:quote.quote_digest,hard_cap_micro_usd:null}});
  const run=(await scoped.query('SELECT id::text,hard_cap_micro_usd::text,processing_admission_id::text FROM signal_workspace_embedding_runs WHERE workspace_id=$1',[workspace])).rows[0];
  assert.equal(run.hard_cap_micro_usd,null);assert.ok(run.processing_admission_id);
  assert.equal((await scoped.query('SELECT count(*)::int n FROM signal_workspace_embedding_calls WHERE run_id=$1',[run.id])).rows[0].n,0);
  await client.query('SAVEPOINT daily_budget');
  try{
    await assert.rejects(scoped.query(`SELECT signal_processing_capacity_v1($1::uuid,$2::uuid,$3::uuid,$4::uuid,
      ARRAY['corpus_embeddings'],'voyage','voyage-4-large',$5::jsonb,NULL,NULL,NULL,20000001)`,
      [workspace,actor,run.id,run.processing_admission_id,JSON.stringify(profile)]),/processing_daily_cap_exhausted/u);
  }finally{await client.query('ROLLBACK TO SAVEPOINT daily_budget');await client.query('RELEASE SAVEPOINT daily_budget');}
  process.env.NOISIA_WORKSPACE_EMBEDDINGS_MAX_COST_MICRO_USD='5000000';
  const strict=await quoteWorkspaceCorpusEmbeddingsForActorV1(args);assert.equal(strict.max_run_cost_micro_usd,5_000_000);
  await assert.rejects(requestWorkspaceCorpusEmbeddingsForActorV1({...args,idempotencyKey:'classic-cannot-remove-cap',body:{preparation_run_id:prep,quote_digest:strict.quote_digest,hard_cap_micro_usd:null}}),/budget_exceeds_limit/u);
  assert.equal((await scoped.query('SELECT count(*)::int n FROM signal_workspace_embedding_runs WHERE workspace_id=$1',[workspace])).rows[0].n,1);
 }});}finally{
  for(const key of keys){const value=prior[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}
  client.release();await physical.end();
 }
});
