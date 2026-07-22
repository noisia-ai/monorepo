import type { PoolClient } from "pg";

import { pool } from "@/lib/db";

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
