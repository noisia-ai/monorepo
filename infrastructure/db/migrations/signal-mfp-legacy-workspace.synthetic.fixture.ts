import assert from 'node:assert/strict';
import type { Pool, PoolClient } from 'pg';
import { insertSignalTaxonomyDraftCoreV1 } from '../signal-taxonomy-profile';
import { loadSignalTopicInheritedContextStoreV1 } from '../signal-topic-catalog';
import { fixtureSha, workspaceProjectionFixtureBodyV1 } from './signal-workspace-topic-projection.fixture';
import { seedSignalTopicEditorialRenewalSourceV1 } from './signal-topic-editorial-renewal.synthetic.fixture';
import type { SyntheticTransactionV1 } from './signal-client-workspace-entry.synthetic.fixture';

/** Migrated PostgreSQL CI fixture for still-live workspace v1 readers/writers.
 * It creates only invented import, preparation, embedding and engine rows inside
 * one physical transaction; all product BEGIN/COMMIT operations are savepoints. */
export async function signalMfpLegacyWorkspaceFixtureV1(options: { root_count?: number; long_text?: boolean } = {}) {
  assert.equal(process.env.NOISIA_MFP_PG_CI, 'true', 'the fixture is limited to disposable migrated-schema CI');
  const { openDatabase } = await import(new URL('../../../scripts/dev-corpus/guard.mjs', import.meta.url).href);
  const pool: Pool = await openDatabase();
  const physical = await pool.connect();
  await physical.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  await physical.query('SET LOCAL search_path=public,extensions,pg_temp');
  const stack: string[] = [];
  let sequence = 0;
  const query = async (sql: string, values?: unknown[]) => {
    if (sql.startsWith('BEGIN')) {
      const key = `legacy_fixture_${++sequence}`;
      stack.push(key);
      await physical.query(`SAVEPOINT ${key}`);
      // Product readers sometimes begin read-only transactions and set local
      // planner/session guards in the same query string. Preserve those trailing
      // statements when the disposable outer transaction maps BEGIN to a savepoint.
      const separator = sql.indexOf(';');
      const remainder = separator < 0 ? '' : sql.slice(separator + 1).trim();
      return remainder ? physical.query(remainder, values) : { rows: [], rowCount: null };
    }
    if (sql === 'COMMIT') return physical.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
    if (sql === 'ROLLBACK') {
      const key = stack.pop();
      assert.ok(key, 'the synthetic fixture transaction is balanced');
      await physical.query(`ROLLBACK TO SAVEPOINT ${key}`);
      return physical.query(`RELEASE SAVEPOINT ${key}`);
    }
    return physical.query(sql, values);
  };
  const scoped = Object.assign(Object.create(physical) as PoolClient, { query, release: () => {} });
  const database = { query, connect: async () => scoped } as unknown as Pool;
  const cleanup = async () => {
    assert.equal(stack.length, 0, 'product transactions are closed before physical rollback');
    await physical.query('ROLLBACK');
    physical.release();
    await pool.end();
  };
  const transaction: SyntheticTransactionV1 = { database, scoped, query: query as never, cleanup };
  try {
    const seed = await seedSignalTopicEditorialRenewalSourceV1({ ...transaction, root_count: options.root_count, long_text: options.long_text });
    const workspace_id = seed.scope.workspace_id, actor_user_id = seed.scope.actor_user_id;
    const engine = (await query(`SELECT embedding_run_id FROM signal_topic_catalog_executions
      WHERE id=$1::uuid AND input_contract='workspace-topic-engine-v1'`, [seed.source_engine_execution_id])).rows[0];
    assert.ok(engine?.embedding_run_id, 'the source engine execution retains its actual embedding run');
    const embedding_run_id = engine.embedding_run_id as string;
    const projection = seed.projection;
    const access = { database, workspace_id, actor_user_id };
    const catalog = async () => {
      const context = await loadSignalTopicInheritedContextStoreV1({ queryable: database, workspace_id, complete_context: true });
      return insertSignalTaxonomyDraftCoreV1({ client: scoped, workspace_id, kind: 'topic',
        context_hash: fixtureSha('mfp-legacy-empty-catalog'), terms: [], rules: { topics: [] }, rule_set_metadata: {},
        provider: 'operator', model_version: 'synthetic-test', prompt_hash: fixtureSha('synthetic'), model_metadata: {},
        profile_metadata: { contract_version: 'signal-topic-catalog-v1' }, context_refs: context.context_refs });
    };
    const classificationCatalog = async () => {
      // The source fit may still be live on its taxonomy profile. Classification
      // is an independent reader/writer contract, so give it a versioned copy of
      // the same synthetic topic definitions on a profile with no engine owner.
      const source = (await query(`SELECT profile.id,profile.taxonomy_id,rule_set.rules,
        COALESCE(jsonb_agg(jsonb_build_object('term_key',term.term_key,'label',term.label,
          'definition',term.metadata->'topic'->>'definition','metadata',term.metadata,'status',term.status)
          ORDER BY term.term_key) FILTER(WHERE term.id IS NOT NULL),'[]'::jsonb) terms
        FROM signal_taxonomy_profiles profile JOIN tagging_rule_sets rule_set ON rule_set.id=profile.rule_set_id
        LEFT JOIN taxonomy_terms term ON term.taxonomy_id=profile.taxonomy_id
        WHERE profile.workspace_id=$1::uuid AND profile.kind='topic'
        GROUP BY profile.id,profile.taxonomy_id,rule_set.rules ORDER BY profile.version DESC LIMIT 1`, [workspace_id])).rows[0];
      assert.ok(source, 'the synthetic source topic profile exists');
      const context = await loadSignalTopicInheritedContextStoreV1({ queryable: database, workspace_id, complete_context: true });
      return insertSignalTaxonomyDraftCoreV1({ client: scoped, workspace_id, kind: 'topic',
        context_hash: fixtureSha('mfp-legacy-classification-catalog'),
        terms: source.terms.map((term: { term_key: string; label: string; definition: string; metadata: Record<string, unknown>; status: 'candidate'|'archived' }) => ({
          term_key: term.term_key, label: term.label, definition: term.definition, metadata: term.metadata, status: term.status,
        })), rules: source.rules, rule_set_metadata: {}, provider: 'operator', model_version: 'synthetic-test',
        prompt_hash: fixtureSha('synthetic'), model_metadata: {},
        profile_metadata: { contract_version: 'signal-topic-catalog-v1', synthetic_classification_copy: true },
        context_refs: context.context_refs });
    };
    const runProjection = (projectionOptions: Parameters<typeof workspaceProjectionFixtureBodyV1>[1] = {}) =>
      workspaceProjectionFixtureBodyV1({ ...transaction, workspace_id, actor_user_id, embedding_run_id,
        cleanup: async () => {} }, projectionOptions);
    return { ...transaction, ...seed, ...projection, database, query, workspace_id, actor_user_id, embedding_run_id,
      engine_execution_id: seed.source_engine_execution_id, access, catalog, classificationCatalog, runProjection, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
