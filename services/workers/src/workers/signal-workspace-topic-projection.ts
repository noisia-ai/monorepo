import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import type { Job } from "bullmq";
import { z } from "zod";
import {
  mergeSignalWorkspaceTopicMaterializationV1, parseSignalWorkspaceInterpretationV1,
  signalTopicDefinitionSchemaV1, signalWorkspaceEmbeddingDigestV1,
  signalWorkspaceClassificationDecisionSchemaV1, signalWorkspaceClassificationResolutionV1,
  signalWorkspaceClassificationReuseKeyV1, signalWorkspaceClassificationTopicSemanticsDigestV1,
  type SignalTopicDefinitionV1, type SignalWorkspaceClassificationDecisionV1,
  type SignalWorkspaceTopicMaterializationMappingV1
} from "@noisia/query-engine";
import { hashWorkspaceEngineFileV1 } from "./signal-workspace-engine-files";
import { createWorkspaceEngineStorageV1, type WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";
import { signalWorkspaceClassificationJobV1, safeWorkspaceClassificationErrorV1,
  type SignalWorkspaceClassificationLeaseV1 as Lease,
  type SignalWorkspaceClassificationStoresV1 as ClassificationStores,
  type SignalWorkspaceClassificationRootV1 as Root } from "./signal-workspace-classification";

export const SIGNAL_WORKSPACE_TOPIC_PROJECTION_JOB_NAME = "signal_workspace_topic_projection_v1";
const digest = signalWorkspaceEmbeddingDigestV1;
const invalid = (): never => { throw new Error("workspace_classification_projection_integrity_invalid"); };
const uuid = z.string().uuid(), hash = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const unit = z.string().regex(/^(open|guided):[A-Za-z0-9_.:-]{1,180}$/u);
const MAX_JSON_BYTES = 64 * 1024 * 1024;
type Lane = "open" | "guided";
export type WorkspaceTopicProjectionArtifactV1 = { artifact_id: string; artifact_key: string; artifact_type: string;
  content: { storage_key: string; sha256: string; size_bytes: number; media_type: string }; metadata: unknown };
export type WorkspaceTopicProjectionSourceV1 = { engine_execution_id: string; materialization_artifact_id: string;
  mapping_digest: string; model_artifact_id: string | null; artifacts: WorkspaceTopicProjectionArtifactV1[];
  interpretation_coverage?: { interpreted_unit_count: number; expected_unit_count: number;
    unit_digest: string; expected_unit_digest: string; complete: boolean } };
export type WorkspaceTopicProjectionStoresV1<Database> = Omit<ClassificationStores<Database>, "claim"> & {
  claim(args: { database: Database; execution_id: string; worker_job_id: string }): Promise<{
    lease: Lease; source: WorkspaceTopicProjectionSourceV1; model_version_id: string | null
  } | null>;
  heartbeat(args: { database: Database; lease: Lease }): Promise<unknown>;
  readTopics(args: { database: Database; lease: Lease; after_term_key: string | null; limit: number }): Promise<{
    items: Array<{ taxonomy_term_id: string; term_key: string; definition_revision: number; definition_digest: string; definition: SignalTopicDefinitionV1 }>;
    next_term_key: string | null; done: boolean
  }>;
  readProposals(args: { database: Database; lease: Lease; after_artifact_id: string | null; limit: number }): Promise<{
    items: WorkspaceTopicProjectionArtifactV1[]; next_artifact_id: string | null; done: boolean
  }>;
  readCorrections(args: { database: Database; lease: Lease; root_id: string }): Promise<SignalWorkspaceClassificationDecisionV1[]>;
};
type Options<Database> = { database: Database; stores: WorkspaceTopicProjectionStoresV1<Database>;
  storage: WorkspaceEngineStorageV1; scratch_root?: string };
const occurrenceSchema = z.object({ ordinal: z.number().int().nonnegative(), root_id: uuid,
  chunk_index: z.number().int().nonnegative(), start: z.number().int().nonnegative(), end: z.number().int().positive(),
  chunk_sha256: hash, stable_cluster_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,180}$/u).nullable(),
  local_label: z.number().int().min(-1), strength: z.number().finite().min(0).max(1) }).passthrough();
type Occurrence = z.infer<typeof occurrenceSchema>;
const rootSchema = z.object({ root_id: uuid, root_fingerprint: hash, chunk_count: z.number().int().positive(),
  open: z.array(z.string()), guided: z.array(z.string()) }).strict();
