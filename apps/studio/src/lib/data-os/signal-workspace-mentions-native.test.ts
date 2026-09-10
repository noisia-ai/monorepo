import assert from "node:assert/strict";
import test from "node:test";
import type { SignalWorkspaceMentionsPageV1 } from "@noisia/db";
import { loadNativeSignalMentionsV1, nativeMentionsErrorResponseV1,
  nativeMentionsQueryV1, nativeMentionsViewDataV1 } from "./signal-workspace-mentions-native";

const workspace = "10000000-0000-0000-0000-000000000001", actor = "10000000-0000-0000-0000-000000000002";
const mention = "10000000-0000-0000-0000-000000000003", digest = `sha256:${"a".repeat(64)}`;
const scope = { workspace_id: workspace, actor_user_id: actor };
function page(): SignalWorkspaceMentionsPageV1 {
  return { contract_version: "signal-workspace-mentions-v1", workspace_id: workspace, generation_id: "generation",
    source_engine_execution_id: "engine", is_current: true, is_processing: false, scope_digest: digest,
    filters: { date_from: null, date_to: null, search_query: null, platforms: [] },
    sort: { field: "published", direction: "desc" }, available_dates: { date_from: "2026-01-01", date_to: "2026-09-01" },
    available_platforms: ["web", "x"],
    metric_denominator: 8, evidence_visible_total: 6, total_count: 6, withheld_evidence_count: 1, integrity_withheld_count: 1,
    items: [{ mention_id: mention, occurred_at: null, text_snippet: "A real unassigned conversation", text_truncated: false, title: null,
      url: null, platform: "web", language: "es", country: "MX", content_type: null, engagement: {}, thread_key: mention,
      resolution_state: "abstained", has_unresolved_topics: true }], page_offset: 0, next_cursor: "next" };
}

test("native dates, literal search and repeated platforms preserve their exact meaning", () => {
  assert.deepEqual(nativeMentionsQueryV1(new URLSearchParams("start=2026-01-01&end=2026-09-01&q=50%25_off&platform=web&platform=x&platform=web&direction=asc")), {
    date_from: "2026-01-01", date_to: "2026-09-01", search_query: "50%_off", platforms: ["web", "x"],
    sort_direction: "asc", limit: 50
  });
  assert.deepEqual(nativeMentionsQueryV1(new URLSearchParams()), { platforms: [], sort_direction: "desc", limit: 50 });
});

test("unsupported dimensions, ambiguous aliases, malformed limits and fabricated scopes fail closed", () => {
  for (const query of ["view=brand", "view=all_conversations&view=brand", "timezone=America/Mexico_City",
    "compare=previous_period", "dimension.topic=one", "dimension.platform=web", "metric_key=topic.volume",
    "sort=engagement", "sort=platform", "offset=1", "start=2026-02-30", "start=0000-01-01", "start=",
    "start=2026-09-01&end=2026-01-01", "start=2026-01-01&date_from=2026-01-02", "q=a&q=b",
    "limit=101", "limit=0", "limit=", "limit=1.2", "limit=1e1", "limit=%20", "platform=",
    "direction=DESC", "scope_digest=other", "cursor=", "mention=private", `cursor=opaque&mention=${mention}`,
    "actor_user_id=other", "generation_id=other", "q=%00"]) {
    assert.throws(() => nativeMentionsQueryV1(new URLSearchParams(query)), error =>
      Boolean(error && typeof error === "object" && "status" in error && error.status === 422), query);
  }
});

test("paging and focus pass only the server-authorized caller with the exact native scope", async () => {
  let seen: unknown;
  const read = async (args: unknown) => { seen = args; return page(); };
  const result = await loadNativeSignalMentionsV1(scope,
    new URLSearchParams(`mention=${mention}&scope_digest=${digest}&view=all_conversations&limit=25`), { read });
  assert.deepEqual(seen, { ...scope, platforms: [], sort_direction: "desc", limit: 25,
    expected_scope_digest: digest, focus_mention_id: mention });
  assert.equal(result?.record?.subject_id, mention);
  assert.equal(result?.native.generation_id, "generation");
  assert.equal(result?.filters_hash, digest);
});

