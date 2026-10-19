# Authentication

Noisia Public Reporting API is a public authenticated API. Every request must include a valid API key.

## Bearer token

Recommended:

```http
Authorization: Bearer <NOISIA_REPORTING_API_KEY>
```

Example:

```bash
curl -H "Authorization: Bearer <NOISIA_REPORTING_API_KEY>" \
  "https://studio.noisia.ai/api/public/v2/reports"
```

## API key header

Fallback option:

```http
x-noisia-api-key: <NOISIA_REPORTING_API_KEY>
```

Example:

```bash
curl -H "x-noisia-api-key: <NOISIA_REPORTING_API_KEY>" \
  "https://studio.noisia.ai/api/public/v2/reports"
```

## Access scope

API keys can be configured to access:

- All published reports
- Only specific report IDs

If your key does not have access to a report, the API returns:

```json
{
  "error": "forbidden_output",
  "message": "API key cannot access this report."
}
```

## Security recommendations

- Do not expose API keys in public frontend code.
- Do not commit API keys to GitHub.
- Store API keys in server-side environment variables.
- Rotate API keys when access changes.

