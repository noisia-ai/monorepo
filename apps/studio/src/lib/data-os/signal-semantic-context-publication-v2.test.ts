import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canonicalJsonV2,
  digestCanonicalJsonV2,
  normalizeSignalSemanticContextDecisionBasisV2,
  normalizeSignalSemanticContextAnnotationResolutionBasisV1,
  signalSemanticContextDecisionElementDigestV2,
  SIGNAL_SEMANTIC_CONTEXT_PUBLICATION_CONFIRMATION_V2
} from "@/lib/data-os/signal-semantic-context-publication-v2";

const vectors: Array<{ name: string; value: unknown; canonical: string; digest: string }> = [
  {
    name: "quote, slash, backslash and controls",
    value: { s: "quote\" slash/ backslash\\ LF\n NUL\0" },
    canonical: "{\"s\":\"quote\\\" slash/ backslash\\\\ LF\\u000A NUL\\u0000\"}",
    digest: "sha256:c0998b854a4e659786347d2f3bdbed948fe8091f73161be23a18e21e50a53b41"
  },
  {
    name: "combining NFC",
    value: { s: "Cafe\u0301" },
    canonical: "{\"s\":\"Café\"}",
    digest: "sha256:d4f21edc957c8d5f5c6ba620f820dabb8b4afc2398a7603cf49e875cf2a36269"
  },
  {
    name: "astral scalar",
    value: { s: "🧠" },
    canonical: "{\"s\":\"🧠\"}",
    digest: "sha256:b2d883dfb70d681a2de3ee4bc8866c220e62896dc61a333cd348fe7a01c37283"
  },
  {
    name: "line and paragraph separators",
    value: { s: "a\u2028b\u2029c" },
    canonical: "{\"s\":\"a\\u2028b\\u2029c\"}",
    digest: "sha256:7970f45418dae559568b46bf9e8df590584d1f531ad30fe670521565d2b36cf4"
  },
  {
    name: "byte-ordered object and arrays",
    value: { b: 2, a: [3, { z: "last", a: "first" }] },
    canonical: "{\"a\":[3,{\"a\":\"first\",\"z\":\"last\"}],\"b\":2}",
    digest: "sha256:c707db5812c5616df37b78e3147bfb3ae755ffd7b0f716e42321a4ac92099111"
  }
];

for (const vector of vectors) {
  test(`canonical_json_v2 matches frozen vector: ${vector.name}`, () => {
    assert.equal(canonicalJsonV2(vector.value), vector.canonical);
    assert.equal(digestCanonicalJsonV2(vector.value), vector.digest);
  });
}

test("canonical_json_v2 rejects lone surrogates, floats, and normalized-key collisions", () => {
  assert.throws(() => canonicalJsonV2({ s: "\ud800" }), /canonical_json_v2_lone_surrogate/u);
  assert.throws(() => canonicalJsonV2({ s: "\udc00" }), /canonical_json_v2_lone_surrogate/u);
  assert.throws(() => canonicalJsonV2({ n: 1.5 }), /canonical_json_v2_integer_required/u);
  assert.throws(() => canonicalJsonV2({ "Café": 1, "Cafe\u0301": 2 }), /canonical_json_v2_key_collision/u);
});

