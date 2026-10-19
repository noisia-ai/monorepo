import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  readSignalWorkspaceInterestDecisionSourcePageV1,
  buildSignalWorkspaceInterestDecisionRequestFromSourcePageV1,
  type SignalWorkspaceInterestDecisionSourcePageV1,
} from "@noisia/db";
import { signalWorkspaceEmbeddingDigestV1 } from "@noisia/query-engine";
import {
  buildSignalWorkspaceInterestDecisionPageManifestV1,
  type SignalWorkspaceInterestDecisionPageManifestV1,
} from "./signal-workspace-interest-decision-batch-v1";

type Database = Pick<Pool, "connect">;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const digest = /^sha256:[0-9a-f]{64}$/u;
const fail = (code: string): never => { throw new Error(`workspace_interest_preparation_${code}`); };

type Owner = {
  id: string; workspace_id: string; actor_user_id: string; generation_id: string;
  source_execution_id: string; taxonomy_term_id: string; term_key: string;
  definition_digest: string; source_input_digest: string; source_input_revision: string;
  source_context_digest: string; decision_policy_digest: string; expected_roots: number;
  manifest_roots: number; cursor_root_id: string | null; manifest_complete: boolean;
  status: string;
};
type Page = { page_id: string; request_digests: string[] };

/** The digest helper hashes this exact recursively ordered JSON representation.
 * Provider bytes are separate: the batch builder measures their insertion-order JSON. */
export function canonicalSignalInterestDecisionJsonV1(value: unknown): string {
  function ordered(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(ordered);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, ordered(child)]));
    return item;
  }
  return JSON.stringify(ordered(value));
}

export function sealSignalWorkspaceInterestDecisionSourcePageV1(args: {
  page: SignalWorkspaceInterestDecisionSourcePageV1; decision_policy_digest: string;
}): { manifest: SignalWorkspaceInterestDecisionPageManifestV1; canonical_manifest_body: string;
  canonical_page_body: string; request_bodies: Array<{ request_body: string; interest_body: string;
    provider_core_body: string; provider_body: string }> } {
  const page = buildSignalWorkspaceInterestDecisionRequestFromSourcePageV1(args.page, args.decision_policy_digest);
  const { request_digest: _requestDigest, ...pageBody } = page;
  const manifest = buildSignalWorkspaceInterestDecisionPageManifestV1({ page: pageBody,
    expected_root_ids: args.page.roots.map(root => root.root_id) });
  const { manifest_digest: _manifestDigest, ...manifestBody } = manifest;
  const canonical_page_body = canonicalSignalInterestDecisionJsonV1(pageBody);
  const canonical_manifest_body = canonicalSignalInterestDecisionJsonV1(manifestBody);
  const request_bodies = manifest.requests.map(item => {
    const { request_digest: _digest, ...requestBody } = item.request;
    return {
      request_body: canonicalSignalInterestDecisionJsonV1(requestBody),
      interest_body: canonicalSignalInterestDecisionJsonV1(item.request.interest),
      provider_core_body: canonicalSignalInterestDecisionJsonV1({
        request_digest: item.request.request_digest, configuration: manifest.configuration,
        params: item.provider_request.params,
      }),
      provider_body: JSON.stringify(item.provider_request),
    };
  });
  if (signalWorkspaceEmbeddingDigestV1(JSON.parse(canonical_page_body)) !== manifest.page_digest
    || signalWorkspaceEmbeddingDigestV1(JSON.parse(canonical_manifest_body)) !== manifest.manifest_digest
    || request_bodies.some((body, index) => {
      const item = manifest.requests[index]!;
      return signalWorkspaceEmbeddingDigestV1(JSON.parse(body.request_body)) !== item.request.request_digest
        || signalWorkspaceEmbeddingDigestV1(JSON.parse(body.provider_core_body)) !== item.provider_request_digest
        || Buffer.byteLength(body.provider_body, "utf8") !== item.provider_request_bytes;
    })) fail("canonical_body_mismatch");
  return { manifest, canonical_manifest_body, canonical_page_body, request_bodies };
}

export type SignalWorkspaceInterestDecisionPreparationStoresV1 = {
  readOwner(): Promise<Owner>;
  readSource(after_root_id: string | null, term_key: string): Promise<SignalWorkspaceInterestDecisionSourcePageV1>;
  appendPage(sealed: ReturnType<typeof sealSignalWorkspaceInterestDecisionSourcePageV1>):
    Promise<{ page_id: string; root_count: number; manifest_complete: boolean }>;
  listPages(): Promise<Page[]>;
  prepareBatch(page: Page): Promise<{ batch_id: string; replayed: boolean }>;
};

