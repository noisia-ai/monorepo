import { pool } from "@/lib/db";
import { resolveReadinessOverall, type DataOsReadinessStatus } from "@/lib/data-os/readiness-state";

export { resolveReadinessOverall } from "@/lib/data-os/readiness-state";
export type { DataOsReadinessStatus } from "@/lib/data-os/readiness-state";

export type DataOsReadinessStageKey =
  | "brand_os"
  | "sources"
  | "observations"
  | "analysis"
  | "signal";

export type DataOsReadinessStage = {
  key: DataOsReadinessStageKey;
  label: string;
  status: DataOsReadinessStatus;
  summary: string;
  detail: string;
};

export type DataOsMetricFamilySummary = {
  family: string;
  observations: number;
  accepted: number;
  metrics: number;
  assets: number;
  temporalObservations: number;
  snapshotObservations: number;
  periodStart: string | null;
  periodEnd: string | null;
  snapshotStart: string | null;
  snapshotEnd: string | null;
  grains: string[];
};

export type DataOsMonthlySeriesPoint = {
  month: string;
  metricFamily: string;
  metricKey: string;
  unit: string | null;
  value: number;
  observations: number;
  source: "data_observations" | "listening_mentions";
};

export type DataOsCorpusReadiness = {
  corpusId: string;
  generatedAt: string;
  overall: DataOsReadinessStatus;
  stages: DataOsReadinessStage[];
  counts: {
    brandOsProfiles: number;
    objectives: number;
    briefs: number;
    audiences: number;
    knowledgeSources: number;
    processedKnowledgeSources: number;
    failedKnowledgeSources: number;
    dataSources: number;
    dataAssets: number;
    dataFields: number;
    activeContracts: number;
    qualityChecks: number;
    observations: number;
    acceptedObservations: number;
    observationsNeedingReview: number;
    temporalObservations: number;
    snapshotObservations: number;
    canonicalRecords: number;
    acceptedRecords: number;
    recordsNeedingReview: number;
    rejectedRecords: number;
    includedMentions: number;
    analyses: number;
    analysisArtifacts: number;
    reviewedAnalysisArtifacts: number;
    unresolvedAnalysisArtifacts: number;
    structuredEvidenceRefs: number;
    claimSpecificStructuredEvidenceRefs: number;
    outputs: number;
    publishedOutputs: number;
    dashboardRefs: number;
  };
  coverage: {
    periodStart: string | null;
    periodEnd: string | null;
    snapshotStart: string | null;
    snapshotEnd: string | null;
    metricFamilies: number;
    metricKeys: number;
    observationMonths: number;
    listeningMonths: number;
    overlappingMonths: number;
    analysisConsumedStructuredData: boolean;
    latestConsumptionAt: string | null;
    structuredFindings: number;
    structuredFindingsWithEvidence: number;
    structuredEvidenceCoverageRatio: number;
  };
  metricFamilies: DataOsMetricFamilySummary[];
  monthlySeries: DataOsMonthlySeriesPoint[];
  blockers: string[];
  warnings: string[];
  nextAction: string;
};

type SummaryRow = {
  brand_os_profiles: number | string;
  objectives: number | string;
  briefs: number | string;
  audiences: number | string;
  knowledge_sources: number | string;
  processed_knowledge_sources: number | string;
  failed_knowledge_sources: number | string;
  data_sources: number | string;
  data_assets: number | string;
  data_fields: number | string;
  active_contracts: number | string;
  quality_checks: number | string;
  observations: number | string;
  accepted_observations: number | string;
  observations_needing_review: number | string;
  temporal_observations: number | string;
  snapshot_observations: number | string;
  canonical_records: number | string;
  accepted_records: number | string;
  records_needing_review: number | string;
  rejected_records: number | string;
  included_mentions: number | string;
  analyses: number | string;
  analysis_artifacts: number | string;
  reviewed_analysis_artifacts: number | string;
  unresolved_analysis_artifacts: number | string;
  structured_evidence_refs: number | string;
  claim_specific_structured_evidence_refs: number | string;
  outputs: number | string;
  published_outputs: number | string;
  dashboard_refs: number | string;
  period_start: string | null;
  period_end: string | null;
  snapshot_start: string | null;
  snapshot_end: string | null;
  metric_families: number | string;
  metric_keys: number | string;
  observation_months: number | string;
  listening_months: number | string;
  overlapping_months: number | string;
  analysis_consumed_structured_data: boolean;
  latest_consumption_at: string | null;
  structured_findings: number | string;
  structured_findings_with_evidence: number | string;
};

