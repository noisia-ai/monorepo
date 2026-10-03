import assert from "node:assert/strict";
import test from "node:test";

import { buildFallbackQuery, buildLensQueryPacks, validatePortableListenQuery } from "./index";
import { ENGINE_METHODOLOGY_SLUGS, isEngineRunnableMethodologySlug } from "./engine";
import { LENS_QUERY_PACK_TEMPLATES } from "./lens-query-packs";
import type { ComposedQuery, QueryComposerInput } from "./index";

const input: QueryComposerInput = {
  corpus: {
    id: "corpus-1",
    name: "Takis",
    businessQuestion: "Entender la marca frente a categoría y competencia.",
    decisionToInform: "Priorizar narrativa, valor y riesgo.",
    audienceSegment: "Consumidores MX",
    geoFocus: ["MX"],
    targetWindowMonths: 6,
    contextForm: {}
  },
  subject: {
    type: "brand",
    name: "Takis",
    slug: "takis",
    industry: "snacks",
    industrySub: "botanas",
    countries: ["MX"],
    brandSeedHandles: ["@TakisMX"],
    description: null
  },
  methodology: {
    slug: "triggers-barriers",
    name: "Triggers & Barriers",
    version: "1.0",
    manifest: {}
  },
  competitors: ["Sabritas", "Doritos"],
  competitorEntities: [
    { name: "Sabritas", aliases: ["Sabritas MX"] },
    { name: "Doritos", handles: ["@DoritosMX"] }
  ],
  brandSeeds: ["Takis"],
  knowledgeSources: [],
  memoryIndustry: [],
  memoryBrand: []
};

const composed: ComposedQuery = {
  query_text: '("Takis") AND ("me gusta" OR "no me gusta")',
  competitor_queries: [
    { entity: "Sabritas", query_text: '("Sabritas" OR "Sabritas MX") AND NOT ("receta")' },
    { entity: "Doritos", query_text: '("Doritos" OR @DoritosMX) AND NOT ("receta")' }
  ],
  competitor_query_text: '("Sabritas" OR "Doritos") AND ("me gusta" OR "no me gusta")',
  industry_query_text: '("snacks" OR "botanas") AND ("me gusta" OR "no me gusta")',
  query_components: {
    brand_seeds: ["Takis", "@TakisMX"],
    competitor_seeds: ["Sabritas", "Doritos"],
    category_seeds: ["snacks", "botanas"],
    trigger_phrases_tb: ["me gusta"],
    barrier_phrases_tb: ["no me gusta"],
    knowledge_query_language: ["pica rico"],
    global_exclusions: ["receta"],
    memory_industry: [],
    memory_brand: []
  }
};

test("query packs materialize every selected active lens without arbitrary subset", () => {
  const packs = buildLensQueryPacks({
    input,
    composed,
    analysisPlan: {
      version: 1,
      primary_methodology_slug: "triggers-barriers",
      selected_lenses: [
        "triggers-barriers",
        "competitive-wave",
        "narrative-ownership",
        "value-perception-matrix",
        "brand-positioning-map",
        "category-opportunity-map",
        "white-space-analysis",
        "journey-friction-mapping",
        "decision-velocity",
        "cultural-codes-decoding",
        "sentiment-advocacy-proxy",
        "audience-segment-lens",
        "influence-architecture",
        "trust-risk-benchmark",
        "evidence-confidence-layer"
      ]
    }
  });

  const byLens = new Map<string, number>();
  for (const pack of packs) {
    byLens.set(pack.lensSlug, (byLens.get(pack.lensSlug) ?? 0) + 1);
  }

  assert.equal(byLens.get("triggers-barriers"), 4);
  assert.equal(byLens.get("competitive-wave"), 4);
  assert.equal(byLens.get("narrative-ownership"), 4);
  assert.equal(byLens.get("value-perception-matrix"), 4);
  assert.equal(byLens.get("brand-positioning-map"), 4);
  assert.equal(byLens.get("category-opportunity-map"), 4);
  assert.equal(byLens.get("white-space-analysis"), 4);
  assert.equal(byLens.get("journey-friction-mapping"), 2);
  assert.equal(byLens.get("decision-velocity"), 2);
  assert.equal(byLens.get("cultural-codes-decoding"), 2);
  assert.equal(byLens.get("sentiment-advocacy-proxy"), 3);
  assert.equal(byLens.get("audience-segment-lens"), 2);
  assert.equal(byLens.get("influence-architecture"), 4);
  assert.equal(byLens.get("trust-risk-benchmark"), 4);
  assert.equal(byLens.get("evidence-confidence-layer"), 1);
  assert.equal(packs.length, 48);
});

test("query pack registry covers every runnable engine methodology", () => {
  const templateSlugs = new Set(LENS_QUERY_PACK_TEMPLATES.map((template) => template.lensSlug));
  assert.equal(templateSlugs.has("triggers-barriers"), true);

  for (const slug of ENGINE_METHODOLOGY_SLUGS.filter(isEngineRunnableMethodologySlug)) {
    assert.equal(templateSlugs.has(slug), true, `${slug} needs query pack templates before it can be selected`);
  }
});

