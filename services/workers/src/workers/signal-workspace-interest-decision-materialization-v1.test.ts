import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  buildSignalWorkspaceInterestDecisionRequestV1,
  signalWorkspaceEmbeddingDigestV1,
  type SignalWorkspaceClassificationIdentityV1,
} from "@noisia/query-engine";
import type {
  SignalWorkspaceClassificationDatabaseV1,
  SignalWorkspaceClassificationLeaseV1,
  SignalWorkspaceClassificationPageV1,
} from "@noisia/db";
import { materializeSignalWorkspaceInterestDecisionV1 } from "./signal-workspace-interest-decision-materialization-v1";

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
const identity: SignalWorkspaceClassificationIdentityV1 = {
  contract_version: "signal-workspace-classification-v1", workspace_id: request.workspace_id,
  engine_key: "interest_decision", engine_version: 1, engine_artifact_digest: sha("engine"),
  embedding_config_digest: sha("embedding"),
  catalog_digest: signalWorkspaceEmbeddingDigestV1([{ term_key: interest.term_key,
    definition_digest: interest.definition_digest, definition_revision: interest.definition_revision }]),
  compiler_digest: signalWorkspaceEmbeddingDigestV1([{ term_key: interest.term_key, compiler_digest: compiler }]),
  context_digest: request.context_digest, decision_policy_digest: request.decision_policy_digest,
};
const output = { contract_version: "signal-workspace-interest-decision-v1" as const,
  request_digest: request.request_digest, interest_identity_digest: signalWorkspaceEmbeddingDigestV1(interest),
  decisions: [{ root_id: root.root_id, root_fingerprint: root.fingerprint, asset_sha256: root.asset_sha256,
    verdict: "belongs" as const, rationale: "Sin permiso explícito.", citations: [{ chunk_index: 0,
      chunk_sha256: sha(text), quote_start: 0, quote_end: 6, quote: "Alexa+", role: "supports" as const }] }] };
// The provider may serialize keys in an order different from the normalized QE
// digest. SQL0211 stores the digest of these exact output bytes.
const outputText = JSON.stringify({ decisions: output.decisions, interest_identity_digest: output.interest_identity_digest,
  request_digest: output.request_digest, contract_version: output.contract_version });
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

function fixture(options: { missingEvidence?: boolean; ownerAvailable?: boolean;
  correction?: SignalWorkspaceClassificationPageV1["items"][number]["corrections"][number] } = {}) {
  const queries: string[] = [];
  const db = { query: async (sql: string) => {
    queries.push(sql);
    if (sql.includes("FROM signal_topic_catalog_executions execution")) return { rows:
      options.ownerAvailable === false ? [] : [{ owner_id: ownerId, generation_id: generationId,
        taxonomy_profile_id: randomUUID(), compiler_digest: compiler, expected_roots: 1,
        term_key: interest.term_key, taxonomy_term_id: interest.taxonomy_term_id,
        definition_digest: interest.definition_digest }] };
    if (sql.includes("FROM tagging_model_versions model")) return { rows: [{ model_version_id: randomUUID(),
      approval_policy_id: randomUUID() }] };
    if (sql.includes("SELECT DISTINCT ON (request.id)")) return { rows: [{ request_id: requestId,
      call_id: callId, request, request_digest: request.request_digest, output_text: outputText,
      output_digest: sha(outputText), raw_sha256: sha("provider-envelope") }] };
    if (sql.includes("FROM signal_interest_decision_root_evidence_v1 evidence")) return { rows:
      options.missingEvidence ? [] : [{ id: evidenceId, request_id: requestId, call_id: callId,
        root_id: root.root_id, term_key: interest.term_key, taxonomy_term_id: interest.taxonomy_term_id,
        root_fingerprint: root.fingerprint, asset_sha256: root.asset_sha256,
        verdict: "belongs", rationale: output.decisions[0]!.rationale,
        citations: output.decisions[0]!.citations, output_digest: sha(outputText),
        decision_digest: sha("SQL decision digest") }] };
    throw new Error(`unexpected query ${sql}`);
  } } as unknown as SignalWorkspaceClassificationDatabaseV1;
  let commits = 0, finishes = 0;
  const stores = {
    claim: async () => lease,
    readPage: async () => ({ ...page, items: [{ ...page.items[0]!, corrections: options.correction ? [options.correction] : [] }] }),
    commitPage: async ({ outcomes }: { outcomes: unknown[] }) => {
      commits++;
      assert.equal(outcomes.length,1);
      return { ...lease, cursor_root_id: root.root_id };
    },
    finish: async () => { finishes++; return { generation_id: generationId, complete_usable: true }; },
  } as unknown as NonNullable<Parameters<typeof materializeSignalWorkspaceInterestDecisionV1>[0]["stores"]>;
  return { db,stores,queries,counts: () => ({ commits, finishes }) };
}

