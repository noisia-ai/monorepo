/** Run only through the MFP private runner; never part of pnpm test. All state is synthetic. */
import { mkdir, writeFile } from 'node:fs/promises';
import { openDatabase, main } from '../dev-corpus/guard.mjs';
import { createTypesafeJevClientV1, validateJevResponseV1, jevProviderErrorV1, type JevRequestV1 } from '../../services/workers/src/providers/typesafe-jev';
void main(async () => {
  const pool = await openDatabase(); await pool.end();
  const price = Number(process.env.NOISIA_JEV_INPUT_USD_PER_MTOK);
  if (!Number.isFinite(price) || price < 0 || process.env.NOISIA_JEV_INPUT_USD_PER_MTOK === undefined) throw new Error('mfp_jev_price_required');
  const client = createTypesafeJevClientV1({ concurrency: 2 });
  const questions: JevRequestV1['questions'] = {
    refers: { type: 'noul', instructions: 'Does the text compare two fictional devices?', criteria: { true: 'Explicit comparison of devices', false: 'No comparison' } },
    language: { type: 'choice', instructions: 'Which language is used?', criteria: { es: 'Spanish', en: 'English', other: 'Another language' } }
  };
  const cases: Array<{ name: string; request: JevRequestV1 }> = [];
  for (const model of ['jev-1.13.0', 'jev-latest']) cases.push({ name: model, request: { model, state: 'El dispositivo Uno tiene mejor batería que el dispositivo Dos, aunque ambos me gustan.', questions } });
  for (const chars of [12_000, 64_000]) cases.push({ name: `state_${chars}`, request: { model: 'jev-1.13.0', state: `${'Información sintética sin datos personales. '.repeat(Math.ceil(chars / 43)).slice(0, chars)} El dispositivo Uno tiene mejor batería que el dispositivo Dos.`, questions } });
  for (let i = 0; i < 2; i++) {
    const many: JevRequestV1['questions'] = { ...questions };
    for (let e = 0; e < 10; e++) {
      many[`entity_${e}`] = { type: 'noul', instructions: `Does the mention refer to fictional device number ${e}?` };
      many[`main_${e}`] = { type: 'noul', instructions: `Is fictional device number ${e} a main subject of the mention?` };
    }
    cases.push({ name: `concurrent_ten_entities_${i}`, request: { model: 'jev-1.13.0', state: 'Prefiero el dispositivo número 1 al dispositivo número 2 por su batería.', questions: many } });
  }
  const directory = '.data/dev-corpus/jev-synthetic'; await mkdir(directory, { recursive: true, mode: 0o700 });
  const runId = new Date().toISOString().replaceAll(':', '-');
  const results: Array<Record<string, unknown>> = [];
  async function run(item: typeof cases[number]) {
    const path = `${directory}/${runId}-${item.name}`;
    await writeFile(`${path}-request.json`, JSON.stringify(item.request), { mode: 0o600 });
    await writeFile(`${path}-attempt.json`, JSON.stringify({ status: 'submitting', estimated_input_tokens: Math.ceil(JSON.stringify(item.request).length / 3.5), price_usd_per_mtok: price }), { mode: 0o600 });
    try {
      const raw = await client.evaluate(item.request);
      await writeFile(`${path}-raw.json`, JSON.stringify(raw), { mode: 0o600 });
      const parsed = validateJevResponseV1(item.request, raw);
      const result = { name: item.name, status: 'settled', http_status: raw.http_status, model: parsed.model, usage: parsed.usage,
        cost_usd: parsed.usage.input_tokens * price / 1_000_000, latency_ms: raw.latency_ms, answers: parsed.answers };
      await writeFile(`${path}-attempt.json`, JSON.stringify(result), { mode: 0o600 }); results.push(result);
    } catch (error) {
      const failure = jevProviderErrorV1(error); const result = { name: item.name, status: failure.outcome, code: failure.code, evidence: failure.evidence };
      await writeFile(`${path}-attempt.json`, JSON.stringify(result), { mode: 0o600 }); results.push(result);
    }
  }
  for (const item of cases.slice(0, 4)) await run(item);
  await Promise.all(cases.slice(4).map(run));
  const latency = results.flatMap(row => typeof row.latency_ms === 'number' ? [row.latency_ms] : []).sort((a, b) => a - b);
  const summary = { status: 'synthetic_only', requests: cases.length, results,
    p50_ms: latency[Math.ceil(latency.length * 0.5) - 1] ?? null, p95_ms: latency[Math.ceil(latency.length * 0.95) - 1] ?? null,
    observed_cost_usd: results.reduce((sum, row) => {
      if (typeof row.cost_usd === 'number') return sum + row.cost_usd;
      const evidence = row.evidence as { usage?: { input_tokens: number } } | undefined;
      return sum + (evidence?.usage ? evidence.usage.input_tokens * price / 1_000_000 : 0);
    }, 0),
    unresolved_billing_requests: results.filter(row => row.status === 'outcome_unknown' || (row.status === 'known_response_invalid' && !(row.evidence as { usage?: unknown } | undefined)?.usage)).length,
    billing_complete: results.every(row => row.status === 'settled' || row.status === 'definitely_not_sent') };
  await writeFile(`${directory}/${runId}-summary.json`, JSON.stringify(summary, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(summary));
});
