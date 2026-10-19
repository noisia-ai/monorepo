import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { buildSignalWorkspaceInterestDecisionRequestV1, signalWorkspaceEmbeddingDigestV1 } from "@noisia/query-engine";

type Database = Pick<Pool, "connect">;
type State = { id: string; processing_status: "in_progress" | "canceling" | "ended";
  request_counts: { processing: number; succeeded: number; errored: number; canceled: number; expired: number };
  ended_at: string | null; results_url: string | null };
type RawReceiptStorage = (args: { workspace_id: string; owner_id: string; batch_id: string; call_id: string;
  raw_text: string; raw_sha256: string }) => Promise<string>;
type Request = { contract_version: string; root_ids: string[]; request: Record<string, unknown>;
  provider_request: { custom_id: string; params: Record<string, unknown> }; provider_request_digest: string;
  provider_request_bytes: number };
type Manifest = { contract_version: string; expected_root_ids: string[]; page_digest: string;
  configuration: Record<string, unknown>; requests: Request[]; manifest_digest: string };
export type SignalWorkspaceInterestDecisionBatchLeaseV1 = { batch_id: string; lease_token: string;
  state: "prepared" | "submitting" | "submission_unknown" | "in_progress" | "canceling" | "ended";
  provider_batch_id: string | null; manifest: Manifest };
export type SignalWorkspaceInterestDecisionItemResultV1 =
  | { status: "accepted"; custom_id: string; request_digest: string; raw_sha256: string; parsed: unknown }
  | { status: "provider_error" | "canceled" | "expired" | "refusal" | "max_tokens" | "invalid_message" | "invalid_output";
      custom_id: string; request_digest: string; raw_sha256: string; code: string };
export class SignalWorkspaceInterestDecisionBatchStoreError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); this.name = "SignalWorkspaceInterestDecisionBatchStoreError"; }
}
const fail = (code: string, status = 409): never => { throw new SignalWorkspaceInterestDecisionBatchStoreError(code, status); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sha = (value: string) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const jsonDigest = (value: unknown) => signalWorkspaceEmbeddingDigestV1(value);
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const parseJson = (value: unknown, code: string): Record<string, unknown> => {
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { return fail(code, 503); } }
  return isRecord(value) ? value : fail(code, 503);
};
const canonicalState = (state: State) => {
  if (!state || typeof state.id !== "string" || !state.id || !["in_progress", "canceling", "ended"].includes(state.processing_status)
    || !isRecord(state.request_counts) || Object.keys(state.request_counts).sort().join(",") !== "canceled,errored,expired,processing,succeeded"
    || Object.values(state.request_counts).some(value => !Number.isSafeInteger(value) || (value as number) < 0)
    || !(state.ended_at === null || typeof state.ended_at === "string")
    || !(state.results_url === null || typeof state.results_url === "string")) fail("provider_receipt_invalid", 422);
  return JSON.stringify({ id: state.id, processing_status: state.processing_status, request_counts: state.request_counts,
    ended_at: state.ended_at, results_url: state.results_url });
};

