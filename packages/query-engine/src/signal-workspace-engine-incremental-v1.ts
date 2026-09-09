import { createHash } from "node:crypto";
import { z } from "zod";

/** Numeric evidence only. This wire grants no provider, Topic alias or approval authority. */
export const SIGNAL_WORKSPACE_INCREMENTAL_INPUT_V1 = "workspace-topic-incremental-input-v1" as const;
export const SIGNAL_WORKSPACE_INCREMENTAL_OUTPUT_V1 = "workspace-topic-incremental-output-v1" as const;
export const SIGNAL_WORKSPACE_INCREMENTAL_POLICY_V1 = "workspace-frozen-model-cohort-v1" as const;
export const SIGNAL_WORKSPACE_INCREMENTAL_PAGE_SIZE_V1 = 128;
export const SIGNAL_WORKSPACE_INCREMENTAL_MODEL_BANK_MAX_BYTES_V1 = 4_294_967_296;
const hash = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const unitKey = z.string().refine(value => /^(open|guided):/u.test(value)
  && uuid.safeParse(value.slice(value.indexOf(":") + 1)).success);
const natural = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const file = z.object({ file: z.string().regex(/^[a-z][a-z0-9_.-]{0,100}$/u), sha256: hash,
  bytes: natural, rows: natural.optional() }).strict();
const compatibility = z.object({ embedding_config_digest: hash, chunk_policy_version: z.literal("corpus-text-chunks-v1"),
  context_digest: hash, input_interest_catalog_digest: hash, guides_digest: hash,
  fit_config_digest: hash, runtime_digest: hash }).strict();
export const signalWorkspaceIncrementalRootSchemaV1 = z.object({ root_id: uuid, root_fingerprint: hash,
  asset_sha256: hash, expected_chunks: natural.refine(value => value > 0),
  chunk_coverage_digest: hash, correction_digest: hash }).strict();
export type SignalWorkspaceIncrementalRootV1 = z.infer<typeof signalWorkspaceIncrementalRootSchemaV1>;
export const signalWorkspaceIncrementalInputSchemaV1 = z.object({
  contract_version: z.literal(SIGNAL_WORKSPACE_INCREMENTAL_INPUT_V1), workspace_id: uuid, execution_id: uuid,
  mode: z.literal("frozen-model-delta"), policy_version: z.literal(SIGNAL_WORKSPACE_INCREMENTAL_POLICY_V1),
  current_input_manifest: file, current_roots: file,
  parent: z.object({ execution_id: uuid, manifest_sha256: hash }).strict(), compatibility,
  discovery: z.object({ cohort_key: hash, close_requested: z.boolean() }).strict()
}).strict();
export type SignalWorkspaceIncrementalInputV1 = z.infer<typeof signalWorkspaceIncrementalInputSchemaV1>;
export type SignalWorkspaceIncrementalTransitionV1 = { root_id: string;
  transition: "unchanged" | "metadata_changed" | "added" | "content_changed" | "removed_or_ineligible";
  prior: SignalWorkspaceIncrementalRootV1 | null; current: SignalWorkspaceIncrementalRootV1 | null };

