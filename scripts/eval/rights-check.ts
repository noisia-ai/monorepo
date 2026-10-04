/** Read-only preflight for the private MFP fixture before sending any text to JEV. */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
// @ts-expect-error guarded private runner JavaScript
import { main,openDatabase } from '../dev-corpus/guard.mjs';
export async function verifyMfpEvalRights(){
  const identity=JSON.parse(await readFile('.data/dev-corpus/voyage-real/identity.json','utf8')) as {fixture_key:string;workspace_id:string;source_id:string};
  if(identity.fixture_key!=='rental-corpus-voyage-v1'||!identity.workspace_id||!identity.source_id)throw new Error('mfp_eval_fixture_identity_invalid');
  const pool=await openDatabase();
  const client=await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const rights=await client.query(`WITH accepted AS MATERIALIZED (
        SELECT id,data_source_id FROM import_batches WHERE workspace_id=$1 AND status='completed'
      ),authorized AS MATERIALIZED (
        SELECT batch.id,batch.data_source_id FROM accepted batch
        JOIN data_sources source ON source.id=batch.data_source_id AND source.workspace_id=$1 AND source.status='active'
        JOIN LATERAL (SELECT candidate.* FROM signal_provenance_policy_bindings candidate
          WHERE candidate.workspace_id=$1 AND candidate.data_source_id=batch.data_source_id
            AND candidate.status='active' AND candidate.effective_from<=now()
            AND (candidate.effective_to IS NULL OR candidate.effective_to>now())
            AND (candidate.import_batch_id=batch.id OR candidate.import_batch_id IS NULL)
          ORDER BY (candidate.import_batch_id IS NOT NULL) DESC,candidate.binding_version DESC,candidate.id LIMIT 1) binding ON true
        JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
          AND retention.workspace_id=$1 AND retention.status='active' AND retention.effective_from<=now()
          AND (retention.effective_to IS NULL OR retention.effective_to>now()) AND retention.retention_state='allowed'
          AND (retention.retention_mode='indefinite' OR retention.retention_mode='until' AND retention.retain_until>now())
        JOIN signal_licensing_policies licensing ON licensing.id=binding.licensing_policy_id
          AND licensing.workspace_id=$1 AND licensing.status='active' AND licensing.effective_from<=now()
          AND (licensing.effective_to IS NULL OR licensing.effective_to>now())
        WHERE EXISTS(SELECT 1 FROM signal_licensing_policy_usages usage
          WHERE usage.workspace_id=$1 AND usage.licensing_policy_id=licensing.id
            AND usage.usage_purpose='llm-processing' AND usage.decision='allowed')
      ) SELECT (SELECT count(*)::int FROM accepted) accepted_batches,
        (SELECT count(DISTINCT data_source_id)::int FROM accepted) accepted_sources,
        (SELECT count(*)::int FROM authorized) authorized_batches,
        (SELECT count(DISTINCT data_source_id)::int FROM authorized) authorized_sources,
        (SELECT count(*)::int FROM authorized WHERE data_source_id=$2::uuid) expected_source_batches`,[identity.workspace_id,identity.source_id]);
    const activity=await client.query(`SELECT (SELECT count(*)::int FROM signal_labeling_runs WHERE workspace_id=$1 AND status IN('queued','running')) active_runs,
        (SELECT count(*)::int FROM signal_labeling_calls WHERE workspace_id=$1 AND status IN('reserved','submitting','submitted','unknown')) unsettled_calls`,[identity.workspace_id]);
    const state={...rights.rows[0],...activity.rows[0]};
    if(state.accepted_batches!==1||state.accepted_sources!==1||state.authorized_batches!==1||state.authorized_sources!==1||state.expected_source_batches!==1||state.active_runs!==0||state.unsettled_calls!==0)
      throw new Error('mfp_eval_rights_or_activity_invalid');
    console.log(JSON.stringify({stage:'mfp_eval_jev_rights_verified',...state,read_only:true}));
    await client.query('COMMIT');
  } catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main(verifyMfpEvalRights);
