/** Offline statistics. No provider, database, corpus text, or approval side effects. */
export const divide = (n: number, d: number): number | null => d ? n / d : null;
export const mean = (values: (number | null)[]) => {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
};
export function binary(tp: number, fp: number, fn: number) {
  return { tp, fp, fn, precision: divide(tp, tp + fp), recall: divide(tp, tp + fn), f1: divide(2 * tp, 2 * tp + fp + fn) };
}
export function wilson(successes: number, total: number) {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || successes < 0 || total < successes) throw new Error('eval_wilson_counts');
  if (!total) return null;
  const z = 1.959963984540054, p = successes / total, denominator = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denominator;
  const half = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half), confidence: 0.95 };
}
export function categorical(rows: { truth: string; predicted: string }[], labels: readonly string[]) {
  const specials = ['abstained', 'refused', 'error', 'pending'];
  const columns = [...labels, ...specials];
  const confusion = Object.fromEntries(labels.map(label => [label, Object.fromEntries(columns.map(c => [c, 0]))]));
  for (const row of rows) {
    if (!confusion[row.truth] || !(row.predicted in confusion[row.truth])) throw new Error('eval_category_invalid');
    confusion[row.truth][row.predicted]++;
  }
  const per_class = Object.fromEntries(labels.map(label => {
    const tp=rows.filter(r => r.truth === label && r.predicted === label).length;
    const fp=rows.filter(r => r.truth !== label && r.predicted === label).length;
    const fn=rows.filter(r => r.truth === label && r.predicted !== label).length;
    return [label,{...binary(tp,fp,fn),precision_wilson:wilson(tp,tp+fp),recall_wilson:wilson(tp,tp+fn)}];
  }));
  const correct=rows.filter(r => r.truth === r.predicted).length;
  return { denominator: rows.length, accuracy: divide(correct, rows.length),accuracy_wilson:wilson(correct,rows.length),
    macro_f1: mean(Object.values(per_class).map(v => v.f1)),
    abstention_rate: divide(rows.filter(r => r.predicted === 'abstained').length, rows.length),
    status_counts: Object.fromEntries(specials.map(s => [s, rows.filter(r => r.predicted === s).length])), per_class, confusion };
}
export function reliability(rows: { probability: number; outcome: boolean }[], binCount = 10) {
  if (!Number.isInteger(binCount) || binCount < 1) throw new Error('eval_bin_count');
  const bins = Array.from({ length: binCount }, (_, i) => ({ lower: i / binCount, upper: (i + 1) / binCount, count: 0, sum_probability: 0, positives: 0 }));
  for (const row of rows) {
    if (!Number.isFinite(row.probability) || row.probability < 0 || row.probability > 1 || typeof row.outcome !== 'boolean') throw new Error('eval_probability_invalid');
    const bin = bins[Math.min(binCount - 1, Math.floor(row.probability * binCount))];
    bin.count++; bin.sum_probability += row.probability; bin.positives += Number(row.outcome);
  }
  const result = bins.map(b => ({ lower: b.lower, upper: b.upper, count: b.count, mean_probability: divide(b.sum_probability, b.count), observed_frequency: divide(b.positives, b.count) }));
  return { denominator: rows.length, ece: rows.length ? result.reduce((n, b) => n + b.count / rows.length * Math.abs((b.mean_probability ?? 0) - (b.observed_frequency ?? 0)), 0) : null, bins: result, calibration_claim: 'not_established' };
}
