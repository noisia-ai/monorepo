import { pool } from "../db/client";
import {
  enqueueSignalSemanticResolutionChild,
  semanticResolutionRedisConnection,
  signalSemanticResolutionQueueName
} from "../queues/semantic-resolution";

const POLL_MS = 2_000;
const LEASE_SECONDS = 120;

export function startSignalSemanticResolutionChildOutboxDrainer() {
  let closed = false;
  let running = false;
  const tick = async () => {
    if (closed || running) return;
    running = true;
    try {
      const claimed = await pool.query<{
        outbox_id: string;
        workspace_id: string;
        run_id: string;
        child_batch_id: string;
        lease_token: string;
        attempt: number;
      }>(`
        SELECT outbox_id::text,workspace_id::text,run_id::text,
          child_batch_id::text,lease_token::text,attempt::int
        FROM claim_signal_semantic_resolution_child_dispatch_v1(10,$1,8)
      `, [LEASE_SECONDS]);
      for (const row of claimed.rows) {
        try {
          await enqueueSignalSemanticResolutionChild({
            outbox_id: row.outbox_id,
            workspace_id: row.workspace_id,
            run_id: row.run_id,
            child_batch_id: row.child_batch_id
          }, `semantic-resolution-child-${row.child_batch_id}-${row.attempt}`);
          await pool.query(`
            SELECT complete_signal_semantic_resolution_child_dispatch_v1($1::uuid,$2::uuid)
          `, [row.outbox_id,row.lease_token]);
        } catch (error) {
          await pool.query(`
            SELECT fail_signal_semantic_resolution_child_dispatch_v1(
              $1::uuid,$2::uuid,$3,30
            )
          `, [row.outbox_id,row.lease_token,safeErrorCode(error)]).catch(() => undefined);
        }
      }
    } catch (error) {
      console.warn(`[semantic-resolution-child-outbox] claim failed: ${safeErrorCode(error)}`);
    } finally {
      running = false;
    }
  };
  const heartbeatKey=`noisia:drainer-alive:${signalSemanticResolutionQueueName}:child-outbox`;
  const heartbeat=()=>semanticResolutionRedisConnection.set(
    heartbeatKey,String(Date.now()),"EX",45
  ).catch(()=>undefined);
  void heartbeat();
  void tick();
  const timer = setInterval(() => void tick(),POLL_MS);
  const heartbeatTimer=setInterval(()=>void heartbeat(),15_000);
  return {
    close: async () => {
      closed = true;
      clearInterval(timer);
      clearInterval(heartbeatTimer);
      while (running) await new Promise((resolve) => setTimeout(resolve,25));
    }
  };
}

function safeErrorCode(error: unknown) {
  return (error instanceof Error ? error.name : "unknown_error").slice(0,120);
}