/** Revalidate the immutable stored manifest before it crosses the DB→Worker seam. */
export function validateSignalWorkspaceInterestDecisionBatchManifestV1(value: unknown, expectedBody: string,
  expectedDigest: string): Manifest {
  const raw = parseJson(value, "manifest_invalid");
  if (raw.contract_version !== "signal-workspace-interest-decision-page-manifest-v1" || !Array.isArray(raw.requests)
    || !Array.isArray(raw.expected_root_ids) || !isRecord(raw.configuration)
    || typeof raw.page_digest !== "string" || typeof raw.manifest_digest !== "string") return fail("manifest_invalid", 503);
  const manifest = raw as unknown as Manifest;
  if (!manifest.requests.length) return fail("manifest_invalid", 503);
  const { manifest_digest: _digest, ...core } = manifest;
  if (manifest.manifest_digest !== jsonDigest(core) || sha(expectedBody) !== expectedDigest) return fail("manifest_digest_invalid", 503);
  let roots: string[] = [];
  for (const item of manifest.requests) {
    if (!item || item.contract_version !== "signal-workspace-interest-decision-batch-request-v1"
      || !Array.isArray(item.root_ids) || !isRecord(item.request) || !isRecord(item.provider_request)
      || typeof item.provider_request.custom_id !== "string" || !isRecord(item.provider_request.params)
      || typeof item.provider_request_digest !== "string" || !Number.isSafeInteger(item.provider_request_bytes)
      || item.provider_request_bytes !== bytes(item.provider_request)) return fail("manifest_request_invalid", 503);
    const { request_digest: _requestDigest, ...requestBody } = item.request;
    let rebuilt: unknown;
    try { rebuilt = buildSignalWorkspaceInterestDecisionRequestV1(requestBody as never); }
    catch { return fail("manifest_request_invalid", 503); }
    if ((rebuilt as { request_digest?: unknown }).request_digest !== item.request.request_digest
      || jsonDigest({ request_digest: item.request.request_digest, configuration: manifest.configuration,
        params: item.provider_request.params }) !== item.provider_request_digest
      || item.provider_request.custom_id !== `id1_${item.provider_request_digest.slice(7, 67)}`
      || jsonDigest(item.root_ids) !== jsonDigest((item.request.roots as Array<{ root_id: string }>).map(root => root.root_id)))
      return fail("manifest_request_digest_invalid", 503);
    roots = roots.concat(item.root_ids);
  }
  const expected = manifest.expected_root_ids;
  const first = manifest.requests[0]!.request;
  if (typeof first.workspace_id !== "string" || typeof first.context_digest !== "string"
    || typeof first.decision_policy_digest !== "string" || !isRecord(first.interest) || !Array.isArray(first.roots)
    || manifest.page_digest !== jsonDigest({ contract_version: "signal-workspace-interest-decision-v1",
      workspace_id: first.workspace_id, context_digest: first.context_digest,
      decision_policy_digest: first.decision_policy_digest, interest: first.interest,
      roots: manifest.requests.flatMap(item => item.request.roots as unknown[]) })) return fail("manifest_page_digest_invalid", 503);
  let bodyValue: unknown;
  try { bodyValue = JSON.parse(expectedBody); } catch { return fail("manifest_body_invalid", 503); }
  if (roots.length !== expected.length || roots.some((id, index) => id !== expected[index])
    || new Set(expected).size !== expected.length || !isRecord(bodyValue) || !Array.isArray(bodyValue.requests)
    || jsonDigest({ requests: manifest.requests.map(x => x.provider_request) }) !== jsonDigest(bodyValue))
    return fail("manifest_coverage_invalid", 503);
  return manifest;
}

async function inTransaction<T>(database: Database, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database.connect();
  try { await client.query("BEGIN"); await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    const result = await work(client); await client.query("COMMIT"); return result;
  } catch (error) { try { await client.query("ROLLBACK"); } catch { /* retain the original failure */ } throw error; }
  finally { client.release(); }
}

/** SQL owns policy, reservations, leases, settlement and replay. Raw result bytes are
 * stored before the DB settlement routine is called. The caller supplies the existing
 * workspace-engine object store; no parallel storage namespace is introduced. */
