import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

import {
  buildQueryStrategyBriefPrompt,
  parseQueryStrategyBriefJson,
  type MemoryRecord,
  type QueryComposerInput,
  type QueryStrategyBrief
} from "@noisia/query-engine";
import { pool } from "../db/client";

type KnowledgeSourceRow = {
  type: string;
  title: string;
  raw_text: string | null;
  content: unknown;
};

type CorpusScopeRow = {
  organization_id: string | null;
  brand_id: string | null;
};

export type AnalysisRagContext = {
  knowledgeSources: MemoryRecord[];
  queryStrategyBrief: QueryStrategyBrief | null;
};

export async function loadAnalysisRagContext(corpusId: string, brandId?: string | null): Promise<AnalysisRagContext> {
  const sources = await loadKnowledgeSources(brandId ?? null, corpusId);
  return {
    knowledgeSources: sources,
    queryStrategyBrief: extractStrategyBrief(sources)
  };
}

export async function ensureQueryStrategyBrief(args: {
  input: QueryComposerInput;
  model: string;
  requestedByUserId: string;
}): Promise<QueryStrategyBrief> {
  const existing = extractStrategyBrief(args.input.knowledgeSources);
  if (existing) return existing;

  const prompt = buildQueryStrategyBriefPrompt(args.input);
  const result = await generateText({
    model: anthropic(args.model),
    prompt,
    temperature: 0.12
  });
  const brief = parseQueryStrategyBriefJson(result.text);

  const [scope] = (
    await pool.query<CorpusScopeRow>(
      `SELECT b.organization_id, sc.brand_id
       FROM study_corpora sc
       LEFT JOIN brands b ON b.id = sc.brand_id
       WHERE sc.id = $1
       LIMIT 1`,
      [args.input.corpus.id]
    )
  ).rows;

  await pool.query(
    `
      INSERT INTO brand_knowledge_sources (
        organization_id,
        brand_id,
        study_corpus_id,
        source_kind,
        title,
        raw_text,
        extracted_payload,
        status,
        created_by_user_id
      )
      VALUES ($1, $2, $3, 'query_strategy_brief', 'Query Strategy Brief', $4, $5::jsonb, 'processed', $6)
    `,
    [
      scope?.organization_id ?? null,
      scope?.brand_id ?? null,
      args.input.corpus.id,
      renderStrategyBrief(brief),
      JSON.stringify({
        ...brief,
        source: "query_strategy_brief",
        recommended_use: ["query_composition", "sample_evaluation", "analysis_context", "competitive_analysis"]
      }),
      args.requestedByUserId
    ]
  );

  return brief;
}

async function loadKnowledgeSources(brandId: string | null, corpusId: string): Promise<MemoryRecord[]> {
  const result = await pool.query<KnowledgeSourceRow>(
    `
      SELECT
        source_kind AS type,
        title,
        raw_text,
        extracted_payload AS content
      FROM brand_knowledge_sources
      WHERE status IN ('processed', 'processed_truncated')
        AND (
          study_corpus_id = $2
          OR ($1::uuid IS NOT NULL AND brand_id = $1 AND study_corpus_id IS NULL)
        )
      ORDER BY
        CASE
          WHEN source_kind = 'query_strategy_brief' THEN 0
          WHEN study_corpus_id = $2 THEN 1
          ELSE 2
        END,
        created_at DESC
      LIMIT 24
    `,
    [brandId, corpusId]
  );

  return result.rows.map((row) => ({
    type: row.type,
    content: compactKnowledgeContent(row.title, row.content, row.raw_text)
  }));
}

function extractStrategyBrief(records: MemoryRecord[]): QueryStrategyBrief | null {
  const record = records.find((item) => item.type === "query_strategy_brief");
  if (!record?.content || typeof record.content !== "object") return null;
  try {
    return parseQueryStrategyBriefJson(JSON.stringify(record.content));
  } catch {
    return null;
  }
}

function compactKnowledgeContent(title: string, content: unknown, rawText: string | null) {
  const source = content && typeof content === "object" ? content as Record<string, unknown> : {};
  if (source.source === "query_strategy_brief" || source.summary || source.priority_topics) {
    return {
      title,
      ...source,
      raw_text_excerpt: rawText ? rawText.slice(0, 1200) : undefined
    };
  }

  return {
    title,
    summary: rawText?.slice(0, 1200) ?? "",
    raw_text_excerpt: rawText?.slice(0, 1800) ?? "",
    recommended_use: ["analysis_context"]
  };
}

function renderStrategyBrief(brief: QueryStrategyBrief) {
  return [
    `Resumen: ${brief.summary}`,
    "",
    "Temas prioritarios:",
    ...brief.priority_topics.map((item) => `- ${item}`),
    "",
    "Lenguaje de query:",
    ...brief.query_language.map((item) => `- ${item}`),
    "",
    "Hipotesis competitivas:",
    ...brief.competitor_hypotheses.map((item) => `- ${item}`),
    "",
    "Exclusiones / ruido:",
    ...brief.exclusions_or_noise.map((item) => `- ${item}`),
    "",
    `Rol query marca: ${brief.brand_query_role}`,
    `Rol query competencia: ${brief.competitor_query_role}`,
    `Rol query industria: ${brief.industry_query_role}`
  ].join("\n");
}

