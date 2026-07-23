import type { PoolClient } from "pg";

import { pool } from "@/lib/db";
import {
  planAnalysisArtifactReview,
  type AnalysisArtifactReviewAction,
  type AnalysisArtifactReviewPatch,
  type AnalysisArtifactReviewResult
} from "@/lib/data-os/analysis-artifact-review";

export { planAnalysisArtifactReview } from "@/lib/data-os/analysis-artifact-review";

export type AnalysisArtifactNode = {
  id: string;
  artifact_key: string;
  artifact_type: string;
  source_entity_type: string | null;
  source_entity_id: string | null;
  title: string | null;
  summary: string | null;
  content: unknown;
  confidence: string | null;
  review_status: string;
  revision: number;
  position: number;
  metadata: unknown;
};

export type AnalysisArtifactEvidenceGroup = {
  id: string;
  artifact_id: string;
  group_key: string;
  role: string;
  label: string | null;
  summary: string | null;
  position: number;
  metadata: unknown;
};

export type AnalysisArtifactEvidenceLink = {
  id: string;
  evidence_group_id: string;
  source_type: string;
  source_id: string;
  relation_type: string;
  evidence_role: string;
  quote: string | null;
  locator: unknown;
  confidence: string | null;
  weight: string | null;
  position: number;
  metadata: unknown;
};

export type AnalysisArtifactRelation = {
  id: string;
  source_artifact_id: string;
  target_artifact_id: string;
  relation_type: string;
  position: number;
  metadata: unknown;
};

export type AnalysisArtifactGraph = {
  contract_version: "analysis-artifacts-v1";
  analysis_id: string;
  corpus_id: string;
  output_id: string | null;
  artifacts: AnalysisArtifactNode[];
  evidence_groups: AnalysisArtifactEvidenceGroup[];
  evidence_links: AnalysisArtifactEvidenceLink[];
  relations: AnalysisArtifactRelation[];
};

export async function loadAnalysisArtifactReviewHistory(args: {
  corpusId: string;
  artifactId: string;
}) {
  const result = await pool.query<{
    id: string;
    artifact_id: string;
    reviewer_user_id: string | null;
    action: string;
    previous_status: string | null;
    next_status: string;
    patch: unknown;
    notes: string | null;
    created_at: string;
  }>(
    `SELECT
       event.id::text,
       event.artifact_id::text,
       event.reviewer_user_id::text,
       event.action,
       event.previous_status,
       event.next_status,
       event.patch,
       event.notes,
       event.created_at::text
     FROM analysis_artifact_review_events event
     JOIN analysis_artifacts artifact ON artifact.id = event.artifact_id
     WHERE artifact.study_corpus_id = $1::uuid
       AND (
         artifact.id = $2::uuid
         OR artifact.supersedes_artifact_id = $2::uuid
         OR EXISTS (
           SELECT 1
           FROM analysis_artifacts requested
           WHERE requested.id = $2::uuid
             AND requested.study_corpus_id = artifact.study_corpus_id
             AND requested.artifact_key = artifact.artifact_key
             AND requested.tb_analysis_id IS NOT DISTINCT FROM artifact.tb_analysis_id
             AND requested.engine_analysis_id IS NOT DISTINCT FROM artifact.engine_analysis_id
         )
       )
     ORDER BY event.created_at, event.id`,
    [args.corpusId, args.artifactId]
  );
  return result.rows;
}

/**
 * Internal loader only. Callers must authorize corpus/output access before use.
 * Passing outputId freezes the read to the exact artifact rows linked at publish.
 */
