import { ACTS, VOICES, VARIANTS, validateBundle, validateGold, validateSelection, type Bundle, type Entity, type Gold, type Partition, type Prediction, type Selection, type Variant } from './contract';
import { binary, categorical, divide, mean, reliability, wilson } from './metrics';
const terminal = (p?: Prediction) => !p ? 'pending' : ['refused', 'error', 'pending'].includes(p.status) ? p.status : null;
function dimension(p: Prediction | undefined, name: 'voice' | 'act' | 'spam_or_bot' | 'language') {
  const status = terminal(p); if (status) return status;
  const d = p?.facets?.[name]; return !d || d.abstained || d.value === null ? 'abstained' : String(d.value);
}
function predictedEntities(p?: Prediction): Entity[] | null {
  return terminal(p) || !p?.facets || p.facets.entities.abstained ? null : p.facets.entities.value;
}
function relevance(p?: Prediction) {
  const status = terminal(p); if (status) return status;
  const f = p?.facets;
  if (!f) return 'unknown';
  if (!f.spam_or_bot.abstained && f.spam_or_bot.value) return 'spam';
  if (f.entities.abstained) return 'unknown';
  if (f.entities.value.length) return 'relevant';
  return f.unrelated_reason ? 'unrelated' : 'unknown';
}
const goldRelevance = (g: Gold) => g.spam_or_bot ? 'spam' : g.entities_abstained ? 'unknown' : g.entities.length ? 'relevant' : 'unrelated';
function entityMetrics(gold: Gold[], predictions: Map<string, Prediction>, selection: Selection) {
  const known = gold.filter(g => !g.entities_abstained);
  let tp = 0, fp = 0, fn = 0, exact = 0, kind = 0, salience = 0;
  const perEntity = selection.context.entities.map((e, ordinal) => {
    let a = 0, b = 0, c = 0;
    for (const g of known) {
      const truth = g.entities.find(x => x.entity_id === e.entity_id);
      const pred = predictedEntities(predictions.get(g.root_id))?.find(x => x.entity_id === e.entity_id);
      if (truth && pred) { a++; kind += Number(truth.kind === pred.kind); salience += Number(truth.salience === pred.salience); }
      else if (pred) b++; else if (truth) c++;
    }
    tp += a; fp += b; fn += c;
    return { entity: `entity_${ordinal + 1}`, ...binary(a, b, c) };
  });
  for (const g of known) {
    const p = predictedEntities(predictions.get(g.root_id));
    if (p && p.length === g.entities.length && p.every(e => g.entities.some(t => t.entity_id === e.entity_id))) exact++;
  }
  return { roots: gold.length, evaluable_roots: known.length, gold_abstained: gold.length - known.length,
    unavailable_predictions: known.filter(g => predictedEntities(predictions.get(g.root_id)) === null).length,
    micro: {...binary(tp, fp, fn),precision_wilson:wilson(tp,tp+fp),recall_wilson:wilson(tp,tp+fn)}, macro_precision: mean(perEntity.map(v => v.precision)), macro_recall: mean(perEntity.map(v => v.recall)), macro_f1: mean(perEntity.map(v => v.f1)),
    exact_set_accuracy: divide(exact, known.length), correct_pair_denominator: tp, kind_accuracy: divide(kind, tp), salience_accuracy: divide(salience, tp), per_entity: perEntity };
}
function membershipVerdict(p: Prediction | undefined, conceptKey: string) {
  return terminal(p) ?? p?.memberships?.[conceptKey] ?? 'pending';
}
function membershipMetric(gold: Gold[], predictions: Map<string, Prediction>, conceptKey: string, ordinal: number) {
    const rows = gold.map(g => ({ truth: g.memberships[conceptKey], predicted: membershipVerdict(predictions.get(g.root_id), conceptKey) }));
    const resolvedGold = rows.filter(r => r.truth !== 'insufficient');
    const tp = resolvedGold.filter(r => r.truth === 'belongs' && r.predicted === 'belongs').length;
    const fp = resolvedGold.filter(r => r.truth === 'not_belongs' && r.predicted === 'belongs').length;
    const fn = resolvedGold.filter(r => r.truth === 'belongs' && r.predicted !== 'belongs').length;
    return { concept: `concept_${ordinal + 1}`, denominator: rows.length, binary_gold_denominator: resolvedGold.length,
      gold_insufficient: rows.length - resolvedGold.length, ...binary(tp, fp, fn), precision_wilson:wilson(tp,tp+fp),recall_wilson: wilson(tp, tp + fn),
      insufficient_rate: divide(rows.filter(r => r.predicted === 'insufficient').length, rows.length),
      errors: { false_positive: fp, false_negative_semantic: resolvedGold.filter(r => r.truth === 'belongs' && r.predicted === 'not_belongs').length,
        false_negative_without_positive_judgment: resolvedGold.filter(r => r.truth === 'belongs' && !['belongs','not_belongs'].includes(r.predicted)).length,
        insufficient: rows.filter(r => r.predicted === 'insufficient').length, refused: rows.filter(r => r.predicted === 'refused').length, error: rows.filter(r => r.predicted === 'error').length, pending: rows.filter(r => r.predicted === 'pending').length } };
}
function membershipMetrics(gold: Gold[], predictions: Map<string, Prediction>, selection: Selection) {
  return selection.concepts.map((c, ordinal) => membershipMetric(gold,predictions,c.concept_key,ordinal));
}
function calibration(gold: Gold[], predictions: Map<string, Prediction>, selection: Selection) {
  const groups = new Map<string, { probability: number; outcome: boolean }[]>();
  const add = (key: string, probability: number, outcome: boolean) => groups.set(key, [...(groups.get(key) ?? []), { probability, outcome }]);
  for (const g of gold) {
    const p = predictions.get(g.root_id);
    if (terminal(p)) continue;
    for (const item of p?.probabilities ?? []) {
      if (item.task === 'entity' && !g.entities_abstained) add('entity', item.probability, g.entities.some(e => e.entity_id === item.key));
      if (item.task === 'salience' && !g.entities_abstained) {
        const e = g.entities.find(e => e.entity_id === item.key); if (e) add('salience', item.probability, e.salience === 'main');
      }
      if (item.task === 'spam') add('spam', item.probability, g.spam_or_bot);
      // Choice confidence: only the declared top choice, never a pooled multiclass distribution.
      if (item.task === 'voice' && p?.facets?.voice.value === item.key) add('voice', item.probability, g.voice === item.key);
      if (item.task === 'act' && p?.facets?.act.value === item.key) add('act', item.probability, g.act === item.key);
      if (item.task === 'membership' && g.memberships[item.key] !== 'insufficient') {
        const ordinal = selection.concepts.findIndex(c => c.concept_key === item.key);
        add(`membership_${ordinal + 1}`, item.probability, g.memberships[item.key] === 'belongs');
      }
    }
  }
  const names = ['entity', 'salience', 'voice', 'act', 'spam', ...selection.concepts.map((_, i) => `membership_${i + 1}`)];
  return Object.fromEntries(names.map(name => [name, reliability(groups.get(name) ?? [])]));
}
function costs(v: Variant) {
  return { ...v.costs, settled_usd_per_1000: v.costs.settled_usd === null ? null : divide(1000 * v.costs.settled_usd, v.costs.mentions_attempted),
    complete: v.costs.settled_usd !== null && v.costs.unknown_calls === 0 && v.costs.reserved_usd === 0 };
}
function agreement(bundle: Bundle) {
  const a = bundle.variants.find(v => v.variant === 'A_facets_adaptive_low');
  const b = bundle.variants.find(v => v.variant === 'B_facets_jev');
  if (!a || !b) return null;
  const left = new Map(a.prediction_rows.map(r => [r.root_id, r])), right = new Map(b.prediction_rows.map(r => [r.root_id, r]));
  const roots = new Set([...left.keys(), ...right.keys()]);
  const result = ['voice', 'act', 'spam_or_bot', 'entities', 'relevance'].map(name => {
    let comparable = 0, agreed = 0;
    for (const root of roots) {
      const x = left.get(root), y = right.get(root);
      if (!x || !y || x.input_digest !== y.input_digest || terminal(x) || terminal(y)) continue;
      let l: string, r: string;
      if (name === 'entities') {
        const xe = predictedEntities(x), ye = predictedEntities(y); if (!xe || !ye) continue;
        l = xe.map(e => e.entity_id).sort().join('\0'); r = ye.map(e => e.entity_id).sort().join('\0');
      } else if (name === 'relevance') { l = relevance(x); r = relevance(y); if (l === 'unknown' || r === 'unknown') continue; }
      else { l = dimension(x, name as 'voice'); r = dimension(y, name as 'voice'); if (l === 'abstained' || r === 'abstained') continue; }
      comparable++; agreed += Number(l === r);
    }
    return { dimension: name, comparable, excluded: roots.size - comparable, agreement: divide(agreed, comparable) };
  });
  return { scope: 'exported_corpus_without_gold', union_roots: roots.size, missing_claude: roots.size - left.size, missing_jev: roots.size - right.size, metrics: result, accuracy_claim: false };
}
function judgeComparisons(gold: Gold[], bundle: Bundle, selection: Selection) {
  const bJudge = bundle.variants.find(v => v.variant === 'B_judge_jev');
  const bFacets = bundle.variants.find(v => v.variant === 'B_facets_jev');
  if (!bJudge || !bFacets) return null;
  const bPredictions = new Map(bJudge.prediction_rows.map(r => [r.root_id,r]));
  const bFacetPredictions = new Map(bFacets.prediction_rows.map(r => [r.root_id,r]));
  const bPipeline = new Map(bJudge.prediction_rows.filter(r =>
    relevance(bFacetPredictions.get(r.root_id)) === 'relevant').map(r => [r.root_id,r]));
  const binaryVerdict = (p: Prediction | undefined, key: string) =>
    ['belongs','not_belongs'].includes(membershipVerdict(p,key));
  return (['A_judge_low','A_judge_medium'] as const).flatMap(name => {
    const aJudge = bundle.variants.find(v => v.variant === name);
    if (!aJudge) return [];
    const aPredictions = new Map(aJudge.prediction_rows.map(r => [r.root_id,r]));
    return selection.concepts.map((concept,ordinal) => {
      const key = concept.concept_key;
      const evaluated = gold.filter(g => ['belongs','not_belongs','insufficient'].includes(membershipVerdict(aPredictions.get(g.root_id),key)));
      const commonEmitted = evaluated.filter(g => binaryVerdict(aPredictions.get(g.root_id),key) && binaryVerdict(bPredictions.get(g.root_id),key));
      return { a_variant:name, concept:`concept_${ordinal + 1}`,
        a_evaluated_vs_b_same_roots:{roots:evaluated.length,
          a:membershipMetric(evaluated,aPredictions,key,ordinal), b:membershipMetric(evaluated,bPredictions,key,ordinal)},
        full_pipeline:{roots:gold.length, b_gate_relevant_roots:gold.filter(g=>bPipeline.has(g.root_id)).length,
          a:membershipMetric(gold,aPredictions,key,ordinal), b:membershipMetric(gold,bPipeline,key,ordinal)},
        common_emitted:{roots:commonEmitted.length,
          a:membershipMetric(commonEmitted,aPredictions,key,ordinal), b:membershipMetric(commonEmitted,bPredictions,key,ordinal)} };
    });
  });
}
export function buildReport(selection: Selection, gold: Gold[] | null, bundle: Bundle, partition: Partition) {
  validateSelection(selection);
  if (gold) validateGold(gold, selection);
  validateBundle(bundle, selection, partition, !!gold);
  const selectedGold = gold?.filter(g => g.partition === partition) ?? [];
  const variants = bundle.variants.map(v => {
    const predictions = new Map(v.prediction_rows.map(r => [r.root_id, r]));
    const facet = v.variant.includes('_facets_');
    const dimensions = !gold || !facet ? null : {
      voice: categorical(selectedGold.map(g => ({ truth: g.voice, predicted: dimension(predictions.get(g.root_id), 'voice') })), VOICES),
      act: categorical(selectedGold.map(g => ({ truth: g.act, predicted: dimension(predictions.get(g.root_id), 'act') })), ACTS),
      spam: categorical(selectedGold.map(g => ({ truth: String(g.spam_or_bot), predicted: dimension(predictions.get(g.root_id), 'spam_or_bot') })), ['false', 'true']),
      language: categorical(selectedGold.map(g => ({ truth: g.language, predicted: dimension(predictions.get(g.root_id), 'language') })),
        [...new Set([...selectedGold.map(g => g.language), ...selectedGold.map(g => dimension(predictions.get(g.root_id), 'language')).filter(v => /^[a-z]{2}$/u.test(v))])].sort()),
    };
    return { variant: v.variant, status: gold ? 'evaluado_sin_aprobacion' : 'no_evaluado', costs: costs(v),
      cost_basis: v.variant === 'B_judge_jev' ? 'private_journal_input_tokens_times_configured_usd_per_mtok_not_labeling_ledger' : 'labeling_ledger',
      thresholds: v.thresholds ?? null, dimensions,
      entities: gold && facet ? entityMetrics(selectedGold, predictions, selection) : null,
      comparisons: gold && facet ? entityMetrics(selectedGold.filter(g => g.entities.length >= 2), predictions, selection) : null,
      relevance: gold && facet ? categorical(selectedGold.map(g => ({ truth: goldRelevance(g), predicted: relevance(predictions.get(g.root_id)) })), ['relevant', 'unrelated', 'spam', 'unknown']) : null,
      memberships: gold && !facet ? membershipMetrics(selectedGold, predictions, selection) : null,
      reliability: gold && v.variant.startsWith('B_') ? calibration(selectedGold, predictions, selection) : null };
  });
  const candidate = (dimension: 'voice' | 'act' | 'spam' | 'entities') => {
    if (!gold || partition !== 'test') return { dimension, candidate: null, reason: 'test_only' };
    const scored = variants.filter(v => v.dimensions && v.entities).map(v => ({
      variant: v.variant, score: dimension === 'entities' ? v.entities!.micro.f1 : v.dimensions![dimension].macro_f1,
      cost: v.costs.complete ? v.costs.settled_usd_per_1000 : null,
    })).filter((v): v is typeof v & { score: number } => v.score !== null).sort((a, b) => b.score - a.score);
    if (scored.length < 2) return { dimension, candidate: null, reason: 'at_least_two_evaluated_variants_required' };
    const tied = scored.filter(v => scored[0].score - v.score < 0.03);
    if (tied.length === 1) return { dimension, candidate: scored[0].variant, reason: 'highest_f1' };
    if (tied.some(v => v.cost === null)) return { dimension, candidate: null, reason: 'complete_cost_required_for_tie' };
    tied.sort((a, b) => a.cost! - b.cost!);
    if (tied[0].cost === tied[1].cost) return { dimension, candidate: null, reason: 'equal_cost_and_similar_f1' };
    return { dimension, candidate: tied[0].variant, reason: 'less_than_three_points_cheapest' };
  };
  const comparisons = gold?.filter(g => !g.entities_abstained && g.entities.length >= 2).length ?? null;
  return { contract_version: 'mfp-eval-report-v1', status: gold && variants.length ? 'evaluado_sin_aprobacion' : 'no_evaluado', partition,
    gold_provenance: gold ? bundle.human_gold : null,
    approval: 'requires_founder_confirmation', selection: { roots: 150, dev: 90, test: 60, strata: Object.fromEntries(['random', 'enriched', 'comparison'].map(s => [s, selection.selected.filter(r => r.stratum === s).length])),
      comparison_candidates: selection.selected.filter(r => r.stratum === 'comparison').length, human_multi_entity: comparisons, comparison_target_met: comparisons === null ? null : comparisons >= 15 },
    candidates: (['voice', 'act', 'spam', 'entities'] as const).map(candidate),
    judge_comparisons: gold ? judgeComparisons(selectedGold,bundle,selection) : null,
    total_known_settled_usd: variants.reduce((n, v) => n + (v.costs.settled_usd ?? 0), 0),
    total_cost_complete: variants.length > 0 && variants.every(v => v.costs.complete),
    variants, missing_variants: VARIANTS.filter(id => !bundle.variants.some(v => v.variant === id)), agreement: agreement(bundle),
    limitations: ['No aprueba ni cambia el etiquetador.', 'Una sola ronda y una corrección focal en dev; test sólo final.',
      'Sin texto del corpus; entity_N y concept_N son ordinales de la selección privada.',
      'La congelación antes de test es declarativa; el script verifica el campo, no una barrera técnica temporal.',
      'El gold asistido por Opus de la familia Claude comparte posible vocabulario con A y puede sesgar la comparación a su favor.',
      'La regla preregistrada de candidatos cubre fichas, no jueces; ninguna superioridad del juez B se infiere sin comparar sus rutas.',
      'Sin evidencia literal JEV sólo compara detección de pertenencia.', 'Asunto requiere revisión humana de utilidad; no hay exactitud automática para texto libre.',
      ...(comparisons !== null && comparisons < 15 ? ['Faltan comparaciones humanas para el objetivo de al menos 15; no se eliminó ningún gold válido.'] : [])] };
}
export type Report = ReturnType<typeof buildReport>;
const value = (v: unknown) => v === null || v === undefined ? 'N/D' : typeof v === 'number' ? Number.isInteger(v) ? String(v) : v.toFixed(4) : String(v);
const table = (headers: string[], rows: unknown[][]) => [headers.join(' | '), headers.map(() => '---').join(' | '), ...rows.map(r => r.map(value).join(' | '))].map(s => `| ${s} |`).join('\n');
export function renderMarkdown(report: Report) {
  const lines = ['# Evaluación MFP', '', `Estado: **${report.status}**. Partición: **${report.partition}**. Aprobación: pendiente del fundador.`, '',
    report.gold_provenance?.origin === 'ai_assisted_founder_reviewed'
      ? `Gold asistido por ${report.gold_provenance.assistant_model}; fundador revisó ${report.gold_provenance.reviewed_rows} filas inciertas y corrigió ${report.gold_provenance.corrected_rows}. No es etiquetado humano independiente.`
      : report.gold_provenance?.origin === 'human' ? 'Gold declarado como anotación humana confirmada.' : 'Gold pendiente.', '',
    'Selección fija: 150 raíces, 90 dev y 60 test. No se recalcula ni cambia la partición.', '',
    table(['Estrato', 'Raíces'], Object.entries(report.selection.strata)), '',
    `Comparaciones candidatas: ${report.selection.comparison_candidates}; multi-entidad humanas: ${value(report.selection.human_multi_entity)}.`, '',
    'Precisión = TP/(TP+FP), recall = TP/(TP+FN), F1 = 2TP/(2TP+FP+FN). N/D significa denominador cero, no cero calidad. Macro omite clases sin soporte ni predicción. Exactitud incluye pendientes, rechazos, errores y abstenciones como fallos; se conservan sus tasas separadas.', '',
    'Para entidades, gold con abstención no define verdad del conjunto: se excluye de esa métrica y se cuenta aparte. Predicción no disponible conserva los FN y no acierta un conjunto vacío. Kind/prominencia se miden sólo sobre pares verdaderos positivos.', '',
    'Pertenencia excluye gold insufficient del denominador binario y lo reporta. En pipeline completo, pending/error/insufficient sobre gold positivo sí cuentan como FN operativos de recall, pero no como not_belongs ni como FN semánticos; se separan ambos tipos. Wilson 95% corresponde a recall sobre todos los positivos gold.', ''];
  for (const v of report.variants) {
    lines.push(`## Prueba ${v.variant.startsWith('A_') ? 'A — Sonnet' : 'B — JEV'} / ${v.variant}`, '', `Estado: ${v.status}.`, '',
      table(['Liquidado USD', 'Reservado USD', 'Llamadas inciertas', 'Menciones intentadas', 'USD/1000', 'Pared ms'], [[v.costs.settled_usd, v.costs.reserved_usd, v.costs.unknown_calls, v.costs.mentions_attempted, v.costs.settled_usd_per_1000, v.costs.wall_ms]]), '',
      `Coste completo: ${v.costs.complete ? 'sí' : 'no; el total conocido no equivale al total final'}. Base: ${v.cost_basis === 'labeling_ledger' ? 'ledger de etiquetado' : 'journal privado, input_tokens × precio configurado por MTok; no ledger de etiquetado'}.`, '');
    if (v.thresholds) lines.push(`Umbrales: seleccionados en dev, ronda ${v.thresholds.development_round}; frozen_before_test=${v.thresholds.frozen_before_test} es una declaración del operador, no una barrera temporal comprobada por el script.`, '', table(['Parámetro', 'Valor'], Object.entries(v.thresholds.values)), '');
    if (v.dimensions) for (const [name, m] of Object.entries(v.dimensions)) {
      lines.push(`### ${name}`, '', table(['N', 'Exactitud', 'Wilson exactitud inf.', 'Wilson exactitud sup.', 'F1 macro', 'Abstención', 'Error', 'Rechazo', 'Pendiente'], [[m.denominator, m.accuracy, m.accuracy_wilson?.low, m.accuracy_wilson?.high, m.macro_f1, m.abstention_rate, m.status_counts.error, m.status_counts.refused, m.status_counts.pending]]), '',
        'Matriz: filas gold, columnas predicción.', '', table(['Gold / predicción', ...Object.keys(Object.values(m.confusion)[0] ?? {})], Object.entries(m.confusion).map(([k, counts]) => [k, ...Object.values(counts)])), '');
    }
    for (const [name, m] of [['Entidades', v.entities], ['Comparaciones humanas ≥2 entidades', v.comparisons]] as const) if (m) {
      lines.push(`### ${name}`, '', table(['Raíces', 'Evaluables', 'Gold abstuvo', 'Predicción ausente', 'P micro', 'Wilson P inf.', 'Wilson P sup.', 'R micro', 'Wilson R inf.', 'Wilson R sup.', 'F1 micro', 'P macro', 'R macro', 'F1 macro', 'Conjunto exacto', 'Kind', 'Prominencia'], [[m.roots, m.evaluable_roots, m.gold_abstained, m.unavailable_predictions, m.micro.precision, m.micro.precision_wilson?.low, m.micro.precision_wilson?.high, m.micro.recall, m.micro.recall_wilson?.low, m.micro.recall_wilson?.high, m.micro.f1, m.macro_precision, m.macro_recall, m.macro_f1, m.exact_set_accuracy, m.kind_accuracy, m.salience_accuracy]]), '',
        table(['Entidad', 'TP', 'FP', 'FN', 'P', 'R', 'F1'], m.per_entity.map(e => [e.entity, e.tp, e.fp, e.fn, e.precision, e.recall, e.f1])), '');
    }
    if (v.relevance) lines.push('### Relevancia', '', table(['Clase', 'TP', 'FP', 'FN', 'Precisión', 'Wilson P inf.', 'Wilson P sup.', 'Recall', 'Wilson R inf.', 'Wilson R sup.'], ['relevant', 'unrelated'].map(k => { const m = v.relevance!.per_class[k]; return [k, m.tp, m.fp, m.fn, m.precision, m.precision_wilson?.low, m.precision_wilson?.high, m.recall, m.recall_wilson?.low, m.recall_wilson?.high]; })), '');
    if (v.memberships) lines.push('### Pertenencia por concepto · A incluye puerta de ficha; B directo no la usa', '', table(['Concepto', 'N', 'Gold binario', 'Gold insuficiente', 'P', 'Wilson P inf.', 'Wilson P sup.', 'R', 'Wilson R inf.', 'Wilson R sup.', 'Insufficient', 'FP', 'FN semántico', 'FN sin juicio positivo', 'Error', 'Rechazo', 'Pendiente'], v.memberships.map(m => [m.concept, m.denominator, m.binary_gold_denominator, m.gold_insufficient, m.precision, m.precision_wilson?.low, m.precision_wilson?.high, m.recall, m.recall_wilson?.low, m.recall_wilson?.high, m.insufficient_rate, m.errors.false_positive, m.errors.false_negative_semantic, m.errors.false_negative_without_positive_judgment, m.errors.error, m.errors.refused, m.errors.pending])), '');
    if (v.reliability) for (const [name, m] of Object.entries(v.reliability)) {
      lines.push(`### Fiabilidad ${name}`, '', `Probabilidades disponibles: ${m.denominator}. ECE: ${value(m.ece)}. No se afirma calibración.`, '',
        table(['Intervalo (último incluye 1)', 'N', 'Probabilidad media', 'Frecuencia real', 'Diagrama (probabilidad / frecuencia, 10 bloques)'], m.bins.map(b => [`${b.lower.toFixed(1)}–${b.upper.toFixed(1)}`, b.count, b.mean_probability, b.observed_frequency, b.count ? `${'█'.repeat(Math.round((b.mean_probability ?? 0) * 10))} / ${'█'.repeat(Math.round((b.observed_frequency ?? 0) * 10))}` : 'N/D'])), '');
    }
  }
  lines.push('## Comparación de jueces en tres vistas', '',
    'Vista 1 condiciona ambas cifras a las mismas raíces donde A emitió belongs, not_belongs o insufficient. Vista 2 mide los pipelines completos: A con su propia puerta y B con la relevancia de su ficha JEV. Vista 3 condiciona a raíces donde ambos jueces emitieron belongs o not_belongs; no mide cobertura. No hay comparador preregistrado ni ganador de jueces.', '');
  if (report.judge_comparisons?.length) {
    const ratio = (m: ReturnType<typeof membershipMetric>) =>
      `${value(m.precision)} [${value(m.precision_wilson?.low)},${value(m.precision_wilson?.high)}] / ${value(m.recall)} [${value(m.recall_wilson?.low)},${value(m.recall_wilson?.high)}]`;
    const failures = (m: ReturnType<typeof membershipMetric>) =>
      `${m.errors.false_negative_semantic}/${m.errors.false_negative_without_positive_judgment}; ${m.errors.insufficient}/${m.errors.refused}/${m.errors.error}/${m.errors.pending}`;
    for (const [heading,key] of [
      ['1 · A evaluó; B sobre esas mismas raíces','a_evaluated_vs_b_same_roots'],
      ['2 · Pipeline completo con puerta propia','full_pipeline'],
      ['3 · Ambos emitieron juicio binario','common_emitted'],
    ] as const) {
      lines.push(`### Vista ${heading}`, '', table(['A variante', 'Concepto', 'Raíces', 'Gold binario', 'Puerta B relevante', 'A P [IC] / R [IC]', 'B P [IC] / R [IC]', 'A FN sem/sin juicio; I/R/E/P', 'B FN sem/sin juicio; I/R/E/P'],
        report.judge_comparisons.map(c => {
          const view=c[key]; return [c.a_variant,c.concept,view.roots,view.a.binary_gold_denominator,
            'b_gate_relevant_roots' in view ? view.b_gate_relevant_roots : 'N/A',ratio(view.a),ratio(view.b),failures(view.a),failures(view.b)];
        })), '');
    }
  } else lines.push('No evaluado: faltan las dos fichas/jueces B y al menos un juez A.', '');
  lines.push('## Comparación preregistrada', '', table(['Dimensión', 'Candidato sin aprobación', 'Motivo'], report.candidates.map(c => [c.dimension, c.candidate, c.reason])), '',
    `Suma liquidada conocida de variantes exportadas: USD ${report.total_known_settled_usd.toFixed(6)}. Costes completos: ${report.total_cost_complete ? 'sí' : 'no'}. No incluye variantes ausentes ni infraestructura.`, '',
    'Los candidatos sólo comparan fichas presentes y no acreditan umbrales, jueces, variantes ausentes ni aceptación del programa.', '');
  lines.push('## Acuerdo sin gold', '');
  if (report.agreement) lines.push(`Unión de raíces exportadas: ${report.agreement.union_roots}. No mide exactitud. Se excluyen pares ausentes, no vigentes o abstenciones; no cuentan como acuerdos.`, '', table(['Dimensión', 'Comparables', 'Excluidas', 'Acuerdo'], report.agreement.metrics.map(m => [m.dimension, m.comparable, m.excluded, m.agreement])), '');
  else lines.push('No evaluado: faltan exportaciones emparejadas de Claude y JEV.', '');
  lines.push('## Regla preregistrada y límites', '',
    'En test gana F1 macro por dimensión (entidades: F1 micro); diferencia <0.03 usa menor coste completo por 1000. No hay ganador automático ni aprobación sin fundador. Relevancia P/R ≥0.90; entidades F1 micro ≥0.90 y recall en comparaciones ≥0.90; voice/act F1 macro ≥0.75; pertenencia precisión ≥0.80, con recall/Wilson reportados. Son umbrales propuestos del spec, no evidencia de aceptación.', '',
    `Variantes ausentes: ${report.missing_variants.join(', ') || 'ninguna'}.`, '', ...report.limitations.map(l => `- ${l}`), '');
  return lines.join('\n');
}
