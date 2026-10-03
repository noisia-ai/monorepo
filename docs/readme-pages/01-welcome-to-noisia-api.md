# Welcome to Noisia API

Noisia Public Reporting API lets clients and external integrations access published Signal reports through authenticated endpoints.

Use this API to retrieve structured report outputs, findings, action cards, evidence samples, and BI-ready datasets from published Noisia studies.

## What you can build

- Client portals
- Internal dashboards
- BI reports
- Automated workflows
- Custom visualizations
- Published Signal report viewers

## Base URL

```txt
https://studio.noisia.ai
```

## Recommended version

Use **V2** for most integrations.

```txt
https://studio.noisia.ai/api/public/v2
```

V2 returns the structured, client-ready Signal report output.

Use **V1** only when you need flat datasets or CSV exports for BI tools.

## OpenAPI

The API Reference is generated from this OpenAPI specification:

```txt
https://studio.noisia.ai/api/public/openapi.yaml
```

## Start here

1. Get an API key from Noisia.
2. Call `GET /api/public/v2/reports`.
3. Copy an `output_id`.
4. Call `GET /api/public/v2/reports/{outputId}`.

```bash
curl -H "Authorization: Bearer <NOISIA_REPORTING_API_KEY>" \
  "https://studio.noisia.ai/api/public/v2/reports"
```

