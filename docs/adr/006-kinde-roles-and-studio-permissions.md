# ADR 006: Kinde roles and Studio permissions

## Status

Accepted for MVP.

## Context

Noisia Studio is an internal analyst platform. Clients will authenticate with Kinde, but they should not operate the query engine, inspect raw corpora, or access maintenance workflows. The client-facing surface will consume published outputs through a separate portal layer.

The database already has `users`, `user_brand_access`, brands, themes, and corpora. Kinde is the identity provider, while brand/corpus/theme authorization remains app-level because access depends on Noisia study configuration and client contracts.

## Decision

Use four canonical app roles:

- `noisia_admin`
- `analyst`
- `client_admin`
- `client_viewer`

Kinde role keys should match those exact values. Legacy roles are normalized in app code so current internal users keep access while Kinde role assignment is completed:

- `founder`, `admin`, `kam` -> `noisia_admin`
- `insights_manager`, `ux_data_specialist` -> `analyst`
- `client_owner`, `brand_manager` -> `client_admin`
- `agency_insights` -> `client_viewer`

Studio routes require an internal role (`noisia_admin` or `analyst`). Access to a specific brand/corpus/theme still goes through `user_brand_access` and the existing data helpers. Clients are blocked from `/studio` and from internal corpus APIs even when they have brand access.

After Kinde login, the app sends internal users to `/studio` and client users to `/portal`. `/portal` is intentionally thin in MVP: it proves the auth split and shows assigned brands, but it does not expose raw corpus data or unpublished analysis.

For invited client users, the app attempts to resolve the active Kinde organization against Noisia `organizations` by:

1. `NOISIA_KINDE_ORG_MAP` entries (`org_code:organization_slug`)
2. Kinde `orgCode` matching an organization slug
3. Kinde `orgName` matching organization slug/legal/display name after slug normalization

When a client organization is resolved, the session sync creates `user_brand_access` rows for active brands in that organization:

- `client_admin` -> `comment`
- `client_viewer` -> `read`

This is a bootstrap path for MVP, not the final invitation model.

## Consequences

- Analysts can operate the engine, ingestion, evaluation, cleanup, snapshots, and mentions browser.
- Client users can exist in Kinde and in the database; they are redirected to `/portal` after login and to a custom unauthorized screen if they try to enter Studio.
- Client output APIs must be implemented separately instead of reusing raw Studio APIs.
- Invitations should create Kinde users with a canonical role and, for now, rely on Kinde organization mapping to bootstrap `user_brand_access`.

## Follow-ups

- TODO mejora-futura: replace the temporary database-role preservation fallback with Kinde Management API/webhook sync once invitations and organizations are fully modeled.
- TODO mejora-futura: add output-scoped APIs under `/portal` that expose only published deliverables.
- TODO mejora-futura: store Kinde organization IDs on Noisia organizations and validate organization membership alongside app-level brand access instead of matching by slug/name.
- TODO mejora-futura: replace automatic org-wide brand grants with invitation-scoped brand/theme permissions.
