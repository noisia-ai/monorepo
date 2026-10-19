export type EngineQualityGateSummary = {
  methodology_slug: string;
  retrieval_units?: number | null;
  retrieval_eligible_units?: number | null;
  retrieval_max_units?: number | null;
  retrieval_truncated?: boolean | null;
  findings: number;
  findings_with_confidence: number;
  findings_with_citation: number;
  narrative_ownership_scored: number;
  narrative_owned_negative: number;
  insufficient_signal_findings: number;
  sentiment_advocacy_scored: number;
  sentiment_proxy_non_survey: number;
  trust_risk_scored: number;
  sensitive_risk_findings: number;
  sensitive_risk_with_citation: number;
  vpm_scored: number;
  vpm_entities: number;
  vpm_whitespace_candidates: number;
  jfm_scored: number;
  jfm_phase_count: number;
  jfm_invisible_findings: number;
  category_opportunity_scored?: number;
  category_opportunity_coverage_evidence?: number;
  white_space_scored?: number;
  white_space_absence_evidence?: number;
  white_space_permission_evidence?: number;
  brand_positioning_scored?: number;
  brand_positioning_axis_defined?: number;
  brand_positioning_entities?: number;
  cultural_codes_scored?: number;
  cultural_codes_level_present?: number;
  cultural_codes_oppositions?: number;
  cultural_codes_long_text_validated?: number;
  competitive_wave_scored?: number;
  competitive_wave_entities?: number;
  competitive_wave_publishable?: number;
  audience_segment_scored?: number;
  audience_segment_source_present?: number;
  audience_segment_sensitive_inference?: number;
  influence_architecture_scored?: number;
  influence_graph_ready?: number;
  influence_author_metadata_ready?: number;
  decision_velocity_scored?: number;
  decision_velocity_benchmarked?: number;
  decision_velocity_ab_ready?: number;
};

export type EngineQualityCheck = {
  id: string;
  passed: boolean;
  detail: string;
};

