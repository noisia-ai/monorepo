import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { materializeSignalTopicEditorialSuccessorV1 } from '../signal-topic-editorial-materialization';

const sql = readFileSync(new URL('./0179_signal_topic_editorial_materialization.sql', import.meta.url), 'utf8');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const stateDigest = `sha256:${'a'.repeat(64)}`;

function database(value: unknown) {
  const trace: Array<{ sql: string; params?: unknown[] }> = [];
  let connected = 0;
  const client = { query: async (text: string, params?: unknown[]) => {
    trace.push({ sql: text, params });
    if (text.startsWith('SELECT materialize_signal_topic_editorial_successor_v1')) return { rows: [{ value }] };
    return { rows: [] };
  }, release: () => { connected--; trace.push({ sql: 'release' }); } } as unknown as PoolClient;
  return { database: { connect: async () => { connected++; return client; } }, trace, connected: () => connected };
}

const completed = (replayed = false) => ({ contract_version: 'signal-topic-editorial-materialization-v1',
  execution_id: id(3), revision_id: id(4), revision: 1, status: 'completed', concept_count: 42,
  decision_count: 1_652, topic_count: 26, narrative_count: 16, noise_count: 311, unresolved_count: 87,
  target_range_met: true, activation: 'not_activated', replayed });

test('0179 derives one complete SQL0174 revision without changing current Signal serving', () => {
  const materialization = sql.split('CREATE FUNCTION materialize_signal_topic_editorial_successor_v1')[1]!;
  assert.match(sql, /CREATE FUNCTION materialize_signal_topic_editorial_successor_v1/u);
  assert.match(sql, /e\.state_body::jsonb->'global'->'result'/u);
  assert.match(sql, /concept_count:=jsonb_array_length/u);
  assert.match(sql, /concept_count>120/u);
  assert.doesNotMatch(sql, /concept_count<1/u);
  assert.match(sql, /concept_count BETWEEN 24 AND 80/u);
  assert.match(sql, /decision_count<>r\.expected_group_count OR distinct_decisions<>r\.expected_group_count/u);
  assert.match(sql, /disposition','noise'/u);
  assert.match(sql, /disposition','unresolved'/u);
  assert.match(sql, /INSERT INTO signal_topic_consolidation_revisions/u);
  assert.match(sql, /VALUES\(new_revision_id,r\.id,e\.workspace_id,e\.source_engine_execution_id,revision_number,'draft'/u);
  assert.match(sql, /INSERT INTO signal_topic_editorial_concepts/u);
  assert.match(sql, /INSERT INTO signal_topic_consolidation_decisions/u);
  assert.match(sql, /validate_signal_topic_consolidation_revision_v1\(new_revision_id\)/u);
  assert.match(sql, /SET status='validated',revision_digest=new_revision_digest/u);
  assert.match(sql, /SET status='completed',result_revision_id=new_revision_id/u);
  assert.match(sql, /'activation','not_activated'/u);
  assert.doesNotMatch(sql, /SET status='superseded'/u);
  assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:signal_topic_definitions|signal_topic_selections|signal_serving|signal_materializations|signal_taxonomy_profiles|taxonomy_terms|signal_classification_generations|signal_topic_catalog_executions)/iu);
  assert.doesNotMatch(materialization, /reserve_signal_topic_editorial_call|mark_sent_signal_topic_editorial_call|anthropic|voyage/iu);
});

test('0179 completion is private, idempotent and accepts only a validated revision from the same owner', () => {
  assert.match(sql, /IF e\.status='completed' THEN/u);
  assert.match(sql, /'replayed',true/u);
  assert.match(sql, /result_revision\.status<>'validated'/u);
  assert.match(sql, /WHERE id=NEW\.result_revision_id AND consolidation_run_id=NEW\.numeric_run_id AND workspace_id=NEW\.workspace_id/u);
  assert.match(sql, /OLD\.status='review_ready'/u);
  assert.match(sql, /NEW\.plan IS DISTINCT FROM OLD\.plan/u);
  assert.match(sql, /jsonb_populate_record\(NEW,'\{"plan":null,"state_body":null\}'::jsonb\)/u);
  assert.match(sql, /NEW\.state_body IS DISTINCT FROM OLD\.state_body OR new_owner IS DISTINCT FROM old_owner/u);
  assert.match(sql, /NEW\.status<>'completed'/u);
  assert.match(sql, /topic_editorial_materialization_current_revision_present/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION materialize_signal_topic_editorial_successor_v1\(uuid,uuid,uuid,text\) FROM PUBLIC/u);
  assert.match(sql, /ARRAY\['anon','authenticated'\]/u);
});

test('DB wrapper materializes all 1,652 decisions once and preserves not-activated state', async () => {
  const fixture = database(completed());
  const result = await materializeSignalTopicEditorialSuccessorV1({ database: fixture.database,
    workspace_id: id(1), actor_user_id: id(2), execution_id: id(3), expected_state_digest: stateDigest, expected_group_count: 1_652 });
  assert.equal(result.decision_count, 1_652);
  assert.equal(result.concept_count, 42);
  assert.equal(result.target_range_met, true);
  assert.equal(result.activation, 'not_activated');
  assert.deepEqual(fixture.trace.find(item => item.sql.startsWith('SELECT materialize'))?.params,
    [id(1), id(2), id(3), stateDigest]);
  assert.deepEqual(fixture.trace.slice(-2).map(item => item.sql), ['COMMIT', 'release']);
  assert.equal(fixture.connected(), 0);
});

test('DB wrapper returns exact replay and fails closed before DB or on damaged receipts', async () => {
  const replay = database(completed(true));
  assert.equal((await materializeSignalTopicEditorialSuccessorV1({ database: replay.database,
    workspace_id: id(1), actor_user_id: id(2), execution_id: id(3), expected_state_digest: stateDigest, expected_group_count: 1_652 })).replayed, true);
  let connections = 0;
  await assert.rejects(materializeSignalTopicEditorialSuccessorV1({ database: { connect: async () => { connections++; throw Error('unexpected'); } },
    workspace_id: 'invalid', actor_user_id: id(2), execution_id: id(3), expected_state_digest: stateDigest, expected_group_count: 1_652 }), /scope_invalid/u);
  assert.equal(connections, 0);
  for (const invalid of [{ ...completed(), decision_count: 1_651 }, { ...completed(), concept_count: 121 },
    { ...completed(), target_range_met: false }, { ...completed(), activation: 'active' }]) {
    const fixture = database(invalid);
    await assert.rejects(materializeSignalTopicEditorialSuccessorV1({ database: fixture.database,
      workspace_id: id(1), actor_user_id: id(2), execution_id: id(3), expected_state_digest: stateDigest, expected_group_count: 1_652 }), /result_invalid/u);
    assert.deepEqual(fixture.trace.slice(-2).map(item => item.sql), ['ROLLBACK', 'release']);
  }
});

test('DB wrapper preserves an honest all-noise catalog with zero publishable concepts', async () => {
  const fixture = database({ ...completed(), concept_count: 0, topic_count: 0, narrative_count: 0, target_range_met: false });
  const value = await materializeSignalTopicEditorialSuccessorV1({ database: fixture.database,
    workspace_id: id(1), actor_user_id: id(2), execution_id: id(3), expected_state_digest: stateDigest, expected_group_count: 1_652 });
  assert.equal(value.concept_count, 0); assert.equal(value.target_range_met, false);
});
