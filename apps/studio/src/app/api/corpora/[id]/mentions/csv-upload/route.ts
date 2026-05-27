import { eq } from "drizzle-orm";

import { importBatches } from "@noisia/db";
import { forbidden, unauthorized } from "@/lib/api/responses";

export const maxDuration = 300; // 5 min — large CSV files need time
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { fileHash, ingestSentioneCsv } from "@/lib/csv/sentione";
import { getCorpusForUser } from "@/lib/data/corpora";
import { db } from "@/lib/db";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) {
    return unauthorized();
  }

  if (!canManageCorpus(session.appUser.primaryRole)) {
    return forbidden();
  }

  const { id } = await context.params;
  const corpus = await getCorpusForUser(session.appUser, id);

  if (!corpus) {
    return Response.json(
      { error: "not_found", message: "Corpus not found or not accessible." },
      { status: 404 }
    );
  }

  const request = _request;
  const form = await request.formData();
  const file = form.get("file");
  const sourceLabel = String(form.get("source_label") ?? "sentione_csv");
  const mentionTypeRaw = form.get("mention_type");
  const iterationIdRaw = form.get("query_iteration_id");
  const mentionType =
    mentionTypeRaw === "brand" || mentionTypeRaw === "competitor" || mentionTypeRaw === "industry"
      ? (mentionTypeRaw as "brand" | "competitor" | "industry")
      : null;
  const queryIterationId = typeof iterationIdRaw === "string" && iterationIdRaw.length > 0 ? iterationIdRaw : null;

  if (!(file instanceof File)) {
    return Response.json(
      {
        error: "validation_error",
        message: "CSV file is required.",
        details: { fields: [{ path: "file", message: "Expected multipart file." }] }
      },
      { status: 422 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const csvText = buffer.toString("utf8").replace(/^\uFEFF/, "");

  const [batch] = await db
    .insert(importBatches)
    .values({
      studyCorpusId: corpus.id,
      queryIterationId,
      mentionType,
      sourceSystem: "sentione_csv",
      sourceFileName: file.name || sourceLabel,
      sourceFileHash: fileHash(buffer),
      importedByUserId: session.appUser.id,
      status: "processing"
    })
    .returning();

  if (!batch) {
    throw new Error("Could not create import batch.");
  }

  try {
    const stats = await ingestSentioneCsv({
      corpusId: corpus.id,
      importBatchId: batch.id,
      sourceFileName: file.name || sourceLabel,
      csvText
    });

    await db
      .update(importBatches)
      .set({
        recordCount: stats.record_count,
        includedCount: stats.included_count,
        excludedCount: stats.excluded_count,
        duplicateCount: stats.duplicate_count,
        status: "completed"
      })
      .where(eq(importBatches.id, batch.id));

    return Response.json({
      import_batch_id: batch.id,
      stats
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[csv-upload] ingest failed:", message);
    await db.update(importBatches).set({ status: "failed" }).where(eq(importBatches.id, batch.id));
    return Response.json(
      { error: "import_failed", message },
      { status: 500 }
    );
  }
}
