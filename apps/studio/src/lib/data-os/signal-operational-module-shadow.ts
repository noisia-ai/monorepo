import { createHash } from "node:crypto";
import type {
  SignalComparisonV1,
  SignalFilterV1,
  SignalTopicsNarrativesOverviewV1
} from "@noisia/query-engine";
import {
  decodeSignalDrillDownCursorV1,
  normalizeSignalFilterV1,
  resolveSignalComparisonV1,
  signalFiltersHashV1,
  SignalBackendContractError
} from "@noisia/query-engine";

import { pool } from "@/lib/db";
import {
  governedSignalOperationalReadScopeV1,
  type SignalOperationalReadScopeV1
} from "@/lib/data-os/signal-operational-read-scope";
import {
  loadSignalModuleShadowAuthorityV1,
  resolveSignalModuleServingScopeV1,
  type SignalModuleServingScopeV1,
  type SignalModuleShadowAuthorityV1
} from "@/lib/data-os/signal-module-serving-scope";
import {
  parseSignalModuleShadowAuthorityV1,
  parseSignalModuleShadowRequesterAuthorityV1,
  sameSignalModuleShadowAuthorityV1,
  signalModuleShadowAuthorityHashV1,
  signalModuleShadowRequesterAuthorityV1,
  signalServingModuleKeyForShadowV1,
  withSignalModuleShadowAuthorityV1,
  withSignalModuleShadowRequesterAuthorityV1,
  type SignalOperationalShadowModuleV1,
  type SignalModuleShadowRequesterAuthorityV1
} from "@/lib/data-os/signal-module-shadow-authority";
import { loadSignalModuleShadowRequesterV1 } from "@/lib/data-os/signal-module-shadow-requester";
import {
  loadGovernedPopulationContract,
  loadGovernedMentionPageBaseline,
  loadLegacyDifferenceExplanation
} from "@/lib/data-os/signal-workspace-population";
import type {
  ResolvedSignalWorkspace,
  SignalWorkspaceUser
} from "@/lib/data-os/signal-workspace";
import { resolveSignalWorkspaceForUser } from "@/lib/data-os/signal-workspace";
import {
  loadSignalMentionByIdV1,
  loadSignalMentionsV1,
  type SignalMentionsPayloadV1
} from "@/lib/data-os/signal-workspace-serving";
import {
  loadSignalTaxonomyEvidenceV1,
  loadSignalTaxonomyLineageV1,
  loadSignalTaxonomyTermDetailV1,
  loadSignalTopicsNarrativesOverviewV1
} from "@/lib/data-os/signal-topics-narratives-serving";
import {
  loadSignalBrandMonitoringV1,
  type SignalBrandMonitoringV1
} from "@/lib/signal-v2/brand-monitoring";

type ShadowModule = SignalOperationalShadowModuleV1;

type CommonShadowArgs = {
  workspace: ResolvedSignalWorkspace;
  readScope: SignalOperationalReadScopeV1;
  filter: SignalFilterV1;
  isInternalUser: boolean;
  samplingToken?: string;
  shadowAuthority?: SignalModuleShadowAuthorityV1;
};

type CommonShadowScheduleArgs = Omit<CommonShadowArgs, "isInternalUser"> & {
  servingScope: SignalModuleServingScopeV1;
  requester: SignalWorkspaceUser;
};

type SignalMentionsShadowRequestV1 = {
  metricKey?: string;
  cursor?: string | null;
  limit: number;
  offset: number;
  sort: {
    field: "published" | "platform" | "conversation_role" | "engagement";
    direction: "asc" | "desc";
  };
};

type SignalOperationalShadowScheduleResultV1 = {
  queued: boolean;
  request_id: string | null;
  outbox_duration_ms: number;
  persistence_state: "not_applicable" | "persisted" | "failed";
};

type AfterResponseRegistrar = (task: () => Promise<void>) => void;

class SignalShadowResultPersistenceError extends Error {
  constructor(readonly persistenceErrorName: string) {
    super("signal_shadow_result_persistence_failed");
    this.name = "SignalShadowResultPersistenceError";
  }
}

export function scheduleSignalBrandMonitoringShadowV1(
  args: CommonShadowScheduleArgs & { comparison: SignalComparisonV1 },
  registerAfter: AfterResponseRegistrar
) {
  return scheduleModuleShadow(
    args,
    "brand_monitoring",
    { comparison: args.comparison },
    registerAfter
  );
}

export function scheduleSignalMentionsShadowV1(
  args: CommonShadowScheduleArgs & { request: SignalMentionsShadowRequestV1 },
  registerAfter: AfterResponseRegistrar
) {
  return scheduleModuleShadow(args, "mentions", args.request, registerAfter);
}

export function scheduleSignalTopicsNarrativesShadowV1(
  args: CommonShadowScheduleArgs & {
    comparisonRange?: { start: string; end: string } | null;
  },
  registerAfter: AfterResponseRegistrar
) {
  return scheduleModuleShadow(
    args,
    "topics_narratives",
    { comparisonRange: args.comparisonRange ?? null },
    registerAfter
  );
}

