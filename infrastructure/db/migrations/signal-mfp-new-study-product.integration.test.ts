import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import type { Pool } from "pg";
import { users } from "../schema";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "../signal-workspace-capabilities";
import { loadSignalWorkspaceEnginePreflightV1 } from "../signal-workspace-engine";
import { requestSignalWorkspaceCorpusPreparationStoreV1 } from "../signal-workspace-corpus-preparation-management";
import { quoteSignalWorkspaceEmbeddingsStoreV1, requestSignalWorkspaceEmbeddingsStoreV1 } from "../signal-workspace-embeddings-management";
import { getMassLabelingStudyPolicyV1, updateMassLabelingStudyPolicyV1 } from "../signal-mass-labeling-study-policy";
import { enableMassLabelingProductV2, requestMassLabelingProductV2 } from "../signal-mass-labeling-product";
import { createMassLabelingStoreV1, continueMassLabelingV1 } from "../signal-mass-labeling";
import { drainMassLabelingProductFinalizationV2 } from "../signal-mass-labeling-product-finalization";
import { loadSignalWorkspaceTopicsOverviewV1 } from "../signal-workspace-topics-serving";
import { syntheticImportedWorkspaceFixtureV1 } from "./signal-client-workspace-entry.synthetic.fixture";
import { workspaceProjectionFixtureBodyV1 } from "./signal-workspace-topic-projection.fixture";
import { signalWorkspaceCorpusPreparationJobV1 } from "../../../services/workers/src/workers/signal-workspace-corpus-preparation";
import { signalWorkspaceEmbeddingsJobV1 } from "../../../services/workers/src/workers/signal-workspace-embeddings";
import { createBrandContextSyntheticVoyageProviderV1 } from "./signal-brand-context.synthetic.fixture";
import { consolidateMassLabelingGroupsV1 } from "../../../services/workers/src/workers/signal-mass-labeling-consolidation";
import { materializeMassLabelingProductMapV2 } from "../../../services/workers/src/workers/signal-mass-labeling-product-map";
import { authorizeMassEngineConsumerV1 } from "../../../services/workers/src/providers/mass-labeling-consumer";
import { signalWorkspaceEngineJobV1 } from "../../../services/workers/src/workers/signal-workspace-engine";
import { signalMassLabelingJevJobV1 } from "../../../services/workers/src/workers/signal-mass-labeling-jev";
import type { WorkspaceEngineStorageV1 } from "../../../services/workers/src/workers/signal-workspace-engine-storage";
import type { JevRequestV1 } from "@noisia/query-engine/src/signal-mention-facets-jev-v1";
import { SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, SIGNAL_WORKSPACE_MASS_LABELING_PRODUCT_CONFIGURATION_V2,
  signalWorkspaceMassLabelingConfigV3 } from "@noisia/query-engine";

const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

