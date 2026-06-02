# Reporting API V2 + Public Customer Contract

Fecha: 2026-06-01

## Objetivo

Exponer el output publicado de Signal en formato JSON estructurado para clientes
e integraciones externas. V1 se mantiene como contrato tabular/CSV para Looker;
V2 entrega el reporte completo y sus secciones nuevas sin obligar al consumidor a
reconstruir el dashboard desde datasets planos.

La fuente de verdad sigue siendo `published_outputs.payload` y sólo se leen
outputs con `status = published` y `archived_at IS NULL`.

## Auth

Igual que V1:

```http
Authorization: Bearer <NOISIA_REPORTING_API_KEY>
```

Fallback soportado:

```http
x-noisia-api-key: <NOISIA_REPORTING_API_KEY>
```

## Base

```txt
https://studio.noisia.ai/api/public/v2
```

## Endpoints

Lista de reportes visibles para la API key:

```txt
GET /reports
```

Reporte completo:

```txt
GET /reports/:outputId
GET /reports/:outputId/full
```

Secciones:

```txt
GET /reports/:outputId/sections/overview
GET /reports/:outputId/sections/findings
GET /reports/:outputId/sections/decision-field
GET /reports/:outputId/sections/action-cards
GET /reports/:outputId/sections/strategic-opportunities
GET /reports/:outputId/sections/competitive-intelligence
GET /reports/:outputId/sections/emerging-patterns
GET /reports/:outputId/sections/future-signals
GET /reports/:outputId/sections/market-analysis
GET /reports/:outputId/sections/knowledge-impact
GET /reports/:outputId/sections/evidence-deep-dives
GET /reports/:outputId/sections/aggregates
GET /reports/:outputId/sections/evidence-sample
GET /reports/:outputId/sections/manifest
```

También funcionan aliases cortos como `/competitive`, `/actions`,
`/opportunities`, `/patterns`, `/market`, `/knowledge` y `/verbatims`.

## Shape de respuesta

Todas las respuestas usan:

```json
{
  "data": {},
  "meta": {
    "api_version": 2,
    "output_id": "uuid",
    "section": "full",
    "report_version": 4,
    "schema_version": 4,
    "published_at": "2026-06-01T00:00:00.000Z"
  }
}
```

`GET /reports/:outputId` devuelve:

```json
{
  "metadata": {},
  "report": {},
  "manifest": {},
  "metrics": {},
  "sections": {
    "overview": {},
    "findings": [],
    "decision_field": { "nodes": [], "edges": [] },
    "action_cards": [],
    "strategic_opportunities": [],
    "competitive_intelligence": {},
    "emerging_patterns": [],
    "future_signals": [],
    "market_analysis": null,
    "knowledge_impact": null,
    "evidence_deep_dives": [],
    "aggregates": {},
    "evidence_sample": [],
    "manifest": {}
  }
}
```

## Notas de compatibilidad

- V1 no cambia.
- V2 normaliza el payload con el mismo adapter que usa la UI de Signal.
- `sections` en `GET /reports` indica qué módulos están disponibles según el
  manifest publicado.
- No hay CSV en V2; para CSV y BI tabular se debe seguir usando V1.
