import { z } from "zod";
import { buildSignalTopicEditorialRepairRequestV1, signalTopicEditorialSemanticRepairErrorV1,
  type SignalTopicEditorialRepairBindingV1 } from "./signal-topic-consolidation-editorial-repair-v1";
import {
  SIGNAL_TOPIC_EDITORIAL_SCREENING_CONFIGURATION_V1,
  SIGNAL_TOPIC_EDITORIAL_SCREENING_MODEL_V1,
  buildSignalTopicEditorialGlobalReviewV1,
  buildSignalTopicEditorialScreeningPlanV1,
  signalTopicEditorialDigestV1,
  signalTopicEditorialGlobalOutputSchemaV1,
  signalTopicEditorialScreeningOutputSchemaV1,
  validateSignalTopicEditorialGlobalResultV1,
  validateSignalTopicEditorialScreeningCoverageV1,
  validateSignalTopicEditorialScreeningOutputV1,
  type SignalTopicEditorialGlobalResultV1,
  type SignalTopicEditorialGlobalReviewV1,
  type SignalTopicEditorialScreeningGroupV1,
  type SignalTopicEditorialScreeningOutputV1,
  type SignalTopicEditorialScreeningPlanV1,
  type SignalTopicEditorialScreeningResultV1,
} from "./signal-topic-consolidation-editorial-v1";

export const SIGNAL_TOPIC_EDITORIAL_RUNNER_CONTRACT_V1 = "signal-topic-editorial-runner-v1" as const;

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const executionKeyPattern = /^[A-Za-z0-9_.:-]{1,240}$/u;
const groupKeyPattern = /^(open|guided):[A-Za-z0-9_.:-]{1,180}$/u;
const fail = (code: string): never => { throw new Error(code); };
const exactDigest = (value: unknown, code: string) =>
  typeof value === "string" && digestPattern.test(value) ? value : fail(code);
