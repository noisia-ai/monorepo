import { createSentioneTimestampParser, SentioneTimestampError } from "@noisia/db";

/** A legacy import keeps the operator's source zone separately from acquisition seals. */
export function declareSourceTimestampContext(sourceTimezone?: string | null) {
  createSentioneTimestampParser(sourceTimezone);
  const timezone = sourceTimezone?.trim() ?? null;
  return {
    timezone,
    processingMetrics: timezone === null ? {} : {
      source_timestamp_context: {
        contract_version: "source-timestamp-context-v1",
        origin: "operator_declared",
        timezone
      }
    }
  };
}

/** Stable error fields are safe to persist; never include a timestamp or source row. */
export function sourceTimestampFailure(error: unknown) {
  if (!(error instanceof SentioneTimestampError)) return null;
  return {
    code: error.code,
    detail: {
      field: error.field ?? "source_timezone",
      parameter: error.code.startsWith("source_timezone_") ? "source_timezone" : "file",
      expected: error.code.startsWith("source_timezone_") ? "IANA time zone, or timestamps with explicit Z/offset" : "Valid unambiguous source timestamps"
    }
  };
}
