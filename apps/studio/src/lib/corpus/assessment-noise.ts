export type AssessmentNoiseEligibilityInput = {
  expectedRevision: number;
  currentRevision: number;
  latestAssessedRevision: number | null;
  lockedByAnalysisId: string | null;
  assessment: {
    id: string;
    corpusRevision: number;
    status: string;
    sampleStrategy: string;
    populationSize: number;
    sampleSize: number;
  } | null;
  includedCount: number;
  classifiedIncludedCount: number;
  noiseIncludedCount: number;
};

export type AssessmentNoiseImpact = {
  assessmentId: string;
  corpusRevision: number;
  includedCount: number;
  excludedCount: number;
  retainedCount: number;
  noisePercentage: number;
};

export type AssessmentNoiseEligibility =
  | { ok: true; impact: AssessmentNoiseImpact }
  | {
      ok: false;
      code:
        | "corpus_locked"
        | "stale_revision"
        | "assessment_missing"
        | "assessment_sampled"
        | "classification_incomplete"
        | "no_noise";
      message: string;
    };

export function evaluateAssessmentNoiseEligibility(
  input: AssessmentNoiseEligibilityInput
): AssessmentNoiseEligibility {
  if (input.lockedByAnalysisId) {
    return {
      ok: false,
      code: "corpus_locked",
      message: "El corpus ya esta bloqueado por un analisis y no puede limpiarse."
    };
  }

  if (
    input.expectedRevision !== input.currentRevision
    || input.latestAssessedRevision !== input.currentRevision
  ) {
    return {
      ok: false,
      code: "stale_revision",
      message: "El corpus cambio desde el diagnostico. Vuelve a diagnosticar antes de excluir ruido."
    };
  }

  const assessment = input.assessment;
  if (
    !assessment
    || assessment.status !== "completed"
    || assessment.corpusRevision !== input.currentRevision
  ) {
    return {
      ok: false,
      code: "assessment_missing",
      message: "No existe un diagnostico completo para la revision actual."
    };
  }

  if (
    assessment.sampleStrategy !== "full_population"
    || assessment.sampleSize !== assessment.populationSize
  ) {
    return {
      ok: false,
      code: "assessment_sampled",
      message: "La limpieza automatica exige que el diagnostico haya clasificado toda la poblacion."
    };
  }

  if (
    assessment.populationSize !== input.includedCount
    || input.classifiedIncludedCount !== input.includedCount
  ) {
    return {
      ok: false,
      code: "classification_incomplete",
      message: "La clasificacion ya no coincide con todas las menciones incluidas del corpus."
    };
  }

  if (input.noiseIncludedCount <= 0) {
    return {
      ok: false,
      code: "no_noise",
      message: "El diagnostico actual no contiene menciones clasificadas como ruido."
    };
  }

  return {
    ok: true,
    impact: {
      assessmentId: assessment.id,
      corpusRevision: input.currentRevision,
      includedCount: input.includedCount,
      excludedCount: input.noiseIncludedCount,
      retainedCount: input.includedCount - input.noiseIncludedCount,
      noisePercentage: Number(
        ((input.noiseIncludedCount / input.includedCount) * 100).toFixed(1)
      )
    }
  };
}