async function scheduleModuleShadow(
  args: CommonShadowScheduleArgs,
  module: ShadowModule,
  request: Record<string, unknown>,
  registerAfter: AfterResponseRegistrar
): Promise<SignalOperationalShadowScheduleResultV1> {
  const started = performance.now();
  if (args.readScope.mode !== "shadow"
    || args.servingScope.rollout_mode !== "shadow"
    || args.servingScope.workspace_id !== args.workspace.id
    || signalServingModuleKeyForShadowV1(module) !== args.servingScope.module_key
    || args.servingScope.governed.state !== "available"
    || args.servingScope.governed.descriptor.resolution_source !== "governed-binding") {
    return {
      queued: false,
      request_id: null,
      outbox_duration_ms: Math.round(performance.now() - started),
      persistence_state: "not_applicable"
    };
  }
  const governedDescriptor = args.servingScope.governed.descriptor;
  if (!governedDescriptor.population
    || args.readScope.population?.id !== governedDescriptor.population.population_id
    || args.readScope.population.version !== governedDescriptor.population.population_version
    || args.readScope.population.definition_hash
      !== governedDescriptor.population.definition_hash
    || args.readScope.legacyCorpus?.id
      !== args.servingScope.readScope.legacyCorpus?.id) {
    return {
      queued: false,
      request_id: null,
      outbox_duration_ms: Math.round(performance.now() - started),
      persistence_state: "not_applicable"
    };
  }

  let authority: SignalModuleShadowAuthorityV1;
  let requesterAuthority: SignalModuleShadowRequesterAuthorityV1;
  try {
    authority = await loadSignalModuleShadowAuthorityV1({
      scope: args.servingScope
    });
    requesterAuthority = signalModuleShadowRequesterAuthorityV1({
      userId: args.requester.id,
      organizationId: args.requester.organizationId,
      isInternalUser: args.requester.userType === "noisia_internal"
    });
  } catch (error) {
    console.warn("Signal operational shadow authority could not be captured.", {
      module,
      workspace_id: args.workspace.id,
      failure_kind: "authority_capture_failure",
      error_name: shadowErrorName(error)
    });
    return {
      queued: false,
      request_id: null,
      outbox_duration_ms: Math.round(performance.now() - started),
      persistence_state: "not_applicable"
    };
  }
  const population = authority.population;
  const filtersHash = signalFiltersHashV1(args.filter);
  const samplingWindow = args.samplingToken ?? new Date().toISOString().slice(0, 13);
  const dedupeKey = hashValues([
    args.workspace.id,
    module,
    filtersHash,
    signalModuleShadowAuthorityHashV1(authority),
    stableJson(requesterAuthority),
    stableJson(request),
    samplingWindow
  ]);
  const durableRequest = withSignalModuleShadowRequesterAuthorityV1(
    withSignalModuleShadowAuthorityV1(request, authority),
    requesterAuthority
  );

  try {
    const inserted = await pool.query<{ id: string; status: string }>(`
      INSERT INTO signal_operational_shadow_requests (
        workspace_id, population_id, legacy_study_corpus_id, module,
        filters, filters_hash, request, dedupe_key,
        population_version, population_definition_hash
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4,
        $5::jsonb, $6, $7::jsonb, $8,
        $9::int, $10
      )
      ON CONFLICT (dedupe_key) DO UPDATE SET
        status = CASE
          WHEN signal_operational_shadow_requests.status = 'failed'
            AND signal_operational_shadow_requests.attempt < 3 THEN 'pending'
          WHEN signal_operational_shadow_requests.status = 'processing'
            AND signal_operational_shadow_requests.locked_at < now() - interval '5 minutes'
            AND signal_operational_shadow_requests.attempt < 3 THEN 'pending'
          ELSE signal_operational_shadow_requests.status
        END,
        available_at = CASE
          WHEN signal_operational_shadow_requests.status IN ('failed', 'processing')
            THEN now()
          ELSE signal_operational_shadow_requests.available_at
        END,
        updated_at = now()
      RETURNING id::text, status
    `, [
      args.workspace.id,
      population.id,
      args.readScope.legacyCorpus?.id ?? null,
      module,
      JSON.stringify(args.filter),
      filtersHash,
      JSON.stringify(durableRequest),
      dedupeKey,
      population.version,
      population.definition_hash
    ]);
    const row = inserted.rows[0];
    if (!row) throw new Error("signal_shadow_outbox_insert_missing");
    const shouldRun = row.status === "pending";
    registerAfter(async () => {
      await drainSignalOperationalModuleShadowOutboxV1(args.workspace.id, row.id);
    });
    return {
      queued: shouldRun,
      request_id: row.id,
      outbox_duration_ms: Math.round(performance.now() - started),
      persistence_state: "persisted"
    };
  } catch (error) {
    console.error("Signal operational shadow request could not be persisted.", {
      module,
      workspace_id: args.workspace.id,
      failure_kind: "outbox_persistence_failure",
      error_name: error instanceof Error ? error.name : "unknown"
    });
    return {
      queued: false,
      request_id: null,
      outbox_duration_ms: Math.round(performance.now() - started),
      persistence_state: "failed"
    };
  }
}

