/** Read-only preflight for the private MFP fixture before sending any text to JEV. */
import { loadMfpEvalIdentity } from './fixture-identity';
// @ts-ignore -- eval and provider tsconfigs type the guarded JavaScript entrypoint differently.
import { main,openDatabase } from '../dev-corpus/guard.mjs';
type RightsCensus={accepted_batches:number;accepted_sources:number;authorized_batches:number;authorized_sources:number;
  expected_source_batches:number;active_runs:number;unsettled_calls:number};
/** This fixed fixture has two completed loads from one source; failed imports are excluded by the SQL CTE. */
export function mfpEvalRightsCensusValid(state:RightsCensus,exactWorkspace:boolean){
  return exactWorkspace&&state.accepted_batches===2&&state.accepted_sources===1&&
    state.authorized_batches===2&&state.authorized_sources===1&&state.expected_source_batches===2&&
    state.active_runs===0&&state.unsettled_calls===0;
}
export async function verifyMfpEvalRights(allowedRunId?:string,database?:{connect():Promise<any>}){
  if(allowedRunId&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(allowedRunId))
    throw new Error('mfp_eval_allowed_run_invalid');
  const identity=await loadMfpEvalIdentity();
  const pool=database??await openDatabase();
  const client=await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const workspace=await client.query(`SELECT EXISTS(SELECT 1 FROM signal_workspaces
      WHERE id=$1::uuid AND organization_id=$2::uuid AND brand_id=$3::uuid AND status='active') exact_workspace`,
      [identity.workspace_id,identity.organization_id,identity.brand_id]);
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
    const activity=await client.query(`SELECT (SELECT count(*)::int FROM signal_labeling_runs WHERE workspace_id=$1
          AND status IN('queued','running') AND ($2::uuid IS NULL OR id<>$2::uuid)) active_runs,
        (SELECT count(*)::int FROM signal_labeling_calls WHERE workspace_id=$1
          AND status IN('reserved','submitting','submitted','unknown')
          AND ($2::uuid IS NULL OR run_id<>$2::uuid)) unsettled_calls`,[identity.workspace_id,allowedRunId??null]);
    const state={...rights.rows[0],...activity.rows[0]};
    if(!mfpEvalRightsCensusValid(state,workspace.rows[0]?.exact_workspace===true))
      throw new Error('mfp_eval_rights_or_activity_invalid');
    console.log(JSON.stringify({stage:'mfp_eval_jev_rights_verified',...state,
      active_run_excluded:Boolean(allowedRunId),exact_workspace:true,read_only:true}));
    await client.query('COMMIT');
  } catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();if(!database)await pool.end();}
}
if(process.argv[1]?.endsWith('/scripts/eval/rights-check.ts'))void main(verifyMfpEvalRights);