/** ASCII keys and integer metadata only are used for cross-runtime identity. */
export function signalWorkspaceIncrementalDigestV1(value: unknown): string {
  const ordered = (item: unknown): unknown => Array.isArray(item) ? item.map(ordered)
    : item && typeof item === "object" ? Object.fromEntries(Object.keys(item).sort()
      .map(key => [key, ordered((item as Record<string, unknown>)[key])])) : item;
  return `sha256:${createHash("sha256").update(JSON.stringify(ordered(value))).digest("hex")}`;
}
function roots(value: readonly unknown[]): SignalWorkspaceIncrementalRootV1[] {
  const rows = value.map(row => signalWorkspaceIncrementalRootSchemaV1.parse(row));
  if (rows.some((row, index) => index > 0 && row.root_id <= rows[index - 1]!.root_id)) {
    throw new Error("workspace_engine_incremental_root_order_invalid");
  }
  return rows;
}
/** The caller supplies COMPLETE manifests, not a claimed list of changed roots. */
export function buildSignalWorkspaceIncrementalRootDeltaV1(prior: readonly unknown[], current: readonly unknown[]) {
  const before = roots(prior), after = roots(current), result: SignalWorkspaceIncrementalTransitionV1[] = [];
  let left = 0, right = 0;
  while (left < before.length || right < after.length) {
    const a = before[left], b = after[right];
    if (!b || a && a.root_id < b.root_id) {
      result.push({ root_id: a!.root_id, transition: "removed_or_ineligible", prior: a!, current: null }); left++;
    } else if (!a || b.root_id < a.root_id) {
      result.push({ root_id: b.root_id, transition: "added", prior: null, current: b }); right++;
    } else {
      const contentSame = a.asset_sha256 === b.asset_sha256 && a.expected_chunks === b.expected_chunks
        && a.chunk_coverage_digest === b.chunk_coverage_digest;
      result.push({ root_id: b.root_id, prior: a, current: b, transition: !contentSame ? "content_changed"
        : a.root_fingerprint !== b.root_fingerprint || a.correction_digest !== b.correction_digest ? "metadata_changed" : "unchanged" });
      left++; right++;
    }
  }
  return result;
}
const component = z.object({ component_key: hash, lane: z.enum(["open", "guided"]),
  model_origin: z.object({ execution_id: uuid, model_artifact_sha256: hash }).strict(),
  model: file, center: file.nullable(),
  units: z.array(z.object({ local_label: natural, unit_key: unitKey,
    birth_membership_digest: hash }).strict())
}).strict().superRefine((value, ctx) => {
  if (value.model.sha256 !== value.model_origin.model_artifact_sha256 || value.lane === "guided" && !value.center
    || value.component_key !== signalWorkspaceIncrementalDigestV1([value.model_origin.execution_id, value.model.sha256, value.lane])
    || value.lane === "open" && value.center || value.units.some(row => !row.unit_key.startsWith(`${value.lane}:`))
    || new Set(value.units.map(row => row.local_label)).size !== value.units.length
    || new Set(value.units.map(row => row.unit_key)).size !== value.units.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "workspace_engine_incremental_component_invalid" });
  }
});
export const signalWorkspaceIncrementalMembershipSchemaV1 = z.object({ root_id: uuid, root_fingerprint: hash,
  chunk_index: natural, start: natural, end: natural, chunk_sha256: hash,
  lane: z.enum(["open", "guided"]), unit_key: unitKey, model_component_key: hash, strength: z.number().finite(),
  model_origin: z.object({ execution_id: uuid, model_artifact_sha256: hash }).strict(),
  evaluation_origin: z.object({ execution_id: uuid, input_population_digest: hash, evaluation_key: hash,
    basis: z.enum(["fitted_member", "predicted_member"]) }).strict(),
  carried_from: z.object({ output_manifest_sha256: hash, membership_digest: hash }).strict().nullable()
}).strict().refine(value => value.end > value.start && value.end - value.start <= 1400
  && value.unit_key.startsWith(`${value.lane}:`)
  && value.model_component_key === signalWorkspaceIncrementalDigestV1([value.model_origin.execution_id,
    value.model_origin.model_artifact_sha256, value.lane])
  && value.evaluation_origin.evaluation_key === signalWorkspaceIncrementalDigestV1([value.evaluation_origin.execution_id,
    value.model_component_key, value.evaluation_origin.input_population_digest, value.evaluation_origin.basis])
  && (value.evaluation_origin.basis !== "fitted_member" || value.evaluation_origin.execution_id === value.model_origin.execution_id),
  "workspace_engine_incremental_membership_invalid");
