import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBlindSamples,
  comparePilotSnapshot,
  computeSnapshotDigest,
  loadPilotAuditInputs,
  renderBlindSamples,
  renderPrivateComparisonAnnex,
  renderPublicReceipt,
  renderSealedAnswerKey,
  sealAnswerKey,
  summarizePilotSnapshot,
  validatePilotSnapshot,
  verifyAnswerKeySeal,
} from './pilot-audit.mjs';

const topicAnswer = (probability) => ({ type: 'noul', noul: probability });
const choiceAnswer = (selected, probability) => ({
  type: 'choice',
  choice: selected,
  confidence: probability,
  probabilities: {
    trigger: selected === 'trigger' ? probability : (1 - probability) / 2,
    barrier: selected === 'barrier' ? probability : (1 - probability) / 2,
    none: selected === 'none' ? probability : (1 - probability) / 2,
  },
});
const result = (root_id, topic0, topic1, decision, decisionProbability) => ({
  root_id,
  call_id: root_id === 'root-1' ? 'call-smoke' : `call-full-${root_id}`,
  status: 'completed',
  probabilities: {
    relevance: topicAnswer(0.9),
    promotion: topicAnswer(0.2),
    spam: topicAnswer(0.1),
    voice: choiceAnswer('consumer', 0.9),
    trigger_barrier: choiceAnswer(decision, decisionProbability),
    topic_0: topicAnswer(topic0),
    topic_1: topicAnswer(topic1),
  },
});

