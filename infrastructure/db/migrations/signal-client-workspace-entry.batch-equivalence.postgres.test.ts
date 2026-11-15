import assert from 'node:assert/strict';
import test from 'node:test';
import { openR16CiPostgresV1, openR16LocalPostgresV1, assertR16LocalPostgresPoolV1 } from './signal-r16-local-pg.fixture';
import { syntheticImportedWorkspaceFixtureV1, type SyntheticTransactionV1 } from './signal-client-workspace-entry.synthetic.fixture';

test('batched synthetic import preserves 16 roots, memberships, hashes and native policies', {
  skip: process.env.NOISIA_R16_LOCAL_PG_LAB !== 'r16-benchmark-pg17', timeout: 180_000,
}, async () => {
  const database = process.env.GITHUB_ACTIONS === 'true'
    ? await openR16CiPostgresV1() : await openR16LocalPostgresV1();
  assertR16LocalPostgresPoolV1(database);
  const client = await database.connect();
  const tx: SyntheticTransactionV1 = {
    database,
    scoped: client,
    query: (sql, values) => client.query(sql, values as never) as never,
    cleanup: async () => {},
  };
  try {
    await client.query('BEGIN');
    const rowwise = await syntheticImportedWorkspaceFixtureV1(tx, undefined, { root_count: 16, batch_size: 1 });
    const batched = await syntheticImportedWorkspaceFixtureV1(tx, undefined, { root_count: 16, batch_size: 8 });
    const snapshot = async (workspaceId: string) => ({
      mentions: (await client.query(`SELECT m.text_raw,m.text_clean,m.text_hash,m.text_length,m.published_at,
          m.platform,m.resolved_platform,m.language,m.inclusion_status,m.source_system,
          membership.ingestion_disposition
        FROM mentions m JOIN signal_mention_import_memberships membership
          ON membership.workspace_id=m.workspace_id AND membership.mention_id=m.id
        WHERE m.workspace_id=$1 ORDER BY m.text_raw`, [workspaceId])).rows,
      quality: (await client.query(`SELECT policy_key,policy_version,status,canonical_root_disposition,min_quality_score
        FROM signal_quality_policies WHERE workspace_id=$1 ORDER BY policy_key`, [workspaceId])).rows,
      retention: (await client.query(`SELECT policy_key,policy_version,status,retention_state,retention_mode,expiry_action
        FROM signal_retention_policies WHERE workspace_id=$1 ORDER BY policy_key`, [workspaceId])).rows,
      license: (await client.query(`SELECT policy.policy_key,policy.policy_version,policy.status,
          usage.usage_purpose,usage.decision
        FROM signal_licensing_policies policy JOIN signal_licensing_policy_usages usage
          ON usage.workspace_id=policy.workspace_id AND usage.licensing_policy_id=policy.id
        WHERE policy.workspace_id=$1 ORDER BY policy.policy_key,usage.usage_purpose`, [workspaceId])).rows,
      provenance: (await client.query(`SELECT data_source_id IS NOT NULL source_bound,
          quality_policy_id IS NOT NULL quality_bound,retention_policy_id IS NOT NULL retention_bound,
          licensing_policy_id IS NOT NULL license_bound,status
        FROM signal_provenance_policy_bindings WHERE workspace_id=$1`, [workspaceId])).rows,
    });
    const one = await snapshot(rowwise.workspace_id);
    const many = await snapshot(batched.workspace_id);
    assert.deepEqual(many.mentions, one.mentions);
    assert.equal(many.mentions.length, 16);
    assert.ok(many.mentions.every(row => /^sha256:[0-9a-f]{64}$/u.test(String(row.text_hash))));
    assert.deepEqual(many.quality, one.quality);
    assert.deepEqual(many.retention, one.retention);
    assert.deepEqual(many.license, one.license);
    assert.deepEqual(many.provenance, one.provenance);
    assert.equal(many.provenance.length, 1);
    assert.deepEqual(many.provenance[0], { source_bound: true, quality_bound: true,
      retention_bound: true, license_bound: true, status: 'active' });
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await database.end();
  }
});
