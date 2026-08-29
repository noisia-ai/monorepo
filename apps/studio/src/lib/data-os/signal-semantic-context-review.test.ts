import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import type { SignalBrandPolicyQueryable } from "./signal-governed-brand-policy";
import {
  loadSignalSemanticContextReviewSummaryV1,
  loadSignalSemanticContextReviewPageV1,
  parseSignalSemanticContextReviewFiltersV1,
  projectSignalSemanticContextEvidenceSourceV1
} from "./signal-semantic-context-review";
import type { ResolvedSignalWorkspace, SignalWorkspaceUser } from "./signal-workspace";

const workspace = {
  id: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000002",
  subject: { type: "brand", id: "00000000-0000-4000-8000-000000000003" }
} as unknown as ResolvedSignalWorkspace;
const actor = ({
  id: "00000000-0000-4000-8000-000000000004",
  userType: "noisia_internal"
} as unknown) as SignalWorkspaceUser;
const generation = {
  id: "00000000-0000-4000-8000-000000000005",
  generation_key: "semantic-context-v6",
  generation_version: 6,
  brand_os_profile_id: "00000000-0000-4000-8000-000000000006",
  primary_locale: "es-MX",
  locale_variants: ["en-US", "es-MX"],
  markets: ["MX", "US"],
  timezone: "America/Mexico_City"
};

function element(index: number) {
  return {
    element_key: `element-${String(index).padStart(2, "0")}`,
    element_version: 1,
    element_kind: index % 2 ? "need" : "feature",
    canonical_key: `canonical-${index}`,
    display_text: index < 2 ? "Same display" : `Display ${index}`,
    scope: index % 2 ? "primary_brand" : "category",
    entity_type: "brand",
    locale: index % 3 ? null : "es-MX",
    relation_kind: null,
    relation_target_key: null,
    disposition: "pending",
    origin_kind: "provider_proposal",
    proposed_at: "2026-08-23T08:00:00.000Z",
    decided_at: null,
    source_ref_count: 2,
    distinct_source_count: 1,
    supports_count: 2,
    limits_count: 0,
    contradicts_count: 0,
    exact_duplicate_count: 1,
    display_duplicate_count: index < 2 ? 2 : 1
  };
}

test("review filters are closed and reject browser authority fields", () => {
  const parsed = parseSignalSemanticContextReviewFiltersV1(new URLSearchParams(
    "search=need&disposition=pending&locale=needs_review&evidence=has_limits&duplicate=display&page_size=40"
  ));
  assert.equal(parsed.page_size, 40);
  assert.equal(parsed.locale, "needs_review");
  for (const hostile of ["workspace_id=x", "source_id=x", "page_size=100", "locale=Mexico",
    "element_kind=open_kind", "evidence=approved", "duplicate=semantic"]) {
    assert.throws(() => parseSignalSemanticContextReviewFiltersV1(new URLSearchParams(hostile)));
  }
});

test("review summary represents only a zero-generation missing-brief workspace as uninitialized", async () => {
  const summary = await loadSignalSemanticContextReviewSummaryV1({
    queryable: summaryQueryable({ brief: false, generationCount: 0 }), workspace, actor
  });
  assert.equal(summary.generation, null);
  assert.equal(summary.latest_proposal_run, null);
  assert.deepEqual(summary.readiness, {
    lifecycle_state: "missing",
    unavailable_reason: "acquisition_brief_required",
    generation: null,
    open_draft: null,
    counts: { pending: 0, approved: 0, rejected: 0, merged: 0 },
    locale_coverage: { primary_locale: null, locale_variants: [], markets: [] },
    drift_state: "missing",
    drift_reasons: [],
    ready_for_context_aware_discovery: false,
    limitations: ["acquisition_brief_required"]
  });

  const prepared = await loadSignalSemanticContextReviewSummaryV1({
    queryable: summaryQueryable({ brief: true, generationCount: 0 }), workspace, actor
  });
  assert.equal(prepared.readiness.lifecycle_state, "missing");
  assert.equal(prepared.readiness.unavailable_reason, null,
    "a valid brief with no generation keeps the ordinary prepare-draft state");
});

test("review summary never reclassifies unknown errors or an existing generation", async () => {
  await assert.rejects(loadSignalSemanticContextReviewSummaryV1({
    queryable: summaryQueryable({ brief: false, generationCount: 0, unknownError: true }),
    workspace, actor
  }), /unexpected_summary_failure/u);
  await assert.rejects(loadSignalSemanticContextReviewSummaryV1({
    queryable: summaryQueryable({ brief: false, generationCount: 1 }), workspace, actor
  }), (error: unknown) => (error as { code?: string }).code === "acquisition_brief_required");
});

