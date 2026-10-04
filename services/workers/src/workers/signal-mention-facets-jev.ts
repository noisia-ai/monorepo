import { setMaxListeners } from 'node:events';
import { signalWorkspaceEmbeddingDigestV1 as digest } from '@noisia/query-engine/src/signal-workspace-embeddings-v1';
import { buildJevFacetRequestV1, mapJevFacetResponseV1, validateJevThresholdsV1, type JevFacetThresholdsV1, type JevRequestV1, type JevResponseV1 } from '@noisia/query-engine/src/signal-mention-facets-jev-v1';
import { llmPriceV1, llmCostMicroUsdV1, type LlmUsageV1 } from '@noisia/query-engine/src/llm-pricing-v1';
import type { FacetResult } from '@noisia/query-engine/src/signal-mention-labeler-v1';
import type { SignalLabelingStoreV1, LabelingCallV1, LabelingCallProposalV1 } from '@noisia/db';
import { validateJevResponseV1, jevProviderErrorV1, type JevProviderV1, type JevRawResponseV1 } from '../providers/typesafe-jev';
export const jevUsageV1 = (usage: JevResponseV1['usage']): LlmUsageV1 => ({ ...usage, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } });
/** One page lease, >=200 roots per page (the final page may be smaller). The provider owns
 * the concurrency limiter. Never retry a submitting/unknown call, even after process loss. */
export async function processMentionFacetsJevV1(args: { run_id: string; store: SignalLabelingStoreV1; provider: JevProviderV1; lease_renewal_ms?: number }) {
  const { store, provider } = args; const run = await store.claim(args.run_id);
  if (!run) return { status: 'not_claimed' };
  const cancellation = new AbortController();
  // At most 200 page requests subscribe to the same private cancellation signal.
  setMaxListeners(201, cancellation.signal);
  let leaseError: unknown; let renewal: Promise<void> | undefined;
  const interval = args.lease_renewal_ms ?? 60_000;
  if (!Number.isSafeInteger(interval) || interval < 1 || interval > 60_000) { await store.release(run); throw new Error('jev_renewal_interval_invalid'); }
  const heartbeat = setInterval(() => {
    if (renewal || cancellation.signal.aborted) return;
    renewal = store.renew(run).catch(error => { leaseError = error; cancellation.abort(); }).finally(() => { renewal = undefined; });
  }, interval); heartbeat.unref?.();
  try {
    if (run.identity.provider !== 'typesafe' || run.identity.kind !== 'facets') throw new Error('jev_run_provider_mismatch');
    const parameters = run.identity.params;
    const thresholds: JevFacetThresholdsV1 = { entity: parameters.entity as number, salience: parameters.salience as number, spam: parameters.spam as number, minimum_choice_confidence: parameters.minimum_choice_confidence as number };
    validateJevThresholdsV1(thresholds);
    const price = llmPriceV1('typesafe', run.identity.model, 'sync', parameters.input_usd_per_mtok as number);
    let calls = (await store.calls(run)).filter(call => !call.results_applied).slice(0, 200);
    if (!calls.length && !run.error_code) {
      const inputs = await store.inputs(run);
      const proposals: LabelingCallProposalV1[] = inputs.map(input => {
        const request = buildJevFacetRequestV1(input, run.context, run.identity.model);
        const requestDigest = digest({ run_id: run.id, root_id: input.root_id, input_digest: input.input_digest, entity_context_digest: run.entity_context_digest, labeler_digest: run.labeler_digest, request });
        return { custom_id: `mfj1_${requestDigest.replace(/^sha256:/u, '').slice(0, 60)}`, request_digest: requestDigest, request, inputs: [input],
          reserved_micro_usd: llmCostMicroUsdV1(jevUsageV1({ input_tokens: Math.ceil(JSON.stringify(request).length / 3.5), output_tokens: 0 }), price) };
      });
      if (proposals.length) calls = await store.reserve(run, proposals);
    }
    const reserved = run.error_code ? [] : calls.filter(call => call.status === 'reserved' && !call.raw_body);
    if (reserved.length) await store.markSubmitting(run, reserved);
    const rawPage: Array<{ call: LabelingCallV1; raw: string }> = [];
    const errors: Array<{ call: LabelingCallV1; unknown: boolean; code: string }> = [];
    await Promise.all(reserved.map(async call => {
      try { const raw = await provider.evaluate(call.request as JevRequestV1, { signal: cancellation.signal }); rawPage.push({ call, raw: JSON.stringify(raw) }); }
      catch (error) { const failure = jevProviderErrorV1(error); errors.push({ call, unknown: failure.outcome !== 'definitely_not_sent', code: failure.code }); }
    }));
    // Raw persistence must succeed for the whole page before any parsing or settlement.
    if (rawPage.length) await store.persistRawPage(run, rawPage);
    if (renewal) await renewal;
    if (leaseError) {
      // Even after lease loss, preserve transport facts; do not parse/apply under a lost lease.
      for (const unknown of [false, true]) {
        const group = errors.filter(error => error.unknown === unknown);
        if (group.length) await store.markFailed(run, group.map(error => error.call), unknown);
      }
      throw leaseError;
    }
    const results: Array<{ call: LabelingCallV1; results: FacetResult[] }> = [];
    const settlement: Array<{ call: LabelingCallV1; usage: LlmUsageV1; settled_micro_usd: number; stop_reason: string }> = [];
    const latencies: number[] = [];
    const failureResult = (call: LabelingCallV1, code: string): FacetResult[] => call.inputs.map(input => ({ root_id: input.root_id, input_digest: input.input_digest, entity_context_digest: run.entity_context_digest, status: 'error', error_code: code }));
    for (const call of calls) {
      const rawText = rawPage.find(item => item.call.id === call.id)?.raw ?? call.raw_body;
      if (!rawText) {
        const error = errors.find(item => item.call.id === call.id);
        if (!error) errors.push({ call, unknown: call.status !== 'failed', code: call.status === 'failed' ? 'jev_definitely_not_sent' : 'jev_outcome_unknown' });
        continue;
      }
      try {
        const raw = JSON.parse(rawText) as JevRawResponseV1;
        const parsed = validateJevResponseV1(call.request as JevRequestV1, raw);
        const usage = jevUsageV1(parsed.usage);
        const input = call.inputs[0]; if (!input || call.inputs.length !== 1) throw new Error('jev_input_invalid');
        const result = mapJevFacetResponseV1(input, run.context, parsed, thresholds);
        settlement.push({ call, usage, settled_micro_usd: llmCostMicroUsdV1(usage, price), stop_reason: 'completed' });
        results.push({ call, results: [result] });
        latencies.push(raw.latency_ms);
      } catch (error) {
        const failure = jevProviderErrorV1(error);
        if (failure.evidence.usage) {
          const usage = jevUsageV1(failure.evidence.usage);
          settlement.push({ call, usage, settled_micro_usd: llmCostMicroUsdV1(usage, price), stop_reason: 'known_response_invalid' });
          results.push({ call, results: failureResult(call, failure.code) });
        } else errors.push({ call, unknown: true, code: failure.code });
      }
    }
    if (settlement.length) await store.settlePage(run, settlement);
    for (const unknown of [false, true]) {
      const group = errors.filter(error => error.unknown === unknown);
      if (group.length) await store.markFailed(run, group.map(error => error.call), unknown);
      results.push(...group.map(error => ({ call: error.call, results: failureResult(error.call, error.code) })));
    }
    if (results.length) await store.apply(run, results);
    latencies.sort((a, b) => a - b);
    return { status: await store.finish(run), roots: calls.length, labeled: results.filter(item => item.results[0]?.status === 'labeled').length,
      unresolved_billing_requests: errors.filter(error => error.unknown).length,
      settled_micro_usd: settlement.reduce((sum, row) => sum + row.settled_micro_usd, 0),
      p50_ms: latencies[Math.ceil(latencies.length * 0.5) - 1] ?? null, p95_ms: latencies[Math.ceil(latencies.length * 0.95) - 1] ?? null };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (['labeling_forbidden', 'labeling_policy_changed', 'labeling_preparation_changed', 'labeling_context_changed', 'labeling_cap_exhausted', 'labeling_daily_cap_exhausted'].includes(code)) {
      await store.fail(run, code);
    }
    throw error;
  } finally { clearInterval(heartbeat); if (renewal) await renewal; await store.release(run); }
}

