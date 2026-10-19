import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import pg from "pg";
import { SIGNAL_METRIC_DEFINITIONS_V1 } from "@noisia/query-engine";

const DATABASE_URL = process.env.NOISIA_SIGNAL_DATA_PLANE_INTEGRATION_URL;
const APPROVED = process.env.NOISIA_SIGNAL_DATA_PLANE_INTEGRATION_APPROVED === "true";
const execFile = promisify(execFileCallback);

const IDS = {
  orgA: "10000000-0000-4000-8000-000000000001",
  orgB: "10000000-0000-4000-8000-000000000002",
  userA: "10000000-0000-4000-8000-000000000101",
  userB: "10000000-0000-4000-8000-000000000102",
  brandA: "10000000-0000-4000-8000-000000000201",
  brandB: "10000000-0000-4000-8000-000000000202",
  brandDirect: "10000000-0000-4000-8000-000000000203",
  methodTb: "10000000-0000-4000-8000-000000000301",
  methodPulse: "10000000-0000-4000-8000-000000000302",
  corpusPrimary: "10000000-0000-4000-8000-000000000401",
  corpusSecondary: "10000000-0000-4000-8000-000000000402",
  corpusOtherOrg: "10000000-0000-4000-8000-000000000403",
  directStudy: "10000000-0000-4000-8000-000000000404",
  sourceLegacyPrimary: "10000000-0000-4000-8000-000000000501",
  sourceLegacySecondary: "10000000-0000-4000-8000-000000000502",
  batchPrimary: "10000000-0000-4000-8000-000000000601",
  batchCompetitor: "10000000-0000-4000-8000-000000000602",
  batchCategory: "10000000-0000-4000-8000-000000000603",
  batchReference: "10000000-0000-4000-8000-000000000604",
  batchUnattributed: "10000000-0000-4000-8000-000000000605",
  batchPending: "10000000-0000-4000-8000-000000000606",
  mentionPrimary: "10000000-0000-4000-8000-000000000701",
  mentionPrimaryAlias: "10000000-0000-4000-8000-000000000702",
  mentionExcluded: "10000000-0000-4000-8000-000000000703",
  mentionCompetitor: "10000000-0000-4000-8000-000000000704",
  mentionCategory: "10000000-0000-4000-8000-000000000705",
  mentionReference: "10000000-0000-4000-8000-000000000706",
  mentionUnattributed: "10000000-0000-4000-8000-000000000707",
  mentionPending: "10000000-0000-4000-8000-000000000708",
  mentionPrimaryTwo: "10000000-0000-4000-8000-000000000709"
} as const;