test("review summary route and OpenAPI expose one closed uninitialized reason", async () => {
  const [route, service, openApi] = await Promise.all([
    readFile(resolve(process.cwd(),
      "src/app/api/data-os/signal/[workspaceId]/semantic-context/review/summary/route.ts"), "utf8"),
    readFile(resolve(process.cwd(), "src/lib/data-os/signal-semantic-context-review.ts"), "utf8"),
    readFile(resolve(process.cwd(), "../../docs/api/openapi.yaml"), "utf8")
  ]);
  assert.match(route, /loadSignalWorkspaceContextForSemanticContextManagement/u);
  assert.match(route, /semanticContextError\(error, "semantic_context_review_summary_unavailable"\)/u,
    "unknown and authorization failures retain the existing fail-closed route boundary");
  assert.match(service, /error\.code !== "acquisition_brief_required"\) throw error/u);
  assert.match(service, /count\(\*\)::int generation_count[\s\S]+generation_count \?\? -1\) !== 0\) throw error/u,
    "the exception requires exact zero-generation authority");
  const schema = openApi.match(/    SignalSemanticContextReviewSummaryV1:\n([\s\S]*?)\n    SignalSemanticContextReviewElementV1:/u)?.[1];
  assert.ok(schema);
  assert.match(schema, /readiness:\n\s+type: object\n\s+additionalProperties: false/u);
  assert.match(schema, /required: \[lifecycle_state, unavailable_reason/u);
  assert.match(schema, /const: acquisition_brief_required/u);
});

test("global locale filter stays closed and aligned across runtime, UI, and OpenAPI", async () => {
  const parsed = parseSignalSemanticContextReviewFiltersV1(new URLSearchParams("locale=global"));
  assert.equal(parsed.locale, "global");

  const [workbench, openApi] = await Promise.all([
    readFile(resolve(process.cwd(), "src/components/brands/SemanticContextReviewWorkbench.tsx"), "utf8"),
    readFile(resolve(process.cwd(), "../../docs/api/openapi.yaml"), "utf8")
  ]);
  assert.match(workbench, /<option value="global">/u);
  const reviewPath = openApi.match(
    /  \/api\/data-os\/signal\/\{workspaceId\}\/semantic-context\/review:\n([\s\S]*?)\n  \/api\/data-os\/signal\/\{workspaceId\}\/semantic-context\/review\/summary:/u
  )?.[1];
  assert.ok(reviewPath, "the Semantic Context review GET contract exists");
  assert.match(reviewPath,
    /name: locale, in: query, schema: \{ type: string, enum: \[all, explicit, unassigned, global, needs_review\], default: all \}/u);
});

test("effective applicability is a closed server-owned review contract",async()=>{
  const[service,workbench,openApi,esMx,enUs]=await Promise.all([
    readFile(resolve(process.cwd(),"src/lib/data-os/signal-semantic-context-review.ts"),"utf8"),
    readFile(resolve(process.cwd(),"src/components/brands/SemanticContextReviewWorkbench.tsx"),"utf8"),
    readFile(resolve(process.cwd(),"../../docs/api/openapi.yaml"),"utf8"),
    readFile(resolve(process.cwd(),"messages/es-MX.json"),"utf8"),
    readFile(resolve(process.cwd(),"messages/en-US.json"),"utf8")]);
  assert.match(service,/signal-semantic-context-effective-applicability-v1/u);
  assert.match(service,/workspace_inherited/u);
  assert.match(workbench,/values\.inheritedWorkspace/u);
  assert.match(workbench,/locale_authority\.state === "unresolved"/u,
    "only truly unresolved approved leaves retain the dedicated decision action");
  assert.match(openApi,/signal-semantic-context-effective-applicability-v1/u);
  assert.match(openApi,/workspace_inherited, explicit_global, explicit_locale, unresolved/u);
  assert.match(esMx,/Hereda \{markets\}/u);assert.match(enUs,/Inherits \{markets\}/u);
});

