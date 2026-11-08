import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  analyzeR13CostArms,
  appendR13ComparisonCorrection,
  buildNewConsumerSamples,
  buildR13LanguageVariants,
  isHashtagOnlyR13,
  projectR13Cost,
  renderCorrectedPublicReceiptR13,
  sealR13AnswerKey,
  writeR13BlindPacket,
  writeR13VariantFile,
  summarizeR13Baseline,
  summarizeR13Interests,
  summarizeR13Repair,
  verifyR13AnswerKeySeal,
} from './pilot-r13-audit.mjs';

const topic = (key) => ({ topic_key: key });
function makeItem(id, { voice = 'individual', promo = 0.3, text = 'Me gusta la cerveza.', candidates = [topic('a')],
  topics = [0.8], call = `call-${id}`, relevance = 0.2 } = {}) {
  const probabilities = { voice: { choice: voice }, promotion: { noul: promo }, relevance: { noul: relevance },
    trigger_barrier: { type: 'choice', choice: 'trigger', confidence: 0.8,
      probabilities: { trigger: 0.8, barrier: 0.1, none: 0.1 } } };
  candidates.forEach((_, index) => { probabilities[`topic_${index}`] = { noul: topics[index] ?? 0.2 }; });
  return { root_id: id, input_digest: `digest-${id}`, ordinal: Number(id.slice(1)), call_id: call,
    status: 'labeled', text, candidates, probabilities };
}
function result(item, stage, { choice = 'trigger', confidence = 0.9, interests = {}, tokens = 12 } = {}) {
  return { stage, root_id: item.root_id, input_digest: item.input_digest, status: 'settled', input_tokens: tokens,
    request_digest: `request-${stage}-${item.root_id}`, raw_sha256: `raw-${stage}-${item.root_id}`,
    response: { model: 'jev-1.13.0', usage: { input_tokens: tokens, output_tokens: 0 }, answers: {
      trigger_barrier: { type: 'choice', choice, confidence, probabilities: { trigger: choice === 'trigger' ? confidence : 0.05,
        barrier: choice === 'barrier' ? confidence : 0.05, none: choice === 'none' ? confidence : 0.05 } },
      ...Object.fromEntries(Object.entries(interests).map(([key, value]) => [key, { noul: value }])) } } };
}

test('hashtag-only rule requires at least one hashtag and accepts only tag text', () => {
  assert.equal(isHashtagOnlyR13('#hoje #brasil'), true);
  assert.equal(isHashtagOnlyR13('✨ #cerveja'), false);
  assert.equal(isHashtagOnlyR13('#brasil mas adorei'), false);
  assert.equal(isHashtagOnlyR13('um texto'), false);
});

test('historical summary separates generic relevance from promotion and voice', () => {
  const item = makeItem('r1', { relevance: 0.8, promo: 0.9, voice: 'retail_promo' });
  const summary = summarizeR13Baseline({ items: [item], calls: [{ id: item.call_id,
    usage: { input_tokens: 100, output_tokens: 3 } }] });
  assert.deepEqual(summary.original_relevance, { positive: 1, intermediate: 0, negative: 0, missing: 0 });
  assert.equal(summary.historical_trigger_barrier_by_promotion.trigger.promoted, 1);
  assert.equal(summary.prior_jev_usage.input_tokens_per_root, 100);
});

test('corrected consumer summary requires individual organic non hashtag-only posts', () => {
  const items = [
    makeItem('r1'),
    makeItem('r2', { voice: 'creator' }),
    makeItem('r3', { promo: 0.8 }),
    makeItem('r4', { text: '#brasil #cerveja' }),
  ];
  const output = summarizeR13Repair({ items }, items.map((item) => result(item, 'repair')));
  assert.deepEqual(output.consumer_eligibility, { eligible: 1, excluded: 3 });
  assert.equal(output.consumer_voice_by_prior_promotion.organic.trigger, 1);
  assert.equal(output.counts.trigger, 4);
});

