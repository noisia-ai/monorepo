import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { binary, categorical, reliability, wilson } from './metrics.ts';
import { buildReport, renderMarkdown } from './report.ts';
import { main } from './facets-report.ts';
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const entity = (entity_id = 'private-entity', salience = 'main') => ({ entity_id, kind: entity_id === 'private-entity' ? 'primary_brand' : 'competitor', salience });
function fixture() {
  const selected = Array.from({ length: 150 }, (_, i) => ({ root_id: `private-root-${i}`, input_digest: `digest-${i}`, partition: i < 90 ? 'dev' : 'test', stratum: i < 100 ? 'random' : i < 135 ? 'enriched' : 'comparison', text: 'SECRET_CORPUS_DO_NOT_RENDER' }));
  const selection = { seed: 'fixed-seed', context: { entities: [entity(), entity('private-competitor')] }, concepts: [{ concept_key: 'private-concept-one' }, { concept_key: 'private-concept-two' }], selected };
  const gold = selected.map(s => ({ ...s, entities: [entity()], entities_abstained: false, unrelated_reason: null, voice: 'individual', act: 'experience', spam_or_bot: false, language: 'es', asunto: 'SECRET_CORPUS_DO_NOT_RENDER', memberships: { 'private-concept-one': 'belongs', 'private-concept-two': 'not_belongs' } }));
  const dim = value => ({ value, confidence: 'high', abstained: false });
  const prediction_rows = gold.map(g => ({ root_id: g.root_id, input_digest: g.input_digest, status: 'labeled', facets: { entities: dim(g.entities), unrelated_reason: null, voice: dim(g.voice), act: dim(g.act), spam_or_bot: dim(false), language: dim('es'), asunto: dim(g.asunto) }, memberships: g.memberships }));
  const variant = { variant: 'A_facets_adaptive_low', labeler_digest: 'private-labeler', prediction_rows, costs: { settled_usd: 0.15, reserved_usd: 0, unknown_calls: 0, mentions_attempted: 150, wall_ms: 1000 } };
  const bundle = { contract_version: 'mfp-eval-v1', human_gold: { origin: 'ai_assisted_founder_reviewed', reviewer_confirmed: true, assistant_model: 'independent-opus', reviewed_rows: 15, corrected_rows: 2 }, variants: [variant] };
  return { selection, gold, bundle, variant };
}
test('independent binary counts and Wilson examples, including zero denominators', () => {
  assert.deepEqual(binary(3, 1, 2), { tp: 3, fp: 1, fn: 2, precision: 0.75, recall: 0.6, f1: 2 / 3 });
  const interval = wilson(8, 10); close(interval.low, 0.4901624715366418); close(interval.high, 0.9433178485456247);
  assert.equal(wilson(0, 0), null); assert.equal(binary(0, 0, 0).f1, null);
  assert.throws(() => wilson(2, 1), /eval_wilson_counts/);
});
test('categorical macro includes prediction-only classes and keeps technical failures', () => {
  const m = categorical([{ truth: 'a', predicted: 'a' }, { truth: 'a', predicted: 'b' }, { truth: 'a', predicted: 'error' }, { truth: 'a', predicted: 'abstained' }], ['a', 'b', 'absent']);
  close(m.accuracy, 0.25); close(m.macro_f1, 0.2); close(m.abstention_rate, 0.25);
  close(m.accuracy_wilson.low,wilson(1,4).low);
  close(m.per_class.a.recall_wilson.high,wilson(1,4).high);
  assert.equal(m.per_class.absent.precision_wilson,null);
  assert.equal(m.confusion.a.error, 1); assert.equal(m.per_class.absent.f1, null);
});
test('ECE known example and p=1 boundary', () => {
  const r = reliability([{ probability: 0.1, outcome: false }, { probability: 0.2, outcome: true }, { probability: 0.8, outcome: true }, { probability: 1, outcome: true }], 2);
  close(r.ece, 0.225); assert.equal(r.bins[1].count, 2); assert.equal(reliability([]).ece, null);
  assert.throws(() => reliability([{ probability: 1.1, outcome: true }]), /eval_probability_invalid/);
});
test('no human gold gives no evaluated metrics, winner, or approval', () => {
  const { selection, bundle } = fixture(); bundle.human_gold = null;
  const r = buildReport(selection, null, bundle, 'dev');
  assert.equal(r.status, 'no_evaluado'); assert.equal(r.variants[0].dimensions, null); assert.equal(r.variants[0].entities, null);
  assert.equal(r.approval, 'requires_founder_confirmation');
});
test('fixed source/split and truthful assisted gold provenance reject substitutes', () => {
  const f = fixture();
  assert.equal(buildReport(f.selection, f.gold, f.bundle, 'dev').selection.comparison_target_met, false);
  f.gold[0].partition = 'test'; assert.throws(() => buildReport(f.selection, f.gold, f.bundle, 'dev'), /eval_gold_selection_changed/);
  f.gold[0].partition = 'dev'; f.bundle.human_gold.origin = 'model'; assert.throws(() => buildReport(f.selection, f.gold, f.bundle, 'dev'), /eval_gold_provenance_required/);
  f.bundle.human_gold.origin = 'ai_assisted_founder_reviewed'; f.bundle.human_gold.reviewed_rows = 1; f.bundle.human_gold.corrected_rows = 2;
  assert.throws(() => buildReport(f.selection, f.gold, f.bundle, 'dev'), /eval_gold_provenance_required/);
});
test('entity multi-label counts, kind/salience, and missing prediction retain FN', () => {
  const f = fixture(); f.gold[0].entities = [entity(), entity('private-competitor')];
  f.variant.prediction_rows[0].facets.entities.value = [entity('private-competitor', 'secondary')];
  f.variant.prediction_rows[1].status = 'error';
  const m = buildReport(f.selection, f.gold, f.bundle, 'dev').variants[0];
  assert.equal(m.entities.micro.tp, 89); assert.equal(m.entities.micro.fn, 2); assert.equal(m.entities.unavailable_predictions, 1);
  assert.equal(m.comparisons.micro.recall, 0.5); assert.equal(m.comparisons.salience_accuracy, 0);
  assert.equal(m.entities.correct_pair_denominator, 89);
});
test('membership never interprets absent/error/insufficient as semantic negative', () => {
  const f = fixture(); f.variant.variant = 'A_judge_medium';
  f.variant.prediction_rows[0].status = 'error';
  f.variant.prediction_rows[1].memberships = {};
  f.variant.prediction_rows[2].memberships = { 'private-concept-one': 'insufficient' };
  const m = buildReport(f.selection, f.gold, f.bundle, 'dev').variants[0].memberships[0];
  assert.equal(m.tp, 87); assert.equal(m.fn, 3); assert.equal(m.errors.false_negative_semantic, 0);
  assert.equal(m.errors.error, 1); assert.equal(m.errors.pending, 1); close(m.insufficient_rate, 1 / 90);
});
test('dev statistics invariant to held-out test predictions; B/test requires dev threshold provenance', () => {
  const f = fixture(), before = buildReport(f.selection, f.gold, f.bundle, 'dev');
  for (const p of f.variant.prediction_rows.slice(90)) p.status = 'error';
  assert.deepEqual(buildReport(f.selection, f.gold, f.bundle, 'dev'), before);
  f.variant.variant = 'B_facets_jev';
  assert.throws(() => buildReport(f.selection, f.gold, f.bundle, 'test'), /eval_test_requires_dev_thresholds/);
  f.variant.thresholds = { selected_on: 'dev', frozen_before_test: true, development_round: 0, values: { entity: 0.5, salience: 0.5, spam: 0.5, minimum_choice_confidence: 0 } };
  assert.equal(buildReport(f.selection, f.gold, f.bundle, 'test').variants[0].dimensions.voice.accuracy, 0);
  f.variant.thresholds.selected_on = 'test'; assert.throws(() => buildReport(f.selection, f.gold, f.bundle, 'test'), /eval_threshold_dev_only/);
});
test('agreement excludes unavailable and stale pairs, and never claims accuracy', () => {
  const f = fixture(); const b = structuredClone(f.variant); b.variant = 'B_facets_jev';
  b.prediction_rows[0].status = 'error'; b.prediction_rows.pop(); f.bundle.variants.push(b);
  const r = buildReport(f.selection, null, f.bundle, 'dev');
  assert.equal(r.agreement.metrics[0].comparable, 148); assert.equal(r.agreement.metrics[0].excluded, 2); assert.equal(r.agreement.accuracy_claim, false);
});
test('calibration derives outcomes from human gold, not caller supplied accuracy', () => {
  const f = fixture(); f.variant.variant = 'B_facets_jev';
  f.variant.prediction_rows[0].probabilities = [{ task: 'entity', key: 'private-entity', probability: 0.8 }, { task: 'spam', key: 'true', probability: 0.1 }];
  const r = buildReport(f.selection, f.gold, f.bundle, 'dev').variants[0].reliability;
  close(r.entity.ece, 0.2); close(r.spam.ece, 0.1); assert.equal(r.entity.calibration_claim, 'not_established');
});
test('markdown projection excludes corpus, private identifiers and arbitrary fields', () => {
  const f = fixture(); f.variant.untrusted_note = 'PRIVATE_PROVIDER_PROMPT';
  const md = renderMarkdown(buildReport(f.selection, f.gold, f.bundle, 'dev'));
  for (const secret of ['SECRET_CORPUS', 'private-entity', 'private-concept', 'private-root', 'private-labeler', 'PRIVATE_PROVIDER_PROMPT']) assert.ok(!md.includes(secret));
  assert.match(md, /entity_1/); assert.match(md, /no se eliminó ningún gold válido/);
});
test('CLI pins exact existing selection bytes and protects earlier receipt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mfp-eval-test-'));
  try {
    const f = fixture(), selection = join(dir, 'selection.json'), output = join(dir, 'report.md');
    const bytes = JSON.stringify(f.selection); await writeFile(selection, bytes);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const args = ['--selection', selection, '--selection-sha256', digest, '--output', output];
    await main(args); assert.match(await readFile(output, 'utf8'), /no_evaluado/);
    await assert.rejects(main(args), /EEXIST/);
    await writeFile(selection, bytes + ' '); await assert.rejects(main(args), /eval_selection_fingerprint_mismatch/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('test candidate uses preregistered price tiebreak and refuses unknown cost', () => {
  const f = fixture(), other = structuredClone(f.variant); other.variant = 'A_facets_between_tools'; other.costs.settled_usd = 0.1;
  f.bundle.variants.push(other);
  const candidate = buildReport(f.selection, f.gold, f.bundle, 'test').candidates.find(c => c.dimension === 'entities');
  assert.equal(candidate.candidate, other.variant); assert.equal(candidate.reason, 'less_than_three_points_cheapest');
  other.costs.unknown_calls = 1;
  assert.equal(buildReport(f.selection, f.gold, f.bundle, 'test').candidates[0].candidate, null);
});
test('fully missing negatives never obtain exact empty-set credit; nullable costs stay incomplete', () => {
  const f = fixture(); f.gold[0].entities = []; f.gold[0].unrelated_reason = 'off_topic';
  f.variant.prediction_rows.shift(); f.variant.costs.settled_usd = null;
  const r = buildReport(f.selection, f.gold, f.bundle, 'dev');
  close(r.variants[0].entities.exact_set_accuracy, 89 / 90);
  assert.equal(r.variants[0].costs.settled_usd_per_1000, null); assert.equal(r.total_cost_complete, false);
});