test("Signal workspace data plane 0059-0063 preserves, governs and freezes real Postgres data", {
  skip: !DATABASE_URL || !APPROVED
}, async (t) => {
  assert.ok(DATABASE_URL);
  requireDisposableLocalDatabase(DATABASE_URL);
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
  await client.connect();
  const observed: Record<string, unknown> = {};
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await applyMigrations(client, (file) => file < "0059_signal_workspace_owned_data_plane.sql");
    await seedPre0059Fixtures(client);
    await seedLegacyModuleServingFixture(client, {
      kinds: ["topic"],
      subjectId: IDS.mentionPrimaryAlias,
      studyCorpusId: IDS.corpusSecondary,
      source: "historical-alias-fixture"
    });

    const before = await scalarRow(client, `
      SELECT
        (SELECT count(*)::int FROM brands) AS brands,
        (SELECT count(*)::int FROM signal_workspaces) AS workspaces,
        (SELECT count(*)::int FROM mentions) AS mention_rows,
        (SELECT count(*)::int FROM mentions WHERE inclusion_status = 'included') AS included_rows,
        (SELECT count(DISTINCT text_hash)::int FROM mentions WHERE inclusion_status = 'included') AS distinct_included_text
    `);
    observed.pre_0059 = before;
    assert.deepEqual(before, {
      brands: 2,
      workspaces: 2,
      mention_rows: 114,
      included_rows: 112,
      distinct_included_text: 111
    });

    await applyMigrations(client, (file) =>
      file >= "0059_signal_workspace_owned_data_plane.sql"
      && file <= "0063_signal_strategic_run_outbox_recovery.sql"
    );
    await seedOperationalServingRuntimeFixture(client);
    await seedLegacyModuleServingFixture(client, {
      kinds: ["narrative"],
      subjectId: IDS.mentionPrimary,
      studyCorpusId: IDS.corpusPrimary,
      source: "module-shadow-fixture"
    });

    await t.test("backfill separates rows, canonical mentions and provenance", async () => {
      const counts = await scalarRow(client, `
        SELECT
          count(*)::int AS legacy_rows,
          count(*) FILTER (WHERE canonical_mention_id = id)::int AS canonical_records,
          count(DISTINCT canonical_mention_id)::int AS canonical_identities,
          (SELECT count(*)::int FROM signal_mention_import_memberships) AS import_memberships,
          (SELECT count(*)::int FROM signal_mention_attributions) AS attributions,
          (SELECT count(*)::int FROM signal_population_memberships
            WHERE membership_status = 'included' AND removed_at IS NULL) AS operational_memberships
        FROM mentions
      `);
      observed.backfill = counts;
      assert.deepEqual(counts, {
        legacy_rows: 114,
        canonical_records: 113,
        canonical_identities: 113,
        import_memberships: 114,
        attributions: 114,
        operational_memberships: 107
      });
      const scopes = await client.query<{ scope: string }>(`
        SELECT scope FROM signal_mention_attributions
        WHERE mention_id = $1::uuid ORDER BY scope
      `, [IDS.mentionPrimary]);
      assert.deepEqual(scopes.rows.map((row) => row.scope), ["competitor", "primary_brand"]);
    });

    await t.test("brand insertion provisions one workspace without a study", async () => {
      await client.query(`
        INSERT INTO brands (
          id, organization_id, slug, name, display_name, countries, status
        ) VALUES ($1, $2, 'direct-brand', 'Direct Brand', 'Direct Brand', ARRAY['MX']::char(2)[], 'active')
      `, [IDS.brandDirect, IDS.orgA]);
      const provisioned = await scalarRow(client, `
        SELECT
          count(*)::int AS workspaces,
          count(*) FILTER (WHERE report.report_key = 'triggers-barriers')::int AS reports,
          count(*) FILTER (WHERE definition.population_key = 'primary-brand-operational')::int AS populations,
          (SELECT count(*)::int FROM study_corpora WHERE brand_id = $1::uuid) AS studies
        FROM signal_workspaces workspace
        LEFT JOIN signal_workspace_reports report ON report.workspace_id = workspace.id
        LEFT JOIN signal_population_definitions definition ON definition.workspace_id = workspace.id
        WHERE workspace.brand_id = $1::uuid
      `, [IDS.brandDirect]);
      observed.brand_workspace = provisioned;
      assert.deepEqual(provisioned, { workspaces: 1, reports: 1, populations: 1, studies: 0 });
    });

    const direct = await seedDirectWorkspaceIngestion(client);

    await t.test("direct imports are idempotent and preserve multi-source scope", async () => {
      const identity = await scalarRow(client, `
        SELECT
          count(*)::int AS canonical_rows,
          (SELECT count(*)::int FROM signal_mention_import_memberships
            WHERE mention_id = $1::uuid) AS import_memberships,
          (SELECT count(*)::int FROM signal_mention_attributions
            WHERE mention_id = $1::uuid) AS attributions,
          (SELECT count(DISTINCT scope)::int FROM signal_mention_attributions
            WHERE mention_id = $1::uuid) AS scopes
        FROM mentions
        WHERE workspace_id = $2::uuid
          AND text_hash = $3
          AND canonical_mention_id = id
      `, [direct.primaryMentionId, direct.workspaceId, direct.sharedHash]);
      observed.direct_dedup = identity;
      assert.deepEqual(identity, {
        canonical_rows: 1,
        import_memberships: 2,
        attributions: 2,
        scopes: 2
      });
    });

    await t.test("only approved included primary-brand records enter the operational population", async () => {
      const population = await populationState(client, direct.workspaceId);
      observed.operational_population = population;
      assert.deepEqual(population, {
        included: 1,
        excluded: 7,
        primary_approved_included: 1,
        competitor_included: 1,
        category_included: 1,
        reference_included: 1,
        unattributed_included: 1,
        attribution_pending: 1,
        attribution_rejected: 1,
        mention_pending: 1,
        mention_excluded: 1
      });
    });

    await t.test("attribution review and scope changes reconcile membership", async () => {
      await client.query(`
        UPDATE signal_mention_attributions
        SET review_status = 'rejected', approval_source = NULL,
            approved_by_user_id = NULL, approved_at = NULL, updated_at = now()
        WHERE mention_id = $1::uuid AND scope = 'primary_brand'
      `, [direct.primaryMentionId]);
      assert.equal(await activePopulationCount(client, direct.workspaceId), 0);
      await client.query(`
        UPDATE signal_mention_attributions
        SET review_status = 'approved', approval_source = 'human',
            approved_by_user_id = $2::uuid, approved_at = now(), updated_at = now()
        WHERE mention_id = $1::uuid AND data_source_id = $3::uuid
      `, [direct.primaryMentionId, IDS.userA, direct.primarySourceId]);
      assert.equal(await activePopulationCount(client, direct.workspaceId), 1);
      await client.query(`
        UPDATE signal_mention_attributions
        SET scope = 'reference', entity_type = 'reference', entity_id = NULL,
            updated_at = now()
        WHERE mention_id = $1::uuid AND data_source_id = $2::uuid
      `, [direct.primaryMentionId, direct.primarySourceId]);
      assert.equal(await activePopulationCount(client, direct.workspaceId), 0);
      await client.query(`
        UPDATE signal_mention_attributions
        SET scope = 'primary_brand', entity_type = 'brand', entity_id = $2::uuid,
            updated_at = now()
        WHERE mention_id = $1::uuid AND data_source_id = $3::uuid
      `, [direct.primaryMentionId, IDS.brandDirect, direct.primarySourceId]);
      assert.equal(await activePopulationCount(client, direct.workspaceId), 1);
    });

    await t.test("governed source scope cannot be cleared and source rejection removes membership", async () => {
      await expectSqlState(client, "23514", `
        UPDATE data_sources
        SET governed_scope = NULL,
            governed_entity_type = NULL,
            governed_entity_id = NULL,
            scope_review_status = 'pending',
            scope_approved_by_user_id = NULL,
            scope_approval_source = NULL,
            scope_approved_at = NULL
        WHERE id = $1::uuid
      `, [direct.primarySourceId]);
      const afterBlockedClear = await scalarRow(client, `
        SELECT
          governed_scope,
          scope_review_status,
          (SELECT count(*)::int FROM signal_mention_attributions
            WHERE data_source_id = $1::uuid AND review_status = 'approved')
            AS approved_attributions,
          (SELECT count(*)::int FROM signal_population_memberships
            WHERE workspace_id = $2::uuid
              AND membership_status = 'included' AND removed_at IS NULL)
            AS active_memberships
        FROM data_sources WHERE id = $1::uuid
      `, [direct.primarySourceId, direct.workspaceId]);
      assert.equal(afterBlockedClear.governed_scope, "primary_brand");
      assert.equal(afterBlockedClear.scope_review_status, "approved");
      assert.ok(Number(afterBlockedClear.approved_attributions) > 0);
      assert.equal(afterBlockedClear.active_memberships, 1);

      await client.query(`
        UPDATE data_sources
        SET scope_review_status = 'rejected',
            scope_approved_by_user_id = NULL,
            scope_approval_source = NULL,
            scope_approved_at = NULL
        WHERE id = $1::uuid
      `, [direct.primarySourceId]);
      const rejected = await scalarRow(client, `
        SELECT
          count(*) FILTER (WHERE review_status = 'approved')::int AS approved_attributions,
          count(*) FILTER (WHERE review_status = 'rejected')::int AS rejected_attributions,
          (SELECT count(*)::int FROM signal_population_memberships
            WHERE workspace_id = $2::uuid
              AND membership_status = 'included' AND removed_at IS NULL)
            AS active_memberships
        FROM signal_mention_attributions
        WHERE data_source_id = $1::uuid
      `, [direct.primarySourceId, direct.workspaceId]);
      assert.equal(rejected.approved_attributions, 0);
      assert.ok(Number(rejected.rejected_attributions) > 0);
      assert.equal(rejected.active_memberships, 0);

      await client.query(`
        UPDATE data_sources
        SET scope_review_status = 'approved',
            scope_approved_by_user_id = $2::uuid,
            scope_approval_source = 'fixture_governance',
            scope_approved_at = now()
        WHERE id = $1::uuid
      `, [direct.primarySourceId, IDS.userA]);
      assert.equal(await activePopulationCount(client, direct.workspaceId), 1);
      observed.source_scope_lifecycle = {
        clear_sqlstate: "23514",
        rejected_attributions: rejected.rejected_attributions,
        active_after_reject: rejected.active_memberships,
        active_after_reapprove: 1
      };
    });

    await t.test("population acceptance creates idempotent governed invalidation and enforces materialization scope", async () => {
      const acceptedAt = "2026-02-02T00:00:00.000Z";
      const first = await scalarRow(client, `
        SELECT watermark_id::text, population_id::text, invalidation_id::text, changed
        FROM record_signal_workspace_data_acceptance_v2(
          $1::uuid, 'fixture:primary', $2::uuid, $3::uuid, $4::timestamptz, $4::timestamptz
        )
      `, [direct.workspaceId, direct.primarySourceId, direct.primaryBatchId, acceptedAt]);
      const second = await scalarRow(client, `
        SELECT watermark_id::text, population_id::text, invalidation_id::text, changed
        FROM record_signal_workspace_data_acceptance_v2(
          $1::uuid, 'fixture:primary', $2::uuid, $3::uuid, $4::timestamptz, $4::timestamptz
        )
      `, [direct.workspaceId, direct.primarySourceId, direct.primaryBatchId, acceptedAt]);
      assert.equal(first.changed, true);
      assert.equal(second.changed, false);
      assert.equal(second.watermark_id, first.watermark_id);
      assert.equal(second.invalidation_id, first.invalidation_id);

      const population = await scalarRow(client, `
        SELECT definition.id::text, definition.version, definition.definition_hash
        FROM signal_workspace_population_pointers pointer
        JOIN signal_population_definitions definition ON definition.id = pointer.population_id
        WHERE pointer.workspace_id = $1::uuid AND pointer.purpose = 'operational'
      `, [direct.workspaceId]);
      const metricDefinitionId = await scalar<string>(client,
        "SELECT id::text FROM metric_definitions ORDER BY id LIMIT 1");
      const materializationId = await scalar<string>(client, `
        INSERT INTO metric_materializations (
          metric_definition_id, study_corpus_id, filters_hash, payload,
          workspace_id, population_id, population_version, population_definition_hash,
          materialization_key, metric_key, metric_version, metric_group_key,
          granularity, period_start, period_end, normalized_filter, typed_payload,
          value, denominator, sample_size, quality_state, data_watermark_id,
          data_watermark, data_watermark_hash, materialization_state, cache_scope
        ) VALUES (
          $1::uuid, NULL, 'sha256:${"1".repeat(64)}', '{}'::jsonb,
          $2::uuid, $3::uuid, $4::int, $5::text,
          'sha256:${"2".repeat(64)}', 'conversation.volume', 1, 'conversation',
          'day', '2026-02-01', '2026-02-01', '{}'::jsonb,
          jsonb_build_object('kind', 'scalar', 'mention_count', 1),
          1, NULL, 1, 'pass', $6::uuid,
          jsonb_build_object('contract_version', 'signal-backend-v1',
            'workspace_id', $2::text, 'read_scope', 'governed_population',
            'corpus_id', NULL, 'corpus_revision', NULL,
            'population_id', $3::text, 'population_version', $4::int,
            'population_definition_hash', $5::text, 'source_sync_run_ids', '[]'::jsonb,
            'data_through_at', NULL, 'accepted_at', $7::text,
            'materialized_at', $7::text),
          'sha256:${"3".repeat(64)}', 'fresh', 'default'
        ) RETURNING id::text
      `, [
        metricDefinitionId,
        direct.workspaceId,
        population.id,
        population.version,
        population.definition_hash,
        first.watermark_id,
        acceptedAt
      ]);
      await expectSqlState(client, "23514", `
        UPDATE metric_materializations SET study_corpus_id = $2::uuid
        WHERE id = $1::uuid
      `, [materializationId, IDS.corpusPrimary]);
      const otherWorkspaceId = await scalar<string>(client, `
        SELECT id::text FROM signal_workspaces WHERE brand_id = $1::uuid
      `, [IDS.brandB]);
      await expectSqlState(client, "23514", `
        UPDATE metric_materializations SET workspace_id = $2::uuid
        WHERE id = $1::uuid
      `, [materializationId, otherWorkspaceId]);
      const invalidation = await scalarRow(client, `
        SELECT study_corpus_id::text, population_id::text, reason,
          scope->>'kind' AS kind, affected_from::text, affected_through::text
        FROM signal_data_invalidations WHERE id = $1::uuid
      `, [first.invalidation_id]);
      assert.deepEqual(invalidation, {
        study_corpus_id: null,
        population_id: population.id,
        reason: "workspace_data_accepted",
        kind: "governed_population",
        affected_from: "2026-01-31",
        affected_through: "2026-01-31"
      });
      observed.population_materialization_scope = {
        first_changed: first.changed,
        second_changed: second.changed,
        materialization_id: materializationId,
        invalidation
      };
    });

    await t.test("membership eligibility transitions invalidate population materializations", async () => {
      const startedAt = await scalar<string>(client, "SELECT clock_timestamp()::text");
      await client.query(`
        UPDATE signal_mention_attributions
        SET review_status = 'rejected', approval_source = NULL,
            approved_by_user_id = NULL, approved_at = NULL, updated_at = now()
        WHERE mention_id = $1::uuid AND data_source_id = $2::uuid
          AND scope = 'primary_brand'
      `, [direct.primaryMentionId, direct.primarySourceId]);
      const excluded = await scalarRow(client, `
        SELECT
          (SELECT count(*)::int FROM signal_population_memberships
            WHERE workspace_id = $1::uuid AND mention_id = $2::uuid
              AND membership_status = 'included' AND removed_at IS NULL)
            AS active_memberships,
          (SELECT count(*)::int FROM metric_materializations
            WHERE workspace_id = $1::uuid AND population_id = pointer.population_id
              AND (materialization_state = 'stale' OR stale_after <= now()))
            AS stale_materializations,
          (SELECT count(*)::int FROM signal_data_invalidations invalidation
            WHERE invalidation.workspace_id = $1::uuid
              AND invalidation.population_id = pointer.population_id
              AND invalidation.reason = 'operational_population_membership_changed'
              AND invalidation.scope->>'mention_id' = $2::text
              AND (invalidation.scope->>'eligible_before')::boolean = true
              AND (invalidation.scope->>'eligible_after')::boolean = false
              AND invalidation.created_at >= $3::timestamptz)
            AS transition_invalidations
        FROM signal_workspace_population_pointers pointer
        WHERE pointer.workspace_id = $1::uuid AND pointer.purpose = 'operational'
      `, [direct.workspaceId, direct.primaryMentionId, startedAt]);
      assert.equal(excluded.active_memberships, 0);
      assert.ok(Number(excluded.stale_materializations) > 0);
      assert.equal(excluded.transition_invalidations, 1);

      await client.query(`
        UPDATE signal_mention_attributions
        SET review_status = 'approved', approval_source = 'human',
            approved_by_user_id = $3::uuid, approved_at = now(), updated_at = now()
        WHERE mention_id = $1::uuid AND data_source_id = $2::uuid
          AND scope = 'primary_brand'
      `, [direct.primaryMentionId, direct.primarySourceId, IDS.userA]);
      const included = await scalarRow(client, `
        SELECT
          (SELECT count(*)::int FROM signal_population_memberships
            WHERE workspace_id = $1::uuid AND mention_id = $2::uuid
              AND membership_status = 'included' AND removed_at IS NULL)
            AS active_memberships,
          (SELECT count(*)::int FROM signal_data_invalidations invalidation
            WHERE invalidation.workspace_id = $1::uuid
              AND invalidation.population_id = pointer.population_id
              AND invalidation.reason = 'operational_population_membership_changed'
              AND invalidation.scope->>'mention_id' = $2::text
              AND (invalidation.scope->>'eligible_before')::boolean = false
              AND (invalidation.scope->>'eligible_after')::boolean = true
              AND invalidation.created_at >= $3::timestamptz)
            AS transition_invalidations
        FROM signal_workspace_population_pointers pointer
        WHERE pointer.workspace_id = $1::uuid AND pointer.purpose = 'operational'
      `, [direct.workspaceId, direct.primaryMentionId, startedAt]);
      assert.deepEqual(included, {
        active_memberships: 1,
        transition_invalidations: 1
      });

      const deletedMentionId = crypto.randomUUID();
      await insertDirectMention(client, {
        id: deletedMentionId,
        workspaceId: direct.workspaceId,
        sourceId: direct.primarySourceId,
        batchId: direct.primaryBatchId,
        hash: crypto.randomUUID().replaceAll("-", ""),
        externalId: `membership-delete-${deletedMentionId}`,
        inclusion: "included"
      });
      assert.equal(await scalar<number>(client, `
        SELECT count(*)::int FROM signal_population_memberships
        WHERE workspace_id = $1::uuid AND mention_id = $2::uuid
          AND membership_status = 'included' AND removed_at IS NULL
      `, [direct.workspaceId, deletedMentionId]), 1);
      const deletedAt = await scalar<string>(client, "SELECT clock_timestamp()::text");
      await client.query(`
        DELETE FROM signal_population_memberships
        WHERE workspace_id = $1::uuid AND mention_id = $2::uuid
      `, [direct.workspaceId, deletedMentionId]);
      const deleted = await scalarRow(client, `
        SELECT
          (SELECT count(*)::int FROM signal_population_memberships
            WHERE workspace_id = $1::uuid AND mention_id = $2::uuid)
            AS memberships,
          (SELECT count(*)::int FROM signal_data_invalidations invalidation
            WHERE invalidation.workspace_id = $1::uuid
              AND invalidation.population_id = pointer.population_id
              AND invalidation.reason = 'operational_population_membership_changed'
              AND invalidation.scope->>'mention_id' = $2::text
              AND (invalidation.scope->>'deleted_count')::int = 1
              AND (invalidation.scope->>'eligible_before')::boolean = true
              AND (invalidation.scope->>'eligible_after')::boolean = false
              AND invalidation.created_at >= $3::timestamptz)
            AS transition_invalidations
        FROM signal_workspace_population_pointers pointer
        WHERE pointer.workspace_id = $1::uuid AND pointer.purpose = 'operational'
      `, [direct.workspaceId, deletedMentionId, deletedAt]);
      assert.deepEqual(deleted, {
        memberships: 0,
        transition_invalidations: 1
      });
      await client.query(`DELETE FROM mentions WHERE id = $1::uuid`, [deletedMentionId]);
      observed.membership_invalidation = { excluded, included, deleted };
    });

    await t.test("population promotion retires the old definition and deactivates old memberships", async () => {
      const oldPopulationId = await scalar<string>(client, `
        SELECT population_id::text
        FROM signal_workspace_population_pointers
        WHERE workspace_id = $1::uuid AND purpose = 'operational'
      `, [direct.workspaceId]);
      await expectSqlState(client, "23514", `
        UPDATE signal_population_definitions
        SET status = 'retired'
        WHERE id = $1::uuid
      `, [oldPopulationId]);
      const nextPopulationId = await scalar<string>(client, `
        INSERT INTO signal_population_definitions (
          workspace_id, population_key, version, purpose, status,
          acceptance_status, allowed_scopes, definition_hash
        ) VALUES (
          $1::uuid, 'primary-brand-operational', 2, 'operational', 'draft',
          'included', ARRAY['primary_brand']::text[],
          'sha256:${"b".repeat(64)}'
        ) RETURNING id::text
      `, [direct.workspaceId]);
      await client.query(`
        SELECT promote_signal_workspace_population(
          $1::uuid, 'operational', $2::uuid, $3::uuid
        )
      `, [direct.workspaceId, nextPopulationId, IDS.userA]);
      const lifecycle = await scalarRow(client, `
        SELECT
          pointer.population_id::text AS current_population_id,
          current_definition.version AS current_version,
          current_definition.status AS current_status,
          old_definition.status AS old_status,
          (SELECT count(*)::int FROM signal_population_memberships
            WHERE population_id = $2::uuid
              AND membership_status = 'included' AND removed_at IS NULL)
            AS old_active_memberships,
          (SELECT count(*)::int FROM signal_population_memberships
            WHERE population_id = $3::uuid
              AND membership_status = 'included' AND removed_at IS NULL)
            AS new_active_memberships
          ,(SELECT materialization_state FROM metric_materializations
            WHERE workspace_id = $1::uuid AND population_id = $2::uuid
            ORDER BY computed_at DESC LIMIT 1) AS old_materialization_state
          ,(SELECT count(*)::int FROM signal_data_invalidations
            WHERE workspace_id = $1::uuid AND population_id = $3::uuid
              AND reason = 'operational_population_promoted') AS promotion_invalidations
        FROM signal_workspace_population_pointers pointer
        JOIN signal_population_definitions current_definition
          ON current_definition.id = pointer.population_id
        JOIN signal_population_definitions old_definition
          ON old_definition.id = $2::uuid
        WHERE pointer.workspace_id = $1::uuid AND pointer.purpose = 'operational'
      `, [direct.workspaceId, oldPopulationId, nextPopulationId]);
      assert.deepEqual(lifecycle, {
        current_population_id: nextPopulationId,
        current_version: 2,
        current_status: "active",
        old_status: "retired",
        old_active_memberships: 0,
        new_active_memberships: 1,
        old_materialization_state: "stale",
        promotion_invalidations: 1
      });
      await expectSqlState(client, "23514", `
        UPDATE signal_population_definitions
        SET status = 'retired'
        WHERE id = $1::uuid
      `, [nextPopulationId]);
      observed.population_lifecycle = lifecycle;
    });

    await t.test("cross-organization ownership and authorization scopes fail closed", async () => {
      const otherWorkspace = await scalar<string>(client, `
        SELECT id::text FROM signal_workspaces WHERE brand_id = $1::uuid
      `, [IDS.brandB]);
      await expectSqlState(client, "23514", `
        INSERT INTO data_sources (
          workspace_id, organization_id, brand_id, source_type, provider,
          connection_method, name, governed_scope, governed_entity_type,
          governed_entity_id, scope_policy_version, scope_review_status,
          scope_approval_source, scope_approved_at, status
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, 'social-listening', 'fixture',
          'csv', 'Cross-org', 'primary_brand', 'brand', $3::uuid,
          'fixture-v1', 'approved', 'fixture', now(), 'active'
        )
      `, [direct.workspaceId, IDS.orgB, IDS.brandDirect]);
      await expectSqlState(client, "23514", `
        INSERT INTO import_batches (
          workspace_id, data_source_id, source_system, status
        ) VALUES ($1::uuid, $2::uuid, 'fixture', 'completed')
      `, [otherWorkspace, direct.primarySourceId]);
      const authCount = await scalar<number>(client, `
        SELECT count(*)::int
        FROM signal_workspaces workspace
        WHERE workspace.id = $1::uuid
          AND workspace.organization_id = $2::uuid
          AND EXISTS (
            SELECT 1 FROM user_brand_access access
            WHERE access.user_id = $3::uuid
              AND access.brand_id = workspace.brand_id
              AND access.revoked_at IS NULL
          )
      `, [direct.workspaceId, IDS.orgB, IDS.userB]);
      assert.equal(authCount, 0);
      observed.cross_org = { constraint_sqlstate: "23514", unauthorized_workspace_rows: authCount };
    });

    await t.test("governed study snapshot and approved release remain immutable after ingestion", async () => {
      const invariant = await exerciseSnapshotReleaseAndEnrichment(client, direct);
      observed.snapshot_release = invariant;
      assert.equal(invariant.snapshot_before, 1);
      assert.equal(invariant.snapshot_after_ingest, 1);
      assert.equal(invariant.release_one_rows_after_ingest, 1);
      assert.equal(invariant.report_registry_rows, 1);
      assert.equal(invariant.release_revisions, "1,2");
      assert.equal(invariant.current_revision, 2);
      assert.equal(invariant.reusable_enrichment_rows, 1);
      await client.query(`
        UPDATE signal_workspace_corpora
        SET valid_to = now()
        WHERE workspace_id = $1::uuid
          AND study_corpus_id = $2::uuid
          AND valid_to IS NULL
      `, [direct.workspaceId, IDS.directStudy]);
      await expectSqlState(client, "23514", `
        SELECT *
        FROM create_signal_workspace_population_snapshot(
          $1::uuid,
          (SELECT population_id FROM signal_workspace_population_pointers
            WHERE workspace_id = $1::uuid AND purpose = 'operational'),
          $2::uuid,
          'Inactive membership',
          'manual',
          $3::uuid,
          '{}'::jsonb
        )
      `, [direct.workspaceId, IDS.directStudy, IDS.userA]);
    });

    await t.test("workspace-native T&B freezes, reviews and promotes two immutable revisions", async () => {
      assert.ok(DATABASE_URL);
      const strategic = await exerciseStrategicConsumptionV1(client, DATABASE_URL);
      observed.strategic_consumption = strategic;
      assert.deepEqual({
        run_one: strategic.run_one,
        run_two: strategic.run_two,
        release_history: strategic.release_history,
        reusable_enrichment: strategic.reusable_enrichment,
        containment: strategic.containment,
        idempotency: strategic.idempotency,
        authorization: strategic.authorization
      }, {
        run_one: {
          population_version: 1,
          snapshot_mentions: 107,
          later_mention_membership: 0,
          committed_outbox: {
            status: "pending",
            attempt: 0,
            bullmq_job_id: null
          }
        },
        run_two: {
          population_version: 2,
          snapshot_mentions: 108,
          later_mention_membership: 1
        },
        release_history: {
          revisions: "1,2",
          current_revision: 2,
          release_one_unchanged: true,
          snapshot_one_unchanged: true,
          report_registry_rows: 1
        },
        reusable_enrichment: {
          approved_root_rows: 1,
          approved_alias_rows: 0,
          source_alias_events: 1,
          canonical_lineage_edges: 1
        },
        containment: {
          checked: true,
          contract_violation_count: 0,
          outside_coding_sqlstate: "23514",
          outside_citation_sqlstate: "23514",
          outside_evidence_sqlstate: "23514"
        },
        idempotency: {
          population_ids: 1,
          run_ids: 1,
          snapshot_ids: 1,
          review_event_rows: 1,
          release_ids: 1
        },
        authorization: {
          cross_workspace_population_sqlstate: "23514",
          cross_workspace_run_sqlstate: "23514",
          incompatible_concurrent_run_sqlstate: "23505"
        }
      });
    });

    await t.test("legacy row duplicates reconcile by canonical identity", async () => {
      const shadow = await scalarRow(client, `
        WITH legacy AS (
          SELECT DISTINCT mention.canonical_mention_id AS mention_id
          FROM mentions mention
          JOIN import_batches batch ON batch.id = mention.source_file_id
          WHERE mention.study_corpus_id = $1::uuid
            AND mention.inclusion_status = 'included'
            AND (batch.mention_type = 'brand' OR batch.entity_kind = 'primary_brand')
        ), governed AS (
          SELECT membership.mention_id
          FROM signal_population_memberships membership
          JOIN signal_workspace_population_pointers pointer
            ON pointer.population_id = membership.population_id
           AND pointer.workspace_id = membership.workspace_id
           AND pointer.purpose = 'operational'
          WHERE membership.workspace_id = (
            SELECT workspace_id FROM signal_workspace_corpora
            WHERE study_corpus_id = $1::uuid AND valid_to IS NULL LIMIT 1
          )
            AND membership.membership_status = 'included'
            AND membership.removed_at IS NULL
        )
        SELECT
          (SELECT count(*)::int FROM mentions
            JOIN import_batches batch ON batch.id = mentions.source_file_id
            WHERE mentions.study_corpus_id = $1::uuid
              AND mentions.inclusion_status = 'included'
              AND (batch.mention_type = 'brand' OR batch.entity_kind = 'primary_brand')) AS legacy_rows,
          (SELECT count(*)::int FROM legacy) AS legacy_canonical,
          (SELECT count(*)::int FROM governed) AS governed_canonical,
          (SELECT count(*)::int FROM legacy
            WHERE NOT EXISTS (SELECT 1 FROM governed WHERE governed.mention_id = legacy.mention_id)) AS missing,
          (SELECT count(*)::int FROM governed
            WHERE NOT EXISTS (SELECT 1 FROM legacy WHERE legacy.mention_id = governed.mention_id)) AS additional
      `, [IDS.corpusPrimary]);
      observed.shadow_identity = shadow;
      assert.deepEqual(shadow, {
        legacy_rows: 107,
        legacy_canonical: 107,
        governed_canonical: 107,
        missing: 0,
        additional: 0
      });
    });

    await t.test("real module readers accept only explained legacy scope differences and resolve alias enrichment", async () => {
      const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
      const { stdout } = await execFile(
        join(repoRoot, "infrastructure/db/node_modules/.bin/tsx"),
        [join(repoRoot, "apps/studio/scripts/signal-workspace-module-shadow-smoke.ts")],
        {
          cwd: join(repoRoot, "apps/studio"),
          env: {
            ...process.env,
            DATABASE_URL,
            DATABASE_SSL: "false",
            NOISIA_SIGNAL_MODULE_SHADOW_SMOKE_APPROVED: "true"
          },
          maxBuffer: 2 * 1024 * 1024
        }
      );
      const moduleShadow = JSON.parse(stdout) as {
        population_shadow: { state: string; reconciled: boolean };
        module_serving_shadow: {
          state: string;
          reconciled: boolean;
          gate_passed: boolean;
          parity_with_legacy: boolean;
          governed_correct: boolean;
          zero_unexplained_differences: boolean;
          legacy_differences: {
            unexplained_count: number;
            legacy_only_by_scope: Record<string, number>;
          };
          brand_monitoring: { legacy: { row_denominator: number }; governed: { row_denominator: number } };
          mentions: {
            legacy: { total_count: number; cursor_valid: boolean };
            governed: { total_count: number; cursor_valid: boolean };
          };
          topics_narratives: {
            legacy: { row_denominator: number; resolved_alias_assignment_count: number };
            governed: { row_denominator: number; resolved_alias_assignment_count: number };
          };
        };
        alias_enrichment_evidence: {
          records: number;
          canonical_mention_id: string | null;
          alias_deep_link_canonical_mention_id: string | null;
        };
        operational_reader_shadow: {
          read_mode: string;
          visible_source: string;
          visible_payload_matches_explicit_legacy: boolean;
          route_latency: {
            route_shadow_overhead_ms: number;
            outbox_write_ms: number[];
            deferred_shadow_ms: number;
            pending_before_response_completion: number;
            shadow_results_before_drain: number;
          };
        };
        topics_narratives_membership_etag: {
          before: { denominator: number; terms: number; etag: string };
          read_through: {
            denominator: number;
            terms: number;
            status_with_previous_etag: number;
            etag: string;
          };
          rematerialized: {
            denominator: number;
            terms: number;
            status_with_previous_etag: number;
            etag: string;
          };
          restored: { denominator: number; terms: number; etag: string };
        };
      };
      assert.deepEqual(moduleShadow.population_shadow, {
        comparison_kind: "population_membership",
        canonical_delta: 0,
        missing_from_governed: 0,
        additional_in_governed: 0,
        reconciled: true,
        state: "exact",
        dimensions: ["scope", "quality", "period", "dedup"]
      });
      assert.equal(
        moduleShadow.module_serving_shadow.state,
        "correct_with_explained_legacy_differences"
      );
      assert.equal(moduleShadow.module_serving_shadow.reconciled, true);
      assert.equal(moduleShadow.module_serving_shadow.gate_passed, true);
      assert.equal(moduleShadow.module_serving_shadow.parity_with_legacy, false);
      assert.equal(moduleShadow.module_serving_shadow.governed_correct, true);
      assert.equal(moduleShadow.module_serving_shadow.zero_unexplained_differences, true);
      assert.equal(moduleShadow.module_serving_shadow.legacy_differences.unexplained_count, 0);
      assert.deepEqual(
        moduleShadow.module_serving_shadow.legacy_differences.legacy_only_by_scope,
        { category: 1, reference: 1, unattributed: 1 }
      );
      assert.deepEqual({
        brand_monitoring: [
          moduleShadow.module_serving_shadow.brand_monitoring.legacy.row_denominator,
          moduleShadow.module_serving_shadow.brand_monitoring.governed.row_denominator
        ],
        mentions: [
          moduleShadow.module_serving_shadow.mentions.legacy.total_count,
          moduleShadow.module_serving_shadow.mentions.governed.total_count
        ],
        topics_narratives: [
          moduleShadow.module_serving_shadow.topics_narratives.legacy.row_denominator,
          moduleShadow.module_serving_shadow.topics_narratives.governed.row_denominator
        ]
      }, {
        brand_monitoring: [110, 107],
        mentions: [110, 107],
        topics_narratives: [110, 107]
      });
      assert.equal(moduleShadow.module_serving_shadow.mentions.legacy.cursor_valid, true);
      assert.equal(moduleShadow.module_serving_shadow.mentions.governed.cursor_valid, true);
      assert.equal(
        moduleShadow.module_serving_shadow.topics_narratives.governed
          .resolved_alias_assignment_count,
        1
      );
      assert.deepEqual(moduleShadow.alias_enrichment_evidence, {
        records: 1,
        canonical_mention_id: IDS.mentionPrimary,
        alias_deep_link_canonical_mention_id: IDS.mentionPrimary
      });
      assert.deepEqual({
        read_mode: moduleShadow.operational_reader_shadow.read_mode,
        visible_source: moduleShadow.operational_reader_shadow.visible_source,
        visible_payload_matches_explicit_legacy:
          moduleShadow.operational_reader_shadow.visible_payload_matches_explicit_legacy
      }, {
        read_mode: "shadow",
        visible_source: "legacy_corpus",
        visible_payload_matches_explicit_legacy: true
      });
      assert.equal(
        moduleShadow.operational_reader_shadow.route_latency.pending_before_response_completion,
        3
      );
      assert.equal(
        moduleShadow.operational_reader_shadow.route_latency.shadow_results_before_drain,
        0
      );
      assert.ok(
        moduleShadow.operational_reader_shadow.route_latency.deferred_shadow_ms
          > Math.max(
            ...moduleShadow.operational_reader_shadow.route_latency.outbox_write_ms
          )
      );
      assert.ok(
        moduleShadow.operational_reader_shadow.route_latency.deferred_shadow_ms
          > moduleShadow.operational_reader_shadow.route_latency.route_shadow_overhead_ms
      );
      assert.deepEqual({
        before: [
          moduleShadow.topics_narratives_membership_etag.before.denominator,
          moduleShadow.topics_narratives_membership_etag.before.terms
        ],
        read_through: [
          moduleShadow.topics_narratives_membership_etag.read_through.denominator,
          moduleShadow.topics_narratives_membership_etag.read_through.terms,
          moduleShadow.topics_narratives_membership_etag.read_through.status_with_previous_etag
        ],
        rematerialized: [
          moduleShadow.topics_narratives_membership_etag.rematerialized.denominator,
          moduleShadow.topics_narratives_membership_etag.rematerialized.terms,
          moduleShadow.topics_narratives_membership_etag.rematerialized.status_with_previous_etag
        ],
        restored: [
          moduleShadow.topics_narratives_membership_etag.restored.denominator,
          moduleShadow.topics_narratives_membership_etag.restored.terms
        ]
      }, {
        before: [107, 2],
        read_through: [106, 0, 200],
        rematerialized: [106, 0, 200],
        restored: [107, 2]
      });
      assert.notEqual(
        moduleShadow.topics_narratives_membership_etag.before.etag,
        moduleShadow.topics_narratives_membership_etag.read_through.etag
      );
      assert.equal(
        moduleShadow.topics_narratives_membership_etag.read_through.etag,
        moduleShadow.topics_narratives_membership_etag.rematerialized.etag
      );
      assert.equal(
        moduleShadow.topics_narratives_membership_etag.before.etag,
        moduleShadow.topics_narratives_membership_etag.restored.etag
      );
      observed.module_serving_shadow = moduleShadow.module_serving_shadow;
      observed.topics_narratives_membership_etag =
        moduleShadow.topics_narratives_membership_etag;
    });

    process.stdout.write(`${JSON.stringify({ ok: true, observed }, null, 2)}\n`);
  } finally {
    await client.end();
  }
});