type MetricFamilyRow = {
  metric_family: string;
  observations: number | string;
  accepted: number | string;
  metrics: number | string;
  assets: number | string;
  temporal_observations: number | string;
  snapshot_observations: number | string;
  period_start: string | null;
  period_end: string | null;
  snapshot_start: string | null;
  snapshot_end: string | null;
  grains: string[] | null;
};

type MonthlySeriesRow = {
  month: string;
  metric_family: string;
  metric_key: string;
  metric_unit: string | null;
  metric_value: number | string;
  observations: number | string;
};

const EMPTY_COUNTS: DataOsCorpusReadiness["counts"] = {
  brandOsProfiles: 0,
  objectives: 0,
  briefs: 0,
  audiences: 0,
  knowledgeSources: 0,
  processedKnowledgeSources: 0,
  failedKnowledgeSources: 0,
  dataSources: 0,
  dataAssets: 0,
  dataFields: 0,
  activeContracts: 0,
  qualityChecks: 0,
  observations: 0,
  acceptedObservations: 0,
  observationsNeedingReview: 0,
  temporalObservations: 0,
  snapshotObservations: 0,
  canonicalRecords: 0,
  acceptedRecords: 0,
  recordsNeedingReview: 0,
  rejectedRecords: 0,
  includedMentions: 0,
  analyses: 0,
  analysisArtifacts: 0,
  reviewedAnalysisArtifacts: 0,
  unresolvedAnalysisArtifacts: 0,
  structuredEvidenceRefs: 0,
  claimSpecificStructuredEvidenceRefs: 0,
  outputs: 0,
  publishedOutputs: 0,
  dashboardRefs: 0
};

