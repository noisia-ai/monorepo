import { z } from "zod";

import {
  SIGNAL_MONTHLY_INSIGHT_MAX_BUDGET_USD,
  SIGNAL_MONTHLY_INSIGHT_MODEL_VERSION,
  SIGNAL_MONTHLY_INSIGHT_PROMPT_VERSION,
  SIGNAL_MONTHLY_INSIGHT_METRIC_GROUP_KEY,
  signalFiltersHashV1,
  signalMonthlyInsightIdempotencyKeyV1,
  type SignalMonthlyInsightJobDataV1
} from "@noisia/query-engine";
import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { pool } from "@/lib/db";
import { getSignalOutputForUser } from "@/lib/data/signal";
import { resolveLegacyOutputSignalWorkspaceForUser } from "@/lib/data-os/signal-workspace";
import { enqueueSignalMonthlyInsights } from "@/lib/queue/data-os";
import { prepareSignalMonthlyInsightPacketV1 } from "@/lib/signal-v2/brand-monitoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  budget_cap_usd: z.number().positive().max(SIGNAL_MONTHLY_INSIGHT_MAX_BUDGET_USD).default(2)
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ outputId: string }> }
) {
  const access = await resolveAccess(context);
  if ("response" in access) return access.response;
  const latest = await loadLatestRun(access.workspace.id);
  return Response.json(
    { ok: true, run: latest },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ outputId: string }> }
) {
  const access = await resolveAccess(context, true);
  if ("response" in access) return access.response;
  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return validationError(parsed.error);

  try {
    const packet = await prepareSignalMonthlyInsightPacketV1(access.workspace);
    const filter = {
      contract_version: "signal-backend-v1" as const,
      date_range: { start: packet.window.start, end: packet.window.end },
      timezone: packet.timezone,
      granularity: "day" as const,
      dimensions: {}
    };
    const filtersHash = signalFiltersHashV1(filter);
    const dataWatermarkHash = packet.candidate_hash;
    const idempotencyKey = signalMonthlyInsightIdempotencyKeyV1({
      workspace_id: packet.workspace_id,
      study_corpus_id: packet.study_corpus_id,
      filters_hash: filtersHash,
      data_watermark_hash: dataWatermarkHash,
      candidate_hash: packet.candidate_hash,
      prompt_version: SIGNAL_MONTHLY_INSIGHT_PROMPT_VERSION,
      model_version: SIGNAL_MONTHLY_INSIGHT_MODEL_VERSION
    });
    const data: SignalMonthlyInsightJobDataV1 = {
      contract_version: "signal-monthly-insight-job-v1",
      output_id: access.outputId,
      requested_by_user_id: access.session.appUser.id,
      packet,
      filters_hash: filtersHash,
      data_watermark_hash: dataWatermarkHash,
      idempotency_key: idempotencyKey,
      budget_cap_usd: parsed.data.budget_cap_usd,
      prompt_version: SIGNAL_MONTHLY_INSIGHT_PROMPT_VERSION,
      model_version: SIGNAL_MONTHLY_INSIGHT_MODEL_VERSION
    };
    const existing = await loadRunByIdempotency(idempotencyKey);
    if (existing?.status === "completed") {
      return Response.json({ ok: true, reused: true, run: existing });
    }
    const job = await enqueueSignalMonthlyInsights(
      data,
      idempotencyKey.replaceAll(":", "-")
    );
    return Response.json({
      ok: true,
      reused: false,
      job_id: String(job.id),
      run: existing ?? {
        status: "queued",
        budget_cap_usd: parsed.data.budget_cap_usd,
        actual_cost_usd: 0,
        window: packet.window
      }
    }, { status: 202 });
  } catch (error) {
    return Response.json({
      error: "monthly_insights_failed",
      message: error instanceof Error ? error.message : "Unable to queue monthly insights."
    }, { status: 500 });
  }
}

async function resolveAccess(
  context: { params: Promise<{ outputId: string }> },
  requireManagement = false
) {
  const session = await getAuthenticatedAppUser();
  if (!session) return { response: unauthorized() } as const;
  if (requireManagement && !canManageCorpus(session.appUser.primaryRole)) {
    return { response: forbidden() } as const;
  }
  const { outputId } = await context.params;
  const output = await getSignalOutputForUser(session.appUser, outputId);
  if (!output) {
    return {
      response: Response.json(
        { error: "not_found", message: "Signal output not found." },
        { status: 404 }
      )
    } as const;
  }
  const workspace = await resolveLegacyOutputSignalWorkspaceForUser(session.appUser, outputId);
  if (!workspace) {
    return {
      response: Response.json(
        { error: "workspace_not_found", message: "Signal workspace is not mapped." },
        { status: 404 }
      )
    } as const;
  }
  return { session, outputId, workspace } as const;
}

async function loadLatestRun(workspaceId: string) {
  const result = await pool.query(`
    SELECT
      id::text,
      status,
      budget_cap_usd::float8,
      estimated_cost_usd::float8,
      actual_cost_usd::float8,
      input_tokens,
      output_tokens,
      error_code,
      error_summary,
      started_at,
      completed_at,
      created_at
    FROM metric_interpretation_runs
    WHERE workspace_id = $1::uuid
      AND metric_group_key = $2
    ORDER BY created_at DESC
    LIMIT 1
  `, [workspaceId, SIGNAL_MONTHLY_INSIGHT_METRIC_GROUP_KEY]);
  return result.rows[0] ?? null;
}

async function loadRunByIdempotency(idempotencyKey: string) {
  const result = await pool.query(`
    SELECT
      id::text,
      status,
      budget_cap_usd::float8,
      estimated_cost_usd::float8,
      actual_cost_usd::float8,
      input_tokens,
      output_tokens,
      error_code,
      error_summary,
      started_at,
      completed_at,
      created_at
    FROM metric_interpretation_runs
    WHERE idempotency_key = $1
    LIMIT 1
  `, [idempotencyKey]);
  return result.rows[0] ?? null;
}
