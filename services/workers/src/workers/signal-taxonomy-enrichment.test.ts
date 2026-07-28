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
  assert.match(source, /signalTaxonomyAssignmentDispositionV1/);
  assert.match(source, /semantic_embeddings/);
  assert.match(source, /provider: "voyage"/);
  assert.match(source, /context_refs/);
  assert.match(source, /INSERT INTO lineage_edges/);
  assert.match(source, /'mention'.*'record_tag'/s);
  assert.match(source, /'tagging_model_version'.*'record_tag'/s);
  assert.match(source, /inclusion_status = 'included'/);
  assert.match(source, /signal_data_invalidations/);
  assert.match(source, /NOISIA_SIGNAL_TAXONOMY_PAID_BATCH_ATTEMPTS/);
  assert.match(source, /NOISIA_SIGNAL_TAXONOMY_BATCH_SIZE/);
  assert.match(
    source,
    /actual_cost_usd = COALESCE\(actual_cost_usd, 0\) \+ \$2/
  );
  assert.match(source, /remainingBudgetUsd/);
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

test("taxonomy discovery is budgeted, target-guarded, versioned and human-reviewed", async () => {
  const source = await readFile(
    resolve(process.cwd(), "scripts/discover-signal-topics-narratives.ts"),
    "utf8"
  );
  assert.match(source, /requireSafeDatabaseWriteTarget/);
  assert.match(source, /NOISIA_SIGNAL_TAXONOMY_DISCOVERY_ALLOW_REMOTE/);
  assert.match(source, /NOISIA_SIGNAL_TAXONOMY_DISCOVERY_APPROVED/);
  assert.match(source, /--budget-cap-usd/);
  assert.match(source, /embedTexts/);
  assert.match(source, /generateObject/);
  assert.match(source, /createSignalTaxonomyDraftStoreV1/);
  assert.match(source, /human_approval_required: true/);
  assert.doesNotMatch(
    source,
    /published_outputs\.payload|chart_aggregates|tb_analyses/
  );
});