export async function getDataOsCorpusReadiness(corpusId: string): Promise<DataOsCorpusReadiness> {
  try {
    const [summaryResult, metricResult, observationSeriesResult, mentionSeriesResult] = await Promise.all([
      pool.query<SummaryRow>(READINESS_SUMMARY_SQL, [corpusId]),
      pool.query<MetricFamilyRow>(METRIC_FAMILIES_SQL, [corpusId]),
      pool.query<MonthlySeriesRow>(OBSERVATION_SERIES_SQL, [corpusId]),
      pool.query<MonthlySeriesRow>(MENTION_SERIES_SQL, [corpusId])
    ]);

    const row = summaryResult.rows[0];
    if (!row) return unavailableReadiness(corpusId, "No se encontró el corpus.");

    const counts: DataOsCorpusReadiness["counts"] = {
      brandOsProfiles: asNumber(row.brand_os_profiles),
      objectives: asNumber(row.objectives),
      briefs: asNumber(row.briefs),
      audiences: asNumber(row.audiences),
      knowledgeSources: asNumber(row.knowledge_sources),
      processedKnowledgeSources: asNumber(row.processed_knowledge_sources),
      failedKnowledgeSources: asNumber(row.failed_knowledge_sources),
      dataSources: asNumber(row.data_sources),
      dataAssets: asNumber(row.data_assets),
      dataFields: asNumber(row.data_fields),
      activeContracts: asNumber(row.active_contracts),
      qualityChecks: asNumber(row.quality_checks),
      observations: asNumber(row.observations),
      acceptedObservations: asNumber(row.accepted_observations),
      observationsNeedingReview: asNumber(row.observations_needing_review),
      temporalObservations: asNumber(row.temporal_observations),
      snapshotObservations: asNumber(row.snapshot_observations),
      canonicalRecords: asNumber(row.canonical_records),
      acceptedRecords: asNumber(row.accepted_records),
      recordsNeedingReview: asNumber(row.records_needing_review),
      rejectedRecords: asNumber(row.rejected_records),
      includedMentions: asNumber(row.included_mentions),
      analyses: asNumber(row.analyses),
      analysisArtifacts: asNumber(row.analysis_artifacts),
      reviewedAnalysisArtifacts: asNumber(row.reviewed_analysis_artifacts),
      unresolvedAnalysisArtifacts: asNumber(row.unresolved_analysis_artifacts),
      structuredEvidenceRefs: asNumber(row.structured_evidence_refs),
      claimSpecificStructuredEvidenceRefs: asNumber(row.claim_specific_structured_evidence_refs),
      outputs: asNumber(row.outputs),
      publishedOutputs: asNumber(row.published_outputs),
      dashboardRefs: asNumber(row.dashboard_refs)
    };
    const coverage: DataOsCorpusReadiness["coverage"] = {
      periodStart: row.period_start,
      periodEnd: row.period_end,
      snapshotStart: row.snapshot_start,
      snapshotEnd: row.snapshot_end,
      metricFamilies: asNumber(row.metric_families),
      metricKeys: asNumber(row.metric_keys),
      observationMonths: asNumber(row.observation_months),
      listeningMonths: asNumber(row.listening_months),
      overlappingMonths: asNumber(row.overlapping_months),
      analysisConsumedStructuredData: row.analysis_consumed_structured_data === true,
      latestConsumptionAt: row.latest_consumption_at,
      structuredFindings: asNumber(row.structured_findings),
      structuredFindingsWithEvidence: asNumber(row.structured_findings_with_evidence),
      structuredEvidenceCoverageRatio: ratio(
        asNumber(row.structured_findings_with_evidence),
        asNumber(row.structured_findings)
      )
    };
    const metricFamilies = metricResult.rows.map((metric) => ({
      family: metric.metric_family,
      observations: asNumber(metric.observations),
      accepted: asNumber(metric.accepted),
      metrics: asNumber(metric.metrics),
      assets: asNumber(metric.assets),
      temporalObservations: asNumber(metric.temporal_observations),
      snapshotObservations: asNumber(metric.snapshot_observations),
      periodStart: metric.period_start,
      periodEnd: metric.period_end,
      snapshotStart: metric.snapshot_start,
      snapshotEnd: metric.snapshot_end,
      grains: metric.grains ?? []
    }));
    const monthlySeries = [...observationSeriesResult.rows, ...mentionSeriesResult.rows]
      .map((point) => ({
        month: point.month,
        metricFamily: point.metric_family,
        metricKey: point.metric_key,
        unit: point.metric_unit,
        value: asNumber(point.metric_value),
        observations: asNumber(point.observations),
        source: point.metric_family === "mentions" && point.metric_key === "mentions_monthly"
          ? "listening_mentions" as const
          : "data_observations" as const
      }))
      .sort((a, b) => a.month.localeCompare(b.month) || a.metricKey.localeCompare(b.metricKey));

    return buildReadiness({ corpusId, counts, coverage, metricFamilies, monthlySeries });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[data-os-readiness] readiness unavailable", { corpusId, message });
    return unavailableReadiness(corpusId, "Data OS no está disponible en esta base o la migración no terminó.");
  }
}

