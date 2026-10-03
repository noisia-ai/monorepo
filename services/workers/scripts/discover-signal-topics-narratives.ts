import { createHash } from "node:crypto";

import { anthropic } from "@ai-sdk/anthropic";
import {
  createSignalTaxonomyDraftStoreV1,
  getDatabaseSslConfig,
  loadSignalTaxonomyDiscoveryContextStoreV1,
  requireSafeDatabaseWriteTarget
} from "@noisia/db";
import {
  embedTexts,
  getEmbeddingModel,
  normalizeSignalTaxonomyProposalV1,
  signalTaxonomyContextHashV1,
  vectorLiteral,
  type SignalTaxonomyCandidateV1,
  type SignalTaxonomyKindV1
} from "@noisia/query-engine";
import { generateObject, NoObjectGeneratedError } from "ai";
import pg from "pg";
import { z } from "zod";

import {
  estimateModelCostUsd,
  positiveTokenInteger
} from "../src/workers/engine-cost";

const ALLOW_REMOTE_ENV = "NOISIA_SIGNAL_TAXONOMY_DISCOVERY_ALLOW_REMOTE";
const APPROVAL_ENV = "NOISIA_SIGNAL_TAXONOMY_DISCOVERY_APPROVED";
const DISCOVERY_ENABLED_ENV = "NOISIA_SIGNAL_TAXONOMY_DISCOVERY_ENABLED";
const LLM_ENABLED_ENV = "NOISIA_SIGNAL_TAXONOMY_LLM_ENABLED";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const candidateSchema = z.object({
  term_key: z.string().regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u),
  label: z.string().min(1).max(160),
  definition: z.string().min(1).max(800),
  statement: z.string().min(3).max(300).nullable(),
  examples: z.array(z.string().min(1).max(500)).min(1).max(8),
  exclusions: z.array(z.string().min(1).max(500)).max(8)
});
const proposalSchema = z.object({
  terms: z.array(candidateSchema).min(5).max(20)
});

type Args = {
  corpusId: string;
  historicalOutputId: string;
  budgetCapUsd: number;
  priorCostUsd: number;
};

type Scope = {
  workspace_id: string;
  study_corpus_id: string;
  corpus_revision: number;
  organization_id: string;
  brand_id: string | null;
  historical_output_status: string;
  subject_matches: boolean;
  active_operational_memberships: number;
};

