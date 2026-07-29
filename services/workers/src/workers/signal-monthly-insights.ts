import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import type { Job } from "bullmq";
import { z } from "zod";

import {
  SIGNAL_MONTHLY_INSIGHT_EDITORIAL_CONTRACT_VERSION,
  SIGNAL_MONTHLY_INSIGHT_METRIC_GROUP_KEY,
  SIGNAL_MONTHLY_INSIGHT_TIMEOUT_MS,
  embedTexts,
  getEmbeddingModel,
  hasEmbeddingProvider,
  signalMonthlyInsightCandidateHashV1,
  validateSignalMonthlyInsightEditorialV1,
  validateSignalMonthlyInsightJobDataV1,
  vectorLiteral,
  type SignalMonthlyInsightEditorialV1,
  type SignalMonthlyInsightJobDataV1
} from "@noisia/query-engine";
import { pool } from "../db/client";
import { estimateModelCostUsd } from "./engine-cost";
import { loadAnalysisRagContext } from "./analysis-rag-context";

const editorialSchema = z.object({
  contract_version: z.literal(SIGNAL_MONTHLY_INSIGHT_EDITORIAL_CONTRACT_VERSION),
  candidate_hash: z.string(),
  summary: z.string().min(1),
  items: z.array(z.object({
    candidate_id: z.string().min(1),
    priority: z.number().int().min(1).max(7),
    short_title: z.string().min(1).max(80),
    explanation: z.string().min(1).max(280),
    why_it_matters: z.string().min(1).max(220),
    confidence: z.enum(["high", "medium", "low"]),
    limitations: z.array(z.string().max(180)).max(3)
  })).min(1).max(7)
});

type RagMatch = {
  candidate_id: string;
  knowledge: Array<{
    title: string | null;
    source_kind: string | null;
    text: string;
    similarity: number | null;
  }>;
  mentions: Array<{
    id: string;
    text: string;
    platform: string;
    published_at: string | null;
    sentiment: number | null;
    similarity: number | null;
  }>;
};

