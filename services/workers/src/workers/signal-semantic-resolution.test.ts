import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type {
  SignalSemanticResolutionGovernedContextV1,
  SignalSemanticResolutionMentionContextV1
} from "@noisia/db";

import {
  buildSignalSemanticResolutionJsonSchemaV1,
  buildSignalSemanticResolutionIdentityReferencesV1,
  buildSignalSemanticResolutionMentionPromptV1,
  buildSignalSemanticResolutionPromptV1,
  mapSignalSemanticResolutionModelOutputV1,
  mapSignalSemanticResolutionSingleOutputV1,
  signalSemanticResolutionCustomIdV1,
  signalSemanticResolutionMentionIdFromCustomIdV1
} from "./signal-semantic-resolution-contract";
import { signalSemanticResolutionBatchErrorCodeV1 } from "./signal-semantic-resolution-message-batch";

test("projection and paid resolution share an isolated semantic queue, not the legacy query queue", async () => {
  const [semanticQueue, queryQueue, projectionOutbox, projectionWorker, workerEntrypoint] = await Promise.all([
    readFile(new URL("../queues/semantic-resolution.ts", import.meta.url), "utf8"),
    readFile(new URL("../queues/query-engine.ts", import.meta.url), "utf8"),
    readFile(new URL("./signal-semantic-review-projection-outbox.ts", import.meta.url), "utf8"),
    readFile(new URL("./signal-semantic-review-projection.ts", import.meta.url), "utf8"),
    readFile(new URL("../index.ts", import.meta.url), "utf8")
  ]);
  assert.match(semanticQueue, /SIGNAL_SEMANTIC_REVIEW_PROJECTION_JOB_NAME/u);
  assert.match(semanticQueue, /signalSemanticReviewProjectionJob/u);
  assert.match(projectionOutbox, /from "\.\.\/queues\/semantic-resolution"/u);
  for (const failurePath of [projectionOutbox, projectionWorker]) {
    assert.match(failurePath, /fail_signal_semantic_review_projection_v1/u);
    assert.match(failurePath, /\$3::text/u);
    assert.doesNotMatch(failurePath, /\$3::jsonb/u);
  }
  assert.doesNotMatch(queryQueue, /SIGNAL_SEMANTIC_REVIEW_PROJECTION_JOB_NAME/u);
  assert.doesNotMatch(queryQueue, /signalSemanticReviewProjectionJob/u);
  assert.match(
    workerEntrypoint,
    /const semanticReviewProjectionOutboxDrainer = semanticResolutionWorker\s*\? startSignalSemanticReviewProjectionOutboxDrainer\(\)\s*:\s*null/u
  );
});

const IDS = {
  workspace: "10000000-0000-4000-8000-000000000001",
  brand: "10000000-0000-4000-8000-000000000002",
  competitor: "10000000-0000-4000-8000-000000000003",
  category: "10000000-0000-4000-8000-000000000004",
  mention: "10000000-0000-4000-8000-000000000005"
} as const;

const governedContext: SignalSemanticResolutionGovernedContextV1 = {
  workspace: {
    workspace_id: IDS.workspace,
    brand_id: IDS.brand,
    brand_name: "Laika Mascotas",
    brand_slug: "laika",
    brand_handles: ["@laikamascotas"],
    description: "Pet retail brand",
    industry: "Pet care",
    industry_sub: "Retail para mascotas",
    countries: ["MX"]
  },
  identities: [
    {
      scope: "primary_brand",
      entity_id: IDS.brand,
      entity_label: "Laika Mascotas",
      aliases: ["Laika", "@laikamascotas"]
    },
    {
      scope: "competitor",
      entity_id: IDS.competitor,
      entity_label: "Maskota",
      aliases: ["Maskota México"]
    },
    {
      scope: "category",
      entity_id: IDS.category,
      entity_label: "Retail para mascotas",
      aliases: ["Pet care"]
    }
  ],
  brand_context: [{ kind: "brand_brief", title: "Brand OS", content: "Laika operates in Mexico." }]
};

