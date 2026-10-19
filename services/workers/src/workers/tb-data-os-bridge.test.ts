import assert from "node:assert/strict";
import test from "node:test";

import { assessTbCodingBridgeQuality } from "./tb-data-os-bridge-quality";

const baseCounts = {
  codings: 100,
  coded_mentions: 100,
  non_irrelevant_mentions: 90,
  ambiguous_mentions: 0,
  missing_layer_mentions: 0,
  missing_emergent_tag_mentions: 0,
  unlinked_finding_mentions: 0,
  record_tags: 260,
  record_features: 100,
  polarity_tagged_mentions: 90,
  layer_tagged_mentions: 90,
  emergent_candidate_tags: 170,
  tag_lineage_edges: 260,
  feature_lineage_edges: 100,
  lineage_edges: 360
};

test("accepts a complete coding bridge", () => {
  assert.deepEqual(assessTbCodingBridgeQuality(baseCounts, "step3_hierarchy"), {
    status: "accepted",
    ready: true,
    warnings: []
  });
});

test("blocks when a coded mention has no governed feature", () => {
  const result = assessTbCodingBridgeQuality(
    { ...baseCounts, record_features: 99 },
    "step3_hierarchy"
  );
  assert.equal(result.status, "blocked");
  assert.equal(result.ready, false);
});

test("blocks when governed feature lineage is incomplete", () => {
  const result = assessTbCodingBridgeQuality(
    { ...baseCounts, feature_lineage_edges: 99 },
    "step3_hierarchy"
  );
  assert.equal(result.status, "blocked");
  assert.equal(result.ready, false);
  assert.match(result.warnings[0] ?? "", /feature records have coding lineage/);
});

test("blocks when governed tag lineage is incomplete", () => {
  const result = assessTbCodingBridgeQuality(
    { ...baseCounts, tag_lineage_edges: 259 },
    "step3_hierarchy"
  );
  assert.equal(result.status, "blocked");
  assert.equal(result.ready, false);
  assert.match(result.warnings[0] ?? "", /tag records have coding lineage/);
});

test("blocks when a taggable coding did not reach the governed taxonomy layer", () => {
  const result = assessTbCodingBridgeQuality(
    { ...baseCounts, polarity_tagged_mentions: 89 },
    "step3_hierarchy"
  );
  assert.equal(result.status, "blocked");
  assert.equal(result.ready, false);
  assert.match(result.warnings[0] ?? "", /governed trigger\/barrier tag/);
});

test("does not require a fabricated tag when the coding has no emergent evidence", () => {
  const result = assessTbCodingBridgeQuality(
    {
      ...baseCounts,
      missing_emergent_tag_mentions: 4,
      polarity_tagged_mentions: 86
    },
    "step3_hierarchy"
  );
  assert.equal(result.status, "needs_review");
  assert.equal(result.ready, true);
});

test("does not treat missing findings as a step 2 failure", () => {
  const result = assessTbCodingBridgeQuality(
    { ...baseCounts, unlinked_finding_mentions: 90 },
    "step2_coding"
  );
  assert.equal(result.status, "accepted");
  assert.equal(result.ready, true);
});

test("surfaces ambiguity and missing explicit dimensions for review", () => {
  const result = assessTbCodingBridgeQuality(
    {
      ...baseCounts,
      ambiguous_mentions: 8,
      missing_layer_mentions: 4,
      missing_emergent_tag_mentions: 2,
      unlinked_finding_mentions: 3
    },
    "reconcile"
  );
  assert.equal(result.status, "needs_review");
  assert.equal(result.ready, true);
  assert.equal(result.warnings.length, 4);
});
