import assert from "node:assert/strict";
import test from "node:test";

import {
  REQUIRED_SIGNAL_DATA_REF_KEYS,
  SIGNAL_OPPORTUNITY_KINDS,
  SIGNAL_SERVING_CONTRACT_VERSION,
  attachSignalServingContract,
  hasSignalServingContract,
  isSignalOpportunityKind,
  normalizeSignalMobility
} from "./semantics";

test("published Signal requires one unique reference for every governed surface", () => {
  assert.equal(REQUIRED_SIGNAL_DATA_REF_KEYS.length, 8);
  assert.equal(new Set(REQUIRED_SIGNAL_DATA_REF_KEYS).size, 8);
  assert.deepEqual(REQUIRED_SIGNAL_DATA_REF_KEYS, [
    "published_mentions",
    "social_overview",
    "social_timeseries",
    "social_dimensions",
    "analysis_findings",
    "analysis_opportunities",
    "analysis_evidence",
    "cross_source_timeline"
  ]);
});

test("attaches a relational contract without replacing the compatibility manifest", () => {
  const manifest = attachSignalServingContract(
    { title: "Laika", legacy_payload_available: true },
    { analysisId: "analysis-1", snapshotId: "snapshot-1" }
  );

  assert.equal(manifest.title, "Laika");
  assert.equal(manifest.legacy_payload_available, true);
  assert.equal(manifest.data_contract.version, SIGNAL_SERVING_CONTRACT_VERSION);
  assert.equal(manifest.data_contract.analysis_id, "analysis-1");
  assert.equal(manifest.data_contract.snapshot_id, "snapshot-1");
  assert.equal(manifest.data_contract.source_of_truth, "relational");
  assert.equal(manifest.data_contract.payload_role, "manifest_only");
  assert.equal(hasSignalServingContract(manifest), true);
  assert.equal(hasSignalServingContract({ data_contract: { version: SIGNAL_SERVING_CONTRACT_VERSION } }), false);
});

test("unknown mobility remains unknown and is never promoted to movable", () => {
  assert.equal(normalizeSignalMobility("movible_por_marca"), "movable");
  assert.equal(normalizeSignalMobility("parcialmente_movible"), "partial");
  assert.equal(normalizeSignalMobility("estructural"), "structural");
  assert.equal(normalizeSignalMobility("unknown"), "unknown");
  assert.equal(normalizeSignalMobility("something Claude invented"), "unknown");
  assert.equal(normalizeSignalMobility(null), "unknown");
});

test("opportunities are recommendations, not arbitrary findings or mentions", () => {
  assert.deepEqual(SIGNAL_OPPORTUNITY_KINDS, ["activation", "friction_removal"]);
  assert.equal(isSignalOpportunityKind("activation"), true);
  assert.equal(isSignalOpportunityKind("friction_removal"), true);
  assert.equal(isSignalOpportunityKind("finding"), false);
  assert.equal(isSignalOpportunityKind("mention"), false);
  assert.equal(isSignalOpportunityKind("unknown"), false);
});
