import { createHash } from "node:crypto";

import type { Job } from "bullmq";
import type { PoolClient } from "pg";

import {
  SIGNAL_MATERIALIZATION_CONTRACT_VERSION,
  SIGNAL_TOPIC_CLASSIFIER_CONTRACT_V1,
  buildSignalTopicEmbeddingInputsV1,
  calibrateSignalTopicThresholdV1,
  chunkForEmbedding,
  embedTexts,
  estimateSignalTopicEmbeddingCostMicroUsdV1,
  getEmbeddingModel,
  getEmbeddingProvider,
  hashEmbeddingChunk,
  signalTopicDefinitionSchemaV1,
  signalTopicContrastScoreV1,
  signalTopicLexicalMatchV1,
  vectorLiteral,
  type SignalTopicClassificationJobDataV1,
  type SignalTopicCalibrationV1,
  type SignalMaterializeJobDataV1,
  type SignalTopicDefinitionV1
} from "@noisia/query-engine";
import { loadSignalTopicClassificationContextStoreV1 } from "@noisia/db";
import { pool } from "../db/client";
import { signalMaterializationJob } from "./signal-materialization";
import { canClaimSignalTopicExecutionV1 } from "./signal-topic-execution";

type ExecutionRow = {
  id: string; workspace_id: string; taxonomy_profile_id: string; study_corpus_id: string;
  actor_user_id: string; intent: "search" | "publish"; source_execution_id: string | null;
  status: string; denominator: number; population_digest: string; watermark_digest: string;
  identity_catalog_digest: string; definition_digest: string; publish_when_ready: boolean;
  embedding_cost_estimate_micro_usd: number | null;
  embedding_cost_cap_micro_usd: number | null;
  embedding_pricing_version: string | null;
  generation_id: string | null;
  result_summary: Record<string, unknown>;
};
type TopicRow = { id: string; term_key: string; label: string; description: string; metadata: unknown };
type RootRow = { id: string; text_clean: string; platform: string; published_at: string; scopes: string[] };
type Suggestion = {
  execution_id: string; workspace_id: string; canonical_root_id: string; taxonomy_term_id: string;
  term_key: string; disposition: "relevant" | "doubt" | "excluded" | "none";
  method: "semantic" | "lexical" | "semantic_lexical" | "human"; semantic_score: number | null;
  negative_semantic_score: number | null; lexical_match: boolean; excluded_by_rule: boolean;
  excluded_by_negative: boolean; evidence_digest: string; lineage_digest: string;
};
type SemanticScore = { score: number; negative_score: number | null; excluded_by_negative: boolean };
type TopicEmbeddingKeys = { term_id: string; positive_digest: string; negative_digest: string | null };
type TopicCalibrationAuthority = {
  calibration: SignalTopicCalibrationV1;
  labeling_function_version_id: string;
  approval_policy_id: string;
};
type PublicationReceipt = {
  contract_version: typeof SIGNAL_TOPIC_CLASSIFIER_CONTRACT_V1;
  generation_id: string;
  denominator: number;
  approved_roots: number;
  approved_assignments: number;
  automatic_assignments: number;
  human_assignments: number;
  active_topic_count: number;
  projected_count: number;
  processed_count: number;
  projection_digest: string;
  projection_created_at: string;
  signal_invalidation_id: string;
  signal_population_id: string;
  signal_population_version: number;
  signal_population_definition_hash: string;
};

const DOUBT_RETRIEVAL_SCORE = 0.45;
const WRITE_BATCH_SIZE = 2_000;

export async function signalTopicClassificationJob(job: Job<SignalTopicClassificationJobDataV1>) {
  const recoverInterruptedAttempt = job.attemptsMade > 0;
  const execution = await claimExecution(job.data.execution_id, recoverInterruptedAttempt);
  if (!execution) {
    await completeTopicClassificationOutbox(job.data.execution_id);
    return { execution_id: job.data.execution_id, replayed: true };
  }
  try {
    const result = execution.intent === "search"
      ? await processSearch(execution, job)
      : await processPublish(execution, job);
    await job.updateProgress(100);
    await completeTopicClassificationOutbox(execution.id);
    return result;
  } catch (error) {
    await failExecution(execution.id, safeErrorCode(error));
    await completeTopicClassificationOutbox(execution.id);
    throw error;
  }
}

async function processSearch(execution: ExecutionRow, job: Job<SignalTopicClassificationJobDataV1>) {
  const [topics, roots, context] = await Promise.all([
    loadTopics(execution.taxonomy_profile_id),
    loadRoots(execution.workspace_id, execution.taxonomy_profile_id, execution.study_corpus_id),
    loadSignalTopicClassificationContextStoreV1({ queryable: pool, workspace_id: execution.workspace_id,
      taxonomy_profile_id: execution.taxonomy_profile_id })
  ]);
  await verifyExecutionSnapshot(execution, roots, context.definition_digest);
  const corrections = await loadCorrectionsSnapshot(execution.workspace_id, execution.taxonomy_profile_id, topics);
  await job.updateProgress(10);
  await heartbeat(execution.id, 10);

  const activeTopics = topics.filter((item) => item.definition.lifecycle !== "archived");
  if (activeTopics.length > 64) throw new Error("topic_catalog_limit_exceeded");
  if (activeTopics.length === 0) {
    const chained = await persistSearch(execution, [], roots.map((root) => ({ root, suggestions: [] })),
      null, new Map(), corrections.digest);
    return { execution_id: execution.id, topics: 0, denominator: roots.length, semantic: false,
      publish_execution_id: chained };
  }
  if (roots.length === 0) {
    const chained = await persistSearch(execution, activeTopics, [], null, new Map(), corrections.digest);
    return { execution_id: execution.id, topics: activeTopics.length, denominator: 0, semantic: false,
      publish_execution_id: chained };
  }

  const embeddingModel = await resolveCompleteMentionEmbeddingModel(execution, roots);
  const embeddingKeys = await ensureDefinitionEmbeddings(execution, activeTopics, embeddingModel, context);
  await job.updateProgress(25);
  await heartbeat(execution.id, 25);

  const scores = await loadSemanticScores(execution, roots, embeddingModel, embeddingKeys);
  const calibrations = new Map(activeTopics.map((topic) => {
    const labels = Array.from(corrections.items.values()).filter((item) => item.term_key === topic.definition.term_key)
      .map((item) => ({ mention_id: item.root_id,
        score: scores.get(scoreKey(item.root_id, topic.id))?.score ?? Number.NaN,
        disposition: item.disposition }));
    return [topic.definition.term_key, calibrateSignalTopicThresholdV1(labels)];
  }));
  const evaluated = roots.map((root) => ({
    root,
    suggestions: activeTopics.filter((topic) => root.scopes.includes(topic.definition.scope))
      .map((topic) => classifySuggestion({ execution, root, topic,
        semantic: scores.get(scoreKey(root.id, topic.id)) ?? null,
        correction: corrections.items.get(`${topic.definition.term_key}:${root.id}`)?.disposition ?? null,
        calibratedThreshold: calibrations.get(topic.definition.term_key)?.threshold ?? null }))
  }));
  await job.updateProgress(70);
  await heartbeat(execution.id, 70);
  const chained = await persistSearch(execution, activeTopics, evaluated, embeddingModel, calibrations,
    corrections.digest);
  return { execution_id: execution.id, topics: activeTopics.length, denominator: roots.length,
    semantic: true, embedding_model: embeddingModel, publish_execution_id: chained };
}

async function processPublish(execution: ExecutionRow, job: Job<SignalTopicClassificationJobDataV1>) {
  if (!execution.source_execution_id) throw new Error("topic_publish_source_missing");
  const materialization = await projectPublication(execution, job);
  await job.updateProgress(100);
  return { execution_id: execution.id, generation_id: materialization.generation_id,
    projected_count: materialization.projected_count, signal_materialization: materialization };
}

