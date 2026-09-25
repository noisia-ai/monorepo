import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";

import { editSignalTopicConsolidationConceptV1 } from "./signal-topic-consolidation-edition";
import { signalTopicConsolidationDigestV1 } from "./signal-topic-consolidation";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const sha = (value: string) => `sha256:${value.repeat(64)}`;
const workspace = id(1), actor = id(2), revision = id(3), run = id(4), execution = id(5), successor = id(6);
const authority = { workspace_status: "active", brand_status: "active", organization_status: "active",
  brand_same_organization: true, actor_status: "active", user_type: "client", primary_role: "client_admin",
  same_organization: true, brand_access_level: "admin" };

function fixture(status = "validated") {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let committed = false, rolledBack = false;
  const client = { release() { /* fixture */ }, async query(sql: string, params: unknown[] = []) {
    calls.push({ sql, params });
    if (sql === "COMMIT") { committed = true; return { rows: [] }; }
    if (sql === "ROLLBACK") { rolledBack = true; return { rows: [] }; }
    if (sql.includes("workspace.status workspace_status")) return { rows: [authority] };
    if (sql.includes("SELECT consolidation_run_id FROM signal_topic_consolidation_revisions"))
      return { rows: [{ consolidation_run_id: run }] };
    if (sql.includes("run.status run_status")) return { rows: [{ id: revision, revision: 1, revision_digest: sha("a"),
      consolidation_run_id: run, source_engine_execution_id: execution, status, run_status: "validated" }] };
    if (sql.includes("SELECT concept_key,kind,label,definition,locale,source,metadata")) return { rows: [
      { concept_key: "topic-one", kind: "topic", label: "Old name", definition: "Old definition", locale: "es-MX",
        source: "model", metadata: { priority_rank: 1, priority_rationale: "Brand relevance" } }
    ] };
    if (sql.includes("SELECT g.group_key,d.disposition")) return { rows: [
      { group_key: "open:first", disposition: "topic", concept_key: "topic-one", source: "model", confidence: .9, rationale: "evidence" },
      { group_key: "open:second", disposition: "noise", concept_key: null, source: "model", confidence: .8, rationale: "off-brand" }
    ] };
    if (sql.includes("INSERT INTO signal_topic_consolidation_revisions")) return { rows: [{ id: successor }] };
    if (sql.includes("validate_signal_topic_consolidation_revision_v1")) return { rows: [{ validation: { complete: true } }] };
    if (sql.includes("prepare_signal_topic_consolidation_snapshot_v1")) return { rows: [{ receipt: {
      snapshot_id: id(7), snapshot_digest: sha("b") } }] };
    return { rows: [] };
  } };
  return { database: { async connect() { return client; } } as unknown as Pick<Pool,"connect">,
    calls, committed: () => committed, rolledBack: () => rolledBack };
}

test("a client edit preserves every group decision and priority while preparing an unpublished successor", async () => {
  const f = fixture();
  const result = await editSignalTopicConsolidationConceptV1({ database: f.database, workspace_id: workspace,
    actor_user_id: actor, expected_revision_id: revision, expected_revision_digest: sha("a"),
    concept_key: "topic-one", label: "New name", definition: "New definition" });
  assert.equal(result.revision_id, successor);
  assert.equal(result.revision, 2);
  assert.equal(result.snapshot_id, id(7));
  assert.equal(f.committed(), true);
  assert.equal(f.rolledBack(), false);
  const conceptInsert = f.calls.find(call => call.sql.includes("INSERT INTO signal_topic_editorial_concepts"));
  assert.ok(conceptInsert?.sql.includes("metadata"));
  assert.deepEqual(conceptInsert?.params.slice(2), ["topic-one","New name","New definition"]);
  const decisions = f.calls.find(call => call.sql.includes("INSERT INTO signal_topic_consolidation_decisions"));
  assert.ok(decisions?.sql.includes("d.decision_digest"));
  assert.ok(decisions?.sql.includes("new_concept.concept_key=old_concept.concept_key"));
  const previousSuperseded = f.calls.findIndex(call => call.sql.includes("status='superseded'"));
  const newValidated = f.calls.findIndex(call => call.sql.includes("status='validated',revision_digest"));
  const prepared = f.calls.findIndex(call => call.sql.includes("prepare_signal_topic_consolidation_snapshot_v1"));
  assert.ok(previousSuperseded > 0 && newValidated > previousSuperseded && prepared > newValidated);
  const body = { contract_version: "signal-topic-consolidation-revision-v1", revision: 2, concepts: [{
    concept_key: "topic-one", kind: "topic", label: "New name", definition: "New definition", locale: "es-MX", source: "human"
  }], decisions: [
    { group_key: "open:first", disposition: "topic", concept_key: "topic-one", source: "model", confidence: .9, rationale: "evidence" },
    { group_key: "open:second", disposition: "noise", concept_key: null, source: "model", confidence: .8, rationale: "off-brand" }
  ] };
  assert.equal(result.revision_digest, signalTopicConsolidationDigestV1(body));
});

test("a stale edit rolls back without creating a revision", async () => {
  const f = fixture("superseded");
  await assert.rejects(editSignalTopicConsolidationConceptV1({ database: f.database, workspace_id: workspace,
    actor_user_id: actor, expected_revision_id: revision, expected_revision_digest: sha("a"),
    concept_key: "topic-one", label: "New name", definition: "New definition" }),
  /topic_consolidation_edition_stale/u);
  assert.equal(f.rolledBack(), true);
  assert.equal(f.calls.some(call => call.sql.includes("INSERT INTO signal_topic_consolidation_revisions")), false);
});
