# Noisia Branch State

> Current as of 2026-08-03. This is branch context for production-bound agent work;
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

Subsequent work on the same branch also adds or has active local WIP for:

- one stable `/signal/{workspaceSlug}` client workspace;
- Brand Monitoring, Mentions and Topics & Narratives on relational serving;
- governed and incremental topic/narrative profiles and assignments;
- Signal V2 filters, charts, evidence drawers, skeletons and navigation behavior based
  on direct Shopify Admin inspection;
- T&B relational releases, Decision Field, finding reading and evidence UI;
- taxonomy insight research and persistent mention enrichment;
- a cleaned client navigation organized around operational modules, Reports and
  Settings.

### Current local architecture state

The workspace-owned ingestion boundary and **Phase 4A primary-brand operational
serving** are implemented locally in additive migrations 0059–0061. Canonical mentions,
source/import provenance, scope attribution, current operational population, materializations, invalidations,
watermarks and the Brand Monitoring/Mentions/Topics & Narratives readers can now resolve
the workspace population without a study corpus. Client rollout is controlled by one
closed-by-default `legacy | shadow | governed` read mode; shadow does not alter the
visible payload, writes comparisons to a durable deduplicated outbox and rollback
requires only returning the configuration to `legacy`.
Topics & Narratives derives its private overview ETag from the served semantic body,
so membership changes cannot reuse a validator from an older denominator while an
equivalent rematerialization keeps the same validator.

Phase 4 is not declared complete: competitor/category exploration remains explicitly
deferred until it has a server-owned governed population contract. Staging handoff is
blocked until that scope decision and a separate authorization/configuration step; no
remote migration or cutover has been run.

**Phase 5 Strategic Consumption** is structurally closed and locally exercised in
additive migrations 0062–0063. A workspace/report run now creates an explicit approved analysis
population, freezes IDs/watermarks into an immutable relational snapshot, reuses the
existing T&B pipeline behind containment gates, promotes only selected reviewed tags
to canonical mention enrichment and publishes append-only revisions under one
`(workspace_id, report_key='triggers-barriers')` current pointer. The client uses one
stable `/signal/{workspaceSlug}/reports/triggers-barriers` surface; corpus routes and
legacy URLs remain adapters, not product identity. PostgreSQL fixtures cover two runs,
releases 1→2, alias lineage, concurrency and snapshot/release invariance without an LLM
or paid pipeline run. Workers owns recoverable dispatch: startup/periodic drains claim
due rows with leases and `SKIP LOCKED`, use deterministic BullMQ IDs, reconcile a job
accepted before PostgreSQL ACK, and dead-letter bounded repeated failures.

This is local evidence only. Migrations 0062–0063 have not been applied remotely, no staging
run or cutover occurred, and production accessibility/build identity remains
unverified. Phase 4A's deferred exploration-scope contract is unaffected.

Canon and handoff:

- `docs/adr/014-signal-workspace-owned-data-plane.md`;
- `docs/product/42_SIGNAL_WORKSPACE_DATA_OWNERSHIP.md`;
- `docs/product/43_SIGNAL_V2_FRONTEND_SYSTEM.md`;
- `docs/product/44_SIGNAL_WORKSPACE_DATA_PLANE_HANDOFF.md`.

Local PostgreSQL and browser evidence is recorded in
`docs/product/45_SIGNAL_WORKSPACE_DATA_PLANE_IMPLEMENTATION_AUDIT.md`. Staging, remote
migration and client cutover remain explicitly unexecuted. Do not infer production
readiness from the local governed gate, and do not pursue blind equality with a legacy
reader that includes non-primary scopes.

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
