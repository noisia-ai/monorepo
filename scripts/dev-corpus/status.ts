import { readFile } from 'node:fs/promises';
import { openDatabase, main } from './guard.mjs';
await main(async()=>{
  const identity=JSON.parse(await readFile('.data/dev-corpus/identity.json','utf8'));const pool=await openDatabase();
  try {
    const {loadSignalWorkspaceCorpusPreparationStoreV1}=await import('../../infrastructure/db/signal-workspace-corpus-preparation-management');
    const {loadSignalWorkspaceEmbeddingsStoreV1}=await import('../../infrastructure/db/signal-workspace-embeddings-management');
    const preparation=await loadSignalWorkspaceCorpusPreparationStoreV1({queryable:pool,workspace_id:identity.workspace_id});
    const embedding=await loadSignalWorkspaceEmbeddingsStoreV1({queryable:pool,workspace_id:identity.workspace_id});
    const imports=(await pool.query(`SELECT count(*)::int AS completed_files,coalesce(sum(record_count),0)::int AS received,
      coalesce(sum(duplicate_count),0)::int AS duplicates FROM import_batches WHERE workspace_id=$1 AND status='completed'`,[identity.workspace_id])).rows[0];
    const roots=(await pool.query('SELECT count(*)::int AS unique FROM mentions WHERE workspace_id=$1',[identity.workspace_id])).rows[0];
    const tables=(await pool.query("SELECT to_regclass('signal_mention_facets_current_v1')::text AS facets,to_regclass('signal_concept_memberships_current_v1')::text AS memberships")).rows[0];
    const facets=tables.facets?(await pool.query(`SELECT count(*) FILTER(WHERE status='labeled')::int AS labeled,count(*) FILTER(WHERE relevance='relevant')::int AS relevant FROM signal_mention_facets_current_v1 WHERE workspace_id=$1`,[identity.workspace_id])).rows[0]:null;
    const memberships=tables.memberships?(await pool.query(`SELECT count(DISTINCT root_id)::int AS roots_with_membership FROM signal_concept_memberships_current_v1 WHERE workspace_id=$1 AND verdict='belongs'`,[identity.workspace_id])).rows[0]:null;
    console.log(JSON.stringify({contract_version:'mfp-corpus-status-v1',...imports,...roots,preparation_current:preparation.is_current,
      preparation:preparation.latest_completed?.counts??null,embedding_current:embedding.is_current,embedding:embedding.latest_completed?.counts??null,
      facets,memberships,evidence:'remote_real_database',semantic_acceptance:false}));
  } finally {await pool.end();}
});
