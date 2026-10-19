import assert from "node:assert/strict";

import type { ResolvedSignalWorkspace } from "../src/lib/data-os/signal-workspace";
import { resolveSignalOperationalReadScopeV1 } from "../src/lib/data-os/signal-operational-read-scope";
import { loadSignalWorkspaceHomeV1 } from "../src/lib/data-os/signal-workspace-home";
import {
  loadSignalFacetsV1,
  loadSignalMentionByIdV1,
  loadSignalMentionsV1
} from "../src/lib/data-os/signal-workspace-serving";
import { loadSignalTopicsNarrativesOverviewV1 } from "../src/lib/data-os/signal-topics-narratives-serving";
import {
  createWorkspaceDataSource,
  ingestWorkspaceDataSourceCsvProductV1
} from "../src/lib/data-os/workspace-ingestion";
import { loadSignalBrandMonitoringV1 } from "../src/lib/signal-v2/brand-monitoring";
import { getAdminBrandWorkspace } from "../src/lib/data/admin-workspace";
import { loadSignalClientSettingsV1 } from "../src/lib/data-os/signal-client-settings";
import { pool } from "../src/lib/db";
import { normalizeSignalFilterV1 } from "@noisia/query-engine";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (process.env.NOISIA_SIGNAL_DATA_PLANE_RUNTIME_SMOKE_APPROVED !== "true") {
  throw new Error("Set NOISIA_SIGNAL_DATA_PLANE_RUNTIME_SMOKE_APPROVED=true for a disposable local database.");
}
const parsed = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    || !/migration[_-]smoke/u.test(parsed.pathname)) {
  throw new Error("Runtime smoke only accepts the disposable local migration-smoke database.");
}

const runId = crypto.randomUUID();
const orgId = crypto.randomUUID();
const userId = crypto.randomUUID();
const brandId = crypto.randomUUID();
const competitorSeedId = crypto.randomUUID();
const competitorId = crypto.randomUUID();

