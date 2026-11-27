import { setTimeout as sleep } from "node:timers/promises";
import type { JevAccountRateLimiter, JevAccountRateLimits, JevRateReservation } from "./jev-account-rate-limit";
import { validateJevResponseV1, type JevRequestV1, type JevResponseV1 } from "./typesafe-jev";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** The whole run must stop: retrying cannot help and may keep spending. */
export class JevFatalErrorV1 extends Error {
  constructor(readonly code: string, readonly http_status?: number) { super(code); this.name = "JevFatalErrorV1"; }
}
export type JevPacedResultV1 =
  | { ok: true; response: JevResponseV1; raw_body: string; latency_ms: number; attempts: number; throttled: number }
  | { ok: false; code: string; attempts: number; throttled: number; http_status?: number };
export type JevPacedClientV1 = {
  evaluate(request: JevRequestV1, options?: { signal?: AbortSignal }): Promise<JevPacedResultV1>;
};

export function jevRetryAfterMsV1(value: string, now: number): number | undefined {
  const normalized = value.trim();
  if (/^\d+(?:\.\d+)?$/u.test(normalized)) {
    const delay = Number(normalized) * 1000;
    return Number.isFinite(delay) ? Math.ceil(delay) : undefined;
  }
  const date = Date.parse(normalized);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/** Same contract as the Redis limiter, for one process: tests and local runs. */
export function createLocalJevRateLimiterV1(limits: Omit<JevAccountRateLimits, "account_id">, now: () => number = Date.now): JevAccountRateLimiter {
  const events: Array<{ id: number; at: number; tokens: number }> = [];
  let cooldownUntil = 0, sequence = 0;
  const live = () => { const cutoff = now() - 1000; while (events.length && events[0]!.at <= cutoff) events.shift(); };
  return {
    async acquire(tokens, signal) {
      if (!Number.isSafeInteger(tokens) || tokens < 1 || tokens > limits.input_tokens_per_second) throw new Error("jev_rate_token_estimate_invalid");
      for (;;) {
        signal?.throwIfAborted();
        live();
        const wait = cooldownUntil > now() ? cooldownUntil - now()
          : events.length >= limits.requests_per_second || events.reduce((sum, event) => sum + event.tokens, 0) + tokens > limits.input_tokens_per_second
            ? Math.max(1, events[0]!.at + 1000 - now()) : 0;
        if (!wait) { const id = ++sequence; events.push({ id, at: now(), tokens }); return { id: String(id), estimated_input_tokens: tokens }; }
        await sleep(wait, undefined, { signal });
      }
    },
    async throttle(delay) { cooldownUntil = Math.max(cooldownUntil, now() + delay); },
    async observe(reservation, tokens) {
      const event = events.find(candidate => String(candidate.id) === reservation.id);
      if (event) event.tokens = tokens;
    },
  };
}

/** Input tokens from request bytes. Starts conservative and follows the highest
 * recently observed ratio, so the shared token window is rarely underestimated. */
export function createJevTokenEstimatorV1(options: { initial_tokens_per_byte?: number; max_tokens: number; window?: number }) {
  const window = options.window ?? 256, ratios: number[] = [];
  let ratio = options.initial_tokens_per_byte ?? 1 / 3;
  return {
    estimate(bytes: number) { return Math.max(1, Math.min(options.max_tokens, Math.ceil(bytes * ratio * 1.03) + 16)); },
    learn(bytes: number, input_tokens: number) {
      if (bytes < 1 || input_tokens < 1) return;
      ratios.push(input_tokens / bytes);
      if (ratios.length > window) ratios.shift();
      if (ratios.length >= 16) ratio = Math.max(...ratios);
    },
    ratio() { return ratio; },
  };
}

async function readBounded(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel().catch(() => undefined); throw new Error("jev_response_too_large"); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size).toString("utf8");
}

/**
 * JEV as a mass classifier: every request first takes a slot from the account
 * rhythm shared by all processes (requests/s and input tokens/s). A 429 or 529
 * pauses the whole account for `retry-after` (or an exponential floor) and the
 * request is tried again. Other failures are retried a few times and then
 * reported for that root only.
 */
