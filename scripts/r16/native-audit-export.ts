import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { chmod, mkdir, open, link, lstat, unlink } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import {
  authorizeSignalListeningV1,
  listeningTransactionV1,
  loadSignalListeningConfigurationWithClientV1,
} from "../../infrastructure/db/signal-listening-configuration.js";
import { signalWorkspaceEmbeddingDigestV1 as digest } from "../../packages/query-engine/src/signal-workspace-embeddings-v1.js";
import type { LabelingDatabaseV1 } from "../../infrastructure/db/signal-mention-facets.js";

type ReadClientV1 = { query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[] }>; release(): void };
type ReadPoolV1 = LabelingDatabaseV1 & { connect(): Promise<ReadClientV1>; end(): Promise<void> };
const requireStudio = createRequire(new URL("../../apps/studio/package.json", import.meta.url));
import { validateSignalStudyExecutionConfigurationV1 } from "../../packages/query-engine/src/signal-study-configuration.js";
import { applySignalStudyBoundaryRecodeV1, signalStudyLayerStabilityV1, validateSignalStudyLayerReviewV1,
  type SignalStudyEditorialRequestV1, type SignalStudyLayerDecisionV1 } from "../../packages/query-engine/src/signal-study-editorial.js";
import type { SignalStudySampleV1 } from "../../packages/query-engine/src/signal-study-evidence.js";
import { redactSignalStudyTextV1 } from "../../packages/query-engine/src/signal-study-evidence.js";
import { LISTENING_COHORTS_V1, validateSnapshotV1, type BlindSnapshotV1 } from "./blind-package.js";

const BATCH_SIZE = 512;
const PRIVATE_ROOT = resolve(".data/piloto-masivo/r16");
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

type GenerationRow = {
  id: string; workspace_id: string; configuration_id: string; map_id: string; status: string; kind: string;
  snapshot_digest: string | null; actual_digest: string; source_current: boolean; counts: Record<string, unknown> | null;
  entity_context_digest: string; configuration_digest: string; created_at: Date | string;
};
type TopicRow = { question_key: string; definition: Record<string, unknown>; member_count: number; cohort_no: number };
type ListeningRootRow = { root_id: string; proof: Record<string, unknown>; proof_digest: string; text: string; assigned_keys: string[] };
type StudyExecutionRow = {
  id: string; workspace_id: string; actor_user_id: string; study_id: string; configuration_id: string; status: string;
  output: Record<string, unknown> | null; output_digest: string | null; actual_output_digest: string | null;
  source_current: boolean; owner_current: boolean; envelope: Record<string, unknown>;
  listening_generation_id: string | null; listening_source_digest: string | null; source_roots: number; source_digest: string;
  frozen_source_kind: string; frozen_source_id: string; frozen_base_snapshot_id: string; frozen_configuration_id: string;
  frozen_generation_id: string; frozen_source_digest: string; bound_source_kind: string | null; bound_source_id: string | null;
  bound_base_snapshot_id: string; bound_configuration_id: string; bound_generation_id: string | null; bound_source_digest: string | null;
};
type StudyRootRow = { root_id: string; asset_sha256: string; full_text: string; private_person_names: string[];
  occurred_at: Date | string; channel: string; source_url: string; axes: Record<string, unknown>; listening_topic_keys: string[] };

function configListeningConfigurationId(envelope: Record<string, unknown>): string {
  const source = envelope.source_listening as { configuration_id?: unknown } | undefined;
  if (typeof source?.configuration_id !== "string") throw new Error("native_audit_study_listening_configuration_mismatch");
  return source.configuration_id;
}
function configListeningConfigurationDigest(envelope: Record<string, unknown>): string {
  const source = envelope.source_listening as { configuration_digest?: unknown } | undefined;
  if (typeof source?.configuration_digest !== "string") throw new Error("native_audit_study_listening_configuration_mismatch");
  return source.configuration_digest;
}

export type FrozenStudyListeningSourceV1 = {
  kind: string; id: string; base_snapshot_id: string; configuration_id: string; generation_id: string; source_digest: string;
};
export function sourceStudyAxesForAuditV1(axes: Record<string, unknown>): {
  direction: "trigger" | "barrier" | "mixed" | "none";
  target: "category" | "own_brand" | "competitor_brand" | "alternative";
  use: "literal" | "figurative_or_ironic" | "other";
  alternative_inverted: boolean;
} {
  const direction = axes.source_direction;
  const target = axes.target;
  const use = axes.use;
  if (!(["trigger", "barrier", "mixed", "none"] as unknown[]).includes(direction)
    || !(["category", "own_brand", "competitor_brand", "alternative"] as unknown[]).includes(target)
    || !(["literal", "figurative_or_ironic", "other"] as unknown[]).includes(use)
    || typeof axes.alternative_inverted !== "boolean") throw new Error("native_audit_study_axes_invalid");
  return { direction: direction as "trigger" | "barrier" | "mixed" | "none",
    target: target as "category" | "own_brand" | "competitor_brand" | "alternative",
    use: use as "literal" | "figurative_or_ironic" | "other", alternative_inverted: axes.alternative_inverted };
}

export type NativeAuditMotiveDefinitionV1 = { key: string; name: string; layer: string };
export type NativeAuditCandidateDefinitionV1 = { motive_key: string; volume_cohort: string; name: string; definition: string };

/** The persisted question key array is an observed candidate set, not a ranked centroid result. */
export function nativeNearestCandidateSetV1(args: {
  question_keys: string[]; motives: NativeAuditMotiveDefinitionV1[];
  cohorts: Map<string, string>; definitions: Map<string, string>;
}): NativeAuditCandidateDefinitionV1[] | null {
  if (args.question_keys.length !== 4 || new Set(args.question_keys).size !== 4) return null;
  const candidates = args.question_keys.map(key => {
    const motive = args.motives.find(item => item.key === key);
    const volume_cohort = args.cohorts.get(key), definition = args.definitions.get(key);
    if (!motive || !volume_cohort || !definition) return null;
    return { motive_key: key, volume_cohort, name: motive.name, definition };
  });
  if (candidates.some(item => item === null)) return null;
  return candidates.sort((a, b) => a!.motive_key.localeCompare(b!.motive_key)) as NativeAuditCandidateDefinitionV1[];
}

export type BoundStudyListeningSourceV1 = {
  kind: string | null; id: string | null; base_snapshot_id: string; configuration_id: string;
  generation_id: string | null; source_digest: string | null;
};

