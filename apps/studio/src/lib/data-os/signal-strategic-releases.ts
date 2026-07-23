import type { PoolClient } from "pg";

import { canManageCorpus } from "@/lib/auth/roles";
import { pool } from "@/lib/db";
import type { ResolvedSignalWorkspace } from "@/lib/data-os/signal-workspace";

export type SignalStrategicReleaseSummary = {
  release_id: string;
  release_key: string;
  title: string;
  status: string;
  visibility: string;
  period_start: string;
  period_end: string;
  corpus_revision: number;
  snapshot_id: string;
  comparison_base_analysis_id: string | null;
  approved_at: string | null;
  published_at: string | null;
  is_current: boolean;
  artifact_count: number;
  temporal_metric_count: number;
  movement_counts: Record<string, number>;
  artifacts: Array<{
    artifact_id: string;
    artifact_key: string;
    artifact_type: string;
    artifact_revision: number;
    title: string | null;
    summary: string | null;
    review_status: string;
  }>;
};

export function canManageSignalStrategicReleases(
  isInternalUser: boolean,
  primaryRole: string
) {
  return isInternalUser && canManageCorpus(primaryRole);
}

type ReleaseRow = Omit<
  SignalStrategicReleaseSummary,
  "is_current" | "artifact_count" | "temporal_metric_count"
> & {
  is_current: boolean;
  artifact_count: number | string;
  temporal_metric_count: number | string;
};

export async function loadSignalStrategicReleasesV1(
  workspace: ResolvedSignalWorkspace,
  isInternalUser: boolean
) {
  const result = await pool.query<ReleaseRow>(
    `SELECT
       release.id::text AS release_id,
       release.release_key,
       release.title,
       release.status,
       release.visibility,
       release.period_start::text,
       release.period_end::text,
       release.corpus_revision,
       release.snapshot_id::text,
       release.comparison_base_analysis_id::text,
       release.approved_at::text,
       release.published_at::text,
       (current_release.release_id = release.id) AS is_current,
       (
         SELECT COUNT(*)::integer
         FROM signal_workspace_release_artifacts release_artifact
         WHERE release_artifact.release_id = release.id
           AND ($2::boolean OR release_artifact.visibility = 'client')
       ) AS artifact_count,
       (
         SELECT COUNT(*)::integer
         FROM tb_temporal_metrics metric
         WHERE metric.tb_analysis_id = release.tb_analysis_id
       ) AS temporal_metric_count,
       COALESCE((
         SELECT jsonb_object_agg(movement, movement_count ORDER BY movement)
         FROM (
           SELECT comparison.movement, COUNT(*)::integer AS movement_count
           FROM tb_finding_temporal_comparisons comparison
           WHERE comparison.tb_analysis_id = release.tb_analysis_id
           GROUP BY comparison.movement
         ) movement_summary
       ), '{}'::jsonb) AS movement_counts,
       COALESCE((
         SELECT jsonb_agg(
           jsonb_build_object(
             'artifact_id', artifact.id,
             'artifact_key', artifact.artifact_key,
             'artifact_type', artifact.artifact_type,
             'artifact_revision', release_artifact.artifact_revision,
             'title', artifact.title,
             'summary', artifact.summary,
             'review_status', artifact.review_status
           )
           ORDER BY release_artifact.position, artifact.artifact_key
         )
         FROM signal_workspace_release_artifacts release_artifact
         JOIN analysis_artifacts artifact ON artifact.id = release_artifact.artifact_id
         WHERE release_artifact.release_id = release.id
           AND artifact.revision = release_artifact.artifact_revision
           AND ($2::boolean OR release_artifact.visibility = 'client')
       ), '[]'::jsonb) AS artifacts
     FROM signal_workspace_releases release
     LEFT JOIN signal_workspace_current_releases current_release
       ON current_release.workspace_id = release.workspace_id
      AND current_release.release_id = release.id
     WHERE release.workspace_id = $1::uuid
       AND ($2::boolean OR (release.status = 'published' AND release.visibility = 'client'))
     ORDER BY release.period_end DESC, release.created_at DESC, release.id`,
    [workspace.id, isInternalUser]
  );
  const releases = result.rows.map(normalizeRelease);
  return {
    contract_version: "signal-backend-v1" as const,
    strategic_release_contract_version: "tb-temporal-v1" as const,
    workspace_id: workspace.id,
    current: releases.find((release) => release.is_current) ?? null,
    history: releases
  };
}

