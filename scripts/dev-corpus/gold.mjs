import { createHash } from 'node:crypto';
export const hash = value => createHash('sha256').update(value).digest('hex');
const normalize = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim();
export function matchingEntities(text, entities) {
  const normalized = ` ${normalize(text)} `;
  return entities.filter(entity => [entity.name, ...(entity.aliases ?? [])].some(alias => {
    const word = normalize(alias);
    if (!word) return false;
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(normalized);
  }));
}
export function selectGold(roots, entities, seed, verifiedComparisonIds = []) {
  if (new Set(roots.map(root => root.root_id)).size !== roots.length) throw new Error('mfp_gold_duplicate_root');
  const ranked = [...roots].sort((a, b) => hash(`${seed}:${a.root_id}`).localeCompare(hash(`${seed}:${b.root_id}`)));
  const verified = new Set(verifiedComparisonIds);
  const comparisons = ranked.filter(root => verified.has(root.root_id) && matchingEntities(`${root.title ?? ''} ${root.text}`, entities).length >= 2);
  if (comparisons.length < 15) throw new Error('mfp_gold_fifteen_verified_comparisons_required');
  // Reserve enriched rows first so random selection cannot consume the quota.
  const selected = comparisons.slice(0, 15).map(root => ({ ...root, stratum: 'comparison', comparison_verified: true }));
  const selectedIds = new Set(selected.map(root => root.root_id));
  const enriched = ranked.filter(root => !selectedIds.has(root.root_id)).sort((a, b) => score(b) - score(a));
  function score(root) { return matchingEntities(`${root.title ?? ''} ${root.text}`, entities).length * 100000 + root.text.length; }
  for (const root of enriched.slice(0, 35)) { selected.push({ ...root, stratum: 'enriched', comparison_verified: false }); selectedIds.add(root.root_id); }
  for (const root of ranked.filter(root => !selectedIds.has(root.root_id)).slice(0, 100)) selected.push({ ...root, stratum: 'random', comparison_verified: false });
  if (selected.length !== 150) throw new Error('mfp_gold_insufficient_roots');
  // Fix 90/60 split before any model output exists, 60/40 within each stratum.
  const counts = new Map();
  return selected.map(root => { const n = counts.get(root.stratum) ?? 0; counts.set(root.stratum, n + 1);
    const limit = root.stratum === 'comparison' ? 9 : root.stratum === 'enriched' ? 21 : 60;
    return { ...root, partition: n < limit ? 'dev' : 'test' }; });
}
const allowed = { voice: ['individual','media','brand_official','retail_promo','creator','institution','unknown'],
  act: ['experience','question_help','complaint','praise','opinion','news','promotion','other'],
  unrelated_reason: ['homonym','off_topic'] };
export function importGold(rows, template, context, conceptKeys) {
  const originals = new Map(template.map(row => [row.root_id, row]));
  const names = new Map();
  for (const entity of context.entities) {
    if (names.has(normalize(entity.name))) throw new Error('mfp_gold_ambiguous_entity_name');
    names.set(normalize(entity.name), entity);
  }
  if (rows.length !== 150 || new Set(rows.map(row => row.root_id)).size !== 150) throw new Error('mfp_gold_population_invalid');
  const result = rows.map(row => {
    const source = originals.get(row.root_id);
    if (!source || row.partition !== source.partition || row.text !== source.text || row.stratum !== source.stratum) throw new Error('mfp_gold_source_changed');
    const entities = row.entities.split(';').map(value => value.trim()).filter(Boolean).map(value => {
      const main = value.endsWith('*'); const entity = names.get(normalize(main ? value.slice(0,-1).trim() : value));
      if (!entity) throw new Error('mfp_gold_unknown_entity');
      return { entity_id: entity.entity_id, kind: entity.kind, salience: main ? 'main' : 'secondary' };
    });
    if (new Set(entities.map(entity => entity.entity_id)).size !== entities.length) throw new Error('mfp_gold_duplicate_entity');
    const abstained = row.entities_abstained === 'true';
    if (!['true','false'].includes(row.entities_abstained) || (abstained && entities.length)) throw new Error('mfp_gold_abstention_invalid');
    if ((!entities.length && !abstained && !allowed.unrelated_reason.includes(row.unrelated_reason)) || ((entities.length || abstained) && row.unrelated_reason)) throw new Error('mfp_gold_unrelated_reason_invalid');
    if (!allowed.voice.includes(row.voice) || !allowed.act.includes(row.act) || !['true','false'].includes(row.spam_or_bot) || !/^[a-z]{2}$/u.test(row.language)) throw new Error('mfp_gold_dimension_invalid');
    if (row.asunto.trim().split(/\s+/u).filter(Boolean).length > 12) throw new Error('mfp_gold_asunto_too_long');
    const memberships = Object.fromEntries(conceptKeys.map(key => {
      const value = row[`concept:${key}`];
      if (!['belongs','not_belongs','insufficient'].includes(value)) throw new Error('mfp_gold_membership_invalid');
      return [key, value];
    }));
    return { root_id: row.root_id, input_digest: source.input_digest, partition: source.partition, stratum: source.stratum,
      entities, entities_abstained: abstained, unrelated_reason: row.unrelated_reason || null, voice: row.voice, act: row.act,
      spam_or_bot: row.spam_or_bot === 'true', language: row.language, asunto: row.asunto || null, memberships };
  });
  if (result.filter(row => row.stratum === 'comparison' && row.entities.length >= 2).length < 15) throw new Error('mfp_gold_comparisons_not_confirmed');
  return result;
}