export function assertStudyListeningSourceBindingV1(args: {
  frozen: FrozenStudyListeningSourceV1; bound: BoundStudyListeningSourceV1;
  expected_generation_id: string; expected_configuration_id: string;
}): void {
  const { frozen, bound } = args;
  if (!(frozen.kind === "serving" || frozen.kind === "human_edit")
    || (bound.kind !== null && frozen.kind !== bound.kind) || (bound.id !== null && frozen.id !== bound.id)
    || frozen.base_snapshot_id !== bound.base_snapshot_id
    || frozen.configuration_id !== bound.configuration_id || frozen.configuration_id !== args.expected_configuration_id
    || frozen.generation_id !== args.expected_generation_id
    || (bound.generation_id !== null && frozen.generation_id !== bound.generation_id)
    || !/^sha256:[a-f0-9]{64}$/u.test(frozen.source_digest)
    || (bound.source_digest !== null && frozen.source_digest !== bound.source_digest)) {
    throw new Error("native_audit_study_after_source_mismatch");
  }
}

export type NativeAuditExportArgsV1 = {
  database: LabelingDatabaseV1;
  workspace_id: string;
  actor_user_id: string;
  listening_before_generation_id: string;
  listening_after_generation_id: string;
  study_execution_id: string;
  output_path: string;
  source_manifest_path: string;
};

/**
 * Read-only exporter. The caller must supply the immutable source identities;
 * this function never searches for a latest generation or execution. All DB
 * reads share one repeatable-read, read-only transaction and are bounded by
 * explicit batches. Only the private snapshot and its private source manifest
 * are written, each with mode 0600 and fsync before atomic publication.
 */
export async function exportNativeAuditSnapshotV1(args: NativeAuditExportArgsV1): Promise<{
  snapshot: BlindSnapshotV1; snapshot_path: string; source_manifest_path: string; limitations: string[];
}> {
  assertInput(args);
  const snapshotPath = privatePath(args.output_path), manifestPath = privatePath(args.source_manifest_path);
  if (snapshotPath === manifestPath) throw new Error("native_audit_output_paths_must_differ");

  const collected = await listeningTransactionV1(args.database, async client => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const before = await loadGeneration(client, args.workspace_id, args.actor_user_id, args.listening_before_generation_id);
    const after = await loadGeneration(client, args.workspace_id, args.actor_user_id, args.listening_after_generation_id);
    if (before.id === after.id || before.map_id !== after.map_id) throw new Error("native_audit_listening_pair_invalid");
    const study = await loadStudyExecution(client, args.workspace_id, args.study_execution_id);
    if (study.actor_user_id !== args.actor_user_id) {
      await authorizeSignalListeningV1(client as unknown as Parameters<typeof authorizeSignalListeningV1>[0], { workspace_id: args.workspace_id, actor_user_id: args.actor_user_id }, "view");
    }
    assertStudyListeningSourceBindingV1({
      frozen: { kind: study.frozen_source_kind, id: study.frozen_source_id, base_snapshot_id: study.frozen_base_snapshot_id,
        configuration_id: study.frozen_configuration_id, generation_id: study.frozen_generation_id, source_digest: study.frozen_source_digest },
      bound: { kind: study.bound_source_kind, id: study.bound_source_id, base_snapshot_id: study.bound_base_snapshot_id,
        configuration_id: study.bound_configuration_id, generation_id: study.bound_generation_id, source_digest: study.bound_source_digest },
      expected_generation_id: after.id, expected_configuration_id: after.configuration_id,
    });
    const beforeConfiguration = await loadSignalListeningConfigurationWithClientV1(client as unknown as Parameters<typeof loadSignalListeningConfigurationWithClientV1>[0], args.workspace_id, before.configuration_id);
    const afterConfiguration = await loadSignalListeningConfigurationWithClientV1(client as unknown as Parameters<typeof loadSignalListeningConfigurationWithClientV1>[0], args.workspace_id, after.configuration_id);
    if (!beforeConfiguration || !afterConfiguration) throw new Error("native_audit_listening_configuration_missing");
    if (afterConfiguration.id !== configListeningConfigurationId(study.envelope)
      || afterConfiguration.configuration_digest !== configListeningConfigurationDigest(study.envelope)) {
      throw new Error("native_audit_study_listening_configuration_mismatch");
    }
    const beforeTopics = await loadTopics(client, before);
    const afterTopics = await loadTopics(client, after);
    const privateNamesByRoot = await loadStudyPrivateNames(client, study);
    const listening = [
      ...(await loadListeningRows(client, before, beforeTopics, "before", privateNamesByRoot)),
      ...(await loadListeningRows(client, after, afterTopics, "after", privateNamesByRoot)),
    ];
    const config = validateSignalStudyExecutionConfigurationV1(study.envelope);
    const studyRows = await loadStudyRows(client, study, config, after);
    const membershipEvidence = await loadNativeMembershipEvidence(client, study, studyRows);
    const receiptRows = await loadStudyReceipts(client, study.id);
    const layerAgreement = await loadNativeLayerAgreement(client, study);
    return { before, after, study, config, listening, studyRows, membershipEvidence, receiptRows, layerAgreement };
  });

  const { before, after, study, config } = collected;
  const limitations = [
    "native_candidate_flags_unavailable",
    ...(!collected.layerAgreement ? ["native_layer_agreement_pair_unavailable"] : []),
    ...(!collected.membershipEvidence.nearest_candidate_sets_available ? ["native_nearest_candidate_sets_unavailable"] : []),
    ...(!collected.membershipEvidence.motive_memberships_available ? ["native_motive_membership_cache_unavailable"] : []),
    "outside_private_person_name_roster_unavailable_for_outside_cut_roots",
    ...collected.receiptRows.limitations,
  ];
  const totalCost = collected.receiptRows.complete ? collected.receiptRows.total_cost_usd : null;
  const totalElapsed = collected.receiptRows.complete ? collected.receiptRows.total_elapsed_ms : null;
  const template = config.template_snapshot;
  const snapshotWithoutDigest = {
    contract_version: "r16-blind-snapshot-v1" as const,
    exported_at: new Date().toISOString(),
    source: { export_contract: "r16-native-audit-export-v1", export_digest: "0".repeat(64) },
    study_provenance: {
      listening_before_digest: stripSha(before.snapshot_digest!), listening_after_digest: stripSha(after.snapshot_digest!),
      study_contract_version: "signal-study-v1", methodology_template_version: template.template.version,
      methodology_template_digest: template.template_digest,
    },
    study_guidance: {
      subject_context: [config.study.subject.name, config.study.business_question].filter(Boolean).join("\n"),
      direction_options: configuredOptions(config.question_configuration, "direction"),
      target_options: configuredOptions(config.question_configuration, "target"),
      use_options: configuredOptions(config.question_configuration, "use"),
      layer_diagnostics: template.template.diagnostics.map(item => ({ key: item.key, layer: item.layer,
        question: item.question, definition: item.question })),
    },
    layer_agreement: collected.layerAgreement,
    receipts: { status: collected.receiptRows.complete ? "complete" as const : "incomplete" as const,
      total_cost_usd: totalCost, total_elapsed_ms: totalElapsed,
      stages: collected.receiptRows.stages.length ? collected.receiptRows.stages
        : [{ stage: "native_measurements", cost_usd: null, elapsed_ms: null }] },
    listening: collected.listening,
    study: collected.studyRows,
  };
  const sourceManifest = {
    contract_version: "r16-native-audit-source-manifest-v1",
    workspace_id: args.workspace_id,
    actor_user_id: args.actor_user_id,
    listening_before_generation_id: before.id,
    listening_after_generation_id: after.id,
    study_execution_id: study.id,
    source_digests: { before: before.snapshot_digest, before_verified_digest: before.actual_digest,
      after: after.snapshot_digest, after_verified_digest: after.actual_digest, study_output: study.output_digest,
      study_output_verified_digest: study.actual_output_digest },
    study_listening_source: { kind: study.frozen_source_kind, id: study.frozen_source_id,
      base_snapshot_id: study.frozen_base_snapshot_id, configuration_id: study.frozen_configuration_id,
      generation_id: study.frozen_generation_id, snapshot_digest: study.frozen_source_digest },
    source_row_counts: { before_roots: Number(before.counts?.roots ?? 0), after_roots: Number(after.counts?.roots ?? 0),
      listening_rows: collected.listening.length, study_roots: study.source_roots, study_rows: collected.studyRows.length },
    measurements: collected.receiptRows.manifest,
    limitations,
  };
  const sourceDigest = stripSha(digest(sourceManifest));
  const snapshot = validateSnapshotV1({ ...snapshotWithoutDigest,
    source: { export_contract: "r16-native-audit-export-v1", export_digest: sourceDigest } });
  await writePrivateJson(manifestPath, sourceManifest);
  await writePrivateJson(snapshotPath, snapshot);
  return { snapshot, snapshot_path: snapshotPath, source_manifest_path: manifestPath, limitations };
}

