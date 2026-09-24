import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { signalTopicDefinitionDigestV1, buildSignalTopicInterestReviewV1,
  buildSignalTopicEditorialScreeningPlanV1, signalTopicEditorialDigestV1 as digest,
  type SignalTopicDefinitionV1 } from '@noisia/query-engine';
import { prepareSignalTopicInterestReviewV1 as prepare, loadSignalTopicInterestReviewPreparationV1 as load } from './signal-topic-interest-review-preparation';
import type { SignalTopicInheritedContextStoreV1 } from './signal-topic-catalog';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function group(n: number) {
  const text = `Voice routines evidence ${n}`, root_id = id(n + 1), chunk_index = 0, start = 0, end = text.length;
  const chunk_sha256 = `sha256:${createHash("sha256").update(text).digest("hex")}`;
  const evidence = [{ ref_id: digest({ root_id, chunk_index, start, end, chunk_sha256 }), root_id, chunk_index,
    start, end, chunk_sha256, text, locale: "es-MX", platform: "reddit", occurred_at: "2026-09-12T00:00:00.000Z" }];
  const scope_counts = { brand: 1, competitor: 0, category: 0, unknown: 0 }, locale_counts = [{ key: "es-MX", count: 1 }],
    platform_counts = [{ key: "reddit", count: 1 }], month_counts = [{ key: "2026-09", count: 1 }],
    brand_affinity = { positive: [], negative: [], abstention: [] }, neighbors: never[] = [], metrics = { cohesion: null, outlier_ratio: null };
  const dossier = { contract_version: "signal-topic-group-dossier-v1", scope_counts, locale_counts, platform_counts,
    month_counts, brand_affinity, neighbors, metrics, evidence: evidence.map(({ text: _text, ...ref }) => ref) };
  return { group_key: `open:cluster-${String(n).padStart(4, "0")}`, lane: "open" as const,
    group_digest: digest(["group", n]), source_dossier_digest: digest(dossier), dossier_digest: digest(dossier),
    community_key: `community-${Math.floor(n / 8)}`, root_count: 1, chunk_count: 1, terms: ["routines"],
    scope_counts, locale_counts, platform_counts, month_counts, brand_affinity, neighbors, metrics, evidence };
}
const context = { brand_name: "Synthetic voice assistant", default_locale: "es-MX", summary: "Voice assistant.", audiences: ["homes"],
  categories: ["voice assistants"], competitors: ["Google Assistant"], positive_anchors: ["routines"], negative_anchors: ["Alexandra"], abstention_anchors: ["noise"] };
const plan = (count = 2) => buildSignalTopicEditorialScreeningPlanV1({ expected_group_count: count,
  source_context_digest: digest("context-source"), editorial_context_digest: digest(context), context,
  groups: Array.from({ length: count }, (_, index) => group(index)) });
function definition(n = 0, overrides: Partial<SignalTopicDefinitionV1> = {}): SignalTopicDefinitionV1 {
  const value: SignalTopicDefinitionV1 = { term_key: `interest_${n}`, label: `Interest ${n}`, definition: "Experiences with voice routines.",
    scope: "primary_brand", inclusion: ["Automating home tasks"], exclusion: ["Unrelated names"],
    positive_examples: ["My routine turns off the lights"], negative_examples: ["Alexandra turned off the lights"],
    lifecycle: "draft", origin: "manual", source: null, definition_revision: 1, definition_digest: digest("placeholder"),
    created_at: "2026-09-24T00:00:00.000Z", updated_at: "2026-09-24T00:00:00.000Z", ...overrides };
  value.definition_digest = signalTopicDefinitionDigestV1(value);
  return value;
}
const build = (definitions = [definition()], screening_plan = plan()) => buildSignalTopicInterestReviewV1({
  workspace_id: id(100), taxonomy_profile_id: id(200), definitions, screening_plan });