export const SIGNAL_MENTION_FACETS_JEV_JOB_V1 = 'signal-mention-facets-jev-v1';
let runtimeProvider: JevProviderV1 | undefined;
export async function signalMentionFacetsJevJobV1(job: { data: { run_id: string } }) {
  if (process.env.NOISIA_MENTION_FACETS_ENABLED !== 'true' || process.env.NOISIA_JEV_PROVIDER_ENABLED !== 'true') throw new Error('jev_disabled');
  const { pool } = await import('../db/client');
  const { createMentionFacetsRuntimeStoreV1 } = await import('./signal-mention-facets-batch');
  const { createTypesafeJevClientV1 } = await import('../providers/typesafe-jev');
  runtimeProvider ??= createTypesafeJevClientV1();
  return processMentionFacetsJevV1({ run_id: job.data.run_id, store: createMentionFacetsRuntimeStoreV1(pool), provider: runtimeProvider });
}
export function startMentionFacetsJevDrainerV1() {
  let active: Promise<void> | undefined;
  const tick = async () => {
    if (process.env.NOISIA_MENTION_FACETS_ENABLED !== 'true' || process.env.NOISIA_JEV_PROVIDER_ENABLED !== 'true') return;
    const { pool } = await import('../db/client');
    if (!(await pool.query("SELECT to_regclass('signal_labeling_runs') IS NOT NULL ready")).rows[0]?.ready) return;
    const rows = (await pool.query(`SELECT r.id FROM signal_labeling_runs r JOIN signal_labeler_versions l ON l.id=r.labeler_version_id
      WHERE r.kind='facets' AND l.provider='typesafe' AND r.status IN('queued','running') AND NOT r.waiting_full_confirmation
      AND r.next_poll_at<=now() AND (r.lease_until IS NULL OR r.lease_until<now()) ORDER BY r.created_at LIMIT 4`)).rows;
    for (const row of rows) await signalMentionFacetsJevJobV1({ data: { run_id: row.id } }).catch(() => console.warn('[mention-facets-jev] page unavailable'));
  };
  const start = () => { if (!active) active = tick().catch(() => console.warn('[mention-facets-jev] drainer unavailable')).finally(() => { active = undefined; }); };
  const timer = setInterval(start, 30_000); timer.unref?.(); start();
  return { async close() { clearInterval(timer); if (active) await active; } };
}