async function loadGeneration(client: ReadClientV1, workspaceId: string, actorId: string, generationId: string): Promise<GenerationRow> {
  const row = (await client.query<GenerationRow>(`SELECT g.*,signal_listening_discovery_digest_v1(g.id) actual_digest,
      signal_listening_discovery_source_current_v1(g.id) source_current
    FROM signal_listening_discovery_generations g WHERE g.workspace_id=$1 AND g.id=$2`, [workspaceId, generationId])).rows[0];
  if (!row || row.status !== "ready" || row.kind !== "confirmed_members" || !row.source_current
    || !row.snapshot_digest || row.snapshot_digest !== row.actual_digest) throw new Error("native_audit_listening_source_stale");
  await authorizeSignalListeningV1(client as unknown as Parameters<typeof authorizeSignalListeningV1>[0], { workspace_id: workspaceId, actor_user_id: actorId }, "view");
  const configuration = await loadSignalListeningConfigurationWithClientV1(client as unknown as Parameters<typeof loadSignalListeningConfigurationWithClientV1>[0], workspaceId, row.configuration_id);
  if (!configuration || configuration.state !== "published" || digest(configuration.configuration) !== configuration.configuration_digest) {
    throw new Error("native_audit_listening_configuration_stale");
  }
  return row;
}

async function loadStudyExecution(client: ReadClientV1, workspaceId: string, executionId: string): Promise<StudyExecutionRow> {
  const row = (await client.query<StudyExecutionRow>(`SELECT e.id,e.workspace_id,e.actor_user_id,e.study_id,e.configuration_id,e.status,e.output,e.output_digest,e.source_digest,
      signal_labeling_digest_v1(e.output) actual_output_digest,signal_study_source_current_v1(e.id) source_current,
      signal_study_owner_current_v1(e.id) owner_current,cfg.envelope,cfg.listening_generation_id,cfg.listening_source_digest,e.source_roots,
      source.source_kind frozen_source_kind,source.id frozen_source_id,source.base_snapshot_id frozen_base_snapshot_id,
      source.configuration_id frozen_configuration_id,source.generation_id frozen_generation_id,source.snapshot_digest frozen_source_digest,
      cfg.listening_source_kind bound_source_kind,cfg.listening_source_id bound_source_id,cfg.listening_snapshot_id bound_base_snapshot_id,
      cfg.listening_configuration_id bound_configuration_id,cfg.listening_generation_id bound_generation_id,cfg.listening_source_digest bound_source_digest
    FROM signal_study_executions e JOIN signal_study_configurations cfg ON cfg.id=e.configuration_id AND cfg.workspace_id=e.workspace_id
    JOIN signal_study_configuration_sources_v1 source ON source.study_configuration_id=cfg.id AND source.workspace_id=e.workspace_id
    JOIN signal_study_outputs output ON output.execution_id=e.id AND output.workspace_id=e.workspace_id AND output.output_digest=e.output_digest
    WHERE e.workspace_id=$1 AND e.id=$2`, [workspaceId, executionId])).rows[0];
  if (!row || row.status !== "completed" || !row.source_current || !row.owner_current || !row.output
    || row.output_digest !== row.actual_output_digest) {
    throw new Error("native_audit_study_execution_invalid");
  }
  return row;
}

async function loadTopics(client: ReadClientV1, generation: GenerationRow): Promise<Map<string, { name: string; definition: string; cohort: string }>> {
  const rows = (await client.query<TopicRow>(`WITH ranked AS (
      SELECT t.question_key,t.member_count,q.definition,
        ntile(10) OVER(ORDER BY t.member_count DESC,t.question_key) cohort_no
      FROM signal_listening_discovery_topics t
      JOIN signal_listening_questions q ON q.workspace_id=t.workspace_id AND q.configuration_id=t.configuration_id AND q.question_key=t.question_key
      WHERE t.workspace_id=$1 AND t.generation_id=$2
    ) SELECT question_key,definition,member_count,cohort_no FROM ranked ORDER BY question_key`,
  [generation.workspace_id, generation.id])).rows;
  const topics = new Map<string, { name: string; definition: string; cohort: string }>();
  for (const row of rows) {
    const localized = row.definition.localization as { original?: { name?: string; definition?: string } } | undefined;
    const name = localized?.original?.name ?? row.definition.text;
    const definition = localized?.original?.definition ?? row.definition.positive;
    if (typeof name !== "string" || !name.trim() || typeof definition !== "string" || !definition.trim()) {
      throw new Error("native_audit_topic_guidance_missing");
    }
    const cohortIndex = Math.min(9, Math.max(0, Number(row.cohort_no) - 1));
    topics.set(row.question_key, { name, definition, cohort: LISTENING_COHORTS_V1[cohortIndex]! });
  }
  return topics;
}

