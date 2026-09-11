import {
  adoptSignalTopicCandidateStoreV1,
  correctSignalTopicMembershipStoreV1,
  createSignalTopicCatalogExecutionStoreV1,
  createSignalTopicStoreV1,
  loadLegacySignalTopicDiscoveryCandidatesStoreV1,
  loadSignalTopicCatalogStoreV1,
  loadSignalTopicEvaluationV2CandidateManagement,
  loadSignalTopicExecutionResultsStoreV1,
  loadSignalWorkspaceCapabilitiesStoreV1,
  isSignalWorkspaceTopicSearchModeV1,
  type SignalWorkspaceCapabilitiesV1,
  setSignalTopicLifecycleStoreV1,
  updateSignalTopicStoreV1
} from "@noisia/db";
import {
  adoptSignalTopicCandidateInputSchemaV1,
  createSignalTopicInputSchemaV1,
  signalTopicCorrectionSchemaV1,
  signalTopicPublicOriginV1,
  updateSignalTopicInputSchemaV1
} from "@noisia/query-engine";

import type { ResolvedSignalWorkspace, SignalWorkspaceUser } from "./signal-workspace";

async function requireTopicCapability(workspaceId: string, actor: SignalWorkspaceUser,
  capability: keyof SignalWorkspaceCapabilitiesV1) {
  const { pool } = await import("@/lib/db");
  const capabilities = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: pool,
    workspace_id: workspaceId, actor_user_id: actor.id });
  if (!capabilities[capability]) throw Object.assign(new Error("topic_catalog_forbidden"), {
    code: "topic_catalog_forbidden", status: 403
  });
  return capabilities;
}

export type SignalTopicsManagementProductV1 = Awaited<ReturnType<typeof loadSignalTopicsManagementProductV1>>;

export async function loadSignalTopicCandidatesForAccessV1(args: {
  canAdopt: boolean;
  loadCurrent: () => ReturnType<typeof loadSignalTopicEvaluationV2CandidateManagement>;
  loadLegacy: () => ReturnType<typeof loadLegacySignalTopicDiscoveryCandidatesStoreV1>;
}) {
  // Historical candidate examples can contain excerpts. Do not read or project them through
  // the client catalogue until their reader has the same current-rights policy as client evidence.
  if (!args.canAdopt) return { current: null, legacy: { run_key: null, items: [] } };
  const [current, legacy] = await Promise.all([args.loadCurrent(), args.loadLegacy()]);
  return { current, legacy };
}

