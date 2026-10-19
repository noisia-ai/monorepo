import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { SignalWorkspaceTopicsOverviewV1 } from "@noisia/query-engine";
import { loadSignalWorkspaceTopicsOverviewV1, loadSignalWorkspaceTopicEvidenceV1 } from "./signal-workspace-topics-serving";
import { loadSignalWorkspaceTopicSelectionV1, selectSignalWorkspaceTopicV1 } from "./signal-workspace-topic-selection";

/** Shared by the opt-in local PostgreSQL projection fixture. The caller owns an
 * outer rollback transaction; this helper never connects to a provider. */
export async function assertSignalWorkspaceTopicsServingV1(args: {
  database: Pick<Pool, "query" | "connect">; workspace_id: string; actor_user_id: string; generation_id: string;
  expected_memberships: Array<{ term_key: string; root_ids: string[] }>;
}) {
  const { database, workspace_id, actor_user_id, generation_id, expected_memberships } = args;
  const access = { database, workspace_id, actor_user_id };
  assert.ok(expected_memberships.length >= 2, "fixture includes independently selectable overlapping Topics");
  const roots = (await database.query<{ root_id: string; date: string }>(`SELECT item.canonical_root_id root_id,
    to_char(mention.published_at AT TIME ZONE 'UTC','YYYY-MM-DD') date FROM signal_classification_generation_items item
    JOIN mentions mention ON mention.id=item.canonical_root_id WHERE item.generation_id=$1::uuid ORDER BY item.canonical_root_id`, [generation_id])).rows;
  const admin = await loadSignalWorkspaceTopicsOverviewV1({ ...access, include_unselected: true });
  assert.ok(admin); assert.equal(admin.generation_id, generation_id); assert.equal(admin.is_current, true);
  assert.equal(admin.denominator, roots.length); assert.equal(admin.coverage.processed, roots.length);
  const first = await loadSignalWorkspaceTopicsOverviewV1(access);
  assert.ok(first); assert.equal(first.terms.length, 0); assert.equal(first.coverage.assigned_unique, 0);
  assert.equal(first.coverage.unresolved, admin.coverage.unresolved, "visibility does not change classification uncertainty");
  const selectedKeys: string[] = [];
  for (const expected of expected_memberships.slice(0, 2)) {
    const term: SignalWorkspaceTopicsOverviewV1["terms"][number] | undefined = admin.terms.find(item => item.term_key === expected.term_key); assert.ok(term);
    assert.equal(term.mention_count, new Set(expected.root_ids).size, "whole-root count, independent of chunk or lane duplicates");
    const state = await loadSignalWorkspaceTopicSelectionV1(access), key = randomUUID();
    const command = { ...access, term_key: term.term_key, selected: true, expected_selection_revision: state.revision,
      expected_definition_revision: term.definition_revision, expected_definition_digest: term.definition_digest,
      generation_id, idempotency_key: key };
    const saved = await selectSignalWorkspaceTopicV1(command);
    const replay = await selectSignalWorkspaceTopicV1(command);
    assert.equal(replay.replayed, true); assert.equal(saved.operation_id, replay.operation_id);
    assert.equal(saved.revision, replay.revision, "lost ACK retry creates no additional mutation");
    const recovered = await loadSignalWorkspaceTopicSelectionV1({ ...access, idempotency_key: key });
    assert.equal(recovered.request_receipt?.operation_id, saved.operation_id);
    await assert.rejects(selectSignalWorkspaceTopicV1({ ...command, idempotency_key: randomUUID() }), /selection_revision_conflict/u);
    selectedKeys.push(term.term_key);
  }
  const selected = await loadSignalWorkspaceTopicsOverviewV1(access); assert.ok(selected);
  assert.deepEqual(selected.terms.map(term => term.term_key).sort(), [...selectedKeys].sort());
  const expectedUnion = new Set(expected_memberships.filter(term => selectedKeys.includes(term.term_key)).flatMap(term => term.root_ids));
  assert.equal(selected.coverage.assigned_unique, expectedUnion.size);
  assert.equal(selected.coverage.unresolved, first.coverage.unresolved);
  assert.equal(selected.quality, "not_calibrated"); assert.equal(selected.scope, "all_conversations"); assert.equal(selected.corpus_id, null);
  assert.equal((await loadSignalWorkspaceTopicsOverviewV1(access))?.scope_digest, selected.scope_digest, "unchanged refresh has stable identity");
  const target = expected_memberships[0]!;
  const seen: string[] = []; let cursor: string | null = null;
  do {
    const evidence = await loadSignalWorkspaceTopicEvidenceV1({ ...access, term_key: target.term_key, limit: 1,
      cursor, expected_scope_digest: selected.scope_digest });
    for (const item of evidence.items) {
      assert.ok(item.text.length > 0 && Array.from(item.text).length <= 2000);
      assert.ok(item.evidence_fragment, "computed membership returns its actual matching fragment");
      assert.equal(item.text.length, item.evidence_fragment.end - item.evidence_fragment.start);
      assert.equal(`sha256:${createHash("sha256").update(item.text).digest("hex")}`, item.evidence_fragment.chunk_sha256);
      seen.push(item.mention_id);
    }
    cursor = evidence.next_cursor;
  } while (cursor);
  assert.deepEqual(seen.sort(), [...new Set(target.root_ids)].sort());
  const date = roots[0]!.date;
  const period = await loadSignalWorkspaceTopicsOverviewV1({ ...access, date_from: date, date_to: date }); assert.ok(period);
  assert.equal(period.denominator, roots.filter(root => root.date === date).length);
  for (const term of period.terms) {
    const expected = expected_memberships.find(item => item.term_key === term.term_key)!;
    assert.equal(term.mention_count, roots.filter(root => root.date === date && expected.root_ids.includes(root.root_id)).length);
  }
  await assert.rejects(loadSignalWorkspaceTopicsOverviewV1({ ...access, date_from: "2026-02-30" }), /date_invalid/u);
  await assert.rejects(loadSignalWorkspaceTopicEvidenceV1({ ...access, term_key: target.term_key, expected_scope_digest: first.scope_digest }), /scope_changed/u);
  await assert.rejects(loadSignalWorkspaceTopicsOverviewV1({ ...access, actor_user_id: randomUUID() }), /forbidden/u);

  const state = await loadSignalWorkspaceTopicSelectionV1(access), term = selected.terms.find(item => item.term_key === selectedKeys[1])!;
  await selectSignalWorkspaceTopicV1({ ...access, term_key: term.term_key, selected: false, expected_selection_revision: state.revision,
    expected_definition_revision: term.definition_revision, expected_definition_digest: term.definition_digest, generation_id,
    idempotency_key: randomUUID() });
  const removed = await loadSignalWorkspaceTopicsOverviewV1(access); assert.ok(removed);
  assert.equal(removed.terms.length, 1); assert.equal(removed.coverage.unresolved, selected.coverage.unresolved);
  await assert.rejects(loadSignalWorkspaceTopicEvidenceV1({ ...access, term_key: term.term_key }), /topic_unavailable/u);

  await database.query("SAVEPOINT serving_rights_revocation");
  try {
    await database.query(`UPDATE signal_retention_policies SET status='retired',effective_to=now(),updated_at=now()
      WHERE workspace_id=$1::uuid AND status='active'`, [workspace_id]);
    const revoked = await loadSignalWorkspaceTopicsOverviewV1(access); assert.ok(revoked);
    assert.equal(revoked.denominator, 0); assert.equal(revoked.coverage.withheld, roots.length);
    assert.equal(revoked.terms.every(item => item.mention_count === 0), true);
    assert.notEqual(revoked.scope_digest, removed.scope_digest);
    await assert.rejects(loadSignalWorkspaceTopicEvidenceV1({ ...access, term_key: target.term_key,
      expected_scope_digest: removed.scope_digest }), /stale|scope_changed/u);
  } finally { await database.query("ROLLBACK TO SAVEPOINT serving_rights_revocation"); await database.query("RELEASE SAVEPOINT serving_rights_revocation"); }
  const counts = (await database.query<{ approved: number }>(`SELECT count(*)::int approved FROM signal_classification_assignments
    WHERE generation_id=$1::uuid AND membership_basis='computed_cluster' AND disposition='approved'`, [generation_id])).rows[0]!;
  assert.equal(counts.approved, 0, "serving never fabricates semantic approval");
  return { roots: roots.length, topics_checked: 2, assigned_unique: selected.coverage.assigned_unique,
    evidence_roots: seen.length, rights_revocation: true, idempotent_selection: true, unauthorized_denied: true };
}
