import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import test from 'node:test';
import pg from 'pg';
import { validateSignalTopicEditorialScreeningOutputV1,
  validateSignalTopicEditorialScreeningCoverageV1, buildSignalTopicEditorialGlobalReviewV1 } from '@noisia/query-engine';
import { loadSignalTopicConsolidationEditorialInputV1 } from './signal-topic-consolidation-editorial-input';
import { seedSignalTopicEditorialRenewalSourceV1 } from './migrations/signal-topic-editorial-renewal.synthetic.fixture';

const file = process.env.NOISIA_EDITORIAL_RENEWAL_PG_URL_FILE;
const approved = Boolean(file || process.env.DATABASE_URL);
const sql = readFileSync(new URL('./migrations/0184_signal_topic_editorial_renewal.sql', import.meta.url), 'utf8');
const id = '10000000-0000-4000-8000-000000000001';

async function installWithinRollback(client: pg.PoolClient) {
  try { await client.query(sql); }
  catch (error) {
    const pgError = error as { code?: string; position?: string; internalPosition?: string; routine?: string };
    throw new Error(`sql0184_install_${pgError.code ?? 'unknown'}_at_${pgError.position ?? pgError.internalPosition ?? 'unknown'}_${pgError.routine ?? 'unknown'}`);
  }
}

async function assertEmptyPrivateSchema(client: pg.PoolClient) {
  const { schemaFingerprint } = await import('./scripts/noi19-dev-test/database-checks.mjs');
  assert.equal(await schemaFingerprint(client), 'ff26cd9ba6c0cbe2c8b6e7178b85463a3fa67ecea0f0f91ef672213b0cc3f94b',
    'SQL0182 private schema fingerprint changed');
  const tables = (await client.query<{ name: string }>(`SELECT c.relname name FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p')`)).rows;
  assert.equal(tables.length, 299, 'SQL0182 private schema expected');
  for (const table of tables) {
    const quoted = `public."${table.name.replaceAll('"', '""')}"`;
    assert.equal((await client.query(`SELECT EXISTS(SELECT 1 FROM ${quoted} LIMIT 1) nonempty`)).rows[0]?.nonempty, false,
      'synthetic acceptance requires every table empty');
  }
}

async function privateEmptyPool() {
  assert.equal(process.env.RAILWAY_ENVIRONMENT_ID, '5bad359d-cfa4-4e8f-aa41-98e6f075375a');
  assert.equal(process.env.RAILWAY_SERVICE_ID, 'fb2b5925-d7aa-4d5d-9353-6e54dfe38c0e');
  assert.equal(process.env.NOISIA_DEV_TEST_DATABASE_SERVICE_ID, '8cc1601e-a87a-4b23-ae7c-9a4dc0a315a0');
  const parsed = new URL(file ? readFileSync(file, 'utf8').trim() : process.env.DATABASE_URL!);
  const expectedSystemId = process.env.NOISIA_EDITORIAL_RENEWAL_PG_SYSTEM_ID;
  assert.equal(parsed.hostname, 'pgvector.railway.internal', 'only the private dev-test target is allowed');
  assert.equal(parsed.port || '5432', '5432'); assert.equal(parsed.pathname, '/noisia_dev_test');
  assert.equal(parsed.username, 'noisia_dev');
  assert.equal(expectedSystemId, '7683766906362679330', 'the reviewed readonly system identifier is required');
  const addresses = await lookup(parsed.hostname, { all: true });
  assert.ok(addresses.length > 0 && addresses.every(row => isIP(row.address) === 6
    ? /^(?:fc|fd)[0-9a-f]{2}:/iu.test(row.address)
    : isIP(row.address) === 4 && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/u.test(row.address)));
  const pool = new pg.Pool({ connectionString: parsed.href, max: 1, ssl: false });
  const client = await pool.connect();
  try {
    const systemId = (await client.query<{ system_identifier: string }>(
      'SELECT system_identifier::text FROM pg_control_system()')).rows[0]?.system_identifier;
    assert.equal(systemId, expectedSystemId, 'private PostgreSQL identity changed');
    await assertEmptyPrivateSchema(client);
    assert.equal((await client.query('SELECT count(*)::int count FROM organizations')).rows[0]?.count, 0,
      'synthetic acceptance requires an empty target');
  } catch (error) { client.release(); await pool.end(); throw error; }
  return { pool, client };
}

