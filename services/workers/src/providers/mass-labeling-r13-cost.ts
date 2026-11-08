import { createHash } from 'node:crypto';
import type { EntityContextV1 } from '@noisia/query-engine/src/signal-entity-context-v1';
import type { JevAnswerV1 } from '@noisia/query-engine/src/signal-mention-facets-jev-v1';
import { buildR13JevRequest } from '@noisia/query-engine/src/signal-mass-labeling-r13';
import type { R13Input, R13Result } from './mass-labeling-r13-runner';
const disposition = (p: number) => p > 0.7 ? 'positive' : p < 0.3 ? 'negative' : 'intermediate';
function probabilities(answer: JevAnswerV1): Record<string, number> {
  return answer.type === 'noul' ? { true: answer.noul } : answer.probabilities;
}
function compare(left: Record<string, JevAnswerV1>, right: Record<string, JevAnswerV1>) {
  let count = 0; let absolute_delta = 0; let threshold_crossings = 0; let choice_changes = 0; let choices = 0;
  for (const [key, answer] of Object.entries(left)) {
    const other = right[key];
    if (!other || other.type !== answer.type) throw new Error('r13_cost_question_mismatch');
    const values = probabilities(answer); const baseline = probabilities(other);
    if (Object.keys(values).sort().join() !== Object.keys(baseline).sort().join()) throw new Error('r13_cost_choice_mismatch');
    for (const [option, value] of Object.entries(values)) {
      count++; absolute_delta += Math.abs(value - baseline[option]!);
      threshold_crossings += Number(disposition(value) !== disposition(baseline[option]!));
    }
    if (answer.type === 'choice' && other.type === 'choice') { choices++; choice_changes += Number(answer.choice !== other.choice); }
  }
  return { count, absolute_delta, threshold_crossings, choices, choice_changes };
}
export function compareR13JevCosts(args: { items: Array<R13Input & { baseline_input_tokens?: number }>; full: R13Result[]; reduced: R13Result[]; context: EntityContextV1; category: string }) {
  if (args.items.length !== 1000 || args.full.length !== 1000 || args.reduced.length !== 1000) throw new Error('r13_cost_requires_1000_pairs');
  const full = new Map(args.full.map(row => [row.root_id, row]));
  const reduced = new Map(args.reduced.map(row => [row.root_id, row]));
  if (full.size !== 1000 || reduced.size !== 1000 || new Set(args.items.map(i => i.root_id)).size !== 1000) throw new Error('r13_cost_duplicate_root');
  const totals = { full_input_tokens: 0, reduced_input_tokens: 0, full_micro_usd: 0, reduced_micro_usd: 0, baseline_input_tokens: 0 };
  let baselineComplete = true;
  const deltas = Object.fromEntries(['reduced_vs_full', 'full_vs_historical', 'reduced_vs_historical'].map(key => [key, { count: 0, absolute_delta: 0, threshold_crossings: 0, choices: 0, choice_changes: 0 }]));
  for (const item of args.items) {
    const a = full.get(item.root_id); const b = reduced.get(item.root_id);
    if (!a || !b) throw new Error('r13_cost_pair_missing');
    for (const [stage, result] of [['cost13', a], ['cost7', b]] as const) {
      const request = buildR13JevRequest({ stage, item, context: args.context, category: args.category });
      const digest = `sha256:${createHash('sha256').update(JSON.stringify(request)).digest('hex')}`;
      if (result.stage !== stage || result.status !== 'settled' || result.request_digest !== digest || result.input_digest !== item.input_digest
        || result.map_id !== item.map_id || result.map_digest !== item.map_digest || result.question_count !== (stage === 'cost13' ? 13 : 7)) throw new Error('r13_cost_input_mismatch');
    }
    totals.full_input_tokens += a.input_tokens; totals.reduced_input_tokens += b.input_tokens;
    totals.full_micro_usd += a.micro_usd; totals.reduced_micro_usd += b.micro_usd;
    if (Number.isSafeInteger(item.baseline_input_tokens) && item.baseline_input_tokens! >= 0) totals.baseline_input_tokens += item.baseline_input_tokens!; else baselineComplete = false;
    const rows = { reduced_vs_full: compare(b.response.answers, a.response.answers), full_vs_historical: compare(a.response.answers, item.probabilities), reduced_vs_historical: compare(b.response.answers, item.probabilities) };
    for (const [key, row] of Object.entries(rows)) for (const metric of Object.keys(row) as Array<keyof typeof row>) deltas[key]![metric] += row[metric];
  }
  return {
    contract_version: 'mass-labeling-r13-cost-comparison-v1', paired_roots: 1000,
    questions: { full: 13, reduced: 7, removed: 6 }, same_text_and_shared_questions_verified: true,
    ...totals, baseline_input_tokens: baselineComplete ? totals.baseline_input_tokens : null,
    tokens_per_root: { full: totals.full_input_tokens / 1000, reduced: totals.reduced_input_tokens / 1000, historical: baselineComplete ? totals.baseline_input_tokens / 1000 : null },
    measured_tokens_saved_per_removed_question: (totals.full_input_tokens - totals.reduced_input_tokens) / 6000,
    token_reduction_fraction: 1 - totals.reduced_input_tokens / totals.full_input_tokens,
    probability_comparisons: Object.fromEntries(Object.entries(deltas).map(([key, row]) => [key, { ...row, mean_absolute_delta: row.absolute_delta / row.count, threshold_crossing_fraction: row.threshold_crossings / row.count, choice_change_fraction: row.choice_changes / row.choices }])),
    interpretation: 'Paired difference measures this six-question reduction with the same texts and shared definitions. It does not separately estimate a constant intercept or every question type.',
  };
}