function requireDisposableLocalDatabase(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname));
  assert.match(parsed.pathname, /migration[_-]smoke/u);
}

async function applyMigrations(client: pg.Client, include: (file: string) => boolean) {
  const migrationsDir = dirname(fileURLToPath(import.meta.url));
  const files = (await readdir(migrationsDir))
    .filter((file) => /^\d{4}_.+\.sql$/u.test(file) && include(file))
    .sort();
  for (const file of files) {
    await client.query(await readFile(join(migrationsDir, file), "utf8"));
  }
}

async function seedPre0059Fixtures(client: pg.Client) {
  await client.query(`
    INSERT INTO organizations (id, slug, legal_name, display_name, status) VALUES
      ('${IDS.orgA}', 'org-a', 'Org A', 'Org A', 'active'),
      ('${IDS.orgB}', 'org-b', 'Org B', 'Org B', 'active');
    INSERT INTO users (id, email, full_name, user_type, primary_role, organization_id, status) VALUES
      ('${IDS.userA}', 'a@example.test', 'User A', 'client', 'brand_manager', '${IDS.orgA}', 'active'),
      ('${IDS.userB}', 'b@example.test', 'User B', 'client', 'brand_manager', '${IDS.orgB}', 'active');
    INSERT INTO brands (id, organization_id, slug, name, display_name, countries, status) VALUES
      ('${IDS.brandA}', '${IDS.orgA}', 'brand-a', 'Brand A', 'Brand A', ARRAY['MX']::char(2)[], 'active'),
      ('${IDS.brandB}', '${IDS.orgB}', 'brand-b', 'Brand B', 'Brand B', ARRAY['MX']::char(2)[], 'active');
    INSERT INTO user_brand_access (user_id, brand_id, access_level) VALUES
      ('${IDS.userA}', '${IDS.brandA}', 'manage'),
      ('${IDS.userB}', '${IDS.brandB}', 'manage');
    INSERT INTO methodologies (id, slug, name, version, status, manifest_yaml) VALUES
      ('${IDS.methodTb}', 'triggers-barriers', 'Triggers & Barriers', '1.0.0', 'active', '{}'::jsonb),
      ('${IDS.methodPulse}', 'signal-pulse', 'Signal Pulse', '1.0.0', 'active', '{}'::jsonb);
    INSERT INTO study_corpora (
      id, name, brand_id, methodology_id, methodology_version_at_creation,
      business_question, decision_to_inform, status
    ) VALUES
      ('${IDS.corpusPrimary}', 'Brand A operational', '${IDS.brandA}', '${IDS.methodTb}', '1.0.0', 'Question A', 'Decision A', 'corpus_approved'),
      ('${IDS.corpusSecondary}', 'Brand A secondary', '${IDS.brandA}', '${IDS.methodPulse}', '1.0.0', 'Question B', 'Decision B', 'corpus_approved'),
      ('${IDS.corpusOtherOrg}', 'Brand B operational', '${IDS.brandB}', '${IDS.methodTb}', '1.0.0', 'Question C', 'Decision C', 'corpus_approved');
    INSERT INTO data_sources (
      id, study_corpus_id, organization_id, brand_id, source_type, provider,
      connection_method, name, role, status
    ) VALUES
      ('${IDS.sourceLegacyPrimary}', '${IDS.corpusPrimary}', '${IDS.orgA}', '${IDS.brandA}', 'social-listening', 'fixture', 'csv', 'Legacy Primary', '{"scope":"primary_brand"}', 'active'),
      ('${IDS.sourceLegacySecondary}', '${IDS.corpusSecondary}', '${IDS.orgA}', '${IDS.brandA}', 'social-listening', 'fixture', 'csv', 'Legacy Secondary', '{"scope":"competitor"}', 'active');
    INSERT INTO import_batches (
      id, study_corpus_id, mention_type, entity_kind, entity_label,
      source_system, imported_by_user_id, status
    ) VALUES
      ('${IDS.batchPrimary}', '${IDS.corpusPrimary}', 'brand', 'primary_brand', 'Brand A', 'fixture', '${IDS.userA}', 'completed'),
      ('${IDS.batchCompetitor}', '${IDS.corpusSecondary}', 'competitor', 'competitor_pool', 'Competitor', 'fixture', '${IDS.userA}', 'completed'),
      ('${IDS.batchCategory}', '${IDS.corpusPrimary}', 'industry', 'category', 'Category', 'fixture', '${IDS.userA}', 'completed'),
      ('${IDS.batchReference}', '${IDS.corpusPrimary}', NULL, 'reference', 'Reference', 'fixture', '${IDS.userA}', 'completed'),
      ('${IDS.batchUnattributed}', '${IDS.corpusPrimary}', NULL, 'unknown', 'Unknown', 'fixture', '${IDS.userA}', 'completed'),
      ('${IDS.batchPending}', '${IDS.corpusPrimary}', 'brand', 'primary_brand', 'Brand A', 'fixture', '${IDS.userA}', 'completed');
  `);
  await client.query(`
    UPDATE signal_workspace_corpora membership
    SET role = 'legacy'
    FROM signal_workspaces workspace
    WHERE workspace.id = membership.workspace_id
      AND workspace.brand_id = $1::uuid
  `, [IDS.brandA]);
  await client.query(`
    UPDATE signal_workspace_corpora
    SET role = 'operational'
    WHERE study_corpus_id = $1::uuid
  `, [IDS.corpusPrimary]);
  const mentions = [
    [IDS.mentionPrimary, IDS.corpusPrimary, IDS.batchPrimary, "primary-1", "a".repeat(64), "included", "2026-01-01T00:00:00Z"],
    [IDS.mentionPrimaryAlias, IDS.corpusSecondary, IDS.batchCompetitor, "competitor-duplicate", "a".repeat(64), "included", "2026-01-02T00:00:00Z"],
    [IDS.mentionExcluded, IDS.corpusPrimary, IDS.batchPrimary, "excluded-1", "b".repeat(64), "excluded", "2026-01-03T00:00:00Z"],
    [IDS.mentionCompetitor, IDS.corpusSecondary, IDS.batchCompetitor, "competitor-1", "c".repeat(64), "included", "2026-01-04T00:00:00Z"],
    [IDS.mentionCategory, IDS.corpusPrimary, IDS.batchCategory, "category-1", "d".repeat(64), "included", "2026-01-05T00:00:00Z"],
    [IDS.mentionReference, IDS.corpusPrimary, IDS.batchReference, "reference-1", "e".repeat(64), "included", "2026-01-06T00:00:00Z"],
    [IDS.mentionUnattributed, IDS.corpusPrimary, IDS.batchUnattributed, "unattributed-1", "f".repeat(64), "included", "2026-01-07T00:00:00Z"],
    [IDS.mentionPending, IDS.corpusPrimary, IDS.batchPending, "pending-1", "1".repeat(64), "pending", "2026-01-08T00:00:00Z"],
    [IDS.mentionPrimaryTwo, IDS.corpusPrimary, IDS.batchPrimary, "primary-2", "0".repeat(64), "included", "2026-01-09T00:00:00Z"]
  ];
  for (const row of mentions) {
    await client.query(`
      INSERT INTO mentions (
        id, study_corpus_id, external_id, source_system, source_file_id,
        text_hash, text_clean, text_snippet, text_length, language,
        published_at, platform, resolved_platform, quality_score, inclusion_status,
        created_at
      ) VALUES (
        $1::uuid, $2::uuid, $4, 'fixture', $3::uuid,
        $5, 'Fixture mention with enough text for governed analysis',
        'Fixture mention', 56, 'es', $7::timestamptz, 'x', 'x', 8, $6, $7::timestamptz
      )
    `, row);
  }
  for (let index = 0; index < 105; index += 1) {
    await client.query(`
      INSERT INTO mentions (
        id, study_corpus_id, external_id, source_system, source_file_id,
        text_hash, text_clean, text_snippet, text_length, language,
        published_at, platform, resolved_platform, quality_score, inclusion_status,
        created_at
      ) VALUES (
        $1::uuid, $2::uuid, $3, 'fixture', $4::uuid,
        $5, 'Large population fixture mention with enough text for governed analysis',
        'Large population fixture', 66, 'es', $6::timestamptz,
        'x', 'x', 8, 'included', $6::timestamptz
      )
    `, [
      crypto.randomUUID(),
      IDS.corpusPrimary,
      `primary-large-${index}`,
      IDS.batchPrimary,
      (index + 16).toString(16).padStart(64, "0"),
      new Date(Date.UTC(2026, 1, 1, 12, index, 0)).toISOString()
    ]);
  }
}

