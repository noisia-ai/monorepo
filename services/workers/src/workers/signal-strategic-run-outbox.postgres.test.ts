import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const APPROVED = process.env.NOISIA_SIGNAL_STRATEGIC_OUTBOX_INTEGRATION_APPROVED === "true";
const REDIS_URL = process.env.NOISIA_SIGNAL_STRATEGIC_OUTBOX_REDIS_URL;

type JobRecord = { id: string; name: string; data: { tbAnalysisId: string } };

class MockBullBroker {
  readonly jobs = new Map<string, JobRecord>();
  readonly acceptedAddsByJob = new Map<string, number>();
  acceptedAdds = 0;
  failuresRemaining = 0;
  throwAfterAccept = false;
}

class MockBullQueue {
  addCalls = 0;

  constructor(private readonly broker: MockBullBroker) {}

  async getJob(jobId: string) {
    return this.broker.jobs.get(jobId) ?? null;
  }

  async add(
    name: string,
    data: { tbAnalysisId: string },
    options: { jobId: string }
  ) {
    this.addCalls += 1;
    const existing = this.broker.jobs.get(options.jobId);
    if (existing) return existing;
    if (this.broker.failuresRemaining > 0) {
      this.broker.failuresRemaining -= 1;
      throw new Error("redis dispatch unavailable");
    }
    const job = { id: options.jobId, name, data };
    this.broker.jobs.set(options.jobId, job);
    this.broker.acceptedAdds += 1;
    this.broker.acceptedAddsByJob.set(
      options.jobId,
      (this.broker.acceptedAddsByJob.get(options.jobId) ?? 0) + 1
    );
    if (this.broker.throwAfterAccept) {
      this.broker.throwAfterAccept = false;
      throw new Error("connection lost after Redis accepted the job");
    }
    return job;
  }
}