function fixture() {
  return {
    contract_version: 'mass-labeling-private-export-v1',
    exported_at: '2026-11-07T12:02:00.000Z',
    map: {
      id: 'synthetic-map-id',
      map_digest: 'sha256:synthetic-map-digest',
      created_at: '2026-11-07T12:00:00.000Z',
      root_count: 5,
      source_engine_execution_id: 'synthetic-engine-run',
      preparation_run_id: 'synthetic-preparation-run',
      input_revision: 7,
      catalog: [
        { topic_key: 'product-a', name: 'Synthetic topic A', definition: 'Synthetic definition A', group_ids: ['g1'] },
        { topic_key: 'product-b', name: 'Synthetic topic B', definition: 'Synthetic definition B', group_ids: ['g2'] },
      ],
    },
    run: { id: 'synthetic-label-run', run_id: 'synthetic-label-run', map_id: 'synthetic-map-id',
      status: 'completed', smoke_root_limit: null, smoke_metrics: { root_count: 1, technical_failure: false },
      smoke_metrics_digest: 'sha256:synthetic-smoke-digest', continued_at: '2026-11-07T12:01:00.000Z' },
    items: [
      { map_id: 'synthetic-map-id', root_id: 'root-1', ordinal: 1, input_digest: 'sha256:synthetic-input-1',
        chunk_index: 0, text: 'Synthetic mention one', status: 'labeled', call_id: 'call-smoke',
        probabilities: result('root-1', 0.8, 0.1, 'trigger', 0.9).probabilities,
        candidates: [{ topic_key: 'product-a', name: 'Synthetic topic A', definition: 'Synthetic definition A', similarity: 0.9 },
          { topic_key: 'product-b', name: 'Synthetic topic B', definition: 'Synthetic definition B', similarity: 0.8 }],
        error_code: null, result_created_at: '2026-11-07T12:01:01.000Z' },
      { map_id: 'synthetic-map-id', root_id: 'root-2', ordinal: 2, input_digest: 'sha256:synthetic-input-2',
        chunk_index: 0, text: 'Synthetic mention two', status: 'labeled', call_id: 'call-full-root-2',
        probabilities: result('root-2', 0.7, 0.2, 'none', 0.55).probabilities,
        candidates: [{ topic_key: 'product-a', name: 'Synthetic topic A', definition: 'Synthetic definition A', similarity: 0.9 },
          { topic_key: 'product-b', name: 'Synthetic topic B', definition: 'Synthetic definition B', similarity: 0.8 }],
        error_code: null, result_created_at: '2026-11-07T12:01:02.000Z' },
      { map_id: 'synthetic-map-id', root_id: 'root-3', ordinal: 3, input_digest: 'sha256:synthetic-input-3',
        chunk_index: 0, text: 'Synthetic mention three', status: 'abstained', call_id: 'call-full-root-3',
        probabilities: result('root-3', 0.1, 0.3, 'barrier', 0.8).probabilities,
        candidates: [{ topic_key: 'product-a', name: 'Synthetic topic A', definition: 'Synthetic definition A', similarity: 0.9 },
          { topic_key: 'product-b', name: 'Synthetic topic B', definition: 'Synthetic definition B', similarity: 0.8 }],
        error_code: null, result_created_at: '2026-11-07T12:01:03.000Z' },
      { map_id: 'synthetic-map-id', root_id: 'root-4', ordinal: 4, input_digest: 'sha256:synthetic-input-4',
        chunk_index: 0, text: 'Synthetic mention four', status: null, call_id: null, probabilities: null,
        candidates: [{ topic_key: 'product-a', name: 'Synthetic topic A', definition: 'Synthetic definition A', similarity: 0.9 },
          { topic_key: 'product-b', name: 'Synthetic topic B', definition: 'Synthetic definition B', similarity: 0.8 }],
        error_code: null, result_created_at: null },
      { map_id: 'synthetic-map-id', root_id: 'root-5', ordinal: 5, input_digest: 'sha256:synthetic-input-5',
        chunk_index: 0, text: 'Synthetic mention five', status: 'labeled', call_id: 'call-full-root-5',
        probabilities: result('root-5', 0.2, 0.29, 'none', 0.8).probabilities,
        candidates: [{ topic_key: 'product-a', name: 'Synthetic topic A', definition: 'Synthetic definition A', similarity: 0.9 },
          { topic_key: 'product-b', name: 'Synthetic topic B', definition: 'Synthetic definition B', similarity: 0.8 }],
        error_code: null, result_created_at: '2026-11-07T12:01:05.000Z' },
    ],
    calls: [
      { id: 'call-smoke', run_id: 'synthetic-label-run', model: 'synthetic-jev-v1', status: 'succeeded',
        reserved_micro_usd: '10000', settled_micro_usd: '0', terminal_exposure_micro_usd: '0', usage: { input_tokens: 1000 } },
      { id: 'call-full-root-2', run_id: 'synthetic-label-run', model: 'synthetic-jev-v1', status: 'succeeded',
        reserved_micro_usd: '10000', settled_micro_usd: '0', terminal_exposure_micro_usd: '0', usage: { input_tokens: 3000 } },
      { id: 'call-full-root-3', run_id: 'synthetic-label-run', model: 'synthetic-jev-v1', status: 'succeeded',
        reserved_micro_usd: '10000', settled_micro_usd: '12340', terminal_exposure_micro_usd: '12340', usage: { input_tokens: 3000 } },
      { id: 'call-full-root-5', run_id: 'synthetic-label-run', model: 'synthetic-jev-v1', status: 'succeeded',
        reserved_micro_usd: '10000', settled_micro_usd: '0', terminal_exposure_micro_usd: '0', usage: { input_tokens: 4000 } },
    ],
    stage_receipts: {
      embeddings: { input_tokens: '5000' },
      engine: { id: 'synthetic-engine-run', status: 'completed', result_summary: { fit_checkpoint: { interpretation_manifest: { unit_count: 12 } } } },
      editorial_calls: [{ id: 'editorial-call', settled_micro_usd: '0', input_tokens: 0, usage: { input_tokens: 0 } }],
    },
  };
}

