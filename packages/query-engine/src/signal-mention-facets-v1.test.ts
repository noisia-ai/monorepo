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

test("ordinal grammar preserves legacy identities and requires every input key", async () => {
  const {
    buildFacetRequestV1,
    facetLabelerIdentityOrdinalV3,
    facetLabelerIdentityLegacyV1,
    facetLabelerIdentityOrdinalV2,
    validateFacetLabelerIdentityV1,
  } = await import("./signal-mention-facets-v1");
  const legacy = facetLabelerIdentityLegacyV1(),
    previous = facetLabelerIdentityOrdinalV2(),
    current = facetLabelerIdentityOrdinalV3();
  assert.equal(
    legacy.prompt_digest,
    "sha256:6b98bcb5ada4632d36ecce6576a53f2a9622e9acedb065ebc8085f161ee89ff7",
  );
  assert.equal(
    legacy.schema_digest,
    "sha256:6bc8a3548169c8de1a54785c0fc75bd8e16ab9053fe8f49cca4edf3a868f41aa",
  );
  assert.equal(
    previous.prompt_digest,
    "sha256:592728b28d0ea8f3721ce33804e2545ad04c93a72fe8ce03bf97a43fd2f327ca",
  );
  assert.equal(
    previous.schema_digest,
    "sha256:53a371b67816339162cb852a3eb1f31d1a4aff479e14cedb1210f9be09cbc64e",
  );
  assert.equal(
    current.schema_digest,
    "sha256:eb8c894adf24de6d4c4eb0425a2c388caa067c6823e103e3f85ba301efc8af38",
  );
  assert.equal(current.prompt_digest, previous.prompt_digest);
  assert.notEqual(current.schema_digest, previous.schema_digest);
  assert.equal(current.params.request_format, "required-ordinal-fields-v3");
  assert.doesNotThrow(() => validateFacetLabelerIdentityV1(previous));
  assert.doesNotThrow(() => validateFacetLabelerIdentityV1(current));
  assert.throws(
    () => buildFacetRequestV1([], ce, current),
    /facet_root_count_invalid/u,
  );
  assert.notEqual(current.prompt_digest, legacy.prompt_digest);
  assert.notEqual(current.schema_digest, legacy.schema_digest);
  for (const count of [2, 8, 25]) {
    const inputs = Array.from({ length: count }, (_, i) => input(i));
    const request = buildFacetRequestV1(inputs, ce, current);
    const schema = request.output_config.format.schema as any;
    const expectedKeys = inputs.map((_, i) => `r${i}`);
    assert.deepEqual(schema.properties.roots.required, expectedKeys);
    assert.deepEqual(
      Object.keys(schema.properties.roots.properties),
      expectedKeys,
    );
    assert.equal(schema.properties.roots.additionalProperties, false);
    const body = JSON.parse(request.messages[0]!.content);
    assert.equal(body.expected_root_count, count);
    assert.deepEqual(
      body.roots.map((root: any) => root.root_ordinal),
      inputs.map((_, i) => i),
    );
    const response = {
      roots: Object.fromEntries(expectedKeys.map((key) => [key, facets()])),
    };
    assert.deepEqual(
      parseFacetGroupV1(
        JSON.stringify(response),
        inputs,
        ce,
        current,
      ).results.map((row) => row.root_id),
      inputs.map((row) => row.root_id),
    );
    delete response.roots.r1;
    assert.equal(
      parseFacetGroupV1(JSON.stringify(response), inputs, ce, current).split,
      true,
    );
    assert.equal(
      parseFacetGroupV1(
        JSON.stringify({ roots: [{ root_ordinal: 0, facets: facets() }] }),
        inputs,
        ce,
        current,
      ).split,
      true,
    );
    assert.equal(
      parseFacetGroupV1(
        JSON.stringify({ roots: { r0: facets() } }),
        [input(0)],
        ce,
        legacy,
      ).split,
      true,
    );
    assert.ok(
      Array.isArray(
        JSON.parse(
          buildFacetRequestV1(inputs, ce, legacy).messages[0]!.content,
        ),
      ),
    );
    assert.equal(
      schema.properties.roots.properties.r0.$ref,
      "#/definitions/facet",
    );
    assert.equal((JSON.stringify(schema).match(/"anyOf"/gu) ?? []).length, 3);
    const fields = schema.definitions.facet.properties;
    assert.ok(
      new RegExp(fields.language.properties.value.anyOf[0].pattern).test("es"),
    );
    assert.equal(
      new RegExp(fields.language.properties.value.anyOf[0].pattern).test(
        "es-MX",
      ),
      false,
    );
    assert.equal(fields.asunto.properties.value.anyOf[0].pattern, undefined);
    const previousSchema = buildFacetRequestV1(inputs, ce, previous)
      .output_config.format.schema as any;
    const expectedSchema = structuredClone(previousSchema);
    delete expectedSchema.definitions.facet.properties.asunto.properties.value
      .anyOf[0].pattern;
    assert.deepEqual(schema, expectedSchema);
    assert.equal(
      previousSchema.definitions.facet.properties.asunto.properties.value
        .anyOf[0].pattern,
      "^\\S+(?:\\s+\\S+){0,11}$",
    );
    assert.equal(
      parseFacetGroupV1(
        JSON.stringify({
          roots: Object.fromEntries(expectedKeys.map((key) => [key, facets()])),
        }),
        inputs,
        ce,
        previous,
      ).results.length,
      count,
    );
    const tooLong = {
      roots: Object.fromEntries(
        expectedKeys.map((key) => [
          key,
          { ...facets(), asunto: dim("word ".repeat(13).trim()) },
        ]),
      ),
    };
    assert.ok(
      parseFacetGroupV1(
        JSON.stringify(tooLong),
        inputs,
        ce,
        current,
      ).results.every((row) => row.error_code === "invalid_facets"),
    );
  }
  const incompatible = {
    ...current,
    params: { ...current.params, request_format: "legacy-array-v1" },
  };
  assert.throws(
    () => buildFacetRequestV1([input(0)], ce, incompatible),
    /facet_labeler_identity_unsupported/u,
  );
});

