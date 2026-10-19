import type { EngineRunnableMethodologySlug } from "@noisia/query-engine";
import { normalizeStudyAnalysisPlan } from "@/lib/multimethod/analysis-plan";
import { isActiveEngineRuntimeSlug } from "@/lib/engine/methodology-options";

export function selectedEngineRuntimeLenses(analysisPlan: unknown): EngineRunnableMethodologySlug[] {
  const plan = normalizeStudyAnalysisPlan(analysisPlan);
  return plan.selected_lenses.filter(isActiveEngineRuntimeSlug);
}

