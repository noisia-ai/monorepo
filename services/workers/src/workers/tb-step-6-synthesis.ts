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
  type ActionStudioCard,
  type FrictionRemovalPlan,
  type SynthesisResponse,
  type SynthesisFindingInput,
  type TbLayer,
  type TbMobility
} from "@noisia/query-engine";
import { pool } from "../db/client";
import { safeJsonStringifyForPostgres, sanitizeUnicodeForPostgresJson, sanitizeUnicodeForPostgresText } from "./postgres-json";
import { detectTbOutputLanguage } from "./tb-language";
import { loadTbRagPromptContext } from "./tb-rag-context";
import { enqueueSelectedEngineLensesAfterTb } from "./engine-selected-lenses";
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
  study_corpus_id: string;
  snapshot_id: string | null;
  business_question: string | null;
  decision_to_inform: string | null;
  brand_name: string | null;
  brand_display_name: string | null;
  brand_industry: string | null;
  comparative_brief: unknown | null;
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

type HumanizerResult = {
  synthesis: SynthesisResponse;
  applied: boolean;
  finishReason: string | null;
  outputChars: number;
  errorMessage: string | null;
};

// TODO mejora-futura: medir costo/duracion real por corrida y bajar estos limites
// cuando tengamos benchmarks. Step 6 privilegia profundidad estrategica sobre
// velocidad porque recibe findings ya curados; los limites solo evitan workers
// colgados indefinidamente.
const STEP6_SYNTHESIS_TIMEOUT_MS = 20 * 60 * 1000;
const STEP6_HUMANIZER_TIMEOUT_MS = 20 * 60 * 1000;
const STEP6_SYNTHESIS_MAX_OUTPUT_TOKENS = 20_000;
// The humanizer rewrites the WHOLE synthesis JSON 1:1 (often slightly longer in
// natural language), so its budget MUST exceed the synthesis output. At 10k it
// truncated rich syntheses (finishReason="length") → invalid JSON → the brutal
// "compact" retry (max 3 items/array, 16 words) gutted the report. Sonnet
// supports up to 64k output tokens; the 20-min timeout has ample room.
const STEP6_HUMANIZER_MAX_OUTPUT_TOKENS = 26_000;

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
    const outputLanguage = await detectTbOutputLanguage(tbAnalysisId);
    const ragContext = await loadTbRagPromptContext(tbAnalysisId);
    const corpusOpenSignals = buildOpenSignalsFromCorpusIntelligence(ragContext.corpus_intelligence, outputLanguage);
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
      outputLanguage,
      ragContext,
      comparativeBrief: ctx.comparative_brief,
      findings: promptFindings.map(toSynthesisInput)
    });

    console.log(
      `[tb-step6] synthesis with ${promptFindings.length}/${findings.length} findings ` +
      `(triggers=${promptFindings.filter((f) => f.polarity === "trigger").length}, ` +
      `barriers=${promptFindings.filter((f) => f.polarity === "barrier").length})`
    );
    await job.updateProgress(32);

    let synthesis = await generateAndParseSynthesis({
      model,
      prompt,
      parser: parseSynthesisResponse,
      phase: "synthesis",
      temperature: 0.18,
      maxOutputTokens: STEP6_SYNTHESIS_MAX_OUTPUT_TOKENS,
      timeout: STEP6_SYNTHESIS_TIMEOUT_MS
    });
    await job.updateProgress(62);

    const beforeHumanizer = JSON.stringify(synthesis, null, 2);
    const humanizerPrompt = buildHumanizerPrompt({ jsonText: beforeHumanizer, outputLanguage });
    const humanizer = await generateAndParseHumanizer({
      model,
      prompt: humanizerPrompt,
      parser: parseHumanizerResponse,
      temperature: 0.12,
      maxOutputTokens: STEP6_HUMANIZER_MAX_OUTPUT_TOKENS,
      timeout: STEP6_HUMANIZER_TIMEOUT_MS,
      fallbackSynthesis: synthesis
    });
    synthesis = humanizer.synthesis;
    console.log(
      `[tb-step6] humanizer applied=${humanizer.applied} finish=${humanizer.finishReason ?? "unknown"} ` +
      `chars=${humanizer.outputChars} error="${humanizer.errorMessage ?? ""}" ` +
      `before="${beforeHumanizer.slice(0, 180).replace(/\s+/g, " ")}" ` +
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
      actionStudio: synthesis.action_studio,
      emergingPatterns: synthesis.emerging_patterns,
      knowledgeImpact: synthesis.knowledge_impact,
      strategicOpportunities: synthesis.strategic_opportunities,
      futureSignals: synthesis.future_signals,
      marketAnalysis: synthesis.market_analysis,
      evidenceDeepDives: synthesis.evidence_deep_dives,
      openSignals: corpusOpenSignals,
      humanizerMeta: {
        applied: humanizer.applied,
        finish_reason: humanizer.finishReason,
        output_chars: humanizer.outputChars,
        error_message: humanizer.errorMessage
      },
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
        action_studio_cards: synthesis.action_studio.length,
        emerging_patterns: synthesis.emerging_patterns.length,
        open_signals: corpusOpenSignals.length,
        humanizer_applied: humanizer.applied,
        humanizer_finish_reason: humanizer.finishReason,
        humanizer_output_chars: humanizer.outputChars,
        humanizer_error: humanizer.errorMessage,
        recommendations_inserted: persistResult.recommendationsInserted,
        unmatched_recommendation_ids: persistResult.unmatchedFindingIds,
        humanizer_preview: {
          before: beforeHumanizer.slice(0, 300),
          after: JSON.stringify(synthesis, null, 2).slice(0, 300)
        }
      }
    });

    if (process.env.TB_STEP6_ONLY_SKIP_QUALITY_GATES === "true") {
      await job.updateProgress(100);
      return {
        recommendations_inserted: persistResult.recommendationsInserted,
        next_step_job_id: null,
        quality_gates_skipped: true
      };
    }

    const next = await enqueueStep({ tbAnalysisId, step: "quality_gates" });
    await job.updateProgress(100);

    return {
      recommendations_inserted: persistResult.recommendationsInserted,
      next_step_job_id: next.jobId
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[tb-step6] failed: ${msg}`);
    await enqueueSelectedEngineLensesAfterStep6Failure(tbAnalysisId, msg);
    if (process.env.TB_ALLOW_DUPLICATE_STEP6_SKIP === "true" && await hasCompletedSynthesis(tbAnalysisId)) {
      await markStepSkipped({
        pipelineStepId,
        reason: `Skipped duplicate Step 6 failure after completed synthesis: ${msg}`
      });
      await releaseCorpusLock(tbAnalysisId);
      return {
        skipped_duplicate: true,
        reason: msg
      };
    }
    await markStepFailed({ pipelineStepId, errorMessage: msg });
    await releaseCorpusLock(tbAnalysisId);
    throw err;
  }
}

async function enqueueSelectedEngineLensesAfterStep6Failure(tbAnalysisId: string, failureReason: string) {
  try {
    const result = await enqueueSelectedEngineLensesAfterTb(tbAnalysisId, {
      launchSurface: "tb_step6_failure_auto_selected_lenses",
      resultMetaKey: "selected_engine_lenses_after_tb_step6_failure",
      triggerReason: failureReason.slice(0, 300)
    });
    console.log(
      `[tb-step6] selected engine lenses auto-launch after failure: ` +
      `${JSON.stringify(result).slice(0, 600)}`
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await pool.query(
      `UPDATE tb_analyses
       SET meta_json = COALESCE(meta_json, '{}'::jsonb) || $1::jsonb,
           updated_at = NOW()
       WHERE id = $2`,
      [
        JSON.stringify({
          selected_engine_lenses_after_tb_step6_failure: {
            status: "failed",
            launch_surface: "tb_step6_failure_auto_selected_lenses",
            trigger_reason: failureReason.slice(0, 300),
            reason
          }
        }),
        tbAnalysisId
      ]
    );
    console.error("[tb-step6] selected engine lenses auto-launch after failure failed", reason);
  }
}

async function generateAndParseSynthesis(args: {
  model: string;
  prompt: string;
  parser: (raw: string) => SynthesisResponse;
  phase: "synthesis" | "humanizer";
  temperature: number;
  maxOutputTokens: number;
  timeout: number;
}): Promise<SynthesisResponse> {
  const run = async (prompt: string) => generateText({
    model: anthropic(args.model),
    prompt,
    temperature: args.temperature,
    maxOutputTokens: args.maxOutputTokens,
    timeout: args.timeout,
    maxRetries: 1
  });

  const first = await run(args.prompt);
  try {
    return args.parser(first.text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[tb-step6] ${args.phase} returned invalid JSON (${message}); retrying compact regeneration. ` +
      `finish=${first.finishReason ?? "unknown"} chars=${first.text.length}`
    );
  }

  const retryPrompt = [
    args.prompt,
    "",
    "RETRY BECAUSE YOUR PREVIOUS RESPONSE WAS NOT VALID JSON.",
    "Return the same required schema again, but be more compact.",
    "Hard limits: max 3 items per array, max 16 words per explanation string.",
    "Your first character must be { and your last character must be }.",
    "Do not include markdown fences or prose outside JSON."
  ].join("\n");
  const second = await run(retryPrompt);
  return args.parser(second.text);
}