export async function loadTbAnalysisArtifactGraph(args: {
  corpusId: string;
  analysisId: string;
  outputId?: string | null;
}): Promise<AnalysisArtifactGraph> {
  const outputId = args.outputId ?? null;
  const artifactScopeSql = outputId
    ? `AND EXISTS (
         SELECT 1
         FROM published_output_artifacts output_artifact
         WHERE output_artifact.published_output_id = $3::uuid
           AND output_artifact.artifact_id = artifact.id
           AND output_artifact.artifact_revision = artifact.revision
       )`
    : "";
  const params = outputId
    ? [args.corpusId, args.analysisId, outputId]
    : [args.corpusId, args.analysisId];

  const artifactResult = await pool.query<AnalysisArtifactNode>(
    `SELECT
       artifact.id::text,
       artifact.artifact_key,
       artifact.artifact_type,
       artifact.source_entity_type,
       artifact.source_entity_id::text,
       artifact.title,
       artifact.summary,
       artifact.content,
       artifact.confidence,
       artifact.review_status,
       artifact.revision,
       artifact.position,
       artifact.metadata
     FROM analysis_artifacts artifact
     WHERE artifact.study_corpus_id = $1::uuid
       AND artifact.tb_analysis_id = $2::uuid
       ${artifactScopeSql}
     ORDER BY artifact.artifact_type, artifact.position, artifact.artifact_key`,
    params
  );
  const artifactIds = artifactResult.rows.map((artifact) => artifact.id);
  if (artifactIds.length === 0) {
    return {
      contract_version: "analysis-artifacts-v1",
      analysis_id: args.analysisId,
      corpus_id: args.corpusId,
      output_id: outputId,
      artifacts: [],
      evidence_groups: [],
      evidence_links: [],
      relations: []
    };
  }

  const [groupResult, linkResult, relationResult] = await Promise.all([
    pool.query<AnalysisArtifactEvidenceGroup>(
      `SELECT
         evidence_group.id::text,
         evidence_group.artifact_id::text,
         evidence_group.group_key,
         evidence_group.role,
         evidence_group.label,
         evidence_group.summary,
         evidence_group.position,
         evidence_group.metadata
       FROM analysis_evidence_groups evidence_group
       WHERE evidence_group.artifact_id = ANY($1::uuid[])
       ORDER BY evidence_group.artifact_id, evidence_group.position, evidence_group.group_key`,
      [artifactIds]
    ),
    pool.query<AnalysisArtifactEvidenceLink>(
      `SELECT
         evidence_link.id::text,
         evidence_link.evidence_group_id::text,
         evidence_link.source_type,
         evidence_link.source_id::text,
         evidence_link.relation_type,
         evidence_link.evidence_role,
         evidence_link.quote,
         evidence_link.locator,
         evidence_link.confidence,
         evidence_link.weight::text,
         evidence_link.position,
         evidence_link.metadata
       FROM analysis_evidence_links evidence_link
       JOIN analysis_evidence_groups evidence_group
         ON evidence_group.id = evidence_link.evidence_group_id
       WHERE evidence_group.artifact_id = ANY($1::uuid[])
       ORDER BY evidence_group.artifact_id, evidence_link.position, evidence_link.id`,
      [artifactIds]
    ),
    pool.query<AnalysisArtifactRelation>(
      `SELECT
         relation.id::text,
         relation.source_artifact_id::text,
         relation.target_artifact_id::text,
         relation.relation_type,
         relation.position,
         relation.metadata
       FROM analysis_artifact_relations relation
       WHERE relation.source_artifact_id = ANY($1::uuid[])
         AND relation.target_artifact_id = ANY($1::uuid[])
       ORDER BY relation.source_artifact_id, relation.position, relation.target_artifact_id`,
      [artifactIds]
    )
  ]);

  return {
    contract_version: "analysis-artifacts-v1",
    analysis_id: args.analysisId,
    corpus_id: args.corpusId,
    output_id: outputId,
    artifacts: artifactResult.rows,
    evidence_groups: groupResult.rows,
    evidence_links: linkResult.rows,
    relations: relationResult.rows
  };
}

