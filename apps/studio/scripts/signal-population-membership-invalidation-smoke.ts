import assert from "node:assert/strict";

import {
  normalizeSignalFilterV1,
  signalFiltersHashV1,
  type SignalMaterializeJobDataV1
} from "@noisia/query-engine";

import type { ResolvedSignalWorkspace } from "../src/lib/data-os/signal-workspace";
import { resolveSignalOperationalReadScopeV1 } from "../src/lib/data-os/signal-operational-read-scope";
import {
  createWorkspaceDataSource,
  ingestWorkspaceDataSourceCsv
} from "../src/lib/data-os/workspace-ingestion";
import { loadSignalBrandMonitoringV1 } from "../src/lib/signal-v2/brand-monitoring";
import { pool } from "../src/lib/db";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (process.env.NOISIA_SIGNAL_MEMBERSHIP_INVALIDATION_SMOKE_APPROVED !== "true") {
  throw new Error(
    "Set NOISIA_SIGNAL_MEMBERSHIP_INVALIDATION_SMOKE_APPROVED=true for a disposable local database."
  );
}
const parsed = new URL(databaseUrl);
if (!(["localhost", "127.0.0.1", "::1"] as string[]).includes(parsed.hostname)
    || !/migration[_-]smoke/u.test(parsed.pathname)) {
  throw new Error("Membership invalidation smoke only accepts the disposable migration-smoke database.");
}

const fixture = {
  organizationId: crypto.randomUUID(),
  userId: crypto.randomUUID(),
  brandId: crypto.randomUUID(),
  runId: crypto.randomUUID()
};

