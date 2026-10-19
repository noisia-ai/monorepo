import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { buildSignalWorkspaceInterestDecisionRequestV1,
  signalWorkspaceEmbeddingDigestV1,
  type SignalWorkspaceClassificationIdentityV1 } from "@noisia/query-engine";
import type { SignalWorkspaceClassificationDatabaseV1,
  SignalWorkspaceClassificationLeaseV1,
  SignalWorkspaceClassificationPageV1 } from "@noisia/db";
import { buildSignalWorkspaceInterestDecisionPageManifestV2 } from "./signal-workspace-interest-decision-batch-v2";
import { materializeSignalWorkspaceInterestDecisionV2 } from "./signal-workspace-interest-decision-materialization-v2";

const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const text = "Alexa+ se activó sin mi permiso.";
const compiler = sha("compiler");
const interest = { taxonomy_term_id: randomUUID(), term_key: "unrequested_activation",
  definition_revision: 1, definition_digest: sha("definition"), definition: "Activación no solicitada",
  inclusion: ["Sin permiso"], exclusion: ["Con consentimiento"] };
const root = { root_id: randomUUID(), fingerprint: sha("fingerprint"), correction_digest: sha("correction"),
  asset_sha256: sha(text), chunks: [{ chunk_index: 0, start: 0, end: text.length,
    chunk_sha256: sha(text), text }] };
const request = buildSignalWorkspaceInterestDecisionRequestV1({
  contract_version: "signal-workspace-interest-decision-v1", workspace_id: randomUUID(),
  context_digest: sha("context"), decision_policy_digest: sha("policy"), interest, roots: [root],
});
const { request_digest: _requestDigest, ...requestBody } = request;
const manifest = buildSignalWorkspaceInterestDecisionPageManifestV2({ page: requestBody,
  expected_root_ids: [root.root_id] });
const provider = manifest.requests[0]!;
const identity: SignalWorkspaceClassificationIdentityV1 = {
  contract_version: "signal-workspace-classification-v1", workspace_id: request.workspace_id,
  engine_key: "interest_decision", engine_version: 2, engine_artifact_digest: sha("engine"),
  embedding_config_digest: sha("embedding"),
  catalog_digest: signalWorkspaceEmbeddingDigestV1([{ term_key: interest.term_key,
    definition_digest: interest.definition_digest, definition_revision: interest.definition_revision }]),
  compiler_digest: signalWorkspaceEmbeddingDigestV1([{ term_key: interest.term_key, compiler_digest: compiler }]),
  context_digest: request.context_digest, decision_policy_digest: request.decision_policy_digest,
};
const output = { contract_version: "signal-workspace-interest-decision-provider-output-v2",
  decisions: [{ root_ordinal: 0, verdict: "belongs", rationale: "Sin permiso explícito.",
    citations: [{ span_id: "r0c0s0", role: "supports" }] }] };
const outputText = JSON.stringify(output);
const rawBody = JSON.stringify({ custom_id: provider.provider_request.custom_id,
  result: { type: "succeeded", message: { id: "msg_test", type: "message", role: "assistant",
    model: "claude-sonnet-4-6", stop_reason: "end_turn", content: [{ type: "text", text: outputText }],
    usage: { input_tokens: 100, output_tokens: 40 } } } });
const evidenceId = randomUUID(), requestId = randomUUID(), callId = randomUUID();
const ownerId = randomUUID(), generationId = randomUUID(), executionId = randomUUID();
const lease: SignalWorkspaceClassificationLeaseV1 = { execution_id: executionId,
  workspace_id: request.workspace_id, execution_token: randomUUID(), cursor_root_id: null,
  input_digest: sha("input"), identity };
const coverage = sha(JSON.stringify([0,0,text.length,sha(text)]) + "\n");
const page: SignalWorkspaceClassificationPageV1 = { items: [{ root: {
  root_id: root.root_id, fingerprint: root.fingerprint, correction_digest: root.correction_digest,
  asset_sha256: root.asset_sha256, expected_chunks: 1, chunk_coverage_digest: coverage,
  reuse_item_id: randomUUID(),
}, corrections: [] }], done: true };

