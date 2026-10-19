import { resolve } from "node:path";
import dotenv from "dotenv";

import type { TbStepName } from "@noisia/query-engine";

const repoRoot = resolve(import.meta.dirname, "../../..");
const workerRoot = resolve(import.meta.dirname, "..");

dotenv.config({ path: resolve(repoRoot, "apps/studio/.env.local"), override: true });
dotenv.config({ path: resolve(workerRoot, ".env"), override: true });

const analysisId = argValue("--analysis-id");
const resumeStep = argValue("--step") as TbStepName | undefined;
const resumableSteps = new Set<TbStepName>([
  "step3_hierarchy",
  "step4_mobility",
  "step5_comparative",
  "step6_synthesis",
  "quality_gates"
]);

if (!analysisId || !resumeStep || !resumableSteps.has(resumeStep)) {
  throw new Error(
    "Usage: pnpm exec tsx scripts/resume-tb-analysis.mts " +
      "--analysis-id=<uuid> --step=<step3_hierarchy|step4_mobility|step5_comparative|step6_synthesis|quality_gates>"
  );
}

const { pool } = await import("../src/db/client.ts");
const { enqueueStep, getTbQueue } = await import("../src/workers/tb-shared.ts");
const { redisConnection } = await import("../src/queues/query-engine.ts");

type AnalysisRow = {
  id: string;
  study_corpus_id: string;
  status: string;
  current_step: string;
  failure_reason: string | null;
  failed_at: Date | null;
  locked_by_analysis_id: string | null;
  codings: number;
  findings: number;
  next_attempt: number;
};

let original: AnalysisRow | null = null;

try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    original = (
      await client.query<AnalysisRow>(
        `SELECT
           analysis.id,
           analysis.study_corpus_id,
           analysis.status,
           analysis.current_step,
           analysis.failure_reason,
           analysis.failed_at,
           corpus.locked_by_analysis_id,
           (SELECT COUNT(*)::int FROM tb_mention_codings coding WHERE coding.tb_analysis_id = analysis.id) AS codings,
           (SELECT COUNT(*)::int FROM tb_findings finding WHERE finding.tb_analysis_id = analysis.id) AS findings,
           (
             SELECT COALESCE(MAX(step.attempt), 0)::int + 1
             FROM tb_pipeline_steps step
             WHERE step.tb_analysis_id = analysis.id AND step.step = $2
           ) AS next_attempt
         FROM tb_analyses analysis
         JOIN study_corpora corpus ON corpus.id = analysis.study_corpus_id
         WHERE analysis.id = $1
         FOR UPDATE OF analysis, corpus`,
        [analysisId, resumeStep]
      )
    ).rows[0] ?? null;

    if (!original) throw new Error(`T&B analysis ${analysisId} not found.`);
    if (original.status !== "failed" && original.status !== "aborted_preflight") {
      throw new Error(`Analysis must be failed before resume; current status=${original.status}.`);
    }
    if (original.locked_by_analysis_id && original.locked_by_analysis_id !== analysisId) {
      throw new Error(`Corpus is locked by another analysis: ${original.locked_by_analysis_id}.`);
    }
    if (original.codings === 0 || original.findings === 0) {
      throw new Error("Persisted codings/findings are missing; refusing a partial resume.");
    }

    await client.query(
      `UPDATE study_corpora SET locked_by_analysis_id = $1 WHERE id = $2`,
      [analysisId, original.study_corpus_id]
    );
    await client.query(
      `UPDATE tb_analyses
       SET status = 'running',
           current_step = $2,
           failure_reason = NULL,
           failed_at = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [analysisId, resumeStep]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const queued = await enqueueStep({
    tbAnalysisId: analysisId,
    step: resumeStep,
    attempt: original.next_attempt
  });
  console.log(
    `[resume] analysis=${analysisId} step=${resumeStep} attempt=${original.next_attempt} ` +
      `codings=${original.codings} findings=${original.findings} job=${queued.jobId}`
  );
} catch (error) {
  if (original) {
    await pool.query(
      `UPDATE tb_analyses
       SET status = $2,
           current_step = $3,
           failure_reason = $4,
           failed_at = $5,
           updated_at = NOW()
       WHERE id = $1`,
      [
        original.id,
        original.status,
        original.current_step,
        original.failure_reason,
        original.failed_at
      ]
    );
    await pool.query(
      `UPDATE study_corpora
       SET locked_by_analysis_id = $2
       WHERE id = $1 AND locked_by_analysis_id = $3`,
      [original.study_corpus_id, original.locked_by_analysis_id, original.id]
    );
  }
  throw error;
} finally {
  await getTbQueue().close();
  await redisConnection.quit();
  await pool.end();
}

function argValue(name: string) {
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}
