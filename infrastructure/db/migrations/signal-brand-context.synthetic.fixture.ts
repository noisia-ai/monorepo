import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import {
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION_V3,
  SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
  parseSignalSemanticContextProposalResponseV3,
  validateSignalWorkspaceEmbeddingInputsV1,
  type SignalSemanticContextProposalInputV1,
  type SignalSemanticContextProposalProviderV1
} from "@noisia/query-engine";
import {
  validateWorkspaceVoyageResponseV1,
  type WorkspaceEmbeddingProviderV1
} from "../../../services/workers/src/workers/signal-workspace-embeddings-provider";
import { signalWorkspaceEmbeddingsJobV1 } from "../../../services/workers/src/workers/signal-workspace-embeddings";

// Invented test material. The creation service must build the actual profile and
// automatic KB; this fixture never inserts semantic generations or ready states.
export const BRAND_CONTEXT_SYNTHETIC_INTAKE_V1 = Object.freeze({
  name: "Lumbre Bicycles Synthetic",
  industry: "Bicycles",
  industry_sub: "Urban bicycles and scheduled repairs",
  countries: ["MX"],
  timezone: "America/Mexico_City",
  description: "Invented bicycle business offering scheduled repairs. Test data only.",
  knowledge_notes: ""
});
export const BRAND_CONTEXT_SYNTHETIC_ADDITIONAL_KB_V1 =
  "Synthetic workshop note: customers can schedule bicycle repairs. A guaranteed repair time is not established. "
  + "Invented workshop instructions concern bicycle upkeep and appointment planning. ".repeat(60)
  + "SYNTHETIC_KB_COMPLETE_TAIL: the complete note must reach semantic preparation.";
export const BRAND_CONTEXT_SYNTHETIC_UPDATED_KB_V1 =
  `${BRAND_CONTEXT_SYNTHETIC_ADDITIONAL_KB_V1} Battery maintenance is now available for synthetic electric bicycles.`;

type ProposalInput = Pick<SignalSemanticContextProposalInputV1, "identity" | "knowledge_blocks" | "limits">;
export type BrandContextSyntheticRevisionV1 = "initial" | "updated";

/** Uses server-prepared aliases. The limited-evidence proposal is valid provider
 * JSON but must remain an exception under the existing deterministic policy. */
export function brandContextSyntheticSemanticResponseV1(input: ProposalInput,
  revision: BrandContextSyntheticRevisionV1) {
  const primaryAlias = input.identity.primary.source_aliases.find(alias =>
    input.knowledge_blocks.some(block => block.source_alias === alias));
  const knowledge = input.knowledge_blocks.find(block =>
    ["knowledge_source", "knowledge_chunk"].includes(block.source_kind)
    && block.text.includes("Synthetic workshop note:"));
  assert.ok(primaryAlias, "synthetic provider requires a resolved Brand OS source");
  assert.ok(knowledge, "synthetic provider requires the additional KB in prepared authority");
  const updatedKnowledge = input.knowledge_blocks.find(block => block.text.includes("Battery maintenance"));
  if (revision === "updated") assert.ok(updatedKnowledge,
    "successor must contain the actual updated KB");
  const base = { scope: "primary_brand", entity_ref: input.identity.primary.entity_ref,
    locale: null, relation_kind: null, relation_target_key: null, confidence: 1 };
  const proposals = [
    { ...base, element_key: "identity.synthetic-bicycle", element_kind: "identity_term",
      canonical_key: "synthetic-bicycle", display_text: "Synthetic bicycle workshop",
      evidence: [{ source_alias: primaryAlias, relation_type: "supports" }] },
    { ...base, element_key: "benefit.scheduled-repairs", element_kind: "benefit",
      canonical_key: "scheduled-repairs", display_text: "Scheduled bicycle repairs",
      evidence: [{ source_alias: knowledge.source_alias, relation_type: "supports" }] },
    { ...base, element_key: "benefit.guaranteed-repair-time", element_kind: "benefit",
      canonical_key: "guaranteed-repair-time", display_text: "Guaranteed repair time",
      evidence: [{ source_alias: knowledge.source_alias, relation_type: "limits" }] }
  ];
  if (revision === "updated") proposals.push({ ...base, element_key: "feature.battery-maintenance",
    element_kind: "feature", canonical_key: "battery-maintenance", display_text: "Battery maintenance",
    evidence: [{ source_alias: updatedKnowledge!.source_alias, relation_type: "supports" }] });
  const text = JSON.stringify({ contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION_V3,
    proposals });
  parseSignalSemanticContextProposalResponseV3(text, input.limits.maximum_proposals);
  return text;
}

