# Signal Pulse Social Performance ETL

Codex implementation note for the flexible performance importer added after the pre-prod checklist.

## What It Solves

Insights Managers can upload either:

- A normalized tabular performance CSV with date/entity/metric columns.
- Multiple raw social exports where each file is a single metric time series, for example:
  - `Clics en el enlace.csv`
  - `Interacciones.csv`
  - `Seguidores (1).csv`
  - `Visitas.csv`
  - `Visualizaciones.csv`

The importer detects the shape, normalizes the rows, and writes structured `performance_records`. These files are never imported as mentions or text context.

## Deterministic Rules

- Encoding is decoded before parsing, including UTF-16LE/BOM social exports.
- Excel `sep=,` directives and title rows are skipped.
- A `Fecha`/`Primary` export is treated as `single_metric_timeseries`.
- Metric inference is deterministic from the file title/name:
  - `Clics en el enlace` -> `clicks`
  - `Interacciones` -> `engagement`
  - `Visualizaciones` -> `video_views`
  - `Seguidores` -> `followers` in `metrics` JSON
  - `Visitas` -> `visits` in `metrics` JSON
- Single-metric social exports default to `platform=social`, `channel=organic`, `entity_kind=account`, and `entity_name=account` when the file does not provide entity fields.
- Stable external IDs intentionally match across same platform/account/date so separate metric files merge into one daily grain.
- SQL upsert merges sparse metrics with existing rows instead of overwriting earlier files.

## User-Facing Feedback

The Source Wizard now accepts multiple performance CSVs at once. It returns a diagnostic summary:

- `Tienes`: detected metrics plus days/months of structured coverage.
- `Te falta`: recommended Signal Pulse metrics not present (`spend`, `impressions`, `reach`, `clicks`, `engagement`, `video_views`, `conversions`).

For the Potosi sample package, the importer detects:

- 5 files
- 516 rows per file
- Coverage from `2025-01-01` to `2026-05-31`
- Metrics: `clicks`, `engagement`, `followers`, `visits`, `video_views`

The package is usable for organic trend/performance context. It still lacks paid spend, impressions/reach, campaign/ad IDs, and creative text for paid attribution.

## Validation

Validated with:

- `pnpm --filter @noisia/query-engine test`
- `pnpm --filter @noisia/workers test`
- `pnpm --filter @noisia/studio test`
- `pnpm --filter @noisia/query-engine typecheck`
- `pnpm --filter @noisia/workers typecheck`
- `pnpm --filter @noisia/studio typecheck`

