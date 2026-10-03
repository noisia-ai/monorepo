import Redis from "ioredis";

import {
  type SessionRefreshBarrier,
  type SessionRefreshBarrierAcquireResult,
  type SessionRefreshBarrierRecord
} from "@/lib/auth/session-refresh-barrier";

declare global {
  var noisiaKindeSessionRefreshRedis: Redis | undefined;
}

const OWNER_TRANSITION_SCRIPT = `
local current = redis.call("GET", KEYS[1])
if not current then
  return 0
end
local decoded = cjson.decode(current)
if decoded.owner ~= ARGV[1] or decoded.state ~= "started" then
  return 0
end
redis.call("SET", KEYS[1], ARGV[2], "PX", ARGV[3], "XX")
return 1
`;

export class RedisSessionRefreshBarrier implements SessionRefreshBarrier {
  constructor(private readonly redis: Pick<Redis, "get" | "set" | "eval">) {}

  async acquire(input: {
    key: string;
    owner: string;
    ttl_ms: number;
    now_iso: string;
  }): Promise<SessionRefreshBarrierAcquireResult> {
    const record: SessionRefreshBarrierRecord = {
      state: "started",
      owner: input.owner,
      updated_at: input.now_iso
    };
    const written = await this.redis.set(
      input.key,
      JSON.stringify(record),
      "PX",
      input.ttl_ms,
      "NX"
    );
    if (written === "OK") return { acquired: true, record };

    const existing = await this.read(input.key);
    if (!existing) {
      throw new Error("Kinde session refresh barrier disappeared during acquisition.");
    }
    return { acquired: false, record: existing };
  }

  async read(key: string) {
    const raw = await this.redis.get(key);
    return raw ? parseBarrierRecord(raw) : null;
  }

  async transition(input: {
    key: string;
    owner: string;
    state: "rotated" | "failed" | "ambiguous";
    ttl_ms: number;
    now_iso: string;
  }) {
    const next: SessionRefreshBarrierRecord = {
      state: input.state,
      owner: input.owner,
      updated_at: input.now_iso
    };
    const result = await this.redis.eval(
      OWNER_TRANSITION_SCRIPT,
      1,
      input.key,
      input.owner,
      JSON.stringify(next),
      String(input.ttl_ms)
    );
    return result === 1;
  }
}

export function getRedisSessionRefreshBarrier(
  env: Record<string, string | undefined> = process.env
) {
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) throw new Error("REDIS_URL is required for Kinde session refresh continuity.");

  globalThis.noisiaKindeSessionRefreshRedis ??= new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    tls: redisUrl.startsWith("rediss://") ? {} : undefined
  });
  return new RedisSessionRefreshBarrier(globalThis.noisiaKindeSessionRefreshRedis);
}

function parseBarrierRecord(raw: string): SessionRefreshBarrierRecord {
  const value = JSON.parse(raw) as Partial<SessionRefreshBarrierRecord>;
  if (
    !["started", "rotated", "failed", "ambiguous"].includes(value.state ?? "")
    || typeof value.owner !== "string"
    || typeof value.updated_at !== "string"
  ) {
    throw new Error("Kinde session refresh barrier contains an invalid record.");
  }
  return value as SessionRefreshBarrierRecord;
}
