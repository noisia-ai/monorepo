# V2 Structured Reports

V2 returns the client-ready Signal report as structured JSON.

## List reports

```bash
curl -H "Authorization: Bearer <NOISIA_REPORTING_API_KEY>" \
  "https://studio.noisia.ai/api/public/v2/reports"
```

## Get full report

```bash
curl -H "Authorization: Bearer <NOISIA_REPORTING_API_KEY>" \
  "https://studio.noisia.ai/api/public/v2/reports/<OUTPUT_ID>"
```

## Get one section

```bash
curl -H "Authorization: Bearer <NOISIA_REPORTING_API_KEY>" \
  "https://studio.noisia.ai/api/public/v2/reports/<OUTPUT_ID>/sections/findings"
```

## Response shape

```json
{
  "data": {
    "metadata": {},
    "report": {},
    "manifest": {},
    "metrics": {},
    "sections": {}
  },
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

## Section endpoints

```txt
GET /api/public/v2/reports/{outputId}/sections/overview
GET /api/public/v2/reports/{outputId}/sections/findings
GET /api/public/v2/reports/{outputId}/sections/decision-field
GET /api/public/v2/reports/{outputId}/sections/action-cards
GET /api/public/v2/reports/{outputId}/sections/strategic-opportunities
GET /api/public/v2/reports/{outputId}/sections/competitive-intelligence
GET /api/public/v2/reports/{outputId}/sections/emerging-patterns
GET /api/public/v2/reports/{outputId}/sections/future-signals
GET /api/public/v2/reports/{outputId}/sections/market-analysis
GET /api/public/v2/reports/{outputId}/sections/knowledge-impact
GET /api/public/v2/reports/{outputId}/sections/evidence-deep-dives
GET /api/public/v2/reports/{outputId}/sections/aggregates
GET /api/public/v2/reports/{outputId}/sections/evidence-sample
GET /api/public/v2/reports/{outputId}/sections/manifest
```

