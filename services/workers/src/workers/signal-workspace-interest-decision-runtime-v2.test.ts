import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import type { SignalWorkspaceInterestDecisionRequestBodyV1 } from "@noisia/query-engine";
import { buildSignalWorkspaceInterestDecisionPageManifestV2 } from "./signal-workspace-interest-decision-batch-v2";
import { applySettledSignalWorkspaceInterestDecisionItemV2,
  signalWorkspaceInterestDecisionRuntimeConfigurationV2 } from "./signal-workspace-interest-decision-runtime-v2";

const sha = (value: string) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const callId = randomUUID(), rootId = randomUUID();
const text = "La conversación menciona el interés de forma específica.";
const page: SignalWorkspaceInterestDecisionRequestBodyV1 = {
  contract_version: "signal-workspace-interest-decision-v1", workspace_id: randomUUID(),
  context_digest: sha("context"), decision_policy_digest: sha("policy"),
  interest: { taxonomy_term_id: randomUUID(), term_key: "interest", definition_revision: 1,
    definition_digest: sha("definition"), definition: "Interés específico",
    inclusion: ["Interés específico"], exclusion: ["Caso ajeno"] },
  roots: [{ root_id: rootId, fingerprint: sha("fingerprint"), correction_digest: sha("correction"),
    asset_sha256: sha(text), chunks: [{ chunk_index: 0, start: 0, end: text.length,
      chunk_sha256: sha(text), text }] }],
};
const manifest = buildSignalWorkspaceInterestDecisionPageManifestV2({ page, expected_root_ids: [rootId] });
const customId = manifest.requests[0]!.provider_request.custom_id;
const spanId = "r0c0s0";
const output = { contract_version: "signal-workspace-interest-decision-provider-output-v2",
  decisions: [{ root_ordinal: 0, verdict: "belongs", rationale: "Cita el interés concreto.",
    citations: [{ span_id: spanId, role: "supports" }] }] };
function rawItem(kind: "accepted" | "invalid_output" | "provider_error") {
  const result = kind === "provider_error" ? { type: "errored", error: { type: "api_error", message: "unavailable" } }
    : { type: "succeeded", message: { id: "msg_test", type: "message", role: "assistant",
      model: "claude-sonnet-4-6", stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify(kind === "accepted" ? output : {
        ...output, decisions: [{ ...output.decisions[0], citations: [{ span_id: "unknown", role: "supports" }] }],
      }) }], usage: { input_tokens: 100, output_tokens: 40 } } };
  return JSON.stringify({ custom_id: customId, result });
}
function harness(kind: "accepted" | "invalid_output" | "provider_error", overrides: Record<string, unknown> = {},
  replayed = false) {
  const raw = rawItem(kind), statements: string[] = [], parameters: unknown[][] = [];
  const status = kind === "provider_error" ? "errored" : kind;
  const database = { connect: async () => ({ query: async (sql: string, values: unknown[] = []) => {
    statements.push(sql); parameters.push(values);
    if (sql.includes("FOR UPDATE OF c")) return { rows: [{ call_id: callId, custom_id: customId,
      status: "settled", raw_body: raw, raw_sha256: sha(raw), request_version: 2,
      owner_version: 2, manifest, ...overrides }] };
    if (sql.includes("apply_signal_interest_decision_item_v2")) return { rows: [{ result: {
      call_id: callId, validation_status: status, replayed,
      ...(kind === "accepted" && !replayed ? { root_count: 1 } : {}),
    } }] };
    return { rows: [] };
  }, release() { statements.push("release"); } }) };
  return { database, statements, parameters };
}
const enabled = { NOISIA_SIGNAL_INTEREST_DECISION_V2_ENABLED: "true" };

test("V2 provider remains unavailable and default OFF without reading DB", async () => {
  assert.deepEqual(signalWorkspaceInterestDecisionRuntimeConfigurationV2({}),
    { enabled: false, provider_ready: false });
  assert.deepEqual(signalWorkspaceInterestDecisionRuntimeConfigurationV2(enabled),
    { enabled: true, provider_ready: false });
  const database = { connect: async () => assert.fail("disabled V2 opened DB") };
  assert.deepEqual(await applySettledSignalWorkspaceInterestDecisionItemV2({ database: database as never,
    call_id: callId, env: {} }), { disabled: true });
});

test("sealed V2 call is parsed before SQL apply; raw receipt and usage are never rewritten", async () => {
  const h = harness("accepted");
  const applied = await applySettledSignalWorkspaceInterestDecisionItemV2({
    database: h.database as never, call_id: callId, env: enabled });
  assert.deepEqual(applied, { disabled: false, call_id: callId, validation_status: "accepted", replayed: false });
  assert.equal(h.statements.filter(sql => sql.includes("apply_signal_interest_decision_item_v2")).length, 1);
  assert.deepEqual(h.parameters.filter(values => values.length), [[callId], [callId]]);
  assert.equal(h.statements.some(sql => /^\s*(UPDATE|INSERT)\b|persist_signal_interest_decision_item_v1/iu.test(sql)), false);
  assert.deepEqual(h.statements.slice(-2), ["COMMIT", "release"]);
});

test("invalid V2 output and provider errors remain recovery outcomes", async () => {
  for (const kind of ["invalid_output", "provider_error"] as const) {
    const h = harness(kind);
    const result = await applySettledSignalWorkspaceInterestDecisionItemV2({
      database: h.database as never, call_id: callId, env: enabled });
    assert.equal(result.disabled, false);
    if (!result.disabled) assert.equal(result.validation_status, kind === "provider_error" ? "errored" : kind);
    assert.ok(h.statements.some(sql => sql.includes("apply_signal_interest_decision_item_v2")));
  }
});

test("tampered or non-V2 ledger rows stop before SQL apply", async () => {
  for (const overrides of [{ raw_sha256: sha("different") }, { status: "outcome_unknown" },
    { request_version: 1 }, { owner_version: 1 }, { custom_id: "id2_foreign" },
    { manifest: { ...manifest, manifest_digest: sha("tampered") } }]) {
    const h = harness("accepted", overrides);
    await assert.rejects(applySettledSignalWorkspaceInterestDecisionItemV2({
      database: h.database as never, call_id: callId, env: enabled }));
    assert.equal(h.statements.some(sql => sql.includes("apply_signal_interest_decision_item_v2")), false);
    assert.ok(h.statements.includes("ROLLBACK"));
  }
});

test("duplicate settled receipt replays the same apply; there is no Batch POST path", async () => {
  const h = harness("accepted", {}, true);
  for (let index = 0; index < 2; index++) {
    const result = await applySettledSignalWorkspaceInterestDecisionItemV2({
      database: h.database as never, call_id: callId, env: enabled });
    assert.equal(result.disabled, false);
    if (!result.disabled) assert.equal(result.replayed, true);
  }
  assert.equal(h.statements.filter(sql => sql.includes("apply_signal_interest_decision_item_v2")).length, 2);
  assert.equal(h.statements.some(sql => /mark_submitting|provider\.create|https?:\/\//u.test(sql)), false);
});
