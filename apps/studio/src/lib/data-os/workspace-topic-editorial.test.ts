import assert from "node:assert/strict";
import test from "node:test";
import Redis from "ioredis";
import { createElement, type ComponentProps } from "react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { readFile } from "node:fs/promises";
import type { SignalTopicEditorialScreeningPlanV1 } from "@noisia/query-engine";
import { WorkspaceTopicEditorialCard } from "../../components/brands/WorkspaceTopicEditorialCard";
import { WorkspaceTopicEditorialOutcomes, parseWorkspaceTopicEditorialOutcomesPageV2 } from "../../components/brands/WorkspaceTopicEditorialOutcomes";
import { RedisEditorialQuoteCache, getEditorialQuoteCacheV1, editorialQuoteRuntimeAvailableV1, editorialRecoveryRuntimeAvailableV1, type EditorialQuoteSnapshot } from "./workspace-topic-editorial-cache";
import { parseWorkspaceTopicEditorialCommandV1, validWorkspaceTopicEditorialViewV1, workspaceTopicEditorialIntentV1,
  submitWorkspaceTopicEditorialIntentV1, WorkspaceTopicEditorialRequestError, type WorkspaceTopicEditorialViewV1 } from "./workspace-topic-editorial-contract";
import { loadWorkspaceTopicEditorialForActorV1, requestWorkspaceTopicEditorialForActorV1, type WorkspaceTopicEditorialDependenciesV1 } from "./signal-topic-editorial-control";
Object.assign(globalThis, { React });
const workspace = "00000000-0000-4000-8000-000000000001", actor = "00000000-0000-4000-8000-000000000002";
const numeric = "00000000-0000-4000-8000-000000000003", run = "00000000-0000-4000-8000-000000000004", execution = "00000000-0000-4000-8000-000000000005";
const successor = "00000000-0000-4000-8000-000000000006";
const mentionRoot = "00000000-0000-4000-8000-000000000007";
const reference = `v1.1789236000.${"a".repeat(64)}`, expires = new Date(1789236000 * 1000).toISOString(), now = Date.parse(expires) - 60_000;
const plan = { plan_digest: "server-plan", private_evidence: "private corpus text" } as unknown as SignalTopicEditorialScreeningPlanV1;
const quote = { reference, expires_at: expires, maximum_micro_usd: "30000000", group_count: 1652, screening_count: 42, global_count: 1 as const };
const snapshot: EditorialQuoteSnapshot = { workspace_id: workspace, actor_user_id: actor, numeric_execution_id: numeric, numeric_run_id: run, quote, plan };
const command = { action: "authorize_editorial" as const, numeric_execution_id: numeric, quote_reference: reference, confirmed_maximum_micro_usd: "30000000" };
const access = { workspaceId: workspace, actorUserId: actor, database: {} as import("pg").Pool };
const ready: WorkspaceTopicEditorialViewV1 = { contract_version: "workspace-topic-editorial-view-v1", workspace_id: workspace, numeric_execution_id: numeric,
  status: "ready_to_authorize", can_quote: true, can_retry: false, can_complete: false, quote, execution: null, activation: "not_activated" };
