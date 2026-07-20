import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type { Job } from "bullmq";

import {
  buildFindingId,
  buildHierarchyPrompt,
  computeCompositeScore,
  normalizeTag,
  parseHierarchyResponse,
  TB_HIERARCHY_MAX_CLUSTERS,
  TB_HIERARCHY_MIN_FREQUENCY,
  TB_HIERARCHY_SAMPLES_PER_CLUSTER,
  type CodedTag,
  type HierarchyClusterInput,
  type TbLayer
} from "@noisia/query-engine";
import { pool } from "../db/client";
import {
  assertCorpusDataOsAuditReady,
  auditCorpusDataOs,
  persistCorpusDataOsAudit,
  summarizeCorpusDataOsAudit
} from "./data-os-corpus-audit";
import { materializeTbCodingDataOs } from "./tb-data-os-bridge";
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

type AnalysisCtxRow = {
  business_question: string | null;
  brand_name: string | null;
  brand_display_name: string | null;
  brand_industry: string | null;
};

type CandidateCluster = {
  key: string; // polarity|layer|cluster-or-tag
  label: string;
  polarity: "trigger" | "barrier" | "mixed";
  layer: TbLayer;
  member_tags: string[]; // normalized
  mention_ids: string[]; // ids of mentions touching any member tag
};

type HierarchyClusterWithMentions = HierarchyClusterInput & {
  mention_ids: string[];
};

/**
 * Step 3 — Hierarchy.
 * Spec §5.4: turn the coded vocabulary + mention codings into ranked findings
 * with composite scores. Each cluster of related tags becomes a tb_findings
 * row, with citations attached and tb_mention_codings.finding_id back-linked.
 *
 * Algorithm:
 *   1. Read step 2's coded_vocabulary + this analysis' mention codings.
 *   2. Group tags into clusters keyed by (polarity, layer, cluster-or-tag).
 *      Tags that share a `cluster` value collapse together.
 *   3. For each cluster, collect all mentions whose emergent_tags touch any
 *      member tag — that's the cluster's frequency.
 *   4. Drop clusters with frequency < TB_HIERARCHY_MIN_FREQUENCY.
 *   5. One Claude call evaluates all surviving clusters: nombre_comercial +
 *      intensidad + predictividad + protagonist + supporting citations.
 *   6. Compute composite scores, sort, assign finding_ids ("B-PER-01" style).
 *   7. INSERT tb_findings, UPDATE tb_mention_codings.finding_id, INSERT
 *      tb_finding_citations.
 */
