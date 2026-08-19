import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { SIGNAL_TAXONOMY_ENRICHMENT_JOB_NAME } from "@noisia/query-engine";
import {
  assertSignalTaxonomyJobNotRetiredV1,
  SignalTaxonomyEnrichmentRetiredError
} from "./signal-taxonomy-enrichment-runtime";

test("manual queue injection is rejected before worker/provider dispatch", () => {
  assert.throws(
    () => assertSignalTaxonomyJobNotRetiredV1(SIGNAL_TAXONOMY_ENRICHMENT_JOB_NAME),
    SignalTaxonomyEnrichmentRetiredError
  );
  assert.doesNotThrow(() => assertSignalTaxonomyJobNotRetiredV1("signal.materialize.v1"));
});

test("legacy worker is an auditable tombstone without provider or tag writers", async () => {
  const source = await readFile(
    resolve(process.cwd(), "src/workers/signal-taxonomy-enrichment.ts"),
    "utf8"
  );
  assert.match(source, /status='blocked'/);
  assert.match(source, /provider_calls',0/);
  assert.match(source, /SignalTaxonomyEnrichmentRetiredError/);
  assert.doesNotMatch(source, /@ai-sdk\/anthropic|@ai-sdk\/voyage|generateObject|embedMany/);
  assert.doesNotMatch(source, /INSERT INTO record_tags|UPDATE record_tags|INSERT INTO record_feature_values/);
});

test("refresh no longer produces or recovers full-pop taxonomy jobs", async () => {
  const source = await readFile(
    resolve(process.cwd(), "src/workers/signal-refresh.ts"),
    "utf8"
  );
  assert.match(source, /taxonomy_enrichment_state: "retired_10b"/);
  assert.match(source, /SIGNAL_TAXONOMY_ENRICHMENT_RETIRED_REASON/);
  assert.match(source, /status IN \('queued','running','partial','failed'\)/);
  assert.doesNotMatch(source, /status IN \([^)]*'blocked'/);
  assert.doesNotMatch(source, /queue\.add\(\s*SIGNAL_TAXONOMY_ENRICHMENT_JOB_NAME/);
  assert.doesNotMatch(source, /signalTaxonomyEnrichmentIdempotencyKeyV1/);
});

test("taxonomy discovery remains a separate bounded draft-only compatibility tool", async () => {
  const source = await readFile(
    resolve(process.cwd(), "scripts/discover-signal-topics-narratives.ts"),
    "utf8"
  );
  assert.match(source, /createSignalTaxonomyDraftStoreV1/);
  assert.match(source, /human_approval_required: true/);
  assert.doesNotMatch(source, /published_outputs\.payload|chart_aggregates|tb_analyses/);
});
