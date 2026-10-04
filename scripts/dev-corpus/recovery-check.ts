import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDatabase, main } from './guard.mjs';
import { runJob } from './job';
await main(async()=>{
  const identity=JSON.parse(await readFile('.data/dev-corpus/identity.json','utf8'));
  if(!identity.fixture_key.endsWith('-recovery-check'))throw new Error('mfp_recovery_fixture_required');
  const pool=await openDatabase();
  const runScript=(name:string,args:string[]=['--retry'],expected=0)=>{
    const child=spawnSync(process.execPath,['--import','tsx',fileURLToPath(new URL(name,import.meta.url)),...args],{encoding:'utf8',env:{...process.env,NOISIA_DEV_EMBEDDINGS:'fake'}});
    assert.equal(child.status,expected,'recovery subprocess outcome');
  };
  try{
    const csvPath=process.argv[2];if(!csvPath)throw new Error('mfp_recovery_csv_required');
    const importArgs=[csvPath,'2026-01-01','2026-12-31'];
    runScript('import.ts',[...importArgs,'--test-fail-import'],1);
    runScript('import.ts',importArgs,1);
    runScript('import.ts',[...importArgs,'--retry']);
    const imports=(await pool.query('SELECT id,status,supersedes_import_batch_id FROM import_batches WHERE workspace_id=$1 ORDER BY created_at',[identity.workspace_id])).rows;
    assert.equal(imports.length,2);assert.equal(imports[0].status,'failed');assert.equal(imports[1].status,'completed');
    assert.equal(imports[1].supersedes_import_batch_id,imports[0].id);
    runScript('import.ts',importArgs);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM import_batches WHERE workspace_id=$1',[identity.workspace_id])).rows[0].count,2);
    const prep=await import('../../infrastructure/db/signal-workspace-corpus-preparation');
    const management=await import('../../infrastructure/db/signal-workspace-corpus-preparation-management');
    const {signalWorkspaceCorpusPreparationJobV1:handler}=await import('../../services/workers/src/workers/signal-workspace-corpus-preparation');
    const access={database:pool,workspace_id:identity.workspace_id,actor_user_id:identity.actor_user_id};
    const request=await management.requestSignalWorkspaceCorpusPreparationStoreV1({...access,idempotency_key:'mfp-fault-preparation-initial'});
    const job=(await pool.query('SELECT worker_job_id FROM signal_corpus_preparation_runs WHERE id=$1',[request.run_id])).rows[0];
    await assert.rejects(runJob('prepare-fault',job.worker_job_id,{run_id:request.run_id},task=>handler(task,{database:pool,stores:{
      claim:prep.claimSignalWorkspaceCorpusPreparationRunV1,snapshot:prep.snapshotSignalWorkspaceCorpusPreparationV1,
      readPage:prep.readSignalWorkspaceCorpusPreparationPageV1,readAssets:async()=>{throw new Error('corpus_preparation_worker_failed');},
      commitPage:prep.commitSignalWorkspaceCorpusPreparationPageV1,finish:prep.finishSignalWorkspaceCorpusPreparationV1,fail:prep.failSignalWorkspaceCorpusPreparationV1
    }})));
    const failed=await management.loadSignalWorkspaceCorpusPreparationStoreV1({queryable:pool,workspace_id:identity.workspace_id});
    assert.equal(failed.latest_run?.retryable,true);runScript('prepare.ts');
    const prepared=await management.loadSignalWorkspaceCorpusPreparationStoreV1({queryable:pool,workspace_id:identity.workspace_id});
    assert.equal(prepared.latest_completed?.id,request.run_id);assert.equal(prepared.is_current,true);
    const emb=await import('../../infrastructure/db/signal-workspace-embeddings-management');
    const {SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1:profile}=await import('../../packages/query-engine/src/signal-workspace-embeddings-v1');
    const {signalWorkspaceEmbeddingsJobV1}=await import('../../services/workers/src/workers/signal-workspace-embeddings');
    const {WorkspaceEmbeddingProviderErrorV1}=await import('../../services/workers/src/workers/signal-workspace-embeddings-provider');
    const embeddingAccess={...access,actor_user_id:identity.internal_user_id,profile};
    const quote=await emb.quoteSignalWorkspaceEmbeddingsStoreV1(embeddingAccess);
    const requested=await emb.requestSignalWorkspaceEmbeddingsStoreV1({...embeddingAccess,preparation_run_id:quote.preparation_run_id!,quote_digest:quote.quote_digest,
      hard_cap_micro_usd:quote.estimated_upper_micro_usd,provider_available:true,idempotency_key:'mfp-fault-embeddings-initial'});
    const embeddingJob=(await pool.query('SELECT worker_job_id FROM signal_workspace_embedding_runs WHERE id=$1',[requested.run_id])).rows[0];
    let fakeCalls=0;
    await assert.rejects(runJob('embedding-fault',embeddingJob.worker_job_id,{run_id:requested.run_id},task=>signalWorkspaceEmbeddingsJobV1(task,{database:pool,provider:{
      embedBatch:async(inputs)=>{
        if(++fakeCalls===2)throw new WorkspaceEmbeddingProviderErrorV1('workspace_embedding_definitely_not_sent','definitely_not_sent');
        return {http_status:200,provider_request_id:'synthetic-no-transport',body:JSON.stringify({model:profile.model,usage:{total_tokens:inputs.length},
          data:inputs.map((_,index)=>({index,embedding:Array.from({length:1024},(_,i)=>i===index%1024?1:0)}))})};
      }
    }})));
    const failedEmbedding=await emb.loadSignalWorkspaceEmbeddingsStoreV1({queryable:pool,workspace_id:identity.workspace_id});
    assert.equal(failedEmbedding.latest_run?.retryable,true);assert.equal(failedEmbedding.latest_run?.unknown_reserved_micro_usd,0);
    assert.equal(fakeCalls,2);assert.ok(failedEmbedding.latest_run!.settled_micro_usd>0);
    const partialQuote=await emb.quoteSignalWorkspaceEmbeddingsStoreV1(embeddingAccess);
    assert.notEqual(partialQuote.quote_digest,quote.quote_digest);
    assert.ok(partialQuote.missing_asset_chunks<quote.missing_asset_chunks);
    runScript('embeddings.ts');
    const restored=await emb.loadSignalWorkspaceEmbeddingsStoreV1({queryable:pool,workspace_id:identity.workspace_id});
    assert.equal(restored.latest_completed?.id,requested.run_id);assert.equal(restored.is_current,true);
    assert.equal(restored.latest_completed?.hard_cap_micro_usd,quote.estimated_upper_micro_usd);
    assert.ok(restored.latest_completed!.settled_micro_usd>=failedEmbedding.latest_run!.settled_micro_usd);
    const calls=(await pool.query('SELECT count(*)::int AS count FROM signal_workspace_embedding_calls WHERE run_id=$1',[requested.run_id])).rows[0].count;
    runScript('prepare.ts');runScript('embeddings.ts');
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM signal_workspace_embedding_calls WHERE run_id=$1',[requested.run_id])).rows[0].count,calls);
    console.log(JSON.stringify({status:'passed',real_postgres:true,real_redis:true,simulated_provider:true,provider_calls:0,
      import_successor_recovered:true,preparation_same_run_recovered:true,partial_settlement_preserved:true,changed_quote_recovered:true,embedding_same_run_recovered:true,original_cap_preserved:true,replay_new_calls:0}));
  }finally{await pool.end();}
});
