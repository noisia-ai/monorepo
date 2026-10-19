import assert from "node:assert/strict";

import {
  signalTopicsNarrativesOverviewContentHashV1,
  type SignalMaterializeJobDataV1,
  type SignalTopicsNarrativesOverviewV1
} from "@noisia/query-engine";

import type {
  ResolvedSignalWorkspace,
  SignalWorkspaceUser
} from "../src/lib/data-os/signal-workspace";
import {
  governedSignalOperationalReadScopeV1,
  resolveSignalOperationalReadScopeV1
} from "../src/lib/data-os/signal-operational-read-scope";
import {
  scheduleSignalBrandMonitoringShadowV1,
  scheduleSignalMentionsShadowV1,
  scheduleSignalTopicsNarrativesShadowV1
} from "../src/lib/data-os/signal-operational-module-shadow";
import { resolveSignalModuleServingScopeV1 } from "../src/lib/data-os/signal-module-serving-scope";
import { loadWorkspacePopulationShadowComparison } from "../src/lib/data-os/signal-workspace-population";
import {
  loadSignalTaxonomyEvidenceV1,
  loadSignalTopicsNarrativesOverviewV1
} from "../src/lib/data-os/signal-topics-narratives-serving";
import {
  loadSignalMentionByIdV1,
  loadSignalMentionsV1,
  signalJsonResponse
} from "../src/lib/data-os/signal-workspace-serving";
import { loadSignalBrandMonitoringV1 } from "../src/lib/signal-v2/brand-monitoring";
import { pool } from "../src/lib/db";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (process.env.NOISIA_SIGNAL_MODULE_SHADOW_SMOKE_APPROVED !== "true") {
  throw new Error("Set NOISIA_SIGNAL_MODULE_SHADOW_SMOKE_APPROVED=true for a disposable local database.");
}
const parsed = new URL(databaseUrl);
if (!(["localhost", "127.0.0.1", "::1"] as string[]).includes(parsed.hostname)
    || !/migration[_-]smoke/u.test(parsed.pathname)) {
  throw new Error("Module shadow smoke only accepts the disposable local migration-smoke database.");
}

let workerPool: { end(): Promise<void> } | null = null;

