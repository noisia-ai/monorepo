import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

import { handleKindeSessionRefresh } from "../src/lib/auth/session-continuity";
import {
  deriveSessionRefreshBarrierKey,
  type SessionRefreshBarrier,
  type SessionRefreshBarrierAcquireResult,
  type SessionRefreshBarrierRecord
} from "../src/lib/auth/session-refresh-barrier";

type RpcRequest = {
  type: "rpc";
  id: number;
  operation: "acquire" | "read" | "transition" | "provider";
  payload?: Record<string, unknown>;
};

type RpcResponse = {
  type: "rpc-result";
  id: number;
  value: unknown;
};

if (process.argv.includes("--child")) {
  await runChild();
} else {
  await runParent();
}

async function runParent() {
  const records = new Map<string, SessionRefreshBarrierRecord>();
  let providerCalls = 0;
  let cookieCommitmentOwner: string | null = null;
  const runReplica = (name: string) => {
    const child = fork(fileURLToPath(import.meta.url), ["--child", name], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "pipe", "pipe", "ipc"]
    });
    return new Promise<{ name: string; status: number; location: string | null; error: string | null }>((resolve, reject) => {
      child.on("message", (message: RpcRequest | {
        type: "result";
        value: { name: string; status: number; location: string | null; error: string | null };
      }) => {
        if (message.type === "result") {
          resolve(message.value);
          return;
        }
        if (message.type !== "rpc") return;
        let value: unknown;
        if (message.operation === "provider") {
          providerCalls += 1;
          cookieCommitmentOwner = String(message.payload?.name);
          value = "rotated";
        } else if (message.operation === "acquire") {
          const input = message.payload as {
            key: string;
            owner: string;
            now_iso: string;
          };
          const existing = records.get(input.key);
          if (existing) value = { acquired: false, record: existing };
          else {
            const record: SessionRefreshBarrierRecord = {
              state: "started",
              owner: input.owner,
              updated_at: input.now_iso
            };
            records.set(input.key, record);
            value = { acquired: true, record };
          }
        } else if (message.operation === "read") {
          value = records.get(String(message.payload?.key)) ?? null;
        } else {
          const input = message.payload as {
            key: string;
            owner: string;
            state: "rotated" | "failed" | "ambiguous";
            now_iso: string;
          };
          const existing = records.get(input.key);
          const allowed = existing?.owner === input.owner && existing.state === "started";
          if (allowed) {
            records.set(input.key, {
              state: input.state,
              owner: input.owner,
              updated_at: input.now_iso
            });
          }
          value = allowed;
        }
        child.send({ type: "rpc-result", id: message.id, value } satisfies RpcResponse);
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code && code !== 0) reject(new Error(`child exited ${code}`));
      });
    });
  };

  const results = await Promise.all([runReplica("replica-a"), runReplica("replica-b")]);

  assert.equal(providerCalls, 1);
  assert.equal(results.filter((result) => result.status === 303).length, 1);
  assert.equal(results.filter((result) => result.status === 503).length, 1);
  const ownerResult = results.find((result) => result.name === cookieCommitmentOwner);
  const waiterResult = results.find((result) => result.name !== cookieCommitmentOwner);
  assert.deepEqual(ownerResult, {
    name: cookieCommitmentOwner,
    status: 303,
    location: "/studio",
    error: null
  });
  assert.deepEqual(waiterResult, {
    name: waiterResult?.name,
    status: 503,
    location: null,
    error: "session_refresh_cookie_commit_pending"
  });
  assert.equal([...records.values()][0]?.state, "rotated");
  const replay = await runReplica("replica-terminal-replay");
  assert.deepEqual(replay, {
    name: "replica-terminal-replay",
    status: 503,
    location: null,
    error: "session_refresh_cookie_commit_pending"
  });
  assert.equal(providerCalls, 1);
  console.log(JSON.stringify({
    concurrent_processes: 2,
    total_processes: 3,
    requests: 3,
    provider_calls: providerCalls,
    terminal_state: "rotated",
    terminal_replay_provider_calls: 0,
    owner_cookie_commitment: cookieCommitmentOwner,
    owner_redirects: 1,
    waiter_cookie_commitments: 0,
    waiter_fail_closed: true,
    terminal_replay_fail_closed: true
  }));
}

async function runChild() {
  let rpcId = 0;
  const pending = new Map<number, (value: unknown) => void>();
  process.on("message", (message: RpcResponse) => {
    if (message.type !== "rpc-result") return;
    pending.get(message.id)?.(message.value);
    pending.delete(message.id);
  });
  const rpc = <T>(operation: RpcRequest["operation"], payload?: Record<string, unknown>) =>
    new Promise<T>((resolve) => {
      const id = rpcId += 1;
      pending.set(id, resolve as (value: unknown) => void);
      process.send?.({ type: "rpc", id, operation, payload } satisfies RpcRequest);
    });

  const barrier: SessionRefreshBarrier = {
    acquire: (input) => rpc<SessionRefreshBarrierAcquireResult>("acquire", input),
    read: (key) => rpc<SessionRefreshBarrierRecord | null>("read", { key }),
    transition: (input) => rpc<boolean>("transition", input)
  };
  const rawAccessToken = jwt(1);
  const response = await handleKindeSessionRefresh(
    new Request("https://studio.example.test/auth/session/refresh?next=%2Fstudio", {
      headers: {
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "document"
      }
    }),
    {
      sdk: {
        getAccessTokenRaw: async () => rawAccessToken,
        refreshTokens: () => rpc("provider", { name: process.argv.at(-1) })
      },
      barrier,
      derive_barrier_key: (raw) => deriveSessionRefreshBarrierKey({
        raw_access_token: raw,
        hmac_key: "two-process-fixture-key",
        environment_namespace: "two-process-fixture"
      }),
      create_owner: () => `${process.pid}`,
      now: () => new Date("2026-08-24T00:00:00.000Z"),
      sleep: (milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
      ttl_ms: 60_000,
      poll_interval_ms: 2,
      max_polls: 100
    }
  );
  const body = response.headers.get("content-type")?.includes("application/json")
    ? await response.clone().json() as { error?: unknown }
    : null;
  process.send?.({
    type: "result",
    value: {
      name: process.argv.at(-1) ?? "unknown",
      status: response.status,
      location: response.headers.get("location"),
      error: typeof body?.error === "string" ? body.error : null
    }
  });
  process.disconnect?.();
}

function jwt(exp: number) {
  const segment = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${segment({ alg: "none" })}.${segment({ exp })}.signature`;
}
