import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { buildSignalWorkspaceInterpretationBatchV1, signalWorkspaceInterpretationReferenceIdV1,
  SIGNAL_WORKSPACE_MASS_LABELING_INTERPRETATION_CONFIGURATION_V1 as configuration } from "@noisia/query-engine";
import * as engine from "../signal-workspace-engine";
import * as money from "../signal-workspace-engine-interpretation";
import { insertSignalTaxonomyDraftCoreV1 } from "../signal-taxonomy-profile";
import { materializeSignalWorkspaceEngineTopicsV1 } from "../signal-topic-catalog";

/** Synthetic persisted receipts exercise the exact money and materialization
 * entrypoints. The caller rolls back all rows and no provider is contacted. */
export async function assertMassLabelingProfileLocaleV1(args: {
  database: engine.SignalWorkspaceEngineDatabaseV1; workspace_id: string; actor_user_id: string;
  numeric_lease: engine.SignalWorkspaceEngineLeaseV1;
}) {
  const { database, workspace_id, actor_user_id } = args;
  const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
  await engine.failSignalWorkspaceEngineV1({ database, lease: args.numeric_lease, error_code: "workspace_engine_process_failed" });
  const client = await database.connect();
  try {
    await insertSignalTaxonomyDraftCoreV1({ client, workspace_id, kind: "topic", context_hash: sha("empty pilot catalog"),
      terms: [], rules: {}, rule_set_metadata: {}, provider: "operator", model_version: "synthetic",
      prompt_hash: sha("synthetic"), model_metadata: {}, profile_metadata: { contract_version: "signal-topic-catalog-v1" }, context_refs: [] });
  } finally { client.release(); }
  const access = { database, workspace_id, actor_user_id };
  const started = await engine.beginSignalWorkspaceMassLabelingEngineV1({ ...access, idempotency_key: randomUUID(),
    claude_cap_micro_usd: 2_000_000, interpretation_config: { call_configuration: configuration,
      budget_timezone: "UTC", daily_cap_micro_usd: 2_000_000 } });
  const lease = await engine.claimSignalWorkspaceEngineV1({ database, execution_id: started.execution_id,
    worker_job_id: `workspace-engine-${started.execution_id}-1` });
  assert.ok(lease);
  const execution_id = lease.execution_id;
  const coverage = { roots: lease.snapshot.expected_roots, chunks: lease.snapshot.expected_chunks, guides: lease.snapshot.expected_guides };
  await engine.heartbeatSignalWorkspaceEngineV1({ database, lease, phase: "fitting", exported: { ...coverage, stream_digest: sha("synthetic full export") } });
  const artifact = (artifact_key: string, artifact_type: engine.SignalWorkspaceEngineArtifactV1["artifact_type"],
    content: string, metadata: Record<string, unknown> = {}): engine.SignalWorkspaceEngineArtifactV1 => ({
      artifact_key, artifact_type, title: "Synthetic pilot locale acceptance",
      storage_key: `workspace-engine/${workspace_id}/${execution_id}/${artifact_key}`, sha256: sha(content),
      size_bytes: Buffer.byteLength(content), media_type: "application/json", metadata });
  const model = await engine.persistSignalWorkspaceEngineArtifactV1({ database, lease, artifact: artifact("model.json", "engine_model", "{}") });
  const output = await engine.persistSignalWorkspaceEngineArtifactV1({ database, lease, artifact: artifact("manifest.json", "engine_output", "{}") });
  const key = "guided:synthetic-locale", units = { unit_count: 1, unit_digest: sha(JSON.stringify(key) + "\n") };
  await engine.checkpointSignalWorkspaceEngineFitV1({ database, lease, model_artifact_id: model.artifact_id,
    output_artifact_id: output.artifact_id, result_kind: "computational_grouping", coverage,
    model_configuration: lease.snapshot.engine_config, runtime_kind: "python", artifact_format: "workspace-model-bundle-v1",
    license_key: null, interpretation_manifest: units });
  // A fresh explicitly admitted execution already owns its sealed cap/config.
  // The separate authorization action renews eligible failed executions only.
  const governed = await engine.readSignalWorkspaceEngineInterpretationContextV1({ database, lease });
  const chunk = (await engine.readSignalWorkspaceEngineChunksV1({ database, lease, after: null, limit: 1 })).items[0]!;
  const ref = { root_id: chunk.root_id, chunk_index: chunk.chunk_index, start: chunk.start, end: chunk.end, chunk_sha256: chunk.chunk_sha256 };
  const ref_id = signalWorkspaceInterpretationReferenceIdV1(ref);
  const cluster = { cluster_id: key, lane: "guided" as const, cluster_digest: sha("synthetic-locale-cluster"),
    root_count: 1, chunk_count: 1, terms: ["cerveja"], representatives: [{ ...ref, ref_id, text: chunk.text,
      strength: 0.8, selection_reason: "high_affiliation" as const }] };
  const batch = buildSignalWorkspaceInterpretationBatchV1(governed.context, [cluster], configuration);
  const call = await money.reserveSignalWorkspaceEngineInterpretationV1({ ...access, execution_id, idempotency_key: randomUUID(),
    request_digest: batch.request_digest, configuration, reserved_micro_usd: batch.reserved_micro_usd,
    budget_timezone: "UTC", daily_cap_micro_usd: 2_000_000, execution_token: lease.execution_token });
  const token = { database, call_id: call.call_id, attempt_token: call.attempt_token };
  await money.markSignalWorkspaceEngineInterpretationSentV1({ ...token, execution_token: lease.execution_token });
  await money.persistSignalWorkspaceEngineInterpretationResponseV1({ ...token, response: {
    storage_key: `workspace-engine/${workspace_id}/${execution_id}/synthetic-receipt.json`, sha256: sha("synthetic receipt"),
    size_bytes: Buffer.byteLength("synthetic receipt"), http_status: 200, provider_request_id: null } });
  await money.settleSignalWorkspaceEngineInterpretationV1({ ...token, usage: { input_tokens: 100, output_tokens: 50,
    cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  const body = JSON.stringify({ contract_version: "workspace-engine-interpretation-result-v1", execution_id,
    context: batch.context, clusters: batch.clusters, interpretations: [{ cluster_id: key, cluster_digest: cluster.cluster_digest,
      status: "coherent", name: "Conversas sobre cerveja", definition: "Experiências sintéticas sobre cerveja.",
      inclusion: [], exclusion: [], citations: [ref_id] }] });
  const checkpoint = await engine.checkpointSignalWorkspaceEngineInterpretationV1({ database, lease, call_id: call.call_id,
    unit_keys: [key], artifact: artifact("synthetic-interpretation.json", "engine_proposals", body) });
  const result = await materializeSignalWorkspaceEngineTopicsV1({ database, lease, proposals: (async function* () {
    yield { artifact_id: checkpoint.artifact_id, body };
  })() });
  const profile = (await database.query("SELECT metadata FROM signal_taxonomy_profiles WHERE id=$1", [result.output_catalog_profile_id])).rows[0]!;
  assert.equal(profile.metadata.locale.primary_locale, "pt-BR");
  assert.deepEqual(profile.metadata.locale.languages, ["pt-BR"]);
  assert.equal((await database.query("SELECT count(*)::int n FROM signal_semantic_context_generations WHERE workspace_id=$1", [workspace_id])).rows[0].n, 0);
}
