import {
  SIGNAL_ACQUISITION_IMPORT_CONTRACT_VERSION,
  SIGNAL_WORKSPACE_DATA_PLANE_CONTRACT_VERSION
} from "@noisia/query-engine";

import { loadSignalWorkspaceContextForManagement } from "@/app/api/data-os/_lib/load";
import {
  createWorkspaceImportUploadV1,
  listWorkspaceImportsV1,
  uploadWorkspaceImportRequestBodyV1,
  WorkspaceAsyncImportError,
  WORKSPACE_ASYNC_IMPORT_CONTRACT_VERSION
} from "@/lib/data-os/workspace-async-import";
import {
  finalizeWorkspaceImportUploadV1
} from "@/lib/data-os/workspace-async-import";
import { WorkspaceImportStorageError } from "@/lib/data-os/workspace-import-storage";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string;sourceId: string }> }
) {
  const { workspaceId,sourceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  const rows = await listWorkspaceImportsV1({ workspaceId: loaded.workspace.id,sourceId });
  return Response.json({
    contract_version: WORKSPACE_ASYNC_IMPORT_CONTRACT_VERSION,
    workspace_id: loaded.workspace.id,
    data_source_id: sourceId,
    imports: rows
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string;sourceId: string }> }
) {
  const { workspaceId,sourceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length<8 || idempotencyKey.length>500) {
    return Response.json({ error: "idempotency_key_required",message: "Idempotency-Key is required." },{ status: 400 });
  }
  const url = new URL(request.url);
  const contentType = request.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase() ?? "";
  try {
    if (contentType==="application/json") {
      const body = await request.json() as Record<string,unknown>;
      if (body.action!=="create-upload") {
        throw new WorkspaceAsyncImportError("unsupported_import_action",422);
      }
      if (body.acquisition_contract_version===SIGNAL_ACQUISITION_IMPORT_CONTRACT_VERSION) {
        throw new WorkspaceAsyncImportError("acquisition_import_requires_source_key_route",409);
      }
      const created = await createWorkspaceImportUploadV1({
        workspace: loaded.workspace,
        actor: loaded.session.appUser,
        sourceId,
        fileName: compact(String(body.file_name ?? ""),300),
        fileSizeBytes: Number(body.file_size_bytes),
        contentType: String(body.content_type ?? "text/csv"),
        contributedByStudyCorpusId: optionalString(body.study_corpus_id),
        supersedesImportBatchId: optionalString(body.supersedes_import_batch_id),
        idempotencyKey,
        acquisition: null
      });
      return Response.json({
        contract_version: WORKSPACE_ASYNC_IMPORT_CONTRACT_VERSION,
        workspace_id: loaded.workspace.id,
        data_source_id: sourceId,
        import: created.batch,
        upload: created.upload ? {
          protocol: "supabase-multipart-signed",
          bucket: created.upload.bucket,
          part_size_bytes: created.upload.partSizeBytes,
          parts: created.upload.parts.map((part) => ({
            part_number: part.partNumber,
            expected_size_bytes: part.expectedSizeBytes,
            upload_url: part.uploadUrl
          })),
          expires_in_seconds: created.upload.expiresInSeconds
        } : null,
        polling_url: pollingUrl(url,created.batch.id),
        replayed: created.replayed
      },{ status: 202 });
    }
    if (!request.body) throw new WorkspaceAsyncImportError("csv_required",422);
    const size = Number(request.headers.get("content-length"));
    const uploaded = await uploadWorkspaceImportRequestBodyV1({
      workspace: loaded.workspace,actor: loaded.session.appUser,sourceId,
      fileName: compact(url.searchParams.get("file_name") ?? "workspace-import.csv",300),
      fileSizeBytes: size,contentType: contentType || "text/csv",
      contributedByStudyCorpusId: url.searchParams.get("study_corpus_id"),
      supersedesImportBatchId: url.searchParams.get("supersedes_import_batch_id"),
      idempotencyKey,body: request.body
    });
    const finalized = await finalizeWorkspaceImportUploadV1({
      workspace: loaded.workspace,actor: loaded.session.appUser,sourceId,
      importBatchId: uploaded.batch.id,idempotencyKey: `${idempotencyKey}:finalize`
    });
    return Response.json({
      contract_version: WORKSPACE_ASYNC_IMPORT_CONTRACT_VERSION,
      compatibility_contract_version: SIGNAL_WORKSPACE_DATA_PLANE_CONTRACT_VERSION,
      workspace_id: loaded.workspace.id,data_source_id: sourceId,
      import: finalized.batch,polling_url: pollingUrl(url,finalized.batch.id),
      replayed: uploaded.replayed || finalized.replayed
    },{ status: 202 });
  } catch (error) {
    if (error instanceof WorkspaceAsyncImportError) {
      return Response.json({ error: error.code,message: operatorMessage(error.code) },{ status: error.status });
    }
    if (error instanceof WorkspaceImportStorageError) {
      return Response.json({
        error: error.code,
        message: operatorMessage(error.code)
      },{ status: storageErrorStatus(error) });
    }
    return Response.json({
      error: "import_unavailable",message: "The import could not be prepared. Retry safely with the same key."
    },{ status: 503 });
  }
}

function pollingUrl(url: URL,importBatchId: string) {
  return `${url.pathname}/${importBatchId}`;
}

function compact(value: string,maxLength: number) {
  return value.replace(/[\r\n]+/gu," ").trim().slice(0,maxLength) || "workspace-import.csv";
}

function optionalString(value: unknown) {
  return typeof value==="string" && value.trim() ? value.trim() : null;
}

function operatorMessage(code: string) {
  const messages: Record<string,string> = {
    source_not_ready: "Approve the workspace source scope before importing.",
    idempotency_conflict: "This Idempotency-Key was already used with different input.",
    upload_size_mismatch: "The durable upload is incomplete or has a different size.",
    uploaded_object_unavailable: "The durable upload is not available yet.",
    uploaded_object_size_unavailable: "The durable upload size could not be verified.",
    signed_upload_unavailable: "The resumable upload could not be authorized. Retry safely with the same file.",
    upload_failed: "The durable upload did not complete. Retry safely with the same file.",
    storage_authority_mismatch: "The durable upload does not belong to this workspace import.",
    storage_configuration_unavailable: "Durable import storage is unavailable.",
    acquisition_import_requires_source_key_route: "Use the workspace acquisition import endpoint with its connector key.",
    csv_required: "A CSV file is required.",
    file_size_invalid: "The CSV file size is invalid."
  };
  return messages[code] ?? "The workspace import request is not valid.";
}

function storageErrorStatus(error: WorkspaceImportStorageError) {
  if (error.code==="storage_authority_mismatch") return 409;
  if (error.code==="uploaded_object_unavailable" || error.code==="uploaded_object_size_unavailable") return 409;
  return error.status && error.status>=400 && error.status<500 ? 503 : 503;
}