const mention: SignalSemanticResolutionMentionContextV1 = {
  mention_id: IDS.mention,
  published_at: "2026-07-12T12:00:00.000Z",
  platform: "facebook",
  title: null,
  text: "Maskota anunció una promoción para alimento de mascotas.",
  thread_context: null,
  author_handle: "@customer",
  author_name: "Customer",
  source_name: "DO_NOT_EXPOSE_SOURCE_NAME",
  source_intent: "DO_NOT_EXPOSE_SOURCE_INTENT",
  prepared_decision: {
    mention_id: IDS.mention,
    classifications: [{
      scope: "primary_brand",
      entity_id: IDS.brand,
      confidence: 1,
      rationale: "DO_NOT_EXPOSE_PREPARED_DECISION"
    }]
  }
};

test("semantic resolution exposes deterministic short refs without database ids or source intent", () => {
  const references = buildSignalSemanticResolutionIdentityReferencesV1(governedContext);
  assert.deepEqual(
    references.map(({ entity_ref, scope }) => ({ entity_ref, scope })),
    [
      { entity_ref: "category_1", scope: "category" },
      { entity_ref: "competitor_1", scope: "competitor" },
      { entity_ref: "primary_brand", scope: "primary_brand" }
    ]
  );

  const prompt = buildSignalSemanticResolutionPromptV1({ governedContext, mentions: [mention] });
  assert.match(prompt, /"entity_ref":"category_1"/u);
  assert.match(prompt, /"entity_ref":"competitor_1"/u);
  assert.match(prompt, /"entity_ref":"primary_brand"/u);
  assert.doesNotMatch(prompt, new RegExp(IDS.brand, "u"));
  assert.doesNotMatch(prompt, new RegExp(IDS.competitor, "u"));
  assert.doesNotMatch(prompt, new RegExp(IDS.category, "u"));
  assert.doesNotMatch(prompt, /DO_NOT_EXPOSE_SOURCE_NAME/u);
  assert.doesNotMatch(prompt, /DO_NOT_EXPOSE_SOURCE_INTENT/u);
  assert.doesNotMatch(prompt, /DO_NOT_EXPOSE_PREPARED_DECISION/u);
});

test("semantic resolution maps closed refs to governed ids and strips transport refs", () => {
  const [decision] = mapSignalSemanticResolutionModelOutputV1({
    decisions: [{
      mention_id: IDS.mention,
      classifications: [
        {
          scope: "competitor",
          entity_ref: "competitor_1",
          confidence: 0.94,
          rationale: "Maskota is the focal subject."
        },
        {
          scope: "category",
          entity_ref: "category_1",
          confidence: 0.81,
          rationale: "The mention makes a separate market-level claim."
        }
      ]
    }]
  }, governedContext);

  assert.deepEqual(decision, {
    mention_id: IDS.mention,
    classifications: [
      {
        scope: "competitor",
        entity_id: IDS.competitor,
        confidence: 0.94,
        rationale: "Maskota is the focal subject."
      },
      {
        scope: "category",
        entity_id: IDS.category,
        confidence: 0.81,
        rationale: "The mention makes a separate market-level claim."
      }
    ]
  });
});

test("semantic resolution fails closed on invented or scope-mismatched refs", () => {
  assert.throws(() => mapSignalSemanticResolutionModelOutputV1({
    decisions: [{
      mention_id: IDS.mention,
      classifications: [{
        scope: "competitor",
        entity_ref: "competitor_99",
        confidence: 0.5,
        rationale: "Invented reference."
      }]
    }]
  }, governedContext), /semantic_resolution_unknown_entity_ref/u);

  assert.throws(() => mapSignalSemanticResolutionModelOutputV1({
    decisions: [{
      mention_id: IDS.mention,
      classifications: [{
        scope: "category",
        entity_ref: "competitor_1",
        confidence: 0.5,
        rationale: "Wrong scope."
      }]
    }]
  }, governedContext), /semantic_resolution_unknown_entity_ref/u);
});

test("unattributed remains entity-free in the persisted decision", () => {
  const [decision] = mapSignalSemanticResolutionModelOutputV1({
    decisions: [{
      mention_id: IDS.mention,
      classifications: [{
        scope: "unattributed",
        entity_ref: null,
        confidence: 0.88,
        rationale: "There is not enough responsible evidence."
      }]
    }]
  }, governedContext);

  assert.ok(decision);
  assert.deepEqual(decision.classifications[0], {
    scope: "unattributed",
    entity_id: null,
    confidence: 0.88,
    rationale: "There is not enough responsible evidence."
  });
});

