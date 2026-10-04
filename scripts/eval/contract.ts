export const VOICES = ['individual', 'media', 'brand_official', 'retail_promo', 'creator', 'institution', 'unknown'] as const;
export const ACTS = ['experience', 'question_help', 'complaint', 'praise', 'opinion', 'news', 'promotion', 'other'] as const;
export const KINDS = ['primary_brand', 'competitor', 'category'] as const;
export type Entity = { entity_id: string; kind: typeof KINDS[number]; salience: 'main' | 'secondary' };
export type Partition = 'dev' | 'test';
export type Membership = 'belongs' | 'not_belongs' | 'insufficient';
export type Technical = 'refused' | 'error' | 'pending';
export type Dimension<T> = { value: T; abstained: boolean; confidence?: number | string };
export type Facets = { entities: Dimension<Entity[]>; unrelated_reason: 'homonym' | 'off_topic' | null;
  voice: Dimension<string>; act: Dimension<string>; spam_or_bot: Dimension<boolean>; language: Dimension<string | null>; asunto?: Dimension<string | null> };
export type Gold = { root_id: string; input_digest: string; partition: Partition; stratum: string; entities: Entity[]; entities_abstained: boolean;
  unrelated_reason: 'homonym' | 'off_topic' | null; voice: string; act: string; spam_or_bot: boolean; language: string; memberships: Record<string, Membership> };
export type Selection = { seed: string; context: { entities: { entity_id: string; kind: typeof KINDS[number] }[] };
  concepts: { concept_key: string }[]; selected: { root_id: string; input_digest: string; partition: Partition; stratum: string; comparison_verified?: boolean }[] };
export type Prediction = { root_id: string; input_digest: string; status: 'labeled' | 'abstained' | Technical; facets?: Facets;
  memberships?: Record<string, Membership | Technical>; probabilities?: { task: 'entity' | 'salience' | 'voice' | 'act' | 'spam' | 'membership'; key: string; probability: number }[] };
export const VARIANTS = ['A_facets_adaptive_low', 'A_facets_between_tools', 'A_judge_low', 'A_judge_medium', 'B_facets_jev', 'B_judge_jev'] as const;
export type Variant = { variant: typeof VARIANTS[number]; labeler_digest: string; prediction_rows: Prediction[];
  costs: { settled_usd: number | null; unknown_calls: number; reserved_usd: number; mentions_attempted: number; wall_ms: number | null };
  thresholds?: { selected_on: 'dev'; frozen_before_test: boolean; development_round: 0 | 1; values: Record<string, number> } };