export async function createSignalStrategicReleaseDraft(args: {
  workspaceId: string;
  tbAnalysisId: string;
  title?: string;
  createdByUserId: string;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const scope = await client.query<{
      period_start: string;
      period_end: string;
      corpus_revision: number;
      snapshot_id: string;
      comparison_base_analysis_id: string | null;
      membership_role: string;
      quality_gates: unknown;
      failed_gates: number;
    }>(
      `SELECT
         analysis.period_start::text,
         analysis.period_end::text,
         analysis.corpus_revision,
         analysis.snapshot_id::text,
         analysis.comparison_base_analysis_id::text,
         membership.role AS membership_role,
         COALESCE((
           SELECT jsonb_agg(
             jsonb_build_object(
               'gate_name', gate.gate_name,
               'passed', gate.passed,
               'notes', gate.notes,
               'checked_at', gate.checked_at
             ) ORDER BY gate.gate_name
           )
           FROM tb_quality_gates gate
           WHERE gate.tb_analysis_id = analysis.id
         ), '[]'::jsonb) AS quality_gates,
         (
           SELECT COUNT(*)::integer
           FROM tb_quality_gates gate
           WHERE gate.tb_analysis_id = analysis.id
             AND gate.passed = false
         ) AS failed_gates
       FROM tb_analyses analysis
       JOIN signal_workspace_corpora membership
         ON membership.workspace_id = $1::uuid
        AND membership.study_corpus_id = analysis.study_corpus_id
        AND membership.valid_to IS NULL
        AND membership.role IN ('operational', 'strategic')
       WHERE analysis.id = $2::uuid
         AND analysis.status IN ('approved_by_im', 'approved_by_kam')
         AND analysis.scope_frozen_at IS NOT NULL
         AND analysis.period_start IS NOT NULL
         AND analysis.period_end IS NOT NULL
         AND analysis.corpus_revision IS NOT NULL
       FOR UPDATE OF analysis`,
      [args.workspaceId, args.tbAnalysisId]
    );
    const analysis = scope.rows[0];
    if (!analysis) throw new Error("signal_release_analysis_not_eligible");
    if (analysis.failed_gates > 0) throw new Error("signal_release_quality_gates_failed");

    const inserted = await client.query<{ id: string; status: string }>(
      `INSERT INTO signal_workspace_releases (
         workspace_id, tb_analysis_id, release_key, title, status, visibility,
         period_start, period_end, corpus_revision, snapshot_id,
         comparison_base_analysis_id, quality_gates, metadata
       ) VALUES (
         $1::uuid,
         $2::uuid,
         'strategic:' || $3::date::text || ':' || $2::uuid::text,
         COALESCE(NULLIF($4, ''), 'Strategic release · ' || $3::date::text),
         'draft',
         'internal',
         $5::date,
         $3::date,
         $6,
         $7::uuid,
         $8::uuid,
         $9::jsonb,
         jsonb_build_object(
           'contract_version', 'tb-temporal-v1',
           'created_by_user_id', $10::uuid,
           'membership_role', $11
         )
       )
       ON CONFLICT (workspace_id, tb_analysis_id) DO NOTHING
       RETURNING id::text, status`,
      [
        args.workspaceId,
        args.tbAnalysisId,
        analysis.period_end,
        args.title ?? "",
        analysis.period_start,
        analysis.corpus_revision,
        analysis.snapshot_id,
        analysis.comparison_base_analysis_id,
        JSON.stringify(analysis.quality_gates),
        args.createdByUserId,
        analysis.membership_role
      ]
    );
    const releaseRow = inserted.rows[0] ?? (
      await client.query<{ id: string; status: string }>(
        `SELECT id::text, status
         FROM signal_workspace_releases
         WHERE workspace_id = $1::uuid
           AND tb_analysis_id = $2::uuid
         FOR UPDATE`,
        [args.workspaceId, args.tbAnalysisId]
      )
    ).rows[0];
    if (!releaseRow) throw new Error("signal_release_insert_failed");
    if (releaseRow.status === "published") throw new Error("signal_release_already_published");

    await client.query(
      `DELETE FROM signal_workspace_release_artifacts
       WHERE release_id = $1::uuid`,
      [releaseRow.id]
    );
    const artifacts = await client.query<{ id: string }>(
      `INSERT INTO signal_workspace_release_artifacts (
         release_id, artifact_id, artifact_revision, position, visibility
       )
       SELECT
         $1::uuid,
         artifact.id,
         artifact.revision,
         ROW_NUMBER() OVER (
           ORDER BY artifact.artifact_type, artifact.position, artifact.artifact_key
         )::integer - 1,
         CASE WHEN artifact.artifact_type = 'analysis_context' THEN 'internal' ELSE 'client' END
       FROM analysis_artifacts artifact
       WHERE artifact.tb_analysis_id = $2::uuid
         AND artifact.review_status IN ('accepted', 'corrected', 'limited')
         AND NOT EXISTS (
           SELECT 1
           FROM analysis_artifacts newer
           WHERE newer.tb_analysis_id = artifact.tb_analysis_id
             AND newer.artifact_key = artifact.artifact_key
             AND newer.revision > artifact.revision
         )
       RETURNING id::text`,
      [releaseRow.id, args.tbAnalysisId]
    );
    if (artifacts.rows.length === 0) throw new Error("signal_release_artifacts_missing");

    await client.query("COMMIT");
    return {
      contract_version: "signal-backend-v1" as const,
      strategic_release_contract_version: "tb-temporal-v1" as const,
      release_id: releaseRow.id,
      status: releaseRow.status,
      artifact_count: artifacts.rows.length
    };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function promoteSignalStrategicRelease(args: {
  workspaceId: string;
  releaseId: string;
  reviewerUserId: string;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const scoped = await client.query<{ id: string }>(
      `SELECT id::text
       FROM signal_workspace_releases
       WHERE id = $1::uuid
         AND workspace_id = $2::uuid
       FOR UPDATE`,
      [args.releaseId, args.workspaceId]
    );
    if (!scoped.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      `SELECT promote_signal_workspace_release($1::uuid, $2::uuid)`,
      [args.releaseId, args.reviewerUserId]
    );
    await client.query("COMMIT");
    return {
      contract_version: "signal-backend-v1" as const,
      strategic_release_contract_version: "tb-temporal-v1" as const,
      release_id: args.releaseId,
      status: "published" as const,
      is_current: true as const
    };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

function normalizeRelease(row: ReleaseRow): SignalStrategicReleaseSummary {
  return {
    ...row,
    is_current: row.is_current === true,
    artifact_count: numeric(row.artifact_count),
    temporal_metric_count: numeric(row.temporal_metric_count),
    movement_counts:
      row.movement_counts && typeof row.movement_counts === "object"
        ? row.movement_counts
        : {},
    artifacts: Array.isArray(row.artifacts) ? row.artifacts : []
  };
}

async function rollbackQuietly(client: PoolClient) {
  await client.query("ROLLBACK").catch(() => undefined);
}

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
