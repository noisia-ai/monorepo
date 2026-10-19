import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claimDueSignalTopicEditorialBatchV2,
  markSubmittingSignalTopicEditorialBatchV2,
  attachProviderSignalTopicEditorialBatchV2,
  recordSignalTopicEditorialBatchPollV2,
  releaseSignalTopicEditorialBatchLeaseV2,
  persistSignalTopicEditorialBatchItemV2,
  recordSignalTopicEditorialBatchItemValidationV2,
  finishSignalTopicEditorialBatchImportV2,
  rejectSignalTopicEditorialBatchSubmissionV2,
  type SignalTopicEditorialBatchDatabaseV2,
  type SignalTopicEditorialBatchLeaseV2 as DatabaseLease,
} from "@noisia/db";
import { createWorkspaceEngineStorageV1, type WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";
import type { SignalTopicEditorialBatchLeaseV2, SignalTopicEditorialBatchStoresV2 } from "./signal-topic-editorial-batch-v2";

const sha = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Real PG/storage binding. Merely composing it opens no connections and spends
 * nothing. The drainer remains disabled until its explicit feature flag is set. */
export function createSignalTopicEditorialBatchRuntimeStoresV2(options: {
  database: SignalTopicEditorialBatchDatabaseV2;
  storage?: WorkspaceEngineStorageV1;
  now?: () => Date;
  temporary_root?: string;
  batch_id?: string;
}): SignalTopicEditorialBatchStoresV2 {
  const database = options.database;
  const now = options.now ?? (() => new Date());
  let storage = options.storage;
  const getStorage = () => storage ??= createWorkspaceEngineStorageV1();
  const leases = new WeakMap<SignalTopicEditorialBatchLeaseV2, { db: DatabaseLease; uncertain: boolean }>();
  const bound = (lease: SignalTopicEditorialBatchLeaseV2) => {
    const value = leases.get(lease);
    if (!value || value.db.batch_id !== lease.batch_id || value.db.lease_token !== lease.lease_token) {
      throw new Error("topic_editorial_batch_runtime_lease_invalid");
    }
    return value;
  };
  async function storeReceipt(db: DatabaseLease, filename: string, body: string) {
    const workspace_id = db.items[0]?.request.identity.workspace_id ?? "";
    if (![workspace_id, db.execution_id, db.batch_id].every(value => uuid.test(value))) {
      throw new Error("topic_editorial_batch_storage_identity_invalid");
    }
    const digest = sha(body), size = Buffer.byteLength(body);
    const directory = await mkdtemp(join(options.temporary_root ?? tmpdir(), "noisia-editorial-batch-"));
    try {
      const file = join(directory, filename);
      await writeFile(file, body, { mode: 0o600, flag: "wx" });
      const result = await getStorage().put({ workspace_id, execution_id: db.execution_id,
        file, sha256: digest, size_bytes: size, media_type: "application/json" });
      const expected = `workspace-engine/${workspace_id}/${db.execution_id}/${filename}.${digest.slice(7)}.parts.json`;
      if (result.storage_key !== expected || result.sha256 !== digest || result.size_bytes !== size
        || result.media_type !== "application/json") throw new Error("topic_editorial_batch_storage_receipt_invalid");
      return result.storage_key;
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  return {
    async claimDue() {
      const db = await claimDueSignalTopicEditorialBatchV2({ database, batch_id: options.batch_id, lease_seconds: 120 });
      if (!db) return null;
      if (db.state === "applied" || db.state === "rejected") throw new Error("topic_editorial_batch_runtime_terminal_claim");
      const lease: SignalTopicEditorialBatchLeaseV2 = { ...db, state: db.state };
      leases.set(lease, { db, uncertain: false });
      return lease;
    },
    async markSubmitting(lease) {
      // Detect a missing private receipt store before any paid network operation.
      await getStorage().assertReady?.();
      const current = bound(lease).db;
      const prepared = await markSubmittingSignalTopicEditorialBatchV2({ database, lease: current });
      if (prepared.submission_token !== current.submission_token || prepared.manifest_digest !== current.manifest_digest) {
        throw new Error("topic_editorial_batch_runtime_manifest_changed");
      }
    },
    async attachProviderBatch(lease, state) {
      await attachProviderSignalTopicEditorialBatchV2({ database, lease: bound(lease).db, receipt_body: JSON.stringify(state) });
    },
    async markSubmissionUncertain(lease) { bound(lease).uncertain = true; },
    async markSubmissionRejected(lease, _code, receipt) {
      if (!receipt) {
        // A local preflight rejection after markSubmitting proves no HTTP receipt;
        // quarantine rather than inventing a provider rejection/cost settlement.
        bound(lease).uncertain = true;
        return;
      }
      const db = bound(lease).db;
      const body = JSON.stringify({ contract_version: "signal-topic-editorial-batch-rejection-receipt-v2",
        batch_id: db.batch_id, execution_id: db.execution_id, submission_token: db.submission_token, ...receipt });
      const storage_key = await storeReceipt(db, `editorial-batch-${db.batch_id}-rejection.json`, body);
      await rejectSignalTopicEditorialBatchSubmissionV2({ database, lease: db,
        http_status: receipt.http_status, raw_body: receipt.raw_body, complete: receipt.complete, storage_key });
    },
    async recordPoll(lease, state) {
      await recordSignalTopicEditorialBatchPollV2({ database, lease: bound(lease).db,
        receipt_body: JSON.stringify(state), next_poll_at: new Date(now().getTime() + 60_000).toISOString() });
    },
    async persistItem(lease, receipt) {
      const db = bound(lease).db;
      const item = db.items.find(value => value.custom_id === receipt.custom_id && value.call_id === receipt.call_id);
      if (!item || receipt.raw_sha256 !== sha(receipt.raw_text)) throw new Error("topic_editorial_batch_receipt_invalid");
      const workspace_id = item.request.identity.workspace_id;
      if (![workspace_id, db.execution_id, db.batch_id, item.call_id].every(value => uuid.test(value))) {
        throw new Error("topic_editorial_batch_storage_identity_invalid");
      }
      const body = JSON.stringify({ contract_version: "signal-topic-editorial-batch-item-receipt-v2",
        workspace_id, execution_id: db.execution_id, batch_id: db.batch_id, provider_batch_id: db.provider_batch_id,
        call_id: item.call_id, request_digest: item.request.request_digest, custom_id: item.custom_id,
        raw_sha256: receipt.raw_sha256, raw_body: receipt.raw_text });
      const filename = `editorial-batch-${db.batch_id}-item-${item.call_id}.json`;
      const storage_key = await storeReceipt(db, filename, body);
      await persistSignalTopicEditorialBatchItemV2({ database, lease: db, custom_id: receipt.custom_id,
        raw_body: receipt.raw_text, storage_key });
    },
    async recordValidation(lease, result) {
      const validation = result.validation.status === "provider_error" || result.validation.status === "canceled" || result.validation.status === "expired"
        ? { status: "invalid_message" as const, code: "code" in result.validation ? result.validation.code : "topic_editorial_batch_provider_error" }
        : result.validation;
      await recordSignalTopicEditorialBatchItemValidationV2({ database, lease: bound(lease).db,
        custom_id: result.custom_id, validation });
    },
    async finishImport(lease) { await finishSignalTopicEditorialBatchImportV2({ database, lease: bound(lease).db }); },
    async release(lease, result) {
      const current = bound(lease);
      await releaseSignalTopicEditorialBatchLeaseV2({ database, lease: current.db,
        next_poll_at: result.next_poll_at, submission_unknown: current.uncertain, error_code: result.error_code });
      leases.delete(lease);
    },
  };
}
