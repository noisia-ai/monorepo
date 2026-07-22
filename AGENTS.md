# AGENTS.md — Noisia monorepo

> Read this first. It is the entry point for any AI coding agent (Claude Code, Codex,
> Cursor, etc.) and for any human joining the repo. It is written as **operating
> instructions**, not prose. Nested `AGENTS.md` files override this one in their folder.

## Current branch priority: DATA OS CUT 1 sobre SIGNAL PULSE

This branch implements **Noisia Data OS Cut 1** on top of `codex/signal-pulse`: a live
client-owned data layer with source catalogs, Brand OS, Knowledge Base, taxonomies, tags,
quality checks, lineage and serving APIs in shadow mode.

Signal Pulse remains the first consumer surface: a tactical, marketing-first,
month-comparable report. The 16 multimethod engine lenses remain **PAUSED**. Do not build
new UI on top of them and do not break them; see GitHub Issue #2.

Branch-local canon:

- Data OS product spec: `docs/product/22_NOISIA_DATA_OS_CUT_1.md`.
- Data OS staging runbook: `docs/product/23_NOISIA_DATA_OS_STAGING_RUNBOOK.md`.
- Data OS technology/process benchmark: `docs/product/24_NOISIA_DATA_OS_TECH_BENCHMARK.md`.
- Data OS operator handoff: `docs/product/25_NOISIA_DATA_OS_STAGING_HANDOFF.md`.
- Data OS completion audit: `docs/product/26_NOISIA_DATA_OS_COMPLETION_AUDIT.md`.
- Data OS ADR: `docs/adr/007-noisia-data-os-cut-1.md`.
- Analysis artifact/evidence graph ADR: `docs/adr/008-analysis-artifact-evidence-graph.md`.
- Branch status: `docs/BRANCHES.md`.
- Production guardrails: `docs/AGENT_GUARDRAILS.md`.
- Schema canon: `docs/product/04_DATABASE_SCHEMA.md`, section "Data OS Cut 1".
- API contracts: `docs/product/08_API_CONTRACTS.md`, section "Data OS serving endpoints".

## What this repo is

Monorepo for **Noisia**, a social-intelligence / social-listening firm. Two products plus
shared packages:

- **Marketing site** (`apps/website`) — public Next.js site (scrollytelling, methodology pages, insights).
- **Studio** (`apps/studio`) — the internal/client product: corpora, analysis engine, Signal & Signal Pulse reports, team management, public reporting API.
- **Shared packages** (`packages/*`) + the async **workers** service (`services/workers`).

## Stack & tooling

- **pnpm workspaces** (`pnpm@10.33.2`) + **Turborepo** (`turbo.json`). Node via the codex runtime — see `docs/product/09_DEV_SETUP_GUIDE.md`.
- `apps/studio` & `apps/website`: **Next.js 15** App Router, TypeScript, global CSS (BEM-ish in `globals.css`, Tailwind base layer only — **no CSS modules**).
- DB: **Supabase Postgres** + **Drizzle** (`infrastructure/db`, package `@noisia/db`). Migrations are hand-verified SQL (see ⚠️ below).
- Auth: **Kinde** = authentication only; **our DB owns authorization** (roles/orgs/brand access). See `apps/studio/AGENTS.md`.
- Async: **BullMQ on Upstash Redis** (`services/workers`). LLMs: Anthropic (Claude). Embeddings: Voyage. Listening data: SentiOne CSV.

## Commands (run from repo root)

```bash
pnpm install
pnpm dev                 # turbo dev (all). Or scope it:
pnpm dev:studio          # Studio on :3001
pnpm dev:website         # marketing site
pnpm dev:workers         # REQUIRED for New Study / Engine flows (see workers AGENTS.md)
pnpm lint                # turbo lint
pnpm typecheck           # turbo typecheck   <- run before every commit
pnpm test                # turbo test
pnpm db:migrate          # @noisia/db
pnpm db:seed
```

**Definition of done for a change:** `pnpm typecheck` + `pnpm lint` green, and `pnpm test`
green for any package you touched. Studio/engine changes that touch runtime usually also
need a real run with workers up (they are not covered by unit tests).

## Where the knowledge lives (read before acting)

This repo separates **Canon** (current truth) from **History/Intent** (why things are the way they are). Don't treat a spec or a paused plan as shipped reality.

**Canon — how things are now:**
- `packages/kb/` — **the Knowledge Base**: Noisia's business definitions, methodologies, services, process, AI playbooks (`00-overview`, `01-methodologies`, `02-services`, `03-process`, `04-cases`, `05-ai-playbooks`). Start at `packages/kb/README.md`. This is the source of truth for *what the methodologies mean*.
- `docs/product/` — product & engineering docs. Key index: `00_README.md`, `01_PRODUCT_SPEC_MASTER.md`, `04_DATABASE_SCHEMA.md`, `06_TECHNICAL_DECISIONS.md`, `07_REPO_STRUCTURE.md`, `08_API_CONTRACTS.md`, `09_DEV_SETUP_GUIDE.md`. Methodology build specs live under `docs/product/10_methodology_seeds/` (`engine_comparative/` and `signal_pulse/`).
- `docs/adr/` — **Architecture Decision Records** (numbered). Add a new one when you make a structural decision. Existing: monorepo structure, auth/Supabase boundary, external-service deltas, TS compat, methodology slug/version uniqueness, Kinde roles & Studio permissions.
- `docs/api/` — public reporting API: `openapi.yaml`, `public-api-readme.md`.
- `packages/pitch-kit/` — **Pitch Kit**: build Noisia sales/pitch decks (PDF + editable PPTX) from a shared engine, a slide library (`slides/catalog.json`) and deck recipes (`slides/recipes.json`). For the commercial team. Invoke the skill `.claude/skills/noisia-pitch/SKILL.md` (Claude Code auto-discovers it; in Codex, read `packages/pitch-kit/AGENTS.md`). To make a deck just ask, e.g. *"arma un pitch de qué es Noisia"* or *"haz una presentación de Triggers & Barriers"*.
- The nested `AGENTS.md` files (this directory tree).