async function loadListeningRows(client: ReadClientV1, generation: GenerationRow, topics: Map<string, { name: string; definition: string; cohort: string }>,
  stage: "before" | "after", privateNamesByRoot: Map<string, string[]>): Promise<BlindSnapshotV1["listening"]> {
  const rootIds = await readRootIds(client, `SELECT root_id FROM signal_listening_discovery_roots
    WHERE workspace_id=$1 AND generation_id=$2`, [generation.workspace_id, generation.id]);
  const rows: BlindSnapshotV1["listening"] = [];
  for (let offset = 0; offset < rootIds.length; offset += BATCH_SIZE) {
    const batch = rootIds.slice(offset, offset + BATCH_SIZE);
    const page = (await client.query<ListeningRootRow>(`SELECT r.root_id,r.proof,r.proof_digest,i.text,
        COALESCE((SELECT array_agg(m.question_key ORDER BY m.question_key) FROM signal_listening_discovery_members m
          WHERE m.workspace_id=r.workspace_id AND m.generation_id=r.generation_id AND m.root_id=r.root_id),'{}'::text[]) assigned_keys
      FROM signal_listening_discovery_roots r
      JOIN signal_mass_labeling_items i ON i.workspace_id=r.workspace_id AND i.map_id=$3 AND i.root_id=r.root_id
      WHERE r.workspace_id=$1 AND r.generation_id=$2 AND r.root_id=ANY($4::uuid[])
       AND signal_listening_root_right_v1(r.workspace_id,r.root_id,'client-derived-metrics')
       AND r.proof_digest=signal_labeling_digest_v1(r.proof)
      ORDER BY r.root_id`, [generation.workspace_id, generation.id, generation.map_id, batch])).rows;
    if (page.length !== batch.length) throw new Error("native_audit_listening_root_source_incomplete");
    for (const row of page) {
      if (row.proof.source_text_sha256 !== `sha256:${sha256(row.text)}`) throw new Error("native_audit_listening_text_digest_mismatch");
      const assigned = new Set(row.assigned_keys);
      const evaluations = Array.isArray(row.proof.evaluations) ? row.proof.evaluations as Array<Record<string, unknown>> : [];
      const keys = new Set([...row.assigned_keys, ...evaluations.map(item => item.question_key).filter((key): key is string => typeof key === "string")]);
      const assignments = [...keys].map(topic_key => {
        const topic = topics.get(topic_key);
        if (!topic) throw new Error("native_audit_topic_source_mismatch");
        return { topic_key, topic_name: topic.name, topic_definition: topic.definition, volume_cohort: topic.cohort, assigned: assigned.has(topic_key) };
      });
      if (!assignments.length) continue;
      rows.push({ mention_id: row.root_id, redacted_text: safeDisplayText(row.text, privateNamesByRoot.get(row.root_id) ?? []), stage, assignments });
    }
  }
  return rows;
}

async function loadStudyPrivateNames(client: ReadClientV1, execution: StudyExecutionRow): Promise<Map<string, string[]>> {
  const rootIds = await readRootIds(client, `SELECT root_id FROM signal_study_source_roots
    WHERE workspace_id=$1 AND execution_id=$2`, [execution.workspace_id, execution.id]);
  const names = new Map<string, string[]>();
  for (let offset = 0; offset < rootIds.length; offset += BATCH_SIZE) {
    const batch = rootIds.slice(offset, offset + BATCH_SIZE);
    const rows = (await client.query<{ root_id: string; private_person_names: string[] }>(`SELECT root_id,private_person_names
      FROM signal_study_source_roots WHERE workspace_id=$1 AND execution_id=$2 AND root_id=ANY($3::uuid[]) ORDER BY root_id`,
    [execution.workspace_id, execution.id, batch])).rows;
    for (const row of rows) names.set(row.root_id, row.private_person_names ?? []);
  }
  return names;
}

async function loadStudyRows(client: ReadClientV1, execution: StudyExecutionRow,
  config: ReturnType<typeof validateSignalStudyExecutionConfigurationV1>, after: GenerationRow): Promise<BlindSnapshotV1["study"]> {
  const rootIds = await readRootIds(client, `SELECT root_id FROM signal_study_source_roots
    WHERE workspace_id=$1 AND execution_id=$2`, [execution.workspace_id, execution.id]);
  if (rootIds.length !== execution.source_roots) throw new Error("native_audit_study_root_count_mismatch");
  const rows: BlindSnapshotV1["study"] = [];
  for (let offset = 0; offset < rootIds.length; offset += BATCH_SIZE) {
    const batch = rootIds.slice(offset, offset + BATCH_SIZE);
    const page = (await client.query<StudyRootRow>(`SELECT r.root_id,r.asset_sha256,a.full_text,r.private_person_names,r.occurred_at,r.channel,r.source_url,
        r.listening_topic_keys,signal_study_axes_v1($2,r.root_id) axes
      FROM signal_study_source_roots r
      JOIN signal_corpus_text_assets a ON a.workspace_id=r.workspace_id AND a.text_sha256=r.asset_sha256 AND a.chunk_policy_version=r.chunk_policy_version
      WHERE r.workspace_id=$1 AND r.execution_id=$2 AND r.root_id=ANY($3::uuid[])
       AND signal_listening_root_right_v1(r.workspace_id,r.root_id,'client-derived-metrics')
       AND EXISTS(SELECT 1 FROM signal_study_expected_cut_roots_v1($2) expected WHERE expected.root_id=r.root_id)
      ORDER BY r.root_id`, [execution.workspace_id, execution.id, batch])).rows;
    if (page.length !== batch.length) throw new Error("native_audit_study_root_source_incomplete");
    for (const row of page) {
      if (row.asset_sha256 !== `sha256:${sha256(row.full_text)}`) throw new Error("native_audit_study_text_digest_mismatch");
      const axes = sourceStudyAxesForAuditV1(row.axes);
      rows.push({ mention_id: row.root_id, redacted_text: safeDisplayText(row.full_text, row.private_person_names ?? []),
        axes_status: "observed", direction: axes.direction, target: axes.target, use: axes.use, alternative_inverted: axes.alternative_inverted,
        in_cut: true, lexical_filter_match: true, base_voice_valid: true,
        review_flags: [] });
    }
  }
  rows.push(...await loadOutsideLexicalRows(client, execution, config, after));
  return rows;
}