async function projectPublication(execution: ExecutionRow, job: Job<SignalTopicClassificationJobDataV1>) {
  const sourceExecutionId = execution.source_execution_id;
  if (!sourceExecutionId) throw new Error("topic_publish_source_missing");
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1::text||':topic-catalog-publish',0))",
      [execution.workspace_id]
    );
    const roots = await loadRoots(
      execution.workspace_id,
      execution.taxonomy_profile_id,
      execution.study_corpus_id,
      client
    );
    const context = await loadSignalTopicClassificationContextStoreV1({
      queryable: client,
      workspace_id: execution.workspace_id,
      taxonomy_profile_id: execution.taxonomy_profile_id
    });
    const currentSnapshot = await verifyExecutionSnapshot(
      execution,
      roots,
      context.definition_digest,
      client
    );
    const topics = await loadTopicsWithQueryable(client, execution.taxonomy_profile_id);
    const activeTopics = topics.filter((topic) => topic.definition.lifecycle !== "archived");
    if (activeTopics.some((topic) => topic.definition.scope !== "primary_brand")) {
      throw new Error("topic_signal_scope_unsupported");
    }
    await client.query(`
      SELECT complete_signal_topic_catalog_profile_v1(
        $1::uuid,$2,$3,$4,$5
      )
    `, [execution.id, currentSnapshot.population_digest, currentSnapshot.identity_catalog_digest,
      currentSnapshot.definition_digest, currentSnapshot.denominator]);
    const priorGeneration = (await client.query<{ id: string; generation_version: number;
      taxonomy_profile_id: string; study_corpus_id: string | null }>(`
      SELECT id::text,generation_version,taxonomy_profile_id::text,study_corpus_id::text
      FROM signal_classification_generations
      WHERE workspace_id=$1::uuid AND generation_key='topic-catalog-v1' AND status='ready'
      ORDER BY generation_version DESC,id DESC LIMIT 1
    `, [execution.workspace_id])).rows[0];
    const generationVersion = Number(priorGeneration?.generation_version ?? 0) + 1;
    if (!Number.isSafeInteger(generationVersion) || generationVersion < 1) {
      throw new Error("topic_generation_version_invalid");
    }
    const supersedesGenerationId = priorGeneration
      && priorGeneration.taxonomy_profile_id === execution.taxonomy_profile_id
      && priorGeneration.study_corpus_id === execution.study_corpus_id
      ? priorGeneration.id
      : null;
    const beginKey = sha256(`topic-generation:${execution.id}`);
    const beginRequest = sha256(stableJson({ execution_id: execution.id,
      profile_id: execution.taxonomy_profile_id, definition_digest: execution.definition_digest,
      generation_version: generationVersion, supersedes_generation_id: supersedesGenerationId }));
    const generation = (await client.query<{ generation_id: string }>(`
      SELECT generation_id::text FROM begin_signal_classification_generation_v1(
        $1::uuid,$2::uuid,'topic-catalog-v1',$3,$4::uuid,$5,$6,$7,$8,$9,$10::uuid,$11,$12,$13::uuid)
    `, [execution.workspace_id, execution.taxonomy_profile_id, generationVersion,
      execution.study_corpus_id, execution.population_digest, execution.watermark_digest,
      execution.identity_catalog_digest, execution.denominator, execution.definition_digest,
      execution.actor_user_id, beginKey, beginRequest, supersedesGenerationId])).rows[0];
    if (!generation) throw new Error("topic_generation_not_created");
    await job.updateProgress(15);

    const activeTopicCount = activeTopics.length;
    const calibrations = await loadCalibrationsForSearch(
      client,
      sourceExecutionId,
      activeTopics
    );
    const authorities = await registerCalibratedAuthorities(
      client,
      execution,
      activeTopics,
      calibrations
    );
    const rows = (await client.query<{
      canonical_root_id: string; taxonomy_term_id: string | null; term_key: string | null;
      score: string | null; evidence_digest: string | null; lineage_digest: string | null;
      excluded_by_rule: boolean | null; excluded_by_negative: boolean | null;
      correction: "belongs" | "excluded" | null;
    }>(`
      SELECT item.canonical_root_id::text,term.id::text taxonomy_term_id,suggestion.term_key,
        suggestion.semantic_score::text score,suggestion.evidence_digest,suggestion.lineage_digest,
        suggestion.excluded_by_rule,suggestion.excluded_by_negative,override.disposition correction
      FROM signal_topic_classification_items item
      LEFT JOIN signal_topic_classification_suggestions suggestion
        ON suggestion.execution_id=item.execution_id
        AND suggestion.canonical_root_id=item.canonical_root_id
      LEFT JOIN taxonomy_terms term ON term.id=suggestion.taxonomy_term_id
        AND term.taxonomy_id=(SELECT taxonomy_id FROM signal_taxonomy_profiles WHERE id=$2::uuid)
        AND term.status='active'
      LEFT JOIN signal_topic_membership_overrides override
        ON override.workspace_id=item.workspace_id
        AND override.canonical_root_id=item.canonical_root_id
        AND override.term_key=suggestion.term_key
        AND override.definition_revision=(term.metadata->'topic'->>'definition_revision')::int
      WHERE item.execution_id=$1::uuid
      ORDER BY item.canonical_root_id,term.term_key
    `, [sourceExecutionId, execution.taxonomy_profile_id])).rows;
    const grouped = new Map<string, Array<typeof rows[number]>>();
    for (const row of rows) {
      const list = grouped.get(row.canonical_root_id) ?? [];
      if (row.taxonomy_term_id) list.push(row);
      grouped.set(row.canonical_root_id, list);
    }
    const payload = Array.from(grouped.entries()).map(([rootId, assignments]) => {
      const approved = assignments.flatMap((item) => {
        const score = item.score === null ? null : Number(item.score);
        const authority = item.term_key ? authorities.get(item.term_key) : null;
        const isHuman = item.correction === "belongs";
        const isAutomatic = item.correction === null
          && !item.excluded_by_rule
          && !item.excluded_by_negative
          && score !== null
          && authority?.calibration.available === true
          && authority.calibration.threshold !== null
          && score >= authority.calibration.threshold;
        if (!isHuman && !isAutomatic) return [];
        return [{
          taxonomy_term_id: item.taxonomy_term_id,
          resolution_method: isHuman ? "human" : "labeling_function",
          labeling_function_version_id: isHuman ? null : authority!.labeling_function_version_id,
          model_version_id: null,
          approval_policy_id: isHuman ? null : authority!.approval_policy_id,
          score,
          confidence: isHuman ? "operator-confirmed" : "validated-threshold",
          evidence_digest: item.evidence_digest
            ?? sha256(`topic-evidence:${sourceExecutionId}:${rootId}:${item.term_key}`),
          lineage_digest: item.lineage_digest
            ?? sha256(`topic-lineage:${sourceExecutionId}:${rootId}:${item.term_key}`)
        }];
      });
      const itemDigest = sha256(stableJson({ root_id: rootId,
        term_ids: approved.map((item) => item.taxonomy_term_id).sort() }));
      const idempotencyKey = sha256(`topic-generation-item:${generation.generation_id}:${rootId}`);
      return { root_id: rootId, assignments: approved, item_digest: itemDigest,
        idempotency_key: idempotencyKey, request_digest: sha256(stableJson({ item_digest: itemDigest, approved })) };
    });
    for (let index = 0; index < payload.length; index += 1_000) {
      await client.query(`
        SELECT result.* FROM jsonb_to_recordset($1::jsonb) AS input(
          root_id uuid,assignments jsonb,item_digest text,idempotency_key text,request_digest text)
        CROSS JOIN LATERAL append_signal_classification_result_batch_v1(
          $2::uuid,$3::uuid,input.root_id,input.assignments,input.item_digest,$4::uuid,
          input.idempotency_key,input.request_digest) result
      `, [JSON.stringify(payload.slice(index, index + 1_000)), execution.workspace_id,
        generation.generation_id, execution.actor_user_id]);
      const progress = 15 + Math.round(60 * Math.min(index + 1_000, payload.length) / Math.max(payload.length, 1));
      await job.updateProgress(progress);
    }
    const finalizeKey = sha256(`topic-generation-finalize:${generation.generation_id}`);
    await client.query("SELECT * FROM finalize_signal_classification_generation_v1($1::uuid,$2::uuid,$3::uuid,$4,$5)",
      [execution.workspace_id, generation.generation_id, execution.actor_user_id, finalizeKey,
        sha256(stableJson({ generation_id: generation.generation_id, action: "finalize" }))]);
    const projectKey = sha256(`topic-generation-project:${generation.generation_id}`);
    const projected = (await client.query<{ projected_count: number; projection_digest: string }>(`
      SELECT * FROM project_signal_classification_generation_v1($1::uuid,$2::uuid,$3::uuid,$4,$5)
    `, [execution.workspace_id, generation.generation_id, execution.actor_user_id, projectKey,
      sha256(stableJson({ generation_id: generation.generation_id, action: "project" }))])).rows[0];
    if (!projected?.projection_digest) throw new Error("topic_projection_receipt_missing");
    await client.query(`
      INSERT INTO record_feature_values(organization_id,brand_id,study_corpus_id,subject_type,
        subject_id,feature_key,feature_value,value_type,confidence,source,model_version_id)
      SELECT workspace.organization_id,workspace.brand_id,generation.study_corpus_id,'mention',
        item.canonical_root_id,'signal_taxonomy_classification:'||generation.taxonomy_profile_id::text,
        jsonb_build_object('processed',true,'contract_version',$3::text,
          'generation_id',generation.id,'item_digest',item.item_digest),
        'object','high','signal_taxonomy_profile:'||generation.taxonomy_profile_id::text,
        profile.model_version_id
      FROM signal_classification_generation_items item
      JOIN signal_classification_generations generation ON generation.id=item.generation_id
        AND generation.workspace_id=item.workspace_id
      JOIN signal_taxonomy_profiles profile ON profile.id=generation.taxonomy_profile_id
      JOIN signal_workspaces workspace ON workspace.id=generation.workspace_id
      WHERE item.workspace_id=$1::uuid AND item.generation_id=$2::uuid
      ON CONFLICT ON CONSTRAINT uq_record_feature_values_subject_key_source DO UPDATE SET
        organization_id=EXCLUDED.organization_id,brand_id=EXCLUDED.brand_id,
        study_corpus_id=EXCLUDED.study_corpus_id,feature_value=EXCLUDED.feature_value,
        value_type=EXCLUDED.value_type,confidence=EXCLUDED.confidence,
        model_version_id=EXCLUDED.model_version_id
    `, [execution.workspace_id, generation.generation_id, SIGNAL_TOPIC_CLASSIFIER_CONTRACT_V1]);
    const processedCount = Number((await client.query<{ count: number }>(`
      SELECT count(*)::int count FROM record_feature_values feature
      JOIN signal_classification_generation_items item
        ON item.workspace_id=$1::uuid AND item.generation_id=$2::uuid
        AND item.canonical_root_id=feature.subject_id
      WHERE feature.subject_type='mention'
        AND feature.feature_key='signal_taxonomy_classification:'||$3::uuid::text
        AND feature.source='signal_taxonomy_profile:'||$3::uuid::text
        AND feature.feature_value->>'generation_id'=$2::uuid::text
    `, [execution.workspace_id, generation.generation_id,
      execution.taxonomy_profile_id])).rows[0]?.count ?? 0);
    if (processedCount !== payload.length) throw new Error("topic_processed_marker_count_mismatch");
    const projectionRun = (await client.query<{ created_at: string; invalidation_digest: string }>(`
      SELECT created_at::text,invalidation_digest
      FROM signal_classification_projection_runs
      WHERE workspace_id=$1::uuid AND generation_id=$2::uuid
      ORDER BY created_at DESC,id DESC LIMIT 1
    `, [execution.workspace_id, generation.generation_id])).rows[0];
    if (!projectionRun) throw new Error("topic_projection_receipt_missing");
    const operational = (await client.query<{
      population_id: string; population_version: number; population_definition_hash: string;
      data_watermark_id: string;
    }>(`
      SELECT population.id::text population_id,population.version population_version,
        population.definition_hash population_definition_hash,watermark.id::text data_watermark_id
      FROM signal_workspace_population_pointers pointer
      JOIN signal_population_definitions population ON population.id=pointer.population_id
        AND population.workspace_id=pointer.workspace_id AND population.status='active'
      JOIN LATERAL (
        SELECT candidate.id FROM signal_data_watermarks candidate
        WHERE candidate.workspace_id=pointer.workspace_id
          AND candidate.population_id=population.id AND candidate.study_corpus_id IS NULL
        ORDER BY candidate.accepted_at DESC,candidate.id DESC LIMIT 1
      ) watermark ON true
      WHERE pointer.workspace_id=$1::uuid AND pointer.purpose='operational'
      LIMIT 1
    `, [execution.workspace_id])).rows[0];
    if (!operational) throw new Error("topic_signal_population_unavailable");
    const signalInvalidationKey = sha256(stableJson({
      kind: "topic-catalog-signal-materialization-v1",
      generation_id: generation.generation_id,
      projection_digest: projected.projection_digest,
      population_id: operational.population_id,
      population_version: operational.population_version,
      population_definition_hash: operational.population_definition_hash
    }));
    const signalInvalidation = (await client.query<{ id: string }>(`
      INSERT INTO signal_data_invalidations(workspace_id,study_corpus_id,population_id,
        data_watermark_id,source_key,idempotency_key,reason,scope)
      VALUES($1::uuid,NULL,$2::uuid,$3::uuid,'topic-catalog-signal-materialization-v1',$4,
        'classification_projection_rebuilt',$5::jsonb)
      ON CONFLICT(idempotency_key) DO UPDATE SET scope=signal_data_invalidations.scope||EXCLUDED.scope
      RETURNING id::text
    `, [execution.workspace_id, operational.population_id, operational.data_watermark_id,
      signalInvalidationKey, JSON.stringify({
        contract_version: "topic-catalog-signal-materialization-v1",
        generation_id: generation.generation_id,
        projection_digest: projected.projection_digest,
        population_version: operational.population_version,
        population_definition_hash: operational.population_definition_hash
      })])).rows[0];
    if (!signalInvalidation) throw new Error("topic_signal_invalidation_not_created");
    await client.query(`
      UPDATE signal_data_invalidations
      SET status='completed',processed_at=COALESCE(processed_at,now()),
        scope=scope||jsonb_build_object('superseded_by_population_invalidation_id',$2::text)
      WHERE workspace_id=$1::uuid AND idempotency_key=$3 AND source_key='signal-classification-projector-v1'
    `, [execution.workspace_id, signalInvalidation.id, projectionRun.invalidation_digest]);
    const receipt: PublicationReceipt = {
        contract_version: SIGNAL_TOPIC_CLASSIFIER_CONTRACT_V1,
        generation_id: generation.generation_id,
        denominator: payload.length,
        approved_roots: payload.filter((item) => item.assignments.length > 0).length,
        approved_assignments: payload.reduce((sum, item) => sum + item.assignments.length, 0),
        automatic_assignments: payload.reduce((sum, item) => sum + item.assignments
          .filter((assignment) => assignment.resolution_method === "labeling_function").length, 0),
        human_assignments: payload.reduce((sum, item) => sum + item.assignments
          .filter((assignment) => assignment.resolution_method === "human").length, 0),
        active_topic_count: activeTopicCount,
        projected_count: Number(projected?.projected_count ?? 0),
        processed_count: processedCount,
        projection_digest: projected.projection_digest,
        projection_created_at: projectionRun.created_at,
        signal_invalidation_id: signalInvalidation.id,
        signal_population_id: operational.population_id,
        signal_population_version: Number(operational.population_version),
        signal_population_definition_hash: operational.population_definition_hash
      };
    const completion = await materializePublicationInSignal(execution, receipt, client);
    await client.query("COMMIT");
    return completion;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function materializePublicationInSignal(
  execution: ExecutionRow,
  receipt: PublicationReceipt,
  client: PoolClient
) {
  const data: SignalMaterializeJobDataV1 = {
    contract_version: SIGNAL_MATERIALIZATION_CONTRACT_VERSION,
    trigger: "invalidation",
    workspace_id: execution.workspace_id,
    population_id: receipt.signal_population_id,
    population_version: receipt.signal_population_version,
    population_definition_hash: receipt.signal_population_definition_hash,
    invalidation_id: receipt.signal_invalidation_id,
    affected_from: null,
    affected_through: null
  };
  const result = await signalMaterializationJob({ data } as Job<SignalMaterializeJobDataV1>, client);
  if (result.state === "not_available" || Number(result.rows_written ?? 0) < 1) {
    throw new Error("topic_signal_materialization_unavailable");
  }
    const verified = (await client.query<{
      authority_current: boolean; projected_count: number; topic_volume_rows: number;
      usable_topic_volume_rows: number; empty_topic_volume_rows: number;
      latest_topic_volume_at: string | null;
    }>(`
      SELECT signal_classification_generation_is_current_v1($2::uuid,now()) authority_current,
        (SELECT count(*)::int FROM record_tags tag
          WHERE tag.classification_generation_id=$2::uuid
            AND tag.classification_projection_contract='signal-record-tags-projector-v1') projected_count,
        (SELECT count(*)::int FROM metric_materializations materialization
          WHERE materialization.workspace_id=$1::uuid
            AND materialization.population_id=$3::uuid
            AND materialization.population_version=$4::int
            AND materialization.population_definition_hash=$5
            AND materialization.metric_key='topic.volume'
            AND materialization.computed_at >= $6::timestamptz) topic_volume_rows,
        (SELECT count(*)::int FROM metric_materializations materialization
          WHERE materialization.workspace_id=$1::uuid
            AND materialization.population_id=$3::uuid
            AND materialization.population_version=$4::int
            AND materialization.population_definition_hash=$5
            AND materialization.metric_key='topic.volume'
            AND materialization.computed_at >= $6::timestamptz
            AND materialization.materialization_state IN ('fresh','stale','partial')
            AND materialization.value IS NOT NULL
            AND materialization.typed_payload->>'kind'='signal_taxonomy_volume'
            AND materialization.typed_payload->>'profile_id'=$7::uuid::text
            AND (materialization.typed_payload->>'processed_mentions')::int
              =(materialization.typed_payload->>'included_mentions')::int) usable_topic_volume_rows,
        (SELECT count(*)::int FROM metric_materializations materialization
          WHERE materialization.workspace_id=$1::uuid
            AND materialization.population_id=$3::uuid
            AND materialization.population_version=$4::int
            AND materialization.population_definition_hash=$5
            AND materialization.metric_key='topic.volume'
            AND materialization.computed_at >= $6::timestamptz
            AND materialization.materialization_state='not_available'
            AND materialization.value IS NULL
            AND materialization.typed_payload->>'kind'='signal_taxonomy_volume'
            AND materialization.typed_payload->>'profile_id'=$7::uuid::text
            AND (materialization.typed_payload->>'processed_mentions')::int=0
            AND (materialization.typed_payload->>'classified_mentions')::int=0
            AND materialization.typed_payload->'buckets'='[]'::jsonb) empty_topic_volume_rows,
        (SELECT max(materialization.computed_at)::text FROM metric_materializations materialization
          WHERE materialization.workspace_id=$1::uuid
            AND materialization.population_id=$3::uuid
            AND materialization.population_version=$4::int
            AND materialization.population_definition_hash=$5
            AND materialization.metric_key='topic.volume'
            AND materialization.computed_at >= $6::timestamptz) latest_topic_volume_at
    `, [execution.workspace_id, receipt.generation_id, receipt.signal_population_id,
      receipt.signal_population_version, receipt.signal_population_definition_hash,
      receipt.projection_created_at, execution.taxonomy_profile_id])).rows[0];
    if (!verified?.authority_current) throw new Error("topic_generation_superseded_before_signal");
    if (Number(verified.projected_count) !== receipt.projected_count) {
      throw new Error("topic_signal_projection_count_changed");
    }
    const validTopicRows = receipt.active_topic_count === 0
      ? Number(verified.empty_topic_volume_rows)
      : Number(verified.usable_topic_volume_rows);
    if (Number(verified.topic_volume_rows) < 1
      || validTopicRows !== Number(verified.topic_volume_rows)
      || !verified.latest_topic_volume_at) {
      throw new Error("topic_signal_materialization_receipt_missing");
    }
    const completion = {
      ...receipt,
      signal_materialization_state: result.state,
      signal_materialization_plans_executed: result.plans_executed,
      signal_materialization_rows_written: result.rows_written,
      signal_materialization_watermark_hash: result.watermark_hash,
      signal_topic_volume_rows: Number(verified.topic_volume_rows),
      signal_usable_topic_volume_rows: Number(verified.usable_topic_volume_rows),
      signal_empty_topic_volume_rows: Number(verified.empty_topic_volume_rows),
      signal_materialized_at: verified.latest_topic_volume_at
    };
    const completed = await client.query(`
      UPDATE signal_topic_catalog_executions
      SET status='completed',progress=100,result_summary=$3::jsonb,generation_id=$4::uuid,
        completed_at=now(),heartbeat_at=now(),updated_at=now()
      WHERE id=$1::uuid AND workspace_id=$2::uuid AND status='running'
        AND (generation_id IS NULL OR generation_id=$4::uuid)
    `, [execution.id, execution.workspace_id, JSON.stringify(completion), receipt.generation_id]);
    if ((completed.rowCount ?? 0) !== 1) throw new Error("topic_signal_completion_conflict");
    await client.query(`UPDATE signal_data_invalidations SET status='completed',processed_at=now(),
      scope=scope||jsonb_build_object('topic_signal_receipt',$2::jsonb)
      WHERE id=$1::uuid`, [receipt.signal_invalidation_id, JSON.stringify({
      generation_id: receipt.generation_id,
      topic_volume_rows: Number(verified.topic_volume_rows),
      materialized_at: verified.latest_topic_volume_at,
      watermark_hash: result.watermark_hash
    })]);
    return completion;
}