**History / intent — why (do NOT treat as current state):**
- `docs/HISTORY.md` — narrated history of every shipped commit on `main`, plus hard-won lessons.
- `docs/BRANCHES.md` — the two big unmerged branches (`live-intelligence-store`, `signal-pulse`) and how they relate.
- **GitHub Issues** (`noisia-ai/website`) — running context: `#1` Live Corpus/Sephora research, `#2` Engine multimétodo **PAUSED** runbook, `#4` Signal Pulse pre-prod checklist. Issues are the source of truth for *paused/in-flight* work.

## Data OS gates

For this branch, the cut is not ready for production PR/review until these pass:

```bash
corepack pnpm --filter @noisia/db typecheck
corepack pnpm --filter @noisia/db test
corepack pnpm --filter @noisia/studio typecheck
corepack pnpm --filter @noisia/studio test
corepack pnpm --filter @noisia/studio build
corepack pnpm data-os:verify
corepack pnpm data-os:staging-check
corepack pnpm data-os:staging-shadow
```

`data-os:staging-check` does not print secrets or UUIDs; it only confirms the staging
shadow environment is ready. `data-os:staging-shadow` must run against a real
staging/preview corpus/output before any internal serving switch, and the resulting
`data-os:release-gate` must report `ready_for_production_review: true` and the gate
`database_format_postgres_url` before client-visible activation.

If the local code checks are green but `data-os:staging-check` reports missing
`DATABASE_URL`, `NOISIA_REMOTE_DATABASE_TARGET`, corpus/output UUIDs or
`NOISIA_DATA_OS_STAGING_SHADOW_APPROVED`, stop at the handoff. Do not invent staging
evidence from local runs; use `docs/product/25_NOISIA_DATA_OS_STAGING_HANDOFF.md` to
collect the missing operator values.

Use `docs/product/26_NOISIA_DATA_OS_COMPLETION_AUDIT.md` before claiming the Data OS
Goal is complete. Local checks are necessary but not sufficient; completion requires a
staging/preview evidence pack with `release-gate.json` reporting
`ready_for_production_review: true` and `database_format: "postgres_url"`.

Operacion en espanol para este corte: `data-os:staging-check` no imprime secretos ni IDs;
solo confirma que el entorno esta listo para el shadow. `data-os:staging-shadow` ejecuta
shadow-run, analyze,
serving-smoke y evidence contra staging/preview. Data OS Cut 1 es aditivo: no borrar
`published_outputs.payload`, no hacer migraciones destructivas, y no activar live API para
clientes antes de shadow QA real.

## Safety guardrails (read `docs/AGENT_GUARDRAILS.md`)

Non-negotiable, enforced by `.github/` + `.gitignore`:

- **Never commit/push to `main`.** `main` deploys to prod. Always branch → PR → review → merge.
- **Never weaken authorization** to make something pass. Studio enforces authZ server-side in
  every route (`canManage*` helpers + ownership scoping) — if a guard blocks you, that's usually correct.
- **No secrets in git** (only `.env.example`). CI runs a secret scan; `.gitignore` covers all `.env*` + env backups.
- **Migrations are forward-only & hand-verified** (drizzle meta is drifted).
- **LLM runs cost real money** — surface a budget cap before queueing.

`docs/AGENT_GUARDRAILS.md` lists the **protected Studio surfaces** (auth, team/roles, DB,
public API, money pipelines, destructive/external routes, deploy) — the things to **never touch
casually**. `.github/CODEOWNERS` routes PRs on those paths to mandatory review.

## Conventions

- **Language:** UI copy is bilingual es-MX / en-US via `apps/studio/messages/*.json` (i18n). Code, comments and docs: match the file you're editing (much of this repo is Spanish-first in docs, English in code).
- **Commits:** short imperative subject (`Add …`, `Fix …`, `Implement …`). Group a feature into a few thematic commits, not one mega-commit, when practical.
- **Branches:** branch off `main` for prod-bound work. `main` is what deploys (Railway). Never push secrets or `.env*` files.
- **PRs:** run `/code-review` before merging engine/auth/money-touching changes.

## Landmines (read before you get burned)

- **Drizzle migration snapshots in `infrastructure/db/migrations/meta` are drifted** from the live DB. Running `drizzle-kit generate` spills pre-existing tables into the diff. **Always hand-verify generated SQL** and keep only the DDL you intend.
- **Do NOT re-add Kinde middleware** to `apps/studio`, and **do NOT enable `<Link>` prefetch** on protected routes — both reintroduce a prod login loop (Kinde refresh-token reuse detection). See `apps/studio/AGENTS.md` + ADR / `docs/HISTORY.md`.
- **Workers must be running** for New Study / Engine / Signal Pulse flows or the wizard hangs. See `services/workers/AGENTS.md`.
- **Money traps:** engine/pulse runs cost real Anthropic $. Show a budget cap before queueing, use resilient batches, and `ANALYZE` Postgres after big materializations. Details in Issue #2 and the engine AGENTS.md.
- Secrets pasted into chat historically should be rotated; never commit them.
