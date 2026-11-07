import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type pg from 'pg';
import { loadAdminWorkspaceCorpusSummariesV1 } from '../admin-workspace-corpus-summary';

test('admin corpus receipt aggregation runs against synthetic PostgreSQL rows', {
  skip: process.env.NOISIA_MFP_PG_CI !== 'true', timeout: 30_000,
}, async () => {
  const { openDatabase } = await import(new URL('../../../scripts/dev-corpus/guard.mjs', import.meta.url).href);
  const pool: pg.Pool = await openDatabase();
  const client = await pool.connect();
  const workspaceId = randomUUID(), actorId = randomUUID(), brandId = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL search_path=pg_temp,public,extensions');
    await client.query(`CREATE TEMP TABLE signal_workspaces(id uuid,timezone text);
      CREATE TEMP TABLE workspaces(id uuid,timezone text);
      CREATE TEMP TABLE import_batches(id uuid,workspace_id uuid,data_source_id uuid,record_count int,included_count int,
        excluded_count int,duplicate_count int,status text,acquisition_slot_id uuid,acquisition_plan_id uuid,acquisition_slot_digest text);
      CREATE TEMP TABLE data_sources(id uuid,workspace_id uuid,status text,connection_method text);
      CREATE TEMP TABLE signal_acquisition_slots(id uuid,workspace_id uuid,plan_id uuid,definition_hash text,scope text);
      CREATE TEMP TABLE signal_mention_import_memberships(workspace_id uuid,import_batch_id uuid,data_source_id uuid,mention_id uuid);
      CREATE TEMP TABLE mentions(id uuid,workspace_id uuid,canonical_mention_id uuid,inclusion_status text,published_at timestamptz);`);
    const sourceId = randomUUID(), batchId = randomUUID(), slotId = randomUUID(), planId = randomUUID();
    const rootIncluded = randomUUID(), rootExcluded = randomUUID();
    await client.query('INSERT INTO signal_workspaces VALUES($1,$2)', [workspaceId, 'America/Mexico_City']);
    await client.query('INSERT INTO workspaces VALUES($1,$2)', [workspaceId, 'America/Mexico_City']);
    await client.query('INSERT INTO data_sources VALUES($1,$2,$3,$4)', [sourceId, workspaceId, 'active', 'manual-csv']);
    await client.query('INSERT INTO signal_acquisition_slots VALUES($1,$2,$3,$4,$5)',
      [slotId, workspaceId, planId, 'synthetic-slot-digest', 'competitor']);
    await client.query(`INSERT INTO import_batches VALUES($1,$2,$3,4,1,1,2,'completed',$4,$5,$6)`,
      [batchId, workspaceId, sourceId, slotId, planId, 'synthetic-slot-digest']);
    await client.query(`INSERT INTO mentions VALUES
      ($1,$3,$1,'included','2026-06-15T12:00:00Z'),($2,$3,$2,'excluded',NULL)`, [rootIncluded, rootExcluded, workspaceId]);
    await client.query(`INSERT INTO signal_mention_import_memberships VALUES
      ($1,$2,$3,$4),($1,$2,$3,$5),($1,$2,$3,$4)`,
      [workspaceId, batchId, sourceId, rootIncluded, rootExcluded]);

    let statements = 0;
    const queryable = {
      query: async <Row extends Record<string, unknown>>(sql: string, values?: unknown[]) => {
        statements += 1;
        if (statements === 1) return { rows: [{ workspace_id: workspaceId, workspace_status: 'active',
          brand_status: 'active', actor_status: 'active', user_type: 'noisia_internal', primary_role: 'analyst',
          same_organization: true, brand_access_level: null, brand_same_organization: true }] as unknown as Row[] };
        return client.query<Row>(sql, values);
      },
    };
    const summaries = await loadAdminWorkspaceCorpusSummariesV1({
      queryable, workspace_ids: [workspaceId, workspaceId], actor_user_id: actorId,
    });
    const summary = summaries.get(workspaceId);
    assert.equal(statements, 2, 'one authorization batch and one PostgreSQL aggregate serve the requested workspaces');
    assert.ok(summary);
    assert.equal(summary.received_unique_roots, 2, 'repeated import links do not duplicate canonical roots');
    assert.equal(summary.included_roots, 1);
    assert.equal(summary.excluded_roots, 1);
    assert.equal(summary.accepted_files, 1);
    assert.equal(summary.records_read, 4);
    assert.equal(summary.duplicate_rows, 2);
    assert.equal(summary.capture_scopes.competitor, 1);
    assert.deepEqual(summary.coverage, { from: '2026-06-15', through: '2026-06-15', timezone: 'America/Mexico_City',
      dated_roots: 1, unknown_date_roots: 1, state: 'partial' });
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