function classifySuggestion(args: {
  execution: ExecutionRow; root: RootRow; topic: { id: string; definition: SignalTopicDefinitionV1 };
  semantic: SemanticScore | null; correction: "belongs" | "excluded" | null; calibratedThreshold: number | null;
}): Suggestion {
  const score = args.semantic?.score ?? null;
  const lexical = signalTopicLexicalMatchV1(args.root.text_clean,
    args.topic.definition.inclusion, args.topic.definition.exclusion);
  let disposition: Suggestion["disposition"] = "none";
  if (args.correction === "belongs") disposition = "relevant";
  else if (args.correction === "excluded" || lexical.excluded || args.semantic?.excluded_by_negative) disposition = "excluded";
  else if (score !== null && args.calibratedThreshold !== null && score >= args.calibratedThreshold) disposition = "relevant";
  else if (lexical.matched || (score !== null && score >= DOUBT_RETRIEVAL_SCORE)) disposition = "doubt";
  const method = args.correction ? "human" : lexical.matched && score !== null
    ? "semantic_lexical" : lexical.matched ? "lexical" : "semantic";
  const evidenceDigest = sha256(stableJson({ execution_id: args.execution.id, root_id: args.root.id,
    term_key: args.topic.definition.term_key, score, negative_score: args.semantic?.negative_score ?? null,
    excluded_by_negative: args.semantic?.excluded_by_negative ?? false, lexical, disposition }));
  return {
    execution_id: args.execution.id,
    workspace_id: args.execution.workspace_id,
    canonical_root_id: args.root.id,
    taxonomy_term_id: args.topic.id,
    term_key: args.topic.definition.term_key,
    disposition,
    method,
    semantic_score: score,
    negative_semantic_score: args.semantic?.negative_score ?? null,
    lexical_match: lexical.matched,
    excluded_by_rule: lexical.excluded,
    excluded_by_negative: args.semantic?.excluded_by_negative ?? false,
    evidence_digest: evidenceDigest,
    lineage_digest: sha256(`${args.execution.definition_digest}:${evidenceDigest}`)
  };
}

