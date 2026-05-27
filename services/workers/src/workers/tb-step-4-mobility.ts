import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type { Job } from "bullmq";

import {
  buildMobilityPrompt,
  parseMobilityResponse,
  type MobilityFindingInput,
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
  brand_name: string | null;
  brand_display_name: string | null;
  brand_industry: string | null;
};

type FindingRow = {
  finding_id: string;
  polarity: "trigger" | "barrier" | "mixed";
  layer: TbLayer;
  nombre_comercial: string;
  frecuencia: number;
  intensidad_promedio: string | null;
  capacidad_predictiva: string | null;
  score_compuesto: string | null;
  confidence: "alta" | "media" | "baja_direccional" | null;
  cita_protagonista: { text?: string } | null;
};

/**
 * Step 4 — Mobility.
 * Spec §5.5: classify every finding as movible_por_marca / parcialmente_movible
 * / estructural. This is what turns the diagnostic into actionable strategy —
 * if a barrier is structural, fighting it directly burns budget; the brand has
 * to align with the narrative instead.
 *
 * Algorithm:
 *   1. Load all tb_findings for this analysis.
 *   2. One Claude call evaluates mobility + razon for all of them.
 *   3. UPDATE each tb_findings row.
 *   4. Persist distribution summary for step 6 + dashboard.
 */
export async function tbStep4MobilityJob(job: Job<StepJobData>) {
  const { tbAnalysisId, pipelineStepId } = job.data;
  await markStepRunning(pipelineStepId);
  await job.updateProgress(10);

  try {
    const ctx = await loadCtx(tbAnalysisId);
    await job.updateProgress(20);

    const findings = await loadFindings(tbAnalysisId);
    if (findings.length === 0) {
      throw new Error("No hay findings que evaluar — step 3 no produjo nada");
    }
    console.log(`[tb-step4] evaluating mobility for ${findings.length} findings`);
    await job.updateProgress(35);

    const inputs: MobilityFindingInput[] = findings.map((f) => ({
      finding_id: f.finding_id,
      nombre_comercial: f.nombre_comercial,
      polarity: f.polarity,
      layer: f.layer,
      frecuencia: f.frecuencia,
      intensidad_promedio: Number(f.intensidad_promedio ?? 0),
      capacidad_predictiva: Number(f.capacidad_predictiva ?? 0),
      score_compuesto: Number(f.score_compuesto ?? 0),
      confidence: f.confidence ?? "media",
      cita_protagonista_text:
        (f.cita_protagonista && typeof f.cita_protagonista === "object" && f.cita_protagonista.text) || ""
    }));

    const model = process.env.ANTHROPIC_MODEL_DEFAULT ?? "claude-sonnet-4-6";
    const prompt = buildMobilityPrompt({
      brandName: ctx.brand_display_name ?? ctx.brand_name ?? "Marca",
      industry: ctx.brand_industry,
      businessQuestion: ctx.business_question,
      findings: inputs
    });

    let mobilityResult;
    try {
      const r = await generateText({ model: anthropic(model), prompt, temperature: 0.15 });
      console.log(`[tb-step4] response first 200: ${r.text.slice(0, 200)}`);
      mobilityResult = parseMobilityResponse(r.text);
    } catch (err) {
      throw new Error(`Mobility parse failed: ${err instanceof Error ? err.message : err}`);
    }

    if (mobilityResult.verdicts.length === 0) {
      throw new Error("Claude no devolvió verdicts de movilidad");
    }
    await job.updateProgress(75);

    // Build lookup and apply UPDATEs
    const verdictMap = new Map(mobilityResult.verdicts.map((v) => [v.finding_id, v]));
    const distribution: Record<TbMobility, number> = {
      movible_por_marca: 0,
      parcialmente_movible: 0,
      estructural: 0
    };
    let updated = 0;
    let unmatched = 0;

    for (const f of findings) {
      const v = verdictMap.get(f.finding_id);
      if (!v) {
        unmatched += 1;
        continue;
      }
      await pool.query(
        `UPDATE tb_findings
         SET movilidad = $1, movilidad_razon = $2
         WHERE tb_analysis_id = $3 AND finding_id = $4`,
        [v.movilidad, v.movilidad_razon, tbAnalysisId, f.finding_id]
      );
      distribution[v.movilidad] += 1;
      updated += 1;
    }

    await job.updateProgress(92);

    await markStepCompleted({
      pipelineStepId,
      resultSummary: {
        findings_total: findings.length,
        findings_updated: updated,
        findings_unmatched: unmatched,
        mobility_distribution: distribution,
        verdicts_preview: mobilityResult.verdicts.slice(0, 10).map((v) => ({
          finding_id: v.finding_id,
          movilidad: v.movilidad
        }))
      }
    });

    const next = await enqueueStep({ tbAnalysisId, step: "step5_comparative" });
    await job.updateProgress(100);

    return {
      findings_updated: updated,
      mobility_distribution: distribution,
      next_step_job_id: next.jobId
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[tb-step4] failed: ${msg}`);
    await markStepFailed({ pipelineStepId, errorMessage: msg });
    await releaseCorpusLock(tbAnalysisId);
    throw err;
  }
}

async function loadCtx(tbAnalysisId: string): Promise<AnalysisCtxRow> {
  const r = await pool.query<AnalysisCtxRow>(
    `SELECT
       ta.business_question,
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
    `SELECT finding_id, polarity, layer, nombre_comercial,
            frecuencia, intensidad_promedio, capacidad_predictiva,
            score_compuesto, confidence, cita_protagonista
     FROM tb_findings
     WHERE tb_analysis_id = $1
     ORDER BY score_compuesto DESC`,
    [tbAnalysisId]
  );
  return r.rows;
}