test("accepted saved receipt and evidence commit the same-generation page and finish", async () => {
  const f = fixture();
  let saved: unknown;
  const stores = { ...f.stores,
    commitPage: async (args: Parameters<typeof f.stores.commitPage>[0]) => {
      saved = args.outcomes[0];
      return f.stores.commitPage(args);
    } };
  const result = await materializeSignalWorkspaceInterestDecisionV1({ database: f.db,
    execution_id: executionId, worker_job_id: `workspace-classification-${executionId}`, stores });
  assert.deepEqual(result,{ generation_id: generationId, complete_usable: true });
  assert.deepEqual(f.counts(),{ commits: 1, finishes: 1 });
  const outcome = saved as { resolution_state: string; decisions: Array<Record<string,unknown>> };
  assert.equal(outcome.resolution_state,"approved");
  assert.equal(outcome.decisions[0]?.interest_decision_evidence_id,evidenceId);
  assert.equal(outcome.decisions[0]?.interest_output_digest,sha(outputText));
  assert.equal(outcome.decisions[0]?.evidence_digest,sha("SQL decision digest"));
  assert.ok(f.queries.some(sql => sql.includes("owner.generation_id=generation.id")));
});

test("missing settled root evidence cannot advance the generation cursor", async () => {
  const f = fixture({ missingEvidence: true });
  await assert.rejects(materializeSignalWorkspaceInterestDecisionV1({ database: f.db,
    execution_id: executionId, worker_job_id: `workspace-classification-${executionId}`, stores: f.stores }),
  /saved_evidence_mismatch/u);
  assert.deepEqual(f.counts(),{ commits: 0, finishes: 0 });
});

test("a current human correction supersedes the model assignment", async () => {
  const correction = { taxonomy_term_id: interest.taxonomy_term_id, term_key: interest.term_key,
    definition_revision: interest.definition_revision, definition_digest: interest.definition_digest,
    disposition: "rejected" as const, resolution_method: "human" as const,
    model_version_id: null, labeling_function_version_id: null, approval_policy_id: null,
    decided_by_user_id: randomUUID(), correction_operation_id: randomUUID(), score: null,
    evidence_digest: sha("human correction"), lineage_digest: sha("human correction") };
  const f = fixture({ correction });
  let saved: unknown;
  await materializeSignalWorkspaceInterestDecisionV1({ database: f.db,
    execution_id: executionId, worker_job_id: `workspace-classification-${executionId}`,
    stores: { ...f.stores, commitPage: async args => {
      saved = args.outcomes[0]; return f.stores.commitPage(args);
    } } });
  const outcome = saved as { resolution_state: string; decisions: Array<Record<string,unknown>> };
  assert.equal(outcome.resolution_state,"rejected");
  assert.equal(outcome.decisions[0]?.resolution_method,"human");
  assert.equal(outcome.decisions[0]?.interest_decision_evidence_id,undefined);
});

test("an old generation owner is not an inherited-evidence authority", async () => {
  const f = fixture({ ownerAvailable: false });
  await assert.rejects(materializeSignalWorkspaceInterestDecisionV1({ database: f.db,
    execution_id: executionId, worker_job_id: `workspace-classification-${executionId}`, stores: f.stores }),
  /owner_or_source_unavailable/u);
  assert.deepEqual(f.counts(),{ commits: 0, finishes: 0 });
});

test("lost page acknowledgement resumes from the committed SQL cursor", async () => {
  const f = fixture();
  let advanced = false, writes = 0, finishes = 0;
  const stores = { ...f.stores,
    claim: async () => advanced ? { ...lease, cursor_root_id: root.root_id } : lease,
    readPage: async () => advanced ? { items: [], done: true } : page,
    commitPage: async () => { writes++; advanced = true; throw Object.assign(new Error("lost ACK"),{ code: "ECONNRESET" }); },
    finish: async () => { finishes++; return { complete_usable: true }; },
  } as unknown as NonNullable<Parameters<typeof materializeSignalWorkspaceInterestDecisionV1>[0]["stores"]>;
  const args = { database: f.db, execution_id: executionId,
    worker_job_id: `workspace-classification-${executionId}`, stores };
  await assert.rejects(materializeSignalWorkspaceInterestDecisionV1(args),/lost ACK/u);
  assert.deepEqual(await materializeSignalWorkspaceInterestDecisionV1(args),{ complete_usable: true });
  assert.equal(writes,1);
  assert.equal(finishes,1);
});
