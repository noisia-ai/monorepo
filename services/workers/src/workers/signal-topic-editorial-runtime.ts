import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadSignalTopicEditorialOwnerInputV1, createSignalTopicEditorialRunnerStoreV1,
  bindSignalTopicEditorialGlobalRequestV1, bindSignalTopicEditorialRepairRequestV1,
  readSignalTopicEditorialRecoveryV1, reserveSignalTopicEditorialCallV1, markSentSignalTopicEditorialCallV1,
  persistSignalTopicEditorialReceiptV1, settleSignalTopicEditorialCallV1, failSignalTopicEditorialCallV1,
} from "@noisia/db";
import { createWorkspaceEngineStorageV1, type WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";
import type { SignalTopicEditorialRuntimeStoresV1 } from "./signal-topic-editorial-queue";

export type SignalTopicEditorialEnvironmentV1 = Readonly<Record<string, string | undefined>>;
/** Flag reads are exact and short-circuit before credentials when disabled. */
export function signalTopicEditorialRuntimeConfigurationV1(env: SignalTopicEditorialEnvironmentV1 = process.env,
  overrides: { enabled?: boolean; provider_enabled?: boolean; api_key?: string } = {}) {
  const enabled = overrides.enabled ?? env.NOISIA_SIGNAL_TOPIC_EDITORIAL_ENABLED === "true";
  if (!enabled) return { enabled: false, provider_enabled: false, api_key: "" };
  const provider_enabled = overrides.provider_enabled ?? env.NOISIA_SIGNAL_TOPIC_EDITORIAL_PROVIDER_ENABLED === "true";
  return { enabled: true, provider_enabled, api_key: provider_enabled ? overrides.api_key ?? env.ANTHROPIC_API_KEY ?? "" : "" };
}

export type SignalTopicEditorialRuntimeDatabaseStoresV1 = Omit<SignalTopicEditorialRuntimeStoresV1, "storeRawReceipt">;
const defaults: SignalTopicEditorialRuntimeDatabaseStoresV1 = {
  loadInput: loadSignalTopicEditorialOwnerInputV1, runnerStore: createSignalTopicEditorialRunnerStoreV1,
  bindGlobal: bindSignalTopicEditorialGlobalRequestV1, bindRepair: bindSignalTopicEditorialRepairRequestV1,
  ledger: { readRecovery: readSignalTopicEditorialRecoveryV1, reserve: reserveSignalTopicEditorialCallV1,
    markSent: markSentSignalTopicEditorialCallV1, persistReceipt: persistSignalTopicEditorialReceiptV1,
    settle: settleSignalTopicEditorialCallV1, failCall: failSignalTopicEditorialCallV1 },
};
const sha = (value: Uint8Array | string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const digest = /^sha256:[0-9a-f]{64}$/u;
const fail = (): never => { throw new Error("topic_editorial_receipt_storage_invalid"); };

/** Pure composition: no pool, filesystem, storage request or provider is opened
 * until a hook is invoked. DB hooks each own a short transaction. */
export function createSignalTopicEditorialRuntimeStoresV1(options: {
  stores?: SignalTopicEditorialRuntimeDatabaseStoresV1; storage?: WorkspaceEngineStorageV1;
  create_storage?: () => WorkspaceEngineStorageV1; temporary_root?: string;
} = {}): SignalTopicEditorialRuntimeStoresV1 {
  const stores = options.stores ?? defaults;
  let storage = options.storage;
  const getStorage = () => storage ??= (options.create_storage ?? createWorkspaceEngineStorageV1)();
  return { ...stores, ledger: { ...stores.ledger, reserve: async args => {
    // Validate local storage configuration before reserving/sending. Historical
    // replay does not require credentials for either provider or storage.
    if (args.provider_available) await getStorage().assertReady?.();
    return stores.ledger.reserve(args);
  } }, storeRawReceipt: async ({ lease, call_id, receipt }) => {
    if (!uuid.test(lease.workspace_id) || !uuid.test(lease.execution_id) || !uuid.test(call_id)
      || !digest.test(receipt.request_digest) || !digest.test(receipt.sha256) || sha(receipt.bytes) !== receipt.sha256
      || receipt.bytes.byteLength > 8 * 1024 * 1024 || !/^[A-Za-z0-9_.:-]{1,240}$/u.test(receipt.idempotency_key)
      || !Number.isSafeInteger(receipt.http_status) || receipt.http_status < 100 || receipt.http_status > 599
      || typeof receipt.complete !== "boolean" || receipt.provider_request_id !== null
        && !/^[A-Za-z0-9_.:-]{1,200}$/u.test(receipt.provider_request_id)) return fail();
    const body = JSON.stringify({ contract_version: "signal-topic-editorial-http-receipt-v1",
      workspace_id: lease.workspace_id, execution_id: lease.execution_id, call_id,
      request_digest: receipt.request_digest, idempotency_key: receipt.idempotency_key,
      response_sha256: receipt.sha256, http_status: receipt.http_status, complete: receipt.complete,
      provider_request_id: receipt.provider_request_id, response_bytes_base64: Buffer.from(receipt.bytes).toString("base64") });
    const bodySha = sha(body), size = Buffer.byteLength(body), filename = `topic-editorial-response-${call_id}.json`;
    const directory = await mkdtemp(join(options.temporary_root ?? tmpdir(), "noisia-topic-editorial-receipt-"));
    try {
      const file = join(directory, filename);await writeFile(file, body, { mode: 0o600, flag: "wx" });
      const stored = await getStorage().put({ workspace_id: lease.workspace_id, execution_id: lease.execution_id,
        file, sha256: bodySha, size_bytes: size, media_type: "application/json" });
      const expectedKey = `workspace-engine/${lease.workspace_id}/${lease.execution_id}/${filename}.${bodySha.slice(7)}.parts.json`;
      if (stored.storage_key !== expectedKey || stored.sha256 !== bodySha || stored.size_bytes !== size || stored.media_type !== "application/json") return fail();
      return stored.storage_key;
    } finally { await rm(directory, { recursive: true, force: true }); }
  } };
}
