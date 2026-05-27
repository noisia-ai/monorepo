import type { Job } from "bullmq";

import { pool } from "../db/client";
import {
  markStepCompleted,
  markStepFailed,
  markStepRunning,
  releaseCorpusLock
} from "./tb-shared";

type QualityGateJobData = {
  tbAnalysisId: string;
  pipelineStepId: string;
};

type FindingRow = {
  id: string;
  finding_id: string;
  polarity: string;
  layer: string | null;
  frecuencia: number | null;
  intensidad_promedio: string | null;
  capacidad_predictiva: string | null;
  score_compuesto: string | null;
  movilidad: string | null;
  movilidad_razon: string | null;
  confidence: string | null;
  cita_protagonista: unknown;
  citation_count: number;
};

type RecommendationRow = {
  kind: string;
  finding_id: string | null;
  intervencion_sugerida: string | null;
  tipo_intervencion: string | null;
  inversion_estimada: string | null;
  indicador_exito: string | null;
  responsable_sugerido: string | null;
  razon_estructural: string | null;
  recomendacion: string | null;
  medio_recomendado: string | null;
  tono_recomendado: string | null;
};

type AnalysisRow = {
  status: string;
  activation_playbook: unknown;
  friction_removal_plan: unknown;
  limitations: unknown;
  confidence_per_finding: unknown;
};

type GateResult = {
  id: string;
  passed: boolean;
  level: "pass" | "warn" | "fail";
  notes: string;
};

const VALID_CONFIDENCE = new Set(["alta", "media", "baja_direccional"]);
const VALID_MOBILITY = new Set(["movible_por_marca", "parcialmente_movible", "estructural"]);

const CONSULTANT_JARGON = [
  "aprovechar sinergias",
  "optimizar engagement",
  "palanca de crecimiento",
  "audiencias clave",
  "ecosistema digital",
  "landscape",
  "pivotal",
  "seamless",
  "next-gen"
];

const FUTURE_PROJECTION_PHRASES = [
  "va a crecer",
  "van a crecer",
  "predecimos",
  "se proyecta",
  "tendencia futura",
  "inevitablemente",
  "garantiza que"
];

