import {
  SIGNAL_DATA_SOURCE_CONNECTOR_CONTRACT_VERSION,
  SIGNAL_WORKSPACE_DATA_PLANE_CONTRACT_VERSION,
  validateSignalConnectorSourceInputV1,
  validateSignalWorkspaceSourceInputV1
} from "@noisia/query-engine";

import { loadSignalWorkspaceContextForManagement } from "@/app/api/data-os/_lib/load";
import {
  createWorkspaceDataSourceProductInTransactionV1,
  createWorkspaceConnectorSourceProductInTransactionV1,
  listWorkspaceDataSources,
  WorkspaceIngestionValidationError
} from "@/lib/data-os/workspace-ingestion";

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForManagement(workspaceId);
  if ("response" in loaded) return loaded.response;

  const rows = await listWorkspaceDataSources(loaded.workspace.id);
  return Response.json({
    contract_version: SIGNAL_WORKSPACE_DATA_PLANE_CONTRACT_VERSION,
    workspace_id: loaded.workspace.id,
    sources: rows.map((row) => row.sourceContractVersion===SIGNAL_DATA_SOURCE_CONNECTOR_CONTRACT_VERSION ? ({
      source_key: row.sourceKey,
      source_contract_version: row.sourceContractVersion,
      name: row.name,
      provider: row.provider,
      source_type: row.sourceType,
      connection_method: row.connectionMethod,
      governance_readiness: row.scopeReviewStatus,
      status: row.status,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    }) : ({
      id: row.id,source_key: row.sourceKey,source_contract_version: row.sourceContractVersion,
      name: row.name,provider: row.provider,source_type: row.sourceType,
      connection_method: row.connectionMethod,scope: row.governedScope,
      entity_id: row.governedEntityId,scope_review_status: row.scopeReviewStatus,
      status: row.status,created_at: row.createdAt.toISOString(),updated_at: row.updatedAt.toISOString()
    }))
  },{ headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  if (loaded.session.appUser.userType !== "noisia_internal") {
    return Response.json({ error: "forbidden",message: "Source management requires an internal operator." }, { status: 403 });
  }

  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 500) {
    return Response.json({ error: "idempotency_key_required",message: "Idempotency-Key is required." }, { status: 400 });
  }

  try {
    const body = await request.json();
    const connector = Boolean(body && typeof body === "object"
      && (body as { contract_version?: unknown }).contract_version === SIGNAL_DATA_SOURCE_CONNECTOR_CONTRACT_VERSION);
    const source = connector
      ? await createWorkspaceConnectorSourceProductInTransactionV1({
          workspace: loaded.workspace, actor: loaded.session.appUser, idempotencyKey,
          input: validateSignalConnectorSourceInputV1(body)
        })
      : await createWorkspaceDataSourceProductInTransactionV1({
          workspace: loaded.workspace, actor: loaded.session.appUser, idempotencyKey,
          input: validateSignalWorkspaceSourceInputV1(body)
        });
    return Response.json({
      contract_version: SIGNAL_WORKSPACE_DATA_PLANE_CONTRACT_VERSION,
      workspace_id: loaded.workspace.id,
      source
    }, { status: 201,headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceIngestionValidationError
        || (error instanceof Error && /must (?:be|contain)/u.test(error.message))) {
      return Response.json({
        error: "validation_error",
        message: error.message
      }, { status: 422 });
    }
    return Response.json({ error: "source_create_rejected",message: "The source could not be created from the current workspace state." }, { status: 409 });
  }
}