test("strategic run outbox recovers dispatch durably and exactly once", {
  skip: !DATABASE_URL || !APPROVED,
  timeout: 30_000
}, async () => {
  assert.ok(DATABASE_URL);
  requireDisposableLocalDatabase(DATABASE_URL);
  process.env.DATABASE_SSL = "false";

  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
  await client.connect();
  const migration0063 = await readFile(
    new URL("../../../../infrastructure/db/migrations/0063_signal_strategic_run_outbox_recovery.sql", import.meta.url),
    "utf8"
  );
  await client.query(migration0063);
  await client.query(migration0063);
  const { pool } = await import("../db/client");
  const {
    buildSignalStrategicRunJobId,
    drainSignalStrategicRunOutbox,
    startSignalStrategicRunOutboxDrainer
  } = await import("./signal-strategic-run-outbox");
  const fixture = await createFixture(client);
  const observed: Record<string, unknown> = {};

  try {
    const restartRow = await insertOutboxRow(client, fixture, "restart", "pending");
    const restartBroker = new MockBullBroker();
    const stoppedBeforeDispatch = startSignalStrategicRunOutboxDrainer({
      database: pool,
      queue: new MockBullQueue(restartBroker),
      intervalMs: 60_000,
      runImmediately: false
    });
    await stoppedBeforeDispatch.close();

    const restarted = startSignalStrategicRunOutboxDrainer({
      database: pool,
      queue: new MockBullQueue(restartBroker),
      intervalMs: 60_000
    });
    const restartDrain = await restarted.drainNow();
    await restarted.close();
    const restartedAgain = startSignalStrategicRunOutboxDrainer({
      database: pool,
      queue: new MockBullQueue(restartBroker),
      intervalMs: 60_000
    });
    await restartedAgain.drainNow();
    await restartedAgain.close();
    assert.equal(await outboxStatus(client, restartRow.outboxId), "dispatched");
    const restartJobId = buildSignalStrategicRunJobId(restartRow.analysisId);
    assert.equal(restartBroker.acceptedAddsByJob.get(restartJobId), 1);
    assert.ok(restartBroker.jobs.has(restartJobId));
    observed.restart = {
      drain: restartDrain,
      effective_jobs_for_run: Number(restartBroker.jobs.has(restartJobId)),
      accepted_adds_for_run: restartBroker.acceptedAddsByJob.get(restartJobId)
    };

    const concurrentRow = await insertOutboxRow(client, fixture, "concurrent", "pending");
    const concurrentBroker = new MockBullBroker();
    const concurrentResults = await Promise.all([
      drainSignalStrategicRunOutbox({ database: pool, queue: new MockBullQueue(concurrentBroker) }),
      drainSignalStrategicRunOutbox({ database: pool, queue: new MockBullQueue(concurrentBroker) })
    ]);
    assert.equal(await outboxStatus(client, concurrentRow.outboxId), "dispatched");
    assert.equal(concurrentBroker.acceptedAdds, 1);
    assert.equal(concurrentBroker.jobs.size, 1);
    assert.equal(concurrentResults.reduce((sum, item) => sum + item.claimed, 0), 1);
    observed.concurrent = {
      total_claimed: concurrentResults.reduce((sum, item) => sum + item.claimed, 0),
      effective_jobs: concurrentBroker.jobs.size
    };

    const orphanRow = await insertOutboxRow(client, fixture, "orphan", "dispatching", 1);
    const orphanBroker = new MockBullBroker();
    const orphanResult = await drainSignalStrategicRunOutbox({
      database: pool,
      queue: new MockBullQueue(orphanBroker),
      leaseSeconds: 15
    });
    const orphanState = await outboxState(client, orphanRow.outboxId);
    assert.equal(orphanState.status, "dispatched");
    assert.equal(orphanState.attempt, 2);
    assert.equal(orphanBroker.acceptedAdds, 1);
    observed.orphaned_lease = { ...orphanState, drain: orphanResult };

    const acceptedRow = await insertOutboxRow(client, fixture, "accepted-before-ack", "pending");
    const acceptedBroker = new MockBullBroker();
    acceptedBroker.throwAfterAccept = true;
    const acceptedQueue = new MockBullQueue(acceptedBroker);
    const acceptedResult = await drainSignalStrategicRunOutbox({
      database: pool,
      queue: acceptedQueue
    });
    assert.equal(await outboxStatus(client, acceptedRow.outboxId), "dispatched");
    assert.equal(acceptedResult.reconciled, 1);
    assert.equal(acceptedBroker.acceptedAdds, 1);
    assert.equal(acceptedBroker.jobs.size, 1);
    observed.accepted_before_postgres_ack = {
      drain: acceptedResult,
      add_calls: acceptedQueue.addCalls,
      effective_jobs: acceptedBroker.jobs.size
    };

    const existingRow = await insertOutboxRow(client, fixture, "existing-job", "dispatching", 3);
    const existingBroker = new MockBullBroker();
    const existingJobId = buildSignalStrategicRunJobId(existingRow.analysisId);
    existingBroker.jobs.set(existingJobId, {
      id: existingJobId,
      name: "tb_run_analysis",
      data: { tbAnalysisId: existingRow.analysisId }
    });
    const existingQueue = new MockBullQueue(existingBroker);
    const existingResult = await drainSignalStrategicRunOutbox({
      database: pool,
      queue: existingQueue,
      maxAttempts: 3
    });
    assert.equal(await outboxStatus(client, existingRow.outboxId), "dispatched");
    assert.equal(existingResult.reconciled, 1);
    assert.equal(existingQueue.addCalls, 0);
    assert.equal(existingBroker.jobs.size, 1);
    const existingState = await outboxState(client, existingRow.outboxId);
    assert.equal(existingState.attempt, 3);
    observed.existing_bullmq_job = {
      drain: existingResult,
      attempt: existingState.attempt,
      add_calls: existingQueue.addCalls,
      effective_jobs: existingBroker.jobs.size
    };

    const failedRow = await insertOutboxRow(client, fixture, "dead-letter", "pending");
    const failedBroker = new MockBullBroker();
    failedBroker.failuresRemaining = 10;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await drainSignalStrategicRunOutbox({
        database: pool,
        queue: new MockBullQueue(failedBroker),
        maxAttempts: 3
      });
      if (attempt < 3) {
        await client.query(`
          UPDATE signal_strategic_run_outbox
          SET available_at = now()
          WHERE id = $1::uuid AND status = 'failed'
        `, [failedRow.outboxId]);
      }
    }
    const deadLetter = await outboxState(client, failedRow.outboxId);
    assert.equal(deadLetter.status, "dead_letter");
    assert.equal(deadLetter.attempt, 3);
    assert.equal(failedBroker.jobs.size, 0);
    observed.dead_letter = deadLetter;

    const periodicBroker = new MockBullBroker();
    const periodic = startSignalStrategicRunOutboxDrainer({
      database: pool,
      queue: new MockBullQueue(periodicBroker),
      intervalMs: 20
    });
    await periodic.drainNow();
    const periodicRow = await insertOutboxRow(client, fixture, "periodic", "pending");
    await waitFor(async () => (await outboxStatus(client, periodicRow.outboxId)) === "dispatched");
    await periodic.close();
    assert.equal(periodicBroker.jobs.size, 1);
    observed.periodic = {
      status: await outboxStatus(client, periodicRow.outboxId),
      effective_jobs: periodicBroker.jobs.size
    };

    const rows = await client.query<{
      status: string;
      count: number;
    }>(`
      SELECT status, count(*)::integer AS count
      FROM signal_strategic_run_outbox
      WHERE workspace_id = $1::uuid
      GROUP BY status ORDER BY status
    `, [fixture.workspaceId]);
    observed.final_statuses = rows.rows;
    console.log(JSON.stringify({ ok: true, strategic_outbox: observed }, null, 2));
  } finally {
    await cleanupFixture(client, fixture).catch(() => undefined);
    await client.end();
    await pool.end();
  }
});

