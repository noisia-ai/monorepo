import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { SignalTopicDefinitionV1 } from "@noisia/query-engine";
import {
  advanceSignalBrandContextPreparationsV1, ensureSignalBrandContextPreparationV1,
  quoteSignalBrandContextPreparationV1, type SignalBrandContextPreparationRuntimeV1,
} from "../signal-brand-context-preparation";
import { prepareSignalSemanticContextProposalInputV1, processSignalSemanticContextProposalRunV1,
  signalSemanticContextProposalRuntimeConfigurationFromEnvV1 } from "../signal-semantic-context-proposal";
import { provisionSignalBrandContextPolicyV1 } from "../signal-brand-context-policy-provisioning";
import { readSignalBrandOsCanonicalSnapshotV1, signalBrandOsCanonicalSnapshotHashV1 } from "../signal-brand-os-snapshot";
import { loadSignalWorkspaceTopicPrototypesV1 } from "../signal-workspace-topic-prototypes-management";
import { createSignalTopicStoreV1 } from "../signal-topic-catalog";
import {
  loadSignalTopicConsolidationRootMetadataV1, materializeSignalTopicAtomicCensusV1,
  materializeSignalTopicCommunityPlanV1, parseSignalTopicAtomicCensusV1, parseSignalTopicCommunityPlanV1,
  signalTopicConsolidationDigestV1 as digest, type SignalTopicAtomicCensusV1,
  type SignalTopicAtomicGroupV1, type SignalTopicConsolidationConfigurationV1,
} from "../signal-topic-consolidation";
import {
  claimSignalTopicConsolidationExecutionV1, completeSignalTopicConsolidationExecutionV1,
  loadSignalTopicConsolidationStatusV1, requestSignalTopicConsolidationV1,
} from "../signal-topic-consolidation-control";
import { loadSignalTopicConsolidationEditorialSourceV1 } from "../signal-topic-consolidation-editorial";
import { loadSignalTopicInterestReviewInputV1 } from "../signal-topic-consolidation-editorial-input";
import {
  BRAND_CONTEXT_SYNTHETIC_ADDITIONAL_KB_V1, BRAND_CONTEXT_SYNTHETIC_INTAKE_V1,
  createBrandContextSyntheticSemanticProviderV1, createBrandContextSyntheticVoyageProviderV1,
  executeBrandContextSyntheticPrototypeRunV1,
} from "./signal-brand-context.synthetic.fixture";
import type { BrandContextSyntheticSaveBindingsV1 } from "./signal-brand-context.integration.assertions";
import { syntheticClientWorkspaceFixtureV1, type SyntheticTransactionV1 } from "./signal-client-workspace-entry.synthetic.fixture";
import { fixtureSha } from "./signal-workspace-topic-projection.fixture";

export type SignalTopicInterestReviewSyntheticSeedArgsV1 = SyntheticTransactionV1 & {
  runtime?: SignalBrandContextPreparationRuntimeV1;
  saves?: Pick<BrandContextSyntheticSaveBindingsV1, "createBrand" | "saveKnowledge">;
};

/** Explicit synthetic configuration. Passing this literal to the parser never
 * reads process.env and does not create a provider transport or credential. */
export const SIGNAL_TOPIC_INTEREST_REVIEW_SYNTHETIC_RUNTIME_V1: SignalBrandContextPreparationRuntimeV1 = {
  semantic: signalSemanticContextProposalRuntimeConfigurationFromEnvV1({
    NOISIA_SEMANTIC_CONTEXT_MODEL: "claude-sonnet-4-6", NOISIA_SEMANTIC_CONTEXT_MODEL_VERSION: "claude-sonnet-4-6",
    NOISIA_SEMANTIC_CONTEXT_PRICING_VERSION: "synthetic-interest-review-v1",
    NOISIA_SEMANTIC_CONTEXT_MAX_INPUT_TOKENS: "20000", NOISIA_SEMANTIC_CONTEXT_MAX_OUTPUT_TOKENS: "8192",
    NOISIA_SEMANTIC_CONTEXT_INPUT_USD_PER_MILLION_TOKENS: "3", NOISIA_SEMANTIC_CONTEXT_OUTPUT_USD_PER_MILLION_TOKENS: "15",
    NOISIA_SEMANTIC_CONTEXT_HARD_CAP_MICRO_USD: "2000000",
  }),
  prototype: { available: true, max_run_cost_micro_usd: 1_000_000 },
  queue_configured: true, worker_alive: true, recovery_alive: true,
};

