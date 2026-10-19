# Errors

The API returns JSON errors with an `error` code and a human-readable `message`.

## Missing API key

```json
{
  "error": "missing_api_key",
  "message": "Missing reporting API key."
}
```

## Invalid API key

```json
{
  "error": "invalid_api_key",
  "message": "Invalid reporting API key."
}
```

## Forbidden report

```json
{
  "error": "forbidden_output",
  "message": "API key cannot access this report."
}
```

## Report not found

```json
{
  "error": "report_not_found",
  "message": "Published report not found."
}
```

## Unknown section

```json
{
  "error": "unknown_section",
  "message": "Unknown reporting V2 section."
}
```

## Server error

```json
{
  "error": "server_error",
  "message": "Reporting API failed while building the response."
}
```

