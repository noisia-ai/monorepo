import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  parseSignalSemanticContextProposalResponseV3,
  planSignalSemanticContextCapacityV1,
  type SignalSemanticContextProposalInputV1
} from "@noisia/query-engine";
import { evaluateSignalSemanticContextAutomaticPolicyV1 } from "../signal-semantic-context-automatic-policy";
import { validateWorkspaceVoyageResponseV1 } from "../../../services/workers/src/workers/signal-workspace-embeddings-provider";
import {
  BRAND_CONTEXT_SYNTHETIC_ADDITIONAL_KB_V1,
  BRAND_CONTEXT_SYNTHETIC_UPDATED_KB_V1,
  brandContextSyntheticSemanticResponseV1,
  createBrandContextSyntheticSemanticProviderV1,
  createBrandContextSyntheticVoyageProviderV1
} from "./signal-brand-context.synthetic.fixture";

const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
function input(updated = false): Pick<SignalSemanticContextProposalInputV1, "identity" | "knowledge_blocks" | "limits"> {
  const capacity = planSignalSemanticContextCapacityV1({ authority: {
    brand_os_digest: sha("synthetic brand"), knowledge_digest: sha(updated ? "updated KB" : "initial KB"),
    locale_context_digest: sha("synthetic locale") }, counts: {
    aliases: 0, products: 0, competitors: 0, locale_variants: 1, markets: 1,
    code_switching: 0, category_fields: 2, structured_terms: 0, knowledge_blocks: 2, evidence_source_kinds: 2 } });
  return { identity: { primary: { entity_ref: "brand.primary", entity_type: "brand",
    display_name: "Lumbre Bicycles Synthetic", aliases: [], source_aliases: ["src.001"] }, aliases: [] },
    knowledge_blocks: [
      { source_alias: "src.001", source_kind: "brand_os_profile", content_kind: "identity",
        title: "Synthetic structured intake", text: "Invented bicycle workshop, not a customer." },
      { source_alias: "src.002", source_kind: "knowledge_source", content_kind: "source",
        title: "Synthetic workshop note", text: updated ? BRAND_CONTEXT_SYNTHETIC_UPDATED_KB_V1
          : BRAND_CONTEXT_SYNTHETIC_ADDITIONAL_KB_V1 } ],
    limits: { capacity_policy_version: capacity.policy_version, capacity_digest: capacity.capacity_digest,
      minimum_useful_proposals: capacity.minimum_useful_proposals, target_proposals: capacity.target_proposals,
      maximum_proposals: capacity.maximum_proposals, output_token_budget: capacity.output_token_budget,
      abstention_required_when_evidence_is_insufficient: true, mentions_included: false } };
}

test("synthetic response passes strict V3 and real policy isolates exactly one exception", () => {
  const prepared = input();
  const parsed = parseSignalSemanticContextProposalResponseV3(
    brandContextSyntheticSemanticResponseV1(prepared, "initial"), prepared.limits.maximum_proposals).output;
  const result = evaluateSignalSemanticContextAutomaticPolicyV1({ generation_key: "synthetic-test-only",
    parent_authority: { valid: true, parent_authority_digest: sha("synthetic authority"),
      locales: ["es-MX"], markets: ["MX"] }, current_leaves: [],
    proposals: parsed.proposals.map(proposal => ({ ...proposal, entity_type: "brand",
      entity_id: "00000000-0000-4000-8000-000000000001", origin_kind: "provider_proposal",
      source_refs: proposal.evidence.map(ref => ({
        source_type: prepared.knowledge_blocks.find(block => block.source_alias === ref.source_alias)!.source_kind,
        source_id: ref.source_alias === "src.001" ? "00000000-0000-4000-8000-000000000002"
          : "00000000-0000-4000-8000-000000000003", relation_type: ref.relation_type })) })) });
  assert.equal(result.ready_count, 2);
  assert.equal(result.exception_count, 1);
  assert.deepEqual(result.decisions.find(row => row.outcome === "exception")?.reasons, ["evidence_limited"]);
});

test("successor simulator preserves prior texts and requires updated KB before adding a proposal", () => {
  assert.throws(() => brandContextSyntheticSemanticResponseV1(input(), "updated"), /actual updated KB/);
  const first = JSON.parse(brandContextSyntheticSemanticResponseV1(input(), "initial"));
  const next = JSON.parse(brandContextSyntheticSemanticResponseV1(input(true), "updated"));
  assert.deepEqual(next.proposals.slice(0, 3), first.proposals);
  assert.equal(next.proposals.length, 4);
  const missing = input(); missing.knowledge_blocks = missing.knowledge_blocks.slice(0, 1);
  assert.throws(() => brandContextSyntheticSemanticResponseV1(missing, "initial"), /additional KB/);
});

test("semantic simulator checks the sealed request and detects an unintended replay send", async () => {
  const prepared = input();
  const simulator = createBrandContextSyntheticSemanticProviderV1({ input: prepared, prompt: "synthetic prompt",
    model: "synthetic-model", revision: "initial" });
  const request = { model: "synthetic-model", prompt: "synthetic prompt", temperature: 0 as const,
    request_identity: sha("synthetic request"), maximum_proposals: prepared.limits.maximum_proposals,
    max_output_tokens: prepared.limits.output_token_budget };
  await assert.rejects(simulator.provider.generate({ ...request, model: "changed-model" }));
  assert.equal(simulator.calls.length, 0);
  const response = await simulator.provider.generate(request);
  assert.equal(simulator.calls.length, 1);
  assert.deepEqual(response.usage, { input_tokens: 1000, output_tokens: 500 });
  await assert.rejects(simulator.provider.generate(request), /only once/);
});

test("Voyage simulator crosses the real response validator and rejects resubmitted cached inputs", async () => {
  const simulator = createBrandContextSyntheticVoyageProviderV1();
  const inputs = ["Scheduled bicycle repairs", "Battery maintenance"].map(text => ({ text, chunk_sha256: sha(text) }));
  const raw = await simulator.provider.embedBatch(inputs);
  const parsed = validateWorkspaceVoyageResponseV1(inputs, raw);
  assert.equal(parsed.embeddings.length, 2);
  assert.equal(parsed.embeddings[0]?.vector.length, 1024);
  assert.equal(simulator.calls.length, 1);
  await assert.rejects(simulator.provider.embedBatch(inputs.slice(0, 1)), /must not be submitted again/);
  assert.equal(simulator.calls.length, 1);
});
