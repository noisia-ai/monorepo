import { createSignalSentioneCsvIngester } from "@noisia/db";
import { pool } from "@/lib/db";

export type { CsvImportStats } from "@noisia/db";

/**
 * Compatibility export for server-only Studio callers. Parsing, normalization,
 * deduplication, persistence and provenance live in the canonical @noisia/db
 * implementation also used by the asynchronous Worker.
 */
export const { ingestSentioneCsvStream } = createSignalSentioneCsvIngester(pool);