test("every lens pack scope is reachable by the CSV import fan-out vocabulary", () => {
  // INVARIANT: services/workers/src/workers/mentions-csv-ingest.ts resolveQueryScope()
  // only ever emits these scopes for imported batches, and the fan-out links a
  // mention to other lens packs by matching `scope` exactly. If a template ever
  // introduces a scope outside this set (e.g. "baseline"), that lens silently
  // receives ZERO fanned-out mentions and shows up empty/blocked in the Signal.
  const csvFannableScopes = new Set(["brand", "competitors", "category"]);
  const offenders = LENS_QUERY_PACK_TEMPLATES
    .filter((template) => !csvFannableScopes.has(template.scope))
    .map((template) => `${template.lensSlug}:${template.signalIntent}:${template.scope}`);

  assert.deepEqual(
    offenders,
    [],
    `These lens packs use a scope the CSV import fan-out cannot match: ${offenders.join(", ")}`
  );
});

test("T&B packs preserve canonical retrieval and split competitors by entity", () => {
  const packs = buildLensQueryPacks({
    input,
    composed,
    analysisPlan: { selected_lenses: ["triggers-barriers"] }
  });

  assert.deepEqual(
    packs.map((pack) => [pack.lensSlug, pack.signalIntent, pack.scope, pack.entityKey, pack.queryText]),
    [
      ["triggers-barriers", "decision_signal", "brand", "brand", composed.query_text],
      ["triggers-barriers", "competitive_signal", "competitors", "competitor:sabritas", composed.competitor_queries?.[0]?.query_text],
      ["triggers-barriers", "competitive_signal", "competitors", "competitor:doritos", composed.competitor_queries?.[1]?.query_text],
      ["triggers-barriers", "category_signal", "category", "category", composed.industry_query_text]
    ]
  );
});

test("Signal Pulse preserves canonical queries and treats marketing language as post-ingest metadata", () => {
  const packs = buildLensQueryPacks({
    input: {
      ...input,
      methodology: {
        slug: "signal-pulse",
        name: "Signal Pulse",
        version: "0.1",
        manifest: {}
      }
    },
    composed,
    analysisPlan: { primary_methodology_slug: "signal-pulse", selected_lenses: ["signal-pulse"] }
  }).filter((pack) => pack.lensSlug === "signal-pulse");

  assert.deepEqual(
    packs.map((pack) => [pack.signalIntent, pack.scope, pack.entityKey]),
    [
      ["marketing_signal", "brand", "brand"],
      ["marketing_signal", "competitors", "competitor:sabritas"],
      ["marketing_signal", "competitors", "competitor:doritos"],
      ["marketing_signal", "category", "category"]
    ]
  );
  assert.equal(packs[0]?.queryText, composed.query_text);
  assert.deepEqual(
    (packs[0]?.queryComponents.post_ingest_phrase_hints as string[]).slice(0, 4),
    ["esta de moda", "lo vi en", "vi un video", "trend"]
  );
  assert.equal(packs[0]?.queryComponents.classification_policy, "post_ingest");
  assert.equal(packs.every((pack) => pack.seeds.required === true), true);
});

test("non-T&B packs preserve retrieval and attach lens-specific classification provenance", () => {
  const [pack] = buildLensQueryPacks({
    input,
    composed,
    analysisPlan: { selected_lenses: ["narrative-ownership"] }
  }).filter((candidate) => candidate.lensSlug === "narrative-ownership" && candidate.scope === "brand");

  assert.ok(pack);
  assert.equal(pack.queryText, composed.query_text);
  assert.deepEqual(
    (pack.queryComponents.post_ingest_phrase_hints as string[]).slice(0, 3),
    ["confío en", "no confío", "letra chica"]
  );
  assert.equal(pack.queryComponents.retrieval_policy, "canonical_entity_query");
  assert.equal(pack.seeds.lens_slug, "narrative-ownership");
  assert.equal(pack.evaluation.status, "awaiting_imported_evidence");
  assert.equal(pack.status, "planned");
});

test("every materialized pack passes the portable structural compiler", () => {
  const governedFallback = buildFallbackQuery(input);
  const packs = buildLensQueryPacks({
    input,
    composed: {
      ...governedFallback,
      query_components: {
        ...governedFallback.query_components
      }
    },
    analysisPlan: {
      selected_lenses: Array.from(new Set(LENS_QUERY_PACK_TEMPLATES.map((template) => template.lensSlug)))
    }
  });

  for (const pack of packs) {
    const validation = validatePortableListenQuery(pack.queryText);
    const contract = pack.queryComponents.generation_contract as {
      dialect_version?: string;
      construction_plan?: {
        version?: string;
        tag_plan?: {
          application?: string;
          tags?: Array<{ key?: string; expression?: string }>;
        };
      };
    } | undefined;
    assert.equal(validation.valid, true, `${pack.lensSlug}/${pack.scope}: ${JSON.stringify(validation.errors)}`);
    assert.ok(validation.stats.length <= 12_000);
    assert.equal(pack.queryComponents.structural_validation && typeof pack.queryComponents.structural_validation, "object");
    assert.equal(contract?.dialect_version, "portable-listen-v2");
    assert.equal(contract?.construction_plan?.version, "query-construction-v2");
    assert.equal(contract?.construction_plan?.tag_plan?.application, "post_ingest");
    assert.equal(
      contract?.construction_plan?.tag_plan?.tags?.every(
        (tag) => Boolean(tag.key) && Boolean(tag.expression)
      ),
      true
    );
    assert.equal(pack.queryComponents.entity_key, pack.entityKey);
    assert.equal(pack.queryComponents.query_identity, pack.entityKey);

    if (pack.scope === "competitors") {
      assert.match(pack.entityKey ?? "", /^competitor:/);
      assert.ok(pack.entityLabel);
      assert.equal(pack.seeds.entity_key, pack.entityKey);
    }
  }
});
