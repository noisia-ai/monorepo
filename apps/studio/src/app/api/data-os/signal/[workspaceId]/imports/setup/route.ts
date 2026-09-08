import { loadSignalWorkspaceContextForImport } from "@/app/api/data-os/_lib/load-import";
import { validateWorkspaceManualImportSetupInputV1 } from "@/lib/data-os/workspace-manual-import-contract";
import {
  loadWorkspaceManualImportSetupProductV1,
  prepareWorkspaceManualImportInTransactionV1,
  WorkspaceManualImportSetupError
} from "@/lib/data-os/workspace-manual-import-setup";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

export async function GET(_request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForImport(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    return Response.json(await loadWorkspaceManualImportSetupProductV1({
      workspace: loaded.workspace, actor: loaded.session.appUser, access: "manual-import" }), { headers });
  } catch { return rejected("manual_import_setup_unavailable", 503); }
}

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForImport(workspaceId);
  if ("response" in loaded) return loaded.response;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 500) return rejected("idempotency_key_required", 400);
  let input;
  try { input = validateWorkspaceManualImportSetupInputV1(await request.json()); }
  catch { return rejected("invalid_manual_import_setup", 422); }
  try {
    return Response.json(await prepareWorkspaceManualImportInTransactionV1({
      workspace: loaded.workspace, actor: loaded.session.appUser, access: "manual-import", idempotencyKey, input
    }), { headers });
  } catch (error) {
    if (error instanceof WorkspaceManualImportSetupError) return rejected(error.code, error.status);
    if (error instanceof Error && error.message.startsWith("Idempotency-Key")) return rejected("idempotency_conflict", 409);
    if (error instanceof Error && /unauthorized/u.test(error.message)) return rejected("forbidden", 403);
    return rejected("manual_import_setup_rejected", 409);
  }
}

function rejected(error: string, status: number) { return Response.json({ error }, { status, headers }); }
