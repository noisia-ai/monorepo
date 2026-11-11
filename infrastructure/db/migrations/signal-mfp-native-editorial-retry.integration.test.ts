import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { SIGNAL_WORKSPACE_MASS_LABELING_PRODUCT_CONFIGURATION_V2, signalWorkspaceEmbeddingDigestV1 } from "@noisia/query-engine";
import * as engine from "../signal-workspace-engine";
import * as money from "../signal-workspace-engine-interpretation";
import { loadSignalDiscoveryPolicyV1 } from "../signal-workspace-discovery-policy";
import { signalMfpLegacyWorkspaceFixtureV1 } from "./signal-mfp-legacy-workspace.synthetic.fixture";

const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

test("native product resumes a definitely-unsent editorial expiry under its original live admission", {
  skip: process.env.NOISIA_MFP_PG_CI !== "true", timeout: 180_000,
}, async (t) => {
  const f = await signalMfpLegacyWorkspaceFixtureV1({
    after_brand_created: async ({ transaction, identity }) => {
      await transaction.query("UPDATE brands SET industry='bicycle' WHERE id=$1", [identity.brand_id]);
    },
  });
  const access = { database: f.database, workspace_id: f.workspace_id, actor_user_id: f.actor_user_id };
  try {
    await f.query("UPDATE users SET primary_role='noisia_admin' WHERE id=$1", [f.actor_user_id]);
    await f.query("INSERT INTO signal_workspace_features(workspace_id,feature,enabled_by) VALUES($1,'mass_labeling',$2) ON CONFLICT DO NOTHING",
      [f.workspace_id, f.actor_user_id]);
    await f.catalog();
    const configuration = SIGNAL_WORKSPACE_MASS_LABELING_PRODUCT_CONFIGURATION_V2;
    const priorPolicy = (await f.query(`SELECT p.* FROM signal_processing_policy_versions p
      JOIN signal_workspaces w ON w.organization_id=p.organization_id WHERE w.id=$1 AND p.status='active'`, [f.workspace_id])).rows[0];
    const policyId = randomUUID();
    await f.query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
      VALUES($1,$2,$3,'draft',now(),$4,$5,$6,$7)`,
      [policyId, priorPolicy.organization_id, Number(priorPolicy.version)+1, priorPolicy.valid_until,
        priorPolicy.budget_timezone, null, f.actor_user_id]);
    await f.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
      SELECT $1,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed
      FROM signal_processing_policy_actions WHERE policy_version_id=$2 AND action<>'topic_interpretation'`, [policyId, priorPolicy.id]);
    await f.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
      VALUES($1,'topic_interpretation','provider','anthropic',$2,$3::jsonb,$4,NULL,false)`,
      [policyId, configuration.model, JSON.stringify(configuration), signalWorkspaceEmbeddingDigestV1(configuration)]);
    await f.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1", [priorPolicy.id]);
    await f.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1", [policyId]);
    const policy = await loadSignalDiscoveryPolicyV1(f.database, f.workspace_id);
    const preflight = await engine.loadSignalWorkspaceEnginePreflightV1(access);
    assert.ok(preflight.engine_configuration);
    const started = await engine.beginSignalWorkspaceEngineV1({ ...access, idempotency_key: randomUUID(),
      embedding_run_id: f.embedding_run_id, expected_context_digest: preflight.expected_context_digest,
      expected_catalog_digest: preflight.expected_catalog_digest, engine_config: preflight.engine_configuration,
      claude_cap_micro_usd: policy.maximum_cap_micro_usd, interpretation_config: {
        call_configuration: configuration, budget_timezone: policy.budget_timezone, daily_cap_micro_usd: policy.daily_cap_micro_usd,
      } });
    const lease = await engine.claimSignalWorkspaceEngineV1({ database: f.database, ...started, worker_job_id: "native-retry-fixture" });
    assert.ok(lease);
    const coverage = { roots: lease.snapshot.expected_roots, chunks: lease.snapshot.expected_chunks, guides: lease.snapshot.expected_guides };
    await engine.heartbeatSignalWorkspaceEngineV1({ database: f.database, lease, phase: "persisting",
      exported: { ...coverage, stream_digest: sha("native-retry-export") } });
    const bundle = ["manifest.json", "model-manifest.json", "model.open.joblib", "clusters.open.json",
      "assignments.open.jsonl", "roots.jsonl"].map(name => ({
      name, storage_key: `workspace-engine/${f.workspace_id}/${started.execution_id}/${name}`,
      sha256: sha(name), size_bytes: 10, media_type: "application/octet-stream",
    }));
    const artifacts = new Map<string, string>();
    for (const artifact of bundle) artifacts.set(artifact.name, (await engine.persistSignalWorkspaceEngineArtifactV1({
      database: f.database, lease, artifact: { ...artifact, artifact_key: artifact.name, title: "Synthetic native retry",
        artifact_type: artifact.name === "model-manifest.json" || artifact.name.endsWith(".joblib") ? "engine_model" : "engine_output",
        metadata: { filename: artifact.name, ...(artifact.name === "manifest.json" ? { bundle } : {}) },
      },
    })).artifact_id);
    await engine.checkpointSignalWorkspaceEngineFitV1({ database: f.database, lease, coverage,
      model_artifact_id: artifacts.get("model-manifest.json")!, output_artifact_id: artifacts.get("manifest.json")!,
      result_kind: "computational_grouping", model_configuration: { fixture: true }, runtime_kind: "python",
      artifact_format: "joblib", license_key: null,
      interpretation_manifest: { unit_count: 2, unit_digest: sha('"guided:a"\n"guided:b"\n') },
    });
    const call = await money.reserveSignalWorkspaceEngineInterpretationV1({ ...access, ...started, configuration,
      idempotency_key: randomUUID(), request_digest: sha("native-retry-unsent"), reserved_micro_usd: 1000,
      budget_timezone: policy.budget_timezone, daily_cap_micro_usd: policy.daily_cap_micro_usd,
      execution_token: lease.execution_token, unit_keys: ["guided:a"] });
    await money.failSignalWorkspaceEngineInterpretationV1({ database: f.database, call_id: call.call_id,
      attempt_token: call.attempt_token,
      outcome: "definitely_not_sent", error_code: "workspace_engine_interpretation_daily_authority_expired" });
    await engine.failSignalWorkspaceEngineV1({ database: f.database, lease,
      error_code: "workspace_engine_interpretation_daily_authority_expired" });
    const before = (await f.query("SELECT input_snapshot,processing_admission_id,result_summary->'fit_checkpoint' fit FROM signal_topic_catalog_executions WHERE id=$1",
      [started.execution_id])).rows[0];
    const ledger = (await f.query("SELECT * FROM engine_cost_events WHERE catalog_execution_id=$1 ORDER BY id", [started.execution_id])).rows;
    const status = await engine.loadSignalWorkspaceEngineStatusV1(access);
    assert.equal(status.latest_run?.native_interpretation_retry_eligible, true);
    assert.deepEqual(await engine.assertSignalWorkspaceMassLabelingRecoveryReadyV1({ ...access, ...started }), { pilot: true },
      "native replay accepts its frozen nullable cap without creating provider authority");

    const negative = async (work: () => Promise<void>) => {
      await f.query("SAVEPOINT native_retry_negative");
      try { await work(); } finally { await f.query("ROLLBACK TO SAVEPOINT native_retry_negative"); }
    };
    await negative(async () => {
      await f.query("UPDATE users SET status='suspended' WHERE id=$1", [f.actor_user_id]);
      await assert.rejects(engine.retrySignalWorkspaceEngineV1({ ...access, ...started, idempotency_key: randomUUID() }), /forbidden/u);
    });
    await negative(async () => {
      await f.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=(SELECT policy_version_id FROM signal_processing_admissions WHERE id=$1)",
        [before.processing_admission_id]);
      assert.equal((await engine.loadSignalWorkspaceEngineStatusV1(access)).latest_run?.native_interpretation_retry_eligible, false);
      await assert.rejects(engine.retrySignalWorkspaceEngineV1({ ...access, ...started, idempotency_key: randomUUID() }), /retry_unavailable/u);
    });
    await negative(async () => {
      const otherActor = randomUUID();
      await f.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,status,organization_id)
        VALUES($1,$2,'Synthetic other operator','noisia_internal','noisia_admin','active',$3)`,
        [otherActor, otherActor+"@example.test", priorPolicy.organization_id]);
      const otherAccess = { ...access, actor_user_id: otherActor };
      assert.equal((await engine.loadSignalWorkspaceEngineStatusV1(otherAccess)).latest_run?.native_interpretation_retry_eligible, false);
      await assert.rejects(engine.retrySignalWorkspaceEngineV1({ ...otherAccess, ...started, idempotency_key: randomUUID() }), /forbidden/u);
    });
    await negative(async () => {
      await engine.retrySignalWorkspaceEngineV1({ ...access, ...started, idempotency_key: randomUUID() });
      const sending = await engine.claimSignalWorkspaceEngineV1({ database: f.database, ...started, worker_job_id: "native-retry-negative" });
      assert.ok(sending);
      const pending = await money.reserveSignalWorkspaceEngineInterpretationV1({ ...access, ...started, configuration,
        idempotency_key: randomUUID(), request_digest: sha("native-retry-in-flight"), reserved_micro_usd: 1000,
        budget_timezone: policy.budget_timezone, daily_cap_micro_usd: policy.daily_cap_micro_usd,
        execution_token: sending.execution_token, unit_keys: ["guided:b"] });
      await money.markSignalWorkspaceEngineInterpretationSentV1({ database: f.database, call_id: pending.call_id,
        attempt_token: pending.attempt_token, execution_token: sending.execution_token });
      await engine.failSignalWorkspaceEngineV1({ database: f.database, lease: sending,
        error_code: "workspace_engine_interpretation_daily_authority_expired" });
      assert.equal((await engine.loadSignalWorkspaceEngineStatusV1(access)).latest_run?.native_interpretation_retry_eligible, false);
      await assert.rejects(engine.retrySignalWorkspaceEngineV1({ ...access, ...started, idempotency_key: randomUUID() }), /retry_unavailable/u);
    });
    await negative(async () => {
      await f.query("UPDATE signal_corpus_preparation_input_state SET input_revision=input_revision+1 WHERE workspace_id=$1", [f.workspace_id]);
      await assert.rejects(engine.retrySignalWorkspaceEngineV1({ ...access, ...started, idempotency_key: randomUUID() }), /inputs_stale/u);
    });
    const outboxBefore = (await f.query("SELECT dispatch_generation FROM signal_topic_catalog_executions WHERE id=$1", [started.execution_id])).rows[0];
    const retryKey = randomUUID();
    const retryStartedAt = performance.now();
    const resumed = await engine.retrySignalWorkspaceEngineV1({ ...access, ...started, idempotency_key: retryKey });
    t.diagnostic(`same-run native retry ${Math.round(performance.now()-retryStartedAt)}ms, no provider called`);
    assert.equal(resumed.execution_id, started.execution_id);
    assert.equal(resumed.replayed, false);
    assert.equal((await engine.retrySignalWorkspaceEngineV1({ ...access, ...started, idempotency_key: retryKey })).replayed, true);
    const after = (await f.query("SELECT input_snapshot,processing_admission_id,result_summary->'fit_checkpoint' fit,status FROM signal_topic_catalog_executions WHERE id=$1",
      [started.execution_id])).rows[0];
    assert.equal(after.status, "queued");
    const outboxAfter = (await f.query(`SELECT execution.dispatch_generation,outbox.status outbox_status
      FROM signal_topic_catalog_executions execution JOIN signal_topic_classification_outbox outbox ON outbox.execution_id=execution.id
      WHERE execution.id=$1 AND outbox.dispatch_kind='execution'`, [started.execution_id])).rows[0];
    assert.equal(outboxAfter.dispatch_generation, outboxBefore.dispatch_generation+1);
    assert.equal(outboxAfter.outbox_status, "pending");
    assert.deepEqual({ ...after, status: undefined }, { ...before, status: undefined });
    assert.deepEqual((await f.query("SELECT * FROM engine_cost_events WHERE catalog_execution_id=$1 ORDER BY id", [started.execution_id])).rows, ledger);
    assert.equal((await f.query("SELECT count(*)::int count FROM signal_processing_admissions WHERE target_id=$1", [started.execution_id])).rows[0].count, 1);
  } finally { await f.cleanup(); }
});