export async function signalMonthlyInsightJob(job: Job<SignalMonthlyInsightJobDataV1>) {
  const data = validateSignalMonthlyInsightJobDataV1(job.data);
  const packetHash = signalMonthlyInsightCandidateHashV1(data.packet);
  const estimatedCostUsd = estimateCost(data);
  if (estimatedCostUsd > data.budget_cap_usd) {
    throw new Error("estimated_cost_exceeds_budget_cap");
  }

  const run = await pool.query<{ id: string; status: string }>(`
    INSERT INTO metric_interpretation_runs (
      workspace_id, study_corpus_id, metric_group_key, metric_group_version,
      normalized_filter, filters_hash, data_scope, data_watermark_hash,
      packet, packet_hash, prompt_version, model_version, provider,
      idempotency_key, status, attempt, budget_cap_usd, estimated_cost_usd,
      timeout_ms, started_at
    ) VALUES (
      $1::uuid, $2::uuid, $3, 1,
      $4::jsonb, $5, $6::jsonb, $7,
      $8::jsonb, $9, $10, $11, 'anthropic',
      $12, 'running', $13, $14, $15, $16, now()
    )
    ON CONFLICT (idempotency_key) DO UPDATE SET
      status = CASE
        WHEN metric_interpretation_runs.status = 'completed'
          THEN metric_interpretation_runs.status
        ELSE 'running'
      END,
      attempt = GREATEST(metric_interpretation_runs.attempt, EXCLUDED.attempt),
      started_at = COALESCE(metric_interpretation_runs.started_at, now()),
      updated_at = now()
    RETURNING id::text, status
  `, [
    data.packet.workspace_id,
    data.packet.study_corpus_id,
    SIGNAL_MONTHLY_INSIGHT_METRIC_GROUP_KEY,
    JSON.stringify({
      contract_version: "signal-backend-v1",
      date_range: {
        start: data.packet.window.start,
        end: data.packet.window.end
      },
      timezone: data.packet.timezone,
      granularity: "day",
      dimensions: {}
    }),
    data.filters_hash,
    JSON.stringify({
      window: data.packet.window,
      comparison_window: data.packet.comparison_window,
      output_id: data.output_id
    }),
    data.data_watermark_hash,
    JSON.stringify(data.packet),
    packetHash,
    data.prompt_version,
    data.model_version,
    data.idempotency_key,
    job.attemptsMade + 1,
    data.budget_cap_usd,
    estimatedCostUsd,
    SIGNAL_MONTHLY_INSIGHT_TIMEOUT_MS
  ]);
  if (run.rows[0]?.status === "completed") {
    return { run_id: run.rows[0].id, reconciliation_only: true };
  }

  try {
    const [analysisContext, rag] = await Promise.all([
      loadAnalysisRagContext(data.packet.study_corpus_id, data.packet.brand_id),
      loadMonthlyInsightRag(data)
    ]);
    const result = await generateObject({
      model: anthropic(data.model_version),
      schema: editorialSchema,
      temperature: 0,
      maxRetries: 0,
      prompt: monthlyInsightPrompt({
        data,
        rag,
        knowledgeSources: analysisContext.knowledgeSources
      })
    });
    const editorial = validateSignalMonthlyInsightEditorialV1(result.object, {
      candidate_hash: data.packet.candidate_hash,
      candidate_ids: data.packet.candidates.map((candidate) => candidate.id)
    });
    const inputTokens = positiveInteger(result.usage.inputTokens);
    const outputTokens = positiveInteger(result.usage.outputTokens);
    const actualCostUsd = estimateModelCostUsd({
      provider: "anthropic",
      model: data.model_version,
      inputTokens,
      outputTokens
    }) ?? Number.POSITIVE_INFINITY;
    if (!Number.isFinite(actualCostUsd) || actualCostUsd > data.budget_cap_usd) {
      throw new Error("actual_cost_exceeds_budget_cap");
    }
    return await persistResult({
      data,
      runId: run.rows[0]!.id,
      packetHash,
      editorial,
      actualCostUsd,
      inputTokens,
      outputTokens
    });
  } catch (error) {
    await pool.query(`
      UPDATE metric_interpretation_runs
      SET status = 'failed', error_code = 'monthly_insight_failed',
        error_summary = $2::jsonb, completed_at = now(), updated_at = now()
      WHERE id = $1::uuid
    `, [
      run.rows[0]!.id,
      JSON.stringify({ message: safeError(error) })
    ]);
    throw error;
  }
}

