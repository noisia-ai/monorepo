# ADR-005: Llave unica de metodologias

## Status
Accepted (2026-05-24)

## Context
`04_DATABASE_SCHEMA.md` define `methodologies.slug` como `UNIQUE` y tambien agrega `UNIQUE(slug, version)`. Ambas reglas juntas impiden guardar multiples versiones de una misma metodologia, aunque el producto requiere versionado.

## Decision
Usar `UNIQUE(slug, version)` como llave de upsert y dejar `slug` indexado, pero no unico.

## Rationale
- El seed de metodologias debe ser idempotente por version.
- Futuros cambios de T&B pueden convivir como `triggers-barriers@1.0`, `triggers-barriers@1.1`, etc.
- Las APIs que busquen por slug deben resolver version activa o version del corpus.

## Consequences
+ Soporta versionado real de metodologias desde el dia uno.
+ Evita migrations destructivas cuando T&B evolucione.
- `GET /api/methodologies/:slug` debe manejar multiples versiones.

// TODO mejora-futura: agregar columna `is_current` o `published_at` para resolver
// explicitamente cual version se muestra por default en el Studio.
