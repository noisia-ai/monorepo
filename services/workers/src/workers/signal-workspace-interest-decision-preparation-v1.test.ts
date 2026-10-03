import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { signalWorkspaceEmbeddingDigestV1, type SignalTopicDefinitionV1 } from "@noisia/query-engine";
import type { SignalWorkspaceInterestDecisionSourcePageV1 } from "@noisia/db";
import {
  canonicalSignalInterestDecisionJsonV1,
  prepareSignalWorkspaceInterestDecisionPagesV1,
  sealSignalWorkspaceInterestDecisionSourcePageV1,
  type SignalWorkspaceInterestDecisionPreparationStoresV1,
} from "./signal-workspace-interest-decision-preparation-v1";

const sha = (value: string) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const identity = { owner_id: randomUUID(), workspace_id: randomUUID(), actor_user_id: randomUUID(),
  generation_id: randomUUID(), source_execution_id: randomUUID() };
const definition: SignalTopicDefinitionV1 = { term_key: "alexa_consent", label: "Consentimiento Alexa+",
  definition: "Activación de Alexa+ y consentimiento de la persona", scope: "all_conversations",
  inclusion: ["Activación sin permiso"], exclusion: ["Clima"], positive_examples: [], negative_examples: [],
  lifecycle: "draft", origin: "manual", source: null, definition_revision: 1,
  definition_digest: sha("definition"), created_at: "2026-10-02T00:00:00.000Z",
  updated_at: "2026-10-02T00:00:00.000Z" };
const topicId = randomUUID();
const policy = sha("decision policy");
const source = { workspace_id: identity.workspace_id, execution_id: identity.source_execution_id,
  input_digest: sha("input"), input_revision: randomUUID(), taxonomy_profile_id: randomUUID(),
  preparation_run_id: randomUUID(), embedding_run_id: randomUUID(), embedding_config_digest: sha("embedding"),
  context_digest: sha("context"), definition_digest: sha("all definitions"), correction_digest: sha("correction"),
  current: true as const };
const root = (id: string, text: string) => ({ root_id: id, root_fingerprint: sha(`fingerprint:${id}`),
  root_correction_digest: sha(`correction:${id}`), asset_sha256: sha(text), full_text: text,
  chunks: [{ chunk_index: 0, start: 0, end: text.length, chunk_sha256: sha(text), text }],
  chunk_coverage_digest: sha(`coverage:${id}`), suggestion: null, suggestion_state: "not_retained" as const });
const page = (roots: ReturnType<typeof root>[], done = true): SignalWorkspaceInterestDecisionSourcePageV1 => ({
  contract_version: "workspace-interest-decision-source-v1", source,
  interest: { taxonomy_term_id: topicId, definition, compiler_digest: sha("compiler") },
  roots, next_root_id: done ? null : roots.at(-1)!.root_id, done,
});
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const owner = (manifest_roots: number, expected_roots: number) => ({ id: identity.owner_id,
  workspace_id: identity.workspace_id, actor_user_id: identity.actor_user_id,
  generation_id: identity.generation_id, source_execution_id: identity.source_execution_id,
  taxonomy_term_id: topicId, term_key: definition.term_key, definition_digest: definition.definition_digest,
  source_input_digest: source.input_digest, source_input_revision: source.input_revision,
  source_context_digest: source.context_digest, decision_policy_digest: policy,
  expected_roots, manifest_roots, cursor_root_id: manifest_roots ? id(manifest_roots) : null,
  manifest_complete: manifest_roots === expected_roots, status: manifest_roots === expected_roots ? "ready" : "open" });

test("SQL0211 canonical bodies bind full root text, page, requests and exact provider bytes", () => {
  const sealed = sealSignalWorkspaceInterestDecisionSourcePageV1({
    page: page([root(id(1), "Alexa+ se activó; yo no acepté 😀.")]), decision_policy_digest: policy });
  assert.equal(signalWorkspaceEmbeddingDigestV1(JSON.parse(sealed.canonical_manifest_body)), sealed.manifest.manifest_digest);
  assert.equal(signalWorkspaceEmbeddingDigestV1(JSON.parse(sealed.canonical_page_body)), sealed.manifest.page_digest);
  assert.equal(sealed.canonical_manifest_body, canonicalSignalInterestDecisionJsonV1((({ manifest_digest: _digest, ...body }) => body)(sealed.manifest)));
  const item = sealed.manifest.requests[0]!;
  const body = sealed.request_bodies[0]!;
  assert.equal(signalWorkspaceEmbeddingDigestV1(JSON.parse(body.request_body)), item.request.request_digest);
  assert.equal(signalWorkspaceEmbeddingDigestV1(JSON.parse(body.provider_core_body)), item.provider_request_digest);
  assert.equal(signalWorkspaceEmbeddingDigestV1(JSON.parse(body.interest_body)), signalWorkspaceEmbeddingDigestV1(item.request.interest));
  assert.equal(body.provider_body, JSON.stringify(item.provider_request));
  assert.equal(Buffer.byteLength(body.provider_body, "utf8"), item.provider_request_bytes);
  assert.match(body.provider_body, /Alexa\+ se activó/u);
});