async function seedLegacyModuleServingFixture(
  client: pg.Client,
  args: {
    kinds: Array<"topic" | "narrative">;
    subjectId: string;
    studyCorpusId: string;
    source: string;
  }
) {
  const workspaceId = await scalar<string>(client, `
    SELECT id::text FROM signal_workspaces WHERE brand_id = $1::uuid
  `, [IDS.brandA]);
  for (const kind of args.kinds) {
    const taxonomyId = crypto.randomUUID();
    const termId = crypto.randomUUID();
    const ruleSetId = crypto.randomUUID();
    const modelId = crypto.randomUUID();
    const profileId = crypto.randomUUID();
    await client.query(`
      INSERT INTO taxonomies (id, taxonomy_key, name, scope, methodology_slug, status)
      VALUES ($1::uuid, $2, $3, 'workspace', 'triggers-barriers', 'active')
    `, [taxonomyId, `module-${kind}-${taxonomyId}`, `Module ${kind}`]);
    await client.query(`
      INSERT INTO taxonomy_terms (id, taxonomy_id, term_key, label, status)
      VALUES ($1::uuid, $2::uuid, $3, $4, 'active')
    `, [termId, taxonomyId, `module_${kind}`, `Module ${kind}`]);
    await client.query(`
      INSERT INTO tagging_rule_sets (
        id, rule_set_key, version, methodology_slug, subject_type, scope,
        taxonomy_id, rules, status
      ) VALUES (
        $1::uuid, $2, 1, 'triggers-barriers', 'mention', 'workspace',
        $3::uuid, '{}'::jsonb, 'active'
      )
    `, [ruleSetId, `module-rules-${kind}-${ruleSetId}`, taxonomyId]);
    await client.query(`
      INSERT INTO tagging_model_versions (
        id, model_key, provider, version, methodology_slug, tagging_rule_set_id
      ) VALUES ($1::uuid, $2, 'fixture', '1', 'triggers-barriers', $3::uuid)
    `, [modelId, `module-model-${kind}-${modelId}`, ruleSetId]);
    await client.query(`
      INSERT INTO signal_taxonomy_profiles (
        id, workspace_id, taxonomy_id, kind, version, status, context_hash,
        rule_set_id, model_version_id, approved_by_user_id, approved_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4, 1, 'active',
        $5, $6::uuid, $7::uuid, $8::uuid, now()
      )
    `, [
      profileId,
      workspaceId,
      taxonomyId,
      kind,
      `sha256:${(kind === "topic" ? "c" : "d").repeat(64)}`,
      ruleSetId,
      modelId,
      IDS.userA
    ]);
    await client.query(`
      INSERT INTO record_tags (
        organization_id, brand_id, study_corpus_id, subject_type, subject_id,
        taxonomy_term_id, value, score, confidence, evidence, source,
        model_version_id, signal_taxonomy_profile_id,
        review_status, approval_source, approved_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, 'mention', $4::uuid,
        $5::uuid, $6, 0.95, 'high', '[]'::jsonb, $9,
        $7::uuid, $8::uuid, 'approved', 'human', now()
      )
    `, [
      IDS.orgA,
      IDS.brandA,
      args.studyCorpusId,
      args.subjectId,
      termId,
      `module_${kind}`,
      modelId,
      profileId,
      args.source
    ]);
  }
}

