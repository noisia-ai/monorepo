# ReadMe API Explorer Setup

This page is for Noisia admins configuring ReadMe.

## OpenAPI import URL

Use this URL to generate the API Reference:

```txt
https://studio.noisia.ai/api/public/openapi.yaml
```

## Personalized Docs webhook

Use this webhook URL when configuring API keys in ReadMe:

```txt
https://studio.noisia.ai/api/readme/personalized-docs
```

## Required Studio environment variables

```bash
README_WEBHOOK_SECRET='<SECRET_FROM_README>'
NOISIA_README_DEFAULT_API_KEY='<NOISIA_REPORTING_API_KEY>'
```

The same API key must also exist in:

```bash
NOISIA_REPORTING_API_KEYS
```

Example shape:

```bash
NOISIA_REPORTING_API_KEYS='customer_label:api_key:outputId1|outputId2,readme:api_key:*'
```

## Recommended ReadMe settings

- Language: Node.js or Shell
- Auth: Bearer token
- Server: `https://studio.noisia.ai`
- First test endpoint: `GET /api/public/v2/reports`

## Important

Do not paste real API keys into public guide pages.