function nestedClient(client: pg.PoolClient, pool: pg.Pool) {
  const stack: string[] = []; let serial = 0;
  let firstFailure: { code: string; message: string; statement: string } | null = null;
  const query = async (sql: string, params?: unknown[]) => {
    try {
    if (/^BEGIN(?:\s|;|$)/u.test(sql)) {
      const [begin, ...settings] = sql.split(';').map(part => part.trim()).filter(Boolean);
      // A nested semantic finalizer requests SERIALIZABLE in production. This
      // rollback harness exercises its logic within a savepoint, not its
      // concurrency guarantee; concurrency is outside this acceptance scope.
      assert.match(begin!, /^BEGIN(?: ISOLATION LEVEL (?:READ COMMITTED|REPEATABLE READ|SERIALIZABLE)(?: READ ONLY)?)?$/u);
      const name = `editorial_renewal_${++serial}`; stack.push(name);
      const result = await client.query(`SAVEPOINT ${name}`);
      for (const setting of settings) { assert.match(setting, /^SET LOCAL /u); await client.query(setting); }
      return result;
    }
    if (sql === 'COMMIT' || sql === 'ROLLBACK') {
      const name = stack.pop(); assert.ok(name, 'balanced fixture savepoint');
      if (sql === 'ROLLBACK') await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      return client.query(`RELEASE SAVEPOINT ${name}`);
    }
    return await client.query(sql, params);
    } catch (error) {
      const failure = error as { code?: string; message?: string };
      firstFailure ??= { code: failure.code ?? 'unknown',
        message: String(failure.message ?? 'unknown').slice(0, 180),
        statement: sql.replace(/\s+/gu, ' ').slice(0, 80) };
      throw error;
    }
  };
  const scoped = Object.assign(Object.create(client) as pg.PoolClient, { query, release: () => undefined });
  const database = Object.assign(Object.create(pool) as pg.Pool, { query, connect: async () => scoped });
  return { query, scoped, database, get depth() { return stack.length; }, get firstFailure() { return firstFailure; } };
}

test('0184 installs and exercises its denial paths on an empty private PostgreSQL fixture with physical rollback',
  { skip: !approved || process.env.NOISIA_EDITORIAL_RENEWAL_PG_APPROVE !== 'empty-dev-test-rollback-0184', timeout: 90000 }, async () => {
    const { pool, client } = await privateEmptyPool();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout='20s'");
      const before = (await client.query<{ owners: string; renewals: string | null; prior: string | null }>(`
        SELECT (SELECT count(*)::text FROM signal_topic_editorial_executions) owners,
          to_regclass('public.signal_topic_editorial_renewals')::text renewals,
          to_regprocedure('public.retry_signal_topic_editorial_execution_v1(uuid,uuid,uuid,text)')::text prior`)).rows[0];
      assert.equal(before?.owners, '0', 'private fixture must have no editorial owner');
      assert.equal(before?.renewals, null, '0184 already installed; never apply it twice');
      assert.ok(before?.prior, '0182 prerequisite missing');
      await installWithinRollback(client);
      const shape = (await client.query<{ rls: boolean; public_table: boolean; public_function: boolean }>(`
        SELECT (SELECT relrowsecurity FROM pg_class WHERE oid='public.signal_topic_editorial_renewals'::regclass) rls,
          has_table_privilege('public','public.signal_topic_editorial_renewals','SELECT') public_table,
          has_function_privilege('public','public.signal_topic_editorial_renewal_quote_v1(uuid,uuid,uuid,bigint)','EXECUTE') public_function`)).rows[0];
      assert.equal(shape?.rls, true);
      assert.equal(shape?.public_table, false);
      assert.equal(shape?.public_function, false);
      const quote = (await client.query<{ value: { status: string } }>(
        'SELECT signal_topic_editorial_renewal_quote_v1($1,$2,$3,NULL) value',[id,id,id])).rows[0];
      assert.equal(quote?.value.status, 'access_required');
      await assert.rejects(client.query(
        'SELECT renew_signal_topic_editorial_execution_v1($1,$2,$3,$4,$5,$6)',
        [id,id,id,'bad','bad',0]), /topic_editorial_renewal_invalid/u);
    } finally {
      try {
        await client.query('ROLLBACK');
        await assertEmptyPrivateSchema(client);
      } finally { client.release(); await pool.end(); }
    }
  });

