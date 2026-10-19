import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAdminWorkspaceCorpusSummariesV1 as read } from '../admin-workspace-corpus-summary';
const actor = '00000000-0000-4000-8000-000000000001', workspace = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';
const authority = { workspace_id: workspace, workspace_status: 'active', brand_status: 'active', actor_status: 'active',
  user_type: 'noisia_internal', primary_role: 'analyst', same_organization: false, brand_access_level: null as string | null };
const raw = { workspace_id: workspace, timezone: 'America/Mexico_City', observed_at: '2026-09-09T14:47:00.000001Z',
  received_unique_roots: '2', included_roots: '1', excluded_roots: '1', pending_roots: '0', dated_roots: '2',
  coverage_from: '2026-01-01', coverage_through: '2026-08-31', accepted_files: '2', records_read: '4', duplicate_rows: '2',
  sources_with_accepted_imports: '2', sources_without_accepted_imports: '0', unmeasured_sources: '0',
  scope_primary_brand: '1', scope_competitor: '1', scope_category: '0', scope_reference: '0', scope_unknown: '0',
  invalid_sources: '0', invalid_counters: '0', missing_import_links: '0', invalid_links: '0' };
function queryable(rows = [raw], authorities = [authority]) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  return { calls, query: async <Row extends Record<string, unknown>>(sql: string, values?: unknown[]) => {
    calls.push({ sql, values }); return { rows: (calls.length === 1 ? authorities : rows) as unknown as Row[] };
  } };
}
test('batch receiver separates unique corpus, raw rows, capture intentions and observed dates', async () => {
  const database = queryable(); const value = (await read({ queryable: database, workspace_ids: [workspace,workspace], actor_user_id: actor })).get(workspace)!;
  assert.equal(database.calls.length, 2); assert.deepEqual(database.calls[1]!.values, [[workspace]]);
  assert.equal(value.received_unique_roots, 2); assert.equal(value.records_read, 4); assert.equal(value.duplicate_rows, 2);
  assert.equal(value.included_roots + value.excluded_roots + value.pending_roots, 2);
  assert.deepEqual(value.capture_scopes, { primary_brand: 1, competitor: 1, category: 0, reference: 0, unknown: 0 });
  assert.equal(value.coverage.state, 'observed'); assert.equal(value.coverage.timezone, 'America/Mexico_City');
  assert.equal(value.measurement_state, 'complete'); assert.equal(value.state, 'received');
});
test('shared DB capabilities filter foreign and revoked access before the single aggregate batch', async () => {
  for (const denied of [{ ...authority, actor_status: 'suspended' }, { ...authority, primary_role: 'invented' },
    { ...authority, user_type: 'client', primary_role: 'client_viewer', same_organization: false, brand_access_level: 'read' },
    { ...authority, user_type: 'client', primary_role: 'client_viewer', same_organization: true }]) {
    const database = queryable([], [denied]); assert.equal((await read({ queryable: database, workspace_ids: [workspace], actor_user_id: actor })).size, 0);
    assert.equal(database.calls.length, 1);
  }
  const database = queryable([raw], [authority, { ...authority, workspace_id: other, workspace_status: 'archived' }]);
  await read({ queryable: database, workspace_ids: [workspace,other], actor_user_id: actor });
  assert.deepEqual(database.calls[1]!.values, [[workspace]]);
});
test('partial provenance and missing observable dates remain explicit, never claim complete period coverage', async () => {
  const database = queryable([{ ...raw, dated_roots: '1', invalid_links: '1' }]);
  const value = (await read({ queryable: database, workspace_ids: [workspace], actor_user_id: actor })).get(workspace)!;
  assert.equal(value.received_unique_roots, 2); assert.equal(value.coverage.unknown_date_roots, 1);
  assert.equal(value.coverage.state, 'partial'); assert.equal(value.state, 'needs_attention');
  assert.deepEqual(value.reconciliation_errors, ['canonical_root_link_invalid']);
});
test('sources outside measurable import receipts yield unknown, not zero, while manual CSV empty is known zero', async () => {
  const empty = { ...raw, received_unique_roots: '0', included_roots: '0', excluded_roots: '0', dated_roots: '0',
    coverage_from: null, coverage_through: null, accepted_files: '0', records_read: '0', duplicate_rows: '0',
    sources_with_accepted_imports: '0', sources_without_accepted_imports: '1', scope_primary_brand: '0', scope_competitor: '0' };
  for (const unmeasured of [0,1]) {
    const database = queryable([{ ...empty, unmeasured_sources: String(unmeasured) }] as unknown as typeof raw[]);
    const value = (await read({ queryable: database, workspace_ids: [workspace], actor_user_id: actor })).get(workspace)!;
    assert.equal(value.received_unique_roots, unmeasured ? null : 0);
    assert.equal(value.measurement_state, unmeasured ? 'unavailable' : 'complete'); assert.equal(value.coverage.from, null);
  }
  const database = queryable([{ ...raw, unmeasured_sources: '1' }]);
  const value = (await read({ queryable: database, workspace_ids: [workspace], actor_user_id: actor })).get(workspace)!;
  assert.equal(value.received_unique_roots, 2); assert.equal(value.measurement_state, 'partial');
});
test('invalid counters and out-of-scope aggregate rows cannot become misleading displayed counts', async () => {
  for (const row of [{ ...raw, received_unique_roots: -1 }, { ...raw, received_unique_roots: '9007199254740992' },
    { ...raw, dated_roots: '3' }, { ...raw, workspace_id: other }]) {
    await assert.rejects(read({ queryable: queryable([row] as unknown as typeof raw[]), workspace_ids: [workspace], actor_user_id: actor }), /admin_workspace_corpus_/u);
  }
});