async function loadNativeMembershipEvidence(client: ReadClientV1, execution: StudyExecutionRow, rows: BlindSnapshotV1["study"]): Promise<{
  motive_memberships_available: boolean; nearest_candidate_sets_available: boolean;
}> {
  const summary = execution.output?.summary as { motives?: Array<{ key?: unknown; name?: unknown; layer?: unknown; mentions?: unknown }> } | undefined;
  if (!summary || !Array.isArray(summary.motives)) throw new Error("native_audit_study_summary_missing");
  const motives = summary.motives.map(m => {
    if (typeof m.key !== "string" || typeof m.name !== "string" || !["psychological", "personal", "social", "cultural", "unclear"].includes(String(m.layer))
      || !Number.isSafeInteger(m.mentions) || Number(m.mentions) < 0) throw new Error("native_audit_study_summary_motive_invalid");
    return { key: m.key, name: m.name, layer: String(m.layer), mentions: Number(m.mentions) };
  }).sort((a, b) => b.mentions - a.mentions || a.key.localeCompare(b.key));
  const cohortByKey = new Map(motives.map((m, index) => [m.key, LISTENING_COHORTS_V1[Math.min(9, Math.floor(index * 10 / Math.max(1, motives.length)))]!]));
  const configRows = (await client.query<{ id: string; stage: string; created_at: Date | string; stage_configuration: Record<string, unknown> }>(`SELECT id,stage,created_at,stage_configuration
    FROM signal_study_jev_batches WHERE execution_id=$1 AND status='completed' AND stage IN('membership','dominance_membership')
    ORDER BY created_at,id`, [execution.id])).rows;
  const configs = new Map(configRows.map(batch => [batch.id, { ...batch, questions: Array.isArray(batch.stage_configuration.questions)
    ? batch.stage_configuration.questions as Array<Record<string, unknown>> : [] }]));
  const definitions = new Map<string, { name: string; definition: string; stage: string; created_at: Date | string }>();
  for (const batch of configs.values()) for (const question of batch.questions) {
    if (typeof question.key !== "string" || !motives.some(motive => motive.key === question.key)) continue;
    if (typeof question.text !== "string" || !question.text.trim() || typeof question.positive !== "string" || !question.positive.trim()) continue;
    const previous = definitions.get(question.key);
    if (!previous || (batch.stage === "dominance_membership" ? 0 : 1) < (previous.stage === "dominance_membership" ? 0 : 1)
      || batch.stage === previous.stage && new Date(batch.created_at) > new Date(previous.created_at)) {
      definitions.set(question.key, { name: question.text, definition: question.positive, stage: batch.stage, created_at: batch.created_at });
    }
  }
  const byId = new Map(rows.map(row => [row.mention_id, row]));
  const selectedMemberships = new Map<string, Map<string, { probability: number; name: string; definition: string; batch_id: string }>>();
  const candidateBatchByRoot = new Map<string, { batch_id: string; stage: string; created_at: Date | string; question_keys: string[] }>();
  const rootIds = rows.filter(row => row.axes_status === "observed").map(row => row.mention_id);
  for (let offset = 0; offset < rootIds.length; offset += BATCH_SIZE) {
    const batch = rootIds.slice(offset, offset + BATCH_SIZE);
    const answers = (await client.query<{ root_id: string; batch_id: string; stage: string; created_at: Date | string; question_keys: string[];
      motive_key: string; ordinal: number; answer: Record<string, unknown> }>(`SELECT m.root_id,b.id batch_id,b.stage,b.created_at,m.question_keys,
        question.key motive_key,question.ordinal::int ordinal,a.answer
      FROM signal_study_jev_batches b JOIN signal_study_jev_members m ON m.batch_id=b.id AND m.workspace_id=b.workspace_id
      CROSS JOIN LATERAL unnest(m.question_keys) WITH ORDINALITY question(key,ordinal)
      JOIN signal_study_answers a ON a.batch_id=b.id AND a.workspace_id=m.workspace_id AND a.root_id=m.root_id AND a.question_key=question.key
       AND a.state_sha256=m.state_sha256 AND a.target_digest=m.target_digest AND a.model='jev-1.13.0'
       AND a.question_digest=m.question_digests->>a.question_key
      JOIN signal_labeling_raw_pages page ON page.id=a.raw_page_id AND page.status='verified'
      WHERE b.execution_id=$1 AND b.status='completed' AND b.stage IN('membership','dominance_membership') AND m.root_id=ANY($2::uuid[])
      ORDER BY m.root_id,question.ordinal,CASE WHEN b.stage='dominance_membership' THEN 0 ELSE 1 END,b.created_at DESC,b.id DESC`, [execution.id, batch])).rows;
    const priority = (stage: string) => stage === "dominance_membership" ? 0 : 1;
    const chosenPerRootBatch = new Map<string, { batch_id: string; stage: string; created_at: Date | string; question_keys: string[] }>();
    for (const answer of answers) {
      const chosenBatch = chosenPerRootBatch.get(answer.root_id);
      if (!chosenBatch || priority(answer.stage) < priority(chosenBatch.stage)
        || priority(answer.stage) === priority(chosenBatch.stage) && new Date(answer.created_at) > new Date(chosenBatch.created_at)) {
        chosenPerRootBatch.set(answer.root_id, { batch_id: answer.batch_id, stage: answer.stage, created_at: answer.created_at, question_keys: answer.question_keys });
      }
      const batchConfig = configs.get(answer.batch_id);
      const question = batchConfig?.questions.find(item => item.key === answer.motive_key);
      const probability = Number(answer.answer.noul);
      if (answer.answer.type !== "noul" || !Number.isFinite(probability) || probability < 0 || probability > 1
        || typeof question?.text !== "string" || !question.text.trim() || typeof question.positive !== "string" || !question.positive.trim()) {
        throw new Error("native_audit_membership_answer_invalid");
      }
      const current = selectedMemberships.get(answer.root_id) ?? new Map();
      const existing = current.get(answer.motive_key);
      if (!existing || priority(answer.stage) < priority(configs.get(existing.batch_id)?.stage ?? "membership")
        || priority(answer.stage) === priority(configs.get(existing.batch_id)?.stage ?? "membership")
          && new Date(answer.created_at) > new Date(configs.get(existing.batch_id)?.created_at ?? 0)) {
        current.set(answer.motive_key, { probability, name: question.text, definition: question.positive, batch_id: answer.batch_id });
      }
      selectedMemberships.set(answer.root_id, current);
    }
    for (const [rootId, selected] of chosenPerRootBatch) {
      const previous = candidateBatchByRoot.get(rootId);
      if (!previous || priority(selected.stage) < priority(previous.stage)
        || priority(selected.stage) === priority(previous.stage) && new Date(selected.created_at) > new Date(previous.created_at)) candidateBatchByRoot.set(rootId, selected);
    }
  }
  for (const [rootId, memberships] of selectedMemberships) {
    const row = byId.get(rootId); if (!row || row.axes_status !== "observed" || row.direction === "none" || row.use !== "literal") continue;
    row.motive_memberships = [...memberships].flatMap(([key, value]) => {
      const motive = motives.find(item => item.key === key), volume_cohort = cohortByKey.get(key);
      const definition = definitions.get(key)?.definition;
      return motive && volume_cohort && definition ? [{ motive_key: key, volume_cohort, name: motive.name, definition, layer: motive.layer,
        probability: value.probability, assigned: value.probability >= .7 }] : [];
    });
    const candidateBatch = candidateBatchByRoot.get(rootId);
    if (!candidateBatch || candidateBatch.question_keys.length !== 4 || new Set(candidateBatch.question_keys).size !== 4) continue;
    const candidateSet = nativeNearestCandidateSetV1({ question_keys: candidateBatch.question_keys, motives,
      cohorts: cohortByKey, definitions: new Map([...definitions].map(([key, value]) => [key, value.definition])) });
    if (!candidateSet) continue;
    row.native_nearest_candidate_set = candidateSet;
  }
  return { motive_memberships_available: selectedMemberships.size > 0,
    nearest_candidate_sets_available: [...byId.values()].some(row => row.native_nearest_candidate_set?.length === 4) };
}

