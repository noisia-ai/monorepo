import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";
import {
  loadSignalWorkspaceClassificationInputV1,
  SignalWorkspaceClassificationError,
} from "./signal-workspace-classification";
import { signalDiscoveryProjectionContextCurrentV1 } from "./signal-workspace-discovery-projection-current";

export type TopicContextIdentityV1 = {
  catalog_digest: string;
  context_digest: string;
  compiler_digest: string;
  embedding_config_digest: string;
  correction_digest: string;
};
export function topicContextIdentityV1(input: TopicContextIdentityV1): TopicContextIdentityV1 {
  return {
    catalog_digest: input.catalog_digest,
    context_digest: input.context_digest,
    compiler_digest: input.compiler_digest,
    embedding_config_digest: input.embedding_config_digest,
    correction_digest: input.correction_digest,
  };
}
function same(left: TopicContextIdentityV1, right: TopicContextIdentityV1) {
  return JSON.stringify(topicContextIdentityV1(left)) === JSON.stringify(topicContextIdentityV1(right));
}
export async function sealedTopicContextBridgeMatchesV1(
  queryable: Pick<PoolClient, "query">,
  args: { workspace_id: string; generation_id: string; source_engine_execution_id: string;
    legacy: TopicContextIdentityV1; modern: TopicContextIdentityV1 },
): Promise<boolean> {
  const row = (await queryable.query<{ matches: boolean }>(`
    SELECT EXISTS(SELECT 1 FROM signal_topic_context_identity_bridges_v1 bridge
      CROSS JOIN signal_topic_context_identity_cuts_v1 cut
      WHERE cut.singleton AND cut.sealed_at IS NOT NULL
        AND bridge.workspace_id=$1::uuid AND bridge.generation_id=$2::uuid
        AND bridge.source_engine_execution_id=$3::uuid
        AND bridge.legacy_identity=$4::jsonb AND bridge.modern_identity=$5::jsonb) matches
  `, [args.workspace_id, args.generation_id, args.source_engine_execution_id,
    JSON.stringify(topicContextIdentityV1(args.legacy)), JSON.stringify(topicContextIdentityV1(args.modern))])).rows[0];
  return row?.matches === true;
}

