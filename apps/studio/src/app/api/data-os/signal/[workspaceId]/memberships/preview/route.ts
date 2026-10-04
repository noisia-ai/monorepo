import { z } from "zod";
import { conceptForJudgeSchemaV1 } from "@noisia/query-engine";
import { loadSignalWorkspaceContextForTopics } from "../../topics/_lib";
import {
  requestMembershipsForActorV1,
  loadMembershipPreviewForActorV1,
  SignalLabelingError,
} from "@/lib/data-os/signal-concept-memberships";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const bodySchema = z
  .object({
    idempotency_key: z.string().regex(/^[A-Za-z0-9._:-]{8,200}$/u),
    concept: conceptForJudgeSchemaV1,
    budget_micro_usd: z.number().int().nonnegative().nullable().optional(),
    cap_micro_usd: z.number().int().nonnegative().nullable().optional(),
    full_recalculation: z.boolean().optional(),
  })
  .strict();
const errorResponse = (e: unknown) =>
  Response.json(
    {
      error:
        e instanceof SignalLabelingError
          ? e.code
          : "membership_preview_unavailable",
    },
    { status: e instanceof SignalLabelingError ? e.status : 503, headers },
  );
type Context = { params: Promise<{ workspaceId: string }> };
export async function GET(request: Request, context: Context) {
  const loaded = await loadSignalWorkspaceContextForTopics(
    (await context.params).workspaceId,
  );
  if ("response" in loaded) return loaded.response;
  const id = z
    .string()
    .uuid()
    .safeParse(new URL(request.url).searchParams.get("run_id"));
  if (!id.success)
    return Response.json(
      { error: "membership_preview_id_invalid" },
      { status: 400, headers },
    );
  try {
    return Response.json(
      await loadMembershipPreviewForActorV1({
        workspace_id: loaded.workspace.id,
        actor_user_id: loaded.session.appUser.id,
        run_id: id.data,
      }),
      { headers },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request, context: Context) {
  const loaded = await loadSignalWorkspaceContextForTopics(
    (await context.params).workspaceId,
  );
  if ("response" in loaded) return loaded.response;
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success)
    return Response.json(
      { error: "membership_preview_request_invalid" },
      { status: 400, headers },
    );
  try {
    return Response.json(
      await requestMembershipsForActorV1({
        workspace_id: loaded.workspace.id,
        actor_user_id: loaded.session.appUser.id,
        ...body.data,
      }),
      { status: 202, headers },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
