import assert from "node:assert/strict";
import test from "node:test";

import { REQUIRED_SIGNAL_DATA_REF_KEYS } from "../signal/semantics";
import {
  assessSignalServingReadiness,
  type SignalServingReadiness
} from "./signal-serving-assessment";

function readiness(
  overrides: Partial<SignalServingReadiness["counts"]> = {},
  missing: SignalServingReadiness["dataRefs"]["missing"] = []
): SignalServingReadiness {
  const present = REQUIRED_SIGNAL_DATA_REF_KEYS.filter((key) => !missing.includes(key));

  return {
    contractVersion: "signal-serving-v1",
    snapshotId: "snapshot-1",
    analysisId: "analysis-1",
    counts: {
      mentions: 723,
      findings: 17,
      findingsWithEvidence: 17,
      opportunities: 5,
      citations: 40,
      citationLinks: 68,
      tags: 900,
      tagTerms: 12,
      features: 1_200,
      featureKeys: 8,
      ...overrides
    },
    dataRefs: {
      required: REQUIRED_SIGNAL_DATA_REF_KEYS,
      present,
      missing,
      complete: missing.length === 0,
      enforced: true
    }
  };
}

test("is ready only when evidence, governed dimensions, and all references exist", () => {
  const assessment = assessSignalServingReadiness(readiness());

  assert.equal(assessment.ready, true);
  assert.deepEqual(assessment.hardBlocks, []);
  assert.deepEqual(assessment.warnings, []);
});

test("blocks publication when any mandatory dashboard reference is missing", () => {
  const assessment = assessSignalServingReadiness(
    readiness({}, ["cross_source_timeline"])
  );

  assert.equal(assessment.ready, false);
  assert.equal(assessment.hardBlocks.some((issue) => issue.code === "dashboard_refs_incomplete"), true);
});

test("blocks findings without snapshot-scoped evidence", () => {
  const assessment = assessSignalServingReadiness(
    readiness({ findingsWithEvidence: 16 })
  );

  assert.equal(assessment.ready, false);
  assert.equal(assessment.hardBlocks.some((issue) => issue.code === "finding_evidence_incomplete"), true);
});

test("requires at least one governed dimension but permits tags or features independently", () => {
  const blocked = assessSignalServingReadiness(
    readiness({ tags: 0, tagTerms: 0, features: 0, featureKeys: 0 })
  );
  const featuresOnly = assessSignalServingReadiness(
    readiness({ tags: 0, tagTerms: 0 })
  );

  assert.equal(blocked.ready, false);
  assert.equal(blocked.hardBlocks.some((issue) => issue.code === "governed_dimensions_missing"), true);
  assert.equal(featuresOnly.ready, true);
  assert.equal(featuresOnly.warnings.some((issue) => issue.code === "tags_missing"), true);
});

test("zero opportunities is a warning, never an invitation to count mentions as opportunities", () => {
  const assessment = assessSignalServingReadiness(readiness({ opportunities: 0 }));

  assert.equal(assessment.ready, true);
  assert.equal(assessment.warnings.some((issue) => issue.code === "opportunities_missing"), true);
});
