import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadSignalWorkspaceMentionsV1, type SignalWorkspaceMentionsArgsV1 } from "../signal-workspace-topics-serving";

const database: SignalWorkspaceMentionsArgsV1["database"] = { connect: async () => { throw new Error("unexpected_database_access"); } };
const access = { database, workspace_id: randomUUID(), actor_user_id: randomUUID() };
const scope = `sha256:${"a".repeat(64)}`;
const sha = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const cursor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const valid = { version: 1, root_id: randomUUID(), occurred_at: "2026-09-09T01:02:03.123456Z", scope, offset: 1 };
const servingSource = readFileSync(new URL("../signal-workspace-topics-serving.ts", import.meta.url), "utf8");

test("mentions scope uses a constant-state population fingerprint without concatenating every root", () => {
  assert.doesNotMatch(servingSource, /string_agg\(jsonb_build_array\(root\.root_id,root\.metrics,root\.evidence/u);
  assert.match(servingSource, /hashtextextended\(ROW\(checked\.root_id,checked\.metrics,checked\.evidence,/u);
  assert.match(servingSource, /bit_xor\(root\.population_hash\)/u);
  assert.match(servingSource, /sum\(root\.population_hash::numeric\)/u);
  assert.match(servingSource, /fingerprint: \{ xor: summary\.population_fingerprint_xor, sum: summary\.population_fingerprint_sum \}/u);
  assert.match(servingSource, /generation: ctx\.generation\.id, finalized_digest: ctx\.generation\.finalized_digest, input_revision: ctx\.generation\.current_revision/u);
  assert.match(servingSource, /rights: summary\.rights_digest, population:/u);
  assert.match(servingSource, /filters: request\.filters, direction: request\.direction/u);
  assert.match(servingSource, /const ctx = await mentionsContext\(client, access\)/u);
  assert.match(servingSource, /Mentions are a generation-wide corpus view/u);
  assert.match(servingSource, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;[\s\S]*SET LOCAL enable_nestloop=off; SET LOCAL jit=off/u);
});

test("mentions uses the workspace corpus fence without rebuilding unrelated editorial context", async () => {
  const workspace = randomUUID(), actor = randomUUID(), generation = randomUUID(), preparation = randomUUID();
  const statements: string[] = [];
  const client = { async query(sql: string) {
    statements.push(sql);
    if (sql.startsWith("BEGIN") || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
    if (sql.includes("brand_access_level")) return { rows: [{ workspace_status: "active", brand_status: "active",
      organization_status: "active", brand_same_organization: true, actor_status: "active",
      user_type: "noisia_internal", primary_role: "noisia_admin", same_organization: false, brand_access_level: null }] };
    if (sql.includes("candidate.input_contract='workspace-topic-classification-v1'")) return { rows: [{
      native: true, is_processing: false, id: generation, taxonomy_profile_id: randomUUID(), preparation_run_id: preparation,
      input_revision: "7", current_revision: "7", finalized_digest: sha("f"), policy_live: true,
      source_engine_execution_id: randomUUID(), interpretation_coverage: null, identity: {},
      correction_digest: sha("c"), source_valid: true
    }] };
    if (sql.includes("mention_roots AS MATERIALIZED")) return { rows: [{ metric_denominator: 0,
      evidence_visible_total: 0, total_count: 0, withheld_evidence_count: 0, integrity_withheld_count: 0,
      rights_digest: sha("r"), population_fingerprint_xor: "0", population_fingerprint_sum: "0",
      date_from: null, date_to: null, available_platforms: [], cursor_exists: true, cursor_offset: 0,
      item: null, focus_only: null }] };
    throw new Error(`unexpected query: ${sql.slice(0, 100)}`);
  }, release() {} };
  const page = await loadSignalWorkspaceMentionsV1({ database: { async connect() { return client as never; } },
    workspace_id: workspace, actor_user_id: actor });
  assert.ok(page); assert.equal(page.total_count, 0); assert.equal(page.generation_id, generation);
  assert.equal(statements.length, 5, "setup, authority, workspace fence, corpus and commit are the only roundtrips");
  const corpus = statements.findIndex(sql => sql.includes("mention_roots AS MATERIALIZED"));
  assert.equal(statements.slice(0, corpus).some(sql => sql.includes("brand_objective") || sql.includes("taxonomy_terms")), false);
});

test("mentions rejects unsupported filters, unsafe bounds and malformed dates before reading content", async () => {
  for (const change of [
    { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { sort_direction: "desc; SELECT" },
    { search_query: "a".repeat(301) }, { search_query: "a\0b" }, { platforms: [""] },
    { platforms: ["x\0y"] }, { platforms: "x" }, { platforms: Array(33).fill("x") },
    { workspace_id: "wrong" }, { actor_user_id: "wrong" }, { focus_mention_id: "wrong" },
    { focus_mention_id: randomUUID(), cursor: cursor(valid) }, { expected_scope_digest: "anything" },
  ]) await assert.rejects(loadSignalWorkspaceMentionsV1({ ...access, ...change } as SignalWorkspaceMentionsArgsV1), /workspace_mentions_request_invalid/u);
  for (const change of [{ date_from: "2026-02-30" }, { date_to: "2026-13-01" }, { date_from: "2026-09-10", date_to: "2026-09-09" }])
    await assert.rejects(loadSignalWorkspaceMentionsV1({ ...access, ...change }), /workspace_topics_date_invalid/u);
});

test("mentions cursors reject malformed scope, timestamps, extra fields and unsafe presentation offsets", async () => {
  for (const value of [null, [], {}, { ...valid, version: 2 }, { ...valid, root_id: "wrong" }, { ...valid, scope: "wrong" },
    { ...valid, offset: -1 }, { ...valid, offset: 1.5 }, { ...valid, offset: Number.MAX_SAFE_INTEGER },
    { ...valid, occurred_at: "2026-09-09" }, { ...valid, occurred_at: "2026-09-09T99:00:00.000000Z" },
    { ...valid, occurred_at: "2026-02-31T01:02:03.000000Z" },
    { ...valid, arbitrary: "ignored?" }, { ...valid, offset: "1" }])
    await assert.rejects(loadSignalWorkspaceMentionsV1({ ...access, cursor: cursor(value) }), /workspace_mentions_cursor_invalid/u);
  for (const value of ["", "=padding=", "a".repeat(2049)])
    await assert.rejects(loadSignalWorkspaceMentionsV1({ ...access, cursor: value }), /workspace_mentions_cursor_invalid/u);
});
