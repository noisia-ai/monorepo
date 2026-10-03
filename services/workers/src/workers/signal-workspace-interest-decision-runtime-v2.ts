import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { AnthropicBatchItem } from "../providers/anthropic-message-batches";
import {
  parseSignalWorkspaceInterestDecisionBatchItemV2,
  validateSignalWorkspaceInterestDecisionPageManifestV2,
  type SignalWorkspaceInterestDecisionItemResultV2,
  type SignalWorkspaceInterestDecisionPageManifestV2,
} from "./signal-workspace-interest-decision-batch-v2";

type Database = Pick<Pool, "connect">;
type Environment = Readonly<Record<string, string | undefined>>;
type SealedCall = {
  call_id: string; custom_id: string; status: string; raw_body: string | null;
  raw_sha256: string | null; request_version: number; owner_version: number;
  manifest: unknown;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sha = (value: string) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const fail = (code: string): never => { throw new Error(`workspace_interest_batch_v2_runtime_${code}`); };

/** V2 has a sealed-output SQL function, but no V2 admission, claim or raw
 * settlement contract. This module is deliberately absent from the drainer. */
export function signalWorkspaceInterestDecisionRuntimeConfigurationV2(env: Environment = process.env) {
  return { enabled: env.NOISIA_SIGNAL_INTEREST_DECISION_V2_ENABLED === "true",
    provider_ready: false as const };
}

function manifestFromDatabase(value: unknown): SignalWorkspaceInterestDecisionPageManifestV2 {
  const manifest = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return fail("manifest_invalid");
  validateSignalWorkspaceInterestDecisionPageManifestV2(manifest as SignalWorkspaceInterestDecisionPageManifestV2);
  return manifest as SignalWorkspaceInterestDecisionPageManifestV2;
}

const expectedValidationStatus = (result: SignalWorkspaceInterestDecisionItemResultV2) =>
  result.status === "provider_error" ? "errored" : result.status;

/** Local post-settlement seam. The existing ledger must already contain exact
 * provider bytes and billed usage. This function never writes either field and
 * cannot prepare, claim, reserve, send or retry a provider Batch. */
export async function applySettledSignalWorkspaceInterestDecisionItemV2(args: {
  database: Database; call_id: string; env?: Environment;
}): Promise<{ disabled: true } | { disabled: false; call_id: string;
  validation_status: string; replayed: boolean }> {
  if (!signalWorkspaceInterestDecisionRuntimeConfigurationV2(args.env).enabled) return { disabled: true };
  if (!uuid.test(args.call_id)) return fail("call_id_invalid");
  const client = await args.database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    const row = (await client.query<SealedCall>(`SELECT c.id::text call_id,c.status,c.raw_body,c.raw_sha256,
      r.custom_id,r.provider_contract_version request_version,
      o.provider_contract_version owner_version,p.manifest
      FROM signal_interest_decision_calls_v1 c
      JOIN signal_interest_decision_requests_v1 r ON r.id=c.request_id
      JOIN signal_interest_decision_owners_v1 o ON o.id=c.owner_id
      JOIN signal_interest_decision_pages_v1 p ON p.id=r.page_id
      WHERE c.id=$1::uuid FOR UPDATE OF c`, [args.call_id])).rows[0];
    if (!row || row.call_id !== args.call_id || row.status !== "settled"
      || row.request_version !== 2 || row.owner_version !== 2
      || typeof row.raw_body !== "string" || row.raw_sha256 !== sha(row.raw_body))
      return fail("settled_v2_receipt_required");
    const manifest = manifestFromDatabase(row.manifest);
    if (!manifest.requests.some(request => request.provider_request.custom_id === row.custom_id))
      return fail("call_manifest_mismatch");
    let item: AnthropicBatchItem;
    try { item = JSON.parse(row.raw_body) as AnthropicBatchItem; }
    catch { return fail("raw_envelope_invalid"); }
    const parsed = parseSignalWorkspaceInterestDecisionBatchItemV2({
      manifest, item, rawText: row.raw_body,
    });
    if (parsed.custom_id !== row.custom_id || parsed.raw_sha256 !== row.raw_sha256)
      return fail("raw_binding_mismatch");
    const applied = (await client.query<{ result: unknown }>(
      "SELECT apply_signal_interest_decision_item_v2($1::uuid) result", [args.call_id])).rows[0]?.result;
    if (!applied || typeof applied !== "object" || Array.isArray(applied)) return fail("apply_receipt_invalid");
    const receipt = applied as Record<string, unknown>;
    if (receipt.call_id !== args.call_id || receipt.validation_status !== expectedValidationStatus(parsed)
      || typeof receipt.replayed !== "boolean"
      || parsed.status === "accepted" && receipt.root_count !== undefined
        && receipt.root_count !== parsed.parsed.output.decisions.length)
      return fail("apply_receipt_mismatch");
    await client.query("COMMIT");
    return { disabled: false, call_id: args.call_id,
      validation_status: receipt.validation_status as string, replayed: receipt.replayed };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve original failure */ }
    throw error;
  } finally { client.release(); }
}
