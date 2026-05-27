import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type { Job } from "bullmq";
import type { PoolClient } from "pg";

import {
  buildHumanizerPrompt,
  buildSynthesisPrompt,
  parseHumanizerResponse,
  parseSynthesisResponse,
  TB_SYNTHESIS_TOP_PER_KIND,
  type ActivationPlaybook,
  type FrictionRemovalPlan,
  type SynthesisFindingInput,
  type TbLayer,
  type TbMobility
} from "@noisia/query-engine";
import { pool } from "../db/client";
import {
  enqueueStep,
  markStepCompleted,
  markStepFailed,
  markStepRunning,
  releaseCorpusLock
} from "./tb-shared";

type StepJobData = {
  tbAnalysisId: string;
  pipelineStepId: string;
};

type AnalysisCtxRow = {
  business_question: string | null;
  decision_to_inform: string | null;
  brand_name: string | null;
  brand_display_name: string | null;
  brand_industry: string | null;
};

type FindingRow = {
  id: string;
  finding_id: string;
  polarity: "trigger" | "barrier" | "mixed";
  layer: TbLayer;
  nombre_comercial: string;
  frecuencia: number;
  intensidad_promedio: string | null;
  capacidad_predictiva: string | null;
  score_compuesto: string | null;
  movilidad: TbMobility | null;
  movilidad_razon: string | null;
  confidence: "alta" | "media" | "baja_direccional" | null;
  cita_protagonista: { text?: string } | null;
};

// TODO mejora-futura: medir costo/duracion real por corrida y bajar estos limites
// cuando tengamos benchmarks. Step 6 privilegia profundidad estrategica sobre
// velocidad porque recibe findings ya curados; los limites solo evitan workers
// colgados indefinidamente.
const STEP6_SYNTHESIS_TIMEOUT_MS = 10 * 60 * 1000;
const STEP6_HUMANIZER_TIMEOUT_MS = 10 * 60 * 1000;
const STEP6_SYNTHESIS_MAX_OUTPUT_TOKENS = 9_000;
const STEP6_HUMANIZER_MAX_OUTPUT_TOKENS = 8_000;

/**
 * Step 6 — Synthesis + humanizer.
 * Turns the scored/mobility-tagged findings into the canonical client-facing
 * playbooks, then runs one second-pass humanizer over the whole JSON.
 */
