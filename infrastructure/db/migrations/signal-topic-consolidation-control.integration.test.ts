import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import pg, { type Pool, type PoolClient } from 'pg';
import { loadSignalWorkspaceCapabilitiesStoreV1 } from '../signal-workspace-capabilities';
import { claimSignalTopicConsolidationDispatchV1, claimSignalTopicConsolidationExecutionV1,
  loadSignalTopicConsolidationStatusV1, recoverSignalTopicConsolidationExecutionsV1,
  requestSignalTopicConsolidationV1, retrySignalTopicConsolidationV1 } from '../signal-topic-consolidation-control';

/** Requires the complete, already migrated, EMPTY local synthetic schema.
 * No migration, import, provider, fake fit or trigger/RLS bypass runs here.
 * DATABASE_URL is read only when this dedicated opt-in is true; no fallback.
 */
const enabled = process.env.NOISIA_TOPIC_CONSOLIDATION_PG_APPROVED === 'true';
const controlTables = ['signal_topic_consolidation_executions', 'signal_topic_consolidation_request_keys', 'signal_topic_consolidation_outbox'];
const moneyTables = ['engine_cost_events', 'signal_workspace_embedding_calls', 'signal_semantic_context_budget_reservations',
  'signal_semantic_context_proposal_runs', 'signal_workspace_embedding_runs'];

