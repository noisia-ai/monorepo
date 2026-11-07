import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { signalWorkspaceMassLabelingConfigV1, SIGNAL_WORKSPACE_ENGINE_CONFIG_V1 } from "./signal-workspace-engine-v1";
import { parseSignalWorkspaceInterpretationClusterV1, buildSignalWorkspaceInterpretationBatchV1,
  SIGNAL_WORKSPACE_MASS_LABELING_INTERPRETATION_CONFIGURATION_V1 as pilot,
  signalWorkspaceInterpretationReferenceIdV1 } from "./signal-workspace-interpretation-v1";

const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
test("mass-labeling profile scales on canonical roots and keeps historical identity", () => {
  assert.equal(signalWorkspaceMassLabelingConfigV1(83962).hdbscan_min_cluster_size, 84);
  assert.equal(signalWorkspaceMassLabelingConfigV1(1).hdbscan_min_cluster_size, 40);
  assert.equal(signalWorkspaceMassLabelingConfigV1(1_000_001).hdbscan_min_cluster_size, 1001);
  assert.equal(signalWorkspaceMassLabelingConfigV1(83962).maximum_topics, 200);
  assert.equal(signalWorkspaceMassLabelingConfigV1(83962).output_locale, "pt-BR");
  assert.equal(signalWorkspaceMassLabelingConfigV1(83962).cluster_selection_method, "eom");
  assert.equal(SIGNAL_WORKSPACE_ENGINE_CONFIG_V1.cluster_selection_method, "leaf");
  assert.throws(() => signalWorkspaceMassLabelingConfigV1(-1));
});

test("only the sealed pilot interpretation profile accepts thirty distinct roots", () => {
  const representatives = Array.from({ length: 30 }, (_, index) => {
    const text = `Conversa sintética ${index}`;
    const identity = { root_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      chunk_index: 0, start: 0, end: text.length, chunk_sha256: sha(text) };
    return { ...identity, ref_id: signalWorkspaceInterpretationReferenceIdV1(identity), text,
      strength: 0.9, selection_reason: "high_affiliation" as const };
  });
  const group = { cluster_id: "guided:synthetic", lane: "guided" as const, cluster_digest: sha("group"),
    root_count: 100, chunk_count: 100, terms: ["cerveja"], representatives };
  assert.throws(() => parseSignalWorkspaceInterpretationClusterV1(group), /cluster_invalid/u);
  const context = { workspace_id: representatives[0]!.root_id, execution_id: representatives[1]!.root_id,
    context_digest: sha("context"), data: {} };
  assert.equal(buildSignalWorkspaceInterpretationBatchV1(context, [group], pilot).clusters[0]!.representatives.length, 30);
  assert.throws(() => buildSignalWorkspaceInterpretationBatchV1(context, [group]), /cluster_invalid/u);
});

test("root-density pilot has a new sealed identity while historical v1 remains readable",async()=>{
  const {signalWorkspaceMassLabelingConfigV2,isSignalWorkspaceMassLabelingConfigV1,
    signalWorkspaceEmbeddingDigestV1}=await import("./index");
  const old=signalWorkspaceMassLabelingConfigV1(83962),current=signalWorkspaceMassLabelingConfigV2(83962);
  assert.equal(current.profile_version,"workspace-bertopic-mass-labeling-v2");
  assert.equal(current.fit_unit,"canonical-root-centroid-v1");assert.equal(current.hdbscan_min_cluster_size,84);
  assert.notEqual(signalWorkspaceEmbeddingDigestV1(old),signalWorkspaceEmbeddingDigestV1(current));
  assert.ok(isSignalWorkspaceMassLabelingConfigV1(old));assert.ok(isSignalWorkspaceMassLabelingConfigV1(current));
});

test("shared-vocabulary pilot freezes document-frequency units with a distinct identity",async()=>{
 const {signalWorkspaceMassLabelingConfigV2,signalWorkspaceMassLabelingConfigV3,
  signalWorkspaceEmbeddingDigestV1,isSignalWorkspaceMassLabelingConfigV1}=await import("./index");
 const old=signalWorkspaceMassLabelingConfigV2(83962),current=signalWorkspaceMassLabelingConfigV3(83962);
 assert.equal(current.profile_version,"workspace-bertopic-mass-labeling-v3");
 assert.equal(current.vectorizer_min_df_unit,"document-count");
 assert.equal(current.vectorizer_max_df_unit,"document-proportion");
 assert.notEqual(signalWorkspaceEmbeddingDigestV1(old),signalWorkspaceEmbeddingDigestV1(current));
 assert.ok(isSignalWorkspaceMassLabelingConfigV1(old));assert.ok(isSignalWorkspaceMassLabelingConfigV1(current));
});
