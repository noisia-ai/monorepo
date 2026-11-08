import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { JevRequestV1 } from "@noisia/query-engine/src/signal-mention-facets-jev-v1";
import type { PoolClient } from "pg";
import { enableMassLabelingProductV2, requestMassLabelingProductV2, loadMassLabelingProductStatusV2, publishMassLabelingProductResultV2 } from "../signal-mass-labeling-product";
import { getMassLabelingStudyPolicyV1, updateMassLabelingStudyPolicyV1 } from "../signal-mass-labeling-study-policy";
import { createMassLabelingStoreV1, continueMassLabelingV1, measureMassLabelingSmokeV1 } from "../signal-mass-labeling";
import type { LabelingDatabaseV1 } from "../signal-mention-facets";
import { processMassLabelingJevV1 } from "../../../services/workers/src/workers/signal-mass-labeling-jev";

/** Exercises the normal native admission and unified transport over a real,
 * invented-data map supplied by the existing migrated PostgreSQL fixture. */
export async function assertMassLabelingProductNativeV2(args: {
  database: LabelingDatabaseV1; query: PoolClient["query"]; workspace_id: string; actor_user_id: string; map_id: string;
}) {
  const policy = await getMassLabelingStudyPolicyV1(args);
  await updateMassLabelingStudyPolicyV1({ ...args, ...policy, expected_revision: policy.revision,
    category: "bicycles", lexicon_terms: ["bicycle", "bike"], candidate_language: "en",
    interest_threshold: .85, interests: [{ key: "travel", name: "Travel", definition: "Travel and tourism", active: true }] });
  const activation = await enableMassLabelingProductV2({ ...args, cap_micro_usd: 1_000_000 });
  assert.equal(activation.request_version, "mass-labeling-jev-v2");
  const request = { ...args, idempotency_key: randomUUID(), cap_micro_usd: 1_000_000, provider_available: true };
  const admitted = await requestMassLabelingProductV2(request);
  assert.equal((await requestMassLabelingProductV2(request)).run_id, admitted.run_id);
  const recorded = (await args.query(`SELECT run.processing_admission_id,run.membership_snapshot,labeler.identity
    FROM signal_labeling_runs run JOIN signal_labeler_versions labeler ON labeler.id=run.labeler_version_id WHERE run.id=$1`, [admitted.run_id])).rows[0]!;
  assert.ok(recorded.processing_admission_id);
  assert.equal(recorded.identity.params.request_version, "mass-labeling-jev-v2");
  assert.equal(recorded.identity.params.question_language, "en");
  assert.equal(recorded.identity.params.category, "bicycles");
  assert.equal(recorded.identity.params.interests.length, 1);
  await args.query("SET CONSTRAINTS ALL IMMEDIATE"); await args.query("SET CONSTRAINTS ALL DEFERRED");
  const raw = new Map<string, string>();
  const store = createMassLabelingStoreV1({ database: args.database,
    async storeRaw(receipt) { const key = `synthetic/${receipt.call_id}`; raw.set(key, receipt.raw_text); return key; },
    async loadRaw(receipt) { return raw.get(receipt.storage_key)!; } });
  let sends = 0;
  const provider = { async evaluate(body: JevRequestV1) {
    sends++;
    assert.deepEqual(Object.keys(body.questions), ["promotion", "voice", "trigger_barrier", "topic_0", "interest_travel"]);
    assert.match(JSON.stringify(body.questions.trigger_barrier), /consume or buy bicycles/u);
    assert.doesNotMatch(JSON.stringify(body.questions), /O texto|relevance|spam/u);
    return { body: JSON.stringify({ model: body.model, usage: { input_tokens: 120, output_tokens: 20 },
      answers: Object.fromEntries(Object.entries(body.questions).map(([key, question]) => [key, question.type === "noul"
        ? { type: "noul", noul: key === "promotion" ? .1 : .9 }
        : { type: "choice", choice: key === "voice" ? "individual" : "none", confidence: .9,
          probabilities: Object.fromEntries(Object.keys(question.criteria).map(option => [option,
            option === (key === "voice" ? "individual" : "none") ? .9 : .1 / (Object.keys(question.criteria).length - 1)])) }])) }), http_status: 200, latency_ms: 1 };
  } };
  for (let page = 0; page < 4; page++) {
    const outcome = await processMassLabelingJevV1({ run_id: admitted.run_id, store, provider });
    if (outcome.status === "completed") break;
  }
  const status = await loadMassLabelingProductStatusV2(args);
  assert.equal(status.run?.status, "completed");
  assert.equal(sends, status.map?.root_count);
  const smoke = await measureMassLabelingSmokeV1({ ...args, run_id: admitted.run_id });
  assert.equal(smoke.metrics.technical_failure, false);
  await continueMassLabelingV1({ ...args, run_id: admitted.run_id });
  await processMassLabelingJevV1({ run_id: admitted.run_id, store, provider });
  const published = await publishMassLabelingProductResultV2({ database: args.database, run_id: admitted.run_id });
  assert.equal(published.published, true);
  assert.equal(sends, status.map?.root_count, "continuation reuses settled root calls");
  assert.equal((await publishMassLabelingProductResultV2({ database: args.database, run_id: admitted.run_id })).published, false);
  await args.query("SET CONSTRAINTS ALL IMMEDIATE"); await args.query("SET CONSTRAINTS ALL DEFERRED");
}
