import { SIGNAL_ACQUISITION_IMPORT_CONTRACT_VERSION } from "@noisia/query-engine";

import { loadSignalWorkspaceContextForManagement } from "@/app/api/data-os/_lib/load";
import {
  failWorkspaceImportUploadV1,
  finalizeWorkspaceImportUploadV1,
  loadWorkspaceImportV1,
  retryWorkspaceImportFromStorageV1,
  resolveWorkspaceImportConnectorV1,
  WorkspaceAsyncImportError,
  WORKSPACE_ASYNC_IMPORT_CONTRACT_VERSION
} from "@/lib/data-os/workspace-async-import";

export const runtime = "nodejs";
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string;importBatchId: string }> }
) {
  const { workspaceId,importBatchId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  const source = await resolveWorkspaceImportConnectorV1(loaded.workspace.id,importBatchId);
  if (!source) return operatorError("not_found",404);
  const item = await loadWorkspaceImportV1({
    workspaceId: loaded.workspace.id,sourceId: source.id,importBatchId
  });
  if (!item) return operatorError("not_found",404);
  return Response.json({
    contract_version: WORKSPACE_ASYNC_IMPORT_CONTRACT_VERSION,
    acquisition_contract_version: SIGNAL_ACQUISITION_IMPORT_CONTRACT_VERSION,
    source_key: source.source_key,import: publicImport(item)
  },{ headers: PRIVATE_HEADERS });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string;importBatchId: string }> }
) {
  const { workspaceId,importBatchId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  const source = await resolveWorkspaceImportConnectorV1(loaded.workspace.id,importBatchId);
  if (!source) return operatorError("not_found",404);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length<8 || idempotencyKey.length>500) {
    return operatorError("idempotency_key_required",400);
  }
  try {
    const body = await request.json().catch(() => ({})) as Record<string,unknown>;
    let result: { batch: Record<string,unknown>;replayed: boolean;jobId?: string };
    if (body.action==="complete-upload") {
      result = await finalizeWorkspaceImportUploadV1({
        workspace: loaded.workspace,actor: loaded.session.appUser,sourceId: source.id,
        importBatchId,idempotencyKey
      });
    } else if (body.action==="retry-from-storage") {
      result = await retryWorkspaceImportFromStorageV1({
        workspace: loaded.workspace,actor: loaded.session.appUser,sourceId: source.id,
        importBatchId,idempotencyKey
      });
    } else if (body.action==="fail-upload") {
      result = await failWorkspaceImportUploadV1({
        workspace: loaded.workspace,actor: loaded.session.appUser,sourceId: source.id,
        importBatchId,failureCode: body.failure_code==="upload_aborted"
          ? "upload_aborted" : "upload_transport_failed"
      });
    } else {
      return operatorError("unsupported_import_action",422);
    }
    const targetId = String(result.batch.id);
    const base = new URL(request.url).pathname.slice(0,-importBatchId.length);
    return Response.json({
      contract_version: WORKSPACE_ASYNC_IMPORT_CONTRACT_VERSION,
      acquisition_contract_version: SIGNAL_ACQUISITION_IMPORT_CONTRACT_VERSION,
      source_key: source.source_key,import: publicImport(result.batch),
      job_id: result.jobId ?? null,polling_url: `${base}${targetId}`,replayed: result.replayed
    },{ status: body.action==="fail-upload" ? 200 : 202,headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof WorkspaceAsyncImportError) return operatorError(error.code,error.status);
    return operatorError("queue_unavailable",503);
  }
}

function publicImport(value: Record<string,unknown>) {
  const safe = { ...value };
  delete safe.data_source_id;
  return safe;
}
function operatorError(code: string,status: number) {
  return Response.json({ error: code,message: code==="not_found"
    ? "The acquisition import was not found." : "The acquisition import operation is unavailable." },{
    status,headers: PRIVATE_HEADERS
  });
}
