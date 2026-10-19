import { z } from "zod";

import { validationError } from "@/lib/api/responses";
import {
  SignalStrategicConsumptionError,
  assertSignalTbStrategicLaunchRequest,
  launchSignalTbStrategicRunV2,
  prepareSignalTbStrategicRun,
  preflightSignalTbStrategicRun
} from "@/lib/data-os/signal-strategic-consumption";
import { signalBackendErrorResponse } from "@/lib/data-os/signal-workspace-serving";
import { loadSignalWorkspaceContextForManagement } from "../../../../../_lib/load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  period_start: z.string().date(),
  period_end: z.string().date(),
  timezone: z.string().trim().min(1).max(100),
  study_size: z.enum(["small", "medium", "large", "full_power"]).optional(),
  business_question: z.string().trim().max(2000).nullable().optional(),
  decision_to_inform: z.string().trim().max(2000).nullable().optional(),
  hard_cap_usd: z.number().positive(),
  preflight_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/u)
});

const querySchema = z.object({
  period_start: z.string().date(),
  period_end: z.string().date(),
  timezone: z.string().trim().min(1).max(100),
  study_size: z.enum(["small", "medium", "large", "full_power"]).optional(),
  hard_cap_usd: z.coerce.number().positive()
});

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    period_start: url.searchParams.get("period_start"),
    period_end: url.searchParams.get("period_end"),
    timezone: url.searchParams.get("timezone"),
    study_size: url.searchParams.get("study_size") ?? undefined,
    hard_cap_usd: url.searchParams.get("hard_cap_usd")
  });
  if (!parsed.success) return validationError(parsed.error);
  if (parsed.data.timezone !== loaded.workspace.timezone) {
    return Response.json({
      error: "invalid_timezone",
      message: "The strategic preflight timezone must match the governed workspace timezone."
    }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
  }
  try {
    const preflight = await preflightSignalTbStrategicRun({
      workspaceId: loaded.workspace.id,
      periodStart: parsed.data.period_start,
      periodEnd: parsed.data.period_end,
      timezone: parsed.data.timezone,
      studySize: parsed.data.study_size,
      hardCapUsd: parsed.data.hard_cap_usd
    });
    return Response.json(preflight, {
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch (error) {
    if (error instanceof SignalStrategicConsumptionError) {
      return Response.json({ error: error.code, message: error.message }, {
        status: 409, headers: { "Cache-Control": "private, no-store" }
      });
    }
    return signalBackendErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForManagement(workspaceId);
  if ("response" in loaded) return loaded.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return validationError(parsed.error);
  if (parsed.data.period_start > parsed.data.period_end) {
    return Response.json(
      { error: "invalid_period", message: "period_start must be on or before period_end." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } }
    );
  }
  if (parsed.data.timezone !== loaded.workspace.timezone) {
    return Response.json(
      {
        error: "invalid_timezone",
        message: "The strategic run timezone must match the governed workspace timezone."
      },
      { status: 409, headers: { "Cache-Control": "private, no-store" } }
    );
  }
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey) {
    return Response.json(
      { error: "idempotency_key_required", message: "Idempotency-Key is required." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  try {
    // Recompute the free preflight on every launch attempt. The browser never
    // supplies a population, bundle, binding or compilation identity.
    const prepared = await prepareSignalTbStrategicRun({
      workspaceId: loaded.workspace.id,
      periodStart: parsed.data.period_start,
      periodEnd: parsed.data.period_end,
      timezone: parsed.data.timezone,
      studySize: parsed.data.study_size,
      hardCapUsd: parsed.data.hard_cap_usd
    });
    const preflight = prepared.public;
    if (!preflight.launch_authorized) {
      return Response.json({
        error: "strategic_paid_run_not_authorized",
        message: "Paid strategic runs require explicit server-side operator authorization.",
        preflight_digest: preflight.preflight_digest,
        idempotency_key_accepted: true
      }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
    }
    assertSignalTbStrategicLaunchRequest({
      preflight,
      submittedPreflightDigest: parsed.data.preflight_digest,
      submittedHardCapUsd: parsed.data.hard_cap_usd
    });
    if (!prepared.launch) {
      throw new SignalStrategicConsumptionError(
        "strategic_preflight_required",
        "The exact server-owned launch authority is unavailable."
      );
    }
    const launched = await launchSignalTbStrategicRunV2({
      workspaceId: loaded.workspace.id,
      actorUserId: loaded.session.appUser.id,
      idempotencyKey,
      prepared: prepared.launch,
      periodStart: parsed.data.period_start,
      periodEnd: parsed.data.period_end,
      timezone: parsed.data.timezone,
      businessQuestion: parsed.data.business_question,
      decisionToInform: parsed.data.decision_to_inform
    });
    return Response.json(launched, {
      status: launched.created ? 202 : 200,
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch (error) {
    if (error instanceof SignalStrategicConsumptionError) {
      return Response.json(
        { error: error.code, message: error.message },
        { status: 409, headers: { "Cache-Control": "private, no-store" } }
      );
    }
    if (isStrategicConflict(error)) {
      return Response.json(
        { error: "strategic_run_conflict", message: safeConflictMessage(error) },
        { status: 409, headers: { "Cache-Control": "private, no-store" } }
      );
    }
    return signalBackendErrorResponse(error);
  }
}

function isStrategicConflict(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "23505" || candidate.code === "23514"
    || String(candidate.message ?? "").includes("Strategic");
}

function safeConflictMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Strategic run could not be created.";
  return message.slice(0, 300);
}