test("union-free ordinal transport restores the exact semantic facet contract", async () => {
  const {
    buildFacetRequestV1,
    facetLabelerIdentityOrdinalV4,
    facetLabelerIdentityLegacyV1,
    facetLabelerIdentityOrdinalV3,
    decodeFacetOrdinalWireV4,
  } = await import("./signal-mention-facets-v1");
  const identity = facetLabelerIdentityOrdinalV4();
  const legacy = facetLabelerIdentityLegacyV1();
  assert.equal(identity.params.request_format, "required-ordinal-fields-v4");
  assert.notEqual(
    identity.prompt_digest,
    facetLabelerIdentityOrdinalV3().prompt_digest,
  );
  const context: EntityContextV1 = {
    entities: [
      ...ce.entities,
      {
        entity_id: "b",
        kind: "competitor",
        name: "Second Example",
        aliases: [],
        disambiguation: null,
      },
    ],
  };
  const examples = [
    {
      ...facets(),
      entities: dim([
        { entity_id: "a", kind: "primary_brand", salience: "main" },
        { entity_id: "b", kind: "competitor", salience: "secondary" },
      ]),
      asunto: dim("Comparison of installation experiences"),
    },
    { ...facets(), entities: dim([]), unrelated_reason: "off_topic" },
    {
      ...facets(),
      entities: { ...dim([]), abstained: true },
      language: { ...dim(null), confidence: "low", abstained: true },
    },
    {
      ...facets(),
      entities: dim([]),
      unrelated_reason: "homonym",
      spam_or_bot: dim(true),
    },
  ];
  for (const count of [2, 8, 25]) {
    const inputs = Array.from({ length: count }, (_, i) => ({
      ...input(i),
      language: null,
    }));
    const semantic = inputs.map((_, i) => examples[i % examples.length]!);
    const wire = semantic.map((row) => ({
      ...row,
      unrelated_reason: row.unrelated_reason ?? "none",
      language: { ...row.language, value: row.language.value ?? "" },
      asunto: { ...row.asunto, value: row.asunto.value ?? "" },
    }));
    wire.forEach((row, i) =>
      assert.deepEqual(decodeFacetOrdinalWireV4(row), semantic[i]),
    );
    const response = JSON.stringify({
      roots: Object.fromEntries(wire.map((row, i) => [`r${i}`, row])),
    });
    assert.deepEqual(
      parseFacetGroupV1(response, inputs, context, identity),
      parseFacetGroupV1(
        JSON.stringify({
          roots: semantic.map((row, i) => ({ root_ordinal: i, facets: row })),
        }),
        inputs,
        context,
        legacy,
      ),
    );
    const schema = buildFacetRequestV1(inputs, context, identity).output_config
      .format.schema as any;
    assert.deepEqual(
      schema.properties.roots.required,
      inputs.map((_, i) => `r${i}`),
    );
    const visit = (value: any) => {
      if (value && typeof value === "object") {
        assert.equal(value.anyOf, undefined);
        assert.equal(value.oneOf, undefined);
        assert.equal(Array.isArray(value.type), false);
        for (const child of Object.values(value)) visit(child);
      }
    };
    visit(schema);
    const missing = JSON.parse(response);
    delete missing.roots.r1;
    assert.equal(
      parseFacetGroupV1(JSON.stringify(missing), inputs, context, identity)
        .split,
      true,
    );
  }
  const badLanguage = {
    ...facets(),
    unrelated_reason: "none",
    language: dim("es-MX"),
    asunto: dim(""),
  };
  const badTopic = {
    ...badLanguage,
    language: dim("es"),
    asunto: dim("word ".repeat(13).trim()),
  };
  for (const bad of [
    badLanguage,
    badTopic,
    { ...badLanguage, unrelated_reason: null },
  ]) {
    assert.equal(
      parseFacetGroupV1(
        JSON.stringify({ roots: { r0: bad } }),
        [{ ...input(0), language: null }],
        context,
        identity,
      ).results[0]?.error_code,
      "invalid_facets",
    );
  }
});

