import { createHash } from "node:crypto";
import {
  reconcileMassLabelingJevReceiptV1, type LabelingRunV1, type LabelingCallV1,
  type createMassLabelingStoreV1,
} from "@noisia/db";
import {
  massLabelingConfigurationV2, massLabelingJevIdentityV2, labelerDigestV1,
  buildMassLabelingJevRequestV2, mapMassLabelingJevResponseV2,
  llmPriceV1, llmCostMicroUsdV1, signalWorkspaceEmbeddingDigestV1 as digest,
  type MassLabelingInputV1,
} from "@noisia/query-engine";
import { validateJevResponseV1, type JevRawResponseV1 } from "../providers/typesafe-jev";
import { jevUsageV1 } from "./signal-jev-labeling-page";
import { createWorkspaceEngineStorageV1, type WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";

/** Recovers only bytes previously returned for this exact frozen call. This
 * function has no provider, input selection, reservation or retry transport. */
export async function recoverMassLabelingJevReceiptsV1(args: {
  database: Parameters<typeof createMassLabelingStoreV1>[0]["database"];
  run_id: string; storage?: WorkspaceEngineStorageV1;
}) {
  const run = (await args.database.query<LabelingRunV1>(`SELECT run.*,labeler.identity,labeler.labeler_digest,context.context
    FROM signal_labeling_runs run JOIN signal_labeler_versions labeler ON labeler.id=run.labeler_version_id
    JOIN signal_entity_context_versions context ON context.workspace_id=run.workspace_id AND context.version_no=run.entity_context_version_no
    WHERE run.id=$1 AND run.kind='mass_labeling' AND run.status='failed' AND run.error_code='labeling_outcome_unknown'
      AND (run.lease_until IS NULL OR run.lease_until<now())`, [args.run_id])).rows[0];
  if (!run || run.identity.params.request_version !== "mass-labeling-jev-v2") return { recovered: 0 };
  const configuration = massLabelingConfigurationV2(run.identity.params);
  if (labelerDigestV1(run.identity) !== labelerDigestV1(massLabelingJevIdentityV2(configuration))) throw new Error("mass_labeling_identity_invalid");
  const calls = (await args.database.query<LabelingCallV1<MassLabelingInputV1>>(`SELECT * FROM signal_labeling_calls
    WHERE run_id=$1 AND workspace_id=$2 AND status='unknown' AND results_applied ORDER BY created_at,id LIMIT 200`,
    [run.id, run.workspace_id])).rows;
  if (!calls.length) return { recovered: 0 };
  const storage = args.storage ?? createWorkspaceEngineStorageV1();
  if (!storage.recoverIncomplete) throw new Error("mass_labeling_jev_recovery_storage_unavailable");
  let recovered = 0;
  for (const call of calls) {
    if (call.inputs.length !== 1) throw new Error("mass_labeling_input_invalid");
    const input = call.inputs[0]!;
    const request = buildMassLabelingJevRequestV2(input, run.context, configuration, run.identity.model);
    const requestDigest = digest({ request_version: run.identity.params.request_version, run_id: run.id,
      root_id: input.root_id, input_digest: input.input_digest, map_digest: input.map_digest,
      entity_context_digest: run.entity_context_digest, labeler_digest: run.labeler_digest, request });
    if (requestDigest !== call.request_digest || digest(call.request) !== digest(request)
      || call.custom_id !== `mass_${requestDigest.slice(7, 67)}`) throw new Error("mass_labeling_jev_recovery_request_invalid");
    const stored = await storage.recoverIncomplete({ workspace_id: run.workspace_id, execution_id: run.id,
      name: `response-${call.id}.json`, max_bytes: 8 * 1024 * 1024 });
    if (!stored) continue;
    if (Buffer.byteLength(stored.raw_text) !== stored.size_bytes
      || `sha256:${createHash("sha256").update(stored.raw_text).digest("hex")}` !== stored.sha256) throw new Error("mass_labeling_jev_recovery_raw_invalid");
    const parsed = validateJevResponseV1(request, JSON.parse(stored.raw_text) as JevRawResponseV1);
    const result = mapMassLabelingJevResponseV2(input, run.context, configuration, parsed);
    const usage = jevUsageV1(parsed.usage);
    await reconcileMassLabelingJevReceiptV1({ database: args.database, run_id: run.id, workspace_id: run.workspace_id,
      actor_user_id: run.actor_user_id, call_id: call.id, request_digest: call.request_digest,
      raw_sha256: stored.sha256, raw_storage_key: stored.storage_key, raw_size_bytes: stored.size_bytes,
      usage, settled_micro_usd: llmCostMicroUsdV1(usage, llmPriceV1("typesafe", run.identity.model, "sync", Number(run.identity.params.input_usd_per_mtok))), result });
    recovered++;
  }
  return { recovered };
}
