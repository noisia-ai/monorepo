import "../src/env/load";

import { requireSafeDatabaseWriteTarget } from "../../../infrastructure/db/seeds/connection";
import { pool } from "../src/db/client";
import { auditCorpusDataOs } from "../src/workers/data-os-corpus-audit";
import { reconcileListeningDataOs } from "../src/workers/listening-data-os";
import { rematerializeOneSource } from "../src/workers/process-knowledge-sources";
import { materializeTbCodingDataOs } from "../src/workers/tb-data-os-bridge";

type SourceRow = {
  id: string;
  title: string;
};

type CodingAnalysisRow = {
  id: string;
  codings: number;
};

type SourceOutcome = {
  title: string;
  ok: boolean;
  observation_count?: number;
  upserted_observation_count?: number;
  metric_keys?: string[];
  period_start?: string | null;
  period_end?: string | null;
  truncated_datasets?: unknown[];
  error?: string;
};

async function main() {
  const corpusId = process.env.NOISIA_DATA_OS_RECONCILE_CORPUS_ID?.trim();
  if (!corpusId) {
    throw new Error("NOISIA_DATA_OS_RECONCILE_CORPUS_ID is required.");
  }
  if (process.env.NOISIA_DATA_OS_RECONCILE_APPROVED !== "true") {
    throw new Error("Set NOISIA_DATA_OS_RECONCILE_APPROVED=true after reviewing the target corpus.");
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  requireSafeDatabaseWriteTarget(databaseUrl, {
    operation: "data-os:reconcile-sources",
    allowRemoteEnv: "NOISIA_DATA_OS_RECONCILE_ALLOW_REMOTE"
  });

  const sourceResult = await pool.query<SourceRow>(
    `
      SELECT id, title
      FROM brand_knowledge_sources
      WHERE study_corpus_id = $1
        AND storage_path IS NOT NULL
      ORDER BY created_at, id
    `,
    [corpusId]
  );

  const outcomes: SourceOutcome[] = [];
  for (const source of sourceResult.rows) {
    try {
      const materialization = await rematerializeOneSource(source.id, corpusId);
      outcomes.push({
        title: source.title,
        ok: true,
        observation_count: materialization.observation_count,
        upserted_observation_count: materialization.upserted_observation_count,
        metric_keys: materialization.metric_keys,
        period_start: materialization.period_start,
        period_end: materialization.period_end,
        truncated_datasets: materialization.truncated_datasets
      });
    } catch (error) {
      outcomes.push({
        title: source.title,
        ok: false,
        error: sanitizeError(error)
      });
    }
  }

  const listening = await reconcileListeningDataOs({ corpusId });
  const codingAnalysis = await findLatestCodedAnalysis(corpusId);
  const bridge = codingAnalysis
    ? await materializeTbCodingDataOs({
        tbAnalysisId: codingAnalysis.id,
        stage: "reconcile"
      })
    : null;

  await analyzeDataOsTables();

  const audit = await auditCorpusDataOs({
    corpusId,
    stage: bridge ? "post_coding" : "pre_analysis",
    tbAnalysisId: codingAnalysis?.id ?? null
  });
  const failed = outcomes.filter((outcome) => outcome.ok === false);
  console.log(JSON.stringify({
    ok: failed.length === 0 && audit.ready_for_claude,
    sources_total: outcomes.length,
    sources_reconciled: outcomes.length - failed.length,
    sources_failed: failed.length,
    source_outcomes: outcomes,
    listening: {
      quality: listening.quality,
      counts: listening.counts,
      coverage: listening.coverage,
      capabilities: listening.capabilities
    },
    tb_bridge: bridge
      ? {
          stage: bridge.stage,
          counts: bridge.counts,
          quality: bridge.quality
        }
      : {
          stage: "not_applicable",
          reason: "No T&B mention codings exist yet. The bridge will be required after coding."
        },
    audit
  }, null, 2));
  if (failed.length > 0 || !audit.ready_for_claude) process.exitCode = 1;
}

async function findLatestCodedAnalysis(corpusId: string): Promise<CodingAnalysisRow | null> {
  const result = await pool.query<CodingAnalysisRow>(
    `SELECT ta.id, COUNT(coding.id)::int AS codings
     FROM tb_analyses ta
     JOIN tb_mention_codings coding ON coding.tb_analysis_id = ta.id
     WHERE ta.study_corpus_id = $1::uuid
     GROUP BY ta.id, ta.created_at
     HAVING COUNT(coding.id) > 0
     ORDER BY ta.created_at DESC
     LIMIT 1`,
    [corpusId]
  );
  return result.rows[0] ?? null;
}

async function analyzeDataOsTables(): Promise<void> {
  await pool.query(
    `ANALYZE mentions, data_sources, data_assets, data_observations,
             data_quality_results, lineage_edges, record_tags, record_feature_values`
  );
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
    "[internal-id]"
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
