/** Private operator entry point. Config and corpus files belong under .data.
 * Run with node --import tsx scripts/dev-corpus/pilot-r13-jev.ts check|run CONFIG.
 * Provider keys are read only from the process environment. */
import { readFile, realpath, mkdir, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve, relative, join, dirname } from 'node:path';
import type { EntityContextV1 } from '../../packages/query-engine/src/signal-entity-context-v1';
import { buildR13JevRequest, R13_JEV_STAGES, type R13JevStage } from '../../packages/query-engine/src/signal-mass-labeling-r13';
import { compareR13JevCosts } from '../../services/workers/src/providers/mass-labeling-r13-cost';
import { createTypesafeJevClientV1 } from '../../services/workers/src/providers/typesafe-jev';
import { runR13JevStage, exportR13JevStage, type R13Input, type R13Result } from '../../services/workers/src/providers/mass-labeling-r13-runner';

type Config = {
  stage: R13JevStage; items_file: string; directory: string;
  category: { pt: string; en: string }; context_file?: string;
  concurrency?: number; arms?: { cost13: string; cost7: string };
};
async function privatePath(file: string, exists = true): Promise<string> {
  const data = await realpath(resolve('.data'));
  const path = exists ? await realpath(resolve(file)) : join(await realpath(dirname(resolve(file))), resolve(file).split('/').at(-1)!);
  if (relative(data, path).startsWith('..') || path === data) throw new Error('r13_path_outside_private_data');
  return path;
}
async function json<T>(file: string): Promise<T> { return JSON.parse(await readFile(await privatePath(file), 'utf8')) as T; }
async function main() {
  process.umask(0o077);
  const [action, configFile] = process.argv.slice(2);
  if (!configFile || !['check', 'run', 'export', 'compare'].includes(action ?? '')) throw new Error('r13_usage');
  const config = await json<Config>(configFile);
  if (!R13_JEV_STAGES.includes(config.stage)) throw new Error('r13_stage_invalid');
  const checkedDirectory = await privatePath(config.directory, false);
  await mkdir(checkedDirectory, { recursive: true, mode: 0o700 });
  const directory = await privatePath(config.directory);
  const items: Array<R13Input & { baseline_input_tokens?: number }> = [];
  const lines = createInterface({ input: createReadStream(await privatePath(config.items_file)), crlfDelay: Infinity });
  for await (const line of lines) if (line.trim()) items.push(JSON.parse(line));
  const context = config.context_file ? await json<EntityContextV1>(config.context_file) : undefined;
  if (action === 'export') {
    const count = await exportR13JevStage({ ...config, directory, items, context });
    console.log(JSON.stringify({ stage: config.stage, exported: count })); return;
  }
  if (action === 'compare') {
    if (!context || !config.arms) throw new Error('r13_cost_arms_required');
    async function results(file: string): Promise<R13Result[]> {
      const rows: R13Result[] = [];
      const source = createInterface({ input: createReadStream(await privatePath(file)), crlfDelay: Infinity });
      for await (const line of source) if (line.trim()) rows.push(JSON.parse(line));
      return rows;
    }
    const comparison = compareR13JevCosts({ items, context, category: config.category.pt, full: await results(config.arms.cost13), reduced: await results(config.arms.cost7) });
    const output = await open(join(directory, 'cost-comparison.json'), 'w', 0o600);
    try { await output.writeFile(JSON.stringify(comparison, null, 2)); await output.sync(); } finally { await output.close(); }
    console.log(JSON.stringify({ paired_roots: comparison.paired_roots, tokens_per_root: comparison.tokens_per_root })); return;
  }
  for (const item of items) buildR13JevRequest({ ...config, item, context, category: config.stage === 'language-en' ? config.category.en : config.category.pt });
  if (action === 'check') {
    console.log(JSON.stringify({ stage: config.stage, roots: items.length, questions: items.length ? Object.keys(buildR13JevRequest({ ...config, item: items[0]!, context, category: config.stage === 'language-en' ? config.category.en : config.category.pt }).questions).length : 0 })); return;
  }
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'dev-test' || process.env.RAILWAY_SERVICE_NAME !== 'mfp-private-runner') throw new Error('r13_wrong_target');
  const provider = createTypesafeJevClientV1({ concurrency: config.concurrency ?? 16 });
  let settled = 0;
  const result = await runR13JevStage({ ...config, directory, items, context, provider,
    onSettled: () => { if (++settled % 1000 === 0) console.log(JSON.stringify({ stage: config.stage, settled })); },
  });
  console.log(JSON.stringify({ stage: config.stage, ...result }));
}
main().catch(error => {
  const code = error instanceof Error && /^r13_[a-z_]+$/u.test(error.message) ? error.message : 'r13_operation_failed_inspect_private_journal';
  console.error(code); process.exitCode = 1;
});
