# Noisia Branch State

> Current as of 2026-07-02. This is branch context for production-bound agent work;
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

### `codex/noisia-data-os-prod`

- Purpose: first production-bound Noisia Data OS cut.
- Base: `codex/signal-pulse`.
- Current fork point: `e329136` (`Add Signal Pulse source health context`), same commit
  as local and remote `codex/signal-pulse` at the time this document was written.
- Status: uncommitted working branch for PR preparation.

Cut 1 adds:

- governed Data Catalog tables: `data_assets`, `data_asset_fields`,
  `data_contracts`, `data_quality_rules`, `data_quality_results`, `lineage_edges`;
- Brand OS catalog tables for profiles, objectives, audiences, seeds and future
  campaign/claim/product entities;
- Knowledge Catalog tables for chunks, assertions, assertion links and usage events;
- taxonomy/entity/tag/feature store tables;
- semantic layer tables and `dashboard_data_refs`;
- feature-flagged `/api/data-os/*` serving APIs;
- local/staging gates: `data-os:verify`, `data-os:candidates`,
  `data-os:shadow-run`, `data-os:serving-smoke`, `data-os:evidence`;
- Pulse dashboard internal shadow badge while clients continue reading
  `published_outputs.payload`.

## Merge Order

1. Finish Data OS local checks on `codex/noisia-data-os-prod`.
2. Run staging/prod-shadow checklist in `docs/product/23_NOISIA_DATA_OS_STAGING_RUNBOOK.md`.
3. Open PR from `codex/noisia-data-os-prod` to `main` only after staging/preview
   evidence shows: `ready_for_live_api_shadow: true`,
   `ready_for_serving_shadow: true`, `ready_for_pr_review: true` and
   `release-gate.json` with `ready_for_production_review: true`,
   `database_format: "postgres_url"` and gate `database_format_postgres_url`.
4. Keep live serving flags off for clients until internal shadow mode passes on a real
   Signal Pulse corpus/output.

## Do Not Merge From

- Do not branch Data OS directly from `main`; it would miss Signal Pulse/live
  intelligence substrate.
- Do not cherry-pick Data OS tables without the flags, verifier, smoke and rollback
  docs.
- Do not turn on `NOISIA_DATA_OS_TAGGING_ENABLED` for LLM enrichment in Cut 1.