export function createBrandContextSyntheticSemanticProviderV1(args: {
  input: ProposalInput; prompt: string; model: string; revision: BrandContextSyntheticRevisionV1;
}) {
  const response = brandContextSyntheticSemanticResponseV1(args.input, args.revision);
  const expectedPrompt = args.prompt, expectedModel = args.model;
  const maximum = args.input.limits.maximum_proposals, outputTokens = args.input.limits.output_token_budget;
  const calls: Array<{ request_identity: string; response_sha256: string }> = [];
  const provider: SignalSemanticContextProposalProviderV1 = { async generate(request) {
    assert.equal(calls.length, 0, "one generation may consume the synthetic provider only once");
    assert.equal(request.prompt, expectedPrompt);
    assert.equal(request.model, expectedModel);
    assert.equal(request.maximum_proposals, maximum);
    assert.equal(request.max_output_tokens, outputTokens);
    assert.equal(request.temperature, 0);
    calls.push({ request_identity: request.request_identity, response_sha256: sha(response) });
    return { text: response, provider_request_id: `synthetic-brand-context-${args.revision}`,
      usage: { input_tokens: 1000, output_tokens: 500 } };
  } };
  return { provider, calls };
}

export function createBrandContextSyntheticVoyageProviderV1() {
  const calls: Array<{ input_sha256: string[]; response_sha256: string }> = [];
  const seen = new Set<string>();
  const provider: WorkspaceEmbeddingProviderV1 = { async embedBatch(inputs) {
    validateSignalWorkspaceEmbeddingInputsV1(inputs);
    for (const input of inputs) assert.ok(!seen.has(input.chunk_sha256),
      "a cached prototype must not be submitted again in this synthetic journey");
    const body = JSON.stringify({ model: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1.model,
      usage: { total_tokens: inputs.length }, data: inputs.map((_, index) => ({ index,
        embedding: Array.from({ length: SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1.dimensions },
          (__, dimension) => dimension === 0 ? 1 : 0) })) });
    const raw = { body, http_status: 200, provider_request_id: `synthetic-voyage-${calls.length + 1}` };
    validateWorkspaceVoyageResponseV1(inputs, raw);
    inputs.forEach(input => seen.add(input.chunk_sha256));
    calls.push({ input_sha256: inputs.map(input => input.chunk_sha256), response_sha256: sha(body) });
    return raw;
  } };
  return { provider, calls };
}

/** Real Worker and stores, injected transaction and raw-response simulator.
 * No default Worker, queue connection, environment lookup or provider transport. */
export async function executeBrandContextSyntheticPrototypeRunV1(args: {
  database: Pool; run_id: string; provider: WorkspaceEmbeddingProviderV1;
}) {
  const row = (await args.database.query<{ worker_job_id: string; input_contract: string }>(
    "SELECT worker_job_id,input_contract FROM signal_workspace_embedding_runs WHERE id=$1::uuid",
    [args.run_id])).rows[0];
  assert.ok(row, "the product service must durably request the prototype run");
  assert.equal(row.input_contract, "topic_prototypes");
  return signalWorkspaceEmbeddingsJobV1({ id: row.worker_job_id, data: { run_id: args.run_id },
    updateProgress: async () => {} }, { database: args.database, provider: args.provider });
}

const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
