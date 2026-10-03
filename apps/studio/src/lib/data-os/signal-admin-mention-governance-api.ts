import { z } from "zod";

import {
  mutateWorkspaceCanonicalMentionGovernance,
  SignalMentionGovernanceContractError
} from "./signal-admin-mention-governance";

type LoadedContext =
  | { response: Response }
  | { workspace: { id: string }; session: { appUser: { id: string } } };

export type SignalAdminMentionGovernanceApiDependencies = {
  loadContext: (workspaceId: string) => Promise<LoadedContext>;
  mutate: typeof mutateWorkspaceCanonicalMentionGovernance;
};

const bodySchema = z.object({
  action: z.enum(["include", "exclude", "revert", "send_to_review"]),
  reason: z.string().trim().min(3).max(1_000)
}).strict();

export async function handleSignalAdminMentionGovernanceMutation(
  request: Request,
  workspaceId: string,
  mentionId: string,
  dependencies: SignalAdminMentionGovernanceApiDependencies
) {
  const loaded = await dependencies.loadContext(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    z.string().uuid().parse(mentionId);
    const body = bodySchema.parse(await request.json());
    const payload = await dependencies.mutate({
      workspaceId: loaded.workspace.id,
      mentionId,
      actorUserId: loaded.session.appUser.id,
      action: body.action,
      reason: body.reason,
      idempotencyKey: requiredIdempotencyKey(request)
    });
    return Response.json(payload, {
      status: payload.was_replayed ? 200 : 201,
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({
        error: "invalid_mention_governance_input",
        message: "Mention governance request is invalid.",
        details: error.flatten()
      }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
    }
    if (error instanceof SignalMentionGovernanceContractError) {
      const status = error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 400;
      return Response.json({ error: error.code, message: error.message }, {
        status,
        headers: { "Cache-Control": "private, no-store" }
      });
    }
    throw error;
  }
}

function requiredIdempotencyKey(request: Request) {
  const value = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (value.length < 8 || value.length > 500) {
    throw new SignalMentionGovernanceContractError(
      "invalid_input",
      "Idempotency-Key must be between 8 and 500 characters."
    );
  }
  return value;
}