async function loadOutsideLexicalRows(client: ReadClientV1, execution: StudyExecutionRow,
  config: ReturnType<typeof validateSignalStudyExecutionConfigurationV1>, after: GenerationRow): Promise<BlindSnapshotV1["study"]> {
  const rootIds = await readRootIds(client, `SELECT root_id FROM signal_listening_discovery_roots
    WHERE workspace_id=$1 AND generation_id=$2`, [execution.workspace_id, after.id]);
  const result: BlindSnapshotV1["study"] = [];
  for (let offset = 0; offset < rootIds.length; offset += BATCH_SIZE) {
    const batch = rootIds.slice(offset, offset + BATCH_SIZE);
    const page = (await client.query<{ root_id: string; body: string; proof: Record<string, unknown>; proof_digest: string }>(`WITH source AS MATERIALIZED (
        SELECT p.root_id,max(p.body) body,max(p.input_digest) input_digest,
          jsonb_object_agg(p.question_key,p.answer) FILTER(WHERE p.question_key IN('voice','promotion')) answers
        FROM signal_listening_population_roots_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid[],'client-derived-metrics') p
        WHERE p.question_key IN('voice','promotion') GROUP BY p.root_id
      )
      SELECT source.root_id,source.body,r.proof,r.proof_digest
      FROM source JOIN signal_listening_discovery_roots r ON r.workspace_id=$1 AND r.generation_id=$6 AND r.root_id=source.root_id
      JOIN mentions mention ON mention.workspace_id=$1 AND mention.id=source.root_id AND mention.canonical_mention_id=mention.id AND mention.inclusion_status='included'
      CROSS JOIN LATERAL(SELECT signal_study_attributes_v1(signal_study_listening_cache_v1($1,$7,source.root_id,source.input_digest,$8),r.proof,mention.platform) value) attributes
      WHERE mention.published_at>=($9::jsonb#>>'{cut,start_at}')::timestamptz
        AND mention.published_at<($9::jsonb#>>'{cut,end_at}')::timestamptz
        AND source.answers#>>'{voice,choice}'='individual' AND (source.answers#>>'{promotion,noul}')::double precision<=0.7
        AND NOT signal_mass_labeling_category_matches_v1(source.body,ARRAY(SELECT jsonb_array_elements_text($10::jsonb->'lexicon_terms')))
        AND NOT signal_mass_labeling_r13_hashtags_v1(source.body)
        AND r.proof->'in_category'='false'::jsonb AND source.input_digest=r.proof->>'input_digest'
        AND NOT EXISTS(SELECT 1 FROM jsonb_each($9::jsonb#>'{cut,filters}') f
          WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(f.value) allowed(value) WHERE attributes.value->f.key ? allowed.value))
        AND NOT EXISTS(SELECT 1 FROM signal_study_source_roots study_root WHERE study_root.workspace_id=$1
          AND study_root.execution_id=$11 AND study_root.root_id=source.root_id)
        AND r.proof_digest=signal_labeling_digest_v1(r.proof)
        AND signal_listening_root_right_v1($1,source.root_id,'client-derived-metrics')
      ORDER BY source.root_id`, [execution.workspace_id, after.configuration_id, after.map_id, after.entity_context_digest, batch,
      after.id, config.study.listening_configuration_id, after.entity_context_digest, JSON.stringify(config.study),
      JSON.stringify(config.source_listening.configuration), execution.id])).rows;
    for (const row of page) {
      if (row.proof.source_text_sha256 !== `sha256:${sha256(row.body)}`) {
        throw new Error("native_audit_outside_source_proof_invalid");
      }
      result.push({ mention_id: row.root_id, redacted_text: safeDisplayText(row.body, []), axes_status: "not_asked_outside_cut",
        direction: null, target: null, use: null, in_cut: false, lexical_filter_match: false, base_voice_valid: true, review_flags: [] });
    }
  }
  return result;
}

async function readRootIds(client: ReadClientV1, query: string, values: unknown[]): Promise<string[]> {
  const ids: string[] = []; let cursor = "";
  for (;;) {
    const page = (await client.query<{ root_id: string }>(`${query} AND root_id::text > $${values.length + 1} ORDER BY root_id LIMIT $${values.length + 2}`, [...values, cursor, BATCH_SIZE])).rows;
    ids.push(...page.map(row => row.root_id));
    if (page.length < BATCH_SIZE) return ids;
    cursor = page[page.length - 1]!.root_id;
  }
}

async function loadStudyReceipts(client: ReadClientV1, executionId: string): Promise<{
  complete: boolean; total_cost_usd: number | null; total_elapsed_ms: number | null;
  stages: BlindSnapshotV1["receipts"]["stages"]; manifest: Record<string, unknown>; limitations: string[];
}> {
  const rows = (await client.query<{ stage: string; call_count: number; cost_micro: string | null; timed_count: number; elapsed_ms: string | null }>(`SELECT s.mode stage,
      count(*)::int call_count,sum(c.settled_micro_usd) FILTER(WHERE c.call_state='settled')::text cost_micro,
      count(*) FILTER(WHERE c.call_state='settled' AND c.sent_at IS NOT NULL AND c.response_received_at IS NOT NULL)::int timed_count,
      sum(extract(epoch FROM(c.response_received_at-c.sent_at))*1000) FILTER(WHERE c.call_state='settled')::text elapsed_ms
    FROM signal_study_steps s LEFT JOIN engine_cost_events c ON c.study_step_id=s.id AND c.workspace_id=s.workspace_id
    WHERE s.execution_id=$1 AND s.status='committed' GROUP BY s.mode ORDER BY s.mode`, [executionId])).rows;
  const stages = rows.map(row => ({ stage: `study_${row.stage}`,
    cost_usd: row.cost_micro === null ? null : Number(row.cost_micro) / 1_000_000,
    elapsed_ms: Number(row.timed_count) === Number(row.call_count) && row.elapsed_ms !== null ? Number(row.elapsed_ms) : null }));
  const allMeasured = stages.length > 0 && stages.every(stage => stage.cost_usd !== null && stage.elapsed_ms !== null);
  return { complete: false, total_cost_usd: null, total_elapsed_ms: null,
    stages: stages.length ? stages : [{ stage: "native_measurements", cost_usd: null, elapsed_ms: null }],
    manifest: { study_stage_receipts: rows, study_stage_totals_complete: allMeasured, listening_stage_receipts: "not_joined_to_exact_shared-ledger_run_lineage" },
    limitations: ["native_total_cost_and_timing_incomplete_across_listening_and_study_stages"] };
}

type NativeLayerStepV1 = { step_key: string; request_body: string; request_sha256: string; source_digest: string;
  mode: string; status: string; value: Record<string, unknown> | null; value_digest: string | null };
type RecoveredLayerStageV1 = { pass: "a" | "b"; repair: boolean; offset: number; decision: SignalStudyLayerDecisionV1 };