export async function drainSignalOperationalModuleShadowOutboxV1(
  workspaceId: string,
  preferredRequestId?: string
) {
  await pool.query(`
    UPDATE signal_operational_shadow_requests
    SET status = CASE WHEN attempt >= 3 THEN 'dead_letter' ELSE 'failed' END,
        available_at = now(), locked_at = NULL,
        error_summary = jsonb_build_object(
          'failure_kind', 'processing_lease_expired',
          'error_name', 'stale_processing_lease'
        ),
        updated_at = now()
    WHERE workspace_id = $1::uuid
      AND status = 'processing'
      AND locked_at < now() - interval '5 minutes'
  `, [workspaceId]);
  const pending = await pool.query<{ id: string }>(`
    SELECT id::text
    FROM signal_operational_shadow_requests
    WHERE workspace_id = $1::uuid
      AND status IN ('pending', 'failed')
      AND attempt < 3
      AND available_at <= now()
    ORDER BY CASE WHEN id = $2::uuid THEN 0 ELSE 1 END,
      available_at, created_at, id
    LIMIT 3
  `, [workspaceId, preferredRequestId ?? null]);
  const results = [];
  for (const request of pending.rows) {
    results.push(await processSignalOperationalModuleShadowRequestV1(request.id));
  }
  return results;
}

export async function processSignalOperationalModuleShadowRequestV1(
  requestId: string
) {
  const claimed = await pool.query<{
    id: string;
    workspace_id: string;
    population_id: string;
    legacy_study_corpus_id: string | null;
    module: ShadowModule;
    filters: unknown;
    request: Record<string, unknown>;
    population_version: number;
    population_definition_hash: string;
    attempt: number;
  }>(`
    UPDATE signal_operational_shadow_requests shadow_request
    SET status = 'processing', attempt = attempt + 1,
        locked_at = now(), error_summary = '{}'::jsonb, updated_at = now()
    WHERE shadow_request.id = $1::uuid
      AND shadow_request.status IN ('pending', 'failed')
      AND shadow_request.attempt < 3
      AND shadow_request.available_at <= now()
    RETURNING id::text, workspace_id::text, population_id::text,
      legacy_study_corpus_id::text, module, filters, request,
      population_version, population_definition_hash,
      attempt
  `, [requestId]);
  const row = claimed.rows[0];
  if (!row) return { state: "reconciliation_only" as const };

  try {
    let storedAuthority: SignalModuleShadowAuthorityV1;
    let requesterAuthority: SignalModuleShadowRequesterAuthorityV1;
    try {
      storedAuthority = parseSignalModuleShadowAuthorityV1(row.request);
      requesterAuthority = parseSignalModuleShadowRequesterAuthorityV1(row.request);
    } catch {
      await markShadowRequest(
        row.id,
        "superseded",
        "signal_shadow_durable_authority_invalid"
      );
      return { state: "superseded" as const };
    }
    if (storedAuthority.workspace_id !== row.workspace_id
      || storedAuthority.module_key !== signalServingModuleKeyForShadowV1(row.module)
      || storedAuthority.population.id !== row.population_id
      || storedAuthority.population.version !== row.population_version
      || storedAuthority.population.definition_hash !== row.population_definition_hash) {
      throw new Error("signal_shadow_stored_authority_mismatch");
    }
    const requester = await loadSignalModuleShadowRequesterV1(
      requesterAuthority,
      pool
    );
    if (!requester) {
      await markShadowRequest(
        row.id,
        "superseded",
        "signal_shadow_requester_not_authorized"
      );
      return { state: "superseded" as const };
    }
    const workspace = await resolveSignalWorkspaceForUser(
      requester.user,
      { workspaceId: row.workspace_id }
    );
    if (!workspace) {
      await markShadowRequest(
        row.id,
        "superseded",
        "signal_shadow_workspace_access_revoked"
      );
      return { state: "superseded" as const };
    }
    let servingScope: SignalModuleServingScopeV1;
    try {
      servingScope = await resolveSignalModuleServingScopeV1(
        workspace,
        signalServingModuleKeyForShadowV1(row.module),
        { mode: "shadow" }
      );
    } catch (error) {
      throw new Error(
        "signal_shadow_governed_resolution_dependency_failure",
        { cause: error }
      );
    }
    if (servingScope.governed.state !== "available") {
      if (servingScope.governed.reason === "governed_module_scope_not_available") {
        throw new Error("signal_shadow_governed_resolution_dependency_failure");
      }
      await markShadowRequest(
        row.id,
        "superseded",
        servingScope.governed.reason
      );
      return { state: "superseded" as const };
    }
    let currentAuthority: SignalModuleShadowAuthorityV1;
    try {
      currentAuthority = await loadSignalModuleShadowAuthorityV1({
        scope: servingScope
      });
    } catch (error) {
      if (!(error instanceof SignalBackendContractError)) throw error;
      await markShadowRequest(
        row.id,
        "superseded",
        typeof error.details.reason === "string"
          ? error.details.reason
          : "signal_shadow_current_authority_not_available"
      );
      return { state: "superseded" as const };
    }
    if (!sameSignalModuleShadowAuthorityV1(storedAuthority, currentAuthority)
      || servingScope.readScope.legacyCorpus?.id !== row.legacy_study_corpus_id) {
      await markShadowRequest(
        row.id,
        "superseded",
        "signal_shadow_authority_superseded"
      );
      return { state: "superseded" as const };
    }
    const readScope = servingScope.readScope;
    const filter = normalizeSignalFilterV1(row.filters);
    if (row.module === "brand_monitoring") {
      const storedComparison = recordValue(row.request.comparison);
      const comparison = resolveSignalComparisonV1({
        filter,
        mode: storedComparison?.mode,
        custom_date_range: storedComparison?.date_range
      });
      const legacy = await loadSignalBrandMonitoringV1({
        workspace,
        readScope,
        filter,
        comparison,
        isInternalUser: requester.isInternalUser
      });
      await recordSignalBrandMonitoringShadowV1({
        workspace,
        readScope,
        filter,
        isInternalUser: requester.isInternalUser,
        shadowAuthority: currentAuthority,
        legacy
      });
    } else if (row.module === "mentions") {
      const request = parseMentionsShadowRequest(row.request);
      const legacy = await loadSignalMentionsV1({
        workspace,
        readScope,
        filter,
        ...(request.metricKey ? { metricKey: request.metricKey } : {}),
        cursor: request.cursor,
        limit: request.limit,
        offset: request.offset,
        sort: request.sort,
        isInternalUser: requester.isInternalUser
      });
      await recordSignalMentionsShadowV1({
        workspace,
        readScope,
        filter,
        isInternalUser: requester.isInternalUser,
        shadowAuthority: currentAuthority,
        legacy,
        request
      });
    } else {
      const comparisonRange = parseOptionalDateRange(row.request.comparisonRange);
      const legacy = await loadSignalTopicsNarrativesOverviewV1({
        workspace,
        readScope,
        filter,
        comparisonRange,
        isInternalUser: requester.isInternalUser
      });
      await recordSignalTopicsNarrativesShadowV1({
        workspace,
        readScope,
        filter,
        isInternalUser: requester.isInternalUser,
        shadowAuthority: currentAuthority,
        legacy,
        comparisonRange
      });
    }
    await markShadowRequest(row.id, "completed");
    return { state: "completed" as const };
  } catch (error) {
    const terminal = row.attempt >= 3;
    const failureKind = error instanceof SignalShadowResultPersistenceError
      ? "result_persistence_failure"
      : "processing_or_dependency_failure";
    const errorName = shadowErrorName(error);
    try {
      await pool.query(`
        UPDATE signal_operational_shadow_requests
        SET status = $2,
            available_at = CASE WHEN $2 = 'failed' THEN now() + interval '30 seconds' ELSE available_at END,
            error_summary = jsonb_build_object(
              'failure_kind', $3::text,
              'error_name', $4::text
            ),
            locked_at = NULL, updated_at = now()
        WHERE id = $1::uuid AND status = 'processing'
      `, [
        row.id,
        terminal ? "dead_letter" : "failed",
        failureKind,
        errorName
      ]);
    } catch (statusPersistenceError) {
      console.error("Signal operational shadow failure state could not be persisted.", {
        module: row.module,
        workspace_id: row.workspace_id,
        failure_kind: "outbox_status_persistence_failure",
        original_failure_kind: failureKind,
        error_name: shadowErrorName(statusPersistenceError)
      });
      throw statusPersistenceError;
    }
    console.warn("Signal operational shadow outbox processing failed.", {
      module: row.module,
      workspace_id: row.workspace_id,
      failure_kind: failureKind,
      error_name: errorName
    });
    return { state: terminal ? "dead_letter" as const : "failed" as const };
  }
}

