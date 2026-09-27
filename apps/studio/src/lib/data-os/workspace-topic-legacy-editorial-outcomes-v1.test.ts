import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildSignalTopicEditorialScreeningPlanV1, signalTopicEditorialDigestV1 } from "@noisia/query-engine";
import { loadWorkspaceTopicLegacyEditorialOutcomesPageV1, PositivePlanValidationCacheV1 } from "./workspace-topic-legacy-editorial-outcomes-v1";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const actorUserId = "00000000-0000-4000-8000-000000000002";
const numericExecutionId = "00000000-0000-4000-8000-000000000003";
const runId = "00000000-0000-4000-8000-000000000004";
const rootId = "00000000-0000-4000-8000-000000000005";
const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const text = "La respuesta del soporte explicó cuándo estará disponible Alexa+ en los dispositivos Echo.";
const chunk = digest(text);
const refId = signalTopicEditorialDigestV1({ root_id: rootId, chunk_index: 0, start: 0, end: text.length, chunk_sha256: chunk });

const group = {
  group_key: "open:access-delay", lane: "open" as const, group_digest: digest("group"), source_dossier_digest: digest("source"),
  dossier_digest: "", community_key: "community:1", root_count: 1, chunk_count: 1, terms: ["acceso", "alexa"],
  scope_counts: { brand: 1, competitor: 0, category: 0, unknown: 0 },
  locale_counts: [{ key: "es-MX", count: 1 }], platform_counts: [{ key: "reddit", count: 1 }], month_counts: [],
  brand_affinity: { positive: [], negative: [], abstention: [] }, neighbors: [], metrics: { cohesion: 0.8, outlier_ratio: 0.1 },
  evidence: [{ ref_id: refId, root_id: rootId, chunk_index: 0, start: 0, end: text.length, chunk_sha256: chunk,
    text, locale: "es-MX", platform: "reddit", occurred_at: null }],
};
group.dossier_digest = signalTopicEditorialDigestV1({ contract_version: "signal-topic-group-dossier-v1", scope_counts: group.scope_counts,
  locale_counts: group.locale_counts, platform_counts: group.platform_counts, month_counts: group.month_counts,
  brand_affinity: group.brand_affinity, neighbors: group.neighbors, metrics: group.metrics,
  evidence: group.evidence.map(item => ({ ref_id: item.ref_id, root_id: item.root_id, chunk_index: item.chunk_index,
    start: item.start, end: item.end, chunk_sha256: item.chunk_sha256, locale: item.locale, platform: item.platform, occurred_at: item.occurred_at })) });
const context = { brand_name: "Alexa+", default_locale: "es-MX", summary: "Asistente para dispositivos Echo.", audiences: [],
  categories: ["Tecnología"], competitors: [], positive_anchors: ["Alexa+"], negative_anchors: [], abstention_anchors: [] };
const plan = buildSignalTopicEditorialScreeningPlanV1({ expected_group_count: 1, source_context_digest: digest("context"),
  editorial_context_digest: signalTopicEditorialDigestV1(context), batch_size: 40, context, groups: [group] });
const batch = plan.batches[0]!;
const decision = { group_key: group.group_key, disposition: "topic" as const,
  candidate: { candidate_key: "b0000-alexa-access", label: "Acceso anticipado a Alexa+",
    definition: "Conversaciones sobre disponibilidad y despliegue gradual de Alexa+.", locale: "es-MX" },
  confidence: 0.91, rationale: "La cita describe la disponibilidad del producto.", cited_ref_ids: [refId] };
const output = { contract_version: "signal-topic-editorial-screening-output-v1" as const,
  batch_index: batch.batch_index, decisions: [decision] };
const stateBody = { contract_version: "signal-topic-editorial-runner-v1" as const,
  execution_key: "00000000-0000-4000-8000-000000000006", plan_digest: plan.plan_digest, phase: "global" as const,
  screening_outputs: [output], global: null };
const stateDigest = signalTopicEditorialDigestV1(stateBody);

