import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React, { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { WorkspaceTopicAtomicMembers } from "../../components/brands/WorkspaceTopicAtomicMembers";
import { AtomicGroupMembersError, loadWorkspaceTopicAtomicGroupMembersV1 } from "./workspace-topic-atomic-members";

Object.assign(globalThis, { React });
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const workspaceId = id(1), actorUserId = id(2), numericExecutionId = id(3), groupId = id(4);
const groupKey = "open:cluster-12";

function fake(authorized: boolean, found = true, rootRows = 31) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const client = { release() { /* test connection */ }, async query(sql: string, params?: unknown[]) {
    calls.push({ sql, params });
    if (sql.includes("workspace.status workspace_status")) return { rows: [{ workspace_status: "active", brand_status: "active",
      organization_status: "active", brand_same_organization: true, actor_status: "active", user_type: "client",
      primary_role: "client_viewer", same_organization: authorized, brand_access_level: authorized ? "read" : null }] };
    if (sql.includes("SELECT g.id,g.root_count")) return { rows: found ? [{ id: groupId, root_count: 100 }] : [] };
    if (sql.includes("SELECT member.canonical_root_id root_id")) return { rows: Array.from({ length: rootRows }, (_, index) => ({
      root_id: id(100 + index), chunk_count: 2, platform: "reddit", published_at: "2026-09-12T00:00:00.000000Z",
      snippet: `Mention ${index}` })) };
    return { rows: [] };
  } };
  return { database: { connect: async () => client } as never, calls };
}

test("reads only thirty member roots with a stable keyset cursor and no corpus hydration", async () => {
  const db = fake(true);
  const page = await loadWorkspaceTopicAtomicGroupMembersV1({ database: db.database, workspaceId, actorUserId,
    numericExecutionId, groupKey, cursor: id(99) });
  assert.equal(page.root_count, 100);
  assert.equal(page.items.length, 30);
  assert.equal(page.next_cursor, id(129));
  const read = db.calls.find(call => call.sql.includes("SELECT member.canonical_root_id root_id"));
  assert.deepEqual(read?.params, [workspaceId, groupId, id(99)]);
  assert.match(read?.sql ?? "", /member\.canonical_root_id>\$3::uuid/u);
  assert.match(read?.sql ?? "", /ORDER BY member\.canonical_root_id LIMIT 31/u);
  assert.match(read?.sql ?? "", /left\(COALESCE\(NULLIF\(btrim\(mention\.text_snippet\),''\),mention\.text_clean\),240\)/u);
  assert.doesNotMatch(read?.sql ?? "", /asset\.full_text|SELECT \*/u);
});

test("final page has no cursor; access denied and foreign group reveal no member rows", async () => {
  const short = fake(true, true, 2);
  const page = await loadWorkspaceTopicAtomicGroupMembersV1({ database: short.database, workspaceId, actorUserId,
    numericExecutionId, groupKey });
  assert.equal(page.items.length, 2);
  assert.equal(page.next_cursor, null);
  const denied = fake(false);
  await assert.rejects(loadWorkspaceTopicAtomicGroupMembersV1({ database: denied.database, workspaceId, actorUserId,
    numericExecutionId, groupKey }), error => error instanceof AtomicGroupMembersError && error.status === 403);
  assert.equal(denied.calls.some(call => call.sql.includes("SELECT g.id,g.root_count")), false);
  const missing = fake(true, false);
  await assert.rejects(loadWorkspaceTopicAtomicGroupMembersV1({ database: missing.database, workspaceId, actorUserId,
    numericExecutionId, groupKey }), error => error instanceof AtomicGroupMembersError && error.status === 404);
  assert.equal(missing.calls.some(call => call.sql.includes("SELECT member.canonical_root_id root_id")), false);
});

test("invalid group, cursor and numeric scope fail before acquiring a DB connection", async () => {
  const db = fake(true);
  for (const change of [{ groupKey: "bad" }, { cursor: "1; DROP" }, { numericExecutionId: id(3) + "x" }])
    await assert.rejects(loadWorkspaceTopicAtomicGroupMembersV1({ database: db.database, workspaceId, actorUserId,
      numericExecutionId, groupKey, ...change }), /topic_atomic_members_request_invalid/u);
  assert.equal(db.calls.length, 0);
});

test("member list stays closed and does not fetch until opened", async () => {
  const messages = JSON.parse(await readFile(new URL("../../../messages/es-MX.json", import.meta.url), "utf8"));
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale: "es-MX", messages, timeZone: "UTC" } as ComponentProps<typeof NextIntlClientProvider>,
    createElement(WorkspaceTopicAtomicMembers, { workspaceId, numericExecutionId, groupKey,
      mentionsHref: "/signal/alexa/mentions" })));
  assert.match(html, /aria-expanded="false"/u);
  assert.match(html, /Ver todas las menciones del grupo/u);
  assert.doesNotMatch(html, /Cargando menciones|Mention 0/u);
  const source = await readFile(new URL("../../components/brands/WorkspaceTopicAtomicMembers.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(!open\) return;/u);
  assert.match(source, /\?mention=\$\{encodeURIComponent\(item\.root_id\)\}/u);
});
