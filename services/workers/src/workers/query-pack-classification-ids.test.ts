import assert from "node:assert/strict";
import test from "node:test";

import {
  aliasQueryPackSample,
  restoreQueryPackClassificationIds
} from "./query-pack-classification-ids";

test("uses short stable aliases in the evaluator prompt and restores source ids", () => {
  const originalId = "smid-0ffRDySpJeBj4pc3JwFQYkqKR2ANlBQL21AJ1pM1Sx9EfbDEIUGVLMXm";
  const { aliasedSample, originalIdByAlias } = aliasQueryPackSample([
    {
      id: originalId,
      text_snippet: "Laika no entregó mi pedido",
      platform: "x",
      language: "es",
      country: "MX",
      sentiment_source: "negative"
    }
  ]);

  assert.equal(aliasedSample[0]?.id, "m-01");
  assert.equal(
    restoreQueryPackClassificationIds(
      [{ mention_id: "m-01", relevance: "relevant", signal_types: ["barrier"], reason: "Entrega" }],
      originalIdByAlias
    )[0]?.mention_id,
    originalId
  );
});

test("rejects evaluator ids that were not present in the prompt", () => {
  assert.throws(
    () => restoreQueryPackClassificationIds(
      [{ mention_id: "m-99", relevance: "noise", signal_types: [], reason: "Unknown" }],
      new Map([["m-01", "source-1"]])
    ),
    /unknown local mention_id: m-99/
  );
});
