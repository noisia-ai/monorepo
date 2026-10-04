import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildReport, renderMarkdown } from './report';
import type { Bundle, Gold, Partition, Selection } from './contract';
export async function main(args: string[]) {
  const options = new Map<string, string>();
  const allowed = new Set(['--selection', '--selection-sha256', '--gold', '--bundle', '--partition', '--output']);
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1] || options.has(args[i])) throw new Error('eval_arguments');
    options.set(args[i], args[i + 1]);
  }
  const selectionPath = options.get('--selection'), expectedHash = options.get('--selection-sha256'), output = options.get('--output');
  const partition = options.get('--partition') ?? 'dev';
  if (!selectionPath || !expectedHash || !/^[a-f0-9]{64}$/u.test(expectedHash) || !output || !['dev', 'test'].includes(partition)) throw new Error('eval_arguments');
  const raw = await readFile(selectionPath);
  if (createHash('sha256').update(raw).digest('hex') !== expectedHash) throw new Error('eval_selection_fingerprint_mismatch');
  const selection = JSON.parse(raw.toString()) as Selection;
  const gold = options.has('--gold') ? (await readFile(options.get('--gold')!, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) as Gold[] : null;
  const bundle = options.has('--bundle') ? JSON.parse(await readFile(options.get('--bundle')!, 'utf8')) as Bundle : { contract_version: 'mfp-eval-v1', human_gold: null, variants: [] } as Bundle;
  const report = buildReport(selection, gold, bundle, partition as Partition);
  // Exclusive creation avoids replacing a previous dev/test receipt accidentally.
  await writeFile(output, renderMarkdown(report) + `\nHuella SHA-256 de la selección fijada: ${expectedHash}.\n`, { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, partition, variants: report.variants.length, approval: report.approval }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => {
    // Never echo paths, JSON fragments, schema values, or provider messages.
    const code = error instanceof Error && /^eval_[a-z_]+$/u.test(error.message) ? error.message : 'eval_input_or_output_failed';
    console.error(JSON.stringify({ status: 'failed', code })); process.exitCode = 1;
  });
}