function fixture(options: { raw_body?: string; citations?: unknown; provider_request?: unknown } = {}) {
  let commits = 0, finishes = 0;
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const db = { query: async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    if (sql.includes("FROM signal_topic_catalog_executions execution")) return { rows: [{
      owner_id: ownerId, generation_id: generationId, taxonomy_profile_id: randomUUID(),
      compiler_digest: compiler, expected_roots: 1, term_key: interest.term_key,
      taxonomy_term_id: interest.taxonomy_term_id, definition_digest: interest.definition_digest }] };
    if (sql.includes("FROM tagging_model_versions model")) return { rows: [{
      model_version_id: randomUUID(), approval_policy_id: randomUUID() }] };
    if (sql.includes("SELECT DISTINCT ON (request.id)")) return { rows: [{ request_id: requestId,
      call_id: callId, request, request_digest: request.request_digest,
      custom_id: provider.provider_request.custom_id,
      provider_request: options.provider_request ?? provider.provider_request,
      provider_request_digest: provider.provider_request_digest,
      raw_body: options.raw_body ?? rawBody, raw_sha256: sha(rawBody),
      output_text: outputText, output_digest: sha(outputText) }] };
    if (sql.includes("FROM signal_interest_decision_root_evidence_v1 evidence")) return { rows: [{
      id: evidenceId, request_id: requestId, call_id: callId, root_id: root.root_id,
      term_key: interest.term_key, taxonomy_term_id: interest.taxonomy_term_id,
      root_fingerprint: root.fingerprint, asset_sha256: root.asset_sha256,
      verdict: "belongs", rationale: output.decisions[0]!.rationale,
      citations: options.citations ?? [{ chunk_index: 0, chunk_sha256: sha(text),
        quote_start: 0, quote_end: text.length, quote: text, role: "supports" }],
      output_digest: sha(outputText), decision_digest: sha("sealed SQL decision digest") }] };
    throw new Error(`unexpected query ${sql}`);
  } } as unknown as SignalWorkspaceClassificationDatabaseV1;
  const stores = { claim: async () => lease, readPage: async () => page,
    commitPage: async ({ outcomes }: { outcomes: unknown[] }) => {
      commits++; assert.equal(outcomes.length, 1); return { ...lease, cursor_root_id: root.root_id };
    }, finish: async () => { finishes++; return { generation_id: generationId, complete_usable: true }; },
  } as unknown as NonNullable<Parameters<typeof materializeSignalWorkspaceInterestDecisionV2>[0]["stores"]>;
  return { db, stores, queries, counts: () => ({ commits, finishes }) };
}

test("V2 raw receipt and SQL-derived citation commit the same generation page", async () => {
  const h = fixture();
  let saved: unknown;
  const stores = { ...h.stores, commitPage: async (args: Parameters<typeof h.stores.commitPage>[0]) => {
    saved = args.outcomes[0]; return h.stores.commitPage(args);
  } };
  assert.deepEqual(await materializeSignalWorkspaceInterestDecisionV2({ database: h.db,
    execution_id: executionId, worker_job_id: `workspace-classification-${executionId}`, stores }),
  { generation_id: generationId, complete_usable: true });
  assert.deepEqual(h.counts(), { commits: 1, finishes: 1 });
  const outcome = saved as { decisions: Array<Record<string, unknown>> };
  assert.equal(outcome.decisions[0]?.interest_decision_evidence_id, evidenceId);
  assert.equal(outcome.decisions[0]?.interest_output_digest, sha(outputText));
  assert.ok(h.queries.some(entry => entry.params.some(value => typeof value === "string"
    && value.includes("provider-config-v2"))));
});

test("V2 materialization refuses tampered raw, request, or SQL citation before commit", async () => {
  for (const options of [
    { raw_body: rawBody.replace("msg_test", "msg_changed") },
    { provider_request: { ...provider.provider_request, custom_id: "foreign" } },
    { citations: [{ chunk_index: 0, chunk_sha256: sha(text), quote_start: 0,
      quote_end: 5, quote: "Alexa", role: "supports" }] },
  ]) {
    const h = fixture(options);
    await assert.rejects(materializeSignalWorkspaceInterestDecisionV2({ database: h.db,
      execution_id: executionId, worker_job_id: `workspace-classification-${executionId}`, stores: h.stores }));
    assert.deepEqual(h.counts(), { commits: 0, finishes: 0 });
  }
});
