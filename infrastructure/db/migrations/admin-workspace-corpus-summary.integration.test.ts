import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';
import test from 'node:test';
import { loadAdminWorkspaceCorpusSummariesV1 as read, ADMIN_WORKSPACE_CORPUS_SUMMARIES_SQL } from '../admin-workspace-corpus-summary';
import { loadSignalWorkspaceCorpusReadinessStoreV1 as readiness } from '../signal-workspace-corpus-readiness';

test('admin batch corpus matches accepted workspace receipts, dedup, observed period and authorization in PostgreSQL', {
  skip: process.env.NOISIA_ADMIN_CORPUS_TEST_APPROVED !== 'true', timeout: 60_000
}, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname)); assert.match(url.pathname, /^\/noisia_national_import_test_\d+$/u);
  const workspace = process.env.NOISIA_ADMIN_CORPUS_WORKSPACE_ID!, second = process.env.NOISIA_ADMIN_CORPUS_SECOND_WORKSPACE_ID!;
  const actor = process.env.NOISIA_ADMIN_CORPUS_ACTOR_ID!;
  assert.ok(workspace && second && actor);
  const pool = new Pool({ connectionString: url.href, max: 1 }), c = await pool.connect();
  try {
    await c.query('BEGIN READ ONLY');
    const small = (await c.query<{ id: string }>(`SELECT workspace.id::text FROM signal_workspaces workspace
      WHERE workspace.slug LIKE 'readiness-%-main' AND EXISTS(SELECT 1 FROM import_batches batch
        JOIN mentions mention ON mention.source_file_id=batch.id WHERE batch.workspace_id=workspace.id AND batch.status='failed')
      ORDER BY workspace.created_at DESC LIMIT 1`)).rows[0]!.id;
    let statements = 0;
    const queryable = { query: async <Row extends Record<string, unknown>>(sql: string, values?: unknown[]) => {
      statements++; return c.query<Row>(sql,values);
    } };
    const start = performance.now();
    const batch = await read({ queryable, workspace_ids: [workspace,second,small,workspace,randomUUID()], actor_user_id: actor });
    const elapsed = performance.now()-start;
    assert.equal(statements, 2, 'one batch authority lookup and one corpus aggregate for the entire list');
    assert.equal(batch.size, 3);
    const value = batch.get(workspace)!;
    assert.equal(value.received_unique_roots, 7396); assert.equal(value.accepted_files, 16);
    assert.equal(value.records_read, 9131); assert.equal(value.duplicate_rows, 1735);
    assert.equal(value.included_roots, 6826); assert.equal(value.excluded_roots, 570); assert.equal(value.pending_roots, 0);
    assert.equal(value.sources_with_accepted_imports, 1); assert.equal(value.capture_scopes.primary_brand, 16);
    assert.equal(value.coverage.from, '2026-08-01'); assert.equal(value.coverage.through, '2026-08-01', 'declared August1–31 is not observed coverage');
    assert.equal(value.coverage.dated_roots, 7396); assert.equal(value.measurement_state, 'complete');
    assert.equal(batch.get(second)!.received_unique_roots, 10000); assert.equal(batch.get(second)!.sources_with_accepted_imports, 16);
    assert.equal(batch.get(small)!.received_unique_roots, 2); assert.equal(batch.get(small)!.records_read, 4);
    assert.equal(batch.get(small)!.duplicate_rows, 2); assert.equal(batch.get(small)!.sources_with_accepted_imports, 2);
    assert.equal(batch.get(small)!.state, 'received', 'failed partial import does not contaminate reception state');
    for (const id of [workspace,second,small]) {
      const original = await readiness({ queryable: c, workspace_id: id }), compact = batch.get(id)!;
      assert.equal(compact.received_unique_roots, original.projection.linked_roots);
      assert.equal(compact.records_read, original.records_read); assert.equal(compact.accepted_files, original.accepted_files);
    }
    const plan = (await c.query(`EXPLAIN (ANALYZE,FORMAT JSON) ${ADMIN_WORKSPACE_CORPUS_SUMMARIES_SQL}`,[[workspace,second,small]])).rows[0]!['QUERY PLAN'][0];
    const nodes: Record<string, unknown>[] = [];
    const walk = (node: Record<string, unknown>) => { nodes.push(node); for (const child of (node.Plans ?? []) as Record<string, unknown>[]) walk(child); };
    walk(plan.Plan);
    const mentions = nodes.filter(node => node['Relation Name']==='mentions');
    assert.equal(mentions.length, 2);
    assert.ok(mentions.every(node => node['Index Name']==='mentions_pkey'), 'root lookups must not become repeated workspace scans');
    const visits = mentions.reduce((sum,node) => sum+(Number(node['Actual Rows'])+Number(node['Rows Removed by Filter']??0))*Number(node['Actual Loops']),0);
    assert.ok(visits<100_000, 'bounded PK work across both full fixtures, no quadratic scan');
    console.log(JSON.stringify({ phase: 'batch-read', workspaces: batch.size, distinct_roots: 17398, statements, elapsed_ms: elapsed,
      explain_ms: plan['Execution Time'], mention_rows_visited: visits, remote: false }));
    await c.query('ROLLBACK');

    await c.query('BEGIN');
    const identity = (await c.query<{ brand_id: string; organization_id: string }>('SELECT brand_id::text,organization_id::text FROM signal_workspaces WHERE id=$1::uuid',[workspace])).rows[0]!;
    const client = randomUUID();
    await c.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,status,organization_id)
      VALUES($1::uuid,$2,'Isolated reception reader client','client','client_viewer','active',$3::uuid)`,[client,`admin-corpus-${client}@example.test`,identity.organization_id]);
    assert.equal((await read({queryable:c,workspace_ids:[workspace,second],actor_user_id:client})).size,0);
    await c.query(`INSERT INTO user_brand_access(user_id,brand_id,access_level,granted_by_user_id) VALUES($1::uuid,$2::uuid,'read',$3::uuid)`,[client,identity.brand_id,actor]);
    assert.deepEqual([...await read({queryable:c,workspace_ids:[workspace,second],actor_user_id:client})].map(([id])=>id),[workspace]);
    await c.query('UPDATE user_brand_access SET revoked_at=clock_timestamp() WHERE user_id=$1::uuid',[client]);
    assert.equal((await read({queryable:c,workspace_ids:[workspace],actor_user_id:client})).size,0);
    await c.query('UPDATE users SET status=\'suspended\' WHERE id=$1::uuid',[actor]);
    assert.equal((await read({queryable:c,workspace_ids:[workspace,second],actor_user_id:actor})).size,0);
    await c.query('ROLLBACK');

    await c.query('BEGIN');
    await c.query("UPDATE signal_workspaces SET timezone='Pacific/Kiritimati' WHERE id=$1::uuid",[workspace]);
    const zoned = (await read({queryable:c,workspace_ids:[workspace],actor_user_id:actor})).get(workspace)!;
    assert.equal(zoned.coverage.from,'2026-08-02'); assert.equal(zoned.coverage.through,'2026-08-02');
    assert.equal(zoned.coverage.timezone,'Pacific/Kiritimati'); assert.equal(zoned.received_unique_roots,7396);
    await c.query(`INSERT INTO data_sources(workspace_id,organization_id,brand_id,source_type,provider,connection_method,name,status)
      VALUES($1::uuid,$2::uuid,$3::uuid,'social-listening','isolated-fixture','api','Unmeasured test source','active')`,
      [workspace,identity.organization_id,identity.brand_id]);
    const partial = (await read({queryable:c,workspace_ids:[workspace],actor_user_id:actor})).get(workspace)!;
    assert.equal(partial.received_unique_roots,7396); assert.equal(partial.unmeasured_sources,1);
    assert.equal(partial.measurement_state,'partial'); assert.equal(partial.coverage.state,'partial');
    await c.query('ROLLBACK');
  } finally { await c.query('ROLLBACK').catch(()=>{}); c.release(); await pool.end(); }
});
