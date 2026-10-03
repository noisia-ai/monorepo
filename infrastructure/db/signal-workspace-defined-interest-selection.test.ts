import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { prepareSignalWorkspaceDefinedInterestOverlayV1 } from "./signal-workspace-topics-serving";
import { loadSignalWorkspaceDefinedInterestSelectionV1,
  mutateSignalWorkspaceDefinedInterestSelectionV1 } from "./signal-workspace-defined-interest-selection";

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const sha = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const workspace_id = id("1"), actor_user_id = id("2"), snapshot_id = id("3"), generation_id = id("4"), taxonomy_term_id = id("5");
const command = { term_key: "activation-consent", selected: true, snapshot_id, expected_snapshot_digest: sha("a"),
  generation_id, taxonomy_term_id, definition_digest: sha("b"), definition_revision: 2,
  expected_selection_revision: 0 };
const selection = { workspace_id, snapshot_id, generation_id, taxonomy_term_id, term_key: command.term_key,
  definition_digest: command.definition_digest, definition_revision: 2, selected: true as const,
  selection_revision: 1, selection_digest: sha("c"), operation_id: id("6") };

test("SQL0212 keeps a separate reversible receipt with CAS, replay, current approval, rights and ACL guards", () => {
  const sql = readFileSync(new URL("./migrations/0212_signal_defined_interest_selection.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE signal_defined_interest_selection_operations/u);
  assert.match(sql, /CREATE TABLE signal_defined_interest_selections/u);
  assert.match(sql, /UNIQUE\(workspace_id,idempotency_key\)/u);
  assert.match(sql, /expected_selection_revision/u);
  assert.match(sql, /defined_interest_selection_revision_conflict/u);
  assert.match(sql, /defined_interest_selection_idempotency_conflict/u);
  assert.match(sql, /is_selected:=\(payload->>'selected'\)::boolean/u);
  assert.match(sql, /assignment.disposition='approved'/u);
  assert.match(sql, /signal_workspace_classification_assignment_current_v1\(assignment,generation\)/u);
  assert.match(sql, /signal_topic_consolidation_snapshot_current_v1\(snapshot.id\)/u);
  assert.doesNotMatch(sql, /signal_topic_consolidation_snapshot_roots_v1 roots/u,
    "overlap changes the displayed count, never the validity of a selected interest");
  assert.match(sql, /selected.snapshot_id IS NULL OR binding.snapshot_id=selected.snapshot_id/u);
  assert.match(sql, /COALESCE\(\(payload->>'snapshot_id'\)::uuid,binding_snapshot_id\)/u);
  assert.doesNotMatch(sql, /generation.preparation_run_id\s*(?:IS DISTINCT FROM|=)\s*snapshot.preparation_run_id/u);
  assert.match(sql, /client-derived-metrics/u);
  assert.match(sql, /client-text-or-excerpt/u);
  assert.match(sql, /CREATE TRIGGER defined_interest_selection_guard/u);
  assert.match(sql, /REVOKE ALL ON signal_defined_interest_selection_operations,signal_defined_interest_selections FROM PUBLIC/u);
  assert.doesNotMatch(sql, /UPDATE signal_topic_consolidation_bindings/u);
  assert.doesNotMatch(sql, /UPDATE signal_workspaces SET topic_signal_selection/u);
});

test("SQL0212 admits a final zero-positive interest while preserving rights on positive assignments", () => {
  const sql = readFileSync(new URL("./migrations/0212_signal_defined_interest_selection.sql", import.meta.url), "utf8");
  assert.match(sql, /IF EXISTS\(SELECT 1 FROM signal_classification_assignments assignment[\s\S]*?AND NOT EXISTS\(SELECT 1 FROM signal_classification_assignments assignment/u);
  assert.match(sql, /LEFT JOIN signal_classification_assignments assignment ON assignment\.generation_id=generation\.id/u);
  assert.match(sql, /assignment\.id IS NULL OR EXISTS\(SELECT 1 FROM signal_mention_import_memberships path/u);
  assert.doesNotMatch(sql, /IF NOT EXISTS\(SELECT 1 FROM signal_classification_assignments assignment\s+JOIN signal_classification_generation_items/u);
});

test("write returns a durable selected receipt consumable by the opt-in Signal helper", async () => {
  const statements: string[] = []; let released = 0;
  const client = { async query(sql: string, params: unknown[] = []) {
    statements.push(sql);
    if (sql.startsWith("BEGIN") || sql.startsWith("SET LOCAL") || sql === "COMMIT") return { rows: [] };
    if (sql.includes("brand_access_level")) return { rows: [{ workspace_status: "active", brand_status: "active",
      organization_status: "active", brand_same_organization: true, actor_status: "active", user_type: "client",
      primary_role: "client_admin", same_organization: true, brand_access_level: "admin" }] };
    if (sql.includes("mutate_signal_defined_interest_selection_v1")) {
      assert.deepEqual(params.slice(0, 3), [workspace_id, actor_user_id, "selection-key-1"]);
      assert.deepEqual(JSON.parse(params[3] as string), command);
      return { rows: [{ value: { selection, replayed: false } }] };
    }
    return { rows: [] };
  }, release() { released++; } };
  const result = await mutateSignalWorkspaceDefinedInterestSelectionV1({ database: { async connect() { return client as never; } },
    workspace_id, actor_user_id, idempotency_key: "selection-key-1", command });
  assert.deepEqual(result, { selection, replayed: false });
  assert.equal(released, 1); assert.equal(statements.at(-1), "COMMIT");
  const prepared = prepareSignalWorkspaceDefinedInterestOverlayV1({ selection, workspace_id, snapshot_id,
    existing_term_keys: ["consolidated_x"] });
  assert.equal(prepared.visible_term.term_key, command.term_key);
});

test("read marks an old selected receipt unservable and refuses access without brand rights", async () => {
  let access = true;
  const client = { async query(sql: string) {
    if (sql.startsWith("BEGIN") || sql.startsWith("SET LOCAL") || sql === "COMMIT") return { rows: [] };
    if (sql.includes("brand_access_level")) return { rows: [{ workspace_status: "active", brand_status: "active",
      organization_status: "active", brand_same_organization: true, actor_status: access ? "active" : "suspended",
      user_type: "client", primary_role: "client_admin", same_organization: true, brand_access_level: "admin" }] };
    if (sql.includes("FROM signal_workspaces workspace") && sql.includes("signal_defined_interest_selections"))
      return { rows: [{ selection, servable: false, receipt: null }] };
    return { rows: [] };
  }, release() {} };
  const args = { database: { async connect() { return client as never; } }, workspace_id, actor_user_id,
    term_key: command.term_key };
  const result = await loadSignalWorkspaceDefinedInterestSelectionV1(args);
  assert.equal(result.selection?.selected, true); assert.equal(result.servable, false);
  access = false;
  await assert.rejects(loadSignalWorkspaceDefinedInterestSelectionV1(args), /defined_interest_selection_forbidden/u);
});

test("request validation refuses score-only or missing durable identity", async () => {
  await assert.rejects(mutateSignalWorkspaceDefinedInterestSelectionV1({ database: { async connect() { throw new Error("connected"); } },
    workspace_id, actor_user_id, idempotency_key: "selection-key-2", command: { ...command, generation_id: "" } }),
  /defined_interest_selection_request_invalid/u);
  const imported = { ...command, snapshot_id: null, expected_snapshot_digest: null };
  assert.equal(imported.snapshot_id, null);
  await assert.rejects(mutateSignalWorkspaceDefinedInterestSelectionV1({ database: { async connect() { throw new Error("connected"); } },
    workspace_id, actor_user_id, idempotency_key: "selection-key-3",
    command: { ...imported, expected_snapshot_digest: sha("a") } }),
  /defined_interest_selection_request_invalid/u);
});
