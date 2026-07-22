# Noisia Branch State

> Current as of 2026-07-21. This is branch context for production-bound agent work;
> verify with `git branch -vv --all` before making release decisions.

## Production Branch

### `main`

- Purpose: production deploy branch.
- Rule: do not work directly on `main`; branch, open PR, review, then merge.
- Current local note: local `main` can lag `origin/main`; always fetch before comparing
  prod readiness.

## Foundation Branches

### `codex/live-intelligence-store`

- Purpose: reusable live intelligence substrate.
- Contains the live intelligence store, workers, composer, corpus explorer, persistent
  signals/observations, query pack provenance, monthly cuts and related specs.
- Status: frozen as the base for Signal Pulse work. Do not expand product surface here
  unless explicitly resuming that line.

### `codex/signal-pulse`

- Purpose: tactical marketing Signal Pulse product branch.
- Base: created from `codex/live-intelligence-store`.
- Contains Signal Pulse output kind, performance/source foundation, runtime contracts,
  report periods, canonical signals, signal metrics, chart aggregates and the
  `/pulse/[outputId]` dashboard path.
- Status: base branch for Data OS Cut 1.

## Current Production-Bound Work

### `codex/noisia-data-os-cut-1-wip`

- Purpose: first production-bound Noisia Data OS cut.
- Base: `codex/signal-pulse`.
- Fork point: `e329136` (`Add Signal Pulse source health context`), the tip of
  `codex/signal-pulse` when Data OS Cut 1 work began.
- Previous recovery checkpoint: `48ef71d` (`Implement T&B relational serving layer`).
  Subsequent focused commits add the Analysis Artifact Graph; use `git log` to resolve
  the exact remote tip instead of treating this document as a branch pointer.
- Status: active WIP. The checkpoint is locally validated but does not claim feature
  completion, staging readiness or production readiness. No PR is open.
- Product North Star: `docs/product/31_SIGNAL_PRODUCT_NORTH_STAR.md`. Signal evolves
  toward one stable client dashboard where almost always-on Social Listening and
  reviewed strategic reports coexist; the current `outputId` surface is transitional.
- Backend execution: `docs/product/32_SIGNAL_BACKEND_EXECUTION_ROADMAP.md`. Execute
  SB-01 through SB-10 sequentially; do not begin the Signal V2 frontend before the
  Backend Ready gate in SB-10.

Cut 1 adds:

- governed Data Catalog tables: `data_assets`, `data_asset_fields`,
  `data_contracts`, `data_quality_rules`, `data_quality_results`, `lineage_edges`;
- Brand OS catalog tables for profiles, objectives, audiences, seeds and future
  campaign/claim/product entities;
- Knowledge Catalog tables for chunks, assertions, assertion links and usage events;
- taxonomy/entity/tag/feature store tables;
- semantic layer tables and `dashboard_data_refs`;
- a shared T&B Analysis Serving Layer for Review and Signal, with canonical strategic
  opportunities, Action Studio, immutable published revisions and guarded historical
  reconciliation;
- an additive `analysis-artifacts-v1` registry and evidence graph connecting typed
  analytical units, mention citations, contextual Study assets, editorial state and
  the exact artifact revisions frozen into a published output;
- the documented target architecture for live metric groups, versioned Claude
  interpretations, periodic T&B releases and a stable Signal home;
- feature-flagged `/api/data-os/*` serving APIs;
- local/staging gates: `data-os:verify`, `data-os:candidates`,
  `data-os:shadow-run`, `data-os:serving-smoke`, `data-os:evidence`;
- Pulse dashboard internal shadow badge while clients continue reading
  `published_outputs.payload`.

## Merge Order

1. Continue Data OS Cut 1 implementation on `codex/noisia-data-os-cut-1-wip` with
   focused commits by subsystem.
2. Finish the complete local gate set on `codex/noisia-data-os-cut-1-wip`.
3. Run staging/prod-shadow checklist in `docs/product/23_NOISIA_DATA_OS_STAGING_RUNBOOK.md`.
4. Open PR from `codex/noisia-data-os-cut-1-wip` to `main` only after staging/preview
   evidence shows: `ready_for_live_api_shadow: true`,
   `ready_for_serving_shadow: true`, `ready_for_pr_review: true` and
   `release-gate.json` with `ready_for_production_review: true`,
   `database_format: "postgres_url"` and gate `database_format_postgres_url`.
5. Keep live serving flags off for clients until internal shadow mode passes on a real
   Signal Pulse corpus/output.

## Do Not Merge From

- Do not branch Data OS directly from `main`; it would miss Signal Pulse/live
  intelligence substrate.
- Do not cherry-pick Data OS tables without the flags, verifier, smoke and rollback
  docs.
- Do not turn on `NOISIA_DATA_OS_TAGGING_ENABLED` for LLM enrichment in Cut 1.