function operatorReceipt(snapshot = fixture()) {
  const timing = (name, input_count, duration, charged_micro_usd, usage_value_micro_usd,
    free_tokens_used, input_tokens, ledger_call_ids = []) => ({
    name,
    input_count,
    input_unit: name === 'voyage' ? 'fragments' : name === 'claude' ? 'groups' : 'roots',
    charged_micro_usd,
    usage_value_micro_usd,
    free_tokens_used,
    input_tokens,
    ledger_call_ids,
    started_at: '2026-11-07T12:00:00.000Z',
    completed_at: new Date(Date.parse('2026-11-07T12:00:00.000Z') + duration * 1000).toISOString(),
  });
  return {
    contract_version: 'signal-mass-labeling-operator-receipt-v1',
    map_digest: 'sha256:synthetic-map-digest',
    snapshot_sha256: computeSnapshotDigest(snapshot),
    population: { unique_roots: 6, excluded_roots: 1, eligible_roots: 5 },
    public_catalog: {
      map_digest: snapshot.map.map_digest,
      private_identity_terms: ['confidential brand zeta', 'private competitor omega'],
      topics: snapshot.map.catalog.map((topic) => ({ topic_key: topic.topic_key,
        public_name: `Public alias ${topic.topic_key}`, public_definition: `Public definition ${topic.topic_key}` })),
    },
    stages: [
      timing('voyage', 5, 2, 0, 10000, 5000, 5000),
      { ...timing('bertopic', 5, 5, 0, 0, 0, 0), group_count: 12 },
      timing('claude', 2, 3, 0, 0, 0, 0, ['editorial-call']),
      timing('jev_smoke', 1, 2, 0, 0, 0, 1000, ['call-smoke']),
      timing('jev_full', 3, 5, 12340, 12340, 0, 10000,
        ['call-full-root-2', 'call-full-root-3', 'call-full-root-5']),
    ],
  };
}

const comparison = {
  map_digest: 'sha256:synthetic-map-digest',
  study_topics: [{ key: 'study-a', name: 'Synthetic study topic A' }, { key: 'study-b', name: 'Synthetic study topic B' }],
  topic_matches: [{ product_topic_key: 'product-a', study_topic_keys: ['study-a'] }],
  new_product_topic_keys: ['product-b'],
  study_triggers: [{ key: 'trigger-a', label: 'Synthetic trigger', product_topic_keys: ['product-a'] }],
  study_barriers: [{ key: 'barrier-a', label: 'Synthetic barrier', product_topic_keys: [] }],
};

test('rejects snapshots without a frozen map before baseline comparison can be read', async () => {
  const snapshot = fixture();
  snapshot.map.created_at = null;
  assert.throws(() => validatePilotSnapshot(snapshot), /map_not_frozen/u);
});

test('accepts the H2 full export with null smoke_root_limit and partitions calls by persisted smoke_metrics.root_count', () => {
  const snapshot = fixture();
  assert.equal(snapshot.run.smoke_root_limit, null);
  assert.equal(snapshot.run.smoke_metrics.root_count, 1);
  const summary = summarizePilotSnapshot(snapshot, operatorReceipt(snapshot));
  assert.equal(summary.stages.find((stage) => stage.name === 'jev_smoke').input_count, 1);
  assert.equal(summary.stages.find((stage) => stage.name === 'jev_full').input_count, 3);
  const invalidLegacyLimit = structuredClone(snapshot);
  invalidLegacyLimit.run.smoke_root_limit = 1;
  assert.throws(() => validatePilotSnapshot(invalidLegacyLimit), /map_not_frozen/u);
});

