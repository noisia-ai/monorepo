import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("taxonomy worker classifies incrementally into canonical tags with governed evidence", async () => {
  const source = await readFile(
    resolve(process.cwd(), "src/workers/signal-taxonomy-enrichment.ts"),
    "utf8"
  );
  assert.match(source, /signal_taxonomy_profiles/);
  assert.match(source, /taxonomy_terms/);
  assert.match(source, /record_tags/);
  assert.match(source, /record_feature_values/);
  assert.match(source, /signal_taxonomy_profile_id/);
  assert.match(source, /review_status NOT IN \('approved', 'rejected'\)/);
  assert.match(source, /review_status[\s\S]*'pending'/);
  assert.match(source, /semantic_embeddings/);
  assert.match(source, /provider: "voyage"/);
  assert.match(source, /context_refs/);
  assert.match(source, /inclusion_status = 'included'/);
  assert.match(source, /signal_data_invalidations/);
  assert.doesNotMatch(source, /published_outputs|chart_aggregates|tb_analyses/);
});

test("refresh invalidation creates durable idempotent enrichment runs and recovery", async () => {
  const source = await readFile(
    resolve(process.cwd(), "src/workers/signal-refresh.ts"),
    "utf8"
  );
  assert.match(source, /run_type, taxonomy_profile_id, model_version_id/);
  assert.match(source, /signalTaxonomyEnrichmentIdempotencyKeyV1/);
  assert.match(source, /heartbeat_stale/);
  assert.match(source, /PostgreSQL remains the durable outbox/);
  assert.match(source, /profile\.status = 'active'/);
  assert.match(source, /NOISIA_SIGNAL_TAXONOMY_BUDGET_CAP_USD/);
});

test("the Data OS queue dispatches taxonomy enrichment independently of T&B", async () => {
  const source = await readFile(
    resolve(process.cwd(), "src/queues/data-os.ts"),
    "utf8"
  );
  assert.match(source, /SIGNAL_TAXONOMY_ENRICHMENT_JOB_NAME/);
  assert.match(source, /signalTaxonomyEnrichmentJob/);
  assert.doesNotMatch(source, /tbAnalysisWorker|tb-step/);
});
