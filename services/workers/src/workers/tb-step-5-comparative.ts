import type { Job } from "bullmq";

import { pool } from "../db/client";
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

type EntityKind = "primary_brand" | "competitor_pool" | "competitor" | "category" | "unknown";
type Polarity = "trigger" | "barrier" | "mixed";

type EntityCountRow = {
  competitor_id: string | null;
  entity_kind: EntityKind | null;
  entity_label: string | null;
  mention_count: number;
};

type PresenceRow = {
  finding_id: string;
  finding_uuid: string;
  finding_name: string;
  polarity: Polarity;
  layer: string;
  movilidad: string | null;
  competitor_id: string | null;
  entity_kind: EntityKind | null;
  entity_label: string | null;
  mention_count: number;
};

type EntitySummary = {
  entity_id: string;
  entity_name: string;
  entity_kind: Exclude<EntityKind, "unknown">;
  mention_count: number;
  confidence: "alta" | "media" | "baja_direccional";
};

type FindingEntityPresence = {
  finding_id: string;
  finding_name: string;
  polarity: Polarity;
  layer: string;
  mobility: string | null;
  total_mentions: number;
  brand_mentions: number;
  competitor_mentions: number;
  category_mentions: number;
  dominant_entity_kind: EntityKind;
  dominant_entity_name: string;
  ownership:
    | "brand_owned"
    | "competitor_owned"
    | "category_wide"
    | "shared"
    | "insufficient_evidence";
  entities: Array<{
    entity_id: string;
    entity_name: string;
    entity_kind: EntityKind;
    mention_count: number;
    share_pct: number;
  }>;
};

/**
 * Step 5 — Comparative brief.
 * Uses the CSV/import-batch attribution saved by the engine wizard to answer:
 * "esto es mio, de la competencia o de la categoria?" without making claims
 * that are not supported by evidence.
 */
