import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canonicalJsonV2,
  digestCanonicalJsonV2,
  normalizeSignalSemanticContextDecisionBasisV2,
  normalizeSignalSemanticContextAnnotationResolutionBasisV1,
  normalizeSignalSemanticContextLocaleDecisionBasisV1,
  signalSemanticContextOperatorElementKeyV1,
  signalSemanticContextLocaleDecisionElementDigestV1,
  signalSemanticContextDecisionElementDigestV2,
  SIGNAL_SEMANTIC_CONTEXT_PUBLICATION_CONFIRMATION_V2
} from "@/lib/data-os/signal-semantic-context-publication-v2";

test("operator-created element keys preserve publication collision identity across raw locales",()=>{
  const inherited=signalSemanticContextOperatorElementKeyV1("alias","alexa-name",null);
  const explicitGlobal=signalSemanticContextOperatorElementKeyV1("alias","alexa-name",null);
  const en=signalSemanticContextOperatorElementKeyV1("alias","alexa-name","en-US");
  const es=signalSemanticContextOperatorElementKeyV1("alias","alexa-name","es-MX");
  assert.equal(inherited,explicitGlobal,"inherited and explicit global share the raw-locale collision identity");
  assert.notEqual(en,es,"the same kind/canonical pair remains distinct across sealed locales");
  assert.notEqual(inherited,en);
  assert.match(en,/\.en-us$/u);
});

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
  const expected=["total_leaves","pending","approved","rejected","merged","archived","open_annotations",
    "open_uncertainty","open_near_duplicate","unresolved_locale","unresolved_competitive_unit",
    "merge_edges","canonical_collisions","invalid_evidence_refs","invalid_relation_targets",
    "decision_basis_missing","annotation_resolution_basis_missing",
    "locale_market_required_unresolved"].sort();
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
  assert.doesNotMatch(routes[0]!,/\blocale\s*:/u,
    "merge cannot accept browser-owned locale in its generic correction payload");
  assert.doesNotMatch(routes[1]!,/\blocale\s*:/u,
    "correction cannot accept browser-owned locale");
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
  const localeAuthorityRoute=await readFile(new URL(
    "../../app/api/data-os/signal/[workspaceId]/semantic-context/locale-authority/route.ts",import.meta.url),"utf8");
  assert.match(localeAuthorityRoute,/loadSignalWorkspaceContextForSemanticContextManagement/u);
  assert.match(localeAuthorityRoute,/requireIdempotencyKey/u);
  assert.match(localeAuthorityRoute,/z\.discriminatedUnion\("disposition"/u);
  assert.match(localeAuthorityRoute,/element_keys: z\.array\(key\)\.min\(1\)\.max\(15\)/u);
  assert.match(localeAuthorityRoute,/SIGNAL_SEMANTIC_CONTEXT_LOCALE_DECISION_CONFIRMATION_V1/u);
  assert.doesNotMatch(localeAuthorityRoute,/workspace_id|actor_user_id|authority_digest|brand_os_digest/u);
});

test("simple creation route is closed, idempotent, and excludes browser authority",async()=>{
  const route=await readFile(new URL(
    "../../app/api/data-os/signal/[workspaceId]/semantic-context/elements/route.ts",import.meta.url),"utf8");
  const service=await readFile(new URL("./signal-semantic-context-publication-v2.ts",import.meta.url),"utf8");
  const migration=await readFile(new URL(
    "../../../../../infrastructure/db/migrations/0103_signal_semantic_context_simple_creation.sql",
    import.meta.url),"utf8");
  assert.match(route,/loadSignalWorkspaceContextForSemanticContextManagement/u);
  assert.match(route,/requireIdempotencyKey/u);assert.match(route,/\.strict\(\)/u);
  assert.doesNotMatch(route,/actor_user_id|element_key:z\.|evidence_(?:id|group_id)|disposition:z\.|creation_basis/u);
  assert.match(service,/semantic_context_operator_input/u);
  assert.match(service,/collision:true/u);assert.doesNotMatch(service,/auto.?merge/iu);
  assert.match(migration,/signal_semantic_context_creation_authority_valid_v1/u);
  assert.match(migration,/signal_semantic_context_operator_element_key_v1\(kind text,canonical_key text,raw_locale text\)/u);
  assert.match(migration,/DEFERRABLE INITIALLY DEFERRED/u);
  assert.match(migration,/operator_element_created/u);
});

