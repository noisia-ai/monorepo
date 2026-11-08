import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { loadAdminWorkspaceCorpusSummariesV1 } from '../admin-workspace-corpus-summary';
import { loadSignalWorkspaceCorpusReadinessStoreV1 } from '../signal-workspace-corpus-readiness';
import { signalMfpLegacyWorkspaceFixtureV1 } from './signal-mfp-legacy-workspace.synthetic.fixture';

test('admin corpus receipt aggregation uses migrated PostgreSQL data and live authorization', {
  skip: process.env.NOISIA_MFP_PG_CI !== 'true', timeout: 300_000,
}, async () => {
  const f = await signalMfpLegacyWorkspaceFixtureV1();
  try {
    const { organization_id, brand_id, actor_user_id } = f.identity;
    const workspaceId = f.workspace_id;
    const siblingBrand = randomUUID();
    await f.query(`INSERT INTO brands(id,organization_id,slug,name,description,status)
      VALUES($1::uuid,$2::uuid,$3,'Synthetic sibling brand','Synthetic authorization fixture','active')`,
    [siblingBrand, organization_id, `admin-summary-${siblingBrand}`]);
    const siblingWorkspace = (await f.query('SELECT id FROM signal_workspaces WHERE brand_id=$1::uuid AND organization_id=$2::uuid',
      [siblingBrand, organization_id])).rows[0]?.id as string;
    assert.ok(siblingWorkspace, 'real brand provisioning creates the sibling workspace');

    const existingBatch = (await f.query(`SELECT id,study_corpus_id,workspace_id,data_source_id,source_system,source_file_name,source_file_hash,
      record_count,included_count,excluded_count,duplicate_count,imported_by_user_id
      FROM import_batches WHERE workspace_id=$1::uuid AND status='completed' ORDER BY created_at LIMIT 1`, [workspaceId])).rows[0];
    assert.ok(existingBatch, 'the migrated synthetic source has a completed import receipt');
    const importedRoots = (await f.query(`SELECT mention_id::text FROM signal_mention_import_memberships
      WHERE workspace_id=$1::uuid AND import_batch_id=$2::uuid ORDER BY mention_id`, [workspaceId, existingBatch.id])).rows as Array<{mention_id: string}>;
    assert.equal(importedRoots.length, f.projection.roots.length,
      'the first accepted import has one durable receipt link per synthetic root');
    const secondBatchId = randomUUID();
    const secondBatchCounts = { records_read: 4, included: 1, excluded: 1, duplicates: 2 };
    await f.query(`INSERT INTO import_batches(id,study_corpus_id,workspace_id,data_source_id,source_system,source_file_name,source_file_hash,status,
      record_count,included_count,excluded_count,duplicate_count,imported_by_user_id)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,'completed',$8,$9,$10,$11,$12::uuid)`,
    [secondBatchId, existingBatch.study_corpus_id, workspaceId, existingBatch.data_source_id, existingBatch.source_system,
      'synthetic-second-accepted-import.txt', createHash('sha256').update('synthetic second import').digest('hex'),
      secondBatchCounts.records_read, secondBatchCounts.included, secondBatchCounts.excluded,
      secondBatchCounts.duplicates, existingBatch.imported_by_user_id]);
    for (const [index, root] of importedRoots.slice(0, 3).entries()) {
      const disposition = (['included', 'excluded', 'duplicate'] as const)[index]!;
      await f.query('SELECT record_signal_workspace_import_provenance_v1($1::uuid,$2::uuid,$3)',
        [root.mention_id, secondBatchId, disposition]);
    }
    const secondBatchMemberships = (await f.query(`SELECT count(*)::int roots,
      count(*) FILTER(WHERE EXISTS(SELECT 1 FROM signal_mention_import_memberships first
        WHERE first.import_batch_id=$2::uuid AND first.mention_id=second.mention_id))::int shared_roots
      FROM signal_mention_import_memberships second WHERE second.import_batch_id=$1::uuid`, [secondBatchId, existingBatch.id])).rows[0] as {roots: number; shared_roots: number};
    assert.deepEqual(secondBatchMemberships, { roots: 3, shared_roots: 3 },
      'the second accepted receipt shares canonical roots with the first');
    await f.query(`INSERT INTO import_batches(id,study_corpus_id,workspace_id,data_source_id,source_system,source_file_name,source_file_hash,status,
      record_count,included_count,excluded_count,duplicate_count,imported_by_user_id)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,'failed',$8,$9,$10,$11,$12::uuid)`,
    [randomUUID(), existingBatch.study_corpus_id, existingBatch.workspace_id, existingBatch.data_source_id, existingBatch.source_system,
      'synthetic-failed-import.txt', existingBatch.source_file_hash, existingBatch.record_count,
      existingBatch.included_count, existingBatch.excluded_count, existingBatch.duplicate_count, existingBatch.imported_by_user_id]);
    await f.query(`UPDATE mentions SET inclusion_status='excluded' WHERE id=(SELECT mention_id FROM signal_mention_import_memberships
      WHERE workspace_id=$1::uuid ORDER BY mention_id LIMIT 1)`, [workspaceId]);
    await f.query(`UPDATE mentions SET published_at='infinity'::timestamptz WHERE id=(SELECT mention_id FROM signal_mention_import_memberships
      WHERE workspace_id=$1::uuid ORDER BY mention_id DESC LIMIT 1)`, [workspaceId]);
    await f.query("UPDATE signal_workspaces SET timezone='Pacific/Kiritimati' WHERE id=$1::uuid", [workspaceId]);
    for (const connectionMethod of ['manual-csv', 'api']) {
      const sourceId = randomUUID();
      await f.query(`INSERT INTO data_sources(id,workspace_id,organization_id,brand_id,source_type,provider,connection_method,name,source_key,status)
        VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'social_listening','synthetic',$5,$6,$7,'active')`,
      [sourceId, workspaceId, organization_id, brand_id, connectionMethod, `Synthetic unimported ${connectionMethod}`,
        `source-sha256-${createHash('sha256').update(sourceId).digest('hex')}`]);
    }

    let statements = 0;
    const queryable = { query: async <Row extends Record<string, unknown>>(sql: string, values?: unknown[]) => {
      statements++;
      return f.database.query<Row>(sql, values);
    } };
    const summaryResult = await loadAdminWorkspaceCorpusSummariesV1({
      queryable, workspace_ids: [workspaceId, workspaceId, siblingWorkspace, randomUUID()], actor_user_id,
    });
    const summary = summaryResult.get(workspaceId);
    assert.equal(statements, 2, 'one real authorization batch and one PostgreSQL aggregate serve every requested workspace');
    assert.equal(summaryResult.size, 2, 'the internal analyst sees both active workspaces, unknown IDs have no result');
    assert.ok(summary);
    assert.equal(summary.received_unique_roots, f.projection.roots.length, 'canonical roots are counted once');
    assert.equal(summary.included_roots, f.projection.roots.length - 1);
    assert.equal(summary.excluded_roots, 1);
    assert.equal(summary.pending_roots, 0);
    assert.equal(summary.accepted_files, 2, 'both accepted imports count independently; a failed import does not count');
    assert.equal(summary.records_read, Number(existingBatch.record_count) + secondBatchCounts.records_read,
      'records read sum the independent receipt counters even when roots overlap');
    assert.equal(summary.duplicate_rows, Number(existingBatch.duplicate_count) + secondBatchCounts.duplicates,
      'duplicate rows sum the independent receipt counters');
    assert.deepEqual(summary.capture_scopes,
      { primary_brand: 0, competitor: 0, category: 0, reference: 0, unknown: 2 },
      'each accepted legacy receipt contributes its own unknown capture scope');
    assert.equal(summary.coverage.unknown_date_roots, 1);
    assert.equal(summary.coverage.state, 'partial');
    assert.equal(summary.coverage.timezone, 'Pacific/Kiritimati');
    assert.equal(summary.coverage.from, '2026-09-02', 'observed coverage follows the persisted workspace timezone');
    assert.equal(summary.unmeasured_sources, 1, 'unimported API sources remain explicitly unmeasured');
    assert.equal(summary.measurement_state, 'partial');
    assert.equal(summary.sources_without_accepted_imports, 2, 'manual CSV is known zero while API import remains unmeasured');
    assert.deepEqual(summaryResult.get(siblingWorkspace)?.received_unique_roots, 0,
      'shared mention memberships never leak into the sibling workspace');
    assert.equal(summaryResult.get(siblingWorkspace)?.accepted_files, 0);
    assert.deepEqual(summaryResult.get(siblingWorkspace)?.capture_scopes,
      { primary_brand: 0, competitor: 0, category: 0, reference: 0, unknown: 0 });

    const readiness = await loadSignalWorkspaceCorpusReadinessStoreV1({ queryable: f.database, workspace_id: workspaceId });
    assert.equal(summary.received_unique_roots, readiness.projection.linked_roots,
      'readiness reports the same distinct roots despite overlapping import memberships');
    assert.equal(summary.records_read, readiness.records_read);
    assert.equal(summary.accepted_files, readiness.accepted_files);

    const clientId = randomUUID();
    await f.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,status,organization_id)
      VALUES($1::uuid,$2,'Synthetic corpus summary client','client','client_viewer','active',$3::uuid)`,
    [clientId, `${clientId}@example.test`, organization_id]);
    statements = 0;
    assert.equal((await loadAdminWorkspaceCorpusSummariesV1({ queryable, workspace_ids: [workspaceId, siblingWorkspace], actor_user_id: clientId })).size, 0,
      'a same-organization client without a brand grant cannot read either workspace');
    assert.equal(statements, 1, 'denied clients are filtered before the aggregate query');

    await f.query(`INSERT INTO user_brand_access(user_id,brand_id,access_level,granted_by_user_id)
      VALUES($1::uuid,$2::uuid,'read',$3::uuid)`, [clientId, brand_id, actor_user_id]);
    statements = 0;
    const granted = await loadAdminWorkspaceCorpusSummariesV1({
      queryable, workspace_ids: [workspaceId, siblingWorkspace], actor_user_id: clientId,
    });
    assert.deepEqual([...granted.keys()], [workspaceId], 'a read grant reveals only its own brand workspace');
    assert.equal(statements, 2);
    await f.query('UPDATE user_brand_access SET revoked_at=clock_timestamp() WHERE user_id=$1::uuid AND brand_id=$2::uuid', [clientId, brand_id]);
    assert.equal((await loadAdminWorkspaceCorpusSummariesV1({ queryable, workspace_ids: [workspaceId], actor_user_id: clientId })).size, 0,
      'revoked grants stop revealing the workspace');

    await f.query("UPDATE users SET status='suspended' WHERE id=$1::uuid", [actor_user_id]);
    assert.equal((await loadAdminWorkspaceCorpusSummariesV1({ queryable, workspace_ids: [workspaceId, siblingWorkspace], actor_user_id })).size, 0,
      'suspended internal actors receive no workspace summaries');
  } finally {
    await f.cleanup();
  }
});
