import type { SignalBrandPolicyQueryable } from "@/lib/data-os/signal-governed-brand-policy";
import {
  SIGNAL_SEMANTIC_CONTEXT_ELEMENT_KINDS,
  SignalSemanticContextPackError,
  loadSignalSemanticContextGenerationV1,
  loadSignalSemanticContextReadinessV1,
  type SignalSemanticContextElementKindV1
} from "@/lib/data-os/signal-semantic-context-pack";
import type {
  ResolvedSignalWorkspace,
  SignalWorkspaceUser
} from "@/lib/data-os/signal-workspace";

const PAGE_SIZES = [20, 40] as const;
const DISPOSITIONS = ["pending", "approved", "rejected", "merged"] as const;
const EVIDENCE_RELATIONS = ["supports", "limits", "contradicts"] as const;
const LOCALE_FILTERS = ["all", "explicit", "unassigned", "needs_review"] as const;
const EVIDENCE_FILTERS = [
  "all",
  "needs_review",
  "one_source_only",
  "supports_only",
  "has_limits",
  "has_contradictions"
] as const;
const DUPLICATE_FILTERS = ["all", "exact", "display"] as const;
const KEY_PATTERN = /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u;
const SCOPE_PATTERN = /^[a-z0-9]+(?:[_:-][a-z0-9]+)*$/u;
const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Z]{2})?$/u;
const MARKET_PATTERN = /^[A-Z]{2}$/u;
const PREVIEW_LIMIT = 720;

type Disposition = (typeof DISPOSITIONS)[number];
type EvidenceRelation = (typeof EVIDENCE_RELATIONS)[number];
type LocaleFilter = (typeof LOCALE_FILTERS)[number];
type EvidenceFilter = (typeof EVIDENCE_FILTERS)[number];
type DuplicateFilter = (typeof DUPLICATE_FILTERS)[number];

export type SignalSemanticContextReviewFiltersV1 = {
  search: string;
  disposition: Disposition | null;
  element_kind: SignalSemanticContextElementKindV1 | null;
  scope: string | null;
  locale: LocaleFilter;
  evidence: EvidenceFilter;
  duplicate: DuplicateFilter;
  evidence_relation: EvidenceRelation | null;
  page_size: (typeof PAGE_SIZES)[number];
  cursor: string | null;
};

type GenerationRow = {
  id: string;
  generation_key: string;
  generation_version: number;
  brand_os_profile_id: string;
  primary_locale: string;
  locale_variants: string[];
  markets: string[];
  timezone: string;
};

type ReviewElementRow = {
  id?: string;
  element_key: string;
  element_version: number;
  element_kind: SignalSemanticContextElementKindV1;
  canonical_key: string;
  display_text: string;
  scope: string | null;
  entity_type: string | null;
  locale: string | null;
  relation_kind: string | null;
  relation_target_key: string | null;
  disposition: Disposition;
  origin_kind: string;
  proposed_at: string | Date;
  decided_at: string | Date | null;
  source_ref_count: number;
  distinct_source_count: number;
  supports_count: number;
  limits_count: number;
  contradicts_count: number;
  exact_duplicate_count: number;
  display_duplicate_count: number;
};

type PageQueryRow = {
  total: number;
  items: ReviewElementRow[];
  kind_counts: Record<string, number>;
  scope_counts: Record<string, number>;
  disposition_counts: Record<string, number>;
};

type EvidenceProjectionRow = {
  source_type: string;
  relation_type: EvidenceRelation;
  position: number;
  source_title: string | null;
  source_kind: string | null;
  section_label: string | null;
  source_context: string | null;
  source_metadata: unknown;
  resolved: boolean;
  current: boolean;
};

type ReviewAnnotationProjectionRow = {
  annotation_key: string;
  annotation_version: number;
  annotation_type: "uncertain" | "needs_more_context" | "near_duplicate"
    | "locale_unresolved" | "competitive_unit_unresolved";
  state: "open" | "resolved";
  resolution: "merged" | "kept_distinct" | "context_sufficient" | "not_supported"
    | "governed_locale" | "global" | "canonical_unit" | "not_applicable" | null;
  subject_element_key: string;
  reason_code: string;
  rationale: string;
  created_at: string | Date;
  related_elements: Array<{
    element_key: string;
    element_kind: string;
    display_text: string;
  }>;
};

type ReviewMergeProjectionRow = {
  role: "source" | "target";
  source_element_key: string;
  target_element_key: string;
  reason_code: string;
  rationale: string;
  created_at: string | Date;
};

export type SignalSemanticContextEvidenceProjectionV1 = {
  relation: EvidenceRelation;
  source_type: string;
  source_kind: string;
  source_title: string;
  section_label: string;
  source_context: {
    label: "context_supplied_to_model";
    preview: string | null;
    truncated: boolean;
    redacted: boolean;
    pinpoint_citation: false;
  };
  applicability: {
    locales: string[];
    markets: string[];
    state: "explicit" | "not_declared";
  };
  generation_state: "validated_at_generation";
  current_state: "current" | "inactive" | "unavailable";
  unavailable_reason: "source_unavailable" | "context_not_available" | null;
};