test("ordinary edit authority is a closed command with a PostgreSQL backstop", async () => {
  const route = await readFile(new URL(
    "../../app/api/data-os/signal/[workspaceId]/semantic-context/elements/[elementKey]/commands/route.ts",
    import.meta.url), "utf8");
  const service = await readFile(new URL("./signal-semantic-context-publication-v2.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL(
    "../../../../../infrastructure/db/migrations/0102_signal_semantic_context_ordinary_editing.sql",
    import.meta.url), "utf8");
  assert.match(route,/loadSignalWorkspaceContextForSemanticContextManagement/u);
  assert.match(route,/requireIdempotencyKey/u);
  assert.match(route,/edit-semantic-context-element-v1/u);
  assert.doesNotMatch(route,/reason|rationale|confirmation|actor_user_id|evidence_group_id|authority_digest/u);
  assert.match(service,/save|undo|archive|restore/u);
  assert.match(service,/signal-semantic-context-ordinary-audit-v1/u);
  assert.match(migration,/validate_signal_semantic_context_ordinary_command_v1/u);
  assert.match(migration,/DEFERRABLE INITIALLY DEFERRED/u);
  assert.match(migration,/lifecycle_state IN \('active','archived'\)/u);
  assert.match(migration,/edit-semantic-context-element-v1/u);
  assert.match(migration,/signal_semantic_context_safe_positive_int_v1/u,
    "malformed browser versions fail closed without unsafe casts in publication checks");
  assert.match(migration,/target\.locale_decision_poststate_digest/u,
    "undo binds the successor payload and locale lineage to the selected target version");
  assert.match(migration,/predecessor\.disposition='archived'[\s\S]*element\.disposition='approved'/u,
    "restore is valid only from the archived lifecycle");
  assert.match(service,/afterLocaleFields:localeFields/u);
  assert.match(service,/field:"applicability"/u,
    "applicability-only edits remain present in the exact audit diff");
  const openApi=await readFile(new URL("../../../../../docs/api/openapi.yaml",import.meta.url),"utf8");
  const review=openApi.match(/    SignalSemanticContextReviewElementV1:\n([\s\S]*?)\n    SignalSemanticContextReviewPageV1:/u)?.[1];
  assert.ok(review);assert.match(review,/required: \[element_key, element_version, state_token, lifecycle_state, undo_target_version,/u);
  assert.match(review,/enum: \[pending, approved, rejected, merged, archived\]/u);
});

test("0104 counts archived leaves without weakening fork or merge-cycle publication guards",async()=>{
  const migration=await readFile(new URL(
    "../../../../../infrastructure/db/migrations/0104_signal_semantic_context_archived_publication_accounting.sql",
    import.meta.url),"utf8");
  assert.match(migration,/RENAME TO signal_semantic_context_publication_snapshot_pre_0104/u);
  assert.match(migration,/disposition='archived' AND lifecycle_state='archived'/u);
  assert.match(migration,/total_leaves<>pending_count\+approved_count\+rejected_count\+merged_count\+archived_count/u);
  assert.match(migration,/fork_count>0 OR cycle_count>0/u,
    "the archived equation cannot suppress structural graph corruption");
  assert.match(migration,/WHERE value<>'graph_count_inconsistent'/u);
  assert.match(migration,/signal_semantic_context_digest_json_v2\(preflight\)/u,
    "the exact nested preflight remains the sole digest source");
  assert.doesNotMatch(migration,/UPDATE |INSERT INTO |DELETE FROM /u,
    "the publication snapshot correction is read-only");
});

test("generic correction and merge preserve locale authority outside the dedicated writer", async()=>{
  const service=await readFile(new URL("./signal-semantic-context-publication-v2.ts",import.meta.url),"utf8");
  assert.match(service,/entity_id:current\.entity_id,locale:current\.locale/u);
  assert.match(service,/entity_id:target\.entity_id,locale:target\.locale/u);
  assert.match(service,/sourceRefs:refs,current\}/u);
  assert.match(service,/sourceRefs:union,current:target/u);
  assert.match(service,/locale_decision_contract_version,locale_decision_disposition/u);
  const openApi=await readFile(new URL("../../../../../docs/api/openapi.yaml",import.meta.url),"utf8");
  const correction=openApi.match(/    SignalSemanticContextCorrectionFieldsV2:\n([\s\S]*?)\n    SignalSemanticContextAnnotationResolutionV2:/u)?.[1];
  assert.ok(correction);assert.doesNotMatch(correction,/\n\s+locale:/u);
});