export async function approveTbAnalysisWithArtifacts(args: {
  corpusId: string;
  analysisId: string;
  reviewerUserId: string;
  limitations: unknown;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query<{ id: string }>(
      `SELECT id::text
       FROM tb_analyses
       WHERE id = $1::uuid
         AND study_corpus_id = $2::uuid
       FOR UPDATE`,
      [args.analysisId, args.corpusId]
    );
    if (!locked.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }

    const artifactCounts = await client.query<{
      artifacts: number | string;
      blocked: number | string;
    }>(
      `SELECT
         COUNT(*) AS artifacts,
         COUNT(*) FILTER (WHERE review_status NOT IN ('draft', 'needs_review')) AS blocked
       FROM analysis_artifacts
       WHERE tb_analysis_id = $1::uuid`,
      [args.analysisId]
    );
    const artifacts = numeric(artifactCounts.rows[0]?.artifacts);
    const blocked = numeric(artifactCounts.rows[0]?.blocked);
    if (artifacts === 0) {
      throw new Error("analysis_artifact_graph_missing");
    }
    if (blocked > 0) {
      throw new Error("analysis_artifact_review_state_conflict");
    }

    await client.query(
      `INSERT INTO analysis_artifact_review_events (
         artifact_id, reviewer_user_id, action, previous_status, next_status, patch, notes
       )
       SELECT
         artifact.id,
         $2::uuid,
         'accept_analysis',
         artifact.review_status,
         'accepted',
         '{}'::jsonb,
         'Accepted through T&B analysis approval.'
       FROM analysis_artifacts artifact
       WHERE artifact.tb_analysis_id = $1::uuid
         AND artifact.review_status IN ('draft', 'needs_review')`,
      [args.analysisId, args.reviewerUserId]
    );
    await client.query(
      `UPDATE analysis_artifacts
       SET review_status = 'accepted',
           updated_at = NOW()
       WHERE tb_analysis_id = $1::uuid
         AND review_status IN ('draft', 'needs_review')`,
      [args.analysisId]
    );
    const updated = await client.query<{ id: string; status: string }>(
      `UPDATE tb_analyses
       SET status = 'approved_by_im',
           current_step = 'done',
           limitations = $3::jsonb,
           approved_by_im_user_id = $4::uuid,
           im_approved_at = NOW(),
           updated_at = NOW()
       WHERE id = $1::uuid
         AND study_corpus_id = $2::uuid
       RETURNING id::text, status`,
      [
        args.analysisId,
        args.corpusId,
        args.limitations === null || args.limitations === undefined
          ? null
          : JSON.stringify(args.limitations),
        args.reviewerUserId
      ]
    );
    await client.query("COMMIT");
    return updated.rows[0] ?? null;
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Central artifact review writer. Corrections and limitations always create a
 * new revision; any review of a published revision also forks it.
 */
export async function reviewAnalysisArtifact(args: {
  corpusId: string;
  artifactId: string;
  reviewerUserId: string;
  action: AnalysisArtifactReviewAction;
  patch?: AnalysisArtifactReviewPatch;
  notes?: string;
}): Promise<AnalysisArtifactReviewResult | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query<{
      id: string;
      review_status: string;
      revision: number;
      published: boolean;
    }>(
      `SELECT
         artifact.id::text,
         artifact.review_status,
         artifact.revision,
         EXISTS (
           SELECT 1
           FROM published_output_artifacts published
           WHERE published.artifact_id = artifact.id
             AND published.artifact_revision = artifact.revision
         ) AS published
       FROM analysis_artifacts artifact
       WHERE artifact.id = $1::uuid
         AND artifact.study_corpus_id = $2::uuid
       FOR UPDATE`,
      [args.artifactId, args.corpusId]
    );
    const artifact = locked.rows[0];
    if (!artifact) {
      await client.query("ROLLBACK");
      return null;
    }

    const plan = planAnalysisArtifactReview({ action: args.action, published: artifact.published });
    const patch = args.patch ?? {};
    const notes = args.notes ?? null;

    if (!plan.createRevision) {
      await client.query(
        `INSERT INTO analysis_artifact_review_events (
           artifact_id, reviewer_user_id, action, previous_status, next_status, patch, notes
         ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7)`,
        [
          artifact.id,
          args.reviewerUserId,
          args.action,
          artifact.review_status,
          plan.nextStatus,
          JSON.stringify(patch),
          notes
        ]
      );
      await client.query(
        `UPDATE analysis_artifacts
         SET review_status = $2,
             updated_at = NOW()
         WHERE id = $1::uuid`,
        [artifact.id, plan.nextStatus]
      );
      await client.query("COMMIT");
      return {
        artifact_id: artifact.id,
        previous_artifact_id: null,
        review_status: plan.nextStatus,
        revision: artifact.revision,
        created_revision: false
      };
    }

    const superseded = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM analysis_artifacts newer
         JOIN analysis_artifacts current ON current.id = $1::uuid
         WHERE newer.study_corpus_id = current.study_corpus_id
           AND newer.artifact_key = current.artifact_key
           AND newer.revision > current.revision
           AND newer.tb_analysis_id IS NOT DISTINCT FROM current.tb_analysis_id
           AND newer.engine_analysis_id IS NOT DISTINCT FROM current.engine_analysis_id
       ) AS exists`,
      [artifact.id]
    );
    if (superseded.rows[0]?.exists) throw new Error("analysis_artifact_revision_superseded");

    const inserted = await client.query<{ id: string; revision: number }>(
      `INSERT INTO analysis_artifacts (
         study_corpus_id, tb_analysis_id, engine_analysis_id, artifact_key, artifact_type,
         source_entity_type, source_entity_id, title, summary, content, confidence,
         review_status, revision, position, supersedes_artifact_id, metadata
       )
       SELECT
         current.study_corpus_id,
         current.tb_analysis_id,
         current.engine_analysis_id,
         current.artifact_key,
         current.artifact_type,
         current.source_entity_type,
         current.source_entity_id,
         CASE WHEN $2::jsonb ? 'title' THEN $2::jsonb->>'title' ELSE current.title END,
         CASE WHEN $2::jsonb ? 'summary' THEN $2::jsonb->>'summary' ELSE current.summary END,
         CASE WHEN $2::jsonb ? 'content' THEN $2::jsonb->'content' ELSE current.content END,
         CASE WHEN $2::jsonb ? 'confidence' THEN $2::jsonb->>'confidence' ELSE current.confidence END,
         $3,
         current.revision + 1,
         current.position,
         current.id,
         current.metadata
           || COALESCE($2::jsonb->'metadata', '{}'::jsonb)
           || jsonb_build_object(
             'review_action', $4::text,
             'reviewed_at', NOW(),
             'reviewed_by_user_id', $5::uuid
           )
       FROM analysis_artifacts current
       WHERE current.id = $1::uuid
       RETURNING id::text, revision`,
      [artifact.id, JSON.stringify(patch), plan.nextStatus, args.action, args.reviewerUserId]
    );
    const revision = inserted.rows[0];
    if (!revision) throw new Error("analysis_artifact_revision_insert_failed");

    await cloneArtifactEvidence(client, artifact.id, revision.id);
    await cloneArtifactRelationsAndLineage(client, artifact.id, revision.id);
    await client.query(
      `INSERT INTO analysis_artifact_review_events (
         artifact_id, reviewer_user_id, action, previous_status, next_status, patch, notes
       ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7)`,
      [
        revision.id,
        args.reviewerUserId,
        args.action,
        artifact.review_status,
        plan.nextStatus,
        JSON.stringify(patch),
        notes
      ]
    );

    await client.query("COMMIT");
    return {
      artifact_id: revision.id,
      previous_artifact_id: artifact.id,
      review_status: plan.nextStatus,
      revision: revision.revision,
      created_revision: true
    };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

async function cloneArtifactEvidence(client: PoolClient, sourceArtifactId: string, targetArtifactId: string) {
  await client.query(
    `WITH inserted_groups AS (
       INSERT INTO analysis_evidence_groups (
         artifact_id, group_key, role, label, summary, position, metadata
       )
       SELECT $2::uuid, group_key, role, label, summary, position, metadata
       FROM analysis_evidence_groups
       WHERE artifact_id = $1::uuid
       RETURNING id, group_key
     )
     INSERT INTO analysis_evidence_links (
       evidence_group_id, source_type, source_id, relation_type, evidence_role,
       quote, locator, confidence, weight, position, metadata
     )
     SELECT
       inserted_group.id,
       link.source_type,
       link.source_id,
       link.relation_type,
       link.evidence_role,
       link.quote,
       link.locator,
       link.confidence,
       link.weight,
       link.position,
       link.metadata
     FROM analysis_evidence_links link
     JOIN analysis_evidence_groups source_group ON source_group.id = link.evidence_group_id
     JOIN inserted_groups inserted_group ON inserted_group.group_key = source_group.group_key
     WHERE source_group.artifact_id = $1::uuid`,
    [sourceArtifactId, targetArtifactId]
  );
}

async function cloneArtifactRelationsAndLineage(
  client: PoolClient,
  sourceArtifactId: string,
  targetArtifactId: string
) {
  await client.query(
    `INSERT INTO analysis_artifact_relations (
       source_artifact_id, target_artifact_id, relation_type, position, metadata
     )
     SELECT $2::uuid, relation.target_artifact_id, relation.relation_type, relation.position, relation.metadata
     FROM analysis_artifact_relations relation
     WHERE relation.source_artifact_id = $1::uuid
     ON CONFLICT ON CONSTRAINT uq_analysis_artifact_relations_pair DO NOTHING`,
    [sourceArtifactId, targetArtifactId]
  );
  await client.query(
    `INSERT INTO analysis_artifact_relations (
       source_artifact_id, target_artifact_id, relation_type, position, metadata
     )
     SELECT relation.source_artifact_id, $2::uuid, relation.relation_type, relation.position, relation.metadata
     FROM analysis_artifact_relations relation
     WHERE relation.target_artifact_id = $1::uuid
       AND relation.source_artifact_id <> $2::uuid
     ON CONFLICT ON CONSTRAINT uq_analysis_artifact_relations_pair DO NOTHING`,
    [sourceArtifactId, targetArtifactId]
  );
  await client.query(
    `INSERT INTO lineage_edges (
       source_type, source_id, target_type, target_id, relation_type, metadata
     )
     SELECT
       edge.source_type,
       edge.source_id,
       edge.target_type,
       CASE WHEN edge.target_type = 'analysis_artifact' THEN $2::uuid ELSE edge.target_id END,
       edge.relation_type,
       edge.metadata || jsonb_build_object(
         'revision_cloned_from', $1::uuid,
         'contract', 'analysis-artifacts-v1'
       )
     FROM lineage_edges edge
     WHERE edge.target_type = 'analysis_artifact'
       AND edge.target_id = $1::uuid
     ON CONFLICT ON CONSTRAINT uq_lineage_edges_relation DO UPDATE SET
       metadata = lineage_edges.metadata || EXCLUDED.metadata`,
    [sourceArtifactId, targetArtifactId]
  );
}

export async function persistPublishedAnalysisArtifacts(args: {
  outputId: string;
  corpusId: string;
  analysisId: string;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const output = await client.query<{ id: string }>(
      `SELECT id::text
       FROM published_outputs
       WHERE id = $1::uuid
         AND study_corpus_id = $2::uuid
         AND tb_analysis_id = $3::uuid
       FOR UPDATE`,
      [args.outputId, args.corpusId, args.analysisId]
    );
    if (!output.rows[0]) throw new Error("published_output_artifact_scope_mismatch");

    const statusCounts = await client.query<{
      eligible: number | string;
      unresolved: number | string;
      rejected: number | string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE review_status IN ('accepted', 'corrected', 'limited')) AS eligible,
         COUNT(*) FILTER (WHERE review_status IN ('draft', 'needs_review')) AS unresolved,
         COUNT(*) FILTER (WHERE review_status = 'rejected') AS rejected
       FROM analysis_artifacts
       WHERE study_corpus_id = $1::uuid
         AND tb_analysis_id = $2::uuid`,
      [args.corpusId, args.analysisId]
    );
    const status = statusCounts.rows[0];
    const eligible = numeric(status?.eligible);
    const unresolved = numeric(status?.unresolved);
    const rejected = numeric(status?.rejected);
    if (eligible === 0) throw new Error("analysis_artifacts_missing_or_unapproved");
    if (unresolved > 0) throw new Error("analysis_artifacts_require_review");

    await client.query(
      `DELETE FROM lineage_edges
       WHERE target_type = 'published_output'
         AND target_id = $1::uuid
         AND source_type = 'analysis_artifact'`,
      [args.outputId]
    );
    await client.query(
      `DELETE FROM published_output_artifacts
       WHERE published_output_id = $1::uuid`,
      [args.outputId]
    );
    const linked = await client.query<{ id: string }>(
      `INSERT INTO published_output_artifacts (
         published_output_id, artifact_id, artifact_revision, position, visibility, metadata
       )
       SELECT
         $1::uuid,
         artifact.id,
         artifact.revision,
         ROW_NUMBER() OVER (ORDER BY artifact.artifact_type, artifact.position, artifact.artifact_key)::integer - 1,
         'published',
         jsonb_build_object(
           'review_status', artifact.review_status,
           'contract', 'analysis-artifacts-v1'
         )
       FROM analysis_artifacts artifact
       WHERE artifact.study_corpus_id = $2::uuid
         AND artifact.tb_analysis_id = $3::uuid
         AND artifact.review_status IN ('accepted', 'corrected', 'limited')
       RETURNING id::text`,
      [args.outputId, args.corpusId, args.analysisId]
    );
    if (linked.rows.length !== eligible) {
      throw new Error("published_output_artifact_count_mismatch");
    }

    await client.query(
      `INSERT INTO lineage_edges (
         source_type, source_id, target_type, target_id, relation_type, metadata
       )
       SELECT
         'analysis_artifact',
         output_artifact.artifact_id,
         'published_output',
         output_artifact.published_output_id,
         'published_as',
         jsonb_build_object(
           'artifact_revision', output_artifact.artifact_revision,
           'contract', 'analysis-artifacts-v1'
         )
       FROM published_output_artifacts output_artifact
       WHERE output_artifact.published_output_id = $1::uuid
       ON CONFLICT ON CONSTRAINT uq_lineage_edges_relation DO UPDATE SET
         metadata = lineage_edges.metadata || EXCLUDED.metadata`,
      [args.outputId]
    );
    await client.query("COMMIT");

    return {
      status: "ok" as const,
      contractVersion: "analysis-artifacts-v1" as const,
      linkedArtifacts: linked.rows.length,
      rejectedArtifacts: rejected
    };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

async function rollbackQuietly(client: PoolClient) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original error.
  }
}

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