function buildReadiness(args: {
  corpusId: string;
  counts: DataOsCorpusReadiness["counts"];
  coverage: DataOsCorpusReadiness["coverage"];
  metricFamilies: DataOsMetricFamilySummary[];
  monthlySeries: DataOsMonthlySeriesPoint[];
}): DataOsCorpusReadiness {
  const { counts, coverage } = args;
  const blockers: string[] = [];
  const warnings: string[] = [];

  const brandOsStatus: DataOsReadinessStatus = counts.brandOsProfiles === 0
    ? "attention"
    : counts.objectives === 0 || counts.briefs === 0
      ? "building"
      : "ready";
  if (counts.brandOsProfiles === 0) blockers.push("El corpus no está vinculado a un Brand OS gobernado.");
  if (counts.objectives === 0 || counts.briefs === 0) warnings.push("Falta persistir el objetivo o brief estructurado del estudio.");

  const sourceStatus: DataOsReadinessStatus = counts.dataSources === 0 && counts.knowledgeSources === 0
    ? "empty"
    : counts.failedKnowledgeSources > 0
      ? "attention"
      : counts.dataAssets === 0 || counts.activeContracts < counts.dataAssets
        ? "building"
        : "ready";
  if (counts.failedKnowledgeSources > 0) blockers.push(`${counts.failedKnowledgeSources} fuente(s) fallaron durante el perfilado.`);
  if (counts.dataAssets > counts.activeContracts) warnings.push("Hay assets sin contrato activo; Signal no debe tratarlos como series listas.");

  const acceptedDataEvidence = counts.acceptedRecords + counts.acceptedObservations;
  const reviewDataEvidence = counts.recordsNeedingReview + counts.observationsNeedingReview;
  const observationStatus: DataOsReadinessStatus = counts.dataAssets === 0
    ? "empty"
    : acceptedDataEvidence === 0
      ? "attention"
      : reviewDataEvidence > 0
          ? "building"
          : "ready";
  if (counts.dataAssets > 0 && acceptedDataEvidence === 0) {
    blockers.push("Los archivos están catalogados, pero todavía no tienen filas u observaciones aceptadas por su contrato.");
  }
  if (counts.acceptedObservations > 0 && counts.temporalObservations === 0 && counts.snapshotObservations > 0) {
    warnings.push("Las métricas disponibles son capturas puntuales; sirven como contexto gobernado, no como serie mensual.");
  }
  if (counts.acceptedObservations > 0 && counts.temporalObservations === 0 && counts.snapshotObservations === 0) {
    warnings.push("Hay observaciones aceptadas sin semántica temporal gobernada; revisa el contrato antes de compararlas.");
  }
  if (counts.recordsNeedingReview > 0) warnings.push(`${counts.recordsNeedingReview} fila(s) canónicas requieren revisión de mapeo.`);
  if (counts.observationsNeedingReview > 0) warnings.push(`${counts.observationsNeedingReview} observaciones requieren revisión de mapeo.`);

  const analysisStatus: DataOsReadinessStatus = counts.includedMentions === 0
    ? "empty"
    : counts.analyses === 0
      ? "building"
      : counts.unresolvedAnalysisArtifacts > 0
        ? "building"
      : acceptedDataEvidence > 0 && !coverage.analysisConsumedStructuredData
        ? "attention"
        : "ready";
  if (counts.analyses > 0 && acceptedDataEvidence > 0 && !coverage.analysisConsumedStructuredData) {
    blockers.push("El análisis existe, pero no registró consumo del contexto gobernado de Data OS.");
  }
  if (counts.includedMentions === 0) {
    warnings.push("Aún no hay menciones incluidas; el Engine no puede contrastar listening con las fuentes estructuradas.");
  }
  if (coverage.observationMonths > 0 && coverage.listeningMonths > 0 && coverage.overlappingMonths === 0) {
    warnings.push("Listening y fuentes estructuradas no comparten meses; el cruce temporal no es válido todavía.");
  }
  if (counts.unresolvedAnalysisArtifacts > 0) {
    warnings.push(`${counts.unresolvedAnalysisArtifacts} artefacto(s) de análisis requieren revisión editorial.`);
  }
  if (
    coverage.analysisConsumedStructuredData
    && coverage.structuredFindings > 0
    && coverage.structuredFindingsWithEvidence < coverage.structuredFindings
  ) {
    warnings.push(
      `${coverage.structuredFindingsWithEvidence}/${coverage.structuredFindings} finding(s) tienen evidencia estructurada claim-specific.`
    );
  }

  const signalStatus: DataOsReadinessStatus = counts.outputs === 0
    ? "empty"
    : counts.dashboardRefs === 0
      ? "attention"
      : counts.publishedOutputs === 0
        ? "building"
        : "ready";
  if (counts.outputs > 0 && counts.dashboardRefs === 0) blockers.push("El output no tiene dashboard_data_refs; Signal depende todavía del snapshot JSON.");

  const stages: DataOsReadinessStage[] = [
    {
      key: "brand_os",
      label: "Brand OS",
      status: brandOsStatus,
      summary: counts.brandOsProfiles > 0 ? `${fmt(counts.objectives)} objetivo(s) · ${fmt(counts.briefs)} brief(s)` : "Sin perfil gobernado",
      detail: `${fmt(counts.audiences)} audiencia(s) · ${fmt(counts.knowledgeSources)} fuente(s) de conocimiento`
    },
    {
      key: "sources",
      label: "Sources",
      status: sourceStatus,
      summary: `${fmt(counts.dataAssets)} asset(s) · ${fmt(counts.dataFields)} campo(s)`,
      detail: `${fmt(counts.activeContracts)}/${fmt(counts.dataAssets)} contratos activos · ${fmt(counts.qualityChecks)} controles`
    },
    {
      key: "observations",
      label: "Observations",
      status: observationStatus,
      summary: `${fmt(counts.acceptedObservations)} observaciones · ${fmt(counts.acceptedRecords)} filas`,
      detail: coverage.periodStart && coverage.periodEnd
        ? `${coverage.periodStart} a ${coverage.periodEnd} · ${fmt(coverage.overlappingMonths)} meses cruzables`
        : coverage.snapshotStart && coverage.snapshotEnd
          ? `Capturas ${coverage.snapshotStart} a ${coverage.snapshotEnd} · sin tendencia implícita`
          : counts.acceptedRecords > 0
            ? `${fmt(counts.acceptedRecords)} filas estáticas gobernadas · ${fmt(coverage.metricFamilies)} familias`
            : "Sin evidencia gobernada"
    },
    {
      key: "analysis",
      label: "Engine",
      status: analysisStatus,
      summary: `${fmt(counts.includedMentions)} menciones · ${fmt(counts.analyses)} análisis`,
      detail: counts.analysisArtifacts > 0
        ? `${fmt(counts.reviewedAnalysisArtifacts)}/${fmt(counts.analysisArtifacts)} artefactos revisados · ${Math.round(coverage.structuredEvidenceCoverageRatio * 100)}% findings con evidencia estructurada`
        : coverage.analysisConsumedStructuredData
          ? "T&B consumió observaciones estructuradas"
        : acceptedDataEvidence > 0
          ? "Observaciones listas; falta consumo registrado"
          : "Opera con listening + Knowledge Base"
    },
    {
      key: "signal",
      label: "Signal",
      status: signalStatus,
      summary: `${fmt(counts.publishedOutputs)}/${fmt(counts.outputs)} outputs publicados`,
      detail: `${fmt(counts.dashboardRefs)} referencias gobernadas al Data OS`
    }
  ];
  const overall = resolveReadinessOverall(stages, blockers);

  return {
    corpusId: args.corpusId,
    generatedAt: new Date().toISOString(),
    overall,
    stages,
    counts,
    coverage,
    metricFamilies: args.metricFamilies,
    monthlySeries: args.monthlySeries,
    blockers,
    warnings,
    nextAction: nextActionForStages(stages)
  };
}

