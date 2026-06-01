import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type { Job } from "bullmq";

import {
  buildOpenPassPrompt,
  normalizeTag,
  parseOpenPassResponse,
  TB_OPEN_PASS_BATCH_SIZE,
  TB_OPEN_PASS_MAX_SAMPLE,
  type OpenPassMentionInput
} from "@noisia/query-engine";
import { pool } from "../db/client";
import { detectTbOutputLanguage } from "./tb-language";
import { loadTbRagPromptContext } from "./tb-rag-context";
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

type AnalysisContextRow = {
  study_corpus_id: string;
  snapshot_id: string;
  business_question: string | null;
  brand_name: string | null;
  brand_display_name: string | null;
  brand_industry: string | null;
  meta_json: {
    analysis_sample?: {
      target_mentions?: number;
      snapshot_mentions?: number;
      resolved_study_size?: string;
      strategy?: string;
      estimated_cost_usd?: number;
      is_auto_full?: boolean;
    };
  } | null;
};

type MentionRow = {
  id: string;
  platform: string;
  text_snippet: string | null;
  text_clean: string;
};

const BATCH_CONCURRENCY = 4;
const MIN_ROLE_SAMPLE_SHARE = 0.08;
const MIN_ROLE_SAMPLE_FLOOR = 40;
const MIN_ROLE_SAMPLE_CEILING = 500;
const LEGACY_OPEN_PASS_SAFE_MAX = 5000;

/**
 * Step 1 — Pase abierto (open pass).
 * Spec §5.2: read each mention and assign 1-3 emergent tags in the corpus's
 * own language. Writes one row per mention into tb_mention_codings with
 * polarity='mixed' (placeholder until step 2 codes it properly).
 *
 * For large corpora we work on a stratified sample (max TB_OPEN_PASS_MAX_SAMPLE)
 * to keep the run bounded; step 2 expands coverage. The aggregate of unique
 * tags + counts lands in tb_pipeline_steps.result_summary so step 2 can pick
 * up the vocabulary.
 */
