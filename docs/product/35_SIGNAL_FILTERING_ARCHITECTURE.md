# Signal filtering architecture

Status: canonical for Signal V2 and Data OS Cut 1.

## Product rule

Every Signal module must answer the same analytical question for the same selected
population. A date picker is not an isolated chart control: it is the visible editor for
one governed `SignalFilterV1`.

The canonical filter contains:

- a closed date range (`start`, `end`);
- the workspace IANA timezone;
- an explicit granularity (`day`, `week`, `month`);
- zero or more governed dimensions from `SIGNAL_DIMENSIONS`;
- one independent comparison mode.

The URL is the shareable representation of that contract. API routes parse and normalize
it with `@noisia/query-engine`; clients do not invent SQL predicates or metric-specific
date semantics.

## Interaction model

The period control follows the Shopify analytics pattern:

- common presets on the left;
- editable start and end dates;
- two synchronized calendar months on desktop;
- explicit Cancel and Apply actions;
- comparison as a separate control;
- keyboard navigation, locale-aware date segments and visible focus.

The calendar is implemented with React Aria Components and
`@internationalized/date`. Those packages own accessible calendar behavior, focus and
locale-aware date primitives. Noisia owns the visual tokens and the analytical meaning.

No Shopify proprietary source code is used. Shopify is the interaction and density
reference.

## Comparison modes

`SignalComparisonV1` supports:

| Mode | Meaning |
| --- | --- |
| `none` | Do not load or render a comparison series. |
| `previous_period` | Immediately preceding non-overlapping window. |
| `previous_year` | Same calendar start in the prior year, preserving duration across leap years. |
| `previous_year_same_weekday` | Equivalent weekday-aligned window, 364 days earlier. |
| `custom` | Analyst-selected non-overlapping range with equal duration. |

The resolved comparison range is returned by the API. Charts consume the returned range;
they must not recalculate it independently.

## Cache-aside serving

A valid interactive filter must return live values on first use. Serving therefore uses:

1. an exact `filters_hash` materialization when one exists;
2. a bounded, governed read-through query compiled by
   `buildSignalMetricMaterializationPlanV1` when that cache entry is absent;
3. the normal ad-hoc worker queue to persist the same canonical filter when enabled.

The read-through path uses the same SQL planner, quality rules, watermark and authorization
scope as persisted materialization. It never falls back to `published_outputs.payload` and
never treats a cache miss as missing source data.

This distinction is important: `pending` means accepted source data is genuinely not
available for serving, not merely that a user chose a period that has not been cached yet.

## Dimension semantics

- Values inside one dimension are OR-ed.
- Different dimensions are AND-ed.
- Unsupported dimensions fail as `invalid_filter`; they are never ignored.
- Every metric, breakdown and drill-down receives the same normalized filter.
- The canonical filter JSON produces `filters_hash`, which is used for reconciliation,
  cache/materialization identity and evidence lineage.

Changing the period or comparison must preserve active dimensions. Changing dimensions
must preserve the period, timezone and comparison.

## Brand Monitoring controls

The Brand Monitoring toolbar separates two concepts that must not be conflated:

- **Data: {brand}** describes the authorized, approved corpus population backing the
  workspace. It is a scope control and a path to the included mentions, not an analytical
  filter.
- **More filters** opens the global population controls. Applying a control recomputes
  every live KPI, series, breakdown and drill-down against the same canonical filter.

The client-safe controls are:

- full-text search over governed mention title and cleaned/snippet text;
- platform;
- sentiment;
- content type;
- language;
- country;
- topic;
- entity;
- campaign.

Facet values are loaded from the authorized corpus and selected period. A dimension with
no available values is omitted rather than rendered as an inert control. Provider name,
source-system identifiers, inclusion state, cleaning type and exclusion reason are
operator concerns and must not be exposed as client-facing filters. The approved/included
corpus remains an invariant of Signal serving.

The monthly insight carousel is the deliberate exception to live report filters. It is a
versioned interpretation of the latest fixed 30-day window and declares that scope in its
metadata. Live KPIs and charts below it always follow the active period, comparison,
search and dimensions.

The controls panel follows the right-rail interaction hierarchy used by the inspected
Shopify analytics reference: compact grouped controls, visible active-filter count,
explicit reset/clear actions and a sticky Apply action. No Shopify proprietary code is
used.

## Runtime flow

```text
Signal filter UI
  -> canonical URL query
  -> Signal API parser
  -> SignalFilterV1 + SignalComparisonV1
  -> authorized serving loaders
  -> metric series / breakdowns / mentions
  -> response with resolved filters and freshness
```

Authorization and workspace/corpus ownership remain server-side. A client-visible filter
never broadens access.

## Technology decision

Use:

- React Aria Components for the date-range interaction and accessibility;
- `@internationalized/date` for calendar-safe date operations;
- `@noisia/query-engine` as the only semantic parser, normalizer and serializer;
- the existing Data OS metric store and `filters_hash` for query identity.

Do not add Cube, another semantic layer or a second filter schema in the client. Cube may
be reconsidered only if measured serving latency proves that Data OS materializations and
indexes cannot meet the Signal SLO.

Do not add `nuqs` merely to hold the same URL state. The query engine already provides
canonical serialization. A client URL helper can be reconsidered when Signal becomes a
multi-route client application with browser history requirements that exceed
`replaceState`.

TanStack Query is a compatible future cache/orchestration option when independent Signal
panels load concurrently. It does not define filter meaning and is not required for the
current aggregate endpoint.

## Acceptance gates

- URL round-trips to the same normalized filter and comparison.
- Previous-period and custom comparisons are equal-duration and non-overlapping.
- Active dimensions survive period and comparison changes.
- Search and client-safe dimensions update every live Brand Monitoring module.
- Data scope remains the authorized approved corpus and is not serialized as a filter.
- Internal quality/cleaning/provider fields never appear in the client controls.
- All visible modules reconcile to the same `filters_hash`.
- Empty, partial and stale data remain explicit.
- An uncached, valid range returns governed values on its first request.
- Calendar works by keyboard and at desktop/mobile breakpoints.
- A Laika runtime request returns data for the selected period and resolved comparison.