test("annotation resolution basis is explicit, closed, normalized, and independent of predecessor rationale",()=>{
  assert.deepEqual(normalizeSignalSemanticContextAnnotationResolutionBasisV1({annotationType:"uncertain",
    resolution:"not_supported",reason:"insufficient_context",rationale:"  Cafe\u0301 lacks support.  "}),{
    contract_version:"signal-semantic-context-annotation-resolution-v1",annotation_type:"uncertain",
    resolution:"not_supported",reason:"insufficient_context",rationale:"Café lacks support."});
  assert.throws(()=>normalizeSignalSemanticContextAnnotationResolutionBasisV1({annotationType:"uncertain",
    resolution:"not_supported",reason:"insufficient_context",rationale:"\t\u00a0"}),/rationale/u);
  assert.throws(()=>normalizeSignalSemanticContextAnnotationResolutionBasisV1({annotationType:"near_duplicate",
    resolution:"merged",reason:"duplicate_same_concept",rationale:"Use the merge writer."}),
  /semantic_context_merge_operation_required/u);
  assert.throws(()=>normalizeSignalSemanticContextAnnotationResolutionBasisV1({annotationType:"uncertain",
    resolution:"outside_contract" as never,reason:"insufficient_context",rationale:"Reviewed."}),
  /semantic_context_annotation_resolution_invalid/u);
  assert.throws(()=>normalizeSignalSemanticContextAnnotationResolutionBasisV1({annotationType:"uncertain",
    resolution:"not_supported",reason:"outside_contract" as never,rationale:"Reviewed."}),
  /semantic_context_decision_reason_invalid/u);
});

test("canonical publish route exposes only V2 confirmation and preflight authority", async () => {
  const route = await readFile(new URL("../../app/api/data-os/signal/[workspaceId]/semantic-context/publish/route.ts",
    import.meta.url), "utf8");
  assert.match(route, /preflight_digest/u);
  assert.match(route, /z\.literal\(SIGNAL_SEMANTIC_CONTEXT_PUBLICATION_CONFIRMATION_V2\)/u);
  assert.equal(SIGNAL_SEMANTIC_CONTEXT_PUBLICATION_CONFIRMATION_V2, "publish_reviewed_semantic_context_v2");
  assert.doesNotMatch(route, /z\.literal\("publish_reviewed_semantic_context"\)/u);
  for (const browserOwned of ["candidate_pack_digest", "evidence_graph_digest", "review_graph_digest",
    "publication_authority_digest", "semantic_context_pack_digest", "element_id", "actor_user_id"]) {
    assert.doesNotMatch(route, new RegExp(browserOwned, "u"));
  }
});

test("closed OpenAPI publication counts match the runtime preflight including annotation resolution basis",async()=>{
  const openApi=await readFile(new URL("../../../../../docs/api/openapi.yaml",import.meta.url),"utf8");
  const schema=openApi.match(/    SignalSemanticContextPublicationPreflightV2:\n([\s\S]*?)\n    SignalSemanticContextProposalStartV1:/u)?.[1];
  assert.ok(schema,"the publication preflight schema exists in the tracked OpenAPI document");
  const counts=schema.match(/        counts:\n([\s\S]*?)\n        collisions:/u)?.[1];
  assert.ok(counts,"the publication preflight exposes one closed counts object");
  const requiredText=counts.match(/          required: \[([\s\S]*?)\]\n          properties:/u)?.[1];
  assert.ok(requiredText,"the counts object has an explicit required list");
  const required=requiredText.split(",").map((value)=>value.trim()).filter(Boolean).sort();
  const properties=[...counts.matchAll(/^            ([a-z_]+): \{ type: integer, minimum: 0 \}$/gmu)]
    .map((match)=>match[1]!).sort();
  const expected=["total_leaves","pending","approved","rejected","merged","open_annotations",
    "open_uncertainty","open_near_duplicate","unresolved_locale","unresolved_competitive_unit",
    "merge_edges","canonical_collisions","invalid_evidence_refs","invalid_relation_targets",
    "decision_basis_missing","annotation_resolution_basis_missing"].sort();
  assert.deepEqual(required,expected,"all runtime counters are required by the closed response contract");
  assert.deepEqual(properties,expected,"OpenAPI declares no missing or unowned count property");
  const assertCounts=(value:Record<string,number>)=>{
    assert.deepEqual(Object.keys(value).sort(),properties,"additional or missing counters fail closed");
    for(const entry of Object.values(value))assert.ok(Number.isInteger(entry)&&entry>=0,
      "publication counters are non-negative integers");
  };
  const runtimeShape=Object.fromEntries(expected.map((key)=>[key,key==="annotation_resolution_basis_missing"?1:0]));
  assertCounts(runtimeShape);
  assert.throws(()=>assertCounts(Object.fromEntries(Object.entries(runtimeShape)
    .filter(([key])=>key!=="annotation_resolution_basis_missing"))),/additional or missing/u,
  "omitting the runtime basis counter violates the closed OpenAPI contract");
  assert.throws(()=>assertCounts({...runtimeShape,unowned_counter:0}),/additional or missing/u,
  "an extra runtime counter also violates the closed OpenAPI contract");
});

