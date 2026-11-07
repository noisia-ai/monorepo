import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { SIGNAL_WORKSPACE_MASS_LABELING_PROFILE_V1, SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, signalWorkspaceEmbeddingDigestV1 } from "@noisia/query-engine";
import { createProcessingPolicyIdentitiesV1 } from "./signal-processing-policy.fixture";
import { insertSignalTaxonomyDraftCoreV1 } from "../signal-taxonomy-profile";
import { loadSignalWorkspaceTopicPrototypePlanV1 } from "../signal-workspace-topic-prototype-inputs";
import { loadSignalWorkspaceEnginePreflightV1 } from "../signal-workspace-engine";
import { signalWorkspaceFeatureEnabledV1 } from "../signal-workspace-features";

// This acceptance test runs on the complete migrated PostgreSQL CI schema.
test("mass-labeling profile selection is workspace-scoped and seeds exclude study taxonomy", {
  skip: process.env.NOISIA_MFP_PG_CI !== "true", timeout: 120_000,
}, async () => {
  const previous = process.env.NOISIA_MASS_LABELING_ENABLED;
  process.env.NOISIA_MASS_LABELING_ENABLED = "true";
  const database = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
  const client = await database.connect();
  try {
    assert.equal((await client.query("SELECT current_database() name")).rows[0].name, "noisia_mfp_ci");
    await client.query("BEGIN");
    const fixture = await createProcessingPolicyIdentitiesV1({ database, scoped: client });
    const { workspace_id, brand_id } = fixture.first, actor_user_id = fixture.actors.internal;
    await client.query("UPDATE brands SET industry='Synthetic beer category' WHERE id=$1", [brand_id]);
    await client.query("INSERT INTO signal_workspace_features(workspace_id,feature,enabled_by) VALUES($1,'mass_labeling',$2)", [workspace_id, actor_user_id]);
    const options = { queryable: client, workspace_id, actor_user_id };
    assert.equal(await signalWorkspaceFeatureEnabledV1({ ...options, feature: "mass_labeling" }), true);
    assert.equal(await signalWorkspaceFeatureEnabledV1({ ...options, workspace_id: fixture.foreign.workspace_id, feature: "mass_labeling" }), false);
    const profile = await insertSignalTaxonomyDraftCoreV1({ client, workspace_id, kind: "topic",
      context_hash: signalWorkspaceEmbeddingDigestV1("test"), terms: [{ term_key: "delivered-study-label",
        label: "Synthetic delivered-study label must never guide discovery", definition: "Excluded synthetic baseline", metadata: {} }],
      rules: {}, rule_set_metadata: {}, provider: "operator", model_version: "fixture",
      prompt_hash: signalWorkspaceEmbeddingDigestV1("fixture"), model_metadata: {},
      profile_metadata: { contract_version: "signal-topic-catalog-v1" }, context_refs: [] });
    const plan = await loadSignalWorkspaceTopicPrototypePlanV1(options);
    assert.equal(plan.taxonomy_profile_id, profile.profileId);
    assert.deepEqual(plan.topics, []);
    assert.ok(Object.values(plan.texts).some(text => text.includes("Synthetic beer category")));
    assert.ok(Object.values(plan.texts).every(text => !text.includes("delivered-study")));
    assert.ok(plan.context_inputs?.every(input => input.role === "scope_positive" && input.guide_key.startsWith("scope:")));
    const prep = randomUUID(), embeddings = randomUUID();
    await client.query("INSERT INTO signal_corpus_preparation_input_state(workspace_id) VALUES($1) ON CONFLICT DO NOTHING", [workspace_id]);
    const revision = (await client.query("SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=$1", [workspace_id])).rows[0].input_revision;
    await client.query(`INSERT INTO signal_corpus_preparation_runs(id,workspace_id,actor_user_id,worker_job_id,status,phase,input_revision)
      VALUES($1::uuid,$2,$3,$1::text,'completed','complete',$4)`, [prep, workspace_id, actor_user_id, revision]);
    await client.query(`INSERT INTO signal_workspace_embedding_runs(id,workspace_id,preparation_run_id,actor_user_id,input_revision,
      profile,config_digest,quote_digest,request_keys,hard_cap_micro_usd,estimated_upper_micro_usd,status,counts,worker_job_id,input_contract,completed_at)
      VALUES($1::uuid,$2,$3,$4,$5,$6::jsonb,$7,$7,'{}',1,0,'completed','{"eligible_roots":83962}'::jsonb,$1::text,'corpus',clock_timestamp())`,
      [embeddings, workspace_id, prep, actor_user_id, revision, JSON.stringify(SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1), SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1.config_digest]);
    const savepoints: string[] = [];
    const scoped = Object.create(client) as PoolClient;
    scoped.query = (async (sql: string, values?: unknown[]) => {
      if (sql.startsWith("BEGIN")) { const key = `pilot_${savepoints.length}`; savepoints.push(key); return client.query(`SAVEPOINT ${key}`); }
      if (sql === "COMMIT") return client.query(`RELEASE SAVEPOINT ${savepoints.pop()!}`);
      if (sql === "ROLLBACK") return client.query(`ROLLBACK TO SAVEPOINT ${savepoints.pop()!}`);
      return client.query(sql, values);
    }) as PoolClient["query"];
    scoped.release = () => {};
    const txDatabase = Object.assign(Object.create(database) as Pool, { query: scoped.query, connect: async () => scoped });
    const preflight = await loadSignalWorkspaceEnginePreflightV1({ database: txDatabase, workspace_id, actor_user_id });
    assert.equal(preflight.engine_configuration?.profile_version, SIGNAL_WORKSPACE_MASS_LABELING_PROFILE_V1);
    assert.equal(preflight.engine_configuration?.hdbscan_min_cluster_size, 84);
    assert.equal(preflight.engine_configuration?.maximum_topics, 200);
    assert.equal(preflight.total_interests, 0);
    process.env.NOISIA_MASS_LABELING_ENABLED = "false";
    assert.equal(await signalWorkspaceFeatureEnabledV1({ ...options, feature: "mass_labeling" }), false);
  } finally {
    await client.query("ROLLBACK"); client.release(); await database.end();
    if (previous === undefined) delete process.env.NOISIA_MASS_LABELING_ENABLED;
    else process.env.NOISIA_MASS_LABELING_ENABLED = previous;
  }
});