export async function tbStep3HierarchyJob(job: Job<StepJobData>) {
  const { tbAnalysisId, pipelineStepId } = job.data;
  await markStepRunning(pipelineStepId);
  await job.updateProgress(5);

  try {
    const ctx = await loadCtx(tbAnalysisId);
    const outputLanguage = await detectTbOutputLanguage(tbAnalysisId);
    const ragContext = await loadTbRagPromptContext(tbAnalysisId);
    await job.updateProgress(12);

    // Pull step 2's coded vocabulary
    const step2 = await pool.query<{ result_summary: { coded_vocabulary?: CodedTag[] } }>(
      `SELECT result_summary FROM tb_pipeline_steps
       WHERE tb_analysis_id = $1 AND step = 'step2_coding' AND status = 'completed'
       ORDER BY created_at DESC LIMIT 1`,
      [tbAnalysisId]
    );
    const codedVocab = step2.rows[0]?.result_summary?.coded_vocabulary ?? [];
    if (codedVocab.length === 0) {
      throw new Error("Step 2 no produjo coded_vocabulary — no se puede ejecutar step 3");
    }

    // Build candidate clusters from the coded vocabulary
    const candidates = buildCandidateClusters(codedVocab);
    console.log(`[tb-step3] ${codedVocab.length} coded tags grouped into ${candidates.size} candidate clusters`);
    await job.updateProgress(22);

    // Populate each cluster's mention_ids by querying tb_mention_codings.
    // Done in one SQL pass: for each row, pick the cluster of its first matching tag.
    await populateClusterMentions({ tbAnalysisId, candidates });
    await job.updateProgress(40);

    // Filter out long-tail clusters below the min frequency
    const eligible = Array.from(candidates.values())
      .filter((c) => c.mention_ids.length >= TB_HIERARCHY_MIN_FREQUENCY)
      .sort((a, b) => b.mention_ids.length - a.mention_ids.length)
      .slice(0, TB_HIERARCHY_MAX_CLUSTERS);

    if (eligible.length === 0) {
      throw new Error(`Ningun cluster alcanzo el minimo de ${TB_HIERARCHY_MIN_FREQUENCY} menciones`);
    }
    console.log(`[tb-step3] ${eligible.length} clusters passed min frequency, sending to Claude`);

    // Load sample verbatims (5 per cluster) for the prompt
    const clustersWithSamples = await attachSamples(eligible);
    await job.updateProgress(55);

    // Single Claude call to score all clusters
    const model = process.env.ANTHROPIC_MODEL_DEFAULT ?? "claude-sonnet-4-6";
    const prompt = buildHierarchyPrompt({
      brandName: ctx.brand_display_name ?? ctx.brand_name ?? "Marca",
      industry: ctx.brand_industry,
      businessQuestion: ctx.business_question,
      outputLanguage,
      ragContext,
      clusters: clustersWithSamples
    });

    let evalResult;
    try {
      const r = await generateText({ model: anthropic(model), prompt, temperature: 0.15 });
      console.log(`[tb-step3] response first 200: ${r.text.slice(0, 200)}`);
      evalResult = parseHierarchyResponse(r.text);
    } catch (err) {
      throw new Error(`Hierarchy parse failed: ${err instanceof Error ? err.message : err}`);
    }

    if (evalResult.evaluated.length === 0) {
      throw new Error("Claude no devolvio clusters evaluados");
    }
    await job.updateProgress(78);

    // Compute composite scores. Frequency is normalized per polarity bucket so
    // big-bucket clusters don't crush small-bucket ones.
    const evaluatedByKey = new Map(evalResult.evaluated.map((e) => [e.key, e]));
    const maxFreqByPolarity = new Map<string, number>();
    for (const c of clustersWithSamples) {
      const cur = maxFreqByPolarity.get(c.polarity) ?? 0;
      if (c.frequency > cur) maxFreqByPolarity.set(c.polarity, c.frequency);
    }

    const scored: Array<{
      cluster: HierarchyClusterWithMentions;
      evaluation: typeof evalResult.evaluated[number];
      score: number;
    }> = [];
    for (const c of clustersWithSamples) {
      const e = evaluatedByKey.get(c.key);
      if (!e) continue;
      const score = computeCompositeScore({
        frequency: c.frequency,
        maxFrequencyInBucket: maxFreqByPolarity.get(c.polarity) ?? c.frequency,
        intensidadPromedio: e.intensidad_promedio,
        capacidadPredictiva: e.capacidad_predictiva
      });
      scored.push({ cluster: c, evaluation: e, score });
    }

    // Assign finding_ids by (polarity, layer) bucket sorted by score desc
    type GroupKey = string;
    const buckets = new Map<GroupKey, typeof scored>();
    for (const s of scored) {
      const k = `${s.cluster.polarity}|${s.cluster.layer}`;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(s);
    }
    for (const bucket of buckets.values()) {
      bucket.sort((a, b) => b.score - a.score);
    }

    type Persistable = {
      finding_id: string;
      cluster: HierarchyClusterWithMentions;
      evaluation: typeof evalResult.evaluated[number];
      score: number;
      position_in_layer: number;
    };
    const toPersist: Persistable[] = [];
    for (const [key, bucket] of buckets.entries()) {
      const [polarity, layer] = key.split("|") as ["trigger" | "barrier" | "mixed", TbLayer];
      bucket.forEach((s, idx) => {
        toPersist.push({
          finding_id: buildFindingId({ polarity, layer, ordinal: idx + 1 }),
          cluster: s.cluster,
          evaluation: s.evaluation,
          score: s.score,
          position_in_layer: idx
        });
      });
    }

    await job.updateProgress(85);

    // Persist findings + citations + back-link mention codings
    const stats = await persistFindings({ tbAnalysisId, toPersist });
    const dataOsBridge = await materializeTbCodingDataOs({
      tbAnalysisId,
      stage: "step3_hierarchy"
    });
    const dataOsAudit = await auditCorpusDataOs({
      corpusId: dataOsBridge.study_corpus_id,
      stage: "post_coding",
      tbAnalysisId
    });
    await persistCorpusDataOsAudit({ tbAnalysisId, audit: dataOsAudit });
    assertCorpusDataOsAuditReady(dataOsAudit, "T&B hierarchy bridge");
    await job.updateProgress(96);

    await markStepCompleted({
      pipelineStepId,
      resultSummary: {
        candidate_clusters: candidates.size,
        eligible_clusters: eligible.length,
        evaluated_clusters: evalResult.evaluated.length,
        findings_inserted: stats.findingsInserted,
        citations_inserted: stats.citationsInserted,
        codings_linked: stats.codingsLinked,
        data_os_coding_bridge: dataOsBridge,
        data_os_post_coding: summarizeCorpusDataOsAudit(dataOsAudit),
        top_findings: toPersist
          .slice()
          .sort((a, b) => b.score - a.score)
          .slice(0, 8)
          .map((p) => ({
            finding_id: p.finding_id,
            nombre_comercial: p.evaluation.nombre_comercial,
            polarity: p.cluster.polarity,
            layer: p.cluster.layer,
            frequency: p.cluster.frequency,
            score: p.score
          }))
      }
    });

    const next = await enqueueStep({ tbAnalysisId, step: "step4_mobility" });
    await job.updateProgress(100);

    return {
      findings: stats.findingsInserted,
      citations: stats.citationsInserted,
      data_os_coding_bridge: dataOsBridge,
      data_os_post_coding: summarizeCorpusDataOsAudit(dataOsAudit),
      next_step_job_id: next.jobId
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[tb-step3] failed: ${msg}`);
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

/**
 * Group coded tags into candidate clusters. Tags that share Claude's `cluster`
 * value collapse together. Tags with no cluster get their own bucket (tag-as-cluster).
 * Irrelevant tags are filtered out.
 */
function buildCandidateClusters(codedVocab: CodedTag[]): Map<string, CandidateCluster> {
  const clusters = new Map<string, CandidateCluster>();
  for (const t of codedVocab) {
    if (t.polarity === "irrelevant" || !t.layer) continue;
    const clusterKey = t.cluster ? normalizeTag(t.cluster) : normalizeTag(t.tag);
    const key = `${t.polarity}|${t.layer}|${clusterKey}`;
    const existing = clusters.get(key);
    if (existing) {
      existing.member_tags.push(normalizeTag(t.tag));
    } else {
      clusters.set(key, {
        key,
        label: t.cluster ?? t.tag,
        polarity: t.polarity as "trigger" | "barrier" | "mixed",
        layer: t.layer,
        member_tags: [normalizeTag(t.tag)],
        mention_ids: []
      });
    }
  }
  return clusters;
}

/**
 * Walk every coded mention and assign it to the first cluster whose member
 * tags appear in its emergent_tags. We only do JS-side matching to avoid an
 * N+1 SQL pattern.
 */
async function populateClusterMentions(args: {
  tbAnalysisId: string;
  candidates: Map<string, CandidateCluster>;
}): Promise<void> {
  // Build reverse index: tag → cluster keys it belongs to (a tag can be in
  // multiple clusters if assigned multiple polarities, but that's pathological).
  const tagToClusters = new Map<string, string[]>();
  for (const cluster of args.candidates.values()) {
    for (const tag of cluster.member_tags) {
      const existing = tagToClusters.get(tag) ?? [];
      existing.push(cluster.key);
      tagToClusters.set(tag, existing);
    }
  }

  const rows = await pool.query<{ id: string; mention_id: string; emergent_tags: string[] | null }>(
    `SELECT id, mention_id, emergent_tags FROM tb_mention_codings
     WHERE tb_analysis_id = $1 AND polarity != 'irrelevant'`,
    [args.tbAnalysisId]
  );

  for (const row of rows.rows) {
    const tags = (row.emergent_tags ?? []).map(normalizeTag);
    // Find the first matching cluster (defensive against weird multi-cluster cases)
    for (const tag of tags) {
      const clusterKeys = tagToClusters.get(tag);
      if (!clusterKeys || clusterKeys.length === 0) continue;
      const cluster = args.candidates.get(clusterKeys[0]!);
      if (cluster) {
        cluster.mention_ids.push(row.mention_id);
        break;
      }
    }
  }
}

async function attachSamples(eligible: CandidateCluster[]): Promise<HierarchyClusterWithMentions[]> {
  const result: HierarchyClusterWithMentions[] = [];
  for (const c of eligible) {
    // Take up to N random mention_ids from this cluster's pool
    const pool_ = c.mention_ids.slice();
    pool_.sort(() => Math.random() - 0.5);
    const sampleIds = pool_.slice(0, TB_HIERARCHY_SAMPLES_PER_CLUSTER);
    let samples: { mention_id: string; text: string }[] = [];
    if (sampleIds.length > 0) {
      const placeholders = sampleIds.map((_, i) => `$${i + 1}`).join(", ");
      const r = await pool.query<{ id: string; text: string }>(
        `SELECT id, COALESCE(text_snippet, LEFT(text_clean, 280)) AS text
         FROM mentions WHERE id IN (${placeholders})`,
        sampleIds
      );
      // Preserve sample order
      const byId = new Map(r.rows.map((row) => [row.id, row.text]));
      samples = sampleIds
        .map((id) => byId.get(id))
        .filter((s): s is string => typeof s === "string" && s.length > 0)
        .map((text, i) => ({ mention_id: sampleIds[i]!, text }));
    }
    result.push({
      key: c.key,
      label: c.label,
      polarity: c.polarity,
      layer: c.layer,
      member_tags: c.member_tags,
      frequency: c.mention_ids.length,
      samples,
      mention_ids: c.mention_ids
    });
  }
  return result;
}

type PersistedFinding = {
  finding_id: string;
  cluster: HierarchyClusterWithMentions;
  evaluation: ReturnType<typeof parseHierarchyResponse>["evaluated"][number];
  score: number;
  position_in_layer: number;
};

async function persistFindings(args: {
  tbAnalysisId: string;
  toPersist: PersistedFinding[];
}): Promise<{ findingsInserted: number; citationsInserted: number; codingsLinked: number }> {
  let findingsInserted = 0;
  let citationsInserted = 0;
  let codingsLinked = 0;

  for (const p of args.toPersist) {
    const protagonistSample =
      p.cluster.samples[p.evaluation.protagonist_sample_index] ?? p.cluster.samples[0];
    const period = await loadFindingPeriod(p.cluster.mention_ids);

    // INSERT finding
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO tb_findings
        (tb_analysis_id, finding_id, polarity, layer, nombre_comercial,
         frecuencia, intensidad_promedio, capacidad_predictiva, score_compuesto,
         confidence, period_start, period_end, cita_protagonista, raw_data, position_in_layer)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12::date, $13::jsonb, $14::jsonb, $15)
       ON CONFLICT (tb_analysis_id, finding_id) DO UPDATE
         SET nombre_comercial = EXCLUDED.nombre_comercial,
             frecuencia = EXCLUDED.frecuencia,
             intensidad_promedio = EXCLUDED.intensidad_promedio,
             capacidad_predictiva = EXCLUDED.capacidad_predictiva,
             score_compuesto = EXCLUDED.score_compuesto,
             confidence = EXCLUDED.confidence,
             period_start = EXCLUDED.period_start,
             period_end = EXCLUDED.period_end,
             cita_protagonista = EXCLUDED.cita_protagonista,
             position_in_layer = EXCLUDED.position_in_layer
       RETURNING id`,
      [
        args.tbAnalysisId,
        p.finding_id,
        p.cluster.polarity,
        p.cluster.layer,
        p.evaluation.nombre_comercial,
        p.cluster.frequency,
        p.evaluation.intensidad_promedio.toFixed(2),
        p.evaluation.capacidad_predictiva.toFixed(2),
        p.score.toFixed(2),
        p.evaluation.confidence,
        period.start,
        period.end,
        protagonistSample ? JSON.stringify({
          text: protagonistSample.text,
          mention_id: protagonistSample.mention_id,
          reason: p.evaluation.reason
        }) : null,
        JSON.stringify({
          member_tags: p.cluster.member_tags,
          original_label: p.cluster.label,
          all_samples: p.cluster.samples.map((s) => ({ id: s.mention_id, text: s.text }))
        }),
        p.position_in_layer
      ]
    );
    const findingDbId = inserted.rows[0]?.id;
    if (!findingDbId) continue;
    findingsInserted += 1;

    // Insert citations: protagonist + supporting (deduped by mention_id)
    const citationIds = new Set<string>();
    const citationRows: { mention_id: string; is_protagonist: boolean; position: number }[] = [];
    if (protagonistSample) {
      citationIds.add(protagonistSample.mention_id);
      citationRows.push({ mention_id: protagonistSample.mention_id, is_protagonist: true, position: 0 });
    }
    let position = 1;
    for (const idx of p.evaluation.supporting_sample_indices) {
      const s = p.cluster.samples[idx];
      if (!s || citationIds.has(s.mention_id)) continue;
      citationIds.add(s.mention_id);
      citationRows.push({ mention_id: s.mention_id, is_protagonist: false, position });
      position += 1;
    }

    for (const cit of citationRows) {
      await pool.query(
        `INSERT INTO tb_finding_citations (finding_id, mention_id, is_protagonist, position)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (finding_id, mention_id) DO NOTHING`,
        [findingDbId, cit.mention_id, cit.is_protagonist, cit.position]
      );
      citationsInserted += 1;
    }

    // Back-link tb_mention_codings.finding_id for all mentions in this cluster
    if (p.cluster.member_tags.length > 0) {
      // Mentions whose emergent_tags overlap with this cluster's member_tags
      const linkResult = await pool.query(
        `UPDATE tb_mention_codings
         SET finding_id = $1
         WHERE tb_analysis_id = $2
           AND finding_id IS NULL
           AND polarity = $3
           AND layer = $4
           AND emergent_tags && $5::text[]`,
        [findingDbId, args.tbAnalysisId, p.cluster.polarity, p.cluster.layer, p.cluster.member_tags]
      );
      codingsLinked += linkResult.rowCount ?? 0;
    }
  }

  return { findingsInserted, citationsInserted, codingsLinked };
}

async function loadFindingPeriod(mentionIds: string[]) {
  if (mentionIds.length === 0) return { start: null, end: null };
  const uniqueIds = Array.from(new Set(mentionIds));
  const placeholders = uniqueIds.map((_, index) => `$${index + 1}::uuid`).join(", ");
  const r = await pool.query<{ start: string | null; end: string | null }>(
    `SELECT MIN(published_at)::date::text AS start, MAX(published_at)::date::text AS end
     FROM mentions
     WHERE id IN (${placeholders})`,
    uniqueIds
  );
  return {
    start: r.rows[0]?.start ?? null,
    end: r.rows[0]?.end ?? null
  };
}
