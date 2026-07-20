import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFallbackQuery,
  buildQueryComposerPrompt,
  buildSampleEvaluatorPrompt,
  buildQueryStrategyBriefPrompt,
  parseComposedQueryJson,
  type QueryComposerInput
} from "./index";

function composerInput(overrides: Partial<QueryComposerInput> = {}): QueryComposerInput {
  const base: QueryComposerInput = {
    corpus: {
      id: "corpus-1",
      name: "Laika study",
      businessQuestion: "¿Qué impide la recompra?",
      decisionToInform: "Retention",
      audienceSegment: "Members without repurchase",
      geoFocus: ["MX"],
      targetWindowMonths: 12,
      contextForm: { hypotheses: ["La membresía no comunica valor recurrente"] }
    },
    subject: {
      type: "brand",
      name: "Laika Mascotas",
      slug: "laika",
      industry: "Pet care",
      industrySub: "Pet ecommerce",
      countries: ["MX"],
      brandSeedHandles: ["@laikamascotas"],
      description: "Pet commerce brand"
    },
    methodology: {
      slug: "triggers-barriers",
      name: "Triggers & Barriers",
      version: "1.0",
      manifest: {
        signal_phrases: {
          triggers_generic: ["vale la pena"],
          barriers_generic: ["no volví"]
        }
      }
    },
    competitors: ["Petco México"],
    brandSeeds: ["Laika Mascotas", "@laikamascotas"],
    knowledgeSources: [
      { type: "brand_os", content: { aliases: ["Laika MX"] } },
      { type: "study_context", content: { objective: "Understand repurchase" } }
    ],
    memoryIndustry: [],
    memoryBrand: []
  };

  return {
    ...base,
    ...overrides,
    corpus: { ...base.corpus, ...(overrides.corpus ?? {}) },
    subject: { ...base.subject, ...(overrides.subject ?? {}) },
    methodology: { ...base.methodology, ...(overrides.methodology ?? {}) }
  };
}

test("composer prompt identifies governed Brand OS and Study OS RAG scopes", () => {
  const prompt = buildQueryComposerPrompt(composerInput());

  assert.match(prompt, /RAG gobernado: Brand OS \+ Study OS/);
  assert.match(prompt, /Produce exactamente los 3 scopes respaldados por Data OS/);
  assert.match(prompt, /No inventes un scope opcional/);
});