/** Base input rows ONLY, not acceptance of Studio's creation/knowledge routes.
 * No generation, publication, ready result or provider receipt is inserted here.
 * Brand provisioning triggers, the canonical snapshot helper and policy service
 * remain real; the main fixture then runs the normal semantic transitions. */
export function createSignalTopicInterestReviewSyntheticSavesV1(
  runtime = SIGNAL_TOPIC_INTEREST_REVIEW_SYNTHETIC_RUNTIME_V1,
): Pick<BrandContextSyntheticSaveBindingsV1, "createBrand" | "saveKnowledge"> {
  const refreshSnapshot = async (args: Parameters<BrandContextSyntheticSaveBindingsV1["saveKnowledge"]>[0]) => {
    const snapshot = await readSignalBrandOsCanonicalSnapshotV1({ queryable: args.scoped,
      brand_id: args.brand_id, organization_id: args.organization_id });
    assert.ok(snapshot, "synthetic base brand must resolve through the canonical snapshot reader");
    const metadata = { source: "synthetic-interest-review-base-intake-v1", snapshot_hash: signalBrandOsCanonicalSnapshotHashV1(snapshot),
      display_name: snapshot.name, industry: snapshot.industry, industry_sub: snapshot.industry_sub,
      countries: snapshot.countries, aliases: snapshot.aliases, description: snapshot.description, created_by_user_id: args.actor_user_id };
    await args.scoped.query(`INSERT INTO brand_os_profiles(organization_id,brand_id,name,status,version,metadata)
      VALUES($1,$2,$3,'active',1,$4::jsonb) ON CONFLICT(brand_id,version) WHERE brand_id IS NOT NULL
      DO UPDATE SET metadata=EXCLUDED.metadata,updated_at=clock_timestamp()`,
    [args.organization_id, args.brand_id, `${snapshot.name} Synthetic Brand OS`, JSON.stringify(metadata)]);
  };
  return {
    async createBrand(args) {
      const brand_id = randomUUID();
      await args.scoped.query(`INSERT INTO brands(id,organization_id,slug,name,display_name,description,industry,industry_sub,countries,status)
        VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,'active')`, [brand_id, args.organization_id, args.intake.slug, args.intake.name,
      args.intake.description, args.intake.industry, args.intake.industry_sub, args.intake.countries]);
      const workspace = (await args.scoped.query<{ id: string }>("SELECT id FROM signal_workspaces WHERE brand_id=$1 AND organization_id=$2",
        [brand_id, args.organization_id])).rows[0];
      assert.ok(workspace, "real brand provisioning trigger must create the synthetic workspace");
      await args.scoped.query(`UPDATE signal_workspaces SET timezone=$2,metadata=metadata||$3::jsonb WHERE id=$1`,
        [workspace.id, args.intake.timezone, JSON.stringify({ created_by_user_id: args.actor_user_id,
          creation_request_digest: digest({ contract_version: "synthetic-interest-review-base-intake-v1", brand_id, intake: args.intake }) })]);
      await refreshSnapshot({ ...args, brand_id, title: "Synthetic base identity", raw_text: "" });
      const config = runtime.semantic;
      const policy = await provisionSignalBrandContextPolicyV1({ database: args.database, workspace_id: workspace.id,
        brand_id, initiator_user_id: args.actor_user_id, env: {
          NOISIA_BRAND_CONTEXT_POLICY_CREATOR_USER_ID: args.actor_user_id,
          NOISIA_BRAND_CONTEXT_POLICY_DAILY_CAP_MICRO_USD: String(config.platform_hard_cap_micro_usd + BigInt(runtime.prototype.max_run_cost_micro_usd)),
          NOISIA_BRAND_CONTEXT_POLICY_VALID_UNTIL: new Date(Date.now() + 86_400_000).toISOString(),
          NOISIA_WORKSPACE_EMBEDDINGS_MAX_COST_MICRO_USD: String(runtime.prototype.max_run_cost_micro_usd),
          NOISIA_SEMANTIC_CONTEXT_MODEL: config.model, NOISIA_SEMANTIC_CONTEXT_MODEL_VERSION: config.model_version,
          NOISIA_SEMANTIC_CONTEXT_PRICING_VERSION: config.pricing_version,
          NOISIA_SEMANTIC_CONTEXT_MAX_INPUT_TOKENS: String(config.max_input_tokens),
          NOISIA_SEMANTIC_CONTEXT_MAX_OUTPUT_TOKENS: String(config.max_output_tokens),
          NOISIA_SEMANTIC_CONTEXT_INPUT_USD_PER_MILLION_TOKENS: config.input_usd_per_million_tokens,
          NOISIA_SEMANTIC_CONTEXT_OUTPUT_USD_PER_MILLION_TOKENS: config.output_usd_per_million_tokens,
          NOISIA_SEMANTIC_CONTEXT_HARD_CAP_MICRO_USD: String(config.platform_hard_cap_micro_usd),
        } });
      assert.equal(policy.status, "provisioned", "real policy service must seal the explicit synthetic context allowance");
      return { brand_id, workspace_id: workspace.id };
    },
    async saveKnowledge(args) {
      const source_id = args.source_id ?? randomUUID();
      if (args.source_id) {
        const changed = await args.scoped.query(`UPDATE brand_knowledge_sources SET title=$4,raw_text=$5,file_hash=$6,updated_at=clock_timestamp()
          WHERE id=$1 AND organization_id=$2 AND brand_id=$3 AND study_corpus_id IS NULL`,
        [source_id, args.organization_id, args.brand_id, args.title, args.raw_text, fixtureSha(args.raw_text)]);
        assert.equal(changed.rowCount, 1, "synthetic source edits stay bound to the original brand and tenant");
      } else {
        await args.scoped.query(`INSERT INTO brand_knowledge_sources(id,organization_id,brand_id,source_kind,title,raw_text,file_hash,status,created_by_user_id)
          VALUES($1,$2,$3,'note',$4,$5,$6,'processed',$7)`,
        [source_id, args.organization_id, args.brand_id, args.title, args.raw_text, fixtureSha(args.raw_text), args.actor_user_id]);
      }
      await refreshSnapshot(args);
      return { source_id };
    },
  };
}