test("all-time evidence retains undated and unassigned roots without fabricating legacy attribution", () => {
  const result = nativeMentionsViewDataV1(page(), 50);
  assert.equal(result.native.filters.date_from, null);
  assert.equal(result.records[0]?.occurred_at, "");
  assert.equal(result.records[0]?.text_snippet, "A real unassigned conversation");
  assert.deepEqual(result.records[0]?.tags, []);
  assert.deepEqual(result.records[0]?.attribution, []);
  assert.equal(result.records[0]?.tb_classification, null);
  assert.equal(result.records[0]?.sentiment, null);
  assert.equal(result.native.metric_denominator, 8);
  assert.equal(result.native.evidence_visible_total, 6);
  assert.equal(result.total_count, 6);
  assert.equal(result.native.withheld_evidence_count, 1);
  assert.equal(result.native.integrity_withheld_count, 1);
  assert.deepEqual(result.native.available_platforms, ["web", "x"]);
});

test("a valid uppercase focus UUID resolves the same canonical mention", async () => {
  const id = "abcdefab-cdef-abcd-efab-cdefabcdefab";
  const result = await loadNativeSignalMentionsV1(scope, new URLSearchParams(`mention=${id.toUpperCase()}`), {
    read: async args => {
      assert.equal(args.focus_mention_id, id);
      const value = page(); value.items[0]!.mention_id = id;
      return value;
    }
  });
  assert.equal(result?.record?.subject_id, id);
});

test("effective search count and cursor presentation never replace the metric denominator", () => {
  const source = page();
  source.filters.search_query = "conversation"; source.total_count = 2; source.page_offset = 1; source.next_cursor = null;
  const result = nativeMentionsViewDataV1(source, 1);
  assert.equal(result.total_count, 2); assert.equal(result.native.metric_denominator, 8);
  assert.equal(result.page.offset, 1); assert.equal(result.page.next_offset, null);
  assert.equal(result.filter.search_query, "conversation");
});

test("a direct page exposes its cursor for back navigation only after the reader validates it", async () => {
  const result = await loadNativeSignalMentionsV1(scope, new URLSearchParams("cursor=validated-current-page&limit=50"), {
    read: async args => {
      assert.equal(args.cursor, "validated-current-page");
      return { ...page(), page_offset: 50 };
    }
  });
  assert.equal(result?.page.offset, 50);
  assert.equal(result?.native.page_cursor, "validated-current-page");
  assert.equal(nativeMentionsViewDataV1(page(), 50).native.page_cursor, null);
  await assert.rejects(loadNativeSignalMentionsV1(scope, new URLSearchParams("cursor=unverified"), {
    read: async () => { throw Object.assign(new Error("cursor rejected"), { status: 409 }); }
  }), /cursor rejected/);
});

test("original mention links allow web URLs without turning imported content into executable links", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,private", "/relative", "https://user:password@example.test/x"]) {
    const source = page(); source.items[0]!.url = url;
    assert.equal(nativeMentionsViewDataV1(source, 50).records[0]?.url, null);
  }
  const source = page(); source.items[0]!.url = "https://example.test/mention/123";
  assert.equal(nativeMentionsViewDataV1(source, 50).records[0]?.url, source.items[0]!.url);
});

test("a native invalid query is rejected after detection and cannot return an unfiltered page", async () => {
  const calls: unknown[] = [];
  await assert.rejects(loadNativeSignalMentionsV1(scope, new URLSearchParams("dimension.topic=one"), {
    read: async args => { calls.push(args); return page(); }
  }), /mention filters/);
  assert.deepEqual(calls, [{ ...scope, limit: 1 }]);
});

test("native detection preserves the existing non-native branch without exposing a native fallback", async () => {
  assert.equal(await loadNativeSignalMentionsV1(scope, new URLSearchParams("dimension.topic=one"), { read: async () => null }), null);
  assert.equal(await loadNativeSignalMentionsV1(scope, new URLSearchParams("view=brand"), {
    read: async () => { throw new Error("not invoked"); }
  }), null);
});

test("denied, stale, changed scope and inaccessible focus never return retained records", async () => {
  for (const status of [401, 403, 404, 409]) {
    const error = Object.assign(new Error("private detail must not be returned"), { code: "workspace_mentions_scope_changed", status });
    await assert.rejects(loadNativeSignalMentionsV1(scope, new URLSearchParams(), { read: async () => { throw error; } }), error);
    const response = nativeMentionsErrorResponseV1(error);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(JSON.stringify(await response.json()).includes("private detail"), false);
  }
  await assert.rejects(loadNativeSignalMentionsV1(scope, new URLSearchParams(), { read: async () => ({ ...page(), workspace_id: "other" }) }), /changed/);
  assert.throws(() => nativeMentionsViewDataV1({ ...page(), items: [] }, 50, mention), /unavailable/);
});

test("unexpected storage errors become an unavailable response without internal messages", async () => {
  const response = nativeMentionsErrorResponseV1(new Error("private SQL and connection string"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "workspace_mentions_unavailable",
    message: "Mentions could not be loaded. Refresh and try again." });
});