async function generateAndParseHumanizer(args: {
  model: string;
  prompt: string;
  parser: (raw: string) => SynthesisResponse;
  temperature: number;
  maxOutputTokens: number;
  timeout: number;
  fallbackSynthesis: SynthesisResponse;
}): Promise<HumanizerResult> {
  const result = await generateText({
    model: anthropic(args.model),
    prompt: args.prompt,
    temperature: args.temperature,
    maxOutputTokens: args.maxOutputTokens,
    timeout: args.timeout,
    maxRetries: 1
  });

  try {
    return {
      synthesis: args.parser(result.text),
      applied: true,
      finishReason: result.finishReason ?? null,
      outputChars: result.text.length,
      errorMessage: null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[tb-step6] humanizer returned invalid JSON (${message}); preserving full synthesis output. ` +
      `finish=${result.finishReason ?? "unknown"} chars=${result.text.length}`
    );
    return {
      synthesis: args.fallbackSynthesis,
      applied: false,
      finishReason: result.finishReason ?? null,
      outputChars: result.text.length,
      errorMessage: message
    };
  }
}

async function loadCtx(tbAnalysisId: string): Promise<AnalysisCtxRow> {
  const r = await pool.query<AnalysisCtxRow>(
    `SELECT
       ta.study_corpus_id,
       ta.snapshot_id,
       ta.business_question,
       COALESCE(ta.decision_to_inform, sc.decision_to_inform) AS decision_to_inform,
       ta.comparative_brief,
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

async function hasCompletedSynthesis(tbAnalysisId: string): Promise<boolean> {
  const r = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM tb_pipeline_steps
       WHERE tb_analysis_id = $1
         AND step = 'step6_synthesis'
         AND status = 'completed'
     ) AS exists`,
    [tbAnalysisId]
  );
  return Boolean(r.rows[0]?.exists);
}

async function markStepSkipped(args: { pipelineStepId: string; reason: string }): Promise<void> {
  await pool.query(
    `UPDATE tb_pipeline_steps
     SET status = 'skipped',
         completed_at = NOW(),
         duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000,
         error_message = $1
     WHERE id = $2`,
    [args.reason.slice(0, 2000), args.pipelineStepId]
  );
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
  actionStudio: ActionStudioCard[];
  emergingPatterns: SynthesisResponse["emerging_patterns"];
  knowledgeImpact: SynthesisResponse["knowledge_impact"];
  strategicOpportunities: SynthesisResponse["strategic_opportunities"];
  futureSignals: SynthesisResponse["future_signals"];
  marketAnalysis: SynthesisResponse["market_analysis"];
  evidenceDeepDives: SynthesisResponse["evidence_deep_dives"];
  openSignals: ReturnType<typeof buildOpenSignalsFromCorpusIntelligence>;
  humanizerMeta: {
    applied: boolean;
    finish_reason: string | null;
    output_chars: number;
    error_message: string | null;
  };
  confidencePerFinding: Record<string, string>;
  findings: FindingRow[];
}): Promise<{ recommendationsInserted: number; unmatchedFindingIds: string[] }> {
  const client = await pool.connect();
  const findingUuidById = new Map(args.findings.map((f) => [f.finding_id, f.id]));
  const unmatched = new Set<string>();
  let inserted = 0;

  try {
    await client.query("BEGIN");
    // Disable timeout for this transaction — the synthesis UPDATE writes large
    // jsonb payloads and the pooler's 2-min statement_timeout kills it otherwise.
    await client.query("SET LOCAL statement_timeout = 0");
    await client.query(
      `UPDATE tb_analyses
       SET activation_playbook = $1::jsonb,
           friction_removal_plan = $2::jsonb,
           confidence_per_finding = $3::jsonb,
           meta_json = COALESCE(meta_json, '{}'::jsonb) || jsonb_build_object(
             'action_studio', $4::jsonb,
             'emerging_patterns', $5::jsonb,
             'open_signals', $6::jsonb,
             'knowledge_impact', $7::jsonb,
             'strategic_opportunities', $8::jsonb,
             'future_signals', $9::jsonb,
             'market_analysis', $10::jsonb,
             'evidence_deep_dives', $11::jsonb,
             'humanizer', $13::jsonb
           ),
           updated_at = NOW()
       WHERE id = $12`,
      [
        safeJsonStringifyForPostgres(args.activationPlaybook),
        safeJsonStringifyForPostgres(args.frictionRemovalPlan),
        safeJsonStringifyForPostgres(args.confidencePerFinding),
        safeJsonStringifyForPostgres(args.actionStudio),
        safeJsonStringifyForPostgres(args.emergingPatterns),
        safeJsonStringifyForPostgres(args.openSignals),
        safeJsonStringifyForPostgres(args.knowledgeImpact),
        safeJsonStringifyForPostgres(args.strategicOpportunities),
        safeJsonStringifyForPostgres(args.futureSignals),
        safeJsonStringifyForPostgres(args.marketAnalysis),
        safeJsonStringifyForPostgres(args.evidenceDeepDives),
        args.tbAnalysisId,
        safeJsonStringifyForPostgres(args.humanizerMeta)
      ]
    );

    await client.query(`DELETE FROM tb_recommendations WHERE tb_analysis_id = $1`, [args.tbAnalysisId]);
    await client.query(`DELETE FROM tb_insights WHERE tb_analysis_id = $1`, [args.tbAnalysisId]);
    await client.query(`DELETE FROM tb_open_signals WHERE tb_analysis_id = $1`, [args.tbAnalysisId]);

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

    await persistInsights(client, {
      tbAnalysisId: args.tbAnalysisId,
      emergingPatterns: args.emergingPatterns
    });
    await persistOpenSignals(client, {
      tbAnalysisId: args.tbAnalysisId,
      openSignals: args.openSignals
    });

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

async function persistInsights(
  client: PoolClient,
  args: {
    tbAnalysisId: string;
    emergingPatterns: SynthesisResponse["emerging_patterns"];
  }
) {
  for (const [position, pattern] of args.emergingPatterns.entries()) {
    await client.query(
      `INSERT INTO tb_insights (
         tb_analysis_id,
         insight_id,
         kind,
         title,
         summary,
         finding_ids,
         data_basis,
         source_breakdown,
         evidence_quotes,
         confidence,
         position
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
       ON CONFLICT (tb_analysis_id, insight_id) DO UPDATE
       SET kind = EXCLUDED.kind,
           title = EXCLUDED.title,
           summary = EXCLUDED.summary,
           finding_ids = EXCLUDED.finding_ids,
           data_basis = EXCLUDED.data_basis,
           source_breakdown = EXCLUDED.source_breakdown,
           evidence_quotes = EXCLUDED.evidence_quotes,
           confidence = EXCLUDED.confidence,
           position = EXCLUDED.position,
           updated_at = NOW()`,
      [
        args.tbAnalysisId,
        pattern.pattern_id,
        pattern.pattern_type,
        sanitizeUnicodeForPostgresText(pattern.title),
        sanitizeUnicodeForPostgresText(pattern.why_it_matters),
        sanitizeUnicodeForPostgresJson(pattern.related_finding_ids),
        sanitizeUnicodeForPostgresJson(pattern.data_basis),
        safeJsonStringifyForPostgres(pattern.source_breakdown),
        sanitizeUnicodeForPostgresJson(pattern.evidence_quotes),
        pattern.confidence,
        position
      ]
    );
  }
}

async function persistOpenSignals(
  client: PoolClient,
  args: {
    tbAnalysisId: string;
    openSignals: ReturnType<typeof buildOpenSignalsFromCorpusIntelligence>;
  }
) {
  for (const [position, signal] of args.openSignals.entries()) {
    await client.query(
      `INSERT INTO tb_open_signals (
         tb_analysis_id,
         signal_id,
         title,
         signal_type,
         why_it_matters,
         tags,
         evidence_count,
         source_breakdown,
         metrics,
         evidence_quotes,
         confidence,
         position
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12)
       ON CONFLICT (tb_analysis_id, signal_id) DO UPDATE
       SET title = EXCLUDED.title,
           signal_type = EXCLUDED.signal_type,
           why_it_matters = EXCLUDED.why_it_matters,
           tags = EXCLUDED.tags,
           evidence_count = EXCLUDED.evidence_count,
           source_breakdown = EXCLUDED.source_breakdown,
           metrics = EXCLUDED.metrics,
           evidence_quotes = EXCLUDED.evidence_quotes,
           confidence = EXCLUDED.confidence,
           position = EXCLUDED.position,
           updated_at = NOW()`,
      [
        args.tbAnalysisId,
        signal.pattern_id,
        sanitizeUnicodeForPostgresText(signal.title),
        signal.pattern_type,
        sanitizeUnicodeForPostgresText(signal.why_it_matters),
        sanitizeUnicodeForPostgresJson(signal.data_basis),
        signal.evidence_count,
        safeJsonStringifyForPostgres(signal.source_breakdown),
        safeJsonStringifyForPostgres({ data_basis: signal.data_basis, related_finding_ids: signal.related_finding_ids }),
        sanitizeUnicodeForPostgresJson(signal.evidence_quotes),
        signal.confidence,
        position
      ]
    );
  }
}

function scoreNumber(value: string | number | null): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function buildOpenSignalsFromCorpusIntelligence(source: unknown, outputLanguage: string) {
  const record = source && typeof source === "object" ? source as Record<string, unknown> : {};
  const candidates = Array.isArray(record.open_signal_candidates) ? record.open_signal_candidates : [];
  const english = outputLanguage.toLowerCase().startsWith("english");
  return candidates
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item, index) => {
      const tag = stringFromUnknown(item.tag) || `senal-${index + 1}`;
      const mentionCount = numberFromUnknown(item.mention_count);
      const channel = stringFromUnknown(item.dominant_channel);
      const quote = stringFromUnknown(item.sample_quote);
      return {
        pattern_id: `OS-${String(index + 1).padStart(2, "0")}`,
        title: titleizeSignal(english ? englishSignalTitle(tag) : tag),
        pattern_type: "unexpected_insight",
        why_it_matters:
          mentionCount > 0
            ? english
              ? `Appears in ${mentionCount} mentions that were outside or ambiguous in T&B; it may be an adjacent signal for another method.`
              : `Aparece en ${mentionCount} menciones que quedaron fuera o ambiguas en T&B; puede ser una señal adyacente para otra metodología.`
            : english
              ? "Appears outside the T&B frame and may be an adjacent signal for another method."
              : "Aparece fuera del marco T&B y puede ser señal adyacente para otra metodología.",
        data_basis: ["corpus_sql", "noise_plus_signal"],
        evidence_count: mentionCount,
        source_breakdown: channel ? [{ source: channel, count: mentionCount }] : [],
        related_finding_ids: [],
        confidence: mentionCount >= 30 ? "media" : "baja_direccional",
        evidence_quotes: quote ? [quote.slice(0, 260)] : []
      };
    })
    .filter((item) => item.evidence_count > 0)
    .slice(0, 8);
}

function englishSignalTitle(value: string) {
  const key = normalizeLoose(value);
  const known: Record<string, string> = {
    "esperando el dia de pago": "waiting for payday",
    "dia de pago": "payday",
    "rutina de dia de pago": "payday routine",
    "aguantando hasta el dia de pago": "making it to payday",
    "no confio en los bancos": "distrust in banks",
    "me cerraron la cuenta sin razon": "account closed without explanation",
    "me cambie de banco": "switched banks",
    "los numeros no cuadran": "the numbers do not add up"
  };
  return known[key] ?? value;
}

function normalizeLoose(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stringFromUnknown(value: unknown) {
  return sanitizeUnicodeForPostgresText(typeof value === "string" ? value : value === null || value === undefined ? "" : String(value));
}

function numberFromUnknown(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function titleizeSignal(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
