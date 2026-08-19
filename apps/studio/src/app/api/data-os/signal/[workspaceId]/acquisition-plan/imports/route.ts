import {
  SIGNAL_ACQUISITION_IMPORT_CONTRACT_VERSION,
  validateSignalAcquisitionImportInputV2,
  validateSignalAcquisitionSlotKeyV1
} from "@noisia/query-engine";

import { loadSignalWorkspaceContextForManagement } from "@/app/api/data-os/_lib/load";
import {
  createWorkspaceImportUploadV1,
  listWorkspaceImportsV1,
  resolveWorkspaceConnectorByKeyV1,
  WorkspaceAsyncImportError,
  WORKSPACE_ASYNC_IMPORT_CONTRACT_VERSION
} from "@/lib/data-os/workspace-async-import";
import { WorkspaceImportStorageError } from "@/lib/data-os/workspace-import-storage";

export const runtime = "nodejs";
export const maxDuration = 60;

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  const sourceKey = new URL(request.url).searchParams.get("source_key") ?? "";
  const requestedSlotKey = new URL(request.url).searchParams.get("slot_key");
  let slotKey: string | null = null;
  if (requestedSlotKey) {
    try { slotKey = validateSignalAcquisitionSlotKeyV1(requestedSlotKey); }
    catch { return operatorError("invalid_slot_key",422); }
  }
  const source = await resolveWorkspaceConnectorByKeyV1(loaded.workspace.id,sourceKey);
  if (!source) return operatorError("connector_not_found",404);
  const imports = await listWorkspaceImportsV1({
    workspaceId: loaded.workspace.id,sourceId: source.id,slotKey
  });
  return Response.json({
    contract_version: WORKSPACE_ASYNC_IMPORT_CONTRACT_VERSION,
    acquisition_contract_version: SIGNAL_ACQUISITION_IMPORT_CONTRACT_VERSION,
    source_key: source.source_key,slot_key: slotKey,
    imports: imports.map(publicImport)
  },{ headers: PRIVATE_HEADERS });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length<8 || idempotencyKey.length>500) {
    return operatorError("idempotency_key_required",400);
  }
  try {
    const raw = await request.json();
    let input: ReturnType<typeof validateSignalAcquisitionImportInputV2>;
    try {
      input = validateSignalAcquisitionImportInputV2(raw);
    } catch {
      return operatorError("invalid_acquisition_import",422);
    }
    if (input.supersedes_import_key!==null) {
      return operatorError("recovery_requires_existing_import",422);
    }
    const source = await resolveWorkspaceConnectorByKeyV1(loaded.workspace.id,input.source_key);
    if (!source) return operatorError("connector_not_found",404);
    const created = await createWorkspaceImportUploadV1({
      workspace: loaded.workspace,actor: loaded.session.appUser,sourceId: source.id,
      fileName: input.file_name,fileSizeBytes: input.file_size_bytes,contentType: input.content_type,
      contributedByStudyCorpusId: null,supersedesImportBatchId: null,idempotencyKey,
      acquisition: {
        sourceKey: input.source_key,slotKey: input.slot_key,
        queryEvidence: input.query_evidence.class==="operator_attested"
          ? {class:"operator_attested",queryVersion:input.query_evidence.query_version,reason:null}
          : {class:"unavailable",queryVersion:null,reason:input.query_evidence.reason},
        period: input.period
      }
    });
    const url = new URL(request.url);
    return Response.json({
      contract_version: WORKSPACE_ASYNC_IMPORT_CONTRACT_VERSION,
      acquisition_contract_version: SIGNAL_ACQUISITION_IMPORT_CONTRACT_VERSION,
      source_key: input.source_key,
      import: publicImport(created.batch),
      upload: created.upload ? {
        protocol: "supabase-multipart-signed",
        bucket: created.upload.bucket,
        part_size_bytes: created.upload.partSizeBytes,
        parts: created.upload.parts.map((part) => ({
          part_number: part.partNumber,expected_size_bytes: part.expectedSizeBytes,
          upload_url: part.uploadUrl
        })),
        expires_in_seconds: created.upload.expiresInSeconds
      } : null,
      polling_url: `${url.pathname}/${created.batch.id}`,
      replayed: created.replayed
    },{ status: 202,headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof WorkspaceAsyncImportError) return operatorError(error.code,error.status);
    if (error instanceof WorkspaceImportStorageError) return operatorError(error.code,503);
    return operatorError("acquisition_import_unavailable",503);
  }
}

function publicImport(value: Record<string,unknown>) {
  const safe = { ...value };
  delete safe.data_source_id;
  return safe;
}

function operatorError(code: string,status: number) {
  const messages: Record<string,string> = {
    idempotency_key_required: "Idempotency-Key is required.",
    connector_not_found: "The connector is unavailable for this workspace.",
    invalid_acquisition_import: "The acquisition import request is invalid.",
    recovery_requires_existing_import: "Retry an existing failed import from its polling resource.",
    source_not_ready: "Complete connector and provenance governance before importing.",
    acquisition_authority_unavailable: "The current plan, slot, query, or rights authority is unavailable.",
    provider_execution_evidence_required: "Provider verification requires server-owned execution evidence.",
    idempotency_conflict: "This Idempotency-Key was already used with different input.",
    storage_configuration_unavailable: "Durable import storage is unavailable."
  };
  return Response.json({ error: code,message: messages[code] ?? "The acquisition import is unavailable." },{
    status,headers: PRIVATE_HEADERS
  });
}