test("demonstrated grammar partitions all 905 roots without changing facets or imposing a cost cap", async () => {
  const {
    facetLabelerIdentityV1,
    facetLabelerIdentityOrdinalV3,
    buildFacetRequestV1,
  } = await import("./signal-mention-facets-v1");
  const identity = facetLabelerIdentityV1();
  const previous = facetLabelerIdentityOrdinalV3();
  assert.equal(identity.prompt_digest, previous.prompt_digest);
  assert.equal(identity.schema_digest, previous.schema_digest);
  assert.equal(identity.params.max_roots_per_request, 8);
  const inputs = Array.from({ length: 905 }, (_, i) =>
    input(i, i % 101 === 0 ? "long ".repeat(2500) : "Example mention"),
  );
  const groups = groupFacetInputsV1(inputs, 0, identity);
  assert.deepEqual(groups.flat(), inputs);
  assert.ok(groups.every((group) => group.length <= 8));
  assert.ok(
    groups
      .filter((group) => group.some((row) => row.text.length > 12000))
      .every((group) => group.length === 1),
  );
  for (const group of groups)
    assert.doesNotThrow(() => buildFacetRequestV1(group, ce, identity));
  assert.throws(
    () => buildFacetRequestV1(inputs.slice(0, 9), ce, identity),
    /facet_root_count_invalid/u,
  );
  const eight = inputs.slice(1, 9);
  assert.deepEqual(
    buildFacetRequestV1(eight, ce, identity),
    buildFacetRequestV1(eight, ce, previous),
  );
});