async function seedDirectWorkspaceIngestion(client: pg.Client) {
  const workspaceId = await scalar<string>(client, `
    SELECT id::text FROM signal_workspaces WHERE brand_id = $1::uuid
  `, [IDS.brandDirect]);
  await client.query(`
    INSERT INTO user_brand_access (user_id, brand_id, access_level)
    VALUES ($1::uuid, $2::uuid, 'manage') ON CONFLICT DO NOTHING
  `, [IDS.userA, IDS.brandDirect]);
  const competitorSeedId = crypto.randomUUID();
  const competitorId = crypto.randomUUID();
  await client.query(`
    INSERT INTO brand_seeds (
      id, canonical_name, aliases, detection_patterns, country, active
    ) VALUES ($1::uuid, $2, ARRAY[]::text[], ARRAY[$2]::text[], 'MX', true)
  `, [competitorSeedId, `Direct Competitor ${competitorSeedId}`]);
  await client.query(`
    INSERT INTO competitors (id, brand_id, competitor_brand_seed_id, priority)
    VALUES ($1::uuid, $2::uuid, $3::uuid, 1)
  `, [competitorId, IDS.brandDirect, competitorSeedId]);
  const scopes = [
    ["primary", "primary_brand", "brand", IDS.brandDirect, "approved"],
    ["competitor", "competitor", "competitor", competitorId, "approved"],
    ["category", "category", "category", null, "approved"],
    ["reference", "reference", "reference", null, "approved"],
    ["unattributed", "unattributed", "unattributed", null, "approved"],
    ["pending", "primary_brand", "brand", IDS.brandDirect, "pending"],
    ["rejected", "primary_brand", "brand", IDS.brandDirect, "rejected"],
    ["excluded", "primary_brand", "brand", IDS.brandDirect, "approved"]
  ] as const;
  const sourceIds = new Map<string, string>();
  for (const [key, scope, entityType, entityId, review] of scopes) {
    const sourceId = await scalar<string>(client, `
      INSERT INTO data_sources (
        workspace_id, organization_id, brand_id, source_type, provider,
        connection_method, name, governed_scope, governed_entity_type,
        governed_entity_id, scope_policy_version, scope_review_status,
        scope_approved_by_user_id, scope_approval_source, scope_approved_at,
        role, status
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, 'social-listening', 'fixture',
        'csv', $4, $5, $6, $7::uuid, 'workspace-source-scope-v1', $8,
        CASE WHEN $8 = 'approved' THEN $9::uuid END,
        CASE WHEN $8 = 'approved' THEN 'fixture_governance' END,
        CASE WHEN $8 = 'approved' THEN now() END,
        jsonb_build_object('ownership', 'workspace'), 'active'
      ) RETURNING id::text
    `, [workspaceId, IDS.orgA, IDS.brandDirect, `Source ${key}`, scope, entityType, entityId, review, IDS.userA]);
    sourceIds.set(key, sourceId);
  }

  const primaryMentionId = "20000000-0000-4000-8000-000000000701";
  const sharedHash = "9".repeat(64);
  const primaryBatch = await insertDirectBatch(client, workspaceId, sourceIds.get("primary")!);
  await insertDirectMention(client, {
    id: primaryMentionId,
    workspaceId,
    sourceId: sourceIds.get("primary")!,
    batchId: primaryBatch,
    hash: sharedHash,
    externalId: "direct-primary",
    inclusion: "included"
  });
  const competitorBatch = await insertDirectBatch(client, workspaceId, sourceIds.get("competitor")!);
  await client.query(`
    UPDATE import_batches
    SET mention_type = 'brand', entity_kind = 'primary_brand'
    WHERE id = $1::uuid
  `, [competitorBatch]);
  const duplicateId = crypto.randomUUID();
  const duplicate = await client.query(`
    INSERT INTO mentions (
      id, workspace_id, data_source_id, canonical_mention_id, provider_record_id,
      external_id, source_system, source_file_id, text_hash, text_clean,
      text_snippet, text_length, language, published_at, platform,
      resolved_platform, quality_score, inclusion_status
    ) VALUES (
      $5::uuid, $1::uuid, $2::uuid, $5::uuid, 'direct-duplicate',
      $1::text || ':direct-duplicate', 'fixture', $3::uuid, $4,
      'Same canonical mention from another source', 'Same canonical mention', 42,
      'es', '2026-02-01', 'x', 'x', 8, 'included'
    ) ON CONFLICT DO NOTHING RETURNING id
  `, [workspaceId, sourceIds.get("competitor")!, competitorBatch, sharedHash, duplicateId]);
  assert.equal(duplicate.rowCount, 0);
  await client.query(`SELECT record_signal_mention_import_provenance($1::uuid, $2::uuid)`, [
    primaryMentionId,
    competitorBatch
  ]);

  const cases = [
    ["category", "3".repeat(64), "included"],
    ["reference", "4".repeat(64), "included"],
    ["unattributed", "5".repeat(64), "included"],
    ["pending", "6".repeat(64), "included"],
    ["rejected", "7".repeat(64), "included"],
    ["excluded", "8".repeat(64), "excluded"],
    ["primary", "2".repeat(64), "pending"]
  ] as const;
  for (const [key, hash, inclusion] of cases) {
    const sourceId = sourceIds.get(key)!;
    const batchId = await insertDirectBatch(client, workspaceId, sourceId);
    await insertDirectMention(client, {
      id: crypto.randomUUID(), workspaceId, sourceId, batchId, hash,
      externalId: `${key}-${inclusion}`, inclusion
    });
  }
  return {
    workspaceId,
    primaryMentionId,
    primarySourceId: sourceIds.get("primary")!,
    primaryBatchId: primaryBatch,
    sharedHash
  };
}

