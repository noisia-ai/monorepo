import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { buildR13JevRequest, isConsumerVoiceR13, isHashtagOnlyR13, massLabelingJevIdentityR13, type R13JevStage } from '@noisia/query-engine/src/signal-mass-labeling-r13';
import type { MassLabelingInputV1 } from '@noisia/query-engine/src/signal-mass-labeling-jev-v1';
import type { EntityContextV1 } from '@noisia/query-engine/src/signal-entity-context-v1';
import type { JevAnswerV1, JevResponseV1 } from '@noisia/query-engine/src/signal-mention-facets-jev-v1';
import { validateJevResponseV1, jevProviderErrorV1, type JevProviderV1, type JevRawResponseV1 } from './typesafe-jev';

export type R13Input = MassLabelingInputV1 & { probabilities: Record<string, JevAnswerV1>; root_hashtag_only?: boolean };
export type R13Result = {
  contract_version: 'mass-labeling-r13-result-v1'; stage: R13JevStage;
  root_id: string; input_digest: string; map_id: string; map_digest: string; request_digest: string;
  question_count: number; status: 'settled'; consumer_eligible: boolean; root_hashtag_only: boolean;
  response: JevResponseV1; raw_sha256: string; input_tokens: number; micro_usd: number;
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const digest = (value: unknown) => `sha256:${hash(JSON.stringify(value))}`;
async function load<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
async function durable(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, file);
  const directory = await open(dirname(file), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

export type R13StageInputs = {
  stage: R13JevStage; items: R13Input[]; directory: string;
  category: { pt: string; en: string }; context?: EntityContextV1;
};
function validateItems(args: R13StageInputs): void {
  if (args.items.length === 0
    || args.items.some(item => [item.root_id, item.input_digest, item.map_id, item.map_digest, item.text].some(value => typeof value !== 'string' || !value.trim()))
    || new Set(args.items.map(item => item.root_id)).size !== args.items.length) throw new Error('r13_stage_invalid');
}
function requestFor(args: R13StageInputs, item: R13Input) {
  return buildR13JevRequest({ ...args, item, category: args.stage === 'language-en' ? args.category.en : args.category.pt });
}
function stageBinding(args: R13StageInputs): string {
  return digest({ stage: args.stage, roots: args.items.map(item => [
    item.root_id, item.input_digest, item.map_id, item.map_digest, item.root_hashtag_only ?? null, digest(requestFor(args, item)),
  ]) });
}
/** Exclusive creation is the sole acquisition operation. A stale lock is kept for
 * the operator to inspect together with its submitting calls and raw receipts. */
async function acquireStageLock(directory: string): Promise<() => Promise<void>> {
  const lockFile = join(directory, 'active.lock');
  let lock;
  try { lock = await open(lockFile, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('r13_lock_exists_requires_operator_reconciliation');
    throw error;
  }
  try { await lock.writeFile(JSON.stringify({ pid: process.pid })); await lock.sync(); }
  finally { await lock.close(); }
  return () => unlink(lockFile);
}
function verifySettled(args: R13StageInputs, item: R13Input, result: R13Result, raw: JevRawResponseV1 | null): void {
  const request = requestFor(args, item);
  if (!raw || result.contract_version !== 'mass-labeling-r13-result-v1' || result.status !== 'settled'
    || result.root_id !== item.root_id || result.input_digest !== item.input_digest || result.map_id !== item.map_id
    || result.map_digest !== item.map_digest || result.stage !== args.stage || result.request_digest !== digest(request)
    || result.question_count !== Object.keys(request.questions).length || result.raw_sha256 !== `sha256:${hash(raw.body)}`
    || JSON.stringify(result.response) !== JSON.stringify(validateJevResponseV1(request, raw))
    || result.input_tokens !== result.response.usage.input_tokens || result.micro_usd !== Math.ceil(result.input_tokens * 0.042)
    || result.root_hashtag_only !== (item.root_hashtag_only ?? isHashtagOnlyR13(item.text))
    || result.consumer_eligible !== isConsumerVoiceR13({ ...item, probabilities: args.stage === 'label' ? result.response.answers : item.probabilities })) {
    throw new Error('r13_settled_receipt_mismatch');
  }
}

/** A root in submitting/unknown state is never sent again. A durable raw response
 * can be decoded after a crash, without contacting the provider. */
export async function runR13JevStage(args: R13StageInputs & {
  provider: JevProviderV1; concurrency?: number;
  onSettled?: (result: R13Result) => void;
}): Promise<{ settled: number; input_tokens: number; micro_usd: number }> {
  const concurrency = args.concurrency ?? 16;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 48) throw new Error('r13_stage_invalid');
  validateItems(args);
  await mkdir(args.directory, { recursive: true, mode: 0o700 });
  const releaseLock = await acquireStageLock(args.directory);
  let index = 0;
  let failure: unknown;
  const total = { settled: 0, input_tokens: 0, micro_usd: 0 };
  try {
    const binding = stageBinding(args);
    const manifestFile = join(args.directory, 'manifest.json');
    const manifest = await load<{ binding: string }>(manifestFile);
    if (manifest && manifest.binding !== binding) throw new Error('r13_stage_binding_changed');
    if (!manifest) await durable(manifestFile, { contract_version: 'mass-labeling-r13-stage-v1', stage: args.stage, binding, root_count: args.items.length, ...(args.stage === 'label' ? { labeler_identity: massLabelingJevIdentityR13(args.category.pt) } : {}) });
    async function execute(item: R13Input): Promise<void> {
      const request = requestFor(args, item);
      const request_digest = digest(request);
      const stem = join(args.directory, hash(item.root_id));
      const stateFile = `${stem}.json`;
      const rawFile = `${stem}.raw.json`;
      const prior = await load<R13Result | { request_digest: string; status: string }>(stateFile);
      if (prior && prior.request_digest !== request_digest) throw new Error('r13_request_changed');
      let raw = await load<JevRawResponseV1>(rawFile);
      if (prior?.status === 'settled') {
        const result = prior as R13Result;
        verifySettled(args, item, result, raw);
        total.settled++; total.input_tokens += result.input_tokens; total.micro_usd += result.micro_usd;
        args.onSettled?.(result); return;
      }
      if (prior && !raw && prior.status !== 'definitely_not_sent') throw new Error('r13_unresolved_call_requires_reconciliation');
      if (!raw) {
        await durable(stateFile, { stage: args.stage, root_id: item.root_id, input_digest: item.input_digest, map_id: item.map_id, map_digest: item.map_digest, request_digest, request, status: 'submitting' });
        try { raw = await args.provider.evaluate(request); }
        catch (error) {
          const known = jevProviderErrorV1(error);
          await durable(stateFile, { stage: args.stage, root_id: item.root_id, request_digest, status: known.outcome, error_code: known.code });
          throw new Error(`r13_provider_${known.outcome}`);
        }
        await durable(rawFile, raw);
      }
      const response = validateJevResponseV1(request, raw);
      const result: R13Result = {
        contract_version: 'mass-labeling-r13-result-v1', stage: args.stage, root_id: item.root_id,
        input_digest: item.input_digest, map_id: item.map_id, map_digest: item.map_digest, request_digest,
        question_count: Object.keys(request.questions).length, status: 'settled', root_hashtag_only: item.root_hashtag_only ?? isHashtagOnlyR13(item.text),
        consumer_eligible: isConsumerVoiceR13({ ...item, probabilities: args.stage === 'label' ? response.answers : item.probabilities }), response, raw_sha256: `sha256:${hash(raw.body)}`,
        input_tokens: response.usage.input_tokens, micro_usd: Math.ceil(response.usage.input_tokens * 0.042),
      };
      await durable(stateFile, result);
      total.settled++; total.input_tokens += result.input_tokens; total.micro_usd += result.micro_usd;
      args.onSettled?.(result);
    }
    async function worker() {
      while (!failure && index < args.items.length) {
        const item = args.items[index++]!;
        try { await execute(item); } catch (error) { failure ??= error; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, args.items.length) }, worker));
    await durable(join(args.directory, 'summary.json'), { ...total, root_count: args.items.length, completed: !failure && total.settled === args.items.length });
    if (failure) throw failure;
    return total;
  } finally { await releaseLock(); }
}

/** Export uses the same exclusive lock and request binding as execution. It reads
 * each expected root by its own filename and checks its raw provider receipt. */
export async function exportR13JevStage(args: R13StageInputs): Promise<number> {
  validateItems(args);
  const releaseLock = await acquireStageLock(args.directory);
  const temporary = join(args.directory, `results.${randomUUID()}.tmp`);
  try {
    const manifest = await load<{ contract_version: string; stage: R13JevStage; binding: string; root_count: number }>(join(args.directory, 'manifest.json'));
    if (!manifest || manifest.contract_version !== 'mass-labeling-r13-stage-v1' || manifest.stage !== args.stage
      || manifest.binding !== stageBinding(args) || manifest.root_count !== args.items.length) throw new Error('r13_export_binding_mismatch');
    const expected = new Set(args.items.map(item => `${hash(item.root_id)}.json`));
    const actual = (await readdir(args.directory)).filter(name => /^[a-f0-9]{64}\.json$/u.test(name));
    if (actual.length !== expected.size || actual.some(name => !expected.has(name))) throw new Error('r13_export_roots_mismatch');
    const output = await open(temporary, 'wx', 0o600);
    const totals = { settled: 0, input_tokens: 0, micro_usd: 0 };
    try {
      for (const item of args.items) {
        const stem = join(args.directory, hash(item.root_id));
        const result = await load<R13Result>(`${stem}.json`);
        if (!result) throw new Error('r13_export_incomplete');
        verifySettled(args, item, result, await load<JevRawResponseV1>(`${stem}.raw.json`));
        await output.write(JSON.stringify(result) + '\n');
        totals.settled++; totals.input_tokens += result.input_tokens; totals.micro_usd += result.micro_usd;
      }
      const summary = await load<{ completed: boolean; root_count: number; settled: number; input_tokens: number; micro_usd: number }>(join(args.directory, 'summary.json'));
      if (!summary?.completed || summary.root_count !== args.items.length || summary.settled !== totals.settled
        || summary.input_tokens !== totals.input_tokens || summary.micro_usd !== totals.micro_usd) throw new Error('r13_export_summary_mismatch');
      await output.sync();
    } finally { await output.close(); }
    await rename(temporary, join(args.directory, 'results.jsonl'));
    return totals.settled;
  } finally {
    await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
    await releaseLock();
  }
}
