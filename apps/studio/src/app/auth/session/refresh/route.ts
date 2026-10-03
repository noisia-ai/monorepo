import {
  createSessionRefreshOwner,
  deriveSessionRefreshBarrierKey,
  resolveSessionRefreshBarrierTtlMs,
  resolveSessionRefreshEnvironmentNamespace
} from "@/lib/auth/session-refresh-barrier";
import { createKindeSessionRefreshRoute } from "@/lib/auth/kinde-session-refresh-route";
import { getRedisSessionRefreshBarrier } from "@/lib/auth/session-refresh-redis";
import type { KindeRefreshAttemptResult } from "@/lib/auth/session-continuity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = createKindeSessionRefreshRoute({
  async create_sdk() {
    const { getKindeServerSession } = await import("@kinde-oss/kinde-auth-nextjs/server");
    const session = getKindeServerSession();
    return {
      async getAccessTokenRaw() {
        return await session.getAccessTokenRaw();
      },
      async refreshTokens(): Promise<KindeRefreshAttemptResult> {
        const result = await session.refreshTokens();
        if (!result) return "ambiguous";
        const value = result as {
          access_token?: unknown;
          id_token?: unknown;
          refresh_token?: unknown;
        };
        return typeof value.access_token === "string"
          && typeof value.id_token === "string"
          && typeof value.refresh_token === "string"
          ? "rotated"
          : "ambiguous";
      }
    };
  },
  resolve_configuration() {
    const env = process.env;
    const hmacKey = env.NOISIA_KINDE_REFRESH_BARRIER_HMAC_KEY?.trim();
    if (!hmacKey) throw new Error("Kinde refresh barrier HMAC configuration is missing.");
    return {
      derive_barrier_key(rawAccessToken: string) {
        return deriveSessionRefreshBarrierKey({
          raw_access_token: rawAccessToken,
          hmac_key: hmacKey,
          environment_namespace: resolveSessionRefreshEnvironmentNamespace(env)
        });
      },
      ttl_ms: resolveSessionRefreshBarrierTtlMs(
        env.NOISIA_KINDE_REFRESH_BARRIER_TTL_SECONDS
      )
    };
  },
  create_barrier() {
    return getRedisSessionRefreshBarrier(process.env);
  },
  create_owner: createSessionRefreshOwner,
  now: () => new Date(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
});
