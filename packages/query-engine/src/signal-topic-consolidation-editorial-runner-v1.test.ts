import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  SIGNAL_TOPIC_EDITORIAL_SCREENING_MODEL_V1,
  buildSignalTopicEditorialScreeningPlanV1,
  signalTopicEditorialDigestV1,
  type SignalTopicEditorialScreeningGroupV1,
} from "./signal-topic-consolidation-editorial-v1";
import {
  runSignalTopicEditorialConsolidationV1,
  type SignalTopicEditorialRunnerProviderRequestV1,
  type SignalTopicEditorialRunnerProviderV1,
  type SignalTopicEditorialRunnerStateV1,
  type SignalTopicEditorialRunnerStoreV1,
} from "./signal-topic-consolidation-editorial-runner-v1";

const digest = (value: unknown) => signalTopicEditorialDigestV1(value);
const textDigest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const context = { brand_name: "Alexa+", default_locale: "es-MX", summary: "Asistente de voz con IA generativa.",
  audiences: ["hogares"], categories: ["asistentes de voz"], competitors: ["Google Assistant"],
  positive_anchors: ["rutinas"], negative_anchors: ["Alexandra"], abstention_anchors: ["ruido"] };

function group(index: number): SignalTopicEditorialScreeningGroupV1 {
  const text = `Evidencia verificable de Alexa ${index}`, root_id = uuid(index + 1), chunk_sha256 = textDigest(text),
    evidence = [{ ref_id: digest({ root_id, chunk_index: 0, start: 0, end: text.length, chunk_sha256 }), root_id,
      chunk_index: 0, start: 0, end: text.length, chunk_sha256, text, locale: "es-MX", platform: "reddit",
      occurred_at: "2026-09-12T00:00:00.000Z" }], scope_counts = { brand: 1, competitor: 0, category: 0, unknown: 0 },
    locale_counts = [{ key: "es-MX", count: 1 }], platform_counts = [{ key: "reddit", count: 1 }],
    month_counts = [{ key: "2026-09", count: 1 }], brand_affinity = { positive: [], negative: [], abstention: [] },
    neighbors: never[] = [], metrics = { cohesion: null, outlier_ratio: null }, dossier = {
      contract_version: "signal-topic-group-dossier-v1", scope_counts, locale_counts, platform_counts, month_counts,
      brand_affinity, neighbors, metrics, evidence: evidence.map(({ text: _text, ...item }) => item),
    };
  return { group_key: `open:cluster-${String(index).padStart(4, "0")}`, lane: "open", group_digest: digest(["group", index]),
    dossier_digest: digest(dossier), community_key: `community-${Math.floor(index / 8)}`, root_count: 1, chunk_count: 1,
    terms: [`term-${index}`], scope_counts, locale_counts, platform_counts, month_counts, brand_affinity, neighbors, metrics, evidence };
}

const planFor = (groups: SignalTopicEditorialScreeningGroupV1[], batchSize = 40) =>
  buildSignalTopicEditorialScreeningPlanV1({ expected_group_count: groups.length, source_context_digest: digest("source"),
    editorial_context_digest: digest(context), context, groups, batch_size: batchSize });

class MemoryStore implements SignalTopicEditorialRunnerStoreV1 {
  state: SignalTopicEditorialRunnerStateV1 | null = null;
  saves = 0;
  async load() { return this.state === null ? null : structuredClone(this.state); }
  async save(input: { execution_key: string; expected_state_digest: string | null; state: SignalTopicEditorialRunnerStateV1 }) {
    assert.equal(input.expected_state_digest, this.state?.state_digest ?? null, "compare-and-set token");
    assert.equal(input.execution_key, input.state.execution_key);
    this.state = structuredClone(input.state); this.saves++;
  }
}

const payload = (request: SignalTopicEditorialRunnerProviderRequestV1) => {
  const body = JSON.parse(request.request_body) as { messages: Array<{ content: string }> };
  return JSON.parse(body.messages[0]!.content) as Record<string, unknown>;
};