async function claimExecution(executionId: string, recoverInterruptedAttempt = false) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = (await client.query<ExecutionRow>(`
      SELECT id::text,workspace_id::text,taxonomy_profile_id::text,study_corpus_id::text,
        actor_user_id::text,intent,source_execution_id::text,status,denominator,population_digest,
        watermark_digest,identity_catalog_digest,definition_digest,publish_when_ready,
        embedding_cost_estimate_micro_usd,embedding_cost_cap_micro_usd,embedding_pricing_version,
        generation_id::text,result_summary
      FROM signal_topic_catalog_executions WHERE id=$1::uuid FOR UPDATE
    `, [executionId])).rows[0];
    if (!row) throw new Error("topic_execution_not_found");
    if (["ready", "completed"].includes(row.status)) { await client.query("COMMIT"); return null; }
    if (!canClaimSignalTopicExecutionV1(row.status, recoverInterruptedAttempt)) {
      throw new Error("topic_execution_not_claimable");
    }
    await client.query(`UPDATE signal_topic_catalog_executions SET status='running',progress=1,
      error_code=NULL,completed_at=NULL,started_at=COALESCE(started_at,now()),heartbeat_at=now(),updated_at=now()
      WHERE id=$1::uuid`, [executionId]);
    await client.query("COMMIT");
    return { ...row, denominator: Number(row.denominator),
      embedding_cost_estimate_micro_usd: row.embedding_cost_estimate_micro_usd === null ? null
        : Number(row.embedding_cost_estimate_micro_usd),
      embedding_cost_cap_micro_usd: row.embedding_cost_cap_micro_usd === null ? null
        : Number(row.embedding_cost_cap_micro_usd), status: "running" };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