test('0174 + 0175 PostgreSQL: numeric policy, exact authority, source gate, atomic admission, ACL/RLS and physical rollback',
  { skip: !enabled, timeout: 30_000 }, async t => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55439');
    assert.match(url.pathname, /^\/noisia_topic_consolidation_(?:smoke|test)_[a-z0-9_]+$/u);
    const pool = new pg.Pool({ connectionString: url.href, ssl: false, max: 1 });
    const client = await pool.connect();
    let physicalTransaction = false, policyReady = false, savepoint = 0;
    const stack: string[] = [];
    const query = async (sql: string, values?: unknown[]) => {
      if (sql.startsWith('BEGIN')) {
        const name = `consolidation_nested_${++savepoint}`; stack.push(name);
        return client.query(`SAVEPOINT ${name}`);
      }
      if (sql === 'COMMIT') return client.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
      if (sql === 'ROLLBACK') {
        const name = stack.pop()!; await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        return client.query(`RELEASE SAVEPOINT ${name}`);
      }
      return client.query(sql, values);
    };
    const scoped = Object.create(client) as PoolClient;
    scoped.query = query as PoolClient['query']; scoped.release = () => {};
    const database = Object.assign(Object.create(pool) as Pool, { connect: async () => scoped });
    const isolated = async (work: () => Promise<void>) => {
      const name = `consolidation_case_${++savepoint}`; await client.query(`SAVEPOINT ${name}`);
      try { await work(); } finally {
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`); await client.query(`RELEASE SAVEPOINT ${name}`);
      }
    };
    const denied = async (work: () => Promise<unknown>, expected: string | RegExp) => isolated(async () => {
      await assert.rejects(work, caught => caught instanceof Error && (typeof expected === 'string'
        ? caught.message === expected : expected.test(caught.message)));
    });
    const counts = async () => {
      const result: Record<string, number> = {};
      for (const table of [...controlTables, ...moneyTables, 'signal_processing_admissions'])
        result[table] = (await client.query(`SELECT count(*)::integer count FROM ${table}`)).rows[0]!.count;
      return result;
    };
    const organization = randomUUID(), foreignOrganization = randomUUID(), internal = randomUUID(), actor = randomUUID();
    const brand = randomUUID(), foreignBrand = randomUUID(), policy = randomUUID(), absentSource = randomUUID();
    try {
      // Refuse a populated or remote-shaped destination before any fixture write.
      assert.equal((await client.query('SELECT count(*)::integer count FROM organizations')).rows[0]!.count, 0);
      assert.equal((await client.query('SELECT count(*)::integer count FROM signal_topic_catalog_executions')).rows[0]!.count, 0);
      const installed = (await client.query(`SELECT to_regclass('public.signal_topic_consolidation_runs')::text foundation,
        to_regprocedure('public.request_signal_topic_consolidation_v1(uuid,uuid,uuid,text,text)')::text control`)).rows[0]!;
      assert.ok(installed.foundation && installed.control, '0174 and 0175 must already be installed');
      const before = await counts();
      await client.query('BEGIN'); physicalTransaction = true;
      await client.query("SET LOCAL search_path=public,extensions,pg_temp; SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='2s'");
      for (const id of [organization, foreignOrganization]) await client.query(`INSERT INTO organizations(id,slug,legal_name,status)
        VALUES($1,$2,'Synthetic consolidation control organization','active')`, [id, `consolidation-${id}`]);
      for (const [id, org] of [[brand, organization], [foreignBrand, foreignOrganization]])
        await client.query(`INSERT INTO brands(id,organization_id,slug,name,description,status)
          VALUES($1,$2,$3,'Synthetic consolidation brand','Invented fixture; no customer data','active')`, [id, org, `consolidation-${id}`]);
      const workspace = (await client.query('SELECT id FROM signal_workspaces WHERE brand_id=$1', [brand])).rows[0]!.id as string;
      const foreignWorkspace = (await client.query('SELECT id FROM signal_workspaces WHERE brand_id=$1', [foreignBrand])).rows[0]!.id as string;
      for (const [id, type, role] of [[internal, 'noisia_internal', 'noisia_admin'], [actor, 'client', 'client_admin']])
        await client.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status)
          VALUES($1,$2,'Synthetic consolidation actor',$3,$4,$5,'active')`, [id, `${id}@example.test`, type, role, organization]);
      await client.query("INSERT INTO user_brand_access(user_id,brand_id,access_level) VALUES($1,$2,'admin')", [actor, brand]);
      const access = { database, workspace_id: workspace, actor_user_id: actor };
      const quote = async (who = actor, target: string | null = null) => (await client.query(
        'SELECT signal_topic_consolidation_quote_v1($1,$2,$3) body', [workspace, who, target])).rows[0]!.body;
      const makePolicy = async (id: string, version: number) => client.query(`INSERT INTO signal_processing_policy_versions(
        id,organization_id,version,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
        VALUES($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 day','America/Mexico_City',20000000,$4)`,
      [id, organization, version, internal]);
      const addNumeric = async (id: string, cap = 0, automatic = false) => client.query(`INSERT INTO signal_processing_policy_actions(
        policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
        SELECT $1,'topic_consolidation_numeric','free',NULL,NULL,configuration,
          signal_semantic_context_digest_json_v2(configuration),$2,$3 FROM (SELECT signal_topic_consolidation_numeric_configuration_v1() configuration) c`, [id, cap, automatic]);
      await t.test('separate numeric action is explicitly versioned, cap0 and immutable; no policy is provisioned implicitly', async () => {
        await query('BEGIN');
        try {
        assert.equal((await client.query('SELECT count(*)::integer n FROM signal_processing_policy_versions')).rows[0]!.n, 0);
        await makePolicy(policy, 1);
        await addNumeric(policy);
        await denied(() => addNumeric(policy, 1), /check constraint/u);
        await denied(() => addNumeric(policy, 0, true), /check constraint/u);
        await client.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,
          configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
          VALUES($1,'topic_consolidation','provider','anthropic','claude-sonnet-4-6','{}',signal_semantic_context_digest_json_v2('{}'),20000000,false)`, [policy]);
        await client.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1", [policy]);
        const stored = (await client.query(`SELECT p.version::text version,p.created_by_user_id,p.policy_digest,a.kind,a.provider,a.model,
          a.max_execution_micro_usd::text cap,a.automatic_allowed FROM signal_processing_policy_versions p JOIN signal_processing_policy_actions a
          ON a.policy_version_id=p.id WHERE p.id=$1 AND a.action='topic_consolidation_numeric'`, [policy])).rows[0]!;
        assert.deepEqual({ ...stored, policy_digest: undefined }, { version: '1', created_by_user_id: internal, policy_digest: undefined,
          kind: 'free', provider: null, model: null, cap: '0', automatic_allowed: false });
        assert.match(stored.policy_digest, /^sha256:[a-f0-9]{64}$/u);
        await denied(() => client.query('UPDATE signal_processing_policy_actions SET max_execution_micro_usd=1 WHERE policy_version_id=$1', [policy]), 'processing_policy_action_immutable');
        await query('COMMIT'); policyReady = true;
        } catch (error) { await query('ROLLBACK'); throw error; }
      });
      await t.test('exact client_admin/admin capability never grants can_execute, foreign tenant, revoked grant or alias', async () => {
        const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: scoped, workspace_id: workspace, actor_user_id: actor });
        assert.equal(caps.can_request_processing, true); assert.equal(caps.can_execute_topics, false);
        assert.equal((await quote()).status, 'source_required');
        assert.equal((await quote(internal)).status, 'source_required');
        assert.equal((await client.query('SELECT signal_topic_consolidation_quote_v1($1,$2,NULL) body', [foreignWorkspace, actor])).rows[0]!.body.status, 'access_required');
        for (const sql of ["UPDATE users SET primary_role='client_owner' WHERE id=$1", "UPDATE users SET status='suspended' WHERE id=$1",
          "UPDATE user_brand_access SET revoked_at=clock_timestamp() WHERE user_id=$1", "UPDATE user_brand_access SET access_level='comment' WHERE user_id=$1"])
          await isolated(async () => { await client.query(sql, [actor]); assert.equal((await quote()).status, 'access_required'); });
      });
      await t.test('missing source never fabricates quote, owner or queue; request retry remains inert', async () => {
        const status = await loadSignalTopicConsolidationStatusV1(access);
        assert.equal(status.status, 'source_required'); assert.equal(status.can_request, false);
        assert.equal(status.provider_execution_enabled, false); assert.equal(status.maximum_micro_usd, '0');
        assert.equal(status.quote_reference, null); assert.equal(status.execution, null);
        assert.equal((await quote(actor, absentSource)).status, 'source_stale');
        const request = { ...access, source_execution_id: absentSource, idempotency_key: randomUUID(),
          quote_reference: `v1.${Math.floor(Date.now() / 1000) + 120}.${'0'.repeat(64)}` };
        for (let attempt = 0; attempt < 2; attempt++)
          await assert.rejects(requestSignalTopicConsolidationV1(request), { code: 'topic_consolidation_preflight_blocked' });
        assert.deepEqual(await counts(), before);
      });
      await t.test('a numeric admission alone cannot commit, and paid consolidation admission is disabled', {
        skip: policyReady ? false : 'Prerequisite numeric policy/action was rejected; no replacement grant is fabricated.',
      }, async () => {
        const admission = (action: string) => client.query(`INSERT INTO signal_processing_admissions(id,organization_id,workspace_id,brand_id,
          actor_user_id,policy_version_id,action,target_id,idempotency_key,request_digest,provider,model,configuration,configuration_digest,
          execution_cap_micro_usd,budget_date,budget_timezone,admission_not_after,automatic,receipt_digest)
          SELECT gen_random_uuid(),$2,$3,$4,$5,$1,a.action,gen_random_uuid(),$6,signal_semantic_context_digest_json_v2('{}'),a.provider,a.model,
            a.configuration,a.configuration_digest,a.max_execution_micro_usd,(clock_timestamp() AT TIME ZONE p.budget_timezone)::date,
            p.budget_timezone,least(p.valid_until,(((clock_timestamp() AT TIME ZONE p.budget_timezone)::date+1)::timestamp AT TIME ZONE p.budget_timezone)),false,'pending'
          FROM signal_processing_policy_versions p JOIN signal_processing_policy_actions a ON a.policy_version_id=p.id WHERE p.id=$1 AND a.action=$7`,
        [policy, organization, workspace, brand, actor, randomUUID(), action]);
        await isolated(async () => {
          assert.equal((await admission('topic_consolidation_numeric')).rowCount, 1);
          await assert.rejects(client.query('SET CONSTRAINTS topic_consolidation_admission_complete IMMEDIATE'),
            { code: '23514', message: 'topic_consolidation_admission_incomplete' });
        });
        await denied(() => admission('topic_consolidation'), 'topic_consolidation_provider_disabled');
        assert.deepEqual(await counts(), before);
      });
      await t.test('all new control functions and tables are private and RLS remains enabled', async () => {
        const sql = readFileSync(new URL('./0175_signal_topic_consolidation_control.sql', import.meta.url), 'utf8');
        const names = [...sql.matchAll(/CREATE FUNCTION ([a-z0-9_]+)\(/gu)].map(match => match[1]!);
        assert.equal(new Set(names).size, names.length);
        const acl = (await client.query(`WITH funcs AS (SELECT p.oid,p.proowner,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname=ANY($1::text[])) SELECT count(*)::integer count,
          (SELECT count(*)::integer FROM funcs f CROSS JOIN LATERAL aclexplode(COALESCE(f.proacl,acldefault('f',f.proowner))) a
            WHERE a.grantee=0 AND a.privilege_type='EXECUTE') public_execute,
          (SELECT count(*)::integer FROM funcs f CROSS JOIN pg_roles r WHERE r.rolname IN('anon','authenticated')
            AND has_function_privilege(r.oid,f.oid,'EXECUTE')) client_execute FROM funcs`, [names])).rows[0]!;
        assert.deepEqual(acl, { count: names.length, public_execute: 0, client_execute: 0 });
        const tables = (await client.query(`SELECT c.relname,c.relrowsecurity,
          EXISTS(SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0) public_access,
          EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN('anon','authenticated') AND
            has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE')) client_access
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])`, [controlTables])).rows;
        assert.equal(tables.length, 3);
        for (const row of tables) assert.deepEqual({ ...row, relname: undefined },
          { relname: undefined, relrowsecurity: true, public_access: false, client_access: false });
      });
      await t.test('empty dispatch/recovery is inert and a nonexistent owner never obtains a worker lease or retry', async () => {
        assert.deepEqual(await claimSignalTopicConsolidationDispatchV1({ database, worker_id: 'synthetic-control-worker' }), []);
        assert.equal(await recoverSignalTopicConsolidationExecutionsV1({ database }), 0);
        assert.equal(await claimSignalTopicConsolidationExecutionV1({ database, execution_id: absentSource,
          worker_job_id: `topic-consolidation-${absentSource}-1` }), null);
        await denied(() => client.query('SELECT assert_signal_topic_consolidation_worker_scope_v1($1,$2,$3,$4,$5)',
          [absentSource, randomUUID(), workspace, actor, randomUUID()]), 'topic_consolidation_lease_conflict');
        await assert.rejects(retrySignalTopicConsolidationV1({ ...access, execution_id: absentSource, idempotency_key: randomUUID() }),
          { code: 'topic_consolidation_retry_unavailable' });
        assert.deepEqual(await counts(), before);
      });
      await t.test('source → request/outbox/claim → centroid affinity/materialization → recovery/retry/completion', {
        skip: 'Requires a genuine synthetic prepared corpus, completed embedding receipts and sealed BERTopic output. Empty-schema gate does not fabricate these histories or bypass their triggers.',
      }, () => {});
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      assert.deepEqual(await counts(), before, 'all provider ledgers, jobs and admissions remain unchanged');
      await client.query('ROLLBACK'); physicalTransaction = false;
      assert.deepEqual(await counts(), before);
      assert.equal((await client.query('SELECT count(*)::integer count FROM organizations')).rows[0]!.count, 0,
        'physical rollback removes every synthetic identity and policy');
    } finally {
      if (physicalTransaction) await client.query('ROLLBACK');
      client.release(); await pool.end();
    }
  });