test("automatic exceptions stay closed and localized while ready excludes terminal leaves",async()=>{
  const[service,workbench,openApi,esMxRaw,enUsRaw,migration]=await Promise.all([
    readFile(resolve(process.cwd(),"src/lib/data-os/signal-semantic-context-review.ts"),"utf8"),
    readFile(resolve(process.cwd(),"src/components/brands/SemanticContextReviewWorkbench.tsx"),"utf8"),
    readFile(resolve(process.cwd(),"../../docs/api/openapi.yaml"),"utf8"),
    readFile(resolve(process.cwd(),"messages/es-MX.json"),"utf8"),
    readFile(resolve(process.cwd(),"messages/en-US.json"),"utf8"),
    readFile(resolve(process.cwd(),"../../infrastructure/db/migrations/0105_signal_semantic_context_automatic_disposition.sql"),"utf8")]);
  const reasons=["evidence_missing","evidence_invalid","evidence_limited","evidence_contradictory",
    "semantic_collision","relation_target_unresolved","locale_required","locale_not_in_parent_envelope",
    "locale_specific_requires_operator_review"];
  const esMx=JSON.parse(esMxRaw).AdminWorkspace.brandOs.semanticContext.reviewWorkbench.automaticReasons;
  const enUs=JSON.parse(enUsRaw).AdminWorkspace.brandOs.semanticContext.reviewWorkbench.automaticReasons;
  for(const reason of reasons){assert.equal(typeof esMx[reason],"string");assert.equal(typeof enUs[reason],"string");
    assert.match(openApi,new RegExp(reason,"u"));assert.match(migration,new RegExp(reason,"u"));}
  assert.doesNotMatch(openApi,/automatic_policy:[\s\S]{0,900}(?:schema_invalid|parent_authority_invalid)/u);
  assert.match(service,/element\.lifecycle_state === "active" && element\.disposition === "approved" \? "ready"/u);
  assert.match(service,/element\.disposition='approved' THEN 'ready'/u);
  assert.match(workbench,/reviewWorkbench\.resolvedCount/u);
  assert.match(service,/'ready',\(SELECT count\(\*\)::int FROM review_elements WHERE review_state='ready'\)/u);
  assert.match(workbench,/reviewStateCounts=page\?page\.facets\.review_states:EMPTY_REVIEW_STATE_COUNTS/u);
  assert.doesNotMatch(workbench,/page\?\.facets\.review_states/u,
    "the client does not repair a sparse review-state API response");
});

test("review-state facets are a closed three-key object even when SQL counts are sparse",async()=>{
  const empty=await loadSignalSemanticContextReviewPageV1({queryable:fakeQueryable([],{}),workspace,actor,
    generationKey:generation.generation_key,
    filters:parseSignalSemanticContextReviewFiltersV1(new URLSearchParams())});
  assert.deepEqual(empty.facets.review_states,{ready:0,exception:0,resolved:0});
  const sparse=await loadSignalSemanticContextReviewPageV1({
    queryable:fakeQueryable([element(1)],{ready:1}),workspace,actor,generationKey:generation.generation_key,
    filters:parseSignalSemanticContextReviewFiltersV1(new URLSearchParams())});
  assert.deepEqual(sparse.facets.review_states,{ready:1,exception:0,resolved:0});
  const mixed=await loadSignalSemanticContextReviewPageV1({
    queryable:fakeQueryable([element(1)],{ready:2,exception:3,resolved:4}),workspace,actor,
    generationKey:generation.generation_key,
    filters:parseSignalSemanticContextReviewFiltersV1(new URLSearchParams())});
  assert.deepEqual(mixed.facets.review_states,{ready:2,exception:3,resolved:4});
});

