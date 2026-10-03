import assert from "node:assert/strict";
import test from "node:test";

import { loadSignalWorkspaceCorpusReadinessStoreV1,
  type SignalWorkspaceCorpusReadinessQueryableV1 } from "./signal-workspace-corpus-readiness";

const workspaceId = "a82cda11-cc80-4a7d-b4ae-2074b63f42a7";
const observedAt = "2026-09-08T20:15:30.123456Z";
const empty = {
  observed_at: observedAt,
  accepted_files: "0", records_read: "0", included: "0", excluded: "0", duplicates: "0",
  observations: "0", linked_roots: "0", included_roots: "0", excluded_roots: "0", roots_with_text: "0",
  rights_eligible_roots: "0", semantic_eligible_roots: "0", invalid_counters: "0", invalid_sources: "0",
  invalid_root_links: "0", missing_import_links: "0", unlinked_observations: "0",
  observation_count_mismatches: "0", missing_included_text: "0", pending_inclusion: "0"
};
const received = { ...empty, accepted_files: "2", records_read: "4", included: "2", excluded: "1",
  duplicates: "1", observations: "3", linked_roots: "2", included_roots: "1", excluded_roots: "1",
  roots_with_text: "2", rights_eligible_roots: "1" };

async function load(row: Record<string, unknown>) {
  let queries = 0;
  const queryable: SignalWorkspaceCorpusReadinessQueryableV1 = {
    query: async <Row extends Record<string, unknown>>(_sql: string, values?: unknown[]) => {
      queries++;
      assert.deepEqual(values, [workspaceId]);
      return { rows: [row as Row] };
    }
  };
  const result = await loadSignalWorkspaceCorpusReadinessStoreV1({ queryable, workspace_id: workspaceId });
  assert.equal(queries, 1, "all aggregates must be read within one statement snapshot");
  return result;
}

test("empty accepted population awaits an import without claiming a preparation state", async () => {
  const result = await load(empty);
  assert.equal(result.state, "awaiting_import");
  assert.equal(result.accepted_files, 0);
  assert.equal(result.projection.linked_roots, 0);
  assert.deepEqual(result.reconciliation_errors, []);
  assert.equal("preparation" in result, false);
  assert.equal("source_digest" in result, false);
});

test("raw duplicates and roots shared by imports reconcile without demanding one observation per record", async () => {
  const result = await load({ ...received, source_text: "Synthetic private text must not leave the reader" });
  assert.deepEqual(result, {
    contract_version: "signal-workspace-corpus-readiness-v1", workspace_id: workspaceId,
    observed_at: observedAt, state: "received",
    accepted_files: 2, records_read: 4, dispositions: { included: 2, excluded: 1, duplicates: 1 },
    projection: { observations: 3, linked_roots: 2, included_roots: 1, excluded_roots: 1, roots_with_text: 2 },
    eligibility: { rights_eligible_roots: 1, rights_blocked_roots: 0, semantic_eligible_roots: 0, semantic_pending_roots: 1 },
    reconciliation_errors: []
  });
  assert.doesNotMatch(JSON.stringify(result), /Synthetic private/u);
});

test("rights and semantic coverage remain separate and semantic uncertainty is not an import failure", async () => {
  const pending = await load(received);
  assert.equal(pending.state, "received");
  assert.equal(pending.eligibility.semantic_pending_roots, 1);
  const semantic = await load({ ...received, semantic_eligible_roots: "1" });
  assert.deepEqual(semantic.eligibility, { rights_eligible_roots: 1, rights_blocked_roots: 0,
    semantic_eligible_roots: 1, semantic_pending_roots: 0 });
  const blocked = await load({ ...received, rights_eligible_roots: "0" });
  assert.equal(blocked.state, "received");
  assert.deepEqual(blocked.eligibility, { rights_eligible_roots: 0, rights_blocked_roots: 1,
    semantic_eligible_roots: 0, semantic_pending_roots: 0 });
  assert.deepEqual(blocked.reconciliation_errors, []);
});

test("reconciliation failures retain the received counts and expose stable codes only", async () => {
  const result = await load({ ...received, invalid_counters: "1", invalid_sources: "1", invalid_root_links: "1",
    missing_import_links: "1", unlinked_observations: "1", observation_count_mismatches: "1",
    missing_included_text: "1", pending_inclusion: "1" });
  assert.equal(result.state, "needs_attention");
  assert.equal(result.accepted_files, 2);
  assert.equal(result.records_read, 4);
  assert.deepEqual(result.reconciliation_errors, ["accepted_import_counters_mismatch",
    "accepted_import_source_unavailable", "canonical_root_link_invalid", "accepted_import_membership_missing",
    "provider_observation_membership_missing", "provider_observation_count_mismatch",
    "included_root_text_missing", "canonical_inclusion_pending"]);
});

test("unavailable or unsafe aggregates fail rather than silently displaying zero or ready", async () => {
  for (const patch of [{ records_read: "9007199254740992" }, { records_read: "invalid" },
    { observations: -1 }, { observations: undefined }, { observations: null }, { observations: "" },
    { rights_eligible_roots: 2 }, { semantic_eligible_roots: 2 }]) {
    await assert.rejects(load({ ...received, ...patch }), /workspace_corpus_readiness_count_invalid/u);
  }
  await assert.rejects(loadSignalWorkspaceCorpusReadinessStoreV1({ workspace_id: workspaceId,
    queryable: { query: async () => ({ rows: [] }) } }), /workspace_corpus_readiness_unavailable/u);
  const transportError = new Error("Synthetic PostgreSQL failure");
  await assert.rejects(loadSignalWorkspaceCorpusReadinessStoreV1({ workspace_id: workspaceId,
    queryable: { query: async () => { throw transportError; } } }), (error: unknown) => error === transportError);
});

test("snapshot timestamps preserve PostgreSQL microseconds and reject invalid or host-local forms", async () => {
  const first = await load({ ...received, observed_at: "2026-09-08T20:15:30.123456Z" });
  const next = await load({ ...received, observed_at: "2026-09-08T20:15:30.123457Z" });
  assert.equal(first.observed_at, "2026-09-08T20:15:30.123456Z");
  assert.equal(next.observed_at, "2026-09-08T20:15:30.123457Z");
  assert.ok(first.observed_at < next.observed_at);
  assert.equal((await load({ ...empty, observed_at: "2024-02-29T00:00:00.000000Z" })).observed_at,
    "2024-02-29T00:00:00.000000Z");
  for (const observed_at of [null, undefined, 1788898530123, "", "2026-09-08 20:15:30.123456",
    "2026-09-08T20:15:30.123Z", "2026-09-08T20:15:30.123456+00:00", "2026-09-08T20:15:30.1234567Z",
    "2026-02-29T00:00:00.000000Z", "2026-04-31T00:00:00.000000Z", "2026-13-01T00:00:00.000000Z",
    "2026-09-08T24:00:00.000000Z", "2026-09-08T20:60:00.000000Z", "0000-01-01T00:00:00.000000Z"]) {
    await assert.rejects(load({ ...received, observed_at }), /workspace_corpus_readiness_observed_at_invalid/u);
  }
});
