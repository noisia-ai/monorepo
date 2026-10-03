import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSignalTaxonomyEnrichmentOptions,
  isSignalTaxonomyEnrichmentEnabled,
  isSignalTaxonomyLlmEnabled,
  SIGNAL_TAXONOMY_ENRICHMENT_RETIRED_REASON,
  SignalTaxonomyEnrichmentRetiredError
} from "./signal-taxonomy-enrichment-runtime";

test("taxonomy enrichment cannot be reactivated by flags or provider keys", () => {
  const allEnabled = {
    NOISIA_DATA_OS_WORKER_ENABLED: "true",
    NOISIA_SIGNAL_TAXONOMY_ENRICHMENT_ENABLED: "true",
    NOISIA_SIGNAL_TAXONOMY_LLM_ENABLED: "true",
    ANTHROPIC_API_KEY: "fake",
    VOYAGE_API_KEY: "fake"
  };
  assert.equal(isSignalTaxonomyEnrichmentEnabled({}), false);
  assert.equal(isSignalTaxonomyLlmEnabled({}), false);
  assert.equal(isSignalTaxonomyEnrichmentEnabled(allEnabled), false);
  assert.equal(isSignalTaxonomyLlmEnabled(allEnabled), false);
});

test("legacy enqueue options always throw the stable retirement error", () => {
  assert.throws(
    () => buildSignalTaxonomyEnrichmentOptions("taxonomy-stable"),
    (error) => error instanceof SignalTaxonomyEnrichmentRetiredError
      && error.code === SIGNAL_TAXONOMY_ENRICHMENT_RETIRED_REASON
  );
});
