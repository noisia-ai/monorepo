import { z } from "zod";

import { loadSignalWorkspaceContextForManagement } from "@/app/api/data-os/_lib/load";
import { transitionSignalGovernedViewProductV1 } from "@/lib/data-os/signal-governed-view-orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const viewSchema = z.enum(["brand", "competition", "category", "all-governed"]);
const bodySchema = z.object({ expected_set_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/u) }).strict();

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; viewKey: string }> }) {
  const params = await context.params;
  const loaded = await loadSignalWorkspaceContextForManagement(params.workspaceId);
  if ("response" in loaded) return loaded.response;
  if (loaded.session.appUser.userType !== "noisia_internal") return Response.json({ error: "forbidden" }, { status: 403 });
  const view = viewSchema.safeParse(params.viewKey);
  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  const key = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (!view.success || !body.success || key.length < 8 || key.length > 500) {
    return Response.json({ error: "invalid_governed_view_withdrawal", message: "A closed view, CAS digest and Idempotency-Key are required." }, { status: 422 });
  }
  try {
    const result = await transitionSignalGovernedViewProductV1({
      workspace: loaded.workspace, actor: loaded.session.appUser,
      viewKey: view.data, action: "withdraw", expectedSetDigest: body.data.expected_set_digest,
      idempotencyKey: key
    });
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "governed_view_withdrawal_rejected", message: "The governed view could not be withdrawn from its current state." }, { status: 409 });
  }
}