/** Rebuilds only what the native committed layer steps prove. The sample envelope is
 * reconstructed from the exact request payload solely to re-run the product parser;
 * its synthetic bookkeeping is never exported as a measurement. */
export function reconstructNativeLayerStageV1(args: { step: NativeLayerStepV1; execution_id: string; execution_source_digest: string }): RecoveredLayerStageV1 | null {
  const { step } = args;
  if (step.mode !== "layers" || step.status !== "committed" || !step.value || !step.value_digest
    || step.source_digest !== args.execution_source_digest || step.value_digest !== digest(step.value)
    || step.request_sha256 !== `sha256:${sha256(step.request_body)}`) return null;
  let recovered: { pass: "a" | "b"; repair: boolean; offset: number } | undefined;
  for (const pass of ["a", "b"] as const) for (const repair of [false, true]) for (let offset = 0; offset <= 160; offset += 40) {
    const stage = `layers:${pass}:${repair ? "repair" : "initial"}:${offset}`;
    if (step.step_key === digest({ execution_id: args.execution_id, source_digest: step.source_digest, stage,
      request_sha256: step.request_sha256 })) recovered = { pass, repair, offset };
  }
  if (!recovered) return null;
  const { pass, repair, offset } = recovered;
  try {
    const body = JSON.parse(step.request_body) as { messages?: Array<{ content?: unknown }> };
    const message = JSON.parse(String(body.messages?.[0]?.content)) as { input_digest?: string; untrusted_data?: Record<string, unknown> };
    const payload = message.untrusted_data;
    if (!payload || typeof message.input_digest !== "string" || digest(payload) !== message.input_digest
      || typeof payload.study_digest !== "string" || !Array.isArray(payload.motives)) return null;
    const samples: SignalStudySampleV1[] = [];
    const motiveKeys: string[] = [];
    for (const raw of payload.motives) {
      if (!raw || typeof raw !== "object") return null;
      const motive = raw as { key?: unknown; sampling?: Record<string, unknown>; sample?: unknown };
      const rows = motive.sample;
      if (typeof motive.key !== "string" || !motive.sampling || !Array.isArray(rows)) return null;
      const random = motive.sampling.random, far = motive.sampling.far;
      if (!Number.isSafeInteger(random) || !Number.isSafeInteger(far) || typeof motive.sampling.insufficient !== "boolean"
        || !["disjoint", "overlapping", "small_group"].includes(String(motive.sampling.independence))) return null;
      const sampleBody = { contract_version: "signal-study-sample-v1" as const, study_digest: payload.study_digest,
        group_key: motive.key, pass, random_count: random as number, far_count: far as number, population_count: rows.length,
        independence: motive.sampling.independence as SignalStudySampleV1["independence"],
        sampling_policy: { seed_digest: digest({ step_key: step.step_key, key: motive.key }),
          population_digest: digest(rows), centroid_digest: digest({ step_key: step.step_key, centroid: motive.key }),
          requested_random: random as number, requested_far: far as number }, insufficient_sample: motive.sampling.insufficient,
        rows: rows as SignalStudySampleV1["rows"] };
      samples.push({ ...sampleBody, sample_digest: digest(sampleBody) });
      motiveKeys.push(motive.key);
    }
    if (!samples.length || new Set(motiveKeys).size !== motiveKeys.length || motiveKeys.length > 40) return null;
    const reviewBody = { contract_version: "signal-study-editorial-request-v1" as const, mode: "layers" as const,
      model: "claude-sonnet-4-6" as const, study_digest: payload.study_digest, input_digest: message.input_digest,
      request_body: step.request_body, source_samples: samples, motive_keys: [...motiveKeys].sort(), pass,
      recode_attempt: repair ? 1 as const : 0 as const, boundary_keys: repair ? [...motiveKeys].sort() : [] };
    const review: SignalStudyEditorialRequestV1 = { ...reviewBody, request_digest: digest(reviewBody) };
    const content = step.value.content;
    if (!Array.isArray(content) || content.length !== 1 || !content[0] || typeof content[0] !== "object"
      || typeof (content[0] as { text?: unknown }).text !== "string") return null;
    const parsed = JSON.parse((content[0] as { text: string }).text) as unknown;
    const decision = validateSignalStudyLayerReviewV1(review, parsed);
    return { pass, repair, offset, decision };
  } catch { return null; }
}

export function nativeLayerAgreementReceiptV1(args: { initial: [SignalStudyLayerDecisionV1, SignalStudyLayerDecisionV1];
  repairs?: [SignalStudyLayerDecisionV1, SignalStudyLayerDecisionV1]; expectedOutput?: unknown; passDigests?: [string, string] }): BlindSnapshotV1["layer_agreement"] {
  try {
    let decisions = args.initial;
    let stability = signalStudyLayerStabilityV1(...decisions);
    if (stability.action === "recode_boundary_once") {
      if (!args.repairs) return null;
      const repaired = applySignalStudyBoundaryRecodeV1({ initial: decisions, recoded: args.repairs });
      decisions = repaired.decisions; stability = repaired.stability;
    } else if (args.repairs) return null;
    if (args.expectedOutput !== undefined && digest(args.expectedOutput) !== digest(stability)) return null;
    const eligible = stability.total_motives;
    const passA = args.initial[0].motives.length, passB = args.initial[1].motives.length;
    const denominator = stability.compared_motives, complete = denominator === eligible && passA === eligible && passB === eligible;
    const noPasses = passA === 0 && passB === 0;
    const expectedOne = complete && stability.expected_agreement === 1;
    const status = noPasses ? "not_measured" : !complete ? "insufficient_data"
      : expectedOne ? "not_estimable" : stability.kappa !== null && stability.kappa >= .8 ? "acceptable" : "below_threshold";
    const estimationStatus = stability.kappa === null ? "not_estimable" : "complete";
    return { eligible_count: eligible, pass_a_count: passA, pass_a_digest: passA ? stripSha(args.passDigests?.[0] ?? digest(args.initial[0])) : null,
      pass_b_count: passB, pass_b_digest: passB ? stripSha(args.passDigests?.[1] ?? digest(args.initial[1])) : null,
      denominator, coverage: eligible ? denominator / eligible : 0,
      observed_agreement: complete ? stability.observed_agreement : null,
      expected_agreement: complete ? stability.expected_agreement : null,
      kappa: complete ? stability.kappa : null, estimation_status: estimationStatus,
      not_estimable_reason: noPasses ? "no_passes" : !complete ? "incomplete_coverage" : expectedOne ? "expected_agreement_one" : null,
      action: stability.action, status, boundary_recoded_count: args.repairs ? args.repairs[0].motives.length : 0 };
  } catch { return null; }
}