test("a client creates a brand and admits and consumes the default product pipeline under its own identity", {
  skip: process.env.NOISIA_MFP_PG_CI !== "true", timeout: 600_000,
}, async () => {
  if (process.env.NOISIA_MFP_NEW_STUDY_CHILD !== "true") {
    const env: NodeJS.ProcessEnv = { ...process.env, NOISIA_MFP_NEW_STUDY_CHILD: "true", TSX_TSCONFIG_PATH: resolve(fileURLToPath(new URL("../../../apps/studio/tsconfig.json", import.meta.url))) };
    for (const key of ["REDIS_URL", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "ANTHROPIC_API_KEY", "VOYAGE_API_KEY", "TYPESAFE_API_KEY", "NOISIA_MASS_LABELING_ENABLED"]) delete env[key];
    delete env.NODE_TEST_CONTEXT;
    const child = spawnSync(process.execPath, ["--test", "--import", "tsx", fileURLToPath(import.meta.url)], { env, encoding: "utf8", timeout: 540_000, maxBuffer: 2_000_000 });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    assert.match(child.stdout,/product_journey_verified roots=5 questions=9 actor=client_admin/,child.stdout+child.stderr);
    assert.match(child.stdout,/# skipped 0/u,child.stdout+child.stderr);
    console.log("verified isolated client journey: 5 roots, 9 questions, 0 skipped tests");
    return;
  }
  const { openDatabase } = await import(new URL("../../../scripts/dev-corpus/guard.mjs", import.meta.url).href);
  const database: Pool = await openDatabase();
  const client = await database.connect();
  const directory = await mkdtemp(join(tmpdir(), "noisia-new-study-product-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("unexpected_real_provider_transport"); };
  try {
    const organization = randomUUID(), systemActor = randomUUID(), clientActor = randomUUID(), brandId = randomUUID();
    await database.query("INSERT INTO organizations(id,slug,legal_name,status) VALUES($1,$2,'Synthetic product journey','active')", [organization, `product-${organization}`]);
    await database.query(`INSERT INTO users(id,email,user_type,primary_role,organization_id,status) VALUES
      ($1,$2,'noisia_internal','noisia_admin',$5,'active'),($3,$4,'client','client_admin',$5,'active')`,
      [systemActor, `${systemActor}@example.test`, clientActor, `${clientActor}@example.test`, organization]);
    process.env.NOISIA_BRAND_CONTEXT_POLICY_CREATOR_USER_ID = systemActor;
    process.env.NOISIA_MFP_PROCESSING_DAILY_CAP_MICRO_USD = "100000000";
    process.env.NOISIA_WORKSPACE_EMBEDDINGS_MAX_COST_MICRO_USD = "1000000";
    process.env.NOISIA_MENTION_FACETS_ENABLED = "false";
    const { db } = await import(new URL("../../../apps/studio/src/lib/db.ts", import.meta.url).href);
    const { createBrandForActorV1 } = await import(new URL("../../../apps/studio/src/lib/data-os/brand-creation-service.ts", import.meta.url).href);
    const [actor] = await db.select().from(users).where(eq(users.id, clientActor));
    assert.ok(actor);
    const response = await createBrandForActorV1(new Request("https://synthetic.invalid/api/brands", { method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": brandId }, body: JSON.stringify({
        organization_id: organization, name: "Synthetic fixture", slug: `synthetic-${brandId}`, industry: "Technology", industry_sub: "Bicycles",
        countries: ["MX"], timezone: "America/Mexico_City", description: "Invented bicycle repair brand", preparation: { idempotency_key: brandId }
      }) }), actor);
    const created = await response.json();
    assert.equal(response.status, 201, JSON.stringify(created));
    assert.equal(created.brand_context_policy.status, "provisioned");
    const workspace = created.signal_workspace.id as string;
    const access = { database, workspace_id: workspace, actor_user_id: clientActor };
    const capability = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: database, ...access });
    assert.equal(capability.can_request_processing, true); assert.equal(capability.can_execute_topics, false);
    const features = (await database.query("SELECT feature FROM signal_workspace_features WHERE workspace_id=$1", [workspace])).rows.map(row => row.feature);
    assert.ok(features.includes("mass_labeling")); assert.ok(!features.includes("mfp_discovery"));
    const policy = (await database.query(`SELECT a.action,a.configuration FROM signal_processing_policy_actions a
      JOIN signal_processing_policy_versions p ON p.id=a.policy_version_id WHERE p.organization_id=$1 AND p.status='active'`, [organization])).rows;
    assert.deepEqual(policy.find(row => row.action === "topic_interpretation")?.configuration, SIGNAL_WORKSPACE_MASS_LABELING_PRODUCT_CONFIGURATION_V2);
    assert.equal(policy.find(row => row.action === "mass_labeling_jev")?.configuration.contract_version, "mass-labeling-jev-v2");
    assert.equal((await database.query("SELECT count(*)::int n FROM signal_taxonomy_profiles WHERE workspace_id=$1", [workspace])).rows[0]!.n, 0);
    await updateMassLabelingStudyPolicyV1({ ...access, expected_revision: 0, category: "bicycles", lexicon_terms: [],
      candidate_language: "en", interest_threshold: .85, interests: [] });
    const imported = await syntheticImportedWorkspaceFixtureV1({ database, scoped: client, query: database.query.bind(database), cleanup: async () => {} },
      { organization_id: organization, brand_id: created.data.id, workspace_id: workspace, actor_user_id: clientActor }, { root_count: 5 });
    const prep = await requestSignalWorkspaceCorpusPreparationStoreV1({ ...access, idempotency_key: randomUUID() });
    const prepJob = (await database.query("SELECT worker_job_id FROM signal_corpus_preparation_runs WHERE id=$1", [prep.run_id])).rows[0]!.worker_job_id;
    await signalWorkspaceCorpusPreparationJobV1({ id: prepJob, data: { run_id: prep.run_id }, updateProgress: async () => {} }, { database, page_size: 5 });
    const quote = await quoteSignalWorkspaceEmbeddingsStoreV1({ ...access, profile: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 });
    const embedded = await requestSignalWorkspaceEmbeddingsStoreV1({ ...access, profile: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
      preparation_run_id: quote.preparation_run_id, quote_digest: quote.quote_digest, idempotency_key: randomUUID(),
      hard_cap_micro_usd: 1_000_000, provider_available: true });
    const embeddingJob = (await database.query("SELECT worker_job_id FROM signal_workspace_embedding_runs WHERE id=$1", [embedded.run_id])).rows[0]!.worker_job_id;
    const voyage = createBrandContextSyntheticVoyageProviderV1();
    await signalWorkspaceEmbeddingsJobV1({ id: embeddingJob, data: { run_id: embedded.run_id }, updateProgress: async () => {} }, { database, provider: voyage.provider });
    const preflight = await loadSignalWorkspaceEnginePreflightV1(access);
    assert.equal(preflight.engine_configuration?.profile_version, "workspace-bertopic-mass-labeling-v3");
    const bodies = new Map<string, string>();
    const storage: WorkspaceEngineStorageV1 = { async put(args) {
      const key = `workspace-engine/${args.workspace_id}/${args.execution_id}/${basename(args.file)}`;
      bodies.set(key, await readFile(args.file, "utf8")); return { storage_key: key, sha256: args.sha256, size_bytes: args.size_bytes, media_type: args.media_type };
    }, async get(args) { const body = bodies.get(args.stored.storage_key); assert.ok(body); await writeFile(args.destination, body); } };
    const projected = await workspaceProjectionFixtureBodyV1({ ...access, query: database.query.bind(database), scoped: client,
      embedding_run_id: embedded.run_id, cleanup: async () => {} }, { preserve_catalog: true, split_guided_groups: 4,
      engine_config: signalWorkspaceMassLabelingConfigV3(5), interpretation_configuration: SIGNAL_WORKSPACE_MASS_LABELING_PRODUCT_CONFIGURATION_V2,
      budget: { cap_micro_usd: 30_000_000, daily_cap_micro_usd: 100_000_000, timezone: "America/Mexico_City" },
      onStarted: async execution_id => {
        assert.equal((await database.query("SELECT status FROM signal_topic_catalog_executions WHERE id=$1",[execution_id])).rows[0]!.status,"queued");
        assert.equal(await authorizeMassEngineConsumerV1({database,execution_id}),true);
        await database.query("UPDATE users SET status='inactive' WHERE id=$1",[clientActor]);
        assert.equal(await authorizeMassEngineConsumerV1({database,execution_id}),false);
        assert.deepEqual(await signalWorkspaceEngineJobV1({id:'synthetic-revoked-engine',data:{execution_id},updateProgress:async()=>{}},{database}),{execution_id,operator_required:true});
        assert.equal((await database.query("SELECT status FROM signal_topic_catalog_executions WHERE id=$1",[execution_id])).rows[0]!.status,"queued");
        await database.query("UPDATE users SET status='active' WHERE id=$1",[clientActor]);
      },
      onClaimed: async execution_id => {
        // The real handler must reach its native lease guard without an operator
        // or injected stores. The fixture's existing live lease blocks a second
        // numerical fit, preserving the independently tested numerical packet.
        const job_id=(await database.query("SELECT worker_job_id FROM signal_topic_classification_outbox WHERE execution_id=$1",[execution_id])).rows[0]!.worker_job_id;
        assert.deepEqual(await signalWorkspaceEngineJobV1({id:job_id,data:{execution_id},updateProgress:async()=>{}},{database}),{execution_id,replayed:true});
      },
      onCheckpoint: async fixture => {
        if (fixture.proposals.length !== 4) return;
        for (const [key, body] of fixture.bodies) bodies.set(key, body);
        const proposals = await Promise.all(fixture.proposals.map(async (packet, index) => { const file = join(directory, `proposal-${index}.json`); await writeFile(file, packet.body); return { artifact_id: packet.artifact_id, file }; }));
        const groups = fixture.proposals.flatMap(packet => JSON.parse(packet.body).clusters);
        await consolidateMassLabelingGroupsV1({ database, lease: fixture.lease, actor_user_id: clientActor, proposals,
          expected_group_ids: groups.map(group => group.cluster_id), expected_cluster_digests: Object.fromEntries(groups.map(group => [group.cluster_id, group.cluster_digest])),
          directory, storage, provider_enabled: true, api_key: "synthetic-not-used", send: async args => {
            const body = JSON.parse(args.batch.request_body), input = JSON.parse(body.messages[0].content);
            const output = { topics: input.groups.map((group: { group_id: string }, index: number) => {
              const en = { name: `Bicycle topic ${index}`, definition: `Bicycle repair conversation ${index}.` };
              return { topic_key: `bicycle_${index}`, ...en, localization: { original_language: "en", original: en, en, es: { name: `Bicicletas ${index}`, definition: `Conversación sobre bicicletas ${index}.` } }, group_ids: [group.group_id] };
            }), excluded_groups: [], category_lexicon: { category: "bicycles", terms: ["bicycle", "bicycles", "bike"] } };
            assert.equal(await args.authorize_send(), true);
            const raw = JSON.stringify({ id: "synthetic", type: "message", role: "assistant", model: args.batch.configuration.model,
              stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(output) }], usage: { input_tokens: 100, output_tokens: 100 } });
            const receipt = { bytes: Buffer.from(raw), http_status: 200, provider_request_id: "synthetic", complete: true, sha256: hash(raw) };
            await args.persist_receipt(receipt); return receipt;
          } });
      } });
    for (const [key, body] of projected.bodies) bodies.set(key, body);
    const execution = (await database.query("SELECT actor_user_id,input_snapshot FROM signal_topic_catalog_executions WHERE id=$1", [projected.engine_execution_id])).rows[0]!;
    assert.equal(execution.actor_user_id, clientActor); assert.equal(execution.input_snapshot.mass_labeling_product, true);
    assert.equal(execution.input_snapshot.discovery_population, undefined);
    const materialized = await materializeMassLabelingProductMapV2({ database, storage });
    assert.equal(materialized.materialized, true);
    const settings = await getMassLabelingStudyPolicyV1(access);
    assert.equal(settings.lexicon_provenance, "editorial"); assert.ok(settings.lexicon_terms.includes("bicycle"));
    await updateMassLabelingStudyPolicyV1({ ...access, ...settings, expected_revision: settings.revision, interests: [
      { key: "travel", name: "Travel", definition: "Travel and tourism", active: true },
      { key: "repairs", name: "Repairs", definition: "Repair services and appointments", active: true }
    ] });
    await enableMassLabelingProductV2({ ...access, cap_micro_usd: 1_000_000 });
    const intent = { ...access, map_id: materialized.map_id!, idempotency_key: randomUUID(), cap_micro_usd: 1_000_000, provider_available: true };
    const [admitted, replay] = await Promise.all([requestMassLabelingProductV2(intent), requestMassLabelingProductV2(intent)]);
    assert.equal(admitted.run_id, replay.run_id);
    const raws = new Map<string, string>();
    const store = createMassLabelingStoreV1({ database, async storeRaw(raw) { raws.set(raw.call_id, raw.raw_text); return `synthetic/${raw.call_id}`; }, async loadRaw(raw) { return raws.get(raw.call_id)!; } });
    let sends = 0;
    const provider = { async evaluate(request: JevRequestV1) { sends++; assert.equal(Object.keys(request.questions).length, 9);
      assert.ok(request.questions.interest_travel && request.questions.interest_repairs); assert.ok(!request.questions.relevance && !request.questions.spam);
      return { http_status: 200, latency_ms: 1, body: JSON.stringify({ model: request.model, usage: { input_tokens: 300, output_tokens: 30 },
        answers: Object.fromEntries(Object.entries(request.questions).map(([key, question]) => [key, question.type === "noul" ? { type: "noul", noul: key === "promotion" ? .1 : .9 }
          : { type: "choice", choice: key === "voice" ? "individual" : "none", confidence: .9, probabilities: Object.fromEntries(Object.keys(question.criteria).map(option => [option,
            option === (key === "voice" ? "individual" : "none") ? .9 : .1 / (Object.keys(question.criteria).length - 1)])) }])) }) }; } };
    let preflight_probes=0;
    const provider_preflight={api_key:'synthetic-not-used',fetch_impl:async(url:Parameters<typeof fetch>[0])=>{
      assert.equal(String(url),'https://api.typesafe.ai/v1/models');preflight_probes++;return new Response('{}',{status:200});
    }};
    const job={data:{run_id:admitted.run_id}};
    await assert.rejects(signalMassLabelingJevJobV1(job,{database,store,provider,provider_preflight:{api_key:'synthetic-not-used',fetch_impl:async()=>new Response('{}',{status:401})}}),/mass_labeling_provider_unavailable/u);
    assert.equal(sends,0);
    await database.query("DELETE FROM signal_workspace_features WHERE workspace_id=$1 AND feature='mass_labeling'",[workspace]);
    await assert.rejects(signalMassLabelingJevJobV1(job,{database,store,provider,provider_preflight}),/mass_labeling_not_enabled/u);
    assert.equal(sends,0);
    await database.query("INSERT INTO signal_workspace_features(workspace_id,feature,enabled_by) VALUES($1,'mass_labeling',$2)",[workspace,clientActor]);
    const crash = { query: database.query.bind(database), async connect() { throw new Error("synthetic_finalization_crash"); } };
    await assert.rejects(signalMassLabelingJevJobV1(job,{database:crash,store,provider,provider_preflight}), /synthetic_finalization_crash/u);
    assert.equal(sends, 5);
    const completedSmoke = (await database.query(`SELECT run.status,mass.smoke_metrics FROM signal_labeling_runs run
      JOIN signal_mass_labeling_runs mass ON mass.run_id=run.id WHERE run.id=$1`, [admitted.run_id])).rows[0]!;
    assert.equal(completedSmoke.status, "completed"); assert.equal(completedSmoke.smoke_metrics, null);
    // Advance only the synthetic scheduling field, leaving every paid receipt intact.
    await database.query("UPDATE signal_labeling_runs SET next_poll_at=clock_timestamp() WHERE id=$1", [admitted.run_id]);
    const recoveredSmoke = await drainMassLabelingProductFinalizationV2({ database });
    assert.equal(recoveredSmoke.finalized, true);
    assert.equal(sends, 5);
    assert.ok((await database.query("SELECT smoke_metrics FROM signal_mass_labeling_runs WHERE run_id=$1", [admitted.run_id])).rows[0]!.smoke_metrics);
    await continueMassLabelingV1({ ...access, run_id: admitted.run_id });
    await assert.rejects(signalMassLabelingJevJobV1(job,{database:crash,store,provider,provider_preflight}), /synthetic_finalization_crash/u);
    await database.query("UPDATE signal_labeling_runs SET next_poll_at=clock_timestamp() WHERE id=$1", [admitted.run_id]);
    assert.equal((await drainMassLabelingProductFinalizationV2({ database })).finalized, true);
    assert.equal((await signalMassLabelingJevJobV1(job,{database,store,provider,provider_preflight})).status, "not_claimed");
    assert.equal(sends, 5);
    assert.ok(preflight_probes>=4);
    const overview = await loadSignalWorkspaceTopicsOverviewV1({ ...access, conversation_segment: "all" });
    assert.ok(overview);
    assert.equal(overview.denominator, imported.roots.length);
    assert.equal(overview.terms.filter(term => term.basis === "defined_interest").length, 2);
    assert.ok(overview.terms.filter(term => term.basis === "defined_interest").every(term => term.mention_count === 5));
    const owner = (await database.query("SELECT actor_user_id FROM signal_labeling_runs WHERE id=$1", [admitted.run_id])).rows[0]!;
    assert.equal(owner.actor_user_id, clientActor);
    console.log("product_journey_verified roots=5 questions=9 actor=client_admin");
  } finally { globalThis.fetch = originalFetch; client.release(); await database.end(); await rm(directory, { recursive: true, force: true }); }
});
