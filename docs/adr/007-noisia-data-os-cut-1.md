# ADR 007: Noisia Data OS Cut 1

## Status

Accepted for production-bound implementation.

## Context

Noisia's current production shape still depends too much on generated report payloads:
corpus data is ingested, Claude or the engine produces an output, and dashboards read a
published snapshot. That works for narrative reporting, but it is not enough for Signal
Pulse, recurring client intelligence, cross-source analysis, or future methodology reuse.

The `codex/signal-pulse` branch already moved the system in the right direction. It
adds persistent sources, performance records, report periods, canonical signals, signal
observations, signal metrics, chart aggregates, and a Signal Pulse output kind. The
remaining architectural gap is to make this a governed data product instead of another
large JSON payload.

Noisia needs a client-level data foundation that can keep raw inputs, normalized records,
knowledge, Brand OS context, taxonomies, feature tags, quality results, lineage, and
serving APIs connected over time.

## Decision

Build **Noisia Data OS Cut 1** as an additive, feature-flagged data foundation on top of
`codex/signal-pulse`.

The target product category is not a full CDP yet. The correct first architecture is a
**Customer Intelligence Lakehouse with CDP-like capabilities**:

- client/brand-scoped data lakehouse layers;
- governed data and knowledge catalogs;
- Brand OS as structured data, not only prompt context;
- reusable taxonomies and methodology bindings;
- record-level tags/features with confidence, evidence, model version, and review state;
- entity graph for brands, competitors, campaigns, creatives, claims, products, and
  source identities;
- data contracts, quality checks, source health, and lineage;
- serving APIs that read live database records and materialized aggregates;
- `published_outputs.payload` remains a fallback snapshot, not the source of truth.

Cut 1 is intentionally additive:

- no destructive migrations;
- no replacement of Triggers & Barriers production output;
- no client-visible switch until shadow mode passes;
- no full identity-resolution CDP promise;
- no dashboard rewrite before the data APIs exist.

## Consequences

- New tables must be scoped to `organization_id`, `brand_id`, `theme_id`, and/or
  `study_corpus_id` so authorization can stay server-side and narrow.
- Drizzle migrations remain forward-only and hand-verified.
- Heavy ingestion, enrichment, tagging, quality, and backfill work runs in workers, not
  Studio route handlers.
- Data OS shadow execution has a BullMQ worker path, disabled by default with
  `NOISIA_DATA_OS_WORKER_ENABLED=false` and a second execution gate
  `NOISIA_DATA_OS_WORKER_RUNS_ENABLED=false`.
- Claude can interpret structured evidence, but it must not become the system of record.
- Dashboards can keep reading payloads while the new API path is feature-flagged.
- Signal Pulse becomes the first consumer of Data OS, but the model must support future
  lenses such as Triggers & Barriers, Value Perception Matrix, Journey Friction Mapping,
  Cultural Codes, and Competitive intelligence.
- Engine validation has two independent evidence contracts: SentiOne query-potential
  screening before extraction, and revision-bound corpus certification after ingestion.
  Only the latter can approve a corpus for analysis; see
  `docs/product/28_CORPUS_ENGINE_VALIDATION_CONTRACT.md`.

## Production Gates

No Data OS path is client-visible until all gates pass:

- additive migrations applied in isolated staging/prod target;
- backfill is idempotent and reports counts;
- source health and data quality results exist for the test corpus;
- Signal Pulse can render from the old snapshot fallback and, for internal shadow only,
  from the new serving API behind `NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED`;
- `pnpm typecheck`, `pnpm lint`, and touched-package tests pass;
- workers can run the enrichment/backfill flow without long work in Studio;
- Data OS worker jobs remain off by default and require explicit staging/throwaway
  approval before remote execution;
- feature flags default off in production;
- rollback is logical: disable flags and continue serving existing snapshots.

## Follow-ups

- Implement the schema and rollout plan in `docs/product/22_NOISIA_DATA_OS_CUT_1.md`.
- Add a migration batch for catalog/taxonomy/tagging/quality/lineage tables.
- Add worker jobs for catalog backfill, taxonomy tagging, and quality evaluation.
- Add serving APIs for Signal Pulse live data reads behind a feature flag.
