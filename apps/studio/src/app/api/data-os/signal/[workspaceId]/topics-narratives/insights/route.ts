import { z } from "zod";

import {
  SIGNAL_TAXONOMY_INSIGHT_DEFAULT_BUDGET_USD,
  SIGNAL_TAXONOMY_INSIGHT_MAX_BUDGET_USD,
  SIGNAL_TAXONOMY_INSIGHT_MODEL_VERSION,
  SIGNAL_TAXONOMY_INSIGHT_PROMPT_VERSION,
  signalFiltersHashV1,
  signalTaxonomyInsightIdempotencyKeyV1,
  signalTaxonomyInsightPacketHashV1,
  type SignalTaxonomyInsightJobDataV1
} from "@noisia/query-engine";
import {
  loadSignalWorkspaceModuleContext,
  loadSignalWorkspaceContextForManagement
} from "@/app/api/data-os/_lib/load";
import { validationError } from "@/lib/api/responses";
import { signalModuleServingEtagSeedV1 } from "@/lib/data-os/signal-module-serving-scope";
import {
  signalBackendErrorResponse,
  signalJsonResponse
} from "@/lib/data-os/signal-workspace-serving";
import {
  loadSignalTaxonomyInsightsV1,
  prepareSignalTaxonomyInsightPacketV1
} from "@/lib/data-os/signal-taxonomy-insights";
import { enqueueSignalTaxonomyInsights } from "@/lib/queue/data-os";
import { resolveSignalOperationalReadScopeV1 } from "@/lib/data-os/signal-operational-read-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  budget_cap_usd: z.number()
    .positive()
    .max(SIGNAL_TAXONOMY_INSIGHT_MAX_BUDGET_USD)
    .default(SIGNAL_TAXONOMY_INSIGHT_DEFAULT_BUDGET_USD)
});

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceModuleContext(workspaceId, "topics-narratives", request);
  if ("response" in loaded) return loaded.response;
  try {
    const payload = await loadSignalTaxonomyInsightsV1(loaded.workspace.id, {
      includeInternalContextRefs: loaded.isInternalUser,
      readScope: loaded.readScope
    });
    const filter = payload.result
      ? {
          contract_version: "signal-backend-v1" as const,
          date_range: {
            start: payload.result.window.start,
            end: payload.result.window.end
          },
          timezone: loaded.workspace.timezone,
          granularity: "day" as const,
          dimensions: {}
        }
      : null;
    const servingScope = loaded.servingScope.rollout_mode === "governed"
      ? await loaded.finalizeServingScope(filter)
      : null;
    if (loaded.servingScope.rollout_mode !== "governed") {
      return Response.json(payload, {
        headers: { "Cache-Control": "private, no-store" }
      });
    }
    if (!servingScope) {
      throw new Error("Governed Topics & Narratives insight authority is unavailable.");
    }
    const etagSeed = JSON.stringify([
      payload.state,
      payload.run?.completed_at ?? null,
      payload.result?.packet_hash ?? null,
      payload.enrichment
    ]);
    return signalJsonResponse(request, {
      ...payload,
      serving_scope: servingScope
    }, {
      etagSeed: signalModuleServingEtagSeedV1(etagSeed, servingScope),
      state: payload.state
    });
  } catch (error) {
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
  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return validationError(parsed.error);

  try {
    const readScope = await resolveSignalOperationalReadScopeV1(loaded.workspace);
    if (readScope.visibleSource === "governed_population") {
      return Response.json({
        error: "governed_interpretation_generation_not_available",
        message: "Generated Topics & Narratives interpretations are not enabled for the governed population."
      }, { status: 409 });
    }
    const packet = await prepareSignalTaxonomyInsightPacketV1(loaded.workspace);
    const packetHash = signalTaxonomyInsightPacketHashV1(packet);
    const filter = {
      contract_version: "signal-backend-v1" as const,
      date_range: {
        start: packet.window.start,
        end: packet.window.end
      },
      timezone: packet.timezone,
      granularity: "day" as const,
      dimensions: {}
    };
    const filtersHash = signalFiltersHashV1(filter);
    const idempotencyKey = signalTaxonomyInsightIdempotencyKeyV1({
      workspace_id: packet.workspace_id,
      study_corpus_id: packet.study_corpus_id,
      packet_hash: packetHash,
      prompt_version: SIGNAL_TAXONOMY_INSIGHT_PROMPT_VERSION,
      model_version: SIGNAL_TAXONOMY_INSIGHT_MODEL_VERSION
    });
    const existing = await loadSignalTaxonomyInsightsV1(loaded.workspace.id, {
      includeInternalContextRefs: true,
      readScope
    });
    if (
      existing.state === "ready"
      && existing.result?.packet_hash === packetHash
    ) {
      return Response.json({ ok: true, reused: true, serving: existing });
    }
    const data: SignalTaxonomyInsightJobDataV1 = {
      contract_version: "signal-taxonomy-insight-job-v1",
      requested_by_user_id: loaded.session.appUser.id,
      packet,
      packet_hash: packetHash,
      filters_hash: filtersHash,
      data_watermark_hash: packetHash,
      idempotency_key: idempotencyKey,
      budget_cap_usd: parsed.data.budget_cap_usd,
      prompt_version: SIGNAL_TAXONOMY_INSIGHT_PROMPT_VERSION,
      model_version: SIGNAL_TAXONOMY_INSIGHT_MODEL_VERSION
    };
    const job = await enqueueSignalTaxonomyInsights(
      data,
      idempotencyKey.replaceAll(":", "-")
    );
    return Response.json({
      ok: true,
      reused: false,
      job_id: String(job.id),
      sample: {
        analyzed_mentions: packet.sampling.analyzed_mentions,
        population_mentions: packet.population.current_mentions,
        analyzed_chars: packet.sampling.analyzed_chars,
        limit: packet.sampling.max_mentions
      },
      budget_cap_usd: parsed.data.budget_cap_usd,
      state: "queued"
    }, { status: 202 });
  } catch (error) {
    return Response.json({
      error: "taxonomy_insights_failed",
      message: error instanceof Error
        ? error.message
        : "Unable to queue Topics & Narratives insights."
    }, { status: 500 });
  }
}
