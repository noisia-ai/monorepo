# V1 BI Datasets

V1 exposes published reports as flat datasets for BI tools.

## List reports

```bash
curl -H "Authorization: Bearer <NOISIA_REPORTING_API_KEY>" \
  "https://studio.noisia.ai/api/public/v1/reports"
```

## JSON dataset

```bash
curl -H "Authorization: Bearer <NOISIA_REPORTING_API_KEY>" \
  "https://studio.noisia.ai/api/public/v1/reports/<OUTPUT_ID>/findings"
```

## CSV dataset

```bash
curl -H "Authorization: Bearer <NOISIA_REPORTING_API_KEY>" \
  "https://studio.noisia.ai/api/public/v1/reports/<OUTPUT_ID>/datasets/findings.csv"
```

## Available datasets

```txt
summary
kpis
findings
recommendations
emerging-patterns
time-series-monthly
platform-distribution
content-type-distribution
layer-distribution
mobility-distribution
polarity-distribution
evidence-sample
```

## When to use V1

Use V1 when your tool expects rows and columns.

For structured report rendering, use V2.