async function main() {
  const identity = await pool.query<{
    id: string;
    organization_id: string;
    slug: string;
    timezone: string;
    brand_id: string;
    name: string;
  }>(`
    SELECT
      workspace.id::text,
      workspace.organization_id::text,
      workspace.slug,
      workspace.timezone,
      brand.id::text AS brand_id,
      brand.display_name AS name
    FROM signal_workspaces workspace
    JOIN brands brand ON brand.id = workspace.brand_id
    WHERE brand.slug = 'brand-a'
    LIMIT 1
  `);
  const row = identity.rows[0];
  assert.ok(row);
  const requesterResult = await pool.query<{
    id: string;
    user_type: string;
    organization_id: string | null;
  }>(`
    SELECT id::text, user_type, organization_id::text
    FROM users
    WHERE status = 'active' AND user_type = 'noisia_internal'
    ORDER BY id
    LIMIT 1
  `);
  const requesterRow = requesterResult.rows[0];
  assert.ok(requesterRow, "module shadow smoke requires an active fixture operator");
  const requester: SignalWorkspaceUser = {
    id: requesterRow.id,
    userType: requesterRow.user_type,
    organizationId: requesterRow.organization_id
  };
  const corpora = await pool.query<{
    id: string;
    name: string | null;
    role: "operational" | "strategic" | "legacy";
    status: string;
    valid_from: string;
    methodology_slug: string | null;
  }>(`
    SELECT
      corpus.id::text,
      corpus.name,
      membership.role,
      corpus.status,
      membership.valid_from::text,
      methodology.slug AS methodology_slug
    FROM signal_workspace_corpora membership
    JOIN study_corpora corpus ON corpus.id = membership.study_corpus_id
    LEFT JOIN methodologies methodology ON methodology.id = corpus.methodology_id
    WHERE membership.workspace_id = $1::uuid
      AND membership.valid_to IS NULL
    ORDER BY membership.role, corpus.id
  `, [row.id]);
  const workspace: ResolvedSignalWorkspace = {
    contractVersion: "signal-backend-v1",
    id: row.id,
    organizationId: row.organization_id,
    slug: row.slug,
    name: row.name,
    subject: { type: "brand", id: row.brand_id },
    timezone: row.timezone,
    status: "active",
    corpora: corpora.rows.map((corpus) => ({
      id: corpus.id,
      name: corpus.name,
      role: corpus.role,
      status: corpus.status,
      validFrom: corpus.valid_from,
      methodologySlug: corpus.methodology_slug,
      outputId: null
    }))
  };
  const shadow = await loadWorkspacePopulationShadowComparison(workspace);
  assert.equal(shadow.comparison.comparison_kind, "population_membership");
  assert.equal(shadow.comparison.state, "exact");
  assert.equal(shadow.comparison.reconciled, true);
  assert.equal(
    shadow.module_serving_shadow.state,
    "correct_with_explained_legacy_differences"
  );

  const actualShadowStartedAt = new Date();
  const samplingToken = crypto.randomUUID();
  const [monitoringServingScope, mentionsServingScope, taxonomyServingScope] = await Promise.all([
    resolveSignalModuleServingScopeV1(workspace, "brand-monitoring", { mode: "shadow" }),
    resolveSignalModuleServingScopeV1(workspace, "mentions", { mode: "shadow" }),
    resolveSignalModuleServingScopeV1(workspace, "topics-narratives", { mode: "shadow" })
  ]);
  assert.ok([
    monitoringServingScope,
    mentionsServingScope,
    taxonomyServingScope
  ].every((scope) => scope.governed.state === "available"));
  const operationalFilter = shadow.module_serving_shadow.filter;
  const legacyMonitoring = await loadSignalBrandMonitoringV1({
    workspace,
    readScope: monitoringServingScope.readScope,
    filter: operationalFilter,
    isInternalUser: true
  });
  const legacyMentions = await loadSignalMentionsV1({
    workspace,
    readScope: mentionsServingScope.readScope,
    filter: operationalFilter,
    limit: 100,
    sort: { field: "published", direction: "desc" },
    isInternalUser: true
  });
  const taxonomyComparisonRange = legacyMonitoring.comparison_filter?.date_range ?? null;
  const legacyTopicsNarratives = await loadSignalTopicsNarrativesOverviewV1({
    workspace,
    readScope: taxonomyServingScope.readScope,
    filter: operationalFilter,
    comparisonRange: taxonomyComparisonRange,
    isInternalUser: true
  });
  const explicitLegacyScope = await resolveSignalOperationalReadScopeV1(workspace, {
    mode: "legacy"
  });
  const [explicitLegacyMonitoring, explicitLegacyMentions, explicitLegacyTaxonomy] = await Promise.all([
    loadSignalBrandMonitoringV1({
      workspace,
      readScope: explicitLegacyScope,
      filter: operationalFilter,
      isInternalUser: true
    }),
    loadSignalMentionsV1({
      workspace,
      readScope: explicitLegacyScope,
      filter: operationalFilter,
      limit: 100,
      sort: { field: "published", direction: "desc" },
      isInternalUser: true
    }),
    loadSignalTopicsNarrativesOverviewV1({
      workspace,
      readScope: explicitLegacyScope,
      filter: operationalFilter,
      comparisonRange: taxonomyComparisonRange,
      isInternalUser: true
    })
  ]);
  assert.deepEqual(
    semanticServingPayload(legacyMonitoring),
    semanticServingPayload(explicitLegacyMonitoring),
    "shadow must preserve the legacy Brand Monitoring payload"
  );
  assert.deepEqual(
    semanticServingPayload(legacyMentions),
    semanticServingPayload(explicitLegacyMentions),
    "shadow must preserve the legacy Mentions payload"
  );
  assert.deepEqual(
    semanticServingPayload(legacyTopicsNarratives),
    semanticServingPayload(explicitLegacyTaxonomy),
    "shadow must preserve the legacy Topics & Narratives payload"
  );
  const deferredTasks: Array<() => Promise<void>> = [];
  const registerAfter = (task: () => Promise<void>) => {
    deferredTasks.push(task);
  };
  const routeShadowOverheadStarted = performance.now();
  const scheduled = await Promise.all([
    scheduleSignalBrandMonitoringShadowV1({
      workspace,
      readScope: monitoringServingScope.readScope,
      servingScope: monitoringServingScope,
      filter: operationalFilter,
      requester,
      samplingToken,
      comparison: legacyMonitoring.comparison
    }, registerAfter),
    scheduleSignalMentionsShadowV1({
      workspace,
      readScope: mentionsServingScope.readScope,
      servingScope: mentionsServingScope,
      filter: operationalFilter,
      requester,
      samplingToken,
      request: {
        cursor: null,
        limit: 100,
        offset: 0,
        sort: { field: "published", direction: "desc" }
      }
    }, registerAfter),
    scheduleSignalTopicsNarrativesShadowV1({
      workspace,
      readScope: taxonomyServingScope.readScope,
      servingScope: taxonomyServingScope,
      filter: operationalFilter,
      requester,
      samplingToken,
      comparisonRange: taxonomyComparisonRange
    }, registerAfter)
  ]);
  const routeShadowOverheadMs = Math.round(performance.now() - routeShadowOverheadStarted);
  assert.equal(deferredTasks.length, 3);
  assert.ok(scheduled.every((item) => item.queued && item.request_id));
  const beforeDrain = await pool.query<{ pending: number; results: number }>(`
    SELECT
      (SELECT count(*)::int FROM signal_operational_shadow_requests
        WHERE workspace_id = $1::uuid AND created_at >= $2::timestamptz
          AND status = 'pending') AS pending,
      (SELECT count(*)::int FROM signal_operational_serving_shadow_results
        WHERE workspace_id = $1::uuid AND created_at >= $2::timestamptz) AS results
  `, [workspace.id, actualShadowStartedAt]);
  assert.deepEqual(beforeDrain.rows[0], { pending: 3, results: 0 });
  const shadowDrainStarted = performance.now();
  await Promise.all(deferredTasks.map((task) => task()));
  const shadowDrainDurationMs = Math.round(performance.now() - shadowDrainStarted);
  assert.ok(
    shadowDrainDurationMs > Math.max(...scheduled.map((item) => item.outbox_duration_ms)),
    "the heavy module comparison must execute after the visible route outbox write"
  );
  const persistedReaderShadow = await pool.query<{
    module: string;
    state: string;
    contract_violation_count: number;
    unexplained_count: number;
    governed_summary: Record<string, unknown>;
  }>(`
    SELECT DISTINCT ON (module) module, state, contract_violation_count,
      unexplained_count, governed_summary
    FROM signal_operational_serving_shadow_results
    WHERE workspace_id = $1::uuid AND created_at >= $2::timestamptz
    ORDER BY module, created_at DESC
  `, [workspace.id, actualShadowStartedAt]);
  assert.equal(persistedReaderShadow.rows.length, 3);
  assert.ok(persistedReaderShadow.rows.every((result) =>
    result.state === "correct_with_explained_legacy_differences"
      && result.contract_violation_count === 0
      && result.unexplained_count === 0
  ));
  assert.equal(shadow.module_serving_shadow.reconciled, true);
  assert.equal(shadow.module_serving_shadow.gate_passed, true);
  assert.equal(shadow.module_serving_shadow.parity_with_legacy, false);
  assert.equal(shadow.module_serving_shadow.governed_correct, true);
  assert.equal(shadow.module_serving_shadow.zero_unexplained_differences, true);
  assert.equal(
    shadow.module_serving_shadow.governed_contract?.primary_brand_contract,
    true
  );
  assert.equal(
    shadow.module_serving_shadow.governed_contract?.contract_violation_count,
    0
  );
  assert.deepEqual(shadow.module_serving_shadow.legacy_differences?.legacy_only_by_scope, {
    category: 1,
    reference: 1,
    unattributed: 1
  });
  assert.equal(shadow.module_serving_shadow.legacy_differences?.unexplained_count, 0);
  assert.deepEqual(shadow.module_serving_shadow.governed_module_checks, {
    brand_monitoring: true,
    mentions: true,
    topics_narratives: true
  });

  const monitoring = shadow.module_serving_shadow.brand_monitoring;
  const mentions = shadow.module_serving_shadow.mentions;
  const taxonomy = shadow.module_serving_shadow.topics_narratives;
  assert.ok(monitoring && mentions && taxonomy);
  assert.equal(monitoring.legacy.row_denominator, 110);
  assert.equal(monitoring.governed.row_denominator, 107);
  assert.equal(mentions.set_comparison, "sql_full_canonical_hash");
  assert.equal(mentions.legacy.total_count, 110);
  assert.equal(mentions.governed.total_count, 107);
  assert.equal(mentions.legacy.first_page_count, 100);
  assert.equal(mentions.legacy.second_page_count, 10);
  assert.equal(mentions.governed.first_page_count, 100);
  assert.equal(mentions.governed.second_page_count, 7);
  assert.equal(mentions.legacy.cursor_valid, true);
  assert.equal(mentions.governed.cursor_valid, true);
  assert.equal(mentions.legacy.next_cursor_present, true);
  assert.equal(mentions.governed.next_cursor_present, true);
  assert.equal(mentions.legacy.next_cursor_hash, mentions.governed.next_cursor_hash);
  assert.equal(mentions.legacy.first_result_id, mentions.governed.first_result_id);
  assert.equal(taxonomy.legacy.row_denominator, 110);
  assert.equal(taxonomy.governed.row_denominator, 107);
  assert.equal(taxonomy.legacy.topic_result_count, 1);
  assert.equal(taxonomy.governed.topic_result_count, 1);
  assert.equal(taxonomy.legacy.narrative_result_count, 1);
  assert.equal(taxonomy.governed.narrative_result_count, 1);
  assert.equal(taxonomy.legacy.resolved_alias_assignment_count, 1);
  assert.equal(taxonomy.governed.resolved_alias_assignment_count, 1);

  const aliasEvidence = await loadSignalTaxonomyEvidenceV1({
    workspace,
    readScope: governedSignalOperationalReadScopeV1(taxonomyServingScope.readScope),
    filter: shadow.module_serving_shadow.filter,
    kind: "topic",
    termKey: "module_topic",
    limit: 10,
    isInternalUser: true
  });
  assert.equal(aliasEvidence.records.length, 1);
  assert.equal(
    aliasEvidence.records[0]?.mention_id,
    "10000000-0000-4000-8000-000000000701"
  );
  const historicalAlias = await pool.query<{
    alias_id: string;
    canonical_id: string;
  }>(`
    SELECT alias.id::text AS alias_id,
      alias.canonical_mention_id::text AS canonical_id
    FROM mentions alias
    JOIN record_tags tag
      ON tag.subject_type = 'mention' AND tag.subject_id = alias.id
    WHERE alias.workspace_id = $1::uuid
      AND alias.id <> alias.canonical_mention_id
    ORDER BY alias.id
    LIMIT 1
  `, [workspace.id]);
  assert.ok(historicalAlias.rows[0]);
  const aliasDeepLink = await loadSignalMentionByIdV1({
    workspace,
    readScope: governedSignalOperationalReadScopeV1(mentionsServingScope.readScope),
    filter: shadow.module_serving_shadow.filter,
    mentionId: historicalAlias.rows[0]!.alias_id,
    isInternalUser: true
  });
  assert.equal(aliasDeepLink?.subject_id, historicalAlias.rows[0]!.canonical_id);

  const governedScope = governedSignalOperationalReadScopeV1(taxonomyServingScope.readScope);
  const etagEvidence = await exerciseTopicsNarrativesMembershipEtag({
    workspace,
    readScope: governedScope,
    filter: shadow.module_serving_shadow.filter,
    comparisonRange: taxonomyComparisonRange,
    mentionId: historicalAlias.rows[0]!.canonical_id
  });

  process.stdout.write(`${JSON.stringify({
    ok: true,
    population_shadow: shadow.comparison,
    module_serving_shadow: shadow.module_serving_shadow,
    alias_enrichment_evidence: {
      records: aliasEvidence.records.length,
      canonical_mention_id: aliasEvidence.records[0]?.mention_id ?? null,
      alias_deep_link_canonical_mention_id: aliasDeepLink?.subject_id ?? null
    },
    operational_reader_shadow: {
      read_mode: monitoringServingScope.readScope.mode,
      visible_source: monitoringServingScope.readScope.visibleSource,
      operational_pointer_followed: false,
      visible_payload_matches_explicit_legacy: true,
      results: persistedReaderShadow.rows,
      route_latency: {
        route_shadow_overhead_ms: routeShadowOverheadMs,
        outbox_write_ms: scheduled.map((item) => item.outbox_duration_ms),
        deferred_shadow_ms: shadowDrainDurationMs,
        pending_before_response_completion: beforeDrain.rows[0]?.pending ?? 0,
        shadow_results_before_drain: beforeDrain.rows[0]?.results ?? 0
      }
    },
    topics_narratives_membership_etag: etagEvidence
  }, null, 2)}\n`);
}

