import { anthropic } from "@ai-sdk/anthropic";
import type { Job } from "bullmq";
import { generateObject } from "ai";
import { z } from "zod";

import {
  SIGNAL_INTERPRETATION_CONTRACT_VERSION,
  SIGNAL_INTERPRETATION_TIMEOUT_MS,
  assertSignalInterpretationScopeV1,
  buildSignalMetricPacketV1,
  signalMetricPacketHashV1,
  type SignalInterpretationJobDataV1,
  type SignalMetricInterpretationV1,
  type SignalMetricPacketRowV1
} from "@noisia/query-engine";

import { pool } from "../db/client";
import { estimateModelCostUsd, positiveTokenInteger } from "./engine-cost";
import { executeSignalInterpretationV1 } from "./signal-interpretation-runtime";

const claimSchema = z.object({
  kind: z.enum(["fact", "hypothesis", "causal_claim", "recommendation"]),
  text: z.string().min(1),
  numeric_refs: z.array(z.object({
    materialization_id: z.string().uuid(),
    field: z.enum(["value", "denominator", "sample_size"]),
    value: z.number()
  })),
  evidence_refs: z.array(z.string().uuid()),
  uncertainty: z.string().nullable()
});
const interpretationSchema = z.object({
  contract_version: z.literal(SIGNAL_INTERPRETATION_CONTRACT_VERSION),
  summary: z.string(),
  claims: z.array(claimSchema),
  limitations: z.array(z.string()),
  review_status: z.enum(["auto_published", "needs_review"])
});

type CanonicalRow = SignalMetricPacketRowV1 & {
  normalized_filter: unknown;
};

