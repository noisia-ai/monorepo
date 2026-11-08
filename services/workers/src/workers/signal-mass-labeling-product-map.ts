import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMassLabelingMapV1, applyMassLabelingEditorialLexiconV1,
  type SignalWorkspaceEngineDatabaseV1 } from "@noisia/db";
import { createWorkspaceEngineStorageV1, type WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";

type Artifact = { id: string; artifact_key: string; content: { storage_key: string; sha256: string; size_bytes: number; media_type: string } };
/** Reuses settled, scoped editorial and numerical artifacts. It performs no
 * provider call, and can safely retry after an interrupted engine completion. */
export async function materializeMassLabelingProductMapV2(args: {
  database: SignalWorkspaceEngineDatabaseV1; storage?: WorkspaceEngineStorageV1;
}) {
  const client = await args.database.connect();
  let execution: { id: string; workspace_id: string; actor_user_id: string } | undefined;
  let artifacts: Artifact[] = [];
  try {
    execution = (await client.query<{ id: string; workspace_id: string; actor_user_id: string }>(`SELECT execution.id,execution.workspace_id,execution.actor_user_id
      FROM signal_topic_catalog_executions execution
      JOIN signal_workspace_features feature ON feature.workspace_id=execution.workspace_id AND feature.feature='mass_labeling'
      JOIN signal_corpus_preparation_input_state state ON state.workspace_id=execution.workspace_id AND state.input_revision=execution.input_revision
      WHERE execution.status='ready'
        AND execution.input_snapshot#>>'{interpretation_config,call_configuration,category_lexicon_contract_version}'='mass-labeling-category-lexicon-v1'
        AND NOT EXISTS(SELECT 1 FROM signal_mass_labeling_maps map WHERE map.source_engine_execution_id=execution.id)
      ORDER BY execution.completed_at,execution.id LIMIT 1`)).rows[0];
    if (!execution) return { materialized: false };
    artifacts = (await client.query<Artifact>(`SELECT id,artifact_key,content FROM analysis_artifacts
      WHERE workspace_id=$1 AND engine_execution_id=$2 AND (
        artifact_key IN('assignments.guided.jsonl','assignments.open.jsonl','mass-labeling-consolidation.json')
        OR metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1') ORDER BY artifact_key,id`, [execution.workspace_id, execution.id])).rows;
  } finally { client.release(); }
  const assignments = artifacts.find(a => a.artifact_key === "assignments.guided.jsonl")
    ?? artifacts.find(a => a.artifact_key === "assignments.open.jsonl");
  const consolidation = artifacts.find(a => a.artifact_key === "mass-labeling-consolidation.json");
  const checkpoints = artifacts.filter(a => a.artifact_key.startsWith("interpretation-"));
  if (!assignments || !consolidation || !checkpoints.length) throw new Error("mass_labeling_product_artifacts_required");
  const directory = await mkdtemp(join(tmpdir(), "noisia-mass-product-map-"));
  const storage = args.storage ?? createWorkspaceEngineStorageV1();
  const text = async (artifact: Artifact) => {
    const destination = join(directory, `${artifact.id}.json`);
    await storage.get({ workspace_id: execution.workspace_id, execution_id: execution.id, stored: artifact.content, destination });
    return readFile(destination, "utf8");
  };
  try {
    const consolidationRaw = await text(consolidation);
    const proposal = JSON.parse(consolidationRaw) as { output: { topics: Parameters<typeof createMassLabelingMapV1>[0]["catalog"];
      category_lexicon?: { category: string; terms: string[] } } };
    if (proposal.output.category_lexicon) await applyMassLabelingEditorialLexiconV1({ database: args.database,
      workspace_id: execution.workspace_id, actor_user_id: execution.actor_user_id, source_engine_execution_id: execution.id,
      consolidation_artifact_id: consolidation.id, consolidation_raw: consolidationRaw });
    const result = await createMassLabelingMapV1({ database: args.database, workspace_id: execution.workspace_id,
      actor_user_id: execution.actor_user_id, source_engine_execution_id: execution.id,
      assignments_artifact_id: assignments.id, assignments_raw: await text(assignments),
      consolidation_artifact_id: consolidation.id, consolidation_raw: consolidationRaw,
      catalog: proposal.output.topics, source_checkpoints: await Promise.all(checkpoints.map(async artifact => ({ artifact_id: artifact.id, body: await text(artifact) }))) });
    return { materialized: true, map_id: result.map_id };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
