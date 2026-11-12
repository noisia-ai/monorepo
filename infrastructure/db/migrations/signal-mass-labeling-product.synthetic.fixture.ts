import { assertConcurrentMassLabelingJevRecoveryV1 } from "./signal-mass-labeling-concurrent.synthetic.fixture";
import { reconcileMassLabelingJevReceiptV1 } from "../signal-mass-labeling-jev-recovery";
import { createHash } from "node:crypto";
import { recoverMassLabelingJevReceiptsV1 } from "../../../services/workers/src/workers/signal-mass-labeling-jev-recovery";
import { retryMassLabelingProductV2 } from "../signal-mass-labeling-product";
import { assertMassLabelingServingProjectionV1 } from "./signal-mass-labeling-serving-projection.assertions";
import {estimateMassLabelingProductV2} from "../signal-mass-labeling-product-estimate";
import {massLabelingConfigurationV2} from "@noisia/query-engine";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { JevRequestV1 } from "@noisia/query-engine/src/signal-mention-facets-jev-v1";
import type { PoolClient } from "pg";
import { enableMassLabelingProductV2, requestMassLabelingProductV2, loadMassLabelingProductStatusV2, publishMassLabelingProductResultV2 } from "../signal-mass-labeling-product";
import { getMassLabelingStudyPolicyV1, updateMassLabelingStudyPolicyV1 } from "../signal-mass-labeling-study-policy";
import { createMassLabelingStoreV1, continueMassLabelingV1, measureMassLabelingSmokeV1 } from "../signal-mass-labeling";
import type { LabelingDatabaseV1 } from "../signal-mention-facets";
import { processMassLabelingJevV1 } from "../../../services/workers/src/workers/signal-mass-labeling-jev";
import { loadMassLabelingConsumerEvidenceV1, loadSignalWorkspaceTopicsOverviewV1 } from "../signal-workspace-topics-serving";

/** Exercises the normal native admission and unified transport over a real,
 * invented-data map supplied by the existing migrated PostgreSQL fixture. */