async function loadTopics(profileId: string) {
  return loadTopicsWithQueryable(pool, profileId);
}

async function loadTopicsWithQueryable(queryable: Pick<PoolClient, "query">, profileId: string) {
  const rows = (await queryable.query<TopicRow>(`
    SELECT term.id::text,term.term_key,term.label,COALESCE(term.description,'') description,term.metadata
    FROM signal_taxonomy_profiles profile JOIN taxonomy_terms term ON term.taxonomy_id=profile.taxonomy_id
    WHERE profile.id=$1::uuid ORDER BY term.sort_order,term.term_key
  `, [profileId])).rows;
  return rows.map((row) => ({ id: row.id, definition: signalTopicDefinitionSchemaV1.parse({
    ...objectValue(objectValue(row.metadata).topic), term_key: row.term_key,label: row.label,definition: row.description
  }) }));
}

async function loadCalibrationsForSearch(
  queryable: Pick<PoolClient, "query">,
  executionId: string,
  topics: Array<{ id: string; definition: SignalTopicDefinitionV1 }>
) {
  const rows = (await queryable.query<{
    term_key: string;
    root_id: string;
    score: string | null;
    disposition: "belongs" | "excluded";
  }>(`
    SELECT suggestion.term_key,suggestion.canonical_root_id::text root_id,
      suggestion.semantic_score::text score,override.disposition
    FROM signal_topic_classification_suggestions suggestion
    JOIN taxonomy_terms term ON term.id=suggestion.taxonomy_term_id
    JOIN signal_topic_membership_overrides override
      ON override.workspace_id=suggestion.workspace_id
      AND override.term_key=suggestion.term_key
      AND override.canonical_root_id=suggestion.canonical_root_id
      AND override.definition_revision=(term.metadata->'topic'->>'definition_revision')::int
    WHERE suggestion.execution_id=$1::uuid
  `, [executionId])).rows;
  return new Map(topics.map((topic) => [topic.definition.term_key,
    calibrateSignalTopicThresholdV1(rows.filter((row) => row.term_key === topic.definition.term_key)
      .map((row) => ({ mention_id: row.root_id, score: row.score === null ? Number.NaN : Number(row.score),
        disposition: row.disposition }))) ]));
}

async function registerCalibratedAuthorities(
  client: PoolClient,
  execution: ExecutionRow,
  topics: Array<{ id: string; definition: SignalTopicDefinitionV1 }>,
  calibrations: Map<string, SignalTopicCalibrationV1>
) {
  const source = (await client.query<{ embedding_model: string | null }>(`
    SELECT embedding_model FROM signal_topic_catalog_executions
    WHERE id=$1::uuid AND intent='search' AND status='ready'
  `, [execution.source_execution_id])).rows[0];
  const result = new Map<string, TopicCalibrationAuthority>();
  if (!source?.embedding_model) return result;
  const effectiveFrom = (await client.query<{ effective_from: string }>(
    "SELECT transaction_timestamp()::text effective_from"
  )).rows[0]?.effective_from;
  if (!effectiveFrom) throw new Error("topic_authority_effective_time_unavailable");
  for (const topic of topics) {
    const calibration = calibrations.get(topic.definition.term_key);
    if (!calibration?.available || calibration.threshold === null) continue;
    const functionKey = `topic-hybrid:${execution.taxonomy_profile_id}:${topic.definition.term_key}`;
    const inputContract = {
      contract_version: SIGNAL_TOPIC_CLASSIFIER_CONTRACT_V1,
      definition_digest: topic.definition.definition_digest,
      catalog_definition_digest: execution.definition_digest,
      embedding_model: source.embedding_model,
      similarity_threshold: calibration.threshold,
      lexical_exclusions: topic.definition.exclusion,
      semantic_negative_examples: topic.definition.negative_examples,
      semantic_contrast: { negative_weight: 0.25, exclusion_floor: 0.55 },
      calibration: calibration.calibration,
      validation: calibration.validation
    };
    const outputContract = {
      contract_version: SIGNAL_TOPIC_CLASSIFIER_CONTRACT_V1,
      outcomes: ["vote", "abstain"],
      term_key: topic.definition.term_key
    };
    const definitionHash = sha256(stableJson({ input: inputContract, output: outputContract }));
    const priorFunction = (await client.query<{ id: string; version: number; definition_hash: string;
      status: string }>(`
      SELECT id::text,version,definition_hash,status FROM signal_labeling_function_versions
      WHERE owner_kind='workspace' AND workspace_id=$1::uuid AND function_key=$2
      ORDER BY version DESC,id DESC LIMIT 1
    `, [execution.workspace_id, functionKey])).rows[0];
    let labelingFunction: { labeling_function_version_id: string } | undefined;
    if (priorFunction?.status === "approved" && priorFunction.definition_hash === definitionHash) {
      labelingFunction = { labeling_function_version_id: priorFunction.id };
    } else {
      const functionVersion = Number(priorFunction?.version ?? 0) + 1;
      const functionRequest = sha256(stableJson({ function_key: functionKey,
        version: functionVersion, supersedes_id: priorFunction?.id ?? null,
        definition_hash: definitionHash, status: "approved" }));
      labelingFunction = (await client.query<{ labeling_function_version_id: string }>(`
        SELECT labeling_function_version_id::text
        FROM register_signal_labeling_function_v1(
          $1::uuid,'workspace',$2,$3,$4::uuid,$5::uuid,$6::jsonb,$7::jsonb,$8,
          'approved',$9::timestamptz,NULL,$10::uuid,$11::uuid,$12,$13)
      `, [execution.workspace_id, functionKey, functionVersion, execution.taxonomy_profile_id, topic.id,
        JSON.stringify(inputContract), JSON.stringify(outputContract), definitionHash, effectiveFrom,
        priorFunction?.id ?? null, execution.actor_user_id,
        sha256(`topic-lf:${execution.id}:${topic.definition.term_key}:${functionVersion}`),
        functionRequest])).rows[0];
    }
    if (!labelingFunction) throw new Error("topic_labeling_function_not_registered");
    const policyKey = `topic-policy:${execution.taxonomy_profile_id}:${topic.definition.term_key}`;
    const policyHash = sha256(stableJson({ policy_key: policyKey,
      labeling_function_version_id: labelingFunction.labeling_function_version_id,
      minimum_precision: 0.8, minimum_recall: 0.5, calibration }));
    const priorPolicy = (await client.query<{ id: string; version: number; definition_hash: string;
      status: string; labeling_function_version_id: string | null }>(`
      SELECT id::text,version,definition_hash,status,labeling_function_version_id::text
      FROM signal_classification_approval_policies
      WHERE workspace_id=$1::uuid AND taxonomy_profile_id=$2::uuid AND policy_key=$3
      ORDER BY version DESC,id DESC LIMIT 1
    `, [execution.workspace_id, execution.taxonomy_profile_id, policyKey])).rows[0];
    let policy: { approval_policy_id: string } | undefined;
    if (priorPolicy?.status === "approved" && priorPolicy.definition_hash === policyHash
      && priorPolicy.labeling_function_version_id === labelingFunction.labeling_function_version_id) {
      policy = { approval_policy_id: priorPolicy.id };
    } else {
      const policyVersion = Number(priorPolicy?.version ?? 0) + 1;
      const policyRequest = sha256(stableJson({ policy_key: policyKey, version: policyVersion,
        supersedes_id: priorPolicy?.id ?? null, definition_hash: policyHash, status: "approved" }));
      policy = (await client.query<{ approval_policy_id: string }>(`
        SELECT approval_policy_id::text
        FROM register_signal_classification_approval_policy_v1(
          $1::uuid,$2::uuid,$3,$4,'labeling_function',$5::uuid,NULL,NULL,$6,
          'approved',$7::timestamptz,NULL,$8::uuid,$9::uuid,$10,$11)
      `, [execution.workspace_id, execution.taxonomy_profile_id, policyKey, policyVersion,
        labelingFunction.labeling_function_version_id, policyHash, effectiveFrom,
        priorPolicy?.id ?? null, execution.actor_user_id,
        sha256(`topic-policy:${execution.id}:${topic.definition.term_key}:${policyVersion}`),
        policyRequest])).rows[0];
    }
    if (!policy) throw new Error("topic_approval_policy_not_registered");
    result.set(topic.definition.term_key, {
      calibration,
      labeling_function_version_id: labelingFunction.labeling_function_version_id,
      approval_policy_id: policy.approval_policy_id
    });
  }
  return result;
}

