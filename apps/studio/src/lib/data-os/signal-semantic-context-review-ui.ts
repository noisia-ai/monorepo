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

const SIGNAL_SEMANTIC_CONTEXT_APPROVAL_CONFIRMATION_UI =
  "approve_selected_semantic_context_element" as const;
const SIGNAL_SEMANTIC_CONTEXT_BULK_CONFIRMATION_UI =
  "apply_shared_decision_basis_to_all_selected_elements" as const;
export const SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONFIRMATION_UI =
  "resolve_semantic_context_annotation_with_deliberate_basis" as const;
export const SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_REPAIR_CONFIRMATION_UI =
  "repair_semantic_context_annotation_resolution_basis" as const;
export const SIGNAL_SEMANTIC_CONTEXT_LOCALE_AUTHORITY_CONFIRMATION_UI =
  "apply_semantic_context_locale_authority_decision" as const;
export type SignalSemanticContextAnnotationResolutionIntentUi = "resolve" | "repair";
export type SignalSemanticContextLocaleAuthorityDispositionUi = "global" | "locale_specific";

function parseDecisionBasisFormUiV2(form: FormData) {
  const reason = String(form.get("reason") ?? "");
  const rationale = String(form.get("rationale") ?? "").trim().normalize("NFC");
  if (!SIGNAL_SEMANTIC_CONTEXT_REVIEW_REASONS_UI.includes(
    reason as SignalSemanticContextReviewReasonUi
  ) || [...rationale].length < 1 || [...rationale].length > 1000) return null;
  return { reason: reason as SignalSemanticContextReviewReasonUi, rationale };
}

export function parseSignalSemanticContextApprovalFormUiV2(form: FormData) {
  const basis = parseDecisionBasisFormUiV2(form);
  if (!basis || form.get("confirmation") !== SIGNAL_SEMANTIC_CONTEXT_APPROVAL_CONFIRMATION_UI) return null;
  return basis;
}

export function parseSignalSemanticContextBulkApprovalFormUiV2(form: FormData) {
  const basis = parseDecisionBasisFormUiV2(form);
  if (!basis || form.get("confirmation") !== SIGNAL_SEMANTIC_CONTEXT_BULK_CONFIRMATION_UI) return null;
  return basis;
}

export function parseSignalSemanticContextAnnotationResolutionFormUiV1(
  form: FormData,
  intent: SignalSemanticContextAnnotationResolutionIntentUi
) {
  const basis = parseDecisionBasisFormUiV2(form);
  const confirmation = intent === "resolve"
    ? SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONFIRMATION_UI
    : SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_REPAIR_CONFIRMATION_UI;
  if (!basis || form.get("confirmation") !== confirmation) return null;
  return { ...basis, confirmation };
}

export function parseSignalSemanticContextLocaleAuthorityFormUiV1(
  form: FormData,
  permittedLocales: string[]
) {
  const basis = parseDecisionBasisFormUiV2(form);
  const disposition = String(form.get("disposition") ?? "");
  const localeValue = String(form.get("locale") ?? "");
  const locale = localeValue.length > 0 ? localeValue : null;
  if (!basis
      || (disposition !== "global" && disposition !== "locale_specific")
      || form.get("confirmation") !== SIGNAL_SEMANTIC_CONTEXT_LOCALE_AUTHORITY_CONFIRMATION_UI
      || (disposition === "global" && locale !== null)
      || (disposition === "locale_specific"
        && (locale === null || !new Set(permittedLocales).has(locale)))) return null;
  return {
    ...basis,
    disposition: disposition as SignalSemanticContextLocaleAuthorityDispositionUi,
    locale,
    confirmation: SIGNAL_SEMANTIC_CONTEXT_LOCALE_AUTHORITY_CONFIRMATION_UI
  };
}

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
  elements: Array<{ element_key: string; element_kind: string; disposition: string }>;
}) {
  const keys = [...new Set(args.selectedKeys)].sort();
  const byKey = new Map(args.elements.map((element) => [element.element_key, element]));
  const selected = keys.map((key) => byKey.get(key));
  return keys.length >= 2 && keys.length <= 15
    && selected.every((element) => element?.disposition === "pending")
    && new Set(selected.map((element) => element?.element_kind)).size === 1;
}

export function signalSemanticContextSelectionWithinVisiblePageV1(args: {
  selectedKeys: string[];
  visibleElementKeys: string[];
}) {
  const visible = new Set(args.visibleElementKeys);
  const selected = [...new Set(args.selectedKeys)];
  return selected.length > 0 && selected.every((key) => visible.has(key));
}

