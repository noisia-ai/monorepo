import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceMonitoringInsightCandidatesV1, buildWorkspaceMonitoringInsightRequestV1,
  workspaceMonitoringInsightConfigurationV1, parseWorkspaceMonitoringInsightReceiptV1,
  workspaceMonitoringInsightUsageFromRawV1, type WorkspaceMonitoringInsightPacketV1 } from "@noisia/query-engine";
import { MonitoringInsightsProviderErrorV1, type MonitoringInsightsProviderV1 } from "../providers/anthropic-monitoring-insights";
import { signalWorkspaceMonitoringInsightsJobV1 } from "./signal-workspace-monitoring-insights";

type Options = NonNullable<Parameters<typeof signalWorkspaceMonitoringInsightsJobV1>[1]>;
type Stores = NonNullable<Options["stores"]>;
type Call = Awaited<ReturnType<Stores["reserve"]>>;
const workspace = "00000000-0000-4000-8000-000000000001";
const run_id = "00000000-0000-4000-8000-000000000002";
const job = { id: "synthetic-job", data: { run_id }, updateProgress: async () => undefined };
function fixture() {
  const metrics = { denominator: 3, scope_digest: "sha256:" + "a".repeat(64), metadata_digest: "sha256:" + "b".repeat(64),
    population: { map_id: workspace, map_digest: "sha256:" + "c".repeat(64), input_revision: "1", policy_revision: 1 },
    source_coverage: { sentiment_known: 0, thread_id_known: 0, content_type_known: 0, engagement_known_root_posts: 0, llm_eligible_roots: 3 },
    summary: { mentions: 3, root_posts: 0, comments: 0, unknown_roles: 3 },
    series: [{ period_start: "2026-10-30", mentions: 3, sentiment: { positive: 0, neutral: 0, negative: 0, classified: 0 } }],
    sentiment: { positive: 0, neutral: 0, negative: 0, unclassified: 3 }, platforms: [{ key: "web", count: 3 }],
    attention: { root_posts: 0, total_interactions: 0, active_root_posts: 0, active_ratio: null }, drivers: [], limitations: [] };
  const packet: WorkspaceMonitoringInsightPacketV1 = { contract_version: "signal-workspace-monitoring-insight-packet-v1", workspace_id: workspace,
    timezone: "UTC", locale: "es-MX", cadence: "rolling_30_days", scope_segment: "conversation", window: { start: "2026-10-01", end: "2026-10-30", days: 30 },
    comparison_window: null, partial: true, current: metrics, previous: null, candidates: buildWorkspaceMonitoringInsightCandidatesV1({ current: metrics, previous: null }) };
  const request = buildWorkspaceMonitoringInsightRequestV1(packet, workspaceMonitoringInsightConfigurationV1(workspace));
  const lease = { run_id, workspace_id: workspace, execution_token: "execution", packet, request };
  const call: Call = { id: "call", attempt_token: "attempt", state: "reserved", response_body: null, response_http_status: null, response_complete: null };
  const raw = () => Buffer.from(JSON.stringify({ model: "claude-sonnet-4-6", role: "assistant", stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 10 }, content: [{ type: "text", text: JSON.stringify({
      contract_version: "signal-monthly-insight-editorial-v1", candidate_hash: request.packet_digest, summary: "Se observa actividad agregada.",
      items: [{ candidate_id: packet.candidates[0]!.id, priority: 1, short_title: "Actividad observada", explanation: "El paquete describe la actividad disponible.",
        why_it_matters: "Permite establecer una referencia descriptiva.", confidence: "low", limitations: ["Los agregados no establecen causas."] }] }) }] }));
  const events: string[] = []; const outcomes: string[] = []; let sends = 0; let completed = false; let charged = 0;
  const store: Stores = {
    claim: async () => { events.push("claim"); return completed ? null : lease; },
    reserve: async () => { events.push("reserve"); return call; },
    markSent: async ({ lease: received, call_id, attempt_token }) => { assert.equal(received.execution_token, "execution"); assert.equal(call_id, "call"); assert.equal(attempt_token, "attempt"); events.push("mark"); call.state = "in_flight"; return true; },
    persistRaw: async ({ receipt, call_id, attempt_token }) => { assert.equal(call_id, "call"); assert.equal(attempt_token, "attempt"); events.push("persist");
      call.response_body = Buffer.from(receipt.bytes); call.response_http_status = receipt.http_status; call.response_complete = receipt.complete; call.state = "response_persisted";
      return { call_id, replayed: false }; },
    settle: async () => { events.push("settle"); const result = workspaceMonitoringInsightUsageFromRawV1(call.response_body!.toString("utf8"));
      if (call.state !== "settled") charged += result.cost_micro_usd; call.state = "settled"; return result; },
    complete: async () => { events.push("complete"); assert.equal(call.state, "settled"); parseWorkspaceMonitoringInsightReceiptV1(request, call.response_body!.toString("utf8"));
      completed = true; return { run_id, status: "completed" as const }; },
    fail: async ({ outcome }) => { events.push(`fail:${outcome}`); outcomes.push(outcome);
      return { run_id, status: outcome === "outcome_unknown" ? "outcome_unknown" as const : "failed" as const }; }
  };
  const provider: MonitoringInsightsProviderV1 = { generate: async source => { assert.equal(source.request_body, request.request_body); events.push("provider"); sends++;
    return { bytes: raw(), http_status: 200, provider_request_id: "synthetic", complete: true }; } };
  return { store, lease, call, provider, raw, events, outcomes, sends: () => sends, charged: () => charged,
    options: { database: {} as Options["database"], stores: store, provider,
      env: { NOISIA_MONITORING_INSIGHTS_ENABLED: "true", NOISIA_MONITORING_INSIGHTS_ANTHROPIC_API_KEY: "dedicated" } } satisfies Options };
}
test("one closed job sends the sealed aggregate once, persists raw, settles cost, then publishes", async () => {
  const f = fixture(); const result = await signalWorkspaceMonitoringInsightsJobV1(job, f.options);
  assert.equal(result.status, "completed"); assert.equal(f.sends(), 1); assert.ok(f.charged() > 0);
  assert.deepEqual(f.events, ["claim", "reserve", "mark", "provider", "persist", "settle", "complete"]);
  await signalWorkspaceMonitoringInsightsJobV1(job, f.options); assert.equal(f.sends(), 1);
});
test("extra job authority, malformed IDs and altered sealed requests cannot send", async () => {
  for (const invalid of [{ ...job, data: { run_id, budget_cap_usd: 99 } }, { ...job, data: { run_id: "other" } }]) {
    const f = fixture(); await assert.rejects(signalWorkspaceMonitoringInsightsJobV1(invalid, f.options)); assert.equal(f.sends(), 0);
  }
  const f = fixture(); f.lease.request.request_body = "altered private request";
  await assert.rejects(signalWorkspaceMonitoringInsightsJobV1(job, f.options), /monitoring_insights_request_invalid/);
  assert.equal(f.sends(), 0); assert.ok(!f.events.includes("reserve"));
});
test("a disabled flag or missing dedicated key cannot use a generic credential or send", async () => {
  for (const env of [{ NOISIA_MONITORING_INSIGHTS_ENABLED: "false", NOISIA_MONITORING_INSIGHTS_ANTHROPIC_API_KEY: "dedicated" },
    { NOISIA_MONITORING_INSIGHTS_ENABLED: "true", ANTHROPIC_API_KEY: "generic-private-key" }]) {
    const f = fixture(); await assert.rejects(signalWorkspaceMonitoringInsightsJobV1(job, { ...f.options, env }));
    assert.equal(f.sends(), 0); assert.deepEqual(f.outcomes, ["definitely_not_sent"]); assert.ok(!f.events.includes("mark"));
  }
});
test("losing the send compare-and-set never sends, fails or mutates another reservation", async () => {
  const f = fixture(); f.store.markSent = async () => false;
  const result = await signalWorkspaceMonitoringInsightsJobV1(job, f.options);
  assert.equal(result.status, "reconciliation_only"); assert.equal(f.sends(), 0); assert.deepEqual(f.outcomes, []);
});
for (const state of ["in_flight", "outcome_unknown", "definitely_not_sent"] as const) test(`existing ${state} calls never auto-resend`, async () => {
  const f = fixture(); f.call.state = state;
  const result = await signalWorkspaceMonitoringInsightsJobV1(job, f.options);
  assert.equal(result.status, "reconciliation_only"); assert.equal(f.sends(), 0); assert.deepEqual(f.outcomes, []);
});
test("mark-send commit uncertainty conservatively fences the attempt without a provider call", async () => {
  const f = fixture(); f.store.markSent = async () => { throw new Error("private database commit diagnostic"); };
  await assert.rejects(signalWorkspaceMonitoringInsightsJobV1(job, f.options), /monitoring_insights_job_failed/);
  assert.equal(f.sends(), 0); assert.deepEqual(f.outcomes, ["outcome_unknown"]);
});
test("an authoritative pre-send rollback may fail safely without a provider call", async () => {
  const f = fixture(); f.store.markSent = async () => { throw Object.assign(new Error("monitoring_insights_scope_changed"), { definitely_not_sent: true }); };
  await assert.rejects(signalWorkspaceMonitoringInsightsJobV1(job, f.options));
  assert.equal(f.sends(), 0); assert.deepEqual(f.outcomes, ["definitely_not_sent"]);
});
test("a transport interruption is terminal uncertainty without an automatic repair or leaked diagnostics", async () => {
  const f = fixture(); f.provider.generate = async () => { throw new MonitoringInsightsProviderErrorV1("monitoring_insights_provider_transport_unknown", "outcome_unknown"); };
  await assert.rejects(signalWorkspaceMonitoringInsightsJobV1(job, f.options), /monitoring_insights_provider_transport_unknown/);
  assert.deepEqual(f.outcomes, ["outcome_unknown"]); assert.ok(!f.events.includes("persist"));
});
test("a raw persistence acknowledgement loss resumes the saved receipt with no second send", async () => {
  const f = fixture(); const persist = f.store.persistRaw; let fail = true;
  f.store.persistRaw = async args => { const result = await persist(args); if (fail) { fail = false; throw new Error("private lost ack"); } return result; };
  await assert.rejects(signalWorkspaceMonitoringInsightsJobV1(job, f.options));
  await signalWorkspaceMonitoringInsightsJobV1(job, { ...f.options, env: {} });
  assert.equal(f.sends(), 1); assert.ok(f.charged() > 0);
});
for (const kind of ["incomplete", "http-rejection"] as const) test(`a ${kind} receipt is saved before retaining uncertain exposure`, async () => {
  const f = fixture(); f.provider.generate = async () => ({ bytes: Buffer.from("private raw bytes"),
    http_status: kind === "http-rejection" ? 429 : 200, complete: kind !== "incomplete", provider_request_id: "synthetic" });
  await assert.rejects(signalWorkspaceMonitoringInsightsJobV1(job, f.options), /monitoring_insights_provider_response_unknown/);
  assert.ok(f.events.includes("persist")); assert.ok(!f.events.includes("settle")); assert.ok(!f.events.includes("complete"));
  assert.deepEqual(f.outcomes, ["outcome_unknown"]); assert.equal(f.call.response_body!.toString(), "private raw bytes");
  assert.equal(f.charged(), 0, "Unknown usage is not claimed as a zero-cost settlement");
});
test("a settlement acknowledgement loss resumes from settled bytes and never charges twice", async () => {
  const f = fixture(); const settle = f.store.settle; let fail = true;
  f.store.settle = async args => { const result = await settle(args); if (fail) { fail = false; throw new Error("private settlement ack"); } return result; };
  await assert.rejects(signalWorkspaceMonitoringInsightsJobV1(job, f.options)); const charged = f.charged();
  await signalWorkspaceMonitoringInsightsJobV1(job, { ...f.options, env: {} });
  assert.equal(f.sends(), 1); assert.equal(f.charged(), charged); assert.deepEqual(f.outcomes, ["local_failure"]);
});
test("a lost publication acknowledgement replays completion without another provider call", async () => {
  const f = fixture(); const complete = f.store.complete;
  f.store.complete = async args => { await complete(args); throw new Error("private publication commit diagnostic"); };
  await assert.rejects(signalWorkspaceMonitoringInsightsJobV1(job, f.options));
  const result = await signalWorkspaceMonitoringInsightsJobV1(job, { ...f.options, env: {} });
  assert.equal(result.status, "replayed"); assert.equal(f.sends(), 1); assert.ok(f.charged() > 0);
});
test("authority revoked during transport blocks publication while preserving the paid raw receipt and cost", async () => {
  const f = fixture(); f.store.complete = async () => { throw Object.assign(new Error("monitoring_insights_scope_changed"), { code: "monitoring_insights_scope_changed" }); };
  await assert.rejects(signalWorkspaceMonitoringInsightsJobV1(job, f.options), /monitoring_insights_scope_changed/);
  assert.equal(f.sends(), 1); assert.ok(f.call.response_body); assert.equal(f.call.state, "settled"); assert.ok(f.charged() > 0);
  assert.deepEqual(f.outcomes, ["local_failure"]);
});
test("a paid invalid editorial response is settled before publication fails, without repair calls", async () => {
  const f = fixture(); f.provider.generate = async () => ({ bytes: Buffer.from(f.raw().toString().replace("end_turn", "max_tokens")),
    http_status: 200, complete: true, provider_request_id: "synthetic" });
  await assert.rejects(signalWorkspaceMonitoringInsightsJobV1(job, f.options));
  assert.ok(f.charged() > 0); assert.equal(f.call.state, "settled"); assert.deepEqual(f.outcomes, ["local_failure"]);
  assert.ok(f.events.indexOf("settle") < f.events.indexOf("complete"));
});
test("a cost exceeding the cap is already accounted and cannot publish or trigger another send", async () => {
  const f = fixture(); const settle = f.store.settle;
  f.store.settle = async args => ({ ...await settle(args), cost_micro_usd: 2_000_001 });
  await assert.rejects(signalWorkspaceMonitoringInsightsJobV1(job, f.options), /monitoring_insights_settlement_invalid/);
  assert.equal(f.sends(), 1); assert.ok(f.charged() > 0); assert.ok(!f.events.includes("complete"));
  assert.deepEqual(f.outcomes, ["local_failure"]);
});
