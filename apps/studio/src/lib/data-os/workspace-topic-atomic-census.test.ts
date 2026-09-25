import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React, { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { WorkspaceTopicAtomicCensus } from "../../components/brands/WorkspaceTopicAtomicCensus";
import { AtomicCensusReadError, loadWorkspaceTopicAtomicCensusPageV1 } from "./workspace-topic-atomic-census";

Object.assign(globalThis, { React });

const workspaceId = "00000000-0000-4000-8000-000000000001";
const actorUserId = "00000000-0000-4000-8000-000000000002";
const numericExecutionId = "00000000-0000-4000-8000-000000000003";
const groupId = "00000000-0000-4000-8000-000000000004";
const rootId = "00000000-0000-4000-8000-000000000005";

function database(allowed: boolean, revision: string | null = null, hasEvidence = true) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const client = { release() { /* test connection */ }, async query(sql: string, params?: unknown[]) {
    calls.push({ sql, params });
    if (sql.includes("workspace.status workspace_status")) return { rows: [{ workspace_status: "active", brand_status: "active",
      organization_status: "active", brand_same_organization: true, actor_status: "active", user_type: "client",
      primary_role: "client_viewer", same_organization: allowed, brand_access_level: allowed ? "read" : null }] };
    if (sql.includes("SELECT r.id,r.expected_group_count")) return { rows: [{ id: groupId, expected_group_count: 1_652, revision_id: revision }] };
    if (sql.includes("count(*)::integer count")) return { rows: [{ count: 1 }] };
    if (sql.includes("SELECT g.id,g.group_key")) return { rows: [{ id: groupId, group_key: "open:cluster-12", lane: "open",
      root_count: 30, chunk_count: 37, terms: ["alexa", "screen"], disposition: revision ? "topic" : null,
      concept_label: revision ? "Screen experience" : null }] };
    if (sql.includes("SELECT sample.atomic_group_id")) return { rows: hasEvidence ? [{ atomic_group_id: groupId, canonical_root_id: rootId,
      chunk_sha256: `sha256:${createHash("sha256").update("real", "utf8").digest("hex")}`,
      fragment: "real", platform: "reddit", locale: "en" }] : [] };
    if (sql.includes("SELECT g.id atomic_group_id,first_root.canonical_root_id"))
      return { rows: [{ atomic_group_id: groupId, canonical_root_id: rootId }] };
    return { rows: [] };
  } };
  return { database: { connect: async () => client } as never, calls };
}

test("one server-side page uses the exact workspace, numeric run, bounded offset and cited root", async () => {
  const db = database(true);
  const page = await loadWorkspaceTopicAtomicCensusPageV1({ database: db.database, workspaceId, actorUserId,
    numericExecutionId, page: 2, query: "alexa" });
  assert.equal(page.total, 1_652);
  assert.equal(page.matching, 1);
  assert.equal(page.revision_status, "pending");
  assert.deepEqual(page.items[0]?.evidence, [{ root_id: rootId, text: "real", platform: "reddit", locale: "en" }]);
  const list = db.calls.find(call => call.sql.includes("SELECT g.id,g.group_key"));
  assert.deepEqual(list?.params, [workspaceId, groupId, "alexa", null, 20]);
  assert.match(list?.sql ?? "", /LIMIT 20 OFFSET \$5::integer/u);
  assert.ok(db.calls.some(call => call.sql.includes("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")));
  assert.ok(db.calls.some(call => call.sql === "COMMIT"));
});

test("only a validated revision reveals its real concept, without inventing a decision for an incomplete review", async () => {
  const db = database(true, numericExecutionId);
  const page = await loadWorkspaceTopicAtomicCensusPageV1({ database: db.database, workspaceId, actorUserId,
    numericExecutionId, page: 1, query: "" });
  assert.equal(page.revision_status, "validated");
  assert.equal(page.items[0]?.concept_label, "Screen experience");
});

test("a group with no representative text still links one actual member root", async () => {
  const db = database(true, null, false);
  const page = await loadWorkspaceTopicAtomicCensusPageV1({ database: db.database, workspaceId, actorUserId,
    numericExecutionId, page: 1, query: "" });
  assert.deepEqual(page.items[0]?.evidence, [{ root_id: rootId, text: null, platform: null, locale: null }]);
  assert.deepEqual(db.calls.find(call => call.sql.includes("SELECT g.id atomic_group_id,first_root.canonical_root_id"))?.params,
    [workspaceId, groupId, [groupId]]);
});

test("revoked brand access returns no census rows", async () => {
  const db = database(false);
  await assert.rejects(loadWorkspaceTopicAtomicCensusPageV1({ database: db.database, workspaceId, actorUserId,
    numericExecutionId, page: 1, query: "" }), error => error instanceof AtomicCensusReadError && error.status === 403);
  assert.equal(db.calls.some(call => call.sql.includes("SELECT r.id,r.expected_group_count")), false);
  assert.ok(db.calls.some(call => call.sql === "ROLLBACK"));
});

test("invalid scope, page and query fail before acquiring a connection", async () => {
  const db = database(true);
  for (const changed of [{ workspaceId: "other" }, { page: 0 }, { page: 501 }, { query: "x".repeat(101) }]) {
    await assert.rejects(loadWorkspaceTopicAtomicCensusPageV1({ database: db.database, workspaceId, actorUserId,
      numericExecutionId, page: 1, query: "", ...changed }), /topic_atomic_census_request_invalid/u);
  }
  assert.equal(db.calls.length, 0);
});

test("the original group census is collapsed by default and offers an accessible opt-in", async () => {
  const messages = JSON.parse(await readFile(new URL("../../../messages/es-MX.json", import.meta.url), "utf8"));
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale: "es-MX", messages, timeZone: "UTC" } as ComponentProps<typeof NextIntlClientProvider>,
    createElement(WorkspaceTopicAtomicCensus, { workspaceId, numericExecutionId, mentionsHref: "/signal/alexa/mentions" })));
  assert.match(html, /aria-expanded="false"/u);
  assert.match(html, /aria-controls="[^"]+"/u);
  assert.match(html, /Explorar grupos/u);
  assert.doesNotMatch(html, /Cargando grupos|topics-manager__atomic-groups|Ver mención/u);
  const source = await readFile(new URL("../../components/brands/WorkspaceTopicAtomicCensus.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(!open\) return;/u);
});