export async function tbQualityGatesJob(job: Job<QualityGateJobData>) {
  const { tbAnalysisId, pipelineStepId } = job.data;
  await markStepRunning(pipelineStepId);
  await job.updateProgress(10);

  try {
    const analysis = await loadAnalysis(tbAnalysisId);
    const findings = await loadFindings(tbAnalysisId);
    const recommendations = await loadRecommendations(tbAnalysisId);
    await job.updateProgress(35);

    const gates = runQualityGates({ analysis, findings, recommendations });
    await persistGates(tbAnalysisId, gates);
    await job.updateProgress(78);

    const failed = gates.filter((gate) => gate.level === "fail");
    const warned = gates.filter((gate) => gate.level === "warn");

    await markStepCompleted({
      pipelineStepId,
      resultSummary: {
        gates_total: gates.length,
        passed: gates.filter((gate) => gate.level === "pass").length,
        warned: warned.length,
        failed: failed.length,
        blockers: failed.map((gate) => gate.id)
      }
    });

    // TODO mejora-futura: introducir status explicito `requires_fixes`.
    // Para MVP, todo termina en review; los gates fallidos bloquean la aprobacion
    // desde el endpoint de approve, no desde un nuevo status.
    await pool.query(
      `UPDATE tb_analyses
       SET status = CASE
             WHEN status IN ('approved_by_im', 'approved_by_kam') THEN status
             ELSE 'needs_review'
           END,
           current_step = CASE
             WHEN status IN ('approved_by_im', 'approved_by_kam') THEN 'done'
             ELSE 'review'
           END,
           updated_at = NOW()
       WHERE id = $1`,
      [tbAnalysisId]
    );

    await releaseCorpusLock(tbAnalysisId);
    await job.updateProgress(100);

    return {
      gates_total: gates.length,
      failed: failed.map((gate) => gate.id),
      warnings: warned.map((gate) => gate.id),
      pipeline_complete: true
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[tb-quality-gates] failed: ${msg}`);
    await markStepFailed({ pipelineStepId, errorMessage: msg });
    await releaseCorpusLock(tbAnalysisId);
    throw err;
  }
}

async function loadAnalysis(tbAnalysisId: string): Promise<AnalysisRow> {
  const r = await pool.query<AnalysisRow>(
    `SELECT status, activation_playbook, friction_removal_plan, limitations, confidence_per_finding
     FROM tb_analyses
     WHERE id = $1`,
    [tbAnalysisId]
  );
  const row = r.rows[0];
  if (!row) throw new Error(`tb_analyses ${tbAnalysisId} not found`);
  return row;
}

async function loadFindings(tbAnalysisId: string): Promise<FindingRow[]> {
  const r = await pool.query<FindingRow>(
    `SELECT
       f.id,
       f.finding_id,
       f.polarity,
       f.layer,
       f.frecuencia,
       f.intensidad_promedio,
       f.capacidad_predictiva,
       f.score_compuesto,
       f.movilidad,
       f.movilidad_razon,
       f.confidence,
       f.cita_protagonista,
       COUNT(c.id)::int AS citation_count
     FROM tb_findings f
     LEFT JOIN tb_finding_citations c ON c.finding_id = f.id
     WHERE f.tb_analysis_id = $1
     GROUP BY f.id
     ORDER BY f.finding_id`,
    [tbAnalysisId]
  );
  return r.rows;
}

async function loadRecommendations(tbAnalysisId: string): Promise<RecommendationRow[]> {
  const r = await pool.query<RecommendationRow>(
    `SELECT
       r.kind,
       f.finding_id,
       r.intervencion_sugerida,
       r.tipo_intervencion,
       r.inversion_estimada,
       r.indicador_exito,
       r.responsable_sugerido,
       r.razon_estructural,
       r.recomendacion,
       r.medio_recomendado,
       r.tono_recomendado
     FROM tb_recommendations r
     LEFT JOIN tb_findings f ON f.id = r.finding_id
     WHERE r.tb_analysis_id = $1
     ORDER BY r.kind, r.position`,
    [tbAnalysisId]
  );
  return r.rows;
}

function runQualityGates(args: {
  analysis: AnalysisRow;
  findings: FindingRow[];
  recommendations: RecommendationRow[];
}): GateResult[] {
  const { analysis, findings, recommendations } = args;

  return [
    traceabilityGate(findings),
    layerCoverageGate(findings, analysis.limitations),
    hierarchyGate(findings),
    mobilityGate(findings),
    synthesisCompletenessGate(analysis, recommendations),
    actionabilityGate(recommendations),
    confidenceGate(findings, analysis.confidence_per_finding),
    voiceAndProjectionGate(analysis, recommendations)
  ];
}

function traceabilityGate(findings: FindingRow[]): GateResult {
  const withoutEnoughCitations = findings.filter((f) => f.citation_count < 3);
  const withoutQuote = findings.filter((f) => !hasProtagonistQuote(f.cita_protagonista));
  const failed = withoutEnoughCitations.length + withoutQuote.length;

  return {
    id: "traceability_complete",
    passed: failed === 0,
    level: failed === 0 ? "pass" : "fail",
    notes:
      failed === 0
        ? `Cada hallazgo tiene cita protagonista y al menos 3 menciones trazables.`
        : `${withoutEnoughCitations.length} hallazgos tienen menos de 3 citas y ${withoutQuote.length} no tienen cita protagonista completa.`
  };
}

function layerCoverageGate(findings: FindingRow[], limitations: unknown): GateResult {
  const layers = new Set(findings.map((f) => f.layer).filter(Boolean));
  const missing = ["psicologico", "personal", "social", "cultural"].filter((layer) => !layers.has(layer));
  const justified = textBlob(limitations).toLowerCase().includes("layer") || textBlob(limitations).toLowerCase().includes("cultural");
  const ok = missing.length === 0;

  return {
    id: "layer_coverage",
    passed: ok || justified,
    level: ok ? "pass" : justified ? "warn" : "fail",
    notes:
      ok
        ? "Los cuatro niveles de lectura están representados."
        : justified
          ? `Faltan niveles (${missing.join(", ")}), pero hay una limitación documentada.`
          : `Faltan niveles de lectura: ${missing.join(", ")}.`
  };
}

function hierarchyGate(findings: FindingRow[]): GateResult {
  const incomplete = findings.filter(
    (f) =>
      !positiveNumber(f.frecuencia) ||
      !positiveNumber(f.intensidad_promedio) ||
      !positiveNumber(f.capacidad_predictiva) ||
      !positiveNumber(f.score_compuesto)
  );

  return {
    id: "hierarchy_complete",
    passed: incomplete.length === 0,
    level: incomplete.length === 0 ? "pass" : "fail",
    notes:
      incomplete.length === 0
        ? "Todos los hallazgos tienen frecuencia, intensidad, capacidad predictiva y score."
        : `${incomplete.length} hallazgos tienen métricas incompletas.`
  };
}

function mobilityGate(findings: FindingRow[]): GateResult {
  const incomplete = findings.filter(
    (f) => !f.movilidad || !VALID_MOBILITY.has(f.movilidad) || !f.movilidad_razon?.trim()
  );

  return {
    id: "mobility_marked",
    passed: incomplete.length === 0,
    level: incomplete.length === 0 ? "pass" : "fail",
    notes:
      incomplete.length === 0
        ? "Todos los hallazgos tienen movilidad y razón de accionabilidad."
        : `${incomplete.length} hallazgos no tienen movilidad o razón clara.`
  };
}

function synthesisCompletenessGate(analysis: AnalysisRow, recommendations: RecommendationRow[]): GateResult {
  const activation = asRecord(analysis.activation_playbook);
  const friction = asRecord(analysis.friction_removal_plan);
  const hasActivation = Object.keys(activation).length > 0;
  const hasFriction = Object.keys(friction).length > 0;
  const hasRecommendations = recommendations.length > 0;
  const ok = hasActivation && hasFriction && hasRecommendations;

  return {
    id: "synthesis_complete",
    passed: ok,
    level: ok ? "pass" : "fail",
    notes: ok
      ? "La síntesis tiene playbook, plan de acción y recomendaciones persistidas."
      : "Falta algún bloque de síntesis o no hay recomendaciones persistidas."
  };
}

function actionabilityGate(recommendations: RecommendationRow[]): GateResult {
  const friction = recommendations.filter((r) => r.kind === "friction_removal");
  const structural = recommendations.filter((r) => r.kind === "structural_note");
  const activation = recommendations.filter((r) => r.kind === "activation");

  const incompleteFriction = friction.filter(
    (r) =>
      !r.intervencion_sugerida?.trim() ||
      !r.tipo_intervencion?.trim() ||
      !r.inversion_estimada?.trim() ||
      !r.indicador_exito?.trim() ||
      !r.responsable_sugerido?.trim()
  );
  const incompleteStructural = structural.filter(
    (r) => !r.razon_estructural?.trim() || !r.recomendacion?.trim()
  );
  const incompleteActivation = activation.filter(
    (r) => !r.medio_recomendado?.trim() || !r.tono_recomendado?.trim()
  );
  const incomplete = incompleteFriction.length + incompleteStructural.length + incompleteActivation.length;

  return {
    id: "actionability_complete",
    passed: incomplete === 0,
    level: incomplete === 0 ? "pass" : "fail",
    notes:
      incomplete === 0
        ? "Cada recomendación tiene acción, esfuerzo, señal de éxito o nota estructural correspondiente."
        : `${incomplete} recomendaciones están incompletas para ser accionables.`
  };
}

function confidenceGate(findings: FindingRow[], confidencePerFinding: unknown): GateResult {
  const confidence = asRecord(confidencePerFinding);
  const missing = findings.filter((f) => !VALID_CONFIDENCE.has(String(confidence[f.finding_id] ?? "")));
  const low = findings.filter((f) => f.confidence === "baja_direccional").length;

  return {
    id: "confidence_calibrated",
    passed: missing.length === 0,
    level: missing.length === 0 ? (low > Math.max(3, findings.length * 0.35) ? "warn" : "pass") : "fail",
    notes:
      missing.length === 0
        ? low > 0
          ? `${low} hallazgos están marcados como direccionales; se pueden usar, pero conviene no sobreactuarlos.`
          : "Cada hallazgo tiene confianza calibrada."
        : `${missing.length} hallazgos no tienen confianza calibrada en la síntesis.`
  };
}

function voiceAndProjectionGate(analysis: AnalysisRow, recommendations: RecommendationRow[]): GateResult {
  const text = textBlob([
    analysis.activation_playbook,
    analysis.friction_removal_plan,
    recommendations
  ]).toLowerCase();
  const futureHits = FUTURE_PROJECTION_PHRASES.filter((phrase) => text.includes(phrase));
  const jargonHits = CONSULTANT_JARGON.filter((phrase) => text.includes(phrase));
  const dashHits = /[—]/.test(text);
  const total = futureHits.length + jargonHits.length + (dashHits ? 1 : 0);

  return {
    id: "human_voice_and_no_projection",
    passed: total === 0,
    level: total === 0 ? "pass" : "warn",
    notes:
      total === 0
        ? "El texto no contiene proyecciones fuertes ni jerga consultora detectada."
        : `Revisar lenguaje: ${[...futureHits, ...jargonHits, dashHits ? "guiones largos" : ""].filter(Boolean).join(", ")}.`
  };
}

async function persistGates(tbAnalysisId: string, gates: GateResult[]) {
  for (const gate of gates) {
    const prefix = gate.level === "pass" ? "PASS" : gate.level === "warn" ? "WARN" : "FAIL";
    await pool.query(
      `INSERT INTO tb_quality_gates (tb_analysis_id, gate_name, passed, notes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tb_analysis_id, gate_name)
       DO UPDATE SET passed = EXCLUDED.passed, notes = EXCLUDED.notes, checked_at = NOW()`,
      [tbAnalysisId, `post_${gate.id}`, gate.passed, `${prefix}: ${gate.notes}`.slice(0, 700)]
    );
  }
}

function hasProtagonistQuote(value: unknown) {
  const record = asRecord(value);
  // TODO mejora-futura: exigir fuente, fecha y URL cuando step 3 lo persista
  // de forma consistente; en MVP la cita textual es el minimo bloqueante.
  return typeof record.text === "string" && record.text.trim().length > 20;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function positiveNumber(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0;
}

function textBlob(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
