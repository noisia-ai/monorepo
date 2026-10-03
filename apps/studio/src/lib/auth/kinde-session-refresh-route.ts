import type { SessionRefreshBarrier } from "@/lib/auth/session-refresh-barrier";
import {
  handleKindeSessionRefresh,
  rejectDisallowedRefreshNavigation,
  type SessionRefreshSdk
} from "@/lib/auth/session-continuity";
import { loginPath, safeSessionReturnPath } from "@/lib/auth/redirects";

type SessionRefreshRouteConfiguration = {
  derive_barrier_key(rawAccessToken: string): string;
  ttl_ms: number;
};

export type KindeSessionRefreshRouteFactories = {
  create_sdk(): Promise<SessionRefreshSdk>;
  resolve_configuration(): SessionRefreshRouteConfiguration;
  create_barrier(): SessionRefreshBarrier;
  create_owner(): string;
  now(): Date;
  sleep(milliseconds: number): Promise<void>;
};

/**
 * Exact route adapter. Unsafe navigation is rejected before any factory can import
 * Kinde, resolve HMAC configuration or construct Redis.
 */
export function createKindeSessionRefreshRoute(
  factories: KindeSessionRefreshRouteFactories
) {
  return async function GET(request: Request) {
    const navigationRejection = rejectDisallowedRefreshNavigation(request.headers);
    if (navigationRejection) return navigationRejection;

    try {
      const sdk = await factories.create_sdk();
      const configuration = factories.resolve_configuration();
      const barrier = factories.create_barrier();

      return handleKindeSessionRefresh(request, {
        sdk,
        barrier,
        derive_barrier_key: configuration.derive_barrier_key,
        create_owner: factories.create_owner,
        now: factories.now,
        sleep: factories.sleep,
        ttl_ms: configuration.ttl_ms
      });
    } catch {
      const url = new URL(request.url);
      const next = safeSessionReturnPath(url.searchParams.get("next"), "/studio");
      return Response.json(
        {
          error: "session_refresh_boundary_unavailable",
          message: "Session recovery is temporarily unavailable. Start a clean login.",
          login_url: loginPath(next),
          automatic_retry: false
        },
        {
          status: 503,
          headers: {
            "Cache-Control": "private, no-store, max-age=0",
            "Pragma": "no-cache",
            "Vary": "Cookie"
          }
        }
      );
    }
  };
}
