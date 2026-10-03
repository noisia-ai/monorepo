import type { EngineRunnableMethodologySlug } from "@noisia/query-engine";

import { engineModuleKeyForMethodology, isActiveEngineRuntimeSlug } from "@/lib/engine/methodology-options";
import { validateEnginePublishReadiness } from "@/lib/engine/publish-guards";
import { normalizeSignalOutputManifest, type SignalOutputManifest } from "@/lib/signal/manifest";

export type CompositeEngineLensAnalysis = {
  methodologySlug: string;
  engineAnalysisId: string | null;
  status: string | null;
  currentStep: string | null;
  metaJson: unknown;
  usedFixtureCoding?: boolean | null;
};

export type CompositeEngineLensFailure = {
  methodology_slug: string;
  module_key: string;
  engine_analysis_id: string | null;
  error:
    | "engine_lens_missing"
    | "engine_lens_not_reviewable"
    | "engine_coding_missing"
    | "fixture_coding_used"
    | "engine_block_not_ready"
    | "engine_block_directional"
    | "quality_gates_missing"
    | "quality_gates_failed";
  message: string;
  failed_checks: Array<{ id: string; detail: string }>;
};

export type CompositeEnginePublishReadiness =
  | {
      ok: true;
      required_lenses: string[];
    }
  | {
      ok: false;
      error: "selected_engine_lenses_not_ready";
      message: string;
      required_lenses: string[];
      failed_lenses: CompositeEngineLensFailure[];
    };

export function explicitCompositeEngineLensesFromPlan(analysisPlan: unknown): EngineRunnableMethodologySlug[] {
  const record = asRecord(analysisPlan);
  const selected = Array.isArray(record.selected_lenses) ? record.selected_lenses : [];
  return Array.from(new Set(
    selected
      .map((value) => String(value).trim())
      .filter(isActiveEngineRuntimeSlug)
  ));
}

export function validateCompositeEnginePublishReadiness(args: {
  analysisPlan: unknown;
  manifest: unknown;
  latestAnalyses: CompositeEngineLensAnalysis[];
}): CompositeEnginePublishReadiness {
  const manifest = normalizeSignalOutputManifest(args.manifest) as SignalOutputManifest;
  const selectedLenses = explicitCompositeEngineLensesFromPlan(args.analysisPlan);
  const requiredLenses = selectedLenses.filter((slug) => compositeManifestRequiresLens(slug, manifest));
  if (requiredLenses.length === 0) {
    return { ok: true, required_lenses: [] };
  }

  const latestBySlug = new Map(args.latestAnalyses.map((analysis) => [analysis.methodologySlug, analysis]));
  const failures: CompositeEngineLensFailure[] = [];

  for (const slug of requiredLenses) {
    const moduleKey = engineModuleKeyForMethodology(slug) ?? "engine_methodology";
    const analysis = latestBySlug.get(slug);
    if (!analysis) {
      failures.push({
        methodology_slug: slug,
        module_key: moduleKey,
        engine_analysis_id: null,
        error: "engine_lens_missing",
        message: "El Signal tiene activo este modulo, pero el lente seleccionado todavia no corrio.",
        failed_checks: [{ id: "engine_lens_missing", detail: "No existe engine_analysis para este lente." }]
      });
      continue;
    }

    if (analysis.status !== "needs_review" && analysis.status !== "approved") {
      failures.push({
        methodology_slug: slug,
        module_key: moduleKey,
        engine_analysis_id: analysis.engineAnalysisId,
        error: "engine_lens_not_reviewable",
        message: "El lente existe, pero aun no llego a review.",
        failed_checks: [{
          id: "engine_lens_status",
          detail: `status=${analysis.status ?? "missing"} current_step=${analysis.currentStep ?? "missing"}`
        }]
      });
      continue;
    }

    if (analysis.usedFixtureCoding === true) {
      failures.push({
        methodology_slug: slug,
        module_key: moduleKey,
        engine_analysis_id: analysis.engineAnalysisId,
        error: "fixture_coding_used",
        message: "El lente fue generado con fixture/no-cost QA; necesita Claude real antes de publicarse.",
        failed_checks: [{ id: "fixture_coding", detail: "engine_cost_events.provider=fixture" }]
      });
      continue;
    }

    const readiness = validateEnginePublishReadiness(analysis.metaJson);
    if (!readiness.ok) {
      failures.push({
        methodology_slug: slug,
        module_key: moduleKey,
        engine_analysis_id: analysis.engineAnalysisId,
        error: readiness.error,
        message: readiness.message,
        failed_checks: readiness.failedChecks
      });
    }
  }

  if (failures.length > 0) {
    return {
      ok: false,
      error: "selected_engine_lenses_not_ready",
      message: "No se puede publicar el Signal compuesto con modulos de lentes seleccionados que no estan listos.",
      required_lenses: requiredLenses,
      failed_lenses: failures
    };
  }

  return { ok: true, required_lenses: requiredLenses };
}

function compositeManifestRequiresLens(slug: EngineRunnableMethodologySlug, manifest: SignalOutputManifest) {
  const moduleKey = engineModuleKeyForMethodology(slug);
  return Boolean(
    manifest.engine_methodology ||
    (moduleKey && manifest[moduleKey])
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
