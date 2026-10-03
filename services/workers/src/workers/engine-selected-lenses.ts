import {
  ENGINE_PIPELINE_VERSION,
  selectedLensSlugsFromAnalysisPlan,
  engineLensParamsFromTbMeta,
  isEngineLlmEnabled,
  isEngineRuntimeEnabled,
  validateEngineQueryPackCoverage,
  type EngineQueryPackValidation
} from "@noisia/query-engine";
import { getEngineQueue } from "./engine-shared";
import { pool } from "../db/client";
import {
  resolveSelectedEngineLaunchOptions,
  isCompletedEngineAnalysisUsable,
  type SelectedEngineLaunchOptions
} from "./engine-selected-lenses-options";

type MethodologyRow = {
  slug: string;
  version: string | null;
  status: string | null;
};

type ExistingAnalysisRow = {
  methodology_slug: string;
  id: string;
  status: string;
  current_step: string;
  source_tb_analysis_id: string | null;
  retrieved_units: number;
  coding_provider: string | null;
  coding_fixture: boolean | null;
};

type QueryPackRow = {
  id: string;
  lens_slug: string;
  signal_intent: string | null;
  scope: string;
  status: string;
  mentions_returned: number | null;
  linked_mention_count: number;
  direct_mention_count: number;
  shared_mention_count: number;
};

type TbContext = {
  study_corpus_id: string;
  brand_id: string | null;
  theme_id: string | null;
  base_corpus_id: string | null;
  business_question: string | null;
  executed_by_user_id: string | null;
  analysis_plan: unknown;
  meta_json: unknown;
};

type LensLaunchRecord = {
  methodology_slug: string;
  status: "created" | "skipped" | "blocked";
  engine_analysis_id?: string;
  job_id?: string;
  reason?: string;
  missing_scopes?: string[];
  coverage_status?: EngineQueryPackValidation["status"];
  coverage_summary?: EngineQueryPackValidation["summary"];
  hard_failures?: string[];
  warnings?: string[];
};

const PRIMARY_LENS = "triggers-barriers";
const activeStatuses = new Set(["queued", "running"]);
const completedStatuses = new Set(["needs_review", "approved"]);

