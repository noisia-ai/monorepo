import { z } from "zod";

import {
  createWorkspaceManualSemanticAssertion,
  decideWorkspaceSemanticAssertion,
  generateWorkspaceSemanticCandidates,
  listWorkspaceSemanticAssertionHistory,
  listWorkspaceSemanticReviewQueue,
  SignalSemanticReviewContractError,
  supersedeWorkspaceSemanticAssertion
} from "@/lib/data-os/signal-semantic-review";

type LoadedReviewContext =
  | { response: Response }
  | {
      workspace: { id: string };
      session: { appUser: { id: string } };
    };

export type SignalSemanticReviewApiDependencies = {
  loadContext: (workspaceId: string) => Promise<LoadedReviewContext>;
  listQueue: typeof listWorkspaceSemanticReviewQueue;
  generateCandidates: typeof generateWorkspaceSemanticCandidates;
  createAssertion: typeof createWorkspaceManualSemanticAssertion;
  reviewAssertion: typeof decideWorkspaceSemanticAssertion;
  supersedeAssertion: typeof supersedeWorkspaceSemanticAssertion;
  listHistory: typeof listWorkspaceSemanticAssertionHistory;
};

export const signalSemanticReviewApiDependencies = {
  listQueue: listWorkspaceSemanticReviewQueue,
  generateCandidates: generateWorkspaceSemanticCandidates,
  createAssertion: createWorkspaceManualSemanticAssertion,
  reviewAssertion: decideWorkspaceSemanticAssertion,
  supersedeAssertion: supersedeWorkspaceSemanticAssertion,
  listHistory: listWorkspaceSemanticAssertionHistory
} satisfies Omit<SignalSemanticReviewApiDependencies, "loadContext">;

const scopeSchema = z.enum(["primary_brand", "competitor", "category", "reference", "unattributed"]);
const confidenceBandSchema = z.enum(["high", "medium", "low"]);
const stateSchema = z.enum([
  "candidate_pending",
  "current_approved",
  "current_rejected",
  "unresolved",
  "needs_context"
]);
const uuidSchema = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const assertionInputSchema = z.object({
  mention_id: uuidSchema,
  scope: scopeSchema,
  entity_id: uuidSchema.nullable().optional(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().trim().min(3).max(2_000)
}).strict();
const decisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  rationale: z.string().trim().min(3).max(2_000)
}).strict();
const supersedeSchema = assertionInputSchema.omit({ mention_id: true });
const candidateSchema = z.object({ mode: z.enum(["dry-run", "apply"]) }).strict();

export async function handleSignalSemanticReviewList(
  request: Request,
  workspaceId: string,
  dependencies: SignalSemanticReviewApiDependencies
) {
  const loaded = await dependencies.loadContext(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    const params = new URL(request.url).searchParams;
    const limit = Number(params.get("limit") ?? "50");
    const parsed = z.object({
      mention: uuidSchema.optional(),
      state: stateSchema.optional(),
      proposed_scope: scopeSchema.optional(),
      confidence_band: confidenceBandSchema.optional(),
      data_source_id: uuidSchema.optional(),
      platform: z.string().trim().min(1).max(100).optional(),
      start: dateSchema.optional(),
      end: dateSchema.optional()
    }).strict().parse(Object.fromEntries(
      [...params.entries()].filter(([key]) => !["cursor", "limit"].includes(key))
    ));
    const { mention, ...filters } = parsed;
    const payload = await dependencies.listQueue({
      workspaceId: loaded.workspace.id,
      filters: {
        ...filters,
        mention_id: mention
      },
      cursor: params.get("cursor"),
      limit
    });
    return semanticJson(payload);
  } catch (error) {
    return semanticErrorResponse(error);
  }
}

export async function handleSignalSemanticCandidateGeneration(
  request: Request,
  workspaceId: string,
  dependencies: SignalSemanticReviewApiDependencies
) {
  const loaded = await dependencies.loadContext(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    const body = candidateSchema.parse(await request.json());
    const payload = await dependencies.generateCandidates({
      workspaceId: loaded.workspace.id,
      mode: body.mode
    });
    return semanticJson(payload, body.mode === "apply" && payload.writes_performed ? 201 : 200);
  } catch (error) {
    return semanticErrorResponse(error);
  }
}