async function loadRoots(workspaceId: string, profileId: string, corpusId: string,
  queryable: Pick<PoolClient, "query"> | typeof pool = pool) {
  return (await queryable.query<RootRow>(`
    WITH topic_scopes AS(
      SELECT DISTINCT COALESCE(term.metadata->'topic'->>'scope','primary_brand') scope
      FROM signal_taxonomy_profiles profile JOIN taxonomy_terms term ON term.taxonomy_id=profile.taxonomy_id
      WHERE profile.id=$2::uuid AND term.status<>'archived'
    ), eligible AS(
      SELECT membership.mention_id id,'primary_brand'::text scope
      FROM signal_workspace_population_pointers pointer
      JOIN signal_population_memberships membership ON membership.population_id=pointer.population_id
        AND membership.workspace_id=pointer.workspace_id
      WHERE pointer.workspace_id=$1::uuid AND pointer.purpose='operational'
        AND membership.membership_status='included' AND membership.removed_at IS NULL
        AND EXISTS(SELECT 1 FROM topic_scopes WHERE scope='primary_brand')
      UNION
      SELECT attribution.mention_id,attribution.scope
      FROM signal_mention_attributions attribution
      WHERE attribution.workspace_id=$1::uuid AND attribution.is_current=true
        AND attribution.review_status='approved' AND attribution.eligibility_status='eligible'
        AND attribution.scope IN(SELECT scope FROM topic_scopes WHERE scope IN('competitor','category'))
    ) SELECT mention.id::text,mention.text_clean,mention.platform,mention.published_at::text,
      array_agg(DISTINCT eligible.scope ORDER BY eligible.scope) scopes
    FROM eligible JOIN mentions mention ON mention.id=eligible.id AND mention.workspace_id=$1::uuid
      AND mention.study_corpus_id=$3::uuid AND mention.canonical_mention_id=mention.id
    GROUP BY mention.id ORDER BY mention.id
  `, [workspaceId, profileId, corpusId])).rows;
}

async function verifyExecutionSnapshot(execution: ExecutionRow, roots: RootRow[], definitionDigest: string,
  queryable: Pick<PoolClient, "query"> | typeof pool = pool) {
  const current = (await queryable.query<{ study_corpus_id: string | null; watermark_digest: string | null }>(`
    WITH corpus AS(
      SELECT membership.study_corpus_id FROM signal_workspace_corpora membership
      WHERE membership.workspace_id=$1::uuid AND membership.role='operational' AND membership.valid_to IS NULL
      ORDER BY membership.valid_from DESC LIMIT 1
    ) SELECT (SELECT study_corpus_id::text FROM corpus) study_corpus_id,
      signal_classification_watermark_digest_v1($1::uuid,(SELECT study_corpus_id FROM corpus)) watermark_digest
  `, [execution.workspace_id])).rows[0];
  const ids = roots.map((root) => root.id);
  const identityDigest = sha256(ids.join("|"));
  const populationDigest = sha256(stableJson({ workspace_id: execution.workspace_id,
    study_corpus_id: execution.study_corpus_id,
    roots: roots.map((root) => ({ id: root.id, scopes: root.scopes })) }));
  if (current?.study_corpus_id !== execution.study_corpus_id
    || roots.length !== Number(execution.denominator)
    || identityDigest !== execution.identity_catalog_digest
    || populationDigest !== execution.population_digest
    || current.watermark_digest !== execution.watermark_digest) {
    throw new Error("topic_population_changed");
  }
  if (definitionDigest !== execution.definition_digest) throw new Error("topic_definition_changed");
  return {
    population_digest: populationDigest,
    identity_catalog_digest: identityDigest,
    definition_digest: definitionDigest,
    denominator: roots.length
  };
}

async function resolveCompleteMentionEmbeddingModel(execution: ExecutionRow, roots: RootRow[]) {
  const expectedChunks = expectedMentionEmbeddingChunks(roots);
  const row = (await pool.query<{ embedding_model: string; covered: number }>(`
    SELECT embedding.embedding_model,count(DISTINCT embedding.mention_id)::int covered
    FROM semantic_embeddings embedding
    JOIN jsonb_to_recordset($2::jsonb) expected(mention_id uuid,chunk_hash text)
      ON expected.mention_id=embedding.mention_id AND expected.chunk_hash=embedding.chunk_hash
    WHERE embedding.scope_type='mention' AND embedding.study_corpus_id=$1::uuid
      AND embedding.chunk_index=0
    GROUP BY embedding.embedding_model HAVING count(DISTINCT embedding.mention_id)=$3
    ORDER BY max(embedding.created_at) DESC,embedding.embedding_model LIMIT 1
  `, [execution.study_corpus_id, JSON.stringify(expectedChunks), roots.length])).rows[0];
  if (!row) throw new Error("topic_mention_embeddings_incomplete");
  return row.embedding_model;
}

