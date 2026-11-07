import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { SIGNAL_WORKSPACE_MASS_LABELING_PROFILE_V1, SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, signalWorkspaceEmbeddingDigestV1, prepareWorkspaceCorpusTextChunksV1 } from "@noisia/query-engine";
import { createProcessingPolicyIdentitiesV1 } from "./signal-processing-policy.fixture";
import { insertSignalTaxonomyDraftCoreV1 } from "../signal-taxonomy-profile";
import { loadSignalWorkspaceMassLabelingSeedsV1, loadSignalWorkspaceMassLabelingGuidesV1 } from "../signal-workspace-mass-labeling-profile";
import { loadSignalWorkspaceEnginePreflightV1, beginSignalWorkspaceMassLabelingEngineV1, claimSignalWorkspaceEngineV1, readSignalWorkspaceEngineGuidesV1 } from "../signal-workspace-engine";
import { assertMassLabelingProfileLocaleV1 } from "./signal-mass-labeling-profile.assertions";
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
    const plan = await loadSignalWorkspaceMassLabelingSeedsV1(options);
    assert.ok(profile.profileId);
    assert.ok(plan.seeds.some(seed => seed.names.includes("Synthetic beer category")));
    assert.ok(plan.seeds.every(seed => seed.names.every(name => !name.includes("delivered-study"))));
    const prep = randomUUID(), embeddings = randomUUID();
    await client.query("INSERT INTO signal_corpus_preparation_input_state(workspace_id) VALUES($1) ON CONFLICT DO NOTHING", [workspace_id]);
    const revision = (await client.query("SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=$1", [workspace_id])).rows[0].input_revision;
    await client.query(`INSERT INTO signal_corpus_preparation_runs(id,workspace_id,actor_user_id,worker_job_id,status,phase,input_revision,completed_at)
      VALUES($1::uuid,$2,$3,$1::text,'completed','complete',$4,clock_timestamp())`, [prep, workspace_id, actor_user_id, revision]);
    await client.query(`INSERT INTO signal_workspace_embedding_runs(id,workspace_id,preparation_run_id,actor_user_id,input_revision,
      profile,config_digest,quote_digest,request_keys,hard_cap_micro_usd,estimated_upper_micro_usd,status,counts,worker_job_id,input_contract,completed_at)
      VALUES($1::uuid,$2,$3,$4,$5,$6::jsonb,$7,$7,'{}',1,0,'running','{"eligible_roots":1,"completed_roots":1,"total_chunk_references":1,"processed_chunk_references":1}'::jsonb,$1::text,'corpus',NULL)`,
      [embeddings, workspace_id, prep, actor_user_id, revision, JSON.stringify(SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1), SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1.config_digest]);
    const fragment = "Synthetic beer category is discussed by an invented consumer.";
    const fragmentHash = `sha256:${(await import("node:crypto")).createHash("sha256").update(fragment).digest("hex")}`;
    const chunks = prepareWorkspaceCorpusTextChunksV1(fragment, fragmentHash);
    await client.query(`INSERT INTO signal_corpus_text_assets(workspace_id,text_sha256,chunk_policy_version,full_text,chunks,prepared_at)
      VALUES($1,$2,'corpus-text-chunks-v1',$3,$4::jsonb,clock_timestamp())`, [workspace_id, fragmentHash, fragment, JSON.stringify(chunks)]);
    await client.query(`INSERT INTO signal_corpus_preparation_items(workspace_id,run_id,root_id,asset_sha256,disposition,root_metadata,provenance,fingerprint)
      VALUES($1,$2,$3,$4,'eligible','{}','[]',$4)`, [workspace_id, prep, randomUUID(), fragmentHash]);
    const call = randomUUID();
    await client.query(`INSERT INTO signal_workspace_embedding_calls(id,workspace_id,run_id,config_digest,batch_digest,request_digest,input_keys,batch,
      status,tokens_upper,reserved_micro_usd)
      VALUES($1,$2,$3,$4,$5,$5,ARRAY[$6]::text[],'{}','reserved',1,1)`,
      [call,workspace_id,embeddings,SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1.config_digest,signalWorkspaceEmbeddingDigestV1("synthetic-call"),fragmentHash]);
    await client.query("UPDATE signal_workspace_embedding_calls SET status='in_flight',sent_at=clock_timestamp() WHERE id=$1",[call]);
    await client.query(`UPDATE signal_workspace_embedding_calls SET status='response_persisted',response_body_private='{}',
      response_digest='sha256:'||encode(sha256(convert_to('{}','UTF8')),'hex'),http_status=200,response_at=clock_timestamp() WHERE id=$1`,[call]);
    await client.query(`UPDATE signal_workspace_embedding_calls SET status='settled',observed_tokens=1,observed_micro_usd=1,
      settled_micro_usd=1,settled_at=clock_timestamp() WHERE id=$1`,[call]);
    const vector=Array.from({length:1024},(_,index)=>index===0?1:0);
    await client.query(`INSERT INTO signal_workspace_chunk_embeddings(workspace_id,config_digest,chunk_sha256,call_id,response_index,embedding)
      VALUES($1,$2,$3,$4,0,$5::vector)`, [workspace_id,SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1.config_digest,fragmentHash,call,JSON.stringify(vector)]);
    await client.query("UPDATE signal_workspace_embedding_runs SET status='completed',completed_at=clock_timestamp() WHERE id=$1",[embeddings]);
    const derived=await loadSignalWorkspaceMassLabelingGuidesV1(options);
    assert.equal(derived.guides.length,1);
    assert.equal(derived.guides[0]!.guide_key,"scope:category");
    assert.deepEqual(derived.guides[0]!.vector,vector);
    assert.equal((await client.query("SELECT count(*)::int n FROM signal_semantic_context_generations WHERE workspace_id=$1",[workspace_id])).rows[0].n,0);
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
    assert.equal(preflight.engine_configuration?.hdbscan_min_cluster_size, 40);
    assert.equal(preflight.engine_configuration?.maximum_topics, 200);
    assert.equal(preflight.total_interests, 0);
    assert.equal(preflight.missing_guides,0);
    const started=await beginSignalWorkspaceMassLabelingEngineV1({database:txDatabase,workspace_id,actor_user_id,idempotency_key:randomUUID()});
    const lease=await claimSignalWorkspaceEngineV1({database:txDatabase,execution_id:started.execution_id,worker_job_id:`workspace-engine-${started.execution_id}-1`});
    assert.ok(lease);
    assert.equal(lease.snapshot.claude_cap_micro_usd,0);
    assert.equal(lease.snapshot.interpretation_config,undefined);
    const guides=await readSignalWorkspaceEngineGuidesV1({database:txDatabase,lease,after:null});
    assert.deepEqual(guides.items[0]?.vector,vector);
    assert.equal(guides.items[0]?.input_digest,derived.guides[0]?.input_digest);
    await assertMassLabelingProfileLocaleV1({database:txDatabase,workspace_id,actor_user_id,numeric_lease:lease});
    process.env.NOISIA_MASS_LABELING_ENABLED = "false";
    assert.equal(await signalWorkspaceFeatureEnabledV1({ ...options, feature: "mass_labeling" }), false);
  } finally {
    await client.query("ROLLBACK"); client.release(); await database.end();
    if (previous === undefined) delete process.env.NOISIA_MASS_LABELING_ENABLED;
    else process.env.NOISIA_MASS_LABELING_ENABLED = previous;
  }
});