test("management routes keep review authority server-owned and private", async () => {
  const routes = await Promise.all([
    "merge/route.ts",
    "corrections/route.ts",
    "annotations/route.ts",
    "publish/preflight/route.ts"
  ].map((path) => readFile(new URL(`../../app/api/data-os/signal/[workspaceId]/semantic-context/${path}`,
    import.meta.url), "utf8")));
  for (const route of routes) {
    assert.match(route, /loadSignalWorkspaceContextForSemanticContextManagement/u);
    assert.doesNotMatch(route, /evidence_(?:id|group_id)|actor_user_id|publication_authority_digest/u);
  }
  for (const route of routes.slice(0, 3)) {
    assert.match(route, /requireIdempotencyKey/u);
    assert.match(route, /\.strict\(\)/u);
  }
  for (const route of routes.slice(0, 2)) {
    assert.match(route, /annotation_key must be unique/u,
      "merge and correction reject repeated or contradictory annotation resolutions at Zod");
  }
  const annotationRoute=routes[2]!;
  assert.match(annotationRoute,/const command=z\.union\(\[createCommand,resolveCommand,repairCommand\]\)/u);
  assert.match(annotationRoute,/SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONFIRMATION_V1/u);
  assert.match(annotationRoute,/SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_REPAIR_CONFIRMATION_V1/u);
  assert.doesNotMatch(annotationRoute,/resolution:z\.enum\([^\n]+\)\.optional\(\)/u,
    "the annotation creation contract cannot silently resolve from the same command");
  const service = await readFile(new URL("./signal-semantic-context-publication-v2.ts", import.meta.url), "utf8");
  assert.match(service, /semantic_context_duplicate_annotation_resolution/u,
    "the server writer independently rejects repeated annotation keys");
  assert.match(service, /draft_digest_ref/u);
  assert.doesNotMatch(service, /draft_digest:draftDigest/u,
    "operator-safe merge and correction responses never expose the complete draft digest");
  const shared = await readFile(new URL(
    "../../app/api/data-os/signal/[workspaceId]/semantic-context/_lib.ts", import.meta.url), "utf8");
  assert.match(shared, /private, no-store/u);
});

test("browser decisions retire V1 edit and route guided rejection through the atomic V2 writer", async () => {
  const route = await readFile(new URL(
    "../../app/api/data-os/signal/[workspaceId]/semantic-context/decisions/route.ts", import.meta.url), "utf8");
  assert.match(route, /semantic_context_edit_v1_retired/u);
  assert.ok(route.includes("},410)"));
  assert.doesNotMatch(route, /action:z\.literal\("edit"\)/u);
  assert.match(route, /rejectSignalSemanticContextElementProductV2/u);
  assert.match(route, /decideSignalSemanticContextElementProductV2/u);
  assert.match(route, /bulkApproveSignalSemanticContextElementsProductV2/u);
  assert.doesNotMatch(route, /decideSignalSemanticContextElementProductV1|bulkApproveSignalSemanticContextElementsProductV1/u);
  assert.match(route, /reason:z\.enum\(SIGNAL_SEMANTIC_CONTEXT_REVIEW_REASONS_V2\)/u);
  assert.match(route, /\.normalize\("NFC"\)/u);
  assert.match(route, /\[\.\.\.value\]\.length/u,
    "the HTTP boundary uses the same Unicode-scalar limit as TypeScript and PostgreSQL");
  assert.match(route, /element_keys:z\.array\(key\)\.min\(2\)\.max\(15\)/u);
  assert.match(route, /SIGNAL_SEMANTIC_CONTEXT_APPROVAL_CONFIRMATION_V2/u);
  assert.match(route, /SIGNAL_SEMANTIC_CONTEXT_BULK_APPROVAL_CONFIRMATION_V2/u);
  assert.doesNotMatch(route, /workspace_id|authority_digest|proposal_model/u);
});