async function loadMonthlyInsightRag(
  data: SignalMonthlyInsightJobDataV1
): Promise<RagMatch[]> {
  if (!hasEmbeddingProvider()) {
    throw new Error("monthly_insight_embedding_provider_not_configured");
  }
  const model = getEmbeddingModel();
  const inputs = data.packet.candidates.map((candidate) => ({
    id: candidate.id,
    text: candidateQuery(candidate, data.packet.window)
  }));
  const embeddings = await embedTexts({
    inputs,
    model,
    batchSize: 7,
    inputType: "query"
  });
  return Promise.all(embeddings.map(async (embedded) => {
    const [knowledge, mentions] = await Promise.all([
      pool.query<{
        title: string | null;
        source_kind: string | null;
        text: string;
        similarity: string | null;
      }>(`
        SELECT
          COALESCE(bks.title, se.metadata->>'title') AS title,
          COALESCE(bks.source_kind, se.metadata->>'source_kind') AS source_kind,
          se.chunk_text AS text,
          (1 - (se.embedding <=> $2::vector))::text AS similarity
        FROM semantic_embeddings se
        LEFT JOIN brand_knowledge_sources bks ON bks.id = se.source_id
        WHERE se.scope_type = 'knowledge_source'
          AND se.embedding_model = $3
          AND (
            se.study_corpus_id = $1::uuid
            OR ($4::uuid IS NOT NULL AND se.brand_id = $4::uuid)
            OR ($5::uuid IS NOT NULL AND se.organization_id = $5::uuid)
          )
        ORDER BY se.embedding <=> $2::vector
        LIMIT 6
      `, [
        data.packet.study_corpus_id,
        vectorLiteral(embedded.embedding),
        model,
        data.packet.brand_id,
        data.packet.organization_id
      ]),
      pool.query<{
        id: string;
        text: string;
        platform: string;
        published_at: string | null;
        sentiment: string | null;
        similarity: string | null;
      }>(`
        SELECT
          m.id::text,
          COALESCE(NULLIF(m.text_clean, ''), se.chunk_text) AS text,
          COALESCE(NULLIF(m.resolved_platform, ''), NULLIF(m.platform, ''), 'unknown') AS platform,
          m.published_at::date::text AS published_at,
          m.sentiment_score::text AS sentiment,
          (1 - (se.embedding <=> $2::vector))::text AS similarity
        FROM semantic_embeddings se
        JOIN mentions m ON m.id = se.mention_id
        WHERE se.scope_type = 'mention'
          AND se.study_corpus_id = $1::uuid
          AND se.embedding_model = $3
          AND m.inclusion_status = 'included'
          AND m.published_at >= $4::date
          AND m.published_at < ($5::date + interval '1 day')
        ORDER BY se.embedding <=> $2::vector
        LIMIT 10
      `, [
        data.packet.study_corpus_id,
        vectorLiteral(embedded.embedding),
        model,
        data.packet.window.start,
        data.packet.window.end
      ])
    ]);
    return {
      candidate_id: embedded.id,
      knowledge: knowledge.rows.map((row) => ({
        title: row.title,
        source_kind: row.source_kind,
        text: compactText(row.text, 700),
        similarity: nullableNumber(row.similarity)
      })),
      mentions: mentions.rows.map((row) => ({
        id: row.id,
        text: compactText(row.text, 520),
        platform: row.platform,
        published_at: row.published_at,
        sentiment: nullableNumber(row.sentiment),
        similarity: nullableNumber(row.similarity)
      }))
    };
  }));
}

function monthlyInsightPrompt(input: {
  data: SignalMonthlyInsightJobDataV1;
  rag: RagMatch[];
  knowledgeSources: Array<{ type: string; content: unknown }>;
}) {
  return [
    "Eres el editor mensual de Brand Monitoring de Noisia.",
    "Tu trabajo no es resumir el dashboard: selecciona sólo patrones que agregan una explicación que el lector no obtiene mirando una gráfica obvia.",
    "Los números del packet son canónicos. No calcules ni inventes métricas.",
    "El texto editorial es cualitativo: no escribas dígitos, porcentajes, fechas ni ordinales. La interfaz inserta las cifras determinísticas.",
    "No menciones proveedores, modelos, RAG, embeddings ni fuentes técnicas.",
    "Elige entre uno y siete candidatos. No estás obligado a usar todos.",
    "Descarta un líder de plataforma si sólo repite el ranking visible. Úsalo únicamente si el cambio de mezcla explica el movimiento.",
    "Sentimiento sólo entra cuando las menciones recuperadas revelan temas, experiencias o tensiones que explican el balance; nunca publiques sólo que subió o bajó.",
    "Concentración debe explicar de qué conversaciones depende el volumen y el riesgo de que pocas conversaciones dominen la lectura.",
    "Atención debe conectar el cambio con actividad de publicaciones raíz, proporción activa o intensidad por publicación; no confundas correlación con causalidad.",
    "Relaciona los patrones con objetivos, brief, audiencias y conocimiento aprobado cuando exista evidencia.",
    "Write all editorial copy in clear, natural English because this shared Signal release currently renders in en-US.",
    "Keep short_title under eight words. explanation is at most two concise sentences about the evidence-backed pattern. why_it_matters is one concise sentence for marketing, communications or brand.",
    "Do not state or imply resolution, cause, intent or business impact unless the retrieved evidence directly supports it. Phrase unproven drivers as signals or plausible explanations and add a limitation.",
    "Usa confidence baja si la evidencia es escasa o la cobertura es parcial y registra esa limitación.",
    "Devuelve sólo el JSON del contrato.",
    JSON.stringify({
      contract_version: SIGNAL_MONTHLY_INSIGHT_EDITORIAL_CONTRACT_VERSION,
      candidate_hash: input.data.packet.candidate_hash,
      packet: input.data.packet,
      rag: input.rag,
      study_context: input.knowledgeSources.slice(0, 12).map((source) => ({
        type: source.type,
        content: compactValue(source.content, 900)
      }))
    })
  ].join("\n");
}