export async function enqueueSelectedEngineLensesAfterTb(
  tbAnalysisId: string,
  options: SelectedEngineLaunchOptions = {}
) {
  const launchOptions = resolveSelectedEngineLaunchOptions(options);
  const ctx = await loadTbContext(tbAnalysisId);
  const selectedLenses = selectedLensSlugsFromAnalysisPlan(ctx.analysis_plan)
    .filter((slug) => slug !== PRIMARY_LENS);

  if (selectedLenses.length === 0) {
    const result = {
      status: "skipped",
      launch_surface: launchOptions.launchSurface,
      trigger_reason: launchOptions.triggerReason,
      reason: "study_has_no_engine_lenses",
      selected_lenses: []
    };
    await persistAutoLaunchResult(tbAnalysisId, result, launchOptions.resultMetaKey);
    return result;
  }

  if (!isEngineRuntimeEnabled()) {
    const result = {
      status: "blocked",
      launch_surface: launchOptions.launchSurface,
      trigger_reason: launchOptions.triggerReason,
      reason: "engine_runtime_disabled",
      selected_lenses: selectedLenses
    };
    await persistAutoLaunchResult(tbAnalysisId, result, launchOptions.resultMetaKey);
    return result;
  }

  if (!isEngineLlmEnabled() || !process.env.ANTHROPIC_API_KEY) {
    const result = {
      status: "blocked",
      launch_surface: launchOptions.launchSurface,
      trigger_reason: launchOptions.triggerReason,
      reason: !process.env.ANTHROPIC_API_KEY ? "anthropic_key_missing" : "engine_llm_disabled",
      selected_lenses: selectedLenses
    };
    await persistAutoLaunchResult(tbAnalysisId, result, launchOptions.resultMetaKey);
    return result;
  }

  const [methodologies, existing, queryPacks] = await Promise.all([
    loadMethodologies(selectedLenses),
    loadExistingAnalyses(ctx.study_corpus_id, selectedLenses),
    loadQueryPacks(ctx.study_corpus_id, selectedLenses)
  ]);
  const methodologyBySlug = new Map(methodologies.map((row) => [row.slug, row]));
  const existingBySlug = new Map(existing.map((row) => [row.methodology_slug, row]));
  const inheritedEngineParams = engineLensParamsFromTbMeta(ctx.meta_json);

  const created: LensLaunchRecord[] = [];
  const skipped: LensLaunchRecord[] = [];
  const blocked: LensLaunchRecord[] = [];

  const launchable: Array<{
    slug: string;
    methodology: MethodologyRow;
    coverageValidation: EngineQueryPackValidation;
  }> = [];
  for (const slug of selectedLenses) {
    const existingAnalysis = existingBySlug.get(slug);
    if (existingAnalysis && activeStatuses.has(existingAnalysis.status)) {
      skipped.push({
        methodology_slug: slug,
        status: "skipped",
        reason: `existing_${existingAnalysis.status}`,
        engine_analysis_id: existingAnalysis.id
      });
      continue;
    }
    if (
      existingAnalysis &&
      completedStatuses.has(existingAnalysis.status) &&
      existingAnalysis.source_tb_analysis_id === tbAnalysisId &&
      isCompletedEngineAnalysisUsable(existingAnalysis)
    ) {
      skipped.push({
        methodology_slug: slug,
        status: "skipped",
        reason: `existing_${existingAnalysis.status}`,
        engine_analysis_id: existingAnalysis.id
      });
      continue;
    }

    const methodology = methodologyBySlug.get(slug);
    if (!methodology || methodology.status !== "beta") {
      blocked.push({
        methodology_slug: slug,
        status: "blocked",
        reason: methodology ? `methodology_status_${methodology.status ?? "missing"}` : "methodology_not_seeded"
      });
      continue;
    }

    const coverageValidation = validateEngineQueryPackCoverage(slug, {
      brandId: ctx.brand_id,
      themeId: ctx.theme_id,
      baseCorpusId: ctx.base_corpus_id,
      queryPacks: queryPacks.map((pack) => ({
        id: pack.id,
        lensSlug: pack.lens_slug,
        signalIntent: pack.signal_intent,
        scope: pack.scope,
        status: pack.status,
        mentionsReturned: pack.mentions_returned,
        linkedMentionCount: pack.linked_mention_count,
        directMentionCount: pack.direct_mention_count,
        sharedMentionCount: pack.shared_mention_count
      }))
    });

    if (!coverageValidation.ok) {
      blocked.push({
        methodology_slug: slug,
        status: "blocked",
        reason: "query_pack_coverage_blocked",
        missing_scopes: coverageValidation.summary.missingScopes,
        coverage_status: coverageValidation.status,
        coverage_summary: coverageValidation.summary,
        hard_failures: coverageValidation.hardFailures,
        warnings: coverageValidation.warnings
      });
      continue;
    }

    launchable.push({ slug, methodology, coverageValidation });
  }

  const snapshot = launchable.length > 0
    ? await createSnapshot(ctx.study_corpus_id, ctx.executed_by_user_id)
    : null;
  const queue = launchable.length > 0 ? getEngineQueue() : null;

  for (const item of launchable) {
    const [analysis] = (
      await pool.query<{ id: string }>(
        `INSERT INTO engine_analyses (
           study_corpus_id,
           snapshot_id,
           methodology_slug,
           methodology_version,
           pipeline_version,
           status,
           current_step,
           business_question,
           params,
           meta_json,
           executed_by_user_id
         )
         VALUES ($1, $2, $3, $4, $5, 'queued', 'preflight', $6, $7::jsonb, $8::jsonb, $9)
         RETURNING id`,
        [
          ctx.study_corpus_id,
          snapshot?.id ?? null,
          item.slug,
          item.methodology.version ?? "0.1",
          ENGINE_PIPELINE_VERSION,
          ctx.business_question,
          JSON.stringify({
            launch_surface: launchOptions.launchSurface,
            source_tb_analysis_id: tbAnalysisId,
            trigger_reason: launchOptions.triggerReason,
            query_pack_coverage_status: item.coverageValidation.status,
            query_pack_coverage_warnings: item.coverageValidation.warnings,
            ...inheritedEngineParams
          }),
          JSON.stringify({
            launch: {
              source: launchOptions.launchSurface,
              source_tb_analysis_id: tbAnalysisId,
              trigger_reason: launchOptions.triggerReason,
              selected_lenses_batch: selectedLenses,
              snapshot_mentions: snapshot?.mention_count ?? null,
              inherited_engine_params: inheritedEngineParams,
              query_pack_coverage_validation: item.coverageValidation
            }
          }),
          ctx.executed_by_user_id
        ]
      )
    ).rows;
    if (!analysis) continue;
    const job = await queue?.add(
      "engine_run_analysis",
      { engineAnalysisId: analysis.id },
      { attempts: 1, removeOnComplete: { age: 60 * 60 * 24 } }
    );
    created.push({
      methodology_slug: item.slug,
      status: "created",
      engine_analysis_id: analysis.id,
      job_id: job?.id ? String(job.id) : undefined,
      coverage_status: item.coverageValidation.status,
      coverage_summary: item.coverageValidation.summary,
      warnings: item.coverageValidation.warnings
    });
  }

  const result = {
    status: created.length > 0 ? "created" : blocked.length > 0 ? "blocked" : "skipped",
    launch_surface: launchOptions.launchSurface,
    trigger_reason: launchOptions.triggerReason,
    selected_lenses: selectedLenses,
    snapshot_id: snapshot?.id ?? null,
    created,
    skipped,
    blocked
  };
  await persistAutoLaunchResult(tbAnalysisId, result, launchOptions.resultMetaKey);
  return result;
}