function fixture() {
  const calls: string[] = []; let stored: EditorialQuoteSnapshot | null = snapshot;
  const deps: WorkspaceTopicEditorialDependenciesV1 = {
    inspect: async () => ({ numeric_run_id: run, execution_id: null, can_request: true, source_current: true, retry_available: false, completion: null, replay: null }),
    input: async () => { calls.push("input"); return { plan } as Awaited<ReturnType<WorkspaceTopicEditorialDependenciesV1["input"]>>; },
    quote: async () => { calls.push("quote"); return { contract_version: "signal-topic-editorial-quote-v1", workspace_id: workspace, status: "ready_to_authorize",
      quote_reference: reference, quote_expires_at: expires, maximum_micro_usd: "30000000", expected_group_count: 1652, screening_request_count: 42, global_request_count: 1, provider_execution_enabled: false }; },
    status: async () => { calls.push("status"); return { contract_version: "signal-topic-editorial-status-v1", workspace_id: workspace, status: "not_requested", execution_id: null,
      completed_screening_count: 0, expected_screening_count: 0, maximum_micro_usd: null, confirmed_micro_usd: "0", reserved_micro_usd: "0", ambiguous_micro_usd: "0", provider_execution_enabled: false, error_code: null }; },
    request: async args => { calls.push("request"); assert.equal(args.plan, plan); return { execution_id: execution, worker_job_id: "private-job", replayed: false }; },
    retry: async () => { calls.push("retry"); return { execution_id: execution, worker_job_id: "private-job", replayed: false }; },
    complete: async () => { throw new Error("unexpected materialization"); },
    cache: () => ({ put: async value => { calls.push("put"); stored = value; }, get: async () => { calls.push("get"); return stored; } }),
    available: () => true, recoverable: () => true, now: () => now
  };
  return { deps, calls, stored: () => stored, clear: () => { stored = null; } };
}
test("commands accept only explicit capped authorization or scoped retry", () => {
  assert.deepEqual(parseWorkspaceTopicEditorialCommandV1(command), command);
  assert.deepEqual(parseWorkspaceTopicEditorialCommandV1({ action: "start_editorial", numeric_execution_id: numeric }),
    { action: "start_editorial", numeric_execution_id: numeric });
  assert.equal(parseWorkspaceTopicEditorialCommandV1({ action: "start_editorial", numeric_execution_id: numeric, plan }), null);
  for (const change of [{ plan }, { evidence: [] }, { actor_user_id: actor }, { provider_available: true },
    { confirmed_maximum_micro_usd: "9223372036854775808" }, { confirmed_maximum_micro_usd: "0" },
    { confirmed_maximum_micro_usd: "500000000" }, { confirmed_maximum_micro_usd: 20 }, { confirmed_maximum_micro_usd: "030000000" }])
    assert.equal(parseWorkspaceTopicEditorialCommandV1({ ...command, ...change }), null);
  assert.deepEqual(parseWorkspaceTopicEditorialCommandV1({ ...command, quote_reference: `v2.1789236000.${"b".repeat(64)}`,
    confirmed_maximum_micro_usd: "500000000" }), { ...command, quote_reference: `v2.1789236000.${"b".repeat(64)}`,
      confirmed_maximum_micro_usd: "500000000" });
  assert.equal(parseWorkspaceTopicEditorialCommandV1({ action: command.action, numeric_execution_id: numeric, quote_reference: reference }), null);
});
test("V2 start keeps the policy quote internal and admits from one server-built input", async () => {
  const ui = await readFile(new URL("../../components/brands/WorkspaceTopicEditorialCard.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../../app/api/data-os/signal/[workspaceId]/topics/consolidation/editorial/route.ts", import.meta.url), "utf8");
  const start = await readFile(new URL("./signal-topic-editorial-batch-control-v2.ts", import.meta.url), "utf8");
  assert.match(ui, /action: "start_editorial" as const/u); assert.doesNotMatch(ui, /quote=1|onQuote|onAuthorize/u);
  assert.match(route, /command\?\.action==="start_editorial"[\s\S]*startWorkspaceTopicEditorialBatchV2ForActor/u);
  assert.match(start, /startWorkspaceTopicEditorialBatchV2ForActor[\s\S]*signal_topic_editorial_request_keys[\s\S]*replaySignalTopicEditorialBatchV2/u);
  assert.match(start, /quoteSignalTopicEditorialBatchV2[\s\S]*requestSignalTopicEditorialBatchV2/u);
});
test("V2 policy quote accepts a policy-owned cap above the experiment budget with one item per group", () => {
  const largeQuote = { ...ready, status: "ready_to_authorize" as const, can_quote: true,
    quote: { reference: `v2.1789236000.${"b".repeat(64)}`, expires_at: expires,
      maximum_micro_usd: "500000000", group_count: 1652, screening_count: 1652, global_count: 1 as const } };
  assert.equal(validWorkspaceTopicEditorialViewV1(largeQuote, workspace, numeric), true);
  assert.equal(validWorkspaceTopicEditorialViewV1({ ...largeQuote, quote: { ...largeQuote.quote!, screening_count: 42 } }, workspace, numeric), false);
});
test("quote is server-built, redacted, capped and cache never contains the database connection", async () => {
  const f = fixture(); const result = await loadWorkspaceTopicEditorialForActorV1({ ...access, numericExecutionId: numeric, withQuote: true }, f.deps);
  assert.deepEqual(result, ready); assert.deepEqual(f.calls, ["status", "input", "quote"]);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls, ["status", "input", "quote", "put"]);
  assert.equal("database" in f.stored()!, false);
  assert.doesNotMatch(JSON.stringify(result), /private|provider|model|plan_digest|actor_user_id|ledger/u);
});
test("default runtime is closed; status polling never loads private evidence", async () => {
  assert.equal(editorialQuoteRuntimeAvailableV1({}), false);
  assert.equal(editorialRecoveryRuntimeAvailableV1({}), false);
  const f = fixture(); f.deps.available = () => false;
  const result = await loadWorkspaceTopicEditorialForActorV1({ ...access, numericExecutionId: numeric, withQuote: true }, f.deps);
  assert.equal(result.status, "runtime_unavailable"); assert.equal(result.quote, null); assert.deepEqual(f.calls, ["status"]);
  const off = { REDIS_URL: "redis://unused", NOISIA_SIGNAL_TOPIC_EDITORIAL_ENABLED: "true", NOISIA_SIGNAL_TOPIC_EDITORIAL_PROVIDER_ENABLED: "true" };
  assert.equal(editorialQuoteRuntimeAvailableV1(off), true);
  assert.equal(editorialQuoteRuntimeAvailableV1({ ...off, REDIS_URL: undefined }), true);
  assert.equal(editorialQuoteRuntimeAvailableV1({ ...off, NOISIA_SIGNAL_TOPIC_EDITORIAL_QUOTE_KEY: Buffer.alloc(32, 7).toString("base64") }), true);
  assert.equal(editorialRecoveryRuntimeAvailableV1({ NOISIA_SIGNAL_TOPIC_EDITORIAL_ENABLED: "true" }), true);
});
test("expired quotes, cap mismatch, source drift and revoked actors fail before request or rebuilding", async () => {
  for (const mode of ["expired", "cap", "drift", "revoked"] as const) {
    const f = fixture(); if (mode === "expired") f.deps.now = () => Date.parse(expires);
    if (mode === "drift" || mode === "revoked") f.deps.inspect = async () => ({ numeric_run_id: run, execution_id: null,
      can_request: mode !== "revoked", source_current: mode !== "drift", retry_available: false, completion: null, replay: null });
    await assert.rejects(requestWorkspaceTopicEditorialForActorV1({ ...access, idempotencyKey: "request-key", body: { ...command,
      confirmed_maximum_micro_usd: mode === "cap" ? "29000000" : "30000000" } }, f.deps));
    assert.equal(f.calls.includes("request"), false); assert.equal(f.calls.includes("input"), false);
  }
});
test("quote returns before a pending cache write and consumes write/factory errors", async () => {
  for (const mode of ["pending", "reject", "factory"] as const) {
    const f = fixture(); let rejectWrite!: (reason: Error) => void;
    f.deps.cache = () => {
      if (mode === "factory") throw new Error("cache unavailable");
      return { get: async () => null, put: async () => {
        f.calls.push("put");
        if (mode === "reject") throw new Error("request too large");
        return new Promise<void>((_resolve, reject) => { rejectWrite = reject; });
      } };
    };
    const result = await loadWorkspaceTopicEditorialForActorV1({ ...access, numericExecutionId: numeric, withQuote: true }, f.deps);
    assert.deepEqual(result, ready); assert.equal(f.calls.includes("put"), false);
    await new Promise<void>(resolve => setImmediate(resolve));
    if (mode === "pending") rejectWrite(new Error("late cache failure"));
    await new Promise<void>(resolve => setImmediate(resolve));
  }
});
test("cache miss, connection failure or missing cache config reconstructs only server input with the original deadline", async () => {
  for (const mode of ["missing", "read_failure", "factory_failure"] as const) {
    const f = fixture(); f.clear();
    if (mode !== "missing") f.deps.cache = () => {
      if (mode === "factory_failure") throw new Error("missing cache key");
      return { put: async () => {}, get: async () => { throw new Error("Redis unavailable"); } };
    };
    const originalQuote = f.deps.quote;
    f.deps.quote = async args => {
      assert.equal(args.deadline, 1789236000); assert.equal(args.plan, plan);
      assert.equal(args.actor_user_id, actor); assert.equal(args.workspace_id, workspace); assert.equal(args.numeric_run_id, run);
      return originalQuote(args);
    };
    f.deps.input = async args => {
      assert.equal(args.actor_user_id, actor); assert.equal(args.workspace_id, workspace); assert.equal(args.numeric_run_id, run);
      f.calls.push("input"); return { plan } as Awaited<ReturnType<typeof f.deps.input>>;
    };
    const receipt = await requestWorkspaceTopicEditorialForActorV1({ ...access, idempotencyKey: "original-key", body: command }, f.deps);
    assert.equal(receipt.execution_id, execution);
    assert.deepEqual(f.calls.slice(-3), ["input", "quote", "request"]);
  }
});
test("reconstructed quote must match reference, expiry, workspace, cap and current SQL authority exactly", async () => {
  for (const mode of ["reference", "expiry", "workspace", "cap", "source", "policy", "expired_during_rebuild"] as const) {
    const f = fixture(); f.clear(); const original = f.deps.quote;
    f.deps.quote = async args => {
      const value = await original(args);
      if (mode === "reference") value.quote_reference = `v1.1789236000.${"b".repeat(64)}`;
      if (mode === "expiry") value.quote_expires_at = new Date(Date.parse(expires) + 1000).toISOString();
      if (mode === "workspace") value.workspace_id = actor;
      if (mode === "cap") value.maximum_micro_usd = "29000000";
      if (mode === "source") value.status = "source_stale";
      if (mode === "policy") value.status = "policy_required";
      if (mode === "expired_during_rebuild") f.deps.now = () => Date.parse(expires);
      return value;
    };
    await assert.rejects(requestWorkspaceTopicEditorialForActorV1({ ...access, idempotencyKey: "original-key", body: command }, f.deps),
      /topic_editorial_quote_expired|topic_editorial_confirmation_invalid/u);
    assert.equal(f.calls.includes("request"), false);
  }
});
test("cache hits are fenced to the exact actor/workspace/control/run/reference/deadline", async () => {
  for (const field of ["workspace_id", "actor_user_id", "numeric_execution_id", "numeric_run_id", "reference", "expires_at"] as const) {
    const f = fixture(), changed = structuredClone(snapshot);
    if (field === "reference") changed.quote.reference = `v1.1789236000.${"b".repeat(64)}`;
    else if (field === "expires_at") changed.quote.expires_at = new Date(Date.parse(expires) + 1000).toISOString();
    else changed[field] = execution;
    f.deps.cache = () => ({ put: async () => {}, get: async () => changed });
    await assert.rejects(requestWorkspaceTopicEditorialForActorV1({ ...access, idempotencyKey: "original-key", body: command }, f.deps), /topic_editorial_quote_expired/u);
    assert.equal(f.calls.includes("request"), false);
  }
});
test("reconstructed plan reaches SQL final fence; post-commit replay never reconstructs or depends on cache", async () => {
  const f = fixture(); f.clear();
  f.deps.request = async () => { f.calls.push("request"); throw new Error("topic_editorial_source_stale"); };
  await assert.rejects(requestWorkspaceTopicEditorialForActorV1({ ...access, idempotencyKey: "original-key", body: command }, f.deps), /source_stale/u);
  let durable = false, commits = 0;
  f.deps.request = async args => { assert.equal(args.plan, plan); assert.equal(args.quote_reference, reference); assert.equal(args.idempotency_key, "original-key");
    if (durable) return { execution_id: execution, worker_job_id: "private", replayed: true };
    durable = true; commits++; throw new Error("connection lost after commit"); };
  await assert.rejects(requestWorkspaceTopicEditorialForActorV1({ ...access, idempotencyKey: "original-key", body: command }, f.deps), /after commit/u);
  f.deps.inspect = async () => ({ numeric_run_id: run, execution_id: execution, can_request: true, source_current: false,
    retry_available: false, completion: null, replay: { plan, quote_reference: reference, maximum_micro_usd: "30000000" } });
  f.deps.now = () => Date.parse(expires) + 1; f.deps.available = () => false;
  f.deps.input = async () => { throw new Error("must not rebuild"); }; f.deps.cache = () => { throw new Error("must not cache"); };
  assert.equal((await requestWorkspaceTopicEditorialForActorV1({ ...access, idempotencyKey: "original-key", body: command }, f.deps)).replayed, true);
  assert.equal(commits, 1);
});
test("committed receipt returns before status; replay uses durable owner even with runtime/cache/source unavailable", async () => {
  const f = fixture(); f.deps.status = async () => { throw new Error("status failed after commit"); };
  const receipt = await requestWorkspaceTopicEditorialForActorV1({ ...access, idempotencyKey: "request-key", body: command }, f.deps);
  assert.equal(receipt.execution_id, execution); assert.deepEqual(f.calls, ["get", "request"]);
  f.deps.inspect = async () => ({ numeric_run_id: run, execution_id: execution, can_request: true, source_current: false,
    retry_available: false, completion: null, replay: { plan, quote_reference: reference, maximum_micro_usd: "30000000" } });
  f.deps.available = () => false; f.deps.cache = () => { throw new Error("cache unavailable"); };
  f.deps.request = async args => { assert.equal(args.plan, plan); return { execution_id: execution, worker_job_id: "private", replayed: true }; };
  const replay = await requestWorkspaceTopicEditorialForActorV1({ ...access, idempotencyKey: "request-key", body: command }, f.deps);
  assert.equal(replay.replayed, true);
  await assert.rejects(requestWorkspaceTopicEditorialForActorV1({ ...access, idempotencyKey: "request-key", body: { ...command, confirmed_maximum_micro_usd: "1" } }, f.deps), /processing_idempotency_conflict/u);
});
test("retry target must match the numeric owner; uncertain and expired attempts expose no CTA", async () => {
  const f = fixture(); f.deps.inspect = async () => ({ numeric_run_id: run, execution_id: execution, can_request: true, source_current: true, retry_available: false, completion: null, replay: null });
  await assert.rejects(requestWorkspaceTopicEditorialForActorV1({ ...access, idempotencyKey: "request-key", body: { action: "retry_editorial", numeric_execution_id: numeric, execution_id: actor } }, f.deps));
  await assert.rejects(requestWorkspaceTopicEditorialForActorV1({ ...access, idempotencyKey: "request-key", body: { action: "retry_editorial", numeric_execution_id: numeric, execution_id: execution } }, f.deps));
  assert.equal(f.calls.includes("retry"), false);
});
test("settled paid work can retry after source/policy/provider drift without granting a new send", async () => {
  const f = fixture();
  f.deps.available = () => false;
  f.deps.inspect = async () => ({ numeric_run_id: run, execution_id: execution, can_request: true, source_current: false,
    retry_available: true, completion: null, replay: null });
  f.deps.status = async () => ({ contract_version: "signal-topic-editorial-status-v1", workspace_id: workspace, status: "failed", execution_id: execution,
    completed_screening_count: 42, expected_screening_count: 42, maximum_micro_usd: "30000000", confirmed_micro_usd: "1000000",
    reserved_micro_usd: "0", ambiguous_micro_usd: "0", provider_execution_enabled: false, error_code: "topic_editorial_state_conflict" });
  const view = await loadWorkspaceTopicEditorialForActorV1({ ...access, numericExecutionId: numeric }, f.deps);
  assert.equal(view.can_retry, true);
  const receipt = await requestWorkspaceTopicEditorialForActorV1({ ...access, idempotencyKey: "recovery-key",
    body: { action: "retry_editorial", numeric_execution_id: numeric, execution_id: execution } }, f.deps);
  assert.equal(receipt.execution_id, execution); assert.equal(f.calls.includes("retry"), true);
});
test("a zero-checkpoint obsolete failed plan offers and authorizes a fresh review for the same numeric run", async () => {
  const f = fixture();
  f.deps.inspect = async () => ({ numeric_run_id: run, execution_id: execution, can_request: true, source_current: true,
    retry_available: false, replacement_available: true, completion: null, replay: null });
  f.deps.status = async () => ({ contract_version: "signal-topic-editorial-status-v1", workspace_id: workspace, status: "failed", execution_id: execution,
    completed_screening_count: 0, expected_screening_count: 42, maximum_micro_usd: "30000000", confirmed_micro_usd: "0",
    reserved_micro_usd: "0", ambiguous_micro_usd: "0", provider_execution_enabled: false, error_code: "topic_editorial_plan_invalid" });
  f.deps.request = async args => { f.calls.push("request"); assert.equal(args.plan, plan);
    return { execution_id: successor, worker_job_id: "private-successor", replayed: false }; };
  const idle = await loadWorkspaceTopicEditorialForActorV1({ ...access, numericExecutionId: numeric }, f.deps);
  assert.equal(idle.status, "not_requested"); assert.equal(idle.execution, null); assert.equal(idle.can_quote, true);
  const quoted = await loadWorkspaceTopicEditorialForActorV1({ ...access, numericExecutionId: numeric, withQuote: true }, f.deps);
  assert.equal(quoted.status, "ready_to_authorize"); assert.equal(quoted.quote?.reference, reference);
  const receipt = await requestWorkspaceTopicEditorialForActorV1({ ...access, idempotencyKey: "successor-key", body: command }, f.deps);
  assert.equal(receipt.execution_id, successor); assert.ok(f.calls.includes("request")); assert.equal(f.calls.includes("retry"), false);
});
test("view validator rejects cross scope, injected secrets, inflated cap and contradictory authorization", () => {
  assert.equal(validWorkspaceTopicEditorialViewV1(ready, workspace, numeric), true);
  for (const value of [{ ...ready, workspace_id: actor }, { ...ready, numeric_execution_id: actor }, { ...ready, provider: "anthropic" },
    { ...ready, quote: { ...quote, maximum_micro_usd: "9223372036854775808" } }, { ...ready, quote: { ...quote, plan } },
    { ...ready, can_retry: true }, { ...ready, quote: null }, { ...ready, quote: { ...quote, expires_at: new Date(now).toISOString() } }])
    assert.equal(validWorkspaceTopicEditorialViewV1(value, workspace, numeric), false);
});
test("encrypted snapshots bind actor/workspace/control/reference and detect tampering", async () => {
  const rows = new Map<string, string>();
  const redis = { get: async (key: string) => rows.get(key) ?? null,
    eval: async (_script: string, _count: number, key: string, _head: string, envelope: string, ttl: number) => { assert.equal(ttl, 900); rows.set(key, envelope); return 1; } };
  const cache = new RedisEditorialQuoteCache(redis as unknown as ConstructorParameters<typeof RedisEditorialQuoteCache>[0], Buffer.alloc(32, 7));
  await cache.put(snapshot); assert.doesNotMatch([...rows.values()].join(), /private corpus|server-plan|actor_user_id/u);
  assert.deepEqual(await cache.get(snapshot, reference), snapshot);
  assert.equal(await cache.get({ ...snapshot, actor_user_id: workspace }, reference), null);
  const [key, raw] = [...rows][0]!; rows.set(key, raw.slice(0, 20) + "!" + raw.slice(21)); assert.equal(await cache.get(snapshot, reference), null);
});
test("encrypted snapshots wait for a cold Redis connection before the first command", async () => {
  const rows = new Map<string, string>(); let release!: () => void, commands = 0;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const redis = { get: async (key: string) => { commands++; return rows.get(key) ?? null; },
    eval: async (_script: string, _count: number, key: string, _head: string, envelope: string) => { commands++; rows.set(key, envelope); return 1; } };
  const cache = new RedisEditorialQuoteCache(redis as unknown as ConstructorParameters<typeof RedisEditorialQuoteCache>[0], Buffer.alloc(32, 7), ready);
  const pending = cache.put(snapshot); await Promise.resolve(); assert.equal(commands, 0);
  release(); await pending; assert.equal(commands, 1); assert.deepEqual(await cache.get(snapshot, reference), snapshot);
});
test("a 17 MB private snapshot issues no Redis write", async () => {
  const redis = { get: async () => null, eval: async () => { throw new Error("oversized Redis command"); } };
  const cache = new RedisEditorialQuoteCache(redis as unknown as ConstructorParameters<typeof RedisEditorialQuoteCache>[0], Buffer.alloc(32, 7));
  const large = { ...snapshot, plan: { ...plan, private_evidence: "x".repeat(17_000_000) } as unknown as SignalTopicEditorialScreeningPlanV1 };
  await cache.put(large);
});
test("Redis error events and abandoned connection failures are handled without transport", async t => {
  const connect = t.mock.method(Redis.prototype, "connect", async () => { throw new Error("synthetic connection failure"); });
  assert.equal(globalThis.noisiaTopicEditorialQuoteRedis, undefined);
  const cache = getEditorialQuoteCacheV1({ REDIS_URL: "redis://unused:6379", NOISIA_SIGNAL_TOPIC_EDITORIAL_QUOTE_KEY: Buffer.alloc(32, 7).toString("base64") });
  const redis = globalThis.noisiaTopicEditorialQuoteRedis!;
  assert.ok(redis.listenerCount("error") > 0);
  assert.doesNotThrow(() => redis.emit("error", new Error("synthetic Redis error")));
  await assert.rejects(cache.get(snapshot, reference), /topic_editorial_cache_unavailable/u);
  getEditorialQuoteCacheV1({ REDIS_URL: "redis://unused:6379", NOISIA_SIGNAL_TOPIC_EDITORIAL_QUOTE_KEY: Buffer.alloc(32, 7).toString("base64") });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(connect.mock.callCount(), 2); assert.equal(globalThis.noisiaTopicEditorialQuoteRedis, undefined);
});
test("uncertain HTTP keeps the original cap/quote/key and checks receipt scope", async () => {
  const intent = workspaceTopicEditorialIntentV1(workspace, command, null, () => "original-key");
  const sameIntent = workspaceTopicEditorialIntentV1(workspace, { ...command }, intent, () => "wrong-key");
  assert.equal(sameIntent, intent);
  const refreshed = workspaceTopicEditorialIntentV1(workspace, { ...command, quote_reference: `v2.1789236010.${"b".repeat(64)}`,
    confirmed_maximum_micro_usd: "500000000" }, intent, () => "refreshed-key");
  assert.equal(refreshed.key, "refreshed-key");
  await assert.rejects(submitWorkspaceTopicEditorialIntentV1(intent, async () => new Response("{}", { status: 503 })), (e: unknown) => e instanceof WorkspaceTopicEditorialRequestError && !e.quoteRejected);
  await assert.rejects(submitWorkspaceTopicEditorialIntentV1(intent, async () => new Response(JSON.stringify({ error: "topic_editorial_quote_expired" }), { status: 409 })),
    (e: unknown) => e instanceof WorkspaceTopicEditorialRequestError && e.quoteRejected);
  const result = { contract_version: "workspace-topic-editorial-receipt-v1", workspace_id: workspace, numeric_execution_id: numeric, execution_id: execution,
    action: command.action, idempotency_key: intent.key, replayed: true, activation: "not_activated" };
  assert.deepEqual(await submitWorkspaceTopicEditorialIntentV1(intent, async (_url, init) => {
    assert.equal((init?.headers as Record<string, string>)["Idempotency-Key"], intent.key); assert.deepEqual(JSON.parse(String(init?.body)), command);
    return Response.json(result);
  }), result);
  await assert.rejects(submitWorkspaceTopicEditorialIntentV1(intent, async () => Response.json({ ...result, workspace_id: actor })));
});
test("single-action start retains its idempotency key after an uncertain response", async () => {
  const body = { action: "start_editorial" as const, numeric_execution_id: numeric };
  const intent = workspaceTopicEditorialIntentV1(workspace, body, null, () => "start-key-001");
  assert.equal(workspaceTopicEditorialIntentV1(workspace, body, intent, () => "new-start-key"), intent);
  const result = { contract_version: "workspace-topic-editorial-receipt-v1", workspace_id: workspace,
    numeric_execution_id: numeric, execution_id: execution, action: body.action, idempotency_key: intent.key,
    replayed: true, activation: "not_activated" };
  assert.deepEqual(await submitWorkspaceTopicEditorialIntentV1(intent, async (_url, init) => {
    assert.equal((init?.headers as Record<string, string>)["Idempotency-Key"], "start-key-001");
    assert.deepEqual(JSON.parse(String(init?.body)), body); return Response.json(result);
  }), result);
});