async function markShadowRequest(
  requestId: string,
  status: "completed" | "superseded",
  reason: string | null = null
) {
  await pool.query(`
    UPDATE signal_operational_shadow_requests
    SET status = $2, completed_at = now(), locked_at = NULL,
        error_summary = CASE
          WHEN $3::text IS NULL THEN '{}'::jsonb
          ELSE jsonb_build_object(
            'failure_kind', 'authorization_or_authority_superseded',
            'error_name', $3::text
          )
        END,
        updated_at = now()
    WHERE id = $1::uuid AND status = 'processing'
  `, [requestId, status, reason]);
}

export async function recordSignalBrandMonitoringShadowV1(
  args: CommonShadowArgs & { legacy: SignalBrandMonitoringV1 }
) {
  return recordModuleShadow(args, "brand_monitoring", async (governedScope, baseline) => {
    const governed = await loadSignalBrandMonitoringV1({
      workspace: args.workspace,
      readScope: governedScope,
      filter: args.filter,
      comparison: args.legacy.comparison,
      isInternalUser: args.isInternalUser
    });
    const previousBaseline = governed.comparison_filter
      ? await loadGovernedPopulationContract({
          workspace: args.workspace,
          populationId: governedScope.population!.id,
          filter: governed.comparison_filter
        })
      : null;
    const governedSummary = summarizeBrandMonitoring(governed);
    const legacySummary = summarizeBrandMonitoring(args.legacy);
    return {
      governedSummary,
      legacySummary,
      correct: governedSummary.denominator === baseline.filtered_count
        && governedSummary.volume_series_hash === baseline.filled_series_hash
        && governedSummary.coverage_mentions === baseline.active_memberships
        && governedSummary.conversation_series_hash === baseline.conversation_series_hash
        && sameCounts(governedSummary.sentiment_counts, baseline.sentiment_counts)
        && sameCounts(governedSummary.platform_counts, baseline.platform_counts)
        && sameCounts(governedSummary.emotion_counts, baseline.emotion_counts)
        && sameCounts(governedSummary.topic_counts, baseline.topic_counts)
        && sameCounts(governedSummary.narrative_counts, baseline.narrative_counts)
        && (previousBaseline === null
          ? governedSummary.comparison_series_hash === hashValues([])
          : governedSummary.comparison_series_hash === previousBaseline.filled_series_hash
            && sameCounts(
              governedSummary.previous_sentiment_counts,
              previousBaseline.sentiment_counts
            ))
    };
  });
}

