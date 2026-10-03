# Quickstart

Follow these steps to make your first authenticated request.

## 1. Get an API key

Ask the Noisia team for a reporting API key. The key controls which published reports your account can access.

Do not share your API key publicly or commit it to code.

## 2. List available reports

Use the reports endpoint to list the published reports available to your API key.

```bash
curl -H "Authorization: Bearer <NOISIA_REPORTING_API_KEY>" \
  "https://studio.noisia.ai/api/public/v2/reports"
```

Example response:

```json
{
  "data": [
    {
      "api_version": 2,
      "output_id": "b5ce06dd-4f9d-4c43-b145-6ec55c4738db",
      "title": "Published Signal report",
      "report_version": 4,
      "schema_version": 4,
      "sections": ["overview", "findings", "action-cards"]
    }
  ],
  "meta": {
    "api_version": 2,
    "dataset": "reports",
    "row_count": 1
  }
}
```

## 3. Open a report

Copy an `output_id` from the response and request the full report:

```bash
curl -H "Authorization: Bearer <NOISIA_REPORTING_API_KEY>" \
  "https://studio.noisia.ai/api/public/v2/reports/<OUTPUT_ID>"
```

## 4. Request one section

You can request only the section your integration needs:

```bash
curl -H "Authorization: Bearer <NOISIA_REPORTING_API_KEY>" \
  "https://studio.noisia.ai/api/public/v2/reports/<OUTPUT_ID>/sections/overview"
```

## Common sections

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