class FixtureProvider implements SignalTopicEditorialRunnerProviderV1 {
  calls: SignalTopicEditorialRunnerProviderRequestV1[] = [];
  constructor(private readonly corrupt: "none" | "duplicate-screening" | "duplicate-global" = "none") {}
  async complete(request: SignalTopicEditorialRunnerProviderRequestV1) {
    assert.deepEqual(Object.keys(request).sort(), ["contract_version", "idempotency_key", "model", "phase", "request_body", "request_digest"]);
    assert.equal(request.model, SIGNAL_TOPIC_EDITORIAL_SCREENING_MODEL_V1);
    this.calls.push(request); const input = payload(request);
    if (request.phase === "screening") {
      const groups = input.groups as SignalTopicEditorialScreeningGroupV1[], batchIndex = input.batch_index as number;
      const decisions = groups.map((item, index) => ({ group_key: item.group_key, disposition: "topic",
        candidate: { candidate_key: `b${String(batchIndex).padStart(4, "0")}-candidate-${index}`,
          label: `Tema ${batchIndex}-${index}`, definition: "Conversaciones verificables sobre Alexa+.", locale: "es-MX" },
        confidence: 0.8, rationale: null, cited_ref_ids: [item.evidence[0]!.ref_id] }));
      if (this.corrupt === "duplicate-screening" && decisions.length > 1) decisions[1] = { ...decisions[0]! };
      return { contract_version: "signal-topic-editorial-screening-output-v1", batch_index: batchIndex, decisions };
    }
    const eligible = input.eligible as Array<{ group_key: string }>, fixedNoise = input.fixed_noise as string[],
      members = eligible.map(item => item.group_key);
    if (this.corrupt === "duplicate-global" && members.length > 1) members[1] = members[0]!;
    return { contract_version: "signal-topic-editorial-global-result-v1", concepts: [{ concept_key: "topic-alexa-experience",
      kind: "topic", label: "Experiencia con Alexa+", definition: "Conversaciones consolidadas sobre la experiencia con Alexa+.",
      locale: "es-MX", member_group_keys: members }], noise_group_keys: fixedNoise, unresolved_group_keys: [] };
  }
}

test("executes and durably resumes all 1,652 dossiers, then performs one global review", async () => {
  const groups = Array.from({ length: 1_652 }, (_, index) => group(index)), plan = planFor(groups), store = new MemoryStore(),
    provider = new FixtureProvider();
  const first = await runSignalTopicEditorialConsolidationV1({ execution_key: "alexa-1652", plan, groups, store, provider,
    configuration: { model: "claude-sonnet-4-6" } });
  assert.equal(first.status, "completed");
  if (first.status !== "completed") return;
  assert.equal(first.screening.group_count, 1_652); assert.equal(first.screening.topic_count, 1_652);
  assert.equal(first.result.concepts[0]!.member_group_keys.length, 1_652);
  assert.equal(provider.calls.filter(item => item.phase === "screening").length, 42);
  assert.equal(provider.calls.filter(item => item.phase === "global").length, 1);
  assert.equal(new Set(provider.calls.map(item => item.idempotency_key)).size, 43);
  assert.equal(store.saves, 44);

  const callsBeforeReplay = provider.calls.length;
  const replay = await runSignalTopicEditorialConsolidationV1({ execution_key: "alexa-1652", plan, groups, store, provider });
  assert.equal(replay.status, "completed"); assert.equal(provider.calls.length, callsBeforeReplay);
  assert.equal(replay.state.state_digest, first.state.state_digest);
});

test("checkpoints after a bounded number of batches and continues without replaying completed work", async () => {
  const groups = Array.from({ length: 25 }, (_, index) => group(index)), plan = planFor(groups, 10), store = new MemoryStore(),
    provider = new FixtureProvider();
  const paused = await runSignalTopicEditorialConsolidationV1({ execution_key: "bounded-run", plan, groups, store, provider,
    configuration: { max_screening_batches_per_run: 1 } });
  assert.equal(paused.status, "screening_pending");
  if (paused.status !== "screening_pending") return;
  assert.equal(paused.pending_batch_count, 2); assert.equal(paused.state.screening_outputs.length, 1);
  const firstKey = provider.calls[0]!.idempotency_key;
  const completed = await runSignalTopicEditorialConsolidationV1({ execution_key: "bounded-run", plan, groups, store, provider });
  assert.equal(completed.status, "completed");
  assert.equal(provider.calls.filter(item => item.idempotency_key === firstKey).length, 1);
  assert.deepEqual(provider.calls.map(item => item.phase), ["screening", "screening", "screening", "global"]);
});

test("fails closed on duplicate group coverage from screening, global review or input dossiers", async () => {
  const groups = [group(0), group(1)], plan = planFor(groups, 10);
  const screeningStore = new MemoryStore(), duplicateScreening = new FixtureProvider("duplicate-screening");
  await assert.rejects(runSignalTopicEditorialConsolidationV1({ execution_key: "duplicate-screen", plan, groups,
    store: screeningStore, provider: duplicateScreening }), /coverage_invalid/);
  assert.equal(screeningStore.state?.screening_outputs.length, 0);

  const globalStore = new MemoryStore(), duplicateGlobal = new FixtureProvider("duplicate-global");
  await assert.rejects(runSignalTopicEditorialConsolidationV1({ execution_key: "duplicate-global", plan, groups,
    store: globalStore, provider: duplicateGlobal }), /members_invalid|coverage_invalid/);
  assert.equal(globalStore.state?.phase, "global");

  const untouchedStore = new MemoryStore(), untouchedProvider = new FixtureProvider();
  await assert.rejects(runSignalTopicEditorialConsolidationV1({ execution_key: "duplicate-input", plan,
    groups: [groups[0]!, groups[0]!], store: untouchedStore, provider: untouchedProvider }), /group_coverage_invalid/);
  assert.equal(untouchedProvider.calls.length, 0); assert.equal(untouchedStore.saves, 0);
});