async function loadTbContext(tbAnalysisId: string): Promise<TbContext> {
  const result = await pool.query<TbContext>(
    `SELECT
       ta.study_corpus_id,
       sc.brand_id,
       sc.theme_id,
       sc.base_corpus_id,
       COALESCE(ta.business_question, sc.business_question) AS business_question,
       ta.executed_by_user_id,
       sc.analysis_plan,
       ta.meta_json
     FROM tb_analyses ta
     JOIN study_corpora sc ON sc.id = ta.study_corpus_id
     WHERE ta.id = $1`,
    [tbAnalysisId]
  );
  const row = result.rows[0];
  if (!row) throw new Error(`tb_analyses ${tbAnalysisId} not found`);
  return row;
}

async function loadMethodologies(slugs: string[]): Promise<MethodologyRow[]> {
  const result = await pool.query<MethodologyRow>(
    `SELECT DISTINCT ON (slug) slug, version, status
     FROM methodologies
     WHERE slug = ANY($1::text[])
     ORDER BY slug, version DESC`,
    [slugs]
  );
  return result.rows;
}

async function loadExistingAnalyses(corpusId: string, slugs: string[]): Promise<ExistingAnalysisRow[]> {
  const result = await pool.query<ExistingAnalysisRow>(
    `SELECT DISTINCT ON (methodology_slug)
	       methodology_slug,
	       id,
	       status,
	       current_step,
	       COALESCE(params->>'source_tb_analysis_id', meta_json->'launch'->>'source_tb_analysis_id') AS source_tb_analysis_id,
	       COALESCE((meta_json->'retrieval'->>'retrieved_units')::int, 0) AS retrieved_units,
	       meta_json->'engine_coding'->>'provider' AS coding_provider,
	       CASE
	         WHEN meta_json->'engine_coding' ? 'fixture'
	         THEN (meta_json->'engine_coding'->>'fixture')::boolean
	         ELSE NULL
	       END AS coding_fixture
	     FROM engine_analyses
     WHERE study_corpus_id = $1
       AND methodology_slug = ANY($2::text[])
     ORDER BY methodology_slug, created_at DESC`,
    [corpusId, slugs]
  );
  return result.rows;
}

async function loadQueryPacks(corpusId: string, slugs: string[]): Promise<QueryPackRow[]> {
  const result = await pool.query<QueryPackRow>(
    `SELECT
       qp.id::text,
       qp.lens_slug,
       qp.signal_intent,
       qp.scope,
       qp.status,
       qp.mentions_returned,
       COUNT(DISTINCT mqs.mention_id) FILTER (WHERE m.inclusion_status = 'included')::int AS linked_mention_count,
       COUNT(DISTINCT mqs.mention_id) FILTER (WHERE mqs.match_reason = 'csv_import_batch' AND m.inclusion_status = 'included')::int AS direct_mention_count,
       COUNT(DISTINCT mqs.mention_id) FILTER (WHERE COALESCE(mqs.match_reason, '') <> 'csv_import_batch' AND m.inclusion_status = 'included')::int AS shared_mention_count
     FROM query_packs qp
     LEFT JOIN mention_query_sources mqs ON mqs.query_pack_id = qp.id
     LEFT JOIN mentions m ON m.id = mqs.mention_id
     WHERE qp.study_corpus_id = $1
       AND qp.lens_slug = ANY($2::text[])
     GROUP BY qp.id`,
    [corpusId, slugs]
  );
  return result.rows;
}

async function createSnapshot(corpusId: string, userId: string | null) {
  const [snapshot] = (
    await pool.query<{ id: string }>(
      `INSERT INTO corpus_snapshots (study_corpus_id, label, kind, mention_count, created_by_user_id)
       VALUES ($1, $2, 'manual', 0, $3)
       RETURNING id`,
      [
        corpusId,
        `Pre-engine selected lenses · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
        userId
      ]
    )
  ).rows;
  if (!snapshot) throw new Error("Could not create engine snapshot");

  const countResult = await pool.query<{ mention_count: number }>(
    `WITH inserted AS (
       INSERT INTO corpus_snapshot_mentions (snapshot_id, mention_id)
       SELECT $1::uuid, id
       FROM mentions
       WHERE study_corpus_id = $2::uuid
         AND inclusion_status = 'included'
       ON CONFLICT DO NOTHING
       RETURNING mention_id
     )
     SELECT COUNT(*)::int AS mention_count FROM inserted`,
    [snapshot.id, corpusId]
  );
  const mentionCount = countResult.rows[0]?.mention_count ?? 0;
  await pool.query(
    `UPDATE corpus_snapshots SET mention_count = $1 WHERE id = $2`,
    [mentionCount, snapshot.id]
  );

  return { id: snapshot.id, mention_count: mentionCount };
}

async function persistAutoLaunchResult(tbAnalysisId: string, result: unknown, resultMetaKey: string) {
  await pool.query(
    `UPDATE tb_analyses
     SET meta_json = COALESCE(meta_json, '{}'::jsonb) || $1::jsonb,
         updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify({ [resultMetaKey]: result }), tbAnalysisId]
  );
}