async function exerciseTopicsNarrativesMembershipEtag(args: {
  workspace: ResolvedSignalWorkspace;
  readScope: ReturnType<typeof governedSignalOperationalReadScopeV1>;
  filter: Parameters<typeof loadSignalTopicsNarrativesOverviewV1>[0]["filter"];
  comparisonRange: { start: string; end: string } | null;
  mentionId: string;
}) {
  const url = `https://studio.test/api/data-os/signal/${args.workspace.id}/topics-narratives`;
  const before = await loadSignalTopicsNarrativesOverviewV1({
    workspace: args.workspace,
    readScope: args.readScope,
    filter: args.filter,
    comparisonRange: args.comparisonRange,
    isInternalUser: true
  });
  assert.equal(before.topics.coverage.included_mentions, 107);
  assert.equal(before.narratives.coverage.included_mentions, 107);
  assert.equal(before.topics.terms.length, 1);
  assert.equal(before.narratives.terms.length, 1);
  const beforeResponse = taxonomyOverviewResponse(new Request(url), before);
  assert.equal(beforeResponse.status, 200);
  const beforeEtag = requiredEtag(beforeResponse);
  const beforeBody = await beforeResponse.json() as SignalTopicsNarrativesOverviewV1;
  assert.equal(beforeBody.topics.coverage.included_mentions, 107);

  const populationId = args.readScope.population?.id;
  assert.ok(populationId);
  const excluded = await pool.query(`
    UPDATE signal_population_memberships
    SET membership_status = 'excluded', removed_at = now(),
        membership_reason = 'etag_membership_fixture'
    WHERE population_id = $1::uuid AND workspace_id = $2::uuid
      AND mention_id = $3::uuid
      AND membership_status = 'included' AND removed_at IS NULL
  `, [populationId, args.workspace.id, args.mentionId]);
  assert.equal(excluded.rowCount, 1);

  const readThrough = await loadSignalTopicsNarrativesOverviewV1({
    workspace: args.workspace,
    readScope: args.readScope,
    filter: args.filter,
    comparisonRange: args.comparisonRange,
    isInternalUser: true
  });
  assert.equal(readThrough.topics.coverage.included_mentions, 106);
  assert.equal(readThrough.narratives.coverage.included_mentions, 106);
  assert.equal(readThrough.topics.terms.length, 0);
  assert.equal(readThrough.narratives.terms.length, 0);
  const staleValidatorResponse = taxonomyOverviewResponse(new Request(url, {
    headers: { "if-none-match": beforeEtag }
  }), readThrough);
  assert.equal(staleValidatorResponse.status, 200);
  const readThroughEtag = requiredEtag(staleValidatorResponse);
  assert.notEqual(readThroughEtag, beforeEtag);
  const readThroughBody = await staleValidatorResponse.json() as SignalTopicsNarrativesOverviewV1;
  assert.equal(readThroughBody.topics.coverage.included_mentions, 106);
  assert.equal(readThroughBody.topics.terms.length, 0);

  await processLatestMembershipInvalidation(args.workspace.id, args.mentionId);
  const rematerialized = await loadSignalTopicsNarrativesOverviewV1({
    workspace: args.workspace,
    readScope: args.readScope,
    filter: args.filter,
    comparisonRange: args.comparisonRange,
    isInternalUser: true
  });
  const rematerializedResponse = taxonomyOverviewResponse(new Request(url, {
    headers: { "if-none-match": beforeEtag }
  }), rematerialized);
  assert.equal(rematerializedResponse.status, 200);
  const rematerializedEtag = requiredEtag(rematerializedResponse);
  assert.equal(rematerializedEtag, readThroughEtag);
  assert.equal(rematerialized.topics.coverage.included_mentions, 106);
  assert.equal(rematerialized.topics.terms.length, 0);
  assert.equal(taxonomyOverviewResponse(new Request(url, {
    headers: { "if-none-match": rematerializedEtag }
  }), rematerialized).status, 304);

  const restored = await pool.query(`
    UPDATE signal_population_memberships
    SET membership_status = 'included', removed_at = NULL,
        membership_reason = 'etag_membership_fixture_restored', effective_at = now()
    WHERE population_id = $1::uuid AND workspace_id = $2::uuid
      AND mention_id = $3::uuid
      AND (membership_status <> 'included' OR removed_at IS NOT NULL)
  `, [populationId, args.workspace.id, args.mentionId]);
  assert.equal(restored.rowCount, 1);
  await processLatestMembershipInvalidation(args.workspace.id, args.mentionId);
  const restoredPayload = await loadSignalTopicsNarrativesOverviewV1({
    workspace: args.workspace,
    readScope: args.readScope,
    filter: args.filter,
    comparisonRange: args.comparisonRange,
    isInternalUser: true
  });
  const restoredEtag = requiredEtag(taxonomyOverviewResponse(new Request(url), restoredPayload));
  assert.equal(restoredPayload.topics.coverage.included_mentions, 107);
  assert.equal(restoredPayload.topics.terms.length, 1);
  assert.equal(restoredEtag, beforeEtag);

  return {
    before: { denominator: 107, terms: 2, etag: beforeEtag },
    read_through: { denominator: 106, terms: 0, status_with_previous_etag: 200, etag: readThroughEtag },
    rematerialized: { denominator: 106, terms: 0, status_with_previous_etag: 200, etag: rematerializedEtag },
    restored: { denominator: 107, terms: 2, etag: restoredEtag }
  };
}