test("theme prompt uses Theme OS and only requires scopes backed by canonical seeds", () => {
  const input = composerInput({
    subject: {
      type: "theme",
      name: "Pet wellness",
      slug: "pet-wellness",
      industry: null,
      industrySub: null,
      countries: ["MX"],
      brandSeedHandles: [],
      description: "Category theme"
    },
    brandSeeds: ["pet wellness"],
    competitors: []
  });

  const composerPrompt = buildQueryComposerPrompt(input);
  const strategyPrompt = buildQueryStrategyBriefPrompt(input);

  assert.match(composerPrompt, /RAG gobernado: Theme OS \+ Study OS/);
  assert.match(composerPrompt, /Produce exactamente los 2 scopes respaldados por Data OS/);
  assert.match(strategyPrompt, /Study OS, Theme OS y Knowledge Sources/);
  assert.match(strategyPrompt, /"competitor_query_role": ""/);
  assert.match(strategyPrompt, /"industry_query_role": "Medir si la tension es de categoria/);
});

test("invalid generated syntax falls back while invented optional scopes are discarded", () => {
  const input = composerInput({
    subject: {
      type: "theme",
      name: "Pet wellness",
      slug: "pet-wellness",
      industry: null,
      industrySub: null,
      countries: ["MX"],
      brandSeedHandles: [],
      description: "Category theme"
    },
    brandSeeds: ["pet wellness"],
    competitors: []
  });
  const composed = parseComposedQueryJson(
    JSON.stringify({
      query_text: '"pet wellness" "no volví"',
      competitor_query_text: '("Invented competitor") AND (recompra)',
      industry_query_text: '(mascotas) AND (recompra)',
      query_components: { competitor_seeds: ["Invented competitor"] }
    }),
    input,
    "claude-test"
  );

  assert.equal(composed.competitor_query_text, undefined);
  assert.match(composed.industry_query_text ?? "", /tienda de mascotas/);
  assert.deepEqual(composed.query_components.competitor_seeds, []);
  assert.deepEqual(composed.query_components.generation_contract?.required_scopes, ["brand", "category"]);
  assert.deepEqual(composed.query_components.generation_contract?.fallback_scopes, ["brand", "category"]);
  assert.equal(composed.query_components.generation_contract?.queries.brand?.valid, true);
  assert.equal(composed.query_components.generation_contract?.rejected_queries?.competitors, undefined);
});

test("valid generated scopes retain compiler reports and avoid fallback", () => {
  const input = composerInput();
  const governedCandidate = buildFallbackQuery(input);
  const composed = parseComposedQueryJson(
    JSON.stringify({
      query_text: governedCandidate.query_text,
      competitor_queries: governedCandidate.competitor_queries,
      industry_query_text: governedCandidate.industry_query_text
    }),
    input,
    "claude-test"
  );

  assert.equal(composed.query_components.fallback_used, false);
  assert.deepEqual(
    composed.query_components.generation_contract?.required_scopes,
    ["brand", "competitors", "category"]
  );
  assert.ok(Object.values(composed.query_components.generation_contract?.queries ?? {}).every((report) => report.valid));
  assert.equal(composed.query_components.generation_contract?.rag_scopes.join(","), "brand_os,study_os");
});

test("semantic compiler replaces an over-filtered exploratory Laika query", () => {
  const input = composerInput();
  const governedCandidate = buildFallbackQuery(input);
  const composed = parseComposedQueryJson(
    JSON.stringify({
      query_text: '("Laika Mascotas" OR "Laika MX") AND ("lo compre porque" OR "me convencio" OR "no me conviene" OR "me frena")',
      competitor_queries: governedCandidate.competitor_queries,
      industry_query_text: governedCandidate.industry_query_text
    }),
    input,
    "claude-test"
  );

  const contract = composed.query_components.generation_contract;
  assert.equal(composed.query_components.fallback_used, true);
  assert.equal(contract?.fallback_scopes?.includes("brand"), true);
  assert.equal(
    contract?.rejected_semantic_queries?.brand?.errors.some(
      (issue) => issue.code === "exploratory_theme_gate"
    ),
    true
  );
  assert.equal(
    contract?.rejected_semantic_queries?.brand?.errors.some(
      (issue) => issue.code === "missing_preemptive_noise"
    ),
    true
  );
  assert.match(composed.query_text, /AND NOT/i);
  assert.match(composed.query_text, /Laika Studios/i);
  assert.doesNotMatch(composed.query_text, /me convencio/i);
});

test("exploratory evidence evaluator refines identity and noise without thematic AND", () => {
  const input = composerInput();
  const prompt = buildSampleEvaluatorPrompt({
    corpus: input.corpus,
    subject: input.subject,
    methodology: input.methodology,
    query_text: buildFallbackQuery(input).query_text,
    sample: [
      {
        id: "mention-1",
        text_snippet: "Coraline es mi pelicula favorita de Laika",
        platform: "x",
        language: "es",
        country: "MX",
        sentiment_source: "positive",
        quality_flags: {}
      }
    ]
  });

  assert.match(prompt, /MODO EXPLORATORIO/);
  assert.match(prompt, /No propongas agregar un AND obligatorio/);
  assert.match(prompt, /Triggers, barriers, experiences y comparisons se clasifican post-ingesta/);
  assert.doesNotMatch(prompt, /Agregar AND con frases de trigger/);
  assert.doesNotMatch(prompt, /Agregar AND con frases de barrier/);
});

test("detection evidence evaluator permits only a balanced thematic gate", () => {
  const input = composerInput({
    methodology: {
      slug: "service-alert-detection",
      name: "Service alert detection",
      version: "1.0",
      manifest: {
        query_mode: "detection",
        signal_phrases: {
          triggers_generic: ["me resolvieron"],
          barriers_generic: ["no me resolvieron"]
        }
      }
    }
  });
  const prompt = buildSampleEvaluatorPrompt({
    corpus: input.corpus,
    subject: input.subject,
    methodology: input.methodology,
    query_text: buildFallbackQuery(input).query_text,
    sample: []
  });

  assert.match(prompt, /MODO DETECTION/);
  assert.match(prompt, /balance aproximado 40-60/);
});
