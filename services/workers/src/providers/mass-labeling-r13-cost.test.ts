import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { compareR13JevCosts } from './mass-labeling-r13-cost';
import { buildR13JevRequest } from '@noisia/query-engine/src/signal-mass-labeling-r13';
import type { EntityContextV1 } from '@noisia/query-engine/src/signal-entity-context-v1';
import type { JevAnswerV1 } from '@noisia/query-engine/src/signal-mention-facets-jev-v1';
import type { R13Input, R13Result } from './mass-labeling-r13-runner';
const context: EntityContextV1 = { entities: [] };
const items: Array<R13Input & { baseline_input_tokens: number }> = Array.from({ length: 1000 }, (_, n) => ({ root_id: `root-${n}`, input_digest: `input-${n}`, text: `Texto ${n}`, title: null, platform: null, content_type: null, author: null, published_at: '', language: 'pt', map_id: 'map', map_digest: 'digest', chunk_index: 0, candidates: Array.from({ length: 8 }, (_, i) => ({ topic_key: `topic-${i}`, name: `Tema ${i}`, definition: `Definição ${i}`, similarity: 0.8 })), probabilities: {}, baseline_input_tokens: 2500 }));
function arm(item: R13Input, stage: 'cost13' | 'cost7'): R13Result {
  const request = buildR13JevRequest({ stage, item, category: 'cerveja', context });
  const answers: Record<string, JevAnswerV1> = {};
  for (const [key, q] of Object.entries(request.questions)) answers[key] = q.type === 'noul' ? { type: 'noul', noul: 0.8 } : { type: 'choice', choice: Object.keys(q.criteria)[0]!, confidence: 0.9, probabilities: Object.fromEntries(Object.keys(q.criteria).map((k, i) => [k, i === 0 ? 1 : 0])) };
  const input_tokens = stage === 'cost13' ? 2600 : 1500;
  return { contract_version: 'mass-labeling-r13-result-v1', stage, root_id: item.root_id, input_digest: item.input_digest, map_id: item.map_id, map_digest: item.map_digest, request_digest: `sha256:${createHash('sha256').update(JSON.stringify(request)).digest('hex')}`, question_count: stage === 'cost13' ? 13 : 7, status: 'settled', consumer_eligible: true, root_hashtag_only: false, response: { model: 'jev-1.13.0', answers, usage: { input_tokens, output_tokens: 0 } }, raw_sha256: 'synthetic', input_tokens, micro_usd: Math.ceil(input_tokens * 0.042) };
}
test('paired token comparison verifies requests and reports probability changes against both arms and history', () => {
  const full = items.map(i => arm(i, 'cost13')); const reduced = items.map(i => arm(i, 'cost7'));
  for (const [n, item] of items.entries()) item.probabilities = full[n]!.response.answers;
  const result = compareR13JevCosts({ items, full, reduced, context, category: 'cerveja' });
  assert.deepEqual(result.tokens_per_root, { full: 2600, reduced: 1500, historical: 2500 });
  assert.equal(result.measured_tokens_saved_per_removed_question, 1100 / 6);
  assert.equal(result.probability_comparisons.reduced_vs_full!.mean_absolute_delta, 0);
  reduced[0]!.response.answers.topic_0 = { type: 'noul', noul: 0.4 };
  const changed = compareR13JevCosts({ items, full, reduced, context, category: 'cerveja' });
  assert.equal(changed.probability_comparisons.reduced_vs_full!.threshold_crossings, 1);
  reduced[0]!.request_digest = 'wrong';
  assert.throws(() => compareR13JevCosts({ items, full, reduced, context, category: 'cerveja' }), /input_mismatch/);
});
