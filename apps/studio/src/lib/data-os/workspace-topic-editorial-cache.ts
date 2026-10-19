import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import Redis from "ioredis";
import type { SignalTopicEditorialScreeningPlanV1 } from "@noisia/query-engine";
import type { WorkspaceTopicEditorialViewV1 } from "./workspace-topic-editorial-contract";

export type EditorialQuoteScope = { workspace_id: string; actor_user_id: string; numeric_execution_id: string };
export type EditorialQuoteSnapshot = EditorialQuoteScope & { numeric_run_id: string; quote: NonNullable<WorkspaceTopicEditorialViewV1["quote"]>;
  plan: SignalTopicEditorialScreeningPlanV1 };
export interface EditorialQuoteCache { put(value: EditorialQuoteSnapshot): Promise<void>; get(scope: EditorialQuoteScope, reference: string): Promise<EditorialQuoteSnapshot | null> }
const TTL = 900; // Physical retention only. SQL quote expiry is never extended.
// Bound optional cache work. Large plans remain reproducible from their SQL quote;
// they must not become multi-megabyte Redis commands on the request path.
const MAX = 1_048_576;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const scopeKey = (s: EditorialQuoteScope) => digest(JSON.stringify([s.workspace_id, s.actor_user_id, s.numeric_execution_id]));
const cacheKey = (s: EditorialQuoteScope, reference: string) => `topic-editorial:quote:v1:${scopeKey(s)}:${digest(reference)}`;
export function editorialQuoteCacheKeyV1(env: Record<string, string | undefined>): Buffer | null {
  const value = env.NOISIA_SIGNAL_TOPIC_EDITORIAL_QUOTE_KEY;
  if (!value || !/^[A-Za-z0-9+/]{43}=$/u.test(value)) return null;
  const key = Buffer.from(value, "base64"); return key.length === 32 && key.toString("base64") === value ? key : null;
}
/** Dedicated encrypted private snapshot; Redis receives no corpus text in plaintext. */
export class RedisEditorialQuoteCache implements EditorialQuoteCache {
  constructor(private readonly redis: Pick<Redis, "get" | "eval">, private readonly key: Buffer,
    private readonly ready: Promise<void> = Promise.resolve()) {
    if (key.length !== 32) throw new Error("topic_editorial_cache_unavailable");
  }
  async put(value: EditorialQuoteSnapshot) {
    await this.ready;
    const plain = Buffer.from(JSON.stringify(value));
    if (plain.length > MAX) return;
    const address = cacheKey(value, value.quote.reference), iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv); cipher.setAAD(Buffer.from(address));
    const body = Buffer.concat([iv, cipher.update(plain), cipher.final()]);
    const envelope = `${body.toString("base64")}.${cipher.getAuthTag().toString("base64")}`;
    // One current snapshot per actor/workspace/numeric owner bounds retained evidence.
    // Cache misses rebuild against the original quote; committed replay uses its owner.
    await this.redis.eval(`local old=redis.call('GET',KEYS[2]); if old and old~=KEYS[1] then redis.call('DEL',old) end;
      redis.call('SET',KEYS[1],ARGV[1],'EX',ARGV[2],'NX'); redis.call('SET',KEYS[2],KEYS[1],'EX',ARGV[2]); return 1`,
      2, address, `topic-editorial:quote:head:v1:${scopeKey(value)}`, envelope, TTL);
  }
  async get(scope: EditorialQuoteScope, reference: string) {
    await this.ready;
    const address = cacheKey(scope, reference), raw = await this.redis.get(address);
    if (!raw) return null;
    try {
      if (raw.length > Math.ceil(MAX * 4 / 3) + 128) return null;
      const [encoded, tag, extra] = raw.split("."); if (!encoded || !tag || extra) return null;
      const bytes = Buffer.from(encoded, "base64"), cipher = createDecipheriv("aes-256-gcm", this.key, bytes.subarray(0, 12));
      cipher.setAAD(Buffer.from(address)); cipher.setAuthTag(Buffer.from(tag, "base64"));
      const value = JSON.parse(Buffer.concat([cipher.update(bytes.subarray(12)), cipher.final()]).toString("utf8")) as EditorialQuoteSnapshot;
      return value.workspace_id === scope.workspace_id && value.actor_user_id === scope.actor_user_id
        && value.numeric_execution_id === scope.numeric_execution_id && value.quote.reference === reference ? value : null;
    } catch { return null; }
  }
}
declare global {
  var noisiaTopicEditorialQuoteRedis: Redis | undefined;
  var noisiaTopicEditorialQuoteRedisReady: Promise<void> | undefined;
}
export function editorialQuoteRuntimeAvailableV1(env: Record<string, string | undefined> = process.env) {
  return editorialRecoveryRuntimeAvailableV1(env) && env.NOISIA_SIGNAL_TOPIC_EDITORIAL_PROVIDER_ENABLED === "true";
}
/** Recovery may consume settled receipts without a provider, cache or current spend authority. */
export function editorialRecoveryRuntimeAvailableV1(env: Record<string, string | undefined> = process.env) {
  return env.NOISIA_SIGNAL_TOPIC_EDITORIAL_ENABLED === "true";
}
export function getEditorialQuoteCacheV1(env: Record<string, string | undefined> = process.env): EditorialQuoteCache {
  const key = editorialQuoteCacheKeyV1(env);
  if (!env.REDIS_URL?.trim() || !key) throw new Error("topic_editorial_cache_unavailable");
  if (!globalThis.noisiaTopicEditorialQuoteRedis || globalThis.noisiaTopicEditorialQuoteRedis.status === "end") {
    globalThis.noisiaTopicEditorialQuoteRedis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2000,
      commandTimeout: 5000, enableOfflineQueue: false, tls: env.REDIS_URL.startsWith("rediss://") ? {} : undefined });
    // ioredis emits independently of command promises, including reconnect errors.
    // Cache misses are recoverable; never log connection strings or private input.
    globalThis.noisiaTopicEditorialQuoteRedis.on("error", () => undefined);
    globalThis.noisiaTopicEditorialQuoteRedisReady = undefined;
  }
  const redis = globalThis.noisiaTopicEditorialQuoteRedis;
  if (redis.status !== "ready") {
    globalThis.noisiaTopicEditorialQuoteRedisReady ??= redis.connect().catch(() => {
      if (globalThis.noisiaTopicEditorialQuoteRedis === redis) {
        redis.disconnect(); globalThis.noisiaTopicEditorialQuoteRedis = undefined;
      }
      throw new Error("topic_editorial_cache_unavailable");
    }).finally(() => { globalThis.noisiaTopicEditorialQuoteRedisReady = undefined; });
    // A caller may abandon the optional cache before issuing a command.
    void globalThis.noisiaTopicEditorialQuoteRedisReady.catch(() => undefined);
  }
  return new RedisEditorialQuoteCache(redis, key, globalThis.noisiaTopicEditorialQuoteRedisReady);
}
