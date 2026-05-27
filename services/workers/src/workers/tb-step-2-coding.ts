import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type { Job } from "bullmq";

import {
  buildCodingPrompt,
  normalizeTag,
  parseCodingResponse,
  TB_CODING_SAMPLES_PER_TAG,
  TB_CODING_TOP_TAGS,
  type CodedTag,
  type CodingTagInput,
  type TbCodingPolarity,
  type TbLayer
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

type Step1TagRow = { tag: string; count: number; sample_mention_ids: string[] };

/**
 * Step 2 — Codificación 4 layers.
 * Spec §5.3: every mention gets polarity + layer. Doing this per-mention with
 * 1,500+ Claude calls would be slow and expensive. Smarter approach:
 *
 *   1. Pull the top N emergent tags from step 1's result_summary.
 *   2. For each tag, load 2 sample verbatims so Claude can ground its coding.
 *   3. ONE Claude call codes the whole tag vocabulary at once.
 *   4. SQL: propagate each tag's polarity/layer back to every tb_mention_codings
 *      row whose emergent_tags contains it. Conflicts → ambiguous=true.
 *
 * Total: 1 Claude call + a handful of SQL UPDATEs. Runs in ~10-20s vs minutes.
 */
export async function tbStep2CodingJob(job: Job<StepJobData>) {
  const { tbAnalysisId, pipelineStepId } = job.data;
  await markStepRunning(pipelineStepId);
  await job.updateProgress(5);

  try {
    const ctx = await loadCtx(tbAnalysisId);
    await job.updateProgress(15);

    // Pull step 1's result_summary to get the tag vocabulary
    const step1 = await pool.query<{ result_summary: { top_tags?: Step1TagRow[] } }>(
      `SELECT result_summary FROM tb_pipeline_steps
       WHERE tb_analysis_id = $1 AND step = 'step1_open_pass' AND status = 'completed'
       ORDER BY created_at DESC LIMIT 1`,
      [tbAnalysisId]
    );
    const topTagsRaw = step1.rows[0]?.result_summary?.top_tags ?? [];
    if (topTagsRaw.length === 0) {
      throw new Error("Step 1 no produjo tags — no se puede ejecutar step 2");
    }

    // Take the top N (skip 'irrelevant' which we handle by absence)
    const topTags = topTagsRaw.filter((t) => t.tag !== "irrelevant").slice(0, TB_CODING_TOP_TAGS);
    console.log(`[tb-step2] coding ${topTags.length} top tags from step 1`);
    await job.updateProgress(25);

    // Load 2 sample verbatims per tag
    const tagInputs = await loadTagSamples(topTags);
    await job.updateProgress(40);

    // Single Claude call to code the whole vocabulary
    const model = process.env.ANTHROPIC_MODEL_DEFAULT ?? "claude-sonnet-4-6";
    const prompt = buildCodingPrompt({
      brandName: ctx.brand_display_name ?? ctx.brand_name ?? "Marca",
      industry: ctx.brand_industry,
      businessQuestion: ctx.business_question,
      tags: tagInputs
    });

    let coding;
    try {
      const r = await generateText({ model: anthropic(model), prompt, temperature: 0.1 });
      console.log(`[tb-step2] response first 200: ${r.text.slice(0, 200)}`);
      coding = parseCodingResponse(r.text);
    } catch (err) {
      throw new Error(`Coding parse failed: ${err instanceof Error ? err.message : err}`);
    }

    if (coding.coded_tags.length === 0) {
      throw new Error("Claude no devolvió tags codificados");
    }
    await job.updateProgress(75);

    // Build the lookup: normalized tag → {polarity, layer, ambiguous, cluster}
    const tagMap = new Map<string, CodedTag>();
    for (const c of coding.coded_tags) {
      tagMap.set(normalizeTag(c.tag), c);
    }

    // Propagate codings to every tb_mention_codings row.
    const updateStats = await propagateCodings({ tbAnalysisId, tagMap });
    await job.updateProgress(92);

    // Persist step result summary with the coded vocabulary so step 3 can
    // cluster findings using it.
    await markStepCompleted({
      pipelineStepId,
      resultSummary: {
        coded_tags_count: coding.coded_tags.length,
        tags_received: topTags.length,
        mentions_updated: updateStats.updated,
        mentions_unmatched: updateStats.unmatched,
        mentions_ambiguous: updateStats.ambiguous,
        polarity_distribution: coding.polarity_distribution,
        layer_distribution: coding.layer_distribution,
        // Keep full coded vocab inline for step 3 (it's small — ~120 entries)
        coded_vocabulary: coding.coded_tags
      }
    });

    // Chain to step 3
    const next = await enqueueStep({ tbAnalysisId, step: "step3_hierarchy" });
    await job.updateProgress(100);

    return {
      coded_tags: coding.coded_tags.length,
      mentions_updated: updateStats.updated,
      mentions_ambiguous: updateStats.ambiguous,
      next_step_job_id: next.jobId
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[tb-step2] failed: ${msg}`);
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

async function loadTagSamples(topTags: Step1TagRow[]): Promise<CodingTagInput[]> {
  // Collect all mention ids we need to load text for
  const allIds = new Set<string>();
  for (const t of topTags) {
    for (const id of t.sample_mention_ids.slice(0, TB_CODING_SAMPLES_PER_TAG)) {
      allIds.add(id);
    }
  }
  if (allIds.size === 0) {
    return topTags.map((t) => ({ tag: t.tag, count: t.count, samples: [] }));
  }

  const ids = Array.from(allIds);
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
  const textRows = await pool.query<{ id: string; text: string }>(
    `SELECT id, COALESCE(text_snippet, LEFT(text_clean, 280)) AS text
     FROM mentions WHERE id IN (${placeholders})`,
    ids
  );
  const textById = new Map(textRows.rows.map((r) => [r.id, r.text]));

  return topTags.map((t) => ({
    tag: t.tag,
    count: t.count,
    samples: t.sample_mention_ids
      .slice(0, TB_CODING_SAMPLES_PER_TAG)
      .map((id) => textById.get(id))
      .filter((s): s is string => typeof s === "string" && s.length > 0)
  }));
}

/**
 * For every tb_mention_codings row of this analysis, look at its emergent_tags,
 * find matching coded tags, and apply the dominant polarity + layer. Conflicts
 * (two tags with different polarity) mark the row as ambiguous.
 *
 * Done in JS rather than pure SQL because each row's tags need lookup against
 * the in-memory tagMap — a SQL UPDATE per tag would be N round-trips.
 */
async function propagateCodings(args: {
  tbAnalysisId: string;
  tagMap: Map<string, CodedTag>;
}): Promise<{ updated: number; unmatched: number; ambiguous: number }> {
  const rows = await pool.query<{ id: string; emergent_tags: string[] | null }>(
    `SELECT id, emergent_tags FROM tb_mention_codings
     WHERE tb_analysis_id = $1`,
    [args.tbAnalysisId]
  );

  let updated = 0;
  let unmatched = 0;
  let ambiguousCount = 0;

  // Batch updates in chunks of 200 ids per polarity/layer combination to
  // minimize round-trips. We bucket rows by their resolved (polarity, layer,
  // ambiguous) tuple.
  type Bucket = { polarity: TbCodingPolarity; layer: TbLayer | null; ambiguous: boolean; ids: string[] };
  const buckets = new Map<string, Bucket>();

  for (const row of rows.rows) {
    const tags = (row.emergent_tags ?? []).map((t) => normalizeTag(t));
    if (tags.length === 0) {
      unmatched += 1;
      continue;
    }

    // If only tag is 'irrelevant', mark as irrelevant
    if (tags.every((t) => t === "irrelevant")) {
      const key = `irrelevant|null|false`;
      const b = buckets.get(key) ?? { polarity: "irrelevant", layer: null, ambiguous: false, ids: [] };
      b.ids.push(row.id);
      buckets.set(key, b);
      updated += 1;
      continue;
    }

    // Look up each tag in the coded vocabulary
    const matched = tags.map((t) => args.tagMap.get(t)).filter((c): c is CodedTag => !!c);
    if (matched.length === 0) {
      unmatched += 1;
      continue;
    }

    // Resolve dominant polarity: majority among matched (excluding irrelevant)
    const polarityCounts = new Map<TbCodingPolarity, number>();
    for (const m of matched) {
      if (m.polarity === "irrelevant") continue;
      polarityCounts.set(m.polarity, (polarityCounts.get(m.polarity) ?? 0) + 1);
    }
    if (polarityCounts.size === 0) {
      // All matched tags were irrelevant
      const key = `irrelevant|null|false`;
      const b = buckets.get(key) ?? { polarity: "irrelevant", layer: null, ambiguous: false, ids: [] };
      b.ids.push(row.id);
      buckets.set(key, b);
      updated += 1;
      continue;
    }

    // Pick majority polarity (ties: prefer barrier > trigger > mixed)
    const orderedPolarities: TbCodingPolarity[] = ["barrier", "trigger", "mixed"];
    let dominantPolarity: TbCodingPolarity = "mixed";
    let maxCount = -1;
    for (const p of orderedPolarities) {
      const c = polarityCounts.get(p) ?? 0;
      if (c > maxCount) {
        maxCount = c;
        dominantPolarity = p;
      }
    }

    // Same for layer (majority among matched tags that share dominant polarity)
    const layerCounts = new Map<TbLayer, number>();
    for (const m of matched) {
      if (m.polarity !== dominantPolarity || !m.layer) continue;
      layerCounts.set(m.layer, (layerCounts.get(m.layer) ?? 0) + 1);
    }
    const orderedLayers: TbLayer[] = ["personal", "psicologico", "social", "cultural"];
    let dominantLayer: TbLayer | null = null;
    let maxLayer = -1;
    for (const l of orderedLayers) {
      const c = layerCounts.get(l) ?? 0;
      if (c > maxLayer) {
        maxLayer = c;
        dominantLayer = l;
      }
    }

    // Ambiguous: more than one polarity present in the matched set, OR any
    // matched tag was marked ambiguous by Claude.
    const polaritiesPresent = new Set<TbCodingPolarity>();
    for (const m of matched) {
      if (m.polarity !== "irrelevant") polaritiesPresent.add(m.polarity);
    }
    const ambiguous = polaritiesPresent.size > 1 || matched.some((m) => m.ambiguous);
    if (ambiguous) ambiguousCount += 1;

    const key = `${dominantPolarity}|${dominantLayer ?? "null"}|${ambiguous}`;
    const b = buckets.get(key) ?? {
      polarity: dominantPolarity,
      layer: dominantLayer,
      ambiguous,
      ids: []
    };
    b.ids.push(row.id);
    buckets.set(key, b);
    updated += 1;
  }

  // Apply bucket updates
  for (const bucket of buckets.values()) {
    const CHUNK = 500;
    for (let i = 0; i < bucket.ids.length; i += CHUNK) {
      const slice = bucket.ids.slice(i, i + CHUNK);
      const placeholders = slice.map((_, idx) => `$${idx + 4}::uuid`).join(", ");
      await pool.query(
        `UPDATE tb_mention_codings
         SET polarity = $1, layer = $2, ambiguous = $3
         WHERE id IN (${placeholders})`,
        [bucket.polarity, bucket.layer, bucket.ambiguous, ...slice]
      );
    }
  }

  return { updated, unmatched, ambiguous: ambiguousCount };
}
