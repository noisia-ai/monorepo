// Direct, out-of-band mentions CSV ingest. Reuses the EXACT production code
// path (ingestSentioneCsvStream) so normalization/dedup/platform detection are
// identical to the HTTP route — but runs as a background process with no
// 5-minute Node requestTimeout, for files too large to push through HTTP.
//
// Usage:
//   node --import tsx scripts/ingest-mentions-file.mts <csvPath> <corpusId> [mentionType] [entityKind] [entityLabel]
import { readFileSync, createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";

// Load env BEFORE importing modules that build the DB pool at load time.
for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

const [, , csvPath, corpusId, mentionType = "industry", entityKind = "category", entityLabel = "Baseline de categoría", corpusEntityId, competitorId] =
  process.argv;
if (!csvPath || !corpusId) {
  console.error("Usage: ingest-mentions-file.mts <csvPath> <corpusId> [mentionType] [entityKind] [entityLabel] [corpusEntityId] [competitorId]");
  process.exit(1);
}

const { ingestSentioneCsvStream } = await import("@/lib/csv/sentione");
const { db } = await import("@/lib/db");
const { importBatches } = await import("@noisia/db");
const { eq } = await import("drizzle-orm");

const sizeMb = (statSync(csvPath).size / 1024 / 1024).toFixed(1);
const sourceFileName = csvPath.split("/").pop() || "industria.csv";
console.log(`[ingest] file=${sourceFileName} size=${sizeMb}MB corpus=${corpusId} type=${mentionType}/${entityKind}`);

const [batch] = await db
  .insert(importBatches)
  .values({
    studyCorpusId: corpusId,
    mentionType: mentionType as "brand" | "competitor" | "industry",
    entityKind,
    entityLabel,
    corpusEntityId: corpusEntityId || undefined,
    competitorId: competitorId || undefined,
    sourceSystem: "listening_csv",
    sourceFileName,
    sourceFileHash: "pending",
    status: "processing"
  })
  .returning();

if (!batch) throw new Error("Could not create import batch.");
console.log(`[ingest] import_batch=${batch.id} — streaming...`);

const t0 = Date.now();
const progress = setInterval(() => {
  // Heartbeat so the operator can see it's alive (the function itself is silent).
  console.log(`[ingest] still working... ${Math.round((Date.now() - t0) / 1000)}s elapsed`);
}, 30_000);

try {
  const webStream = Readable.toWeb(createReadStream(csvPath)) as unknown as ReadableStream<Uint8Array>;
  const { stats, fileHash } = await ingestSentioneCsvStream({
    corpusId,
    importBatchId: batch.id,
    sourceFileName,
    entityLabel,
    stream: webStream
  });
  clearInterval(progress);

  await db
    .update(importBatches)
    .set({
      recordCount: stats.record_count,
      includedCount: stats.included_count,
      excludedCount: stats.excluded_count,
      duplicateCount: stats.duplicate_count,
      sourceFileHash: fileHash,
      status: "completed"
    })
    .where(eq(importBatches.id, batch.id));

  const dt = (Date.now() - t0) / 1000;
  console.log(`[ingest] DONE in ${dt.toFixed(0)}s — ${JSON.stringify(stats)} (${Math.round(stats.record_count / dt)} rows/s)`);
  process.exit(0);
} catch (err) {
  clearInterval(progress);
  await db.update(importBatches).set({ status: "failed" }).where(eq(importBatches.id, batch.id)).catch(() => {});
  console.error("[ingest] FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
