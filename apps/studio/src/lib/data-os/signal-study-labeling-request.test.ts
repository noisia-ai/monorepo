import assert from "node:assert/strict";
import test from "node:test";
import { studyLabelingProviderAvailableV2, studyLabelingRequestSchemaV2 } from "./signal-study-labeling-request";

test("Studio supports a separate worker and monolithic provider configuration while honoring explicit disable", () => {
  assert.equal(studyLabelingProviderAvailableV2({ NOISIA_JEV_PROVIDER_ENABLED: "true" }), true);
  assert.equal(studyLabelingProviderAvailableV2({ TYPESAFE_API_KEY: "synthetic-existing-local-credential" }), true);
  assert.equal(studyLabelingProviderAvailableV2({}), false);
  assert.equal(studyLabelingProviderAvailableV2({ TYPESAFE_API_KEY: "   " }), false);
  for (const NOISIA_JEV_PROVIDER_ENABLED of ["false", "TRUE", "1", ""]) {
    assert.equal(studyLabelingProviderAvailableV2({ NOISIA_JEV_PROVIDER_ENABLED, TYPESAFE_API_KEY: "synthetic-existing-local-credential" }), false);
  }
});

test("classification requests preserve one request identity and reject client-supplied authority", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const input = { action: "start", map_id: id, idempotency_key: id, cap_micro_usd: 1000 };
  assert.equal(studyLabelingRequestSchemaV2.safeParse(input).success, true);
  for (const key of ["workspace_id", "actor_user_id", "provider_available", "identity", "configuration", "questions", "skip_smoke"]) {
    assert.equal(studyLabelingRequestSchemaV2.safeParse({ ...input, [key]: "injected" }).success, false);
  }
  for (const cap_micro_usd of [0, -1, NaN, Infinity, 0.1]) {
    assert.equal(studyLabelingRequestSchemaV2.safeParse({ ...input, cap_micro_usd }).success, false);
  }
});
