import type { Job } from "bullmq";

import { reconcileSignalSemanticReviewProjectionV1 } from "@noisia/db";
import { pool } from "../db/client";
import type { SemanticReviewProjectionQueueDataV1 } from "../queues/semantic-resolution";

export async function signalSemanticReviewProjectionJob(
  job: Job<SemanticReviewProjectionQueueDataV1>
) {
  const status = await pool.query<{ status: string }>(`
    SELECT status
    FROM signal_semantic_review_projection_outbox
    WHERE id=$1::uuid AND workspace_id=$2::uuid
  `, [job.data.outboxId, job.data.workspaceId]);
  if (status.rows[0]?.status === "completed") {
    return { status: "completed", replayed: true };
  }
  if (!status.rows[0] || !["dispatching", "processing"].includes(status.rows[0].status)) {
    throw new Error("Semantic Review projection outbox is not dispatchable.");
  }
  try {
    const result = await reconcileSignalSemanticReviewProjectionV1(pool, {
      workspace_id: job.data.workspaceId,
      lease_token: job.data.leaseToken
    });
    return { status: "completed", replayed: false, ...result };
  } catch (error) {
    await pool.query(`
      SELECT fail_signal_semantic_review_projection_v1(
        $1::uuid,$2::uuid,$3::text,8
      )
    `, [
      job.data.outboxId,
      job.data.leaseToken,
      JSON.stringify({ kind: safeErrorKind(error) })
    ]).catch(() => undefined);
    throw error;
  }
}

function safeErrorKind(error: unknown) {
  if (error && typeof error === "object" && "code" in error
      && typeof (error as { code?: unknown }).code === "string") {
    return `database_${(error as { code: string }).code}`;
  }
  return error instanceof Error ? error.name : "unknown_error";
}
