import assert from 'node:assert/strict';
import test from 'node:test';
import { buildR13JevRequest, buildTriggerBarrierR13, buildMassLabelingJevRequestR13, massLabelingJevIdentityR13, isConsumerVoiceR13, isHashtagOnlyR13 } from './signal-mass-labeling-r13';
import { buildMassLabelingJevRequestV1, type MassLabelingInputV1 } from './signal-mass-labeling-jev-v1';
import type { EntityContextV1 } from './signal-entity-context-v1';
const item: MassLabelingInputV1 = { root_id: 'root', input_digest: 'input', text: 'Uma conversa comum.', title: null, platform: null, content_type: null, author: null, published_at: '', language: 'pt', map_id: 'map', map_digest: 'digest', chunk_index: 0,
  candidates: Array.from({ length: 8 }, (_, index) => ({ topic_key: `topic-${index}`, name: `Tema ${index}`, definition: `Definição ${index}`, similarity: 0.8 - index / 100 })) };
const context: EntityContextV1 = { entities: [{ entity_id: 'category', kind: 'category', name: 'Categoria', aliases: [], disambiguation: null }] };
test('repair names the category, consumer voice and commerce exclusions in both languages', () => {
  for (const language of ['pt', 'en'] as const) {
    const q = buildTriggerBarrierR13(language, 'beer-category');
    assert.equal(q.type, 'choice'); assert.match(JSON.stringify(q), /beer-category/); assert.match(JSON.stringify(q), /none/);
  }
  assert.throws(() => buildTriggerBarrierR13('pt', ''), /category/);
  const repair = buildR13JevRequest({ stage: 'repair', item, category: 'cerveja' });
  assert.deepEqual(Object.keys(repair.questions), ['trigger_barrier']); assert.equal(repair.state, item.text);
});
test('cost arms reproduce V1 and preserve identical questions for the same root', () => {
  const full = buildR13JevRequest({ stage: 'cost13', item, context, category: 'cerveja' });
  const small = buildR13JevRequest({ stage: 'cost7', item, context, category: 'cerveja' });
  assert.deepEqual(full, buildMassLabelingJevRequestV1(item, context));
  assert.equal(Object.keys(full.questions).length, 13); assert.equal(Object.keys(small.questions).length, 7);
  assert.equal(small.state, full.state);
  for (const [key, q] of Object.entries(small.questions)) assert.deepEqual(q, full.questions[key]);
  assert.equal(small.questions.relevance, undefined); assert.equal(small.questions.spam, undefined);
});
test('interests add two analyst definitions independently of existing candidates', () => {
  const request = buildR13JevRequest({ stage: 'interests', item, category: 'cerveja' });
  assert.deepEqual(Object.keys(request.questions), ['apostas', 'racismo']);
  assert.match(JSON.stringify(request.questions), /discriminação racial/);
});
test('language variants preserve text and compare only the corrected consumer question', () => {
  const request = buildR13JevRequest({ stage: 'language-en', item, category: 'beer' });
  assert.equal(request.state, item.text); assert.deepEqual(Object.keys(request.questions), ['trigger_barrier']);
  assert.match(JSON.stringify(request.questions.trigger_barrier), /beer/);
});
test('hashtag-only rule preserves words, URLs and emojis', () => {
  for (const text of ['#hoje #cerveja', ' (#ação), #futebol! ', '#hoje—#Brasil', '#a\u0345']) assert.equal(isHashtagOnlyR13(text), true);
  for (const text of ['', '...', 'Quero #cerveja', '#hoje 🍺', '#hoje https://example.com', 'não #spam', '#a²', '#a١']) assert.equal(isHashtagOnlyR13(text), false);
});
test('consumer indicator excludes advertising, official accounts and hashtag-only roots', () => {
  const make = (voice: string, promotion: number, text = 'Quero cerveja') => ({ text, probabilities: { voice: { type: 'choice' as const, choice: voice, confidence: 0.9, probabilities: { [voice]: 1 } }, promotion: { type: 'noul' as const, noul: promotion } } });
  assert.equal(isConsumerVoiceR13(make('individual', 0.7)), true);
  for (const voice of ['brand_official', 'retail_promo', 'media', 'creator', 'institution', 'unknown']) assert.equal(isConsumerVoiceR13(make(voice, 0)), false);
  assert.equal(isConsumerVoiceR13(make('individual', 0.71)), false);
  assert.equal(isConsumerVoiceR13(make('individual', 0, '#cerveja')), false);
});

