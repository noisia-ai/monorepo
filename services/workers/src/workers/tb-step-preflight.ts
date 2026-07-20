import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type { Job } from "bullmq";

import {
  buildPreflightPrompt,
  parsePreflightResponse,
  type PreflightInput,
  type PreflightResult
} from "@noisia/query-engine";
import { pool } from "../db/client";
import { auditCorpusDataOs, persistCorpusDataOsAudit } from "./data-os-corpus-audit";
import { loadTbRagPromptContext } from "./tb-rag-context";
import { enqueueStep, markStepCompleted, markStepFailed, markStepRunning, releaseCorpusLock } from "./tb-shared";

type TbPreflightJobData = {
  tbAnalysisId: string;
  pipelineStepId: string;
};

type AnalysisContextRow = {
  study_corpus_id: string;
  business_question: string | null;
  brand_name: string | null;
  brand_display_name: string | null;
  target_window_months: number | null;
};

type SourceCountRow = { platform: string; count: number };
type LanguageRow = { language: string | null; count: number };

export async function tbPreflightJob(job: Job<TbPreflightJobData>) {
  const { tbAnalysisId, pipelineStepId } = job.data;
  await markStepRunning(pipelineStepId);
  await job.updateProgress(10);

  try {
    const ctx = await loadAnalysisContext(tbAnalysisId);
    const dataOsAudit = await auditCorpusDataOs({
      corpusId: ctx.study_corpus_id,
      stage: "pre_analysis",
      tbAnalysisId
    });
    await persistCorpusDataOsAudit({ tbAnalysisId, audit: dataOsAudit });
    await replaceLimitations(
      tbAnalysisId,
      "data_os_preflight",
      dataOsAudit.warnings.map((warning) => `${warning.code}: ${warning.message}`)
    );

    if (!dataOsAudit.ready_for_claude) {
      const blockers = dataOsAudit.blockers.map((blocker) => `${blocker.code}: ${blocker.message}`);
      await markStepCompleted({
        pipelineStepId,
        resultSummary: {
          decision: "ABORTAR_DATA_OS",
          claude_called: false,
          data_os_contract: dataOsAudit.contract,
          data_os_status: dataOsAudit.status,
          blockers,
          warnings: dataOsAudit.warnings
        }
      });
      await abortAnalysis({
        tbAnalysisId,
        prefix: "Data OS",
        blockers
      });
      await releaseCorpusLock(tbAnalysisId);
      await job.updateProgress(100);
      return {
        decision: "ABORTAR_DATA_OS",
        claude_called: false,
        blockers: dataOsAudit.blockers
      };
    }

    await job.updateProgress(20);
    const ragContext = await loadTbRagPromptContext(tbAnalysisId);
    await job.updateProgress(25);

    // Build the input from the corpus snapshot — for now we just sample the
    // current 'included' set. The snapshot table contains the exact mention
    // ids so future iterations can re-run preflight against historical state.
    const input = {
      ...(await buildPreflightInput(ctx)),
      ragContext
    };
    await job.updateProgress(45);

    const model = process.env.ANTHROPIC_MODEL_DEFAULT ?? "claude-sonnet-4-6";
    const prompt = buildPreflightPrompt(input);

    let result: PreflightResult;
    try {
      const r = await generateText({ model: anthropic(model), prompt, temperature: 0.1 });
      console.log(`[tb-preflight] response first 240: ${r.text.slice(0, 240)}`);
      result = parsePreflightResponse(r.text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Preflight parse failed: ${msg}`);
    }

    await job.updateProgress(80);

    // Persist each check as a quality_gate row so the review UI can show them.
    // We map the tri-state result (PASS|WARN|FAIL) into the boolean `passed`
    // column with a prefix in `notes` so the UI can render the three states.
    for (const check of result.checks) {
      const passed = check.result !== "FAIL"; // WARN counts as passed-with-caveat
      const prefix = check.result === "PASS" ? "" : `${check.result}: `;
      await pool.query(
        `INSERT INTO tb_quality_gates (tb_analysis_id, gate_name, passed, notes)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tb_analysis_id, gate_name)
         DO UPDATE SET passed = EXCLUDED.passed, notes = EXCLUDED.notes, checked_at = NOW()`,
        [tbAnalysisId, `preflight_${check.id}`, passed, `${prefix}${check.reason}`.slice(0, 500)]
      );
    }

    await markStepCompleted({
      pipelineStepId,
      resultSummary: {
        decision: result.decision,
        claude_called: true,
        data_os_contract: dataOsAudit.contract,
        data_os_status: dataOsAudit.status,
        passed: result.checks.filter((c) => c.result === "PASS").length,
        warned: result.checks.filter((c) => c.result === "WARN").length,
        failed: result.checks.filter((c) => c.result === "FAIL").length,
        blockers: result.blockers,
        warnings: result.warnings
      }
    });

    if (result.decision === "ABORTAR") {
      // Hard abort. The UI shows the failed gates + reasons so the IM can fix
      // the corpus and re-run.
      await replaceLimitations(tbAnalysisId, "preflight", result.warnings);
      await abortAnalysis({ tbAnalysisId, prefix: "Preflight", blockers: result.blockers });
      await releaseCorpusLock(tbAnalysisId);
      await job.updateProgress(100);
      return { decision: "ABORTAR", blockers: result.blockers };
    }

    // Replace warnings from this origin so retries cannot duplicate caveats.
    await replaceLimitations(tbAnalysisId, "preflight", result.warnings);

    // PROCEDER or PROCEDER_WITH_WARNINGS → enqueue step 1
    const next = await enqueueStep({ tbAnalysisId, step: "step1_open_pass" });
    await job.updateProgress(100);

    return {
      decision: result.decision,
      warnings_count: result.warnings.length,
      next_step_job_id: next.jobId,
      next_step_pipeline_id: next.pipelineStepId
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[tb-preflight] failed: ${msg}`);
    await markStepFailed({ pipelineStepId, errorMessage: msg });
    await releaseCorpusLock(tbAnalysisId);
    throw err;
  }
}

