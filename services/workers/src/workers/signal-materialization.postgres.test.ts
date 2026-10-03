import assert from "node:assert/strict";
import test from "node:test";

import type { Job } from "bullmq";
import pg from "pg";

import {
  SIGNAL_METRIC_DEFINITIONS_V1,
  expandSignalVelocityInvalidationThroughV1,
  type SignalInvalidationJobDataV1,
  type SignalMaterializeJobDataV1
} from "@noisia/query-engine";

const DATABASE_URL = process.env.DATABASE_URL;
const APPROVED = process.env.NOISIA_SIGNAL_OPERATIONAL_MATERIALIZATION_INTEGRATION_APPROVED === "true";

test("governed operational materialization is population-scoped and idempotent in Postgres", {
  skip: !DATABASE_URL || !APPROVED
}, async () => {
  assert.ok(DATABASE_URL);
  const parsed = new URL(DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname));
  assert.match(parsed.pathname, /migration[_-]smoke/u);
  process.env.DATABASE_SSL = "false";
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
  await client.connect();
  const { signalMaterializationJob } = await import("./signal-materialization");
  const { signalInvalidationJob } = await import("./signal-refresh");
  const { pool } = await import("../db/client");
  const fixture = {
    organizationId: crypto.randomUUID(),
    brandId: crypto.randomUUID(),
    mentionId: crypto.randomUUID(),
    sourceKey: `postgres-worker-${crypto.randomUUID()}`
  };
  const insertedMetricDefinitionIds: string[] = [];
  try {
    for (const metric of SIGNAL_METRIC_DEFINITIONS_V1) {
      const metricDefinition = await client.query<{ id: string }>(`
        INSERT INTO metric_definitions (
          metric_key, name, description, grain, unit, definition, dimensions,
          owner_team, status, version, metric_group_key, formula_hash, visibility
        ) VALUES (
          $1, $2, $3, 'mention', $4, $5::jsonb, $6::jsonb,
          'signal', 'active', $7, $8, $9, $10
        ) ON CONFLICT (metric_key, version) DO NOTHING
        RETURNING id::text
      `, [
        metric.key,
        metric.name,
        metric.description,
        metric.unit,
        JSON.stringify({ formula: metric.formula, denominator: metric.denominator }),
        JSON.stringify(metric.dimensions),
        metric.version,
        metric.group,
        metric.formula_hash,
        metric.visibility
      ]);
      const insertedId = metricDefinition.rows[0]?.id;
      if (insertedId) insertedMetricDefinitionIds.push(insertedId);
    }
    await client.query(`
      INSERT INTO organizations (id, slug, legal_name, display_name, status)
      VALUES ($1::uuid, $2, 'Worker Postgres Fixture', 'Worker Postgres Fixture', 'active')
    `, [fixture.organizationId, `worker-org-${fixture.organizationId}`]);
    await client.query(`
      INSERT INTO brands (
        id, organization_id, slug, name, display_name, countries, status
      ) VALUES (
        $1::uuid, $2::uuid, $3, 'Worker Postgres Brand',
        'Worker Postgres Brand', ARRAY['MX']::char(2)[], 'active'
      )
    `, [fixture.brandId, fixture.organizationId, `worker-brand-${fixture.brandId}`]);
    const provisioned = (await client.query<{
      workspace_id: string;
      population_id: string;
      population_version: number;
      population_definition_hash: string;
    }>(`
      SELECT workspace.id::text AS workspace_id,
        definition.id::text AS population_id,
        definition.version AS population_version,
        definition.definition_hash AS population_definition_hash
      FROM signal_workspaces workspace
      JOIN signal_workspace_population_pointers pointer
        ON pointer.workspace_id = workspace.id AND pointer.purpose = 'operational'
      JOIN signal_population_definitions definition
        ON definition.id = pointer.population_id AND definition.status = 'active'
      WHERE workspace.brand_id = $1::uuid
    `, [fixture.brandId])).rows[0];
    assert.ok(provisioned);
    await client.query(`
      INSERT INTO mentions (
        id, workspace_id, study_corpus_id, external_id, source_system,
        text_hash, text_clean, text_length, published_at, platform,
        language, sentiment_score, quality_score, inclusion_status
      ) VALUES (
        $1::uuid, $2::uuid, NULL, $3, 'worker-postgres-fixture',
        $4, 'Autonomous worker materialization fixture', 42,
        '2026-04-03T12:00:00Z', 'x', 'es', 0.5, 100, 'included'
      )
    `, [
      fixture.mentionId,
      provisioned.workspace_id,
      `worker-external-${fixture.mentionId}`,
      `worker-hash-${fixture.mentionId}`
    ]);
    await client.query(`
      INSERT INTO signal_population_memberships (
        population_id, workspace_id, mention_id,
        membership_status, membership_reason
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'included', 'worker_postgres_fixture')
      ON CONFLICT (population_id, mention_id) DO UPDATE SET
        membership_status = 'included',
        membership_reason = 'worker_postgres_fixture',
        removed_at = NULL,
        effective_at = now()
    `, [provisioned.population_id, provisioned.workspace_id, fixture.mentionId]);
    await client.query(`
      INSERT INTO signal_data_watermarks (
        workspace_id, study_corpus_id, population_id, source_key,
        corpus_revision, max_observed_at, accepted_at, materialized_at,
        source_freshness_state, data_freshness_state, stale_after,
        metadata
      ) VALUES (
        $1::uuid, NULL, $2::uuid, $3, 0,
        '2026-04-03T12:00:00Z', now(), now(),
        'fresh', 'fresh', NULL, '{"fixture":"autonomous-worker"}'::jsonb
      )
    `, [provisioned.workspace_id, provisioned.population_id, fixture.sourceKey]);

    const scope = (await client.query<{
      workspace_id: string;
      population_id: string;
      population_version: number;
      population_definition_hash: string;
      date_from: string;
      date_through: string;
    }>(`
      SELECT workspace.id::text AS workspace_id,
        definition.id::text AS population_id,
        definition.version AS population_version,
        definition.definition_hash AS population_definition_hash,
        min((mention.published_at AT TIME ZONE workspace.timezone)::date)::text AS date_from,
        max((mention.published_at AT TIME ZONE workspace.timezone)::date)::text AS date_through
      FROM signal_workspaces workspace
      JOIN signal_workspace_population_pointers pointer
        ON pointer.workspace_id = workspace.id AND pointer.purpose = 'operational'
      JOIN signal_population_definitions definition
        ON definition.id = pointer.population_id AND definition.status = 'active'
      JOIN signal_population_memberships membership
        ON membership.population_id = definition.id
       AND membership.workspace_id = workspace.id
       AND membership.membership_status = 'included' AND membership.removed_at IS NULL
      JOIN mentions mention ON mention.id = membership.mention_id
      WHERE workspace.id = $1::uuid
      GROUP BY workspace.id, definition.id, definition.version, definition.definition_hash
    `, [provisioned.workspace_id])).rows[0];
    assert.ok(scope);
    const data: SignalMaterializeJobDataV1 = {
      contract_version: "signal-materialization-v1",
      trigger: "ad_hoc",
      workspace_id: scope.workspace_id,
      population_id: scope.population_id,
      population_version: scope.population_version,
      population_definition_hash: scope.population_definition_hash,
      metric_keys: ["conversation.volume"],
      filter: {
        contract_version: "signal-backend-v1",
        date_range: { start: scope.date_from, end: scope.date_through },
        timezone: "America/Mexico_City",
        granularity: "day",
        dimensions: {}
      }
    };
    const fakeJob = { data } as Job<SignalMaterializeJobDataV1>;
    const first = await signalMaterializationJob(fakeJob);
    const second = await signalMaterializationJob(fakeJob);
    assert.equal(first.state, "fresh");
    assert.equal(second.state, "fresh");
    assert.equal(first.rows_written, second.rows_written);
    assert.equal(first.watermark_hash, second.watermark_hash);

    const persisted = (await client.query<{
      rows: number;
      keys: number;
      governed_rows: number;
      legacy_rows: number;
      distinct_versions: number;
      sample_size: number;
    }>(`
      SELECT count(*)::int AS rows,
        count(DISTINCT materialization_key)::int AS keys,
        count(*) FILTER (WHERE population_id = $2::uuid
          AND population_version = $3::int
          AND population_definition_hash = $4)::int AS governed_rows,
        count(*) FILTER (WHERE study_corpus_id IS NOT NULL)::int AS legacy_rows,
        count(DISTINCT population_version)::int AS distinct_versions,
        COALESCE(sum(sample_size), 0)::int AS sample_size
      FROM metric_materializations
      WHERE workspace_id = $1::uuid
        AND population_id = $2::uuid
        AND metric_key = 'conversation.volume'
        AND filters_hash = (
          SELECT filters_hash FROM metric_materializations
          WHERE workspace_id = $1::uuid AND population_id = $2::uuid
            AND metric_key = 'conversation.volume'
          ORDER BY computed_at DESC LIMIT 1
        )
    `, [
      scope.workspace_id,
      scope.population_id,
      scope.population_version,
      scope.population_definition_hash
    ])).rows[0]!;
    assert.ok(persisted.rows > 0);
    assert.equal(persisted.rows, persisted.keys);
    assert.equal(persisted.rows, persisted.governed_rows);
    assert.equal(persisted.legacy_rows, 0);
    assert.equal(persisted.distinct_versions, 1);
    assert.ok(persisted.sample_size > 0);

    const invalidation = (await client.query<{ id: string }>(`
      INSERT INTO signal_data_invalidations (
        workspace_id, study_corpus_id, population_id, data_watermark_id,
        source_key, idempotency_key, reason, affected_from, affected_through,
        scope, status, attempt, processed_at
      )
      SELECT
        $1::uuid, NULL, $2::uuid, watermark.id,
        $7,
        'signal-operational-worker-refresh:' || $2::text,
        'workspace_data_accepted', $3::date, $4::date,
        jsonb_build_object(
          'kind', 'governed_population',
          'population_id', $2::uuid,
          'population_version', $5::int,
          'population_definition_hash', $6::text
        ),
        'pending', 0, NULL
      FROM signal_data_watermarks watermark
      WHERE watermark.workspace_id = $1::uuid
        AND watermark.population_id = $2::uuid
        AND watermark.study_corpus_id IS NULL
      ORDER BY watermark.accepted_at DESC, watermark.id DESC
      LIMIT 1
      ON CONFLICT (idempotency_key) DO UPDATE SET
        status = 'pending', attempt = 0, processed_at = NULL,
        error_summary = '{}'::jsonb
      RETURNING id::text
    `, [
      scope.workspace_id,
      scope.population_id,
      scope.date_from,
      scope.date_through,
      scope.population_version,
      scope.population_definition_hash,
      fixture.sourceKey
    ])).rows[0];
    assert.ok(invalidation);
    await client.query(`
      UPDATE metric_materializations
      SET materialization_state = 'fresh', stale_after = NULL
      WHERE workspace_id = $1::uuid AND population_id = $2::uuid
    `, [scope.workspace_id, scope.population_id]);
    const enqueued: SignalMaterializeJobDataV1[] = [];
    const invalidationResult = await signalInvalidationJob({
      data: {
        contract_version: "signal-refresh-v1",
        invalidation_id: invalidation.id
      },
      attemptsMade: 0,
      opts: { attempts: 3 }
    } as Job<SignalInvalidationJobDataV1>, {
      enqueueMaterialization: async (jobData) => {
        enqueued.push(jobData);
      }
    });
    assert.ok(Number(invalidationResult.materializations_invalidated ?? 0) > 0);
    assert.equal(enqueued.length, 1);
    assert.deepEqual(enqueued[0], {
      contract_version: "signal-materialization-v1",
      trigger: "invalidation",
      workspace_id: scope.workspace_id,
      population_id: scope.population_id,
      population_version: scope.population_version,
      population_definition_hash: scope.population_definition_hash,
      invalidation_id: invalidation.id,
      affected_from: scope.date_from,
      affected_through: expandSignalVelocityInvalidationThroughV1(scope.date_through)
    });
    const invalidationMaterialization = await signalMaterializationJob({
      data: enqueued[0]
    } as Job<SignalMaterializeJobDataV1>);
    const invalidationState = (await client.query<{
      status: string;
      plans: number;
      rows: number;
      population_id: string;
    }>(`
      SELECT status,
        COALESCE((scope->>'materialization_plans_executed')::int, 0) AS plans,
        COALESCE((scope->>'materialization_rows_written')::int, 0) AS rows,
        scope->>'population_id' AS population_id
      FROM signal_data_invalidations
      WHERE id = $1::uuid
    `, [invalidation.id])).rows[0]!;
    assert.equal(invalidationState.status, "completed");
    assert.equal(invalidationState.population_id, scope.population_id);
    assert.ok(invalidationState.plans > 0);
    assert.ok(invalidationState.rows > 0);

    const invalidScope = await signalMaterializationJob({
      data: { ...data, population_version: data.population_version + 1 }
    } as Job<SignalMaterializeJobDataV1>);
    assert.deepEqual(invalidScope, {
      state: "not_available",
      reason: "workspace_operational_scope_not_available"
    });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      operational_materialization: {
        first,
        second,
        persisted,
        refresh: {
          invalidation: invalidationResult,
          materialization: invalidationMaterialization,
          persisted: invalidationState
        },
        invalid_scope: invalidScope
      }
    }, null, 2)}\n`);
  } finally {
    await client.query(`DELETE FROM brands WHERE id = $1::uuid`, [fixture.brandId]).catch(() => undefined);
    await client.query(`DELETE FROM organizations WHERE id = $1::uuid`, [fixture.organizationId]).catch(() => undefined);
    if (insertedMetricDefinitionIds.length > 0) {
      await client.query(`DELETE FROM metric_definitions WHERE id = ANY($1::uuid[])`, [insertedMetricDefinitionIds])
        .catch(() => undefined);
    }
    await client.end();
    await pool.end();
  }
});