export async function loadSignalTopicsManagementProductV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
}) {
  const capabilities = await requireTopicCapability(args.workspace.id, args.actor, "can_view");
  const { pool } = await import("@/lib/db");
  const [catalog, candidates] = await Promise.all([
    loadSignalTopicCatalogStoreV1({ queryable: pool, workspace_id: args.workspace.id }),
    loadSignalTopicCandidatesForAccessV1({ canAdopt: capabilities.can_adopt_topics,
      loadCurrent: () => loadSignalTopicEvaluationV2CandidateManagement({ queryable: pool,
        workspace_id: args.workspace.id, actor: { id: args.actor.id, user_type: "noisia_internal" }, limit: 50 }),
      loadLegacy: () => loadLegacySignalTopicDiscoveryCandidatesStoreV1({ queryable: pool,
        workspace_id: args.workspace.id }) })
  ]);
  const { current: currentDiscovered, legacy: legacyDiscovered } = candidates;
  const useCurrent = Boolean(currentDiscovered?.items.length);
  const discovered = useCurrent && currentDiscovered ? currentDiscovered : legacyDiscovered;
  const used = new Set(catalog.topics.map((topic) => topic.source
    ? `${topic.source.run_key}:${topic.source.candidate_key}` : ""));
  return {
    ...catalog,
    topics: catalog.topics.map((topic) => ({ ...topic,
      origin: signalTopicPublicOriginV1(topic.origin, topic.source) })),
    capabilities: { can_view: capabilities.can_view,
      can_edit: capabilities.can_edit_topics,
      can_execute: capabilities.can_execute_topics,
      can_adopt: capabilities.can_adopt_topics,
      can_request_processing: capabilities.can_request_processing },
    workspace: { id: args.workspace.id, slug: args.workspace.slug, name: args.workspace.name,
      timezone: args.workspace.timezone, operational_corpus: args.workspace.corpora.find((item) => item.role === "operational") ?? null },
    discovered: { ...discovered, available: capabilities.can_adopt_topics,
      items: discovered.items.map((item) => ({ ...item,
        inclusion: stringArray(item.inclusion), exclusion: stringArray(item.exclusion),
        origin: useCurrent ? "evidence_candidate" as const : "historical_taxonomy" as const,
        scope: "scope" in item ? item.scope : null,
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
  await requireTopicCapability(args.workspace.id, args.actor, "can_edit_topics");
  const actorId = args.actor.id;
  const { pool } = await import("@/lib/db");
  return createSignalTopicStoreV1({ pool, workspace_id: args.workspace.id, actor_user_id: actorId,
    idempotency_key: args.idempotencyKey, input: createSignalTopicInputSchemaV1.parse(args.input) });
}

export async function adoptSignalTopicProductV1(args: {
  workspace: ResolvedSignalWorkspace; actor: SignalWorkspaceUser; idempotencyKey: string; input: unknown;
}) {
  await requireTopicCapability(args.workspace.id, args.actor, "can_adopt_topics");
  const actorId = args.actor.id;
  const { pool } = await import("@/lib/db");
  return adoptSignalTopicCandidateStoreV1({ pool, workspace_id: args.workspace.id, actor_user_id: actorId,
    idempotency_key: args.idempotencyKey, input: adoptSignalTopicCandidateInputSchemaV1.parse(args.input) });
}

export async function updateSignalTopicProductV1(args: {
  workspace: ResolvedSignalWorkspace; actor: SignalWorkspaceUser; idempotencyKey: string;
  termKey: string; input: unknown;
}) {
  await requireTopicCapability(args.workspace.id, args.actor, "can_edit_topics");
  const actorId = args.actor.id;
  const { pool } = await import("@/lib/db");
  return updateSignalTopicStoreV1({ pool, workspace_id: args.workspace.id, actor_user_id: actorId,
    idempotency_key: args.idempotencyKey, term_key: args.termKey,
    input: updateSignalTopicInputSchemaV1.parse(args.input) });
}

export async function setSignalTopicLifecycleProductV1(args: {
  workspace: ResolvedSignalWorkspace; actor: SignalWorkspaceUser; idempotencyKey: string;
  termKey: string; lifecycle: "draft" | "archived";
  expectedDefinitionRevision: number; expectedDefinitionDigest: string;
}) {
  await requireTopicCapability(args.workspace.id, args.actor, "can_edit_topics");
  const actorId = args.actor.id;
  const { pool } = await import("@/lib/db");
  return setSignalTopicLifecycleStoreV1({ pool, workspace_id: args.workspace.id, actor_user_id: actorId,
    idempotency_key: args.idempotencyKey, term_key: args.termKey, lifecycle: args.lifecycle,
    expected_definition_revision: args.expectedDefinitionRevision,
    expected_definition_digest: args.expectedDefinitionDigest });
}

export async function startSignalTopicCatalogExecutionProductV1(args: {
  workspace: ResolvedSignalWorkspace; actor: SignalWorkspaceUser; idempotencyKey: string;
  intent: "search" | "publish"; publishWhenReady?: boolean; embeddingCostCapMicroUsd?: number;
}) {
  await requireTopicCapability(args.workspace.id, args.actor, "can_execute_topics");
  const actorId = args.actor.id;
  const { pool } = await import("@/lib/db");
  if (await isSignalWorkspaceTopicSearchModeV1(pool, args.workspace.id)) throw Object.assign(new Error("workspace_topic_computation_required"), {
    code: "workspace_topic_computation_required", status: 409
  });
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
  await requireTopicCapability(args.workspace.id, args.actor, "can_execute_topics");
  const actorId = args.actor.id;
  const parsed = signalTopicCorrectionSchemaV1.parse(args.input);
  const { pool } = await import("@/lib/db");
  if (await isSignalWorkspaceTopicSearchModeV1(pool, args.workspace.id)) throw Object.assign(new Error("workspace_topic_approval_unavailable"), {
    code: "workspace_topic_approval_unavailable", status: 409
  });
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
  await requireTopicCapability(args.workspace.id, args.actor, "can_execute_topics");
  const { pool } = await import("@/lib/db");
  return loadSignalTopicExecutionResultsStoreV1({ queryable: pool, workspace_id: args.workspace.id,
    execution_id: args.executionId, term_key: args.termKey, state: args.state, limit: args.limit });
}