test("unattributed fallback is discarded when the model also returns a substantive identity", () => {
  const [decision] = mapSignalSemanticResolutionModelOutputV1({
    decisions: [{
      mention_id: IDS.mention,
      classifications: [
        {
          scope: "unattributed",
          entity_ref: null,
          confidence: 0.51,
          rationale: "There is not enough responsible evidence."
        },
        {
          scope: "primary_brand",
          entity_ref: "primary_brand",
          confidence: 0.93,
          rationale: "Laika is the focal subject."
        }
      ]
    }]
  }, governedContext);

  assert.ok(decision);
  assert.deepEqual(decision.classifications, [{
    scope: "primary_brand",
    entity_id: IDS.brand,
    confidence: 0.93,
    rationale: "Laika is the focal subject."
  }]);
});

test("message batch schema closes every scope over the governed identity catalog", () => {
  const schema = buildSignalSemanticResolutionJsonSchemaV1(governedContext);
  const classifications = schema.properties.classifications;
  const branches = classifications.items.anyOf as Array<{
    properties: { scope: { const: string }; entity_ref: { enum?: string[]; type: string } };
  }>;
  assert.deepEqual(branches.map((branch) => branch.properties.scope.const), [
    "primary_brand",
    "competitor",
    "category",
    "unattributed"
  ]);
  assert.deepEqual(branches[0]?.properties.entity_ref.enum, ["primary_brand"]);
  assert.deepEqual(branches[1]?.properties.entity_ref.enum, ["competitor_1"]);
  assert.deepEqual(branches[2]?.properties.entity_ref.enum, ["category_1"]);
  assert.equal(branches[3]?.properties.entity_ref.type, "null");
  assert.equal(JSON.stringify(schema).includes("competitor_99"), false);
  for (const unsupported of ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"]) {
    assert.equal(JSON.stringify(schema).includes(`\"${unsupported}\"`), false);
  }
});

test("message batch provider errors preserve Anthropic's nested error type", () => {
  assert.equal(signalSemanticResolutionBatchErrorCodeV1({
    type: "errored",
    error: {
      type: "error",
      error: { type: "invalid_request_error", message: "Unsupported schema keyword." },
      request_id: null
    }
  }), "semantic_resolution_provider_invalid_request_error");
});

test("message batch custom ids round-trip without exposing a second identity", () => {
  const customId = signalSemanticResolutionCustomIdV1(IDS.mention);
  assert.equal(customId, "mention_10000000000040008000000000000005");
  assert.ok(customId.length <= 64);
  assert.equal(signalSemanticResolutionMentionIdFromCustomIdV1(customId), IDS.mention);
  assert.throws(
    () => signalSemanticResolutionMentionIdFromCustomIdV1("mention_not-a-uuid"),
    /semantic_resolution_invalid_custom_id/u
  );
});

test("single mention prompts omit source intent and map one result independently", () => {
  const prompt = buildSignalSemanticResolutionMentionPromptV1(mention);
  assert.match(prompt, new RegExp(IDS.mention, "u"));
  assert.doesNotMatch(prompt, /DO_NOT_EXPOSE_SOURCE_NAME/u);
  assert.doesNotMatch(prompt, /DO_NOT_EXPOSE_SOURCE_INTENT/u);
  assert.doesNotMatch(prompt, /DO_NOT_EXPOSE_PREPARED_DECISION/u);

  assert.deepEqual(mapSignalSemanticResolutionSingleOutputV1({
    mentionId: IDS.mention,
    governedContext,
    output: {
      classifications: [{
        scope: "primary_brand",
        entity_ref: "primary_brand",
        confidence: 0.98,
        rationale: "Laika is the focal subject."
      }]
    }
  }), {
    mention_id: IDS.mention,
    classifications: [{
      scope: "primary_brand",
      entity_id: IDS.brand,
      confidence: 0.98,
      rationale: "Laika is the focal subject."
    }]
  });
});
