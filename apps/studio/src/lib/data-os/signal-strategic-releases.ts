import { createHash } from "node:crypto";

import type { PoolClient } from "pg";

import { canManageCorpus } from "@/lib/auth/roles";
import { pool } from "@/lib/db";
import type { ResolvedSignalWorkspace } from "@/lib/data-os/signal-workspace";

export type SignalStrategicReleaseSummary = {
  release_id: string;
  study_corpus_id: string;
  report_key: string;
  report_revision: number;
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
  const hasReportIdentity = await hasSignalWorkspaceReportIdentityV1();
  const reportIdentitySelect = hasReportIdentity
    ? "release.report_key, release.report_revision,"
    : "'triggers-barriers'::text AS report_key, 1::integer AS report_revision,";
  const reportCurrentJoin = hasReportIdentity
    ? `LEFT JOIN signal_workspace_report_current_releases report_current
         ON report_current.workspace_id = release.workspace_id
        AND report_current.report_key = release.report_key`
    : "";
  const currentReleaseExpression = hasReportIdentity
    ? `COALESCE(
         report_current.release_id = release.id,
         legacy_current.release_id = release.id,
         false
       )`
    : "COALESCE(legacy_current.release_id = release.id, false)";
  const result = await pool.query<ReleaseRow>(
    `SELECT
       release.id::text AS release_id,
       analysis.study_corpus_id::text,
       ${reportIdentitySelect}
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
       ${currentReleaseExpression} AS is_current,
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
     JOIN tb_analyses analysis ON analysis.id = release.tb_analysis_id
     ${reportCurrentJoin}
     LEFT JOIN signal_workspace_current_releases legacy_current
       ON legacy_current.workspace_id = release.workspace_id
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

export async function hasSignalWorkspaceReportIdentityV1() {
  const result = await pool.query<{ available: boolean }>(`
    SELECT
      to_regclass('public.signal_workspace_report_current_releases') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'signal_workspace_releases'
          AND column_name = 'report_key'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'signal_workspace_releases'
          AND column_name = 'report_revision'
      ) AS available
  `);
  return result.rows[0]?.available === true;
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
      strategic_contract_version: string | null;
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
         analysis.strategic_contract_version,
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
         AND (analysis.workspace_id IS NULL OR analysis.workspace_id = $1::uuid)
         AND (analysis.report_key IS NULL OR analysis.report_key = 'triggers-barriers')
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
    const governedClientEvidenceAllowed = analysis.strategic_contract_version
      !== "signal-tb-strategic-v2"
      || await snapshotHasClientEvidenceAuthority(client, {
        workspaceId: args.workspaceId,
        snapshotId: analysis.snapshot_id
      });
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1 || ':triggers-barriers', 0))`,
      [args.workspaceId]
    );

    const inserted = await client.query<{ id: string; status: string }>(
      `INSERT INTO signal_workspace_releases (
         workspace_id, tb_analysis_id, report_key, report_revision,
         release_key, title, status, visibility,
         period_start, period_end, corpus_revision, snapshot_id,
         comparison_base_analysis_id, quality_gates, metadata
       ) VALUES (
         $1::uuid,
         $2::uuid,
         'triggers-barriers',
         COALESCE((
           SELECT max(existing.report_revision) + 1
           FROM signal_workspace_releases existing
           WHERE existing.workspace_id = $1::uuid
             AND existing.report_key = 'triggers-barriers'
         ), 1),
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
           'membership_role', $11,
           'strategic_contract_version', $12::text,
           'client_evidence_authority', CASE WHEN $13::boolean
             THEN 'allowed' ELSE 'withheld' END
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
        analysis.membership_role,
        analysis.strategic_contract_version,
        governedClientEvidenceAllowed
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
         CASE
           WHEN artifact.artifact_type = 'analysis_context' THEN 'internal'
           WHEN $3::boolean THEN 'client'
           ELSE 'internal'
         END
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
      [releaseRow.id, args.tbAnalysisId, governedClientEvidenceAllowed]
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

export async function reviewAndPrepareSignalStrategicReleaseV2(args: {
  workspaceId: string;
  tbAnalysisId: string;
  reviewerUserId: string;
  idempotencyKey: string;
  reusableAssertions: Array<{
    recordTagId: string;
    decision: "approve" | "correct" | "reject";
    notes?: string;
    correction?: { value?: string; score?: number; confidence?: string };
  }>;
  limitations?: unknown;
  releaseTitle?: string;
}) {
  const idempotencyDigest = sha256ReleaseIdentity([
    "signal-strategic-review-release-idempotency-v1",
    args.workspaceId,
    args.idempotencyKey
  ]);
  const targetRequest = {
    contract_version: "signal-strategic-review-release-request-v1",
    workspace_id: args.workspaceId,
    tb_analysis_id: args.tbAnalysisId,
    actor_user_id: args.reviewerUserId,
    reusable_assertions: args.reusableAssertions.map((assertion) => ({
      record_tag_id: assertion.recordTagId,
      decision: assertion.decision,
      notes: assertion.notes ?? null,
      correction: assertion.correction ?? {}
    })),
    limitations: args.limitations ?? null,
    release_title: args.releaseTitle ?? null
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const digestResult = await client.query<{ request_digest: string }>(
      `SELECT signal_strategic_review_release_request_digest_v1($1::jsonb)
         AS request_digest`,
      [JSON.stringify(targetRequest)]
    );
    const requestDigest = digestResult.rows[0]?.request_digest;
    if (!requestDigest) throw new Error("signal_review_release_digest_unavailable");
    const request = { ...targetRequest, request_digest: requestDigest };
    const result = await client.query<{
      operation_id: string;
      release_id: string;
      created: boolean;
    }>(
      `SELECT operation_id::text,release_id::text,created
       FROM review_and_prepare_signal_tb_strategic_v2(
         $1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::jsonb
       )`,
      [
        args.workspaceId,
        args.tbAnalysisId,
        args.reviewerUserId,
        idempotencyDigest,
        requestDigest,
        JSON.stringify(request)
      ]
    );
    const row = result.rows[0];
    if (!row) throw new Error("signal_review_release_result_unavailable");
    await client.query("COMMIT");
    return {
      contract_version: "signal-tb-strategic-review-v2" as const,
      operation_id: row.operation_id,
      release_id: row.release_id,
      release_status: "draft" as const,
      created: row.created,
      selected_reusable_assertions: args.reusableAssertions.length
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
  idempotencyKey: string;
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
    const idempotencyDigest = sha256ReleaseIdentity([
      "signal-strategic-release-promotion-idempotency-v1",
      args.workspaceId,
      args.idempotencyKey
    ]);
    const requestDigest = sha256ReleaseIdentity([
      "signal-strategic-release-promotion-request-v1",
      args.workspaceId,
      "triggers-barriers",
      args.releaseId,
      args.reviewerUserId,
      "publish"
    ]);
    const promoted = await client.query<{ release_id: string; created: boolean }>(
      `SELECT release_id::text,created
       FROM promote_signal_workspace_report_release_v2(
         $1::uuid,'triggers-barriers',$2::uuid,$3::uuid,$4::text,$5::text
       )`,
      [args.workspaceId, args.releaseId, args.reviewerUserId, idempotencyDigest, requestDigest]
    );
    if (promoted.rows[0]?.release_id !== args.releaseId) {
      throw new Error("signal_release_promotion_result_incompatible");
    }
    await client.query("COMMIT");
    return {
      contract_version: "signal-backend-v1" as const,
      strategic_release_contract_version: "tb-temporal-v1" as const,
      release_id: args.releaseId,
      status: "published" as const,
      is_current: true as const,
      created: promoted.rows[0].created
    };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

function sha256ReleaseIdentity(parts: string[]) {
  return `sha256:${createHash("sha256").update(parts.join("\u001f"), "utf8").digest("hex")}`;
}

async function snapshotHasClientEvidenceAuthority(client: PoolClient, args: {
  workspaceId: string;
  snapshotId: string;
}) {
  const result = await client.query<{ allowed: boolean }>(
    `SELECT NOT EXISTS (
       SELECT 1
       FROM corpus_snapshot_mentions snapshot_membership
       WHERE snapshot_membership.snapshot_id=$2::uuid
         AND NOT EXISTS (
           SELECT 1
           FROM signal_mention_import_memberships provenance
           JOIN LATERAL (
             SELECT binding.licensing_policy_id,binding.retention_policy_id
             FROM signal_provenance_policy_bindings binding
             WHERE binding.workspace_id=$1::uuid
               AND binding.data_source_id=provenance.data_source_id
               AND (binding.import_batch_id=provenance.import_batch_id
                 OR binding.import_batch_id IS NULL)
               AND binding.status='active'
               AND binding.effective_from<=now()
               AND (binding.effective_to IS NULL OR binding.effective_to>now())
             ORDER BY (binding.import_batch_id IS NOT NULL) DESC,
               binding.binding_version DESC,binding.id
             LIMIT 1
           ) applicable ON true
           JOIN signal_licensing_policies license
             ON license.id=applicable.licensing_policy_id
            AND license.workspace_id=$1::uuid
            AND license.status='active'
            AND license.effective_from<=now()
            AND (license.effective_to IS NULL OR license.effective_to>now())
           JOIN signal_retention_policies retention
             ON retention.id=applicable.retention_policy_id
            AND retention.workspace_id=$1::uuid
            AND retention.status='active' AND retention.retention_state='allowed'
            AND retention.effective_from<=now()
            AND (retention.effective_to IS NULL OR retention.effective_to>now())
            AND (retention.retain_until IS NULL OR retention.retain_until>now())
           JOIN signal_licensing_policy_usages list_usage
             ON list_usage.licensing_policy_id=license.id
            AND list_usage.usage_purpose='client-mention-list'
            AND list_usage.decision='allowed'
           JOIN signal_licensing_policy_usages text_usage
             ON text_usage.licensing_policy_id=license.id
            AND text_usage.usage_purpose='client-text-or-excerpt'
            AND text_usage.decision='allowed'
           WHERE provenance.workspace_id=$1::uuid
             AND provenance.mention_id=snapshot_membership.mention_id
         )
     ) AS allowed`,
    [args.workspaceId, args.snapshotId]
  );
  return result.rows[0]?.allowed === true;
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
