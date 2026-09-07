import {
  adoptSignalTopicCandidateStoreV1,
  correctSignalTopicMembershipStoreV1,
  createSignalTopicCatalogExecutionStoreV1,
  createSignalTopicStoreV1,
  loadLegacySignalTopicDiscoveryCandidatesStoreV1,
  loadSignalTopicCatalogStoreV1,
  loadSignalTopicEvaluationV2CandidateManagement,
  loadSignalTopicExecutionResultsStoreV1,
  setSignalTopicLifecycleStoreV1,
  updateSignalTopicStoreV1
} from "@noisia/db";
import {
  adoptSignalTopicCandidateInputSchemaV1,
  createSignalTopicInputSchemaV1,
  signalTopicCorrectionSchemaV1,
  updateSignalTopicInputSchemaV1
} from "@noisia/query-engine";

import type { ResolvedSignalWorkspace, SignalWorkspaceUser } from "./signal-workspace";

function requireInternalActor(value: SignalWorkspaceUser) {
  if (value.userType !== "noisia_internal") throw Object.assign(new Error("topic_catalog_forbidden"), {
    code: "topic_catalog_forbidden", status: 403
  });
  return value.id;
}

export async function loadSignalTopicsManagementProductV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
}) {
  const actorId = requireInternalActor(args.actor);
  const { pool } = await import("@/lib/db");
  const [catalog, currentDiscovered, legacyDiscovered] = await Promise.all([
    loadSignalTopicCatalogStoreV1({ queryable: pool, workspace_id: args.workspace.id }),
    loadSignalTopicEvaluationV2CandidateManagement({ queryable: pool, workspace_id: args.workspace.id,
      actor: { id: actorId, user_type: "noisia_internal" }, limit: 50 }),
    loadLegacySignalTopicDiscoveryCandidatesStoreV1({ queryable: pool, workspace_id: args.workspace.id })
  ]);
  const useCurrent = currentDiscovered.items.length > 0;
  const discovered = useCurrent ? currentDiscovered : legacyDiscovered;
  const used = new Set(catalog.topics.map((topic) => topic.source
    ? `${topic.source.run_key}:${topic.source.candidate_key}` : ""));
  return {
    ...catalog,
    workspace: { id: args.workspace.id, slug: args.workspace.slug, name: args.workspace.name,
      timezone: args.workspace.timezone, operational_corpus: args.workspace.corpora.find((item) => item.role === "operational") ?? null },
    discovered: { ...discovered, items: discovered.items.map((item) => ({ ...item,
      inclusion: stringArray(item.inclusion), exclusion: stringArray(item.exclusion),
      evidence_source: useCurrent ? "v2" as const : "legacy" as const,
      used_as_topic: used.has(`${discovered.run_key}:${item.candidate_key}`) })) }
  };
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function createSignalTopicProductV1(args: {
  workspace: ResolvedSignalWorkspace; actor: SignalWorkspaceUser; idempotencyKey: string; input: unknown;
}) {
  const actorId = requireInternalActor(args.actor);
  const { pool } = await import("@/lib/db");
  return createSignalTopicStoreV1({ pool, workspace_id: args.workspace.id, actor_user_id: actorId,
    idempotency_key: args.idempotencyKey, input: createSignalTopicInputSchemaV1.parse(args.input) });
}

export async function adoptSignalTopicProductV1(args: {
  workspace: ResolvedSignalWorkspace; actor: SignalWorkspaceUser; idempotencyKey: string; input: unknown;
}) {
  const actorId = requireInternalActor(args.actor);
  const { pool } = await import("@/lib/db");
  return adoptSignalTopicCandidateStoreV1({ pool, workspace_id: args.workspace.id, actor_user_id: actorId,
    idempotency_key: args.idempotencyKey, input: adoptSignalTopicCandidateInputSchemaV1.parse(args.input) });
}

export async function updateSignalTopicProductV1(args: {
  workspace: ResolvedSignalWorkspace; actor: SignalWorkspaceUser; idempotencyKey: string;
  termKey: string; input: unknown; embeddingCostCapMicroUsd?: number;
}) {
  const actorId = requireInternalActor(args.actor);
  const { pool } = await import("@/lib/db");
  const updated = await updateSignalTopicStoreV1({ pool, workspace_id: args.workspace.id, actor_user_id: actorId,
    idempotency_key: args.idempotencyKey, term_key: args.termKey,
    input: updateSignalTopicInputSchemaV1.parse(args.input) });
  if (updated.semantic_changed) {
    if (!updated.prior_had_ready_search) return updated;
    const execution = await startSignalTopicCatalogExecutionProductV1({
      workspace: args.workspace,
      actor: args.actor,
      idempotencyKey: `${args.idempotencyKey}:semantic-replace`,
      intent: "search",
      publishWhenReady: updated.prior_profile_status === "active",
      embeddingCostCapMicroUsd: args.embeddingCostCapMicroUsd
    });
    return { ...updated, replacement_execution: execution };
  }
  if (updated.prior_profile_status !== "active") return updated;
  const execution = await startSignalTopicCatalogExecutionProductV1({
    workspace: args.workspace,
    actor: args.actor,
    idempotencyKey: `${args.idempotencyKey}:replace`,
    intent: "publish"
  });
  return { ...updated, replacement_execution: execution };
}

export async function setSignalTopicLifecycleProductV1(args: {
  workspace: ResolvedSignalWorkspace; actor: SignalWorkspaceUser; idempotencyKey: string;
  termKey: string; lifecycle: "draft" | "archived";
}) {
  const actorId = requireInternalActor(args.actor);
  const { pool } = await import("@/lib/db");
  const updated = await setSignalTopicLifecycleStoreV1({ pool, workspace_id: args.workspace.id, actor_user_id: actorId,
    idempotency_key: args.idempotencyKey, term_key: args.termKey, lifecycle: args.lifecycle });
  const wasPublished = updated.prior_profile_status === "active"
    || (updated.active_profile_id !== null && updated.profile?.id !== updated.active_profile_id);
  if (!wasPublished || args.lifecycle !== "archived") return updated;
  const execution = await startSignalTopicCatalogExecutionProductV1({
    workspace: args.workspace,
    actor: args.actor,
    idempotencyKey: `${args.idempotencyKey}:archive-replace`,
    intent: "search",
    publishWhenReady: true
  });
  return { ...updated, replacement_execution: execution };
}

export async function startSignalTopicCatalogExecutionProductV1(args: {
  workspace: ResolvedSignalWorkspace; actor: SignalWorkspaceUser; idempotencyKey: string;
  intent: "search" | "publish"; publishWhenReady?: boolean; embeddingCostCapMicroUsd?: number;
}) {
  const actorId = requireInternalActor(args.actor);
  const { pool } = await import("@/lib/db");
  const execution = await createSignalTopicCatalogExecutionStoreV1({ pool,
    workspace_id: args.workspace.id, actor_user_id: actorId,
    intent: args.intent, idempotency_key: args.idempotencyKey,
    publish_when_ready: args.publishWhenReady,
    embedding_cost_cap_micro_usd: args.embeddingCostCapMicroUsd });
  return execution;
}

export async function correctSignalTopicMembershipProductV1(args: {
  workspace: ResolvedSignalWorkspace; actor: SignalWorkspaceUser; idempotencyKey: string;
  executionId: string; termKey: string; rootId: string; input: unknown;
}) {
  const actorId = requireInternalActor(args.actor);
  const parsed = signalTopicCorrectionSchemaV1.parse(args.input);
  const { pool } = await import("@/lib/db");
  const corrected = await correctSignalTopicMembershipStoreV1({ pool, workspace_id: args.workspace.id,
    actor_user_id: actorId, execution_id: args.executionId, term_key: args.termKey,
    canonical_root_id: args.rootId, disposition: parsed.disposition,
    expected_definition_revision: parsed.expected_definition_revision,
    idempotency_key: args.idempotencyKey });
  if (!corrected.profile_was_active) return corrected;
  const execution = await startSignalTopicCatalogExecutionProductV1({
    workspace: args.workspace,
    actor: args.actor,
    idempotencyKey: `${args.idempotencyKey}:correction-replace`,
    intent: "search",
    publishWhenReady: true
  });
  return { ...corrected, replacement_execution: execution };
}

export async function loadSignalTopicExecutionResultsProductV1(args: {
  workspace: ResolvedSignalWorkspace; actor: SignalWorkspaceUser; executionId: string;
  termKey?: string | null; state?: "relevant" | "doubt" | "excluded" | null; limit?: number;
}) {
  requireInternalActor(args.actor);
  const { pool } = await import("@/lib/db");
  return loadSignalTopicExecutionResultsStoreV1({ queryable: pool, workspace_id: args.workspace.id,
    execution_id: args.executionId, term_key: args.termKey, state: args.state, limit: args.limit });
}