test('new blind samples are reproducible, balanced, and disjoint from the sealed H4 cases', () => {
  const secret = randomBytes(32);
  const rows = Array.from({ length: 110 }, (_, index) => {
    const item = makeItem(`r${index + 1}`, { voice: index < 105 ? 'individual' : 'media' });
    return { root_id: item.root_id, input_digest: item.input_digest, eligible: index < 105,
      label: index % 2 ? 'trigger' : 'barrier', confidence: 0.85, text: item.text };
  });
  const repair = { private_rows: rows };
  const previous = rows.slice(0, 5).map((row) => row.root_id);
  const first = buildNewConsumerSamples(repair, previous, secret);
  const again = buildNewConsumerSamples(repair, previous, secret);
  assert.deepEqual(first, again);
  assert.equal(first.samples.length, 100);
  assert.equal(first.allocation.trigger, 50);
  assert.equal(first.allocation.barrier, 50);
  assert.equal(first.samples.some((sample) => previous.includes(first.answerKey[sample.case_id].root_id)), false);
  assert.equal(new Set(first.samples.map((sample) => first.answerKey[sample.case_id].root_id)).size, 100);
  assert.equal(verifyR13AnswerKeySeal(sealR13AnswerKey(first.answerKey)), true);
});

test('language export binds 597 paired blinded roots and emits no answer-key fields', () => {
  const pt = [], en = [], links = {};
  const withRaw = (row) => {
    row.raw_body = JSON.stringify(row.response);
    row.raw_response = JSON.parse(row.raw_body);
    row.raw_sha256 = `sha256:${createHash('sha256').update(row.raw_body).digest('hex')}`;
    return row;
  };
  for (let index = 0; index < 597; index++) {
    const root = `r${index}`;
    links[root] = [`case-${index}`];
    pt.push({ stage: 'language-pt', status: 'settled', root_id: root, input_digest: `d-${index}`,
      request_digest: 'pt-request', raw_sha256: '', input_tokens: 10, response: { model: 'jev-r13', usage: { input_tokens: 10 }, answers: {
        trigger_barrier: { type: 'choice', choice: 'trigger', confidence: 0.8,
          probabilities: { trigger: 0.8, barrier: 0.1, none: 0.1 } } } } });
    en.push({ stage: 'language-en', status: 'settled', root_id: root, input_digest: `d-${index}`,
      request_digest: 'en-request', raw_sha256: '', input_tokens: 9, response: { model: 'jev-r13', usage: { input_tokens: 9 }, answers: {
        trigger_barrier: { type: 'choice', choice: 'barrier', confidence: 0.7,
          probabilities: { trigger: 0.2, barrier: 0.7, none: 0.1 } } } } });
  }
  const rows = buildR13LanguageVariants(pt.map(withRaw), en.map(withRaw), links);
  assert.equal(rows.length, 1194);
  assert.equal(rows[0].question_language, 'pt');
  assert.equal(rows[1].question_language, 'en');
  assert.deepEqual(rows[0].probabilities, { trigger: 0.8, barrier: 0.1, none: 0.1 });
  assert.deepEqual(rows[1].probabilities, { trigger: 0.2, barrier: 0.7, none: 0.1 });
  assert.equal(rows.some((row) => 'answer_key' in row || 'verdict' in row), false);
  assert.equal(rows.some((row) => Object.hasOwn(row, 'root_id') || Object.hasOwn(row, 'response')), false);
  assert.throws(() => buildR13LanguageVariants(pt.slice(1).map(withRaw), en.map(withRaw), links), /count_invalid/u);
  const missing = pt.map((row) => withRaw({ ...row, response: structuredClone(row.response) }));
  delete missing[0].response.answers.trigger_barrier.probabilities;
  missing[0].raw_response = structuredClone(missing[0].response);
  missing[0].raw_body = JSON.stringify(missing[0].raw_response);
  missing[0].raw_sha256 = `sha256:${createHash('sha256').update(missing[0].raw_body).digest('hex')}`;
  assert.throws(() => buildR13LanguageVariants(missing, en.map((row) => withRaw({ ...row, response: structuredClone(row.response) })), links), /probability_invalid/u);
  const malformed = pt.map((row) => withRaw({ ...row, response: structuredClone(row.response) }));
  malformed[0].response.answers.trigger_barrier.probabilities.none = 0.4;
  malformed[0].raw_response = structuredClone(malformed[0].response);
  malformed[0].raw_body = JSON.stringify(malformed[0].raw_response);
  malformed[0].raw_sha256 = `sha256:${createHash('sha256').update(malformed[0].raw_body).digest('hex')}`;
  assert.throws(() => buildR13LanguageVariants(malformed, en.map((row) => withRaw({ ...row, response: structuredClone(row.response) })), links), /probability_invalid/u);
  const tampered = pt.map(withRaw); tampered[0].raw_body = '{}';
  assert.throws(() => buildR13LanguageVariants(tampered, en.map(withRaw), links), /raw_digest_mismatch/u);
});

