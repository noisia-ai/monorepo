# ADR 010: Signal filter and comparison query contract

Date: 2026-07-25

Status: Accepted

## Context

Signal is becoming a shared dashboard for always-on monitoring and periodic strategic
reports. Every chart, narrative and mention drill-down must refer to the same corpus
population. A visual date picker alone cannot guarantee that consistency.

The repository already has a Data OS semantic contract, supported dimensions, canonical
serialization and filter hashes in `@noisia/query-engine`.

## Decision

1. `SignalFilterV1` remains the canonical population definition.
2. `SignalComparisonV1` is a separate, explicit contract with `none`,
   `previous_period`, `previous_year`, `previous_year_same_weekday` and `custom` modes.
3. Signal URLs serialize both contracts. API routes parse them with the query engine.
4. React Aria Components and `@internationalized/date` implement the accessible calendar
   interaction; they do not own analytical semantics.
5. Serving loaders resolve and return the comparison range. Charts do not compute their
   own comparison windows.
6. Period and comparison changes preserve every active governed dimension.
7. Exact materializations are the cache. A cache miss executes the existing bounded
   materialization plan as a read-through query and queues the same canonical scope for
   persistence when ad-hoc materialization is enabled.

## Consequences

- A Signal URL is reproducible and shareable.
- A new valid filter works on first use instead of exposing cache state as product state.
- Comparison behavior is testable without rendering the UI.
- Every module can use the same `filters_hash` for materialization, cache identity,
  lineage and reconciliation.
- Disabling comparison avoids unnecessary comparison queries.
- Adding a new filter dimension requires a query-engine contract change instead of an
  ad hoc chart parameter.
- The UI can evolve without changing the Data OS contract.

## Alternatives rejected

- **Copying Shopify implementation code:** unavailable, proprietary and unnecessary. We
  reproduce the proven interaction pattern with our own accessible component.
- **Cube as a second semantic layer:** duplicates Data OS contracts and introduces
  migration/operations cost before a measured performance need exists.
- **Client-only URL/filter schema:** permits drift between cards, drill-downs and backend
  predicates.
- **Native date inputs:** insufficient for the required presets, synchronized range,
  comparison and keyboard experience.

See `docs/product/35_SIGNAL_FILTERING_ARCHITECTURE.md`.