/** Resume from the durable owner cursor. SQL locks the owner and checks the exact
 * next keyset page, so an uncertain append can safely be retried by rerunning this. */
export async function prepareSignalWorkspaceInterestDecisionPagesV1(args: {
  stores: SignalWorkspaceInterestDecisionPreparationStoresV1;
  owner_id: string; workspace_id: string; actor_user_id: string;
  generation_id: string; source_execution_id: string;
  max_pages?: number; max_batches?: number;
}): Promise<{ owner_id: string; manifest_roots: number; page_count: number; batch_ids: string[];
  phase: "sealing" | "preparing" | "complete" }> {
  if (![args.owner_id, args.workspace_id, args.actor_user_id, args.generation_id, args.source_execution_id]
    .every(value => uuid.test(value))) fail("identity_invalid");
  const maxPages = args.max_pages ?? Number.MAX_SAFE_INTEGER;
  const maxBatches = args.max_batches ?? Number.MAX_SAFE_INTEGER;
  if (![maxPages, maxBatches].every(value => Number.isSafeInteger(value) && value >= 1)) fail("limit_invalid");
  let previousRoots = -1;
  let pageCount = 0;
  for (;;) {
    const owner = await args.stores.readOwner();
    if (owner.id !== args.owner_id || owner.workspace_id !== args.workspace_id
      || owner.actor_user_id !== args.actor_user_id || owner.generation_id !== args.generation_id
      || owner.source_execution_id !== args.source_execution_id || !digest.test(owner.decision_policy_digest)
      || !Number.isSafeInteger(owner.expected_roots) || owner.expected_roots < 1
      || !Number.isSafeInteger(owner.manifest_roots) || owner.manifest_roots < 0
      || owner.manifest_roots > owner.expected_roots || owner.manifest_roots < previousRoots
      || owner.manifest_complete !== (owner.manifest_roots === owner.expected_roots)
      || (owner.manifest_roots === 0) !== (owner.cursor_root_id === null)) fail("owner_invalid");
    if (owner.manifest_complete) {
      if (owner.status !== "ready") fail("owner_not_ready");
      const pages = await args.stores.listPages();
      if (pages.some(page => !uuid.test(page.page_id) || !page.request_digests.length
        || page.request_digests.length > 64 || page.request_digests.some(value => !digest.test(value))))
        fail("sealed_pages_invalid");
      const hasMore = pages.length > maxBatches;
      const batch_ids: string[] = [];
      for (const page of pages.slice(0, maxBatches)) {
        const batch = await args.stores.prepareBatch(page);
        if (!uuid.test(batch.batch_id)) fail("prepared_batch_invalid");
        batch_ids.push(batch.batch_id);
      }
      return { owner_id: owner.id, manifest_roots: owner.manifest_roots,
        page_count: pageCount, batch_ids,
        phase: hasMore ? "preparing" : "complete" };
    }
    if (owner.status !== "open") fail("owner_not_open");
    const source = await args.stores.readSource(owner.cursor_root_id, owner.term_key);
    if (source.source.workspace_id !== owner.workspace_id || source.source.execution_id !== owner.source_execution_id
      || source.source.input_digest !== owner.source_input_digest
      || source.source.input_revision !== owner.source_input_revision
      || source.source.context_digest !== owner.source_context_digest
      || source.interest.taxonomy_term_id !== owner.taxonomy_term_id
      || source.interest.definition.term_key !== owner.term_key
      || source.interest.definition.definition_digest !== owner.definition_digest
      || !source.roots.length || source.roots.length > 64
      || source.roots[0]!.root_id <= (owner.cursor_root_id ?? "")
      || source.roots.some((root, index) => index > 0 && root.root_id <= source.roots[index - 1]!.root_id)
      || owner.manifest_roots + source.roots.length > owner.expected_roots
      || (source.done && owner.manifest_roots + source.roots.length !== owner.expected_roots)
      || (source.done && source.next_root_id !== null)
      || (!source.done && source.roots.length !== 64)
      || (!source.done && source.next_root_id !== source.roots.at(-1)!.root_id)) fail("source_page_mismatch");
    const sealed = sealSignalWorkspaceInterestDecisionSourcePageV1({ page: source,
      decision_policy_digest: owner.decision_policy_digest });
    const appended = await args.stores.appendPage(sealed);
    if (!uuid.test(appended.page_id) || appended.root_count !== source.roots.length
      || appended.manifest_complete !== (owner.manifest_roots + source.roots.length === owner.expected_roots))
      fail("append_receipt_invalid");
    previousRoots = owner.manifest_roots + source.roots.length;
    pageCount++;
    if (pageCount === maxPages) return { owner_id: owner.id, manifest_roots: previousRoots,
      page_count: pageCount, batch_ids: [], phase: "sealing" };
  }
}

