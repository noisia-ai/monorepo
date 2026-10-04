import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { openDatabase, main } from './guard.mjs';
import { runJob } from './job';
await main(async()=>{
  const mode=process.env.NOISIA_DEV_EMBEDDINGS;
  if(mode!=='fake'&&mode!=='voyage')throw new Error('mfp_embedding_mode_required');
  const identity=JSON.parse(await readFile('.data/dev-corpus/identity.json','utf8'));const pool=await openDatabase();
  try {
    const {SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1:profile}=await import('../../packages/query-engine/src/signal-workspace-embeddings-v1');
    const {quoteSignalWorkspaceEmbeddingsStoreV1,requestSignalWorkspaceEmbeddingsStoreV1}=await import('../../infrastructure/db/signal-workspace-embeddings-management');
    const access={database:pool,workspace_id:identity.workspace_id,actor_user_id:identity.internal_user_id};
    const quote=await quoteSignalWorkspaceEmbeddingsStoreV1({...access,profile});
    console.log(JSON.stringify({stage:'embedding_quote',mode,estimated_micro_usd:mode==='fake'?0:quote.estimated_upper_micro_usd,
      missing_asset_chunks:quote.missing_asset_chunks}));
    // A fake receipt must never be reused as an actual Voyage embedding. These are
    // separate fixture identities on the one shared MFP DB, never cloned databases.
    const modeRow=(await pool.query(`UPDATE signal_workspaces SET metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{mfp_embedding_mode}',to_jsonb($2::text))
      WHERE id=$1 AND (metadata->>'mfp_embedding_mode' IS NULL OR metadata->>'mfp_embedding_mode'=$2) RETURNING id`,[identity.workspace_id,mode])).rows[0];
    if(!modeRow)throw new Error('mfp_embedding_fixture_mode_conflict');
    // Legacy real embeddings require a strict numeric cap. Never turn the MFP
    // estimate into that cap: until the shared nullable-cap change lands, real
    // execution requires an explicitly configured cap, not a fabricated maximum.
    const configuredCap=process.env.NOISIA_MFP_EXPLICIT_CAP_MICRO_USD;
    if(mode==='voyage'&&(!configuredCap||!/^\d+$/u.test(configuredCap)))throw new Error('mfp_voyage_nullable_cap_contract_pending');
    const cap=mode==='fake'?quote.estimated_upper_micro_usd:Number(configuredCap);
    const requested=await requestSignalWorkspaceEmbeddingsStoreV1({...access,profile,preparation_run_id:quote.preparation_run_id!,quote_digest:quote.quote_digest,
      hard_cap_micro_usd:cap,provider_available:true,idempotency_key:`mfp-embeddings-${mode}-${quote.preparation_run_id}`});
    const run=(await pool.query('SELECT worker_job_id,status FROM signal_workspace_embedding_runs WHERE id=$1',[requested.run_id])).rows[0];
    if(run.status!=='completed'){
      const {signalWorkspaceEmbeddingsJobV1}=await import('../../services/workers/src/workers/signal-workspace-embeddings');
      const provider=mode==='fake'?{async embedBatch(inputs:any[]){
        return {http_status:200,provider_request_id:'synthetic-no-transport',body:JSON.stringify({model:profile.model,usage:{total_tokens:inputs.length},
          data:inputs.map((input,index)=>{
            const vector=Array.from({length:1024},()=>0);vector[createHash('sha256').update(input.chunk_sha256).digest().readUInt16BE()%1024]=1;
            return {index,embedding:vector};})})};}}:undefined;
      await runJob('signal-workspace-embeddings-v1',run.worker_job_id,{run_id:requested.run_id},job=>signalWorkspaceEmbeddingsJobV1(job,{database:pool,provider}));
    }
    const completed=(await pool.query('SELECT status,counts,settled_micro_usd,reserved_micro_usd FROM signal_workspace_embedding_runs WHERE id=$1',[requested.run_id])).rows[0];
    console.log(JSON.stringify({stage:'embeddings',mode,status:completed.status,counts:completed.counts,
      actual_provider_micro_usd:mode==='fake'?0:Number(completed.settled_micro_usd),ledger_is_simulated:mode==='fake',
      simulated_ledger_micro_usd:mode==='fake'?Number(completed.settled_micro_usd):null,replayed:requested.replayed}));
  }finally{await pool.end();}
});
