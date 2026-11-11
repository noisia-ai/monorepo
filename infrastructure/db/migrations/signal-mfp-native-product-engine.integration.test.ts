import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { createMassLabelingProductDatabaseFixtureV1 } from "./signal-mass-labeling-product-database.synthetic.fixture";
import { users } from "../schema";
import { provisionMassLabelingProductEditorialPolicyV2 } from "../signal-mass-labeling-editorial-policy";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "../signal-workspace-capabilities";
import { loadSignalWorkspaceEnginePreflightV1, beginSignalWorkspaceEngineV1 } from "../signal-workspace-engine";
import { requestSignalWorkspaceCorpusPreparationStoreV1 } from "../signal-workspace-corpus-preparation-management";
import { quoteSignalWorkspaceEmbeddingsStoreV1, requestSignalWorkspaceEmbeddingsStoreV1 } from "../signal-workspace-embeddings-management";
import { getMassLabelingStudyPolicyV1, updateMassLabelingStudyPolicyV1 } from "../signal-mass-labeling-study-policy";
import { syntheticImportedWorkspaceFixtureV1 } from "./signal-client-workspace-entry.synthetic.fixture";
import { signalWorkspaceCorpusPreparationJobV1 } from "../../../services/workers/src/workers/signal-workspace-corpus-preparation";
import { signalWorkspaceEmbeddingsJobV1 } from "../../../services/workers/src/workers/signal-workspace-embeddings";
import { signalWorkspaceEngineJobV1 } from "../../../services/workers/src/workers/signal-workspace-engine";
import { createBrandContextSyntheticVoyageProviderV1 } from "./signal-brand-context.synthetic.fixture";
import { materializeMassLabelingProductMapV2 } from "../../../services/workers/src/workers/signal-mass-labeling-product-map";
import { assertMassLabelingProductOutboxV1 } from "./signal-mass-labeling-product-outbox.assertions";
import type { WorkspaceEngineStorageV1 } from "../../../services/workers/src/workers/signal-workspace-engine-storage";
import { SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, SIGNAL_WORKSPACE_MASS_LABELING_PRODUCT_CONFIGURATION_V2 as currentConfiguration,
  SIGNAL_WORKSPACE_MASS_LABELING_PRODUCT_LEGACY_CONFIGURATION_V2 as legacyConfiguration,
  type SignalWorkspaceEngineInputManifestV1 } from "@noisia/query-engine";

const hash = (value: string | Buffer) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

/** Runs in its own process so Studio aliases resolve exactly as they do in the
 * normal brand-creation service, and every external transport is synthetic. */