test("saved editorial outcome pages validate execution scope, phase and bounded cited evidence", () => {
  const decision = { disposition: "topic", label: "Setup friction", definition: "Customers describe difficulty setting up the device.",
    locale: "en", rationale: "Several comments describe setup difficulty.", confidence: 0.92, source: "sonnet-4-6",
    digest: "digest-1", cited_evidence_refs: ["mention-1"] };
  const page = { contract_version: "workspace-topic-editorial-outcomes-page-v2", workspace_id: workspace,
    numeric_execution_id: numeric, execution_id: execution, revision_status: "validated", offset: 0, limit: 20, total: 2,
    items: [
      { group_key: "open:cluster-7", outcome: "topic", phase: "consolidated", decision,
        technical_error_code: null, transport_state: null,
        evidence: [{ id: "mention-1", root_id: mentionRoot, text: "Setup did not work for me.", source: "review", kind: "cited" }] },
      { group_key: "open:cluster-8", outcome: "pending", phase: "pending", decision: null,
        technical_error_code: null, transport_state: "not_submitted",
        evidence: [{ id: actor, root_id: actor, text: "A source group example.", source: "review", kind: "representative" }] }
    ] };
  const parsed = parseWorkspaceTopicEditorialOutcomesPageV2(page, { workspaceId: workspace, numericExecutionId: numeric,
    executionId: execution, offset: 0 });
  assert.equal(parsed?.items[0]?.outcome, "topic"); assert.equal(parsed?.items[0]?.phase, "consolidated");
  assert.equal(parsed?.items[1]?.outcome, "pending"); assert.equal(parsed?.items[1]?.decision, null);
  assert.equal(parsed?.items[1]?.evidence[0]?.kind, "representative");
  assert.equal(parsed?.items[0]?.evidence[0]?.root_id, mentionRoot);
  assert.equal(parseWorkspaceTopicEditorialOutcomesPageV2(page, { workspaceId: actor, numericExecutionId: numeric,
    executionId: execution, offset: 0 }), null);
  assert.equal(parseWorkspaceTopicEditorialOutcomesPageV2({ ...page, items: [{ ...page.items[0],
    evidence: [{ id: "1", text: null, source: null, kind: "representative" }, { id: "2", text: null, source: null, kind: "representative" },
      { id: "3", text: null, source: null, kind: "representative" }] }] },
  { workspaceId: workspace, numericExecutionId: numeric, executionId: execution, offset: 0 }), null);
  assert.equal(parseWorkspaceTopicEditorialOutcomesPageV2({ ...page, revision: "private-field" }, { workspaceId: workspace,
    numericExecutionId: numeric, executionId: execution, offset: 0 }), null);
  assert.equal(parseWorkspaceTopicEditorialOutcomesPageV2({ ...page, items: [{ ...page.items[1], outcome: "technical",
    decision, evidence: [] }] }, { workspaceId: workspace, numericExecutionId: numeric, executionId: execution, offset: 0 }), null);
  assert.equal(parseWorkspaceTopicEditorialOutcomesPageV2({ ...page, items: [{ ...page.items[0],
    evidence: [{ ...page.items[0]!.evidence[0], root_id: "not-a-uuid" }] }] }, { workspaceId: workspace,
    numericExecutionId: numeric, executionId: execution, offset: 0 }), null);
});

