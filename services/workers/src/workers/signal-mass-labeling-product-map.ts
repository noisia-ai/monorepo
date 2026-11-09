import { randomUUID } from "node:crypto";
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
  adopt?: typeof createMassLabelingMapV1; apply_lexicon?: typeof applyMassLabelingEditorialLexiconV1;
}) {
  const token = randomUUID();
  const client = await args.database.connect();
  let execution: { id: string; workspace_id: string; actor_user_id: string } | undefined;
  let artifacts: Artifact[] = [];
  try {
    execution = (await client.query<{ id: string; workspace_id: string; actor_user_id: string }>(`WITH candidate AS (
      SELECT execution.id,execution.workspace_id,execution.actor_user_id
      FROM signal_topic_catalog_executions execution
      JOIN signal_workspace_features feature ON feature.workspace_id=execution.workspace_id AND feature.feature='mass_labeling'
      JOIN signal_corpus_preparation_input_state state ON state.workspace_id=execution.workspace_id AND state.input_revision=execution.input_revision
      LEFT JOIN signal_mass_labeling_product_materializations progress ON progress.execution_id=execution.id
      WHERE execution.status='ready'
        AND execution.input_snapshot#>>'{interpretation_config,call_configuration,category_lexicon_contract_version}'='mass-labeling-category-lexicon-v1'
        AND NOT EXISTS(SELECT 1 FROM signal_mass_labeling_maps map WHERE map.source_engine_execution_id=execution.id)
        AND (progress.execution_id IS NULL OR progress.status='failed' AND progress.next_attempt_at<=clock_timestamp()
          OR progress.status='processing' AND progress.lease_until<=clock_timestamp())
      ORDER BY execution.completed_at,execution.id LIMIT 1
    ), claimed AS (
      INSERT INTO signal_mass_labeling_product_materializations(execution_id,workspace_id,status,attempts,lease_token,lease_until)
      SELECT id,workspace_id,'processing',1,$1,clock_timestamp()+interval '10 minutes' FROM candidate
      ON CONFLICT(execution_id) DO UPDATE SET status='processing',attempts=signal_mass_labeling_product_materializations.attempts+1,
        lease_token=$1,lease_until=clock_timestamp()+interval '10 minutes',updated_at=clock_timestamp(),error_code=NULL
      WHERE signal_mass_labeling_product_materializations.status='failed' AND signal_mass_labeling_product_materializations.next_attempt_at<=clock_timestamp()
        OR signal_mass_labeling_product_materializations.status='processing' AND signal_mass_labeling_product_materializations.lease_until<=clock_timestamp()
      RETURNING execution_id
    ) SELECT candidate.* FROM candidate JOIN claimed ON claimed.execution_id=candidate.id`, [token])).rows[0];
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
  const directory = await mkdtemp(join(tmpdir(), "noisia-mass-product-map-"));
  const storage = args.storage ?? createWorkspaceEngineStorageV1();
  const text = async (artifact: Artifact) => {
    const destination = join(directory, `${artifact.id}.json`);
    await storage.get({ workspace_id: execution.workspace_id, execution_id: execution.id, stored: artifact.content, destination });
    return readFile(destination, "utf8");
  };
  const finish = async (status: "completed" | "empty" | "failed", errorCode: string | null = null) => {
    const connection = await args.database.connect();
    try { await connection.query(`UPDATE signal_mass_labeling_product_materializations SET status=$3,error_code=$4,
      lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp(),
      next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,300*attempts))
      WHERE execution_id=$1 AND lease_token=$2`, [execution.id, token, status, errorCode]); }
    finally { connection.release(); }
  };
  try {
    if (!assignments || !consolidation || !checkpoints.length) throw new Error("mass_labeling_product_artifacts_required");
    const consolidationRaw = await text(consolidation);
    const proposal = JSON.parse(consolidationRaw) as { output: { topics: Parameters<typeof createMassLabelingMapV1>[0]["catalog"];
      category_lexicon?: { category: string; terms: string[] } } };
    if (!Array.isArray(proposal.output.topics)) throw new Error("mass_labeling_product_catalog_invalid");
    if (!proposal.output.topics.length) { await finish("empty"); return { materialized: false, empty: true }; }
    if (proposal.output.category_lexicon) await (args.apply_lexicon ?? applyMassLabelingEditorialLexiconV1)({ database: args.database,
      workspace_id: execution.workspace_id, actor_user_id: execution.actor_user_id, source_engine_execution_id: execution.id,
      consolidation_artifact_id: consolidation.id, consolidation_raw: consolidationRaw });
    const result = await (args.adopt ?? createMassLabelingMapV1)({ database: args.database, workspace_id: execution.workspace_id,
      actor_user_id: execution.actor_user_id, source_engine_execution_id: execution.id,
      assignments_artifact_id: assignments.id, assignments_raw: await text(assignments),
      consolidation_artifact_id: consolidation.id, consolidation_raw: consolidationRaw,
      catalog: proposal.output.topics, source_checkpoints: await Promise.all(checkpoints.map(async artifact => ({ artifact_id: artifact.id, body: await text(artifact) }))) });
    await finish("completed");
    return { materialized: true, map_id: result.map_id };
  } catch (error) {
    const code = error instanceof Error && /^[a-z0-9_]{1,160}$/u.test(error.message)
      ? error.message : "mass_labeling_product_materialization_failed";
    await finish("failed", code);
    return { materialized: false, error_code: code };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