function harness() {
  const review = build(), scope = { workspace_id: id(100), actor_user_id: id(201), numeric_run_id: id(202) };
  const stored = { preparation_id: id(203), workspace_id: scope.workspace_id, numeric_run_id: scope.numeric_run_id,
    review_digest: review.review_digest, input_digest: review.input_digest, provider_execution_enabled: false };
  const trace: string[] = [], parameters: unknown[][] = [];
  let readValue: unknown = { ...stored, review }, prepareValue: unknown = { ...stored, replayed: false };
  let sqlFailure: Error | null = null, connectHook: (() => void) | null = null;
  let inherited = { context_digest: review.manifest.source_context_digest, editorial_context: context };
  const client = { query: async (sql: string, params?: unknown[]) => {
    trace.push(sql); if (params) parameters.push(params);
    if (sql.includes('signal_topic_interest_review')) {
      if (sqlFailure) throw sqlFailure;
      return { rows: [{ value: sql.includes('prepare_signal') ? prepareValue : readValue }] };
    }
    return { rows: [] };
  }, release: () => trace.push('release') } as unknown as PoolClient;
  const database = { connect: async () => { trace.push('connect'); connectHook?.(); return client; } };
  const readers = { context: async () => { trace.push('context'); return inherited as SignalTopicInheritedContextStoreV1; } };
  const args = { database, ...scope, review, idempotency_key: 'synthetic:prepare:1' };
  return { args, readers, stored, trace, parameters, loadArgs: { database, workspace_id: scope.workspace_id,
    actor_user_id: scope.actor_user_id, preparation_id: stored.preparation_id },
    setPrepare(value: unknown) { prepareValue = value; }, setLoad(value: unknown) { readValue = value; },
    rejectSql(error: Error) { sqlFailure = error; }, onConnect(fn: () => void) { connectHook = fn; },
    staleContext() { inherited = { ...inherited, context_digest: digest('changed') }; },
    staleEditorialContext() { inherited = { ...inherited, editorial_context: { ...context, summary: 'Changed' } }; } };
}
test('prepares a verified immutable server snapshot in one write transaction; receipt never enables provider', async () => {
  const h = harness(), out = await prepare(h.args, h.readers);
  assert.deepEqual(out, { ...h.stored, replayed: false });
  assert.equal(h.trace[1], 'BEGIN ISOLATION LEVEL REPEATABLE READ');
  assert.deepEqual(h.trace.slice(-3), ['context','COMMIT','release']);
  assert.deepEqual(h.parameters[0]?.slice(0,3), [h.args.workspace_id,h.args.actor_user_id,h.args.numeric_run_id]);
  assert.deepEqual(JSON.parse(String(h.parameters[0]?.[3])),h.args.review);
  assert.equal(h.parameters.length,1, 'no queue, ledger, or grant operation');
});
test('reload validates stored review and current context inside the same read-only transaction', async () => {
  const h = harness(), out = await load(h.loadArgs,h.readers);
  assert.deepEqual(out.review,h.args.review);
  assert.equal(h.trace[1],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.deepEqual(h.trace.slice(-3),['context','COMMIT','release']);
  assert.equal(out.provider_execution_enabled,false);
});
test('source or editorial context drift rolls back preparation and withholds loaded evidence', async () => {
  for (const change of ['staleContext','staleEditorialContext'] as const) {
    for (const operation of ['prepare','load'] as const) {
      const h = harness(); h[change]();
      await assert.rejects(operation === 'prepare' ? prepare(h.args,h.readers) : load(h.loadArgs,h.readers), /topic_interest_review_source_stale/);
      assert.deepEqual(h.trace.slice(-2),['ROLLBACK','release']);
      assert.ok(!h.trace.includes('COMMIT'));
    }
  }
});
test('bad input and cross-workspace review fail before acquiring a connection', async () => {
  const h = harness();
  await assert.rejects(prepare({ ...h.args, workspace_id: id(999) },h.readers),/identity_invalid/);
  await assert.rejects(prepare({ ...h.args, idempotency_key: 'bad key' },h.readers),/request_key_invalid/);
  await assert.rejects(prepare({ ...h.args, review: { ...h.args.review, review_digest: digest('altered') } },h.readers),/preparation_invalid/);
  assert.deepEqual(h.trace,[]);
});
test('revocation and catalog stale SQL errors roll back without reading or returning evidence', async () => {
  for (const code of ['processing_forbidden','topic_interest_review_catalog_stale']) {
    const h = harness();h.rejectSql(Error(code));
    await assert.rejects(load(h.loadArgs,h.readers),new RegExp(code));
    assert.deepEqual(h.trace.slice(-2),['ROLLBACK','release']);
    assert.ok(!h.trace.includes('context'));
  }
});
test('rejects substituted receipt scope, digest, id and provider permission', async () => {
  for (const bad of [{ workspace_id:id(999) },{ preparation_id:id(999) },{ review_digest:digest('other') },{ provider_execution_enabled:true }]) {
    const h = harness();h.setLoad({ ...h.stored,review:h.args.review,...bad });
    await assert.rejects(load(h.loadArgs,h.readers),/preparation_invalid/);
    assert.deepEqual(h.trace.slice(-2),['ROLLBACK','release']);
  }
  const h = harness();h.setLoad({ ...h.stored,review:{ ...h.args.review,batches:[] } });
  await assert.rejects(load(h.loadArgs,h.readers),/preparation_invalid/);
});
test('preparation retains exact identity after caller mutations during connection wait', async () => {
  const h = harness(), original = structuredClone(h.args.review);
  h.onConnect(() => { h.args.workspace_id = id(999);h.args.review.batches = [];h.args.idempotency_key = 'changed:key'; });
  const out = await prepare(h.args,h.readers);
  assert.equal(out.workspace_id,h.stored.workspace_id);
  assert.equal(h.parameters[0]?.[4],'synthetic:prepare:1');
  assert.deepEqual(JSON.parse(String(h.parameters[0]?.[3])),original);
});
test('recovered prepare receipt is returned only when complete and still bound to the same run/input', async () => {
  const h = harness(); h.setPrepare({ ...h.stored, replayed:true });
  assert.equal((await prepare(h.args,h.readers)).replayed,true);
  h.setPrepare({ ...h.stored, numeric_run_id:id(999), replayed:true });
  await assert.rejects(prepare(h.args,h.readers),/preparation_invalid/);
  h.setPrepare({ ...h.stored, input_digest:digest('other'), replayed:true });
  await assert.rejects(prepare(h.args,h.readers),/preparation_invalid/);
});