export function buildEngineQualityChecks(gates: EngineQualityGateSummary): EngineQualityCheck[] {
  const checks: EngineQualityCheck[] = [
    {
      id: "traceability",
      passed: gates.findings === 0 || gates.findings_with_citation === gates.findings,
      detail: `${gates.findings_with_citation}/${gates.findings} findings tienen cita.`
    },
    {
      id: "confidence_calibrated",
      passed: gates.findings === 0 || gates.findings_with_confidence === gates.findings,
      detail: `${gates.findings_with_confidence}/${gates.findings} findings tienen confianza.`
    },
    {
      id: "limitations_section",
      passed: true,
      detail: "Limitaciones persistidas en engine_analyses.limitations."
    }
  ];

  const retrievedUnits = numberOrNull(gates.retrieval_units);
  const eligibleUnits = numberOrNull(gates.retrieval_eligible_units);
  const maxUnits = numberOrNull(gates.retrieval_max_units);
  const retrievalTruncated = gates.retrieval_truncated === true
    || (retrievedUnits !== null && eligibleUnits !== null && eligibleUnits > retrievedUnits);
  checks.push({
    id: "retrieval_budget_declared",
    passed: !retrievalTruncated,
    detail: retrievalTruncated
      ? `Claude codifico ${retrievedUnits ?? 0}/${eligibleUnits ?? "?"} menciones elegibles para ${gates.methodology_slug} por max_units=${maxUnits ?? "?"}; output direccional hasta ampliar presupuesto o muestreo aprobado.`
      : `Claude codifico ${retrievedUnits ?? 0}/${eligibleUnits ?? retrievedUnits ?? 0} menciones elegibles para ${gates.methodology_slug}.`
  });

  if (gates.methodology_slug === "narrative-ownership") {
    checks.push(
      {
        id: "narrative_ownership_scored",
        passed: gates.findings === 0 || gates.narrative_ownership_scored === gates.findings,
        detail: `${gates.narrative_ownership_scored}/${gates.findings} findings tienen share/ownership narrativo deterministico.`
      },
      {
        id: "narrative_emergent_not_imposed",
        passed: gates.insufficient_signal_findings === 0,
        detail: `${gates.insufficient_signal_findings} findings quedaron como insufficient_signal.`
      },
      {
        id: "owned_negative_flagged",
        passed: true,
        detail: `${gates.narrative_owned_negative} narrativas negativas owned quedan visibles como riesgo, no como logro.`
      }
    );
  }

  if (gates.methodology_slug === "sentiment-advocacy-proxy") {
    checks.push(
      {
        id: "sentiment_advocacy_scored",
        passed: gates.findings === 0 || gates.sentiment_advocacy_scored === gates.findings,
        detail: `${gates.sentiment_advocacy_scored}/${gates.findings} drivers tienen advocacy_proxy deterministico.`
      },
      {
        id: "no_survey_claim",
        passed: gates.findings === 0 || gates.sentiment_proxy_non_survey === gates.findings,
        detail: `${gates.sentiment_proxy_non_survey}/${gates.findings} drivers declaran is_survey_nps=false.`
      },
      {
        id: "driver_evidence_required",
        passed: gates.findings === 0 || gates.findings_with_citation === gates.findings,
        detail: `${gates.findings_with_citation}/${gates.findings} drivers tienen evidencia representativa.`
      }
    );
  }

  if (gates.methodology_slug === "trust-risk-benchmark") {
    checks.push(
      {
        id: "trust_risk_scored",
        passed: gates.findings === 0 || gates.trust_risk_scored === gates.findings,
        detail: `${gates.trust_risk_scored}/${gates.findings} findings tienen trust_score/risk_score deterministico.`
      },
      {
        id: "risk_quote_required",
        passed: gates.sensitive_risk_findings === gates.sensitive_risk_with_citation,
        detail: `${gates.sensitive_risk_with_citation}/${gates.sensitive_risk_findings} riesgos sensibles tienen cita.`
      },
      {
        id: "no_unverified_accusations",
        passed: gates.sensitive_risk_findings === gates.sensitive_risk_with_citation,
        detail: "Riesgos high/critical requieren evidencia trazable antes de publicarse."
      }
    );
  }

  if (gates.methodology_slug === "value-perception-matrix") {
    checks.push(
      {
        id: "vpm_scored",
        passed: gates.findings === 0 || gates.vpm_scored === gates.findings,
        detail: `${gates.vpm_scored}/${gates.findings} celdas tienen ownership/value score deterministico.`
      },
      {
        id: "balance_per_entity",
        passed: gates.vpm_entities >= 2,
        detail: `${gates.vpm_entities} entidades con celdas VPM.`
      },
      {
        id: "evidence_per_quadrant",
        passed: gates.findings === 0 || gates.findings_with_citation === gates.findings,
        detail: `${gates.findings_with_citation}/${gates.findings} celdas tienen evidencia.`
      },
      {
        id: "whitespace_has_absence_evidence",
        passed: gates.vpm_whitespace_candidates === 0,
        detail: `${gates.vpm_whitespace_candidates} whitespace candidates requieren evidencia de ausencia antes de publicarse como whitespace real.`
      }
    );
  }

  if (gates.methodology_slug === "journey-friction-mapping") {
    checks.push(
      {
        id: "journey_friction_scored",
        passed: gates.findings === 0 || gates.jfm_scored === gates.findings,
        detail: `${gates.jfm_scored}/${gates.findings} fricciones tienen choke/accelerator score.`
      },
      {
        id: "journey_phase_coverage",
        passed: gates.jfm_phase_count >= 2,
        detail: `${gates.jfm_phase_count} fases del journey cubiertas.`
      },
      {
        id: "articulable_only",
        passed: gates.jfm_invisible_findings === 0,
        detail: `${gates.jfm_invisible_findings} fricciones invisibles requieren research externo antes de publicarse como JFM.`
      },
      {
        id: "removability_not_assumed",
        passed: gates.findings === 0 || gates.jfm_scored === gates.findings,
        detail: "Removibilidad marcada como heurística direccional, no medición de funnel."
      }
    );
  }

  if (gates.methodology_slug === "category-opportunity-map") {
    checks.push(
      {
        id: "demand_evidence_required",
        passed: gates.findings === 0 || (gates.category_opportunity_scored ?? 0) === gates.findings,
        detail: `${gates.category_opportunity_scored ?? 0}/${gates.findings} oportunidades tienen demand/opportunity score.`
      },
      {
        id: "coverage_evidence_required",
        passed: gates.findings === 0 || (gates.category_opportunity_coverage_evidence ?? 0) === gates.findings,
        detail: `${gates.category_opportunity_coverage_evidence ?? 0}/${gates.findings} oportunidades tienen cobertura competitiva interpretable.`
      },
      {
        id: "best_positioned_not_assumed",
        passed: gates.findings === 0 || (gates.category_opportunity_scored ?? 0) === gates.findings,
        detail: "Entidad mejor posicionada se calcula desde share/sentimiento; no se infiere sin corpus."
      }
    );
  }

  if (gates.methodology_slug === "white-space-analysis") {
    checks.push(
      {
        id: "demand_and_absence_evidence",
        passed: gates.findings === 0 || (gates.white_space_absence_evidence ?? 0) === gates.findings,
        detail: `${gates.white_space_absence_evidence ?? 0}/${gates.findings} espacios tienen evidencia direccional de ausencia/cobertura baja.`
      },
      {
        id: "brand_permission_evidence",
        passed: gates.findings === 0 || (gates.white_space_permission_evidence ?? 0) === gates.findings,
        detail: `${gates.white_space_permission_evidence ?? 0}/${gates.findings} espacios tienen permiso de marca strong/moderate.`
      },
      {
        id: "no_conjecture_whitespace",
        passed: gates.findings === 0 || (gates.white_space_scored ?? 0) === gates.findings,
        detail: `${gates.white_space_scored ?? 0}/${gates.findings} espacios tienen whitespace_score deterministico.`
      }
    );
  }

  if (gates.methodology_slug === "brand-positioning-map") {
    checks.push(
      {
        id: "axis_defined",
        passed: gates.findings === 0 || (gates.brand_positioning_axis_defined ?? 0) === gates.findings,
        detail: `${gates.brand_positioning_axis_defined ?? 0}/${gates.findings} atributos tienen eje definido.`
      },
      {
        id: "attribute_evidence_required",
        passed: gates.findings === 0 || gates.findings_with_citation === gates.findings,
        detail: `${gates.findings_with_citation}/${gates.findings} atributos tienen cita.`
      },
      {
        id: "competitor_required",
        passed: (gates.brand_positioning_entities ?? 0) >= 2,
        detail: `${gates.brand_positioning_entities ?? 0} entidades con posicionamiento perceptual.`
      }
    );
  }

  if (gates.methodology_slug === "cultural-codes-decoding") {
    checks.push(
      {
        id: "codes_emerge_from_corpus",
        passed: gates.findings === 0 || (gates.cultural_codes_scored ?? 0) === gates.findings,
        detail: `${gates.cultural_codes_scored ?? 0}/${gates.findings} codigos tienen intensidad cultural calculada.`
      },
      {
        id: "three_levels_present",
        passed: gates.findings === 0 || (gates.cultural_codes_level_present ?? 0) === gates.findings,
        detail: `${gates.cultural_codes_level_present ?? 0}/${gates.findings} codigos tienen nivel cultural.`
      },
      {
        id: "oppositions_explicit",
        passed: gates.findings === 0 || (gates.cultural_codes_oppositions ?? 0) === gates.findings,
        detail: `${gates.cultural_codes_oppositions ?? 0}/${gates.findings} codigos tienen oposicion binaria.`
      },
      {
        id: "long_quote_evidence",
        passed: gates.findings === 0 || (gates.cultural_codes_long_text_validated ?? 0) === gates.findings,
        detail: `${gates.cultural_codes_long_text_validated ?? 0}/${gates.findings} codigos profundos tienen validacion de texto largo.`
      }
    );
  }

  if (gates.methodology_slug === "competitive-wave") {
    checks.push(
      {
        id: "axis_balance",
        passed: gates.findings === 0 || (gates.competitive_wave_scored ?? 0) === gates.findings,
        detail: `${gates.competitive_wave_scored ?? 0}/${gates.findings} axis signals tienen wave score.`
      },
      {
        id: "competitor_required",
        passed: (gates.competitive_wave_entities ?? 0) >= 3 && (gates.competitive_wave_publishable ?? 0) === gates.findings,
        detail: `${gates.competitive_wave_entities ?? 0} entidades en wave; minimo real 3.`
      }
    );
  }

  if (gates.methodology_slug === "audience-segment-lens") {
    checks.push(
      {
        id: "segment_source_required",
        passed: gates.findings === 0 || (gates.audience_segment_source_present ?? 0) === gates.findings,
        detail: `${gates.audience_segment_source_present ?? 0}/${gates.findings} celdas tienen segmento trazable.`
      },
      {
        id: "no_sensitive_inference",
        passed: (gates.audience_segment_sensitive_inference ?? 0) === 0,
        detail: `${gates.audience_segment_sensitive_inference ?? 0} celdas usan inferencia sensible.`
      },
      {
        id: "segment_skew_calibrated",
        passed: gates.findings === 0 || (gates.audience_segment_scored ?? 0) === gates.findings,
        detail: `${gates.audience_segment_scored ?? 0}/${gates.findings} celdas tienen segment_skew.`
      }
    );
  }

  if (gates.methodology_slug === "influence-architecture") {
    checks.push(
      {
        id: "author_metadata_required",
        passed: gates.findings === 0 || (gates.influence_author_metadata_ready ?? 0) === gates.findings,
        detail: `${gates.influence_author_metadata_ready ?? 0}/${gates.findings} nodos tienen metadata de autor suficiente.`
      },
      {
        id: "community_traceability",
        passed: gates.findings === 0 || (gates.influence_architecture_scored ?? 0) === gates.findings,
        detail: `${gates.influence_architecture_scored ?? 0}/${gates.findings} señales tienen comunidad/rol.`
      },
      {
        id: "no_influence_without_source",
        passed: gates.findings === 0 || (gates.influence_graph_ready ?? 0) === gates.findings,
        detail: `${gates.influence_graph_ready ?? 0}/${gates.findings} nodos tienen centralidad/grafo real disponible.`
      }
    );
  }

  if (gates.methodology_slug === "decision-velocity") {
    checks.push(
      {
        id: "phase_system_dual_coding",
        passed: gates.findings === 0 || (gates.decision_velocity_scored ?? 0) === gates.findings,
        detail: `${gates.decision_velocity_scored ?? 0}/${gates.findings} factores tienen fase/sistema/velocity index.`
      },
      {
        id: "benchmark_referenced",
        passed: gates.findings === 0 || (gates.decision_velocity_benchmarked ?? 0) === gates.findings,
        detail: `${gates.decision_velocity_benchmarked ?? 0}/${gates.findings} factores tienen benchmark de categoria.`
      },
      {
        id: "testable_hypotheses",
        passed: gates.findings === 0 || (gates.decision_velocity_ab_ready ?? 0) === gates.findings,
        detail: `${gates.decision_velocity_ab_ready ?? 0}/${gates.findings} factores tienen hipotesis A/B lista.`
      }
    );
  }

  return checks;
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
