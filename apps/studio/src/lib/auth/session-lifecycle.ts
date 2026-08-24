export type KindeSessionLifecycle =
  | "valid"
  | "refresh_required"
  | "unauthenticated"
  | "malformed";

export type KindeSessionSnapshotResult<AuthenticatedSession> = {
  lifecycle: KindeSessionLifecycle;
  session: AuthenticatedSession | null;
};

export type KindeSessionSnapshotDependencies<AuthenticatedSession> = {
  read_raw_access_token(): Promise<string | null>;
  authenticate_valid_snapshot(): Promise<AuthenticatedSession | null>;
  now_epoch_seconds?: number;
};

/**
 * Resolves lifecycle and authentication from one server-owned raw-token snapshot.
 * Parsing decides only whether refresh/login is required. Identity is returned only by
 * the supported Kinde validation callback.
 */
export async function resolveKindeSessionSnapshot<AuthenticatedSession>(
  dependencies: KindeSessionSnapshotDependencies<AuthenticatedSession>
): Promise<KindeSessionSnapshotResult<AuthenticatedSession>> {
  let rawAccessToken: string | null;
  try {
    rawAccessToken = await dependencies.read_raw_access_token();
  } catch {
    return { lifecycle: "malformed", session: null };
  }

  const lifecycle = classifyKindeAccessToken(
    rawAccessToken,
    dependencies.now_epoch_seconds
  );
  if (lifecycle !== "valid") return { lifecycle, session: null };

  const session = await dependencies.authenticate_valid_snapshot();
  return session
    ? { lifecycle: "valid", session }
    : { lifecycle: "unauthenticated", session: null };
}

type JwtPayload = {
  exp?: unknown;
};

/**
 * This is intentionally only a lifecycle hint. A syntactically valid, unexpired
 * token must still pass Kinde's supported SDK validation before it can establish
 * an authenticated Noisia session.
 */
export function classifyKindeAccessToken(
  rawAccessToken: string | null | undefined,
  nowEpochSeconds = Math.floor(Date.now() / 1_000),
  expirySafetyWindowSeconds = 30
): KindeSessionLifecycle {
  if (!rawAccessToken) return "unauthenticated";

  const segments = rawAccessToken.split(".");
  if (segments.length !== 3 || segments.some((segment) => segment.length === 0)) {
    return "malformed";
  }

  try {
    const payload = JSON.parse(decodeBase64Url(segments[1]!)) as JwtPayload;
    if (
      typeof payload.exp !== "number"
      || !Number.isFinite(payload.exp)
      || !Number.isInteger(payload.exp)
      || payload.exp <= 0
    ) {
      return "malformed";
    }

    // Treat near-expiry tokens as refreshable before a page guard can perform a
    // second SDK read. This bounded server-owned window avoids classifying a token as
    // valid only for it to expire during the same authentication decision.
    return payload.exp <= nowEpochSeconds + expirySafetyWindowSeconds
      ? "refresh_required"
      : "valid";
  } catch {
    return "malformed";
  }
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
}
