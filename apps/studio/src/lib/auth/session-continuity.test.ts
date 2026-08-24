import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

process.env.DATABASE_URL ??= "postgres://unit:test@localhost:5432/noisia_test";

import { unauthorized } from "@/lib/api/responses";
import {
  handleKindeSessionRefresh,
  isTerminalKindeCallbackError,
  type KindeRefreshAttemptResult,
  type SessionRefreshSdk
} from "@/lib/auth/session-continuity";
import { createKindeSessionRefreshRoute } from "@/lib/auth/kinde-session-refresh-route";
import {
  classifyKindeAccessToken,
  resolveKindeSessionSnapshot
} from "@/lib/auth/session-lifecycle";
import {
  deriveSessionRefreshBarrierKey,
  resolveSessionRefreshBarrierTtlMs,
  type SessionRefreshBarrier,
  type SessionRefreshBarrierAcquireResult,
  type SessionRefreshBarrierRecord
} from "@/lib/auth/session-refresh-barrier";
import { RedisSessionRefreshBarrier } from "@/lib/auth/session-refresh-redis";
import { loginPath, safeSessionReturnPath, sessionRefreshPath } from "@/lib/auth/redirects";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const STUDIO_ROOT = resolve(TEST_DIR, "../../..");
const REPO_ROOT = resolve(STUDIO_ROOT, "../..");

class MemoryBarrier implements SessionRefreshBarrier {
  records = new Map<string, SessionRefreshBarrierRecord>();
  transitionAttempts = 0;
  outage = false;
  transitionFailure = false;

  async acquire(input: {
    key: string;
    owner: string;
    ttl_ms: number;
    now_iso: string;
  }): Promise<SessionRefreshBarrierAcquireResult> {
    if (this.outage) throw new Error("redis unavailable");
    const existing = this.records.get(input.key);
    if (existing) return { acquired: false, record: existing };
    const record: SessionRefreshBarrierRecord = {
      state: "started",
      owner: input.owner,
      updated_at: input.now_iso
    };
    this.records.set(input.key, record);
    return { acquired: true, record };
  }

  async read(key: string) {
    if (this.outage) throw new Error("redis unavailable");
    return this.records.get(key) ?? null;
  }

  async transition(input: {
    key: string;
    owner: string;
    state: "rotated" | "failed" | "ambiguous";
    ttl_ms: number;
    now_iso: string;
  }) {
    if (this.outage) throw new Error("redis unavailable");
    this.transitionAttempts += 1;
    if (this.transitionFailure) return false;
    const existing = this.records.get(input.key);
    if (!existing || existing.owner !== input.owner || existing.state !== "started") return false;
    this.records.set(input.key, {
      state: input.state,
      owner: input.owner,
      updated_at: input.now_iso
    });
    return true;
  }
}

function jwt(exp: number) {
  const segment = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${segment({ alg: "none" })}.${segment({ exp })}.signature`;
}

function request(next = "/studio/brands") {
  return new Request(`https://studio.example.test/auth/session/refresh?next=${encodeURIComponent(next)}`, {
    headers: {
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document"
    }
  });
}

function dependencies(input?: {
  barrier?: MemoryBarrier;
  refresh?: () => Promise<KindeRefreshAttemptResult>;
  raw?: string | null;
}) {
  let owner = 0;
  return {
    sdk: {
      async getAccessTokenRaw() {
        return input?.raw === undefined ? jwt(1) : input.raw;
      },
      async refreshTokens() {
        return input?.refresh ? input.refresh() : "rotated" as const;
      }
    } satisfies SessionRefreshSdk,
    barrier: input?.barrier ?? new MemoryBarrier(),
    derive_barrier_key: (raw: string) => deriveSessionRefreshBarrierKey({
      raw_access_token: raw,
      hmac_key: "unit-test-only-key",
      environment_namespace: "test"
    }),
    create_owner: () => `owner-${owner += 1}`,
    now: () => new Date("2026-08-24T00:00:00.000Z"),
    sleep: async () => new Promise<void>((resolve) => setTimeout(resolve, 1)),
    ttl_ms: 60_000,
    max_polls: 100,
    poll_interval_ms: 0
  };
}

