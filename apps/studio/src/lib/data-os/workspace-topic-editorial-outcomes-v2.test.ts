import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { EditorialOutcomeReadError, loadWorkspaceTopicEditorialOutcomesPageV2 } from "./workspace-topic-editorial-outcomes-v2";
import { parseWorkspaceTopicEditorialOutcomesPageV2 } from "../../components/brands/WorkspaceTopicEditorialOutcomes";
import { WorkspaceTopicEvidenceMentionLink, workspaceTopicEvidenceHref } from "../../components/brands/workspace-topic-evidence-link";

Object.assign(globalThis, { React });

const workspaceId = "00000000-0000-4000-8000-000000000001";
const actorUserId = "00000000-0000-4000-8000-000000000002";
const numericExecutionId = "00000000-0000-4000-8000-000000000003";
const runId = "00000000-0000-4000-8000-000000000004";
const rootId = "00000000-0000-4000-8000-000000000005";
const editorialExecutionId = "00000000-0000-4000-8000-000000000006";
const items = ["topic", "narrative", "noise", "insufficient", "technical", "pending"].map((group_key, index) => ({
  group_key: `open:${group_key}`, outcome: group_key, phase: group_key === "pending" ? "pending" : "screening",
  decision: { disposition: group_key === "insufficient" ? "unresolved" : group_key, label: index < 2 ? `Label ${index}` : null,
    definition: index < 2 ? `Definition ${index}` : null, locale: index < 2 ? "en-US" : null,
    rationale: index < 4 ? `Rationale ${index}` : null, confidence: index < 4 ? 0.8 : null,
    source: index < 4 ? "model" : null, digest: null, cited_evidence_refs: index === 0 ? ["sha256:ref"] : [] },
  technical_error_code: group_key === "technical" ? "topic_editorial_v2_output_invalid" : null,
  transport_state: group_key === "pending" ? "outcome_unknown" : "accepted",
  evidence: [{ id: `${rootId.slice(0, -1)}${index}`, root_id: `${rootId.slice(0, -1)}${index}`, text: "representative", source: "reddit", locale: "en-US", kind: "representative" }],
}));

function database(allowed = true, hasOwner = true, hasRevision = false) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const client = { release() {}, async query(sql: string, params?: unknown[]) {
    calls.push({ sql, params });
    if (sql.includes("workspace.status workspace_status")) return { rows: [{ workspace_status: "active", brand_status: "active",
      organization_status: "active", brand_same_organization: true, actor_status: "active", user_type: "client",
      primary_role: "client_viewer", same_organization: allowed, brand_access_level: allowed ? "read" : null }] };
    if (sql.includes("SELECT r.id,r.expected_group_count")) return { rows: [{ id: runId, expected_group_count: 6,
      revision_id: hasRevision ? numericExecutionId : null }] };
    if (sql.includes("count(*)::integer count")) return { rows: [{ count: 6 }] };
    if (sql.includes("SELECT g.id,g.group_key")) return { rows: items.map(item => ({ id: item.group_key, group_key: item.group_key,
      lane: "open", root_count: 1, chunk_count: 1, terms: [item.group_key],
      disposition: hasRevision ? "topic" : null, concept_label: hasRevision ? "Saved topic" : null })) };
    if (sql.includes("SELECT sample.atomic_group_id")) return { rows: items.map(item => ({ atomic_group_id: item.group_key,
      canonical_root_id: rootId, chunk_sha256: `sha256:${createHash("sha256").update("sample").digest("hex")}`,
      fragment: "sample", platform: "reddit", locale: "en-US" })) };
    if (sql.includes("SELECT editorial.id::text execution_id")) return { rows: [{ execution_id: hasOwner ? editorialExecutionId : null }] };
    if (sql.includes("WITH numeric AS (") && sql.includes("latest_v2 AS")) return { rows: hasOwner ? items.map((item, index) => ({
      group_key: item.group_key, editorial_execution_id: editorialExecutionId, category: item.outcome,
      phase: item.phase, label: item.decision.label, definition: item.decision.definition, locale: item.decision.locale,
      rationale: item.decision.rationale, confidence: item.decision.confidence, source: item.decision.source,
      decision_digest: null, evidence_refs: index === 0 ? ["sha256:ref"] : [],
      error_code: item.technical_error_code, transport_state: item.transport_state,
    })) : [] };
    if (sql.includes("WITH numeric AS (") && sql.includes("jsonb_to_recordset")) return { rows: [{
      group_key: "open:topic", ref_id: "sha256:ref", root_id: rootId,
      chunk_sha256: `sha256:${createHash("sha256").update("sample").digest("hex")}`,
      fragment: "sample", platform: "reddit", locale: "en-US",
    }] };
    return { rows: [] };
  } };
  return { database: { connect: async () => client } as never, calls };
}

