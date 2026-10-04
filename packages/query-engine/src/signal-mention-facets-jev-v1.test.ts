import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJevFacetRequestV1, mapJevFacetResponseV1, jevFacetLabelerIdentityV1, JEV_FACET_EXPERIMENTAL_THRESHOLDS_V1 as params, type JevResponseV1 } from './signal-mention-facets-jev-v1';
import type { FacetInput } from './signal-mention-labeler-v1';
import type { EntityContextV1 } from './signal-entity-context-v1';
const input: FacetInput = { root_id: 'root', input_digest: 'digest', text: 'A comparison of two fictional devices', title: null, platform: null, content_type: null, author: null, published_at: '2026-10-04T00:00:00Z', language: 'es' };
const context: EntityContextV1 = { entities: [{ entity_id: 'a', name: 'Device One', kind: 'primary_brand', aliases: ['One'], disambiguation: null }, { entity_id: 'b', name: 'Device Two', kind: 'competitor', aliases: ['Two'], disambiguation: null }] };
function response(): JevResponseV1 {
  const request = buildJevFacetRequestV1(input, context); const answers: JevResponseV1['answers'] = {};
  for (const [key, question] of Object.entries(request.questions)) {
    if (question.type === 'noul') answers[key] = { type: 'noul', noul: key === 'spam_or_bot' ? 0.1 : 0.9 };
    else { const keys = Object.keys(question.criteria); answers[key] = { type: 'choice', choice: keys[0]!, confidence: 1, probabilities: Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 1 : 0])) }; }
  }
  return { model: request.model, answers, usage: { input_tokens: 100, output_tokens: 50 } };
}
test('one request preserves every entity and salience, conditional reason, complete source and metadata', () => {
  const request = buildJevFacetRequestV1(input, context);
  assert.equal(Object.keys(request.questions).length, 8);
  assert.equal(request.questions.unrelated_reason!.type, 'choice');
  assert.deepEqual(buildJevFacetRequestV1(input, { entities: [...context.entities].reverse() }), request);
  const mapped = mapJevFacetResponseV1(input, context, response(), params);
  assert.equal(mapped.status, 'labeled'); assert.equal(mapped.facets?.entities.value.length, 2);
  assert.equal(mapped.facets?.unrelated_reason, null); assert.equal(mapped.facets?.asunto.value, null);
  assert.equal(mapped.facets?.language.value, 'es');
  assert.ok(mapped.facets?.entities.value.every(e => e.salience === 'main'));
});
test('empty entity set uses reason; exact threshold abstains instead of false unrelated', () => {
  const parsed = response(); parsed.answers.entity_0 = { type: 'noul', noul: 0.1 }; parsed.answers.entity_1 = { type: 'noul', noul: 0.2 };
  assert.equal(mapJevFacetResponseV1(input, context, parsed, params).facets?.unrelated_reason, 'homonym');
  parsed.answers.entity_0 = { type: 'noul', noul: 0.5 };
  const result = mapJevFacetResponseV1(input, context, parsed, params);
  assert.equal(result.status, 'abstained'); assert.equal(result.facets?.unrelated_reason, null);
});
test('metadata language avoids extra question; absent language covers all ISO choices and unknown', () => {
  assert.equal(buildJevFacetRequestV1(input, context).questions.language, undefined);
  const question = buildJevFacetRequestV1({ ...input, language: null }, context).questions.language;
  assert.equal(question?.type, 'choice');
  if (question?.type === 'choice') { assert.ok(Object.keys(question.criteria).length > 180); assert.ok(Object.keys(question.criteria).length <= 255); }
});
test('thresholds and model participate in experimental identity; invalid threshold rejected', () => {
  assert.notDeepEqual(jevFacetLabelerIdentityV1(params, 0.042), jevFacetLabelerIdentityV1({ ...params, entity: 0.8 }, 0.042));
  assert.equal(jevFacetLabelerIdentityV1(params, 0.042).params.calibration, 'unvalidated');
  assert.throws(() => jevFacetLabelerIdentityV1({ ...params, entity: NaN }, 0.042));
});