function nextActionForStages(stages: DataOsReadinessStage[]) {
  const first = stages.find((stage) => stage.status !== "ready");
  if (!first) return "Data OS listo para análisis y serving gobernado.";
  if (first.key === "brand_os") return "Completa y guarda el objetivo estructurado del estudio.";
  if (first.key === "sources") return "Termina el perfilado y activa los contratos de las fuentes.";
  if (first.key === "observations") return "Materializa o revisa los mapeos antes de comparar series.";
  if (first.key === "analysis") {
    return first.status === "empty"
      ? "Ingiere y aprueba las menciones para cruzar listening con las observaciones estructuradas."
      : "Ejecuta T&B para registrar el consumo de observaciones estructuradas.";
  }
  return "Guarda Signal para crear sus referencias gobernadas y después publícalo.";
}

function unavailableReadiness(corpusId: string, reason: string): DataOsCorpusReadiness {
  return {
    corpusId,
    generatedAt: new Date().toISOString(),
    overall: "unavailable",
    stages: (["brand_os", "sources", "observations", "analysis", "signal"] as DataOsReadinessStageKey[]).map((key) => ({
      key,
      label: key === "brand_os" ? "Brand OS" : key === "observations" ? "Observations" : key === "analysis" ? "Engine" : key[0]!.toUpperCase() + key.slice(1),
      status: "unavailable",
      summary: "Sin verificación",
      detail: reason
    })),
    counts: { ...EMPTY_COUNTS },
    coverage: {
      periodStart: null,
      periodEnd: null,
      snapshotStart: null,
      snapshotEnd: null,
      metricFamilies: 0,
      metricKeys: 0,
      observationMonths: 0,
      listeningMonths: 0,
      overlappingMonths: 0,
      analysisConsumedStructuredData: false,
      latestConsumptionAt: null,
      structuredFindings: 0,
      structuredFindingsWithEvidence: 0,
      structuredEvidenceCoverageRatio: 0
    },
    metricFamilies: [],
    monthlySeries: [],
    blockers: [reason],
    warnings: [],
    nextAction: "Aplica las migraciones Data OS y vuelve a verificar."
  };
}