for (const locale of ["es-MX", "en-US"] as const) test(`${locale}: saved group outcomes are opt-in and pending is clearly not a decision`, async () => {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale, messages, timeZone: "America/Mexico_City" } as ComponentProps<typeof NextIntlClientProvider>,
    createElement(WorkspaceTopicEditorialOutcomes, { workspaceId: workspace, numericExecutionId: numeric, executionId: execution,
      mentionsHref: "/signal/alexa/mentions" })));
  assert.match(html, /aria-expanded="false"/u);
  assert.match(html, locale === "es-MX" ? /Ver resultados guardados/u : /View saved outcomes/u);
  assert.match(html, locale === "es-MX" ? /Los grupos pendientes aún no tienen una decisión editorial/u : /Pending groups do not yet have an editorial decision/u);
  assert.doesNotMatch(html, /<blockquote/u);
});
for (const locale of ["es-MX", "en-US"] as const) test(`${locale}: one start action uses policy without a per-run quote or confirmation`, async () => {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  const render = (props: Partial<ComponentProps<typeof WorkspaceTopicEditorialCard>> = {}) => renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale, messages, timeZone: "America/Mexico_City" } as ComponentProps<typeof NextIntlClientProvider>, createElement(WorkspaceTopicEditorialCard,
      { value: ready, onStart: () => {}, ...props })));
  const html = render(); assert.doesNotMatch(html, /type="checkbox"|30\.00|cotización editorial|editorial quote/iu);
  assert.match(html, /(Iniciar revisión editorial|Start editorial review)/u);
  assert.doesNotMatch(render({ stale: true }), /(Iniciar revisión editorial|Start editorial review)/u);
});
for (const locale of ["es-MX", "en-US"] as const) test(`${locale}: an expired partial review cannot offer a futile retry before renewal`, async () => {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  const stopped: WorkspaceTopicEditorialViewV1 = { ...ready, status: "failed", can_quote: false, can_retry: true,
    quote: null, execution: { execution_id: execution, status: "failed", completed_screening_count: 2,
      expected_screening_count: 42, maximum_micro_usd: "30000000", confirmed_micro_usd: "1585632",
      reserved_micro_usd: "0", ambiguous_micro_usd: "0" } };
  const render = (retryReady: boolean) => renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale, messages, timeZone: "America/Mexico_City" } as ComponentProps<typeof NextIntlClientProvider>,
    createElement(WorkspaceTopicEditorialCard, { value: stopped, retryReady, onRetry: () => {} })));
  assert.doesNotMatch(render(false), /<(?:button)[^>]*>[^<]*(?:Reanudar|Resume)/u);
  assert.match(render(true), /<(?:button)[^>]*>[^<]*(?:Reanudar|Resume)/u);
});
test("route authenticates first, forbids injected query data, and controls fence after JSON awaits", async () => {
  const route = await readFile(new URL("../../app/api/data-os/signal/[workspaceId]/topics/consolidation/editorial/route.ts", import.meta.url), "utf8");
  const batchControl = await readFile(new URL("./signal-topic-editorial-batch-control-v2.ts", import.meta.url), "utf8");
  assert.ok(route.indexOf("loadSignalWorkspaceContextForTopics(workspaceId)") < route.indexOf("request.json()"));
  assert.match(route, /query\.getAll\(key\)\.length !== 1/u);
  assert.match(batchControl,
    /authorizeWorkspaceTopicEditorialBatchV2ForActor[\s\S]*?if\(replay\.replayed\)[\s\S]*?if\(args\.runtimeEnabled===false\)/u);
  assert.match(route, /view\.execution&&!predecessorEligible\)return topicResponse\(view\)/u);
  assert.match(batchControl, /canSupersedeFailedLegacyEditorialWithBatchV2ForActor/u);
  assert.match(batchControl, /e\.status='failed'[\s\S]*e\.execution_token IS NULL[\s\S]*c\.status NOT IN\('settled','definitely_not_sent'\)[\s\S]*o\.status IN\('queued','dispatching'\)/u);
  const ui = await readFile(new URL("../../components/brands/WorkspaceTopicEditorialCard.tsx", import.meta.url), "utf8");
  assert.match(ui, /await response\.json\(\);\s*if \(controller\.signal\.aborted \|\| current\.current !== scope\) return/u);
  assert.match(ui, /submitController\.current\?\.abort\(\)/u); assert.doesNotMatch(ui, /activateSignal|materializeSignal|ANTHROPIC_API_KEY/u);
});