export function parseSignalSemanticContextReviewFiltersV1(
  searchParams: URLSearchParams
): SignalSemanticContextReviewFiltersV1 {
  const allowed = new Set([
    "search",
    "disposition",
    "element_kind",
    "scope",
    "locale",
    "evidence",
    "duplicate",
    "evidence_relation",
    "page_size",
    "cursor"
  ]);
  for (const key of searchParams.keys()) {
    if (!allowed.has(key)) throw new SignalSemanticContextPackError("semantic_context_review_filter_invalid", 422);
  }
  const search = (searchParams.get("search") ?? "").normalize("NFKC").trim();
  if (search.length > 120) throw new SignalSemanticContextPackError("semantic_context_review_filter_invalid", 422);
  const disposition = closedValue(searchParams.get("disposition"), DISPOSITIONS);
  const elementKind = closedValue(searchParams.get("element_kind"), SIGNAL_SEMANTIC_CONTEXT_ELEMENT_KINDS);
  const locale = closedValue(searchParams.get("locale"), LOCALE_FILTERS) ?? "all";
  const evidence = closedValue(searchParams.get("evidence"), EVIDENCE_FILTERS) ?? "all";
  const duplicate = closedValue(searchParams.get("duplicate"), DUPLICATE_FILTERS) ?? "all";
  const evidenceRelation = closedValue(searchParams.get("evidence_relation"), EVIDENCE_RELATIONS);
  const rawScope = searchParams.get("scope")?.trim() || null;
  if (rawScope && (!SCOPE_PATTERN.test(rawScope) || rawScope.length > 80)) {
    throw new SignalSemanticContextPackError("semantic_context_review_filter_invalid", 422);
  }
  const rawPageSize = searchParams.get("page_size");
  const pageSize = rawPageSize === null ? 20 : Number(rawPageSize);
  if (!PAGE_SIZES.includes(pageSize as (typeof PAGE_SIZES)[number])) {
    throw new SignalSemanticContextPackError("semantic_context_review_filter_invalid", 422);
  }
  const cursor = searchParams.get("cursor")?.trim() || null;
  if (cursor && cursor.length > 600) throw new SignalSemanticContextPackError("semantic_context_review_cursor_invalid", 422);
  return {
    search,
    disposition,
    element_kind: elementKind,
    scope: rawScope,
    locale,
    evidence,
    duplicate,
    evidence_relation: evidenceRelation,
    page_size: pageSize as (typeof PAGE_SIZES)[number],
    cursor
  };
}