test("all V1 decision entrances are terminal tombstones", async () => {
  const service = await readFile(new URL("./signal-semantic-context-pack.ts", import.meta.url), "utf8");
  assert.match(service, /semantic_context_decision_v1_retired/u);
  assert.match(service, /semantic_context_bulk_approval_v1_retired/u);
  assert.equal((service.match(/await assertV1ReviewMutationCurrent\(/gu) ?? []).length, 0);
});

test("decision basis is closed, NFC-normalized, scalar-bounded, and digest-authoritative", () => {
  assert.deepEqual(normalizeSignalSemanticContextDecisionBasisV2({
    reason: "semantic_boundary", rationale: "  Cafe\u0301 boundary  "
  }), { contract_version: "signal-semantic-context-decision-v2", reason: "semantic_boundary",
    rationale: "Café boundary" });
  assert.throws(() => normalizeSignalSemanticContextDecisionBasisV2({
    reason: "open_reason" as never, rationale: "Valid rationale"
  }), /semantic_context_decision_reason_invalid/u);
  assert.throws(() => normalizeSignalSemanticContextDecisionBasisV2({
    reason: "semantic_boundary", rationale: "   "
  }), /semantic_context_rationale_invalid/u);
  assert.throws(() => normalizeSignalSemanticContextDecisionBasisV2({
    reason: "semantic_boundary", rationale: "🧠".repeat(1001)
  }), /semantic_context_rationale_invalid/u);
  assert.equal([...normalizeSignalSemanticContextDecisionBasisV2({
    reason: "semantic_boundary", rationale: "🧠".repeat(1000)
  }).rationale].length, 1000);
  const definition = { element_key: "identity-a", element_kind: "identity_term", canonical_key: "identity-a",
    display_text: "Identity A", scope: "primary_brand", entity_type: "brand", entity_id: null, locale: "es-MX",
    relation_kind: null, relation_target_key: null };
  const first = signalSemanticContextDecisionElementDigestV2({ definition, elementVersion: 2,
    disposition: "approved", sourceRefsDigest: "sha256:" + "a".repeat(64),
    basis: normalizeSignalSemanticContextDecisionBasisV2({ reason: "semantic_boundary", rationale: "First basis" }) });
  const second = signalSemanticContextDecisionElementDigestV2({ definition, elementVersion: 2,
    disposition: "approved", sourceRefsDigest: "sha256:" + "a".repeat(64),
    basis: normalizeSignalSemanticContextDecisionBasisV2({ reason: "semantic_boundary", rationale: "Second basis" }) });
  assert.notEqual(first, second, "rationale participates in the element digest");
});

test("review UI opens deliberate approval forms and never posts from the first click", async () => {
  const component = await readFile(new URL("../../components/brands/SemanticContextReviewWorkbench.tsx",
    import.meta.url), "utf8");
  assert.match(component, /onClick=\{\(\) => onMode\("approve"\)\}/u);
  assert.match(component, /setBulkApproveOpen\(true\)/u);
  assert.doesNotMatch(component, /onClick=\{onApprove\}/u);
  assert.match(component, /apply_shared_decision_basis_to_all_selected_elements/u);
  assert.match(component, /DecisionBasisHistory/u,
    "the operator-safe detail keeps the sealed reason and rationale visible in history");
  assert.match(component, /\.trim\(\)\.normalize\("NFC"\)\]\.length>1000/u,
    "the browser applies the same Unicode-scalar bound before submit");
});
