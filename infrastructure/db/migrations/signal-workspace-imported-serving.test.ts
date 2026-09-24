import assert from "node:assert/strict";
import test from "node:test";
import { loadSignalWorkspaceMentionsV1, loadSignalWorkspaceTopicsOverviewV1 } from "../signal-workspace-topics-serving";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (n: number) => `sha256:${String(n).repeat(64)}`;
/** Store-contract tests; actual SQL behavior is covered by the guarded PG assertions. */
function fixture() {
  const state = { accepted: true, allowed: true, current: true, generated: false, metrics: 3, evidence: 3, receipt: sha(1), rights: sha(2) };
  const statements: string[] = [];
  const roots = [1, 2, 3].map(n => ({ mention_id: id(n + 10), occurred_at: "2026-09-01T12:00:00.000000Z",
    text_snippet: `Synthetic root ${n}`, text_truncated: false, title: null, url: null, platform: "synthetic", language: "en",
    country: null, content_type: null, engagement: {}, thread_key: id(n + 10), resolution_state: null, has_unresolved_topics: null }));
  const client = { async query(sql: string, values: unknown[] = []) {
    statements.push(sql);
    if (/^(BEGIN|COMMIT|ROLLBACK)/u.test(sql)) return { rows: [] };
    if (sql.includes("brand_access_level")) return { rows: [{ workspace_status: "active", brand_status: "active",
      organization_status: "active", brand_same_organization: true, actor_status: state.allowed ? "active" : "suspended",
      user_type: "noisia_internal", primary_role: "noisia_admin", same_organization: false, brand_access_level: null }] };
    if (sql.includes("signal_topic_consolidation_binding_v1")) return { rows: [] };
    if (sql.includes("topic_signal_selection selection")) return { rows: [{ selection: null, native: false, is_processing: false }] };
    if (sql.includes("SELECT generation.id,generation.taxonomy_profile_id") || sql.includes("term.metadata->'topic' definition")) return { rows: [] };
    if (sql.includes("candidate.input_contract='workspace-topic-classification-v1'")) return { rows: [{ native: state.generated,
      is_processing: false, ...(state.generated ? { id: id(90), source_engine_execution_id: id(91), source_valid: state.current,
        policy_live: state.current, input_revision: "1", current_revision: "1", finalized_digest: sha(3) } : {}) }] };
    if (sql.includes("HAVING count(*)>0")) return { rows: state.accepted ? [{ receipt_digest: state.receipt, input_revision: "1" }] : [] };
    if (sql.includes("mention_roots AS MATERIALIZED")) {
      const after = values[7], offset = after ? roots.findIndex(root => root.mention_id === after) + 1 : 0;
      const items = roots.slice(offset, offset + Number(values[10])).slice(0, state.evidence);
      const summary = { metric_denominator: state.metrics, evidence_visible_total: state.evidence, total_count: state.evidence,
        withheld_evidence_count: state.metrics - state.evidence, integrity_withheld_count: 0, rights_digest: state.rights,
        population_fingerprint_xor: "123", population_fingerprint_sum: "456", date_from: "2026-09-01", date_to: "2026-09-01",
        available_platforms: state.evidence ? ["synthetic"] : [], cursor_exists: true, cursor_offset: offset };
      return { rows: items.length ? items.map(item => ({ ...summary, item, focus_only: false })) : [{ ...summary, item: null, focus_only: null }] };
    }
    if (sql.includes("WITH source_generation AS MATERIALIZED")) return { rows: [{ denominator: state.metrics, processed: state.metrics,
      evidence_visible_total: state.evidence, assigned_unique: 0, abstained: 0, noise: 0, unresolved: 0, unresolved_exclusive: 0,
      withheld: 0, rights_digest: state.rights, date_from: "2026-09-01", date_to: "2026-09-01", counts: [],
      series: [{ date: "2026-09-01", mention_count: state.metrics, assigned_unique: 0 }], observed_at: "2026-09-24T00:00:00.000000Z" }] };
    throw new Error(`Unexpected fixture query: ${sql.slice(0, 80)}`);
  }, release() {} };
  const access = { database: { connect: async () => client as never }, workspace_id: id(1), actor_user_id: id(2) };
  return { state, statements, roots, access, imported: { ...access, imported_fallback: true as const } };
}
test("legacy/default readers never opt into an accepted import", async () => {
  const f = fixture();
  assert.equal(await loadSignalWorkspaceTopicsOverviewV1(f.access), null);
  assert.equal(await loadSignalWorkspaceMentionsV1(f.access), null);
  assert.equal(f.statements.some(sql => sql.includes("HAVING count(*)>0")), false);
});
test("explicit fallback returns an imported corpus without invented classification or engine", async () => {
  const f = fixture(), view = await loadSignalWorkspaceTopicsOverviewV1(f.imported);
  assert.ok(view?.source === "workspace_imported", "accepted import is readable before Engine");
  assert.equal(view.generation_id, null); assert.equal(view.source_engine_execution_id, null);
  assert.equal(view.classification_state, "pending"); assert.equal(view.quality, "not_analyzed");
  assert.deepEqual(view.coverage, { processed: null, assigned_unique: null, abstained: null, noise: null, unresolved: null, withheld: null });
  assert.deepEqual(view.terms, []); assert.equal(view.denominator, 3); assert.equal(view.evidence_visible_total, 3);
  assert.equal(view.series[0]!.assigned_unique, null);
  const first = await loadSignalWorkspaceMentionsV1({ ...f.imported, limit: 1 });
  assert.ok(first && "source" in first && first.source === "workspace_imported", "mentions identifies its imported source");
  assert.equal(first.metric_denominator, view.denominator); assert.equal(first.items[0]!.resolution_state, null);
  assert.equal(first.items[0]!.has_unresolved_topics, null); assert.ok(first.next_cursor, "one-item page retains its continuation");
  const second = await loadSignalWorkspaceMentionsV1({ ...f.imported, limit: 1, cursor: first.next_cursor });
  assert.equal(second?.page_offset, 1); assert.equal(second?.items[0]?.mention_id, f.roots[1]!.mention_id);
});
test("new receipt, rights, actor or filters invalidate imported cursors", async () => {
  const f = fixture(), first = await loadSignalWorkspaceMentionsV1({ ...f.imported, limit: 1 });
  assert.ok(first?.next_cursor, "baseline is paginated");
  for (const change of [{ actor_user_id: id(4) }, { date_from: "2026-09-01" }, { platforms: ["synthetic"] }, { sort_direction: "asc" as const }])
    await assert.rejects(loadSignalWorkspaceMentionsV1({ ...f.imported, ...change, cursor: first.next_cursor }), /scope_changed/u);
  f.state.receipt = sha(4);
  await assert.rejects(loadSignalWorkspaceMentionsV1({ ...f.imported, cursor: first.next_cursor }), /scope_changed/u);
  const next = await loadSignalWorkspaceMentionsV1({ ...f.imported, limit: 1 });
  assert.ok(next?.next_cursor, "new receipt can restart pagination");
  f.state.rights = sha(5); f.state.metrics = 0; f.state.evidence = 0;
  await assert.rejects(loadSignalWorkspaceMentionsV1({ ...f.imported, cursor: next.next_cursor }), /scope_changed/u);
  const revoked = await loadSignalWorkspaceMentionsV1(f.imported);
  assert.equal(revoked?.metric_denominator, 0); assert.deepEqual(revoked?.items, []);
  assert.ok(revoked && "source" in revoked, "revoked display rights do not fall through to legacy");
});
test("metrics never substitute for text permission; workspace revocation fails closed", async () => {
  const f = fixture(); f.state.evidence = 0;
  const view = await loadSignalWorkspaceTopicsOverviewV1(f.imported), page = await loadSignalWorkspaceMentionsV1(f.imported);
  assert.equal(view?.denominator, 3); assert.equal(page?.metric_denominator, 3);
  assert.equal(page?.withheld_evidence_count, 3); assert.deepEqual(page?.items, []);
  f.state.allowed = false;
  await assert.rejects(loadSignalWorkspaceTopicsOverviewV1(f.imported), /forbidden/u);
  await assert.rejects(loadSignalWorkspaceMentionsV1(f.imported), /forbidden/u);
});
test("no accepted receipt stays unavailable and a stale generation never falls back", async () => {
  const f = fixture(); f.state.accepted = false;
  assert.equal(await loadSignalWorkspaceTopicsOverviewV1(f.imported), null);
  assert.equal(await loadSignalWorkspaceMentionsV1(f.imported), null);
  f.state.accepted = true; f.state.generated = true; f.state.current = false; f.statements.length = 0;
  await assert.rejects(loadSignalWorkspaceMentionsV1(f.imported), /workspace_mentions_stale/u);
  assert.equal(f.statements.some(sql => sql.includes("HAVING count(*)>0")), false);
});
test("imported SQL reuses complete-path rights precedence and canonical root dedup", async () => {
  const f = fixture(); await loadSignalWorkspaceMentionsV1(f.imported);
  const sql = f.statements.find(query => query.includes("mention_roots AS MATERIALIZED"))!;
  assert.match(sql, /batch.status='completed'/u); assert.match(sql, /source.status='active'/u);
  assert.match(sql, /SELECT DISTINCT origin.canonical_mention_id root_id/u);
  assert.match(sql, /mention.canonical_mention_id=mention.id AND mention.inclusion_status='included'/u);
  assert.match(sql, /ORDER BY \(candidate.import_batch_id IS NOT NULL\) DESC,candidate.binding_version DESC,candidate.id LIMIT 1/u);
  assert.match(sql, /bool_or\(rights.metrics AND rights.evidence\) evidence/u);
  assert.match(sql, /retention.retain_until>now\(\)/u); assert.doesNotMatch(sql, /llm-processing/u);
  assert.doesNotMatch(sql, /prepared.asset_sha256=mention.text_clean_sha256/u);
  assert.match(sql, /mention.text_clean_sha256 IS NOT NULL/u);
  const identity = f.statements.find(query => query.includes("HAVING count(*)>0"))!;
  assert.match(identity, /NOT EXISTS\(SELECT 1 FROM signal_classification_generations prior/u);
  assert.match(identity, /NOT EXISTS\(SELECT 1 FROM signal_topic_consolidation_bindings prior/u);
});

test("an available generation enriches the same roots without selecting imported fallback", async () => {
  const f = fixture(), imported = await loadSignalWorkspaceMentionsV1(f.imported);
  f.state.generated = true; f.statements.length = 0;
  const computed = await loadSignalWorkspaceMentionsV1(f.imported);
  assert.equal(computed?.generation_id, id(90));
  assert.deepEqual(computed?.items.map(item => item.mention_id), imported?.items.map(item => item.mention_id));
  assert.equal(f.statements.some(sql => sql.includes("HAVING count(*)>0")), false);
});
