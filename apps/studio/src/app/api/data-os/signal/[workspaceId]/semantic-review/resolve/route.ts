import { z } from "zod";

import { loadSignalWorkspaceContextForStrategicReview } from "../../../../_lib/load";
import {
  cancelWorkspaceSemanticResolutionV2,
  loadLatestWorkspaceSemanticResolution,
  prepareWorkspaceSemanticResolutionV2
} from "@/lib/data-os/signal-semantic-resolution";
import { handleSignalSemanticResolutionStatus } from "@/lib/data-os/signal-semantic-resolution-api";
import { isUndefinedTableError } from "@/lib/db/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  hard_cap_usd: z.string().regex(/^(0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/),
  preflight_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  confirmation_accepted: z.literal(true),
  supersedes_run_id: z.string().uuid().nullable().optional()
}).strict();

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await context.params;
  return handleSignalSemanticResolutionStatus(workspaceId, {
    loadContext: loadSignalWorkspaceContextForStrategicReview,
    loadLatest: loadLatestWorkspaceSemanticResolution,
    isUnavailableSchema: isUndefinedTableError
  });
}

const cancelSchema=z.object({run_id:z.string().uuid()}).strict();

export async function DELETE(
  request:Request,
  context:{params:Promise<{workspaceId:string}>}
){
  const {workspaceId}=await context.params;
  const loaded=await loadSignalWorkspaceContextForStrategicReview(workspaceId);
  if("response" in loaded)return loaded.response;
  const idempotencyKey=request.headers.get("Idempotency-Key")?.trim();
  if(!idempotencyKey || idempotencyKey.length<8 || idempotencyKey.length>200){
    return semanticJson({error:"semantic_resolution_idempotency_key_required",
      message:"Idempotency-Key is required for semantic resolution cancellation."},400);
  }
  const parsed=cancelSchema.safeParse(await request.json().catch(()=>({})));
  if(!parsed.success)return semanticJson({error:"invalid_semantic_resolution_cancel",
    message:"Semantic resolution cancellation is invalid."},400);
  try{
    return semanticJson(await cancelWorkspaceSemanticResolutionV2({
      workspaceId:loaded.workspace.id,runId:parsed.data.run_id,
      actorUserId:loaded.session.appUser.id,idempotencyKey
    }));
  }catch(error){
    return semanticJson({error:"semantic_resolution_cancel_unavailable",
      message:error instanceof Error?error.message:"Unable to cancel semantic resolution."},409);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForStrategicReview(workspaceId);
  if ("response" in loaded) return loaded.response;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    return semanticJson({
      error: "semantic_resolution_idempotency_key_required",
      message: "Idempotency-Key is required for semantic resolution."
    }, 400);
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return semanticJson({
      error: "invalid_semantic_resolution_request",
      message: "Semantic resolution request is invalid.",
      details: parsed.error.flatten()
    }, 400);
  }
  try {
    const prepared = await prepareWorkspaceSemanticResolutionV2({
      workspaceId: loaded.workspace.id,
      requestedByUserId: loaded.session.appUser.id,
      hardCapUsd: parsed.data.hard_cap_usd,
      preflightDigest: parsed.data.preflight_digest,
      confirmationAccepted: parsed.data.confirmation_accepted,
      idempotencyKey,
      supersedesRunId: parsed.data.supersedes_run_id
    });
    return semanticJson(prepared, prepared.state === "prepared" ? 202 : 200);
  } catch (error) {
    return semanticJson({
      error: "semantic_resolution_unavailable",
      message: error instanceof Error ? error.message : "Unable to resolve semantic mentions."
    }, 500);
  }
}

function semanticJson(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store" }
  });
}