export function createSignalWorkspaceInterestDecisionBatchStoresV1(args: { database: Database; storeRawReceipt: RawReceiptStorage }) {
  const terminalLeases = new WeakSet<object>();
  const checkLease = (lease: SignalWorkspaceInterestDecisionBatchLeaseV1) => {
    if (!uuid.test(lease.batch_id) || !uuid.test(lease.lease_token)) fail("lease_invalid");
  };
  const withLease = <T>(lease: SignalWorkspaceInterestDecisionBatchLeaseV1, fn: (client: PoolClient) => Promise<T>) => {
    checkLease(lease); return inTransaction(args.database, fn);
  };
  return {
    async prepareBatch(input: { owner_id: string; page_id: string; request_digests: string[]; submission_key: string }) {
      if (![input.owner_id, input.page_id].every(value => uuid.test(value)) || !input.request_digests.length
        || input.request_digests.length > 64 || input.request_digests.some(value => !/^sha256:[0-9a-f]{64}$/u.test(value)))
        fail("prepare_invalid", 422);
      return inTransaction(args.database, async client => {
        const result = (await client.query<{ result: unknown }>(`SELECT prepare_signal_interest_decision_batch_v1(
          $1::uuid,$2::uuid,$3::text[],$4::text) AS result`,
          [input.owner_id,input.page_id,input.request_digests,input.submission_key])).rows[0]?.result;
        const row = parseJson(result, "prepare_result_invalid");
        if (!uuid.test(String(row.batch_id)) || typeof row.manifest_digest !== "string"
          || !/^sha256:[0-9a-f]{64}$/u.test(row.manifest_digest) || typeof row.replayed !== "boolean")
          fail("prepare_result_invalid", 503);
        return { batch_id: String(row.batch_id), manifest_digest: row.manifest_digest, replayed: row.replayed };
      });
    },
    async claimDue(batch_id?: string) {
      if (batch_id !== undefined && !uuid.test(batch_id)) fail("batch_id_invalid", 422);
      return inTransaction(args.database, async client => {
        const result = (await client.query<{ lease: unknown }>(`SELECT claim_signal_interest_decision_batch_v1($1::uuid,120) AS lease`,[batch_id ?? null])).rows[0]?.lease;
        if (result === null || result === undefined) return null;
        const lease = parseJson(result, "lease_invalid");
        const id = String(lease.batch_id ?? ""), ownerId = String(lease.owner_id ?? ""), token = String(lease.lease_token ?? "");
        if (![id, ownerId, token].every(value => uuid.test(value)) || typeof lease.manifest_body !== "string"
          || typeof lease.manifest_digest !== "string" || !["prepared","submitting","submission_unknown","in_progress","canceling","ended"].includes(String(lease.state)))
          return fail("lease_invalid", 503);
        const page = (await client.query<{ manifest: unknown; workspace_id: string }>(`SELECT p.manifest,o.workspace_id::text
          FROM signal_interest_decision_batches_v1 b JOIN signal_interest_decision_pages_v1 p ON p.id=b.page_id
          JOIN signal_interest_decision_owners_v1 o ON o.id=b.owner_id WHERE b.id=$1::uuid AND b.owner_id=$2::uuid
            AND o.provider_contract_version=1
            AND NOT EXISTS (SELECT 1 FROM signal_interest_decision_requests_v1 r
              WHERE r.page_id=p.id AND r.provider_contract_version<>1)`,[id,ownerId])).rows[0];
        if (!page) return fail("lease_source_missing", 503);
        const manifest = validateSignalWorkspaceInterestDecisionBatchManifestV1(page.manifest, lease.manifest_body, lease.manifest_digest);
        return { batch_id: id, lease_token: token, state: lease.state as SignalWorkspaceInterestDecisionBatchLeaseV1["state"],
          provider_batch_id: typeof lease.provider_batch_id === "string" ? lease.provider_batch_id : null, manifest };
      });
    },
    async reserveAndMarkSubmitting(lease: SignalWorkspaceInterestDecisionBatchLeaseV1) {
      await withLease(lease, async client => { await client.query("SELECT mark_submitting_signal_interest_decision_batch_v1($1::uuid,$2::uuid)",[lease.batch_id,lease.lease_token]); });
    },
    async attachProviderBatch(lease: SignalWorkspaceInterestDecisionBatchLeaseV1, state: State) {
      const body = canonicalState(state);
      await withLease(lease, async client => { const result = (await client.query<{ result: unknown }>(`SELECT attach_provider_signal_interest_decision_batch_v1(
        $1::uuid,(SELECT submission_token FROM signal_interest_decision_batches_v1 WHERE id=$1::uuid),$2::text,$3::text) AS result`,
        [lease.batch_id,body,sha(body)])).rows[0]?.result; const row=parseJson(result,"attach_result_invalid");
        if (row.provider_batch_id !== state.id) fail("provider_receipt_mismatch",503); });
    },
    async markSubmissionUnknown(lease: SignalWorkspaceInterestDecisionBatchLeaseV1, code: string, acknowledged_state: State | null,
      receipt?: {http_status:number;raw_body:string;complete:boolean;provider_request_id:string|null}|null) {
      if (!acknowledged_state && !receipt) {
        const result=await withLease(lease, async client => parseJson((await client.query<{result:unknown}>(`SELECT quarantine_signal_interest_decision_batch_v1($1::uuid,$2::uuid,$3::text) result`,
          [lease.batch_id,lease.lease_token,code])).rows[0]?.result,"quarantine_result_invalid"));
        if (result.state!=="submission_unknown") fail("quarantine_result_invalid",503);
        terminalLeases.add(lease);
        return;
      }
      if (receipt && (!receipt.complete || typeof receipt.raw_body!=="string" || !receipt.raw_body
        || Buffer.byteLength(receipt.raw_body,"utf8")>8*1024*1024)) fail("submission_receipt_invalid",422);
      const body=receipt?.raw_body ?? (acknowledged_state ? canonicalState(acknowledged_state) : null);
      const rawBody=body ?? fail("submission_receipt_missing",422);
      const quarantined=await withLease(lease, async client => parseJson((await client.query<{result:unknown}>(`SELECT quarantine_signal_interest_decision_batch_v1($1::uuid,$2::uuid,$3::text,$4::text,$5::text) result`,
        [lease.batch_id,lease.lease_token,code,rawBody,sha(rawBody)])).rows[0]?.result,"quarantine_result_invalid"));
      if (quarantined.state!=="submission_unknown") fail("quarantine_result_invalid",503);
      terminalLeases.add(lease);
    },
    async markKnownRejection(lease: SignalWorkspaceInterestDecisionBatchLeaseV1, code: string, receipt: {http_status:number;raw_body:string;complete:boolean;provider_request_id:string|null}|null) {
      if (!receipt || !receipt.complete || ![400,401,403,404,413,422].includes(receipt.http_status)) return fail("known_rejection_receipt_required",422);
      const validReceipt=receipt;
      const digest=sha(validReceipt.raw_body);
      await withLease(lease, async client => {
        const result=parseJson((await client.query<{result:unknown}>(`SELECT reject_signal_interest_decision_batch_v1($1::uuid,$2::uuid,$3::int,$4::text,$5::text) result`,
          [lease.batch_id,lease.lease_token,validReceipt.http_status,validReceipt.raw_body,digest])).rows[0]?.result,"rejection_result_invalid");
        if (result.state!=="rejected") fail("rejection_result_invalid",503);
        terminalLeases.add(lease);
      }); void code;
    },
    async recordPoll(lease: SignalWorkspaceInterestDecisionBatchLeaseV1, state: State) {
      const body=canonicalState(state), next=new Date(Date.now()+60_000).toISOString();
      await withLease(lease, async client => { const row=parseJson((await client.query<{result:unknown}>(`SELECT poll_signal_interest_decision_batch_v1(
        $1::uuid,$2::uuid,$3::text,$4::text,$5::timestamptz) result`,[lease.batch_id,lease.lease_token,body,sha(body),next])).rows[0]?.result,"poll_result_invalid");
        if (row.provider_batch_id!==state.id || row.state!==state.processing_status) fail("poll_receipt_mismatch",503); });
    },
    async persistRawAndSettle(lease: SignalWorkspaceInterestDecisionBatchLeaseV1, result: {custom_id:string;raw_text:string;raw_sha256:string}) {
      if (sha(result.raw_text)!==result.raw_sha256) fail("raw_receipt_digest_invalid",422);
      checkLease(lease);
      const bound=lease.manifest.requests.find(request=>request.provider_request.custom_id===result.custom_id);
      if (!bound) fail("foreign_custom_id",422);
      // Resolve identity quickly, then release PG before the external object-store PUT.
      const call=await inTransaction(args.database, async client => (await client.query<{call_id:string;owner_id:string;workspace_id:string}>(`SELECT c.id::text call_id,c.owner_id::text,o.workspace_id::text
          FROM signal_interest_decision_calls_v1 c JOIN signal_interest_decision_requests_v1 r ON r.id=c.request_id
          JOIN signal_interest_decision_owners_v1 o ON o.id=c.owner_id WHERE c.batch_id=$1::uuid AND r.custom_id=$2::text`,
          [lease.batch_id,result.custom_id])).rows[0]);
      if (!call) return fail("call_binding_missing",503);
      const validCall=call;
      const storageKey=await args.storeRawReceipt({workspace_id:validCall.workspace_id,owner_id:validCall.owner_id,batch_id:lease.batch_id,
        call_id:validCall.call_id,raw_text:result.raw_text,raw_sha256:result.raw_sha256});
      const expected=`workspace-engine/${validCall.workspace_id}/${validCall.owner_id}/interest-decision-${lease.batch_id}-${validCall.call_id}.json.${result.raw_sha256.slice(7)}.parts.json`;
      if (storageKey!==expected) fail("raw_storage_key_invalid",422);
      // The SQL function revalidates batch, token, request binding and raw digest
      // after the object-store operation; content-addressing makes PUT replay safe.
      return withLease(lease, async client => {
        const row=parseJson((await client.query<{result:unknown}>(`SELECT persist_signal_interest_decision_item_v1(
          $1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text) result`,[lease.batch_id,lease.lease_token,result.custom_id,
          result.raw_text,result.raw_sha256,storageKey])).rows[0]?.result,"settlement_result_invalid");
        if (typeof row.call_id!=="string" || !["settled","outcome_unknown"].includes(String(row.status))) fail("settlement_result_invalid",503);
        return {raw_sha256:result.raw_sha256,settlement:row.status==="settled"?"settled" as const:"ambiguous" as const,replayed:row.replayed===true};
      });
    },
    async recordOutcome(lease: SignalWorkspaceInterestDecisionBatchLeaseV1, result: SignalWorkspaceInterestDecisionItemResultV1) {
      await withLease(lease, async client => {
        const call=(await client.query<{id:string;raw_sha256:string}>(`SELECT c.id::text,c.raw_sha256 FROM signal_interest_decision_calls_v1 c
          JOIN signal_interest_decision_requests_v1 r ON r.id=c.request_id WHERE c.batch_id=$1::uuid AND r.custom_id=$2::text`,
          [lease.batch_id,result.custom_id])).rows[0];
        if (!call) return fail("outcome_receipt_binding_invalid",409);
        if (call.raw_sha256!==result.raw_sha256) fail("outcome_receipt_binding_invalid",409);
        const validCall=call;
        const applied=parseJson((await client.query<{result:unknown}>(`SELECT apply_signal_interest_decision_item_v1($1::uuid) result`,[validCall.id])).rows[0]?.result,"outcome_result_invalid");
        const expected=result.status==="accepted"?"accepted":result.status==="provider_error"?"errored":result.status;
        if (applied.validation_status!==expected) fail("outcome_validation_mismatch",409);
      });
    },
    async finishImport(lease: SignalWorkspaceInterestDecisionBatchLeaseV1, result: {provider_state:State;received_custom_ids:string[];status:"ready_for_review"|"needs_recovery"}) {
      const canonical=canonicalState(result.provider_state);
      const expectedIds=lease.manifest.requests.map(request=>request.provider_request.custom_id).sort();
      const received=[...result.received_custom_ids].sort();
      if (result.provider_state.processing_status!=="ended" || result.provider_state.id!==lease.provider_batch_id
        || result.provider_state.request_counts.processing!==0 || new Set(received).size!==received.length
        || received.length!==expectedIds.length || received.some((id,index)=>id!==expectedIds[index])) fail("import_coverage_invalid",422);
      await withLease(lease, async client => {
        const resultRow=parseJson((await client.query<{result:unknown}>(`SELECT finish_signal_interest_decision_batch_v1($1::uuid,$2::uuid) result`,
          [lease.batch_id,lease.lease_token])).rows[0]?.result,"finish_result_invalid");
        if (resultRow.state!=="applied") fail("finish_result_invalid",503);
        terminalLeases.add(lease);
      }); void canonical;
    },
    async releaseLease(lease: SignalWorkspaceInterestDecisionBatchLeaseV1, result: {next_poll_at:string|null;error_code:string|null}) {
      if (terminalLeases.has(lease)) { terminalLeases.delete(lease); return; }
      await withLease(lease, async client => {
        if (result.next_poll_at!==null && (!Number.isFinite(Date.parse(result.next_poll_at)) || Date.parse(result.next_poll_at)<=Date.now()))
          fail("next_poll_invalid",422);
        const errorCode=result.error_code;
        const released=parseJson((await client.query<{result:unknown}>(`SELECT release_signal_interest_decision_batch_v1($1::uuid,$2::uuid,$3::timestamptz,$4::text) result`,
          [lease.batch_id,lease.lease_token,result.next_poll_at,errorCode])).rows[0]?.result,"release_result_invalid");
        if (released.batch_id!==lease.batch_id || released.next_poll_at!==result.next_poll_at) fail("release_result_invalid",503);
      });
    },
    async finishOwner(owner_id: string) {
      if (!uuid.test(owner_id)) fail("owner_id_invalid",422);
      return inTransaction(args.database, async client => {
        const row=parseJson((await client.query<{result:unknown}>(`SELECT finish_signal_interest_decision_v1($1::uuid) result`,[owner_id])).rows[0]?.result,"owner_finish_invalid");
        if (row.owner_id!==owner_id || row.completed!==true) fail("owner_finish_invalid",503);
        return row;
      });
    },
  };
}