function taxonomyOverviewResponse(
  request: Request,
  payload: SignalTopicsNarrativesOverviewV1
) {
  return signalJsonResponse(request, payload, {
    etagSeed: signalTopicsNarrativesOverviewContentHashV1(payload),
    state: payload.state
  });
}

function requiredEtag(response: Response) {
  const etag = response.headers.get("etag");
  assert.ok(etag);
  return etag;
}

async function processLatestMembershipInvalidation(
  workspaceId: string,
  mentionId: string
) {
  const invalidation = (await pool.query<{ id: string }>(`
    SELECT id::text
    FROM signal_data_invalidations
    WHERE workspace_id = $1::uuid
      AND reason = 'operational_population_membership_changed'
      AND scope->>'mention_id' = $2
      AND status = 'pending'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `, [workspaceId, mentionId])).rows[0];
  assert.ok(invalidation);
  const { signalInvalidationJob } = await import(
    "../../../services/workers/src/workers/signal-refresh"
  );
  const { signalMaterializationJob } = await import(
    "../../../services/workers/src/workers/signal-materialization"
  );
  workerPool ??= (await import("../../../services/workers/src/db/client")).pool;
  const jobs: SignalMaterializeJobDataV1[] = [];
  await signalInvalidationJob({
    data: {
      contract_version: "signal-refresh-v1",
      invalidation_id: invalidation.id
    },
    attemptsMade: 0,
    opts: { attempts: 3 }
  } as never, {
    enqueueMaterialization: async (data) => {
      jobs.push(data);
    }
  });
  assert.equal(jobs.length, 1);
  const result = await signalMaterializationJob({ data: jobs[0] } as never);
  assert.equal(result.state, "fresh");
}

function semanticServingPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semanticServingPayload);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => ![
        "read_scope",
        "computed_at",
        "generated_at",
        "refreshed_at"
      ].includes(key))
      .map(([key, nested]) => [key, semanticServingPayload(nested)])
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
    await workerPool?.end();
  });