for (const locale of ["es-MX", "en-US"] as const) test(`${locale}: a quiescent failed V1 review is clearly offered as a V2 successor`, async () => {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  const successorView: WorkspaceTopicEditorialViewV1 = { ...ready, status: "not_requested", can_quote: true,
    quote: null, execution: null, replaces_failed_v1: true };
  assert.equal(validWorkspaceTopicEditorialViewV1(successorView, workspace, numeric), true);
  assert.equal(validWorkspaceTopicEditorialViewV1({ ...successorView, replaces_failed_v1: false }, workspace, numeric), false);
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale, messages, timeZone: "America/Mexico_City" } as ComponentProps<typeof NextIntlClientProvider>,
    createElement(WorkspaceTopicEditorialCard, { value: successorView, onStart: () => {} })));
  assert.match(html, locale === "es-MX" ? /La revisión anterior quedó detenida/u : /The previous review stopped/u);
  assert.match(html, locale === "es-MX" ? /Iniciar revisión editorial/u : /Start editorial review/u);
  assert.doesNotMatch(html, /Reanudar la misma revisión|Resume the same review/u);
});

for (const locale of ["es-MX", "en-US"] as const) test(`${locale}: Batch progress keeps semantic outcomes and technical errors separate and explains resume`, async () => {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  const running: WorkspaceTopicEditorialViewV1 = { ...ready, status: "running", can_quote: false, can_retry: false,
    quote: null, execution: { execution_id: execution, status: "running", completed_screening_count: 4,
      expected_screening_count: 5, maximum_micro_usd: "1000000000", confirmed_micro_usd: "1000",
      reserved_micro_usd: "250", ambiguous_micro_usd: "0" },
    batch_progress: { topics: 1, narratives: 1, noise: 1, insufficient_evidence: 0, technical_errors: 1,
      pending: 1, batch_states: { running: 1, prepared: 1 }, error_codes: ["topic_editorial_v2_output_invalid"] } };
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale, messages, timeZone: "America/Mexico_City" } as ComponentProps<typeof NextIntlClientProvider>,
    createElement(WorkspaceTopicEditorialCard, { value: running, workspaceId: workspace, numericExecutionId: numeric,
      mentionsHref: "/signal/alexa/mentions", onRefresh: () => {} })));
  assert.match(html, /topic_editorial_v2_output_invalid/u);
  assert.match(html, locale === "es-MX" ? /Narrativas/u : /Narratives/u);
  assert.match(html, locale === "es-MX" ? /Evidencia insuficiente/u : /Insufficient evidence/u);
  assert.match(html, locale === "es-MX" ? /Errores técnicos/u : /Technical errors/u);
  assert.match(html, locale === "es-MX" ? /manifiestos y resultados guardados/u : /saved manifests and results/u);
  assert.match(html, locale === "es-MX" ? /Ver cribado anterior/u : /View previous screening/u,
    "current V2 batch progress must not hide the read-only V1 history browser");
});