test("strategic run outbox reconciles an accepted real BullMQ job after PostgreSQL ACK loss", {
  skip: !DATABASE_URL || !APPROVED || !REDIS_URL,
  timeout: 30_000
}, async () => {
  assert.ok(DATABASE_URL);
  assert.ok(REDIS_URL);
  requireDisposableLocalDatabase(DATABASE_URL);
  requireDisposableLocalRedis(REDIS_URL);

  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
  const database = new pg.Pool({ connectionString: DATABASE_URL, ssl: false });
  await client.connect();
  const migration0063 = await readFile(
    new URL("../../../../infrastructure/db/migrations/0063_signal_strategic_run_outbox_recovery.sql", import.meta.url),
    "utf8"
  );
  await client.query(migration0063);
  const fixture = await createFixture(client);
  const { Queue } = await import("bullmq");
  const { default: Redis } = await import("ioredis");
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue(`signal-strategic-outbox-${fixture.organizationId}`, {
    connection: redis
  });

  try {
    const { buildSignalStrategicRunJobId, drainSignalStrategicRunOutbox } = await import(
      "./signal-strategic-run-outbox"
    );
    const row = await insertOutboxRow(client, fixture, "real-bullmq", "pending", 2);
    const first = await drainSignalStrategicRunOutbox({
      database,
      queue,
      maxAttempts: 3
    });
    const jobId = buildSignalStrategicRunJobId(row.analysisId);
    assert.equal(first.dispatched, 1);
    assert.ok(await queue.getJob(jobId));
    assert.deepEqual(await outboxState(client, row.outboxId), {
      status: "dispatched",
      attempt: 3,
      bullmq_job_id: jobId,
      lease_token: null
    });

    // Model the only state PostgreSQL can retain when Redis accepted Queue.add but
    // the process died before the ACK update committed.
    await client.query(`
      UPDATE signal_strategic_run_outbox
      SET status = 'dispatching',
          dispatched_at = NULL,
          locked_at = now() - interval '2 minutes',
          lease_expires_at = now() - interval '1 minute',
          lease_token = gen_random_uuid(),
          updated_at = now() - interval '1 minute'
      WHERE id = $1::uuid
    `, [row.outboxId]);

    const recovered = await drainSignalStrategicRunOutbox({
      database,
      queue,
      maxAttempts: 3
    });
    const effectiveJobs = (await queue.getJobs([
      "active", "completed", "delayed", "failed", "paused", "prioritized", "waiting", "waiting-children"
    ], 0, -1)).filter((job) => job.id === jobId);
    const recoveredState = await outboxState(client, row.outboxId);
    assert.equal(recovered.reconciled, 1);
    assert.equal(recovered.dispatched, 0);
    assert.equal(recoveredState.status, "dispatched");
    assert.equal(recoveredState.attempt, 3);
    assert.equal(effectiveJobs.length, 1);
    console.log(JSON.stringify({
      ok: true,
      real_bullmq_reconciliation: {
        first_dispatch: first,
        recovered_dispatch: recovered,
        attempt: recoveredState.attempt,
        effective_jobs: effectiveJobs.length
      }
    }, null, 2));
  } finally {
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await cleanupFixture(client, fixture).catch(() => undefined);
    await client.end();
    await database.end();
  }
});

async function createFixture(client: pg.Client) {
  const organizationId = randomUUID();
  const brandId = randomUUID();
  const methodologyId = randomUUID();
  const studyCorpusId = randomUUID();
  const slugSuffix = organizationId.slice(0, 8);
  await client.query(`
    INSERT INTO organizations (id, slug, legal_name, display_name, status)
    VALUES ($1::uuid, $2, 'Strategic Outbox Fixture', 'Strategic Outbox Fixture', 'active')
  `, [organizationId, `strategic-outbox-org-${slugSuffix}`]);
  await client.query(`
    INSERT INTO brands (
      id, organization_id, slug, name, display_name, countries, status
    ) VALUES (
      $1::uuid, $2::uuid, $3, 'Strategic Outbox Brand',
      'Strategic Outbox Brand', ARRAY['MX']::char(2)[], 'active'
    )
  `, [brandId, organizationId, `strategic-outbox-brand-${slugSuffix}`]);
  const workspace = await client.query<{ id: string }>(`
    SELECT id::text FROM signal_workspaces WHERE brand_id = $1::uuid
  `, [brandId]);
  const workspaceId = workspace.rows[0]?.id;
  assert.ok(workspaceId);
  await client.query(`
    INSERT INTO methodologies (
      id, slug, name, version, status, manifest_yaml
    ) VALUES (
      $1::uuid, $2, 'Strategic Outbox Transport', '1.0.0', 'active', '{}'::jsonb
    )
  `, [methodologyId, `strategic-outbox-${slugSuffix}`]);
  await client.query(`
    INSERT INTO study_corpora (
      id, name, brand_id, methodology_id, methodology_version_at_creation,
      status, corpus_revision
    ) VALUES (
      $1::uuid, 'Strategic outbox execution corpus', $2::uuid, $3::uuid,
      '1.0.0', 'corpus_approved', 1
    )
  `, [studyCorpusId, brandId, methodologyId]);
  return { organizationId, brandId, methodologyId, studyCorpusId, workspaceId };
}

