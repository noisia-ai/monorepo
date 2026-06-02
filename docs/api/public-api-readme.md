# Noisia Public Reporting API V2

## OpenAPI para ReadMe

Sube o importa este archivo en ReadMe:

```txt
https://studio.noisia.ai/api/public/openapi.yaml
```

## Base URL

```txt
https://studio.noisia.ai/api/public/v2
```

## API Key

La API usa Bearer token.

```http
Authorization: Bearer <NOISIA_REPORTING_API_KEY>
```

Fallback soportado:

```http
x-noisia-api-key: <NOISIA_REPORTING_API_KEY>
```

> No guardar la llave real en GitHub, ReadMe público, Slack abierto ni archivos versionados.
> Compartirla por un canal seguro y reemplazar `<NOISIA_REPORTING_API_KEY>` al consumir la API.

## Endpoints principales

### Listar reportes publicados

```http
GET https://studio.noisia.ai/api/public/v2/reports
Authorization: Bearer <NOISIA_REPORTING_API_KEY>
```

### Obtener reporte completo

```http
GET https://studio.noisia.ai/api/public/v2/reports/:outputId
Authorization: Bearer <NOISIA_REPORTING_API_KEY>
```

### Obtener una sección del reporte

```http
GET https://studio.noisia.ai/api/public/v2/reports/:outputId/sections/:section
Authorization: Bearer <NOISIA_REPORTING_API_KEY>
```

Secciones disponibles:

```txt
overview
findings
decision-field
action-cards
strategic-opportunities
competitive-intelligence
emerging-patterns
future-signals
market-analysis
knowledge-impact
evidence-deep-dives
aggregates
evidence-sample
manifest
```

## Ejemplos con curl

```bash
curl -H "Authorization: Bearer <NOISIA_REPORTING_API_KEY>" \
  "https://studio.noisia.ai/api/public/v2/reports"
```

```bash
curl -H "Authorization: Bearer <NOISIA_REPORTING_API_KEY>" \
  "https://studio.noisia.ai/api/public/v2/reports/<OUTPUT_ID>"
```

```bash
curl -H "Authorization: Bearer <NOISIA_REPORTING_API_KEY>" \
  "https://studio.noisia.ai/api/public/v2/reports/<OUTPUT_ID>/sections/overview"
```

## Respuestas de auth esperadas

Sin API key:

```json
{
  "error": "missing_api_key",
  "message": "Missing reporting API key."
}
```

Con API key inválida:

```json
{
  "error": "invalid_api_key",
  "message": "Invalid reporting API key."
}
```

Con API key válida pero sin acceso al reporte:

```json
{
  "error": "forbidden_output",
  "message": "API key cannot access this report."
}
```

## Nota de versión

V2 entrega JSON estructurado client-ready. Para CSV o datasets planos de Looker,
usar V1:

```txt
https://studio.noisia.ai/api/public/v1
```