type Candidate = {
  generation_id: string; workspace_id: string; taxonomy_profile_id: string;
  source_engine_execution_id: string; legacy_identity: TopicContextIdentityV1; source_current: boolean;
};
type InventoryItem = Candidate & {
  disposition: "bridge" | "modern" | "stale";
  modern_identity: TopicContextIdentityV1 | null;
};
export type TopicContextCutPreflightV1 = {
  contract: "topic-context-identity-cut-v1";
  cutoff_at: string;
  actor_user_id: string;
  inventory_digest: string;
  candidates: InventoryItem[];
  already_sealed: boolean;
  transition_count: number;
};
type Cut = { cutoff_at: string; sealed_at: string | null; inventory_digest: string | null; transition_count: number | null };
const sourceTables = [
  "brand_knowledge_sources", "brand_os_audiences", "brand_os_briefs", "brand_os_claims", "brand_os_objectives",
  "brand_os_products", "brand_os_profiles", "brand_seeds", "brands", "competitors", "entity_aliases",
  "intelligence_entities", "knowledge_assertions", "knowledge_chunks", "organizations", "signal_acquisition_plans",
  "signal_classification_generation_items", "signal_classification_generations", "signal_corpus_preparation_input_state",
  "signal_corpus_preparation_runs", "signal_semantic_context_element_versions", "signal_semantic_context_generations",
  "signal_taxonomy_profiles", "signal_topic_catalog_executions", "signal_topic_membership_overrides",
  "signal_workspace_embedding_runs", "signal_workspace_features", "signal_workspaces", "taxonomy_terms",
  "user_brand_access", "users",
];
async function authorizedOperator(client: PoolClient, actor: string) {
  const allowed = (await client.query<{ allowed: boolean }>(`SELECT EXISTS(SELECT 1 FROM users
    WHERE id=$1::uuid AND status='active' AND user_type='noisia_internal'
      AND primary_role IN('noisia_admin','founder','admin')) allowed`, [actor])).rows[0]?.allowed;
  if (!allowed) throw new Error("topic_context_cut_operator_forbidden");
}
async function inventory(client: PoolClient, actor: string, cut: Cut): Promise<TopicContextCutPreflightV1> {
  if (cut.sealed_at) {
    return { contract: "topic-context-identity-cut-v1", cutoff_at: cut.cutoff_at, actor_user_id: actor,
      inventory_digest: cut.inventory_digest!, candidates: [], already_sealed: true, transition_count: cut.transition_count! };
  }
  const rows = (await client.query<Candidate>(`
    SELECT generation.id::text generation_id,generation.workspace_id::text,generation.taxonomy_profile_id::text,
      generation.input_snapshot#>>'{source_projection,engine_execution_id}' source_engine_execution_id,
      jsonb_build_object('catalog_digest',generation.input_snapshot#>>'{identity,catalog_digest}',
        'context_digest',generation.input_snapshot#>>'{identity,context_digest}',
        'compiler_digest',generation.input_snapshot#>>'{identity,compiler_digest}',
        'embedding_config_digest',generation.input_snapshot#>>'{identity,embedding_config_digest}',
        'correction_digest',generation.input_snapshot->>'correction_digest') legacy_identity,
      (generation.input_revision=state.input_revision
        AND (generation.policy_valid_until IS NULL OR generation.policy_valid_until>clock_timestamp())
        AND signal_workspace_projection_source_current_v1(generation)
        AND NOT EXISTS(SELECT 1 FROM signal_classification_generation_items item
          WHERE item.generation_id=generation.id AND item.resolution_state='error')) source_current
    FROM signal_classification_generations generation
    JOIN signal_corpus_preparation_input_state state USING(workspace_id)
    JOIN signal_workspaces workspace ON workspace.id=generation.workspace_id
    JOIN brands brand ON brand.id=workspace.brand_id
    CROSS JOIN signal_topic_context_identity_cuts_v1 cut
    WHERE cut.singleton AND generation.created_at<=cut.cutoff_at AND generation.finalized_at<=cut.cutoff_at
      AND generation.status='ready' AND workspace.status='active' AND brand.status='active'
      AND generation.input_contract='workspace-topic-classification-v1'
      AND generation.input_snapshot#>>'{source_projection,contract_version}'
        IN('workspace-topic-projection-v1','workspace-topic-incremental-projection-v1')
      AND EXISTS(SELECT 1 FROM signal_topic_catalog_executions execution
        WHERE execution.generation_id=generation.id AND execution.status='ready')
    ORDER BY generation.workspace_id,generation.id
  `)).rows;
  const candidates: InventoryItem[] = [];
  for (const row of rows) {
    const capabilities = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client,
      workspace_id: row.workspace_id, actor_user_id: actor });
    if (!capabilities.can_edit_topics) throw new Error("topic_context_cut_workspace_forbidden");
    const entry: InventoryItem = { ...row, disposition: "stale", modern_identity: null };
    candidates.push(entry);
    if (!row.source_current || !await signalDiscoveryProjectionContextCurrentV1(client,
      row.workspace_id, row.source_engine_execution_id)) continue;
    const args = { queryable: client, workspace_id: row.workspace_id, actor_user_id: actor,
      taxonomy_profile_id: row.taxonomy_profile_id, source_engine_execution_id: row.source_engine_execution_id };
    let modern;
    try { modern = await loadSignalWorkspaceClassificationInputV1(args); }
    catch (error) {
      if (error instanceof SignalWorkspaceClassificationError && error.code === "workspace_classification_catalog_unavailable") continue;
      throw error;
    }
    entry.modern_identity = topicContextIdentityV1(modern);
    if (same(row.legacy_identity, entry.modern_identity)) { entry.disposition = "modern"; continue; }
    const legacy = await loadSignalWorkspaceClassificationInputV1({ ...args, legacy_context_identity: true });
    if (same(row.legacy_identity, legacy)
      && modern.catalog_digest === legacy.catalog_digest && modern.embedding_config_digest === legacy.embedding_config_digest
      && modern.correction_digest === legacy.correction_digest) entry.disposition = "bridge";
  }
  const payload = { contract: "topic-context-identity-cut-v1" as const, cutoff_at: cut.cutoff_at,
    actor_user_id: actor, candidates };
  return { ...payload, inventory_digest: "sha256:" + createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    already_sealed: false, transition_count: candidates.filter(row => row.disposition === "bridge").length };
}
export async function inspectTopicContextIdentityCutV1(args: { database: Pick<Pool,"connect">; actor_user_id: string }) {
  return run(args, null);
}
export async function sealTopicContextIdentityCutV1(args: { database: Pick<Pool,"connect">; actor_user_id: string;
  expected_inventory_digest: string }) {
  if (!/^sha256:[0-9a-f]{64}$/u.test(args.expected_inventory_digest)) throw new Error("topic_context_cut_digest_invalid");
  return run(args, args.expected_inventory_digest);
}
async function run(args: { database: Pick<Pool,"connect">; actor_user_id: string }, expected: string | null) {
  const client = await args.database.connect();
  try {
    await client.query(expected ? "BEGIN ISOLATION LEVEL READ COMMITTED" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    if (expected) {
      // Exclude semantic edits before reading the cut. READ COMMITTED then sees
      // all changes committed since the external preflight, while these locks
      // keep the captured sources consistent through commit.
      await client.query(`LOCK TABLE ${sourceTables.join(",")} IN SHARE MODE NOWAIT`);
    }
    const cut = (await client.query<Cut>(`SELECT cutoff_at::text,sealed_at::text,inventory_digest,transition_count
      FROM signal_topic_context_identity_cuts_v1 WHERE singleton${expected ? " FOR UPDATE NOWAIT" : ""}`)).rows[0];
    if (!cut) throw new Error("topic_context_cut_migration_required");
    await authorizedOperator(client, args.actor_user_id);
    const report = await inventory(client, args.actor_user_id, cut);
    if (expected && expected !== report.inventory_digest) throw new Error("topic_context_cut_preflight_changed");
    if (expected && !report.already_sealed) {
      for (const row of report.candidates.filter(row => row.disposition === "bridge")) {
        await client.query(`INSERT INTO signal_topic_context_identity_bridges_v1
          (generation_id,workspace_id,source_engine_execution_id,legacy_identity,modern_identity)
          VALUES($1::uuid,$2::uuid,$3::uuid,$4::jsonb,$5::jsonb)`, [row.generation_id,row.workspace_id,
          row.source_engine_execution_id,JSON.stringify(row.legacy_identity),JSON.stringify(row.modern_identity)]);
      }
      await client.query(`UPDATE signal_topic_context_identity_cuts_v1 SET sealed_at=clock_timestamp(),
        sealed_by_user_id=$1::uuid,inventory_digest=$2,transition_count=$3 WHERE singleton`,
      [args.actor_user_id, report.inventory_digest, report.transition_count]);
    }
    await client.query("COMMIT");
    return report;
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}
