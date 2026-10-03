import { z } from "zod";

import type {
  ResolvedSignalWorkspace,
  SignalWorkspaceUser
} from "@/lib/data-os/signal-workspace";
import {
  SignalTopicDiscoveryReviewError,
  signalTopicDiscoveryFinalizeSchema,
  signalTopicDiscoveryOutlierDraftSchema,
  signalTopicDiscoveryReviewDraftSchema,
  finalizeSignalTopicDiscoveryReviewV1,
  listSignalTopicDiscoveryProposalsV1,
  loadSignalTopicDiscoveryOutlierReviewV1,
  loadSignalTopicDiscoveryProposalDetailV1,
  loadSignalTopicDiscoveryReviewExportV1,
  loadSignalTopicDiscoveryReviewHistoryV1,
  loadSignalTopicDiscoveryReviewRunsV1,
  loadSignalTopicDiscoveryReviewSummaryV1,
  saveSignalTopicDiscoveryOutlierDraftV1,
  saveSignalTopicDiscoveryReviewDraftV1,
  supersedeSignalTopicDiscoveryReviewV1
} from "@/lib/data-os/signal-topic-discovery-review";

export type SignalTopicDiscoveryReviewApiContext = {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
};

export async function handleTopicDiscoveryOverview(_request: Request, context: SignalTopicDiscoveryReviewApiContext) {
  const startedAt = performance.now();
  return timed(privateJson({
    contract_version: "signal-topic-discovery-review-overview-v1",
    runs: (await loadSignalTopicDiscoveryReviewRunsV1({ workspace: context.workspace })).runs,
    summary: await loadSignalTopicDiscoveryReviewSummaryV1({ workspace: context.workspace })
  }), startedAt, "overview");
}

export async function handleTopicDiscoveryProposals(request: Request, context: SignalTopicDiscoveryReviewApiContext) {
  const startedAt = performance.now();
  const url = new URL(request.url);
  const parsed = listQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return invalid("topic_discovery_list_query_invalid", parsed.error.flatten());
  const value = parsed.data;
  return timed(privateJson(await listSignalTopicDiscoveryProposalsV1({
    workspace: context.workspace,
    runKey: value.run ?? null,
    cursor: value.cursor ?? null,
    limit: value.limit,
    filters: {
      status: value.status,
      decision: value.decision,
      scope: value.scope,
      search: value.search,
      size: value.size,
      stability: value.stability
    }
  })), startedAt, "proposals");
}

export async function handleTopicDiscoveryProposalDetail(
  _request: Request,
  context: SignalTopicDiscoveryReviewApiContext,
  proposalKey: string
) {
  const startedAt = performance.now();
  if (!/^proposal-\d{3}$/u.test(proposalKey)) return invalid("topic_discovery_proposal_key_invalid");
  return timed(privateJson(await loadSignalTopicDiscoveryProposalDetailV1({
    workspace: context.workspace,
    proposalKey
  })), startedAt, "proposal-detail");
}

export async function handleTopicDiscoveryDraft(request: Request, context: SignalTopicDiscoveryReviewApiContext) {
  const startedAt = performance.now();
  const key = idempotencyKey(request);
  if (key instanceof Response) return key;
  const parsed = signalTopicDiscoveryReviewDraftSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return invalid("topic_discovery_review_draft_invalid", parsed.error.flatten());
  return timed(privateJson(await saveSignalTopicDiscoveryReviewDraftV1({
    workspace: context.workspace,
    actor: context.actor,
    idempotencyKey: key,
    input: parsed.data
  })), startedAt, "draft");
}

export async function handleTopicDiscoveryOutliers(request: Request, context: SignalTopicDiscoveryReviewApiContext) {
  const startedAt = performance.now();
  if (request.method === "GET") {
    const run = new URL(request.url).searchParams.get("run");
    return timed(privateJson(await loadSignalTopicDiscoveryOutlierReviewV1({
      workspace: context.workspace,
      runKey: run
    })), startedAt, "outliers");
  }
  const key = idempotencyKey(request);
  if (key instanceof Response) return key;
  const parsed = signalTopicDiscoveryOutlierDraftSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return invalid("topic_discovery_outlier_draft_invalid", parsed.error.flatten());
  const run = new URL(request.url).searchParams.get("run");
  return timed(privateJson(await saveSignalTopicDiscoveryOutlierDraftV1({
    workspace: context.workspace,
    actor: context.actor,
    idempotencyKey: key,
    runKey: run,
    input: parsed.data
  })), startedAt, "outlier-draft");
}

