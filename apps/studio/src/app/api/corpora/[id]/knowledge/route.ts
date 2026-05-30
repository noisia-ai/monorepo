import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { desc, eq } from "drizzle-orm";
import { brandKnowledgeSources } from "@noisia/db";
import { forbidden, unauthorized } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getCorpusForUser } from "@/lib/data/corpora";
import { db } from "@/lib/db";
import { getQueryEngineQueue } from "@/lib/queue/query-engine";

export const runtime = "nodejs";

const MAX_TOTAL_BYTES = 300 * 1024 * 1024;
const MAX_FILES_PER_BATCH = 20;
const MAX_RAW_TEXT_CHARS = 1_000_000;
const SUPPORTED_TYPES = new Set([
  "text/plain",
  "text/csv",
  "text/tab-separated-values",
  "application/json",
  "text/markdown",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream"
]);

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) return unauthorized();
  if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

  const { id } = await context.params;
  const corpus = await getCorpusForUser(session.appUser, id);

  if (!corpus) {
    return Response.json(
      { error: "not_found", message: "Corpus not found or not accessible." },
      { status: 404 }
    );
  }

  const rows = await db
    .select({
      id: brandKnowledgeSources.id,
      sourceKind: brandKnowledgeSources.sourceKind,
      title: brandKnowledgeSources.title,
      originalFileName: brandKnowledgeSources.originalFileName,
      fileSizeBytes: brandKnowledgeSources.fileSizeBytes,
      status: brandKnowledgeSources.status,
      errorMessage: brandKnowledgeSources.errorMessage,
      extractedPayload: brandKnowledgeSources.extractedPayload,
      createdAt: brandKnowledgeSources.createdAt
    })
    .from(brandKnowledgeSources)
    .where(eq(brandKnowledgeSources.studyCorpusId, corpus.id))
    .orderBy(desc(brandKnowledgeSources.createdAt));

  return Response.json({
    data: rows.map((row) => {
      const payload = row.extractedPayload && typeof row.extractedPayload === "object"
        ? row.extractedPayload as Record<string, unknown>
        : {};
      return {
        id: row.id,
        source_kind: row.sourceKind,
        title: row.title,
        file_name: row.originalFileName,
        file_size_bytes: row.fileSizeBytes,
        status: row.status,
        error_message: row.errorMessage,
        summary: stringValue(payload.summary),
        file_understanding: stringValue(payload.file_understanding),
        dataset_inventory: stringArray(payload.dataset_inventory),
        query_language: stringArray(payload.query_language).slice(0, 8),
        created_at: row.createdAt
      };
    })
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();

  if (!session) return unauthorized();
  if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

  const { id } = await context.params;
  const corpus = await getCorpusForUser(session.appUser, id);

  if (!corpus) {
    return Response.json(
      { error: "not_found", message: "Corpus not found or not accessible." },
      { status: 404 }
    );
  }

  const form = await request.formData();
  const sourceKind = String(form.get("source_kind") ?? "spreadsheet_archive");
  const files = form.getAll("files").filter((item): item is File => item instanceof File);

  if (files.length === 0) {
    return Response.json(
      { error: "validation_error", message: "Sube al menos un archivo de contexto." },
      { status: 422 }
    );
  }

  if (files.length > MAX_FILES_PER_BATCH) {
    return Response.json(
      { error: "too_many_files", message: `El intake acepta hasta ${MAX_FILES_PER_BATCH} archivos por batch.` },
      { status: 422 }
    );
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    return Response.json(
      { error: "file_too_large", message: "El intake acepta hasta 300 MB por batch." },
      { status: 413 }
    );
  }

  const created = [];
  const sourceIds: string[] = [];
  const uploadRoot = process.env.NOISIA_KNOWLEDGE_UPLOAD_DIR
    ? resolve(process.env.NOISIA_KNOWLEDGE_UPLOAD_DIR)
    : resolve(process.cwd(), ".data", "knowledge-uploads");
  const uploadDir = join(uploadRoot, corpus.id);
  await mkdir(uploadDir, { recursive: true });

  for (const file of files) {
    if (!isSupported(file)) {
      created.push({ file: file.name, status: "skipped", reason: "unsupported_type" });
      continue;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = createHash("sha256").update(buffer).digest("hex");
    const storagePath = join(uploadDir, `${randomUUID()}-${safeFileName(file.name)}`);
    await writeFile(storagePath, buffer);
    const rawText = extractRawTextSnapshot(file, buffer);

    const title = cleanTitle(file.name);
    const [row] = await db
      .insert(brandKnowledgeSources)
      .values({
        organizationId: corpus.organizationId,
        brandId: corpus.brandId,
        studyCorpusId: corpus.id,
        sourceKind,
        title,
        originalFileName: file.name,
        mimeType: file.type || "application/octet-stream",
        storagePath,
        fileSizeBytes: buffer.byteLength,
        fileHash: hash,
        rawText,
        extractedPayload: {
          intake: {
            file_name: file.name,
            byte_size: buffer.byteLength,
            sha256: hash,
            source_kind: sourceKind,
            raw_text_snapshot: Boolean(rawText),
            raw_text_truncated: rawText ? rawText.length >= MAX_RAW_TEXT_CHARS : false
          }
        },
        status: "pending",
        createdByUserId: session.appUser.id
      })
      .returning({ id: brandKnowledgeSources.id, status: brandKnowledgeSources.status });

    if (row?.id) {
      sourceIds.push(row.id);
    }
    created.push({ file: file.name, id: row?.id, status: row?.status ?? "pending" });
  }

  if (sourceIds.length === 0) {
    return Response.json({ data: created, job_id: null }, { status: 201 });
  }

  const queue = getQueryEngineQueue();
  const job = await queue.add(
    "process_knowledge_sources",
    {
      corpusId: corpus.id,
      sourceIds,
      requestedByUserId: session.appUser.id
    },
    {
      jobId: `knowledge-${corpus.id}-${Date.now()}`,
      attempts: 2,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { age: 60 * 60 * 24, count: 500 },
      removeOnFail: { age: 60 * 60 * 24 * 7, count: 1000 }
    }
  );

  return Response.json(
    {
      data: created,
      job_id: job.id,
      polling_url: `/api/jobs/${job.id}`
    },
    { status: 202 }
  );
}

function isSupported(file: File) {
  const name = file.name.toLowerCase();
  return (
    SUPPORTED_TYPES.has(file.type || "application/octet-stream") ||
    /\.(xlsx|xls|csv|tsv|txt|json|md)$/.test(name)
  );
}

function extractRawTextSnapshot(file: File, buffer: Buffer) {
  const name = file.name.toLowerCase();
  const mime = file.type.toLowerCase();
  const isTextLike =
    mime.startsWith("text/") ||
    mime === "application/json" ||
    /\.(csv|tsv|txt|json|md)$/.test(name);
  if (!isTextLike) return null;
  return buffer.toString("utf8").replace(/\u0000/g, "").slice(0, MAX_RAW_TEXT_CHARS);
}

function safeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120) || "upload";
}

function cleanTitle(fileName: string) {
  return fileName
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .slice(0, 180) || "Knowledge source";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