async function main() {
  const { signalMaterializationJob } = await import(
    "../../../services/workers/src/workers/signal-materialization"
  );
  const { signalInvalidationJob } = await import(
    "../../../services/workers/src/workers/signal-refresh"
  );
  const { pool: workerPool } = await import(
    "../../../services/workers/src/db/client"
  );
  try {
    await pool.query(`
      INSERT INTO organizations (id, slug, legal_name, display_name, status)
      VALUES ($1::uuid, $2, 'Membership Invalidation Fixture',
        'Membership Invalidation Fixture', 'active')
    `, [fixture.organizationId, `membership-org-${fixture.runId}`]);
    await pool.query(`
      INSERT INTO users (
        id, email, full_name, user_type, primary_role, organization_id, status
      ) VALUES (
        $1::uuid, $2, 'Membership Invalidation User', 'client',
        'brand_manager', $3::uuid, 'active'
      )
    `, [fixture.userId, `membership-${fixture.runId}@example.test`, fixture.organizationId]);
    await pool.query(`
      INSERT INTO brands (
        id, organization_id, slug, name, display_name, countries, status
      ) VALUES (
        $1::uuid, $2::uuid, $3, 'Membership Invalidation Brand',
        'Membership Invalidation Brand', ARRAY['MX']::char(2)[], 'active'
      )
    `, [fixture.brandId, fixture.organizationId, `membership-brand-${fixture.runId}`]);
    const provisioned = (await pool.query<{
      id: string;
      slug: string;
      timezone: string;
      population_id: string;
      population_version: number;
      population_definition_hash: string;
    }>(`
      SELECT workspace.id::text, workspace.slug, workspace.timezone,
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
    const workspace: ResolvedSignalWorkspace = {
      contractVersion: "signal-backend-v1",
      id: provisioned.id,
      organizationId: fixture.organizationId,
      slug: provisioned.slug,
      name: "Membership Invalidation Brand",
      subject: { type: "brand", id: fixture.brandId },
      timezone: provisioned.timezone,
      status: "active",
      corpora: []
    };
    const source = await createWorkspaceDataSource({
      workspace,
      userId: fixture.userId,
      input: {
        name: "Membership primary source",
        provider: "membership-invalidation-fixture",
        source_type: "social-listening",
        connection_method: "csv",
        scope: "primary_brand",
        entity_id: fixture.brandId
      }
    });
    await ingestWorkspaceDataSourceCsv({
      workspace,
      sourceId: source.id,
      userId: fixture.userId,
      contributedByStudyCorpusId: null,
      fileName: "membership-invalidation.csv",
      stream: csvStream()
    });
    const mentionId = (await pool.query<{ id: string }>(`
      SELECT id::text FROM mentions
      WHERE workspace_id = $1::uuid AND canonical_mention_id = id
    `, [workspace.id])).rows[0]?.id;
    assert.ok(mentionId);
    const readScope = await resolveSignalOperationalReadScopeV1(workspace, { mode: "governed" });
    const filter = normalizeSignalFilterV1({
      date_range: { start: "2026-04-05", end: "2026-04-05" },
      timezone: workspace.timezone,
      granularity: "day",
      dimensions: {}
    });
    const initialJob: SignalMaterializeJobDataV1 = {
      contract_version: "signal-materialization-v1",
      trigger: "ad_hoc",
      workspace_id: workspace.id,
      population_id: provisioned.population_id,
      population_version: provisioned.population_version,
      population_definition_hash: provisioned.population_definition_hash,
      metric_keys: ["conversation.volume"],
      filter
    };
    const initialMaterialization = await signalMaterializationJob({ data: initialJob } as never);
    assert.ok(Number(initialMaterialization.rows_written ?? 0) > 0);
    assert.equal(await servingCount(workspace, readScope, filter), 1);

    await pool.query(`
      UPDATE signal_mention_attributions
      SET review_status = 'rejected', approval_source = NULL,
          approved_by_user_id = NULL, approved_at = NULL, updated_at = now()
      WHERE workspace_id = $1::uuid AND mention_id = $2::uuid
        AND data_source_id = $3::uuid AND scope = 'primary_brand'
    `, [workspace.id, mentionId, source.id]);
    assert.equal(await activeMembershipCount(workspace.id), 0);
    const rejectedInvalidation = await latestMembershipInvalidation(
      workspace.id,
      mentionId
    );
    assert.equal(rejectedInvalidation.eligible_before, true);
    assert.equal(rejectedInvalidation.eligible_after, false);
    assert.ok(rejectedInvalidation.stale_materializations > 0);
    assert.equal(
      await servingCount(workspace, readScope, filter),
      0,
      "stale count=1 materializations must never be served after rejection"
    );
    const rejectedRefresh = await processInvalidation(
      rejectedInvalidation.id,
      signalInvalidationJob,
      signalMaterializationJob
    );
    assert.equal(await servingCount(workspace, readScope, filter), 0);

    await pool.query(`
      UPDATE signal_mention_attributions
      SET review_status = 'approved', approval_source = 'fixture_review',
          approved_by_user_id = $3::uuid, approved_at = now(), updated_at = now()
      WHERE workspace_id = $1::uuid AND mention_id = $2::uuid
        AND data_source_id = $4::uuid AND scope = 'primary_brand'
    `, [workspace.id, mentionId, fixture.userId, source.id]);
    assert.equal(await activeMembershipCount(workspace.id), 1);
    const approvedInvalidation = await latestMembershipInvalidation(
      workspace.id,
      mentionId
    );
    assert.equal(approvedInvalidation.eligible_before, false);
    assert.equal(approvedInvalidation.eligible_after, true);
    assert.equal(await servingCount(workspace, readScope, filter), 1);
    const approvedRefresh = await processInvalidation(
      approvedInvalidation.id,
      signalInvalidationJob,
      signalMaterializationJob
    );
    assert.equal(await servingCount(workspace, readScope, filter), 1);

    const finalCache = (await pool.query<{
      fresh_rows: number;
      stale_rows: number;
      observed_count: number;
    }>(`
      SELECT
        count(*) FILTER (
          WHERE materialization_state <> 'stale'
            AND (stale_after IS NULL OR stale_after > now())
        )::int AS fresh_rows,
        count(*) FILTER (
          WHERE materialization_state = 'stale'
            OR (stale_after IS NOT NULL AND stale_after <= now())
        )::int AS stale_rows,
        COALESCE(max(value) FILTER (
          WHERE metric_key = 'conversation.volume'
            AND materialization_state <> 'stale'
            AND (stale_after IS NULL OR stale_after > now())
        ), 0)::int AS observed_count
      FROM metric_materializations
      WHERE workspace_id = $1::uuid AND population_id = $2::uuid
        AND filters_hash = $3
    `, [workspace.id, provisioned.population_id, signalFiltersHashV1(filter)])).rows[0]!;
    assert.ok(finalCache.fresh_rows > 0);
    assert.equal(finalCache.observed_count, 1);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      transitions: {
        included_to_excluded: {
          membership: 0,
          invalidation_id: rejectedInvalidation.id,
          serving_after_transition: 0,
          refresh: rejectedRefresh
        },
        excluded_to_included: {
          membership: 1,
          invalidation_id: approvedInvalidation.id,
          serving_after_transition: 1,
          refresh: approvedRefresh
        }
      },
      cache: finalCache
    }, null, 2)}\n`);
  } finally {
    await pool.query("DELETE FROM brands WHERE id = $1::uuid", [fixture.brandId]).catch(() => undefined);
    await pool.query("DELETE FROM users WHERE id = $1::uuid", [fixture.userId]).catch(() => undefined);
    await pool.query("DELETE FROM organizations WHERE id = $1::uuid", [fixture.organizationId]).catch(() => undefined);
    await workerPool.end();
  }
}

async function activeMembershipCount(workspaceId: string) {
  const result = await pool.query<{ count: number }>(`
    SELECT count(*)::int AS count
    FROM signal_population_memberships
    WHERE workspace_id = $1::uuid
      AND membership_status = 'included' AND removed_at IS NULL
  `, [workspaceId]);
  return result.rows[0]?.count ?? 0;
}

async function latestMembershipInvalidation(
  workspaceId: string,
  mentionId: string
) {
  const result = await pool.query<{
    id: string;
    eligible_before: boolean;
    eligible_after: boolean;
    stale_materializations: number;
  }>(`
    SELECT invalidation.id::text,
      (invalidation.scope->>'eligible_before')::boolean AS eligible_before,
      (invalidation.scope->>'eligible_after')::boolean AS eligible_after,
      (SELECT count(*)::int FROM metric_materializations materialization
        WHERE materialization.workspace_id = invalidation.workspace_id
          AND materialization.population_id = invalidation.population_id
          AND (materialization.materialization_state = 'stale'
            OR materialization.stale_after <= now())) AS stale_materializations
    FROM signal_data_invalidations invalidation
    WHERE invalidation.workspace_id = $1::uuid
      AND invalidation.reason = 'operational_population_membership_changed'
      AND invalidation.scope->>'mention_id' = $2
    ORDER BY invalidation.created_at DESC, invalidation.id DESC
    LIMIT 1
  `, [workspaceId, mentionId]);
  assert.ok(result.rows[0]);
  return result.rows[0];
}

async function processInvalidation(
  invalidationId: string,
  invalidationJob: typeof import("../../../services/workers/src/workers/signal-refresh").signalInvalidationJob,
  materializationJob: typeof import("../../../services/workers/src/workers/signal-materialization").signalMaterializationJob
) {
  const jobs: SignalMaterializeJobDataV1[] = [];
  const invalidated = await invalidationJob({
    data: {
      contract_version: "signal-refresh-v1",
      invalidation_id: invalidationId
    },
    attemptsMade: 0,
    opts: { attempts: 3 }
  } as never, {
    enqueueMaterialization: async (data) => {
      jobs.push(data);
    }
  });
  assert.equal(jobs.length, 1);
  const materialized = await materializationJob({ data: jobs[0] } as never);
  return { invalidated, materialized };
}

async function servingCount(
  workspace: ResolvedSignalWorkspace,
  readScope: Awaited<ReturnType<typeof resolveSignalOperationalReadScopeV1>>,
  filter: ReturnType<typeof normalizeSignalFilterV1>
) {
  const payload = await loadSignalBrandMonitoringV1({
    workspace,
    readScope,
    filter,
    comparison: { mode: "none", date_range: null },
    isInternalUser: true
  });
  return payload.volume.current_value ?? 0;
}

function csvStream() {
  const csv = [
    "id,text,date,platform,language,sentiment score",
    `membership-${fixture.runId},Membership invalidation serving fixture,2026-04-05T12:00:00Z,X,es,0.6`
  ].join("\n");
  return new Blob([csv]).stream();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
