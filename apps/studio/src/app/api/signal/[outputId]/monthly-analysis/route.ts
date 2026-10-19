import { z } from "zod";

import { forbidden, unauthorized, validationError } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getSignalOutputForUser } from "@/lib/data/signal";
import { runMonthlyCutBackfill } from "@/lib/live-intelligence/monthly-cut";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const monthlyAnalysisSchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  importBatchId: z.string().uuid().nullable().optional(),
  targetCorpusId: z.string().uuid().nullable().optional()
}).refine((value) => value.dateFrom <= value.dateTo, {
  path: ["dateTo"],
  message: "dateTo must be after dateFrom."
});

export async function POST(request: Request, context: { params: Promise<{ outputId: string }> }) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

  const { outputId } = await context.params;
  const output = await getSignalOutputForUser(session.appUser, outputId);
  if (!output) {
    return Response.json({ error: "not_found", message: "Signal output not found." }, { status: 404 });
  }

  const parsed = monthlyAnalysisSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return validationError(parsed.error);

  try {
    const result = await runMonthlyCutBackfill({
      outputId,
      dateFrom: parsed.data.dateFrom,
      dateTo: parsed.data.dateTo,
      importBatchId: parsed.data.importBatchId ?? null,
      targetCorpusId: parsed.data.targetCorpusId ?? null
    });
    return Response.json(
      {
        ok: true,
        analysis_mode: "monthly_cut_backfill",
        generated_without_llm: true,
        result
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Monthly analysis failed.";
    return Response.json({ error: "monthly_analysis_failed", message }, { status: 500 });
  }
}
