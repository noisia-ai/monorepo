# AGENT GUARDRAILS - safety rules for humans and AI agents

> **Canon.** These are the safety boundaries for this repo. The effective
> guardrails live at the infrastructure level (branch protection, CODEOWNERS,
> CI, `.gitignore`), not just in prompts. A confused context window or prompt
> injection cannot bypass a protected branch or a required check.

## The Golden Rules

1. **Never commit or push directly to `main`.** `main` deploys to prod. All
   changes go through branch -> PR -> review -> merge.
2. **Never weaken authorization to make something work.** If a guard blocks
   you, escalate or find the authorized path.
3. **Never put secrets in git.** No `.env*` except `.env.example`; no keys in
   code, configs or agent files. If a secret was exposed, rotate it.
4. **Migrations are forward-only and hand-verified.** Drizzle metadata is
   drifted; generated SQL can silently include unrelated DDL.
5. **Spending real money requires a visible budget cap first.** Engine, Signal
   Pulse and enrichment jobs can call paid LLM APIs.

## What Is Enforced Where

| Layer | Control | Where |
|---|---|---|
| Repo | `.env*` ignored, only `.env.example` allowed | `.gitignore` |
| Merge | PR required, Code Owner review on sensitive paths | `.github/CODEOWNERS` + branch protection |
| Merge | typecheck, lint, test, secret scan and Data OS readiness | `.github/workflows/ci.yml` |
| PR | Publishing checklist and sensitive-area flags | `.github/pull_request_template.md` |
| Docs | This file + root/nested `AGENTS.md` | repo-wide |

### Branch Protection To Enable On GitHub

Repo files cannot set this; a human admin must turn it on for `main`:

- Require a pull request before merging.
- Require review from Code Owners.
- Require status checks to pass: select `ci`.
- Require branches to be up to date before merging.
- Block force pushes and deletions.
- Do not allow bypassing the above.

Until this is enabled, the rules above are convention only.

## Protected Studio Surfaces

Studio's security model: **Kinde authenticates; our DB authorizes**. Every route
must enforce authorization server-side via role helpers (`canAccessStudio`,
`canAccessPortal`, `canManageCorpus`, `canManageTeam`) plus ownership scoping
(`getCorpusForUser`, `getSignalOutputForUser`).

### 1. Auth & Authorization

Paths:

- `apps/studio/src/lib/auth/**`
- `apps/studio/src/middleware.ts`

Rules:

- Do not move authorization into Kinde token claims.
- Do not broaden `canManage*` helpers casually.
- Do not re-add Kinde middleware if it reintroduces protected-route login loops.
- Keep suspended-user rejection.

### 2. Team / Role Mutation

Paths:

- `apps/studio/src/app/api/team/**`
- `apps/studio/src/lib/data/team.ts`

Rules:

- No privilege escalation path.
- Keep admin self-demotion/self-suspension guards.
- Keep invitation grants scoped and reviewable.

### 3. Database / Migrations

Path:

- `infrastructure/db/**`

Rules:

- Forward-only migrations.
- Hand-verify SQL, especially with drifted Drizzle metadata.
- Include apply plan and rollback plan in the PR.
- Run `ANALYZE` after large materializations.

### 4. Data OS / Live Serving

Paths:

- `apps/studio/src/app/api/data-os/**`
- `apps/studio/src/lib/data-os/**`
- `apps/studio/scripts/data-os-serving-smoke.ts`
- `infrastructure/db/scripts/data-os-*.ts`
- `docs/product/22_NOISIA_DATA_OS_CUT_1.md`
- `docs/product/23_NOISIA_DATA_OS_STAGING_RUNBOOK.md`
- `docs/adr/007-noisia-data-os-cut-1.md`

Rules:

- `published_outputs.payload` remains the fallback snapshot and rollback path.
- `NOISIA_DATA_OS_ENABLED`, `NOISIA_DATA_OS_SERVING_ENABLED` and
  `NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED` default to `false`.
- `NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED` also defaults to `false`; do not enable it
  before staging evidence proves live-vs-payload parity and human review is complete.