test("free completion derives immutable state/census and replays with provider/cache disabled", async () => {
  const f = fixture(); f.deps.available = () => false; f.deps.cache = () => { throw new Error("no cache"); };
  f.deps.inspect = async () => ({ numeric_run_id: run, execution_id: execution, can_request: true, source_current: false,
    retry_available: false, replay: null, completion: { available: true, completed: false } });
  let completions = 0;
  f.deps.complete = async args => {
    assert.equal(args.execution_id, execution); assert.equal(args.workspace_id, workspace); assert.equal(args.actor_user_id, actor);
    assert.equal("expected_state_digest" in args, false); assert.equal("plan" in args, false);
    return { contract_version: "signal-topic-editorial-materialization-v1", execution_id: execution, revision_id: actor, revision: 1, status: "completed",
      concept_count: 32, decision_count: 1652, topic_count: 24, narrative_count: 8, noise_count: 12, unresolved_count: 3,
      target_range_met: true, activation: "not_activated", replayed: completions++ > 0 };
  };
  const body = { action: "complete_catalog", execution_id: execution, numeric_execution_id: numeric };
  const result = await requestWorkspaceTopicEditorialForActorV1({ ...access, idempotencyKey: "complete-key", body }, f.deps);
  assert.equal(result.action, "complete_catalog"); assert.equal(result.activation, "not_activated");
  assert.equal((await requestWorkspaceTopicEditorialForActorV1({ ...access, idempotencyKey: "complete-key", body }, f.deps)).replayed, true);
  assert.deepEqual(f.calls, []);
  assert.equal(parseWorkspaceTopicEditorialCommandV1({ ...body, expected_state_digest: "client-digest" }), null);
  f.deps.inspect = async () => ({ numeric_run_id: run, execution_id: execution, can_request: true, source_current: true,
    retry_available: false, replay: null, completion: { available: false, completed: false } });
  await assert.rejects(requestWorkspaceTopicEditorialForActorV1({ ...access, idempotencyKey: "complete-key", body }, f.deps), /completion_unavailable/u);
  assert.equal(completions, 2);
});

