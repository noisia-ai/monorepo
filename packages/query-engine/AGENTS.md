# AGENTS.md — packages/query-engine (@noisia/query-engine)

Shared engine logic: query packs, retrieval, coding, scoring/aggregation for the analysis
methodologies. Inherits the root `AGENTS.md`.

## Core principle

**Opus interprets · SQL scores · Voyage retrieves.** Any number that appears on a dashboard
must be **deterministic** (computed by SQL/code), never invented by the LLM. The LLM names,
classifies and writes editorial prose; it does not produce metrics.

## What's here

- `src/lens-query-packs.ts` (+ `.test.ts`) — builds the per-lens / per-scope query packs.
  `PRIMARY_LENS` defaults to `triggers-barriers`.
- `src/engine-aggregation.ts` — deterministic scorers. e.g. `scoreSentimentAdvocacy()`
  computes `advocacy_proxy = %promoters − %detractors` (used by the Entel NPS-bridge idea).
- `src/index.ts` — package surface.
- Engine multimethod pieces (methodology specs, registry, per-method scorers, retrieval/coding)
  largely live on the **`codex/live-intelligence-store` branch**, not on `main`. See
  `docs/BRANCHES.md` before extending the engine so you build on the branch, not from scratch.

## Reuse, don't reinvent thresholds

Real tuned thresholds already exist — reuse them: `classifyOwnership()` (0.55 / 0.45 / 35%),
`confidenceFromMentions()` (100 / 30). Don't hardcode new magic numbers for the same concepts.

## Cost & resilience (these are gates, not nice-to-haves)

- Coding costs real money (~$0.0029/mention). Per-method **cluster-first** detection exists in
  Signal Pulse precisely to keep a run under ~$5 instead of hundreds.
- Coding must be **resilient**: retry + skip a bad batch, never let one malformed batch tank a
  whole lens (tolerant parser). See Issue #2 for the incident this came from.

## SQL gotchas

- Qualify columns in Drizzle subqueries (an unqualified `${table.id}` rendered as a bare `"id"`
  and broke a subquery).
- `corpus_entities` has **`status`**, not `archived_at` — don't reference columns that don't exist.

Run `pnpm test` (this package has unit tests) and `pnpm typecheck` before committing.