test("classifies the four Kinde access-token lifecycle states without granting authentication", () => {
  assert.equal(classifyKindeAccessToken(null, 100), "unauthenticated");
  assert.equal(classifyKindeAccessToken("not-a-jwt", 100), "malformed");
  assert.equal(classifyKindeAccessToken(jwt(100), 100), "refresh_required");
  assert.equal(classifyKindeAccessToken(jwt(130), 100), "refresh_required");
  assert.equal(classifyKindeAccessToken(jwt(131), 100), "valid");
});

test("sanitizes refresh destinations and prevents auth loops", () => {
  assert.equal(safeSessionReturnPath("https://evil.example", "/studio"), "/studio");
  assert.equal(safeSessionReturnPath("//evil.example", "/studio"), "/studio");
  assert.equal(safeSessionReturnPath("/api/private", "/studio"), "/studio");
  assert.equal(safeSessionReturnPath("/api", "/studio"), "/studio");
  assert.equal(safeSessionReturnPath("/api/auth", "/studio"), "/studio");
  assert.equal(safeSessionReturnPath("/API", "/studio"), "/studio");
  assert.equal(safeSessionReturnPath("/AUTH/session/refresh", "/studio"), "/studio");
  assert.equal(safeSessionReturnPath("/%41PI", "/studio"), "/studio");
  assert.equal(safeSessionReturnPath("/%2541UTH/session/refresh", "/studio"), "/studio");
  assert.equal(safeSessionReturnPath("/%254cOGIN", "/studio"), "/studio");
  assert.equal(safeSessionReturnPath("/auth/session/refresh", "/studio"), "/studio");
  assert.equal(safeSessionReturnPath("/auth?next=/studio", "/studio"), "/studio");
  assert.equal(safeSessionReturnPath("/auth#fragment", "/studio"), "/studio");
  assert.equal(safeSessionReturnPath("/api?scope=private", "/studio"), "/studio");
  assert.equal(safeSessionReturnPath("/api/auth?next=/studio", "/studio"), "/studio");
  assert.equal(safeSessionReturnPath("/login?next=/studio", "/studio"), "/studio");
  assert.equal(safeSessionReturnPath("/login#fragment", "/studio"), "/studio");
  assert.equal(safeSessionReturnPath("/studio/../auth/session/refresh", "/studio"), "/studio");
  assert.equal(safeSessionReturnPath("/studio/%2e%2e/auth/session/refresh", "/studio"), "/studio");
  assert.equal(safeSessionReturnPath("/studio/%2E%2e/auth?next=/studio", "/studio"), "/studio");
  assert.equal(safeSessionReturnPath("/studio/%252e%252e/auth/session/refresh", "/studio"), "/studio");
  assert.equal(safeSessionReturnPath("/studio/%252E%252e/api?next=/studio", "/studio"), "/studio");
  assert.equal(safeSessionReturnPath("/api/auth/logout", "/studio"), "/studio");
  assert.equal(safeSessionReturnPath("/studio\\evil", "/studio"), "/studio");
  assert.equal(safeSessionReturnPath("/studio\nevil", "/studio"), "/studio");
  assert.equal(safeSessionReturnPath("/studio\u007fevil", "/studio"), "/studio");
  assert.equal(
    safeSessionReturnPath("/studio/brands?tab=data&scope=primary", "/studio"),
    "/studio/brands?tab=data&scope=primary"
  );
  assert.equal(
    safeSessionReturnPath("/portal?report=current#overview", "/studio"),
    "/portal?report=current#overview"
  );
  assert.equal(sessionRefreshPath("/studio/brands?tab=data"), "/auth/session/refresh?next=%2Fstudio%2Fbrands%3Ftab%3Ddata");
});

test("one token snapshot decides refresh before Kinde validation and never grants identity from parsing", async () => {
  let reads = 0;
  let authentications = 0;
  const beforeThreshold = await resolveKindeSessionSnapshot({
    read_raw_access_token: async () => {
      reads += 1;
      return jwt(130);
    },
    authenticate_valid_snapshot: async () => {
      authentications += 1;
      return null;
    },
    now_epoch_seconds: 99
  });
  assert.deepEqual(beforeThreshold, { lifecycle: "unauthenticated", session: null });
  assert.equal(reads, 1);
  assert.equal(authentications, 1);

  reads = 0;
  authentications = 0;
  const crossedThreshold = await resolveKindeSessionSnapshot({
    read_raw_access_token: async () => {
      reads += 1;
      return jwt(130);
    },
    authenticate_valid_snapshot: async () => {
      authentications += 1;
      return { unsafe: "must-not-be-granted" };
    },
    now_epoch_seconds: 100
  });
  assert.deepEqual(crossedThreshold, { lifecycle: "refresh_required", session: null });
  assert.equal(reads, 1);
  assert.equal(authentications, 0);
});

