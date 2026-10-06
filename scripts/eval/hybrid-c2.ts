/** C2 is a read-only counterfactual over frozen predictions. It never fabricates Claude citations. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { validateBundle, validateGold, validateSelection, type Bundle, type Gold, type Prediction, type Selection } from './contract';
import { binary, wilson } from './metrics';

type Verdict = 'belongs' | 'not_belongs' | 'insufficient' | 'refused' | 'error' | 'pending';
const emitted = (v: Verdict) => v === 'belongs' || v === 'not_belongs';
const verdict = (p: Prediction | undefined, key: string): Verdict =>
  !p ? 'pending' : p.status === 'error' || p.status === 'refused' || p.status === 'pending'
    ? p.status : p.memberships?.[key] ?? 'pending';
const relevant = (p: Prediction | undefined) => !!p?.facets &&
  p.status === 'labeled' && !p.facets.spam_or_bot.abstained && !p.facets.spam_or_bot.value &&
  !p.facets.entities.abstained && p.facets.entities.value.length > 0;
const indexed = (bundle: Bundle, variant: string) => {
  const v = bundle.variants.find(x => x.variant === variant);
  if (!v) throw new Error(`eval_c2_missing_${variant}`);
  return { variant: v, rows: new Map(v.prediction_rows.map(p => [p.root_id, p])) };
};
function metric(gold: Gold[], key: string, prediction: (g: Gold) => Verdict) {
  const rows = gold.map(g => ({ truth: g.memberships[key], predicted: prediction(g) }));
  const resolved = rows.filter(r => r.truth !== 'insufficient');
  const tp = resolved.filter(r => r.truth === 'belongs' && r.predicted === 'belongs').length;
  const fp = resolved.filter(r => r.truth === 'not_belongs' && r.predicted === 'belongs').length;
  const fn = resolved.filter(r => r.truth === 'belongs' && r.predicted !== 'belongs').length;
  return { roots: gold.length, binary_gold: resolved.length, gold_positive: resolved.filter(r => r.truth === 'belongs').length,
    ...binary(tp, fp, fn), precision_wilson: wilson(tp, tp + fp), recall_wilson: wilson(tp, tp + fn),
    fn_explicit: resolved.filter(r => r.truth === 'belongs' && r.predicted === 'not_belongs').length,
    fn_without_judgment: resolved.filter(r => r.truth === 'belongs' && !emitted(r.predicted)).length,
    states: Object.fromEntries((['belongs','not_belongs','insufficient','refused','error','pending'] as const)
      .map(s => [s, rows.filter(r => r.predicted === s).length])) };
}
export function buildHybridC2(selection: Selection, gold: Gold[], bundle: Bundle) {
  validateSelection(selection); validateGold(gold, selection); validateBundle(bundle, selection, 'test', true);
  const gate = indexed(bundle, 'B_facets_jev'), jev = indexed(bundle, 'B_judge_jev');
  const candidates = ['A_judge_low', 'A_judge_medium'].map(name => indexed(bundle, name));
  const rows = candidates.flatMap(claude => selection.concepts.flatMap((concept, ordinal) => {
    const key = concept.concept_key;
    return (['dev','test'] as const).map(partition => {
      const all = gold.filter(g => g.partition === partition);
      const passed = (g: Gold) => relevant(gate.rows.get(g.root_id));
      const j = (g: Gold) => passed(g) ? verdict(jev.rows.get(g.root_id), key) : 'pending';
      const c = (g: Gold) => verdict(claude.rows.get(g.root_id), key);
      const confirm = (g: Gold): Verdict => j(g) === 'belongs' ? c(g) : j(g);
      const judge = (g: Gold): Verdict => passed(g) ? c(g) : 'pending';
      const common = all.filter(g => passed(g) && emitted(j(g)) && emitted(c(g)));
      const evaluated = all.filter(g => passed(g) && ['belongs','not_belongs','insufficient'].includes(c(g)));
      const view = (subset: Gold[]) => ({ roots: subset.length, jev: metric(subset,key,j),
        jev_then_claude_positive: metric(subset,key,confirm), jev_gate_claude_judge: metric(subset,key,judge) });
      const positives = all.filter(g => j(g) === 'belongs');
      const gateRows = all.filter(passed);
      return { partition, claude: claude.variant.variant, concept: `concept_${ordinal + 1}`,
        gate_passed: gateRows.length, jev_positive: positives.length,
        missing_claude_saved: { among_gate: gateRows.filter(g => !claude.rows.has(g.root_id)).length,
          among_jev_positive: positives.filter(g => !claude.rows.has(g.root_id)).length,
          nonbinary_among_gate: gateRows.filter(g => !emitted(c(g))).length,
          nonbinary_among_jev_positive: positives.filter(g => !emitted(c(g))).length },
        views: { claude_evaluated_same_roots: view(evaluated), full_pipeline: view(all),
          common_binary: view(common) } };
    });
  }));
  const goldGate = gold.filter(g => relevant(gate.rows.get(g.root_id)));
  const goldPositiveUnion = goldGate.filter(g => selection.concepts.some(x => verdict(jev.rows.get(g.root_id), x.concept_key) === 'belongs'));
  const rootCount = gate.variant.prediction_rows.length;
  const gateRate = goldGate.length / gold.length;
  const positiveRate = goldGate.length ? goldPositiveUnion.length / goldGate.length : 0;
  const jevJudgeRate = (jev.variant.costs.settled_usd ?? 0) / jev.variant.costs.mentions_attempted;
  const projectedGate = gate.variant.prediction_rows.filter(relevant).length;
  const projectedConfirm = projectedGate * positiveRate;
  const positiveRatesByPartition = (['dev','test'] as const).map(partition => {
    const eligible = goldGate.filter(g => g.partition === partition);
    return { partition, eligible:eligible.length, positive_union:eligible.filter(g =>
      selection.concepts.some(x => verdict(jev.rows.get(g.root_id),x.concept_key) === 'belongs')).length };
  });
  const base = gate.variant.costs.settled_usd ?? 0;
  const costs = candidates.map(claude => {
    const claudeRate = (claude.variant.costs.settled_usd ?? 0) / claude.variant.costs.mentions_attempted;
    const route1 = base + projectedGate * jevJudgeRate + projectedConfirm * claudeRate;
    const route2 = base + projectedGate * claudeRate;
    return { claude:claude.variant.variant, observed_component_usd: { jev_facets_1086:base,
      jev_judge_150:jev.variant.costs.settled_usd, claude_judge_481:claude.variant.costs.settled_usd },
      observed_denominators:{facets:rootCount,jev_judge:jev.variant.costs.mentions_attempted,claude_judge:claude.variant.costs.mentions_attempted},
      gold_rates:{jev_gate:gateRate,jev_positive_within_gate:positiveRate,positive_union_by_partition:positiveRatesByPartition},
      projected_roots:{jev_gate:projectedGate,claude_confirmation:projectedConfirm},
      projected_usd_per_1000:{jev_then_claude_positive:1000*route1/rootCount,jev_gate_claude_judge:1000*route2/rootCount},
      projected_usd:{jev_then_claude_positive:route1,jev_gate_claude_judge:route2} };
  });
  return { status:'counterfactual_no_labeler_approval', gold_roots:gold.length,
    note:'Claude membership verdict is a proxy for confirmation. Saved predictions do not prove that a citation exists for the JEV-positive hybrid request. No provider call or hybrid cost was observed.',
    rows, costs };
}
export async function main(args: string[]) {
  if (args.length !== 8 || args[0] !== '--selection' || args[2] !== '--gold' || args[4] !== '--bundle' || args[6] !== '--output') throw new Error('eval_c2_arguments');
  const selection = JSON.parse(await readFile(args[1], 'utf8')) as Selection;
  const gold = (await readFile(args[3], 'utf8')).trim().split('\n').map(line => JSON.parse(line)) as Gold[];
  const bundle = JSON.parse(await readFile(args[5], 'utf8')) as Bundle;
  const report = buildHybridC2(selection,gold,bundle);
  const hashes = await Promise.all([args[1],args[3],args[5]].map(async path => createHash('sha256').update(await readFile(path)).digest('hex')));
  await writeFile(args[7],JSON.stringify({input_sha256:{selection:hashes[0],gold:hashes[1],bundle:hashes[2]},...report},null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({status:report.status,rows:report.rows.length,cost_routes:report.costs.length}));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2)).catch(() => { console.error('eval_c2_failed'); process.exitCode=1; });
