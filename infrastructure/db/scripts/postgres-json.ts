export function sanitizeUnicodeForPostgresText(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += value[index] ?? "";
        result += value[index + 1] ?? "";
        index += 1;
      } else {
        result += "\uFFFD";
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      result += "\uFFFD";
      continue;
    }
    result += value[index] ?? "";
  }
  return result;
}

export function sanitizeUnicodeForPostgresJson<T>(value: T): T {
  if (typeof value === "string") return sanitizeUnicodeForPostgresText(value) as T;
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString() as T;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeUnicodeForPostgresJson(item)) as T;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    sanitized[sanitizeUnicodeForPostgresText(key)] = sanitizeUnicodeForPostgresJson(item);
  }
  return sanitized as T;
}

export function safeJsonStringifyForPostgres(value: unknown): string {
  return JSON.stringify(sanitizeUnicodeForPostgresJson(value));
}
