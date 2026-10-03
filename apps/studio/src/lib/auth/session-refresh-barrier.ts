import { createHmac, randomUUID } from "node:crypto";

export type SessionRefreshBarrierState = "started" | "rotated" | "failed" | "ambiguous";

export type SessionRefreshBarrierRecord = {
  state: SessionRefreshBarrierState;
  owner: string;
  updated_at: string;
};

export type SessionRefreshBarrierAcquireResult = {
  acquired: boolean;
  record: SessionRefreshBarrierRecord;
};

export interface SessionRefreshBarrier {
  acquire(input: {
    key: string;
    owner: string;
    ttl_ms: number;
    now_iso: string;
  }): Promise<SessionRefreshBarrierAcquireResult>;
  read(key: string): Promise<SessionRefreshBarrierRecord | null>;
  transition(input: {
    key: string;
    owner: string;
    state: Exclude<SessionRefreshBarrierState, "started">;
    ttl_ms: number;
    now_iso: string;
  }): Promise<boolean>;
}

export function deriveSessionRefreshBarrierKey(input: {
  raw_access_token: string;
  hmac_key: string;
  environment_namespace: string;
}) {
  if (!input.hmac_key) {
    throw new Error("Kinde session refresh barrier HMAC key is required.");
  }

  const namespace = normalizeNamespace(input.environment_namespace);
  const fingerprint = createHmac("sha256", input.hmac_key)
    .update(namespace)
    .update("\0")
    .update(input.raw_access_token)
    .digest("hex");

  return `noisia:kinde-session-refresh:${namespace}:${fingerprint}`;
}

export function createSessionRefreshOwner() {
  return randomUUID();
}

export function resolveSessionRefreshBarrierTtlMs(
  value: string | undefined,
  fallbackMs = 15 * 60 * 1_000
) {
  if (!value) return fallbackMs;
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > 86_400) return fallbackMs;
  return seconds * 1_000;
}

export function resolveSessionRefreshEnvironmentNamespace(
  env: Record<string, string | undefined> = process.env
) {
  return normalizeNamespace(
    env.RAILWAY_ENVIRONMENT
      ?? env.VERCEL_ENV
      ?? env.NODE_ENV
      ?? "unknown"
  );
}

function normalizeNamespace(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return normalized || "unknown";
}
