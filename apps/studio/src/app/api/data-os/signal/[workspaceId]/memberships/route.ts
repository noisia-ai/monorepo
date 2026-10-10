import { z } from "zod";
import { loadSignalWorkspaceContextForTopics } from "../topics/_lib";
import {
  loadMembershipStatusForActorV1,
  requestMembershipsForActorV1,
  overrideMembershipsForActorV1,
  selectMembershipForActorV1,
  confirmMembershipsForActorV1,
  SignalLabelingError,
} from "@/lib/data-os/signal-concept-memberships";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const requestSchema = z
  .object({
    idempotency_key: z.string().regex(/^[A-Za-z0-9._:-]{8,200}$/u),
    budget_micro_usd: z.number().int().nonnegative().nullable().optional(),
    cap_micro_usd: z.number().int().nonnegative().nullable().optional(),
    full_recalculation: z.boolean().optional(),
  })
  .strict();
const confirmationSchema = z
  .object({
    confirm_run_id: z.string().uuid(),
    entity_context_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict();
const querySchema = z
  .object({
    concept_key: z.string().optional(),
    verdict: z
      .enum([
        "belongs",
        "not_belongs",
        "insufficient",
        "review_required",
        "refused",
        "error",
        "pending",
      ])
      .optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();
const patchSchema = z.union([
  z
    .object({
      overrides: z
        .array(
          z
            .object({
              root_id: z.string().uuid(),
              concept_key: z.string(),
              verdict: z.enum(["belongs", "not_belongs"]),
              decided_via: z.enum(["human_ui", "agent_assisted"]),
            })
            .strict(),
        )
        .min(1)
        .max(500),
    })
    .strict(),
  z
    .object({
      idempotency_key: z.string().regex(/^[A-Za-z0-9._:-]{8,200}$/u),
      selection: z
        .object({
          concept_key: z.string(),
          selected: z.boolean(),
          expected_selection_revision: z.number().int().nonnegative(),
        })
        .strict(),
    })
    .strict(),
]);
const errorResponse = (e: unknown) =>
  Response.json(
    {
      error:
        e instanceof SignalLabelingError ? e.code : "memberships_unavailable",
    },
    { status: e instanceof SignalLabelingError ? e.status : 503, headers },
  );
type Context = { params: Promise<{ workspaceId: string }> };
export async function GET(request: Request, context: Context) {
  const loaded = await loadSignalWorkspaceContextForTopics(
    (await context.params).workspaceId,
  );
  if ("response" in loaded) return loaded.response;
  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success)
    return Response.json(
      { error: "memberships_query_invalid" },
      { status: 400, headers },
    );
  try {
    return Response.json(
      await loadMembershipStatusForActorV1({
        workspace_id: loaded.workspace.id,
        actor_user_id: loaded.session.appUser.id,
        ...query.data,
      }, request.signal),
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
  const raw = await request.json().catch(() => null);
  const confirmation = confirmationSchema.safeParse(raw);
  try {
    if (confirmation.success)
      return Response.json(
        await confirmMembershipsForActorV1({
          workspace_id: loaded.workspace.id,
          actor_user_id: loaded.session.appUser.id,
          run_id: confirmation.data.confirm_run_id,
          entity_context_digest: confirmation.data.entity_context_digest,
        }),
        { headers },
      );
    const body = requestSchema.safeParse(raw);
    if (!body.success)
      return Response.json(
        { error: "memberships_request_invalid" },
        { status: 400, headers },
      );
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
export async function PATCH(request: Request, context: Context) {
  const loaded = await loadSignalWorkspaceContextForTopics(
    (await context.params).workspaceId,
  );
  if ("response" in loaded) return loaded.response;
  const body = patchSchema.safeParse(await request.json().catch(() => null));
  if (!body.success)
    return Response.json(
      { error: "memberships_override_invalid" },
      { status: 400, headers },
    );
  const access = {
    workspace_id: loaded.workspace.id,
    actor_user_id: loaded.session.appUser.id,
  };
  try {
    return Response.json(
      "overrides" in body.data
        ? await overrideMembershipsForActorV1({ ...access, ...body.data })
        : await selectMembershipForActorV1({ ...access, ...body.data }),
      { headers },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