export function handleSignalSemanticContextDecisionKeyV1(args: {
  key: string;
  busy: boolean;
  mode: "view" | "approve" | "correct" | "reject" | "annotate" | "resolve_annotation" | "locale_authority";
  cancel: () => void;
}) {
  if (args.key !== "Escape" || args.mode === "view" || args.busy) return false;
  args.cancel();
  return true;
}

export async function submitSignalSemanticContextBulkApprovalUiV1(args: {
  request: SignalSemanticContextReviewUiRequest;
  base: string;
  generationKey: string;
  elementKeys: string[];
  reason: SignalSemanticContextReviewReasonUi;
  rationale: string;
  idempotencyKey: string;
}) {
  if (new Set(args.elementKeys).size !== args.elementKeys.length) throw new Error("semantic_context_duplicate_key");
  const keys = [...args.elementKeys].sort();
  if (keys.length < 2 || keys.length > 15) throw new Error("semantic_context_bulk_scope_invalid");
  return args.request(`${args.base}/decisions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": args.idempotencyKey },
    body: JSON.stringify({
      action: "bulk_approve",
      generation_key: args.generationKey,
      element_keys: keys,
      reason: args.reason,
      rationale: args.rationale.trim().normalize("NFC"),
      confirmation: "apply_shared_decision_basis_to_all_selected_elements"
    })
  });
}

export async function submitSignalSemanticContextBulkApprovalFormUiV2(args: {
  form: FormData;
  request: SignalSemanticContextReviewUiRequest;
  base: string;
  generationKey: string;
  elementKeys: string[];
  idempotencyKey: string;
}) {
  const basis = parseSignalSemanticContextBulkApprovalFormUiV2(args.form);
  if (!basis) return false;
  await submitSignalSemanticContextBulkApprovalUiV1({ ...args, ...basis });
  return true;
}

export async function submitSignalSemanticContextLocaleAuthorityFormUiV1(args: {
  form: FormData;
  request: SignalSemanticContextReviewUiRequest;
  base: string;
  generationKey: string;
  elementKeys: string[];
  permittedLocales: string[];
  idempotencyKey: string;
}) {
  if (new Set(args.elementKeys).size !== args.elementKeys.length) {
    throw new Error("semantic_context_duplicate_key");
  }
  const keys = [...args.elementKeys].sort();
  if (keys.length < 1 || keys.length > 15) {
    throw new Error("semantic_context_locale_decision_scope_invalid");
  }
  const decision = parseSignalSemanticContextLocaleAuthorityFormUiV1(args.form, args.permittedLocales);
  if (!decision) return false;
  await args.request(`${args.base}/locale-authority`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": args.idempotencyKey },
    body: JSON.stringify({
      generation_key: args.generationKey,
      element_keys: keys,
      disposition: decision.disposition,
      locale: decision.locale,
      reason: decision.reason,
      rationale: decision.rationale,
      confirmation: decision.confirmation
    })
  });
  return true;
}

export async function submitSignalSemanticContextDeliberateApprovalUiV2(args: {
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
      action: "approve",
      generation_key: args.generationKey,
      element_key: args.elementKey,
      reason: args.reason,
      rationale: args.rationale.trim().normalize("NFC"),
      confirmation: "approve_selected_semantic_context_element"
    })
  });
}

export async function submitSignalSemanticContextDeliberateApprovalFormUiV2(args: {
  form: FormData;
  request: SignalSemanticContextReviewUiRequest;
  base: string;
  generationKey: string;
  elementKey: string;
  idempotencyKey: string;
}) {
  const basis = parseSignalSemanticContextApprovalFormUiV2(args.form);
  if (!basis) return false;
  await submitSignalSemanticContextDeliberateApprovalUiV2({ ...args, ...basis });
  return true;
}

export async function submitSignalSemanticContextAnnotationResolutionFormUiV1(args: {
  form: FormData;
  intent: SignalSemanticContextAnnotationResolutionIntentUi;
  request: SignalSemanticContextReviewUiRequest;
  base: string;
  generationKey: string;
  elementKey: string;
  annotationKey: string;
  resolution: SignalSemanticContextAnnotationResolutionUi;
  idempotencyKey: string;
}) {
  const basis = parseSignalSemanticContextAnnotationResolutionFormUiV1(args.form, args.intent);
  if (!basis) return false;
  await args.request(`${args.base}/annotations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": args.idempotencyKey },
    body: JSON.stringify({
      action: args.intent,
      generation_key: args.generationKey,
      element_key: args.elementKey,
      annotation_key: args.annotationKey,
      resolution: args.resolution,
      reason: basis.reason,
      rationale: basis.rationale,
      confirmation: basis.confirmation
    })
  });
  return true;
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
