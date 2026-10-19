import assert from "node:assert/strict";
import test from "node:test";

test("strategic readiness consumes the worker epoch heartbeat contract", async () => {
  const priorRedis = globalThis.noisiaTbRedis;
  try {
    let observedKey: string | null = null;
    globalThis.noisiaTbRedis = {
      async get(key: string) {
        observedKey = key;
        return String(Date.now());
      }
    } as never;
    const { loadTbAnalysisRuntimeReadiness } = await import("./tb-analysis");
    const readiness = await loadTbAnalysisRuntimeReadiness({
      NODE_ENV: "test",
      REDIS_URL: "rediss://configured.invalid",
      ANTHROPIC_API_KEY: "configured-for-test"
    });
    assert.equal(observedKey, "noisia:worker-alive:noisia-tb-analysis");
    assert.deepEqual(readiness, {
      queue_configured: true,
      worker_alive: true,
      provider_key_configured: true,
      recovery_ready: true
    });
  } finally {
    globalThis.noisiaTbRedis = priorRedis;
  }
});

test("missing heartbeat fails worker and recovery closed", async () => {
  const priorRedis = globalThis.noisiaTbRedis;
  try {
    globalThis.noisiaTbRedis = { async get() { return null; } } as never;
    const { loadTbAnalysisRuntimeReadiness } = await import("./tb-analysis");
    const readiness = await loadTbAnalysisRuntimeReadiness({
      NODE_ENV: "test",
      REDIS_URL: "rediss://configured.invalid",
      ANTHROPIC_API_KEY: "configured-for-test"
    });
    assert.equal(readiness.worker_alive, false);
    assert.equal(readiness.recovery_ready, false);
  } finally {
    globalThis.noisiaTbRedis = priorRedis;
  }
});
