import assert from "node:assert/strict";
import test from "node:test";

import {
  REQUIRED_SIGNAL_DATA_REF_KEYS,
  SIGNAL_SERVING_CONTRACT_VERSION,
  attachSignalServingContract,
  getSignalServingContractVersion,
  hasSignalServingContract,
  isImmutablePublishedSignalStatus,
  normalizeSignalMobility
} from "./semantics";

test("published Signal requires one unique reference for every governed surface", () => {
  assert.equal(REQUIRED_SIGNAL_DATA_REF_KEYS.length, 9);
  assert.equal(new Set(REQUIRED_SIGNAL_DATA_REF_KEYS).size, 9);
  assert.deepEqual(REQUIRED_SIGNAL_DATA_REF_KEYS, [
    "published_mentions",
    "social_overview",
    "social_timeseries",
    "social_dimensions",
    "analysis_findings",
    "analysis_opportunities",
    "analysis_actions",
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
  assert.equal(getSignalServingContractVersion(manifest), SIGNAL_SERVING_CONTRACT_VERSION);
  assert.equal(hasSignalServingContract({ data_contract: { version: "signal-serving-v1", source_of_truth: "relational" } }), false);
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

test("opportunities and actions have distinct relational grains", () => {
  const manifest = attachSignalServingContract({}, { analysisId: "analysis-1", snapshotId: "snapshot-1" });

  assert.equal(manifest.data_contract.definitions.opportunity.source, "tb_strategic_opportunities + tb_opportunity_findings");
  assert.equal(manifest.data_contract.definitions.action.source, "tb_action_studio + tb_action_findings");
  assert.match(manifest.data_contract.definitions.opportunity.rule, /Operational recommendations are not strategic opportunities/);
});

test("published Signal rows are immutable revisions", () => {
  assert.equal(isImmutablePublishedSignalStatus("published"), true);
  assert.equal(isImmutablePublishedSignalStatus("draft"), false);
  assert.equal(isImmutablePublishedSignalStatus("archived"), false);
});
