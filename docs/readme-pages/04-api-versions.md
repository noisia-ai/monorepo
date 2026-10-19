# API Versions

Noisia currently exposes two public reporting API versions.

## V2: Structured Signal reports

Use V2 for client portals, custom apps, dashboards, automations, and external integrations.

```txt
/api/public/v2
```

V2 returns structured JSON designed around the published Signal report.

Best for:

- Full report rendering
- Custom client dashboards
- Finding detail pages
- Action cards
- Evidence views
- Strategy and insights workflows

## V1: Flat datasets and CSV

Use V1 for BI tools that expect rows and columns.

```txt
/api/public/v1
```

Best for:

- Looker Studio
- CSV downloads
- Flat tables
- BI joins
- Simple charts

## Recommendation

Use **V2** unless your tool specifically needs flat datasets or CSV exports.

## Compatibility

V1 and V2 use the same authentication method and API keys.

