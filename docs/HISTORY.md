# HISTORY — what shipped on `main`, and what we learned

> **This is History/Intent, not Canon.** It explains *why* the repo looks like it does.
> For current truth read `packages/kb/`, `docs/product/`, `docs/adr/`, and the nested
> `AGENTS.md` files. For unmerged/in-flight work see `docs/BRANCHES.md` and the GitHub Issues.
>
> Scope: every commit currently on `main` (prod), newest → oldest, grouped into phases.
> `main` had 67 commits at the time of writing (HEAD `7637d8f`).

## Phase 1 — Marketing site is born (commits `014fe39` → ~`8e49908`)

The repo started as **just the marketing website** (`apps/website`).

- `014fe39` Initial Noisia website → `7f8b3a8`/`33833ad`/`1e60d42` Railway deployment prep + guide (prod runs on **Railway**, `next start`).
- `9b46da2` / `72d94a5` mobile console sections, Google Sans loading, iOS scroll lock.
- `8c48e7e` **editorial redesign** — methodologies, cases, services.
- `3d9eb7c` diagnostic wizard + services pricing + Field Notes removal; `19ad678` `<a>`→`<Link>` in the wizard success screen.
- `ffcbd57` **docs: knowledge-base** — first version of the operational KB "for humans and AIs" (this seeded `packages/kb/`).
- `8e49908` first Noisia insights report.
- Hero scrollytelling work: `cbfb088` typography/blur perf → `20737ec` **converted the pinned-scrub hero to natural scroll** → `6a55e85`/`f8caf58` tighter spacing & entry mirroring.

## Phase 2 — Marketing polish & launch hardening (`4e513ce` → `7637d8f`-era marketing)

- `4e513ce` hidden `/dashboards` section + **Grupo Salinas demo**.
- `af9626c` insights report **lifecycle + print layout**; `4a5a733` "Future is Human" report; `d9bb019` insights QA.
- Long polish run for production: `cc75432`, `f57ffee` mobile hero/CTA, `3679387` insights hero/slugs, `b2acbfb` Mexico-launch copy, `1891544` sources/industry alerts, `86679ef`/`46e672a` home layout, `e57371a` editorial styling, `612b25d`/`e70eb8d` marketing + footer, `5238cba`/`3134374` contact form & footer.
- `525eb78` insights index redesign, `6824e85` Mexican Home insight, `7368c0d` calendar link, `052a492` transparent hero assets.
- `c57e6b3` Google Analytics, `7d587ce` SEO metadata & crawl signals.

## Phase 3 — Studio is added to the monorepo (`78aedaf` and after)

This is the inflection point: the repo became a real monorepo.

- `78aedaf` **Add Noisia Studio monorepo** — `apps/studio` + shared packages + `services/workers` land.
- `1f985c0` healthcheck liveness-only; `aadbe45` Website Railway config fix.
- `ecc6f49` **Studio i18n foundation** (es-MX / en-US message catalogs).
- `87727fd` first **public reporting API**.
- `9d86ab7` **Rebuild Signal corpus intelligence pipeline** — the Signal report engine.

## Phase 4 — Auth rearchitecture & the login-loop saga (`263aa11` → `fff190a`)

The most painful, best-documented sequence. (Full detail also in agent memory + ADR 006.)

- `263aa11` **Rework Studio/Signal auth: Kinde = authentication only, our DB owns authorization** + team management (invitations table, roles, orgs).
- `b36cbcb` **Remove Kinde middleware** — it caused a prod login loop (middleware refreshes + rotates the refresh token, then per-page guards refresh again with the consumed token → session invalid → `/login` loop). **Do not re-add.**
- `1549dfc` **Disable `<Link>` prefetch** on protected routes — prefetch fired concurrent requests that tripped Kinde's **refresh-token reuse detection**, nuking the session. Fix = `prefetch={false}` on all internal protected links. **Do not re-enable.**
- `fff190a` send unauthenticated users straight to Kinde.
- → Net rule, enforced everywhere since: **no Kinde middleware, no prefetch on protected `<Link>`s.** See `apps/studio/AGENTS.md`.

## Phase 5 — Signal press deck + sharing + email (`f4070df` → `3201748`)

- `f4070df` **Signal press deck export** — 16:9 (1920×1080) view-only deck of a Signal report with PDF-via-print, reusing the team's `deck-stage` web component (added a `readonly` attr + feature-flagged thumbnail rail).
- `f6fe388` preserve deck language through login; `7e16b8c` **deck sharing invites**; `5c6c03f` invite email fallback; `2875ced` default email sender; `3201748` fix invite links & share resend; `a4233bd` T&B study size controls.

## Phase 6 — Public reporting API v2 & admin (`d6ee5eb` → `c117353`)

- `d6ee5eb` **public reporting API v2** (+ `docs/api/openapi.yaml`); `55e92db` make API docs customer-neutral; `60512bb` **ReadMe personalized-docs webhook**.
- `c117353` **Studio admin cleanup controls** — manage orgs/brands/themes/users from Studio.

## Phase 7 — Engine hardening & corpus reuse (`34dd941` → `7637d8f`)

- `34dd941` **Implement industry corpus reuse and engine hardening** — the largest single commit on `main` (~6.7k insertions): `corpus_entities`, baseline/snapshot aggregates, CSV mentions ingest worker, T&B steps reworked (open-pass / comparative / synthesis), migrations `0019`–`0024`, plus the `engine_comparative` methodology seed docs (`00_FAMILY_FRAMEWORK` … `16_*`, `99_BUILD_SPEC_FOR_CODEX`).
- `9b2180f` step6-only synthesis rescue script; `2b702b5` fix Signal corpus facets for baseline scopes; `9045025` Signal demo-mode blur controls; `7637d8f` doc tweak.

---

## Hard-won lessons (carry these forward)

These came out of real prod incidents and long debugging sessions. They are not obvious from the code.

1. **Auth:** Kinde authenticates, our DB authorizes. No Kinde middleware. No prefetch on protected links. Kinde has no toggle to disable refresh-token reuse detection. (Phase 4.)
2. **Drizzle migration drift:** `infrastructure/db/migrations/meta` is out of sync with the live DB; `drizzle-kit generate` produces bloated diffs that re-create existing tables. Hand-trim every generated migration. (e.g. migration `0018` was hand-trimmed.)
3. **Workers are mandatory for runtime flows.** New Study "Analizando Knowledge Base" + Engine `compose_initial_query` enqueue Upstash jobs; with no worker the wizard hangs ~4–5 min then "Load failed". Queue is **Upstash** (remote, shared), dev queue name `noisia-query-engine-local`. Liveness is a heartbeat key (`noisia:worker-alive:<queue>`, TTL 45s) because Upstash `CLIENT LIST` is unreliable.
4. **Worker zombies:** orphaned workers with stale code can silently consume jobs for hours. `pkill` patterns only match some entrypoints — check `ps aux | grep preflight.cjs` before any engine run, and run a single instance.
5. **Postgres stats:** after a big materialization (e.g. `mention_query_sources` at 434k rows) the planner picked rows=1 and the retrieve step timed out. **`ANALYZE` fixed it** (timeout → 0.8s). Always ANALYZE post-materialization.
6. **LLM cost is real money.** Engine coding ≈ $0.0029/mention; a careless "run all lenses" can be ~$87. Always surface a budget cap before queueing and use resilient (retry+skip) batches so one bad batch doesn't tank a run. (Issue #2.)
7. **Secrets** were pasted in chat during early sessions (Kinde, Postgres, Supabase service-role, Anthropic/Resend/Voyage/SentiOne) — rotate, never commit.