for (const variant of ["current", "legacy", "receipt_recovery"] as const) test(`the native product engine worker admits a new client study without a private operator (${variant})`, {
  skip: process.env.NOISIA_MFP_PG_CI !== "true", timeout: 600_000,
}, async () => {
  if (process.env.NOISIA_MFP_NATIVE_ENGINE_CHILD !== "true") {
    const env: NodeJS.ProcessEnv = { ...process.env, NOISIA_MFP_NATIVE_ENGINE_CHILD: "true",
      TSX_TSCONFIG_PATH: resolve(fileURLToPath(new URL("../../../apps/studio/tsconfig.json", import.meta.url))) };
    for (const key of ["NODE_TEST_CONTEXT", "REDIS_URL", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "ANTHROPIC_API_KEY", "VOYAGE_API_KEY", "TYPESAFE_API_KEY", "NOISIA_MASS_LABELING_ENABLED"]) delete env[key];
    const child = spawnSync(process.execPath, ["--test", "--test-name-pattern", `\\(${variant}\\)$`, "--import", "tsx", fileURLToPath(import.meta.url)], { env, encoding: "utf8", timeout: 540_000, maxBuffer: 2_000_000 });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    assert.match(child.stdout, /# pass 1\b/u); assert.match(child.stdout, /# skipped 2\b/u); assert.match(child.stdout, /native_product_engine_signal_ready/u);
    return;
  }
  const configuration = variant === "legacy" ? legacyConfiguration : currentConfiguration;
  const { database,cleanup:cleanupDatabase } = await createMassLabelingProductDatabaseFixtureV1();
  const client = await database.connect();
  const directory = await mkdtemp(join(tmpdir(), "noisia-native-product-engine-"));
  const originalFetch = globalThis.fetch;
  const originalEnvironment = { ...process.env };
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
    if (variant === "legacy") {
      // Seed the pre-upgrade organization's exact R14 policy before any provider work.
      // All study operations below still use the ordinary client actor and admissions.
      const previous = (await client.query("SELECT id FROM signal_processing_policy_versions WHERE organization_id=$1 AND status='active'", [organization])).rows[0]!.id;
      const successor = randomUUID();
      await client.query("BEGIN");
      try {
        await client.query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
          SELECT $1,organization_id,version+1,'draft',valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id
          FROM signal_processing_policy_versions WHERE id=$2`, [successor, previous]);
        await client.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
          SELECT $1,action,kind,provider,model,
            CASE WHEN action='topic_interpretation' THEN $3::jsonb ELSE configuration END,
            CASE WHEN action='topic_interpretation' THEN signal_semantic_context_digest_json_v2($3::jsonb) ELSE configuration_digest END,
            max_execution_micro_usd,automatic_allowed FROM signal_processing_policy_actions WHERE policy_version_id=$2`,
        [successor, previous, JSON.stringify(configuration)]);
        await client.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1", [previous]);
        await client.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1", [successor]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
    }
    const policy = (await database.query(`SELECT a.action,a.configuration FROM signal_processing_policy_actions a
      JOIN signal_processing_policy_versions p ON p.id=a.policy_version_id WHERE p.organization_id=$1 AND p.status='active'`, [organization])).rows;
    assert.deepEqual(policy.find(row => row.action === "topic_interpretation")?.configuration, configuration);
    const admittedPolicy = await provisionMassLabelingProductEditorialPolicyV2(access);
    assert.equal(admittedPolicy.status, "existing_policy");
    assert.deepEqual(admittedPolicy.configuration, configuration);
    assert.equal(policy.find(row => row.action === "mass_labeling_jev")?.configuration.contract_version, "mass-labeling-jev-v2");
    assert.equal((await database.query("SELECT count(*)::int n FROM signal_taxonomy_profiles WHERE workspace_id=$1", [workspace])).rows[0]!.n, 0);
    await updateMassLabelingStudyPolicyV1({ ...access, expected_revision: 0, category: "bicycles", lexicon_terms: [],
      candidate_language: "en", interest_threshold: .85, interests: [] });
    const imported = await syntheticImportedWorkspaceFixtureV1({ database, scoped: client, query: database.query.bind(database), cleanup: async () => {} },
      { organization_id: organization, brand_id: created.data.id, workspace_id: workspace, actor_user_id: clientActor }, { root_count: 80 });
    const prep = await requestSignalWorkspaceCorpusPreparationStoreV1({ ...access, idempotency_key: randomUUID() });
    const prepJob = (await database.query("SELECT worker_job_id FROM signal_corpus_preparation_runs WHERE id=$1", [prep.run_id])).rows[0]!.worker_job_id;
    await signalWorkspaceCorpusPreparationJobV1({ id: prepJob, data: { run_id: prep.run_id }, updateProgress: async () => {} }, { database, page_size: 80 });
    const quote = await quoteSignalWorkspaceEmbeddingsStoreV1({ ...access, profile: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 });
    const embedded = await requestSignalWorkspaceEmbeddingsStoreV1({ ...access, profile: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
      preparation_run_id: quote.preparation_run_id, quote_digest: quote.quote_digest, idempotency_key: randomUUID(),
      hard_cap_micro_usd: 1_000_000, provider_available: true });
    const embeddingJob = (await database.query("SELECT worker_job_id FROM signal_workspace_embedding_runs WHERE id=$1", [embedded.run_id])).rows[0]!.worker_job_id;
    const voyage = createBrandContextSyntheticVoyageProviderV1();
    await signalWorkspaceEmbeddingsJobV1({ id: embeddingJob, data: { run_id: embedded.run_id }, updateProgress: async () => {} }, { database, provider: voyage.provider });
    const preflight = await loadSignalWorkspaceEnginePreflightV1(access);
    assert.equal(preflight.engine_configuration?.profile_version, "workspace-bertopic-mass-labeling-v3");
    assert.equal(imported.roots.length, 80);
    const startArguments = { ...access, embedding_run_id: embedded.run_id,
      expected_catalog_digest: preflight.expected_catalog_digest, expected_context_digest: preflight.expected_context_digest,
      engine_config: preflight.engine_configuration!, parent_execution_id: null, claude_cap_micro_usd: 30_000_000,
      idempotency_key: randomUUID(), interpretation_config: { call_configuration: configuration,
        daily_cap_micro_usd: 100_000_000, budget_timezone: "America/Mexico_City" } };
    const unapprovedConfiguration = { ...configuration, consolidation_prompt_digest: hash("unapproved editorial prompt") };
    await assert.rejects(beginSignalWorkspaceEngineV1({ ...startArguments, idempotency_key: randomUUID(),
      interpretation_config: { ...startArguments.interpretation_config, call_configuration: unapprovedConfiguration } }), /workspace_engine_interpretation_config_invalid/u);
    const started = await beginSignalWorkspaceEngineV1(startArguments);
    const queued = (await database.query("SELECT execution.status,execution.actor_user_id,outbox.worker_job_id,execution.input_snapshot,execution.processing_admission_id FROM signal_topic_catalog_executions execution JOIN signal_topic_classification_outbox outbox ON outbox.execution_id=execution.id WHERE execution.id=$1", [started.execution_id])).rows[0]!;
    assert.equal(queued.status, "queued"); assert.equal(queued.actor_user_id, clientActor); assert.ok(queued.processing_admission_id);
    assert.equal(queued.input_snapshot.mass_labeling_product, true); assert.equal(queued.input_snapshot.discovery_population, undefined);
    await assertMassLabelingProductOutboxV1({ database,client,execution_id:started.execution_id });
    for (const [candidate, expected] of [[currentConfiguration, true], [legacyConfiguration, true],
      [{ ...configuration, consolidation_prompt_digest: hash("unapproved editorial prompt") }, false],
      [{ ...configuration, max_output_tokens: configuration.max_output_tokens + 1 }, false]] as const) {
      const snapshot = { ...queued.input_snapshot, interpretation_config: {
        ...queued.input_snapshot.interpretation_config, call_configuration: candidate } };
      assert.equal((await database.query("SELECT signal_mass_labeling_product_engine_v2($1,'workspace-topic-engine-v1',$2::jsonb) admitted",
        [workspace, JSON.stringify(snapshot)])).rows[0]!.admitted, expected);
    }

    const bodies = new Map<string, Buffer>();
    const storage: WorkspaceEngineStorageV1 = { async put(args) {
      const body = await readFile(args.file); assert.equal(hash(body), args.sha256);
      const key = `workspace-engine/${args.workspace_id}/${args.execution_id}/${basename(args.file)}.${args.sha256.slice(7)}.parts.json`;
      bodies.set(key, body); return { storage_key: key, sha256: args.sha256, size_bytes: body.length, media_type: args.media_type };
    }, async get(args) { const body = bodies.get(args.stored.storage_key); assert.ok(body); assert.equal(hash(body), args.stored.sha256); await writeFile(args.destination, body); } };
    const localization = (index: number) => {
      const en = { name: `Bicycle topic ${index}`, definition: `Bicycle repair conversation ${index}.` };
      return { original_language: "en", original: en, en, es: { name: `Bicicletas ${index}`, definition: `Conversación sobre bicicletas ${index}.` } };
    };
    let groupRequests = 0, consolidationRequests = 0, processes = 0;
    const interpretedGroups = new Set<string>();
    process.env.NOISIA_WORKSPACE_INTERPRETATION_ENABLED = "true";
    process.env.ANTHROPIC_API_KEY = "synthetic-native-product-test-key";
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://api.anthropic.com/v1/messages"); assert.equal(init?.method, "POST");
      assert.equal(new Headers(init?.headers).get("x-api-key"), "synthetic-native-product-test-key");
      const body = JSON.parse(String(init?.body)), packet = JSON.parse(body.messages[0].content);
      assert.equal(body.model, configuration.model);
      let output: unknown;
      if (packet.clusters) {
        groupRequests++;
        output = { interpretations: packet.clusters.map((group: { cluster_id: string; cluster_digest: string; root_count: number; representatives: Array<{ root_id: string; ref_id: string }> }, index: number) => {
          assert.equal(group.root_count, 20); assert.equal(group.representatives.length, 20);
          assert.equal(new Set(group.representatives.map(ref => ref.root_id)).size, 20);
          assert.ok(!interpretedGroups.has(group.cluster_id)); interpretedGroups.add(group.cluster_id);
          const loc = localization(index);
          return { cluster_id: group.cluster_id, cluster_digest: group.cluster_digest, status: variant === "receipt_recovery" ? "mixed" : "coherent", ...loc.en,
            localization: loc, inclusion: [{ text: "Bicycle repairs and maintenance.", citations: [group.representatives[0]!.ref_id] }], exclusion: [], citations: [group.representatives[0]!.ref_id] };
        }) };
      } else {
        consolidationRequests++;
        assert.equal(packet.groups.length, 4); assert.equal(packet.category_context.category, "bicycles");
        if (variant === "receipt_recovery") {
          const groups=packet.groups as Array<{group_id:string;name:string;definition:string;localization:ReturnType<typeof localization>}>;
          output={topics:groups.map((g,index)=>({topic_key:`bicycle_${index}`,name:g.name,
            definition:index===2?`as ${g.definition}`:g.definition,localization:g.localization,group_ids:[g.group_id]})),
            excluded_groups:groups.slice(0,2).map(g=>({group_id:g.group_id,reason:"Mixed group with limited representation and redundant coverage."})),
            category_lexicon:{category:"bicycles",terms:["bicycle","bicycles","bike"]}};
        } else output = { topics: packet.groups.map((group: { group_id: string }, index: number) => {
          const loc = localization(index); return { topic_key: `bicycle_${index}`, ...loc.en, localization: loc, group_ids: [group.group_id] };
        }), excluded_groups: [], category_lexicon: { category: "bicycles", terms: ["bicycle", "bicycles", "bike"] } };
      }
      return new Response(JSON.stringify({ id: `synthetic-${groupRequests}-${consolidationRequests}`, type: "message", role: "assistant", model: body.model,
        stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(output) }], usage: { input_tokens: 100, output_tokens: 100 } }),
        { status: 200, headers: { "content-type": "application/json", "request-id": "synthetic-native-engine" } });
    };
    // Only the Python numerical boundary is synthetic. The job's authorization,
    // export, evidence join, ledger, HTTP transports, checkpoints and finish are real.
    const runOptions: Parameters<typeof signalWorkspaceEngineJobV1>[1] = {
      database, storage, storage_root: directory, process: async args => {
        processes++;
        const manifestBytes = await readFile(join(args.input_directory, "manifest.json"));
        const input = JSON.parse(manifestBytes.toString()) as SignalWorkspaceEngineInputManifestV1;
        const source = (await readFile(join(args.input_directory, "chunks.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line) as {
          ordinal: number; root_id: string; chunk_index: number; start: number; end: number; chunk_sha256: string;
        });
        assert.equal(source.length, 80); assert.equal(new Set(source.map(row => row.root_id)).size, 80);
        await mkdir(args.output_directory);
        const files: Record<string, string> = { "roots.jsonl": source.map(row => JSON.stringify({ root_id: row.root_id }) + "\n").join(""), "lineage.json": "[]" };
        files["fit-roots.jsonl"] = source.map((row, ordinal) => JSON.stringify({ ordinal, root_id: row.root_id }) + "\n").join("");
        files["fit-population.json"] = JSON.stringify({ contract_version: "canonical-root-centroid-v1", rows: 80, dimensions: 1024,
          dtype: "little-endian-float32", source_records_sha256: input.records.sha256, source_vectors_sha256: input.vectors.sha256,
          roots_sha256: hash(files["fit-roots.jsonl"]!), vectors_sha256: hash("synthetic root centroid vectors") });
        const lanes = (["open", "guided"] as const).map(lane => {
          const assignments = source.map((row, index) => ({ ...row, local_label: Math.floor(index / 20), stable_cluster_id: `group_${Math.floor(index / 20)}`, strength: .9 }));
          files[`assignments.${lane}.jsonl`] = assignments.map(row => JSON.stringify(row) + "\n").join("");
          files[`clusters.${lane}.json`] = JSON.stringify(Array.from({ length: 4 }, (_, index) => {
            const members = assignments.filter(row => row.local_label === index);
            return { stable_cluster_id: `group_${index}`, local_label: index, lane, root_count: 20, chunk_count: 20,
              terms: ["bicycle", "repair"], representative_selection_policy: "distinct-roots-affiliation-boundary-v1",
              representatives: members.map((row, index) => ({ ...row, selection_reason: index === members.length - 1 ? "low_affiliation_boundary" : "high_affiliation" })) };
          }));
          files[`model.${lane}.joblib`] = "synthetic model marker: never deserialize";
          return { lane, assignments_file: `assignments.${lane}.jsonl`, clusters_file: `clusters.${lane}.json`, model_file: `model.${lane}.joblib`,
            occurrences: 80, roots: 80, clusters: 4, outlier_occurrences: 0, fit_unit: "canonical-root-centroid-v1", fit_rows: 80 };
        });
        for (const [name, body] of Object.entries(files)) await writeFile(join(args.output_directory, name), body);
        await writeFile(join(args.output_directory, "manifest.json"), JSON.stringify({ contract_version: "workspace-topic-engine-output-v1", workspace_id: input.workspace_id,
          input_manifest_sha256: hash(manifestBytes), previous_manifest_sha256: null,
          input_identity: { embedding_config_digest: input.embedding_config_digest, context_digest: input.context_digest, catalog_digest: input.catalog_digest, chunk_policy_version: input.chunk_policy_version },
          config: input.config, versions: { fixture: "synthetic numerical boundary only" }, status: "completed",
          counts: { occurrences: 80, roots: 80, guides: input.guides.rows, common_unchanged_roots: 0 }, lanes,
          artifacts: Object.entries(files).map(([file, body]) => ({ file, sha256: hash(body), bytes: Buffer.byteLength(body) })), quality: "uncalibrated", approval_policy: "none" }));
      },
    };
    const job={id:queued.worker_job_id,data:{execution_id:started.execution_id},updateProgress:async()=>{}};
    let result:Awaited<ReturnType<typeof signalWorkspaceEngineJobV1>>;
    if(variant!=="receipt_recovery") result=await signalWorkspaceEngineJobV1(job,runOptions);
    else {
      await assert.rejects(signalWorkspaceEngineJobV1(job,runOptions),/workspace_engine_worker_failed/u);
      const before=(await database.query("SELECT to_jsonb(c) body FROM engine_cost_events c WHERE catalog_execution_id=$1 ORDER BY id",[started.execution_id])).rows;
      const fit=(await database.query("SELECT input_digest,result_summary->'fit_checkpoint' fit FROM signal_topic_catalog_executions WHERE id=$1",[started.execution_id])).rows[0];
      const {resumeWorkspacePaidGlobalConsolidationV2}=await import("../../../apps/studio/src/lib/data-os/workspace-paid-global-replay");
      const {loadSignalWorkspaceMassLabelingGlobalReplaySourceV2}=await import("../signal-mass-labeling-global-recovery");
      const readStored=async(args:{stored:{storage_key:string}})=>{const bytes=bodies.get(args.stored.storage_key);assert.ok(bytes);return bytes.toString('utf8');};
      const replayArgs={database,workspaceId:workspace,actorUserId:clientActor,executionId:started.execution_id,idempotencyKey:randomUUID()};
      await assert.rejects(resumeWorkspacePaidGlobalConsolidationV2({...replayArgs,actorUserId:systemActor},{readStored}),/forbidden|invalid/u);
      await assert.rejects(loadSignalWorkspaceMassLabelingGlobalReplaySourceV2({database,workspace_id:randomUUID(),actor_user_id:clientActor,execution_id:started.execution_id}));
      await resumeWorkspacePaidGlobalConsolidationV2(replayArgs,{readStored});
      await resumeWorkspacePaidGlobalConsolidationV2(replayArgs,{readStored});
      const decision=(await database.query("SELECT * FROM signal_mass_labeling_global_receipt_decisions WHERE execution_id=$1",[started.execution_id])).rows[0];assert.ok(decision);
      assert.equal(decision.created_by_user_id,clientActor);assert.equal(decision.decision.contract_version,"workspace-mass-labeling-receipt-recovery-v2");
      await assert.rejects(database.query("UPDATE signal_mass_labeling_global_receipt_decisions SET decision='{}' WHERE id=$1",[decision.id]),/append-only/u);
      await assert.rejects(database.query("DELETE FROM signal_mass_labeling_global_receipt_decisions WHERE id=$1",[decision.id]),/append-only/u);
      await assert.rejects(database.query(`INSERT INTO engine_cost_events SELECT (jsonb_populate_record(NULL::engine_cost_events,to_jsonb(c)||jsonb_build_object('id',$2::uuid,'idempotency_key',$3::text,'call_state','reserved','attempt_token',$4::uuid))).*
        FROM engine_cost_events c WHERE catalog_execution_id=$1 AND metadata#>>'{mass_labeling_stage,stage}'='global-consolidation-v1'`,[started.execution_id,randomUUID(),randomUUID(),randomUUID()]),/global_receipt_recovery_no_send/u);
      const paid=groupRequests+consolidationRequests;
      globalThis.fetch=async()=>{throw Error("receipt_replay_must_not_send");};
      const outbox=(await database.query("SELECT worker_job_id FROM signal_topic_classification_outbox WHERE execution_id=$1",[started.execution_id])).rows[0];
      result=await signalWorkspaceEngineJobV1({...job,id:outbox.worker_job_id},{...runOptions,process:async()=>{throw Error("receipt_replay_must_not_fit");}});
      assert.equal(groupRequests+consolidationRequests,paid);
      assert.deepEqual((await database.query("SELECT to_jsonb(c) body FROM engine_cost_events c WHERE catalog_execution_id=$1 ORDER BY id",[started.execution_id])).rows,before);
      assert.deepEqual((await database.query("SELECT input_digest,result_summary->'fit_checkpoint' fit FROM signal_topic_catalog_executions WHERE id=$1",[started.execution_id])).rows[0],fit);
    }
    assert.ok(!("operator_required" in result)); assert.equal(processes, 1); assert.equal(interpretedGroups.size, 4);
    assert.ok(groupRequests >= 1); assert.equal(consolidationRequests, 1);
    const finished = (await database.query("SELECT status,actor_user_id FROM signal_topic_catalog_executions WHERE id=$1", [started.execution_id])).rows[0]!;
    assert.equal(finished.status, "ready"); assert.equal(finished.actor_user_id, clientActor);
    assert.ok("output_catalog_profile_id" in result && result.output_catalog_profile_id);
    const catalogArtifact = (await database.query(`SELECT metadata FROM analysis_artifacts WHERE engine_execution_id=$1
      AND artifact_key='materialization.json' AND metadata->>'contract_version'='workspace-topic-materialization-v1'`, [started.execution_id])).rows[0];
    assert.ok(catalogArtifact); assert.equal(catalogArtifact.metadata.output_catalog_profile_id, result.output_catalog_profile_id);
    const ledger = (await database.query(`SELECT cost.actor_user_id,cost.call_state,execution.processing_admission_id,admission.actor_user_id admission_actor
      FROM engine_cost_events cost JOIN signal_topic_catalog_executions execution ON execution.id=cost.catalog_execution_id
      JOIN signal_processing_admissions admission ON admission.id=execution.processing_admission_id WHERE cost.catalog_execution_id=$1`, [started.execution_id])).rows;
    assert.equal(ledger.length, groupRequests + consolidationRequests);
    assert.ok(ledger.every(row => row.actor_user_id === clientActor && row.call_state === "settled" && row.processing_admission_id && row.admission_actor === clientActor));
    const materialized = await materializeMassLabelingProductMapV2({ database, storage });
    assert.equal(materialized.materialized, true, JSON.stringify(materialized)); assert.ok(materialized.map_id);
    const settings = await getMassLabelingStudyPolicyV1(access);
    assert.equal(settings.lexicon_provenance, "editorial"); assert.equal(settings.category, "bicycles"); assert.ok(settings.lexicon_terms.includes("bicycle"));
    const map = (await database.query("SELECT created_by_user_id,root_count,catalog FROM signal_mass_labeling_maps WHERE id=$1", [materialized.map_id])).rows[0]!;
    assert.equal(map.created_by_user_id, clientActor); assert.equal(Number(map.root_count), 80); assert.equal(map.catalog.length, variant === "receipt_recovery" ? 2 : 4);
    console.log("native_product_engine_signal_ready");
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnvironment)) delete process.env[key];
    Object.assign(process.env, originalEnvironment);
    client.release(); await cleanupDatabase(); await rm(directory, { recursive: true, force: true });
  }
});
