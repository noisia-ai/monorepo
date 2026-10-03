import assert from "node:assert/strict";
import test from "node:test";

import { parseHierarchyResponse, validateTbStructuredEvidenceRefs } from "./tb";

const OBSERVATION = "observation:11111111-1111-4111-8111-111111111111";
const RECORD = "record:22222222-2222-4222-8222-222222222222";

test("hierarchy response normalizes, sorts and deduplicates governed evidence tokens", () => {
  const parsed = parseHierarchyResponse(JSON.stringify({
    evaluated: [{
      key: "trigger|social|proof",
      nombre_comercial: "Prueba social verificable",
      intensidad_promedio: 3,
      capacidad_predictiva: 0.7,
      confidence: "alta",
      reason: "Structured evidence confirms the finding.",
      protagonist_sample_index: 0,
      supporting_sample_indices: [1],
      structured_evidence_refs: [RECORD.toUpperCase(), OBSERVATION, RECORD]
    }]
  }));

  assert.deepEqual(parsed.evaluated[0]?.structured_evidence_refs, [OBSERVATION, RECORD]);
});

test("unknown structured evidence cannot become claim-specific", () => {
  assert.throws(
    () => validateTbStructuredEvidenceRefs([RECORD], [OBSERVATION]),
    /unknown_structured_evidence_ref:record:22222222/
  );
  assert.deepEqual(
    validateTbStructuredEvidenceRefs([OBSERVATION, OBSERVATION], [OBSERVATION, RECORD]),
    [OBSERVATION]
  );
});