test('decision threshold uses the selected option probability instead of conflicting confidence', () => {
  const item = makeItem('r-threshold');
  item.probabilities.trigger_barrier = { type: 'choice', choice: 'trigger', confidence: 0.99,
    probabilities: { trigger: 0.2, barrier: 0.5, none: 0.3 } };
  const baseline = summarizeR13Baseline({ items: [item], calls: [{ id: item.call_id,
    usage: { input_tokens: 10, output_tokens: 1 } }] });
  assert.equal(baseline.historical_trigger_barrier_by_promotion.unresolved.organic, 1);
  const repaired = result(item, 'repair', { confidence: 0.99 });
  repaired.response.answers.trigger_barrier.probabilities = { trigger: 0.2, barrier: 0.5, none: 0.3 };
  const summary = summarizeR13Repair({ items: [item] }, [repaired]);
  assert.equal(summary.counts.unresolved, 1);
});

test('defined-interest coverage reports individual counts and overlap with baseline topics', () => {
  const items = [makeItem('r1'), makeItem('r2'), makeItem('r3')];
  const interests = items.map((item, index) => result(item, 'interests', { interests: {
    apostas: index < 2 ? 0.8 : 0.1, racismo: index === 1 ? 0.8 : 0.1,
  } }));
  const metrics = summarizeR13Interests({ items }, interests);
  assert.equal(metrics.interests.apostas.roots, 2);
  assert.equal(metrics.interests.racismo.roots, 1);
  assert.equal(metrics.union.roots, 2);
  assert.equal(metrics.intersection_roots, 1);
  assert.equal(metrics.union.overlap_with_topics_roots, 2);
});

test('million-root projection scales Voyage and JEV by roots and editorial by group count', () => {
  const result = projectR13Cost({ roots: 1000, voyageTokens: 305_000, jevInputTokens: 2_489_000,
    observedEditorialUsd: 8, observedEditorialCalls: 144 });
  assert.deepEqual(result.per_million_roots.map((row) => row.editorial_groups), [180, 225, 270]);
  assert.equal(result.per_million_roots[0].voyage_usage_usd, 36.6);
  assert.equal(result.per_million_roots[0].jev_usage_usd, 104.538);
  assert.equal(result.per_million_roots[1].editorial_usage_usd, 12.5);
  assert.throws(() => projectR13Cost({ roots: 1, voyageTokens: 1, jevInputTokens: 1,
    observedEditorialUsd: 8, observedEditorialCalls: 144, forecastGroups: [5] }), /cost_inputs_invalid/u);
});