export async function recordSignalMentionsShadowV1(
  args: CommonShadowArgs & {
    legacy: SignalMentionsPayloadV1;
    request: SignalMentionsShadowRequestV1;
  }
) {
  return recordModuleShadow(args, "mentions", async (governedScope, baseline) => {
    const governedPage = await loadSignalMentionsV1({
      workspace: args.workspace,
      readScope: governedScope,
      filter: args.filter,
      ...(args.request.metricKey ? { metricKey: args.request.metricKey } : {}),
      cursor: args.request.cursor,
      limit: args.request.limit,
      offset: args.request.offset,
      sort: args.request.sort,
      isInternalUser: args.isInternalUser
    });
    const first = await loadSignalMentionsV1({
      workspace: args.workspace,
      readScope: governedScope,
      filter: args.filter,
      limit: 100,
      isInternalUser: args.isInternalUser
    });
    const [pageBaseline, firstPageBaseline] = await Promise.all([
      loadGovernedMentionPageBaseline({
        workspace: args.workspace,
        populationId: governedScope.population!.id,
        filter: args.filter,
        limit: args.request.limit,
        offset: args.request.offset,
        sort: args.request.sort,
        cursor: args.request.cursor
          ? decodeSignalDrillDownCursorV1(args.request.cursor).sort
          : null
      }),
      loadGovernedMentionPageBaseline({
        workspace: args.workspace,
        populationId: governedScope.population!.id,
        filter: args.filter,
        limit: 100,
        offset: 0,
        sort: { field: "published", direction: "desc" },
        cursor: null
      })
    ]);
    const firstId = governedPage.records[0]?.subject_id ?? first.records[0]?.subject_id ?? null;
    const detail = firstId
      ? await loadSignalMentionByIdV1({
          workspace: args.workspace,
          readScope: governedScope,
          filter: args.filter,
          mentionId: firstId,
          isInternalUser: args.isInternalUser
        })
      : null;
    const requestedPageIds = governedPage.records.map((record) => record.subject_id);
    const firstPageIds = first.records.map((record) => record.subject_id);
    const governedSummary = {
      total_count: first.total_count,
      canonical_ids_hash: baseline.canonical_ids_hash,
      full_set_validation: "sql_canonical_hash",
      adapter_pages_sampled: args.request.cursor ? 2 : 1,
      first_cursor_present: first.page.next_cursor !== null,
      detail_resolved_to_root: firstId === null || detail?.subject_id === firstId,
      sample_duplicate_count:
        firstPageIds.length - new Set(firstPageIds).size
        + requestedPageIds.length - new Set(requestedPageIds).size,
      requested_page_count: requestedPageIds.length,
      requested_page_hash: hashValues(requestedPageIds),
      requested_page_first_id: requestedPageIds[0] ?? null,
      requested_page_last_id: requestedPageIds.at(-1) ?? null,
      requested_page_total: governedPage.total_count,
      requested_page_has_next: governedPage.page.next_cursor !== null
        || governedPage.page.next_offset !== null
    };
    return {
      governedSummary,
      legacySummary: {
        total_count: args.legacy.total_count,
        first_result_present: Boolean(args.legacy.records[0]),
        first_cursor_present: args.legacy.page.next_cursor !== null
      },
      correct: governedSummary.total_count === baseline.filtered_count
        && governedSummary.canonical_ids_hash === baseline.canonical_ids_hash
        && governedSummary.sample_duplicate_count === 0
        && governedSummary.detail_resolved_to_root
        && equalValues(
          firstPageIds,
          firstPageBaseline.ids
        )
        && governedSummary.requested_page_total === pageBaseline.total_count
        && equalValues(requestedPageIds, pageBaseline.ids)
        && governedSummary.requested_page_has_next === pageBaseline.has_next
    };
  });
}

