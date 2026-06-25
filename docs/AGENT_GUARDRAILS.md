# AGENT GUARDRAILS — safety rules for humans and AI agents

> **Canon.** These are the safety boundaries for this repo. They follow 2026 state-of-the-art:
> the effective guardrails live at the **infrastructure level** (branch protection, CODEOWNERS,
> CI, `.gitignore`), not just in prompts — a confused context window or prompt injection cannot
> bypass a protected branch or a required check. This file documents what's enforced and what an
> agent must never do on its own.

## The golden rules

1. **Never commit or push directly to `main`.** `main` deploys to prod (Railway). All changes go
   through a **branch → PR → review → merge**. This applies to agents *and* humans.
2. **Never weaken authorization to make something work.** If a guard blocks you, that's usually
   correct — escalate, don't delete the check.
3. **Never put secrets in git.** No `.env*` (except `.env.example`), no keys in code, configs, or
   agent files. If a secret was exposed, rotate it.
4. **Migrations are forward-only and hand-verified.** The drizzle snapshot meta is drifted (see
   root `AGENTS.md`); a generated migration can silently re-create or drop tables.
5. **Spending real money (LLM runs) requires a visible budget cap first.** See money pipelines below.

## What is enforced where (defense in depth)

| Layer | Control | Where |
|-------|---------|-------|
| Repo | `.env*` ignored, env backups ignored, only `.env.example` allowed | `.gitignore` |
| Merge | PR required, Code Owner review on sensitive paths | `.github/CODEOWNERS` + branch protection |
| Merge | `typecheck` + `lint` + `test` + **secret scan** must pass | `.github/workflows/ci.yml` |
| PR | Publishing checklist (sensitive-area flags, deploy plan) | `.github/pull_request_template.md` |
| Docs | This file + nested `AGENTS.md` | repo-wide |

### Branch protection to enable on GitHub (one-time, by a human admin)

Repo files can't set this — an admin must turn it on for `main` (Settings → Branches / Rules):
- ✅ Require a pull request before merging
- ✅ Require review from **Code Owners**
- ✅ Require status checks to pass → select **`ci`**
- ✅ Require branches to be up to date before merging
- ✅ Block force pushes & deletions; **do not allow bypassing** the above (include admins)
- ✅ (optional, recommended) Require linear history + signed commits

Until this is on, the rules above are convention only. **Turn it on.**

---

## What Studio does, and what must be protected (never touch casually)

`apps/studio` is the product. Its security model: **Kinde authenticates; our DB authorizes**, and
**every API route enforces authorization server-side** via role helpers
(`canAccessStudio` / `canAccessPortal` / `canManageCorpus` / `canManageTeam`) plus
ownership scoping (`getCorpusForUser`, `getSignalOutputForUser`). The danger is not the happy path
— it's quietly removing one of these checks. Protected surfaces, in priority order:

### 🔴 1. Auth & authorization — `apps/studio/src/lib/auth/**`
The decision core: `session.ts` (identity + role from DB), `roles.ts` (`canManage*`, `bootstrapRoleForEmail`),
`guards.ts` (suspended/role redirects), `org-sync.ts`, `redirects.ts`. Every route trusts these.
**Rules:** don't move authZ back into the Kinde token; don't broaden a `canManage*`; don't add
Kinde middleware; keep the `status==="suspended"` rejection. Any change → Code Owner review.

### 🔴 2. Team / role mutation — `apps/studio/src/app/api/team/**`, `lib/data/team.ts`
`team/users/[id]` changes roles (privilege-escalation surface — note the self-demotion guard:
an admin can't strip their own `noisia_admin` or suspend themselves), `team/invitations/**` grants
access by email. A bug here = account takeover. Gated by `canManageTeam` (noisia_admin only). Don't loosen it.

### 🔴 3. Database — `infrastructure/db/**`
Schema + migrations `0001..00NN`. Prod data is irreversible. Forward-only, hand-verify generated
SQL (drizzle meta drift), include the apply plan + `ANALYZE` in the PR.

### 🟠 4. Public reporting API — `api/public/v1`, `api/public/v2`, `lib/reporting/**`, `docs/api/**`
External, customer-facing contract with **visibility/redaction** (paid data hidden, internal tabs
hidden from clients, customer-neutral docs). Breaking it leaks data or breaks integrators (Looker,
ReadMe webhook). Version changes; never silently alter v1 output or remove a redaction.

### 🟠 5. Money pipelines — `corpora/run-engine`, `corpora/[id]/tb-analysis`, `packages/query-engine`, `services/workers`
These enqueue LLM jobs that cost real Anthropic dollars (~$0.0029/mention coded; a careless run ≈ $87).
**Always surface a budget cap before queueing**, use resilient (retry+skip) batches, `ANALYZE` after
materializations, and run a single worker instance (zombie workers — see `services/workers/AGENTS.md`).

### 🟡 6. Destructive & external-side-effect routes
- Destructive: `corpora/[id]/cleanup/apply`, `snapshots/[snapshotId]/restore`, and any `DELETE`
  (brands/themes/orgs). Confirm intent; they mutate or wipe corpus data.
- External: `signal/[outputId]/share` (sends email via Resend), `readme/personalized-docs` (webhook).
  These reach the outside world — don't trigger them as a side effect of testing.

### 🟡 7. Deploy & infra — `.github/**`, `supabase/config.toml`, Railway config, `turbo.json`
Changing CI, the secret-scan, or deploy descriptors changes the safety perimeter itself. Code Owner review.

---

## Quick decision guide for an agent

- About to `git push origin main`? **Stop.** Make a branch + PR.
- A guard/check is in your way? **Don't delete it.** Ask, or find the authorized role path.
- Editing anything under §1–§7 above? Flag it in the PR template and expect Code Owner review.
- Generated a migration? Read every line; keep only intended DDL; note the apply plan.
- About to run an engine/pulse job? Confirm the budget cap is shown and the worker is the only instance.
- See a secret in the diff or a tracked `.env`? Remove it, rotate it, tell the user.
