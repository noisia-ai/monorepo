# ADR 009: Signal as an Always-on and Strategic Dashboard

## Status

Accepted as product/architecture direction. Implementation remains incremental and
client-visible activation requires the existing Data OS staging gates.

## Context

The current Signal implementation is centered on a `published_output` and a route keyed
by `outputId`. This makes a curated report reproducible, but it encourages the UI to
behave as a renderer for a large JSON payload. The product direction requires something
broader: recurrent SentiOne/Study ingestion, live filterable social-listening metrics,
Claude interpretations per metric group, and strategic Triggers & Barriers runs that
can occur monthly or at another contracted cadence.

Those operational and strategic reports must coexist at the client's Signal URL.

## Decision

Signal becomes a stable client dashboard/workspace above individual outputs.

- The live corpus, enriched mentions and structured observations are the data plane.
- Metric definitions and aggregations are deterministic and queryable by governed
  filters. Claude does not calculate dashboard numbers.
- Claude interprets versioned metric packets asynchronously. Every interpretation is
  scoped to a definition version, period, filters, data watermark, prompt and model.
- Triggers & Barriers remains a strategic, explicitly executed and human-reviewed run.
- Approved strategic runs and interpretation revisions are immutable releases; new
  corpus data creates new materializations or revisions rather than rewriting history.
- Signal composes live operational reads and frozen strategic releases in the same
  experience.
- `/signal/{outputId}` remains a transition path. A stable subject/workspace identity
  will be introduced before Signal V2 migration.
- `published_outputs.payload` remains fallback/export compatibility, not the source of
  truth for filters, charts or evidence.

The canonical product detail is
`docs/product/31_SIGNAL_PRODUCT_NORTH_STAR.md`.

## Consequences

- Data freshness and interpretation freshness must be modeled separately.
- Arbitrary filter changes cannot reuse incompatible narrative text. The UI must show a
  compatible interpretation, a stale state or an asynchronous refresh state.
- Ingestion and operational metric refresh continue between strategic runs.
- T&B publication does not block the corpus from receiving new data and new data does
  not silently mutate an approved T&B release.
- A Signal home needs stable identity, authorization and navigation above individual
  `published_outputs`.
- Methodology-specific `study_corpora` can remain during migration, but canonical source
  ingestion should become reusable at subject/workspace level rather than duplicated
  per methodology.
- Signal V2 should start after live serving/filter contracts are proven, so the redesign
  is not coupled to legacy JSON shapes.

## Rejected Alternatives

### Keep one Signal URL per output

Rejected as the target because the client loses continuity and the product cannot act
as an almost always-on dashboard.

### Recompute strategic analysis whenever data arrives

Rejected because strategic interpretation requires cadence, cost control, evidence and
human review. It would also rewrite the client's past without an explicit release.

### Let Claude generate metrics and chart payloads

Rejected because numbers would not be reliably filterable, reproducible or auditable.
Claude interprets governed metrics; Postgres/serving computes them.

### Freeze the entire dashboard at publication

Rejected because operational social-listening views must continue updating. Only
identified materializations, interpretations and strategic releases are frozen.
