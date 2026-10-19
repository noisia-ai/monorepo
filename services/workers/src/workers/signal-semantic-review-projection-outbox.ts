import { pool } from "../db/client";
import { enqueueSemanticReviewProjectionJobV1 } from "../queues/semantic-resolution";

const POLL_MS = 2_000;
const LEASE_SECONDS = 900;

export function startSignalSemanticReviewProjectionOutboxDrainer() {
  let closed = false;
  let running = false;
  const tick = async () => {
    if (closed || running) return;
    running = true;
    try {
      const claimed = await pool.query<{
        outbox_id: string;
        workspace_id: string;
        lease_token: string;
      }>(`
        SELECT outbox_id::text,workspace_id::text,lease_token::text
        FROM claim_signal_semantic_review_projection_v1(4,$1)
      `, [LEASE_SECONDS]);
      for (const row of claimed.rows) {
        try {
          await enqueueSemanticReviewProjectionJobV1({
            outboxId: row.outbox_id,
            workspaceId: row.workspace_id,
            leaseToken: row.lease_token
          }, `semantic-review-projection-${row.outbox_id}`);
        } catch (error) {
          await pool.query(`
            SELECT fail_signal_semantic_review_projection_v1(
              $1::uuid,$2::uuid,$3::text,8
            )
          `, [
            row.outbox_id,
            row.lease_token,
            JSON.stringify({ kind: safeErrorKind(error) })
          ]).catch(() => undefined);
        }
      }
    } catch (error) {
      console.warn(`[semantic-review-projection-outbox] claim failed: ${safeErrorKind(error)}`);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), POLL_MS);
  return {
    close: async () => {
      closed = true;
      clearInterval(timer);
      while (running) await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
}

function safeErrorKind(error: unknown) {
  if (error && typeof error === "object" && "code" in error
      && typeof (error as { code?: unknown }).code === "string") {
    return `database_${(error as { code: string }).code}`;
  }
  return error instanceof Error ? error.name : "unknown_error";
}
