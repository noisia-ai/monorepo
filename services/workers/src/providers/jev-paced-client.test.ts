import test from "node:test";
import assert from "node:assert/strict";
import type { JevAccountRateLimiter } from "./jev-account-rate-limit";
import { createJevPacedClientV1, createJevTokenEstimatorV1, createLocalJevRateLimiterV1, JevFatalErrorV1, jevRetryAfterMsV1 } from "./jev-paced-client";

const request = { model: "jev-1.13.0", state: "synthetic text", questions: { promotion: { type: "noul" as const, instructions: "Classify.",
  criteria: { true: "Promotes", false: "Does not" } } } };
const ok = (tokens = 100) => Response.json({ model: "jev-1.13.0", usage: { input_tokens: tokens, output_tokens: 0 }, answers: { promotion: { type: "noul", noul: 0.2 } } });
function recordingLimiter() {
  const log: string[] = [];
  const limiter: JevAccountRateLimiter = {
    async acquire(tokens) { log.push(`acquire:${tokens > 0}`); return { id: "r", estimated_input_tokens: tokens }; },
    async throttle(delay) { log.push(`throttle:${delay}`); },
    async observe(_reservation, tokens) { log.push(`observe:${tokens}`); },
  };
  return { limiter, log };
}
const client = (limiter: JevAccountRateLimiter, responses: Array<() => Response | Promise<Response>>, extra = {}) => {
  let call = 0;
  return createJevPacedClientV1({ api_key: "synthetic-test-key", limiter, max_input_tokens_per_request: 65_536,
    sleep: async () => undefined, fetch: (async () => responses[Math.min(call++, responses.length - 1)]!()) as typeof fetch, ...extra });
};

test("a valid answer takes one account slot and reports its real usage", async () => {
  const { limiter, log } = recordingLimiter();
  const result = await client(limiter, [() => ok(321)]).evaluate(request);
  assert.equal(result.ok, true);
  if (result.ok) { assert.equal(result.response.usage.input_tokens, 321); assert.equal(result.attempts, 1); assert.equal(result.throttled, 0); }
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(log, ["acquire:true", "observe:321"]);
});

test("429 and 529 pause the whole account for retry-after and the request is sent again", async () => {
  const { limiter, log } = recordingLimiter();
  const result = await client(limiter, [
    () => new Response("slow down", { status: 429, headers: { "retry-after": "7" } }),
    () => new Response("overloaded", { status: 529 }),
    () => ok(),
  ]).evaluate(request);
  assert.equal(result.ok, true);
  if (result.ok) { assert.equal(result.throttled, 2); assert.equal(result.attempts, 1); }
  assert.deepEqual(log.filter(entry => entry.startsWith("throttle")), ["throttle:7000", "throttle:2000"]);
  assert.equal(log.filter(entry => entry.startsWith("acquire")).length, 3);
});

test("the exponential floor applies when the provider sends no retry-after and resets after a success", async () => {
  const { limiter, log } = recordingLimiter();
  const paced = client(limiter, [() => new Response("", { status: 429 }), () => new Response("", { status: 429 }), () => ok(),
    () => new Response("", { status: 429 }), () => ok()]);
  await paced.evaluate(request); await paced.evaluate(request);
  assert.deepEqual(log.filter(entry => entry.startsWith("throttle")), ["throttle:1000", "throttle:2000", "throttle:1000"]);
});

test("rejections of one burst lengthen the shared pause once, not once per request", async () => {
  const { limiter, log } = recordingLimiter();
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let call = 0;
  const paced = createJevPacedClientV1({ api_key: "synthetic-test-key", limiter, max_input_tokens_per_request: 65_536, sleep: async () => undefined,
    fetch: (async () => { const mine = call++; if (mine < 6) { await gate; return new Response("", { status: 429 }); } return ok(); }) as typeof fetch });
  const burst = Array.from({ length: 6 }, () => paced.evaluate(request));
  await new Promise(resolve => setTimeout(resolve, 10)); release();
  await Promise.all(burst);
  assert.deepEqual(log.filter(entry => entry.startsWith("throttle")), Array.from({ length: 6 }, () => "throttle:1000"));
});