/** JSON exponent spelling differs between Python and JS; seal the exact score bits. */
export function signalWorkspaceIncrementalMembershipDigestV1(value: unknown): string {
  const { strength, ...row } = signalWorkspaceIncrementalMembershipSchemaV1.parse(value);
  const bytes = Buffer.alloc(8);
  bytes.writeDoubleBE(strength);
  return signalWorkspaceIncrementalDigestV1({ ...row, strength_ieee754_be: bytes.toString("hex") });
}
export const signalWorkspaceIncrementalOutputSchemaV1 = z.object({
  contract_version: z.literal(SIGNAL_WORKSPACE_INCREMENTAL_OUTPUT_V1), workspace_id: uuid, execution_id: uuid,
  request_digest: hash, previous_manifest_sha256: hash, compatibility,
  policy_version: z.literal(SIGNAL_WORKSPACE_INCREMENTAL_POLICY_V1),
  status: z.literal("completed"), quality: z.literal("uncalibrated"), approval_policy: z.literal("none"),
  discovery_status: z.enum(["complete", "pending_insufficient_population", "pending_cohort_close"]),
  relations_status: z.enum(["pending", "none"]),
  population_digest: hash, counts: z.object({ roots: natural, occurrences: natural, added_roots: natural,
    content_changed_roots: natural, metadata_changed_roots: natural, unchanged_roots: natural, removed_roots: natural,
    delta_occurrences: natural, cohort_occurrences: natural, pending_occurrences: natural, memberships: natural,
    components: natural, new_components: natural, model_bank_bytes: natural }).strict(),
  components: z.array(component), artifacts: z.array(file),
  coverage: z.array(z.object({ component_key: hash, population_digest: hash, expected_occurrences: natural,
    copied_occurrences: natural, transformed_occurrences: natural, fitted_occurrences: natural }).strict()),
  operations: z.object({ fit: z.array(z.object({ component_key: hash, occurrences: natural,
    population_digest: hash }).strict()), transform: z.array(z.object({ component_key: hash,
    occurrences: natural, pages: natural, maximum_page_rows: natural }).strict()) }).strict(),
  metrics: z.object({ resident_bytes: natural, elapsed_seconds: z.number().finite().nonnegative() }).strict(),
  limitations: z.array(z.string())
}).strict().superRefine((value, ctx) => {
  const bad = () => ctx.addIssue({ code: z.ZodIssueCode.custom, message: "workspace_engine_incremental_manifest_invalid" });
  const n = value.counts;
  if (n.roots !== n.added_roots + n.content_changed_roots + n.metadata_changed_roots + n.unchanged_roots
    || n.roots > n.occurrences || (n.roots === 0) !== (n.occurrences === 0)
    || n.delta_occurrences > n.cohort_occurrences || n.cohort_occurrences > n.occurrences
    || n.pending_occurrences > n.cohort_occurrences
    || (value.discovery_status === "complete") !== (n.pending_occurrences === 0)
    || n.components !== value.components.length || value.coverage.length !== n.components
    || n.new_components !== value.operations.fit.length || n.new_components > n.components
    || n.model_bank_bytes > SIGNAL_WORKSPACE_INCREMENTAL_MODEL_BANK_MAX_BYTES_V1
    || new Set(value.artifacts.map(row => row.file)).size !== value.artifacts.length
    || new Set(value.components.map(row => row.component_key)).size !== n.components) bad();
  const files = new Map(value.artifacts.map(row => [row.file, row]));
  const modelFiles = new Map(value.components.flatMap(model => [model.model, ...(model.center ? [model.center] : [])])
    .map(ref => [ref.file, ref]));
  if ([...modelFiles.values()].reduce((sum, ref) => sum + ref.bytes, 0) !== n.model_bank_bytes) bad();
  for (const name of ["roots.jsonl", "population.jsonl", "root-transitions.jsonl", "memberships.jsonl",
    "model-components.json", "candidate-groups.json", "relations.json", "pending-cohort.jsonl", "guides.jsonl", "guide-vectors.npy"]) {
    if (!files.has(name)) bad();
  }
  for (const model of value.components) {
    for (const ref of [model.model, model.center].filter((row): row is NonNullable<typeof row> => row !== null)) {
      if (files.get(ref.file)?.sha256 !== ref.sha256 || files.get(ref.file)?.bytes !== ref.bytes) bad();
    }
    const coverage = value.coverage.filter(row => row.component_key === model.component_key);
    if (coverage.length !== 1 || coverage[0]!.population_digest !== value.population_digest
      || coverage[0]!.expected_occurrences !== n.occurrences
      || coverage[0]!.copied_occurrences + coverage[0]!.transformed_occurrences + coverage[0]!.fitted_occurrences !== n.occurrences) bad();
  }
  if (value.operations.transform.some(row => row.maximum_page_rows > SIGNAL_WORKSPACE_INCREMENTAL_PAGE_SIZE_V1)) bad();
});
export const parseSignalWorkspaceIncrementalInputV1 = (value: unknown) => signalWorkspaceIncrementalInputSchemaV1.parse(value);
export const parseSignalWorkspaceIncrementalOutputV1 = (value: unknown) => signalWorkspaceIncrementalOutputSchemaV1.parse(value);
