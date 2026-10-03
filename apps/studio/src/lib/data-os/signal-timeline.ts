import { dashboardDataRefs } from "@noisia/db";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { getDataOsCorpusReadiness } from "@/lib/data-os/readiness";
import { buildSignalDataOsTimeline, type SignalDataOsTimelineModel } from "@/lib/data-os/signal-timeline-model";

export { buildSignalDataOsTimeline } from "@/lib/data-os/signal-timeline-model";
export type {
  SignalDataOsMetric,
  SignalDataOsTimelineModel,
  SignalDataOsTimelinePoint
} from "@/lib/data-os/signal-timeline-model";

export async function loadSignalDataOsTimeline(args: {
  outputId?: string;
  corpusId: string;
  requireGovernedRef?: boolean;
}): Promise<SignalDataOsTimelineModel | null> {
  const requireGovernedRef = args.requireGovernedRef ?? true;
  if (process.env.NOISIA_DATA_OS_ENABLED !== "true" && !requireGovernedRef) return null;

  try {
    if (requireGovernedRef) {
      if (!args.outputId) return null;
      const [governedRef] = await db
        .select({ id: dashboardDataRefs.id })
        .from(dashboardDataRefs)
        .where(and(
          eq(dashboardDataRefs.outputId, args.outputId),
          eq(dashboardDataRefs.studyCorpusId, args.corpusId),
          eq(dashboardDataRefs.refKey, "cross_source_timeline")
        ))
        .limit(1);
      if (!governedRef) return null;
    }

    const readiness = await getDataOsCorpusReadiness(args.corpusId);
    return buildSignalDataOsTimeline(readiness.monthlySeries);
  } catch (error) {
    console.warn("[signal:data-os-timeline] Relational cross-source timeline unavailable.", {
      outputId: args.outputId,
      corpusId: args.corpusId,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}