async function persistResult(input: {
  data: SignalMonthlyInsightJobDataV1;
  runId: string;
  packetHash: string;
  editorial: SignalMonthlyInsightEditorialV1;
  actualCostUsd: number;
  inputTokens: number;
  outputTokens: number;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ id: string }>(`
      INSERT INTO metric_interpretations (
        run_id, workspace_id, study_corpus_id, metric_group_key,
        metric_group_version, revision, filters_hash, data_watermark_hash,
        packet_hash, data_scope, content, facts, hypotheses, causal_claims,
        recommendations, status, review_status, generated_by
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4, 1, 1, $5, $6,
        $7, $8::jsonb, $9::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
        '[]'::jsonb, 'fresh', 'auto_published', 'claude'
      )
      ON CONFLICT (
        workspace_id, metric_group_key, metric_group_version,
        filters_hash, data_watermark_hash, revision
      ) DO UPDATE SET
        run_id = EXCLUDED.run_id,
        packet_hash = EXCLUDED.packet_hash,
        data_scope = EXCLUDED.data_scope,
        content = EXCLUDED.content,
        status = 'fresh',
        review_status = 'auto_published',
        generated_by = 'claude',
        created_at = now()
      RETURNING id::text
    `, [
      input.runId,
      input.data.packet.workspace_id,
      input.data.packet.study_corpus_id,
      SIGNAL_MONTHLY_INSIGHT_METRIC_GROUP_KEY,
      input.data.filters_hash,
      input.data.data_watermark_hash,
      input.packetHash,
      JSON.stringify({
        window: input.data.packet.window,
        comparison_window: input.data.packet.comparison_window,
        candidate_hash: input.data.packet.candidate_hash
      }),
      JSON.stringify(input.editorial)
    ]);
    await client.query(`
      UPDATE metric_interpretation_runs
      SET status = 'completed', actual_cost_usd = $2,
        input_tokens = $3, output_tokens = $4,
        completed_at = now(), updated_at = now()
      WHERE id = $1::uuid
    `, [
      input.runId,
      input.actualCostUsd,
      input.inputTokens,
      input.outputTokens
    ]);
    await client.query("COMMIT");
    return {
      run_id: input.runId,
      interpretation_id: result.rows[0]!.id,
      source: "claude",
      state: "fresh",
      cost_usd: input.actualCostUsd
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function candidateQuery(
  candidate: SignalMonthlyInsightJobDataV1["packet"]["candidates"][number],
  window: SignalMonthlyInsightJobDataV1["packet"]["window"]
) {
  return [
    `Brand monitoring monthly pattern ${candidate.kind}.`,
    `Window ${window.start} to ${window.end}.`,
    `Current ${candidate.metric.current}; previous ${candidate.metric.previous ?? "not available"}.`,
    "Find concrete conversations, perceptions, experiences, topics and brand context that explain the observed pattern.",
    JSON.stringify(candidate.chart)
  ].join(" ");
}

function estimateCost(data: SignalMonthlyInsightJobDataV1) {
  const estimatedInputTokens = Math.ceil(JSON.stringify(data.packet).length / 4) + 18_000;
  return estimateModelCostUsd({
    provider: "anthropic",
    model: data.model_version,
    inputTokens: estimatedInputTokens,
    outputTokens: 2_000
  }) ?? 2;
}

function positiveInteger(value: number | undefined) {
  return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : 0;
}

function nullableNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compactText(value: string, limit: number) {
  const text = value.replace(/\s+/gu, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function compactValue(value: unknown, limit: number) {
  const text = JSON.stringify(value);
  if (text.length <= limit) return value;
  return { excerpt: `${text.slice(0, limit - 1)}…` };
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(?:sk-ant-|postgres(?:ql)?:\/\/)\S+/giu, "[redacted]").slice(0, 300);
}