const PAID_HISTORY_TABLES = [
  "engine_cost_events", "signal_semantic_context_proposal_runs", "signal_semantic_context_budget_reservations",
  "signal_workspace_embedding_runs", "signal_workspace_embedding_calls", "signal_topic_catalog_executions",
  "signal_processing_policy_versions", "signal_processing_policy_actions", "signal_processing_admissions",
  "signal_topic_consolidation_executions", "signal_topic_consolidation_outbox",
  "signal_topic_editorial_executions", "signal_topic_editorial_requests", "signal_topic_editorial_calls",
  "signal_topic_editorial_outbox", "signal_topic_editorial_request_keys",
] as const;

/** Compare this AFTER the synthetic seed. The existing fixture deliberately
 * records simulated semantic/embedding/interpretation receipts in real ledgers.
 * Hashes include complete rows, so an update cannot hide behind an equal count. */
export async function snapshotSignalTopicInterestReviewSyntheticHistoryV1(tx: Pick<SyntheticTransactionV1, "query">) {
  const snapshot: Record<string, { row_count: number; snapshot_digest: string }> = {};
  for (const table of PAID_HISTORY_TABLES) {
    // Static identifiers only; no evidence, input text or receipt body is returned.
    const row = (await tx.query(`SELECT count(*)::int row_count,
      'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(item)::text,E'\\n' ORDER BY to_jsonb(item)::text),''),'UTF8')),'hex') snapshot_digest
      FROM ${table} item`)).rows[0];
    assert.ok(row, "synthetic history inventory must return one aggregate row");
    snapshot[table] = { row_count: Number(row.row_count), snapshot_digest: String(row.snapshot_digest) };
  }
  return snapshot;
}

/** Positive-source FIXTURE, not an independently passed PostgreSQL gate.
 *
 * Requires the exact current schema (including 0183), a verified EMPTY synthetic
 * target and a READ COMMITTED physical transaction with nested savepoints. The
 * runner owns connection, DDL, cleanup and physical rollback. No environment,
 * provider transport, SQL replacement, disabled trigger or actual fit is used.
 *
 * Real publication/receipt/engine/control/materialization functions persist the
 * three invented bicycle roots and two explicitly synthetic numerical groups.
 * This tests the preparation seam; it does not certify the BERTopic bundle worker.
 */