test("scoped metadata enforces read permission before resolving a numeric owner", async () => {
  const queries: string[] = [];
  const database = { connect: async () => ({ query: async (sql: string, params?: unknown[]) => {
    queries.push(sql);
    if (sql.includes("workspace_status")) {
      assert.deepEqual(params, [workspace, actor]);
      return { rows: [{ workspace_status: "active", brand_status: "active", actor_status: "active", user_type: "client", primary_role: "client_admin",
        same_organization: false, brand_access_level: "admin", organization_status: "active", brand_same_organization: true }] };
    }
    return { rows: [] };
  }, release: () => {} }) } as unknown as import("pg").Pool;
  await assert.rejects(loadWorkspaceTopicEditorialForActorV1({ ...access, database, numericExecutionId: numeric }), /processing_forbidden/u);
  assert.ok(queries.includes("ROLLBACK")); assert.equal(queries.some(sql => sql.includes("signal_topic_consolidation_executions n")), false);
});

test("a concurrently committed owner rejects a second intent before cache or admission", async () => {
  const f = fixture(); f.deps.inspect = async () => ({ numeric_run_id: run, execution_id: execution, can_request: true, source_current: true,
    retry_available: false, completion: null, replay: null });
  await assert.rejects(requestWorkspaceTopicEditorialForActorV1({ ...access, idempotencyKey: "another-key", body: command }, f.deps), /topic_editorial_existing_execution/u);
  assert.deepEqual(f.calls, []);
});
