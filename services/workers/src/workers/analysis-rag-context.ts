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
import { compactKnowledgeContent } from "./rag-context-compaction";

export { compactKnowledgeContent } from "./rag-context-compaction";

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

  // The brief is best-effort context: a transient LLM error or malformed JSON
  // must NOT kill the whole compose job. Fall back to a minimal brief derived
  // from the corpus input so query composition can still proceed.
  let brief: QueryStrategyBrief;
  try {
    const prompt = buildQueryStrategyBriefPrompt(args.input);
    const result = await generateText({
      model: anthropic(args.model),
      prompt,
      temperature: 0.12
    });
    brief = parseQueryStrategyBriefJson(result.text);
  } catch (error) {
    console.warn(
      `[brief] strategy brief generation failed, using fallback: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    brief = buildFallbackStrategyBrief(args.input, error);
  }

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

function buildFallbackStrategyBrief(input: QueryComposerInput, error: unknown): QueryStrategyBrief {
  const subjectName = input.subject.name;
  const industry = input.subject.industry ?? "la categoria";
  const competitors = input.competitors.slice(0, 8);
  const businessQuestion = input.corpus.businessQuestion ?? "";
  return {
    summary:
      businessQuestion ||
      `Brief base para ${subjectName} en ${industry}. Generado por fallback porque el LLM no respondio.`,
    priority_topics: [subjectName, industry].filter(Boolean),
    audience_clues: input.corpus.audienceSegment ? [input.corpus.audienceSegment] : [],
    competitor_hypotheses: competitors.map((name) => `Comparar ${subjectName} contra ${name}.`),
    query_language: [subjectName, ...competitors].filter(Boolean).slice(0, 24),
    exclusions_or_noise: [],
    brand_query_role: `Capturar menciones de ${subjectName}.`,
    competitor_query_role:
      competitors.length > 0
        ? `Capturar menciones de competidores: ${competitors.join(", ")}.`
        : "",
    industry_query_role:
      input.subject.industry || input.subject.industrySub
        ? `Capturar conversacion de categoria sobre ${industry}.`
        : "",
    must_answer: businessQuestion ? [businessQuestion] : [],
    limitations: [
      `Brief generado por fallback (sin LLM). Motivo: ${
        error instanceof Error ? error.message : String(error)
      }`
    ]
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
