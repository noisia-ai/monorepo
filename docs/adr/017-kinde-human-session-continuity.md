# ADR 017: Kinde Human Session Continuity Uses an Explicit Refresh Boundary

## Status

Accepted for local implementation. Preview/UAT configuration and runtime validation are
separate gates. Production is not authorized by this decision.

## Context

Noisia Studio uses Kinde for human authentication and the Noisia database for roles,
organizations and brand authorization. The Kinde Next.js SDK's `isAuthenticated()` helper
redirects when the access token is expired. Calling it concurrently from several server
components or API requests can therefore start overlapping OAuth work. With rotating
refresh tokens, two replicas acting on the same expired browser session can invalidate one
another and produce login loops or `State not found` callback failures.

The app deliberately has no Kinde middleware and protected links do not prefetch. Those
guardrails remain in force. Machine-to-machine credentials are not a solution because an
M2M identity cannot replace a human browser session or the subsequent database-owned AuthZ
decision.

## Decision

Studio classifies the raw access token into exactly four lifecycle hints before calling the
SDK's redirecting authentication helper:

- `valid`
- `refresh_required`
- `unauthenticated`
- `malformed`

The `exp` claim is only a lifecycle hint. A `valid` hint must still pass the supported Kinde
SDK authentication path, after which the Noisia database is re-read for status, role,
organization and brand access. Expired tokens never enter `isAuthenticated()`.
Tokens with 30 seconds or less remaining are also classified as `refresh_required`. This
server-owned safety window bounds expiry during the authentication decision. Studio and
Portal guards consume one `resolveAuthenticatedAppSession()` result: it reads one raw-token
snapshot from one request-local Kinde session, classifies it once, and invokes the supported
Kinde validation callback only for a stable `valid` hint. It does not grant authentication
and does not cache AuthZ.

Page guards navigate expired human sessions to a same-origin, server-only GET boundary:

`/auth/session/refresh?next=<safe-relative-path>`

The boundary calls the public SDK `refreshTokens()` method and relies on the App Router
cookie store to commit rotated cookies before issuing a `303`. It accepts only an explicit
same-origin document navigation (`Sec-Fetch-Site: same-origin`, `Sec-Fetch-Mode: navigate`,
`Sec-Fetch-Dest: document`), prevents auth-loop/control-character/backslash destinations,
and returns `private, no-store` responses. A missing, malformed or unreadable session fails
closed without invoking refresh. Callback `State not found` is terminal and starts a clean
login; it is never treated as a refresh retry.

The boundary coordinates replicas through the existing Redis infrastructure. The key is an
HMAC-SHA-256 fingerprint of the expired access token, scoped to the deployment environment;
the raw token is never stored. The record is a small retained state machine:

- `started`
- `rotated`
- `failed`
- `ambiguous`

Acquisition uses Redis `SET NX PX`; only the owner may atomically move `started` to a
terminal state. A crash, Redis outage, missing result or ambiguous provider exchange fails
closed and never authorizes a second rotation. Terminal states remain until a bounded,
server-owned TTL expires.

The `rotated` record proves only that the exchange completed; it cannot transfer the
request-local `Set-Cookie` commitment produced by Next.js. Therefore only the owner
response may redirect to the protected destination. Waiters and terminal replays return a
private `503 session_refresh_cookie_commit_pending` with a clean-login URL and no automatic
retry. This also covers loss of the owner's response: a later request never performs a
second rotation on the same retained record.

API routes do not start OAuth in the background. The central `401` JSON response exposes a
safe refresh URL, clean login URL and explicit replay policy: a caller may retry a GET once
after intentional recovery, while mutating requests require operator resubmission. No
request body is automatically replayed.

The exact `/api/auth/setup` route is closed because the SDK fallback can refresh sessions
and return raw token material. Logout continues through the SDK catch-all and never enters
the refresh boundary.

The exact callback route wraps the pinned SDK handler because SDK 2.12.2 catches a terminal
`State not found` mismatch internally and returns a JSON `500` instead of throwing. The
adapter uses an anchored full-string matcher and recognizes only that exact pinned body
shape, with a nonempty closed Received field, before converting it to a private clean-login
redirect. Inserted markers, prefixes, suffixes, additional keys and all unrelated 4xx/5xx
responses are returned as the original response object unchanged. Unsafe refresh requests
are rejected from Fetch Metadata by the same server-only factory used by the production
route, before its Kinde, HMAC configuration or Redis factories can be called; the pure
handler repeats the check as defense in depth.

Return destinations are parsed as same-origin URLs and canonicalized before checking the
decoded pathname separately from query and fragment. Exact or nested `/api`, `/auth` and
`/login` paths, dot-segment variants, repeatedly encoded or mixed-case dot segments,
backslashes and control characters all fall back to `/studio`; ordinary Studio/Portal
paths keep their query string and fragment.

The SDK is pinned to `@kinde-oss/kinde-auth-nextjs@2.12.2`; an upgrade requires re-auditing
`getAccessTokenRaw()`, `refreshTokens()`, cookie commit behavior, `isAuthenticated()`, setup,
logout and callback semantics. The pinned source and types were inspected locally:

- the Next.js wrapper types `refreshTokens` as `Promise<OAuth2CodeExchangeResponse>`;
- the transitive `@kinde-oss/kinde-typescript-sdk@2.13.2` defaults
  `commitToSession=true`;
- its commit path writes `refresh_token`, `access_token` and `id_token` through
  `sessionManager.setSessionItem`;
- the App Router session manager implements that writer with Next.js `cookies().set`, so
  the response cookie mutation precedes the boundary's `303`.

Tests deliberately inspect those installed, pinned sources and types. A dependency upgrade
that changes this contract must fail the test until it is reviewed. Application source is
also scanned so `refreshTokens()` remains callable only inside this dedicated boundary.

## Configuration

Preview/UAT must provision, without committing values:

- the existing `REDIS_URL`, isolated from production;
- `NOISIA_KINDE_REFRESH_BARRIER_HMAC_KEY`, a dedicated random value per environment;
- optionally `NOISIA_KINDE_REFRESH_BARRIER_TTL_SECONDS` (default `900`, accepted range
  `60..86400`).

Secret provisioning, Upstash identity verification and real Kinde behavior remain deferred
to an explicit Preview/UAT deployment gate.

## Consequences

- One expired browser session can produce at most one refresh-token exchange across
  replicas while its barrier record exists. Terminal replay is retained for the configured
  TTL and never starts another exchange.
- Only the request that performed the exchange can claim the rotated cookie commitment.
  Coordination waiters fail closed instead of following a redirect without those cookies.
- Refresh ambiguity prioritizes session safety over availability.
- Table-driven owner/waiter/replay coverage locks the `rotated`, `failed` and `ambiguous`
  terminal semantics: only the owner exchanges, and waiters/replays never do.
- Database authorization is never cached in the barrier. The boundary only redirects; the
  next protected request re-runs Kinde authentication and database-owned authorization,
  including suspended-user checks.
- The change does not add middleware, client refresh timers, hidden retries, token storage,
  new Redis infrastructure, migrations or M2M authority.
- The local two-process rehearsal proves the coordination contract with fakes; it is not
  evidence about real Kinde, Upstash, cookie propagation or Preview/UAT.