test("seals all keyset pages before preparing any batch and replays from the durable cursor", async () => {
  const roots = Array.from({ length: 65 }, (_, index) => root(id(index + 1), `Texto ${index + 1}`));
  let manifestRoots = 0;
  let phase: "sealing" | "preparing" = "sealing";
  const pages: Array<{ page_id: string; request_digests: string[] }> = [];
  const prepared: string[] = [];
  const stores: SignalWorkspaceInterestDecisionPreparationStoresV1 = {
    readOwner: async () => owner(manifestRoots, roots.length),
    readSource: async (cursor, term_key) => {
      assert.equal(cursor, manifestRoots ? id(manifestRoots) : null);
      assert.equal(term_key, definition.term_key);
      const selected = roots.slice(manifestRoots, manifestRoots + 64);
      return page(selected, manifestRoots + selected.length === roots.length);
    },
    appendPage: async sealed => {
      assert.equal(phase, "sealing");
      assert.deepEqual(sealed.manifest.expected_root_ids,
        roots.slice(manifestRoots, manifestRoots + 64).map(item => item.root_id));
      manifestRoots += sealed.manifest.expected_root_ids.length;
      pages.push({ page_id: randomUUID(), request_digests: sealed.manifest.requests.map(item => item.request.request_digest) });
      return { page_id: pages.at(-1)!.page_id, root_count: sealed.manifest.expected_root_ids.length,
        manifest_complete: manifestRoots === roots.length };
    },
    listPages: async () => { assert.equal(manifestRoots, 65); phase = "preparing"; return pages; },
    prepareBatch: async item => { assert.equal(phase, "preparing"); prepared.push(item.page_id);
      return { batch_id: randomUUID(), replayed: false }; },
  };
  const result = await prepareSignalWorkspaceInterestDecisionPagesV1({ ...identity, stores });
  assert.equal(result.manifest_roots, 65);
  assert.equal(result.page_count, 2);
  assert.deepEqual(prepared, pages.map(item => item.page_id));
  const replay = await prepareSignalWorkspaceInterestDecisionPagesV1({ ...identity, stores });
  assert.equal(replay.batch_ids.length, 2);
  assert.equal(manifestRoots, 65);
});

test("a stale source page aborts before append or paid batch preparation", async () => {
  let appended = 0, prepared = 0;
  const stores: SignalWorkspaceInterestDecisionPreparationStoresV1 = {
    readOwner: async () => owner(0, 1),
    readSource: async () => ({ ...page([root(id(1), "Texto")]), source: { ...source, input_digest: sha("changed") } }),
    appendPage: async () => { appended++; throw new Error("unexpected append"); },
    listPages: async () => [],
    prepareBatch: async () => { prepared++; throw new Error("unexpected prepare"); },
  };
  await assert.rejects(prepareSignalWorkspaceInterestDecisionPagesV1({ ...identity, stores }),
    /workspace_interest_preparation_source_page_mismatch/u);
  assert.equal(appended, 0);
  assert.equal(prepared, 0);
});

test("bounded ticks resume sealing and then prepare one unprepared page", async () => {
  const roots = Array.from({ length: 65 }, (_, index) => root(id(index + 1), `Texto ${index + 1}`));
  let sealedRoots = 0, prepareCalls = 0;
  const pending: Array<{ page_id: string; request_digests: string[] }> = [];
  const stores: SignalWorkspaceInterestDecisionPreparationStoresV1 = {
    readOwner: async () => owner(sealedRoots, roots.length),
    readSource: async cursor => {
      assert.equal(cursor, sealedRoots ? id(sealedRoots) : null);
      const selected = roots.slice(sealedRoots, sealedRoots + 64);
      return page(selected, sealedRoots + selected.length === roots.length);
    },
    appendPage: async sealed => {
      sealedRoots += sealed.manifest.expected_root_ids.length;
      pending.push({ page_id: randomUUID(), request_digests: sealed.manifest.requests.map(item => item.request.request_digest) });
      return { page_id: pending.at(-1)!.page_id, root_count: sealed.manifest.expected_root_ids.length,
        manifest_complete: sealedRoots === roots.length };
    },
    listPages: async () => pending,
    prepareBatch: async item => { prepareCalls++; pending.splice(pending.indexOf(item), 1);
      return { batch_id: randomUUID(), replayed: false }; },
  };
  const tick = () => prepareSignalWorkspaceInterestDecisionPagesV1({ ...identity, stores,
    max_pages: 1, max_batches: 1 });
  assert.equal((await tick()).phase, "sealing");
  assert.equal(sealedRoots, 64);
  assert.equal(prepareCalls, 0);
  assert.equal((await tick()).phase, "sealing");
  assert.equal(sealedRoots, 65);
  assert.equal(prepareCalls, 0);
  assert.equal((await tick()).phase, "preparing");
  assert.equal(prepareCalls, 1);
  assert.equal((await tick()).phase, "complete");
  assert.equal(prepareCalls, 2);
  assert.equal((await tick()).phase, "complete");
  assert.equal(prepareCalls, 2);
});
