# BRANCHES & ISSUES — unmerged work and where the rest of the history lives

> **History/Intent, not Canon.** None of this is in prod. `main` is the only thing that
> deploys. Two large feature branches carry months of work that has **not** been merged.
> Read this before you branch, so you don't rebuild something that already exists on a branch.

## TL;DR of the branch topology

```
main (prod, HEAD 7637d8f)
 └─ codex/live-intelligence-store   ← Engine multimétodo (16 lenses). PAUSED. 11 commits over main.
      └─ codex/signal-pulse         ← Signal Pulse (one simpler report). Built ON TOP of the above.
                                      Contains all of live-intelligence-store + ~93 commits of its own.
```

Verified with `git rev-list --left-right --count`:
- `main…live-intelligence-store` = 1 / 11 (branch is 11 ahead; main's 1 is a later doc tweak).
- `live-intelligence-store…signal-pulse` = 0 / 93 → **signal-pulse is a strict superset** of live-intelligence-store.

So the infra/migrations of the Engine live on `live-intelligence-store`; `signal-pulse`
inherits all of it and adds the tactical report on top. **Neither is merged → nothing in prod.**

---

## Branch A — `codex/live-intelligence-store` · "varios métodos a medio implementar" · ⏸️ PAUSED

The **Engine multimétodo**: a family of 16 reusable comparative methodologies ("lentes")
that all consume the same base model (`corpus + entities + baseline + findings + citations`)
and only differ in how they group / score / visualize.

- **Status:** PAUSED **2026-06-09** by a direction change (a new, simpler methodology was
  designed instead → that became Signal Pulse). Pushed to origin, **not merged to main**.
- **Source of truth to resume (read before touching the Engine):**
  `docs/product/10_methodology_seeds/engine_comparative/98_PROD_READINESS_TRACKER.md`
  and **Issue #2** (checkboxes + ops runbook + money-trap accounting).
- **What's built & validated** (real end-to-end run on the Takis corpus, Claude live):
  wizard (lens selection) → `analysis_plan` → per-lens/scope query packs → CSV provenance +
  fan-out → retrieve → resilient batch coding → score → editorial synthesize → quality gates →
  live signals (`canonical_signals` + observations + evidence) → Live Composer.
  Two lenses fully in `needs_review`: **narrative-ownership** (1,136 findings) and
  **sentiment-advocacy** (1,071), 2,207 live signals with cited evidence.
- **Known gaps at pause:** `engine-step-synthesize.ts` is partly a stub for some methods;
  3 lenses (VPM / trust-risk / JFM) weren't run for lack of Anthropic budget; method-specific
  render in `/signal` and per-lens query packs are incomplete. Spec to close the gap:
  `engine_comparative/97_SIGNAL_RENDER_AND_COMPOSER_SPEC.md`.
- **Key commits on the branch:** `88989cb` DB (migrations 0025–0033) · `2c6e47b` query-engine
  runtime + resilient parser · `6eaa551` workers 6-step pipeline · `37d24ae` Studio wizard/APIs/Live
  Composer · `708528c` docs + readiness tracker.
- **Design docs:** `docs/product/10_methodology_seeds/engine_comparative/` (`00_FAMILY_FRAMEWORK`,
  `01`–`16` per-method, `99_BUILD_SPEC_FOR_CODEX`).

**Principle for this engine:** *Opus interprets, SQL scores, Voyage retrieves* — dashboard
numbers are always deterministic. Engine LLM = `claude-opus-4-8` via `ANTHROPIC_MODEL_ENGINE`.

## Branch B — `codex/signal-pulse` · "un método más simple" · Issue #4 (pre-prod validation)

**Signal Pulse**: a tactical, marketing-first report (the buyer is Marketing — KAM / Brand
Manager / Insights Mgr — who wants creative ammunition: what to post, trends, reinvented
wordcloud/donut), **not** a product/CX improvement. It does **not** replace T&B; it's the
tactical layer. It is the **current priority** (since 2026-06-12), which is why the 16-lens
engine was paused.

- **Built on top of** `codex/live-intelligence-store` (the engine infra/migrations live there).
- **Spec package:** `docs/product/10_methodology_seeds/signal_pulse/` (audited; docs 43–45 have
  precedence: 43 = decisions, 44 = data contract vs real schema, 45 = Production Cut 1).
- **Closed decisions (don't reopen):** SP signals in `canonical_signals`
  (`methodology_slug='signal-pulse'`); runs reuse `engine_analyses` (queue/ledger/locks);
  **cluster-first** detection (embeddings+clustering in a worker, Claude only names/interprets
  clusters → <$5/run instead of ~$470 per-mention); fixed versioned `impact_v1`; galaxy layout
  precomputed to `chart_aggregates`; output = `published_outputs.kind='signal_pulse'` at
  `/pulse/[outputId]`; new tables in migration `0034+` (`report_periods`,
  `signal_period_metrics`, `marketing_moves`, `chart_aggregates`).
- **Status (Issue #4):** implementation complete + audited (235 tests green). Remaining is
  **validation, not construction**: real-data run (Takis + 12-mo performance, <$5,
  `sp_metrics` <5min — watch the known N+1 of 1 query per signal×period), human visual QA,
  PR to main + `/code-review`, deploy (migrations 0025–0034, seeds, envs, ANALYZE).
- **Local dev state:** this branch currently has uncommitted WIP (new Pulse chart/filter
  components, worker tests). As of 2026-06-24 that WIP was stashed to work on `main`.

### Adjacent in-flight idea: Entel NPS bridge
A tab "Índice de Escucha Digital · NPS Bridge" that crosses (simulated) NPS with digital
listening on a −100/+100 scale, aggregating `signal_period_metrics`. The metric already exists
in code (`scoreSentimentAdvocacy()` in `packages/query-engine/src/engine-aggregation.ts`).
Built on the `signal-pulse` branch.

---

## Issues = the running history (GitHub `noisia-ai/website`)

The repo has no `gh` configured locally; read issues via the GitHub web UI or the API. The
ones that carry real context:

- **#1 — Research note: Live Corpus / Store Experience Intelligence (Sephora).** Proposal to
  separate *infrastructure* (live corpus sources: connectors, syncs, normalization, snapshots)
  from *product* (store-experience methodology pack). Sources strategy: Google Business Profile
  Reviews API (official) with Apify backfill fallback; TikTok via per-store seeds, not full
  scrape; Tinyfish only for discovery/edge cases. **Future work, not started.**
- **#2 — ⏸️ Engine multimétodo PAUSED — status, pending, resume guide.** The source of truth
  for Branch A: what's built & validated, the money traps to fix before reactivating, and the
  ops runbook. Pairs with `engine_comparative/98_PROD_READINESS_TRACKER.md`.
- **#4 — ✅ Signal Pulse pre-prod validation checklist.** The closing checklist for Branch B.
  Acceptance: real-data run + human visual QA + PR merged. Pairs with
  `signal_pulse/50_VALIDATION_BEFORE_PROD.md`.

When you pause or hand off non-trivial work, **write an issue like #2/#4** (state + pending +
runbook) and link it from here. That's how the next agent picks up cold.