test('0184 renews a synthetic paid owner after a real short deadline and preserves its settled screening receipt',
  { skip: !approved || process.env.NOISIA_EDITORIAL_RENEWAL_PG_APPROVE !== 'synthetic-rollback-0184', timeout: 180000 }, async () => {
    const { pool, client } = await privateEmptyPool();
    let outer = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED'); outer = true;
      await client.query("SET LOCAL search_path=public,extensions,pg_temp; SET LOCAL statement_timeout='60s'");
      assert.equal((await client.query('SELECT count(*)::int count FROM organizations')).rows[0]?.count, 0);
      assert.equal((await client.query("SELECT to_regclass('public.signal_topic_editorial_renewals') value")).rows[0]?.value, null);
      assert.ok((await client.query("SELECT to_regprocedure('public.retry_signal_topic_editorial_execution_v1(uuid,uuid,uuid,text)') value")).rows[0]?.value);
      await installWithinRollback(client);
      const tx = nestedClient(client, pool);
      let fixture: Awaited<ReturnType<typeof seedSignalTopicEditorialRenewalSourceV1>>;
      try { fixture = await seedSignalTopicEditorialRenewalSourceV1({ ...tx, cleanup: async () => undefined }); }
      catch (error) {
        throw new Error(`synthetic_source_${(error as Error).message}_${JSON.stringify(tx.firstFailure)}`);
      }
      console.log('renewal_fixture_ready');
      const { organization_id, actor_user_id, workspace_id } = fixture.identity;
      const untilMidnight = Number((await tx.query(`SELECT extract(epoch FROM (
        (((clock_timestamp() AT TIME ZONE 'America/Mexico_City')::date+1)::timestamp
         AT TIME ZONE 'America/Mexico_City') - clock_timestamp())) seconds`)).rows[0]?.seconds);
      assert.ok(untilMidnight > 180, 'run this same-day fixture away from the policy timezone midnight');
      const source = await loadSignalTopicConsolidationEditorialInputV1({ ...fixture.scope, database: tx.database });
      assert.equal(source.plan.batches.length, 1, 'the small real source has one screening batch');
      const policy = async (windowSeconds: number) => {
        const policyId = randomUUID();
        await tx.query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,valid_from,valid_until,
          budget_timezone,daily_cap_micro_usd,created_by_user_id)
          SELECT $1,$2,COALESCE(max(version),0)+1,clock_timestamp()-interval '1 second',
           clock_timestamp()+make_interval(secs=>$3::integer),budget_timezone,100000000,$4
          FROM signal_processing_policy_versions WHERE organization_id=$2 GROUP BY budget_timezone`,
        [policyId, organization_id, windowSeconds, actor_user_id]);
        await tx.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,
          configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
          SELECT $1,'topic_consolidation','provider','anthropic','claude-sonnet-4-6',configuration,
            signal_semantic_context_digest_json_v2(configuration),30000000,false
          FROM (SELECT signal_topic_editorial_configuration_v1() configuration) body`, [policyId]);
        await tx.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE organization_id=$1 AND status='active'", [organization_id]);
        await tx.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1", [policyId]);
        return policyId;
      };
      const initialPolicy = await policy(35);
      const plan = source.plan;
      const quoted = (await tx.query(`SELECT signal_topic_editorial_quote_v1($1,$2,$3,$4::jsonb,NULL) value`,
        [workspace_id, actor_user_id, fixture.scope.numeric_run_id, JSON.stringify(plan)])).rows[0]?.value;
      assert.equal(quoted?.status, 'ready_to_authorize');
      const owner = (await tx.query(`SELECT request_signal_topic_editorial_v1($1,$2,$3,$4::jsonb,$5,$6) value`,
        [workspace_id, actor_user_id, fixture.scope.numeric_run_id, JSON.stringify(plan), randomUUID(), quoted.quote_reference])).rows[0]?.value;
      const executionId = owner.execution_id as string;
      await tx.query('SET CONSTRAINTS ALL IMMEDIATE');
      const dispatched = (await tx.query('SELECT claim_signal_topic_editorial_dispatch_v1(1) value')).rows[0]?.value;
      assert.equal(dispatched?.length, 1);
      await tx.query('SELECT acknowledge_signal_topic_editorial_dispatch_v1($1,$2)',
        [dispatched[0].dispatch_id, dispatched[0].lease_token]);
      const lease = (await tx.query('SELECT claim_signal_topic_editorial_execution_v1($1,$2,300) value',
        [executionId, owner.worker_job_id])).rows[0]?.value;
      assert.equal(lease?.execution_id, executionId);
      const first = plan.batches[0]!;
      const reserved = (await tx.query('SELECT reserve_signal_topic_editorial_call_v1($1,$2,$3,true) value',
        [executionId, lease.execution_token, first.request_digest])).rows[0]?.value;
      await tx.query('SELECT mark_sent_signal_topic_editorial_call_v1($1,$2,$3,true)',
        [reserved.call_id, reserved.attempt_token, lease.execution_token]);
      const output = validateSignalTopicEditorialScreeningOutputV1(first, {
        contract_version: 'signal-topic-editorial-screening-output-v1', batch_index: 0,
        decisions: first.group_keys.map((group_key, index) => index === 0
          ? { group_key, disposition: 'topic', candidate: { candidate_key: 'b0000-synthetic-bicycle',
            label: 'Synthetic bicycle repair', definition: 'Invented repair conversations.', locale: plan.default_locale },
            confidence: 0.8, rationale: 'The invented citation supports this topic.',
            cited_ref_ids: [first.group_receipts[index]!.evidence_ref_ids[0]!] }
          : { group_key, disposition: 'noise', candidate: null,
            confidence: null, rationale: 'Synthetic evidence is insufficient.', cited_ref_ids: [] }),
      });
      const raw = JSON.stringify({ model: 'claude-sonnet-4-6', usage: { input_tokens: 100, output_tokens: 50,
        cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, content: [{ type: 'text', text: JSON.stringify(output) }] });
      await tx.query('SELECT persist_signal_topic_editorial_receipt_v1($1,$2,$3,$4,$5,$6,$7,$8)',
        [reserved.call_id, reserved.attempt_token, first.request_digest, raw,
          `synthetic/editorial/${reserved.call_id}`, 200, true, `synthetic:${reserved.call_id}`]);
      const settled = (await tx.query('SELECT settle_signal_topic_editorial_call_v1($1,$2) value',
        [reserved.call_id, reserved.attempt_token])).rows[0]?.value;
      assert.equal(settled?.status, 'settled');
      console.log('renewal_screening_receipt_settled');
      validateSignalTopicEditorialScreeningCoverageV1(plan, [output]);
      console.log('renewal_screening_coverage_valid');
      const state = { contract_version: 'signal-topic-editorial-runner-v1', execution_key: executionId,
        plan_digest: plan.plan_digest, phase: 'global', screening_outputs: [output], global: null };
      const stateText = JSON.stringify(state);
      await tx.query('UPDATE signal_topic_editorial_executions SET state_body=$2,state_digest=signal_semantic_context_digest_v1($2) WHERE id=$1',
        [executionId, stateText]);
      console.log('renewal_checkpoint_saved');
      const review = buildSignalTopicEditorialGlobalReviewV1({ plan, screening: validateSignalTopicEditorialScreeningCoverageV1(plan, [output]),
        groups: source.groups });
      console.log('renewal_global_review_built');
      await tx.query(`INSERT INTO signal_topic_editorial_requests(workspace_id,execution_id,phase,batch_index,request_digest,
        request_body,configuration,receipts,reserved_micro_usd)
        VALUES($1,$2,'global',0,$3,$4,$5::jsonb,$6::jsonb,$7)`, [workspace_id, executionId, review.request_digest,
        review.request_body, JSON.stringify(review.configuration), JSON.stringify(review.eligible_group_receipts),
        Buffer.byteLength(review.request_body, 'utf8') * 3 + review.configuration.max_output_tokens * 15]);
      console.log('renewal_global_request_saved');
      const retained = (await tx.query('SELECT to_jsonb(c) value FROM signal_topic_editorial_calls c WHERE id=$1', [reserved.call_id])).rows[0]?.value;
      const oldAdmission = (await tx.query('SELECT to_jsonb(a) value FROM signal_processing_admissions a WHERE target_id=$1', [executionId])).rows[0]?.value;

      // The policy really expires; no clock override or trigger bypass is used.
      await tx.query('SAVEPOINT ambiguous');
      const pending = (await tx.query('SELECT reserve_signal_topic_editorial_call_v1($1,$2,$3,true) value',
        [executionId, lease.execution_token, review.request_digest])).rows[0]?.value;
      console.log('renewal_pending_call_reserved');
      await tx.query('SELECT mark_sent_signal_topic_editorial_call_v1($1,$2,$3,true)',
        [pending.call_id, pending.attempt_token, lease.execution_token]);
      console.log('renewal_pending_call_sent');
      await tx.query('SELECT fail_signal_topic_editorial_execution_v1($1,$2,$3)',
        [executionId, lease.execution_token, 'topic_editorial_synthetic_timeout']);
      console.log('renewal_owner_failed_for_recovery');
      const remaining = Number((await tx.query(`SELECT extract(epoch FROM (
        (SELECT valid_until FROM signal_processing_policy_versions WHERE id=$1)-clock_timestamp())) seconds`,
      [initialPolicy])).rows[0]?.seconds);
      assert.ok(Number.isFinite(remaining) && remaining >= 0 && remaining <= 40,
        'the synthetic policy must really expire within forty seconds');
      await new Promise(resolve => setTimeout(resolve, Math.ceil((remaining + 0.3) * 1000)));
      console.log('renewal_policy_deadline_elapsed');
      await policy(120);
      const blocked = async () => (await tx.query('SELECT signal_topic_editorial_renewal_quote_v1($1,$2,$3,NULL) value',
        [workspace_id, actor_user_id, executionId])).rows[0]?.value;
      assert.equal((await blocked()).status, 'recovery_required', 'in-flight spend cannot receive a new grant');
      await tx.query('SELECT fail_signal_topic_editorial_call_v1($1,$2,false)', [pending.call_id, pending.attempt_token]);
      assert.equal((await blocked()).status, 'recovery_required', 'unknown outcome must be reconciled first');
      await tx.query('ROLLBACK TO SAVEPOINT ambiguous'); await tx.query('RELEASE SAVEPOINT ambiguous');

      await tx.query('SELECT fail_signal_topic_editorial_execution_v1($1,$2,$3)',
        [executionId, lease.execution_token, 'topic_editorial_synthetic_timeout']);
      await policy(120);
      await tx.query('SAVEPOINT drift');
      await fixture.saves.saveKnowledge({ database: tx.database, scoped: tx.scoped, ...fixture.identity,
        source_id: fixture.knowledge_source_id, title: 'Changed synthetic knowledge',
        raw_text: 'Invented bicycles are no longer repaired; old context is stale.', idempotency_key: randomUUID() });
      assert.equal((await blocked()).status, 'owner_unavailable', 'source drift cannot renew the paid owner');
      await tx.query('ROLLBACK TO SAVEPOINT drift'); await tx.query('RELEASE SAVEPOINT drift');
      const fresh = await blocked(); assert.equal(fresh.status, 'ready_to_authorize');
      assert.equal(fresh.grant_cap_micro_usd, '30000000', 'same-day grant includes prior confirmed spend; it does not reset the owner cap');
      assert.equal(fresh.remaining_micro_usd, String(30_000_000 - Number(settled.settled_micro_usd)));
      console.log('renewal_quote_ready');
      const key = randomUUID();
      const grant = (await tx.query('SELECT renew_signal_topic_editorial_execution_v1($1,$2,$3,$4,$5,$6) value',
        [workspace_id, actor_user_id, executionId, key, fresh.quote_reference, fresh.grant_cap_micro_usd])).rows[0]?.value;
      assert.equal(grant?.replayed, false);
      console.log('renewal_grant_recorded');
      const replay = (await tx.query('SELECT renew_signal_topic_editorial_execution_v1($1,$2,$3,$4,$5,$6) value',
        [workspace_id, actor_user_id, executionId, key, fresh.quote_reference, fresh.grant_cap_micro_usd])).rows[0]?.value;
      assert.equal(replay?.renewal_id, grant.renewal_id); assert.equal(replay?.replayed, true);
      assert.equal((await blocked()).status, 'renewal_already_used_today');
      const retry = (await tx.query('SELECT retry_signal_topic_editorial_execution_v1($1,$2,$3,$4) value',
        [workspace_id, actor_user_id, executionId, randomUUID()])).rows[0]?.value;
      assert.equal(retry?.execution_id, executionId);
      const resumed = (await tx.query('SELECT claim_signal_topic_editorial_execution_v1($1,$2,300) value',
        [executionId, retry.worker_job_id])).rows[0]?.value;
      console.log('renewal_same_owner_resumed');
      const third = (await tx.query('SELECT reserve_signal_topic_editorial_call_v1($1,$2,$3,true) value',
        [executionId, resumed.execution_token, review.request_digest])).rows[0]?.value;
      assert.equal(third?.status, 'reserved');
      await tx.query('SELECT mark_sent_signal_topic_editorial_call_v1($1,$2,$3,true)',
        [third.call_id, third.attempt_token, resumed.execution_token]);
      assert.deepEqual((await tx.query('SELECT to_jsonb(c) value FROM signal_topic_editorial_calls c WHERE id=$1',
        [reserved.call_id])).rows[0]?.value, retained, 'paid screening call is byte-for-byte unchanged');
      assert.deepEqual((await tx.query('SELECT to_jsonb(a) value FROM signal_processing_admissions a WHERE target_id=$1',
        [executionId])).rows[0]?.value, oldAdmission, 'original admission is byte-for-byte unchanged');
      assert.equal((await tx.query('SELECT count(*)::int count FROM signal_topic_editorial_executions WHERE numeric_run_id=$1',
        [fixture.scope.numeric_run_id])).rows[0]?.count, 1, 'same owner resumes');
      assert.equal((await tx.query('SELECT count(*)::int count FROM signal_topic_editorial_renewals WHERE execution_id=$1',
        [executionId])).rows[0]?.count, 1);
      assert.equal(tx.depth, 0, 'all nested service transactions are balanced');
    } finally {
      try {
        if (outer) await client.query('ROLLBACK');
        await assertEmptyPrivateSchema(client);
      } finally { client.release(); await pool.end(); }
    }
  });