async function main() {
  await pool.query(`
    INSERT INTO organizations (id, slug, legal_name, display_name, status)
    VALUES ($1::uuid, $2, 'Runtime Smoke Org', 'Runtime Smoke Org', 'active')
  `, [orgId, `runtime-org-${runId}`]);
  await pool.query(`
    INSERT INTO users (
      id, email, full_name, user_type, primary_role, organization_id, status
    ) VALUES (
      $1::uuid, $2, 'Runtime Smoke User', 'client', 'brand_manager', $3::uuid, 'active'
    )
  `, [userId, `runtime-${runId}@example.test`, orgId]);
  await pool.query(`
    INSERT INTO brands (
      id, organization_id, slug, name, display_name, countries, status
    ) VALUES (
      $1::uuid, $2::uuid, $3, 'Runtime Smoke Brand',
      'Runtime Smoke Brand', ARRAY['MX']::char(2)[], 'active'
    )
  `, [brandId, orgId, `runtime-brand-${runId}`]);
  const workspaceRow = await pool.query<{
    id: string;
    slug: string;
    timezone: string;
  }>(`
    SELECT id::text, slug, timezone
    FROM signal_workspaces WHERE brand_id = $1::uuid
  `, [brandId]);
  const persistedWorkspace = workspaceRow.rows[0];
  assert.ok(persistedWorkspace);
  const workspace: ResolvedSignalWorkspace = {
    contractVersion: "signal-backend-v1",
    id: persistedWorkspace.id,
    organizationId: orgId,
    slug: persistedWorkspace.slug,
    name: "Runtime Smoke Brand",
    subject: { type: "brand", id: brandId },
    timezone: persistedWorkspace.timezone,
    status: "active",
    corpora: []
  };

  const primary = await createWorkspaceDataSource({
    workspace,
    userId,
    input: {
      name: "Primary runtime source",
      provider: "runtime-fixture",
      source_type: "social-listening",
      connection_method: "csv",
      scope: "primary_brand",
      entity_id: brandId
    }
  });
  const first = await ingestWorkspaceDataSourceCsvProductV1({
    workspace,
    sourceId: primary.id,
    userId,
    contributedByStudyCorpusId: null,
    fileName: "runtime-primary-1.csv",
    stream: csvStream(),idempotencyKey: `runtime-primary-1-${runId}`
  });
  const firstReplay = await ingestWorkspaceDataSourceCsvProductV1({
    workspace,sourceId: primary.id,userId,
    contributedByStudyCorpusId: null,fileName: "runtime-primary-1.csv",
    stream: csvStream(),idempotencyKey: `runtime-primary-1-${runId}`
  });
  assert.equal(firstReplay.batchId,first.batchId);
  assert.equal(firstReplay.replayed,true);
  const second = await ingestWorkspaceDataSourceCsvProductV1({
    workspace,
    sourceId: primary.id,
    userId,
    contributedByStudyCorpusId: null,
    fileName: "runtime-primary-2.csv",
    stream: csvStream(),idempotencyKey: `runtime-primary-2-${runId}`
  });

  await pool.query(`
    INSERT INTO brand_seeds (
      id, canonical_name, aliases, detection_patterns, country, active
    ) VALUES ($1::uuid, $2, ARRAY[]::text[], ARRAY[$2]::text[], 'MX', true)
  `, [competitorSeedId, `Runtime Competitor ${runId}`]);
  await pool.query(`
    INSERT INTO competitors (id, brand_id, competitor_brand_seed_id, priority)
    VALUES ($1::uuid, $2::uuid, $3::uuid, 1)
  `, [competitorId, brandId, competitorSeedId]);
  const competitor = await createWorkspaceDataSource({
    workspace,
    userId,
    input: {
      name: "Competitor runtime source",
      provider: "runtime-fixture",
      source_type: "social-listening",
      connection_method: "csv",
      scope: "competitor",
      entity_id: competitorId
    }
  });
  const third = await ingestWorkspaceDataSourceCsvProductV1({
    workspace,
    sourceId: competitor.id,
    userId,
    contributedByStudyCorpusId: null,
    fileName: "runtime-competitor.csv",
    stream: csvStream(),idempotencyKey: `runtime-competitor-${runId}`
  });

  const observed = await pool.query<{
    canonical_mentions: number;
    imports: number;
    import_memberships: number;
    attributions: number;
    scopes: number;
    operational_population: number;
    studies: number;
  }>(`
    SELECT
      (SELECT count(*)::int FROM mentions
        WHERE workspace_id = $1::uuid AND canonical_mention_id = id) AS canonical_mentions,
      (SELECT count(*)::int FROM import_batches WHERE workspace_id = $1::uuid) AS imports,
      (SELECT count(*)::int FROM signal_mention_import_memberships
        WHERE workspace_id = $1::uuid) AS import_memberships,
      (SELECT count(*)::int FROM signal_mention_attributions
        WHERE workspace_id = $1::uuid) AS attributions,
      (SELECT count(DISTINCT scope)::int FROM signal_mention_attributions
        WHERE workspace_id = $1::uuid) AS scopes,
      (SELECT count(*)::int FROM signal_population_memberships
        WHERE workspace_id = $1::uuid
          AND membership_status = 'included' AND removed_at IS NULL) AS operational_population,
      (SELECT count(*)::int FROM study_corpora WHERE brand_id = $2::uuid) AS studies
  `, [workspace.id, brandId]);
  const counts = observed.rows[0];
  assert.deepEqual(counts, {
    canonical_mentions: 1,
    imports: 3,
    import_memberships: 3,
    attributions: 3,
    scopes: 2,
    operational_population: 1,
    studies: 0
  });
  assert.deepEqual(first.stats, {
    record_count: 1,
    included_count: 1,
    excluded_count: 0,
    duplicate_count: 0
  });
  assert.equal(second.stats.duplicate_count, 1);
  assert.equal(third.stats.duplicate_count, 1);
  const readScope = await resolveSignalOperationalReadScopeV1(workspace, { mode: "governed" });
  await assert.rejects(
    resolveSignalOperationalReadScopeV1({
      ...workspace,
      id: crypto.randomUUID()
    }, { mode: "governed" }),
    /no active governed operational population/u
  );
  const filter = normalizeSignalFilterV1({
    date_range: { start: "2026-03-01", end: "2026-03-01" },
    timezone: workspace.timezone,
    granularity: "day",
    dimensions: {}
  });
  const [home, monitoring, mentions, topicsNarratives, facets] = await Promise.all([
    loadSignalWorkspaceHomeV1(workspace, true, readScope),
    loadSignalBrandMonitoringV1({
      workspace,
      readScope,
      filter,
      comparison: { mode: "none", date_range: null },
      isInternalUser: true
    }),
    loadSignalMentionsV1({
      workspace,
      readScope,
      filter,
      limit: 100,
      isInternalUser: true
    }),
    loadSignalTopicsNarrativesOverviewV1({
      workspace,
      readScope,
      filter,
      isInternalUser: true
    }),
    loadSignalFacetsV1({ workspace, readScope, filter, isInternalUser: true })
  ]);
  assert.equal(readScope.visibleSource, "governed_population");
  assert.equal(readScope.legacyCorpus, null);
  assert.equal(home.corpus, null);
  assert.equal(home.read_scope?.visible_source, "governed_population");
  assert.equal(home.coverage.mentions, 1);
  assert.equal(monitoring.read_scope?.visible_source, "governed_population");
  assert.equal(monitoring.volume.current_value, 1);
  assert.equal(monitoring.coverage.mentions, 1);
  assert.equal(mentions.read_scope?.visible_source, "governed_population");
  assert.equal(mentions.total_count, 1);
  assert.equal(mentions.records.length, 1);
  assert.equal(topicsNarratives.read_scope?.visible_source, "governed_population");
  assert.equal(topicsNarratives.topics.coverage.included_mentions, 1);
  assert.equal(topicsNarratives.narratives.coverage.included_mentions, 1);
  assert.equal("corpus_scope" in facets.facets, false);
  await assert.rejects(
    loadSignalFacetsV1({
      workspace,
      readScope,
      filter: normalizeSignalFilterV1({
        ...filter,
        dimensions: { corpus_scope: ["brand"] }
      }),
      isInternalUser: true
    }),
    /cannot be selected by the client/u
  );
  const deepLink = await loadSignalMentionByIdV1({
    workspace,
    readScope,
    filter,
    mentionId: mentions.records[0]!.subject_id,
    isInternalUser: true
  });
  assert.equal(deepLink?.subject_id, mentions.records[0]!.subject_id);
  const [adminWorkspace, clientSettings] = await Promise.all([
    getAdminBrandWorkspace({ id: userId, userType: "noisia_internal" }, brandId),
    loadSignalClientSettingsV1(workspace)
  ]);
  assert.ok(adminWorkspace);
  assert.equal(adminWorkspace.summary.workspaceId, workspace.id);
  assert.equal(adminWorkspace.summary.governedMentions, 1);
  assert.equal(adminWorkspace.summary.activeSources, 2);
  assert.equal(adminWorkspace.compatibilityCorporaCount, 0);
  assert.equal(adminWorkspace.reports.length, 1);
  assert.equal(adminWorkspace.reports[0]?.reportKey, "triggers-barriers");
  assert.equal(clientSettings.data.active_sources, 2);
  assert.equal(clientSettings.data.visible_sources.length, 0);
  assert.equal(clientSettings.report.key, "triggers-barriers");
  assert.doesNotMatch(JSON.stringify(clientSettings), new RegExp(workspace.id, "u"));
  process.stdout.write(`${JSON.stringify({
    ok: true,
    workspace_id: workspace.id,
    first_import: first.stats,
    second_import: second.stats,
    cross_scope_import: third.stats,
    observed: counts,
    operational_serving: {
      mode: readScope.mode,
      visible_source: readScope.visibleSource,
      payload_read_scopes: {
        home: home.read_scope?.visible_source ?? null,
        brand_monitoring: monitoring.read_scope?.visible_source ?? null,
        mentions: mentions.read_scope?.visible_source ?? null,
        topics_narratives: topicsNarratives.read_scope?.visible_source ?? null
      },
      corpus: home.corpus,
      coverage: home.coverage,
      monitoring_denominator: monitoring.volume.current_value,
      mentions_total: mentions.total_count,
      topics_denominator: topicsNarratives.topics.coverage.included_mentions,
      narratives_denominator: topicsNarratives.narratives.coverage.included_mentions,
      deep_link_root: deepLink?.subject_id ?? null,
      invalid_governed_scope_fails_closed: true,
      arbitrary_client_scope_rejected: true,
      governed_facets: Object.keys(facets.facets).sort(),
      admin_workspace: {
        governed_mentions: adminWorkspace.summary.governedMentions,
        active_sources: adminWorkspace.summary.activeSources,
        compatibility_corpora: adminWorkspace.compatibilityCorporaCount,
        reports: adminWorkspace.reports.map((report) => report.reportKey)
      },
      client_settings: {
        active_sources: clientSettings.data.active_sources,
        visible_sources: clientSettings.data.visible_sources.length,
        report_key: clientSettings.report.key,
        exposes_internal_workspace_id: false
      }
    }
  }, null, 2)}\n`);
}

function csvStream() {
  const csv = [
    "id,text,date,platform,language,sentiment score",
    `runtime-shared-${runId},A governed canonical mention repeated across imports and scopes,2026-03-01T12:00:00Z,X,es,0.7`
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