export async function assertMassLabelingProductNativeV2(args: {
  database: LabelingDatabaseV1; query: PoolClient["query"]; workspace_id: string; actor_user_id: string; map_id: string; concurrent_recovery?: boolean; foreign_actor_id?: string;
}) {
  const interests = [{ key: "travel", name: "Travel", definition: "Travel and tourism", active: true },
    ...(args.concurrent_recovery ? [{ key: "equipment", name: "Equipment", definition: "Bicycle equipment and maintenance", active: true }] : [])];
  const policy = await getMassLabelingStudyPolicyV1(args);
  await updateMassLabelingStudyPolicyV1({ ...args, ...policy, expected_revision: policy.revision,
    category: "bicycles", lexicon_terms: ["bicycle", "bike"], candidate_language: "en",
    interest_threshold: .85, interests });
  const activation = await enableMassLabelingProductV2({ ...args, cap_micro_usd: 1_000_000 });
  assert.equal(activation.request_version, "mass-labeling-jev-v2");
  const request = { ...args, idempotency_key: randomUUID(), cap_micro_usd: 1_000_000, provider_available: true };
  const preview=await loadMassLabelingProductStatusV2(args);
  const admitted = await requestMassLabelingProductV2(request);
  assert.equal((await requestMassLabelingProductV2(request)).run_id, admitted.run_id);
  const recorded = (await args.query(`SELECT run.processing_admission_id,run.membership_snapshot,labeler.identity
    FROM signal_labeling_runs run JOIN signal_labeler_versions labeler ON labeler.id=run.labeler_version_id WHERE run.id=$1`, [admitted.run_id])).rows[0]!;
  assert.ok(recorded.processing_admission_id);
  assert.equal(preview.estimated_micro_usd,Number((await args.query("SELECT estimated_micro_usd FROM signal_labeling_runs WHERE id=$1",[admitted.run_id])).rows[0].estimated_micro_usd),
    "the status preview and admission share one estimate for the exact active configuration");
  assert.equal((await args.query("SELECT count(*)::int n FROM signal_mass_labeling_product_estimates WHERE workspace_id=$1 AND map_id=$2",[args.workspace_id,args.map_id])).rows[0].n,1);
  const cached=(await args.query("SELECT root_count roots,input_characters::text characters FROM signal_mass_labeling_product_estimates WHERE workspace_id=$1 AND map_id=$2",[args.workspace_id,args.map_id])).rows[0];
  const dimensions={roots:cached.roots,characters:Number(cached.characters)};
  const config=massLabelingConfigurationV2(recorded.identity.params);
  assert.equal(estimateMassLabelingProductV2(dimensions,config),preview.estimated_micro_usd);
  assert.ok(estimateMassLabelingProductV2({...dimensions,characters:dimensions.characters+1000},config)>preview.estimated_micro_usd!);
  assert.ok(estimateMassLabelingProductV2(dimensions,{...config,interests:[...config.interests,
    {key:"additional",name:"Additional interest",definition:"A longer active interest definition.".repeat(10)}]})>preview.estimated_micro_usd!);

  assert.equal(recorded.identity.params.request_version, "mass-labeling-jev-v2");
  assert.equal(recorded.identity.params.question_language, "en");
  assert.equal(recorded.identity.params.category, "bicycles");
  assert.equal(recorded.identity.params.interests.length, interests.length);
  await args.query("SET CONSTRAINTS ALL IMMEDIATE"); await args.query("SET CONSTRAINTS ALL DEFERRED");
  const scopeBefore = (await args.query(`SELECT run.processing_admission_id,run.cap_micro_usd::text,run.budget_micro_usd::text,
    run.request_digest,run.membership_snapshot,mass.smoke_root_limit,to_jsonb(admission) admission
    FROM signal_labeling_runs run JOIN signal_mass_labeling_runs mass ON mass.run_id=run.id
    JOIN signal_processing_admissions admission ON admission.id=run.processing_admission_id WHERE run.id=$1`, [admitted.run_id])).rows[0];
  const raw = new Map<string, string>();
  let interrupted: { call_id: string; raw_text: string; raw_sha256: string } | undefined;
  let simulateStorageFailure = true;
  const store = createMassLabelingStoreV1({ database: args.database,
    async storeRaw(receipt) {
      const key = `workspace-engine/${receipt.workspace_id}/${receipt.run_id}/response-${receipt.call_id}.json.${receipt.raw_sha256.slice(7)}.parts.json`;
      if (!interrupted) interrupted = receipt;
      if (simulateStorageFailure && receipt.call_id === interrupted.call_id) throw new Error("workspace_engine_storage_unavailable");
      raw.set(key, receipt.raw_text); return key;
    },
    async loadRaw(receipt) { return raw.get(receipt.storage_key)!; } });
  let sends = 0;
  const provider = { async evaluate(body: JevRequestV1) {
    sends++;
    assert.deepEqual(Object.keys(body.questions).sort(), ["promotion", "voice", "trigger_barrier", "topic_0", ...interests.map(interest => `interest_${interest.key}`)].sort());
    assert.match(JSON.stringify(body.questions.trigger_barrier), /consume or buy bicycles/u);
    assert.doesNotMatch(JSON.stringify(body.questions), /O texto|relevance|spam/u);
    return { body: JSON.stringify({ model: body.model, usage: { input_tokens: 120, output_tokens: 20 },
      answers: Object.fromEntries(Object.entries(body.questions).map(([key, question]) => [key, question.type === "noul"
        ? { type: "noul", noul: key === "promotion" ? .1 : .9 }
        : { type: "choice", choice: key === "voice" ? "individual" : "none", confidence: .9,
          probabilities: Object.fromEntries(Object.keys(question.criteria).map(option => [option,
            option === (key === "voice" ? "individual" : "none") ? .9 : .1 / (Object.keys(question.criteria).length - 1)])) }])) }), http_status: 200, latency_ms: 1 };
  } };
  const failed = await processMassLabelingJevV1({ run_id: admitted.run_id, store, provider });
  assert.equal(failed.status, "failed");
  assert.ok(interrupted);
  const failedStatus = await loadMassLabelingProductStatusV2(args);
  assert.equal(failedStatus.run?.status, "failed");
  await assert.rejects(retryMassLabelingProductV2({ ...args, run_id: admitted.run_id }), /receipt_recovery_required/);
  const exposureBefore = (await args.query(`SELECT count(*) FILTER(WHERE status='settled')::int settled,
    count(*) FILTER(WHERE status='unknown')::int unknown,COALESCE(sum(settled_micro_usd),0)::text confirmed,
    COALESCE(sum(reserved_micro_usd) FILTER(WHERE status='unknown'),0)::text uncertain_reserve,
    COALESCE(sum(CASE WHEN status='settled' THEN settled_micro_usd ELSE reserved_micro_usd END),0)::text exposure
    FROM signal_labeling_calls WHERE run_id=$1`, [admitted.run_id])).rows[0];
  if (args.concurrent_recovery) {
    assert.equal(dimensions.roots, 1002);
    assert.equal(scopeBefore.smoke_root_limit, 1000);
    assert.equal(sends, 200);
    assert.equal(exposureBefore.settled, 199);
    assert.equal(exposureBefore.unknown, 1);
  }
  const root = (await args.query("SELECT inputs->0->>'root_id' root_id FROM signal_labeling_calls WHERE id=$1", [interrupted.call_id])).rows[0].root_id;
  const oldCall = (await args.query("SELECT to_jsonb(c) snapshot FROM signal_labeling_calls c WHERE id=$1", [interrupted.call_id])).rows[0].snapshot;
  const oldResult = (await args.query("SELECT to_jsonb(r) snapshot FROM signal_mass_labeling_results r WHERE call_id=$1", [interrupted.call_id])).rows[0].snapshot;
  const siblings = (await args.query("SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) snapshot FROM signal_labeling_calls c WHERE run_id=$1 AND id<>$2", [admitted.run_id, interrupted.call_id])).rows[0].snapshot;
  assert.equal((await args.query("SELECT probability FROM signal_mass_labeling_topic_probabilities WHERE map_id=$1 AND root_id=$2", [args.map_id, root])).rows[0].probability, null);
  const sha = `sha256:${createHash("sha256").update(interrupted.raw_text).digest("hex")}`;
  assert.equal(sha, interrupted.raw_sha256);
  const stored = { storage_key: `workspace-engine/${args.workspace_id}/${admitted.run_id}/response-${interrupted.call_id}.json.${sha.slice(7)}.parts.json`,
    sha256: sha, size_bytes: Buffer.byteLength(interrupted.raw_text), media_type: "application/json", raw_text: interrupted.raw_text };
  const storage = { async put() { throw new Error("unexpected storage write in mocked recovery"); }, async get() { throw new Error("unexpected storage read in mocked recovery"); },
    async recoverIncomplete() { return stored; } };
  const sendsBeforeRecovery = sends;
  await assert.rejects(recoverMassLabelingJevReceiptsV1({ database: args.database, run_id: admitted.run_id,
    storage: { ...storage, async recoverIncomplete() { return { ...stored, raw_text: "corrupt" }; } } }), /recovery_raw_invalid/);
  if (!args.concurrent_recovery) {
    await args.query("SAVEPOINT recovery_frozen_request");
    await args.query("UPDATE signal_labeling_calls SET request=jsonb_set(request,'{model}',to_jsonb('foreign-model'::text)) WHERE id=$1", [interrupted.call_id]);
    await assert.rejects(recoverMassLabelingJevReceiptsV1({ database: args.database, run_id: admitted.run_id, storage }), /recovery_request_invalid/);
    await args.query("ROLLBACK TO SAVEPOINT recovery_frozen_request"); await args.query("RELEASE SAVEPOINT recovery_frozen_request");
    await args.query("SAVEPOINT recovery_revoked_actor");
    await args.query("UPDATE users SET status='suspended' WHERE id=$1", [args.actor_user_id]);
    await assert.rejects(recoverMassLabelingJevReceiptsV1({ database: args.database, run_id: admitted.run_id, storage }), /forbidden/);
    await args.query("ROLLBACK TO SAVEPOINT recovery_revoked_actor"); await args.query("RELEASE SAVEPOINT recovery_revoked_actor");
  }
  assert.deepEqual((await args.query("SELECT to_jsonb(c) snapshot FROM signal_labeling_calls c WHERE id=$1", [interrupted.call_id])).rows[0].snapshot, oldCall);
  if (args.concurrent_recovery) {
    await assertConcurrentMassLabelingJevRecoveryV1({ ...args, run_id: admitted.run_id, storage });
  } else {
    const recovery = await recoverMassLabelingJevReceiptsV1({ database: args.database, run_id: admitted.run_id, storage });
    assert.equal(recovery.recovered, 1);
  }
  assert.equal(sends, sendsBeforeRecovery);
  assert.equal((await loadMassLabelingProductStatusV2(args)).run?.status, args.concurrent_recovery ? "queued" : "failed",
    "only an explicit Retry changes the reconciled run from failed to queued");
  const audit = (await args.query("SELECT * FROM signal_mass_labeling_jev_receipt_recoveries WHERE call_id=$1", [interrupted.call_id])).rows[0];
  assert.deepEqual(audit.original_call, oldCall);
  assert.deepEqual(audit.original_result, oldResult);
  assert.equal((await args.query("SELECT probability FROM signal_mass_labeling_topic_probabilities WHERE map_id=$1 AND root_id=$2", [args.map_id, root])).rows[0].probability, .9);
  assert.equal((await args.query("SELECT promotion_probability FROM signal_mass_labeling_root_segments WHERE map_id=$1 AND root_id=$2", [args.map_id, root])).rows[0].promotion_probability, .1);
  assert.equal((await args.query("SELECT count(*)::int n FROM signal_mass_labeling_study_interest_results WHERE map_id=$1 AND root_id=$2", [args.map_id, root])).rows[0].n, interests.length);
  assert.deepEqual((await args.query("SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) snapshot FROM signal_labeling_calls c WHERE run_id=$1 AND id<>$2", [admitted.run_id, interrupted.call_id])).rows[0].snapshot, siblings);
  const beforeReplay = (await args.query("SELECT to_jsonb(c) snapshot FROM signal_labeling_calls c WHERE id=$1", [interrupted.call_id])).rows[0].snapshot;
  assert.equal((await recoverMassLabelingJevReceiptsV1({ database: args.database, run_id: admitted.run_id, storage })).recovered, 0);
  const replayArgs = { ...args, run_id: admitted.run_id, call_id: interrupted.call_id, request_digest: audit.request_digest,
    raw_sha256: audit.raw_sha256, raw_storage_key: audit.raw_storage_key, raw_size_bytes: Number(audit.raw_size_bytes),
    result: audit.recovered_result, usage: audit.usage, settled_micro_usd: Number(audit.settled_micro_usd) };
  assert.equal((await reconcileMassLabelingJevReceiptV1(replayArgs)).replayed, true);
  await assert.rejects(reconcileMassLabelingJevReceiptV1({ ...replayArgs, raw_sha256: `sha256:${"f".repeat(64)}` }), /recovery_conflict/);
  await assert.rejects(reconcileMassLabelingJevReceiptV1({ ...replayArgs, settled_micro_usd: replayArgs.settled_micro_usd + 1 }), /recovery_conflict/);
  await assert.rejects(reconcileMassLabelingJevReceiptV1({ ...replayArgs, actor_user_id: args.foreign_actor_id ?? randomUUID() }), /forbidden/);
  await assert.rejects(reconcileMassLabelingJevReceiptV1({ ...replayArgs, workspace_id: randomUUID() }), /forbidden/);
  await assert.rejects(reconcileMassLabelingJevReceiptV1({ ...replayArgs, run_id: randomUUID() }), /recovery_unavailable/);
  if (!args.concurrent_recovery) {
    await args.query("SAVEPOINT immutable_recovery_history");
    await assert.rejects(args.query("DELETE FROM signal_mass_labeling_jev_receipt_recoveries WHERE call_id=$1", [interrupted.call_id]), /history_is_immutable/);
    await args.query("ROLLBACK TO SAVEPOINT immutable_recovery_history"); await args.query("RELEASE SAVEPOINT immutable_recovery_history");
  }
  assert.deepEqual((await args.query("SELECT to_jsonb(c) snapshot FROM signal_labeling_calls c WHERE id=$1", [interrupted.call_id])).rows[0].snapshot, beforeReplay);
  await assertMassLabelingServingProjectionV1(args.query, args.workspace_id, args.map_id);
  const scopeAfter = (await args.query(`SELECT run.processing_admission_id,run.cap_micro_usd::text,run.budget_micro_usd::text,
    run.request_digest,run.membership_snapshot,mass.smoke_root_limit,to_jsonb(admission) admission
    FROM signal_labeling_runs run JOIN signal_mass_labeling_runs mass ON mass.run_id=run.id
    JOIN signal_processing_admissions admission ON admission.id=run.processing_admission_id WHERE run.id=$1`, [admitted.run_id])).rows[0];
  assert.deepEqual(scopeAfter, scopeBefore, "recovery and Retry preserve the original admission, execution cap and smoke limit");
  const exposureAfter = (await args.query(`SELECT count(*) FILTER(WHERE status='settled')::int settled,
    count(*) FILTER(WHERE status='unknown')::int unknown,COALESCE(sum(settled_micro_usd),0)::text confirmed,
    COALESCE(sum(reserved_micro_usd) FILTER(WHERE status='unknown'),0)::text uncertain_reserve,
    COALESCE(sum(CASE WHEN status='settled' THEN settled_micro_usd ELSE reserved_micro_usd END),0)::text exposure
    FROM signal_labeling_calls WHERE run_id=$1`, [admitted.run_id])).rows[0];
  assert.equal(exposureAfter.settled, exposureBefore.settled + 1);
  assert.equal(exposureAfter.unknown, 0);
  assert.equal(BigInt(exposureAfter.confirmed), BigInt(exposureBefore.confirmed) + BigInt(audit.settled_micro_usd));
  assert.equal(BigInt(exposureAfter.exposure), BigInt(exposureBefore.exposure) - BigInt(oldCall.reserved_micro_usd) + BigInt(audit.settled_micro_usd));
  assert.equal((await args.query("SELECT count(*)::int n FROM signal_mass_labeling_jev_receipt_recoveries WHERE run_id=$1", [admitted.run_id])).rows[0].n, 1);
  if (!args.concurrent_recovery) await retryMassLabelingProductV2({ ...args, run_id: admitted.run_id });
  simulateStorageFailure = false;
  for (let page = 0; page < 4; page++) {
    const outcome = await processMassLabelingJevV1({ run_id: admitted.run_id, store, provider });
    if (outcome.status === "completed") break;
  }
  const status = await loadMassLabelingProductStatusV2(args);
  assert.equal(status.run?.status, "completed");
  assert.equal(sends, Math.min(1000, status.map!.root_count));
  if (args.concurrent_recovery) {
    const beforeContinuation = (await args.query(`SELECT count(*)::int calls,count(DISTINCT input->>'root_id')::int roots,
      count(*) FILTER(WHERE item.ordinal>1000)::int beyond_smoke
      FROM signal_labeling_calls receipt CROSS JOIN LATERAL jsonb_array_elements(receipt.inputs) input
      JOIN signal_mass_labeling_items item ON item.map_id=$2 AND item.root_id=(input->>'root_id')::uuid
      WHERE receipt.run_id=$1`, [admitted.run_id, args.map_id])).rows[0];
    assert.deepEqual(beforeContinuation, { calls: 1000, roots: 1000, beyond_smoke: 0 });
    assert.equal((await processMassLabelingJevV1({ run_id: admitted.run_id, store, provider })).status, "not_claimed");
    assert.equal(sends, 1000, "the completed smoke waits for explicit continuation");
    console.log(`# native recovery boundary ${JSON.stringify({ first_page: 200, settled_before: 199, unknown_before: 1,
      settled_after: exposureAfter.settled, smoke_limit: scopeAfter.smoke_root_limit,
      siblings_sha256: createHash("sha256").update(JSON.stringify(siblings)).digest("hex"),
      exposure_before: exposureBefore.exposure, exposure_after: exposureAfter.exposure,
      providers_during_recovery: sendsBeforeRecovery - 200, calls_at_smoke_pause: beforeContinuation.calls })}`);
  }
  const smoke = await measureMassLabelingSmokeV1({ ...args, run_id: admitted.run_id });
  assert.equal(smoke.metrics.technical_failure, false);
  await continueMassLabelingV1({ ...args, run_id: admitted.run_id });
  await processMassLabelingJevV1({ run_id: admitted.run_id, store, provider });
  const published = await publishMassLabelingProductResultV2({ database: args.database, run_id: admitted.run_id });
  assert.equal(published.published, true);
  assert.equal(sends, status.map?.root_count, "continuation reuses settled root calls");
  if(args.concurrent_recovery)assert.deepEqual((await args.query(`SELECT count(*)::int calls,
    count(DISTINCT inputs->0->>'root_id')::int roots FROM signal_labeling_calls WHERE run_id=$1`, [admitted.run_id])).rows[0],
    { calls: 1002, roots: 1002 });
  assert.equal((await publishMassLabelingProductResultV2({ database: args.database, run_id: admitted.run_id })).published, false);
  const overview = await loadSignalWorkspaceTopicsOverviewV1({ ...args, conversation_segment: "all" });
  assert.ok(overview?.is_current);
  assert.equal(overview.denominator, status.map!.root_count);
  assert.equal(overview.terms.filter(term => term.basis === "defined_interest").length, interests.length);
  for (const segment of ["conversation", "advertising", "hashtags"] as const) {
    const filtered = await loadSignalWorkspaceTopicsOverviewV1({ ...args, conversation_segment: segment });
    assert.equal(filtered!.denominator, overview.population_segments![segment], "native product filters use the same frozen population");
  }
  const examples = { ...args, conversation_segment: "conversation" as const, choice: "trigger" as const };
  assert.deepEqual((await loadMassLabelingConsumerEvidenceV1(examples)).items, [], "the native fixture answered none for every consumer");
  await args.query("SET CONSTRAINTS ALL IMMEDIATE"); await args.query("SET CONSTRAINTS ALL DEFERRED");
}
