import { loadSignalWorkspaceContextForManagement } from "@/app/api/data-os/_lib/load";
import {
  failWorkspaceImportUploadV1,
  finalizeWorkspaceImportUploadV1,
  loadWorkspaceImportV1,
  retryWorkspaceImportFromStorageV1,
  WorkspaceAsyncImportError,
  WORKSPACE_ASYNC_IMPORT_CONTRACT_VERSION
} from "@/lib/data-os/workspace-async-import";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string;sourceId: string;importBatchId: string }> }
) {
  const { workspaceId,sourceId,importBatchId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  const item = await loadWorkspaceImportV1({
    workspaceId: loaded.workspace.id,sourceId,importBatchId
  });
  if (!item) return Response.json({ error: "not_found",message: "Import was not found." },{ status: 404 });
  return Response.json({
    contract_version: WORKSPACE_ASYNC_IMPORT_CONTRACT_VERSION,
    workspace_id: loaded.workspace.id,data_source_id: sourceId,import: item
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string;sourceId: string;importBatchId: string }> }
) {
  const { workspaceId,sourceId,importBatchId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length<8 || idempotencyKey.length>500) {
    return Response.json({ error: "idempotency_key_required",message: "Idempotency-Key is required." },{ status: 400 });
  }
  try {
    const body = await request.json().catch(() => ({})) as Record<string,unknown>;
    if (body.action==="fail-upload") {
      const failureCode = body.failure_code==="upload_aborted"
        ? "upload_aborted" as const
        : "upload_transport_failed" as const;
      const result = await failWorkspaceImportUploadV1({
        workspace: loaded.workspace,actor: loaded.session.appUser,sourceId,
        importBatchId,failureCode
      });
      return Response.json({
        contract_version: WORKSPACE_ASYNC_IMPORT_CONTRACT_VERSION,
        workspace_id: loaded.workspace.id,data_source_id: sourceId,
        import: result.batch,polling_url: new URL(request.url).pathname,replayed: result.replayed
      });
    }
    if (body.action==="retry-from-storage") {
      const result=await retryWorkspaceImportFromStorageV1({
        workspace: loaded.workspace,actor: loaded.session.appUser,sourceId,
        importBatchId,idempotencyKey
      });
      const pollingUrl=new URL(request.url);
      pollingUrl.pathname=`${pollingUrl.pathname.slice(0,-importBatchId.length)}${result.batch.id}`;
      return Response.json({
        contract_version: WORKSPACE_ASYNC_IMPORT_CONTRACT_VERSION,
        workspace_id: loaded.workspace.id,data_source_id: sourceId,
        import: result.batch,job_id: result.jobId,
        polling_url: pollingUrl.pathname,replayed: result.replayed
      },{ status: 202 });
    }
    if (body.action!=="complete-upload") {
      throw new WorkspaceAsyncImportError("unsupported_import_action",422);
    }
    const result = await finalizeWorkspaceImportUploadV1({
      workspace: loaded.workspace,actor: loaded.session.appUser,sourceId,
      importBatchId,idempotencyKey
    });
    return Response.json({
      contract_version: WORKSPACE_ASYNC_IMPORT_CONTRACT_VERSION,
      workspace_id: loaded.workspace.id,data_source_id: sourceId,
      import: result.batch,polling_url: new URL(request.url).pathname,replayed: result.replayed
    },{ status: 202 });
  } catch (error) {
    if (error instanceof WorkspaceAsyncImportError) {
      return Response.json({ error: error.code,message: "The upload is incomplete or unavailable." },{ status: error.status });
    }
    console.warn("workspace-import-operation-failed",{
      diagnostic_code: databaseDiagnosticCode(error)
    });
    return Response.json({
      error: "queue_unavailable",
      diagnostic_code: databaseDiagnosticCode(error),
      message: "The import could not be queued safely."
    },{ status: 503 });
  }
}

function databaseDiagnosticCode(error: unknown) {
  if (!error || typeof error!=="object" || !("code" in error)) return "not_available";
  const code = String(error.code);
  return /^[0-9A-Z_]{3,32}$/u.test(code) ? code : "not_available";
}