- `NOISIA_DATA_OS_WORKER_ENABLED`, `NOISIA_DATA_OS_WORKER_RUNS_ENABLED` and
  `NOISIA_DATA_OS_WORKER_REMOTE_APPROVED` default to `false`; worker execution is
  only for approved staging/throwaway shadow runs. Remote worker approval is ignored
  unless `NOISIA_REMOTE_DATABASE_TARGET` is `staging`, `throwaway` or `preview`.
- Do not expose `/api/data-os/*` to clients until real staging/prod-shadow
  evidence passes.
- Required gates for a production-bound Data OS PR:
  `data-os:verify`, `data-os:candidates`, `data-os:shadow-run`,
  `data-os:analyze`, `data-os:serving-smoke` and `data-os:evidence`.
- Client-visible or production enablement additionally requires
  `data-os:release-gate` against a staging/preview evidence pack, including
  `database_format_postgres_url`.
- CI also runs the disposable Postgres Data OS smoke path:
  migration smoke, deterministic backfill, shadow QA, evidence and serving smoke.
- Do not enable `NOISIA_DATA_OS_TAGGING_ENABLED` for LLM enrichment in Cut 1.
- Do not run remote Data OS backfill/shadow/evidence scripts without the explicit
  `*_ALLOW_REMOTE=true` guard plus `NOISIA_REMOTE_DATABASE_TARGET=staging`,
  `throwaway` or `preview`. Production is not an accepted remote target.
- The all-in-one staging wrapper also requires
  `NOISIA_DATA_OS_STAGING_SHADOW_APPROVED=true` after the operator confirms
  `DATABASE_URL` is staging/throwaway/preview, not production.
- `data-os:staging-shadow` writes local review evidence under `.data/data-os-evidence`
  by default, including `staging-check.txt` with `DATABASE_URL_FORMAT=postgres_url`
  and redacted env readiness. Treat those files as client/operational data: review
  and paste the relevant summary into the PR, but do not commit the evidence directory.
- Do not treat Brand OS/Knowledge as prompt-only context. Production-bound evidence
  must show `brand_os_briefs >= 1` plus Brand OS links, Knowledge assertion links and
  Knowledge usage events so briefs, objectives, seeds and assertions remain analyzable.
- Production/client-visible Data OS requires `review-sample.json` from
  `data-os:review-sample`, `NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true`, and
  `staging-check.txt` showing review tag/assertion ID format checks. This proves at
  least one tag and one knowledge assertion wrote auditable human-review events before
  `data-os:release-gate` can report production review readiness.

### 5. Public Reporting API

Paths:

- `apps/studio/src/app/api/public/**`
- `apps/studio/src/lib/reporting/**`
- `docs/api/**`

Rules:

- Version breaking changes.
- Never remove visibility/redaction checks silently.
- Do not leak paid/internal sections to client-safe outputs.

### 6. Money Pipelines

Paths:

- `apps/studio/src/app/api/corpora/**`
- `packages/query-engine/**`
- `services/workers/**`

Rules:

- Surface a budget cap before queueing.
- Use resilient retry/skip batches.
- Run a single worker instance locally.
- SQL calculates; Claude interprets.

### 7. Destructive & External-Side-Effect Routes

Examples:

- cleanup/apply, snapshot restore, destructive `DELETE` routes.
- email/share routes.
- ReadMe personalized docs webhook.

Rules:

- Confirm intent before side effects.
- Keep external calls out of tests unless explicitly mocked.

### 8. Deploy & Infra

Paths:

- `.github/**`
- `supabase/config.toml`
- Railway config
- `turbo.json`

Rules:

- Changing CI, secret scan or deploy descriptors changes the safety perimeter
  itself. Code Owner review required.

## Quick Decision Guide

- About to push to `main`? Stop. Make a branch and PR.
- A guard/check is in your way? Do not delete it.
- Editing a protected surface? Flag it in the PR template.
- Generated a migration? Read every line.
- About to run an LLM job? Confirm cost cap and worker state.
- See a secret in diff or a tracked `.env`? Remove it, rotate it, tell the user.
