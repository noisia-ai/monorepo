import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyOwnership,
  confidenceFromMentions,
  differentiationIndex,
  evidenceConfidence,
  roundPct
} from "./engine-scoring";

test("classifyOwnership keeps low evidence and low dominance directional", () => {
  assert.equal(
    classifyOwnership({
      total: 1,
      brandMentions: 1,
      competitorMentions: 0,
      categoryMentions: 0,
      dominantSharePct: 100
    }),
    "insufficient_evidence"
  );
  assert.equal(
    classifyOwnership({
      total: 10,
      brandMentions: 4,
      competitorMentions: 3,
      categoryMentions: 3,
      dominantSharePct: 34.9
    }),
    "insufficient_evidence"
  );
});

test("classifyOwnership respects production thresholds", () => {
  assert.equal(
    classifyOwnership({
      total: 100,
      brandMentions: 55,
      competitorMentions: 30,
      categoryMentions: 15,
      dominantSharePct: 55
    }),
    "brand_owned"
  );
  assert.equal(
    classifyOwnership({
      total: 100,
      brandMentions: 20,
      competitorMentions: 55,
      categoryMentions: 25,
      dominantSharePct: 55
    }),
    "competitor_owned"
  );
  assert.equal(
    classifyOwnership({
      total: 100,
      brandMentions: 20,
      competitorMentions: 35,
      categoryMentions: 45,
      dominantSharePct: 45
    }),
    "category_wide"
  );
  assert.equal(
    classifyOwnership({
      total: 100,
      brandMentions: 45,
      competitorMentions: 40,
      categoryMentions: 15,
      dominantSharePct: 45
    }),
    "shared"
  );
});

test("confidenceFromMentions uses current volume thresholds", () => {
  assert.equal(confidenceFromMentions(100), "alta");
  assert.equal(confidenceFromMentions(30), "media");
  assert.equal(confidenceFromMentions(29), "baja_direccional");
});

test("evidenceConfidence combines volume, diversity, consistency, recency and citation quality", () => {
  assert.equal(
    evidenceConfidence({
      volume: 150,
      distinctSources: 3,
      sentimentVariance: 0.1,
      newestAgeMonths: 3,
      hasProtagonistQuote: true
    }).confidence,
    "alta"
  );
  assert.equal(
    evidenceConfidence({
      volume: 5,
      distinctSources: 1,
      sentimentVariance: 0.9,
      newestAgeMonths: 14,
      hasProtagonistQuote: false
    }).confidence,
    "baja_direccional"
  );
});

test("rounding helpers are stable", () => {
  assert.equal(roundPct(0.554), 55.4);
  assert.equal(differentiationIndex(0.551, 0.35), 0.201);
});