export async function loadSignalSemanticContextReviewPageV1(args: {
  queryable: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  generationKey: string;
  filters: SignalSemanticContextReviewFiltersV1;
}) {
  assertReviewAuthority(args.workspace, args.actor);
  const generation = await loadReviewGeneration(args.queryable, args.workspace.id, args.generationKey);
  const cursorScope = reviewCursorScope(generation.generation_key, args.filters);
  const after = decodeCursor(args.filters.cursor, cursorScope);
  const params: unknown[] = [generation.id];
  const where: string[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (args.filters.search) {
    const value = `%${escapeLike(args.filters.search)}%`;
    const parameter = bind(value);
    where.push(`(element.display_text ILIKE ${parameter} ESCAPE '\\'
      OR element.canonical_key ILIKE ${parameter} ESCAPE '\\'
      OR element.element_key ILIKE ${parameter} ESCAPE '\\')`);
  }
  if (args.filters.disposition) where.push(`element.disposition=${bind(args.filters.disposition)}`);
  if (args.filters.element_kind) where.push(`element.element_kind=${bind(args.filters.element_kind)}`);
  if (args.filters.scope) where.push(`element.scope=${bind(args.filters.scope)}`);
  if (args.filters.locale === "explicit") where.push("element.locale IS NOT NULL");
  if (args.filters.locale === "unassigned") where.push("element.locale IS NULL");
  if (args.filters.locale === "needs_review") {
    const variants = bind(generation.locale_variants);
    where.push(`(element.locale IS NULL OR NOT(element.locale=ANY(${variants}::text[])))`);
  }
  if (args.filters.evidence === "one_source_only") where.push("element.distinct_source_count=1");
  if (args.filters.evidence === "supports_only") {
    where.push("element.supports_count=element.source_ref_count AND element.source_ref_count>0");
  }
  if (args.filters.evidence === "has_limits") where.push("element.limits_count>0");
  if (args.filters.evidence === "has_contradictions") where.push("element.contradicts_count>0");
  if (args.filters.evidence === "needs_review") {
    where.push(`(element.distinct_source_count=1 OR
      (element.supports_count=element.source_ref_count AND element.source_ref_count>0)
      OR element.limits_count>0 OR element.contradicts_count>0)`);
  }
  if (args.filters.duplicate === "exact") where.push("element.exact_duplicate_count>1");
  if (args.filters.duplicate === "display") where.push("element.display_duplicate_count>1");
  if (args.filters.evidence_relation === "supports") where.push("element.supports_count>0");
  if (args.filters.evidence_relation === "limits") where.push("element.limits_count>0");
  if (args.filters.evidence_relation === "contradicts") where.push("element.contradicts_count>0");
  const afterClause = after ? `WHERE element.element_key>${bind(after)}` : "";
  const limit = bind(args.filters.page_size + 1);
  const eligibleWhere = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const result = await args.queryable.query<PageQueryRow>(`${reviewElementsCte}
    ,eligible AS (SELECT * FROM review_elements element ${eligibleWhere})
    SELECT
      (SELECT count(*)::int FROM eligible) total,
      COALESCE((SELECT jsonb_agg(to_jsonb(page_row) ORDER BY page_row.element_key)
        FROM (SELECT * FROM eligible element ${afterClause}
          ORDER BY element.element_key LIMIT ${limit}) page_row),'[]'::jsonb) items,
      COALESCE((SELECT jsonb_object_agg(element_kind,count) FROM (
        SELECT element_kind,count(*)::int count FROM review_elements GROUP BY element_kind
        ORDER BY element_kind) value),'{}'::jsonb) kind_counts,
      COALESCE((SELECT jsonb_object_agg(scope_key,count) FROM (
        SELECT COALESCE(scope,'not_applicable') scope_key,count(*)::int count
        FROM review_elements GROUP BY COALESCE(scope,'not_applicable') ORDER BY scope_key
      ) value),'{}'::jsonb) scope_counts,
      COALESCE((SELECT jsonb_object_agg(disposition,count) FROM (
        SELECT disposition,count(*)::int count FROM review_elements GROUP BY disposition
        ORDER BY disposition) value),'{}'::jsonb) disposition_counts`, params);
  const row = result.rows[0] ?? { total: 0, items: [], kind_counts: {}, scope_counts: {}, disposition_counts: {} };
  const pageRows = row.items.slice(0, args.filters.page_size);
  const nextRow = row.items.length > args.filters.page_size ? pageRows.at(-1) : null;
  return {
    contract_version: "signal-semantic-context-review-page-v1" as const,
    generation: publicReviewGeneration(generation),
    total: Number(row.total),
    page_size: args.filters.page_size,
    next_cursor: nextRow ? encodeCursor(nextRow.element_key, cursorScope) : null,
    elements: pageRows.map((element) => publicReviewElement(element, generation)),
    facets: {
      element_kinds: numericRecord(row.kind_counts),
      scopes: numericRecord(row.scope_counts),
      dispositions: numericRecord(row.disposition_counts)
    },
    authority: { source: "server_owned", attention_signals_authoritative: false }
  };
}

export async function loadSignalSemanticContextReviewDetailV1(args: {
  queryable: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  generationKey: string;
  elementKey: string;
}) {
  assertReviewAuthority(args.workspace, args.actor);
  if (!KEY_PATTERN.test(args.elementKey) || args.elementKey.length > 160) {
    throw new SignalSemanticContextPackError("semantic_context_review_element_not_found", 404);
  }
  const generation = await loadReviewGeneration(args.queryable, args.workspace.id, args.generationKey);
  const elementResult = await args.queryable.query<ReviewElementRow>(`${reviewElementsCte}
    SELECT * FROM review_elements element WHERE element.element_key=$2 LIMIT 1`, [
      generation.id,
      args.elementKey
    ]);
  const element = elementResult.rows[0];
  if (!element) throw new SignalSemanticContextPackError("semantic_context_review_element_not_found", 404);
  const evidence = await args.queryable.query<EvidenceProjectionRow>(evidenceProjectionSql, [
    generation.id,
    element.element_key,
    args.workspace.organizationId,
    args.workspace.subject.id,
    generation.brand_os_profile_id
  ]);
  const annotations = await args.queryable.query<ReviewAnnotationProjectionRow>(`
    SELECT annotation.annotation_key,annotation.annotation_version,annotation.annotation_type,
      annotation.state,annotation.resolution,subject.element_key subject_element_key,
      annotation.reason_code,annotation.rationale,annotation.created_at,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'element_key',related_element.element_key,
        'element_kind',related_element.element_kind,
        'display_text',related_element.display_text) ORDER BY related.position)
        FROM unnest(annotation.related_element_ids) WITH ORDINALITY related(id,position)
        JOIN signal_semantic_context_element_versions related_element ON related_element.id=related.id
          AND related_element.generation_id=annotation.generation_id),'[]'::jsonb) related_elements
    FROM signal_semantic_context_review_annotations annotation
    JOIN signal_semantic_context_element_versions subject ON subject.id=annotation.subject_element_id
    WHERE annotation.generation_id=$1::uuid AND subject.element_key=$2
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_review_annotations successor
        WHERE successor.supersedes_annotation_id=annotation.id)
    ORDER BY annotation.state,annotation.annotation_type,annotation.annotation_key`, [
    generation.id,
    element.element_key
  ]);
  const merges = await args.queryable.query<ReviewMergeProjectionRow>(`
    SELECT CASE WHEN edge.source_element_key=$2 THEN 'source' ELSE 'target' END role,
      edge.source_element_key,edge.target_element_key,edge.reason_code,edge.rationale,edge.created_at
    FROM signal_semantic_context_merge_edges edge
    WHERE edge.generation_id=$1::uuid
      AND (edge.source_element_key=$2 OR edge.target_element_key=$2)
    ORDER BY edge.created_at,edge.source_element_key,edge.target_element_key`, [
    generation.id,
    element.element_key
  ]);
  return {
    contract_version: "signal-semantic-context-review-detail-v1" as const,
    generation: publicReviewGeneration(generation),
    element: publicReviewElement(element, generation),
    evidence: evidence.rows.map(projectSignalSemanticContextEvidenceSourceV1),
    review_annotations: annotations.rows.map((annotation) => ({
      annotation_key: annotation.annotation_key,
      annotation_version: Number(annotation.annotation_version),
      annotation_type: annotation.annotation_type,
      state: annotation.state,
      resolution: annotation.resolution,
      subject_element_key: annotation.subject_element_key,
      reason: annotation.reason_code,
      rationale: safeLabel(annotation.rationale, "Review rationale", 1_000),
      related_elements: annotation.related_elements.map((related) => ({
        element_key: related.element_key,
        element_kind: related.element_kind,
        display_text: safeLabel(related.display_text, related.element_key, 500)
      })),
      created_at: new Date(annotation.created_at).toISOString()
    })),
    merge_lineage: merges.rows.map((merge) => ({
      role: merge.role,
      source_element_key: merge.source_element_key,
      target_element_key: merge.target_element_key,
      reason: merge.reason_code,
      rationale: safeLabel(merge.rationale, "Merge rationale", 1_000),
      created_at: new Date(merge.created_at).toISOString()
    })),
    lineage: {
      element_version: Number(element.element_version),
      origin: element.origin_kind,
      append_only: true as const
    },
    evidence_notice: {
      context_label: "context_supplied_to_model" as const,
      pinpoint_citation: false,
      bounded: true,
      redacted: true
    },
    authority: { source: "server_owned", review_decision_written: false }
  };
}

export async function loadSignalSemanticContextReviewSummaryV1(args: {
  queryable: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
}) {
  assertReviewAuthority(args.workspace, args.actor);
  const readiness = await loadSignalSemanticContextReadinessV1(args);
  const generationKey = readiness.open_draft?.generation_key ?? readiness.generation?.generation_key ?? null;
  const detail = generationKey ? await loadSignalSemanticContextGenerationV1({
    ...args,
    generationKey,
    includeElements: false
  }) : null;
  return {
    contract_version: "signal-semantic-context-review-summary-v1" as const,
    readiness: {
      lifecycle_state: readiness.lifecycle_state,
      generation: readiness.generation ? publicOperatorGeneration(readiness.generation) : null,
      open_draft: readiness.open_draft,
      counts: readiness.counts,
      locale_coverage: {
        primary_locale: readiness.locale_market_coverage.primary_locale,
        locale_variants: readiness.locale_market_coverage.locales,
        markets: readiness.locale_market_coverage.markets
      },
      drift_state: readiness.drift_state === "not_available" ? "missing" : readiness.drift_state,
      drift_reasons: readiness.drift_reasons,
      ready_for_context_aware_discovery: readiness.ready_for_context_aware_discovery,
      limitations: readiness.limitations
    },
    generation: detail?.generation ? publicOperatorGeneration(detail.generation) : null,
    latest_proposal_run: detail?.latest_proposal_run
      ? publicOperatorRun(detail.latest_proposal_run as unknown as Record<string, unknown>)
      : null,
    authority: { source: "server_owned" as const, private_fields_withheld: true as const }
  };
}

export function projectSignalSemanticContextEvidenceSourceV1(
  row: EvidenceProjectionRow
): SignalSemanticContextEvidenceProjectionV1 {
  const title = safeLabel(row.source_title, fallbackSourceTitle(row.source_type), 140);
  const kind = safeLabel(row.source_kind, row.source_type, 80);
  const section = safeLabel(row.section_label, fallbackSection(row.source_type), 120);
  const preview = safeContextPreview(row.source_context);
  const applicability = extractApplicability(row.source_metadata);
  const unavailableReason = !row.resolved
    ? "source_unavailable"
    : preview.value
      ? null
      : "context_not_available";
  return {
    relation: row.relation_type,
    source_type: row.source_type,
    source_kind: kind,
    source_title: title,
    section_label: section,
    source_context: {
      label: "context_supplied_to_model",
      preview: preview.value,
      truncated: preview.truncated,
      redacted: preview.redacted,
      pinpoint_citation: false
    },
    applicability,
    generation_state: "validated_at_generation",
    current_state: !row.resolved ? "unavailable" : row.current ? "current" : "inactive",
    unavailable_reason: unavailableReason
  };
}

export async function loadSignalSemanticContextReviewPageProductV1(
  args: Omit<Parameters<typeof loadSignalSemanticContextReviewPageV1>[0], "queryable" | "generationKey">
) {
  return withReviewReadTransaction(async (queryable) => loadSignalSemanticContextReviewPageV1({
    ...args,
    queryable,
    generationKey: await loadEffectiveReviewGenerationKey(queryable, args.workspace, args.actor)
  }));
}

export async function loadSignalSemanticContextReviewDetailProductV1(
  args: Omit<Parameters<typeof loadSignalSemanticContextReviewDetailV1>[0], "queryable" | "generationKey">
) {
  return withReviewReadTransaction(async (queryable) => loadSignalSemanticContextReviewDetailV1({
    ...args,
    queryable,
    generationKey: await loadEffectiveReviewGenerationKey(queryable, args.workspace, args.actor)
  }));
}

export async function loadSignalSemanticContextReviewSummaryProductV1(
  args: Omit<Parameters<typeof loadSignalSemanticContextReviewSummaryV1>[0], "queryable">
) {
  return withReviewReadTransaction((queryable) => loadSignalSemanticContextReviewSummaryV1({
    ...args,
    queryable
  }));
}

async function withReviewReadTransaction<T>(run: (queryable: SignalBrandPolicyQueryable) => Promise<T>) {
  const { pool } = await import("@/lib/db");
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function loadEffectiveReviewGenerationKey(
  queryable: SignalBrandPolicyQueryable,
  workspace: ResolvedSignalWorkspace,
  actor: SignalWorkspaceUser
) {
  const readiness = await loadSignalSemanticContextReadinessV1({ queryable, workspace, actor });
  const generationKey = readiness.open_draft?.generation_key ?? readiness.generation?.generation_key;
  if (!generationKey) throw new SignalSemanticContextPackError("semantic_context_generation_not_found", 404);
  return generationKey;
}

async function loadReviewGeneration(
  queryable: SignalBrandPolicyQueryable,
  workspaceId: string,
  generationKey: string
) {
  if (!KEY_PATTERN.test(generationKey) || generationKey.length > 160) {
    throw new SignalSemanticContextPackError("semantic_context_generation_not_found", 404);
  }
  const result = await queryable.query<GenerationRow>(`SELECT generation.id::text,
    generation.generation_key,generation.generation_version,generation.brand_os_profile_id::text,
    generation.primary_locale,generation.locale_variants,generation.markets,generation.timezone
    FROM signal_semantic_context_generations generation
    WHERE generation.workspace_id=$1::uuid AND generation.generation_key=$2
    LIMIT 1`, [workspaceId, generationKey]);
  const generation = result.rows[0];
  if (!generation) throw new SignalSemanticContextPackError("semantic_context_generation_not_found", 404);
  return generation;
}

function publicReviewGeneration(generation: GenerationRow) {
  return {
    generation_key: generation.generation_key,
    generation_version: generation.generation_version,
    primary_locale: generation.primary_locale,
    locale_variants: generation.locale_variants,
    markets: generation.markets,
    timezone: generation.timezone
  };
}

function publicOperatorGeneration(value: {
  generation_key: string;
  generation_version: number;
  lifecycle_state: "draft" | "published";
  counts: { pending: number; approved: number; rejected: number; merged: number };
  primary_locale: string;
  locale_variants: string[];
  markets: string[];
  timezone: string;
  created_at: string;
  published_at: string | null;
}) {
  return {
    generation_key: value.generation_key,
    generation_version: value.generation_version,
    lifecycle_state: value.lifecycle_state,
    counts: value.counts,
    primary_locale: value.primary_locale,
    locale_variants: value.locale_variants,
    markets: value.markets,
    timezone: value.timezone,
    created_at: value.created_at,
    published_at: value.published_at
  };
}

function publicOperatorRun(value: Record<string, unknown>) {
  const provider = objectValue(value.provider);
  const budget = objectValue(value.budget);
  const error = optionalObject(value.error);
  const revalidation = optionalObject(value.paid_response_revalidation);
  return {
    run_key: stringValue(value.run_key),
    status: stringValue(value.status),
    progress: numberOrNull(value.progress),
    provider: {
      key: stringValue(provider.key),
      model: stringValue(provider.model),
      model_version: stringValue(provider.model_version),
      pricing_version: stringValue(provider.pricing_version)
    },
    budget: {
      hard_cap_micro_usd: stringValue(budget.hard_cap_micro_usd),
      reservation_micro_usd: stringValue(budget.reservation_micro_usd),
      settled_micro_usd: nullableString(budget.settled_micro_usd)
    },
    provider_call_count: numberValue(value.provider_call_count),
    proposal_count: numberValue(value.proposal_count),
    error: error ? { code: stringValue(error.code), message: stringValue(error.message) } : null,
    paid_response_revalidation: revalidation ? {
      status: stringValue(revalidation.status),
      proposal_count_before: numberValue(revalidation.proposal_count_before),
      normalized_proposal_count: numberValue(revalidation.normalized_proposal_count),
      proposals_appended: numberValue(revalidation.proposals_appended),
      proposals_pending: numberValue(revalidation.proposals_pending),
      proposals_approved: 0 as const,
      provider_calls_added: 0 as const,
      additional_cost_micro_usd: "0" as const,
      error: optionalObject(revalidation.error)
        ? { code: stringValue(optionalObject(revalidation.error)!.code),
            message: stringValue(optionalObject(revalidation.error)!.message) }
        : null,
      recorded_at: stringValue(revalidation.recorded_at)
    } : null
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function optionalObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function stringValue(value: unknown) { return typeof value === "string" ? value : ""; }
function nullableString(value: unknown) { return typeof value === "string" ? value : null; }
function numberValue(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
function numberOrNull(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : null; }

function publicReviewElement(element: ReviewElementRow, generation: GenerationRow) {
  const evidenceRelations = {
    supports: Number(element.supports_count),
    limits: Number(element.limits_count),
    contradicts: Number(element.contradicts_count)
  };
  const localeReasons: string[] = [];
  if (!element.locale) localeReasons.push("locale_unassigned");
  else if (!generation.locale_variants.includes(element.locale)) localeReasons.push("locale_outside_generation_coverage");
  localeReasons.push("market_unassigned");
  const evidenceReasons: string[] = [];
  if (Number(element.distinct_source_count) === 1) evidenceReasons.push("one_source_only");
  if (Number(element.source_ref_count) > 0 && Number(element.supports_count) === Number(element.source_ref_count)) {
    evidenceReasons.push("supports_only_evidence");
  }
  if (Number(element.limits_count) > 0) evidenceReasons.push("limiting_evidence_present");
  if (Number(element.contradicts_count) > 0) evidenceReasons.push("contradicting_evidence_present");
  return {
    element_key: element.element_key,
    element_version: Number(element.element_version),
    element_kind: element.element_kind,
    canonical_key: element.canonical_key,
    display_text: element.display_text,
    scope: element.scope,
    entity_type: element.entity_type,
    locale: element.locale,
    relation_kind: element.relation_kind,
    relation_target_key: element.relation_target_key,
    disposition: element.disposition,
    origin: element.origin_kind,
    provenance: {
      proposed_at: new Date(element.proposed_at).toISOString(),
      decided_at: element.decided_at ? new Date(element.decided_at).toISOString() : null
    },
    applicability: {
      locale_state: element.locale ? "explicit" : "global_unassigned",
      locale: element.locale,
      market_state: "global_unassigned",
      generation_locales: generation.locale_variants,
      generation_markets: generation.markets
    },
    evidence_summary: {
      count: Number(element.source_ref_count),
      distinct_sources: Number(element.distinct_source_count),
      relations: evidenceRelations
    },
    attention: {
      authoritative: false,
      needs_locale_review: localeReasons.length > 0,
      locale_reasons: localeReasons,
      needs_evidence_review: evidenceReasons.length > 0,
      evidence_reasons: evidenceReasons,
      duplicates: {
        authoritative: false,
        exact: Number(element.exact_duplicate_count) > 1,
        exact_count: Number(element.exact_duplicate_count),
        display: Number(element.display_duplicate_count) > 1,
        display_count: Number(element.display_duplicate_count)
      }
    }
  };
}

function reviewCursorScope(generationKey: string, filters: SignalSemanticContextReviewFiltersV1) {
  return {
    contract_version: "signal-semantic-context-review-filter-v1",
    generation_key: generationKey,
    sort: "element_key_asc",
    search: filters.search,
    disposition: filters.disposition,
    element_kind: filters.element_kind,
    scope: filters.scope,
    locale: filters.locale,
    evidence: filters.evidence,
    duplicate: filters.duplicate,
    evidence_relation: filters.evidence_relation,
    page_size: filters.page_size
  };
}

function encodeCursor(after: string, scope: ReturnType<typeof reviewCursorScope>) {
  return Buffer.from(JSON.stringify({ version: 1, after, scope }), "utf8")
    .toString("base64url");
}

function decodeCursor(cursor: string | null, scope: ReturnType<typeof reviewCursorScope>) {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<string, unknown>;
    if (parsed.version !== 1 || JSON.stringify(parsed.scope) !== JSON.stringify(scope)
        || typeof parsed.after !== "string"
        || !KEY_PATTERN.test(parsed.after) || parsed.after.length > 160) {
      throw new Error("invalid cursor");
    }
    return parsed.after;
  } catch {
    throw new SignalSemanticContextPackError("semantic_context_review_cursor_invalid", 422);
  }
}

function safeContextPreview(value: string | null) {
  if (!value?.trim()) return { value: null, truncated: false, redacted: false };
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const redacted = redactPrivateContext(normalized);
  const truncated = redacted.length > PREVIEW_LIMIT;
  return {
    value: truncated ? `${redacted.slice(0, PREVIEW_LIMIT - 1).trimEnd()}…` : redacted,
    truncated,
    redacted: redacted !== normalized
  };
}

function redactPrivateContext(value: string) {
  return value
    .replace(/```[\s\S]*?```/gu, "[code redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[email redacted]")
    .replace(/https?:\/\/\S+/giu, "[link redacted]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
      "[private reference]")
    .replace(/\b(?:sha256:)?[0-9a-f]{64}\b/giu, "[private digest]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu, "[secret redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[secret redacted]")
    .replace(/\b(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/giu,
      "[secret redacted]")
    .replace(/\b(?:sk-ant-|sk-|AKIA)[A-Za-z0-9_-]{12,}\b/gu, "[secret redacted]")
    .replace(/(?:\/Users\/|\/home\/|[A-Z]:\\)[^\s]+/gu, "[private path redacted]");
}

function safeLabel(value: string | null, fallback: string, maximum: number) {
  const normalized = redactPrivateContext((value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim());
  if (!normalized) return fallback;
  return normalized.length > maximum ? `${normalized.slice(0, maximum - 1).trimEnd()}…` : normalized;
}

function extractApplicability(value: unknown) {
  const metadata = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const locales = collectKnownStrings(metadata, ["locale", "locales", "language", "languages"])
    .filter((item) => LOCALE_PATTERN.test(item));
  const markets = collectKnownStrings(metadata, ["market", "markets", "country", "countries"])
    .map((item) => item.toUpperCase())
    .filter((item) => MARKET_PATTERN.test(item));
  const uniqueLocales = [...new Set(locales)].sort();
  const uniqueMarkets = [...new Set(markets)].sort();
  return {
    locales: uniqueLocales,
    markets: uniqueMarkets,
    state: uniqueLocales.length || uniqueMarkets.length ? "explicit" as const : "not_declared" as const
  };
}

function collectKnownStrings(metadata: Record<string, unknown>, keys: string[]) {
  return keys.flatMap((key) => {
    const value = metadata[key];
    if (typeof value === "string") return [value.trim()];
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string")
      .map((item) => item.trim());
    return [];
  }).filter(Boolean);
}

function fallbackSourceTitle(sourceType: string) {
  return ({
    brand_os_profile: "Brand OS profile",
    brand_os_product: "Brand OS product",
    brand_os_competitor: "Brand OS competitor",
    brand_os_seed_term: "Brand OS governed term",
    knowledge_source: "Knowledge source",
    knowledge_chunk: "Knowledge block",
    knowledge_assertion: "Knowledge assertion"
  } as Record<string, string>)[sourceType] ?? "Governed source";
}

function fallbackSection(sourceType: string) {
  return ({
    brand_os_profile: "Brand identity",
    brand_os_product: "Products",
    brand_os_competitor: "Competitors",
    brand_os_seed_term: "Governed vocabulary",
    knowledge_source: "Knowledge source",
    knowledge_chunk: "Knowledge block",
    knowledge_assertion: "Knowledge assertion"
  } as Record<string, string>)[sourceType] ?? "Governed context";
}

function assertReviewAuthority(workspace: ResolvedSignalWorkspace, actor: SignalWorkspaceUser) {
  if (actor.userType !== "noisia_internal") {
    throw new SignalSemanticContextPackError("semantic_context_forbidden", 403);
  }
  if (workspace.subject.type !== "brand") {
    throw new SignalSemanticContextPackError("brand_workspace_required", 422);
  }
}

function closedValue<const Values extends readonly string[]>(value: string | null, values: Values) {
  if (!value) return null;
  if (!values.includes(value as Values[number])) {
    throw new SignalSemanticContextPackError("semantic_context_review_filter_invalid", 422);
  }
  return value as Values[number];
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

function numericRecord(value: Record<string, number>) {
  return Object.fromEntries(Object.entries(value).map(([key, count]) => [key, Number(count)]));
}

const reviewElementsCte = `WITH base_elements AS (
  SELECT element.id::text,element.element_key,element.element_version,element.element_kind,element.canonical_key,
    element.display_text,element.scope,element.entity_type,element.locale,element.relation_kind,
    element.relation_target_key,element.disposition,element.origin_kind,element.proposed_at,
    element.decided_at,lower(regexp_replace(btrim(element.display_text),'\\s+',' ','g')) normalized_display,
    count(link.id)::int source_ref_count,
    count(DISTINCT (link.source_type,link.source_id))::int distinct_source_count,
    count(link.id) FILTER(WHERE link.relation_type='supports')::int supports_count,
    count(link.id) FILTER(WHERE link.relation_type='limits')::int limits_count,
    count(link.id) FILTER(WHERE link.relation_type='contradicts')::int contradicts_count,
    element.entity_id::text entity_id
  FROM signal_semantic_context_element_versions element
  LEFT JOIN analysis_evidence_links link ON link.evidence_group_id=element.evidence_group_id
  WHERE element.generation_id=$1::uuid AND NOT EXISTS(
    SELECT 1 FROM signal_semantic_context_element_versions successor
    WHERE successor.supersedes_element_id=element.id)
  GROUP BY element.id
),review_elements AS (
  SELECT base.*,
    count(*) OVER(PARTITION BY element_kind,canonical_key,COALESCE(locale,''),normalized_display,
      COALESCE(scope,''),COALESCE(entity_type,''),COALESCE(entity_id,''),
      COALESCE(relation_kind,''),COALESCE(relation_target_key,''))::int exact_duplicate_count,
    count(*) OVER(PARTITION BY normalized_display)::int display_duplicate_count
  FROM base_elements base
)`;

const evidenceProjectionSql = `${reviewElementsCte}
  SELECT link.source_type,link.relation_type,link.position,
    CASE link.source_type
      WHEN 'brand_os_profile' THEN COALESCE(brand.display_name,brand.name)
      WHEN 'brand_os_product' THEN product.name
      WHEN 'brand_os_competitor' THEN competitor.competitor_name
      WHEN 'brand_os_seed_term' THEN seed_term.term
      WHEN 'knowledge_source' THEN knowledge_source.title
      WHEN 'knowledge_chunk' THEN chunk_source.title
      WHEN 'knowledge_assertion' THEN assertion_source.title
    END source_title,
    CASE link.source_type
      WHEN 'brand_os_profile' THEN 'identity'
      WHEN 'brand_os_product' THEN COALESCE(product.product_type,'product')
      WHEN 'brand_os_competitor' THEN COALESCE(competitor.role,'competitor')
      WHEN 'brand_os_seed_term' THEN seed_term.term_type
      WHEN 'knowledge_source' THEN knowledge_source.source_kind
      WHEN 'knowledge_chunk' THEN chunk_source.source_kind
      WHEN 'knowledge_assertion' THEN assertion.assertion_type
    END source_kind,
    CASE link.source_type
      WHEN 'brand_os_profile' THEN 'Brand identity'
      WHEN 'brand_os_product' THEN 'Products'
      WHEN 'brand_os_competitor' THEN 'Competitors'
      WHEN 'brand_os_seed_term' THEN COALESCE(seed_set.name,'Governed vocabulary')
      WHEN 'knowledge_source' THEN knowledge_source.source_kind
      WHEN 'knowledge_chunk' THEN 'Knowledge block '||(knowledge_chunk.chunk_index+1)::text
      WHEN 'knowledge_assertion' THEN assertion.assertion_type
    END section_label,
    CASE link.source_type
      WHEN 'brand_os_profile' THEN concat_ws(' · ',COALESCE(brand.display_name,brand.name),
        brand.industry,brand.industry_sub,
        CASE WHEN jsonb_typeof(profile.metadata->'aliases')='array' THEN 'Aliases: '||(
          SELECT string_agg(alias,' · ' ORDER BY alias)
          FROM jsonb_array_elements_text(profile.metadata->'aliases') alias) END)
      WHEN 'brand_os_product' THEN concat_ws(' · ',product.name,product.product_type,product.description)
      WHEN 'brand_os_competitor' THEN concat_ws(' · ',competitor.competitor_name,competitor.role)
      WHEN 'brand_os_seed_term' THEN seed_term.term
      WHEN 'knowledge_source' THEN knowledge_source.raw_text
      WHEN 'knowledge_chunk' THEN knowledge_chunk.chunk_text
      WHEN 'knowledge_assertion' THEN assertion.assertion_text
    END source_context,
    CASE link.source_type
      WHEN 'brand_os_profile' THEN profile.metadata
      WHEN 'brand_os_product' THEN product.metadata
      WHEN 'brand_os_competitor' THEN competitor.metadata
      WHEN 'brand_os_seed_term' THEN seed_term.metadata
      WHEN 'knowledge_source' THEN knowledge_source.extracted_payload
      WHEN 'knowledge_chunk' THEN chunk_source.extracted_payload
      WHEN 'knowledge_assertion' THEN assertion_source.extracted_payload
      ELSE '{}'::jsonb
    END source_metadata,
    CASE link.source_type
      WHEN 'brand_os_profile' THEN profile.id IS NOT NULL
      WHEN 'brand_os_product' THEN product.id IS NOT NULL
      WHEN 'brand_os_competitor' THEN competitor.id IS NOT NULL
      WHEN 'brand_os_seed_term' THEN seed_term.id IS NOT NULL
      WHEN 'knowledge_source' THEN knowledge_source.id IS NOT NULL
      WHEN 'knowledge_chunk' THEN knowledge_chunk.id IS NOT NULL
      WHEN 'knowledge_assertion' THEN assertion.id IS NOT NULL
      ELSE false
    END resolved,
    CASE link.source_type
      WHEN 'brand_os_profile' THEN profile.status='active' AND profile.id=$5::uuid
      WHEN 'brand_os_product' THEN product.status='active' AND product_profile.id=$5::uuid
      WHEN 'brand_os_competitor' THEN competitor_profile.id=$5::uuid
      WHEN 'brand_os_seed_term' THEN seed_set.status='active' AND seed_profile.id=$5::uuid
      WHEN 'knowledge_source' THEN knowledge_source.status IN ('processed','profiled','active')
      WHEN 'knowledge_chunk' THEN chunk_source.status IN ('processed','profiled','active')
      WHEN 'knowledge_assertion' THEN assertion_source.status IN ('processed','profiled','active')
        AND assertion.status IN ('accepted','approved','active')
      ELSE false
    END current
  FROM review_elements element
  JOIN signal_semantic_context_element_versions version
    ON version.generation_id=$1::uuid AND version.element_key=element.element_key
    AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor
      WHERE successor.supersedes_element_id=version.id)
  JOIN analysis_evidence_links link ON link.evidence_group_id=version.evidence_group_id
  LEFT JOIN brand_os_profiles profile ON link.source_type='brand_os_profile'
    AND profile.id=link.source_id AND profile.brand_id=$4::uuid
  LEFT JOIN brands brand ON brand.id=profile.brand_id
  LEFT JOIN brand_os_products product ON link.source_type='brand_os_product' AND product.id=link.source_id
    AND product.brand_os_profile_id IN (SELECT scoped_profile.id FROM brand_os_profiles scoped_profile
      WHERE scoped_profile.brand_id=$4::uuid)
  LEFT JOIN brand_os_profiles product_profile ON product_profile.id=product.brand_os_profile_id
    AND product_profile.brand_id=$4::uuid
  LEFT JOIN brand_os_competitors competitor ON link.source_type='brand_os_competitor'
    AND competitor.id=link.source_id
    AND competitor.brand_os_profile_id IN (SELECT scoped_profile.id FROM brand_os_profiles scoped_profile
      WHERE scoped_profile.brand_id=$4::uuid)
  LEFT JOIN brand_os_profiles competitor_profile ON competitor_profile.id=competitor.brand_os_profile_id
    AND competitor_profile.brand_id=$4::uuid
  LEFT JOIN brand_os_seed_terms seed_term ON link.source_type='brand_os_seed_term'
    AND seed_term.id=link.source_id
    AND seed_term.seed_set_id IN (SELECT scoped_set.id FROM brand_os_seed_sets scoped_set
      JOIN brand_os_profiles scoped_profile ON scoped_profile.id=scoped_set.brand_os_profile_id
      WHERE scoped_profile.brand_id=$4::uuid)
  LEFT JOIN brand_os_seed_sets seed_set ON seed_set.id=seed_term.seed_set_id
  LEFT JOIN brand_os_profiles seed_profile ON seed_profile.id=seed_set.brand_os_profile_id
    AND seed_profile.brand_id=$4::uuid
  LEFT JOIN brand_knowledge_sources knowledge_source ON link.source_type='knowledge_source'
    AND knowledge_source.id=link.source_id AND knowledge_source.organization_id=$3::uuid
    AND knowledge_source.brand_id=$4::uuid AND knowledge_source.study_corpus_id IS NULL
  LEFT JOIN knowledge_chunks knowledge_chunk ON link.source_type='knowledge_chunk'
    AND knowledge_chunk.id=link.source_id
    AND knowledge_chunk.knowledge_source_id IN (SELECT scoped_source.id FROM brand_knowledge_sources scoped_source
      WHERE scoped_source.organization_id=$3::uuid AND scoped_source.brand_id=$4::uuid
        AND scoped_source.study_corpus_id IS NULL)
  LEFT JOIN brand_knowledge_sources chunk_source ON chunk_source.id=knowledge_chunk.knowledge_source_id
    AND chunk_source.organization_id=$3::uuid AND chunk_source.brand_id=$4::uuid
    AND chunk_source.study_corpus_id IS NULL
  LEFT JOIN knowledge_assertions assertion ON link.source_type='knowledge_assertion'
    AND assertion.id=link.source_id
    AND assertion.knowledge_source_id IN (SELECT scoped_source.id FROM brand_knowledge_sources scoped_source
      WHERE scoped_source.organization_id=$3::uuid AND scoped_source.brand_id=$4::uuid
        AND scoped_source.study_corpus_id IS NULL)
  LEFT JOIN brand_knowledge_sources assertion_source ON assertion_source.id=assertion.knowledge_source_id
    AND assertion_source.organization_id=$3::uuid AND assertion_source.brand_id=$4::uuid
    AND assertion_source.study_corpus_id IS NULL
  WHERE element.element_key=$2
  ORDER BY link.position,link.id`;
