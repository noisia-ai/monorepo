import {
  type SessionRefreshBarrier,
  type SessionRefreshBarrierRecord
} from "@/lib/auth/session-refresh-barrier";
import { classifyKindeAccessToken } from "@/lib/auth/session-lifecycle";
import { loginPath, safeSessionReturnPath } from "@/lib/auth/redirects";

export type KindeRefreshAttemptResult = "rotated" | "failed" | "ambiguous";

export type SessionRefreshSdk = {
  getAccessTokenRaw(): Promise<string | null>;
  refreshTokens(): Promise<KindeRefreshAttemptResult>;
};

export type SessionRefreshHandlerDependencies = {
  sdk: SessionRefreshSdk;
  barrier: SessionRefreshBarrier;
  derive_barrier_key(rawAccessToken: string): string;
  create_owner(): string;
  now(): Date;
  sleep(milliseconds: number): Promise<void>;
  ttl_ms: number;
  poll_interval_ms?: number;
  max_polls?: number;
};

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Pragma": "no-cache",
  "Referrer-Policy": "no-referrer",
  "Vary": "Cookie"
} as const;

export async function handleKindeSessionRefresh(
  request: Request,
  dependencies: SessionRefreshHandlerDependencies
) {
  const url = new URL(request.url);
  const next = safeSessionReturnPath(url.searchParams.get("next"), "/studio");
  const navigationRejection = rejectDisallowedRefreshNavigation(request.headers);
  if (navigationRejection) return navigationRejection;

  let rawAccessToken: string | null;
  try {
    rawAccessToken = await dependencies.sdk.getAccessTokenRaw();
  } catch {
    return privateJson(
      {
        error: "session_state_unavailable",
        message: "Session state could not be read safely.",
        login_url: loginPath(next)
      },
      503
    );
  }

  const lifecycle = classifyKindeAccessToken(rawAccessToken);
  if (lifecycle === "valid") return privateRedirect(next);
  if (lifecycle === "unauthenticated" || lifecycle === "malformed") {
    return privateRedirect(loginPath(next));
  }

  const owner = dependencies.create_owner();
  let barrierKey: string;
  try {
    barrierKey = dependencies.derive_barrier_key(rawAccessToken!);
  } catch {
    return unavailableResponse(next, "session_refresh_configuration_unavailable");
  }

  let acquired;
  try {
    acquired = await dependencies.barrier.acquire({
      key: barrierKey,
      owner,
      ttl_ms: dependencies.ttl_ms,
      now_iso: dependencies.now().toISOString()
    });
  } catch {
    return unavailableResponse(next, "session_refresh_coordination_unavailable");
  }

  if (!acquired.acquired) {
    return waitForRefreshOwner(next, barrierKey, acquired.record, dependencies);
  }

  let outcome: KindeRefreshAttemptResult;
  try {
    outcome = await dependencies.sdk.refreshTokens();
  } catch {
    outcome = "ambiguous";
  }

  let transitioned = false;
  try {
    transitioned = await dependencies.barrier.transition({
      key: barrierKey,
      owner,
      state: outcome,
      ttl_ms: dependencies.ttl_ms,
      now_iso: dependencies.now().toISOString()
    });
  } catch {
    // A provider exchange may already have happened. Fail closed and never repeat it.
    return unavailableResponse(next, "session_refresh_result_ambiguous");
  }

  if (!transitioned) {
    return unavailableResponse(next, "session_refresh_result_ambiguous");
  }

  return responseForTerminalState(next, outcome, true);
}

export function isAllowedRefreshNavigation(headers: Headers) {
  return headers.get("sec-fetch-site") === "same-origin"
    && headers.get("sec-fetch-mode") === "navigate"
    && headers.get("sec-fetch-dest") === "document";
}

export function rejectDisallowedRefreshNavigation(headers: Headers) {
  if (isAllowedRefreshNavigation(headers)) return null;
  return privateJson(
    {
      error: "cross_site_session_refresh_rejected",
      message: "Start session recovery from Noisia Studio."
    },
    403
  );
}

export function isTerminalKindeCallbackError(error: unknown) {
  return error instanceof Error
    && /^Authentication flow: Received: [^|\s]+ \| Expected: State not found$/.test(error.message);
}

export function privateRedirect(location: string) {
  return new Response(null, {
    status: 303,
    headers: {
      ...PRIVATE_HEADERS,
      Location: location
    }
  });
}

async function waitForRefreshOwner(
  next: string,
  key: string,
  initialRecord: SessionRefreshBarrierRecord,
  dependencies: SessionRefreshHandlerDependencies
) {
  let record: SessionRefreshBarrierRecord | null = initialRecord;
  const maxPolls = dependencies.max_polls ?? 80;
  const pollIntervalMs = dependencies.poll_interval_ms ?? 100;

  for (let index = 0; record?.state === "started" && index < maxPolls; index += 1) {
    await dependencies.sleep(pollIntervalMs);
    try {
      record = await dependencies.barrier.read(key);
    } catch {
      return unavailableResponse(next, "session_refresh_coordination_unavailable");
    }
  }

  if (!record || record.state === "started") {
    return unavailableResponse(next, "session_refresh_in_progress");
  }
  return responseForTerminalState(next, record.state, false);
}

function responseForTerminalState(
  next: string,
  state: Exclude<SessionRefreshBarrierRecord["state"], "started">,
  ownsCookieCommitment: boolean
) {
  if (state === "rotated") {
    // Next.js commits the SDK's cookies only on the response that called
    // refreshTokens(). Redis proves the exchange completed, but cannot transfer that
    // request-local Set-Cookie commitment to a waiter or terminal replay.
    return ownsCookieCommitment
      ? privateRedirect(next)
      : unavailableResponse(next, "session_refresh_cookie_commit_pending");
  }
  if (state === "failed") return privateRedirect(loginPath(next));
  return unavailableResponse(next, "session_refresh_result_ambiguous");
}

function unavailableResponse(next: string, error: string) {
  return privateJson(
    {
      error,
      message: "Session recovery could not be completed safely. Start a clean login.",
      login_url: loginPath(next),
      automatic_retry: false
    },
    503
  );
}

function privateJson(value: unknown, status: number) {
  return Response.json(value, {
    status,
    headers: PRIVATE_HEADERS
  });
}