type RagItem = {
  source_type: "knowledge_chunk";
  source_id: string;
  version: string;
  content: string;
  content_hash: string;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = requireEnv("DATABASE_URL");
  requireSafeDatabaseWriteTarget(databaseUrl, {
    operation: "discover Signal Topics & Narratives taxonomy drafts",
    allowRemoteEnv: ALLOW_REMOTE_ENV
  });
  requireLiteralTrue(APPROVAL_ENV);
  requireLiteralTrue(DISCOVERY_ENABLED_ENV);
  requireLiteralTrue(LLM_ENABLED_ENV);
  requireEnv("ANTHROPIC_API_KEY");
  requireEnv("VOYAGE_API_KEY");

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig(),
    max: 3
  });
  try {
    const scope = await resolveScope(pool, args);
    const existing = await loadExistingDrafts(pool, scope.workspace_id);
    if (existing.length > 0) {
      console.log(JSON.stringify({
        contract_version: "signal-topics-narratives-v1",
        mode: "existing_drafts",
        paid_provider_invoked: false,
        total_cost_usd: 0,
        profiles: existing
      }, null, 2));
      return;
    }

    const model = process.env.NOISIA_SIGNAL_TAXONOMY_DISCOVERY_MODEL
      ?? process.env.ANTHROPIC_MODEL_DEFAULT
      ?? "claude-sonnet-4-6";
    let totalCostUsd = args.priorCostUsd;
    const profiles = [];
    for (const kind of ["topic", "narrative"] as const) {
      const baseContext = await loadSignalTaxonomyDiscoveryContextStoreV1({
        pool,
        workspace_id: scope.workspace_id,
        study_corpus_id: scope.study_corpus_id,
        kind
      });
      const rag = await retrieveVersionedContext({
        pool,
        scope,
        kind,
        baseContext: baseContext.context_items
      });
      const allItems = [...baseContext.context_items, ...rag];
      const allRefs = allItems.map(
        ({ source_type, source_id, version, content_hash }) => ({
          source_type,
          source_id,
          version,
          content_hash
        })
      );
      const contextHash = signalTaxonomyContextHashV1(allRefs);
      const prompt = discoveryPrompt(kind, allItems);
      const estimatedInputTokens = Math.ceil(prompt.length / 4);
      const estimatedOutputTokens = 4_500;
      const estimatedClaude = estimateModelCostUsd({
        provider: "anthropic",
        model,
        inputTokens: estimatedInputTokens,
        outputTokens: estimatedOutputTokens
      });
      if (estimatedClaude === null) {
        throw new Error("signal_taxonomy_discovery_model_pricing_unknown");
      }
      const voyageTokens = Math.ceil(
        allItems.reduce((sum, item) => sum + item.content.length, 0) / 4
      );
      const estimatedVoyage = voyageCostUsd(voyageTokens);
      if (totalCostUsd + estimatedClaude + estimatedVoyage > args.budgetCapUsd) {
        throw new Error("signal_taxonomy_discovery_budget_cap_reached");
      }

      const result = await generateTaxonomyObject({ model, prompt });
      const inputTokens = positiveTokenInteger(result.usage.inputTokens);
      const outputTokens = positiveTokenInteger(result.usage.outputTokens);
      const claudeCost = estimateModelCostUsd({
        provider: "anthropic",
        model,
        inputTokens,
        outputTokens
      });
      if (claudeCost === null) {
        throw new Error("signal_taxonomy_discovery_actual_cost_unknown");
      }
      const costUsd = claudeCost + estimatedVoyage;
      if (totalCostUsd + costUsd > args.budgetCapUsd) {
        throw new Error("signal_taxonomy_discovery_provider_exceeded_budget_cap");
      }
      const promptHash = sha256(discoveryPromptTemplate(kind));
      const normalized = normalizeSignalTaxonomyProposalV1({
        kind,
        terms: normalizeStatements(kind, result.object.terms),
        context_refs: allRefs,
        context_hash: contextHash,
        provider: "anthropic",
        model_version: model,
        prompt_hash: promptHash
      });
      const profile = await createSignalTaxonomyDraftStoreV1({
        pool,
        workspace_id: scope.workspace_id,
        study_corpus_id: scope.study_corpus_id,
        input: {
          kind,
          terms: normalized.terms,
          provider: "anthropic",
          model_version: model,
          prompt_hash: promptHash,
          expected_context_hash: contextHash,
          additional_context_items: rag,
          discovery_usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            voyage_tokens: voyageTokens,
            cost_usd: costUsd
          }
        }
      });
      totalCostUsd += costUsd;
      profiles.push({
        profile_id: profile.profile_id,
        kind: profile.kind,
        version: profile.version,
        status: profile.status,
        context_hash: profile.context_hash,
        terms: profile.terms,
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          voyage_tokens: voyageTokens,
          cost_usd: costUsd
        }
      });
    }
    console.log(JSON.stringify({
      contract_version: "signal-topics-narratives-v1",
      mode: "discovery",
      target: process.env.NOISIA_REMOTE_DATABASE_TARGET ?? "local",
      corpus_revision: scope.corpus_revision,
      budget_cap_usd: args.budgetCapUsd,
      prior_cost_reserve_usd: args.priorCostUsd,
      total_cost_usd: Number(totalCostUsd.toFixed(6)),
      paid_provider_invoked: true,
      human_approval_required: true,
      profiles
    }, null, 2));
  } finally {
    await pool.end();
  }
}

function parseArgs(argv: string[]): Args {
  const values = argv.filter((value) => value !== "--");
  const read = (name: string) => {
    const inline = values.find((item) => item.startsWith(`${name}=`));
    if (inline) return inline.slice(name.length + 1);
    const index = values.indexOf(name);
    return index >= 0 ? values[index + 1] : undefined;
  };
  const corpusId = read("--corpus-id")?.trim().toLowerCase() ?? "";
  const historicalOutputId =
    read("--historical-output-id")?.trim().toLowerCase() ?? "";
  const budgetCapUsd = Number(read("--budget-cap-usd"));
  const priorCostUsd = Number(read("--prior-cost-usd") ?? "0");
  if (!UUID.test(corpusId)) throw new Error("--corpus-id must be a UUID.");
  if (!UUID.test(historicalOutputId)) {
    throw new Error("--historical-output-id must be a UUID.");
  }
  if (!Number.isFinite(budgetCapUsd) || budgetCapUsd <= 0) {
    throw new Error("--budget-cap-usd must be a positive number.");
  }
  if (
    !Number.isFinite(priorCostUsd)
    || priorCostUsd < 0
    || priorCostUsd >= budgetCapUsd
  ) {
    throw new Error("--prior-cost-usd must be nonnegative and below the cap.");
  }
  return { corpusId, historicalOutputId, budgetCapUsd, priorCostUsd };
}

