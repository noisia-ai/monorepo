import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { JevAccountRateLimiter, JevRateReservation } from './jev-account-rate-limit';

import type { JevRequestV1, JevResponseV1 } from '@noisia/query-engine/src/signal-mention-facets-jev-v1';
export type { JevRequestV1, JevResponseV1 } from '@noisia/query-engine/src/signal-mention-facets-jev-v1';
export type JevRawResponseV1 = { body: string; http_status: number; latency_ms: number; retry_after?: string; retry_after_ms?: number; rate_backoff_ms?: number; rate_reservation?: JevRateReservation; rate_calibration?:{labeler_digest:string;input_bytes:number}; rate_limit_update_failed?: true };
export type JevOutcomeV1 = 'definitely_not_sent' | 'outcome_unknown' | 'known_response_invalid';
export class JevProviderErrorV1 extends Error {
  constructor(readonly code: string, readonly outcome: JevOutcomeV1,
    readonly evidence: { response_digest?: string; usage?: JevResponseV1['usage']; http_status?: number } = {}) {
    super(code); this.name = 'JevProviderErrorV1';
  }
}
// Only this transport can attest that cancellation happened before fetch.
// The witness is process-local identity, never a field accepted from JSON,
// an HTTP response, an adapter or an error with the same public code.
const preFetchCanceled=new WeakSet<JevProviderErrorV1>();
function canceledBeforeFetch(){
  const error=new JevProviderErrorV1('jev_send_canceled','definitely_not_sent');preFetchCanceled.add(error);return error;
}
export function isJevPreFetchCancellationV1(error:unknown):boolean{
  return error instanceof JevProviderErrorV1&&error.code==='jev_send_canceled'&&error.outcome==='definitely_not_sent'&&preFetchCanceled.has(error);
}
export function jevProviderErrorV1(error: unknown): JevProviderErrorV1 {
  return error instanceof JevProviderErrorV1 ? error : new JevProviderErrorV1('jev_transport_unknown', 'outcome_unknown');
}
export function jevRetryAfterMsV1(value: string, now: number): number | undefined {
  const normalized = value.trim();
  if (/^\d+(?:\.\d+)?$/u.test(normalized)) {
    const delay = Number(normalized) * 1000;
    return Number.isFinite(delay) ? Math.ceil(delay) : undefined;
  }
  const date = Date.parse(normalized);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
async function readBounded(response: Response, limit = MAX_RESPONSE_BYTES): Promise<string> {
  const length = response.headers.get('content-length');
  if ((length !== null && (!/^\d+$/u.test(length) || Number(length) > limit)) || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new JevProviderErrorV1('jev_response_unavailable', 'outcome_unknown');
  }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) { await reader.cancel().catch(() => undefined); throw new JevProviderErrorV1('jev_response_too_large', 'outcome_unknown'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export type JevProviderV1 = { close?():Promise<void>; readonly max_concurrency?: number; readonly max_response_bytes?: number; evaluate(request: JevRequestV1, options?: { signal?: AbortSignal }): Promise<JevRawResponseV1>; observeUsage?(raw: JevRawResponseV1, input_tokens: number): Promise<void> };
/** One attempt only. Callers persist submitting before invoking this client. Raw responses
 * are returned without JSON parsing so the shared ledger can persist them first. */
export function createTypesafeJevClientV1(options: {
  api_key?: string; enabled?: boolean; timeout_ms?: number; max_response_bytes?: number; concurrency?: number; fetch?: typeof fetch; rate_limiter?: JevAccountRateLimiter; estimate_input_tokens?: (request: JevRequestV1) => number;
} = {}): JevProviderV1 {
  const concurrency = options.concurrency ?? Number(process.env.NOISIA_JEV_CONCURRENCY ?? '2');
  let active = 0; const waiting: Array<() => void> = [];
  let rejections = 0, localCooldownUntil = 0, rateUnavailable = false;
  const responseLimit = options.max_response_bytes ?? MAX_RESPONSE_BYTES;
  return { max_concurrency: concurrency, max_response_bytes: responseLimit,
    async observeUsage(raw, input_tokens) {
      if (raw.rate_reservation && options.rate_limiter) await options.rate_limiter.observe(raw.rate_reservation, input_tokens);
    }, async evaluate(request, cancellation = {}) {
    const key = options.api_key ?? process.env.TYPESAFE_API_KEY;
    const timeout = options.timeout_ms ?? 60_000;
    if (!(options.enabled ?? process.env.NOISIA_JEV_PROVIDER_ENABLED === 'true')) throw new JevProviderErrorV1('jev_disabled', 'definitely_not_sent');
    if (!key?.trim() || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000
      || !Number.isSafeInteger(responseLimit) || responseLimit < 1 || responseLimit > MAX_RESPONSE_BYTES
      || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4096 || (concurrency > 80 && !options.rate_limiter)
      || Boolean(options.rate_limiter) !== Boolean(options.estimate_input_tokens)) throw new JevProviderErrorV1('jev_configuration_invalid', 'definitely_not_sent');
    let body: string;
    try {
      if (!request.model || !request.questions || Object.keys(request.questions).length === 0 || request.state == null) throw new Error();
      body = JSON.stringify(request);
    } catch { throw new JevProviderErrorV1('jev_request_invalid', 'definitely_not_sent'); }
    const signal = cancellation.signal;
    if (signal?.aborted) throw canceledBeforeFetch();
    if (active >= concurrency) await new Promise<void>((resolve, reject) => {
      const ready = () => { signal?.removeEventListener('abort', cancel); resolve(); };
      const cancel = () => {
        const index = waiting.indexOf(ready);
        if (index >= 0) { waiting.splice(index, 1); reject(canceledBeforeFetch()); }
      };
      waiting.push(ready); signal?.addEventListener('abort', cancel, { once: true });
    }); else active++;
    const controller = new AbortController(); let start = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reservation: JevRateReservation | undefined;
    try {
      // Cancellation fences queued work immediately before fetch. Already sent calls keep
      // their response channel so raw billing evidence can still be persisted.
      if (options.rate_limiter && options.estimate_input_tokens) {
        if (rateUnavailable) throw new JevProviderErrorV1('jev_rate_limiter_unavailable', 'definitely_not_sent');
        try { reservation = await options.rate_limiter.acquire(options.estimate_input_tokens(request), signal); }
        catch { throw signal?.aborted?canceledBeforeFetch():new JevProviderErrorV1('jev_rate_limiter_unavailable','definitely_not_sent'); }
      } else if (localCooldownUntil > Date.now()) {
        try { await sleep(localCooldownUntil - Date.now(), undefined, { signal }); }
        catch { throw canceledBeforeFetch(); }
      }
      if (signal?.aborted) throw canceledBeforeFetch();
      start = performance.now(); timer = setTimeout(() => controller.abort(), timeout); timer.unref?.();
      const response = await (options.fetch ?? fetch)('https://api.typesafe.ai/v1/systemone', {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body
      });
      const retryAfter = response.headers.get('retry-after');
      const retryDelay = retryAfter === null ? undefined : jevRetryAfterMsV1(retryAfter, Date.now());
      // Start the shared cooldown as soon as rejection headers arrive, even if
      // the body is slow or invalid. Retry-After may extend the exponential floor.
      let backoff: number | undefined;
      if ([429, 529].includes(response.status)) {
        rejections++;
        backoff = Math.max(retryDelay ?? 0, Math.min(30_000, 1000 * 2 ** Math.min(rejections - 1, 5)));
        localCooldownUntil = Math.max(localCooldownUntil, Date.now() + backoff);
      } else if (response.status === 200) rejections = 0;
      const bodyPromise = readBounded(response, responseLimit).then(body => ({ body, latency: performance.now() - start }));
      const cooldownPromise = backoff === undefined || !options.rate_limiter ? Promise.resolve(false)
        : options.rate_limiter.throttle(backoff).then(() => false, () => { rateUnavailable = true; return true; });
      const [physical, rateUpdateFailed] = await Promise.all([bodyPromise, cooldownPromise]);
      // Preserve physical rejection evidence. The scheduler must persist this response
      // before admitting any new attempt; this client never retries an HTTP request.
      return { body: physical.body, ...(reservation ? { rate_reservation: reservation } : {}), ...(rateUpdateFailed ? { rate_limit_update_failed: true as const } : {}), http_status: response.status, latency_ms: physical.latency,
        ...(backoff === undefined ? {} : { rate_backoff_ms: backoff }),
        ...(retryAfter === null ? {} : { retry_after: retryAfter }),
        ...(retryDelay === undefined ? {} : { retry_after_ms: retryDelay }) };
    } catch (error) { throw jevProviderErrorV1(error); }
    finally { if (timer) clearTimeout(timer); const next = waiting.shift(); if (next) next(); else active--; }
  } };
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const probability = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
/** Invoke only after raw persistence. Any invalid response keeps billing evidence and cannot
 * become an unrelated/spam decision. No silent acceptance of missing or extra questions. */
export function validateJevResponseV1(request: JevRequestV1, raw: JevRawResponseV1): JevResponseV1 {
  const response_digest = `sha256:${createHash('sha256').update(raw.body).digest('hex')}`;
  // A throttle's optional usage fields do not prove non-processing or a bill.
  // Keep its exposure until authoritative evidence can reconcile the attempt.
  if ([429, 529].includes(raw.http_status)) throw new JevProviderErrorV1('jev_response_invalid', 'outcome_unknown',
    { response_digest, http_status: raw.http_status });
  let usage: JevResponseV1['usage'] | undefined;
  try {
    const json: unknown = JSON.parse(raw.body);
    if (!record(json)) throw new Error();
    if (record(json.usage) && Number.isSafeInteger(json.usage.input_tokens) && Number.isSafeInteger(json.usage.output_tokens)
      && (json.usage.input_tokens as number) >= 0 && (json.usage.output_tokens as number) >= 0) usage = json.usage as JevResponseV1['usage'];
    if (raw.http_status !== 200 || !usage || typeof json.model !== 'string' || !json.model
      || (!['jev-latest', 'jev-preview'].includes(request.model) && json.model !== request.model) || !record(json.answers)
      || Object.keys(json.answers).length !== Object.keys(request.questions).length) throw new Error();
    for (const [name, question] of Object.entries(request.questions)) {
      const answer = json.answers[name];
      if (!record(answer) || answer.type !== question.type) throw new Error();
      if (question.type === 'noul') { if (!probability(answer.noul)) throw new Error(); }
      else {
        if (typeof answer.choice !== 'string' || !Object.hasOwn(question.criteria, answer.choice)
          || !probability(answer.confidence) || !record(answer.probabilities)
          || Object.keys(answer.probabilities).length !== Object.keys(question.criteria).length) throw new Error();
        let sum = 0;
        for (const key of Object.keys(question.criteria)) {
          const value = answer.probabilities[key]; if (!probability(value)) throw new Error(); sum += value;
        }
        // Keep the documented inclusive ±0.01 tolerance despite binary summation
        // (1 - 0.99 is 0.010000000000000009). This only absorbs roundoff.
        const roundoff = Number.EPSILON * Math.max(1, Object.keys(question.criteria).length);
        if (Math.abs(sum - 1) > 0.01 + roundoff) throw new Error();
      }
    }
    return json as JevResponseV1;
  } catch { throw new JevProviderErrorV1('jev_response_invalid', 'known_response_invalid', { response_digest, usage, http_status: raw.http_status }); }
}
