import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";

import { and, eq } from "drizzle-orm";

import {
  corpusEntities,
  importBatches,
  queryIterations,
  queryPacks,
  queryValidationRuns
} from "@noisia/db";
import { forbidden, unauthorized } from "@/lib/api/responses";

export const runtime = "nodejs";
export const maxDuration = 900; // 15 min — very large CSVs (hundreds of MB) stream + ingest in parallel
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { advanceCorpusRevision } from "@/lib/corpus/revision";
import { ingestSentioneCsvStream } from "@/lib/csv/sentione";
import { getCorpusForUser } from "@/lib/data/corpora";
import { db } from "@/lib/db";
import { getQueryEngineQueue } from "@/lib/queue/query-engine";

const WORKER_INGEST_THRESHOLD_BYTES = 50 * 1024 * 1024;

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
  // Metadata travels in query params and the CSV is the raw request body. This
  // lets the server stream the provider-neutral listening export instead of
  // buffering the whole multipart payload in memory, which OOMs on ~0.5GB CSVs.
  const query = new URL(request.url).searchParams;
  const sourceLabel = query.get("source_label") ?? "listening_csv";
  const fileNameRaw = query.get("file_name");
  const fileName = typeof fileNameRaw === "string" && fileNameRaw.trim().length > 0 ? fileNameRaw.trim().slice(0, 300) : sourceLabel;
  const mentionTypeRaw = query.get("mention_type");
  const iterationIdRaw = query.get("query_iteration_id");
  const queryPackIdRaw = query.get("query_pack_id");
  const competitorIdRaw = query.get("competitor_id");
  const corpusEntityIdRaw = query.get("corpus_entity_id");
  const entityLabelRaw = query.get("entity_label");
  const entityKindRaw = query.get("entity_kind");
  const mentionType =
    mentionTypeRaw === "brand" || mentionTypeRaw === "competitor" || mentionTypeRaw === "industry"
      ? (mentionTypeRaw as "brand" | "competitor" | "industry")
      : null;
  const queryIterationId = isUuid(iterationIdRaw) ? iterationIdRaw : null;
  const queryPackId = isUuid(queryPackIdRaw) ? queryPackIdRaw : null;
  const [linkedQueryPack] = queryPackId
    ? await db
        .select({
          id: queryPacks.id,
          queryIterationId: queryPacks.queryIterationId,
          lensSlug: queryPacks.lensSlug,
          signalIntent: queryPacks.signalIntent,
          scope: queryPacks.scope
        })
        .from(queryPacks)
        .where(and(eq(queryPacks.id, queryPackId), eq(queryPacks.studyCorpusId, corpus.id)))
        .limit(1)
    : [];
  if (queryPackId && (!linkedQueryPack || linkedQueryPack.id !== queryPackId)) {
    return Response.json(
      { error: "validation_error", message: "Query pack not found for this corpus." },
      { status: 422 }
    );
  }
  if (
    linkedQueryPack?.queryIterationId &&
    queryIterationId &&
    linkedQueryPack.queryIterationId !== queryIterationId
  ) {
    return Response.json(
      { error: "validation_error", message: "Query pack does not belong to the selected iteration." },
      { status: 422 }
    );
  }
  const resolvedQueryIterationId = queryIterationId ?? linkedQueryPack?.queryIterationId ?? null;
  const [linkedIteration] = resolvedQueryIterationId
    ? await db
        .select({
          id: queryIterations.id,
          decision: queryIterations.insightsManagerDecision,
          approvedValidationRunId: queryIterations.approvedQueryValidationRunId
        })
        .from(queryIterations)
        .where(and(
          eq(queryIterations.id, resolvedQueryIterationId),
          eq(queryIterations.studyCorpusId, corpus.id)
        ))
        .limit(1)
    : [];
  if (resolvedQueryIterationId && !linkedIteration) {
    return Response.json(
      { error: "validation_error", message: "Query iteration not found for this corpus." },
      { status: 422 }
    );
  }

  const [approvedValidationRun] = linkedIteration?.approvedValidationRunId
    ? await db
        .select({ id: queryValidationRuns.id, status: queryValidationRuns.status })
        .from(queryValidationRuns)
        .where(and(
          eq(queryValidationRuns.id, linkedIteration.approvedValidationRunId),
          eq(queryValidationRuns.studyCorpusId, corpus.id),
          eq(queryValidationRuns.queryIterationId, linkedIteration.id)
        ))
        .limit(1)
    : [];
  if (
    linkedIteration &&
    (
      linkedIteration.decision !== "query_approved" ||
      !approvedValidationRun ||
      approvedValidationRun.status !== "ready"
    )
  ) {
    return Response.json(
      {
        error: "query_not_approved",
        message: "Aprueba una query confirmada con una muestra fresca de la fuente de listening antes de importar sus menciones."
      },
      { status: 409 }
    );
  }
  const competitorId =
    isUuid(competitorIdRaw)
      ? competitorIdRaw
      : null;
  const corpusEntityId =
    isUuid(corpusEntityIdRaw)
      ? corpusEntityIdRaw
      : null;
  const [linkedEntity] = corpusEntityId
    ? await db
        .select({
          id: corpusEntities.id,
          competitorId: corpusEntities.competitorId,
          entityKind: corpusEntities.entityKind,
          name: corpusEntities.name
        })
        .from(corpusEntities)
        .where(and(eq(corpusEntities.id, corpusEntityId), eq(corpusEntities.studyCorpusId, corpus.id)))
        .limit(1)
    : [];
  if (corpusEntityId && (!linkedEntity || linkedEntity.id !== corpusEntityId)) {
    return Response.json(
      { error: "validation_error", message: "Corpus entity not found." },
      { status: 422 }
    );
  }
  const entityLabel =
    typeof entityLabelRaw === "string" && entityLabelRaw.trim().length > 0
      ? entityLabelRaw.trim().slice(0, 140)
      : linkedEntity?.name ?? defaultEntityLabel(mentionType);
  const entityKind = linkedEntity?.entityKind ?? normalizeEntityKind(entityKindRaw, mentionType, competitorId, entityLabel);
  const resolvedCompetitorId = linkedEntity?.competitorId ?? competitorId;
  const shouldQueueIngest = shouldUseWorkerIngest(request, query, {
    hasSharedCsvUploadDir: hasConfiguredCsvUploadDir()
  });

  if (!request.body) {
    return Response.json(
      {
        error: "validation_error",
        message: "CSV file is required.",
        details: { fields: [{ path: "file", message: "Expected a CSV request body." }] }
      },
      { status: 422 }
    );
  }

  const [batch] = await db
    .insert(importBatches)
    .values({
      studyCorpusId: corpus.id,
      queryIterationId: resolvedQueryIterationId,
      queryPackId: linkedQueryPack?.id ?? null,
      queryValidationRunId: approvedValidationRun?.id ?? null,
      mentionType,
      competitorId: resolvedCompetitorId,
      corpusEntityId: linkedEntity?.id,
      entityKind,
      entityLabel,
      sourceSystem: "listening_csv",
      sourceFileName: fileName,
      sourceFileHash: "pending",
      importedByUserId: session.appUser.id,
      status: shouldQueueIngest ? "queued" : "processing"
    })
    .returning();

  if (!batch) {
    throw new Error("Could not create import batch.");
  }

  if (shouldQueueIngest) {
    try {
      const uploadRoot = process.env.NOISIA_CSV_UPLOAD_DIR
        ? resolve(process.env.NOISIA_CSV_UPLOAD_DIR)
        : resolve(process.cwd(), ".data", "csv-uploads");
      const uploadDir = join(uploadRoot, corpus.id);
      await mkdir(uploadDir, { recursive: true });
      const storagePath = join(uploadDir, `${randomUUID()}-${safeFileName(fileName)}`);
      const bytes = await persistRawUpload(request.body, storagePath);

      const queue = getQueryEngineQueue();
      const job = await queue.add(
        "ingest_mentions_csv",
        {
          corpusId: corpus.id,
          importBatchId: batch.id,
          sourceFileName: fileName,
          storagePath,
          entityLabel
        },
        {
          jobId: `csv-ingest-${batch.id}`,
          attempts: 1,
          removeOnComplete: { age: 60 * 60 * 24, count: 500 },
          removeOnFail: { age: 60 * 60 * 24 * 7, count: 1000 }
        }
      );

      return Response.json(
        {
          import_batch_id: batch.id,
          query_validation_run_id: approvedValidationRun?.id ?? null,
          job_id: job.id,
          polling_url: `/api/jobs/${job.id}`,
          status: "queued",
          file_size_bytes: bytes
        },
        { status: 202 }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[csv-upload] queue ingest failed:", message);
      await db.update(importBatches).set({ status: "failed" }).where(eq(importBatches.id, batch.id));
      return Response.json(
        { error: "queue_failed", message },
        { status: 500 }
      );
    }
  }

  try {
    const { stats, fileHash: hash } = await ingestSentioneCsvStream({
      corpusId: corpus.id,
      importBatchId: batch.id,
      sourceFileName: fileName,
      entityLabel,
      stream: request.body
    });

    await db
      .update(importBatches)
      .set({
        recordCount: stats.record_count,
        includedCount: stats.included_count,
        excludedCount: stats.excluded_count,
        duplicateCount: stats.duplicate_count,
        sourceFileHash: hash,
        status: "completed"
      })
      .where(eq(importBatches.id, batch.id));

    const persistedCount = stats.included_count + stats.excluded_count;
    const corpusRevision = persistedCount > 0
      ? await advanceCorpusRevision(corpus.id)
      : null;

    return Response.json({
      import_batch_id: batch.id,
      query_validation_run_id: approvedValidationRun?.id ?? null,
      stats,
      corpus_revision: corpusRevision
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

function shouldUseWorkerIngest(
  request: Request,
  query: URLSearchParams,
  options: { hasSharedCsvUploadDir: boolean }
) {
  if (!options.hasSharedCsvUploadDir) return false;
  if (query.get("async") === "1") return true;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  return Number.isFinite(contentLength) && contentLength >= WORKER_INGEST_THRESHOLD_BYTES;
}

function hasConfiguredCsvUploadDir() {
  return typeof process.env.NOISIA_CSV_UPLOAD_DIR === "string" && process.env.NOISIA_CSV_UPLOAD_DIR.trim().length > 0;
}

async function persistRawUpload(stream: ReadableStream<Uint8Array>, storagePath: string) {
  return new Promise<number>((resolvePromise, rejectPromise) => {
    let bytes = 0;
    const source = Readable.fromWeb(stream as unknown as Parameters<typeof Readable.fromWeb>[0]);
    const target = createWriteStream(storagePath, { flags: "wx" });
    source.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
    });
    source.on("error", rejectPromise);
    target.on("error", rejectPromise);
    target.on("finish", () => resolvePromise(bytes));
    source.pipe(target);
  });
}

function safeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 160) || "mentions.csv";
}

function isUuid(value: string | null): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function defaultEntityLabel(mentionType: "brand" | "competitor" | "industry" | null) {
  if (mentionType === "brand") return "Marca";
  if (mentionType === "competitor") return "Pool competitivo";
  if (mentionType === "industry") return "Categoría";
  return null;
}

function normalizeEntityKind(
  raw: FormDataEntryValue | null,
  mentionType: "brand" | "competitor" | "industry" | null,
  competitorId: string | null,
  entityLabel: string | null
) {
  if (
    raw === "primary_brand" ||
    raw === "competitor_pool" ||
    raw === "competitor" ||
    raw === "category"
  ) {
    return raw;
  }

  if (mentionType === "brand") return "primary_brand";
  if (mentionType === "industry") return "category";
  if (mentionType === "competitor") {
    return competitorId || (entityLabel && entityLabel !== "Pool competitivo") ? "competitor" : "competitor_pool";
  }

  return "unknown";
}
