import test from "node:test";
import assert from "node:assert/strict";
import {
  diffEntityContextV1,
  isEntityContextAffectedV1,
  entityContextDigestV1,
  type EntityContextV1,
} from "./signal-entity-context-v1";
import {
  validateMentionFacetsV1,
  deriveRelevanceV1,
  groupFacetInputsV1,
  parseFacetGroupV1,
  facetInputDigestV1,
} from "./signal-mention-facets-v1";
import {
  parseAnthropicResponseV1,
  anthropicUsageV1,
} from "./anthropic-response-v1";
import { llmCostMicroUsdV1, llmPriceV1 } from "./llm-pricing-v1";
const ce: EntityContextV1 = {
  entities: [
    {
      entity_id: "a",
      kind: "primary_brand",
      name: "Example Brand",
      aliases: ["Product One"],
      disambiguation: null,
    },
  ],
};
const dim = <T>(value: T) => ({ value, confidence: "high", abstained: false });
const facets = () => ({
  entities: dim([{ entity_id: "a", kind: "primary_brand", salience: "main" }]),
  unrelated_reason: null,
  voice: dim("individual"),
  act: dim("opinion"),
  spam_or_bot: dim(false),
  language: dim("es"),
  asunto: dim(null),
});
const input = (i: number, text = "Example Brand") => ({
  root_id: String(i),
  input_digest: "digest",
  text,
  title: null,
  platform: null,
  content_type: null,
  author: null,
  published_at: "2026-01-01",
  language: null,
});
test("CE aliases normalize accents, ordering and word boundaries; narrative is outside CE", () => {
  const next = structuredClone(ce);
  next.entities[0]!.aliases.push("Núeva palabra");
  const diff = diffEntityContextV1(ce, next);
  assert.equal(diff.affected_mode, "targeted");
  assert.equal(
    isEntityContextAffectedV1(diff, {
      title: null,
      text: "Una nueva palabra aquí",
      entity_ids: [],
    }),
    true,
  );
  assert.equal(
    isEntityContextAffectedV1(diff, {
      title: null,
      text: "nueva palabras",
      entity_ids: [],
    }),
    false,
  );
  assert.equal(
    entityContextDigestV1(next),
    entityContextDigestV1({
      entities: [
        { ...next.entities[0]!, aliases: ["nueva palabra", "Product One"] },
      ],
    }),
  );
  assert.deepEqual(diffEntityContextV1(ce, ce).lexical_terms, []);
});
test("CE deleted aliases/entities, kind, disambiguation, short names and categories affect prescribed roots", () => {
  for (const next of [
    { entities: [] },
    { entities: [{ ...ce.entities[0]!, aliases: [] }] },
    { entities: [{ ...ce.entities[0]!, kind: "competitor" as const }] },
  ]) {
    assert.equal(
      isEntityContextAffectedV1(diffEntityContextV1(ce, next), {
        title: null,
        text: "indirect",
        entity_ids: ["a"],
      }),
      true,
    );
  }
  assert.equal(
    diffEntityContextV1(ce, {
      entities: [{ ...ce.entities[0]!, aliases: ["xy"] }],
    }).affected_mode,
    "full",
  );
  assert.equal(
    diffEntityContextV1(ce, {
      entities: [{ ...ce.entities[0]!, kind: "category", aliases: [] }],
    }).affected_mode,
    "full",
  );
  const d = diffEntityContextV1(ce, {
    entities: [{ ...ce.entities[0]!, disambiguation: "Device only" }],
  });
  assert.equal(
    isEntityContextAffectedV1(d, {
      title: "Product One",
      text: "",
      entity_ids: [],
    }),
    true,
  );
});
test("facets distinguish entity failures from abstention and preserve multi-entities", () => {
  assert.equal(
    deriveRelevanceV1(validateMentionFacetsV1(facets(), ce)),
    "relevant",
  );
  const empty = { ...facets(), entities: dim([]) };
  assert.equal(validateMentionFacetsV1(empty, ce).entities.abstained, true);
  assert.throws(
    () =>
      validateMentionFacetsV1(
        {
          ...facets(),
          entities: dim([
            { entity_id: "bad", kind: "primary_brand", salience: "main" },
          ]),
        },
        ce,
      ),
    /unknown_entity_id/u,
  );
  assert.throws(
    () =>
      validateMentionFacetsV1(
        {
          ...facets(),
          entities: dim([
            ...facets().entities.value,
            ...facets().entities.value,
          ]),
        },
        ce,
      ),
    /duplicate_entity_id/u,
  );
  assert.equal(
    deriveRelevanceV1(
      validateMentionFacetsV1({ ...facets(), spam_or_bot: dim(true) }, ce),
    ),
    "spam",
  );
});
test("metadata digest and group completeness never infer from truncated output", () => {
  const meta = {
    text_sha256: "sha256:text",
    title: null,
    platform: null,
    content_type: null,
    author: null,
  };
  assert.notEqual(
    facetInputDigestV1(meta),
    facetInputDigestV1({ ...meta, title: "changed" }),
  );
  const grouped = groupFacetInputsV1([
    ...Array.from({ length: 30 }, (_, i) => input(i)),
    input(31, "x".repeat(12001)),
  ]);
  assert.deepEqual(
    grouped.map((g) => g.length),
    [25, 5, 1],
  );
  assert.equal(
    parseFacetGroupV1(
      JSON.stringify({ roots: [{ root_ordinal: 0, facets: facets() }] }),
      [input(0), input(1)],
      ce,
    ).split,
    true,
  );
  assert.equal(
    parseFacetGroupV1(
      JSON.stringify({ roots: [{ root_ordinal: 0, facets: facets() }] }),
      [input(0)],
      ce,
    ).results[0]?.status,
    "labeled",
  );
});
test("Anthropic reads final text, refusal and truncation separately; exact cache pricing", () => {
  assert.equal(
    parseAnthropicResponseV1({
      stop_reason: "end_turn",
      content: [
        { type: "thinking", thinking: "" },
        { type: "text", text: "first" },
        { type: "text", text: "last" },
      ],
    }).text,
    "last",
  );
  assert.equal(
    parseAnthropicResponseV1({
      stop_reason: "refusal",
      stop_details: { category: "general_harms" },
    }).status,
    "refused",
  );
  assert.equal(
    parseAnthropicResponseV1({ stop_reason: "max_tokens" }).status,
    "split",
  );
  const usage = anthropicUsageV1({
    usage: {
      input_tokens: 1000,
      output_tokens: 100,
      cache_read_input_tokens: 1000,
      cache_creation_input_tokens: 1500,
      cache_creation: {
        ephemeral_5m_input_tokens: 500,
        ephemeral_1h_input_tokens: 1000,
      },
    },
  });
  assert.equal(
    llmCostMicroUsdV1(
      usage,
      llmPriceV1("anthropic", "claude-sonnet-5-5", "batch"),
    ),
    4225,
  );
});