async function seedOperationalServingRuntimeFixture(client: pg.Client) {
  for (const metric of SIGNAL_METRIC_DEFINITIONS_V1) {
    await client.query(`
      INSERT INTO metric_definitions (
        metric_key, name, description, grain, unit, definition, dimensions,
        owner_team, status, version, metric_group_key, formula_hash, visibility
      ) VALUES (
        $1, $2, $3, 'mention', $4, $5::jsonb, $6::jsonb,
        'signal', 'active', $7, $8, $9, $10
      ) ON CONFLICT (metric_key, version) DO NOTHING
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
  }
  const workspace = await scalarRow(client, `
    SELECT workspace.id::text AS workspace_id,
      pointer.population_id::text AS population_id
    FROM signal_workspaces workspace
    JOIN signal_workspace_population_pointers pointer
      ON pointer.workspace_id = workspace.id AND pointer.purpose = 'operational'
    WHERE workspace.brand_id = $1::uuid
  `, [IDS.brandA]);
  await client.query(`
    INSERT INTO signal_data_watermarks (
      workspace_id, study_corpus_id, population_id, source_key,
      corpus_revision, max_observed_at, accepted_at, materialized_at,
      source_freshness_state, data_freshness_state, metadata
    ) VALUES
      ($1::uuid, $2::uuid, NULL, 'fixture:legacy', 1,
        '2026-04-30T12:00:00Z', now(), now(), 'fresh', 'fresh',
        jsonb_build_object('fixture', 'module-serving-legacy')),
      ($1::uuid, NULL, $3::uuid, 'fixture:governed', 0,
        '2026-04-30T12:00:00Z', now(), now(), 'fresh', 'fresh',
        jsonb_build_object('fixture', 'module-serving-governed'))
  `, [workspace.workspace_id, IDS.corpusPrimary, workspace.population_id]);
}

async function insertDirectBatch(client: pg.Client, workspaceId: string, sourceId: string) {
  return scalar<string>(client, `
    INSERT INTO import_batches (
      workspace_id, data_source_id, source_system, status, source_file_name
    ) VALUES ($1::uuid, $2::uuid, 'fixture', 'completed', 'fixture.csv')
    RETURNING id::text
  `, [workspaceId, sourceId]);
}

async function insertDirectMention(client: pg.Client, args: {
  id: string;
  workspaceId: string;
  sourceId: string;
  batchId: string;
  hash: string;
  externalId: string;
  inclusion: string;
}) {
  await client.query(`
    INSERT INTO mentions (
      id, workspace_id, data_source_id, canonical_mention_id, provider_record_id,
      external_id, source_system, source_file_id, text_hash, text_clean,
      text_snippet, text_length, language, published_at, platform,
      resolved_platform, quality_score, inclusion_status
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, $1::uuid, $4,
      $2::text || ':' || $4, 'fixture', $5::uuid, $6,
      'Direct workspace mention with enough text', 'Direct workspace mention', 42,
      'es', '2026-02-01', 'x', 'x', 8, $7
    )
  `, [args.id, args.workspaceId, args.sourceId, args.externalId, args.batchId, args.hash, args.inclusion]);
}

async function populationState(client: pg.Client, workspaceId: string) {
  return scalarRow(client, `
    WITH attribution_rollup AS (
      SELECT
        count(DISTINCT mention.id) FILTER (
          WHERE mention.inclusion_status = 'included'
            AND attribution.scope = 'primary_brand'
            AND attribution.review_status = 'approved'
        )::int AS primary_approved_included,
        count(DISTINCT mention.id) FILTER (WHERE attribution.scope = 'competitor' AND mention.inclusion_status = 'included')::int AS competitor_included,
        count(DISTINCT mention.id) FILTER (WHERE attribution.scope = 'category' AND mention.inclusion_status = 'included')::int AS category_included,
        count(DISTINCT mention.id) FILTER (WHERE attribution.scope = 'reference' AND mention.inclusion_status = 'included')::int AS reference_included,
        count(DISTINCT mention.id) FILTER (WHERE attribution.scope = 'unattributed' AND mention.inclusion_status = 'included')::int AS unattributed_included,
        count(DISTINCT mention.id) FILTER (WHERE attribution.review_status = 'pending')::int AS attribution_pending,
        count(DISTINCT mention.id) FILTER (WHERE attribution.review_status = 'rejected')::int AS attribution_rejected,
        count(DISTINCT mention.id) FILTER (WHERE mention.inclusion_status = 'pending')::int AS mention_pending,
        count(DISTINCT mention.id) FILTER (WHERE mention.inclusion_status = 'excluded')::int AS mention_excluded
      FROM mentions mention
      LEFT JOIN signal_mention_attributions attribution ON attribution.mention_id = mention.id
      WHERE mention.workspace_id = $1::uuid AND mention.canonical_mention_id = mention.id
    ), membership_rollup AS (
      SELECT
        count(*) FILTER (WHERE membership_status = 'included' AND removed_at IS NULL)::int AS included,
        count(*) FILTER (WHERE membership_status = 'excluded' OR removed_at IS NOT NULL)::int AS excluded
      FROM signal_population_memberships
      WHERE workspace_id = $1::uuid
    )
    SELECT membership_rollup.*, attribution_rollup.*
    FROM membership_rollup CROSS JOIN attribution_rollup
  `, [workspaceId]);
}

async function activePopulationCount(client: pg.Client, workspaceId: string) {
  return scalar<number>(client, `
    SELECT count(*)::int FROM signal_population_memberships
    WHERE workspace_id = $1::uuid
      AND membership_status = 'included' AND removed_at IS NULL
  `, [workspaceId]);
}

async function exerciseStrategicConsumptionV1(client: pg.Client, databaseUrl: string) {
  const workspace = await scalarRow(client, `
    SELECT id::text AS workspace_id, timezone
    FROM signal_workspaces
    WHERE brand_id = $1::uuid
  `, [IDS.brandA]);
  const workspaceId = String(workspace.workspace_id);
  const timezone = String(workspace.timezone);
  const strategicSourceId = crypto.randomUUID();
  await client.query(`
    INSERT INTO data_sources (
      id, workspace_id, organization_id, brand_id, source_type, provider,
      connection_method, name, governed_scope, governed_entity_type,
      governed_entity_id, scope_policy_version, scope_review_status,
      scope_approved_by_user_id, scope_approval_source, scope_approved_at,
      role, status
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'social-listening', 'fixture',
      'csv', 'Phase 5 governed primary source', 'primary_brand', 'brand',
      $4::uuid, 'primary-brand-analysis-v1', 'approved',
      $5::uuid, 'fixture_governance', now(),
      jsonb_build_object('ownership', 'workspace', 'fixture', 'phase5'), 'active'
    )
  `, [strategicSourceId, workspaceId, IDS.orgA, IDS.brandA, IDS.userA]);
  await client.query(`
    INSERT INTO signal_mention_attributions (
      workspace_id, mention_id, data_source_id, scope, entity_type,
      entity_id, entity_label, confidence, review_status,
      attribution_source, policy_version, approved_by_user_id,
      approval_source, approved_at
    )
    SELECT DISTINCT
      $2::uuid, mention.canonical_mention_id, $1::uuid,
      'primary_brand', 'brand', $3::uuid, 'Brand A', 1,
      'approved', 'phase5-governed-source-fixture',
      'primary-brand-analysis-v1', $4::uuid, 'human', now()
    FROM signal_mention_attributions attribution
    JOIN mentions mention ON mention.id = attribution.mention_id
    WHERE attribution.workspace_id = $2::uuid
      AND attribution.scope = 'primary_brand'
      AND attribution.review_status = 'approved'
      AND mention.canonical_mention_id = mention.id
  `, [strategicSourceId, workspaceId, IDS.brandA, IDS.userA]);
  const otherWorkspaceId = await scalar<string>(client, `
    SELECT id::text FROM signal_workspaces WHERE brand_id = $1::uuid
  `, [IDS.brandB]);
  const populationOneKey = `sha256:${"a".repeat(64)}`;
  const runOneKey = `sha256:${"b".repeat(64)}`;
  const reviewOneKey = `sha256:${"c".repeat(64)}`;
  const populationTwoKey = `sha256:${"d".repeat(64)}`;
  const runTwoKey = `sha256:${"e".repeat(64)}`;
  const periodStart = "2025-12-31";
  const periodEnd = "2026-02-01";
  const laterMentionId = "30000000-0000-4000-8000-000000000701";

  const populationSql = `
    SELECT population_id::text, population_version, definition_hash,
      membership_digest, mention_count
    FROM create_signal_tb_analysis_population(
      $1::uuid, 'triggers-barriers', $2::date, $3::date, $4,
      'primary-brand-analysis', '1', $5::uuid, $6
    )
  `;
  const populationOneRows = await queryConcurrently(databaseUrl, populationSql, [
    workspaceId, periodStart, periodEnd, timezone, IDS.userA,
    populationOneKey
  ]);
  assert.equal(new Set(populationOneRows.map((row) => row.population_id)).size, 1);
  assert.deepEqual(populationOneRows.map((row) => row.mention_count), [107, 107]);
  const populationOne = populationOneRows[0]!;

  const runSql = `
    SELECT tb_analysis_id::text, snapshot_id::text, population_id::text,
      population_version, population_definition_hash, snapshot_digest,
      snapshot_mention_count, period_start::text, period_end::text,
      timezone, report_key, outbox_id::text, created
    FROM create_signal_tb_strategic_run(
      $1::uuid, 'triggers-barriers', $2::uuid, $3::uuid, $4::uuid, $5,
      $6, 'fixture-pipeline-v1', '1.0.0', 'fixture-prompt-v1',
      'fixture-model-v1', 'What moves demand?', 'Review strategic barriers',
      $7::integer, $8::jsonb
    )
  `;
  const runOneParams = [
    workspaceId, populationOne.population_id, IDS.corpusPrimary, IDS.userA,
    runOneKey, "Strategic snapshot revision 1", 1,
    JSON.stringify({ fixture: true, paid_execution: false })
  ];
  const runOneRows = await queryConcurrently(databaseUrl, runSql, runOneParams);
  assert.equal(new Set(runOneRows.map((row) => row.tb_analysis_id)).size, 1);
  assert.equal(new Set(runOneRows.map((row) => row.snapshot_id)).size, 1);
  assert.deepEqual(runOneRows.map((row) => row.created).sort(), [false, true]);
  const runOne = runOneRows[0]!;

  const retryRunOne = await scalarRow(client, runSql, runOneParams);
  assert.equal(retryRunOne.tb_analysis_id, runOne.tb_analysis_id);
  assert.equal(retryRunOne.snapshot_id, runOne.snapshot_id);
  assert.equal(retryRunOne.created, false);
  const runOneOutbox = await scalarRow(client, `
    SELECT status, attempt, bullmq_job_id
    FROM signal_strategic_run_outbox
    WHERE id = $1::uuid AND tb_analysis_id = $2::uuid
  `, [runOne.outbox_id, runOne.tb_analysis_id]);
  assert.deepEqual(runOneOutbox, {
    status: "pending",
    attempt: 0,
    bullmq_job_id: null
  });

  const directWorkspaceId = await scalar<string>(client, `
    SELECT id::text FROM signal_workspaces WHERE brand_id = $1::uuid
  `, [IDS.brandDirect]);
  const directOperationalPopulationId = await scalar<string>(client, `
    SELECT population_id::text
    FROM signal_workspace_population_pointers
    WHERE workspace_id = $1::uuid AND purpose = 'operational'
  `, [directWorkspaceId]);
  await expectSqlState(client, "23514", runSql, [
    directWorkspaceId, directOperationalPopulationId, IDS.directStudy, IDS.userA,
    `sha256:${"f".repeat(64)}`, "Invalid operational population", 1, "{}"
  ]);
  await expectSqlState(client, "23514", runSql, [
    otherWorkspaceId, populationOne.population_id, IDS.corpusOtherOrg, IDS.userB,
    `sha256:${"0".repeat(64)}`, "Cross workspace", 1, "{}"
  ]);
  await expectSqlState(client, "23505", runSql, [
    workspaceId, populationOne.population_id, IDS.corpusPrimary, IDS.userA,
    `sha256:${"1".repeat(64)}`, "Incompatible concurrent run", 1, "{}"
  ]);

  const reviewFixtureOne = await seedStrategicAnalysisFixture(client, {
    analysisId: runOne.tb_analysis_id,
    corpusId: IDS.corpusPrimary,
    workspaceId,
    snapshotMentionId: IDS.mentionPrimary,
    outsideMentionId: IDS.mentionCompetitor,
    aliasMentionId: IDS.mentionPrimaryAlias,
    suffix: "one"
  });
  const reviewedTagIds = await queryConcurrently(databaseUrl, `
    SELECT review_signal_tb_reusable_assertion(
      $1::uuid, $2::uuid, $3::uuid, 'approve', 'Selected reusable fixture assertion',
      $4, '{}'::jsonb
    )::text AS resolved_tag_id
  `, [runOne.tb_analysis_id, reviewFixtureOne.sourceTagId, IDS.userA, reviewOneKey]);
  assert.equal(new Set(reviewedTagIds.map((row) => row.resolved_tag_id)).size, 1);
  await approveStrategicAnalysisFixture(client, {
    analysisId: runOne.tb_analysis_id,
    artifactId: reviewFixtureOne.artifactId,
    reviewerUserId: IDS.userA
  });
  await client.query(`
    UPDATE study_corpora SET locked_by_analysis_id = NULL, updated_at = now()
    WHERE id = $1::uuid AND locked_by_analysis_id = $2::uuid
  `, [IDS.corpusPrimary, runOne.tb_analysis_id]);

  const releaseOne = await createAndPromoteStrategicRelease(client, databaseUrl, {
    workspaceId,
    analysisId: runOne.tb_analysis_id,
    snapshotId: runOne.snapshot_id,
    artifactId: reviewFixtureOne.artifactId,
    revision: 1,
    reviewerUserId: IDS.userA
  });
  const releaseOneFrozen = await scalarRow(client, `
    SELECT to_jsonb(release) AS release_row,
      (SELECT count(*)::int FROM signal_workspace_release_artifacts
        WHERE release_id = release.id) AS artifact_count,
      (SELECT count(*)::int FROM corpus_snapshot_mentions
        WHERE snapshot_id = release.snapshot_id) AS snapshot_count
    FROM signal_workspace_releases release
    WHERE release.id = $1::uuid
  `, [releaseOne]);

  await client.query(`
    INSERT INTO mentions (
      id, workspace_id, data_source_id, canonical_mention_id, provider_record_id,
      external_id, source_system, text_hash, text_clean,
      text_snippet, text_length, language, published_at, platform,
      resolved_platform, quality_score, inclusion_status
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, $1::uuid, 'phase5-later-mention',
      'phase5-later-mention', 'phase5-fixture', $4,
      'New listening evidence ingested after revision one froze',
      'New listening evidence ingested after revision one froze', 56,
      'es', '2026-01-15T12:00:00Z', 'x', 'x', 9, 'included'
    )
  `, [
    laterMentionId, workspaceId, strategicSourceId, "9".repeat(64)
  ]);
  await client.query(`
    INSERT INTO signal_mention_attributions (
      workspace_id, mention_id, data_source_id,
      scope, entity_type, entity_id, entity_label, confidence,
      review_status, attribution_source, policy_version,
      approved_by_user_id, approval_source, approved_at
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid,
      'primary_brand', 'brand', $4::uuid, 'Brand A', 1,
      'approved', 'phase5-fixture', 'primary-brand-analysis-v1',
      $5::uuid, 'human', now()
    )
  `, [
    workspaceId, laterMentionId, strategicSourceId, IDS.brandA, IDS.userA
  ]);

  const laterMentionInSnapshotOne = await scalar<number>(client, `
    SELECT count(*)::int FROM corpus_snapshot_mentions
    WHERE snapshot_id = $1::uuid AND mention_id = $2::uuid
  `, [runOne.snapshot_id, laterMentionId]);
  assert.equal(laterMentionInSnapshotOne, 0);

  const populationTwo = await scalarRow(client, populationSql, [
    workspaceId, periodStart, periodEnd, timezone, IDS.userA,
    populationTwoKey
  ]);
  const runTwoResult = await scalarRow(client, runSql, [
    workspaceId, populationTwo.population_id, IDS.corpusPrimary, IDS.userA,
    runTwoKey, "Strategic snapshot revision 2", 2,
    JSON.stringify({ fixture: true, paid_execution: false, previous_release_id: releaseOne })
  ]);
  const runTwo = {
    tb_analysis_id: String(runTwoResult.tb_analysis_id),
    snapshot_id: String(runTwoResult.snapshot_id),
    population_version: Number(runTwoResult.population_version),
    snapshot_mention_count: Number(runTwoResult.snapshot_mention_count),
    created: runTwoResult.created === true
  };
  assert.equal(runTwo.created, true);
  assert.notEqual(runTwo.snapshot_id, runOne.snapshot_id);
  const reviewFixtureTwo = await seedStrategicAnalysisFixture(client, {
    analysisId: runTwo.tb_analysis_id,
    corpusId: IDS.corpusPrimary,
    workspaceId,
    snapshotMentionId: laterMentionId,
    outsideMentionId: IDS.mentionCompetitor,
    suffix: "two"
  });
  await approveStrategicAnalysisFixture(client, {
    analysisId: runTwo.tb_analysis_id,
    artifactId: reviewFixtureTwo.artifactId,
    reviewerUserId: IDS.userA
  });
  await client.query(`
    UPDATE study_corpora SET locked_by_analysis_id = NULL, updated_at = now()
    WHERE id = $1::uuid AND locked_by_analysis_id = $2::uuid
  `, [IDS.corpusPrimary, runTwo.tb_analysis_id]);
  await createAndPromoteStrategicRelease(client, databaseUrl, {
    workspaceId,
    analysisId: runTwo.tb_analysis_id,
    snapshotId: runTwo.snapshot_id,
    artifactId: reviewFixtureTwo.artifactId,
    revision: 2,
    reviewerUserId: IDS.userA,
    comparisonBaseAnalysisId: runOne.tb_analysis_id
  });

  const releaseOneAfter = await scalarRow(client, `
    SELECT to_jsonb(release) AS release_row,
      (SELECT count(*)::int FROM signal_workspace_release_artifacts
        WHERE release_id = release.id) AS artifact_count,
      (SELECT count(*)::int FROM corpus_snapshot_mentions
        WHERE snapshot_id = release.snapshot_id) AS snapshot_count
    FROM signal_workspace_releases release
    WHERE release.id = $1::uuid
  `, [releaseOne]);
  const releaseHistory = await scalarRow(client, `
    SELECT
      string_agg(release.report_revision::text, ',' ORDER BY release.report_revision) AS revisions,
      (SELECT current_release.report_revision
       FROM signal_workspace_report_current_releases pointer
       JOIN signal_workspace_releases current_release ON current_release.id = pointer.release_id
       WHERE pointer.workspace_id = $1::uuid AND pointer.report_key = 'triggers-barriers') AS current_revision,
      (SELECT count(*)::int FROM signal_workspace_reports
       WHERE workspace_id = $1::uuid AND report_key = 'triggers-barriers') AS report_registry_rows
    FROM signal_workspace_releases release
    WHERE release.workspace_id = $1::uuid AND release.report_key = 'triggers-barriers'
  `, [workspaceId]);
  const enrichment = await scalarRow(client, `
    SELECT
      count(*) FILTER (WHERE tag.subject_id = $1::uuid AND tag.review_status = 'approved')::int AS approved_root_rows,
      count(*) FILTER (WHERE tag.subject_id = $2::uuid AND tag.review_status = 'approved')::int AS approved_alias_rows,
      (SELECT count(*)::int FROM tb_reusable_assertion_review_events event
       WHERE event.tb_analysis_id = $3::uuid
         AND event.source_mention_id = $2::uuid
         AND event.canonical_mention_id = $1::uuid) AS source_alias_events,
      (SELECT count(*)::int FROM lineage_edges edge
       WHERE edge.source_type = 'mention_alias' AND edge.source_id = $2::uuid
         AND edge.relation_type = 'canonicalized_during_review') AS canonical_lineage_edges
    FROM record_tags tag
    WHERE tag.taxonomy_term_id = $4::uuid
  `, [
    IDS.mentionPrimary, IDS.mentionPrimaryAlias, runOne.tb_analysis_id,
    reviewFixtureOne.taxonomyTermId
  ]);
  const containment = await scalarRow(client, `
    SELECT
      (result->>'checked')::boolean AS checked,
      (result->>'contract_violation_count')::integer AS contract_violation_count
    FROM (SELECT assert_signal_tb_snapshot_containment($1::uuid, 'integration-final') AS result) checked
  `, [runTwo.tb_analysis_id]);
  const idempotency = await scalarRow(client, `
    SELECT
      count(DISTINCT population.id)::int AS population_ids,
      count(DISTINCT analysis.id)::int AS run_ids,
      count(DISTINCT analysis.snapshot_id)::int AS snapshot_ids,
      (SELECT count(*)::int FROM tb_reusable_assertion_review_events
       WHERE tb_analysis_id = $2::uuid AND idempotency_key = $3) AS review_event_rows,
      (SELECT count(DISTINCT pointer.release_id)::int
       FROM signal_workspace_report_current_releases pointer
       WHERE pointer.workspace_id = $1::uuid AND pointer.report_key = 'triggers-barriers') AS release_ids
    FROM signal_population_definitions population
    JOIN tb_analyses analysis ON analysis.population_id = population.id
    WHERE population.workspace_id = $1::uuid
      AND population.idempotency_key = $4
      AND analysis.run_idempotency_key = $5
  `, [workspaceId, runOne.tb_analysis_id, reviewOneKey, populationOneKey, runOneKey]);
  const laterMentionInSnapshotTwo = await scalar<number>(client, `
    SELECT count(*)::int FROM corpus_snapshot_mentions
    WHERE snapshot_id = $1::uuid AND mention_id = $2::uuid
  `, [runTwo.snapshot_id, laterMentionId]);
  await client.query(`
    UPDATE mentions
    SET inclusion_status = 'excluded',
        exclusion_reason = 'phase5_fixture_operational_cleanup',
        updated_at = now()
    WHERE id = $1::uuid
  `, [laterMentionId]);

  return {
    run_one: {
      population_version: runOne.population_version,
      snapshot_mentions: runOne.snapshot_mention_count,
      later_mention_membership: laterMentionInSnapshotOne,
      committed_outbox: runOneOutbox
    },
    run_two: {
      population_version: runTwo.population_version,
      snapshot_mentions: runTwo.snapshot_mention_count,
      later_mention_membership: laterMentionInSnapshotTwo
    },
    release_history: {
      revisions: releaseHistory.revisions,
      current_revision: releaseHistory.current_revision,
      release_one_unchanged:
        JSON.stringify(releaseOneFrozen.release_row) === JSON.stringify(releaseOneAfter.release_row)
        && releaseOneFrozen.artifact_count === releaseOneAfter.artifact_count,
      snapshot_one_unchanged: releaseOneFrozen.snapshot_count === releaseOneAfter.snapshot_count,
      report_registry_rows: releaseHistory.report_registry_rows
    },
    reusable_enrichment: enrichment,
    containment: {
      checked: containment.checked,
      contract_violation_count: containment.contract_violation_count,
      outside_coding_sqlstate: "23514",
      outside_citation_sqlstate: "23514",
      outside_evidence_sqlstate: "23514"
    },
    idempotency,
    authorization: {
      cross_workspace_population_sqlstate: "23514",
      cross_workspace_run_sqlstate: "23514",
      incompatible_concurrent_run_sqlstate: "23505"
    }
  };
}

async function seedStrategicAnalysisFixture(client: pg.Client, args: {
  analysisId: string;
  corpusId: string;
  workspaceId: string;
  snapshotMentionId: string;
  outsideMentionId: string;
  aliasMentionId?: string;
  suffix: string;
}) {
  const findingId = await scalar<string>(client, `
    INSERT INTO tb_findings (
      tb_analysis_id, finding_id, polarity, layer, nombre_comercial,
      frecuencia, intensidad_promedio, capacidad_predictiva, score_compuesto,
      confidence, position_in_layer
    ) VALUES (
      $1::uuid, $2, 'trigger', 'personal', $3,
      1, 0.8, 0.7, 0.75, 'alta', 0
    ) RETURNING id::text
  `, [args.analysisId, `T-FIXTURE-${args.suffix}`, `Fixture ${args.suffix}`]);
  const artifactId = await scalar<string>(client, `
    INSERT INTO analysis_artifacts (
      study_corpus_id, tb_analysis_id, artifact_key, artifact_type,
      title, summary, content, confidence, review_status, revision, metadata
    ) VALUES (
      $1::uuid, $2::uuid, $3, 'finding', $4, 'Deterministic fixture',
      jsonb_build_object('fixture', true), 'high', 'needs_review', 1,
      jsonb_build_object('paid_execution', false)
    ) RETURNING id::text
  `, [args.corpusId, args.analysisId, `fixture-artifact-${args.suffix}`, `Fixture ${args.suffix}`]);
  const evidenceGroupId = await scalar<string>(client, `
    INSERT INTO analysis_evidence_groups (
      artifact_id, group_key, role, label, position
    ) VALUES ($1::uuid, 'primary', 'protagonist', 'Primary evidence', 0)
    RETURNING id::text
  `, [artifactId]);

  await expectSqlState(client, "23514", `
    INSERT INTO tb_mention_codings (
      tb_analysis_id, mention_id, finding_id, polarity, layer, intensity_score
    ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'trigger', 'personal', 0.8)
  `, [args.analysisId, args.outsideMentionId, findingId]);
  await expectSqlState(client, "23514", `
    INSERT INTO tb_finding_citations (finding_id, mention_id, is_protagonist)
    VALUES ($1::uuid, $2::uuid, true)
  `, [findingId, args.outsideMentionId]);
  await expectSqlState(client, "23514", `
    INSERT INTO analysis_evidence_links (
      evidence_group_id, source_type, source_id, relation_type, evidence_role
    ) VALUES ($1::uuid, 'mention', $2::uuid, 'supports', 'protagonist')
  `, [evidenceGroupId, args.outsideMentionId]);

  await client.query(`
    INSERT INTO tb_mention_codings (
      tb_analysis_id, mention_id, finding_id, polarity, layer, intensity_score
    ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'trigger', 'personal', 0.8)
  `, [args.analysisId, args.snapshotMentionId, findingId]);
  await client.query(`
    INSERT INTO tb_finding_citations (finding_id, mention_id, is_protagonist)
    VALUES ($1::uuid, $2::uuid, true)
  `, [findingId, args.snapshotMentionId]);
  await client.query(`
    INSERT INTO analysis_evidence_links (
      evidence_group_id, source_type, source_id, relation_type,
      evidence_role, quote, confidence, weight
    ) VALUES (
      $1::uuid, 'mention', $2::uuid, 'supports', 'protagonist',
      'Deterministic snapshot-contained evidence', 'high', 1
    )
  `, [evidenceGroupId, args.snapshotMentionId]);
  await client.query(`
    INSERT INTO tb_quality_gates (tb_analysis_id, gate_name, passed, notes)
    VALUES ($1::uuid, 'snapshot_containment', true, 'Deterministic fixture')
  `, [args.analysisId]);
  await client.query(`
    UPDATE tb_analyses SET status = 'needs_review', current_step = 'review'
    WHERE id = $1::uuid
  `, [args.analysisId]);
  await scalarRow(client, `
    SELECT assert_signal_tb_snapshot_containment($1::uuid, $2) AS result
  `, [args.analysisId, `fixture-${args.suffix}`]);

  const taxonomyId = crypto.randomUUID();
  const taxonomyTermId = crypto.randomUUID();
  const tagSubjectId = args.aliasMentionId ?? args.snapshotMentionId;
  const tagCorpusId = args.aliasMentionId ? IDS.corpusSecondary : args.corpusId;
  await client.query(`
    INSERT INTO taxonomies (
      id, taxonomy_key, name, scope, methodology_slug, status
    ) VALUES ($1::uuid, $2, 'T&B reusable fixture', 'workspace', 'triggers-barriers', 'active')
  `, [taxonomyId, `tb-reusable-${taxonomyId}`]);
  await client.query(`
    INSERT INTO taxonomy_terms (
      id, taxonomy_id, term_key, label, status
    ) VALUES ($1::uuid, $2::uuid, 'reusable-fixture', 'Reusable fixture', 'active')
  `, [taxonomyTermId, taxonomyId]);
  const sourceTagId = await scalar<string>(client, `
    INSERT INTO record_tags (
      organization_id, brand_id, study_corpus_id, subject_type, subject_id,
      taxonomy_term_id, value, score, confidence, evidence, source,
      tb_analysis_id, review_status
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, 'mention', $4::uuid,
      $5::uuid, 'reusable-fixture', 0.91, 'high',
      jsonb_build_array(jsonb_build_object(
        'tb_analysis_id', $6::uuid, 'source_mention_id', $4::uuid,
        'provenance', 'deterministic-phase5-fixture'
      )), $7, $6::uuid, 'unreviewed'
    ) RETURNING id::text
  `, [
    IDS.orgA, IDS.brandA, tagCorpusId, tagSubjectId,
    taxonomyTermId, args.analysisId, `tb_analysis:${args.analysisId}:fixture`
  ]);
  return { artifactId, findingId, evidenceGroupId, sourceTagId, taxonomyTermId };
}

async function approveStrategicAnalysisFixture(client: pg.Client, args: {
  analysisId: string;
  artifactId: string;
  reviewerUserId: string;
}) {
  await client.query(`
    INSERT INTO analysis_artifact_review_events (
      artifact_id, reviewer_user_id, action, previous_status,
      next_status, patch, notes
    ) VALUES (
      $1::uuid, $2::uuid, 'accept', 'needs_review', 'accepted',
      '{}'::jsonb, 'Deterministic local Review fixture'
    )
  `, [args.artifactId, args.reviewerUserId]);
  await client.query(`
    UPDATE analysis_artifacts
    SET review_status = 'accepted', updated_at = now()
    WHERE id = $1::uuid
  `, [args.artifactId]);
  await client.query(`
    UPDATE tb_analyses
    SET status = 'approved_by_kam', current_step = 'done', updated_at = now()
    WHERE id = $1::uuid
  `, [args.analysisId]);
}

async function createAndPromoteStrategicRelease(
  client: pg.Client,
  databaseUrl: string,
  args: {
    workspaceId: string;
    analysisId: string;
    snapshotId: string;
    artifactId: string;
    revision: number;
    reviewerUserId: string;
    comparisonBaseAnalysisId?: string;
  }
) {
  const releaseId = await scalar<string>(client, `
    INSERT INTO signal_workspace_releases (
      workspace_id, tb_analysis_id, report_key, report_revision,
      release_key, title, status, visibility, period_start, period_end,
      corpus_revision, snapshot_id, comparison_base_analysis_id,
      quality_gates, metadata
    )
    SELECT
      $1::uuid, analysis.id, 'triggers-barriers', $2::integer,
      $3, $4, 'draft', 'internal', analysis.period_start, analysis.period_end,
      analysis.corpus_revision, analysis.snapshot_id, $5::uuid,
      jsonb_build_array(jsonb_build_object('gate', 'snapshot_containment', 'passed', true)),
      jsonb_build_object('fixture', true, 'report_identity', 'triggers-barriers')
    FROM tb_analyses analysis
    WHERE analysis.id = $6::uuid AND analysis.snapshot_id = $7::uuid
    RETURNING id::text
  `, [
    args.workspaceId, args.revision, `phase5-fixture-release-${args.revision}`,
    `T&B revision ${args.revision}`, args.comparisonBaseAnalysisId ?? null,
    args.analysisId, args.snapshotId
  ]);
  await client.query(`
    INSERT INTO signal_workspace_release_artifacts (
      release_id, artifact_id, artifact_revision, position, visibility
    ) VALUES ($1::uuid, $2::uuid, 1, 0, 'client')
  `, [releaseId, args.artifactId]);
  const promoted = await queryConcurrently(databaseUrl, `
    SELECT promote_signal_workspace_report_release($1::uuid, $2::uuid)::text AS release_id
  `, [releaseId, args.reviewerUserId]);
  assert.equal(new Set(promoted.map((row) => row.release_id)).size, 1);
  assert.equal(promoted[0]!.release_id, releaseId);
  return releaseId;
}

async function queryConcurrently(
  databaseUrl: string,
  query: string,
  params: unknown[]
): Promise<Array<Record<string, any>>> {
  const clients = [
    new pg.Client({ connectionString: databaseUrl, ssl: false }),
    new pg.Client({ connectionString: databaseUrl, ssl: false })
  ];
  await Promise.all(clients.map((concurrentClient) => concurrentClient.connect()));
  try {
    const results = await Promise.all(
      clients.map((concurrentClient) => concurrentClient.query(query, params))
    );
    return results.flatMap((result) => result.rows);
  } finally {
    await Promise.all(clients.map((concurrentClient) => concurrentClient.end()));
  }
}

async function exerciseSnapshotReleaseAndEnrichment(
  client: pg.Client,
  direct: { workspaceId: string; primaryMentionId: string; primarySourceId: string }
) {
  await client.query(`
    INSERT INTO study_corpora (
      id, name, brand_id, methodology_id, methodology_version_at_creation,
      business_question, decision_to_inform, status, corpus_revision
    ) VALUES (
      $1::uuid, 'Direct governed study', $2::uuid, $3::uuid, '1.0.0',
      'Governed question', 'Governed decision', 'corpus_approved', 1
    )
  `, [IDS.directStudy, IDS.brandDirect, IDS.methodTb]);
  const populationId = await scalar<string>(client, `
    SELECT population_id::text FROM signal_workspace_population_pointers
    WHERE workspace_id = $1::uuid AND purpose = 'operational'
  `, [direct.workspaceId]);
  const snapshotOne = await scalarRow(client, `
    SELECT snapshot_id::text, mention_count
    FROM create_signal_workspace_population_snapshot(
      $1::uuid, $2::uuid, $3::uuid, 'Snapshot 1', 'approval', $4::uuid, '{}'::jsonb
    )
  `, [direct.workspaceId, populationId, IDS.directStudy, IDS.userA]);

  const analysisOne = await scalar<string>(client, `
    INSERT INTO tb_analyses (
      study_corpus_id, snapshot_id, pipeline_version, methodology_version,
      methodology_slug, prompt_version, model_version, corpus_revision,
      period_start, period_end, snapshot_mention_count, snapshot_digest,
      scope_frozen_at, status, current_step, executed_by_user_id
    ) VALUES (
      $1::uuid, $2::uuid, 'fixture-v1', '1.0.0', 'triggers-barriers',
      'fixture-prompt', 'fixture-model', 1, '2026-02-01', '2026-02-01',
      $3, 'md5:fixture-one', now(), 'approved_by_kam', 'done', $4::uuid
    ) RETURNING id::text
  `, [IDS.directStudy, snapshotOne.snapshot_id, snapshotOne.mention_count, IDS.userA]);
  const releaseOne = await scalar<string>(client, `
    INSERT INTO signal_workspace_releases (
      workspace_id, tb_analysis_id, report_key, report_revision,
      release_key, title, status, visibility, period_start, period_end,
      corpus_revision, snapshot_id, approved_by_user_id, approved_at, published_at
    ) VALUES (
      $1::uuid, $2::uuid, 'triggers-barriers', 1,
      'fixture-release-1', 'Release 1', 'published', 'client',
      '2026-02-01', '2026-02-01', 1, $3::uuid, $4::uuid, now(), now()
    ) RETURNING id::text
  `, [direct.workspaceId, analysisOne, snapshotOne.snapshot_id, IDS.userA]);
  await client.query(`
    INSERT INTO signal_workspace_report_current_releases (
      workspace_id, report_key, release_id, promoted_by_user_id
    ) VALUES ($1::uuid, 'triggers-barriers', $2::uuid, $3::uuid)
  `, [direct.workspaceId, releaseOne, IDS.userA]);

  await seedReusableEnrichment(client, direct, analysisOne);

  const nextBatch = await insertDirectBatch(client, direct.workspaceId, direct.primarySourceId);
  await insertDirectMention(client, {
    id: "20000000-0000-4000-8000-000000000799",
    workspaceId: direct.workspaceId,
    sourceId: direct.primarySourceId,
    batchId: nextBatch,
    hash: "0".repeat(64),
    externalId: "new-after-release",
    inclusion: "included"
  });
  const snapshotAfter = await scalar<number>(client, `
    SELECT count(*)::int FROM corpus_snapshot_mentions WHERE snapshot_id = $1::uuid
  `, [snapshotOne.snapshot_id]);
  const releaseOneRows = await scalar<number>(client, `
    SELECT count(*)::int FROM signal_workspace_releases
    WHERE id = $1::uuid AND status = 'published' AND report_revision = 1
  `, [releaseOne]);

  const snapshotTwo = await scalarRow(client, `
    SELECT snapshot_id::text, mention_count
    FROM create_signal_workspace_population_snapshot(
      $1::uuid, $2::uuid, $3::uuid, 'Snapshot 2', 'approval', $4::uuid, '{}'::jsonb
    )
  `, [direct.workspaceId, populationId, IDS.directStudy, IDS.userA]);
  const analysisTwo = await scalar<string>(client, `
    INSERT INTO tb_analyses (
      study_corpus_id, snapshot_id, pipeline_version, methodology_version,
      methodology_slug, prompt_version, model_version, corpus_revision,
      period_start, period_end, snapshot_mention_count, snapshot_digest,
      scope_frozen_at, status, current_step, executed_by_user_id
    ) VALUES (
      $1::uuid, $2::uuid, 'fixture-v1', '1.0.0', 'triggers-barriers',
      'fixture-prompt', 'fixture-model', 2, '2026-02-01', '2026-02-01',
      $3, 'md5:fixture-two', now(), 'approved_by_kam', 'done', $4::uuid
    ) RETURNING id::text
  `, [IDS.directStudy, snapshotTwo.snapshot_id, snapshotTwo.mention_count, IDS.userA]);
  const releaseTwo = await scalar<string>(client, `
    INSERT INTO signal_workspace_releases (
      workspace_id, tb_analysis_id, report_key, report_revision,
      release_key, title, status, visibility, period_start, period_end,
      corpus_revision, snapshot_id, approved_by_user_id, approved_at, published_at
    ) VALUES (
      $1::uuid, $2::uuid, 'triggers-barriers', 2,
      'fixture-release-2', 'Release 2', 'published', 'client',
      '2026-02-01', '2026-02-01', 2, $3::uuid, $4::uuid, now(), now()
    ) RETURNING id::text
  `, [direct.workspaceId, analysisTwo, snapshotTwo.snapshot_id, IDS.userA]);
  await client.query(`
    INSERT INTO signal_workspace_report_current_releases (
      workspace_id, report_key, release_id, promoted_by_user_id
    ) VALUES ($1::uuid, 'triggers-barriers', $2::uuid, $3::uuid)
    ON CONFLICT (workspace_id, report_key) DO UPDATE
    SET release_id = EXCLUDED.release_id,
        promoted_by_user_id = EXCLUDED.promoted_by_user_id,
        promoted_at = now()
  `, [direct.workspaceId, releaseTwo, IDS.userA]);

  return scalarRow(client, `
    SELECT
      $1::int AS snapshot_before,
      $2::int AS snapshot_after_ingest,
      $3::int AS release_one_rows_after_ingest,
      (SELECT count(*)::int FROM signal_workspace_reports
        WHERE workspace_id = $4::uuid AND report_key = 'triggers-barriers') AS report_registry_rows,
      (SELECT string_agg(report_revision::text, ',' ORDER BY report_revision)
        FROM signal_workspace_releases
        WHERE workspace_id = $4::uuid AND report_key = 'triggers-barriers') AS release_revisions,
      (SELECT release.report_revision
        FROM signal_workspace_report_current_releases current_release
        JOIN signal_workspace_releases release ON release.id = current_release.release_id
        WHERE current_release.workspace_id = $4::uuid
          AND current_release.report_key = 'triggers-barriers') AS current_revision,
      (SELECT count(*)::int FROM record_tags
        WHERE subject_id = $5::uuid AND tb_analysis_id = $6::uuid
          AND review_status = 'approved' AND confidence = 'high'
          AND approval_source = 'human') AS reusable_enrichment_rows
  `, [snapshotOne.mention_count, snapshotAfter, releaseOneRows, direct.workspaceId, direct.primaryMentionId, analysisOne]);
}

async function seedReusableEnrichment(
  client: pg.Client,
  direct: { workspaceId: string; primaryMentionId: string },
  analysisId: string
) {
  const taxonomyId = crypto.randomUUID();
  const termId = crypto.randomUUID();
  const ruleSetId = crypto.randomUUID();
  const modelId = crypto.randomUUID();
  const profileId = crypto.randomUUID();
  await client.query(`
    INSERT INTO taxonomies (id, taxonomy_key, name, scope, methodology_slug, status)
    VALUES ($1::uuid, $2, 'Fixture taxonomy', 'workspace', 'triggers-barriers', 'active')
  `, [taxonomyId, `fixture-taxonomy-${taxonomyId}`]);
  await client.query(`
    INSERT INTO taxonomy_terms (id, taxonomy_id, term_key, label, status)
    VALUES ($1::uuid, $2::uuid, 'fixture-term', 'Fixture term', 'active')
  `, [termId, taxonomyId]);
  await client.query(`
    INSERT INTO tagging_rule_sets (
      id, rule_set_key, version, methodology_slug, subject_type, scope,
      taxonomy_id, rules, status
    ) VALUES ($1::uuid, $2, 1, 'triggers-barriers', 'mention', 'workspace', $3::uuid, '{}'::jsonb, 'active')
  `, [ruleSetId, `fixture-rules-${ruleSetId}`, taxonomyId]);
  await client.query(`
    INSERT INTO tagging_model_versions (
      id, model_key, provider, version, methodology_slug, tagging_rule_set_id
    ) VALUES ($1::uuid, $2, 'fixture', '1', 'triggers-barriers', $3::uuid)
  `, [modelId, `fixture-model-${modelId}`, ruleSetId]);
  await client.query(`
    INSERT INTO signal_taxonomy_profiles (
      id, workspace_id, taxonomy_id, kind, version, status, context_hash,
      rule_set_id, model_version_id, approved_by_user_id, approved_at
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, 'topic', 1, 'active',
      'sha256:${"a".repeat(64)}', $4::uuid, $5::uuid, $6::uuid, now()
    )
  `, [profileId, direct.workspaceId, taxonomyId, ruleSetId, modelId, IDS.userA]);
  await client.query(`
    INSERT INTO record_tags (
      organization_id, brand_id, study_corpus_id, subject_type, subject_id,
      taxonomy_term_id, value, score, confidence, evidence, source,
      model_version_id, signal_taxonomy_profile_id, tb_analysis_id,
      review_status, approval_source, approved_at
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, 'mention', $4::uuid,
      $5::uuid, 'fixture-term', 0.91, 'high',
      jsonb_build_array(jsonb_build_object('tb_analysis_id', $6::uuid, 'provenance', 'fixture')),
      'tb_analysis:' || $6::text, $7::uuid, $8::uuid, $6::uuid,
      'approved', 'human', now()
    )
  `, [
    IDS.orgA, IDS.brandDirect, IDS.directStudy, direct.primaryMentionId,
    termId, analysisId, modelId, profileId
  ]);
}

async function expectSqlState(
  client: pg.Client,
  sqlState: string,
  query: string,
  params: unknown[]
) {
  await assert.rejects(
    client.query(query, params),
    (error: unknown) => error instanceof Error
      && "code" in error
      && (error as Error & { code?: string }).code === sqlState
  );
}

async function scalar<T>(client: pg.Client, query: string, params: unknown[] = []) {
  const result = await client.query<Record<string, T>>(query, params);
  const row = result.rows[0];
  assert.ok(row);
  return Object.values(row)[0] as T;
}

async function scalarRow(client: pg.Client, query: string, params: unknown[] = []) {
  const result = await client.query<Record<string, unknown>>(query, params);
  const row = result.rows[0];
  assert.ok(row);
  return row;
}