export async function tbStep5ComparativeJob(job: Job<StepJobData>) {
  const { tbAnalysisId, pipelineStepId } = job.data;
  await markStepRunning(pipelineStepId);
  await job.updateProgress(12);

  try {
    const brief = await rebuildComparativeBrief(tbAnalysisId);
    await job.updateProgress(50);

    await persistComparativeBrief(tbAnalysisId, brief);
    await job.updateProgress(82);

    await markStepCompleted({
      pipelineStepId,
      resultSummary: {
        benchmark_available: brief.benchmark_available,
        entities: brief.entities.length,
        finding_entity_presence: brief.finding_entity_presence.length,
        brand_owned_triggers: brief.brand_owned_triggers.length,
        competitor_owned_triggers: brief.competitor_owned_triggers.length,
        brand_specific_barriers: brief.brand_specific_barriers.length,
        competitor_specific_barriers: brief.competitor_specific_barriers.length,
        category_wide_barriers: brief.category_wide_barriers.length,
        limitations: brief.limitations
      }
    });

    const next = await enqueueStep({ tbAnalysisId, step: "step6_synthesis" });
    await job.updateProgress(100);
    return { comparative_brief: brief, next_step_job_id: next.jobId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[tb-step5] failed: ${msg}`);
    await markStepFailed({ pipelineStepId, errorMessage: msg });
    await releaseCorpusLock(tbAnalysisId);
    throw err;
  }
}

export async function rebuildComparativeBrief(tbAnalysisId: string) {
  const [entities, presenceRows] = await Promise.all([
    loadEntityCounts(tbAnalysisId),
    loadFindingEntityPresence(tbAnalysisId)
  ]);
  const ragContext = await loadTbRagPromptContext(tbAnalysisId);

  return buildComparativeBrief({
    entities: normalizeEntities(entities),
    presence: normalizePresence(presenceRows),
    ragContext
  });
}

export async function rebuildAndPersistComparativeBrief(tbAnalysisId: string) {
  const brief = await rebuildComparativeBrief(tbAnalysisId);
  await persistComparativeBrief(tbAnalysisId, brief);
  return brief;
}

async function loadEntityCounts(tbAnalysisId: string): Promise<EntityCountRow[]> {
  const r = await pool.query<EntityCountRow>(
    `WITH attributed_batches AS (
       SELECT
         ib.id,
         ib.competitor_id,
         COALESCE(
           ib.entity_kind,
           CASE
             WHEN ib.mention_type = 'brand' THEN 'primary_brand'
             WHEN ib.mention_type = 'competitor' THEN 'competitor_pool'
             WHEN ib.mention_type = 'industry' THEN 'category'
             ELSE 'unknown'
           END
         ) AS resolved_entity_kind,
         COALESCE(
           ib.entity_label,
           CASE
             WHEN ib.mention_type = 'brand' THEN 'Marca'
             WHEN ib.mention_type = 'competitor' THEN 'Pool competitivo'
             WHEN ib.mention_type = 'industry' THEN 'Categoria'
             ELSE 'Sin atribucion'
           END
         ) AS resolved_entity_label
       FROM tb_analyses ta
       JOIN import_batches ib ON ib.study_corpus_id = ta.study_corpus_id
       WHERE ta.id = $1
     )
     SELECT
       ab.competitor_id,
       ab.resolved_entity_kind AS entity_kind,
       ab.resolved_entity_label AS entity_label,
       COUNT(m.id)::int AS mention_count
     FROM attributed_batches ab
     LEFT JOIN mentions m
       ON m.source_file_id = ab.id
      AND m.inclusion_status = 'included'
     GROUP BY ab.competitor_id, ab.resolved_entity_kind, ab.resolved_entity_label
     ORDER BY mention_count DESC`,
    [tbAnalysisId]
  );
  return r.rows;
}

async function loadFindingEntityPresence(tbAnalysisId: string): Promise<PresenceRow[]> {
  const r = await pool.query<PresenceRow>(
    `WITH attributed_mentions AS (
       SELECT
         m.id AS mention_id,
         ib.competitor_id,
         COALESCE(
           ib.entity_kind,
           CASE
             WHEN ib.mention_type = 'brand' THEN 'primary_brand'
             WHEN ib.mention_type = 'competitor' THEN 'competitor_pool'
             WHEN ib.mention_type = 'industry' THEN 'category'
             ELSE 'unknown'
           END
         ) AS resolved_entity_kind,
         COALESCE(
           ib.entity_label,
           CASE
             WHEN ib.mention_type = 'brand' THEN 'Marca'
             WHEN ib.mention_type = 'competitor' THEN 'Pool competitivo'
             WHEN ib.mention_type = 'industry' THEN 'Categoria'
             ELSE 'Sin atribucion'
           END
         ) AS resolved_entity_label
       FROM mentions m
       LEFT JOIN import_batches ib ON ib.id = m.source_file_id
     )
     SELECT
       f.finding_id,
       f.id AS finding_uuid,
       f.nombre_comercial AS finding_name,
       f.polarity,
       f.layer,
       f.movilidad,
       am.competitor_id,
       am.resolved_entity_kind AS entity_kind,
       am.resolved_entity_label AS entity_label,
       COUNT(DISTINCT c.mention_id)::int AS mention_count
     FROM tb_mention_codings c
     JOIN tb_findings f ON f.id = c.finding_id
     JOIN attributed_mentions am ON am.mention_id = c.mention_id
     WHERE c.tb_analysis_id = $1
       AND c.finding_id IS NOT NULL
       AND c.polarity != 'irrelevant'
     GROUP BY
       f.finding_id, f.id, f.nombre_comercial, f.polarity, f.layer, f.movilidad,
       am.competitor_id, am.resolved_entity_kind, am.resolved_entity_label
     ORDER BY f.finding_id ASC, mention_count DESC`,
    [tbAnalysisId]
  );
  return r.rows;
}

function normalizeEntities(rows: EntityCountRow[]): EntitySummary[] {
  return rows
    .map((row) => {
      const kind = sanitizeKind(row.entity_kind);
      if (kind === "unknown") return null;
      const mentionCount = Number(row.mention_count ?? 0);
      return {
        entity_id: entityId(kind, row.entity_label, row.competitor_id),
        entity_name: row.entity_label ?? entityName(kind),
        entity_kind: kind,
        mention_count: mentionCount,
        confidence: confidenceFromMentions(mentionCount)
      };
    })
    .filter((row): row is EntitySummary => row !== null);
}

function normalizePresence(rows: PresenceRow[]): FindingEntityPresence[] {
  const byFinding = new Map<string, PresenceRow[]>();
  for (const row of rows) {
    const list = byFinding.get(row.finding_id) ?? [];
    list.push(row);
    byFinding.set(row.finding_id, list);
  }

  return Array.from(byFinding.values()).map((group) => {
    const first = group[0];
    const entities = group
      .map((row) => ({
        entity_id: entityId(sanitizeKind(row.entity_kind), row.entity_label, row.competitor_id),
        entity_name: row.entity_label ?? entityName(sanitizeKind(row.entity_kind)),
        entity_kind: sanitizeKind(row.entity_kind),
        mention_count: Number(row.mention_count ?? 0),
        share_pct: 0
      }))
      .sort((a, b) => b.mention_count - a.mention_count);
    const total = Math.max(1, entities.reduce((sum, entity) => sum + entity.mention_count, 0));
    for (const entity of entities) {
      entity.share_pct = roundPct(entity.mention_count / total);
    }

    const dominant = entities[0] ?? {
      entity_kind: "unknown" as EntityKind,
      entity_name: "Sin atribucion",
      mention_count: 0,
      share_pct: 0
    };
    const brandMentions = sumKinds(entities, ["primary_brand"]);
    const competitorMentions = sumKinds(entities, ["competitor", "competitor_pool"]);
    const categoryMentions = sumKinds(entities, ["category"]);
    const ownership = classifyOwnership({
      total,
      brandMentions,
      competitorMentions,
      categoryMentions,
      dominantSharePct: dominant.share_pct
    });

    return {
      finding_id: first?.finding_id ?? "unknown",
      finding_name: first?.finding_name ?? "Finding",
      polarity: first?.polarity ?? "mixed",
      layer: first?.layer ?? "unknown",
      mobility: first?.movilidad ?? null,
      total_mentions: total,
      brand_mentions: brandMentions,
      competitor_mentions: competitorMentions,
      category_mentions: categoryMentions,
      dominant_entity_kind: dominant.entity_kind,
      dominant_entity_name: dominant.entity_name,
      ownership,
      entities
    };
  });
}

function buildComparativeBrief(args: {
  entities: EntitySummary[];
  presence: FindingEntityPresence[];
  ragContext: Awaited<ReturnType<typeof loadTbRagPromptContext>>;
}) {
  const hasBrand = args.entities.some((entity) => entity.entity_kind === "primary_brand" && entity.mention_count > 0);
  const hasCompetitor = args.entities.some((entity) =>
    (entity.entity_kind === "competitor" || entity.entity_kind === "competitor_pool") && entity.mention_count > 0
  );
  const hasCategory = args.entities.some((entity) => entity.entity_kind === "category" && entity.mention_count > 0);

  const triggers = args.presence.filter((finding) => finding.polarity === "trigger");
  const barriers = args.presence.filter((finding) => finding.polarity === "barrier");
  const brandOwnedTriggers = triggers.filter((finding) => finding.ownership === "brand_owned");
  const competitorOwnedTriggers = triggers.filter((finding) => finding.ownership === "competitor_owned");
  const brandSpecificBarriers = barriers.filter((finding) => finding.ownership === "brand_owned");
  const competitorSpecificBarriers = barriers.filter((finding) => finding.ownership === "competitor_owned");
  const categoryWideBarriers = barriers.filter((finding) =>
    finding.ownership === "category_wide" || finding.ownership === "shared"
  );

  const limitations: string[] = [];
  if (!hasBrand) limitations.push("No hay CSV atribuido a marca; no se puede distinguir ownership propio.");
  if (!hasCompetitor) limitations.push("No hay CSV atribuido a competencia; benchmark competitivo queda limitado.");
  if (!hasCategory) limitations.push("No hay CSV atribuido a industria/categoria; baseline cultural queda limitado.");
  if (args.presence.length === 0) limitations.push("No hay codificacion por finding suficiente para medir presencia competitiva.");

  return {
    schema_version: 1,
    generated_from: "tb_step_5_comparative",
    strategy_context: {
      competitor_hypotheses: extractArray(args.ragContext.query_strategy_brief, "competitor_hypotheses"),
      must_answer: extractArray(args.ragContext.query_strategy_brief, "must_answer"),
      priority_topics: extractArray(args.ragContext.query_strategy_brief, "priority_topics")
    },
    benchmark_available: hasBrand && hasCompetitor && args.presence.length > 0,
    entities: args.entities,
    finding_entity_presence: args.presence,
    brand_owned_triggers: shortFindings(brandOwnedTriggers),
    competitor_owned_triggers: shortFindings(competitorOwnedTriggers),
    brand_specific_barriers: shortFindings(brandSpecificBarriers),
    competitor_specific_barriers: shortFindings(competitorSpecificBarriers),
    category_wide_barriers: shortFindings(categoryWideBarriers),
    whitespace: competitorOwnedTriggers.slice(0, 6).map((finding) => ({
      finding_id: finding.finding_id,
      finding_name: finding.finding_name,
      reason: "La competencia aparece asociada al trigger con mas fuerza que la marca; evaluar si conviene disputar, reinterpretar o evitar copiarlo.",
      evidence_mentions: finding.competitor_mentions
    })),
    gaps_accionables: [...brandSpecificBarriers, ...categoryWideBarriers].slice(0, 8).map((finding) => ({
      finding_id: finding.finding_id,
      finding_name: finding.finding_name,
      question_to_answer: finding.ownership === "brand_owned"
        ? "¿Que debe corregir la marca porque el dolor aparece principalmente en su corpus?"
        : "¿Como puede la marca resolver una barrera de categoria sin prometer de mas?",
      evidence_mentions: finding.total_mentions
    })),
    limitations
  };
}

async function persistComparativeBrief(tbAnalysisId: string, brief: ReturnType<typeof buildComparativeBrief>) {
  await pool.query(
    `UPDATE tb_analyses
     SET comparative_brief = $1::jsonb,
         limitations = COALESCE(limitations, '[]'::jsonb) || $2::jsonb,
         updated_at = NOW()
     WHERE id = $3`,
    [JSON.stringify(brief), JSON.stringify(brief.limitations), tbAnalysisId]
  );
}

function classifyOwnership(args: {
  total: number;
  brandMentions: number;
  competitorMentions: number;
  categoryMentions: number;
  dominantSharePct: number;
}): FindingEntityPresence["ownership"] {
  if (args.total < 2 || args.dominantSharePct < 35) return "insufficient_evidence";
  if (args.brandMentions / args.total >= 0.55) return "brand_owned";
  if (args.competitorMentions / args.total >= 0.55) return "competitor_owned";
  if (args.categoryMentions / args.total >= 0.45) return "category_wide";
  return "shared";
}

function shortFindings(findings: FindingEntityPresence[]) {
  return findings.slice(0, 8).map((finding) => ({
    finding_id: finding.finding_id,
    finding_name: finding.finding_name,
    polarity: finding.polarity,
    layer: finding.layer,
    ownership: finding.ownership,
    dominant_entity_name: finding.dominant_entity_name,
    evidence_mentions: finding.total_mentions
  }));
}

function sanitizeKind(kind: EntityKind | null): EntityKind {
  if (
    kind === "primary_brand" ||
    kind === "competitor_pool" ||
    kind === "competitor" ||
    kind === "category"
  ) {
    return kind;
  }
  return "unknown";
}

function entityId(kind: EntityKind, label: string | null, competitorId: string | null) {
  if (competitorId) return competitorId;
  return `${kind}:${(label ?? entityName(kind)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function entityName(kind: EntityKind) {
  if (kind === "primary_brand") return "Marca";
  if (kind === "competitor" || kind === "competitor_pool") return "Pool competitivo";
  if (kind === "category") return "Categoria";
  return "Sin atribucion";
}

function confidenceFromMentions(count: number): EntitySummary["confidence"] {
  if (count >= 100) return "alta";
  if (count >= 30) return "media";
  return "baja_direccional";
}

function sumKinds(entities: Array<{ entity_kind: EntityKind; mention_count: number }>, kinds: EntityKind[]) {
  return entities
    .filter((entity) => kinds.includes(entity.entity_kind))
    .reduce((sum, entity) => sum + entity.mention_count, 0);
}

function roundPct(value: number) {
  return Math.round(value * 1000) / 10;
}

function extractArray(value: unknown, key: string) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Array.isArray(record[key])
    ? record[key].filter((item): item is string => typeof item === "string").slice(0, 8)
    : [];
}