export async function handleSignalSemanticAssertionCreation(
  request: Request,
  workspaceId: string,
  dependencies: SignalSemanticReviewApiDependencies
) {
  const loaded = await dependencies.loadContext(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    const body = assertionInputSchema.parse(await request.json());
    const payload = await dependencies.createAssertion({
      workspaceId: loaded.workspace.id,
      reviewerUserId: loaded.session.appUser.id,
      mentionId: body.mention_id,
      scope: body.scope,
      entityId: body.entity_id ?? null,
      confidence: body.confidence,
      rationale: body.rationale,
      idempotencyKey: requiredIdempotencyKey(request)
    });
    return semanticJson(payload, 201);
  } catch (error) {
    return semanticErrorResponse(error);
  }
}

export async function handleSignalSemanticAssertionReview(
  request: Request,
  workspaceId: string,
  assertionId: string,
  dependencies: SignalSemanticReviewApiDependencies
) {
  const loaded = await dependencies.loadContext(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    uuidSchema.parse(assertionId);
    const body = decisionSchema.parse(await request.json());
    const payload = await dependencies.reviewAssertion({
      workspaceId: loaded.workspace.id,
      reviewerUserId: loaded.session.appUser.id,
      assertionId,
      decision: body.decision,
      rationale: body.rationale,
      idempotencyKey: requiredIdempotencyKey(request)
    });
    return semanticJson(payload);
  } catch (error) {
    return semanticErrorResponse(error);
  }
}

export async function handleSignalSemanticAssertionSupersession(
  request: Request,
  workspaceId: string,
  assertionId: string,
  dependencies: SignalSemanticReviewApiDependencies
) {
  const loaded = await dependencies.loadContext(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    uuidSchema.parse(assertionId);
    const body = supersedeSchema.parse(await request.json());
    const payload = await dependencies.supersedeAssertion({
      workspaceId: loaded.workspace.id,
      reviewerUserId: loaded.session.appUser.id,
      assertionId,
      scope: body.scope,
      entityId: body.entity_id ?? null,
      confidence: body.confidence,
      rationale: body.rationale,
      idempotencyKey: requiredIdempotencyKey(request)
    });
    return semanticJson(payload, 201);
  } catch (error) {
    return semanticErrorResponse(error);
  }
}

export async function handleSignalSemanticAssertionHistory(
  workspaceId: string,
  assertionId: string,
  dependencies: SignalSemanticReviewApiDependencies
) {
  const loaded = await dependencies.loadContext(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    uuidSchema.parse(assertionId);
    return semanticJson(await dependencies.listHistory({
      workspaceId: loaded.workspace.id,
      assertionId
    }));
  } catch (error) {
    return semanticErrorResponse(error);
  }
}

function requiredIdempotencyKey(request: Request) {
  const value = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (value.length < 8 || value.length > 500) {
    throw new SignalSemanticReviewContractError(
      "invalid_input",
      "Idempotency-Key must be between 8 and 500 characters."
    );
  }
  return value;
}

function semanticJson(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store" }
  });
}

function semanticErrorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return Response.json({
      error: "invalid_semantic_review_input",
      message: "Semantic Review request is invalid.",
      details: error.flatten()
    }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
  if (error instanceof SignalSemanticReviewContractError) {
    const status = error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 400;
    return Response.json({ error: error.code, message: error.message }, {
      status,
      headers: { "Cache-Control": "private, no-store" }
    });
  }
  if (error instanceof Error && "code" in error) {
    const code = String((error as Error & { code: string }).code);
    if (code === "23505") {
      return Response.json({ error: "conflict", message: "A current semantic assertion already exists." }, {
        status: 409,
        headers: { "Cache-Control": "private, no-store" }
      });
    }
    if (code === "23514") {
      return Response.json({ error: "invalid_semantic_contract", message: error.message }, {
        status: 400,
        headers: { "Cache-Control": "private, no-store" }
      });
    }
  }
  return Response.json({
    error: "semantic_review_unavailable",
    message: "Semantic Review is temporarily unavailable."
  }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
}