test('new opt-in classifications name the category and retire generic relevance without modifying V1', () => {
  const old = buildMassLabelingJevRequestV1(item, context);
  const request = buildMassLabelingJevRequestR13(item, context, 'cerveja');
  assert.equal(Object.keys(request.questions).length, 12);
  assert.equal(request.questions.relevance, undefined);
  assert.equal(Object.keys(old.questions).length, 13);
  assert.notDeepEqual(request.questions.trigger_barrier, old.questions.trigger_barrier);
  assert.notEqual(massLabelingJevIdentityR13('cerveja').prompt_digest, massLabelingJevIdentityR13('café').prompt_digest);
  assert.deepEqual(buildR13JevRequest({ stage: 'label', item, context, category: 'cerveja' }), request);
});

test('full-root hashtag flag takes precedence over a selected fragment', () => {
  const probabilities = { voice: { type: 'choice' as const, choice: 'individual', confidence: 1, probabilities: { individual: 1 } }, promotion: { type: 'noul' as const, noul: 0 } };
  assert.equal(isConsumerVoiceR13({ text: '#fragment', probabilities, root_hashtag_only: false }), true);
  assert.equal(isConsumerVoiceR13({ text: 'fragment', probabilities, root_hashtag_only: true }), false);
});

test('new Portuguese classification selects corpus wording while historical and language arms preserve their bytes',()=>{
  const localization={original_language:'pt-BR',original:{name:'Encontros sociais',definition:'Pessoas descrevem encontros.'},
    en:{name:'Social gatherings',definition:'People describe gatherings.'},es:{name:'Encuentros sociales',definition:'Personas describen reuniones.'}};
  const multilingual={...item,candidates:item.candidates.map(candidate=>({...candidate,name:localization.en.name,
    definition:localization.en.definition,localization}))};
  const frozen=structuredClone(multilingual);
  const historicalBytes=JSON.stringify(buildMassLabelingJevRequestV1(multilingual,context));
  const ptVariant=JSON.stringify(buildR13JevRequest({stage:'language-pt',item:multilingual,category:'cerveja'}));
  const enVariant=JSON.stringify(buildR13JevRequest({stage:'language-en',item:multilingual,category:'beer'}));
  const current=buildMassLabelingJevRequestR13(multilingual,context,'cerveja');
  assert.match(JSON.stringify(current.questions.topic_0),/Encontros sociais/);
  assert.doesNotMatch(JSON.stringify(current.questions.topic_0),/Social gatherings/);
  assert.equal(JSON.stringify(buildR13JevRequest({stage:'cost13',item:multilingual,context,category:'cerveja'})),historicalBytes);
  assert.equal(JSON.stringify(buildR13JevRequest({stage:'language-pt',item:multilingual,category:'cerveja'})),ptVariant);
  assert.equal(JSON.stringify(buildR13JevRequest({stage:'language-en',item:multilingual,category:'beer'})),enVariant);
  assert.equal(JSON.stringify(buildMassLabelingJevRequestV1(multilingual,context)),historicalBytes);
  assert.deepEqual(multilingual,frozen);
  assert.deepEqual(buildMassLabelingJevRequestR13(item,context,'cerveja').questions.topic_0,
    buildMassLabelingJevRequestV1(item,context).questions.topic_0);
});