export async function recordSignalTopicsNarrativesShadowV1(
  args: CommonShadowArgs & {
    legacy: SignalTopicsNarrativesOverviewV1;
    comparisonRange?: { start: string; end: string } | null;
  }
) {
  return recordModuleShadow(args, "topics_narratives", async (governedScope, baseline) => {
    const governed = await loadSignalTopicsNarrativesOverviewV1({
      workspace: args.workspace,
      readScope: governedScope,
      filter: args.filter,
      comparisonRange: args.comparisonRange,
      isInternalUser: args.isInternalUser
    });
    const comparisonBaseline = args.comparisonRange
      ? await loadGovernedPopulationContract({
          workspace: args.workspace,
          populationId: governedScope.population!.id,
          filter: { ...args.filter, date_range: args.comparisonRange }
        })
      : null;
    const selected = governed.topics.terms[0]
      ? { kind: "topic" as const, termKey: governed.topics.terms[0].term_key }
      : governed.narratives.terms[0]
        ? { kind: "narrative" as const, termKey: governed.narratives.terms[0].term_key }
        : null;
    const [detail, evidence, lineage] = selected
      ? await Promise.all([
          loadSignalTaxonomyTermDetailV1({
            workspace: args.workspace,
            readScope: governedScope,
            filter: args.filter,
            kind: selected.kind,
            termKey: selected.termKey,
            isInternalUser: args.isInternalUser
          }),
          loadSignalTaxonomyEvidenceV1({
            workspace: args.workspace,
            readScope: governedScope,
            filter: args.filter,
            kind: selected.kind,
            termKey: selected.termKey,
            limit: 100,
            isInternalUser: args.isInternalUser
          }),
          loadSignalTaxonomyLineageV1({
            workspace: args.workspace,
            readScope: governedScope,
            filter: args.filter,
            kind: selected.kind,
            termKey: selected.termKey,
            isInternalUser: args.isInternalUser
          })
        ])
      : [null, null, null] as const;
    const nextEvidence = selected && evidence?.page.next_cursor
      ? await loadSignalTaxonomyEvidenceV1({
          workspace: args.workspace,
          readScope: governedScope,
          filter: args.filter,
          kind: selected.kind,
          termKey: selected.termKey,
          cursor: evidence.page.next_cursor,
          limit: 100,
          isInternalUser: args.isInternalUser
        })
      : null;
    const topicAssignments = governed.topics.terms.reduce((sum, term) => sum + term.mention_count, 0);
    const narrativeAssignments = governed.narratives.terms.reduce((sum, term) => sum + term.mention_count, 0);
    const evidenceIds = [
      ...(evidence?.records.map((record) => record.mention_id) ?? []),
      ...(nextEvidence?.records.map((record) => record.mention_id) ?? [])
    ];
    const governedSummary = {
      topic_denominator: governed.topics.coverage.included_mentions,
      narrative_denominator: governed.narratives.coverage.included_mentions,
      topic_assignment_count: topicAssignments,
      narrative_assignment_count: narrativeAssignments,
      topic_series_hash: hashTaxonomySeries(governed.topics.series),
      narrative_series_hash: hashTaxonomySeries(governed.narratives.series),
      detail_term_key: detail?.term.term_key ?? null,
      detail_denominator: detail?.term.denominator ?? null,
      evidence_total: evidence?.page.total_count ?? 0,
      evidence_duplicate_count: evidenceIds.length - new Set(evidenceIds).size,
      evidence_cursor_valid: evidence?.page.next_cursor
        ? nextEvidence !== null && nextEvidence.records.every((record) =>
            !(evidence?.records.some((firstRecord) => firstRecord.mention_id === record.mention_id) ?? false)
          )
        : true,
      lineage_source_mentions: lineage?.source_summary.mention_count ?? 0,
      alias_assignment_resolved: baseline.resolved_alias_assignment_count > 0
        ? topicAssignments + narrativeAssignments > 0
        : true,
      topic_comparison_counts: termComparisonCounts(governed.topics.terms),
      narrative_comparison_counts: termComparisonCounts(governed.narratives.terms)
    };
    return {
      governedSummary,
      legacySummary: {
        topic_denominator: args.legacy.topics.coverage.included_mentions,
        narrative_denominator: args.legacy.narratives.coverage.included_mentions,
        topic_terms: args.legacy.topics.terms.length,
        narrative_terms: args.legacy.narratives.terms.length
      },
      correct: governedSummary.topic_denominator === baseline.filtered_count
        && governedSummary.narrative_denominator === baseline.filtered_count
        && topicAssignments === baseline.topic_result_count
        && narrativeAssignments === baseline.narrative_result_count
        && governedSummary.evidence_duplicate_count === 0
        && governedSummary.evidence_cursor_valid
        && governedSummary.alias_assignment_resolved
        && (comparisonBaseline === null
          || sameCounts(
            governedSummary.topic_comparison_counts,
            comparisonBaseline.topic_counts
          ) && sameCounts(
            governedSummary.narrative_comparison_counts,
            comparisonBaseline.narrative_counts
          ))
    };
  });
}