async function query<T extends QueryResultRow>(database: Database, statement: string, params: unknown[]): Promise<T[]> {
  const client: PoolClient = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    const rows = (await client.query<T>(statement, params)).rows;
    await client.query("COMMIT");
    return rows;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

/** SQL0211 owns page CAS, policy, admission, cap, reservation and replay. */
export function createSignalWorkspaceInterestDecisionPreparationStoresV1(args: {
  database: Database; owner_id: string; workspace_id: string; actor_user_id: string;
  source_execution_id: string;
}): SignalWorkspaceInterestDecisionPreparationStoresV1 {
  return {
    async readOwner() {
      const rows = await query<Owner>(args.database, `SELECT o.id::text,o.workspace_id::text,
        o.actor_user_id::text,o.generation_id::text,o.source_execution_id::text,
        o.taxonomy_term_id::text,o.term_key,o.definition_digest,o.source_input_digest,
        o.source_input_revision::text,o.source_context_digest,o.expected_roots,o.manifest_roots,
        o.cursor_root_id::text,o.manifest_complete,o.status,
        g.input_snapshot->'identity'->>'decision_policy_digest' decision_policy_digest
        FROM signal_interest_decision_owners_v1 o
        JOIN signal_classification_generations g ON g.id=o.generation_id
        WHERE o.id=$1::uuid AND o.provider_contract_version=1`, [args.owner_id]);
      return rows[0] ?? fail("owner_missing");
    },
    readSource(after_root_id, term_key) {
      return readSignalWorkspaceInterestDecisionSourcePageV1({ database: args.database,
        workspace_id: args.workspace_id, actor_user_id: args.actor_user_id,
        execution_id: args.source_execution_id, term_key, after_root_id, limit: 64 });
    },
    async appendPage(sealed) {
      const rows = await query<{ result: { page_id: string; root_count: number; manifest_complete: boolean } }>(
        args.database, `SELECT append_signal_interest_decision_page_v1($1::uuid,$2::jsonb,$3::text,$4::text,$5::jsonb) result`,
        [args.owner_id, JSON.stringify(sealed.manifest), sealed.canonical_manifest_body,
          sealed.canonical_page_body, JSON.stringify(sealed.request_bodies)]);
      return rows[0]?.result ?? fail("append_receipt_missing");
    },
    async listPages() {
      const rows = await query<{ page_id: string; request_digests: string[] }>(args.database,
        `SELECT p.id::text page_id,array_agg(r.request_digest ORDER BY r.request_index) request_digests
         FROM signal_interest_decision_pages_v1 p
         JOIN signal_interest_decision_requests_v1 r ON r.page_id=p.id AND r.owner_id=p.owner_id
         WHERE p.owner_id=$1::uuid AND NOT EXISTS (
           SELECT 1 FROM signal_interest_decision_batches_v1 b
           WHERE b.owner_id=p.owner_id AND b.page_id=p.id
             AND b.submission_key='interest-decision-page:'||p.id::text)
         GROUP BY p.id,p.page_index ORDER BY p.page_index`, [args.owner_id]);
      return rows;
    },
    async prepareBatch(page) {
      // A source owner may span budget days. Renew only when there is a page
      // needing paid preparation; SQL reuses today's admission and checks the
      // active policy, source and original owner cap before creating a new one.
      const renewal = await query<{ result: { admission_id: string; budget_date: string;
        replayed: boolean } }>(args.database,
        `SELECT renew_signal_interest_decision_admission_v1($1::uuid,$2::uuid) result`,
        [args.owner_id, args.actor_user_id]);
      if (!uuid.test(renewal[0]?.result?.admission_id ?? "")
        || !/^\d{4}-\d{2}-\d{2}$/u.test(renewal[0]?.result?.budget_date ?? "")
        || typeof renewal[0]?.result?.replayed !== "boolean") fail("admission_renewal_invalid");
      const rows = await query<{ result: { batch_id: string; replayed: boolean } }>(args.database,
        `SELECT prepare_signal_interest_decision_batch_v1($1::uuid,$2::uuid,$3::text[],$4::text) result`,
        [args.owner_id, page.page_id, page.request_digests, `interest-decision-page:${page.page_id}`]);
      return rows[0]?.result ?? fail("prepare_receipt_missing");
    },
  };
}

export function prepareSignalWorkspaceInterestDecisionWithDatabaseV1(args: {
  database: Database; owner_id: string; workspace_id: string; actor_user_id: string;
  generation_id: string; source_execution_id: string; max_pages?: number; max_batches?: number;
}) {
  return prepareSignalWorkspaceInterestDecisionPagesV1({ ...args,
    stores: createSignalWorkspaceInterestDecisionPreparationStoresV1(args) });
}