export async function tbStep1OpenPassJob(job: Job<StepJobData>) {
  const { tbAnalysisId, pipelineStepId } = job.data;
  await markStepRunning(pipelineStepId);
  await job.updateProgress(5);

  try {
    const ctx = await loadAnalysisContext(tbAnalysisId);
    const outputLanguage = await detectTbOutputLanguage(tbAnalysisId);
    const ragContext = await loadTbRagPromptContext(tbAnalysisId);

    // Build a stratified sample over the snapshot's mention set, capped.
    const requestedSampleSize = resolveOpenPassSampleSize(ctx);
    const mentions = await sampleSnapshotMentions(ctx.snapshot_id, ctx.study_corpus_id, requestedSampleSize);
    if (mentions.length === 0) {
      throw new Error("Snapshot tiene 0 menciones — no se puede ejecutar open pass");
    }

    console.log(
      `[tb-step1] sampling ${mentions.length} mentions for open pass (${ctx.meta_json?.analysis_sample?.resolved_study_size ?? "legacy"})`
    );
    await job.updateProgress(15);

    // Split into batches
    const batches: OpenPassMentionInput[][] = [];
    for (let i = 0; i < mentions.length; i += TB_OPEN_PASS_BATCH_SIZE) {
      batches.push(
        mentions.slice(i, i + TB_OPEN_PASS_BATCH_SIZE).map((m) => ({
          id: m.id,
          text: m.text_snippet ?? m.text_clean.slice(0, 280),
          platform: m.platform
        }))
      );
    }

    const model = process.env.ANTHROPIC_MODEL_DEFAULT ?? "claude-sonnet-4-6";

    // Run batches in parallel with limited concurrency. We collect all the
    // per-batch results, then persist in one go.
    const allTagged: { mentionId: string; tags: string[] }[] = [];
    let batchesDone = 0;
    let batchesFailed = 0;

    for (let i = 0; i < batches.length; i += BATCH_CONCURRENCY) {
      const slice = batches.slice(i, i + BATCH_CONCURRENCY);
      const results = await Promise.allSettled(
        slice.map((batch) => processBatch({ batch, ctx, model, outputLanguage, ragContext }))
      );
      for (const r of results) {
        batchesDone += 1;
        if (r.status === "fulfilled") {
          allTagged.push(...r.value);
        } else {
          batchesFailed += 1;
          console.error(`[tb-step1] batch failed: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
        }
      }
      // Progress 15 → 85 across all batches
      const pct = 15 + Math.round((batchesDone / batches.length) * 70);
      await job.updateProgress(pct);
    }

    if (allTagged.length === 0) {
      throw new Error("Todos los lotes de open pass fallaron — abortando step 1");
    }

    console.log(
      `[tb-step1] tagged ${allTagged.length}/${mentions.length} mentions (${batchesFailed}/${batches.length} batches failed)`
    );
    await job.updateProgress(88);

    // Persist codings. Batch the inserts so we don't blow up parameters.
    await persistCodings({ tbAnalysisId, tagged: allTagged });

    await job.updateProgress(94);

    // Aggregate unique tags with counts (for step 2 to use as vocabulary)
    const tagCounts = new Map<string, { count: number; sampleIds: string[] }>();
    for (const { mentionId, tags } of allTagged) {
      for (const tag of tags) {
        const key = normalizeTag(tag);
        if (key === "irrelevant" || key.length === 0) continue;
        const entry = tagCounts.get(key) ?? { count: 0, sampleIds: [] };
        entry.count += 1;
        if (entry.sampleIds.length < 5) entry.sampleIds.push(mentionId);
        tagCounts.set(key, entry);
      }
    }

    const uniqueTags = Array.from(tagCounts.entries())
      .map(([tag, v]) => ({ tag, count: v.count, sample_mention_ids: v.sampleIds }))
      .sort((a, b) => b.count - a.count);

    const irrelevantCount = allTagged.filter((t) => t.tags.includes("irrelevant")).length;

    // Spec §5.2 success criterion: 40 ≤ unique_tags ≤ 90.
    // Out of range → record as a warning but proceed (step 2 can handle either
    // direction by grouping or by re-tagging). We don't re-loop automatically
    // to keep token cost bounded.
    let healthFlag: "ok" | "shallow" | "exploded" = "ok";
    if (uniqueTags.length < 40) healthFlag = "shallow";
    if (uniqueTags.length > 90) healthFlag = "exploded";

    if (healthFlag !== "ok") {
      const msg =
        healthFlag === "shallow"
          ? `Open pass produjo ${uniqueTags.length} tags únicos (<40 esperado). El pase puede ser superficial — el step 2 deberá expandir vocabulario.`
          : `Open pass produjo ${uniqueTags.length} tags únicos (>90 esperado). El step 2 deberá agrupar antes de codificar.`;
      await pool.query(
        `UPDATE tb_analyses
         SET limitations = COALESCE(limitations, '[]'::jsonb) || $1::jsonb
         WHERE id = $2`,
        [JSON.stringify([{ source: "step1_open_pass", text: msg }]), tbAnalysisId]
      );
    }

    await markStepCompleted({
      pipelineStepId,
      resultSummary: {
        sampled_mentions: mentions.length,
        requested_sample_size: requestedSampleSize,
        snapshot_mentions: ctx.meta_json?.analysis_sample?.snapshot_mentions ?? null,
        study_size: ctx.meta_json?.analysis_sample?.resolved_study_size ?? null,
        sampling_strategy: ctx.meta_json?.analysis_sample?.strategy ?? null,
        estimated_cost_usd: ctx.meta_json?.analysis_sample?.estimated_cost_usd ?? null,
        tagged_mentions: allTagged.length,
        unique_tags: uniqueTags.length,
        irrelevant_count: irrelevantCount,
        batches_total: batches.length,
        batches_failed: batchesFailed,
        health: healthFlag,
        // Keep the top tags inline so the review UI can show a preview without
        // an extra DB hit. Cap at top 60 to keep the JSON manageable.
        top_tags: uniqueTags.slice(0, 60)
      }
    });

    // Chain to step 2
    const next = await enqueueStep({ tbAnalysisId, step: "step2_coding" });
    await job.updateProgress(100);

    return {
      sampled: mentions.length,
      tagged: allTagged.length,
      unique_tags: uniqueTags.length,
      health: healthFlag,
      next_step_job_id: next.jobId
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[tb-step1] failed: ${msg}`);
    await markStepFailed({ pipelineStepId, errorMessage: msg });
    await releaseCorpusLock(tbAnalysisId);
    throw err;
  }
}

function resolveOpenPassSampleSize(ctx: AnalysisContextRow) {
  const configuredTarget = ctx.meta_json?.analysis_sample?.target_mentions;
  if (typeof configuredTarget === "number" && Number.isFinite(configuredTarget) && configuredTarget > 0) {
    return Math.min(Math.max(Math.floor(configuredTarget), 1), 100000);
  }

  const raw = Number.parseInt(process.env.TB_OPEN_PASS_MAX_SAMPLE ?? "", 10);
  if (!Number.isFinite(raw) || raw <= 0) {
    return Math.min(TB_OPEN_PASS_MAX_SAMPLE, LEGACY_OPEN_PASS_SAFE_MAX);
  }
  return Math.min(Math.max(raw, 1500), LEGACY_OPEN_PASS_SAFE_MAX);
}

async function loadAnalysisContext(tbAnalysisId: string): Promise<AnalysisContextRow> {
  const r = await pool.query<AnalysisContextRow>(
    `SELECT
       ta.study_corpus_id,
       ta.snapshot_id,
       ta.business_question,
       b.name AS brand_name,
       b.display_name AS brand_display_name,
       b.industry AS brand_industry,
       ta.meta_json
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

/**
 * Stratified sample: take proportional slices per attribution role and then
 * platform so minority competitor/category uploads do not disappear in partial
 * studies. The snapshot's mention set is the ground truth — we sample from it
 * directly (joining via corpus_snapshot_mentions).
 */
async function sampleSnapshotMentions(
  snapshotId: string,
  corpusId: string,
  maxSample: number
): Promise<MentionRow[]> {
  const totalRow = await pool.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total
     FROM mentions m
     JOIN corpus_snapshot_mentions csm ON csm.mention_id = m.id
     WHERE csm.snapshot_id = $1 AND m.study_corpus_id = $2`,
    [snapshotId, corpusId]
  );
  const total = totalRow.rows[0]?.total ?? 0;

  // Tiny corpora: take everything.
  if (total <= maxSample) {
    const r = await pool.query<MentionRow>(
      `SELECT m.id, m.platform, m.text_snippet, m.text_clean
       FROM mentions m
       JOIN corpus_snapshot_mentions csm ON csm.mention_id = m.id
       WHERE csm.snapshot_id = $1 AND m.study_corpus_id = $2
         AND length(m.text_clean) >= 20
       ORDER BY random()
       LIMIT $3`,
      [snapshotId, corpusId, maxSample]
    );
    return r.rows;
  }

  const roles = await pool.query<{ mention_role: string; cnt: number }>(
    `SELECT COALESCE(ib.mention_type, 'unattributed') AS mention_role, COUNT(*)::int AS cnt
     FROM mentions m
     JOIN corpus_snapshot_mentions csm ON csm.mention_id = m.id
     LEFT JOIN import_batches ib ON ib.id = m.source_file_id
     WHERE csm.snapshot_id = $1 AND m.study_corpus_id = $2
       AND length(m.text_clean) >= 20
     GROUP BY 1`,
    [snapshotId, corpusId]
  );

  const roleQuotas = allocateRoleQuotas({ roles: roles.rows, maxSample, total });
  const allRows: MentionRow[] = [];
  for (const role of roleQuotas) {
    const platforms = await pool.query<{ platform: string; cnt: number }>(
      `SELECT COALESCE(m.platform, 'unknown') AS platform, COUNT(*)::int AS cnt
       FROM mentions m
       JOIN corpus_snapshot_mentions csm ON csm.mention_id = m.id
       LEFT JOIN import_batches ib ON ib.id = m.source_file_id
       WHERE csm.snapshot_id = $1 AND m.study_corpus_id = $2
         AND COALESCE(ib.mention_type, 'unattributed') = $3
         AND length(m.text_clean) >= 20
       GROUP BY 1`,
      [snapshotId, corpusId, role.mention_role]
    );

    let remainingQuota = role.quota;
    let remainingCount = role.count;
    for (let index = 0; index < platforms.rows.length; index += 1) {
      const p = platforms.rows[index];
      if (!p) continue;
      const quota = Math.min(
        remainingQuota,
        index === platforms.rows.length - 1
          ? remainingQuota
          : Math.max(1, Math.round(remainingQuota * (p.cnt / Math.max(1, remainingCount))))
      );
      if (quota <= 0) continue;
      const r = await pool.query<MentionRow>(
        `SELECT m.id, COALESCE(m.platform, 'unknown') AS platform, m.text_snippet, m.text_clean
       FROM mentions m
       JOIN corpus_snapshot_mentions csm ON csm.mention_id = m.id
       LEFT JOIN import_batches ib ON ib.id = m.source_file_id
       WHERE csm.snapshot_id = $1 AND m.study_corpus_id = $2
         AND COALESCE(ib.mention_type, 'unattributed') = $3
         AND COALESCE(m.platform, 'unknown') = $4
         AND length(m.text_clean) >= 20
       ORDER BY random()
       LIMIT $5`,
        [snapshotId, corpusId, role.mention_role, p.platform, quota]
      );
      allRows.push(...r.rows);
      remainingQuota -= r.rows.length;
      remainingCount -= p.cnt;

      if (remainingQuota <= 0 || remainingCount <= 0) break;
    }
  }

  // If proportional rounding pushed us over the cap, trim randomly.
  if (allRows.length > maxSample) {
    allRows.sort(() => Math.random() - 0.5);
    return allRows.slice(0, maxSample);
  }

  return allRows;
}

function allocateRoleQuotas(args: {
  roles: { mention_role: string; cnt: number }[];
  maxSample: number;
  total: number;
}) {
  const minimum = Math.min(
    MIN_ROLE_SAMPLE_CEILING,
    Math.max(MIN_ROLE_SAMPLE_FLOOR, Math.round(args.maxSample * MIN_ROLE_SAMPLE_SHARE))
  );
  const quotas = args.roles.map((role) => {
    const proportional = Math.round(args.maxSample * (role.cnt / Math.max(1, args.total)));
    const protectedMinimum =
      role.mention_role === "competitor" || role.mention_role === "industry" || role.mention_role === "brand"
        ? minimum
        : 1;
    return {
      mention_role: role.mention_role,
      count: role.cnt,
      quota: Math.min(role.cnt, Math.max(proportional, protectedMinimum))
    };
  });

  let overflow = quotas.reduce((sum, role) => sum + role.quota, 0) - args.maxSample;
  if (overflow <= 0) return quotas.filter((role) => role.quota > 0);

  for (const role of [...quotas].sort((a, b) => b.quota - a.quota)) {
    const floor = Math.min(role.count, role.mention_role === "unattributed" ? 1 : minimum);
    const reducible = Math.max(0, role.quota - floor);
    const reduction = Math.min(reducible, overflow);
    role.quota -= reduction;
    overflow -= reduction;
    if (overflow <= 0) break;
  }

  return quotas.filter((role) => role.quota > 0);
}

async function processBatch(args: {
  batch: OpenPassMentionInput[];
  ctx: AnalysisContextRow;
  model: string;
  outputLanguage: string;
  ragContext: Awaited<ReturnType<typeof loadTbRagPromptContext>>;
}): Promise<{ mentionId: string; tags: string[] }[]> {
  const { batch, ctx, model, outputLanguage, ragContext } = args;
  const prompt = buildOpenPassPrompt({
    brandName: ctx.brand_display_name ?? ctx.brand_name ?? "Marca",
    industry: ctx.brand_industry,
    businessQuestion: ctx.business_question,
    outputLanguage,
    ragContext,
    mentions: batch
  });

  const r = await generateText({ model: anthropic(model), prompt, temperature: 0.2 });
  const parsed = parseOpenPassResponse(r.text);

  // Index by mention_id and only keep ids that were in the batch we sent
  // (defensive: Claude sometimes hallucinates extra ids).
  const validIds = new Set(batch.map((m) => m.id));
  const out: { mentionId: string; tags: string[] }[] = [];
  for (const t of parsed.tagged_mentions) {
    if (!validIds.has(t.mention_id)) continue;
    out.push({ mentionId: t.mention_id, tags: t.tags });
  }
  return out;
}

/** Bulk-insert codings in chunks of ~500 rows to stay under PG param limits. */
async function persistCodings(args: {
  tbAnalysisId: string;
  tagged: { mentionId: string; tags: string[] }[];
}): Promise<void> {
  const CHUNK = 500;
  for (let i = 0; i < args.tagged.length; i += CHUNK) {
    const slice = args.tagged.slice(i, i + CHUNK);
    if (slice.length === 0) continue;

    // VALUES (?, ?, 'mixed', null, ?, false) ... — 4 params per row
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let p = 1;
    for (const t of slice) {
      placeholders.push(`($${p}::uuid, $${p + 1}::uuid, 'mixed', NULL, $${p + 2}::text[], false)`);
      values.push(args.tbAnalysisId, t.mentionId, t.tags);
      p += 3;
    }

    await pool.query(
      `INSERT INTO tb_mention_codings
         (tb_analysis_id, mention_id, polarity, layer, emergent_tags, ambiguous)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (tb_analysis_id, mention_id, finding_id)
       DO UPDATE SET emergent_tags = EXCLUDED.emergent_tags`,
      values
    );
  }
}