async function recordModuleShadow(
  args: CommonShadowArgs,
  module: ShadowModule,
  execute: (
    governedScope: SignalOperationalReadScopeV1,
    baseline: Awaited<ReturnType<typeof loadGovernedPopulationContract>>
  ) => Promise<{
    governedSummary: Record<string, unknown>;
    legacySummary: Record<string, unknown>;
    correct: boolean;
  }>
) {
  if (args.readScope.mode !== "shadow" || !args.readScope.population) return null;
  const started = performance.now();
  const population = args.readScope.population;
  let result: {
    state: "exact" | "correct_with_explained_legacy_differences" | "failed";
    correct: boolean;
    contractViolationCount: number;
    unexplainedCount: number;
    differences: Record<string, number>;
    governedSummary: Record<string, unknown>;
    baselineSummary: Record<string, unknown>;
    legacySummary: Record<string, unknown>;
    evaluationState: "evaluated" | "execution_failed";
  };
  try {
    const governedScope = governedSignalOperationalReadScopeV1(args.readScope);
    const [baseline, differences] = await Promise.all([
      loadGovernedPopulationContract({
        workspace: args.workspace,
        populationId: population.id,
        filter: args.filter
      }),
      args.readScope.legacyCorpus
        ? loadLegacyDifferenceExplanation({
            workspace: args.workspace,
            legacyCorpusId: args.readScope.legacyCorpus.id,
            populationId: population.id,
            filter: args.filter
          })
        : Promise.resolve({
            legacy_only_count: 0,
            governed_only_count: 0,
            explained_legacy_count: 0,
            unexplained_count: 0,
            legacy_only_by_scope: {},
            governed_only_explanation: "workspace_owned_not_present_in_legacy_corpus" as const
          })
    ]);
    const moduleResult = await execute(governedScope, baseline);
    const contractValid = baseline.primary_brand_contract
      && baseline.contract_violation_count === 0;
    const correct = contractValid
      && differences.unexplained_count === 0
      && moduleResult.correct;
    const state = correct
      ? differences.legacy_only_count > 0 || differences.governed_only_count > 0
        ? "correct_with_explained_legacy_differences" as const
        : "exact" as const
      : "failed" as const;
    result = {
      state,
      correct,
      contractViolationCount: baseline.contract_violation_count,
      unexplainedCount: differences.unexplained_count,
      differences: differences.legacy_only_by_scope,
      governedSummary: moduleResult.governedSummary,
      baselineSummary: baseline,
      legacySummary: moduleResult.legacySummary,
      evaluationState: "evaluated"
    };
  } catch (error) {
    const errorName = shadowErrorName(error);
    result = {
      state: "failed",
      correct: false,
      // The parity dimensions were not evaluated. These zero values are never
      // interpreted as a passing gate because `evaluation_state` is explicit
      // and the row state is failed; importantly, they are not fabricated
      // semantic violations.
      contractViolationCount: 0,
      unexplainedCount: 0,
      differences: {},
      governedSummary: {
        execution_failure: {
          failure_kind: "evaluation_or_dependency_failure",
          error_name: errorName
        }
      },
      baselineSummary: { evaluation_state: "not_completed" },
      legacySummary: { evaluation_state: "not_completed" },
      evaluationState: "execution_failed"
    };
    console.warn("Signal operational module shadow evaluation failed.", {
      module,
      workspace_id: args.workspace.id,
      failure_kind: "evaluation_or_dependency_failure",
      error_name: errorName
    });
  }
  // Persistence is intentionally outside the evaluation catch. A result that
  // cannot be recorded is an infrastructure failure and must retry through the
  // durable outbox instead of being reported as a completed parity failure.
  await persistShadow({
    args,
    module,
    state: result.state,
    contractViolationCount: result.contractViolationCount,
    unexplainedCount: result.unexplainedCount,
    differences: result.differences,
    governedSummary: result.governedSummary,
    baselineSummary: result.baselineSummary,
    legacySummary: result.legacySummary,
    evaluationState: result.evaluationState,
    durationMs: Math.round(performance.now() - started)
  });
  return { state: result.state, correct: result.correct };
}

async function persistShadow(input: {
  args: CommonShadowArgs;
  module: ShadowModule;
  state: "exact" | "correct_with_explained_legacy_differences" | "failed";
  contractViolationCount: number;
  unexplainedCount: number;
  differences: Record<string, number>;
  governedSummary: Record<string, unknown>;
  baselineSummary: Record<string, unknown>;
  legacySummary: Record<string, unknown>;
  evaluationState: "evaluated" | "execution_failed";
  durationMs: number;
}) {
  const population = input.args.readScope.population!;
  const governedSummary = input.args.shadowAuthority
    ? {
      ...input.governedSummary,
      shadow_execution: {
        evaluation_state: input.evaluationState,
        persistence_state: "persisted"
      },
      shadow_authority: {
          identity_hash: signalModuleShadowAuthorityHashV1(input.args.shadowAuthority),
          module_key: input.args.shadowAuthority.module_key,
          view_key: input.args.shadowAuthority.view_key,
          binding_version: input.args.shadowAuthority.binding.version,
          policy_version: input.args.shadowAuthority.policy.version,
          population_version: input.args.shadowAuthority.population.version
        }
      }
    : {
        ...input.governedSummary,
        shadow_execution: {
          evaluation_state: input.evaluationState,
          persistence_state: "persisted"
        }
      };
  try {
    await pool.query(`
      INSERT INTO signal_operational_serving_shadow_results (
        workspace_id, population_id, legacy_study_corpus_id, module,
        filters_hash, population_version, population_definition_hash,
        state, contract_violation_count, unexplained_count,
        legacy_differences_by_scope, governed_summary, baseline_summary,
        legacy_summary, duration_ms
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7,
        $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15
      )
    `, [
      input.args.workspace.id,
      population.id,
      input.args.readScope.legacyCorpus?.id ?? null,
      input.module,
      hashFilter(input.args.filter),
      population.version,
      population.definition_hash,
      input.state,
      input.contractViolationCount,
      input.unexplainedCount,
      JSON.stringify(input.differences),
      JSON.stringify(governedSummary),
      JSON.stringify(input.baselineSummary),
      JSON.stringify(input.legacySummary),
      input.durationMs
    ]);
  } catch (error) {
    console.error("Signal operational module shadow result persistence failed.", {
      module: input.module,
      workspace_id: input.args.workspace.id,
      failure_kind: "result_persistence_failure",
      error_name: error instanceof Error ? error.name : "unknown"
    });
    throw new SignalShadowResultPersistenceError(
      error instanceof Error ? error.name : "unknown"
    );
  }
}