function asNumber(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function fmt(value: number) {
  return new Intl.NumberFormat("es-MX").format(value);
}

function ratio(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.min(1, Math.max(0, numerator / denominator));
}

const READINESS_SUMMARY_SQL = `
  WITH scope AS (
    SELECT id, brand_id, theme_id
    FROM study_corpora
    WHERE id = $1::uuid
  ),
  scoped_profiles AS (
    SELECT p.id
    FROM brand_os_profiles p
    CROSS JOIN scope s
    WHERE (s.brand_id IS NOT NULL AND p.brand_id = s.brand_id)
       OR (s.theme_id IS NOT NULL AND p.theme_id = s.theme_id)
  ),
  scoped_knowledge AS (
    SELECT ks.id, ks.status
    FROM brand_knowledge_sources ks
    CROSS JOIN scope s
    WHERE ks.study_corpus_id = s.id
       OR (s.brand_id IS NOT NULL AND ks.brand_id = s.brand_id)
  ),
  observation_months AS (
    SELECT DISTINCT date_trunc('month', period_start)::date AS month
    FROM data_observations
    WHERE study_corpus_id = $1::uuid
      AND period_start IS NOT NULL
      AND quality_status = 'accepted'
      AND period_semantics IN ('measurement', 'event')
  ),
  listening_months AS (
    SELECT DISTINCT date_trunc('month', published_at)::date AS month
    FROM mentions
    WHERE study_corpus_id = $1::uuid
      AND inclusion_status = 'included'
      AND published_at IS NOT NULL
  )
  SELECT
    (SELECT COUNT(*) FROM scoped_profiles) AS brand_os_profiles,
    (SELECT COUNT(*) FROM brand_os_objectives o WHERE o.brand_os_profile_id IN (SELECT id FROM scoped_profiles) AND o.status = 'active') AS objectives,
    (SELECT COUNT(*) FROM brand_os_briefs b WHERE b.brand_os_profile_id IN (SELECT id FROM scoped_profiles) AND (b.study_corpus_id = $1::uuid OR b.study_corpus_id IS NULL) AND b.status = 'active') AS briefs,
    (SELECT COUNT(*) FROM brand_os_audiences a WHERE a.brand_os_profile_id IN (SELECT id FROM scoped_profiles) AND a.status = 'active') AS audiences,
    (SELECT COUNT(*) FROM scoped_knowledge) AS knowledge_sources,
    (SELECT COUNT(*) FROM scoped_knowledge WHERE status IN ('processed', 'profiled', 'active')) AS processed_knowledge_sources,
    (SELECT COUNT(*) FROM scoped_knowledge WHERE status IN ('failed', 'error')) AS failed_knowledge_sources,
    (SELECT COUNT(*) FROM data_sources WHERE study_corpus_id = $1::uuid) AS data_sources,
    (SELECT COUNT(*) FROM data_assets WHERE study_corpus_id = $1::uuid AND status <> 'archived') AS data_assets,
    (SELECT COUNT(*) FROM data_asset_fields f JOIN data_assets a ON a.id = f.data_asset_id WHERE a.study_corpus_id = $1::uuid AND a.status <> 'archived') AS data_fields,
    (SELECT COUNT(*) FROM data_contracts c JOIN data_assets a ON a.id = c.data_asset_id WHERE a.study_corpus_id = $1::uuid AND c.status = 'active') AS active_contracts,
    (SELECT COUNT(*) FROM data_quality_results q JOIN data_assets a ON a.id = q.data_asset_id WHERE a.study_corpus_id = $1::uuid) AS quality_checks,
    (SELECT COUNT(*) FROM data_observations WHERE study_corpus_id = $1::uuid) AS observations,
    (SELECT COUNT(*) FROM data_observations WHERE study_corpus_id = $1::uuid AND quality_status = 'accepted') AS accepted_observations,
    (SELECT COUNT(*) FROM data_observations WHERE study_corpus_id = $1::uuid AND quality_status NOT IN ('accepted', 'rejected')) AS observations_needing_review,
    (SELECT COUNT(*) FROM data_observations WHERE study_corpus_id = $1::uuid AND period_start IS NOT NULL AND quality_status = 'accepted' AND period_semantics IN ('measurement', 'event')) AS temporal_observations,
    (SELECT COUNT(*) FROM data_observations WHERE study_corpus_id = $1::uuid AND period_start IS NOT NULL AND quality_status = 'accepted' AND period_semantics = 'snapshot') AS snapshot_observations,
    (SELECT COUNT(*) FROM data_asset_records WHERE study_corpus_id = $1::uuid) AS canonical_records,
    (SELECT COUNT(*) FROM data_asset_records WHERE study_corpus_id = $1::uuid AND quality_status = 'accepted') AS accepted_records,
    (SELECT COUNT(*) FROM data_asset_records WHERE study_corpus_id = $1::uuid AND quality_status NOT IN ('accepted', 'rejected')) AS records_needing_review,
    (SELECT COUNT(*) FROM data_asset_records WHERE study_corpus_id = $1::uuid AND quality_status = 'rejected') AS rejected_records,
    (SELECT COUNT(*) FROM mentions WHERE study_corpus_id = $1::uuid AND inclusion_status = 'included') AS included_mentions,
    (SELECT COUNT(*) FROM tb_analyses WHERE study_corpus_id = $1::uuid) AS analyses,
    (SELECT COUNT(*) FROM analysis_artifacts WHERE study_corpus_id = $1::uuid) AS analysis_artifacts,
    (
      SELECT COUNT(*)
      FROM analysis_artifacts artifact
      WHERE artifact.study_corpus_id = $1::uuid
        AND artifact.review_status IN ('accepted', 'corrected', 'limited', 'rejected')
    ) AS reviewed_analysis_artifacts,
    (
      SELECT COUNT(*)
      FROM analysis_artifacts artifact
      WHERE artifact.study_corpus_id = $1::uuid
        AND artifact.review_status IN ('draft', 'needs_review')
        AND NOT EXISTS (
          SELECT 1
          FROM analysis_artifacts newer
          WHERE newer.study_corpus_id = artifact.study_corpus_id
            AND newer.artifact_key = artifact.artifact_key
            AND newer.revision > artifact.revision
            AND newer.tb_analysis_id IS NOT DISTINCT FROM artifact.tb_analysis_id
            AND newer.engine_analysis_id IS NOT DISTINCT FROM artifact.engine_analysis_id
        )
    ) AS unresolved_analysis_artifacts,
    (
      SELECT COUNT(*)
      FROM tb_finding_structured_evidence_refs ref
      JOIN tb_findings finding ON finding.id = ref.finding_id
      JOIN tb_analyses analysis ON analysis.id = finding.tb_analysis_id
      WHERE analysis.study_corpus_id = $1::uuid
    ) AS structured_evidence_refs,
    (
      SELECT COUNT(*)
      FROM tb_finding_structured_evidence_refs ref
      JOIN tb_findings finding ON finding.id = ref.finding_id
      JOIN tb_analyses analysis ON analysis.id = finding.tb_analysis_id
      WHERE analysis.study_corpus_id = $1::uuid
        AND ref.evidence_role = 'claim_specific'
    ) AS claim_specific_structured_evidence_refs,
    (SELECT COUNT(*) FROM published_outputs WHERE study_corpus_id = $1::uuid AND archived_at IS NULL) AS outputs,
    (SELECT COUNT(*) FROM published_outputs WHERE study_corpus_id = $1::uuid AND status = 'published' AND archived_at IS NULL) AS published_outputs,
    (SELECT COUNT(*) FROM dashboard_data_refs WHERE study_corpus_id = $1::uuid) AS dashboard_refs,
    (SELECT MIN(period_start)::text FROM data_observations WHERE study_corpus_id = $1::uuid AND period_start IS NOT NULL AND quality_status = 'accepted' AND period_semantics IN ('measurement', 'event')) AS period_start,
    (SELECT MAX(COALESCE(period_end, period_start))::text FROM data_observations WHERE study_corpus_id = $1::uuid AND period_start IS NOT NULL AND quality_status = 'accepted' AND period_semantics IN ('measurement', 'event')) AS period_end,
    (SELECT MIN(period_start)::text FROM data_observations WHERE study_corpus_id = $1::uuid AND period_start IS NOT NULL AND quality_status = 'accepted' AND period_semantics = 'snapshot') AS snapshot_start,
    (SELECT MAX(COALESCE(period_end, period_start))::text FROM data_observations WHERE study_corpus_id = $1::uuid AND period_start IS NOT NULL AND quality_status = 'accepted' AND period_semantics = 'snapshot') AS snapshot_end,
    (SELECT COUNT(DISTINCT metric_family) FROM data_observations WHERE study_corpus_id = $1::uuid AND quality_status = 'accepted') AS metric_families,
    (SELECT COUNT(DISTINCT metric_key) FROM data_observations WHERE study_corpus_id = $1::uuid AND quality_status = 'accepted') AS metric_keys,
    (SELECT COUNT(*) FROM observation_months) AS observation_months,
    (SELECT COUNT(*) FROM listening_months) AS listening_months,
    (SELECT COUNT(*) FROM observation_months o JOIN listening_months l USING (month)) AS overlapping_months,
    EXISTS (
      SELECT 1
      FROM tb_analyses ta
      WHERE ta.study_corpus_id = $1::uuid
        AND COALESCE((ta.meta_json #>> '{data_os_context,consumed}')::boolean, false) = true
    ) AS analysis_consumed_structured_data,
    (
      SELECT MAX(NULLIF(ta.meta_json #>> '{data_os_context,consumed_at}', '')::timestamptz)::text
      FROM tb_analyses ta
      WHERE ta.study_corpus_id = $1::uuid
    ) AS latest_consumption_at,
    (
      SELECT COUNT(*)
      FROM tb_findings finding
      JOIN tb_analyses analysis ON analysis.id = finding.tb_analysis_id
      WHERE analysis.study_corpus_id = $1::uuid
    ) AS structured_findings,
    (
      SELECT COUNT(*)
      FROM tb_findings finding
      JOIN tb_analyses analysis ON analysis.id = finding.tb_analysis_id
      WHERE analysis.study_corpus_id = $1::uuid
        AND EXISTS (
          SELECT 1
          FROM tb_finding_structured_evidence_refs ref
          WHERE ref.finding_id = finding.id
            AND ref.evidence_role = 'claim_specific'
        )
    ) AS structured_findings_with_evidence
  FROM scope
`;

const METRIC_FAMILIES_SQL = `
  SELECT
    metric_family,
    COUNT(*) AS observations,
    COUNT(*) FILTER (WHERE quality_status = 'accepted') AS accepted,
    COUNT(DISTINCT metric_key) AS metrics,
    COUNT(DISTINCT data_asset_id) AS assets,
    COUNT(*) FILTER (WHERE period_semantics IN ('measurement', 'event')) AS temporal_observations,
    COUNT(*) FILTER (WHERE period_semantics = 'snapshot') AS snapshot_observations,
    MIN(period_start) FILTER (WHERE period_semantics IN ('measurement', 'event'))::text AS period_start,
    MAX(COALESCE(period_end, period_start)) FILTER (WHERE period_semantics IN ('measurement', 'event'))::text AS period_end,
    MIN(period_start) FILTER (WHERE period_semantics = 'snapshot')::text AS snapshot_start,
    MAX(COALESCE(period_end, period_start)) FILTER (WHERE period_semantics = 'snapshot')::text AS snapshot_end,
    ARRAY_AGG(DISTINCT period_grain ORDER BY period_grain) AS grains
  FROM data_observations
  WHERE study_corpus_id = $1::uuid
    AND quality_status = 'accepted'
  GROUP BY metric_family
  ORDER BY observations DESC, metric_family ASC
  LIMIT 24
`;

const OBSERVATION_SERIES_SQL = `
  SELECT *
  FROM (
    SELECT
      to_char(date_trunc('month', period_start), 'YYYY-MM') AS month,
      metric_family,
      metric_key,
      metric_unit,
      ROUND((CASE
        WHEN metric_unit = 'ratio'
          OR metric_family IN ('average_order_value', 'margin', 'conversion_rate', 'sentiment', 'score', 'price', 'search_position')
          THEN AVG(metric_value)
        ELSE SUM(metric_value)
      END)::numeric, 4) AS metric_value,
      COUNT(*) AS observations
    FROM data_observations
    WHERE study_corpus_id = $1::uuid
      AND period_start IS NOT NULL
      AND quality_status = 'accepted'
      AND period_semantics IN ('measurement', 'event')
    GROUP BY 1, metric_family, metric_key, metric_unit
    ORDER BY 1 DESC, metric_family, metric_key
    LIMIT 180
  ) series
  ORDER BY month ASC, metric_family, metric_key
`;

const MENTION_SERIES_SQL = `
  SELECT
    to_char(date_trunc('month', published_at), 'YYYY-MM') AS month,
    'mentions'::text AS metric_family,
    'mentions_monthly'::text AS metric_key,
    'count'::text AS metric_unit,
    COUNT(*)::numeric AS metric_value,
    COUNT(*) AS observations
  FROM mentions
  WHERE study_corpus_id = $1::uuid
    AND inclusion_status = 'included'
    AND published_at IS NOT NULL
  GROUP BY 1
  ORDER BY 1 ASC
  LIMIT 60
`;