async function ensureDefinitionEmbeddings(execution: ExecutionRow,
  topics: Array<{ id: string; definition: SignalTopicDefinitionV1 }>, model: string,
  context: Awaited<ReturnType<typeof loadSignalTopicClassificationContextStoreV1>>) {
  const keys: TopicEmbeddingKeys[] = topics.map((topic) => {
    const scopedContext = context.embedding_contexts[topic.definition.scope];
    const inputs = buildSignalTopicEmbeddingInputsV1(topic.definition, scopedContext);
    return { term_id: topic.id,
      positive_digest: inputs.positive.digest,
      negative_digest: inputs.negative?.digest ?? null };
  });
  const allDigests = keys.flatMap((item) => [item.positive_digest, ...(item.negative_digest ? [item.negative_digest] : [])]);
  const cached = new Set((await pool.query<{ definition_digest: string }>(`
    SELECT definition_digest FROM signal_topic_definition_embeddings
    WHERE workspace_id=$1::uuid AND embedding_model=$2 AND definition_digest=ANY($3::text[])
  `, [execution.workspace_id, model, allDigests])).rows
    .map((row) => row.definition_digest));
  const byId = new Map(topics.map((topic) => [topic.id, topic.definition]));
  const missing = keys.flatMap((item) => {
    const topic = byId.get(item.term_id)!;
    const scopedContext = context.embedding_contexts[topic.scope];
    const inputs = buildSignalTopicEmbeddingInputsV1(topic, scopedContext);
    const values: Array<{ id: string; text: string }> = [];
    if (!cached.has(item.positive_digest)) values.push({ id: item.positive_digest,
      text: inputs.positive.text });
    if (item.negative_digest && !cached.has(item.negative_digest)) values.push({ id: item.negative_digest,
      text: inputs.negative!.text });
    return values;
  });
  if (missing.length === 0) return keys;
  const provider = getEmbeddingProvider();
  if (!provider || getEmbeddingModel(provider) !== model) throw new Error("topic_definition_embedding_unavailable");
  const orderedMissing = [...missing].sort((left, right) => left.id.localeCompare(right.id));
  const estimate = estimateSignalTopicEmbeddingCostMicroUsdV1({ provider, model,
    texts: orderedMissing.map((item) => item.text) });
  if (!execution.embedding_cost_cap_micro_usd) throw new Error("topic_embedding_cost_confirmation_required");
  if (execution.embedding_pricing_version !== estimate.pricing_version) {
    throw new Error("topic_embedding_pricing_changed");
  }
  if (execution.embedding_cost_estimate_micro_usd === null
    || execution.embedding_cost_estimate_micro_usd < estimate.estimated_micro_usd) {
    throw new Error("topic_embedding_estimate_changed");
  }
  if (execution.embedding_cost_cap_micro_usd < estimate.estimated_micro_usd) {
    throw new Error("topic_embedding_hard_cap_exceeded");
  }
  const inputDigests = orderedMissing.map((item) => item.id);
  const requestDigest = sha256(stableJson({ provider, model,
    pricing_version: estimate.pricing_version, input_digests: inputDigests }));
  const ledgerClient = await pool.connect();
  let ledger: { status: string; request_digest: string } | undefined;
  try {
    await ledgerClient.query("BEGIN");
    await ledgerClient.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`topic-embedding:${execution.workspace_id}:${model}`]);
    const completedOverlap = (await ledgerClient.query<{ found: boolean }>(`
      SELECT EXISTS(SELECT 1 FROM signal_topic_embedding_calls
        WHERE workspace_id=$1::uuid AND embedding_model=$2 AND status='completed'
          AND execution_id<>$4::uuid AND input_digests && $3::text[]) found
    `, [execution.workspace_id, model, inputDigests, execution.id])).rows[0]?.found;
    if (completedOverlap) throw new Error("topic_definition_embedding_cache_incomplete");
    const uncertainOverlap = (await ledgerClient.query<{ status: string }>(`
      SELECT status FROM signal_topic_embedding_calls
      WHERE workspace_id=$1::uuid AND embedding_model=$2
        AND status IN('reserved','sent_unknown') AND execution_id<>$4::uuid
        AND input_digests && $3::text[] ORDER BY reserved_at LIMIT 1
    `, [execution.workspace_id, model, inputDigests, execution.id])).rows[0];
    if (uncertainOverlap) throw new Error(uncertainOverlap.status === "sent_unknown"
      ? "topic_embedding_outcome_unknown" : "topic_embedding_request_in_progress");
    ledger = (await ledgerClient.query<{ status: string; request_digest: string }>(`
      INSERT INTO signal_topic_embedding_calls(execution_id,workspace_id,provider,embedding_model,
        pricing_version,request_digest,input_digests,input_count,input_characters,reserved_micro_usd,status)
      VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7::text[],$8,$9,$10,'reserved')
      ON CONFLICT DO NOTHING RETURNING status,request_digest
    `, [execution.id, execution.workspace_id, provider, model, estimate.pricing_version,
      requestDigest, inputDigests, orderedMissing.length,
      orderedMissing.reduce((sum, item) => sum + item.text.length, 0),
      estimate.estimated_micro_usd])).rows[0]
      ?? (await ledgerClient.query<{ status: string; request_digest: string }>(`
        SELECT status,request_digest FROM signal_topic_embedding_calls WHERE execution_id=$1::uuid
      `, [execution.id])).rows[0];
    await ledgerClient.query("COMMIT");
  } catch (error) {
    await ledgerClient.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { ledgerClient.release(); }
  if (!ledger || ledger.request_digest !== requestDigest)
    throw new Error("topic_embedding_ledger_conflict");
  if (ledger.status === "sent_unknown") throw new Error("topic_embedding_outcome_unknown");
  if (ledger.status === "completed") throw new Error("topic_definition_embedding_cache_incomplete");
  if (ledger.status !== "reserved") throw new Error("topic_embedding_ledger_unavailable");
  const sent = await pool.query(`UPDATE signal_topic_embedding_calls
    SET status='sent_unknown',sent_at=now(),updated_at=now()
    WHERE execution_id=$1::uuid AND status='reserved'`, [execution.id]);
  if ((sent.rowCount ?? 0) !== 1) throw new Error("topic_embedding_ledger_unavailable");
  const embedded = await embedTexts({ provider, model, inputType: "query", batchSize: 64,
    inputs: orderedMissing });
  if (embedded.length !== orderedMissing.length) throw new Error("topic_definition_embedding_incomplete");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const item of embedded) await client.query(`
      INSERT INTO signal_topic_definition_embeddings(workspace_id,definition_digest,embedding_model,provider,embedding)
      VALUES($1::uuid,$2,$3,$4,$5::vector) ON CONFLICT DO NOTHING
    `, [execution.workspace_id, item.id, model, provider, vectorLiteral(item.embedding)]);
    const completed = await client.query(`UPDATE signal_topic_embedding_calls
      SET status='completed',settled_micro_usd=reserved_micro_usd,
        completed_at=now(),updated_at=now()
      WHERE execution_id=$1::uuid AND status='sent_unknown'`, [execution.id]);
    if ((completed.rowCount ?? 0) !== 1) throw new Error("topic_embedding_ledger_unavailable");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
  return keys;
}

async function loadSemanticScores(execution: ExecutionRow, roots: RootRow[], model: string,
  keys: TopicEmbeddingKeys[]) {
  if (roots.length === 0) return new Map<string, SemanticScore>();
  const expectedChunks = expectedMentionEmbeddingChunks(roots);
  const rows = (await pool.query<{ root_id: string; term_id: string; positive_score: string;
    negative_score: string | null }>(`
    WITH mention_vectors AS(
      SELECT DISTINCT ON(embedding.mention_id) embedding.mention_id,embedding.embedding
      FROM semantic_embeddings embedding
      JOIN jsonb_to_recordset($3::jsonb) expected(mention_id uuid,chunk_hash text)
        ON expected.mention_id=embedding.mention_id AND expected.chunk_hash=embedding.chunk_hash
      WHERE embedding.scope_type='mention' AND embedding.study_corpus_id=$1::uuid
        AND embedding.embedding_model=$2 AND embedding.chunk_index=0
      ORDER BY embedding.mention_id,embedding.created_at DESC,embedding.id DESC
    ), definitions AS(
      SELECT expected.term_id,positive.embedding positive_embedding,negative.embedding negative_embedding
      FROM jsonb_to_recordset($5::jsonb) expected(
        term_id uuid,positive_digest text,negative_digest text)
      JOIN signal_topic_definition_embeddings positive ON positive.workspace_id=$4::uuid
        AND positive.definition_digest=expected.positive_digest AND positive.embedding_model=$2
      LEFT JOIN signal_topic_definition_embeddings negative ON negative.workspace_id=$4::uuid
        AND negative.definition_digest=expected.negative_digest AND negative.embedding_model=$2
    ) SELECT vector.mention_id::text root_id,definition.term_id::text,
      (1-(vector.embedding<=>definition.positive_embedding))::text positive_score,
      CASE WHEN definition.negative_embedding IS NULL THEN NULL
        ELSE (1-(vector.embedding<=>definition.negative_embedding))::text END negative_score
    FROM mention_vectors vector CROSS JOIN definitions definition
  `, [execution.study_corpus_id, model, JSON.stringify(expectedChunks), execution.workspace_id,
    JSON.stringify(keys)])).rows;
  return new Map(rows.map((row) => {
    const negative = row.negative_score === null ? null : Number(row.negative_score);
    const contrasted = signalTopicContrastScoreV1(Number(row.positive_score), negative);
    return [scoreKey(row.root_id, row.term_id), { score: contrasted.score,
      negative_score: negative, excluded_by_negative: contrasted.excluded_by_negative }];
  }));
}

function expectedMentionEmbeddingChunks(roots: RootRow[]) {
  return roots.map((root) => {
    const chunk = chunkForEmbedding(root.text_clean, { maxChars: 900, overlapChars: 0 })[0];
    if (!chunk) throw new Error("topic_mention_text_unavailable");
    return { mention_id: root.id, chunk_hash: hashEmbeddingChunk(chunk) };
  });
}