test("server cursor is stable, filter-bound, and contains no digest or private authority", async () => {
  const rows = Array.from({ length: 21 }, (_, index) => element(index));
  const queryable = fakeQueryable(rows);
  const filters = parseSignalSemanticContextReviewFiltersV1(new URLSearchParams());
  const page = await loadSignalSemanticContextReviewPageV1({ queryable, workspace, actor,
    generationKey: generation.generation_key, filters });
  assert.deepEqual(page.generation,{
    generation_key:"semantic-context-v6",generation_version:6,primary_locale:"es-MX",
    locale_variants:["en-US","es-MX"],markets:["MX","US"],timezone:"America/Mexico_City"
  },"the page exposes the sealed parent envelope independently of visible element rows");
  assert.equal(page.total, 21);
  assert.equal(page.elements.length, 20);
  assert.ok(page.next_cursor);
  const decoded = Buffer.from(page.next_cursor!, "base64url").toString("utf8");
  assert.doesNotMatch(decoded, /sha256|workspace_id|organization|source_id|profile_id/u);
  assert.match(decoded, /element-19/u);
  const nextFilters = parseSignalSemanticContextReviewFiltersV1(new URLSearchParams(
    `cursor=${encodeURIComponent(page.next_cursor!)}`
  ));
  const nextPage = await loadSignalSemanticContextReviewPageV1({ queryable, workspace, actor,
    generationKey: generation.generation_key, filters: nextFilters });
  assert.equal(nextPage.total, 21);
  assert.deepEqual(nextPage.elements.map((item) => item.element_key), ["element-20"]);
  assert.equal(new Set([...page.elements, ...nextPage.elements].map((item) => item.element_key)).size, 21,
    "cursor pages reconcile exactly with no overlap");
  const changed = parseSignalSemanticContextReviewFiltersV1(new URLSearchParams(
    `disposition=approved&cursor=${encodeURIComponent(page.next_cursor!)}`
  ));
  await assert.rejects(loadSignalSemanticContextReviewPageV1({ queryable: fakeQueryable(rows),
    workspace, actor, generationKey: generation.generation_key, filters: changed }),
  (error: unknown) => (error as { code?: string }).code === "semantic_context_review_cursor_invalid");
});

test("attention flags are deterministic and explicitly non-authoritative", async () => {
  const page = await loadSignalSemanticContextReviewPageV1({ queryable: fakeQueryable([element(1)]),
    workspace, actor, generationKey: generation.generation_key,
    filters: parseSignalSemanticContextReviewFiltersV1(new URLSearchParams()) });
  const projected = page.elements[0]!;
  assert.equal(projected.attention.authoritative, false);
  assert.deepEqual(projected.attention.evidence_reasons, ["one_source_only", "supports_only_evidence"]);
  assert.deepEqual(projected.attention.locale_reasons, ["locale_unassigned", "market_unassigned"]);
  assert.equal(projected.attention.duplicates.authoritative, false);
  assert.equal(page.authority.attention_signals_authoritative, false);
});

test("evidence projection is bounded, redacted, source-readable, and never a pinpoint citation", () => {
  const privateUuid = "123e4567-e89b-42d3-a456-426614174000";
  const sourceTypes = ["brand_os_profile", "brand_os_product", "brand_os_competitor",
    "brand_os_seed_term", "knowledge_source", "knowledge_chunk", "knowledge_assertion"];
  for (const sourceType of sourceTypes) {
    const projected = projectSignalSemanticContextEvidenceSourceV1({
      source_type: sourceType,
      relation_type: "supports",
      position: 0,
      source_title: "Governed source",
      source_kind: "research",
      section_label: "Identity and category",
      source_context: `Context mail test@example.com https://private.example/${privateUuid} /Users/private/file password=private-value Bearer private-token ${"x".repeat(900)}`,
      source_metadata: { locales: ["es-MX"], markets: ["mx"] },
      resolved: true,
      current: true
    });
    assert.equal(projected.source_type, sourceType);
    assert.equal(projected.source_context.label, "context_supplied_to_model");
    assert.equal(projected.source_context.pinpoint_citation, false);
    assert.ok(projected.source_context.truncated);
    assert.match(projected.source_context.preview ?? "", /\[email redacted\]|\[link redacted\]/u);
    assert.doesNotMatch(projected.source_context.preview ?? "", /example\.com|123e4567|\/Users\/|private-value|private-token/u);
    assert.deepEqual(projected.applicability, { locales: ["es-MX"], markets: ["MX"], state: "explicit" });
  }
});

test("evidence relation and unavailable/current states remain exact and operator-safe", () => {
  for (const relationType of ["supports", "limits", "contradicts"] as const) {
    const unavailable = projectSignalSemanticContextEvidenceSourceV1({
      source_type: "knowledge_chunk",
      relation_type: relationType,
      position: 0,
      source_title: null,
      source_kind: null,
      section_label: null,
      source_context: null,
      source_metadata: {},
      resolved: false,
      current: false
    });
    assert.equal(unavailable.relation, relationType);
    assert.equal(unavailable.current_state, "unavailable");
    assert.equal(unavailable.unavailable_reason, "source_unavailable");
    assert.equal(unavailable.source_context.preview, null);
  }
  const inactive = projectSignalSemanticContextEvidenceSourceV1({
    source_type: "knowledge_source",
    relation_type: "limits",
    position: 0,
    source_title: "Archived methodology",
    source_kind: "methodology",
    section_label: "Limitations",
    source_context: "A bounded historical limitation.",
    source_metadata: { locale: "en-US", market: "US" },
    resolved: true,
    current: false
  });
  assert.equal(inactive.current_state, "inactive");
  assert.equal(inactive.unavailable_reason, null);
  assert.deepEqual(inactive.applicability, { locales: ["en-US"], markets: ["US"], state: "explicit" });
});