export type Bundle = { contract_version: 'mfp-eval-v1'; human_gold: { origin: 'human'; reviewer_confirmed: true } | null; variants: Variant[] };
const assert: (value: unknown, code: string) => asserts value = (value, code) => { if (!value) throw new Error(`eval_${code}`); };
const string = (v: unknown) => typeof v === 'string' && v.length > 0;
const unique = (v: string[]) => new Set(v).size === v.length;
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
function entities(value: Entity[], context: Selection['context'], requireKind: boolean) {
  assert(Array.isArray(value) && unique(value.map(e => e.entity_id)), 'entity_duplicates');
  for (const e of value) {
    const known = context.entities.find(x => x.entity_id === e.entity_id);
    assert(known && KINDS.includes(e.kind) && ['main', 'secondary'].includes(e.salience) && (!requireKind || e.kind === known.kind), 'entity_invalid');
  }
}
export function validateSelection(selection: Selection) {
  assert(selection && string(selection.seed) && Array.isArray(selection.selected), 'selection_required');
  assert(selection.selected.length === 150 && unique(selection.selected.map(r => r.root_id)), 'selection_population');
  assert(selection.selected.filter(r => r.partition === 'dev').length === 90 && selection.selected.filter(r => r.partition === 'test').length === 60, 'selection_split');
  assert(selection.context?.entities?.length && unique(selection.context.entities.map(e => e.entity_id)), 'context_invalid');
  assert(selection.concepts?.length >= 2 && selection.concepts.length <= 3 && unique(selection.concepts.map(c => c.concept_key)), 'concepts_invalid');
  for (const e of selection.context.entities) assert(string(e.entity_id) && KINDS.includes(e.kind), 'context_entity');
  for (const c of selection.concepts) assert(string(c.concept_key), 'concept_key');
  for (const r of selection.selected) assert(string(r.root_id) && string(r.input_digest) && ['random', 'enriched', 'comparison'].includes(r.stratum), 'selection_row');
}
export function validateGold(rows: Gold[], selection: Selection) {
  assert(rows.length === 150 && unique(rows.map(r => r.root_id)), 'gold_population');
  for (const r of rows) {
    const s = selection.selected.find(x => x.root_id === r.root_id);
    assert(s && r.input_digest === s.input_digest && r.partition === s.partition && r.stratum === s.stratum, 'gold_selection_changed');
    entities(r.entities, selection.context, true);
    assert(typeof r.entities_abstained === 'boolean' && (!r.entities_abstained || !r.entities.length), 'gold_entity_abstention');
    assert(r.entities.length || r.entities_abstained ? r.unrelated_reason === null : ['homonym', 'off_topic'].includes(r.unrelated_reason ?? ''), 'gold_unrelated_reason');
    assert(VOICES.includes(r.voice as typeof VOICES[number]) && ACTS.includes(r.act as typeof ACTS[number]) && typeof r.spam_or_bot === 'boolean' && /^[a-z]{2}$/u.test(r.language), 'gold_dimension');
    assert(r.memberships && Object.keys(r.memberships).length === selection.concepts.length, 'gold_concepts');
    for (const c of selection.concepts) assert(['belongs', 'not_belongs', 'insufficient'].includes(r.memberships[c.concept_key]), 'gold_membership');
  }
}
export function validateBundle(bundle: Bundle, selection: Selection, partition: Partition, hasGold: boolean) {
  assert(bundle?.contract_version === 'mfp-eval-v1' && Array.isArray(bundle.variants) && unique(bundle.variants.map(v => v.variant)), 'bundle_invalid');
  if (hasGold) assert(bundle.human_gold?.origin === 'human' && bundle.human_gold.reviewer_confirmed === true, 'human_gold_confirmation_required');
  for (const v of bundle.variants) {
    assert(VARIANTS.includes(v.variant) && string(v.labeler_digest) && Array.isArray(v.prediction_rows) && unique(v.prediction_rows.map(r => r.root_id)), 'variant_invalid');
    const c = v.costs;
    assert(c && (c.settled_usd === null || finite(c.settled_usd)) && finite(c.reserved_usd) && Number.isInteger(c.unknown_calls) && c.unknown_calls >= 0 && Number.isInteger(c.mentions_attempted) && c.mentions_attempted >= 0 && (c.wall_ms === null || finite(c.wall_ms)), 'cost_invalid');
    if (v.thresholds) {
      assert(v.thresholds.selected_on === 'dev' && [0, 1].includes(v.thresholds.development_round) && typeof v.thresholds.frozen_before_test === 'boolean', 'threshold_dev_only');
      const keys = v.variant === 'B_facets_jev' ? ['entity', 'salience', 'spam', 'minimum_choice_confidence'] : ['membership'];
      assert(Object.keys(v.thresholds.values).length === keys.length && keys.every(k => finite(v.thresholds!.values[k]) && v.thresholds!.values[k] <= 1), 'threshold_values');
    }
    if (hasGold && partition === 'test' && v.variant.startsWith('B_')) assert(v.thresholds?.frozen_before_test === true, 'test_requires_dev_thresholds');
    for (const r of v.prediction_rows) {
      assert(string(r.root_id) && string(r.input_digest) && ['labeled', 'abstained', 'refused', 'error', 'pending'].includes(r.status), 'prediction_identity');
      const s = selection.selected.find(x => x.root_id === r.root_id);
      if (s) assert(s.input_digest === r.input_digest, 'stale_prediction');
      if (v.variant.includes('_facets_') && ['labeled', 'abstained'].includes(r.status)) assert(r.facets, 'facets_missing');
      if (r.facets) {
        const f = r.facets;
        entities(f.entities.value, selection.context, false);
        for (const d of [f.entities, f.voice, f.act, f.spam_or_bot, f.language]) assert(d && typeof d.abstained === 'boolean', 'dimension_abstention');
        assert(VOICES.includes(f.voice.value as typeof VOICES[number]) && ACTS.includes(f.act.value as typeof ACTS[number]) && typeof f.spam_or_bot.value === 'boolean' && (f.language.value === null || /^[a-z]{2}$/u.test(f.language.value)), 'prediction_dimension');
        assert(f.unrelated_reason === null || ['homonym', 'off_topic'].includes(f.unrelated_reason), 'prediction_reason');
      }
      for (const [key, value] of Object.entries(r.memberships ?? {})) assert(selection.concepts.some(c => c.concept_key === key) && ['belongs', 'not_belongs', 'insufficient', 'refused', 'error', 'pending'].includes(value), 'prediction_membership');
      const probabilities = r.probabilities ?? [];
      assert(unique(probabilities.map(p => `${p.task}:${p.key}`)), 'probability_duplicates');
      for (const p of probabilities) {
        assert(finite(p.probability) && p.probability <= 1, 'probability_range');
        const valid = p.task === 'entity' || p.task === 'salience' ? selection.context.entities.some(e => e.entity_id === p.key)
          : p.task === 'membership' ? selection.concepts.some(c => c.concept_key === p.key)
          : p.task === 'voice' ? VOICES.includes(p.key as typeof VOICES[number]) : p.task === 'act' ? ACTS.includes(p.key as typeof ACTS[number]) : p.task === 'spam' && p.key === 'true';
        assert(valid, 'probability_key');
      }
    }
  }
}
