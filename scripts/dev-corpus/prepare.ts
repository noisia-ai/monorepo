import { readFile } from 'node:fs/promises';
import { openDatabase, main } from './guard.mjs';
import { runJob } from './job';
import { recoveryIntent } from './recovery.mjs';
await main(async()=>{
  const identity=JSON.parse(await readFile('.data/dev-corpus/identity.json','utf8'));const pool=await openDatabase();
  try {
    const {requestSignalWorkspaceCorpusPreparationStoreV1,loadSignalWorkspaceCorpusPreparationStoreV1}=await import('../../infrastructure/db/signal-workspace-corpus-preparation-management');
    const before=await loadSignalWorkspaceCorpusPreparationStoreV1({queryable:pool,workspace_id:identity.workspace_id});
    const retry=process.argv.includes('--retry');
    const intent=recoveryIntent('mfp-prepare',before,`mfp-prepare-${before.input_revision}`,retry,{input_revision:before.input_revision});
    const requested=intent.kind==='request'?await requestSignalWorkspaceCorpusPreparationStoreV1({database:pool,workspace_id:identity.workspace_id,actor_user_id:identity.actor_user_id,
      idempotency_key:intent.idempotency_key!}):{run_id:intent.run_id!};
    const run=(await pool.query('SELECT status,worker_job_id FROM signal_corpus_preparation_runs WHERE id=$1',[requested.run_id])).rows[0];
    if(run.status!=='completed'){
      const {signalWorkspaceCorpusPreparationJobV1}=await import('../../services/workers/src/workers/signal-workspace-corpus-preparation');
      await runJob('signal-workspace-corpus-preparation-v1',run.worker_job_id,{run_id:requested.run_id},job=>signalWorkspaceCorpusPreparationJobV1(job,{database:pool,page_size:500}),retry&&run.status==='queued');
    }
    const status=await loadSignalWorkspaceCorpusPreparationStoreV1({queryable:pool,workspace_id:identity.workspace_id});
    console.log(JSON.stringify({stage:'preparation',is_current:status.is_current,counts:status.latest_completed?.counts,provider_calls:0}));
  } finally {await pool.end();}
});
