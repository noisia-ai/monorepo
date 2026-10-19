export function isUndefinedTableError(error: unknown): boolean {
  const code = findErrorCode(error);
  return code === "42P01";
}

function findErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  if (typeof record.code === "string") return record.code;
  return findErrorCode(record.cause);
}