async function insertOutboxRow(
  client: pg.Client,
  fixture: Awaited<ReturnType<typeof createFixture>>,
  label: string,
  status: "pending" | "dispatching",
  attempt = 0
) {
  const snapshotId = randomUUID();
  const analysisId = randomUUID();
  const outboxId = randomUUID();
  await client.query(`
    INSERT INTO corpus_snapshots (
      id, study_corpus_id, label, kind, mention_count
    ) VALUES ($1::uuid, $2::uuid, $3, 'manual', 0)
  `, [snapshotId, fixture.studyCorpusId, `Outbox ${label}`]);
  await client.query(`
    INSERT INTO tb_analyses (
      id, study_corpus_id, snapshot_id, pipeline_version,
      methodology_version, status, current_step
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, 'outbox-fixture-v1',
      '1.0.0', 'running', 'preflight'
    )
  `, [analysisId, fixture.studyCorpusId, snapshotId]);
  await client.query(`
    INSERT INTO signal_strategic_run_outbox (
      id, workspace_id, report_key, tb_analysis_id, snapshot_id,
      idempotency_key, status, attempt, available_at,
      locked_at, lease_expires_at, lease_token
    ) VALUES (
      $1::uuid, $2::uuid, 'triggers-barriers', $3::uuid, $4::uuid,
      $5, $6, $7::integer, now(),
      CASE WHEN $6 = 'dispatching' THEN now() - interval '10 minutes' ELSE NULL END,
      CASE WHEN $6 = 'dispatching' THEN now() - interval '5 minutes' ELSE NULL END,
      CASE WHEN $6 = 'dispatching' THEN gen_random_uuid() ELSE NULL END
    )
  `, [outboxId, fixture.workspaceId, analysisId, snapshotId, sha256(`outbox-${label}-${outboxId}`), status, attempt]);
  return { outboxId, analysisId, snapshotId };
}

async function outboxStatus(client: pg.Client, outboxId: string) {
  return (await outboxState(client, outboxId)).status;
}

async function outboxState(client: pg.Client, outboxId: string) {
  const result = await client.query<{
    status: string;
    attempt: number;
    bullmq_job_id: string | null;
    lease_token: string | null;
  }>(`
    SELECT status, attempt, bullmq_job_id, lease_token::text
    FROM signal_strategic_run_outbox WHERE id = $1::uuid
  `, [outboxId]);
  const row = result.rows[0];
  assert.ok(row);
  return row;
}

async function cleanupFixture(
  client: pg.Client,
  fixture: Awaited<ReturnType<typeof createFixture>>
) {
  await client.query(`DELETE FROM signal_strategic_run_outbox WHERE workspace_id = $1::uuid`, [fixture.workspaceId]);
  await client.query(`DELETE FROM tb_analyses WHERE study_corpus_id = $1::uuid`, [fixture.studyCorpusId]);
  await client.query(`DELETE FROM corpus_snapshots WHERE study_corpus_id = $1::uuid`, [fixture.studyCorpusId]);
  await client.query(`DELETE FROM signal_workspace_corpora WHERE workspace_id = $1::uuid`, [fixture.workspaceId]);
  await client.query(`DELETE FROM study_corpora WHERE id = $1::uuid`, [fixture.studyCorpusId]);
  await client.query(`DELETE FROM signal_workspaces WHERE id = $1::uuid`, [fixture.workspaceId]);
  await client.query(`DELETE FROM brands WHERE id = $1::uuid`, [fixture.brandId]);
  await client.query(`DELETE FROM methodologies WHERE id = $1::uuid`, [fixture.methodologyId]);
  await client.query(`DELETE FROM organizations WHERE id = $1::uuid`, [fixture.organizationId]);
}

async function waitFor(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("Timed out waiting for periodic strategic outbox drain.");
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function requireDisposableLocalDatabase(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname));
  assert.match(parsed.pathname, /migration[_-]smoke/u);
}

function requireDisposableLocalRedis(redisUrl: string) {
  const parsed = new URL(redisUrl);
  assert.equal(parsed.protocol, "redis:");
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname));
}
