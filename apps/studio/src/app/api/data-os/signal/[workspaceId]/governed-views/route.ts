import { z } from "zod";

import { loadSignalWorkspaceContextForManagement } from "@/app/api/data-os/_lib/load";
import {
  loadSignalGovernedViewsProductPreflightForWorkspaceV1,
  reconcileSignalGovernedViewProductInTransactionV1
} from "@/lib/data-os/signal-governed-view-orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const viewKey = z.enum(["brand", "competition", "category", "all-governed"]);

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string }> }
) {
  const loaded = await loadManaged(await context.params);
  if ("response" in loaded) return loaded.response;
  return Response.json(await loadSignalGovernedViewsProductPreflightForWorkspaceV1({
    workspace: loaded.workspace,
    actor: loaded.session.appUser
  }), { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
) {
  const loaded = await loadManaged(await context.params);
  if ("response" in loaded) return loaded.response;
  const key = idempotencyKey(request);
  if (!key) return missingKey();
  const parsed = z.object({ action: z.literal("reconcile"), view_key: viewKey }).strict()
    .safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return invalidCommand(parsed.error.flatten());
  try {
    const result = await reconcileSignalGovernedViewProductInTransactionV1({
      workspace: loaded.workspace,
      actor: loaded.session.appUser,
      viewKey: parsed.data.view_key,
      idempotencyKey: key
    });
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return rejected(error);
  }
}

async function loadManaged(params: { workspaceId: string }) {
  const loaded = await loadSignalWorkspaceContextForManagement(params.workspaceId);
  if ("response" in loaded) return loaded;
  if (loaded.session.appUser.userType !== "noisia_internal") {
    return { response: Response.json({ error: "forbidden", message: "Governed view management requires an internal operator." }, { status: 403 }) } as const;
  }
  return loaded;
}

function idempotencyKey(request: Request) {
  const value = request.headers.get("Idempotency-Key")?.trim() ?? "";
  return value.length >= 8 && value.length <= 500 ? value : null;
}

function missingKey() {
  return Response.json({ error: "idempotency_key_required", message: "Idempotency-Key is required." }, { status: 400 });
}

function invalidCommand(details: unknown) {
  return Response.json({ error: "invalid_governed_view_command", message: "The governed view command is invalid.", details }, { status: 422 });
}

function rejected(error: unknown) {
  void error;
  return Response.json({
    error: "governed_view_operation_rejected",
    message: "The governed view operation could not be applied to the current workspace state."
  }, { status: 409 });
}