async function loadNativeLayerAgreement(client: ReadClientV1, execution: StudyExecutionRow): Promise<BlindSnapshotV1["layer_agreement"]> {
  const expectedOutput = execution.output?.stability;
  if (expectedOutput === null || expectedOutput === undefined) return null;
  const rows = (await client.query<NativeLayerStepV1>(`SELECT step_key,request_body,request_sha256,source_digest,mode,status,value,value_digest
    FROM signal_study_steps WHERE workspace_id=$1 AND execution_id=$2 AND mode='layers' ORDER BY step_key`,
  [execution.workspace_id, execution.id])).rows;
  if (!rows.length || rows.length > 100 || rows.some(row => row.status !== "committed")) return null;
  const stages = rows.map(step => reconstructNativeLayerStageV1({ step, execution_id: execution.id, execution_source_digest: execution.source_digest }));
  if (stages.some(stage => stage === null)) return null;
  const recovered = stages as RecoveredLayerStageV1[];
  const selectPair = (repair: boolean): [SignalStudyLayerDecisionV1, SignalStudyLayerDecisionV1] | null => {
    const pass = (which: "a" | "b") => {
      const items = recovered.filter(item => item.repair === repair && item.pass === which).sort((a, b) => a.offset - b.offset);
      if (!items.length || items.some((item, index) => item.offset !== index * 40)
        || new Set(items.flatMap(item => item.decision.motives.map(m => m.motive_key))).size
          !== items.reduce((n, item) => n + item.decision.motives.length, 0)) return null;
      const first = items[0]!.decision;
      return { ...first, request_digest: digest(items.map(item => item.decision.request_digest)),
        motives: items.flatMap(item => item.decision.motives) };
    };
    const a = pass("a"), b = pass("b");
    return a && b ? [a, b] : null;
  };
  const initial = selectPair(false); if (!initial) return null;
  const repairs = selectPair(true);
  if (recovered.some(item => item.repair) && !repairs) return null;
  const passDigest = (pass: "a" | "b") => digest(rows.filter(row => {
    const recovered = recoveredByStep.get(row.step_key);
    return recovered?.pass === pass;
  }).map(row => ({ step_key: row.step_key, request_sha256: row.request_sha256, value_digest: row.value_digest })));
  const recoveredByStep = new Map(recovered.map((stage, index) => [rows[index]!.step_key, stage]));
  return nativeLayerAgreementReceiptV1({ initial, ...(repairs ? { repairs } : {}), expectedOutput,
    passDigests: [passDigest("a"), passDigest("b")] });
}

function configuredOptions(config: ReturnType<typeof validateSignalStudyExecutionConfigurationV1>["question_configuration"], role: string) {
  const roleKey = config.roles[role];
  const question = config.questions.find(item => item.key === roleKey);
  if (!question || question.type !== "choice") throw new Error("native_audit_study_guidance_missing");
  return question.options.map(option => ({ key: option.key, definition: option.definition }));
}

function stripSha(value: string): string {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) throw new Error("native_audit_source_digest_invalid");
  return value.slice("sha256:".length);
}

function safeDisplayText(text: string, names: string[]): string {
  const result = redactSignalStudyTextV1(text, names);
  if (!result || typeof result.display_text !== "string" || !result.display_text.trim()) throw new Error("native_audit_text_redaction_failed");
  return result.display_text;
}

function assertInput(args: NativeAuditExportArgsV1): void {
  for (const id of [args.workspace_id, args.actor_user_id, args.listening_before_generation_id, args.listening_after_generation_id, args.study_execution_id]) {
    if (!UUID.test(id)) throw new Error("native_audit_source_identity_invalid");
  }
  if (args.listening_before_generation_id === args.listening_after_generation_id) throw new Error("native_audit_listening_pair_invalid");
}

function privatePath(path: string): string {
  const absolute = resolve(path);
  if (absolute !== PRIVATE_ROOT && !absolute.startsWith(`${PRIVATE_ROOT}${sep}`)) throw new Error("native_audit_paths_must_be_private_r16_data");
  return absolute;
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await rejectSymlinkComponents(dirname(path));
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  let privateDirectory = dirname(path);
  while (privateDirectory.startsWith(`${PRIVATE_ROOT}${sep}`)) {
    await chmod(privateDirectory, 0o700);
    privateDirectory = dirname(privateDirectory);
  }
  await mkdir(PRIVATE_ROOT, { recursive: true, mode: 0o700 });
  await chmod(PRIVATE_ROOT, 0o700);
  await rejectSymlinkComponents(path);
  try { await lstat(path); throw new Error("native_audit_output_exists"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const tempPath = `${path}.${process.pid}.${createHash("sha256").update(String(Date.now())).digest("hex").slice(0, 10)}.tmp`;
  const file = await open(tempPath, "wx", 0o600);
  try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8"); await file.sync(); }
  finally { await file.close(); }
  try { await link(tempPath, path); }
  finally { await unlink(tempPath).catch(() => undefined); }
  const directory = await open(dirname(path), "r");
  try { await directory.sync(); } finally { await directory.close(); }
}

async function rejectSymlinkComponents(path: string): Promise<void> {
  const components = resolve(path).split(sep).filter(Boolean); let at: string = sep;
  for (const component of components) {
    at = resolve(at, component);
    try { if ((await lstat(at)).isSymbolicLink()) throw new Error("native_audit_symlink_path_rejected"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") break; throw error; }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const flags = readFlags(process.argv.slice(2));
  if (process.env.NOISIA_R16_NATIVE_AUDIT_EXPORT_APPROVED !== "1") throw new Error("native_audit_export_explicit_approval_required");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("native_audit_database_url_missing");
  const outputPath = flags.out;
  if (!outputPath) throw new Error("native_audit_export_usage");
  const PgPool = requireStudio("pg").Pool as new (config: Record<string, unknown>) => ReadPoolV1;
  const pool = new PgPool({ connectionString, max: 2, application_name: "noisia-r16-native-audit-export-readonly" });
  try {
    const exported = await exportNativeAuditSnapshotV1({
      database: pool, workspace_id: flags.workspace, actor_user_id: flags.actor,
      listening_before_generation_id: flags["before-generation"], listening_after_generation_id: flags["after-generation"],
      study_execution_id: flags["study-execution"], output_path: outputPath,
      source_manifest_path: flags["source-manifest"] ?? `${outputPath}.source-manifest.json`,
    } as NativeAuditExportArgsV1);
    process.stdout.write(`${JSON.stringify({ exported: true, limitations: exported.limitations.length })}\n`);
  } finally { await pool.end(); }
}

function readFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  const allowed = new Set(["workspace", "actor", "before-generation", "after-generation", "study-execution", "out", "source-manifest"]);
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith("--") || !argv[i + 1] || flags[argv[i]!.slice(2)] || !allowed.has(argv[i]!.slice(2))) throw new Error("native_audit_export_usage");
    flags[argv[i]!.slice(2)] = argv[i + 1]!;
  }
  for (const key of ["workspace", "actor", "before-generation", "after-generation", "study-execution"]) {
    if (!flags[key]) throw new Error("native_audit_export_usage");
  }
  return flags;
}