test("returns saved editorial states separately and keeps ambiguous delivery pending", async () => {
  const db = database();
  const timings: Array<{ phase: string; durationMs: number }> = [];
  const page = await loadWorkspaceTopicEditorialOutcomesPageV2({ database: db.database, workspaceId, actorUserId,
    numericExecutionId, editorialExecutionId, offset: 0, limit: 20,
    onPhaseTiming: (phase, durationMs) => timings.push({ phase, durationMs }) });
  assert.equal(page.contract_version, "workspace-topic-editorial-outcomes-page-v2");
  assert.equal(page.execution_id, editorialExecutionId);
  assert.deepEqual(page.items.map((item: { outcome: string }) => item.outcome),
    ["topic", "narrative", "noise", "insufficient", "technical", "pending"]);
  assert.equal(page.items[0]?.decision?.label, "Label 0");
  assert.equal(page.items[0]?.evidence[0]?.id, "sha256:ref");
  assert.equal(page.items[0]?.evidence[0]?.root_id, rootId);
  assert.equal(page.items[0]?.evidence[0]?.kind, "cited");
  assert.deepEqual(Object.keys(page.items[0]!.evidence[0]!).sort(), ["id", "kind", "root_id", "source", "text"]);
  assert.equal(db.calls.filter(call => call.sql === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY").length, 1,
    "census, outcome and evidence reads share one snapshot");
  assert.equal(db.calls.filter(call => call.sql === "COMMIT").length, 1);
  assert.equal(db.calls.some(call => call.sql === "ROLLBACK"), false);
  assert.deepEqual(page.items[1]?.evidence, [], "screening decisions without citations do not inherit representative evidence");
  assert.equal(page.items[3]?.decision?.disposition, "unresolved");
  assert.equal(page.items[4]?.technical_error_code, "topic_editorial_v2_output_invalid");
  assert.equal(page.items[4]?.decision, null);
  assert.equal(page.items[5]?.decision, null);
  assert.equal(page.items[5]?.transport_state, "outcome_unknown");
  assert.ok(db.calls.some(call => call.sql === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"));
  assert.ok(db.calls.some(call => call.sql.includes("workspace_id=$1::uuid") && call.sql.includes("execution.id=$2::uuid")
    && call.sql.includes("group_row.group_key=ANY($3::text[])")));
  const outcomeSql = db.calls.find(call => call.sql.includes("latest_v2 AS"))?.sql ?? "";
  assert.match(outcomeSql, /request_row\.receipts->'request'->'receipt'->>'group_key'/u);
  assert.match(outcomeSql, /revision\.status='validated'/u);
  assert.match(outcomeSql, /screened\.outcome IN\('errored','canceled','expired','submission_rejected'\)/u);
  assert.deepEqual(timings.map(item => item.phase), ["db_connect", "snapshot_start", "census_access", "owner_read",
    "outcomes_read", "citations_read", "citation_mapping", "snapshot_commit", "response_assembly"]);
  assert.ok(timings.every(item => Number.isFinite(item.durationMs) && item.durationMs >= 0));
});

test("timing instrumentation failure cannot change the bounded read result", async () => {
  const page = await loadWorkspaceTopicEditorialOutcomesPageV2({ database: database().database, workspaceId, actorUserId,
    numericExecutionId, editorialExecutionId, offset: 0, limit: 20, onPhaseTiming: () => { throw new Error("telemetry failed"); } });
  assert.equal(page.items.length, 6);
  assert.equal(page.contract_version, "workspace-topic-editorial-outcomes-page-v2");
});

test("uses page-sized stable offsets and rejects invalid or unbounded paging before connecting", async () => {
  const db = database();
  for (const changed of [{ offset: -1 }, { offset: 1 }, { offset: 10_000 }, { limit: 0 }, { limit: 21 }]) {
    await assert.rejects(loadWorkspaceTopicEditorialOutcomesPageV2({ database: db.database, workspaceId, actorUserId,
    numericExecutionId, offset: 0, limit: 20, ...changed }),
    error => error instanceof EditorialOutcomeReadError && error.status === 422);
  }
  assert.equal(db.calls.length, 0);
});

test("rejects a stale editorial execution so a successor cannot replace the caller's snapshot", async () => {
  const db = database();
  await assert.rejects(loadWorkspaceTopicEditorialOutcomesPageV2({ database: db.database, workspaceId, actorUserId,
    numericExecutionId, editorialExecutionId: "00000000-0000-4000-8000-000000000099", offset: 0, limit: 20 }),
  error => error instanceof EditorialOutcomeReadError && error.code === "topic_editorial_outcomes_execution_stale");
  assert.equal(db.calls.some(call => call.sql.includes("latest_v2 AS")), false);
});

test("revoked workspace access prevents the outcomes query", async () => {
  const db = database(false);
  await assert.rejects(loadWorkspaceTopicEditorialOutcomesPageV2({ database: db.database, workspaceId, actorUserId,
    numericExecutionId, offset: 0, limit: 20 }), error => error instanceof Error && "status" in error && error.status === 403);
  assert.equal(db.calls.some(call => call.sql.includes("latest_v2 AS")), false);
});

test("an execution with no V2 owner returns honest pending rows without a decision", async () => {
  const db = database(true, false);
  const page = await loadWorkspaceTopicEditorialOutcomesPageV2({ database: db.database, workspaceId, actorUserId,
    numericExecutionId, offset: 0, limit: 20 });
  assert.equal(page.execution_id, null);
  assert.ok(page.items.every((item: { outcome: string; decision: unknown }) => item.outcome === "pending" && item.decision === null));
  assert.deepEqual(page.items[0]?.evidence, []);
});

test("a validated catalog may use representative evidence when no citation lineage is stored", async () => {
  const db = database(true, false, true);
  const page = await loadWorkspaceTopicEditorialOutcomesPageV2({ database: db.database, workspaceId, actorUserId,
    numericExecutionId, offset: 0, limit: 20 });
  assert.equal(page.items[0]?.phase, "consolidated");
  assert.equal(page.items[0]?.decision?.label, "Saved topic");
  assert.equal(page.items[0]?.evidence[0]?.id, rootId);
  assert.equal(page.items[0]?.evidence[0]?.root_id, rootId);
  assert.equal(page.items[0]?.evidence[0]?.kind, "representative");
  assert.deepEqual(Object.keys(page.items[0]!.evidence[0]!).sort(), ["id", "kind", "root_id", "source", "text"]);
  const parsed = parseWorkspaceTopicEditorialOutcomesPageV2(page, { workspaceId, numericExecutionId,
    executionId: null, offset: 0 });
  assert.ok(parsed);
  assert.equal(parsed.items[0]?.evidence[0]?.root_id, rootId);
  assert.equal(workspaceTopicEvidenceHref("/signal/alexa-plus/mentions", parsed.items[0]!.evidence[0]!.root_id),
    `/signal/alexa-plus/mentions?mention=${rootId}`);
  const malformed = structuredClone(page) as typeof page;
  malformed.items[0]!.evidence[0]!.id = "00000000-0000-4000-8000-000000000099";
  assert.equal(parseWorkspaceTopicEditorialOutcomesPageV2(malformed, { workspaceId, numericExecutionId,
    executionId: null, offset: 0 }), null, "representative link identity must match its evidence identity");
});

test("a cited reference opens its canonical mention root, not its evidence digest", () => {
  const html = renderToStaticMarkup(createElement(WorkspaceTopicEvidenceMentionLink,
    { mentionsHref: "/signal/alexa-plus/mentions", rootId }, "Open source mention"));
  assert.match(html, new RegExp(`href="/signal/alexa-plus/mentions\\?mention=${rootId}"`, "u"));
  assert.match(html, />Open source mention<\/a>/u);
  assert.equal(workspaceTopicEvidenceHref("/signal/alexa-plus/mentions", rootId), `/signal/alexa-plus/mentions?mention=${rootId}`);
  assert.notEqual(workspaceTopicEvidenceHref("/signal/alexa-plus/mentions", rootId), "/signal/alexa-plus/mentions?mention=sha256%3Aref");
});
