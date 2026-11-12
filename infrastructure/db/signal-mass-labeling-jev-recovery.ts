import {
  massLabelingConfigurationV2, signalWorkspaceEmbeddingDigestV1 as digest,
  type LlmUsageV1, type MassLabelingInputV1, type MassLabelingResultV1,
} from "@noisia/query-engine";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";
import { signalWorkspaceFeatureEnabledV1 } from "./signal-workspace-features";
import { mapCurrent, writeMassLabelingResultsV1 } from "./signal-mass-labeling";
import { loadMassLabelingStudyPolicyWithClientV1 } from "./signal-mass-labeling-study-policy";
import { SignalLabelingError, type LabelingCallV1, type LabelingRunV1 } from "./signal-labeling-runs";
import type { LabelingDatabaseV1 } from "./signal-mention-facets";

function fail(code: string): never { throw new SignalLabelingError(code); }
/** Storage-only recovery of an existing native request. The run stays failed
 * until its operator uses the ordinary retry action with the frozen admission. */
export async function reconcileMassLabelingJevReceiptV1(args: {
  database: LabelingDatabaseV1; run_id: string; workspace_id: string; actor_user_id: string;
  call_id: string; request_digest: string; raw_sha256: string; raw_storage_key: string; raw_size_bytes: number;
  usage: LlmUsageV1; settled_micro_usd: number; result: MassLabelingResultV1;
}) {
  const client = await args.database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('mfp-labeling:'||$1,0))", [args.workspace_id]);
    const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, ...args, lock_authority: true });
    if (!caps.can_request_processing || !caps.can_edit_topics
      || !await signalWorkspaceFeatureEnabledV1({ queryable: client, workspace_id: args.workspace_id, feature: "mass_labeling" })) fail("mass_labeling_forbidden");
    const run = (await client.query<LabelingRunV1 & { map_id: string }>(`SELECT run.*,labeler.identity,labeler.labeler_digest,context.context,mass.map_id
      FROM signal_labeling_runs run JOIN signal_labeler_versions labeler ON labeler.id=run.labeler_version_id
      JOIN signal_entity_context_versions context ON context.workspace_id=run.workspace_id AND context.version_no=run.entity_context_version_no
      JOIN signal_mass_labeling_runs mass ON mass.run_id=run.id AND mass.workspace_id=run.workspace_id
      WHERE run.id=$1 AND run.workspace_id=$2 AND run.actor_user_id=$3 FOR UPDATE OF run`,
      [args.run_id, args.workspace_id, args.actor_user_id])).rows[0];
    if (!run || run.kind !== "mass_labeling" || run.identity.params.request_version !== "mass-labeling-jev-v2") fail("mass_labeling_jev_recovery_unavailable");
    const call = (await client.query<LabelingCallV1<MassLabelingInputV1>>(`SELECT * FROM signal_labeling_calls
      WHERE id=$1 AND run_id=$2 AND workspace_id=$3 FOR UPDATE`, [args.call_id, args.run_id, args.workspace_id])).rows[0];
    if (!call || call.request_digest !== args.request_digest) fail("mass_labeling_jev_recovery_conflict");
    const prior = (await client.query<{ raw_sha256: string; raw_storage_key: string; raw_size_bytes: string;
      usage: LlmUsageV1; settled_micro_usd: string; recovered_result: MassLabelingResultV1 }>(`SELECT * FROM signal_mass_labeling_jev_receipt_recoveries
      WHERE call_id=$1 AND workspace_id=$2 AND run_id=$3`, [args.call_id, args.workspace_id, args.run_id])).rows[0];
    if (prior) {
      if (prior.raw_sha256 !== args.raw_sha256 || prior.raw_storage_key !== args.raw_storage_key
        || Number(prior.raw_size_bytes) !== args.raw_size_bytes || digest(prior.usage) !== digest(args.usage)
        || Number(prior.settled_micro_usd) !== args.settled_micro_usd || digest(prior.recovered_result) !== digest(args.result)) fail("mass_labeling_jev_recovery_conflict");
      const intact = await client.query(`SELECT 1 FROM signal_labeling_calls receipt
        JOIN signal_mass_labeling_results outcome ON outcome.call_id=receipt.id AND outcome.workspace_id=receipt.workspace_id
        WHERE receipt.id=$1 AND receipt.run_id=$2 AND receipt.status='settled' AND receipt.raw_sha256=$3
          AND receipt.raw_storage_key=$4 AND receipt.raw_size_bytes=$5 AND receipt.raw_storage_verified_at IS NOT NULL
          AND receipt.raw_storage_verified_key=receipt.raw_storage_key AND receipt.usage=$6::jsonb
          AND receipt.settled_micro_usd=$7 AND receipt.results_applied AND receipt.results=jsonb_build_array($8::jsonb)
          AND outcome.status=$9 AND outcome.probabilities=$10::jsonb AND outcome.error_code IS NULL`,
        [call.id, run.id, args.raw_sha256, args.raw_storage_key, args.raw_size_bytes, JSON.stringify(args.usage),
          args.settled_micro_usd, JSON.stringify(args.result), args.result.status, JSON.stringify(args.result.probabilities)]);
      if (intact.rows.length !== 1) fail("mass_labeling_jev_recovery_conflict");
      await client.query("COMMIT"); return { recovered: true, replayed: true };
    }
    if (run.status !== "failed" || run.error_code !== "labeling_outcome_unknown") fail("mass_labeling_jev_recovery_unavailable");
    await mapCurrent(client, args.workspace_id, run.map_id);
    const policy = await loadMassLabelingStudyPolicyWithClientV1(client, args.workspace_id);
    if (digest(massLabelingConfigurationV2({ category: policy.category, candidate_language: policy.candidate_language,
      interests: policy.interests.filter(interest => interest.active) })) !== digest(massLabelingConfigurationV2(run.identity.params))) fail("mass_labeling_study_configuration_changed");
    const result = (await client.query(`SELECT to_jsonb(outcome) snapshot FROM signal_mass_labeling_results outcome WHERE workspace_id=$1 AND map_id=$2 AND root_id=$3 FOR UPDATE`,
      [args.workspace_id, run.map_id, args.result.root_id])).rows[0]?.snapshot;
    if (!result || result.call_id !== call.id || result.status !== "error" || call.status !== "unknown"
      || !call.results_applied || call.inputs.length !== 1 || call.inputs[0]?.root_id !== args.result.root_id
      || args.result.input_digest !== call.inputs[0].input_digest || args.result.entity_context_digest !== run.entity_context_digest
      || !["labeled", "abstained"].includes(args.result.status)) fail("mass_labeling_jev_recovery_conflict");
    await client.query(`INSERT INTO signal_mass_labeling_jev_receipt_recoveries(call_id,workspace_id,run_id,map_id,root_id,
      request_digest,raw_sha256,raw_storage_key,raw_size_bytes,original_call,original_result,recovered_result,usage,settled_micro_usd,recovered_by_user_id)
      SELECT receipt.id,$2,$3,$4,$5,$6,$7,$8,$9,to_jsonb(receipt),$10::jsonb,$11::jsonb,$12::jsonb,$13,$14
      FROM signal_labeling_calls receipt WHERE receipt.id=$1`, [call.id, args.workspace_id, run.id, run.map_id,
      args.result.root_id, args.request_digest, args.raw_sha256, args.raw_storage_key, args.raw_size_bytes,
      JSON.stringify(result), JSON.stringify(args.result), JSON.stringify(args.usage), args.settled_micro_usd, args.actor_user_id]);
    await client.query(`UPDATE signal_labeling_calls SET status='settled',raw_sha256=$4,raw_storage_key=$5,raw_size_bytes=$6,
      raw_storage_verified_at=now(),raw_storage_verified_key=$5,usage=$7::jsonb,settled_micro_usd=$8,stop_reason='completed',
      results=jsonb_build_array($9::jsonb),results_applied=true,updated_at=now()
      WHERE id=$1 AND run_id=$2 AND workspace_id=$3 AND status='unknown'`, [call.id, run.id, args.workspace_id,
      args.raw_sha256, args.raw_storage_key, args.raw_size_bytes, JSON.stringify(args.usage), args.settled_micro_usd, JSON.stringify(args.result)]);
    await client.query(`UPDATE signal_mass_labeling_results SET status=$4,probabilities=$5::jsonb,error_code=NULL
      WHERE workspace_id=$1 AND map_id=$2 AND root_id=$3 AND call_id=$6 AND status='error'`,
      [args.workspace_id, run.map_id, args.result.root_id, args.result.status, JSON.stringify(args.result.probabilities), call.id]);
    // Reuse the ordinary writer for its consistency checks and both analyst interests.
    await writeMassLabelingResultsV1(client, run, [{ call, results: [args.result] }]);
    await client.query("COMMIT");
    return { recovered: true, replayed: false };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