export function createJevPacedClientV1(options: {
  api_key: string; limiter: JevAccountRateLimiter; max_input_tokens_per_request: number;
  fetch?: typeof fetch; timeout_ms?: number; max_attempts?: number; max_throttles?: number;
  estimator?: ReturnType<typeof createJevTokenEstimatorV1>; sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}): JevPacedClientV1 & { estimator: ReturnType<typeof createJevTokenEstimatorV1> } {
  if (!options.api_key.trim()) throw new JevFatalErrorV1("jev_configuration_invalid");
  const estimator = options.estimator ?? createJevTokenEstimatorV1({ max_tokens: options.max_input_tokens_per_request });
  const maxAttempts = options.max_attempts ?? 4, maxThrottles = options.max_throttles ?? 20, timeout = options.timeout_ms ?? 60_000;
  const pause = options.sleep ?? ((ms: number, signal?: AbortSignal) => sleep(ms, undefined, { signal }));
  let consecutiveRejections = 0;
  return { estimator, async evaluate(request, { signal } = {}) {
    const body = JSON.stringify(request), bytes = Buffer.byteLength(body);
    let attempts = 0, throttled = 0, lastCode = "jev_transport_unknown", lastStatus: number | undefined;
    while (attempts < maxAttempts && throttled <= maxThrottles) {
      signal?.throwIfAborted();
      let reservation: JevRateReservation;
      try { reservation = await options.limiter.acquire(estimator.estimate(bytes), signal); }
      catch (error) { if (signal?.aborted) throw error; throw new JevFatalErrorV1("jev_rate_limiter_unavailable"); }
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout); timer.unref?.();
      const started = performance.now();
      let response: Response, text: string;
      try {
        response = await (options.fetch ?? fetch)(ENDPOINT, { method: "POST", redirect: "error", signal: controller.signal,
          headers: { Authorization: `Bearer ${options.api_key}`, "Content-Type": "application/json" }, body });
        text = await readBounded(response);
      } catch {
        attempts++; lastCode = "jev_transport_unknown"; lastStatus = undefined;
        if (attempts < maxAttempts) await pause(250 * 2 ** attempts + Math.floor(Math.random() * 250), signal);
        continue;
      } finally { clearTimeout(timer); }
      const latency_ms = performance.now() - started;
      lastStatus = response.status;
      if (response.status === 429 || response.status === 529) {
        throttled++; consecutiveRejections++;
        const retryAfter = response.headers.get("retry-after");
        const requested = retryAfter === null ? undefined : jevRetryAfterMsV1(retryAfter, Date.now());
        const backoff = Math.min(120_000, Math.max(requested ?? 0, Math.min(30_000, 1000 * 2 ** Math.min(consecutiveRejections - 1, 5))));
        lastCode = `jev_http_${response.status}`;
        // The pause is shared: every process on the account waits, not only this request.
        try { await options.limiter.throttle(backoff); } catch { throw new JevFatalErrorV1("jev_rate_limiter_unavailable"); }
        continue;
      }
      if ([401, 402, 403].includes(response.status)) throw new JevFatalErrorV1(`jev_http_${response.status}`, response.status);
      if (response.status !== 200) {
        attempts++; lastCode = `jev_http_${response.status}`;
        if (response.status < 500) break;
        if (attempts < maxAttempts) await pause(250 * 2 ** attempts + Math.floor(Math.random() * 250), signal);
        continue;
      }
      consecutiveRejections = 0;
      attempts++;
      try {
        const parsed = validateJevResponseV1(request, { body: text, http_status: 200, latency_ms });
        estimator.learn(bytes, parsed.usage.input_tokens);
        // Correcting the shared window is best effort; the estimate already holds the slot.
        void options.limiter.observe(reservation, parsed.usage.input_tokens).catch(() => undefined);
        return { ok: true, response: parsed, raw_body: text, latency_ms, attempts, throttled };
      } catch { lastCode = "jev_response_invalid"; }
    }
    return { ok: false, code: lastCode, attempts, throttled, ...(lastStatus === undefined ? {} : { http_status: lastStatus }) };
  } };
}
