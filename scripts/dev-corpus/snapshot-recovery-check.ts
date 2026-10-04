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
  try{
    const prep=await import('../../infrastructure/db/signal-workspace-corpus-preparation');
    const management=await import('../../infrastructure/db/signal-workspace-corpus-preparation-management');
    const {signalWorkspaceCorpusPreparationJobV1:handler}=await import('../../services/workers/src/workers/signal-workspace-corpus-preparation');
    const access={database:pool,workspace_id:identity.workspace_id,actor_user_id:identity.actor_user_id};
    const before=await management.loadSignalWorkspaceCorpusPreparationStoreV1({queryable:pool,workspace_id:identity.workspace_id});
    const request=await management.requestSignalWorkspaceCorpusPreparationStoreV1({...access,idempotency_key:`mfp-prepare-${before.input_revision}`});
    const job=(await pool.query('SELECT worker_job_id FROM signal_corpus_preparation_runs WHERE id=$1',[request.run_id])).rows[0];
    await assert.rejects(runJob('prepare-snapshot-fault',job.worker_job_id,{run_id:request.run_id},task=>handler(task,{database:pool,stores:{
      claim:prep.claimSignalWorkspaceCorpusPreparationRunV1,snapshot:async()=>{throw new Error('corpus_preparation_worker_failed');},
      readPage:prep.readSignalWorkspaceCorpusPreparationPageV1,readAssets:prep.readSignalWorkspaceCorpusPreparationAssetsV1,
      commitPage:prep.commitSignalWorkspaceCorpusPreparationPageV1,finish:prep.finishSignalWorkspaceCorpusPreparationV1,fail:prep.failSignalWorkspaceCorpusPreparationV1
    }})));
    const failed=await management.loadSignalWorkspaceCorpusPreparationStoreV1({queryable:pool,workspace_id:identity.workspace_id});
    assert.equal(failed.latest_run?.input_revision,null);assert.equal(failed.latest_run?.retryable,true);
    const script=fileURLToPath(new URL('prepare.ts',import.meta.url));
    assert.equal(spawnSync(process.execPath,['--import','tsx',script],{encoding:'utf8'}).status,1);
    assert.equal(spawnSync(process.execPath,['--import','tsx',script,'--retry'],{encoding:'utf8'}).status,0);
    const recovered=await management.loadSignalWorkspaceCorpusPreparationStoreV1({queryable:pool,workspace_id:identity.workspace_id});
    assert.notEqual(recovered.latest_completed?.id,request.run_id);assert.equal(recovered.is_current,true);
    assert.equal(spawnSync(process.execPath,['--import','tsx',script],{encoding:'utf8'}).status,0);
    console.log(JSON.stringify({status:'passed',real_postgres:true,real_redis:true,snapshotless_failure_successor:true,provider_calls:0}));
  }finally{await pool.end();}
});