function fakeDatabase(hasOwner = true, planValid = true) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const client = { release() {}, async query(sql: string, params?: unknown[]) {
    calls.push({ sql, params });
    if (sql.includes("workspace.status workspace_status")) return { rows: [{ workspace_status: "active", brand_status: "active",
      organization_status: "active", brand_same_organization: true, actor_status: "active", user_type: "client",
      primary_role: "client_viewer", same_organization: true, brand_access_level: "read" }] };
    if (sql.includes("SELECT r.id,r.expected_group_count")) return { rows: [{ id: runId, expected_group_count: 1, revision_id: null }] };
    if (sql.includes("count(*)::integer count")) return { rows: [{ count: 1 }] };
    if (sql.includes("SELECT g.id,g.group_key")) return { rows: [{ id: "00000000-0000-4000-8000-000000000007", group_key: group.group_key,
      lane: "open", root_count: 1, chunk_count: 1, terms: group.terms, disposition: null, concept_label: null }] };
    if (sql.includes("SELECT sample.atomic_group_id")) return { rows: [{ atomic_group_id: "00000000-0000-4000-8000-000000000007",
      canonical_root_id: rootId, chunk_sha256: chunk, fragment: text, platform: "reddit", locale: "es-MX" }] };
    if (sql.includes("SELECT editorial.id::text id")) return { rows: hasOwner ? [{ id: stateBody.execution_key, status: "failed",
      numeric_run_id: runId, plan_digest: plan.plan_digest, plan_body_digest: plan.plan_digest, state_body: stateBody,
      state_digest: stateDigest }] : [] };
    if (sql.includes("SELECT signal_topic_editorial_plan_valid_v1")) return { rows: [{ plan_valid: planValid }] };
    if (sql.includes("SELECT (editorial.plan->>'expected_group_count')::integer")) return { rows: [{ expected_group_count: 1, batch_count: 1 }] };
    if (sql.includes("WITH editorial AS (") && sql.includes("jsonb_array_elements(editorial.plan->'batches')"))
      return { rows: hasOwner ? [{ batch_index: 0, batch, output }] : [] };
    if (sql.includes("jsonb_to_recordset($3::jsonb)")) return { rows: [{ group_key: group.group_key, ref_id: refId,
      chunk_sha256: chunk, fragment: text, platform: "reddit" }] };
    return { rows: [] };
  } };
  return { database: { connect: async () => client } as never, calls };
}