test("operator-authored provenance is never mislabeled as model context or Brand OS evidence",()=>{
  const projected=projectSignalSemanticContextEvidenceSourceV1({source_type:"semantic_context_operator_input",
    relation_type:"supports",position:0,source_title:"Operator input",source_kind:"operator_input",
    section_label:"Manual addition",source_context:"Authenticated operator input · Alexa routine boundary",
    source_metadata:{},resolved:true,current:true});
  assert.equal(projected.source_context.label,"operator_authored_input");
  assert.equal(projected.source_title,"Operator input");
  assert.equal(projected.current_state,"current");
  assert.doesNotMatch(projected.source_context.preview??"",/Brand OS|Knowledge|model/u);
});

test("review routes and guided UI preserve management AuthZ, privacy, explicit scope, and paging", async () => {
  const root = process.cwd();
  const [pageRoute, detailRoute, summaryRoute, manager, workbench, styles, esMx, enUs] = await Promise.all([
    readFile(resolve(root, "src/app/api/data-os/signal/[workspaceId]/semantic-context/review/route.ts"), "utf8"),
    readFile(resolve(root, "src/app/api/data-os/signal/[workspaceId]/semantic-context/review/[elementKey]/route.ts"), "utf8"),
    readFile(resolve(root, "src/app/api/data-os/signal/[workspaceId]/semantic-context/review/summary/route.ts"), "utf8"),
    readFile(resolve(root, "src/components/brands/SemanticContextPackManager.tsx"), "utf8"),
    readFile(resolve(root, "src/components/brands/SemanticContextReviewWorkbench.tsx"), "utf8"),
    readFile(resolve(root, "src/app/workspace-shell.css"), "utf8"),
    readFile(resolve(root, "messages/es-MX.json"), "utf8"),
    readFile(resolve(root, "messages/en-US.json"), "utf8")
  ]);
  const routes = `${pageRoute}\n${detailRoute}\n${summaryRoute}`;
  assert.match(routes, /loadSignalWorkspaceContextForSemanticContextManagement/gu);
  assert.match(routes, /loadSignalSemanticContextReview(?:Page|Detail)ProductV1/gu);
  assert.doesNotMatch(routes, /POST|Idempotency-Key|generation_key|source_id|workspace_id|provider_response|prompt/gu);
  assert.match(manager, /\/review\/summary/u);
  assert.match(manager, /SemanticContextReviewWorkbench/u);
  assert.match(manager, /reviewWritable=\{generation\.lifecycle_state === "draft"\}/u);
  assert.doesNotMatch(manager, /requestJson\(`\$\{base\}\/publish`/u,
    "manager no longer exposes the unsealed V1 publish action");
  assert.doesNotMatch(manager, /brand_os_digest|knowledge_digest|locale_context_digest|semantic_context_pack_digest/u);
  assert.match(workbench, /submitSignalSemanticContextBulkApprovalFormUiV2/u);
  assert.match(workbench, /submitSignalSemanticContextDeliberateApprovalFormUiV2/u);
  assert.match(workbench, /signalSemanticContextBoundedPendingSelectionV1/u);
  assert.match(workbench, /submitSignalSemanticContextGuidedRejectUiV1/u);
  assert.match(workbench, /submitSignalSemanticContextMergeUiV1/u);
  assert.match(workbench, /mutationLockRef\.current\.begin\(\)/u);
  assert.match(workbench, /if \(!beginMutation\("(?:approve|bulk|reject|correct|annotate|merge)"\)\) return/gu);
  assert.match(workbench, /signalSemanticContextSelectionWithinVisiblePageV1/u);
  assert.match(workbench, /setSelected\(new Map\(\)\);\s*setMergeOpen\(false\);/u,
    "page changes clear the exact operator selection");
  assert.match(workbench, /handleSignalSemanticContextDecisionKeyV1/u);
  assert.match(workbench, /cancel:\(\)=>\{setDetailMode\("view"\);setAnnotationResolutionDraft\(null\);\}/u,
    "Escape cancels both decision and annotation-resolution drafts without writing");
  assert.match(workbench, /submitSignalSemanticContextAnnotationResolutionFormUiV1/u);
  assert.match(workbench, /DecisionBasisHistory/u);
  assert.match(workbench, /disposition === "merged" \? "not_available"/u,
    "merged is neutral lineage rather than a rejected error state");
  assert.match(workbench, /"operator_merge"/u);
  assert.match(workbench, /errorRecovery === "preflight" \? \(\) => void loadPublicationPreflight\(\)/u,
    "preflight errors retry the preflight rather than reloading the proposal page");
  assert.match(workbench, /onRetry\?: \(\) => void/u,
    "mutation feedback may remain actionable without a misleading generic reload");
  assert.match(workbench, /\/publish\/preflight/u);
  assert.doesNotMatch(workbench, /provider_response|raw_prompt|brand_os_digest|knowledge_digest|preflight_digest/u);
  assert.match(workbench, /next_cursor/u);
  assert.match(workbench, /formatAdminDate\(element\.provenance\.proposed_at, locale/u);
  assert.match(workbench, /context_supplied_to_model/u);
  assert.match(styles, /\.semantic-context-review__row-button:focus-visible/u);
  assert.match(styles, /@media \(max-width: 700px\)/u);
  assert.match(styles, /\.semantic-context-review__publication-counts/u);
  assert.match(styles, /font-size: 12px/u);
  for (const messages of [JSON.parse(esMx), JSON.parse(enUs)]) {
    const review = messages.AdminWorkspace.brandOs.semanticContext.reviewWorkbench;
    assert.equal(typeof review.evidence.notCitation, "string");
    assert.equal(typeof review.attention.body, "string");
    assert.equal(typeof review.pagination.next, "string");
    assert.equal(typeof review.merge.crossKind, "string");
    assert.equal(typeof review.annotations.types.near_duplicate, "string");
    assert.equal(typeof review.annotations.deliberate.resolveTitle, "string");
    assert.equal(typeof review.annotations.deliberate.repairAction, "string");
    assert.equal(typeof review.annotations.deliberate.resolveConfirmation, "string");
    assert.equal(typeof review.publication.blockers.annotation_resolution_basis_missing, "string");
    assert.equal(typeof review.publication.confirmationBoundary, "string");
    assert.equal(typeof review.decisionBasis.historicalMissing, "string");
  }
});

function fakeQueryable(items: ReturnType<typeof element>[],automaticCounts:Record<string,number>={}) {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM signal_semantic_context_generations generation")) {
        return { rows: [generation], rowCount: 1 };
      }
      const after = params.find((value) => typeof value === "string" && /^element-[0-9]+$/u.test(value));
      const pageItems = typeof after === "string"
        ? items.filter((item) => item.element_key > after)
        : items;
      return { rows: [{
        total: items.length,
        items: pageItems,
        kind_counts: { feature: items.filter((item) => item.element_kind === "feature").length,
          need: items.filter((item) => item.element_kind === "need").length },
        scope_counts: { category: items.filter((item) => item.scope === "category").length,
          primary_brand: items.filter((item) => item.scope === "primary_brand").length },
        disposition_counts: { pending: items.length },
        automatic_counts: automaticCounts
      }], rowCount: 1 };
    }
  } as unknown as SignalBrandPolicyQueryable;
}

function summaryQueryable(args: { brief: boolean; generationCount: number; unknownError?: boolean }) {
  return {
    query: async (sql: string) => {
      if (sql.includes("FROM brand_os_profiles")) {
        if (args.unknownError) throw new Error("unexpected_summary_failure");
        return { rows: [{ id: "00000000-0000-4000-8000-000000000006", version: 1,
          digest: `sha256:${"a".repeat(64)}` }], rowCount: 1 };
      }
      if (sql.includes("count(*)::int generation_count")) {
        return { rows: [{ generation_count: args.generationCount }], rowCount: 1 };
      }
      if (sql.includes("FROM signal_semantic_context_generations generation")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM signal_acquisition_plans")) {
        return { rows: args.brief ? [{ brief: { languages: ["en-US"], countries: ["US"],
          primary_locale: "en-US", timezone: "UTC" } }] : [], rowCount: args.brief ? 1 : 0 };
      }
      if (sql.includes("FROM knowledge_chunks")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM brand_knowledge_sources source")) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected summary query: ${sql.slice(0, 80)}`);
    }
  } as unknown as SignalBrandPolicyQueryable;
}