type Mapped = SignalWorkspaceTopicMaterializationMappingV1 & { topic: { taxonomy_term_id: string; definition: SignalTopicDefinitionV1 };
  proposal_semantics_digest: string; eligible: boolean; archived: boolean };
const occurrenceIdentity = (row: Occurrence) => ({ ordinal: row.ordinal, root_id: row.root_id,
  chunk_index: row.chunk_index, start: row.start, end: row.end, chunk_sha256: row.chunk_sha256 });
const unitDigest = (keys: Iterable<string>) => `sha256:${createHash("sha256")
  .update([...keys].sort().map(key => JSON.stringify(key) + "\n").join("")).digest("hex")}`;

/** Interpretations have already been paid for and persisted. This job only
 * projects their verified numerical memberships into the native root ledger.
 * Files are streamed, decisions are sparse, and no provider/fit is reachable. */
export async function signalWorkspaceTopicProjectionJobV1<Database>(
  job: Pick<Job<{ execution_id: string }>, "id" | "data" | "updateProgress">,
  options?: Options<Database>
) {
  const opts = options ?? await defaultOptions() as unknown as Options<Database>;
  const { database, stores: store } = opts;
  if (!job.id || !uuid.safeParse(job.data?.execution_id).success) throw new Error("workspace_classification_job_invalid");
  const claimed = await store.claim({ database, execution_id: job.data.execution_id, worker_job_id: job.id })
    .catch(error => { throw new Error(safeWorkspaceClassificationErrorV1(error)); });
  if (!claimed) return { execution_id: job.data.execution_id, replayed: true };
  let activeLease = claimed.lease;
  let directory: string | undefined;
  let heartbeatError: unknown, heartbeatPending: Promise<unknown> | null = null;
  const heartbeat = async () => {
    if (heartbeatError) throw heartbeatError;
    if (heartbeatPending) return heartbeatPending;
    heartbeatPending = store.heartbeat({ database, lease: activeLease });
    try { return await heartbeatPending; } catch (error) { heartbeatError = error; throw error; }
    finally { heartbeatPending = null; }
  };
  const timer = setInterval(() => { void heartbeat().catch(() => undefined); }, 15000);
  timer.unref();
  const readers: Array<AsyncGenerator<unknown>> = [];
  try {
    if (claimed.lease.execution_id !== job.data.execution_id) invalid();
    directory = await mkdtemp(join(opts.scratch_root ?? tmpdir(), "noisia-topic-projection-"));
    const { source } = claimed;
    uuid.parse(source.engine_execution_id); uuid.parse(source.materialization_artifact_id); hash.parse(source.mapping_digest);
    const refs = new Map<string, WorkspaceTopicProjectionArtifactV1>();
    for (const ref of source.artifacts) {
      if (refs.has(ref.artifact_key)) invalid();
      refs.set(ref.artifact_key, ref);
    }
    const get = async (ref: WorkspaceTopicProjectionArtifactV1) => {
      uuid.parse(ref.artifact_id); hash.parse(ref.content.sha256);
      if (!/^[a-z][a-z0-9_.-]{0,100}$/u.test(ref.artifact_key) || ref.artifact_key.includes("..")) invalid();
      await heartbeat();
      const path = join(directory!, ref.artifact_key);
      await opts.storage.get({ workspace_id: activeLease.workspace_id, execution_id: source.engine_execution_id,
        stored: ref.content, destination: path });
      const stat = await lstat(path);
      if (!stat.isFile() || stat.size !== ref.content.size_bytes || await hashWorkspaceEngineFileV1(path) !== ref.content.sha256) invalid();
      await heartbeat(); return path;
    };
    const manifest = await json(await get(refs.get("manifest.json") ?? invalid()), 1024 * 1024);
    if (manifest.contract_version !== "workspace-topic-engine-output-v1" || manifest.workspace_id !== activeLease.workspace_id
      || manifest.quality !== "uncalibrated" || manifest.approval_policy !== "none") invalid();
    const counts = z.object({ occurrences: z.number().int().nonnegative(), roots: z.number().int().nonnegative() })
      .passthrough().parse(manifest.counts);
    const lanes = z.array(z.object({ lane: z.enum(["open", "guided"]), assignments_file: z.string(),
      occurrences: z.number().int().nonnegative(), roots: z.number().int().nonnegative(),
      clusters: z.number().int().nonnegative(), outlier_occurrences: z.number().int().nonnegative().optional() }).passthrough())
      .min(1).max(2).parse(manifest.lanes);
    if (!lanes.some(item => item.lane === "open") || new Set(lanes.map(item => item.lane)).size !== lanes.length
      || lanes.some(item => item.occurrences !== counts.occurrences || item.roots !== counts.roots)) invalid();
    const manifestArtifacts = z.array(z.object({ file: z.string(), sha256: hash, bytes: z.number().int().nonnegative() })).parse(manifest.artifacts);
    const rootsRef = refs.get("roots.jsonl") ?? invalid();
    const assignments = new Map<Lane, { path: string; ref: WorkspaceTopicProjectionArtifactV1 }>();
    for (const lane of lanes) {
      if (lane.assignments_file !== `assignments.${lane.lane}.jsonl`) invalid();
      const ref = refs.get(lane.assignments_file) ?? invalid();
      assignments.set(lane.lane, { path: await get(ref), ref });
    }
    for (const ref of [rootsRef, ...[...assignments.values()].map(item => item.ref)]) {
      const entry = manifestArtifacts.filter(item => item.file === ref.artifact_key);
      if (entry.length !== 1 || entry[0]!.sha256 !== ref.content.sha256 || entry[0]!.bytes !== ref.content.size_bytes) invalid();
    }
    const rootsPath = await get(rootsRef);
    const materializationRefs = [...refs.values()].filter(ref => ref.artifact_id === source.materialization_artifact_id);
    if (materializationRefs.length !== 1) invalid();
    const materializationRef = materializationRefs[0]!;
    const progressive = /^materialization-progress-[0-9a-f-]{36}\.json$/u.test(materializationRef.artifact_key);
    if (!progressive && materializationRef.artifact_key !== "materialization.json") invalid();
    const materialization = await json(await get(materializationRef), MAX_JSON_BYTES);
    const mappings = z.array(z.object({ unit_key: unit, term_key: z.string(), status: z.enum(["coherent", "mixed", "insufficient"]),
      cluster_digest: hash, definition_digest: hash, proposal_artifact_id: uuid }).strict()).parse(materialization.mapping);
    if (digest(mappings) !== source.mapping_digest || new Set(mappings.map(item => item.unit_key)).size !== mappings.length
      || new Set(mappings.map(item => item.term_key)).size !== mappings.length) invalid();
    const coverage = source.interpretation_coverage === undefined ? undefined : z.object({
      interpreted_unit_count: z.number().int().nonnegative(), expected_unit_count: z.number().int().nonnegative(),
      unit_digest: hash, expected_unit_digest: hash, complete: z.boolean()
    }).strict().parse(source.interpretation_coverage);
    if (coverage && (coverage.interpreted_unit_count !== mappings.length
      || coverage.unit_digest !== unitDigest(mappings.map(item => item.unit_key))
      || coverage.expected_unit_count < mappings.length
      || coverage.complete !== (coverage.expected_unit_count === mappings.length)
      || coverage.complete && coverage.unit_digest !== coverage.expected_unit_digest)) invalid();
    if (progressive && (!coverage || materialization.contract_version !== "workspace-topic-materialization-progress-v1"
      || materialization.execution_id !== source.engine_execution_id
      || materialization.interpreted_unit_count !== coverage.interpreted_unit_count
      || materialization.interpretation_units_digest !== coverage.unit_digest
      || materialization.expected_interpretation_unit_count !== coverage.expected_unit_count
      || materialization.expected_interpretation_units_digest !== coverage.expected_unit_digest
      || materialization.interpretation_complete !== coverage.complete
      || materialization.mapping_digest !== source.mapping_digest)) invalid();
    if (!progressive && coverage && !coverage.complete) invalid();
    const topics = new Map<string, { taxonomy_term_id: string; definition: SignalTopicDefinitionV1 }>();
    const requiredTopics = new Set(mappings.map(item => item.term_key));
    let afterTerm: string | null = null;
    for (;;) {
      const page = await store.readTopics({ database, lease: activeLease, after_term_key: afterTerm, limit: 128 });
      if (page.items.length > 128 || !page.done && !page.items.length) invalid();
      for (const item of page.items) {
        const definition = signalTopicDefinitionSchemaV1.parse(item.definition); uuid.parse(item.taxonomy_term_id);
        if (afterTerm !== null && item.term_key <= afterTerm || item.term_key !== definition.term_key
          || item.definition_digest !== definition.definition_digest || item.definition_revision !== definition.definition_revision) invalid();
        if (requiredTopics.has(item.term_key)) topics.set(item.term_key, { taxonomy_term_id: item.taxonomy_term_id, definition });
        afterTerm = item.term_key;
      }
      if (page.next_term_key !== afterTerm) invalid();
      if (page.done) break;
    }
    const original = new Map<string, { semantics: string; artifact_id: string; cluster_digest: string; status: string }>();
    const requiredProposals = new Set(mappings.map(item => item.proposal_artifact_id));
    let afterArtifact: string | null = null;
    for (;;) {
      const page = await store.readProposals({ database, lease: activeLease, after_artifact_id: afterArtifact, limit: 32 });
      if (page.items.length > 32 || !page.done && !page.items.length) invalid();
      for (const ref of page.items) {
        if (afterArtifact !== null && ref.artifact_id <= afterArtifact) invalid(); afterArtifact = ref.artifact_id;
        // New batches may have settled after this projection was sealed. They
        // belong to a later catalog version, never this mapping's evidence.
        if (progressive && !requiredProposals.has(ref.artifact_id)) continue;
        const proposal = await json(await get(ref), 2 * 1024 * 1024);
        if (proposal.contract_version !== "workspace-engine-interpretation-result-v1" || proposal.execution_id !== source.engine_execution_id
          || !Array.isArray(proposal.interpretations)) invalid();
        for (const raw of z.array(z.unknown()).parse(proposal.interpretations)) {
          const result = parseSignalWorkspaceInterpretationV1(raw);
          if (original.has(result.cluster_id)) invalid();
          // A generic insufficient placeholder supplies no interpreted meaning.
          const fresh = mergeSignalWorkspaceTopicMaterializationV1({ prior: [], interpretations: [{ result, artifact_id: ref.artifact_id }],
            execution_id: source.engine_execution_id, now: "2000-01-01T00:00:00.000Z", locale: "es-MX" }).definitions[0]!;
          original.set(result.cluster_id, { semantics: signalWorkspaceClassificationTopicSemanticsDigestV1(fresh),
            artifact_id: ref.artifact_id, cluster_digest: result.cluster_digest, status: result.status });
        }
      }
      if (page.next_artifact_id !== afterArtifact) invalid();
      if (page.done) break;
    }
    if (original.size !== mappings.length) invalid();
    const mapped = new Map<string, Mapped>();
    for (const row of mappings) {
      const topic = topics.get(row.term_key) ?? invalid(), proposal = original.get(row.unit_key) ?? invalid();
      if (topic.definition.definition_digest !== row.definition_digest || proposal.artifact_id !== row.proposal_artifact_id
        || proposal.cluster_digest !== row.cluster_digest || proposal.status !== row.status) invalid();
      mapped.set(row.unit_key, { ...row, topic, proposal_semantics_digest: proposal.semantics,
        archived: topic.definition.lifecycle === "archived",
        eligible: row.status !== "insufficient" && proposal.semantics === signalWorkspaceClassificationTopicSemanticsDigestV1(topic.definition) });
    }
    // Reconcile ALL assignment identities, clusters, root fingerprints and EOF
    // before writing the first item. This also validates the already committed
    // prefix during recovery; no old checkpoint can conceal a truncated file.
    await verifyCensus(rootsPath, assignments, lanes, counts, mapped, heartbeat, coverage);
    const rootRows = records(rootsPath, rootSchema); readers.push(rootRows);
    const laneRows = new Map([...assignments].map(([lane, entry]) => {
      const stream = records(entry.path, occurrenceSchema); readers.push(stream); return [lane, stream] as const;
    }));
    let nextRoot = await rootRows.next();
    const skipTo = async (rootId: string) => {
      while (!nextRoot.done && nextRoot.value.root_id < rootId) {
        for (let i = 0; i < nextRoot.value.chunk_count; i++) for (const stream of laneRows.values()) if ((await stream.next()).done) invalid();
        nextRoot = await rootRows.next();
      }
    };
    const readMemberships = async (root: Root, chunks: AsyncIterable<ReadonlyArray<{ chunk_index: number; start: number; end: number; chunk_sha256: string }>>) => {
      await skipTo(root.root_id);
      if (nextRoot.done || nextRoot.value.root_id !== root.root_id || nextRoot.value.root_fingerprint !== root.fingerprint
        || nextRoot.value.chunk_count !== root.expected_chunks) invalid();
      const membership = new Map<string, { count: number; evidence: ReturnType<typeof createHash>;
        first: { chunk_index: number; start: number; end: number; chunk_sha256: string } }>();
      let processed = 0;
      for await (const page of chunks) for (const chunk of page) {
        for (const [lane, stream] of laneRows) {
          const entry = await stream.next(); if (entry.done) invalid(); const row = entry.value;
          if (row.root_id !== root.root_id || row.chunk_index !== chunk.chunk_index || row.start !== chunk.start
            || row.end !== chunk.end || row.chunk_sha256 !== chunk.chunk_sha256) invalid();
          if (row.stable_cluster_id !== null) {
            const key = `${lane}:${row.stable_cluster_id}`, item = membership.get(key) ?? { count: 0, evidence: createHash("sha256"),
              first: { chunk_index: row.chunk_index, start: row.start, end: row.end, chunk_sha256: row.chunk_sha256 } };
            item.count++; item.evidence.update(JSON.stringify(occurrenceIdentity(row)) + "\n"); membership.set(key, item);
          }
        }
        processed++;
      }
      nextRoot = await rootRows.next();
      return { membership, processed };
    };
    const advance = async (promise: Promise<Lease>) => { const next = await promise; activeLease = next; return next; };
    let pageRoots = new Map<string, Root>();
    const classification: ClassificationStores<Database> = { ...store,
      claim: async () => activeLease,
      readRoots: async args => {
        const page = await store.readRoots(args); pageRoots = new Map(page.items.map(root => [root.root_id, root])); return page;
      },
      commitRoot: args => advance(store.commitRoot(args)),
      copyRoot: async args => {
        const root = pageRoots.get(args.root_id) ?? invalid(); await skipTo(root.root_id);
        if (nextRoot.done || nextRoot.value.root_id !== root.root_id || nextRoot.value.root_fingerprint !== root.fingerprint
          || nextRoot.value.chunk_count !== root.expected_chunks) invalid();
        const coverage = createHash("sha256");
        for (let i = 0; i < root.expected_chunks; i++) for (const [lane, stream] of laneRows) {
          const next = await stream.next(); if (next.done) invalid(); const row = next.value;
          if (row.root_id !== root.root_id || row.chunk_index !== i) invalid();
          if (lane === "open") coverage.update(JSON.stringify([i, row.start, row.end, row.chunk_sha256]) + "\n");
        }
        if (`sha256:${coverage.digest("hex")}` !== root.chunk_coverage_digest) invalid();
        nextRoot = await rootRows.next();
        return advance(store.copyRoot(args));
      },
      finish: async args => {
        // A copied or pre-checkpoint suffix may not have requested chunks again.
        while (!nextRoot.done && args.lease.cursor_root_id !== null && nextRoot.value.root_id <= args.lease.cursor_root_id) {
          for (let i = 0; i < nextRoot.value.chunk_count; i++) for (const stream of laneRows.values()) if ((await stream.next()).done) invalid();
          nextRoot = await rootRows.next();
        }
        if (!nextRoot.done) invalid();
        for (const stream of laneRows.values()) if (!(await stream.next()).done) invalid();
        await heartbeat(); return store.finish(args);
      }
    };
    // Root/chunk stores renew the lease themselves. A concurrent preparation
    // heartbeat must not race an atomic root commit with its preceding cursor.
    clearInterval(timer); await heartbeatPending;
    return await signalWorkspaceClassificationJobV1(job, { database, stores: classification, engine: {
      ...activeLease.identity,
      classifyRoot: async ({ identity, root, chunks }) => {
        const { membership, processed } = await readMemberships(root, chunks);
        const decisions = new Map<string, SignalWorkspaceClassificationDecisionV1>();
        const computedEvidence: Array<{ unit_key: string; evidence_digest: string; matched_chunks: number; semantic_current: boolean; archived: boolean }> = [];
        let unresolved = false, interpretationPending = false;
        for (const [key, entry] of membership) {
          const item = mapped.get(key), evidence_digest = `sha256:${entry.evidence.digest("hex")}`;
          if (!item) {
            if (!coverage || coverage.complete) invalid();
            unresolved = true; interpretationPending = true;
            computedEvidence.push({ unit_key: key, evidence_digest, matched_chunks: entry.count, semantic_current: false, archived: false });
            continue;
          }
          computedEvidence.push({ unit_key: key, evidence_digest, matched_chunks: entry.count, semantic_current: item.eligible, archived: item.archived });
          // Archival is an explicit operator decision. Reconcile the evidence
          // without reopening it as a review task or attributing membership.
          if (item.archived) continue;
          if (!item.eligible) { unresolved = true; continue; }
          if (!claimed.model_version_id) invalid();
          decisions.set(item.term_key, { taxonomy_term_id: item.topic.taxonomy_term_id, term_key: item.term_key,
            definition_revision: item.topic.definition.definition_revision, definition_digest: item.definition_digest,
            disposition: "pending", resolution_method: "model", model_version_id: claimed.model_version_id,
            labeling_function_version_id: null, approval_policy_id: null, decided_by_user_id: null, correction_operation_id: null,
            score: null, evidence_digest, lineage_digest: digest({ materialization: source.materialization_artifact_id,
              engine: source.engine_execution_id, unit: key, cluster_digest: item.cluster_digest }),
            membership_basis: "computed_cluster", membership_metadata: {
              contract_version: "workspace-computed-cluster-membership-v1", engine_execution_id: source.engine_execution_id,
              materialization_artifact_id: source.materialization_artifact_id,
              assignment_artifact_ids: [assignments.get(key.startsWith("open:") ? "open" : "guided")!.ref.artifact_id],
              unit_keys: [key], proposal_semantics_digest: item.proposal_semantics_digest,
              materialized_definition_digest: item.definition_digest, evidence_fragment: entry.first, matched_chunks: entry.count
            } });
        }
        for (const raw of await store.readCorrections({ database, lease: activeLease, root_id: root.root_id })) {
          const correction = signalWorkspaceClassificationDecisionSchemaV1.parse(raw);
          if (correction.resolution_method !== "human" || correction.membership_basis) invalid();
          decisions.set(correction.term_key, correction);
        }
        const values = [...decisions.values()].sort((a, b) => a.term_key < b.term_key ? -1 : 1);
        const rootIdentity = { root_id: root.root_id, fingerprint: root.fingerprint, correction_digest: root.correction_digest };
        return { contract_version: "signal-workspace-classification-v1", root: rootIdentity,
          reuse_key: signalWorkspaceClassificationReuseKeyV1(identity, rootIdentity),
          resolution_state: signalWorkspaceClassificationResolutionV1(values, unresolved), has_unresolved_topics: unresolved,
          reason_code: interpretationPending ? "computed_cluster_interpretation_pending"
            : unresolved ? "computed_cluster_semantics_stale" : membership.size ? "computed_cluster_membership" : "computed_cluster_outlier",
          technical_error_code: null, evidence_digest: digest({ root: rootIdentity, membership: computedEvidence,
            corrections: values.filter(value => value.resolution_method === "human").map(value => value.evidence_digest) }),
          coverage: { expected_chunks: root.expected_chunks, processed_chunks: processed, chunk_coverage_digest: root.chunk_coverage_digest },
          decisions: values };
      }
    } });
  } catch (error) {
    const code = safeWorkspaceClassificationErrorV1(error);
    await store.fail({ database, lease: activeLease, error_code: code }).catch(() => undefined);
    throw new Error(code);
  } finally {
    clearInterval(timer); await Promise.resolve().then(() => heartbeatPending).catch(() => undefined);
    for (const reader of readers) await reader.return(undefined).catch(() => undefined);
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

async function json(path: string, limit: number): Promise<Record<string, unknown>> {
  if ((await lstat(path)).size > limit) throw new Error("workspace_classification_projection_capacity_exceeded");
  try { return z.record(z.unknown()).parse(JSON.parse(await readFile(path, "utf8"))); } catch { return invalid(); }
}
async function* records<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): AsyncGenerator<T> {
  const stream = createReadStream(path), lines = createInterface({ input: stream, crlfDelay: Infinity });
  try { for await (const line of lines) {
    if (!line || line.length > 8 * 1024 * 1024) invalid();
    try { yield schema.parse(JSON.parse(line)); } catch { invalid(); }
  } } finally { lines.close(); stream.destroy(); }
}
async function verifyCensus(rootsPath: string, assignments: Map<Lane, { path: string; ref: WorkspaceTopicProjectionArtifactV1 }>,
  lanes: Array<{ lane: Lane; clusters: number; outlier_occurrences?: number }>,
  counts: { roots: number; occurrences: number }, mapped: Map<string, Mapped>, heartbeat: () => Promise<unknown>,
  coverage?: WorkspaceTopicProjectionSourceV1['interpretation_coverage']) {
  const streams = new Map([...assignments].map(([lane, item]) => [lane, records(item.path, occurrenceSchema)] as const));
  const census = new Map<string, { hash: ReturnType<typeof createHash>; label: number }>();
  const outliers = { open: 0, guided: 0 }; let roots = 0, occurrences = 0, lastRoot = "";
  try {
    for await (const root of records(rootsPath, rootSchema)) {
      if (root.root_id <= lastRoot) invalid(); lastRoot = root.root_id; roots++;
      const memberships = { open: new Set<string>(), guided: new Set<string>() }; let end = 0;
      for (let index = 0; index < root.chunk_count; index++) {
        let first: Occurrence | undefined;
        for (const [lane, stream] of streams) {
          const next = await stream.next(); if (next.done) invalid(); const row = next.value;
          if (row.root_id !== root.root_id || row.chunk_index !== index || row.ordinal !== occurrences || row.start !== end
            || row.end <= row.start || row.end - row.start > 1400 || first && digest(occurrenceIdentity(first)) !== digest(occurrenceIdentity(row))) invalid();
          first = row;
          if (row.stable_cluster_id === null) { if (row.local_label !== -1) invalid(); outliers[lane]++; }
          else {
            if (row.local_label < 0) invalid();
            const key = `${lane}:${row.stable_cluster_id}`;
            if (!mapped.has(key) && (!coverage || coverage.complete)) invalid();
            memberships[lane].add(row.stable_cluster_id);
            const old = census.get(key) ?? { hash: createHash("sha256"), label: row.local_label };
            if (old.label !== row.local_label) invalid(); old.hash.update(JSON.stringify(occurrenceIdentity(row)) + "\n"); census.set(key, old);
          }
        }
        end = (first ?? invalid()).end; occurrences++;
      }
      for (const lane of ["open", "guided"] as const) {
        if (new Set(root[lane]).size !== root[lane].length || digest([...memberships[lane]].sort()) !== digest([...root[lane]].sort())) invalid();
      }
      if (roots % 1000 === 0) await heartbeat();
    }
    if (roots !== counts.roots || occurrences !== counts.occurrences || census.size !== (coverage?.expected_unit_count ?? mapped.size)) invalid();
    if (coverage && unitDigest(census.keys()) !== coverage.expected_unit_digest) invalid();
    for (const key of mapped.keys()) if (!census.has(key)) invalid();
    for (const [key, entry] of census) {
      const clusterDigest = `sha256:${entry.hash.digest("hex")}`, mapping = mapped.get(key);
      if (mapping && clusterDigest !== mapping.cluster_digest) invalid();
    }
    for (const lane of lanes) {
      const entries = [...census].filter(([key]) => key.startsWith(`${lane.lane}:`));
      if (entries.length !== lane.clusters || new Set(entries.map(([, value]) => value.label)).size !== entries.length
        || lane.outlier_occurrences !== undefined && lane.outlier_occurrences !== outliers[lane.lane]) invalid();
    }
    for (const stream of streams.values()) if (!(await stream.next()).done) invalid();
    await heartbeat();
  } finally { for (const stream of streams.values()) await stream.return(undefined); }
}

async function defaultOptions(): Promise<Options<import("@noisia/db").SignalWorkspaceClassificationDatabaseV1>> {
  const db = await import("@noisia/db"), { pool: database } = await import("../db/client");
  return { database, storage: createWorkspaceEngineStorageV1(), stores: {
    claim: db.claimSignalWorkspaceTopicProjectionV1, heartbeat: db.heartbeatSignalWorkspaceTopicProjectionV1,
    readTopics: db.readSignalWorkspaceTopicProjectionTopicsV1, readProposals: db.readSignalWorkspaceTopicProjectionProposalsV1,
    readCorrections: db.readSignalWorkspaceClassificationCorrectionsV1,
    readRoots: db.readSignalWorkspaceClassificationRootPageV1, readChunks: db.readSignalWorkspaceClassificationChunkPageV1,
    copyRoot: db.copySignalWorkspaceClassificationRootV1, commitRoot: db.commitSignalWorkspaceClassificationRootV1,
    finish: db.finishSignalWorkspaceClassificationV1, fail: db.failSignalWorkspaceClassificationV1
  } };
}
