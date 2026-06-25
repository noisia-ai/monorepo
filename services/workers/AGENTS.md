# AGENTS.md — services/workers (@noisia/workers)

BullMQ workers that run the async pipelines (KB processing, query compose, T&B steps, engine
steps, Signal Pulse). Inherits the root `AGENTS.md`.

## You must run this for Studio runtime flows

```bash
pnpm dev:workers          # from repo root  (or: pnpm --filter @noisia/workers dev)
```

Without it, Studio's New Study ("Analizando Knowledge Base", `process_knowledge_sources`) and
Engine (`compose_initial_query`) enqueue jobs that nobody consumes → the wizard hangs ~4–5 min
then "Load failed". Compose itself takes ~60–75s (Anthropic brief + query) — that's normal, not stuck.

## Queue facts (Upstash, not local Redis)

- Queue is **Upstash Redis** (remote, shared). Dev queue name: **`noisia-query-engine-local`**
  (base `noisia-query-engine` + `-local` suffix when `NODE_ENV=development`, set in
  `apps/studio/.env.local`). The worker inherits env from `apps/studio/.env.local`
  (`override:true`) so Studio and worker agree on the suffix.
- **Liveness = heartbeat key**, not `CLIENT LIST`. `queue.getWorkers()` / `CLIENT LIST` is
  unreliable on Upstash (returns 0 even when alive). The worker writes
  `noisia:worker-alive:<queueName>` (TTL 45s) every 15s; `/api/jobs/[id]` reads it as `worker_alive`.

## Operational landmines

- **Run a single worker instance.** Orphaned "zombie" workers with stale code can consume jobs
  for hours. `pkill` patterns miss some entrypoints — **check `ps aux | grep preflight.cjs`**
  before any engine run, and kill strays.
- After a big materialization, **`ANALYZE`** the affected tables. Stale Postgres stats once made
  the planner pick rows=1 and the retrieve step timed out; ANALYZE took it from timeout → 0.8s.
- `process_knowledge_sources` is robust (extractive fallback if Claude fails). Engine/Pulse steps
  are the expensive ones — respect the budget cap before queueing.

## Layout

- `src/workers/` — one file per step (`compose-initial-query`, `analysis-rag-context`,
  `apply-query-adjustments`, `mentions-csv-ingest`, `tb-language`, `tb-step-1-open-pass`,
  `tb-step-5-comparative`, `tb-step-6-synthesis`, `cleanup-preview`, `signal-pulse-*`).
- `src/queues/`, `src/db/client.ts`, `src/index.ts`. One-off rescue scripts in `scripts/`
  (e.g. `rerun-step6-only.mts`, `resume-tb-from-step3.mts`).
- Engine 6-step pipeline (preflight→retrieve→code→score→synthesize→quality_gates) lives mostly
  on the `codex/live-intelligence-store` branch — see `docs/BRANCHES.md`.

Run `pnpm test` (worker tests exist) and `pnpm typecheck` before committing.