export async function signalInterpretationJob(job: Job<SignalInterpretationJobDataV1>) {
  const data = job.data;
  const rows = await pool.query<CanonicalRow>(`
    SELECT id::text AS materialization_id, materialization_key,
      metric_key, metric_version, period_start::text, period_end::text,
      value::float8 AS value, denominator::float8 AS denominator,
      sample_size, materialization_state, quality_state,
      data_watermark_hash, normalized_filter
    FROM metric_materializations
    WHERE workspace_id = $1::uuid AND study_corpus_id = $2::uuid
      AND metric_group_key = $3 AND filters_hash = $4
      AND data_watermark_hash = $5
      AND (cache_scope <> 'ad_hoc' OR expires_at > now())
    ORDER BY period_start, metric_key, id
  `, [
    data.workspace_id,
    data.study_corpus_id,
    data.metric_group_key,
    data.filters_hash,
    data.data_watermark_hash
  ]);
  const packet = buildSignalMetricPacketV1({
    workspace_id: data.workspace_id,
    study_corpus_id: data.study_corpus_id,
    metric_group_key: data.metric_group_key,
    metric_group_version: data.metric_group_version,
    filter: data.filter,
    data_watermark_hash: data.data_watermark_hash,
    rows: rows.rows
  });
  assertSignalInterpretationScopeV1({
    expected_filters_hash: data.filters_hash,
    expected_data_watermark_hash: data.data_watermark_hash,
    packet
  });
  const packetHash = signalMetricPacketHashV1(packet);
  const estimatedCostUsd = estimatePacketCost(packet);
  const run = await pool.query<{ id: string; status: string }>(`
    INSERT INTO metric_interpretation_runs (
      workspace_id, study_corpus_id, metric_group_key, metric_group_version,
      normalized_filter, filters_hash, data_scope, data_watermark_hash,
      packet, packet_hash, prompt_version, model_version, provider,
      idempotency_key, status, attempt, budget_cap_usd, estimated_cost_usd,
      timeout_ms, started_at
    ) VALUES (
      $1::uuid, $2::uuid, $3, $4, $5::jsonb, $6, $7::jsonb, $8,
      $9::jsonb, $10, $11, $12, 'anthropic',
      $13, 'running', $14, $15, $16, $17, now()
    )
    ON CONFLICT (idempotency_key) DO UPDATE SET
      status = CASE
        WHEN metric_interpretation_runs.status IN ('completed', 'skipped')
          THEN metric_interpretation_runs.status
        ELSE 'running'
      END,
      attempt = GREATEST(metric_interpretation_runs.attempt, EXCLUDED.attempt),
      started_at = COALESCE(metric_interpretation_runs.started_at, now()),
      updated_at = now()
    RETURNING id::text, status
  `, [
    data.workspace_id,
    data.study_corpus_id,
    data.metric_group_key,
    data.metric_group_version,
    JSON.stringify(packet.filter),
    packet.filters_hash,
    JSON.stringify(packet.data_scope),
    packet.data_watermark_hash,
    JSON.stringify(packet),
    packetHash,
    data.prompt_version,
    data.model_version,
    data.idempotency_key,
    job.attemptsMade + 1,
    data.budget_cap_usd,
    estimatedCostUsd,
    SIGNAL_INTERPRETATION_TIMEOUT_MS
  ]);
  if (run.rows[0]?.status === "completed" || run.rows[0]?.status === "skipped") {
    return { run_id: run.rows[0].id, reconciliation_only: true };
  }

  const execution = await executeSignalInterpretationV1({
    packet,
    provider_enabled: isSignalInterpretationLlmEnabled(),
    budget_cap_usd: data.budget_cap_usd,
    estimated_cost_usd: estimatedCostUsd,
    provider: (metricPacket) => runClaudeMetricInterpretation(metricPacket, data.model_version)
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const status = interpretationState(execution.interpretation);
    const interpretation = await client.query<{ id: string }>(`
      INSERT INTO metric_interpretations (
        run_id, workspace_id, study_corpus_id, metric_group_key,
        metric_group_version, revision, filters_hash, data_watermark_hash,
        packet_hash, data_scope, content, facts, hypotheses, causal_claims,
        recommendations, status, review_status, generated_by
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4, $5, 1, $6, $7,
        $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb,
        $14::jsonb, $15, $16, $17
      )
      ON CONFLICT (
        workspace_id, metric_group_key, metric_group_version,
        filters_hash, data_watermark_hash, revision
      ) DO UPDATE SET
        run_id = EXCLUDED.run_id, packet_hash = EXCLUDED.packet_hash,
        data_scope = EXCLUDED.data_scope, content = EXCLUDED.content,
        facts = EXCLUDED.facts, hypotheses = EXCLUDED.hypotheses,
        causal_claims = EXCLUDED.causal_claims, recommendations = EXCLUDED.recommendations,
        status = EXCLUDED.status, review_status = EXCLUDED.review_status,
        generated_by = EXCLUDED.generated_by
      RETURNING id::text
    `, [
      run.rows[0]!.id,
      data.workspace_id,
      data.study_corpus_id,
      data.metric_group_key,
      data.metric_group_version,
      data.filters_hash,
      data.data_watermark_hash,
      packetHash,
      JSON.stringify(packet.data_scope),
      JSON.stringify(execution.interpretation),
      JSON.stringify(claimsOf(execution.interpretation, "fact")),
      JSON.stringify(claimsOf(execution.interpretation, "hypothesis")),
      JSON.stringify(claimsOf(execution.interpretation, "causal_claim")),
      JSON.stringify(claimsOf(execution.interpretation, "recommendation")),
      status,
      execution.interpretation.review_status,
      execution.source === "claude" ? "claude" : "deterministic_fallback"
    ]);
    const interpretationId = interpretation.rows[0]!.id;
    await client.query(`DELETE FROM metric_interpretation_evidence WHERE interpretation_id = $1::uuid`, [interpretationId]);
    for (const [claimIndex, claim] of execution.interpretation.claims.entries()) {
      const numericByMaterialization = new Map(claim.numeric_refs.map((ref) => [ref.materialization_id, ref]));
      for (const materializationId of claim.evidence_refs) {
        const numeric = numericByMaterialization.get(materializationId);
        await client.query(`
          INSERT INTO metric_interpretation_evidence (
            interpretation_id, materialization_id, claim_index, claim_kind,
            field, cited_numeric_value
          ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
          ON CONFLICT DO NOTHING
        `, [
          interpretationId,
          materializationId,
          claimIndex,
          claim.kind,
          numeric?.field ?? null,
          numeric?.value ?? null
        ]);
      }
    }
    await client.query(`
      INSERT INTO signal_interpretation_freshness (
        workspace_id, metric_group_key, filters_hash, data_scope,
        data_watermark_hash, interpretation_watermark_hash,
        state, reason, latest_interpretation_id, evaluated_at
      ) VALUES (
        $1::uuid, $2, $3, $4::jsonb, $5, $6, $7, $8, $9::uuid, now()
      )
      ON CONFLICT (workspace_id, metric_group_key, filters_hash) DO UPDATE SET
        data_scope = EXCLUDED.data_scope,
        data_watermark_hash = EXCLUDED.data_watermark_hash,
        interpretation_watermark_hash = EXCLUDED.interpretation_watermark_hash,
        state = EXCLUDED.state, reason = EXCLUDED.reason,
        latest_interpretation_id = EXCLUDED.latest_interpretation_id,
        evaluated_at = now(), updated_at = now()
    `, [
      data.workspace_id,
      data.metric_group_key,
      data.filters_hash,
      JSON.stringify(packet.data_scope),
      data.data_watermark_hash,
      packetHash,
      status,
      execution.fallback_reason,
      interpretationId
    ]);
    await client.query(`
      UPDATE metric_interpretation_runs
      SET status = $2, attempt = $3, actual_cost_usd = $4,
        input_tokens = $5, output_tokens = $6, fallback_reason = $7,
        completed_at = now(), updated_at = now()
      WHERE id = $1::uuid
    `, [
      run.rows[0]!.id,
      execution.source === "claude" ? "completed" : "skipped",
      execution.attempts,
      execution.cost_usd,
      execution.input_tokens,
      execution.output_tokens,
      execution.fallback_reason
    ]);
    await client.query("COMMIT");
    return {
      run_id: run.rows[0]!.id,
      interpretation_id: interpretationId,
      source: execution.source,
      state: status,
      cost_usd: execution.cost_usd
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function runClaudeMetricInterpretation(
  packet: ReturnType<typeof buildSignalMetricPacketV1>,
  model: string
) {
  const result = await generateObject({
    model: anthropic(model),
    schema: interpretationSchema,
    temperature: 0,
    maxRetries: 0,
    prompt: [
      "Interpreta exclusivamente el packet JSON.",
      "No calcules métricas ni inventes números.",
      "Mantén summary, claim.text, limitations y uncertainty completamente cualitativos: no escribas dígitos, porcentajes, fechas ni ordinales.",
      "Usa numeric_refs para anclar evidencia cuantitativa sin repetir esas cifras en el texto.",
      "Cada numeric_ref debe copiar exactamente materialization_id, field y value del packet.",
      "Distingue fact, hypothesis, causal_claim y recommendation.",
      "Toda hypothesis o causal_claim declara uncertainty.",
      "Causalidad, hipótesis y recomendaciones requieren review_status=needs_review.",
      JSON.stringify(packet)
    ].join("\n")
  });
  const inputTokens = positiveTokenInteger(result.usage.inputTokens);
  const outputTokens = positiveTokenInteger(result.usage.outputTokens);
  return {
    interpretation: result.object as SignalMetricInterpretationV1,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: estimateModelCostUsd({
      provider: "anthropic",
      model,
      inputTokens,
      outputTokens
    }) ?? Number.POSITIVE_INFINITY
  };
}

function isSignalInterpretationLlmEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.NOISIA_SIGNAL_INTERPRETATIONS_ENABLED === "true"
    && env.NOISIA_SIGNAL_INTERPRETATIONS_LLM_ENABLED === "true"
    && Boolean(env.ANTHROPIC_API_KEY);
}

function estimatePacketCost(packet: ReturnType<typeof buildSignalMetricPacketV1>) {
  const estimatedInputTokens = Math.ceil(JSON.stringify(packet).length / 4);
  return estimateModelCostUsd({
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    inputTokens: estimatedInputTokens,
    outputTokens: 1200
  }) ?? 1;
}

function claimsOf(interpretation: SignalMetricInterpretationV1, kind: SignalMetricInterpretationV1["claims"][number]["kind"]) {
  return interpretation.claims.filter((claim) => claim.kind === kind);
}

function interpretationState(interpretation: SignalMetricInterpretationV1) {
  if (interpretation.claims.length === 0) return "not_available";
  if (interpretation.review_status === "needs_review") return "partial";
  return "fresh";
}