const natural = (value: unknown, code: string, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max ? Number(value) : fail(code);

export type SignalTopicEditorialRunnerProviderRequestV1 = Readonly<{
  contract_version: "signal-topic-editorial-provider-request-v1";
  phase: "screening" | "global";
  idempotency_key: string;
  model: typeof SIGNAL_TOPIC_EDITORIAL_SCREENING_MODEL_V1;
  request_digest: string;
  request_body: string;
  repair?: SignalTopicEditorialRepairBindingV1;
}>;

/** The caller owns transport and credentials. This contract intentionally exposes neither. */
export interface SignalTopicEditorialRunnerProviderV1 {
  complete(request: SignalTopicEditorialRunnerProviderRequestV1): Promise<unknown>;
}

export type SignalTopicEditorialRunnerStateV1 = {
  contract_version: typeof SIGNAL_TOPIC_EDITORIAL_RUNNER_CONTRACT_V1;
  execution_key: string;
  plan_digest: string;
  phase: "screening" | "global" | "completed";
  screening_outputs: SignalTopicEditorialScreeningOutputV1[];
  global: null | { request_digest: string; result: SignalTopicEditorialGlobalResultV1 };
  state_digest: string;
};

export interface SignalTopicEditorialRunnerStoreV1 {
  load(executionKey: string): Promise<unknown | null>;
  save(input: Readonly<{
    execution_key: string;
    expected_state_digest: string | null;
    state: SignalTopicEditorialRunnerStateV1;
  }>): Promise<void>;
}

export type SignalTopicEditorialRunnerConfigurationV1 = Readonly<{
  model?: typeof SIGNAL_TOPIC_EDITORIAL_SCREENING_MODEL_V1;
  max_screening_batches_per_run?: number;
}>;

export type SignalTopicEditorialRunnerResultV1 =
  | { status: "screening_pending"; state: SignalTopicEditorialRunnerStateV1; pending_batch_count: number }
  | { status: "completed"; state: SignalTopicEditorialRunnerStateV1; screening: SignalTopicEditorialScreeningResultV1;
      review: SignalTopicEditorialGlobalReviewV1; result: SignalTopicEditorialGlobalResultV1 };

const stateBodySchema = z.object({
  contract_version: z.literal(SIGNAL_TOPIC_EDITORIAL_RUNNER_CONTRACT_V1),
  execution_key: z.string(), plan_digest: z.string(), phase: z.enum(["screening", "global", "completed"]),
  screening_outputs: z.array(signalTopicEditorialScreeningOutputSchemaV1),
  global: z.object({ request_digest: z.string(), result: signalTopicEditorialGlobalOutputSchemaV1 }).strict().nullable(),
}).strict();
const stateSchema = stateBodySchema.extend({ state_digest: z.string() }).strict();
type StateBody = z.infer<typeof stateBodySchema>;

function sealState(body: StateBody): SignalTopicEditorialRunnerStateV1 {
  return { ...body, state_digest: signalTopicEditorialDigestV1(body) };
}

function validatePlan(plan: SignalTopicEditorialScreeningPlanV1) {
  const { plan_digest, ...body } = plan;
  if (signalTopicEditorialDigestV1(body) !== exactDigest(plan_digest, "topic_editorial_runner_plan_invalid")
    || plan.model !== SIGNAL_TOPIC_EDITORIAL_SCREENING_MODEL_V1
    || natural(plan.expected_group_count, "topic_editorial_runner_plan_invalid", 5_000) < 1
    || natural(plan.batch_size, "topic_editorial_runner_plan_invalid", 60) < 10
    || plan.batches.length !== Math.ceil(plan.expected_group_count / plan.batch_size)
    || !digestPattern.test(plan.source_context_digest) || !digestPattern.test(plan.editorial_context_digest))
    fail("topic_editorial_runner_plan_invalid");
  const groupKeys: string[] = [], batchKeys = new Set<string>();
  for (let index = 0; index < plan.batches.length; index++) {
    const batch = plan.batches[index]!;
    if (batch.batch_index !== index || batch.contract_version !== "signal-topic-editorial-screening-batch-v1"
      || batch.model !== plan.model || batch.source_context_digest !== plan.source_context_digest
      || batch.editorial_context_digest !== plan.editorial_context_digest
      || signalTopicEditorialDigestV1(batch.configuration) !== signalTopicEditorialDigestV1(SIGNAL_TOPIC_EDITORIAL_SCREENING_CONFIGURATION_V1)
      || signalTopicEditorialDigestV1({ request_body: batch.request_body, configuration: batch.configuration,
        group_receipts: batch.group_receipts }) !== batch.request_digest
      || batch.group_keys.length < 1 || batch.group_keys.length > plan.batch_size
      || batch.group_receipts.length !== batch.group_keys.length || !digestPattern.test(batch.request_digest)
      || batch.batch_key !== `topic-consolidation-screen-v1:${index}:${batch.request_digest.slice(7, 23)}`
      || batchKeys.has(batch.batch_key) || Buffer.byteLength(batch.request_body, "utf8") > 1_500_000)
      fail("topic_editorial_runner_plan_invalid");
    batchKeys.add(batch.batch_key);
    const receipts = new Set(batch.group_receipts.map(item => item.group_key));
    if (receipts.size !== batch.group_keys.length || batch.group_keys.some(key => !receipts.has(key) || !groupKeyPattern.test(key))
      || batch.group_receipts.some(item => !digestPattern.test(item.group_digest) || !digestPattern.test(item.source_dossier_digest) || !digestPattern.test(item.dossier_digest)
        || (() => { try { return Intl.getCanonicalLocales(item.expected_locale)[0] !== item.expected_locale; } catch { return true; } })()
        || item.evidence_ref_ids.length > 10 || new Set(item.evidence_ref_ids).size !== item.evidence_ref_ids.length
        || item.evidence_ref_ids.some(ref => !digestPattern.test(ref))))
      fail("topic_editorial_runner_plan_invalid");
    groupKeys.push(...batch.group_keys);
    let sourceGroups: unknown;
    try { sourceGroups = JSON.parse(batch.source_groups_body); } catch { fail("topic_editorial_runner_source_groups_invalid"); }
    if (!Array.isArray(sourceGroups) || sourceGroups.length !== batch.group_keys.length
      || sourceGroups.some((group, index) => group?.group_key !== batch.group_keys[index]))
      fail("topic_editorial_runner_source_groups_invalid");
  }
  if (groupKeys.length !== plan.expected_group_count || new Set(groupKeys).size !== groupKeys.length)
    fail("topic_editorial_runner_group_coverage_invalid");
  return groupKeys;
}

function validateGroupsBeforeProvider(plan: SignalTopicEditorialScreeningPlanV1,
  groups: SignalTopicEditorialScreeningGroupV1[], groupKeys: string[]) {
  const expected = new Set(groupKeys);
  if (groups.length !== groupKeys.length || new Set(groups.map(item => item.group_key)).size !== groups.length
    || groups.some(item => !expected.has(item.group_key))) fail("topic_editorial_runner_group_coverage_invalid");
  // Rebuild the canonical string envelope from separately supplied groups. This
  // validates source_groups_body, its coverage and every request digest without
  // putting floating point dossier fields into a SQL JSON digest.
  let rebuilt: SignalTopicEditorialScreeningPlanV1;
  try {
    const body = JSON.parse(plan.batches[0]!.request_body) as { messages: Array<{ content: string }> };
    const context = JSON.parse(body.messages[0]!.content).context as Parameters<typeof buildSignalTopicEditorialScreeningPlanV1>[0]["context"];
    rebuilt = buildSignalTopicEditorialScreeningPlanV1({ expected_group_count: plan.expected_group_count,
      source_context_digest: plan.source_context_digest, editorial_context_digest: plan.editorial_context_digest,
      context, groups, batch_size: plan.batch_size });
  } catch { return fail("topic_editorial_runner_source_groups_invalid"); }
  if (rebuilt.plan_digest !== plan.plan_digest) fail("topic_editorial_runner_source_groups_invalid");
  const decisions = [...groupKeys].sort().map(group_key => ({ group_key, disposition: "noise" as const,
    candidate: null, confidence: null, rationale: null, cited_ref_ids: [] }));
  buildSignalTopicEditorialGlobalReviewV1({ plan, groups, screening: {
    contract_version: "signal-topic-editorial-screening-result-v1", plan_digest: plan.plan_digest,
    group_count: groupKeys.length, topic_count: 0, narrative_count: 0, noise_count: groupKeys.length,
    unresolved_count: 0, decisions,
  } });
}

function validateLoadedState(value: unknown, executionKey: string, plan: SignalTopicEditorialScreeningPlanV1) {
  const parsed = stateSchema.safeParse(value);
  if (!parsed.success || parsed.data.execution_key !== executionKey || parsed.data.plan_digest !== plan.plan_digest
    || !executionKeyPattern.test(parsed.data.execution_key)) return fail("topic_editorial_runner_state_invalid");
  const { state_digest, ...body } = parsed.data;
  if (signalTopicEditorialDigestV1(body) !== exactDigest(state_digest, "topic_editorial_runner_state_invalid"))
    return fail("topic_editorial_runner_state_invalid");
  const byIndex = new Map<number, SignalTopicEditorialScreeningOutputV1>();
  for (const output of parsed.data.screening_outputs) {
    const batch = plan.batches[output.batch_index];
    if (!batch || byIndex.has(output.batch_index)) return fail("topic_editorial_runner_state_coverage_invalid");
    byIndex.set(output.batch_index, validateSignalTopicEditorialScreeningOutputV1(batch, output));
  }
  const screening_outputs = [...byIndex.values()].sort((a, b) => a.batch_index - b.batch_index);
  if (parsed.data.screening_outputs.some((output, index) => output.batch_index !== screening_outputs[index]!.batch_index))
    return fail("topic_editorial_runner_state_coverage_invalid");
  const screeningComplete = screening_outputs.length === plan.batches.length;
  if ((!screeningComplete && (parsed.data.phase !== "screening" || parsed.data.global !== null))
    || (screeningComplete && parsed.data.global === null && parsed.data.phase !== "global")
    || (parsed.data.global !== null && parsed.data.phase !== "completed"))
    return fail("topic_editorial_runner_state_phase_invalid");
  return sealState({ ...body, screening_outputs });
}

async function persist(store: SignalTopicEditorialRunnerStoreV1, previous: SignalTopicEditorialRunnerStateV1 | null,
  body: StateBody) {
  const state = sealState(body);
  await store.save({ execution_key: body.execution_key, expected_state_digest: previous?.state_digest ?? null, state });
  return state;
}

async function completeValidated<T>(provider: SignalTopicEditorialRunnerProviderV1,
  original: SignalTopicEditorialRunnerProviderRequestV1, validate: (value: unknown) => T): Promise<T> {
  // The provider ledger replays settled originals/children; this method never
  // retries a transport or asks for a second repair of the same logical call.
  const raw = await provider.complete(original);
  try { return validate(raw); } catch (error) {
    const code = signalTopicEditorialSemanticRepairErrorV1(original.phase, raw, error);
    if (!code) throw error;
    const repair = buildSignalTopicEditorialRepairRequestV1({ original, response: raw, error_code: code });
    const repaired = await provider.complete(repair);
    try { return validate(repaired); } catch { throw new Error("topic_editorial_repair_invalid"); }
  }
}

export async function runSignalTopicEditorialConsolidationV1(args: {
  execution_key: string;
  plan: SignalTopicEditorialScreeningPlanV1;
  groups: SignalTopicEditorialScreeningGroupV1[];
  store: SignalTopicEditorialRunnerStoreV1;
  provider: SignalTopicEditorialRunnerProviderV1;
  configuration?: SignalTopicEditorialRunnerConfigurationV1;
}): Promise<SignalTopicEditorialRunnerResultV1> {
  if (!executionKeyPattern.test(args.execution_key)) fail("topic_editorial_runner_execution_key_invalid");
  const groupKeys = validatePlan(args.plan);
  validateGroupsBeforeProvider(args.plan, args.groups, groupKeys);
  const model = args.configuration?.model ?? SIGNAL_TOPIC_EDITORIAL_SCREENING_MODEL_V1;
  if (model !== args.plan.model) fail("topic_editorial_runner_model_invalid");
  const limit = natural(args.configuration?.max_screening_batches_per_run ?? args.plan.batches.length,
    "topic_editorial_runner_configuration_invalid", args.plan.batches.length);
  if (limit < 1) fail("topic_editorial_runner_configuration_invalid");

  const loaded = await args.store.load(args.execution_key);
  let state = loaded === null
    ? await persist(args.store, null, { contract_version: SIGNAL_TOPIC_EDITORIAL_RUNNER_CONTRACT_V1,
      execution_key: args.execution_key, plan_digest: args.plan.plan_digest, phase: "screening", screening_outputs: [], global: null })
    : validateLoadedState(loaded, args.execution_key, args.plan);
  const completedIndexes = new Set(state.screening_outputs.map(item => item.batch_index));
  let executed = 0;
  for (const batch of args.plan.batches) {
    if (completedIndexes.has(batch.batch_index)) continue;
    if (executed >= limit) break;
    const output = await completeValidated(args.provider, { contract_version: "signal-topic-editorial-provider-request-v1", phase: "screening",
      idempotency_key: batch.batch_key, model, request_digest: batch.request_digest, request_body: batch.request_body },
    raw => validateSignalTopicEditorialScreeningOutputV1(batch, raw));
    const screening_outputs = [...state.screening_outputs, output].sort((a, b) => a.batch_index - b.batch_index);
    state = await persist(args.store, state, { contract_version: SIGNAL_TOPIC_EDITORIAL_RUNNER_CONTRACT_V1,
      execution_key: args.execution_key, plan_digest: args.plan.plan_digest,
      phase: screening_outputs.length === args.plan.batches.length ? "global" : "screening", screening_outputs, global: null });
    completedIndexes.add(batch.batch_index); executed++;
  }
  if (state.screening_outputs.length < args.plan.batches.length) return {
    status: "screening_pending", state, pending_batch_count: args.plan.batches.length - state.screening_outputs.length,
  };

  const screening = validateSignalTopicEditorialScreeningCoverageV1(args.plan, state.screening_outputs);
  const review = buildSignalTopicEditorialGlobalReviewV1({ plan: args.plan, screening, groups: args.groups });
  if (state.global !== null) {
    if (state.global.request_digest !== review.request_digest) fail("topic_editorial_runner_global_request_invalid");
    const result = validateSignalTopicEditorialGlobalResultV1({ review, screening, value: state.global.result });
    return { status: "completed", state, screening, review, result };
  }
  const result = await completeValidated(args.provider, { contract_version: "signal-topic-editorial-provider-request-v1", phase: "global",
    idempotency_key: `topic-consolidation-global-v1:${review.request_digest.slice(7, 23)}`, model,
    request_digest: review.request_digest, request_body: review.request_body },
  value => validateSignalTopicEditorialGlobalResultV1({ review, screening, value }));
  state = await persist(args.store, state, { contract_version: SIGNAL_TOPIC_EDITORIAL_RUNNER_CONTRACT_V1,
    execution_key: args.execution_key, plan_digest: args.plan.plan_digest, phase: "completed",
    screening_outputs: state.screening_outputs, global: { request_digest: review.request_digest, result } });
  return { status: "completed", state, screening, review, result };
}
