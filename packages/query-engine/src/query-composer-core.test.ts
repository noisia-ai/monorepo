import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptStudyQueryComposerInputV1,
  buildFallbackQuery,
  buildGenerationContract,
  buildQueryComposerPrompt,
  composeQueryDraftWithProviderV1,
  queryComposerCoreInputDigestV1,
  queryComposerGenerationLineageDigestV1,
  validateQueryComposerAcquisitionBriefV1,
  validateQueryComposerGenerationLineageV1,
  validateSignalAcquisitionQueryVersionInputV1,
  type QueryComposerCoreInput,
  type QueryComposerInput
} from "./index";

const hash = (character: string) => `sha256:${character.repeat(64)}`;

function coreInput(): QueryComposerCoreInput {
  return {
    contractVersion: "query-composer-core-v1",
    brief: {
      contract_version: "signal-acquisition-brief-v1",
      objective: "Escuchar la conversación pública sobre asistentes de voz",
      purpose: "Adquisición gobernada",
      market: "México",
      countries: ["MX"],
      languages: ["es"],
      timezone: "America/Mexico_City",
      default_capture_period: { start: "2026-01-01", end: "2026-08-15" },
      target_window_months: 8,
      construction_mode: "exploratory",
      brand_os_profile_version: 3,
      brand_os_digest: hash("a"),
      identity_catalog_digest: hash("b"),
      knowledge_context_digest: hash("c"),
      knowledge_context_refs: [hash("d")],
      provider_key: "sentione",
      provider_syntax_version: "sentione-query-v1",
      provider_schema_version: "sentione-csv-47-v1",
      optional_study_context: null
    },
    subject: {
      type: "brand",
      name: "Ñandú Voz",
      slug: "nandu-voz",
      industry: "Asistentes de voz",
      industrySub: "Hogar inteligente",
      categoryAliases: ["Asistentes inteligentes"],
      countries: ["MX"],
      brandSeedHandles: ["@nanduvoz"],
      description: "Marca sintética"
    },
    methodology: {
      slug: "triggers-barriers",
      name: "Acquisition",
      version: "1",
      manifest: { query_mode: "exploratory", global_exclusions: ["homónimo"] }
    },
    competitors: ["Eco Voz", "Éko Voz"],
    competitorEntities: [
      { key: `competitor-sha256-${"1".repeat(64)}`, name: "Eco Voz", aliases: ["Eco Home"] },
      { key: `competitor-sha256-${"2".repeat(64)}`, name: "Éko Voz", aliases: ["Eko Hogar"] }
    ],
    brandSeeds: ["Ñandú Voz", "Nandu Voz"],
    knowledgeSources: [{ type: "brand_os", content: { query_language: ["asistente en español"] } }],
    memoryIndustry: [],
    memoryBrand: []
  };
}

test("pure composer input contains no study corpus identity and hashes canonically", () => {
  const input = coreInput();
  assert.equal("corpus" in input, false);
  assert.doesNotMatch(buildQueryComposerPrompt(input), /study_corpus_id/iu);
  assert.doesNotMatch(buildQueryComposerPrompt(input), /Study OS/u);
  assert.equal(queryComposerCoreInputDigestV1(input), queryComposerCoreInputDigestV1({
    ...input,
    brief: { ...input.brief },
    subject: { ...input.subject }
  }));
});

test("legacy Study OS adapter preserves the canonical construction result without leaking its corpus id", () => {
  const legacy: QueryComposerInput = {
    corpus: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Legacy study",
      businessQuestion: "¿Qué conversación debemos adquirir?",
      decisionToInform: "Listening",
      audienceSegment: null,
      geoFocus: ["MX"],
      targetWindowMonths: 8,
      contextForm: {}
    },
    subject: coreInput().subject,
    methodology: coreInput().methodology,
    competitors: coreInput().competitors,
    competitorEntities: coreInput().competitorEntities,
    brandSeeds: coreInput().brandSeeds,
    knowledgeSources: coreInput().knowledgeSources,
    memoryIndustry: [],
    memoryBrand: []
  };
  const adapted = adaptStudyQueryComposerInputV1(legacy);
  assert.equal("corpus" in adapted, false);
  assert.equal(adapted.brief.optional_study_context?.reference_hash.includes(legacy.corpus.id), false);
  assert.match(buildQueryComposerPrompt(adapted), /Brand OS \+ Study OS/u);
  assert.deepEqual(buildFallbackQuery(legacy), buildFallbackQuery(adapted));
});