test("valid, missing, and malformed tokens never invoke refresh", async () => {
  for (const [raw, expectedLocation] of [
    [jwt(Math.floor(Date.now() / 1_000) + 300), "/studio/brands"],
    [null, "/api/auth/login"],
    ["broken", "/api/auth/login"]
  ] as const) {
    let calls = 0;
    const response = await handleKindeSessionRefresh(request(), dependencies({
      raw,
      refresh: async () => {
        calls += 1;
        return "rotated";
      }
    }));
    assert.equal(response.status, 303);
    assert.match(response.headers.get("location") ?? "", new RegExp(expectedLocation));
    assert.equal(calls, 0);
  }
});

test("accepts only explicit same-origin document navigations before reading tokens", async () => {
  const rejectedHeaders: HeadersInit[] = [
    {},
    { "sec-fetch-site": "none", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
    { "sec-fetch-site": "same-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
    { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
    { "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" }
  ];
  for (const headers of rejectedHeaders) {
    let reads = 0;
    const deps = dependencies();
    deps.sdk.getAccessTokenRaw = async () => {
      reads += 1;
      return jwt(1);
    };
    const response = await handleKindeSessionRefresh(
      new Request("https://studio.example.test/auth/session/refresh", { headers }),
      deps
    );
    assert.equal(response.status, 403);
    assert.equal(reads, 0);
  }
});

test("token state read failure is fail-closed and never invokes refresh", async () => {
  let calls = 0;
  const deps = dependencies({
    refresh: async () => {
      calls += 1;
      return "rotated";
    }
  });
  deps.sdk.getAccessTokenRaw = async () => {
    throw new Error("cookie store unavailable");
  };
  const response = await handleKindeSessionRefresh(request(), deps);
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error, "session_state_unavailable");
  assert.equal(calls, 0);
});

test("distinct owner and waiter responses never transfer the owner's cookie commitment", async () => {
  const barrier = new MemoryBarrier();
  let calls = 0;
  const ownerCookies: string[] = [];
  const waiterCookies: string[] = [];
  let started!: () => void;
  const providerStarted = new Promise<void>((resolve) => { started = resolve; });
  let release!: () => void;
  const providerGate = new Promise<void>((resolve) => { release = resolve; });
  const owner = dependencies({
    barrier,
    refresh: async () => {
      calls += 1;
      started();
      await providerGate;
      ownerCookies.push("owner-only-cookie-commitment");
      return "rotated" as const;
    }
  });
  const waiter = dependencies({
    barrier,
    refresh: async () => {
      waiterCookies.push("unexpected-waiter-cookie-commitment");
      calls += 1;
      return "rotated" as const;
    }
  });

  const ownerResponsePromise = handleKindeSessionRefresh(request(), owner);
  await providerStarted;
  const waiterResponsePromise = handleKindeSessionRefresh(request(), waiter);
  release();
  const [ownerResponse, waiterResponse] = await Promise.all([
    ownerResponsePromise,
    waiterResponsePromise
  ]);

  assert.equal(calls, 1);
  assert.deepEqual(ownerCookies, ["owner-only-cookie-commitment"]);
  assert.deepEqual(waiterCookies, []);
  assert.equal(ownerResponse.status, 303);
  assert.equal(ownerResponse.headers.get("location"), "/studio/brands");
  assert.equal(waiterResponse.status, 503);
  assert.equal(waiterResponse.headers.get("location"), null);
  assert.equal((await waiterResponse.json()).error, "session_refresh_cookie_commit_pending");
});

test("terminal concurrency matrix performs one exchange and exact owner/waiter/replay outcomes", async () => {
  const matrix = [
    {
      outcome: "rotated" as const,
      owner: { status: 303, location: "/studio/brands", error: null },
      waiter: { status: 503, location: null, error: "session_refresh_cookie_commit_pending" },
      replay: { status: 503, location: null, error: "session_refresh_cookie_commit_pending" }
    },
    {
      outcome: "failed" as const,
      owner: { status: 303, location: loginPath("/studio/brands"), error: null },
      waiter: { status: 303, location: loginPath("/studio/brands"), error: null },
      replay: { status: 303, location: loginPath("/studio/brands"), error: null }
    },
    {
      outcome: "ambiguous" as const,
      owner: { status: 503, location: null, error: "session_refresh_result_ambiguous" },
      waiter: { status: 503, location: null, error: "session_refresh_result_ambiguous" },
      replay: { status: 503, location: null, error: "session_refresh_result_ambiguous" }
    }
  ];

  const summarize = async (response: Response) => {
    const body = response.headers.get("content-type")?.includes("application/json")
      ? await response.clone().json() as { error?: unknown }
      : null;
    return {
      status: response.status,
      location: response.headers.get("location"),
      error: typeof body?.error === "string" ? body.error : null
    };
  };

  for (const row of matrix) {
    const barrier = new MemoryBarrier();
    let calls = 0;
    let started!: () => void;
    const providerStarted = new Promise<void>((resolve) => { started = resolve; });
    let release!: () => void;
    const providerGate = new Promise<void>((resolve) => { release = resolve; });
    const owner = dependencies({
      barrier,
      refresh: async () => {
        calls += 1;
        started();
        await providerGate;
        return row.outcome;
      }
    });
    const waiter = dependencies({
      barrier,
      refresh: async () => {
        calls += 1;
        throw new Error("waiter must never exchange");
      }
    });
    const ownerPromise = handleKindeSessionRefresh(request(), owner);
    await providerStarted;
    const waiterPromise = handleKindeSessionRefresh(request(), waiter);
    release();
    const [ownerResponse, waiterResponse] = await Promise.all([ownerPromise, waiterPromise]);
    const replayResponse = await handleKindeSessionRefresh(request(), waiter);

    assert.equal(calls, 1, `${row.outcome} must perform exactly one exchange`);
    assert.deepEqual(await summarize(ownerResponse), row.owner);
    assert.deepEqual(await summarize(waiterResponse), row.waiter);
    assert.deepEqual(await summarize(replayResponse), row.replay);
    assert.equal([...barrier.records.values()][0]?.state, row.outcome);
  }
});

test("fifty concurrent requests across two dependency instances perform one rotation", async () => {
  const barrier = new MemoryBarrier();
  let calls = 0;
  let release!: () => void;
  const providerGate = new Promise<void>((resolve) => { release = resolve; });
  const refresh = async () => {
    calls += 1;
    await providerGate;
    return "rotated" as const;
  };
  const replicaA = dependencies({ barrier, refresh });
  const replicaB = dependencies({ barrier, refresh });
  const responses = Array.from({ length: 50 }, (_, index) =>
    handleKindeSessionRefresh(request(), index % 2 === 0 ? replicaA : replicaB)
  );
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const completed = await Promise.all(responses);
  assert.equal(calls, 1);
  assert.equal(completed.filter((response) => response.status === 303).length, 1);
  assert.equal(completed.filter((response) => response.status === 503).length, 49);
  assert.equal(
    completed.filter((response) => response.headers.get("location") === "/studio/brands").length,
    1
  );
});

test("owner-only transitions preserve terminal and ambiguous states", async () => {
  for (const outcome of ["failed", "ambiguous"] as const) {
    const barrier = new MemoryBarrier();
    const response = await handleKindeSessionRefresh(request(), dependencies({
      barrier,
      refresh: async () => outcome
    }));
    const record = [...barrier.records.values()][0];
    assert.ok(record);
    assert.equal(record.state, outcome);
    assert.equal(barrier.transitionAttempts, 1);
    assert.equal(response.status, outcome === "failed" ? 303 : 503);
  }

  const barrier = new MemoryBarrier();
  await barrier.acquire({ key: "key", owner: "owner-a", ttl_ms: 60_000, now_iso: "now" });
  assert.equal(await barrier.transition({
    key: "key",
    owner: "owner-b",
    state: "rotated",
    ttl_ms: 60_000,
    now_iso: "later"
  }), false);
  assert.equal((await barrier.read("key"))?.state, "started");
});

test("SDK success followed by a failed barrier transition remains ambiguous and replay never rotates twice", async () => {
  const barrier = new MemoryBarrier();
  barrier.transitionFailure = true;
  let calls = 0;
  const deps = dependencies({
    barrier,
    refresh: async () => {
      calls += 1;
      return "rotated";
    }
  });
  deps.max_polls = 2;

  const first = await handleKindeSessionRefresh(request(), deps);
  assert.equal(first.status, 503);
  assert.equal((await first.json()).error, "session_refresh_result_ambiguous");
  assert.equal(calls, 1);
  assert.equal([...barrier.records.values()][0]?.state, "started");

  const replay = await handleKindeSessionRefresh(request(), deps);
  assert.equal(replay.status, 503);
  assert.equal((await replay.json()).error, "session_refresh_in_progress");
  assert.equal(calls, 1);
});

test("lost owner response leaves retained replay fail-closed and never invokes refresh twice", async () => {
  const barrier = new MemoryBarrier();
  let calls = 0;
  const deps = dependencies({
    barrier,
    refresh: async () => {
      calls += 1;
      return "rotated";
    }
  });
  const lostOwnerResponse = await handleKindeSessionRefresh(request(), deps);
  const replay = await handleKindeSessionRefresh(request(), deps);
  assert.equal(lostOwnerResponse.status, 303);
  assert.equal(replay.status, 503);
  assert.equal(replay.headers.get("location"), null);
  assert.equal((await replay.json()).error, "session_refresh_cookie_commit_pending");
  assert.equal(calls, 1);
});

test("exact refresh route factory rejects unsafe Fetch Metadata with zero dependency calls", async () => {
  const calls = { kinde: 0, configuration: 0, redis: 0 };
  const GET = createKindeSessionRefreshRoute({
    async create_sdk() {
      calls.kinde += 1;
      return dependencies().sdk;
    },
    resolve_configuration() {
      calls.configuration += 1;
      return {
        derive_barrier_key: () => "not-used",
        ttl_ms: 60_000
      };
    },
    create_barrier() {
      calls.redis += 1;
      return new MemoryBarrier();
    },
    create_owner: () => "not-used",
    now: () => new Date("2026-08-24T00:00:00.000Z"),
    sleep: async () => undefined
  });
  const rejectedHeaders: HeadersInit[] = [
    {},
    { "sec-fetch-site": "same-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
    { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
    { "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" }
  ];
  for (const headers of rejectedHeaders) {
    const response = await GET(new Request("https://studio.example.test/auth/session/refresh", {
      headers
    }));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "cross_site_session_refresh_rejected");
  }
  assert.deepEqual(calls, { kinde: 0, configuration: 0, redis: 0 });

  const routeSource = await readFile(
    resolve(STUDIO_ROOT, "src/app/auth/session/refresh/route.ts"),
    "utf8"
  );
  assert.match(routeSource, /export const GET = createKindeSessionRefreshRoute\(\{/);
});

test("Redis adapter uses NX acquisition, owner-checked transitions, and retained TTL", async () => {
  const values = new Map<string, string>();
  const setCalls: unknown[][] = [];
  const fakeRedis = {
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async set(...args: unknown[]) {
      setCalls.push(args);
      const [key, value, , , mode] = args as [string, string, string, number, string];
      if (mode === "NX" && values.has(key)) return null;
      values.set(key, value);
      return "OK";
    },
    async eval(_script: string, _keys: number, key: string, owner: string, next: string) {
      const current = JSON.parse(values.get(key) ?? "null") as SessionRefreshBarrierRecord | null;
      if (!current || current.owner !== owner || current.state !== "started") return 0;
      values.set(key, next);
      return 1;
    }
  };
  const barrier = new RedisSessionRefreshBarrier(fakeRedis as never);
  const first = await barrier.acquire({
    key: "fingerprint-key",
    owner: "owner-a",
    ttl_ms: 120_000,
    now_iso: "2026-08-24T00:00:00.000Z"
  });
  const second = await barrier.acquire({
    key: "fingerprint-key",
    owner: "owner-b",
    ttl_ms: 120_000,
    now_iso: "2026-08-24T00:00:01.000Z"
  });
  assert.equal(first.acquired, true);
  assert.equal(second.acquired, false);
  assert.equal(second.record.owner, "owner-a");
  assert.deepEqual(setCalls[0]?.slice(2), ["PX", 120_000, "NX"]);
  assert.equal(await barrier.transition({
    key: "fingerprint-key",
    owner: "owner-b",
    state: "rotated",
    ttl_ms: 120_000,
    now_iso: "2026-08-24T00:00:02.000Z"
  }), false);
  assert.equal(await barrier.transition({
    key: "fingerprint-key",
    owner: "owner-a",
    state: "rotated",
    ttl_ms: 120_000,
    now_iso: "2026-08-24T00:00:03.000Z"
  }), true);
  assert.equal((await barrier.read("fingerprint-key"))?.state, "rotated");
});

test("Redis coordination outage fails closed without provider calls", async () => {
  const barrier = new MemoryBarrier();
  barrier.outage = true;
  let calls = 0;
  const response = await handleKindeSessionRefresh(request(), dependencies({
    barrier,
    refresh: async () => {
      calls += 1;
      return "rotated";
    }
  }));
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
});

test("barrier key is deterministic, namespaced, and contains no raw token", () => {
  const raw = jwt(1);
  const first = deriveSessionRefreshBarrierKey({
    raw_access_token: raw,
    hmac_key: "test-key",
    environment_namespace: "Preview/UAT"
  });
  const second = deriveSessionRefreshBarrierKey({
    raw_access_token: raw,
    hmac_key: "test-key",
    environment_namespace: "Preview/UAT"
  });
  assert.equal(first, second);
  assert.match(first, /^noisia:kinde-session-refresh:preview-uat:[a-f0-9]{64}$/);
  assert.equal(first.includes(raw), false);
  assert.equal(resolveSessionRefreshBarrierTtlMs("30"), 900_000);
  assert.equal(resolveSessionRefreshBarrierTtlMs("120"), 120_000);
});

test("API 401 is private JSON with explicit safe replay metadata", async () => {
  const response = unauthorized("/studio/brands");
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(body.refresh_url, "/auth/session/refresh?next=%2Fstudio%2Fbrands");
  assert.equal(body.retry_policy.safe_get, "explicit_once_after_session_recovery");
  assert.equal(body.retry_policy.mutating_request, "operator_resubmission_required");
  assert.equal(body.retry_policy.automatic_replay, false);
});

test("callback State not found is terminal while unrelated failures propagate", () => {
  assert.equal(isTerminalKindeCallbackError(new Error(
    "Authentication flow: Received: stale | Expected: State not found"
  )), true);
  assert.equal(isTerminalKindeCallbackError(new Error("Error: State not found")), false);
  assert.equal(isTerminalKindeCallbackError(new Error("provider unavailable")), false);
});

test("exact callback route converts only the pinned SDK returned State not found 500", async () => {
  const { handleKindeCallbackRequest } = await import("./kinde-callback");
  const pinnedBody = {
    error: "Error: State not found.\nTo resolve this error please visit our docs https://docs.kinde.com/developer-tools/sdks/backend/nextjs-sdk/#state-not-found-errorAuthentication flow: Received: stale | Expected: State not found"
  };
  const response = await handleKindeCallbackRequest(
    new Request("https://studio.example.test/api/auth/kinde_callback?code=private&state=private"),
    async () => Response.json(pinnedBody, { status: 500 })
  );
  assert.equal(response.status, 303);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.match(response.headers.get("location") ?? "", /\/api\/auth\/login/);
  assert.doesNotMatch(response.headers.get("location") ?? "", /kinde_callback/);
});

test("exact callback route accepts JSON media type parameters case-insensitively", async () => {
  const { handleKindeCallbackRequest } = await import("./kinde-callback");
  const pinnedBody = JSON.stringify({
    error: "Error: State not found.\nTo resolve this error please visit our docs "
      + "https://docs.kinde.com/developer-tools/sdks/backend/nextjs-sdk/"
      + "#state-not-found-errorAuthentication flow: Received: stale "
      + "| Expected: State not found"
  });
  const response = await handleKindeCallbackRequest(
    new Request("https://studio.example.test/api/auth/kinde_callback"),
    async () => new Response(pinnedBody, {
      status: 500,
      headers: { "content-type": " Application/JSON ; charset=utf-8" }
    })
  );
  assert.equal(response.status, 303);
  assert.match(response.headers.get("location") ?? "", /\/api\/auth\/login/);
});

test("exact callback route preserves unrelated 4xx and 5xx responses byte-for-byte", async () => {
  const { handleKindeCallbackRequest } = await import("./kinde-callback");
  const exactError = "Error: State not found.\nTo resolve this error please visit our docs "
    + "https://docs.kinde.com/developer-tools/sdks/backend/nextjs-sdk/"
    + "#state-not-found-errorAuthentication flow: Received: stale "
    + "| Expected: State not found";
  const cases = [
    new Response('{"error":"provider unavailable"}', {
      status: 500,
      headers: { "content-type": "application/json", "x-upstream": "one" }
    }),
    new Response('{"error":"Error: State not found"}', {
      status: 500,
      headers: { "content-type": "application/json", "x-upstream": "two" }
    }),
    Response.json({
      error: exactError,
      extra: true
    }, { status: 500, headers: { "x-upstream": "three" } }),
    Response.json({
      error: exactError
    }, { status: 400, headers: { "x-upstream": "four" } }),
    Response.json({
      error: exactError.replace("errorAuthentication", "errorINSERTEDAuthentication")
    }, { status: 500, headers: { "x-upstream": "inserted" } }),
    Response.json({
      error: `prefix:${exactError}`
    }, { status: 500, headers: { "x-upstream": "prefix" } }),
    Response.json({
      error: `${exactError}:suffix`
    }, { status: 500, headers: { "x-upstream": "suffix" } }),
    Response.json({
      error: exactError.replace("Received: stale", "Received: ")
    }, { status: 500, headers: { "x-upstream": "empty-received" } }),
    new Response(JSON.stringify({ error: exactError }), {
      status: 500,
      headers: { "content-type": "text/plain", "x-upstream": "content-type" }
    }),
    new Response(JSON.stringify({ error: exactError }), {
      status: 500,
      headers: { "content-type": "application/jsonp", "x-upstream": "jsonp" }
    }),
    new Response(JSON.stringify({ error: exactError }), {
      status: 500,
      headers: { "content-type": "x-application/json-evil", "x-upstream": "json-evil" }
    })
  ];

  for (const upstream of cases) {
    const expectedStatus = upstream.status;
    const expectedHeaders = [...upstream.headers.entries()];
    const expectedBody = await upstream.clone().text();
    const returned = await handleKindeCallbackRequest(
      new Request("https://studio.example.test/api/auth/kinde_callback"),
      async () => upstream
    );
    assert.equal(returned, upstream);
    assert.equal(returned.status, expectedStatus);
    assert.deepEqual([...returned.headers.entries()], expectedHeaders);
    assert.equal(await returned.text(), expectedBody);
  }
});

test("callback adapter remains compatible with a future exact SDK throw", async () => {
  const { handleKindeCallbackRequest } = await import("./kinde-callback");
  const response = await handleKindeCallbackRequest(
    new Request("https://studio.example.test/api/auth/kinde_callback"),
    async () => {
      throw new Error("Authentication flow: Received: stale | Expected: State not found");
    }
  );
  assert.equal(response.status, 303);
  assert.match(response.headers.get("location") ?? "", /\/api\/auth\/login/);
});

test("the exact setup route is private 404 JSON without token material", async () => {
  const { GET } = await import("../../app/api/auth/setup/route");
  const response = await GET();
  const body = await response.json();
  assert.equal(response.status, 404);
  assert.deepEqual(body, { error: "not_found" });
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(JSON.stringify(body).includes("Token"), false);
});

test("auth source preserves DB authorization and closes unsafe SDK surfaces", async () => {
  const [sessionSource, guardsSource, refreshSource, setupSource, catchAllSource, callbackSource] = await Promise.all([
    readFile(resolve(TEST_DIR, "session.ts"), "utf8"),
    readFile(resolve(TEST_DIR, "guards.ts"), "utf8"),
    readFile(resolve(TEST_DIR, "session-continuity.ts"), "utf8"),
    readFile(resolve(STUDIO_ROOT, "src/app/api/auth/setup/route.ts"), "utf8"),
    readFile(resolve(STUDIO_ROOT, "src/app/api/auth/[kindeAuth]/route.ts"), "utf8"),
    readFile(resolve(STUDIO_ROOT, "src/app/api/auth/kinde_callback/route.ts"), "utf8")
  ]);
  assert.match(
    sessionSource,
    /read_raw_access_token: async \(\) => await session\.getAccessTokenRaw\(\)/
  );
  assert.match(sessionSource, /resolveKindeSessionSnapshot/);
  assert.match(sessionSource, /CASE WHEN .*status.*'suspended'.*THEN 'suspended'/s);
  assert.match(sessionSource, /\.from\(users\)/);
  assert.match(sessionSource, /syncClientBrandAccessForOrganization/);
  assert.match(guardsSource, /session\.appUser\.status === "suspended"/);
  assert.match(guardsSource, /sessionRefreshPath\(next\)/);
  assert.equal((guardsSource.match(/resolveAuthenticatedAppSession\(\)/g) ?? []).length, 2);
  assert.doesNotMatch(guardsSource, /getKindeSessionLifecycle|getAuthenticatedAppUser/);
  assert.doesNotMatch(refreshSource, /from\("@\/lib\/db"\)|appUser|canAccessStudio|canAccessPortal/);
  assert.match(setupSource, /status: 404/);
  assert.doesNotMatch(setupSource, /getAccessToken|refreshTokens|accessTokenRaw/);
  assert.match(catchAllSource, /handleAuth/);
  assert.match(callbackSource, /handleKindeCallbackRequest\(request, callbackHandler\)/);
});

test("SDK is pinned and no middleware or protected-link prefetch regression exists", async () => {
  const [packageJson, lockfile] = await Promise.all([
    readFile(resolve(STUDIO_ROOT, "package.json"), "utf8"),
    readFile(resolve(REPO_ROOT, "pnpm-lock.yaml"), "utf8")
  ]);
  assert.equal(JSON.parse(packageJson).dependencies["@kinde-oss/kinde-auth-nextjs"], "2.12.2");
  assert.match(lockfile, /'@kinde-oss\/kinde-auth-nextjs':\n\s+specifier: 2\.12\.2/);
  await assert.rejects(readFile(resolve(STUDIO_ROOT, "src/middleware.ts"), "utf8"));

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execute = promisify(execFile);
  const result = await execute("rg", ["-n", "prefetch=\\{true\\}", "src"], { cwd: STUDIO_ROOT })
    .catch((error: { code?: number; stdout?: string }) => {
      if (error.code === 1) return { stdout: "" };
      throw error;
    });
  assert.equal(result.stdout.trim(), "");
});

test("the pinned SDK refresh contract commits all three rotated cookies before returning", async () => {
  const sdkRoot = resolve(
    REPO_ROOT,
    "node_modules/.pnpm/@kinde-oss+kinde-typescript-sdk@2.13.2/node_modules/@kinde-oss/kinde-typescript-sdk"
  );
  const [wrapperSource, wrapperTypes, clientSource, tokenSource, tokenTypes, sessionManagerSource] = await Promise.all([
    readFile(resolve(STUDIO_ROOT, "node_modules/@kinde-oss/kinde-auth-nextjs/dist/src/session/index.cjs.js"), "utf8"),
    readFile(resolve(STUDIO_ROOT, "node_modules/@kinde-oss/kinde-auth-nextjs/dist/types/src/session/index.d.ts"), "utf8"),
    readFile(resolve(sdkRoot, "dist/sdk/clients/server/authorization-code.js"), "utf8"),
    readFile(resolve(sdkRoot, "dist/sdk/utilities/token-utils.js"), "utf8"),
    readFile(resolve(sdkRoot, "dist/types/sdk/oauth2-flows/types.d.ts"), "utf8"),
    readFile(resolve(STUDIO_ROOT, "node_modules/@kinde-oss/kinde-auth-nextjs/dist/src/session/sessionManager.cjs.js"), "utf8")
  ]);

  assert.match(wrapperSource, /kindeClient\.refreshTokens\(await .*sessionManager/);
  assert.match(wrapperTypes, /refreshTokens:\s*\(\) => Promise<OAuth2CodeExchangeResponse>/);
  assert.match(clientSource, /commitToSession === void 0.*commitToSession = true/s);
  assert.match(tokenSource, /commitTokensToSession/);
  for (const token of ["refresh_token", "access_token", "id_token"] as const) {
    assert.match(tokenSource, new RegExp(`tokens\\.${token}`));
    assert.match(tokenTypes, new RegExp(`${token}: string`));
  }
  assert.match(sessionManagerSource, /setSessionItem/);
  assert.match(sessionManagerSource, /\.set\(/);
});

test("refreshTokens is callable only inside the dedicated refresh boundary", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execute = promisify(execFile);
  const result = await execute(
    "rg",
    ["-l", "refreshTokens\\(", "src", "-g", "!*.test.ts"],
    { cwd: STUDIO_ROOT }
  );
  assert.deepEqual(
    result.stdout.trim().split("\n").sort(),
    [
      "src/app/auth/session/refresh/route.ts",
      "src/lib/auth/session-continuity.ts"
    ]
  );
});