async function resolveScope(pool: pg.Pool, args: Args) {
  const result = await pool.query<Scope>(`
    WITH workspace_candidates AS (
      SELECT workspace.id, workspace.organization_id, workspace.brand_id,
        count(*) OVER ()::int AS active_operational_memberships
      FROM signal_workspace_corpora membership
      JOIN signal_workspaces workspace ON workspace.id = membership.workspace_id
      JOIN study_corpora corpus ON corpus.id = membership.study_corpus_id
      LEFT JOIN brands brand ON brand.id = corpus.brand_id
      LEFT JOIN themes theme ON theme.id = corpus.theme_id
      WHERE membership.study_corpus_id = $1::uuid
        AND membership.role = 'operational'
        AND membership.valid_to IS NULL
        AND workspace.status = 'active'
        AND workspace.organization_id = COALESCE(
          brand.organization_id,
          theme.organization_id
        )
        AND workspace.brand_id IS NOT DISTINCT FROM corpus.brand_id
        AND workspace.theme_id IS NOT DISTINCT FROM corpus.theme_id
    )
    SELECT candidate.id::text AS workspace_id,
      corpus.id::text AS study_corpus_id, corpus.corpus_revision,
      candidate.organization_id::text, candidate.brand_id::text,
      output.status AS historical_output_status,
      (
        output.study_corpus_id = corpus.id
        AND output.brand_id IS NOT DISTINCT FROM corpus.brand_id
        AND output.theme_id IS NOT DISTINCT FROM corpus.theme_id
      ) AS subject_matches,
      candidate.active_operational_memberships
    FROM study_corpora corpus
    JOIN published_outputs output
      ON output.id = $2::uuid
     AND output.study_corpus_id = corpus.id
    JOIN workspace_candidates candidate ON true
    WHERE corpus.id = $1::uuid
  `, [args.corpusId, args.historicalOutputId]);
  const row = result.rows[0];
  if (
    !row
    || result.rows.length !== 1
    || row.active_operational_memberships !== 1
    || !row.subject_matches
    || row.historical_output_status !== "published"
  ) {
    throw new Error("signal_taxonomy_discovery_scope_not_governed");
  }
  return row;
}

async function loadExistingDrafts(pool: pg.Pool, workspaceId: string) {
  const result = await pool.query(`
    SELECT profile.id::text AS profile_id, profile.kind, profile.version,
      profile.status, profile.context_hash,
      COALESCE(jsonb_agg(jsonb_build_object(
        'term_key', term.term_key,
        'label', term.label,
        'definition', term.description,
        'statement', term.metadata->>'statement',
        'examples', COALESCE(term.metadata->'examples', '[]'::jsonb),
        'exclusions', COALESCE(term.metadata->'exclusions', '[]'::jsonb)
      ) ORDER BY term.sort_order, term.term_key)
      FILTER (WHERE term.id IS NOT NULL), '[]'::jsonb) AS terms
    FROM signal_taxonomy_profiles profile
    LEFT JOIN taxonomy_terms term ON term.taxonomy_id = profile.taxonomy_id
    WHERE profile.workspace_id = $1::uuid
      AND profile.status = 'draft'
    GROUP BY profile.id
    ORDER BY profile.kind, profile.version DESC
  `, [workspaceId]);
  return result.rows;
}