test("primary, category and similar competitor aliases remain isolated by adapter-owned slot key", () => {
  const input = coreInput();
  const fallback = buildFallbackQuery(input);
  assert.equal(fallback.competitor_queries?.length, 2);
  assert.deepEqual(fallback.competitor_queries?.map((item) => item.entity), [
    `competitor-sha256-${"1".repeat(64)}`,
    `competitor-sha256-${"2".repeat(64)}`
  ]);
  assert.match(fallback.query_text, /Ñandú Voz|Nandu Voz/u);
  assert.match(fallback.industry_query_text ?? "", /Asistentes de voz/iu);
  assert.match(fallback.industry_query_text ?? "", /Asistentes inteligentes/iu);
  assert.match(fallback.competitor_queries?.[0]?.query_text ?? "", /Eco Voz/u);
  assert.match(fallback.competitor_queries?.[1]?.query_text ?? "", /Éko Voz/u);
  const contract = buildGenerationContract(input, {
    brand: fallback.query_text,
    category: fallback.industry_query_text ?? "",
    ...Object.fromEntries((fallback.competitor_queries ?? []).map((item) => [
      `competitor:${item.entity}`, item.query_text
    ]))
  });
  assert.equal(contract.rag_scopes.join(","), "brand_os");
  assert.equal(contract.required_query_keys?.length, 4);
});

test("provider omission or invented slots cannot be reassigned and falls back after one repair", async () => {
  const calls: string[] = [];
  const result = await composeQueryDraftWithProviderV1({
    input: coreInput(),
    model: "fixture-model",
    provider: {
      async generate(request) {
        calls.push(request.phase);
        return {
          text: JSON.stringify({
            query_text: "invented unvalidated text",
            competitor_queries: [{ entity: "invented-competitor", query_text: "invented" }]
          })
        };
      }
    }
  });
  assert.deepEqual(calls, ["compose", "repair"]);
  assert.equal(result.query_components.fallback_used, true);
  assert.equal(result.competitor_queries?.length, 2);
  assert.equal(result.competitor_queries?.some((item) => item.entity === "invented-competitor"), false);
  assert.deepEqual(result.query_components.generation_contract?.fallback_scopes, [
    "brand",
    `competitor:competitor-sha256-${"1".repeat(64)}`,
    `competitor:competitor-sha256-${"2".repeat(64)}`,
    "category"
  ]);
});

test("valid provider fixture returns all required identities without a repair call", async () => {
  const input = coreInput();
  const fallback = buildFallbackQuery(input);
  let calls = 0;
  const result = await composeQueryDraftWithProviderV1({
    input,
    model: "fixture-model",
    provider: {
      async generate() {
        calls += 1;
        return { text: JSON.stringify({
          query_text: fallback.query_text,
          competitor_queries: fallback.competitor_queries,
          industry_query_text: fallback.industry_query_text
        }) };
      }
    }
  });
  assert.equal(calls, 1);
  assert.equal(result.query_components.fallback_used, false);
  assert.equal(result.query_components.generation_contract?.required_query_keys?.length, 4);
});

test("brief and lineage contracts reject browser-owned IDs, unknown fields and inconsistent fallback", () => {
  const brief = coreInput().brief;
  assert.deepEqual(validateQueryComposerAcquisitionBriefV1(brief), brief);
  assert.throws(() => validateQueryComposerAcquisitionBriefV1({
    ...brief,
    workspace_id: "00000000-0000-0000-0000-000000000001"
  }), /shape is invalid/u);
  assert.throws(() => validateQueryComposerAcquisitionBriefV1({
    ...brief,
    optional_study_context: {
      study_corpus_id: "00000000-0000-0000-0000-000000000001",
      reference_hash: hash("e"),
      digest: hash("f")
    }
  }), /shape is invalid/u);
  const lineage = {
    contract_version: "signal-query-composer-lineage-v1" as const,
    model: "fixture-model",
    pipeline_version: "fixture-pipeline",
    prompt_template_digest: hash("1"),
    context_digest: hash("2"),
    construction_plan_digest: hash("3"),
    validation_report_digest: hash("4"),
    fallback_used: false,
    fallback_reason: null,
    optional_study_context: null,
    generated_at: "2026-08-15T12:00:00.000Z"
  };
  assert.equal(queryComposerGenerationLineageDigestV1(lineage),
    queryComposerGenerationLineageDigestV1({ ...lineage }));
  assert.deepEqual(validateQueryComposerGenerationLineageV1(lineage), lineage);
  assert.throws(() => validateQueryComposerGenerationLineageV1({
    ...lineage,
    fallback_used: true
  }), /fallback lineage is inconsistent/u);
  assert.throws(() => validateSignalAcquisitionQueryVersionInputV1({
    source_key: `source-sha256-${"a".repeat(64)}`,
    provider: "sentione",
    provider_syntax_version: "sentione-query-v1",
    provider_schema_version: "sentione-csv-47-v1",
    query_text: "brand",
    structured_terms: { include: ["brand"], exclude: [], aliases: [] },
    cadence: "manual",
    default_period: null,
    origin_kind: "engine-generated"
  }), /unknown fields: origin_kind/u);
});
