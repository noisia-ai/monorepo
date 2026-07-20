import {
  buildLensQueryPacks,
  type ComposedQuery,
  type QueryComposerInput
} from "@noisia/query-engine";

import { pool } from "../db/client";

export async function materializeQueryPacksForIteration(params: {
  corpusId: string;
  queryIterationId: string;
  input: QueryComposerInput;
  composed: ComposedQuery;
  requestedByUserId: string;
}) {
  const analysisPlan = await loadAnalysisPlan(params.corpusId);
  const packs = buildLensQueryPacks({
    input: params.input,
    composed: params.composed,
    analysisPlan
  });
  if (packs.length === 0) {
    return { planned_packs: 0 };
  }

  for (const pack of packs) {
    await pool.query(
      `
        INSERT INTO query_packs (
          study_corpus_id,
          query_iteration_id,
          lens_slug,
          signal_intent,
          scope,
          entity_key,
          objective,
          query_text,
          query_components,
          seeds,
          evaluation,
          status,
          cost_budget,
          created_by_user_id
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9::jsonb,
          $10::jsonb,
          $11::jsonb,
          $12,
          $13::jsonb,
          $14::uuid
        )
        ON CONFLICT (
          study_corpus_id,
          (COALESCE(query_iteration_id::text, '')),
          lens_slug,
          signal_intent,
          scope,
          (COALESCE(entity_key, ''))
        )
        DO UPDATE SET
          objective = EXCLUDED.objective,
          query_text = EXCLUDED.query_text,
          query_components = EXCLUDED.query_components,
          seeds = EXCLUDED.seeds,
          evaluation = query_packs.evaluation || EXCLUDED.evaluation,
          status = CASE
            WHEN query_packs.status IN ('imported', 'approved') THEN query_packs.status
            ELSE EXCLUDED.status
          END,
          cost_budget = EXCLUDED.cost_budget,
          updated_at = now()
      `,
      [
        params.corpusId,
        params.queryIterationId,
        pack.lensSlug,
        pack.signalIntent,
        pack.scope,
        pack.entityKey,
        pack.objective,
        pack.queryText,
        JSON.stringify(pack.queryComponents),
        JSON.stringify(pack.seeds),
        JSON.stringify(pack.evaluation),
        pack.status,
        JSON.stringify(pack.costBudget),
        params.requestedByUserId
      ]
    );
  }

  return { planned_packs: packs.length };
}

async function loadAnalysisPlan(corpusId: string) {
  const result = await pool.query<{ analysis_plan: unknown }>(
    `SELECT analysis_plan FROM study_corpora WHERE id = $1::uuid LIMIT 1`,
    [corpusId]
  );
  return result.rows[0]?.analysis_plan ?? null;
}