test("0101 keeps applicability sources and publication versions causally distinct",async()=>{
  const migration=await readFile(new URL(
    "../../../../../infrastructure/db/migrations/0101_signal_semantic_context_inherited_applicability.sql",
    import.meta.url),"utf8");
  const proposalContract=await readFile(new URL(
    "../../../../../packages/query-engine/src/signal-semantic-context-proposal-v1.ts",import.meta.url),"utf8");
  assert.match(migration,/element\.locale_decision_contract_version IS NOT NULL[\s\S]*operator_locale_authority/u,
    "a dedicated explicit-locale decision projects operator authority");
  assert.match(migration,/ELSE 'sealed_element_locale' END/u,
    "a provider-origin locale retains its distinct sealed-element source");
  assert.match(migration,/element\.element_kind='locale_variant'[\s\S]*locale_specific_locale_required/u,
    "the sole closed locale-specific element kind fails closed without a locale");
  const kindBlock=proposalContract.match(/SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_ELEMENT_KINDS = \[([\s\S]*?)\] as const/u)?.[1];
  assert.ok(kindBlock);assert.equal((kindBlock.match(/"locale_variant"/gu)??[]).length,1);
  assert.doesNotMatch(proposalContract,/requires_locale|locale_required|market_specific/u,
    "the closed provider contract exposes no second locale-specific discriminator or browser flag");
  assert.match(migration,/signal-semantic-context-candidate-pack-v3/u);
  assert.match(migration,/signal-semantic-context-publication-graph-v3/u);
  const service=await readFile(new URL("./signal-semantic-context-publication-v2.ts",import.meta.url),"utf8");
  assert.match(service,/SIGNAL_SEMANTIC_CONTEXT_PUBLICATION_SCHEMA_V2/u);
  assert.match(service,/signal-semantic-context-publication-v2/u,
    "the atomic writer envelope remains publication V2 while inner content graphs advance forward-only");
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

test("locale/global decision basis is closed, normalized, and part of the pending successor digest", () => {
  const global = normalizeSignalSemanticContextLocaleDecisionBasisV1({
    disposition: "global",
    locale: null,
    reason: "locale_resolution",
    rationale: "  Applies across the sealed MX and US authority.  "
  });
  assert.deepEqual(global, {
    contract_version: "signal-semantic-context-locale-decision-v1",
    disposition: "global",
    locale: null,
    reason: "locale_resolution",
    rationale: "Applies across the sealed MX and US authority."
  });
  const localeSpecific = normalizeSignalSemanticContextLocaleDecisionBasisV1({
    disposition: "locale_specific",
    locale: "es-MX",
    reason: "locale_resolution",
    rationale: "This reviewed concept is specific to the sealed es-MX locale."
  });
  assert.equal(localeSpecific.locale, "es-MX");
  assert.throws(() => normalizeSignalSemanticContextLocaleDecisionBasisV1({
    disposition: "global", locale: "es-MX", reason: "locale_resolution", rationale: "Invalid pair."
  }), /semantic_context_locale_decision_shape_invalid/u);
  assert.throws(() => normalizeSignalSemanticContextLocaleDecisionBasisV1({
    disposition: "locale_specific", locale: null, reason: "locale_resolution", rationale: "Invalid pair."
  }), /semantic_context_locale_decision_shape_invalid/u);

  const definition = { element_key: "need-a", element_kind: "need", canonical_key: "need-a",
    display_text: "Need A", scope: "primary_brand", entity_type: "brand", entity_id: null,
    locale: null, relation_kind: null, relation_target_key: null };
  const first = signalSemanticContextLocaleDecisionElementDigestV1({ definition, elementVersion: 3,
    sourceRefsDigest: "sha256:" + "a".repeat(64), basis: global });
  const second = signalSemanticContextLocaleDecisionElementDigestV1({ definition, elementVersion: 3,
    sourceRefsDigest: "sha256:" + "a".repeat(64), basis: { ...global, rationale: "A different basis." } });
  assert.notEqual(first, second, "the deliberate locale/global basis is sealed into the pending successor");
});

test("locale authority management route accepts only server-resolved bounded commands", async () => {
  const route = await readFile(new URL(
    "../../app/api/data-os/signal/[workspaceId]/semantic-context/locale-authority/route.ts",
    import.meta.url), "utf8");
  assert.match(route, /loadSignalWorkspaceContextForSemanticContextManagement/u);
  assert.match(route, /requireIdempotencyKey/u);
  assert.match(route, /element_keys:\s*z\.array\(key\)\.min\(1\)\.max\(15\)/u);
  assert.match(route, /z\.literal\("global"\)/u);
  assert.match(route, /z\.literal\("locale_specific"\)/u);
  assert.match(route, /SIGNAL_SEMANTIC_CONTEXT_LOCALE_DECISION_CONFIRMATION_V1/u);
  assert.match(route, /\.strict\(\)/u);
  assert.doesNotMatch(route,
    /workspace_id|generation_id|element_id|actor_user_id|authority_digest|locale_context_digest|provider/u);
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