async function replaceLimitations(
  tbAnalysisId: string,
  source: string,
  messages: string[]
): Promise<void> {
  const entries = messages.map((text) => ({ source, text }));
  await pool.query(
    `UPDATE tb_analyses
     SET limitations = COALESCE(
           (
             SELECT jsonb_agg(item)
             FROM jsonb_array_elements(
               CASE
                 WHEN jsonb_typeof(COALESCE(limitations, '[]'::jsonb)) = 'array'
                   THEN COALESCE(limitations, '[]'::jsonb)
                 ELSE '[]'::jsonb
               END
             ) AS item
             WHERE item->>'source' <> $2
           ),
           '[]'::jsonb
         ) || $3::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [tbAnalysisId, source, JSON.stringify(entries)]
  );
}

async function abortAnalysis(args: {
  tbAnalysisId: string;
  prefix: string;
  blockers: string[];
}): Promise<void> {
  const reason = `${args.prefix}: ${args.blockers.join(" | ").slice(0, 480) || "checks failed"}`;
  await pool.query(
    `UPDATE tb_analyses
     SET status = 'aborted_preflight',
         failed_at = NOW(),
         failure_reason = $1,
         updated_at = NOW()
     WHERE id = $2`,
    [reason, args.tbAnalysisId]
  );
}

async function loadAnalysisContext(tbAnalysisId: string): Promise<AnalysisContextRow> {
  const r = await pool.query<AnalysisContextRow>(
    `SELECT
       sc.id AS study_corpus_id,
       sc.business_question,
       b.name AS brand_name,
       b.display_name AS brand_display_name,
       sc.target_window_months
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

async function buildPreflightInput(ctx: AnalysisContextRow): Promise<PreflightInput> {
  const totalRow = await pool.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM mentions
     WHERE study_corpus_id = $1 AND inclusion_status = 'included'`,
    [ctx.study_corpus_id]
  );
  const total = totalRow.rows[0]?.total ?? 0;

  const sourcesRows = await pool.query<SourceCountRow>(
    `SELECT platform, COUNT(*)::int AS count FROM mentions
     WHERE study_corpus_id = $1 AND inclusion_status = 'included'
     GROUP BY platform
     ORDER BY count DESC`,
    [ctx.study_corpus_id]
  );
  const sources = sourcesRows.rows.map((s) => ({
    name: s.platform,
    count: s.count,
    pct: total > 0 ? (s.count / total) * 100 : 0
  }));

  const langRows = await pool.query<LanguageRow>(
    `SELECT language, COUNT(*)::int AS count FROM mentions
     WHERE study_corpus_id = $1 AND inclusion_status = 'included'
     GROUP BY language
     ORDER BY count DESC LIMIT 6`,
    [ctx.study_corpus_id]
  );
  const languageDistribution = langRows.rows.map((l) => ({
    lang: l.language ?? "unk",
    pct: total > 0 ? (l.count / total) * 100 : 0
  }));

  return {
    brandName: ctx.brand_display_name ?? ctx.brand_name ?? "Marca",
    businessQuestion: ctx.business_question,
    totalMentions: total,
    sources,
    windowMonths: ctx.target_window_months,
    languageDistribution
  };
}
