export const SIGNAL_SEMANTIC_CONTEXT_REVIEW_REASONS_UI = [
  "duplicate_same_concept",
  "alias_or_variant",
  "canonicalization",
  "semantic_boundary",
  "locale_resolution",
  "competitive_unit_resolution",
  "insufficient_context",
  "operator_correction"
] as const;

export const SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_TYPES_UI = [
  "uncertain",
  "needs_more_context",
  "near_duplicate",
  "locale_unresolved",
  "competitive_unit_unresolved"
] as const;

export type SignalSemanticContextReviewReasonUi =
  (typeof SIGNAL_SEMANTIC_CONTEXT_REVIEW_REASONS_UI)[number];
export type SignalSemanticContextAnnotationTypeUi =
  (typeof SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_TYPES_UI)[number];
export type SignalSemanticContextAnnotationResolutionUi =
  | "merged"
  | "kept_distinct"
  | "context_sufficient"
  | "not_supported"
  | "governed_locale"
  | "global"
  | "canonical_unit"
  | "not_applicable";

export type SignalSemanticContextReviewUiRequest = (
  path: string,
  init: RequestInit
) => Promise<unknown>;

export function createSignalSemanticContextMutationLockV1() {
  let active = false;
  return {
    begin() {
      if (active) return false;
      active = true;
      return true;
    },
    end() {
      active = false;
    },
    isActive() {
      return active;
    }
  };
}

export function signalSemanticContextReviewRangeV1(args: {
  total: number;
  visible: number;
  pageIndex: number;
  pageSize: number;
}) {
  if (args.total <= 0 || args.visible <= 0) return { start: 0, end: 0 };
  const start = Math.min(args.pageIndex * args.pageSize + 1, args.total);
  return { start, end: Math.min(start + args.visible - 1, args.total) };
}

export function signalSemanticContextAnnotationResolutionsV1(
  type: SignalSemanticContextAnnotationTypeUi
): SignalSemanticContextAnnotationResolutionUi[] {
  if (type === "near_duplicate") return ["kept_distinct"];
  if (type === "locale_unresolved") return ["governed_locale", "global"];
  if (type === "competitive_unit_unresolved") return ["canonical_unit", "not_applicable"];
  return ["context_sufficient", "not_supported"];
}

export function signalSemanticContextBoundedPendingSelectionV1(args: {
  selectedKeys: string[];
  elements: Array<{ element_key: string; disposition: string }>;
}) {
  const keys = [...new Set(args.selectedKeys)].sort();
  const byKey = new Map(args.elements.map((element) => [element.element_key, element]));
  return keys.length > 0 && keys.length <= 100
    && keys.every((key) => byKey.get(key)?.disposition === "pending");
}

export function signalSemanticContextSelectionWithinVisiblePageV1(args: {
  selectedKeys: string[];
  visibleElementKeys: string[];
}) {
  const visible = new Set(args.visibleElementKeys);
  const selected = [...new Set(args.selectedKeys)];
  return selected.length > 0 && selected.every((key) => visible.has(key));
}

export async function submitSignalSemanticContextBulkApprovalUiV1(args: {
  request: SignalSemanticContextReviewUiRequest;
  base: string;
  generationKey: string;
  elementKeys: string[];
  idempotencyKey: string;
}) {
  const keys = [...new Set(args.elementKeys)].sort();
  if (keys.length < 1 || keys.length > 100) throw new Error("semantic_context_bulk_scope_invalid");
  return args.request(`${args.base}/decisions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": args.idempotencyKey },
    body: JSON.stringify({
      action: "bulk_approve",
      generation_key: args.generationKey,
      element_keys: keys
    })
  });
}

/** One browser command crosses the atomic, server-owned rationale + rejection boundary. */
export async function submitSignalSemanticContextGuidedRejectUiV1(args: {
  request: SignalSemanticContextReviewUiRequest;
  base: string;
  generationKey: string;
  elementKey: string;
  reason: SignalSemanticContextReviewReasonUi;
  rationale: string;
  idempotencyKey: string;
}) {
  return args.request(`${args.base}/decisions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": args.idempotencyKey },
    body: JSON.stringify({
      action: "reject",
      generation_key: args.generationKey,
      element_key: args.elementKey,
      reason: args.reason,
      rationale: args.rationale
    })
  });
}

export async function submitSignalSemanticContextMergeUiV1(args: {
  request: SignalSemanticContextReviewUiRequest;
  base: string;
  generationKey: string;
  targetElementKey: string;
  sourceElementKeys: string[];
  missingAnnotationKeys: Record<string, string>;
  reason: SignalSemanticContextReviewReasonUi;
  rationale: string;
  targetCorrection: {
    canonical_key: string;
    display_text: string;
    scope: string | null;
    locale: string | null;
    relation_kind: string | null;
    relation_target_key: string | null;
  };
  idempotencyKey: string;
}) {
  const sources = [...new Set(args.sourceElementKeys)].sort();
  if (!sources.length || sources.includes(args.targetElementKey)) {
    throw new Error("semantic_context_merge_scope_invalid");
  }
  for (const source of sources) {
    const annotationKey = args.missingAnnotationKeys[source];
    if (!annotationKey) continue;
    await args.request(`${args.base}/annotations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `${args.idempotencyKey}:annotation:${source}`
      },
      body: JSON.stringify({
        generation_key: args.generationKey,
        element_key: source,
        annotation_key: annotationKey,
        annotation_type: "near_duplicate",
        reason: args.reason,
        rationale: args.rationale,
        related_element_keys: [args.targetElementKey]
      })
    });
  }
  return args.request(`${args.base}/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": `${args.idempotencyKey}:merge` },
    body: JSON.stringify({
      generation_key: args.generationKey,
      target_element_key: args.targetElementKey,
      source_element_keys: sources,
      reason: args.reason,
      rationale: args.rationale,
      target_correction: args.targetCorrection
    })
  });
}
