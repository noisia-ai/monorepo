# AGENTS.md — apps/studio

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

## Press deck (Signal)

`signal/[outputId]/deck/page.tsx` renders a 16:9 view-only deck reusing the `deck-stage`
web component (`public/deck/deck-stage.js`). It has a custom `readonly` attr; the thumbnail
rail is feature-flagged off and enabled via `postMessage`. PDF export = `window.print()` (the
component has an `@media print` one-slide-per-page block). Use a plain `<a target="_blank">`,
**not** `<Link>` (prefetch loop).

## Before you commit

`pnpm typecheck && pnpm lint` from root. Studio has runtime behavior not covered by unit
tests — if you touched auth, engine, or a worker-backed flow, do a real run with workers up.