test('R13 comparison addendum corrects provenance and public receipt removes stale projections', () => {
  const item = makeItem('r1');
  const snapshot = { items: [item], calls: [{ id: item.call_id, usage: { input_tokens: 100, output_tokens: 4 } }] };
  const baseline = summarizeR13Baseline(snapshot);
  const repaired = summarizeR13Repair({ items: [item] }, [result(item, 'repair')]);
  const priorComparison = { study_triggers: [{ key: 'reference' }], marker: 'frozen' };
  const correctedComparison = appendR13ComparisonCorrection(priorComparison, repaired);
  assert.equal(priorComparison.r13_correction, undefined);
  assert.equal(correctedComparison.r13_correction.roots, 1);
  const projection = projectR13Cost({ roots: 1000, voyageTokens: 305_000, jevInputTokens: 2_489_000,
    observedEditorialUsd: 8, observedEditorialCalls: 144 });
  const rendered = renderCorrectedPublicReceiptR13({ receipt: '# Piloto de etiquetado masivo\n'
    + 'Cargo total confirmado: n/d.\nValor tarifario del uso: old wrong projection\n'
    + 'Estimación de caja con crédito: wrong\nLa proyección a 1,000,000 de raíces antigua.', baseline, repaired, projection });
  assert.doesNotMatch(rendered, /old wrong projection|Cargo total confirmado|Estimación de caja con crédito/u);
  assert.match(rendered, /Claude por grupo/u);
  assert.match(rendered, /La comparación inicial verificó la presencia/u);
  const nativeCost = { paired_roots: 1000, tokens_per_root: { full: 150, reduced: 95 },
    token_reduction_fraction: 0.3667 };
  const nativeRendered = renderCorrectedPublicReceiptR13({ receipt: '# Piloto de etiquetado masivo\n'
    + 'La proyección a 1,000,000 de raíces antigua.', baseline, repaired, projection, costComparison: nativeCost });
  assert.match(nativeRendered, /150\.00 tokens por raíz con trece preguntas y 95\.00 con siete/u);
  assert.match(nativeRendered, /55\.00 tokens \(36\.7%\)/u);
});

test('private audit artifacts stay separate, mode 0600, and cannot overwrite prior sealed files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pilot-r13-audit-'));
  try {
    const data = join(root, '.data');
    await mkdir(data, { mode: 0o700 });
    await chmod(data, 0o755);
    const samples = Array.from({ length: 100 }, (_, index) => ({ case_id: `case-${index}`, text: `private sample ${index}` }));
    const key = sealR13AnswerKey(Object.fromEntries(samples.map((row, index) => [row.case_id,
      { root_id: `root-${index}`, decision: index % 2 ? 'trigger' : 'barrier' }])));
    const packetPath = join(data, 'auditor', 'muestras-ciegas-r13.jsonl');
    const custodyPath = join(data, 'custodia', 'clave-r13.json');
    const saved = await writeR13BlindPacket({ dataRoot: data, packetPath, custodyPath, samples, seal: key });
    assert.equal(saved.sample_count, 100);
    const packet = await readFile(packetPath, 'utf8');
    const storedKey = JSON.parse(await readFile(custodyPath, 'utf8'));
    assert.equal(packet.includes('root-'), false);
    assert.equal(storedKey.sha256, key.sha256);
    assert.equal((await stat(packetPath)).mode & 0o777, 0o600);
    await assert.rejects(writeR13BlindPacket({ dataRoot: data, packetPath, custodyPath, samples, seal: key }), /already_exists/u);
    const variants = [];
    for (let index = 0; index < 597; index++) for (const language of ['pt', 'en']) {
      variants.push({ case_ids: [`case-${index}`], input_digest: `d-${index}`,
        question_language: language, request_digest: `${language}-${index}`, input_tokens: 5,
        raw_sha256: `raw-${language}-${index}`, probabilities: { trigger: 0.6, barrier: 0.3, none: 0.1 } });
    }
    const variantFile = join(data, 'auditor', 'variantes-r13.jsonl');
    const exportReceipt = await writeR13VariantFile({ dataRoot: data, destination: variantFile, rows: variants });
    assert.equal(exportReceipt.rows, 1194);
    assert.equal((await stat(variantFile)).mode & 0o777, 0o600);
    assert.equal((await readFile(variantFile, 'utf8')).includes('root-'), false);
    assert.equal((await readFile(variantFile, 'utf8')).includes('"choice"'), false);
    assert.equal((await writeR13VariantFile({ dataRoot: data, destination: variantFile, rows: variants })).reused, true);
    const invalidVariants = variants.map((row) => ({ ...row, probabilities: { trigger: 0.8, barrier: 0.8, none: 0.1 } }));
    await assert.rejects(writeR13VariantFile({ dataRoot: data,
      destination: variantFile, rows: invalidVariants }), /row_invalid/u);
    await assert.rejects(writeR13VariantFile({ dataRoot: data,
      destination: join(data, 'other.jsonl'), rows: variants }), /output_directory_invalid/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