export async function tbStep6SynthesisJob(job: Job<StepJobData>) {
  const { tbAnalysisId, pipelineStepId } = job.data;
  await markStepRunning(pipelineStepId);
  await job.updateProgress(8);

  try {
    const ctx = await loadCtx(tbAnalysisId);
    await job.updateProgress(18);

    const findings = await loadFindings(tbAnalysisId);
    if (findings.length === 0) {
      throw new Error("No hay findings para sintetizar — step 3/4 no produjo salida util");
    }

    const promptFindings = selectFindingsForSynthesis(findings);
    const model = process.env.ANTHROPIC_MODEL_DEFAULT ?? "claude-sonnet-4-6";
    const prompt = buildSynthesisPrompt({
      brandName: ctx.brand_display_name ?? ctx.brand_name ?? "Marca",
      industry: ctx.brand_industry,
      businessQuestion: ctx.business_question ?? ctx.decision_to_inform,
      findings: promptFindings.map(toSynthesisInput)
    });

    console.log(
      `[tb-step6] synthesis with ${promptFindings.length}/${findings.length} findings ` +
      `(triggers=${promptFindings.filter((f) => f.polarity === "trigger").length}, ` +
      `barriers=${promptFindings.filter((f) => f.polarity === "barrier").length})`
    );
    await job.updateProgress(32);

    let synthesis = parseSynthesisResponse(
      (await generateText({
        model: anthropic(model),
        prompt,
        temperature: 0.18,
        maxOutputTokens: STEP6_SYNTHESIS_MAX_OUTPUT_TOKENS,
        timeout: STEP6_SYNTHESIS_TIMEOUT_MS,
        maxRetries: 1
      })).text
    );
    await job.updateProgress(62);

    const beforeHumanizer = JSON.stringify(synthesis, null, 2);
    const humanizerPrompt = buildHumanizerPrompt({ jsonText: beforeHumanizer });
    synthesis = parseHumanizerResponse(
      (await generateText({
        model: anthropic(model),
        prompt: humanizerPrompt,
        temperature: 0.12,
        maxOutputTokens: STEP6_HUMANIZER_MAX_OUTPUT_TOKENS,
        timeout: STEP6_HUMANIZER_TIMEOUT_MS,
        maxRetries: 1
      })).text
    );
    console.log(
      `[tb-step6] humanizer before="${beforeHumanizer.slice(0, 180).replace(/\s+/g, " ")}" ` +
      `after="${JSON.stringify(synthesis).slice(0, 180).replace(/\s+/g, " ")}"`
    );
    await job.updateProgress(76);

    const confidencePerFinding = Object.fromEntries(
      findings.map((f) => [f.finding_id, f.confidence ?? "media"])
    );
    const persistResult = await persistSynthesis({
      tbAnalysisId,
      activationPlaybook: synthesis.activation_playbook,
      frictionRemovalPlan: synthesis.friction_removal_plan,
      confidencePerFinding,
      findings
    });
    await job.updateProgress(92);

    await markStepCompleted({
      pipelineStepId,
      resultSummary: {
        findings_total: findings.length,
        findings_sent_to_claude: promptFindings.length,
        activation_top_triggers: synthesis.activation_playbook.top_triggers_movibles.length,
        activation_recommendations: synthesis.activation_playbook.por_trigger_recomendacion.length,
        friction_top_barriers: synthesis.friction_removal_plan.top_barriers_movibles.length,
        friction_recommendations: synthesis.friction_removal_plan.por_barrier_intervencion.length,
        structural_notes: synthesis.friction_removal_plan.barriers_estructurales.length,
        recommendations_inserted: persistResult.recommendationsInserted,
        unmatched_recommendation_ids: persistResult.unmatchedFindingIds,
        humanizer_preview: {
          before: beforeHumanizer.slice(0, 300),
          after: JSON.stringify(synthesis, null, 2).slice(0, 300)
        }
      }
    });

    const next = await enqueueStep({ tbAnalysisId, step: "quality_gates" });
    await job.updateProgress(100);

    return {
      recommendations_inserted: persistResult.recommendationsInserted,
      next_step_job_id: next.jobId
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[tb-step6] failed: ${msg}`);
    await markStepFailed({ pipelineStepId, errorMessage: msg });
    await releaseCorpusLock(tbAnalysisId);
    throw err;
  }
}

async function loadCtx(tbAnalysisId: string): Promise<AnalysisCtxRow> {
  const r = await pool.query<AnalysisCtxRow>(
    `SELECT
       ta.business_question,
       ta.decision_to_inform,
       b.name AS brand_name,
       b.display_name AS brand_display_name,
       b.industry AS brand_industry
     FROM tb_analyses ta
     JOIN study_corpora sc ON sc.id = ta.study_corpus_id
     LEFT JOIN brands b ON b.id = sc.brand_id
     WHERE ta.id = $1`,
    [tbAnalysisId]
  );
  const row = r.rows[0];
  if (!row) throw new Error(`tb_analyses ${tbAnalysisId} not found`);
  return row;
}

async function loadFindings(tbAnalysisId: string): Promise<FindingRow[]> {
  const r = await pool.query<FindingRow>(
    `SELECT id, finding_id, polarity, layer, nombre_comercial,
            frecuencia, intensidad_promedio, capacidad_predictiva,
            score_compuesto, movilidad, movilidad_razon, confidence,
            cita_protagonista
     FROM tb_findings
     WHERE tb_analysis_id = $1
       AND movilidad IS NOT NULL
     ORDER BY score_compuesto DESC NULLS LAST`,
    [tbAnalysisId]
  );
  return r.rows;
}

function selectFindingsForSynthesis(findings: FindingRow[]): FindingRow[] {
  const byId = new Map<string, FindingRow>();
  const add = (rows: FindingRow[]) => {
    for (const row of rows) byId.set(row.finding_id, row);
  };

  const sorted = (rows: FindingRow[]) =>
    rows.slice().sort((a, b) => scoreNumber(b.score_compuesto) - scoreNumber(a.score_compuesto));

  add(
    sorted(
      findings.filter(
        (f) =>
          f.polarity === "trigger" &&
          (f.movilidad === "movible_por_marca" || f.movilidad === "parcialmente_movible")
      )
    ).slice(0, TB_SYNTHESIS_TOP_PER_KIND)
  );
  // TODO mejora-futura: reemplazar este heuristic slice por diversidad por layer
  // cuando tengamos más corpora positivos; hoy evita inflar el prompt en MVP.
  add(
    sorted(findings.filter((f) => f.polarity === "trigger" && f.movilidad === "parcialmente_movible"))
      .slice(0, TB_SYNTHESIS_TOP_PER_KIND)
  );
  add(
    sorted(findings.filter((f) => f.polarity === "barrier" && f.movilidad === "movible_por_marca"))
      .slice(0, TB_SYNTHESIS_TOP_PER_KIND)
  );
  add(sorted(findings.filter((f) => f.polarity === "barrier" && f.movilidad === "estructural")));

  return Array.from(byId.values()).sort((a, b) => scoreNumber(b.score_compuesto) - scoreNumber(a.score_compuesto));
}

function toSynthesisInput(row: FindingRow): SynthesisFindingInput {
  return {
    id: row.id,
    finding_id: row.finding_id,
    nombre_comercial: row.nombre_comercial,
    polarity: row.polarity,
    layer: row.layer,
    frecuencia: row.frecuencia,
    intensidad_promedio: scoreNumber(row.intensidad_promedio),
    capacidad_predictiva: scoreNumber(row.capacidad_predictiva),
    score_compuesto: scoreNumber(row.score_compuesto),
    confidence: row.confidence ?? "media",
    movilidad: row.movilidad ?? "parcialmente_movible",
    movilidad_razon: row.movilidad_razon ?? "",
    cita_protagonista_text:
      row.cita_protagonista && typeof row.cita_protagonista === "object"
        ? row.cita_protagonista.text ?? ""
        : ""
  };
}

async function persistSynthesis(args: {
  tbAnalysisId: string;
  activationPlaybook: ActivationPlaybook;
  frictionRemovalPlan: FrictionRemovalPlan;
  confidencePerFinding: Record<string, string>;
  findings: FindingRow[];
}): Promise<{ recommendationsInserted: number; unmatchedFindingIds: string[] }> {
  const client = await pool.connect();
  const findingUuidById = new Map(args.findings.map((f) => [f.finding_id, f.id]));
  const unmatched = new Set<string>();
  let inserted = 0;

  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE tb_analyses
       SET activation_playbook = $1::jsonb,
           friction_removal_plan = $2::jsonb,
           confidence_per_finding = $3::jsonb,
           updated_at = NOW()
       WHERE id = $4`,
      [
        JSON.stringify(args.activationPlaybook),
        JSON.stringify(args.frictionRemovalPlan),
        JSON.stringify(args.confidencePerFinding),
        args.tbAnalysisId
      ]
    );

    await client.query(`DELETE FROM tb_recommendations WHERE tb_analysis_id = $1`, [args.tbAnalysisId]);

    for (const [position, rec] of args.activationPlaybook.por_trigger_recomendacion.entries()) {
      const findingUuid = findingUuidById.get(rec.trigger_id) ?? null;
      if (!findingUuid) unmatched.add(rec.trigger_id);
      await insertRecommendation(client, {
        tbAnalysisId: args.tbAnalysisId,
        findingId: findingUuid,
        kind: "activation",
        position,
        medioRecomendado: rec.medio_recomendado,
        tonoRecomendado: rec.tono_recomendado,
        riesgoSaturacion: rec.riesgo_saturacion,
        categoriaDondeAplica: rec.categoria_donde_aplica
      });
      inserted += 1;
    }

    for (const [position, rec] of args.frictionRemovalPlan.por_barrier_intervencion.entries()) {
      const findingUuid = findingUuidById.get(rec.barrier_id) ?? null;
      if (!findingUuid) unmatched.add(rec.barrier_id);
      await insertRecommendation(client, {
        tbAnalysisId: args.tbAnalysisId,
        findingId: findingUuid,
        kind: "friction_removal",
        position,
        intervencionSugerida: rec.intervencion_sugerida,
        tipoIntervencion: rec.tipo_intervencion,
        inversionEstimada: rec.inversion_estimada,
        indicadorExito: rec.indicador_exito,
        responsableSugerido: rec.responsable_sugerido
      });
      inserted += 1;
    }

    for (const [position, rec] of args.frictionRemovalPlan.barriers_estructurales.entries()) {
      const findingUuid = findingUuidById.get(rec.barrier_id) ?? null;
      if (!findingUuid) unmatched.add(rec.barrier_id);
      await insertRecommendation(client, {
        tbAnalysisId: args.tbAnalysisId,
        findingId: findingUuid,
        kind: "structural_note",
        position,
        razonEstructural: rec.razon_estructural,
        recomendacion: rec.recomendacion
      });
      inserted += 1;
    }

    await client.query("COMMIT");
    return { recommendationsInserted: inserted, unmatchedFindingIds: Array.from(unmatched) };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function insertRecommendation(
  client: PoolClient,
  values: {
    tbAnalysisId: string;
    findingId: string | null;
    kind: "activation" | "friction_removal" | "structural_note";
    position: number;
    medioRecomendado?: string;
    tonoRecomendado?: string;
    riesgoSaturacion?: string;
    categoriaDondeAplica?: string[];
    intervencionSugerida?: string;
    tipoIntervencion?: string;
    inversionEstimada?: string;
    indicadorExito?: string;
    responsableSugerido?: string;
    razonEstructural?: string;
    recomendacion?: string;
  }
) {
  await client.query(
    `INSERT INTO tb_recommendations (
       tb_analysis_id, finding_id, kind,
       medio_recomendado, tono_recomendado, riesgo_saturacion, categoria_donde_aplica,
       intervencion_sugerida, tipo_intervencion, inversion_estimada, indicador_exito,
       responsable_sugerido, razon_estructural, recomendacion, position
     )
     VALUES (
       $1, $2, $3,
       $4, $5, $6, $7,
       $8, $9, $10, $11,
       $12, $13, $14, $15
     )`,
    [
      values.tbAnalysisId,
      values.findingId,
      values.kind,
      values.medioRecomendado ?? null,
      values.tonoRecomendado ?? null,
      values.riesgoSaturacion ?? null,
      values.categoriaDondeAplica ?? null,
      values.intervencionSugerida ?? null,
      values.tipoIntervencion ?? null,
      values.inversionEstimada ?? null,
      values.indicadorExito ?? null,
      values.responsableSugerido ?? null,
      values.razonEstructural ?? null,
      values.recomendacion ?? null,
      values.position
    ]
  );
}

function scoreNumber(value: string | number | null): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}
