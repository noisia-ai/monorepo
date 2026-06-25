<!--
Publishing conditions. A PR is the ONLY path to `main` (which deploys to prod).
No direct pushes to main. Fill this out — reviewers gate on it.
Full rules: docs/AGENT_GUARDRAILS.md
-->

## What & why


## Pre-merge checklist (required)

- [ ] Branch is **not** `main`; this is a PR (no direct push to prod).
- [ ] `pnpm typecheck` green
- [ ] `pnpm lint` green
- [ ] `pnpm test` green for every package I touched
- [ ] No secrets / `.env*` files in the diff (CI secret-scan must pass)
- [ ] If runtime/engine/worker flow changed: I ran it locally with `pnpm dev:workers` up

## Sensitive areas — tick if touched, and explain below

- [ ] **Auth/authz** (`apps/studio/src/lib/auth/**`, middleware) — Code Owner review required
- [ ] **DB schema / migrations** (`infrastructure/db/**`) — migration hand-verified (drizzle meta is drifted), forward-only, applied plan noted
- [ ] **Public API** (`api/public/**`, `lib/reporting/**`) — contract + visibility/redaction unchanged or versioned
- [ ] **Team/roles** (`api/team/**`) — no privilege-escalation path opened
- [ ] **Money pipelines** (`corpora/run-engine`, `tb-analysis`, query-engine, workers) — budget cap surfaced before queueing
- [ ] **Deploy/infra** (`.github/**`, `supabase/config.toml`, Railway) 

### Notes on the above


## Deploy / migration plan (if prod-affecting)

<!-- migrations to apply, env vars, ANALYZE, worker redeploy, Upstash plan -->
