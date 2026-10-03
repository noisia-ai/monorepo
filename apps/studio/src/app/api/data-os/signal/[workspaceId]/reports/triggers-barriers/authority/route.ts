import { z } from "zod";

import { loadSignalWorkspaceContextForManagement } from "@/app/api/data-os/_lib/load";
import {
  loadSignalStrategicProductStatusForWorkspaceV1,
  reconcileSignalStrategicProductAuthorityInTransactionV1
} from "@/lib/data-os/signal-strategic-product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.enum(["reconcile", "promote"]) }).strict();

export async function GET(_request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  if (loaded.session.appUser.userType !== "noisia_internal") return Response.json({ error: "forbidden" }, { status: 403 });
  return Response.json(await loadSignalStrategicProductStatusForWorkspaceV1({
    workspace: loaded.workspace,actor: loaded.session.appUser
  }), { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  if (loaded.session.appUser.userType !== "noisia_internal") return Response.json({ error: "forbidden" }, { status: 403 });
  const key = request.headers.get("Idempotency-Key")?.trim() ?? "";
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || key.length < 8 || key.length > 500) {
    return Response.json({ error: "invalid_strategic_authority_command", message: "A closed action and Idempotency-Key are required." }, { status: 422 });
  }
  try {
    const result = await reconcileSignalStrategicProductAuthorityInTransactionV1({
      workspace: loaded.workspace,actor: loaded.session.appUser,
      idempotencyKey: key,promote: parsed.data.action === "promote"
    });
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "strategic_authority_rejected", message: "Strategic authority could not be prepared from the current workspace state." }, { status: 409 });
  }
}