test("shows only sealed per-group V1 decisions with citations verified against the exact receipt", async () => {
  const db = fakeDatabase();
  const page = await loadWorkspaceTopicLegacyEditorialOutcomesPageV1({ database: db.database, workspaceId, actorUserId,
    numericExecutionId, offset: 0, limit: 20 });
  assert.equal(page.contract_version, "workspace-topic-legacy-editorial-outcomes-page-v1");
  assert.equal(page.execution_id, stateBody.execution_key);
  assert.equal(page.saved_decision_count, 1);
  assert.equal(page.screening_batch_count, 1);
  assert.equal(page.items[0]?.outcome, "topic");
  assert.equal(page.items[0]?.phase, "screening");
  assert.equal(page.items[0]?.decision?.label, decision.candidate.label);
  assert.deepEqual(page.items[0]?.evidence, [{ id: refId, text, source: "reddit", kind: "cited" }]);
  assert.equal(db.calls.filter(call => call.sql === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY").length, 1);
  assert.equal(db.calls.filter(call => call.sql === "COMMIT").length, 1);
  assert.ok(db.calls.some(call => call.sql.includes("signal_topic_editorial_plan_valid_v1")));
});

test("reuses only a positive full-plan validation while rechecking authorization, state, page outputs, and citations", async () => {
  const db = fakeDatabase();
  const cache = new PositivePlanValidationCacheV1();
  const args = { database: db.database, workspaceId, actorUserId, numericExecutionId, offset: 0, limit: 20, planValidationCache: cache };
  const first = await loadWorkspaceTopicLegacyEditorialOutcomesPageV1(args);
  const second = await loadWorkspaceTopicLegacyEditorialOutcomesPageV1(args);
  assert.deepEqual(second, first);
  assert.equal(db.calls.filter(call => call.sql.includes("signal_topic_editorial_plan_valid_v1")).length, 1);
  assert.equal(db.calls.filter(call => call.sql.includes("workspace.status workspace_status")).length, 2);
  assert.equal(db.calls.filter(call => call.sql.includes("SELECT r.id,r.expected_group_count")).length, 2);
  assert.equal(db.calls.filter(call => call.sql.includes("SELECT editorial.id::text id")).length, 2);
  const ownerRead = db.calls.find(call => call.sql.includes("SELECT editorial.id::text id"))?.sql ?? "";
  assert.match(ownerRead, /editorial\.plan->>'plan_digest' plan_body_digest/);
  assert.doesNotMatch(ownerRead, /SELECT[^]*editorial\.plan\s*,/);
  assert.equal(db.calls.filter(call => call.sql.includes("jsonb_array_elements(editorial.plan->'batches')")).length, 2);
  assert.equal(db.calls.filter(call => call.sql.includes("jsonb_to_recordset($3::jsonb)")).length, 2);
  assert.equal(db.calls.filter(call => call.sql === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY").length, 2);
});

test("does not invent legacy decisions when no saved screening execution exists", async () => {
  const db = fakeDatabase(false);
  const page = await loadWorkspaceTopicLegacyEditorialOutcomesPageV1({ database: db.database, workspaceId, actorUserId,
    numericExecutionId, offset: 0, limit: 20 });
  assert.equal(page.execution_id, null);
  assert.equal(page.saved_decision_count, 0);
  assert.equal(page.items[0]?.outcome, "pending");
  assert.equal(page.items[0]?.decision, null);
  assert.deepEqual(page.items[0]?.evidence, []);
});

test("rejects a corrupt state digest without exposing any partial decisions", async () => {
  const db = fakeDatabase();
  const clientDb = db.database as unknown as { connect: () => Promise<{ release: () => void; query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }> };
  const originalConnect = clientDb.connect;
  clientDb.connect = async () => {
    const client = await originalConnect();
    const originalQuery = client.query;
    client.query = async (sql, params) => {
      const result = await originalQuery(sql, params);
      if (sql.includes("SELECT editorial.id::text id") && result.rows.length) {
        const row = result.rows[0] as Record<string, unknown>;
        return { rows: [{ ...row, state_digest: digest("tampered") }] };
      }
      return result;
    };
    return client;
  };
  await assert.rejects(loadWorkspaceTopicLegacyEditorialOutcomesPageV1({ database: db.database, workspaceId, actorUserId,
    numericExecutionId, offset: 0, limit: 20 }), error => error instanceof Error && "code" in error
      && error.code === "topic_editorial_legacy_state_invalid");
});

test("fails closed when the embedded plan digest differs from the persisted digest, even after a cache hit", async () => {
  const db = fakeDatabase();
  const cache = new PositivePlanValidationCacheV1();
  const args = { database: db.database, workspaceId, actorUserId, numericExecutionId, offset: 0, limit: 20, planValidationCache: cache };
  await loadWorkspaceTopicLegacyEditorialOutcomesPageV1(args);
  const clientDb = db.database as unknown as { connect: () => Promise<{ release: () => void; query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }> };
  const originalConnect = clientDb.connect;
  clientDb.connect = async () => {
    const client = await originalConnect();
    const originalQuery = client.query;
    client.query = async (sql, params) => {
      const result = await originalQuery(sql, params);
      if (sql.includes("SELECT editorial.id::text id") && result.rows.length) {
        const row = result.rows[0] as Record<string, unknown>;
        return { rows: [{ ...row, plan_body_digest: digest("different-plan") }] };
      }
      return result;
    };
    return client;
  };
  await assert.rejects(loadWorkspaceTopicLegacyEditorialOutcomesPageV1(args), error => error instanceof Error && "code" in error
    && error.code === "topic_editorial_legacy_plan_invalid");
  assert.equal(db.calls.filter(call => call.sql.includes("signal_topic_editorial_plan_valid_v1")).length, 1);
});

test("does not cache a false plan validation or a validator error", async () => {
  const db = fakeDatabase(true, false);
  const cache = new PositivePlanValidationCacheV1();
  const args = { database: db.database, workspaceId, actorUserId, numericExecutionId, offset: 0, limit: 20, planValidationCache: cache };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(loadWorkspaceTopicLegacyEditorialOutcomesPageV1(args), error => error instanceof Error && "code" in error
      && error.code === "topic_editorial_legacy_plan_invalid");
  }
  assert.equal(db.calls.filter(call => call.sql.includes("signal_topic_editorial_plan_valid_v1")).length, 2);

  const errorDb = fakeDatabase();
  const errorClientDb = errorDb.database as unknown as { connect: () => Promise<{ release: () => void; query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }> };
  const errorConnect = errorClientDb.connect;
  errorClientDb.connect = async () => {
    const client = await errorConnect();
    const originalQuery = client.query;
    client.query = async (sql, params) => {
      const result = await originalQuery(sql, params);
      if (sql.includes("SELECT signal_topic_editorial_plan_valid_v1")) throw new Error("validator unavailable");
      return result;
    };
    return client;
  };
  const errorCache = new PositivePlanValidationCacheV1();
  const errorArgs = { database: errorDb.database, workspaceId, actorUserId, numericExecutionId, offset: 0, limit: 20, planValidationCache: errorCache };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(loadWorkspaceTopicLegacyEditorialOutcomesPageV1(errorArgs), error => error instanceof Error && "code" in error
      && error.code === "topic_editorial_legacy_outcomes_unavailable");
  }
  assert.equal(errorDb.calls.filter(call => call.sql.includes("SELECT signal_topic_editorial_plan_valid_v1")).length, 2);
});

test("bounds positive entries and scopes hits by workspace, numeric execution, run, execution, digest, and validator version", () => {
  let now = 1_000;
  const cache = new PositivePlanValidationCacheV1(() => now, 100, 2);
  const identity = { workspaceId, numericExecutionId, numericRunId: runId, executionId: stateBody.execution_key, planDigest: plan.plan_digest };
  cache.remember(identity);
  assert.equal(cache.has(identity), true);
  assert.equal(cache.has({ ...identity, workspaceId: "00000000-0000-4000-8000-000000000010" }), false);
  assert.equal(cache.has({ ...identity, numericExecutionId: "00000000-0000-4000-8000-000000000011" }), false);
  assert.equal(cache.has({ ...identity, numericRunId: "00000000-0000-4000-8000-000000000012" }), false);
  assert.equal(cache.has({ ...identity, executionId: "00000000-0000-4000-8000-000000000013" }), false);
  assert.equal(cache.has({ ...identity, planDigest: digest("other-plan") }), false);
  assert.equal(cache.has(identity, "validator-v2"), false);
  cache.remember(identity, "validator-v2");
  assert.equal(cache.has(identity, "validator-v2"), true);
  now += 100;
  assert.equal(cache.has(identity), false);
  cache.remember(identity);
  cache.remember({ ...identity, executionId: "00000000-0000-4000-8000-000000000014" });
  cache.remember({ ...identity, executionId: "00000000-0000-4000-8000-000000000015" });
  assert.equal(cache.has(identity), false);
});