function summarizeBrandMonitoring(payload: SignalBrandMonitoringV1) {
  return {
    denominator: payload.volume.current_value ?? 0,
    coverage_mentions: payload.coverage.mentions,
    volume_series_hash: hashValues(payload.volume.points.map((point) =>
      `${point.period_start}:${point.value ?? 0}`
    )),
    comparison_series_hash: hashValues(payload.volume.previous_points.map((point) =>
      `${point.period_start}:${point.value ?? 0}`
    )),
    sentiment_counts: bucketCounts(payload.sentiment.buckets),
    previous_sentiment_counts: bucketCounts(payload.sentiment.previous_buckets),
    platform_counts: bucketCounts(payload.platforms.buckets),
    emotion_counts: bucketCounts(payload.emotions.buckets),
    topic_counts: bucketCounts(payload.topics.buckets),
    narrative_counts: bucketCounts(payload.narratives.buckets),
    conversation_series_hash: hashValues(payload.conversation_structure.points.map((point) =>
      `${point.period_start}:${point.mentions}:${point.conversations}:${point.root_posts}:${point.comments}`
        + `:${point.sentiment.positive}:${point.sentiment.neutral}:${point.sentiment.negative}`
        + `:${point.sentiment.classified}`
    ))
  };
}

function hashTaxonomySeries(series: Array<{ period_start: string; mention_count: number; denominator: number }>) {
  return hashValues(series.map((point) =>
    `${point.period_start}:${point.mention_count}:${point.denominator}`
  ));
}

function hashFilter(filter: SignalFilterV1) {
  return signalFiltersHashV1(filter);
}

function hashValues(values: string[]) {
  return `sha256:${createHash("sha256").update(values.join(","), "utf8").digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value) ?? "null";
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
    .join(",")}}`;
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseMentionsShadowRequest(
  value: Record<string, unknown>
): SignalMentionsShadowRequestV1 {
  const limit = Number(value.limit);
  const offset = Number(value.offset);
  const sort = recordValue(value.sort);
  const field = sort?.field;
  const direction = sort?.direction;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("signal_shadow_mentions_limit_invalid");
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) {
    throw new Error("signal_shadow_mentions_offset_invalid");
  }
  if (!["published", "platform", "conversation_role", "engagement"].includes(String(field))) {
    throw new Error("signal_shadow_mentions_sort_invalid");
  }
  if (!["asc", "desc"].includes(String(direction))) {
    throw new Error("signal_shadow_mentions_direction_invalid");
  }
  if (value.cursor !== undefined && value.cursor !== null && typeof value.cursor !== "string") {
    throw new Error("signal_shadow_mentions_cursor_invalid");
  }
  if (value.metricKey !== undefined && typeof value.metricKey !== "string") {
    throw new Error("signal_shadow_mentions_metric_invalid");
  }
  return {
    ...(typeof value.metricKey === "string" ? { metricKey: value.metricKey } : {}),
    cursor: typeof value.cursor === "string" ? value.cursor : null,
    limit,
    offset,
    sort: {
      field: String(field) as SignalMentionsShadowRequestV1["sort"]["field"],
      direction: String(direction) as SignalMentionsShadowRequestV1["sort"]["direction"]
    }
  };
}

function parseOptionalDateRange(value: unknown) {
  if (value === null || value === undefined) return null;
  const range = recordValue(value);
  if (typeof range?.start !== "string" || typeof range.end !== "string") {
    throw new Error("signal_shadow_comparison_range_invalid");
  }
  const normalized = normalizeSignalFilterV1({
    date_range: { start: range.start, end: range.end },
    timezone: "UTC",
    granularity: "day",
    dimensions: {}
  });
  return normalized.date_range;
}

function bucketCounts(
  buckets: Array<{ key: string; sample_size: number }>
): Record<string, number> {
  return Object.fromEntries(buckets.map((bucket) => [bucket.key, bucket.sample_size]));
}

function sameCounts(left: Record<string, number>, right: Record<string, number>) {
  return JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort());
}

function equalValues(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function shadowErrorName(error: unknown) {
  if (error instanceof SignalShadowResultPersistenceError) {
    return error.persistenceErrorName;
  }
  if (error instanceof SignalBackendContractError
    && typeof error.details.reason === "string") {
    return error.details.reason;
  }
  if (!(error instanceof Error)) return "unknown";
  return /^signal_[a-z0-9_]+$/u.test(error.message)
    ? error.message
    : error.name;
}

function termComparisonCounts(
  terms: Array<{ term_key: string; comparison_mention_count: number | null }>
) {
  return Object.fromEntries(terms
    .filter((term) => (term.comparison_mention_count ?? 0) > 0)
    .map((term) => [term.term_key, term.comparison_mention_count!])) as Record<string, number>;
}
