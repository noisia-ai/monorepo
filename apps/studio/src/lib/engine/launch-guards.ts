import {
  isEngineMethodologySlug,
  isEngineReadOnlyOutputSlug,
  type EngineRunnableMethodologySlug
} from "@noisia/query-engine";
import { isActiveEngineRuntimeSlug } from "./methodology-options";

export type EngineMethodologyLaunchRow = {
  slug: string;
  version: string | null;
  status: string | null;
} | null;

export type EngineLaunchValidation =
  | {
      ok: true;
      methodologySlug: EngineRunnableMethodologySlug | "signal-pulse";
      methodologyVersion: string;
      methodologyStatus: "beta";
    }
  | {
      ok: false;
      status: number;
      error: string;
      message: string;
      methodologySlug?: string;
      methodologyStatus?: string | null;
    };

export type EngineAnalysisReuseCandidate = {
  status: string;
  retrievedUnits?: number | null;
  codingProvider?: string | null;
  codingFixture?: boolean | null;
};

const ACTIVE_ENGINE_ANALYSIS_STATUSES = new Set(["queued", "running"]);
const COMPLETED_ENGINE_ANALYSIS_STATUSES = new Set(["needs_review", "approved"]);

export function validateEngineLaunchRequest(
  requestedSlug: string,
  methodology: EngineMethodologyLaunchRow
): EngineLaunchValidation {
  if (requestedSlug === "signal-pulse") {
    if (!methodology) {
      return {
        ok: false,
        status: 400,
        error: "methodology_not_seeded",
        message: "Methodology manifest not found in DB. Run methodology seeds first.",
        methodologySlug: requestedSlug
      };
    }
    if (methodology.status !== "beta") {
      return {
        ok: false,
        status: 409,
        error: "methodology_not_beta",
        message: "Signal Pulse solo corre como beta controlada en esta fase.",
        methodologySlug: requestedSlug,
        methodologyStatus: methodology.status
      };
    }
    return {
      ok: true,
      methodologySlug: "signal-pulse",
      methodologyVersion: methodology.version ?? "0.1",
      methodologyStatus: "beta"
    };
  }

  if (!isEngineMethodologySlug(requestedSlug)) {
    return {
      ok: false,
      status: 400,
      error: "unsupported_methodology",
      message: "Esta ruta sólo corre metodologías engine_* beta. Para T&B usa /tb-analysis.",
      methodologySlug: requestedSlug
    };
  }

  if (isEngineReadOnlyOutputSlug(requestedSlug)) {
    return {
      ok: false,
      status: 400,
      error: "read_only_output_methodology",
      message: "Competitive T/B Matrix no corre como engine; se publica como output barato leyendo el análisis T&B existente.",
      methodologySlug: requestedSlug
    };
  }

  if (!isActiveEngineRuntimeSlug(requestedSlug)) {
    return {
      ok: false,
      status: 409,
      error: "methodology_shadow",
      message: "Esta metodologia sigue en shadow; no se puede correr hasta tener renderer, scorer y QA end-to-end.",
      methodologySlug: requestedSlug
    };
  }

  if (!methodology) {
    return {
      ok: false,
      status: 400,
      error: "methodology_not_seeded",
      message: "Methodology manifest not found in DB. Run methodology seeds first.",
      methodologySlug: requestedSlug
    };
  }

  if (methodology.status !== "beta") {
    return {
      ok: false,
      status: 409,
      error: "methodology_not_beta",
      message: "Las metodologias engine nuevas solo corren como beta controlada en esta fase.",
      methodologySlug: requestedSlug,
      methodologyStatus: methodology.status
    };
  }

  return {
    ok: true,
    methodologySlug: requestedSlug,
    methodologyVersion: methodology.version ?? "0.1",
    methodologyStatus: "beta"
  };
}

export function shouldReuseEngineAnalysis(candidate: EngineAnalysisReuseCandidate): boolean {
  if (ACTIVE_ENGINE_ANALYSIS_STATUSES.has(candidate.status)) return true;
  if (!COMPLETED_ENGINE_ANALYSIS_STATUSES.has(candidate.status)) return false;
  return Number(candidate.retrievedUnits ?? 0) > 0 &&
    candidate.codingProvider === "anthropic" &&
    candidate.codingFixture === false;
}