async function loadCorrectionsSnapshot(workspaceId: string, profileId: string,
  topics: Array<{ id: string; definition: SignalTopicDefinitionV1 }>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const rows = (await client.query<{ term_key: string; root_id: string; disposition: "belongs" | "excluded" }>(`
      SELECT override.term_key,override.canonical_root_id::text root_id,override.disposition
      FROM signal_topic_membership_overrides override
      JOIN jsonb_to_recordset($2::jsonb) definition(term_key text,definition_revision int)
        ON definition.term_key=override.term_key AND definition.definition_revision=override.definition_revision
      WHERE override.workspace_id=$1::uuid
    `, [workspaceId, JSON.stringify(topics.map((topic) => ({ term_key: topic.definition.term_key,
      definition_revision: topic.definition.definition_revision })))] )).rows;
    const digest = (await client.query<{ digest: string }>(`
      SELECT signal_topic_membership_override_digest_v1($1::uuid,$2::uuid) digest
    `, [workspaceId, profileId])).rows[0]?.digest;
    await client.query("COMMIT");
    if (!digest) throw new Error("topic_correction_digest_unavailable");
    return { digest, items: new Map(rows.map((row) => [`${row.term_key}:${row.root_id}`, row])) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

async function persistSearch(execution: ExecutionRow,
  topics: Array<{ id: string; definition: SignalTopicDefinitionV1 }>,
  evaluated: Array<{ root: RootRow; suggestions: Suggestion[] }>,
  embeddingModel: string | null,
  calibrations: Map<string, SignalTopicCalibrationV1>,
  correctionDigest: string) {
  const client = await pool.connect();
  let chainedExecutionId: string | null = null;
  try {
    await client.query("BEGIN");
    const currentRoots = await loadRoots(execution.workspace_id, execution.taxonomy_profile_id,
      execution.study_corpus_id, client);
    const currentContext = await loadSignalTopicClassificationContextStoreV1({
      queryable: client,
      workspace_id: execution.workspace_id,
      taxonomy_profile_id: execution.taxonomy_profile_id
    });
    await verifyExecutionSnapshot(execution, currentRoots, currentContext.definition_digest, client);
    const currentCorrectionDigest = (await client.query<{ digest: string }>(`
      SELECT signal_topic_membership_override_digest_v1($1::uuid,$2::uuid) digest
    `, [execution.workspace_id, execution.taxonomy_profile_id])).rows[0]?.digest;
    if (currentCorrectionDigest !== correctionDigest) throw new Error("topic_corrections_changed");
    const suggestions = evaluated.flatMap((item) => item.suggestions);
    for (let index = 0; index < suggestions.length; index += WRITE_BATCH_SIZE) {
      await client.query(`
        INSERT INTO signal_topic_classification_suggestions(execution_id,workspace_id,canonical_root_id,
          taxonomy_term_id,term_key,disposition,method,semantic_score,lexical_match,excluded_by_rule,
          negative_semantic_score,excluded_by_negative,evidence_digest,lineage_digest)
        SELECT execution_id,workspace_id,canonical_root_id,taxonomy_term_id,term_key,disposition,method,
          semantic_score,lexical_match,excluded_by_rule,negative_semantic_score,excluded_by_negative,
          evidence_digest,lineage_digest
        FROM jsonb_to_recordset($1::jsonb) AS value(execution_id uuid,workspace_id uuid,
          canonical_root_id uuid,taxonomy_term_id uuid,term_key text,disposition text,method text,
          semantic_score numeric,lexical_match boolean,excluded_by_rule boolean,negative_semantic_score numeric,
          excluded_by_negative boolean,evidence_digest text,lineage_digest text)
        ON CONFLICT DO NOTHING
      `, [JSON.stringify(suggestions.slice(index, index + WRITE_BATCH_SIZE))]);
    }
    const items = evaluated.map(({ root, suggestions: decisions }) => {
      const visible = decisions.filter((item) => item.disposition !== "none");
      const resolutionState = visible.some((item) => item.disposition === "relevant") ? "relevant"
        : visible.some((item) => item.disposition === "doubt") ? "doubt"
          : visible.some((item) => item.disposition === "excluded") ? "excluded" : "not_relevant";
      const bestScore = decisions.reduce<number | null>((best, item) => item.semantic_score === null
        ? best : best === null ? item.semantic_score : Math.max(best, item.semantic_score), null);
      return { execution_id: execution.id, workspace_id: execution.workspace_id,
        canonical_root_id: root.id, resolution_state: resolutionState, best_score: bestScore,
        item_digest: sha256(stableJson(decisions.map((item) => ({ term_key: item.term_key,
          disposition: item.disposition, evidence_digest: item.evidence_digest })))) };
    });
    for (let index = 0; index < items.length; index += WRITE_BATCH_SIZE) await client.query(`
      INSERT INTO signal_topic_classification_items(execution_id,workspace_id,canonical_root_id,
        resolution_state,best_score,item_digest)
      SELECT execution_id,workspace_id,canonical_root_id,resolution_state,best_score,item_digest
      FROM jsonb_to_recordset($1::jsonb) AS value(execution_id uuid,workspace_id uuid,
        canonical_root_id uuid,resolution_state text,best_score numeric,item_digest text)
      ON CONFLICT DO NOTHING
    `, [JSON.stringify(items.slice(index, index + WRITE_BATCH_SIZE))]);
    const counts = Object.fromEntries(topics.map((topic) => [topic.definition.term_key, {
      relevant: suggestions.filter((item) => item.term_key === topic.definition.term_key && item.disposition === "relevant").length,
      doubt: suggestions.filter((item) => item.term_key === topic.definition.term_key && item.disposition === "doubt").length,
      excluded: suggestions.filter((item) => item.term_key === topic.definition.term_key && item.disposition === "excluded").length
    }]));
    await client.query(`UPDATE signal_topic_catalog_executions SET status='ready',progress=100,
      embedding_model=$2,result_summary=$3::jsonb,completed_at=now(),heartbeat_at=now(),updated_at=now()
      WHERE id=$1::uuid AND status='running'`, [execution.id, embeddingModel, JSON.stringify({
        contract_version: SIGNAL_TOPIC_CLASSIFIER_CONTRACT_V1,
        semantic: embeddingModel !== null,
        denominator: evaluated.length,
        topics: topics.length,
        correction_digest: correctionDigest,
        counts,
        calibrations: Object.fromEntries(calibrations)
      })]);
    if (execution.publish_when_ready) {
      if (topics.some((topic) => topic.definition.scope !== "primary_brand")) {
        throw new Error("topic_signal_scope_unsupported");
      }
      const idempotencyKey = `topic-auto-publish:${execution.id}`;
      const requestDigest = sha256(stableJson({ source_execution_id: execution.id,
        profile_id: execution.taxonomy_profile_id, population_digest: execution.population_digest,
        definition_digest: execution.definition_digest }));
      chainedExecutionId = (await client.query<{ id: string }>(`
        INSERT INTO signal_topic_catalog_executions(workspace_id,taxonomy_profile_id,study_corpus_id,
          actor_user_id,intent,source_execution_id,idempotency_key,request_digest,population_digest,
          watermark_digest,identity_catalog_digest,definition_digest,denominator)
        VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'publish',$5::uuid,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT(workspace_id,idempotency_key) DO UPDATE SET updated_at=EXCLUDED.updated_at
        RETURNING id::text
      `, [execution.workspace_id, execution.taxonomy_profile_id, execution.study_corpus_id,
        execution.actor_user_id, execution.id, idempotencyKey, requestDigest,
        execution.population_digest, execution.watermark_digest, execution.identity_catalog_digest,
        execution.definition_digest, execution.denominator])).rows[0]?.id ?? null;
      if (chainedExecutionId) await client.query(`
        INSERT INTO signal_topic_classification_outbox(execution_id,workspace_id,worker_job_id)
        VALUES($1::uuid,$2::uuid,$3) ON CONFLICT(execution_id) DO NOTHING
      `, [chainedExecutionId, execution.workspace_id,
        `signal-topic-classification-${chainedExecutionId}`]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
  return chainedExecutionId;
}

async function heartbeat(executionId: string, progress: number) {
  await pool.query(`UPDATE signal_topic_catalog_executions SET progress=$2,heartbeat_at=now(),updated_at=now()
    WHERE id=$1::uuid AND status='running'`, [executionId, progress]);
}
async function failExecution(executionId: string, code: string) {
  await pool.query(`UPDATE signal_topic_catalog_executions SET status='failed',error_code=$2,
    heartbeat_at=now(),completed_at=now(),updated_at=now() WHERE id=$1::uuid AND status='running'`,
  [executionId, code.slice(0, 120)]);
}
async function completeTopicClassificationOutbox(executionId: string) {
  await pool.query(`UPDATE signal_topic_classification_outbox SET status='completed',completed_at=now(),
    lease_token=NULL,lease_expires_at=NULL,updated_at=now()
    WHERE execution_id=$1::uuid AND status<>'completed'`, [executionId]);
}
function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "topic_classification_failed";
  return /^[a-z0-9_:-]{3,120}$/u.test(message) ? message : "topic_classification_failed";
}
function scoreKey(rootId: string, termId: string) { return `${rootId}:${termId}`; }
function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function sha256(value: string) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