async function retrieveVersionedContext(args: {
  pool: pg.Pool;
  scope: Scope;
  kind: SignalTaxonomyKindV1;
  baseContext: Array<{ content: string }>;
}): Promise<RagItem[]> {
  const queryText = [
    args.kind === "topic"
      ? "Temas concretos de los que hablan las personas."
      : "Afirmaciones, historias y marcos recurrentes que construyen las personas.",
    ...args.baseContext.map((item) => item.content)
  ].join("\n").slice(0, 16_000);
  const model = getEmbeddingModel("voyage");
  const [embedded] = await embedTexts({
    provider: "voyage",
    model,
    inputType: "query",
    inputs: [{ id: `discovery-${args.kind}`, text: queryText }]
  });
  if (!embedded) return [];
  const result = await args.pool.query<{
    source_id: string;
    chunk_hash: string;
    embedding_model: string;
    content: string;
  }>(`
    SELECT embedding.source_id::text, embedding.chunk_hash,
      embedding.embedding_model, left(embedding.chunk_text, 1600) AS content
    FROM semantic_embeddings embedding
    WHERE embedding.scope_type = 'knowledge_source'
      AND embedding.embedding_model = $4
      AND (
        embedding.study_corpus_id = $1::uuid
        OR ($2::uuid IS NOT NULL AND embedding.brand_id = $2::uuid)
      )
    ORDER BY embedding.embedding <=> $3::vector, embedding.id
    LIMIT 12
  `, [
    args.scope.study_corpus_id,
    args.scope.brand_id,
    vectorLiteral(embedded.embedding),
    model
  ]);
  return result.rows.map((row) => ({
    source_type: "knowledge_chunk" as const,
    source_id: row.source_id,
    version: `embedding:${row.embedding_model}:${row.chunk_hash}`,
    content: row.content,
    content_hash: sha256(row.content)
  }));
}

function discoveryPrompt(
  kind: SignalTaxonomyKindV1,
  context: Array<{ content: string }>
) {
  let remaining = 64_000;
  const boundedContext = [];
  for (const item of context) {
    if (remaining <= 0) break;
    const content = item.content.slice(0, Math.min(900, remaining));
    if (!content) continue;
    boundedContext.push(content);
    remaining -= content.length;
  }
  return [
    discoveryPromptTemplate(kind),
    "Contexto gobernado y muestras versionadas:",
    JSON.stringify(boundedContext)
  ].join("\n");
}

function discoveryPromptTemplate(kind: SignalTaxonomyKindV1) {
  return [
    "Propón una taxonomía client-safe para Social Listening de la marca Laika.",
    "Devuelve entre 5 y 20 términos no solapados, arraigados únicamente en el contexto.",
    "No calcules métricas. No inventes prevalencia ni conclusiones estratégicas.",
    "Devuelve únicamente JSON válido con la forma {\"terms\":[...]}; sin markdown ni explicación.",
    "No conviertas triggers, barriers, decision layers, observed signals, findings, oportunidades o recomendaciones en términos.",
    "term_key debe ser snake_case ASCII; labels, definiciones, ejemplos y exclusiones en español claro.",
    kind === "topic"
      ? "TOPIC responde de qué se habla: sujetos concretos. statement debe ser null."
      : "NARRATIVE responde qué afirmación, historia o marco se construye. statement debe ser una proposición explícita."
  ].join("\n");
}

async function generateTaxonomyObject(args: { model: string; prompt: string }) {
  try {
    const result = await generateObject({
      model: anthropic(args.model),
      schema: proposalSchema,
      temperature: 0,
      maxRetries: 1,
      maxOutputTokens: 6_000,
      abortSignal: AbortSignal.timeout(150_000),
      prompt: args.prompt
    });
    return { object: result.object, usage: result.usage };
  } catch (error) {
    if (!NoObjectGeneratedError.isInstance(error) || !error.text) throw error;
    const parsed = parseGeneratedJson(error.text);
    const validated = proposalSchema.safeParse(parsed);
    if (!validated.success || !error.usage) throw error;
    return { object: validated.data, usage: error.usage };
  }
}

function parseGeneratedJson(text: string): unknown {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "");
  const first = clean.indexOf("{");
  const last = clean.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try {
    return JSON.parse(clean.slice(first, last + 1));
  } catch {
    return null;
  }
}

function normalizeStatements(
  kind: SignalTaxonomyKindV1,
  terms: z.infer<typeof candidateSchema>[]
): SignalTaxonomyCandidateV1[] {
  return terms.map((term) => ({
    ...term,
    statement: kind === "topic" ? null : term.statement
  }));
}

function voyageCostUsd(tokens: number) {
  const rate = Number(
    process.env.NOISIA_SIGNAL_TAXONOMY_VOYAGE_USD_PER_MILLION_TOKENS
      ?? "0.12"
  );
  if (!Number.isFinite(rate) || rate < 0) {
    throw new Error("signal_taxonomy_voyage_pricing_invalid");
  }
  return (tokens / 1_000_000) * rate;
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requireLiteralTrue(name: string) {
  if (process.env[name] !== "true") throw new Error(`${name}=true is required.`);
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