export async function handleTopicDiscoveryFinalize(request: Request, context: SignalTopicDiscoveryReviewApiContext) {
  const startedAt = performance.now();
  const key = idempotencyKey(request);
  if (key instanceof Response) return key;
  const parsed = signalTopicDiscoveryFinalizeSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return invalid("topic_discovery_finalize_invalid", parsed.error.flatten());
  const run = new URL(request.url).searchParams.get("run");
  return timed(privateJson(await finalizeSignalTopicDiscoveryReviewV1({
    workspace: context.workspace,
    actor: context.actor,
    idempotencyKey: key,
    runKey: run,
    outcome: parsed.data.outcome
  })), startedAt, "finalize");
}

export async function handleTopicDiscoveryExport(
  request: Request,
  context: SignalTopicDiscoveryReviewApiContext,
  kind: string
) {
  const startedAt = performance.now();
  if (kind !== "score-sheet" && kind !== "decision-sheet") {
    return invalid("topic_discovery_export_kind_invalid");
  }
  const run = new URL(request.url).searchParams.get("run");
  const exported = await loadSignalTopicDiscoveryReviewExportV1({
    workspace: context.workspace,
    runKey: run,
    kind
  });
  return timed(new Response(exported.body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${exported.filename}"`,
      "Content-Type": "text/csv; charset=utf-8",
      "X-Content-Digest": exported.digest
    }
  }), startedAt, "export");
}

export async function handleTopicDiscoveryHistory(request: Request, context: SignalTopicDiscoveryReviewApiContext) {
  const startedAt = performance.now();
  return timed(privateJson(await loadSignalTopicDiscoveryReviewHistoryV1({
    workspace: context.workspace,
    runKey: new URL(request.url).searchParams.get("run")
  })), startedAt, "history");
}

export async function handleTopicDiscoverySupersede(request: Request, context: SignalTopicDiscoveryReviewApiContext) {
  const startedAt = performance.now();
  const key = idempotencyKey(request);
  if (key instanceof Response) return key;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (Object.keys(body).some((entry) => entry !== "confirmed") || body.confirmed !== true) {
    return invalid("topic_discovery_supersession_confirmation_required");
  }
  return timed(privateJson(await supersedeSignalTopicDiscoveryReviewV1({
    workspace: context.workspace,
    actor: context.actor,
    idempotencyKey: key,
    runKey: new URL(request.url).searchParams.get("run")
  })), startedAt, "supersede");
}

export function topicDiscoveryReviewErrorResponse(error: unknown) {
  if (error instanceof SignalTopicDiscoveryReviewError) {
    return Response.json({
      error: error.code,
      message: operatorMessage(error.code)
    }, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
  }
  if (error instanceof z.ZodError) {
    return invalid("topic_discovery_contract_invalid", error.flatten());
  }
  throw error;
}

const listQuerySchema = z.object({
  run: z.string().max(80).optional(),
  cursor: z.string().max(2000).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  status: z.enum(["pending", "reviewed"]).optional(),
  decision: z.enum(["topic_contract_candidate", "merge", "split", "none_acceptable"]).optional(),
  scope: z.string().trim().min(1).max(80).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  size: z.enum(["small", "medium", "large"]).optional(),
  stability: z.enum(["low", "medium", "high"]).optional()
}).strict();

function idempotencyKey(request: Request) {
  const key = request.headers.get("Idempotency-Key")?.trim() ?? "";
  return key.length >= 8 && key.length <= 500
    ? key
    : Response.json({ error: "idempotency_key_required",
      message: "Idempotency-Key is required." }, { status: 400 });
}

function privateJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}

function timed(response: Response, startedAt: number, operation: string) {
  response.headers.set("Server-Timing",
    `topic-discovery-review;dur=${Math.max(0, performance.now() - startedAt).toFixed(1)};desc="${operation}"`);
  return response;
}

function invalid(error: string, details?: unknown) {
  return Response.json({ error, message: operatorMessage(error), details }, {
    status: 422,
    headers: { "Cache-Control": "private, no-store" }
  });
}

function operatorMessage(code: string) {
  if (code.includes("rights")) return "La evidencia ya no tiene derechos vigentes para esta revisión.";
  if (code.includes("cursor")) return "La página solicitada ya no coincide con los filtros activos.";
  if (code.includes("census")) return "Completa todas las propuestas antes de finalizar.";
  if (code.includes("outlier")) return "Completa la decisión sobre outliers antes de finalizar.";
  if (code.includes("locked")) return "Esta revisión ya fue finalizada. Crea una corrección append-only.";
  if (code.includes("not_found")) return "La revisión solicitada no está disponible en este workspace.";
  return "La operación de revisión no cumple el contrato vigente.";
}