test("authentication and balance failures stop the run instead of being retried", async () => {
  for (const status of [401, 402, 403]) {
    await assert.rejects(client(recordingLimiter().limiter, [() => new Response("", { status })]).evaluate(request),
      (error: unknown) => error instanceof JevFatalErrorV1 && error.code === `jev_http_${status}`);
  }
  await assert.rejects(client({ ...recordingLimiter().limiter, async acquire() { throw new Error("redis down"); } }, [() => ok()]).evaluate(request),
    (error: unknown) => error instanceof JevFatalErrorV1 && error.code === "jev_rate_limiter_unavailable");
});

test("server errors and broken responses are retried a bounded number of times for that root only", async () => {
  const transient = await client(recordingLimiter().limiter, [() => new Response("", { status: 503 }), () => { throw new Error("socket"); }, () => ok()]).evaluate(request);
  assert.equal(transient.ok, true); if (transient.ok) assert.equal(transient.attempts, 3);
  const exhausted = await client(recordingLimiter().limiter, [() => new Response("", { status: 500 })]).evaluate(request);
  assert.deepEqual(exhausted, { ok: false, code: "jev_http_500", attempts: 4, throttled: 0, http_status: 500 });
  const rejected = await client(recordingLimiter().limiter, [() => new Response("", { status: 400 })]).evaluate(request);
  assert.deepEqual(rejected, { ok: false, code: "jev_http_400", attempts: 1, throttled: 0, http_status: 400 });
  const invalid = await client(recordingLimiter().limiter, [() => Response.json({ model: "jev-1.13.0", usage: { input_tokens: 1, output_tokens: 0 }, answers: {} })]).evaluate(request);
  assert.equal(invalid.ok, false); if (!invalid.ok) { assert.equal(invalid.code, "jev_response_invalid"); assert.equal(invalid.attempts, 1, "a billed malformed answer is not sent again"); }
});

test("retry-after accepts seconds and HTTP dates", () => {
  assert.equal(jevRetryAfterMsV1("1.5", 0), 1500);
  assert.equal(jevRetryAfterMsV1("Thu, 01 Jan 1970 00:00:10 GMT", 4000), 6000);
  assert.equal(jevRetryAfterMsV1("soon", 0), undefined);
});

test("the token estimate starts conservative and follows the highest observed ratio", () => {
  const estimator = createJevTokenEstimatorV1({ max_tokens: 10_000 });
  assert.ok(estimator.estimate(3000) >= 1000);
  for (let index = 0; index < 20; index++) estimator.learn(4000, index === 7 ? 1100 : 1000);
  assert.equal(estimator.ratio(), 1100 / 4000);
  assert.ok(estimator.estimate(4000) >= 1100 && estimator.estimate(4000) < 1200);
  assert.equal(estimator.estimate(10_000_000), 10_000);
});

test("the in-process limiter enforces requests and tokens per second and a shared pause", async () => {
  let now = 0;
  const limiter = createLocalJevRateLimiterV1({ requests_per_second: 2, input_tokens_per_second: 100 }, () => now);
  await limiter.acquire(40); await limiter.acquire(40);
  let admitted = false;
  const third = limiter.acquire(10).then(() => { admitted = true; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(admitted, false, "third request must wait for the window");
  now = 1001; await third; assert.equal(admitted, true);
  now = 3000;
  await limiter.acquire(90);
  let tokens = false;
  const heavy = limiter.acquire(20).then(() => { tokens = true; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(tokens, false, "token budget must hold the request");
  now = 4001; await heavy;
  await limiter.throttle(500);
  let paused = false;
  const afterPause = limiter.acquire(1).then(() => { paused = true; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(paused, false);
  now = 6000; await afterPause;
});