test('reads no baseline content until both frozen map and operator receipt match', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'pilot-audit-'));
  const snapshotPath = join(directory, 'snapshot.json');
  const operatorPath = join(directory, 'operator.json');
  const comparisonPath = join(directory, 'comparison.json');
  try {
    const snapshot = fixture();
    const receipt = operatorReceipt();
    receipt.snapshot_sha256 = 'wrong';
    await writeFile(snapshotPath, JSON.stringify(snapshot));
    await writeFile(operatorPath, JSON.stringify(receipt));
    await writeFile(comparisonPath, '{ invalid baseline data');
    await assert.rejects(loadPilotAuditInputs(snapshotPath, operatorPath, comparisonPath), /operator_receipt_invalid/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('summarizes threshold coverage, calls, timing, and cost projections', () => {
  const summary = summarizePilotSnapshot(fixture(), operatorReceipt());
  assert.deepEqual(summary.coverage, {
    covered: 1, intermediate: 2, no_topic: 1, unresolved: 1,
    covered_percent: 20, intermediate_percent: 40, no_topic_percent: 20, unresolved_percent: 20,
  });
  assert.deepEqual(summary.trigger_barrier, {
    trigger: 1, barrier: 1, none: 1, intermediate: 1, unresolved: 1,
    trigger_percent: 20, barrier_percent: 20, none_percent: 20, intermediate_percent: 20, unresolved_percent: 20,
  });
  assert.equal(summary.topics[0].volume, 1);
  assert.equal(summary.charged_per_1000_micro_usd, 2_468_000);
  assert.equal(summary.charged_per_million_micro_usd, 2_468_000_000);
  assert.equal(summary.usage_value_micro_usd, 22_340);
  assert.equal(summary.free_tokens_used, 5_000);
  assert.equal(summary.stages[0].duration_seconds, 2);
  assert.equal(summary.bertopic_group_count, 12);
  const duplicateCall = operatorReceipt();
  duplicateCall.stages[4].ledger_call_ids = ['call-smoke'];
  assert.throws(() => summarizePilotSnapshot(fixture(), duplicateCall), /input_count_mismatch/u);
});

test('compares frozen map keys and rejects mismatched study baseline map digest', async () => {
  const snapshot = fixture();
  const comparisonResult = comparePilotSnapshot(snapshot, comparison);
  assert.deepEqual(comparisonResult.topics_found_by_both, [
    {
      product_topic_key: 'product-a',
      product_topic_name: 'Synthetic topic A',
      study_topic_keys: ['study-a'],
      study_topic_names: ['Synthetic study topic A'],
    },
  ]);
  assert.deepEqual(comparisonResult.product_only_topics, [
    { topic_key: 'product-b', name: 'Synthetic topic B', definition: 'Synthetic definition B' },
  ]);
  assert.deepEqual(comparisonResult.study_only_topics, [{ topic_key: 'study-b', name: 'Synthetic study topic B' }]);
  assert.deepEqual(comparisonResult.new_topics, [{ topic_key: 'product-b', name: 'Synthetic topic B' }]);
  assert.equal(comparisonResult.study_triggers[0].found, true);
  assert.equal(comparisonResult.study_barriers[0].found, false);
  const wrongComparison = { ...comparison, map_digest: 'sha256:wrong' };
  assert.throws(() => comparePilotSnapshot(snapshot, wrongComparison), /wrong_frozen_map/u);
});

test('creates blind samples with a separate key and tamper-evident SHA256', () => {
  const snapshot = fixture();
  const summary = summarizePilotSnapshot(snapshot, operatorReceipt());
  assert.throws(() => buildBlindSamples(snapshot, summary, Buffer.alloc(32, 7)), /top_ten_topics_insufficient/u);
  const answerKey = { 'synthetic-case': { root_id: 'synthetic-root', probability: 0.9 } };
  const seal = sealAnswerKey(answerKey);
  assert.equal(seal.sha256.length, 64);
  assert.equal(JSON.parse(renderSealedAnswerKey(answerKey)).sha256, seal.sha256);
  assert.equal(verifyAnswerKeySeal(seal), true);
  const tampered = structuredClone(seal);
  tampered.answer_key[Object.keys(tampered.answer_key)[0]].root_id = 'changed';
  assert.equal(verifyAnswerKeySeal(tampered), false);
});

test('selects exactly 50 distinct roots per leading topic and 100 for trigger/barrier combined', () => {
  const snapshot = fixture();
  snapshot.map.catalog = Array.from({ length: 10 }, (_, index) => ({
    topic_key: `product-${index}`, name: `Synthetic topic ${index}`, definition: `Synthetic definition ${index}`,
  }));
  snapshot.items = [];
  snapshot.calls = [];
  snapshot.map.root_count = 105;
  const receipt = operatorReceipt();
  receipt.population = { unique_roots: 106, excluded_roots: 1, eligible_roots: 105 };
  receipt.public_catalog.topics = snapshot.map.catalog.map((topic) => ({ topic_key: topic.topic_key,
    public_name: `Public alias ${topic.topic_key}`, public_definition: `Public definition ${topic.topic_key}` }));
  for (let index = 0; index < 105; index += 1) {
    const root_id = `synthetic-root-${index}`;
    const candidateKeys = Array.from({ length: 8 }, (_, offset) => `product-${(index + offset) % 10}`);
    snapshot.items.push({ root_id, ordinal: index + 1, text: `Synthetic auditor text ${index}`,
      status: 'labeled', call_id: `synthetic-call-${index}`, probabilities: null,
      candidates: candidateKeys.map((topic_key, ordinal) => ({ ordinal, topic_key })) });
    const decision = index < 50 ? 'trigger' : index < 100 ? 'barrier' : 'none';
    const resultRow = result(root_id, 0.9, 0.85, decision, decision === 'none' ? 0.95 : 0.9);
    for (const [ordinal] of candidateKeys.entries()) resultRow.probabilities[`topic_${ordinal}`] = topicAnswer(0.9);
    resultRow.call_id = `synthetic-call-${index}`;
    snapshot.items.at(-1).probabilities = resultRow.probabilities;
    snapshot.calls.push({ id: resultRow.call_id, settled_micro_usd: '0', usage: { input_tokens: 0 } });
  }
  receipt.stages[1].input_count = 105;
  receipt.stages[3].input_count = 1;
  receipt.stages[3].input_tokens = 0;
  receipt.stages[3].ledger_call_ids = ['synthetic-call-0'];
  receipt.stages[4].input_count = 104;
  receipt.stages[4].ledger_call_ids = snapshot.calls.slice(1).map((call) => call.id);
  receipt.stages[4].usage_value_micro_usd = 0;
  receipt.stages[4].charged_micro_usd = 0;
  receipt.stages[4].input_tokens = 0;
  receipt.snapshot_sha256 = computeSnapshotDigest(snapshot);
  const { samples, answerKey } = buildBlindSamples(snapshot, summarizePilotSnapshot(snapshot, receipt), Buffer.alloc(32, 9));
  const reordered = { ...snapshot, items: [...snapshot.items].reverse() };
  const reorderedReceipt = { ...receipt, snapshot_sha256: computeSnapshotDigest(reordered) };
  const reorderedResult = buildBlindSamples(reordered, summarizePilotSnapshot(reordered, reorderedReceipt), Buffer.alloc(32, 9));
  const idsFor = (sampleRows, key, cohort) => sampleRows.map((sample) => sample.case_id)
    .filter((caseId) => key[caseId].cohort === cohort);
  assert.deepEqual(idsFor(reorderedResult.samples, reorderedResult.answerKey, 'topic-1'),
    idsFor(samples, answerKey, 'topic-1'));
  assert.equal(renderBlindSamples(samples).includes('synthetic-root-0'), false);
  const topicSamples = Object.values(answerKey).filter((entry) => entry.cohort.startsWith('topic-'));
  assert.equal(topicSamples.length, 500);
  for (let index = 1; index <= 10; index += 1) {
    assert.equal(new Set(topicSamples.filter((entry) => entry.cohort === `topic-${index}`).map((entry) => entry.root_id)).size, 50);
  }
  const triggerBarrierSamples = Object.values(answerKey).filter((entry) => entry.cohort === 'trigger-barrier');
  assert.equal(triggerBarrierSamples.length, 100);
  assert.equal(new Set(triggerBarrierSamples.map((entry) => entry.root_id)).size, 100);
  assert.equal(samples.length, 600);
  assert.ok(samples.every((sample) => !Object.hasOwn(sample, 'root_id') && !Object.hasOwn(sample, 'probability')));
  assert.ok(samples.every((sample) => !Object.hasOwn(sample, 'topic_key') && !Object.hasOwn(sample, 'cohort')));
  assert.ok(Object.values(answerKey).some((entry) => entry.root_id === 'synthetic-root-0'));
});

test('public receipt contains aggregate metrics and excludes mention text and IDs', () => {
  const summary = summarizePilotSnapshot(fixture(), operatorReceipt());
  const receipt = renderPublicReceipt(summary, '2026-11-07');
  assert.match(receipt, /Estudio real A \(cerveza, Brasil\)/u);
  assert.match(receipt, /USD 2\.468000/u);
  assert.match(receipt, /Grupos BERTopic totales .*: 12/u);
  assert.match(receipt, /Public alias product-a/u);
  assert.doesNotMatch(receipt, /Synthetic topic A|Synthetic definition A/u);
  assert.doesNotMatch(receipt, /Synthetic mention/u);
  assert.doesNotMatch(receipt, /root-[1-4]/u);
});

test('requires an explicitly sanitized public catalog and rejects private identity terms', () => {
  const snapshot = fixture();
  const receipt = operatorReceipt(snapshot);
  receipt.public_catalog.topics[0].public_name = 'Confidential Brand Zeta';
  assert.throws(() => summarizePilotSnapshot(snapshot, receipt), /private_identity_leak/u);
  const missing = operatorReceipt(snapshot);
  delete missing.public_catalog;
  assert.throws(() => summarizePilotSnapshot(snapshot, missing), /public_catalog_required/u);
});

test('keeps unverified charges unknown instead of reporting free provider usage', () => {
  const receipt = operatorReceipt();
  receipt.stages[0].charged_micro_usd = null;
  const summary = summarizePilotSnapshot(fixture(), receipt);
  assert.equal(summary.charged_micro_usd, null);
  assert.equal(summary.charged_per_million_micro_usd, null);
  assert.match(renderPublicReceipt(summary, '2026-11-07'), /Cargo total confirmado: n\/d/u);
});

test('exports the H2 JSON contract into private audit files and sanitized public receipt', async () => {
  const { chmod, mkdir, readFile, rm, stat, writeFile } = await import('node:fs/promises');
  const { spawnSync } = await import('node:child_process');
  const { dirname, join, relative, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const privateRoot = join(repositoryRoot, '.data');
  const fixtureDirectory = join(privateRoot, `.pilot-audit-test-${process.pid}`);
  const publicReceiptPath = join(repositoryRoot, 'docs/product/PROMPT_LOOPING', `.pilot-audit-test-${process.pid}.md`);
  try {
    await mkdir(privateRoot, { recursive: true, mode: 0o700 });
    await chmod(privateRoot, 0o700);
    await mkdir(fixtureDirectory, { mode: 0o700 });
    const snapshot = fixture();
    snapshot.map.catalog = Array.from({ length: 10 }, (_, index) => ({
      topic_key: `product-${index}`, name: `Synthetic topic ${index}`, definition: `Synthetic definition ${index}`,
    }));
    snapshot.items = [];
    snapshot.calls = [];
    snapshot.map.root_count = 105;
    const receipt = operatorReceipt();
    receipt.population = { unique_roots: 106, excluded_roots: 1, eligible_roots: 105 };
    receipt.public_catalog.topics = snapshot.map.catalog.map((topic) => ({ topic_key: topic.topic_key,
      public_name: `Public alias ${topic.topic_key}`, public_definition: `Public definition ${topic.topic_key}` }));
    for (let index = 0; index < 105; index += 1) {
      const root_id = `synthetic-root-${index}`;
      const candidateKeys = Array.from({ length: 8 }, (_, offset) => `product-${(index + offset) % 10}`);
      const decision = index < 50 ? 'trigger' : index < 100 ? 'barrier' : 'none';
      const resultRow = result(root_id, 0.9, 0.85, decision, decision === 'none' ? 0.95 : 0.9);
      for (const [ordinal] of candidateKeys.entries()) resultRow.probabilities[`topic_${ordinal}`] = topicAnswer(0.9);
      resultRow.call_id = `synthetic-call-${index}`;
      snapshot.items.push({ root_id, ordinal: index + 1, text: `Synthetic auditor text ${index}`,
        status: 'labeled', call_id: resultRow.call_id, probabilities: resultRow.probabilities,
        candidates: candidateKeys.map((topic_key) => ({ topic_key })) });
      snapshot.calls.push({ id: resultRow.call_id, run_id: snapshot.run.run_id, model: 'synthetic-jev-v1', status: 'succeeded',
        settled_micro_usd: '0', usage: { input_tokens: 0 } });
    }
    receipt.stages[1].input_count = 105;
    receipt.stages[3].input_count = 1;
    receipt.stages[3].input_tokens = 0;
    receipt.stages[3].ledger_call_ids = ['synthetic-call-0'];
    receipt.stages[4].input_count = 104;
    receipt.stages[4].ledger_call_ids = snapshot.calls.slice(1).map((call) => call.id);
    receipt.stages[4].usage_value_micro_usd = 0;
    receipt.stages[4].charged_micro_usd = 0;
    receipt.stages[4].input_tokens = 0;
    receipt.snapshot_sha256 = computeSnapshotDigest(snapshot);
    const comparisonSnapshot = { ...comparison, topic_matches: [],
      new_product_topic_keys: snapshot.map.catalog.map((topic) => topic.topic_key), study_triggers: [], study_barriers: [] };
    const paths = {
      snapshot: join(fixtureDirectory, 'snapshot.json'),
      receipt: join(fixtureDirectory, 'operator-receipt.json'),
      comparison: join(fixtureDirectory, 'comparison.json'),
    };
    await writeFile(paths.snapshot, JSON.stringify(snapshot), { mode: 0o600 });
    await writeFile(paths.receipt, JSON.stringify(receipt), { mode: 0o600 });
    await writeFile(paths.comparison, JSON.stringify(comparisonSnapshot), { mode: 0o600 });
    const cli = join(repositoryRoot, 'scripts/dev-corpus/pilot-audit-export.mjs');
    const snapshotArgument = relative(repositoryRoot, paths.snapshot);
    const digestResult = spawnSync(process.execPath, [cli, '--snapshot-digest', snapshotArgument], { cwd: repositoryRoot, encoding: 'utf8' });
    assert.equal(digestResult.status, 0, digestResult.stderr);
    assert.equal(digestResult.stdout.trim(), receipt.snapshot_sha256);
    const args = [
      cli, '--snapshot', snapshotArgument,
      '--operator-receipt', relative(repositoryRoot, paths.receipt),
      '--comparison', relative(repositoryRoot, paths.comparison),
      '--out-dir', relative(repositoryRoot, join(fixtureDirectory, 'output')),
      '--public-receipt', relative(repositoryRoot, publicReceiptPath),
    ];
    const run = spawnSync(process.execPath, args, { cwd: repositoryRoot, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const outputDirectory = join(fixtureDirectory, 'output');
    const blindSamples = await readFile(join(outputDirectory, 'blind-samples.jsonl'), 'utf8');
    const key = JSON.parse(await readFile(join(outputDirectory, 'answer-key.json'), 'utf8'));
    const publicReceipt = await readFile(publicReceiptPath, 'utf8');
    assert.equal(blindSamples.trim().split('\n').length, 600);
    assert.doesNotMatch(blindSamples, /synthetic-root|topic_key|probability|cohort/u);
    assert.doesNotMatch(publicReceipt, /Synthetic topic [0-9]|Synthetic definition/u);
    assert.doesNotMatch(publicReceipt, /confidential brand zeta|private competitor omega/iu);
    assert.match(publicReceipt, /Public alias product-0/u);
    assert.match(publicReceipt, /Grupos BERTopic totales .*: 12/u);
    assert.equal(verifyAnswerKeySeal(key), true);
    assert.equal((await stat(join(outputDirectory, 'answer-key.json'))).mode & 0o077, 0);
  } finally {
    await rm(fixtureDirectory, { recursive: true, force: true });
    await rm(publicReceiptPath, { force: true });
  }
});
