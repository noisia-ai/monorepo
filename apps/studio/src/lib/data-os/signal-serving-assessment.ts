import type { RequiredSignalDataRefKey } from "@/lib/signal/semantics";

export type SignalServingReadiness = {
  contractVersion: string;
  snapshotId: string;
  analysisId: string;
  counts: {
    mentions: number;
    findings: number;
    findingsWithEvidence: number;
    synthesizedOpportunities: number;
    opportunities: number;
    opportunitiesWithEvidence: number;
    synthesizedActions: number;
    actions: number;
    actionsWithEvidence: number;
    citations: number;
    citationLinks: number;
    tags: number;
    tagTerms: number;
    features: number;
    featureKeys: number;
  };
  dataRefs: {
    required: readonly RequiredSignalDataRefKey[];
    present: string[];
    missing: RequiredSignalDataRefKey[];
    complete: boolean;
    enforced: boolean;
  };
};

export type SignalServingReadinessIssue = {
  code: string;
  message: string;
  detail?: string;
};

export type SignalServingReadinessAssessment = {
  ready: boolean;
  hardBlocks: SignalServingReadinessIssue[];
  warnings: SignalServingReadinessIssue[];
};

export function assessSignalServingReadiness(
  readiness: SignalServingReadiness
): SignalServingReadinessAssessment {
  const hardBlocks: SignalServingReadinessIssue[] = [];
  const warnings: SignalServingReadinessIssue[] = [];
  const { counts } = readiness;

  if (counts.mentions === 0) {
    hardBlocks.push({
      code: "snapshot_empty",
      message: "El snapshot aprobado no contiene menciones publicables."
    });
  }
  if (counts.findings === 0) {
    hardBlocks.push({
      code: "findings_missing",
      message: "El analisis no produjo hallazgos estructurados."
    });
  }
  if (counts.findings > 0 && counts.findingsWithEvidence < counts.findings) {
    hardBlocks.push({
      code: "finding_evidence_incomplete",
      message: "Hay hallazgos sin evidencia verificable dentro del snapshot aprobado.",
      detail: `${counts.findingsWithEvidence}/${counts.findings} hallazgos con evidencia`
    });
  }
  if (counts.opportunities !== counts.synthesizedOpportunities) {
    hardBlocks.push({
      code: "opportunity_persistence_mismatch",
      message: "Las oportunidades sintetizadas no coinciden con la capa relacional canonica.",
      detail: `${counts.opportunities}/${counts.synthesizedOpportunities} oportunidades persistidas`
    });
  }
  if (counts.opportunities > 0 && counts.opportunitiesWithEvidence < counts.opportunities) {
    hardBlocks.push({
      code: "opportunity_evidence_incomplete",
      message: "Hay oportunidades estrategicas sin findings verificables dentro del snapshot aprobado.",
      detail: `${counts.opportunitiesWithEvidence}/${counts.opportunities} oportunidades con evidencia`
    });
  }
  if (counts.actions !== counts.synthesizedActions) {
    hardBlocks.push({
      code: "action_persistence_mismatch",
      message: "Action Studio no coincide con la capa relacional canonica.",
      detail: `${counts.actions}/${counts.synthesizedActions} acciones persistidas`
    });
  }
  if (counts.actions > 0 && counts.actionsWithEvidence < counts.actions) {
    hardBlocks.push({
      code: "action_evidence_incomplete",
      message: "Hay acciones sin findings verificables dentro del snapshot aprobado.",
      detail: `${counts.actionsWithEvidence}/${counts.actions} acciones con evidencia`
    });
  }
  if (counts.tags === 0 && counts.features === 0) {
    hardBlocks.push({
      code: "governed_dimensions_missing",
      message: "Las menciones no tienen tags ni features gobernadas para servir Signal."
    });
  }
  if (readiness.dataRefs.enforced && !readiness.dataRefs.complete) {
    hardBlocks.push({
      code: "dashboard_refs_incomplete",
      message: "El output publicado no tiene el manifiesto relacional completo para servir Signal.",
      detail: readiness.dataRefs.missing.join(", ")
    });
  }

  if (counts.opportunities === 0) {
    warnings.push({
      code: "opportunities_missing",
      message: "No hay oportunidades estructuradas; Signal podra publicarse sin ese modulo."
    });
  }
  if (counts.actions === 0) {
    warnings.push({
      code: "actions_missing",
      message: "Action Studio no contiene acciones canonicas para este analisis."
    });
  }
  if (counts.tags === 0) {
    warnings.push({
      code: "tags_missing",
      message: "No hay tags taxonomicos disponibles como dimensiones filtrables."
    });
  }
  if (counts.features === 0) {
    warnings.push({
      code: "features_missing",
      message: "No hay features tipadas disponibles como dimensiones filtrables."
    });
  }

  return {
    ready: hardBlocks.length === 0,
    hardBlocks,
    warnings
  };
}
