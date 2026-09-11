# AGENTS.md — apps/studio

> **Source fencing Brand Context UAT rollout marker — 2026-09-11.** SQL0159 se aplicó una sola
> vez después de un preflight sin actividad; SHA
> `0be97f5bc9dfe4c0b20e7347a828807bd6fb95a96582f7e97e5b158007bfc8e7`. Worker `f77a316`
> debe estar activo antes de este despliegue Studio. La UI reconcilia cambios de fuente, liga la
> confirmación a una cotización opaca exacta y recupera intentos DNC sin conceder autoridad ni gasto.

> **Brand Context composed UAT rollout marker — 2026-09-11.** SQL0156–0158 were applied
> exactly once to `noisia-staging`; do not reapply them. Worker `f13529e` was active before this
> Studio-only marker. The UI now exposes the free Claude proposal stage and a separate exact
> Voyage quote without auto-authorizing either provider; rollout itself creates no policy,
> admission, provider call or spend.

> **Preparación gratuita de corpus cliente cerrada LOCAL — 2026-09-11.** El paso `Preparar`
> usa el GET/POST workspace-scoped existente, conserva una clave idempotente ante respuesta
> incierta, hace polling sólo mientras hay una corrida activa y limpia todo al cambiar workspace o
> revocar acceso. No llama modelos, no reserva presupuesto y no amplía `can_execute_topics`.
> Studio953/946PASS/7skip, focal25/25, typecheck/lint/build y revisión sin P0/P1 cerrados.
> Entregar sólo como corte Studio; Brand Context/Voyage/Topics pagados siguen bloqueados hasta
> admisiones conjuntas atómicas.

> **Client processing policy UAT marker — 2026-09-11.** Studio and Worker run `485aed8`.
> SQL0155 has been applied once to `noisia-staging`; do not reapply it. No processing policy,
> admission or provider action is active. Client Data and Topics may read the simple processing
> journey; paid actions remain unavailable until their admissions are created atomically with the
> existing owners and ledgers. Read
> `docs/product/PROMPT_LOOPING/DELIVERY_CLIENT_PROCESSING_POLICY_UAT_2026-09-11.md`.

> **Ordered UAT rollout marker — 2026-09-11.** Commit `3782be7` requires SQL0154 and
> Worker rollout before Studio. SQL0154 has been applied once to `noisia-staging`; do not
> reapply it. This cut keeps the served topic catalog stable while client edits remain a
> pending working version, and it must not start imports, provider calls or analysis.

> **UAT Brand Context release marker — 2026-09-11.** SQL0153 was applied once to
> `noisia-staging` before application rollout; do not reapply it. Worker `44eeab5` was active
> before this Studio deployment trigger. The release adds automatic Brand Context preparation,
> exact context authority in Topics, multiple knowledge sources and searchable IANA timezones,
> with zero provider calls during delivery. Read
> `docs/product/PROMPT_LOOPING/DELIVERY_BRAND_CONTEXT_E2E_LOCAL_2026-09-11.md`.

Next.js 15 App Router product app (Studio + Signal + Signal Pulse + public reporting API).
Inherits the root `AGENTS.md`. Read that first. Runs on **:3001** (`pnpm dev:studio`).

## Auth — the #1 rule

**Kinde authenticates, our DB authorizes.** Roles/orgs/brand access come from Supabase, not
from the Kinde token (`lib/auth/session.ts`, `lib/auth/roles.ts`, `lib/auth/guards.ts`).

- **Do NOT add Kinde middleware** (`src/middleware.ts` was removed on purpose) and **do NOT
  enable `<Link>` prefetch** on protected routes (`prefetch={false}` everywhere). Both
  reintroduce a prod login loop via Kinde's refresh-token reuse detection. See `docs/HISTORY.md`
  Phase 4 and ADR `docs/adr/006-kinde-roles-and-studio-permissions.md`.
- Per-page guards (`requirePortalUser` / `getSignalOutputForUser`) protect routes, not middleware.
- Suspended users: `status==="suspended"` is rejected in guards; never overwrite role/org on upsert.

## Layout

- `src/app/` — routes. Notable: `signal/[outputId]` (Signal report + `/deck` press deck),
  `pulse/[outputId]` (Signal Pulse), `studio/**` (corpora, brands, themes, team, engine),
  `api/**` (incl. `api/public/v1` & `v2` reporting API, `api/corpora/[id]/engine-analysis`).
- `src/lib/` — `auth/`, `data/` (corpora, signal, team), `signal/` (build.ts, adapters, contracts),
  `signal-pulse/`, `reporting/` (public-api.ts), `queue/`, `validation/`, `csv/`.
- `src/components/` — `analysis/` (SignalComposer, TbAnalysisRunPanel), `engine/EngineWizard.tsx`,
  `signal/deck/` (DeckSlides/DeckCharts/DeckRuntime), `team/`, `brands/`, `filters/`.
- `messages/{es-MX,en-US}.json` — i18n. **Any user-facing string must be added to both.**
- `globals.css` — all styling (BEM-ish, no CSS modules). Press-deck styles in `signal/[outputId]/deck/deck.css` (prefixed `deck-`).

## Runtime flows need the workers service

New Study, Engine analysis and Signal Pulse runs enqueue jobs to Upstash. **Start
`pnpm dev:workers`** or the wizard hangs. See `services/workers/AGENTS.md`.

## Signal V2 — preserve the shared system

Before editing `/signal/{workspace}` read:

- `docs/product/38_SIGNAL_LOADING_AND_NAVIGATION_STANDARD.md`;
- `docs/product/42_SIGNAL_WORKSPACE_DATA_OWNERSHIP.md` when changing ingestion/serving;
- `docs/product/43_SIGNAL_V2_FRONTEND_SYSTEM.md` when changing UI;
- `docs/product/44_SIGNAL_WORKSPACE_DATA_PLANE_HANDOFF.md` for the current migration.

`SignalV2ModuleHeader`, the persistent shell/navigation, shared filters,
`SignalEChart`/runtime, module skeletons and `SignalEvidenceDrawer` are governed patterns.
Do not create per-module replacements. A backend migration must keep compact/paginated
serving; never hydrate Signal from a complete snapshot or `published_outputs.payload`.

## Press deck (Signal)

`signal/[outputId]/deck/page.tsx` renders a 16:9 view-only deck reusing the `deck-stage`
web component (`public/deck/deck-stage.js`). It has a custom `readonly` attr; the thumbnail
rail is feature-flagged off and enabled via `postMessage`. PDF export = `window.print()` (the
component has an `@media print` one-slide-per-page block). Use a plain `<a target="_blank">`,
**not** `<Link>` (prefetch loop).

## Before you commit

`pnpm typecheck && pnpm lint` from root. Studio has runtime behavior not covered by unit
tests — if you touched auth, engine, or a worker-backed flow, do a real run with workers up.