export async function seedSignalTopicInterestReviewPreparationV1(args: SignalTopicInterestReviewSyntheticSeedArgsV1) {
  const { database, scoped, query } = args;
  const runtime = args.runtime ?? SIGNAL_TOPIC_INTEREST_REVIEW_SYNTHETIC_RUNTIME_V1;
  const saves = args.saves ?? createSignalTopicInterestReviewSyntheticSavesV1(runtime);
  assert.equal((await query("SHOW transaction_isolation")).rows[0]?.transaction_isolation, "read committed",
    "real processing admission requires the runner's READ COMMITTED rollback harness");
  assert.equal((await query("SELECT count(*)::int count FROM organizations")).rows[0]?.count, 0,
    "positive-source fixture requires an empty synthetic target before its first write");
  const organization_id = randomUUID(), actor_user_id = randomUUID();
  await query("INSERT INTO organizations(id,slug,legal_name,status) VALUES($1,$2,'Synthetic interest review organization','active')",
    [organization_id, `interest-review-${organization_id}`]);
  await query(`INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status)
    VALUES($1,$2,'Synthetic interest review actor','noisia_internal','noisia_admin',$3,'active')`,
  [actor_user_id, `${actor_user_id}@example.test`, organization_id]);
  const created = await saves.createBrand({ database, scoped, organization_id, actor_user_id,
    intake: { ...BRAND_CONTEXT_SYNTHETIC_INTAKE_V1, slug: `interest-review-${randomUUID()}` } });
  const identity = { ...created, organization_id, actor_user_id };
  const access = { database, workspace_id: created.workspace_id, actor_user_id };
  const knowledge = await saves.saveKnowledge({ database, scoped, ...identity, title: "Synthetic bicycle knowledge",
    raw_text: BRAND_CONTEXT_SYNTHETIC_ADDITIONAL_KB_V1, idempotency_key: randomUUID() });
  const quote = quoteSignalBrandContextPreparationV1({ actor_user_id, runtime });
  assert.equal(quote.available, true, "runner must supply an explicit synthetic semantic/prototype runtime");
  const prepared = await ensureSignalBrandContextPreparationV1({ ...access, runtime, idempotency_key: randomUUID(),
    primary_locale: "es-MX", admission: { quote_digest: quote.quote_digest, confirmation: "prepare_brand_context_within_shown_cap" } });
  const advance = () => advanceSignalBrandContextPreparationsV1({ ...access, runtime, limit: 10 });
  await advance();
  const semanticInput = await prepareSignalSemanticContextProposalInputV1({ queryable: database,
    workspace: { id: created.workspace_id, organization_id, brand_id: created.brand_id }, generation_key: prepared.generation_key });
  const semantic = createBrandContextSyntheticSemanticProviderV1({ input: semanticInput.input,
    prompt: semanticInput.prompt, model: runtime.semantic.model, revision: "initial" });
  const semanticRun = (await query("SELECT id FROM signal_semantic_context_proposal_runs WHERE generation_id=$1::uuid", [prepared.generation_id])).rows[0];
  assert.ok(semanticRun, "real Brand Context preparation must request the synthetic semantic run");
  assert.equal((await processSignalSemanticContextProposalRunV1({ pool: database, run_id: String(semanticRun.id), provider: semantic.provider })).status,
    "completed", "synthetic provider response must pass real semantic processing");
  await advance();
  const prototypes = await loadSignalWorkspaceTopicPrototypesV1(access);
  assert.ok(prototypes.active_run, "real publication must request prototypes");
  const voyage = createBrandContextSyntheticVoyageProviderV1();
  await executeBrandContextSyntheticPrototypeRunV1({ database, run_id: prototypes.active_run.id, provider: voyage.provider });
  await advance();
  const publication = (await query(`SELECT status,signal_brand_context_processing_source_current_v1(id) current
    FROM signal_semantic_context_generations WHERE id=$1::uuid`, [prepared.generation_id])).rows[0];
  assert.deepEqual(publication, { status: "published", current: true }, "context must be genuinely published and current through existing guards");

  // Suppress only the nested helper's cleanup callback: the runner always owns
  // rollback, including failures. Its numerical records and receipts are real.
  const clusterIds = [randomUUID(), randomUUID()] as const;
  const projection = await syntheticClientWorkspaceFixtureV1({ database, scoped, query, cleanup: async () => {} }, {
    identity, projection: { cluster_ids: clusterIds },
  });
  assert.equal(projection.roots.length, 3, "exactly three invented canonical roots are used");
  assert.equal(projection.chunks.length, 3, "the tiny texts each occupy exactly one governed chunk");
  const source_execution_id = projection.engine_execution_id;
  const binding = (await query("SELECT signal_topic_consolidation_source_binding_v1($1::uuid) value", [source_execution_id])).rows[0]?.value;
  assert.ok(binding, "actual completed embedding and fit checkpoint must resolve the numerical source binding");
  assert.equal(binding.expected_group_count, 2, "source census contains the two sealed synthetic lanes");

  // New synthetic policy version, preserving all old policy/receipt history.
  // It permits ONLY the free numeric action; no editorial send is authorized.
  const policy_id = randomUUID();
  await query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,valid_from,valid_until,
    budget_timezone,daily_cap_micro_usd,created_by_user_id)
    SELECT $1,$2,COALESCE(max(version),0)+1,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 day',
      COALESCE((SELECT budget_timezone FROM signal_processing_policy_versions WHERE organization_id=$2 ORDER BY version DESC LIMIT 1),'America/Mexico_City'),0,$3
    FROM signal_processing_policy_versions WHERE organization_id=$2`, [policy_id, organization_id, actor_user_id]);
  await query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,
    configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
    SELECT $1,'topic_consolidation_numeric','free',NULL,NULL,configuration,
      signal_semantic_context_digest_json_v2(configuration),0,false
    FROM (SELECT signal_topic_consolidation_numeric_configuration_v1() configuration) configuration`, [policy_id]);
  await query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE organization_id=$1 AND status='active'", [organization_id]);
  await query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1", [policy_id]);
  const status = await loadSignalTopicConsolidationStatusV1({ ...access, source_execution_id });
  assert.equal(status.status, "ready_to_prepare", "real source and free policy must permit numeric admission");
  assert.ok(status.quote_reference, "numeric request requires the actual quote reference");
  const requested = await requestSignalTopicConsolidationV1({ ...access, source_execution_id,
    quote_reference: status.quote_reference, idempotency_key: randomUUID() });
  const lease = await claimSignalTopicConsolidationExecutionV1({ database, ...requested, lease_seconds: 300 });
  assert.ok(lease && !("completed" in lease), "real numeric owner must yield a current execution lease");
  const configuration = (await query("SELECT signal_topic_consolidation_numeric_configuration_v1() value")).rows[0]?.value as SignalTopicConsolidationConfigurationV1;
  const metadata = await loadSignalTopicConsolidationRootMetadataV1({ queryable: database,
    workspace_id: created.workspace_id, root_ids: projection.roots.map(root => root.root_id) });
  const byRoot = new Map(metadata.map(row => [row.root_id, row]));
  const counts = (values: Array<string | null>) => [...new Set(values.filter((value): value is string => value !== null))]
    .sort().map(key => ({ key, count: values.filter(value => value === key).length }));
  const groups: SignalTopicAtomicGroupV1[] = (["open", "guided"] as const).map((lane, index) => {
    const stable_cluster_id = clusterIds[index]!, group_key = `${lane}:${stable_cluster_id}`;
    const assignments = projection.chunks.map((chunk, ordinal) => ({ ordinal, root_id: chunk.root_id,
      chunk_index: chunk.chunk_index, start: chunk.start, end: chunk.end, chunk_sha256: chunk.chunk_sha256 }));
    const roots = projection.roots.map(root => ({ root_id: root.root_id, chunk_count: root.chunk_count,
      strength: 0.8, assignment_digest: digest(assignments.filter(item => item.root_id === root.root_id).map(item => ({ ...item, strength: 0.8 }))) })).sort((a, b) => a.root_id.localeCompare(b.root_id));
    const scope_counts = { brand: 0, competitor: 0, category: 0, unknown: 0 };
    for (const row of metadata) scope_counts[row.scope]++;
    const evidence = projection.chunks.map(chunk => {
      const item = byRoot.get(chunk.root_id); assert.ok(item, "each governed root must retain actual metadata");
      const locator = { root_id: chunk.root_id, chunk_index: chunk.chunk_index, start: chunk.start, end: chunk.end, chunk_sha256: chunk.chunk_sha256 };
      return { ...locator, ref_id: digest(locator), locale: item.locale, platform: item.platform, occurred_at: item.occurred_at };
    });
    const dossier: SignalTopicAtomicGroupV1["dossier"] = { contract_version: "signal-topic-group-dossier-v1", scope_counts,
      locale_counts: counts(metadata.map(row => row.locale)), platform_counts: counts(metadata.map(row => row.platform)),
      month_counts: counts(metadata.map(row => row.occurred_at?.slice(0, 7) ?? null)),
      brand_affinity: { positive: [], negative: [], abstention: [] }, neighbors: [],
      metrics: { cohesion: null, outlier_ratio: null }, evidence };
    return { group_key, lane, stable_cluster_id, local_label: 0,
      group_digest: fixtureSha(assignments.map(item => `${JSON.stringify(item)}\n`).join("")),
      root_count: roots.length, chunk_count: assignments.length, terms: ["synthetic bicycle repair"],
      dossier, dossier_digest: digest(dossier), centroid: null, roots };
  }).sort((a, b) => a.group_key < b.group_key ? -1 : 1);
  const census: SignalTopicAtomicCensusV1 = parseSignalTopicAtomicCensusV1({
    contract_version: "signal-topic-consolidation-v1", workspace_id: created.workspace_id, source_execution_id,
    source_checkpoint_digest: binding.source_checkpoint_digest, output_artifact_id: binding.output_artifact_id,
    output_artifact_sha256: binding.output_artifact_sha256, model_artifact_id: binding.model_artifact_id,
    model_artifact_sha256: binding.model_artifact_sha256, context_digest: binding.context_digest,
    centroid_artifact_id: null, centroid_artifact_sha256: null, configuration,
    configuration_digest: digest(configuration), expected_group_count: binding.expected_group_count, groups,
  });
  const numeric = await materializeSignalTopicAtomicCensusV1({ database, actor_user_id, census, control_execution: lease });
  // Explicit synthetic partition, not a claim that a centroid/BERTopic worker ran.
  // Singleton communities require no invented inter-group similarity or centroid.
  const plan = parseSignalTopicCommunityPlanV1({ contract_version: "signal-topic-centroid-community-plan-v1",
    configuration_digest: census.configuration_digest, communities: groups.map(group => {
      const members = [{ group_key: group.group_key, rank: 0, similarity: 1 }];
      return { community_key: `synthetic:${group.group_key}`, community_digest: digest({ members }), members };
    }) }, groups.map(group => group.group_key));
  await materializeSignalTopicCommunityPlanV1({ ...access, source_execution_id,
    consolidation_run_id: numeric.consolidation_run_id, plan, control_execution: lease });
  assert.equal(await completeSignalTopicConsolidationExecutionV1({ database, lease, consolidation_run_id: numeric.consolidation_run_id }),
    true, "real control owner must complete against the guarded materialized census");

  const catalog = await createSignalTopicStoreV1({ pool: database, ...access, idempotency_key: randomUUID(), input: {
    label: "Synthetic bicycle repair interest", definition: "Experiences with appointments and repairs of invented bicycles.",
    scope: "all_conversations", discovery_guidance: false, inclusion: ["Repair appointments"], exclusion: ["Unrelated personal names"],
    positive_examples: ["My invented bicycle repair appointment was delayed"], negative_examples: ["An unrelated person was late"],
  } });
  assert.ok(catalog.profile, "manual interest creation must return the real working profile");
  const scope = { ...access, numeric_run_id: numeric.consolidation_run_id };
  const source = await loadSignalTopicConsolidationEditorialSourceV1(scope);
  const review = await loadSignalTopicInterestReviewInputV1(scope);
  assert.equal(review.manifest.interests.length, 1, "only the explicit manual interest enters review, not discovered output topics");
  const definition: SignalTopicDefinitionV1 = review.manifest.interests[0]!;
  assert.equal(definition.origin, "manual"); assert.equal(definition.discovery_guidance, false,
    "turning off discovery guidance does not remove a classifiable manual interest");
  assert.equal(review.manifest.expected_pair_count, 2, "both real stored groups appear in the complete interest matrix");
  assert.equal((await query("SELECT signal_topic_interest_review_plan_valid_v1($1::uuid,$2::uuid,$3::jsonb) value",
    [created.workspace_id, numeric.consolidation_run_id, JSON.stringify(review)])).rows[0]?.value, true,
  "the real SQL validator must accept the loader-produced source/catalog/evidence review");
  return { scope, identity, review, source_binding: source.source_binding, definition,
    taxonomy_profile_id: catalog.profile.id, engine_execution_id: source_execution_id,
    numeric_execution_id: requested.execution_id, semantic_generation_id: prepared.generation_id,
    knowledge_source_id: knowledge.source_id, saves, runtime,
    roots: projection.roots.map(root => root.root_id), baseline: await snapshotSignalTopicInterestReviewSyntheticHistoryV1(args) };
}
