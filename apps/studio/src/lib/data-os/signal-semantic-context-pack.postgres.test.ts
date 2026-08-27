import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import pg from "pg";

import { SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V3,
  type SignalSemanticContextProviderLineageV1 } from "@noisia/query-engine";
import {
  buildSignalSemanticContextProposalRuntimeLineageV1,
  loadSignalSemanticContextProposalPreflightRuntimeV1,
  prepareSignalSemanticContextProposalInputV1,
  type SignalSemanticContextProposalRuntimeConfigurationV1
} from "@noisia/db";

import {
  appendSignalSemanticContextProposalsV1,
  bulkApproveSignalSemanticContextElementsV1,
  createSignalSemanticContextDraftV1,
  createSignalSemanticContextDraftProductV1,
  decideSignalSemanticContextElementV1,
  loadSignalSemanticContextProposalPreflightV1,
  loadSignalSemanticContextReadinessV1,
  publishSignalSemanticContextGenerationV1,
  reconcileSignalSemanticContextGenerationProductV1,
  reconcileSignalSemanticContextGenerationV1
} from "@/lib/data-os/signal-semantic-context-pack";
import {
  annotateSignalSemanticContextElementV2,
  bulkApproveSignalSemanticContextElementsV2,
  correctSignalSemanticContextElementV2,
  createSignalSemanticContextElementV1,
  decideSignalSemanticContextLocaleAuthorityV1,
  decideSignalSemanticContextElementV2,
  digestCanonicalJsonV2,
  editSignalSemanticContextElementV1,
  loadSignalSemanticContextPublicationPreflightV2,
  loadSignalSemanticContextCreationGuidanceV1,
  mergeSignalSemanticContextElementsV2,
  normalizeSignalSemanticContextAnnotationResolutionBasisV1,
  normalizeSignalSemanticContextDecisionBasisV2,
  publishSignalSemanticContextGenerationV2,
  repairSignalSemanticContextAnnotationResolutionV1,
  rejectSignalSemanticContextElementV2,
  resolveSignalSemanticContextAnnotationV1,
  signalSemanticContextAnnotationStateDigestV1,
  signalSemanticContextLocaleDecisionElementDigestV1,
  SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_REPAIR_CONFIRMATION_V1,
  SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONTRACT_V1,
  SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONFIRMATION_V1,
  SIGNAL_SEMANTIC_CONTEXT_APPROVAL_CONFIRMATION_V2,
  SIGNAL_SEMANTIC_CONTEXT_BULK_APPROVAL_CONFIRMATION_V2,
  SIGNAL_SEMANTIC_CONTEXT_LOCALE_DECISION_CONFIRMATION_V1,
  SIGNAL_SEMANTIC_CONTEXT_PUBLICATION_CONFIRMATION_V2,
  type SignalSemanticContextOrdinaryValuesV1
} from "@/lib/data-os/signal-semantic-context-publication-v2";
import {
  loadSignalSemanticContextReviewDetailV1,
  loadSignalSemanticContextReviewPageV1,
  loadSignalSemanticContextReviewSummaryV1,
  parseSignalSemanticContextReviewFiltersV1
} from "@/lib/data-os/signal-semantic-context-review";
import { withSignalAcquisitionTransactionV1 } from "@/lib/data-os/signal-acquisition-plan";
import type { SignalBrandPolicyQueryable } from "@/lib/data-os/signal-governed-brand-policy";
import { beginSignalProductOperationV1 } from "@/lib/data-os/signal-product-operation";
import { pool } from "@/lib/db";

const DB_URL=process.env.NOISIA_SIGNAL_SEMANTIC_CONTEXT_INTEGRATION_URL;
const APPROVED=process.env.NOISIA_SIGNAL_SEMANTIC_CONTEXT_INTEGRATION_APPROVED==="true";
const digest=(value:string)=>`sha256:${createHash("sha256").update(value).digest("hex")}`;
const terminalPreflightConfiguration:SignalSemanticContextProposalRuntimeConfigurationV1={
  available:true,provider:"anthropic",model:"claude-sonnet-4-6",model_version:"claude-sonnet-4-6",
  pricing_version:"pricing-v1",max_input_tokens:100_000,max_output_tokens:64_000,
  model_max_output_tokens:64_000,input_usd_per_million_tokens:"1",
  output_usd_per_million_tokens:"2",platform_hard_cap_micro_usd:1_000_000n
};
const productLineageConfiguration:SignalSemanticContextProposalRuntimeConfigurationV1={
  available:true,provider:"anthropic",model:"claude-sonnet-4-6",
  model_version:"claude-sonnet-4-6",pricing_version:"pricing-2026-08-21",
  max_input_tokens:120_000,max_output_tokens:64_000,model_max_output_tokens:64_000,
  input_usd_per_million_tokens:"3.000000",output_usd_per_million_tokens:"15.000000",
  platform_hard_cap_micro_usd:1_000_000n
};

test("0091 semantic context authority is append-only, drift-aware, idempotent, and confidence-neutral",{
  skip:!DB_URL||!APPROVED,timeout:180_000
},async(t)=>{
  assert.ok(DB_URL);requireLocal(DB_URL);
  t.after(installProviderEnvironment(terminalPreflightConfiguration));
  let migration0097="";let migration0098="";let migration0099="";let migration0100="";let migration0101="";
  let migration0102="";let migration0103="";let migration0104="";
  const admin=new pg.Client({connectionString:DB_URL,ssl:false});await admin.connect();
  try{await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    const directory=resolve(process.cwd(),"../../infrastructure/db/migrations");
    const files=(await readdir(directory)).filter((file)=>/^\d{4}_.+\.sql$/u.test(file)).sort();
    for(const file of files){const sql=await readFile(join(directory,file),"utf8");
      if(file.startsWith("0097_"))migration0097=sql;
      else if(file.startsWith("0098_"))migration0098=sql;
      else if(file.startsWith("0099_"))migration0099=sql;
      else if(file.startsWith("0100_"))migration0100=sql;
      else if(file.startsWith("0101_"))migration0101=sql;
      else if(file.startsWith("0102_"))migration0102=sql;
      else if(file.startsWith("0103_"))migration0103=sql;
      else if(file.startsWith("0104_"))migration0104=sql;
      else await admin.query(sql);}
  }finally{await admin.end();}

  const historicalV1=await seedHistoricalV1Publication();
  const historicalDecision=await seedHistoricalRationaleLessDraft();
  const historicalDecisionBefore=await pool.query(`SELECT row_to_json(element)::text value FROM (
    SELECT element_key,element_version,element_kind,canonical_key,display_text,scope,entity_type,entity_id,
      locale,relation_kind,relation_target_key,confidence,disposition,origin_kind,supersedes_element_id,
      original_proposal_element_id,source_refs_digest,element_digest,operation_id,proposed_by_user_id,
      decided_by_user_id,proposed_at,decided_at,created_at
    FROM signal_semantic_context_element_versions WHERE workspace_id=$1::uuid
      AND generation_id=$2::uuid AND disposition='approved') element`,
  [historicalDecision.workspace.id,historicalDecision.generationId]);
  const historicalBefore=await pool.query(`SELECT row_to_json(generation)::text value FROM (
    SELECT status,pack_digest,published_operation_id,published_by_user_id,published_at
    FROM signal_semantic_context_generations
    WHERE workspace_id=$1::uuid AND generation_key=$2) generation`,
  [historicalV1.workspaceId,historicalV1.generationKey]);
  assert.ok(migration0097,"0097 migration is present");assert.ok(migration0098,"0098 migration is present");
  assert.ok(migration0099,"0099 migration is present");assert.ok(migration0100,"0100 migration is present");
  assert.ok(migration0101,"0101 migration is present");
  assert.ok(migration0102,"0102 migration is present and must be applied after 0101");
  assert.ok(migration0103,"0103 migration is present and must be applied after 0102");
  assert.ok(migration0104,"0104 migration is present and must be applied after 0103");
  const migrationClient=new pg.Client({connectionString:DB_URL,ssl:false});await migrationClient.connect();
  try{await migrationClient.query(migration0097);await migrationClient.query(migration0098);}
  finally{await migrationClient.end();}
  const historicalAnnotation=await seedHistoricalResolvedAnnotationWithoutBasis(historicalDecision);
  const historicalAnnotationBefore=await pool.query(`SELECT row_to_json(annotation)::text value FROM (
    SELECT annotation_key,annotation_version,annotation_type,state,resolution,subject_element_id,
      related_element_ids,reason_code,rationale,supersedes_annotation_id,operation_id,actor_user_id,created_at
    FROM signal_semantic_context_review_annotations WHERE generation_id=$1::uuid ORDER BY annotation_version) annotation`,
  [historicalDecision.generationId]);
  const migration0099Client=new pg.Client({connectionString:DB_URL,ssl:false});await migration0099Client.connect();
  try{await migration0099Client.query(migration0099);}finally{await migration0099Client.end();}
  const migration0100Client=new pg.Client({connectionString:DB_URL,ssl:false});await migration0100Client.connect();
  try{await migration0100Client.query(migration0100);}finally{await migration0100Client.end();}
  const historicalAnnotationAfter=await pool.query(`SELECT row_to_json(annotation)::text value FROM (
    SELECT annotation_key,annotation_version,annotation_type,state,resolution,subject_element_id,
      related_element_ids,reason_code,rationale,supersedes_annotation_id,operation_id,actor_user_id,created_at
    FROM signal_semantic_context_review_annotations WHERE generation_id=$1::uuid ORDER BY annotation_version) annotation`,
  [historicalDecision.generationId]);
  assert.deepEqual(historicalAnnotationAfter.rows,historicalAnnotationBefore.rows,
    "0099 preserves historical annotations byte-for-byte");
  const historicalAfter=await pool.query(`SELECT row_to_json(generation)::text value FROM (
    SELECT status,pack_digest,published_operation_id,published_by_user_id,published_at
    FROM signal_semantic_context_generations
    WHERE workspace_id=$1::uuid AND generation_key=$2) generation`,
  [historicalV1.workspaceId,historicalV1.generationKey]);
  assert.deepEqual(historicalAfter.rows,historicalBefore.rows,"0097 preserves historical V1 publication byte-for-byte");
  const historicalDecisionAfter=await pool.query(`SELECT row_to_json(element)::text value FROM (
    SELECT element_key,element_version,element_kind,canonical_key,display_text,scope,entity_type,entity_id,
      locale,relation_kind,relation_target_key,confidence,disposition,origin_kind,supersedes_element_id,
      original_proposal_element_id,source_refs_digest,element_digest,operation_id,proposed_by_user_id,
      decided_by_user_id,proposed_at,decided_at,created_at
    FROM signal_semantic_context_element_versions WHERE workspace_id=$1::uuid
      AND generation_id=$2::uuid AND disposition='approved') element`,
  [historicalDecision.workspace.id,historicalDecision.generationId]);
  assert.deepEqual(historicalDecisionAfter.rows,historicalDecisionBefore.rows,
    "0098 preserves every pre-cutover decision field");
  const historicalDecisionBasis=await pool.query(`SELECT decision_contract_version,decision_reason_code,
    decision_rationale,decision_basis_digest FROM signal_semantic_context_element_versions
    WHERE workspace_id=$1::uuid AND generation_id=$2::uuid AND disposition='approved'`,
  [historicalDecision.workspace.id,historicalDecision.generationId]);
  assert.deepEqual(historicalDecisionBasis.rows,[{decision_contract_version:null,decision_reason_code:null,
    decision_rationale:null,decision_basis_digest:null}]);
  const unicodeParity=await pool.query<{scalar_count:number;nfc_value:string}>(
    `SELECT char_length($1::text)::int scalar_count,normalize($2::text,NFC) nfc_value`,
    ["🧠".repeat(1000),"Cafe\u0301"]);
  assert.deepEqual(unicodeParity.rows,[{scalar_count:1000,nfc_value:"Café"}],
    "PostgreSQL applies the same Unicode-scalar count and NFC normalization as TypeScript");
  const historicalBlocked=await transaction((queryable)=>loadSignalSemanticContextPublicationPreflightV2({queryable,
    workspace:historicalDecision.workspace,actor:historicalDecision.actor,
    generationKey:historicalDecision.generationKey}));
  assert.ok(historicalBlocked.blockers.includes("decision_basis_missing"));
  assert.ok(historicalBlocked.blockers.includes("annotation_resolution_basis_missing"));
  assert.equal(historicalBlocked.counts.annotation_resolution_basis_missing,1);
  assert.deepEqual(Object.keys(historicalBlocked.counts).sort(),[
    "annotation_resolution_basis_missing","canonical_collisions","invalid_evidence_refs",
    "decision_basis_missing","invalid_relation_targets","merge_edges","merged","open_annotations","open_near_duplicate",
    "open_uncertainty","pending","approved","rejected","total_leaves","unresolved_competitive_unit",
    "locale_market_required_unresolved",
    "unresolved_locale"].sort(),"the real PostgreSQL preflight has the exact closed OpenAPI count surface");
  const historicalDetail=await transaction((queryable)=>loadSignalSemanticContextReviewDetailV1({queryable,
    workspace:historicalDecision.workspace,actor:historicalDecision.actor,
    generationKey:historicalDecision.generationKey,elementKey:"historical-rationaleless"}));
  assert.equal(historicalDetail.decision_basis.state,"missing_historical");
  assert.equal(historicalDetail.decision_basis.rationale,null);
  assert.equal(historicalDetail.review_annotations[0]?.resolution_basis.state,"missing_historical");
  const repair=await transaction((queryable)=>repairSignalSemanticContextAnnotationResolutionV1({queryable,
    workspace:historicalDecision.workspace,actor:historicalDecision.actor,idempotencyKey:"historical-annotation-repair",
    generationKey:historicalDecision.generationKey,elementKey:"historical-rationaleless",
    annotationKey:historicalAnnotation.annotationKey,resolution:"not_supported",reason:"insufficient_context",
    rationale:"The operator explicitly confirms the historical not-supported resolution under current authority.",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_REPAIR_CONFIRMATION_V1}));
  assert.equal(repair.annotation_version,3);assert.equal(repair.resolution_basis,"complete");
  assert.deepEqual(await transaction((queryable)=>repairSignalSemanticContextAnnotationResolutionV1({queryable,
    workspace:historicalDecision.workspace,actor:historicalDecision.actor,idempotencyKey:"historical-annotation-repair",
    generationKey:historicalDecision.generationKey,elementKey:"historical-rationaleless",
    annotationKey:historicalAnnotation.annotationKey,resolution:"not_supported",reason:"insufficient_context",
    rationale:"The operator explicitly confirms the historical not-supported resolution under current authority.",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_REPAIR_CONFIRMATION_V1})),repair,
  "repair replay returns the same append-only result");
  const repairedHistory=await pool.query<{annotation_version:number;rationale:string;
    basis_complete:boolean}>(`SELECT annotation_version,rationale,
      resolution_basis_digest IS NOT NULL AND resolution_input_digest IS NOT NULL
        AND resolution_authority_digest IS NOT NULL basis_complete
    FROM signal_semantic_context_review_annotations WHERE generation_id=$1::uuid
      AND annotation_key=$2 ORDER BY annotation_version`,
  [historicalDecision.generationId,historicalAnnotation.annotationKey]);
  assert.deepEqual(repairedHistory.rows,[
    {annotation_version:1,rationale:"Historical observation rationale.",basis_complete:false},
    {annotation_version:2,rationale:"Historical observation rationale.",basis_complete:false},
    {annotation_version:3,
      rationale:"The operator explicitly confirms the historical not-supported resolution under current authority.",
      basis_complete:true}
  ],"append-only repair preserves both historical rows and never inherits their rationale as the new decision");
  const repairedAuthority=await pool.query<{actor:unknown}>(`SELECT resolution_authority_snapshot->'actor' actor
    FROM signal_semantic_context_review_annotations WHERE generation_id=$1::uuid AND annotation_key=$2
      AND annotation_version=3`,[historicalDecision.generationId,historicalAnnotation.annotationKey]);
  assert.deepEqual(repairedAuthority.rows,[{actor:{id:historicalDecision.actor.id,
    user_type:"noisia_internal",primary_role:"noisia_admin"}}],
  "the resolution snapshot seals the authenticated actor and DB-owned role");
  await assert.rejects(transaction((queryable)=>repairSignalSemanticContextAnnotationResolutionV1({queryable,
    workspace:historicalDecision.workspace,actor:historicalDecision.actor,
    idempotencyKey:"historical-annotation-repair-second-key",generationKey:historicalDecision.generationKey,
    elementKey:"historical-rationaleless",annotationKey:historicalAnnotation.annotationKey,
    resolution:"not_supported",reason:"insufficient_context",rationale:"A duplicate repair must fail closed.",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_REPAIR_CONFIRMATION_V1})),
  /semantic_context_annotation_resolution_basis_complete/u,
  "a correctly based resolution is explicitly non-repairable under a new request key");
  const repairedPreflight=await transaction((queryable)=>loadSignalSemanticContextPublicationPreflightV2({queryable,
    workspace:historicalDecision.workspace,actor:historicalDecision.actor,
    generationKey:historicalDecision.generationKey}));
  assert.ok(!repairedPreflight.blockers.includes("annotation_resolution_basis_missing"),
    "repair clears only the annotation-resolution basis blocker");
  assert.ok(repairedPreflight.blockers.includes("decision_basis_missing"),
    "unrelated historical element basis remains blocked");
  const historicalV2Columns=await pool.query(`SELECT publication_schema_version,candidate_pack_digest,
    evidence_graph_digest,review_graph_digest,publication_authority_digest,semantic_context_pack_digest,
    publish_preflight_digest,publication_counts FROM signal_semantic_context_generations
    WHERE workspace_id=$1::uuid AND generation_key=$2`,[historicalV1.workspaceId,historicalV1.generationKey]);
  assert.deepEqual(historicalV2Columns.rows,[{publication_schema_version:null,candidate_pack_digest:null,
    evidence_graph_digest:null,review_graph_digest:null,publication_authority_digest:null,
    semantic_context_pack_digest:null,publish_preflight_digest:null,publication_counts:null}]);

  const fixture=await seedFixture();
  const protectedBefore=await protectedCounts(fixture.workspace.id);
  const legacyDraft=await transaction((queryable)=>createSignalSemanticContextDraftV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"context-draft-idempotent"}));
  assert.deepEqual(await transaction((queryable)=>createSignalSemanticContextDraftV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"context-draft-idempotent"})),legacyDraft);
  const lineage=await fullLineageForDraft(fixture,legacyDraft.generation_key,
    terminalPreflightConfiguration);
  const reconciledLegacy=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({
    queryable,workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"reconcile-lineage-idempotent",
    reason:"provider_lineage_missing",proposalLineage:lineage}));
  assert.equal(reconciledLegacy.outcome,"created");
  assert.deepEqual(await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({
    queryable,workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"reconcile-lineage-idempotent",
    reason:"provider_lineage_missing",proposalLineage:lineage})),reconciledLegacy);
  const currentNoop=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({
    queryable,workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"reconcile-current-draft",
    reason:"operator_requested_reconciliation",proposalLineage:lineage}));
  assert.equal(currentNoop.outcome,"noop");
  assert.equal(currentNoop.generation_key,reconciledLegacy.generation_key);
  const draft={generation_key:reconciledLegacy.generation_key,
    generation_version:reconciledLegacy.generation_version,status:"draft" as const};

  const proposals=[
    proposal("identity-main","identity_term","assistant-brand","Assistant brand",1,fixture.profileId),
    proposal("product-main","product","smart-speaker","Smart speaker",0.99,fixture.productId),
    proposal("need-main","need","hands-free-help","Hands-free help",0.8,fixture.chunkId),
    proposal("friction-main","friction","privacy-friction","Privacy concern",0.7,fixture.sourceId)
  ];
  const appended=await transaction((queryable)=>appendSignalSemanticContextProposalsV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"context-proposals-idempotent",
    generationKey:draft.generation_key,proposals}));
  assert.equal(appended.created,4);
  assert.deepEqual(await transaction((queryable)=>appendSignalSemanticContextProposalsV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"context-proposals-idempotent",
    generationKey:draft.generation_key,proposals})),appended);
  const reviewPage=await transaction((queryable)=>loadSignalSemanticContextReviewPageV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key,
    filters:parseSignalSemanticContextReviewFiltersV1(new URLSearchParams())}));
  assert.equal(reviewPage.total,4);
  assert.deepEqual(reviewPage.elements.map((element)=>element.element_key),
    ["friction-main","identity-main","need-main","product-main"]);
  assert.equal(reviewPage.elements.every((element)=>element.attention.authoritative===false),true);
  assert.doesNotMatch(JSON.stringify(reviewPage),/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu,
    "the review page contains no private database identifiers");
  const productDetail=await transaction((queryable)=>loadSignalSemanticContextReviewDetailV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key,
    elementKey:"product-main"}));
  assert.equal(productDetail.evidence.length,1);
  assert.equal(productDetail.evidence[0]!.source_type,"brand_os_product");
  assert.equal(productDetail.evidence[0]!.source_context.label,"context_supplied_to_model");
  assert.equal(productDetail.evidence[0]!.source_context.pinpoint_citation,false);
  assert.equal(productDetail.authority.review_decision_written,false);
  const reviewSummary=await transaction((queryable)=>loadSignalSemanticContextReviewSummaryV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor}));
  assert.deepEqual(reviewSummary.generation?.counts,{pending:4,approved:0,rejected:0,merged:0});
  assert.equal(reviewSummary.authority.private_fields_withheld,true);
  assert.doesNotMatch(JSON.stringify(reviewSummary),/sha256:|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu,
    "the Review hydration contract withholds hashes and private database identifiers");
  await assert.rejects(transaction((queryable)=>loadSignalSemanticContextReviewPageV1({queryable,
    workspace:fixture.otherWorkspace,actor:fixture.actor,generationKey:draft.generation_key,
    filters:parseSignalSemanticContextReviewFiltersV1(new URLSearchParams())})),hasCode("semantic_context_generation_not_found"));
  let readiness=await loadSignalSemanticContextReadinessV1({queryable:pool,workspace:fixture.workspace,
    actor:fixture.actor});
  assert.deepEqual(readiness.counts,{pending:4,approved:0,rejected:0,merged:0});
  assert.equal(readiness.ready_for_context_aware_discovery,false);
  assert.equal(readiness.counts.approved,0,"confidence=1.0 never approves a proposal");

  const concurrentApprovals=await Promise.all([1,2].map(()=>approveElement(fixture,draft.generation_key,
    "identity-main","approve-identity-idempotent")));
  assert.deepEqual(concurrentApprovals[0],concurrentApprovals[1],"concurrent same-key replay is exact");
  const edited=await transaction((queryable)=>correctSignalSemanticContextElementV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"edit-product-idempotent",
    generationKey:draft.generation_key,elementKey:"product-main",reason:"operator_correction",
    rationale:"Create the reviewed operator wording.",correction:{canonical_key:"smart-speaker-current",
      display_text:"Current smart speaker",scope:"primary_brand",
      relation_kind:null,relation_target_key:null}}));
  assert.equal(edited.disposition,"pending","an operator edit remains pending");
  await approveElement(fixture,draft.generation_key,"product-main","approve-product-idempotent");
  await approveElement(fixture,draft.generation_key,"need-main","approve-need-idempotent");
  await approveElement(fixture,draft.generation_key,"friction-main","approve-friction-idempotent");

  await assert.rejects(pool.query(`UPDATE signal_semantic_context_generations SET status='published',
    pack_digest=$3,published_operation_id=created_operation_id,published_by_user_id=created_by_user_id,
    published_at=clock_timestamp() WHERE workspace_id=$1::uuid AND generation_key=$2`,
  [fixture.workspace.id,draft.generation_key,digest("raw-v1-publication")]),hasCode("23514"));
  await assert.rejects(transaction((queryable)=>publishSignalSemanticContextGenerationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"publish-context-v1-retired",
    generationKey:draft.generation_key})),/semantic_context_publish_v1_retired/u);
  const publishPreflight=await transaction((queryable)=>loadSignalSemanticContextPublicationPreflightV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key}));
  assert.equal(publishPreflight.writes_performed,false);
  assert.equal(publishPreflight.provider_calls,0);
  assert.equal(publishPreflight.publishable,true,JSON.stringify(publishPreflight));
  const published=await transaction((queryable)=>publishSignalSemanticContextGenerationV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"publish-context-idempotent-v2",
    generationKey:draft.generation_key,preflightDigest:publishPreflight.preflight_digest,
    confirmation:SIGNAL_SEMANTIC_CONTEXT_PUBLICATION_CONFIRMATION_V2}));
  assert.deepEqual(await transaction((queryable)=>publishSignalSemanticContextGenerationV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"publish-context-idempotent-v2",
    generationKey:draft.generation_key,preflightDigest:publishPreflight.preflight_digest,
    confirmation:SIGNAL_SEMANTIC_CONTEXT_PUBLICATION_CONFIRMATION_V2})),published);
  readiness=await loadSignalSemanticContextReadinessV1({queryable:pool,workspace:fixture.workspace,
    actor:fixture.actor});
  assert.equal(readiness.ready_for_context_aware_discovery,true);
  assert.deepEqual(readiness.counts,{pending:0,approved:4,rejected:0,merged:0});
  const publishedNoop=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({
    queryable,workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"reconcile-current-published",
    reason:"operator_requested_reconciliation",proposalLineage:lineage}));
  assert.equal(publishedNoop.outcome,"noop");
  assert.equal(publishedNoop.generation_key,published.generation_key);

  await assert.rejects(pool.query(`UPDATE signal_semantic_context_generations SET pack_digest=$2
    WHERE workspace_id=$1::uuid`,[fixture.workspace.id,digest("tamper")]),hasCode("55000"));
  await assert.rejects(pool.query(`UPDATE signal_semantic_context_element_versions SET confidence=1
    WHERE workspace_id=$1::uuid`,[fixture.workspace.id]),hasCode("55000"));
  const historyBefore=await pool.query(`SELECT brand_os_digest,knowledge_digest,pack_digest
    FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid`,[fixture.workspace.id]);

  await pool.query(`UPDATE brand_os_profiles SET status='retired' WHERE id=$1::uuid`,[fixture.profileId]);
  await pool.query(`INSERT INTO brand_os_profiles(id,organization_id,brand_id,name,status,version,metadata)
    VALUES($1::uuid,$2::uuid,$3::uuid,'Profile v2','active',2,jsonb_build_object('snapshot_hash',$4::text))`,
  [randomUUID(),fixture.workspace.organizationId,fixture.workspace.subject.id,digest("brand-os-v2")]);
  readiness=await loadSignalSemanticContextReadinessV1({queryable:pool,workspace:fixture.workspace,
    actor:fixture.actor});
  assert.equal(readiness.ready_for_context_aware_discovery,false);
  assert.ok(readiness.drift_reasons.includes("brand_os_drift"));
  const historyAfter=await pool.query(`SELECT brand_os_digest,knowledge_digest,pack_digest
    FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid`,[fixture.workspace.id]);
  assert.deepEqual(historyAfter.rows,historyBefore.rows,"Brand OS drift does not reinterpret history");
  const nextDraft=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"context-draft-v3-idempotent",
    reason:"brand_os_drift",proposalLineage:lineage}));
  assert.equal(nextDraft.outcome,"created");
  const supersession=await pool.query<{supersedes:string}>(`SELECT supersedes_generation_id::text supersedes
    FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid AND generation_key=$2`,
  [fixture.workspace.id,nextDraft.generation_key]);
  const originalGeneration=await pool.query<{id:string}>(`SELECT id::text FROM signal_semantic_context_generations
    WHERE workspace_id=$1::uuid AND generation_key=$2`,[fixture.workspace.id,draft.generation_key]);
  assert.equal(supersession.rows[0]!.supersedes,originalGeneration.rows[0]!.id);
  const beforeKnowledgeEdit=await pool.query(`SELECT brand_os_digest,knowledge_digest,pack_digest
    FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid ORDER BY generation_version`,
  [fixture.workspace.id]);
  await pool.query(`UPDATE brand_knowledge_sources SET raw_text='Changed private fixture narrative'
    WHERE id=$1::uuid`,[fixture.sourceId]);
  const afterKnowledgeEdit=await pool.query(`SELECT brand_os_digest,knowledge_digest,pack_digest
    FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid ORDER BY generation_version`,
  [fixture.workspace.id]);
  assert.deepEqual(afterKnowledgeEdit.rows,beforeKnowledgeEdit.rows,
    "Knowledge edits do not reinterpret historical generations");
  const driftedDraft=await loadSignalSemanticContextReadinessV1({queryable:pool,workspace:fixture.workspace,
    actor:fixture.actor});
  assert.ok(driftedDraft.drift_reasons.includes("knowledge_drift"));

  await seedQueuedProposalRun(fixture,nextDraft.generation_key,lineage);
  await assert.rejects(transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"reconcile-active-run-blocked",
    reason:"knowledge_drift",proposalLineage:lineage})),/semantic_context_proposal_run_active/u);
  await pool.query(`UPDATE signal_semantic_context_proposal_runs SET status='stale',
    stale_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE workspace_id=$1::uuid AND generation_id=(SELECT id FROM signal_semantic_context_generations
      WHERE workspace_id=$1::uuid AND generation_key=$2)`,[fixture.workspace.id,nextDraft.generation_key]);
  const concurrent=await Promise.all(["a","b"].map((suffix)=>transaction((queryable)=>
    reconcileSignalSemanticContextGenerationV1({queryable,workspace:fixture.workspace,actor:fixture.actor,
      idempotencyKey:`reconcile-terminal-${suffix}`,reason:"terminal_provider_run",proposalLineage:lineage}))));
  assert.equal(concurrent.filter((result)=>result.outcome==="created").length,1);
  assert.equal(concurrent.filter((result)=>result.outcome==="noop").length,1);
  assert.equal(concurrent[0]!.generation_key,concurrent[1]!.generation_key);
  const effectiveDrafts=await scalar(`SELECT count(*)::int count
    FROM signal_semantic_context_generations generation
    WHERE generation.workspace_id=$1::uuid AND generation.status='draft' AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_generations successor
      WHERE successor.supersedes_generation_id=generation.id)`,[fixture.workspace.id]);
  assert.equal(effectiveDrafts,1,"different concurrent keys converge on one effective draft");

  const terminalFixture=await seedFixture();
  const terminalLegacyDraft=await transaction((queryable)=>createSignalSemanticContextDraftV1({queryable,
    workspace:terminalFixture.workspace,actor:terminalFixture.actor,
    idempotencyKey:"terminal-legacy-draft-idempotent"}));
  const terminalLineage=await fullLineageForDraft(terminalFixture,terminalLegacyDraft.generation_key,
    terminalPreflightConfiguration);
  const terminalDraft=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({
    queryable,workspace:terminalFixture.workspace,actor:terminalFixture.actor,
    idempotencyKey:"terminal-draft-idempotent",reason:"provider_lineage_missing",
    proposalLineage:terminalLineage}));
  const untouchedTerminal=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({
    queryable,workspace:terminalFixture.workspace,actor:terminalFixture.actor,
    idempotencyKey:"terminal-no-run-noop",reason:"terminal_provider_run",proposalLineage:terminalLineage}));
  assert.equal(untouchedTerminal.outcome,"noop","a draft without a run is not superseded by this operation");
  const terminalRun=await seedTerminalProposalRun(terminalFixture,terminalDraft.generation_key,
    terminalLineage,"safe_failed");
  const predecessorFingerprint=await fingerprint(`SELECT generation.* FROM
    signal_semantic_context_generations generation WHERE generation.workspace_id=$1::uuid
      AND generation.generation_key=$2`,[terminalFixture.workspace.id,terminalDraft.generation_key]);
  const runFingerprint=await fingerprint(`SELECT run.* FROM signal_semantic_context_proposal_runs run
    WHERE run.id=$1::uuid`,[terminalRun.id]);
  const budgetFingerprint=await fingerprint(`SELECT reservation.* FROM
    signal_semantic_context_budget_reservations reservation WHERE reservation.run_id=$1::uuid`,[terminalRun.id]);
  const eventsBefore=await scalar(`SELECT count(*)::int count FROM signal_semantic_context_events
    WHERE workspace_id=$1::uuid`,[terminalFixture.workspace.id]);
  const protectedTerminalBefore=await protectedCounts(terminalFixture.workspace.id);
  const terminalConcurrent=await Promise.all(["a","b"].map((suffix)=>transaction((queryable)=>
    reconcileSignalSemanticContextGenerationV1({queryable,workspace:terminalFixture.workspace,
      actor:terminalFixture.actor,idempotencyKey:`terminal-successor-${suffix}`,
      reason:"terminal_provider_run",proposalLineage:terminalLineage}))));
  assert.equal(terminalConcurrent.filter((result)=>result.outcome==="created").length,1);
  assert.equal(terminalConcurrent.filter((result)=>result.outcome==="noop").length,1);
  assert.equal(terminalConcurrent[0]!.generation_key,terminalConcurrent[1]!.generation_key);
  const createdTerminal=terminalConcurrent.find((result)=>result.outcome==="created")!;
  assert.deepEqual(await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({
    queryable,workspace:terminalFixture.workspace,actor:terminalFixture.actor,
    idempotencyKey:"terminal-successor-a",reason:"terminal_provider_run",proposalLineage:terminalLineage})),
  terminalConcurrent[0],"same-key replay is exact");
  assert.deepEqual(await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({
    queryable,workspace:terminalFixture.workspace,actor:terminalFixture.actor,
    idempotencyKey:"terminal-successor-c",reason:"terminal_provider_run",proposalLineage:terminalLineage})),{
      outcome:"noop",generation_key:createdTerminal.generation_key,
      generation_version:createdTerminal.generation_version,status:"draft"
    },"a new key converges on the existing run-free successor");
  assert.equal(await fingerprint(`SELECT generation.* FROM signal_semantic_context_generations generation
    WHERE generation.workspace_id=$1::uuid AND generation.generation_key=$2`,
  [terminalFixture.workspace.id,terminalDraft.generation_key]),predecessorFingerprint);
  assert.equal(await fingerprint(`SELECT run.* FROM signal_semantic_context_proposal_runs run
    WHERE run.id=$1::uuid`,[terminalRun.id]),runFingerprint);
  assert.equal(await fingerprint(`SELECT reservation.* FROM signal_semantic_context_budget_reservations reservation
    WHERE reservation.run_id=$1::uuid`,[terminalRun.id]),budgetFingerprint);
  assert.equal(await scalar(`SELECT count(*)::int count FROM signal_semantic_context_events
    WHERE workspace_id=$1::uuid`,[terminalFixture.workspace.id]),eventsBefore+1);
  assert.deepEqual(await pool.query(`SELECT generation.supersession_reason,
    generation.supersedes_generation_id::text supersedes,
    (SELECT count(*)::int FROM signal_semantic_context_proposal_runs run
      WHERE run.generation_id=generation.id) runs,
    (SELECT count(*)::int FROM signal_semantic_context_element_versions element
      WHERE element.generation_id=generation.id) elements,
    (SELECT count(*)::int FROM signal_semantic_context_budget_reservations reservation
      JOIN signal_semantic_context_proposal_runs run ON run.id=reservation.run_id
      WHERE run.generation_id=generation.id) reservations,
    (SELECT count(*)::int FROM signal_semantic_context_proposal_outbox outbox
      JOIN signal_semantic_context_proposal_runs run ON run.id=outbox.run_id
      WHERE run.generation_id=generation.id) outboxes
    FROM signal_semantic_context_generations generation
    WHERE generation.workspace_id=$1::uuid AND generation.generation_key=$2`,
  [terminalFixture.workspace.id,createdTerminal.generation_key]).then((result)=>result.rows[0]),{
    supersession_reason:"terminal_provider_run",supersedes:terminalRun.generationId,
    runs:0,elements:0,reservations:0,outboxes:0
  });
  assert.deepEqual(await protectedCounts(terminalFixture.workspace.id),protectedTerminalBefore);
  const successorPreflight=await loadSignalSemanticContextProposalPreflightRuntimeV1({queryable:pool,
    workspace:{id:terminalFixture.workspace.id,organization_id:terminalFixture.workspace.organizationId,
      brand_id:terminalFixture.workspace.subject.id},actor:{id:terminalFixture.actor.id,
      user_type:"noisia_internal"},generation_key:createdTerminal.generation_key,
    configuration:terminalPreflightConfiguration,runtime:{queue_configured:true,worker_alive:true,
      recovery_alive:true}});
  assert.equal(successorPreflight.readiness,"ready");
  assert.ok(!successorPreflight.blockers.includes("semantic_context_generation_run_exists"));

  const productFixture=await seedFixture();
  const productProtectedBefore=await protectedCounts(productFixture.workspace.id);
  let productLineageSuccessorKey="";
  await withProductProviderEnvironment(async()=>{
    const initial=await createSignalSemanticContextDraftProductV1({
      workspace:productFixture.workspace,actor:productFixture.actor,
      idempotencyKey:"product-lineage-initial"});
    const expectedProductLineage=await generationProviderLineage(productFixture.workspace.id,
      initial.generation_key);
    assert.ok(expectedProductLineage.lineage_digest,"initial product draft seals full V3 lineage");
    await seedTerminalProposalRun(productFixture,initial.generation_key,
      expectedProductLineage,"safe_failed");
    const successor=await reconcileSignalSemanticContextGenerationProductV1({
      workspace:productFixture.workspace,actor:productFixture.actor,
      idempotencyKey:"product-lineage-successor",reason:"terminal_provider_run"});
    assert.equal(successor.outcome,"created");
    productLineageSuccessorKey=successor.generation_key;
    assert.deepEqual(await generationProviderLineage(productFixture.workspace.id,
      successor.generation_key),expectedProductLineage,
    "append-only successor seals the same canonical V3 lineage");
    const preflight=await loadSignalSemanticContextProposalPreflightRuntimeV1({queryable:pool,
      workspace:{id:productFixture.workspace.id,
        organization_id:productFixture.workspace.organizationId,
        brand_id:productFixture.workspace.subject.id},
      actor:{id:productFixture.actor.id,user_type:"noisia_internal"},
      generation_key:successor.generation_key,configuration:productLineageConfiguration,
      runtime:{queue_configured:true,worker_alive:true,recovery_alive:true}});
    assert.equal(preflight.readiness,"ready");
    assert.ok(!preflight.blockers.includes("provider_lineage_drift"));
    assert.equal(preflight.provider.prompt_digest,
      SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V3);
  });
  const unchangedProductPredecessor=await generationProviderLineage(productFixture.workspace.id,
    productLineageSuccessorKey);
  const rateSuccessor=await withProductProviderEnvironment(async()=>
    reconcileSignalSemanticContextGenerationProductV1({workspace:productFixture.workspace,
      actor:productFixture.actor,idempotencyKey:"product-lineage-rate-successor",
      reason:"provider_lineage_changed"}),{
    NOISIA_SEMANTIC_CONTEXT_INPUT_USD_PER_MILLION_TOKENS:"3.100000"
  });
  assert.equal(rateSuccessor.outcome,"created");
  const rateSuccessorLineage=await generationProviderLineage(productFixture.workspace.id,
    rateSuccessor.generation_key);
  assert.equal(rateSuccessorLineage.pricing.input_usd_per_million_tokens,"3.100000");
  assert.notEqual(rateSuccessorLineage.lineage_digest,unchangedProductPredecessor.lineage_digest);
  assert.deepEqual(await generationProviderLineage(productFixture.workspace.id,
    productLineageSuccessorKey),unchangedProductPredecessor,
  "provider-lineage reconciliation never mutates its predecessor");
  assert.deepEqual(await protectedCounts(productFixture.workspace.id),productProtectedBefore,
    "lineage creation and successor do not write protected serving authorities");

  const reviewFixture=await seedFixture();
  const reviewLegacyDraft=await transaction((queryable)=>createSignalSemanticContextDraftV1({queryable,
    workspace:reviewFixture.workspace,actor:reviewFixture.actor,
    idempotencyKey:"terminal-review-legacy-draft"}));
  const reviewLineage=await fullLineageForDraft(reviewFixture,reviewLegacyDraft.generation_key,
    terminalPreflightConfiguration);
  const reviewDraft=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:reviewFixture.workspace,actor:reviewFixture.actor,
    idempotencyKey:"terminal-review-draft",reason:"provider_lineage_missing",
    proposalLineage:reviewLineage}));
  await transaction((queryable)=>appendSignalSemanticContextProposalsV1({queryable,
    workspace:reviewFixture.workspace,actor:reviewFixture.actor,idempotencyKey:"terminal-review-element",
    generationKey:reviewDraft.generation_key,proposals:[proposal("review-me","identity_term",
      "review-me","Review me",1,reviewFixture.profileId)]}));
  await seedTerminalProposalRun(reviewFixture,reviewDraft.generation_key,reviewLineage,"safe_failed");
  await assert.rejects(transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:reviewFixture.workspace,actor:reviewFixture.actor,
    idempotencyKey:"terminal-review-blocked",reason:"terminal_provider_run",proposalLineage:reviewLineage})),
  /semantic_context_generation_review_required/u);

  const ambiguousFixture=await seedFixture();
  const ambiguousLegacyDraft=await transaction((queryable)=>createSignalSemanticContextDraftV1({queryable,
    workspace:ambiguousFixture.workspace,actor:ambiguousFixture.actor,
    idempotencyKey:"terminal-ambiguous-legacy-draft"}));
  const ambiguousLineage=await fullLineageForDraft(ambiguousFixture,
    ambiguousLegacyDraft.generation_key,terminalPreflightConfiguration);
  const ambiguousDraft=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:ambiguousFixture.workspace,actor:ambiguousFixture.actor,
    idempotencyKey:"terminal-ambiguous-draft",reason:"provider_lineage_missing",
    proposalLineage:ambiguousLineage}));
  await seedTerminalProposalRun(ambiguousFixture,ambiguousDraft.generation_key,ambiguousLineage,"ambiguous_dead_letter");
  await assert.rejects(transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:ambiguousFixture.workspace,actor:ambiguousFixture.actor,
    idempotencyKey:"terminal-ambiguous-blocked",reason:"terminal_provider_run",proposalLineage:ambiguousLineage})),
  /semantic_context_provider_outcome_ambiguous/u);

  await assert.rejects(transaction((queryable)=>decideSignalSemanticContextElementV2({queryable,
    workspace:fixture.otherWorkspace,actor:fixture.actor,idempotencyKey:"cross-workspace-rejected",
    generationKey:draft.generation_key,elementKey:"identity-main",action:"approve",
    reason:"semantic_boundary",rationale:"Cross-workspace authority must fail closed.",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_APPROVAL_CONFIRMATION_V2})),/not_found/u);

  await assert.rejects(transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:{...fixture.workspace,organizationId:fixture.otherWorkspace.organizationId},actor:fixture.actor,
    idempotencyKey:"reconcile-cross-workspace",reason:"operator_requested_reconciliation",
    proposalLineage:lineage})),/cross-workspace|unauthorized/u);

  const operationsBefore=await scalar(`SELECT count(*)::int count FROM signal_governance_control_operations
    WHERE workspace_id=$1::uuid`,[fixture.workspace.id]);
  const preflight=await loadSignalSemanticContextProposalPreflightV1({queryable:pool,
    workspace:fixture.workspace,actor:fixture.actor,configuration:{available:true,provider:"fixture",
      model:"fixture-model",model_version:"immutable-v1",pricing_version:"pricing-v1",
      prompt_template_digest:digest("prompt"),max_input_tokens:1000,max_output_tokens:500,
      input_usd_per_million_tokens:1,output_usd_per_million_tokens:2,hard_cap_usd:1}});
  assert.equal(preflight.provider_calls,0);assert.equal(preflight.writes_performed,false);
  assert.equal(await scalar(`SELECT count(*)::int count FROM signal_governance_control_operations
    WHERE workspace_id=$1::uuid`,[fixture.workspace.id]),operationsBefore,"preflight is read-only");
  assert.deepEqual(await protectedCounts(fixture.workspace.id),protectedBefore);

  await exerciseReviewPublicationV2();
  await exerciseMixedStateMergeV2();
  await exerciseRelationTargetAuthorityV2();
  await exerciseMutationAuthorityDriftV2();
  await exerciseProviderAuthorityDriftV2();
  await exercisePublicationPreflightScaleV2();
  await exerciseDeliberateApprovalV2();
  await exerciseLocaleAuthorityV1();
  await exerciseDirectLocaleAuthorityMatrixV1();
  await exerciseLocalePublicationLineageGuardV1();
  const inheritedApplicability=await seedInheritedApplicabilityFailingBeforeV1();
  const historicalPublishedV2=await seedHistoricalV2PublicationBefore0101();
  const migration0101Client=new pg.Client({connectionString:DB_URL,ssl:false});await migration0101Client.connect();
  try{await migration0101Client.query(migration0101);}finally{await migration0101Client.end();}
  await exerciseInheritedApplicabilityPassingAfterV1(inheritedApplicability,historicalPublishedV2);
  const migration0102Client=new pg.Client({connectionString:DB_URL,ssl:false});await migration0102Client.connect();
  try{await migration0102Client.query(migration0102);}finally{await migration0102Client.end();}
  const migration0103Client=new pg.Client({connectionString:DB_URL,ssl:false});await migration0103Client.connect();
  try{await migration0103Client.query(migration0103);}finally{await migration0103Client.end();}
  const migration0104Client=new pg.Client({connectionString:DB_URL,ssl:false});await migration0104Client.connect();
  try{await migration0104Client.query(migration0104);}finally{await migration0104Client.end();}
  await exerciseOrdinaryEditingV1();
  await exerciseSimpleCreationV1();
  await exerciseArchivedAccountingAdversarialV1();

  const canonical='{"a":1,"b":[2,3]}';
  const postgresDigest=(await pool.query<{digest:string}>(
    `SELECT signal_semantic_context_digest_v1($1) digest`,[canonical])).rows[0]!.digest;
  assert.equal(postgresDigest,digest(canonical),"TypeScript and PostgreSQL hash identical canonical bytes");
  const goldenVectors=[
    {value:{s:"Cafe\u0301"},canonical:'{"s":"Café"}',hash:"d4f21edc957c8d5f5c6ba620f820dabb8b4afc2398a7603cf49e875cf2a36269"},
    {value:{s:"🧠"},canonical:'{"s":"🧠"}',hash:"b2d883dfb70d681a2de3ee4bc8866c220e62896dc61a333cd348fe7a01c37283"},
    {value:{s:"a\u2028b\u2029c"},canonical:'{"s":"a\\u2028b\\u2029c"}',hash:"7970f45418dae559568b46bf9e8df590584d1f531ad30fe670521565d2b36cf4"},
    {value:{b:2,a:[3,{z:"last",a:"first"}]},canonical:'{"a":[3,{"a":"first","z":"last"}],"b":2}',
      hash:"c707db5812c5616df37b78e3147bfb3ae755ffd7b0f716e42321a4ac92099111"}
  ];
  for(const vector of goldenVectors){const row=(await pool.query<{canonical:string;digest:string}>(
    `SELECT signal_semantic_context_canonical_json_v2($1::jsonb) canonical,
      signal_semantic_context_digest_json_v2($1::jsonb) digest`,[JSON.stringify(vector.value)])).rows[0]!;
    assert.equal(row.canonical,vector.canonical);assert.equal(row.digest,`sha256:${vector.hash}`);}
  await assert.rejects(pool.query(
    `SELECT signal_semantic_context_canonical_json_v2($1::jsonb)`,
    ['{"Café":1,"Cafe\\u0301":2}']),/normalized key collisions/u,
  "PostgreSQL rejects distinct JSON keys that collide after NFC just like TypeScript");
  // PostgreSQL text/jsonb cannot contain a U+0000 scalar. Prove the frozen canonical
  // byte sequence and database SHA independently; TypeScript proves semantic encoding.
  const nulCanonical='{"s":"quote\\" slash/ backslash\\\\ LF\\u000A NUL\\u0000"}';
  const nulDigest=(await pool.query<{digest:string}>(`SELECT signal_semantic_context_digest_v1($1) digest`,
    [nulCanonical])).rows[0]!.digest;
  assert.equal(nulDigest,"sha256:c0998b854a4e659786347d2f3bdbed948fe8091f73161be23a18e21e50a53b41");
  await pool.end();
});

async function exerciseReviewPublicationV2(){
  const fixture=await seedFixture();
  const protectedBefore=await protectedCounts(fixture.workspace.id);
  const initial=await transaction((queryable)=>createSignalSemanticContextDraftV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-review-initial-draft"}));
  const lineage=await fullLineageForDraft(fixture,initial.generation_key,terminalPreflightConfiguration);
  const draft=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-review-lineage-draft",
    reason:"provider_lineage_missing",proposalLineage:lineage}));
  await assert.rejects(transaction((queryable)=>attemptRawCrossAuthorityElementInsert(queryable,
    fixture,draft.generation_key)),hasCode("23514"),
  "the PostgreSQL element trigger rejects cross-workspace evidence under direct SQL bypass");
  const elements=[
    proposal("merge-target","identity_term","amazon-alexa","Amazon Alexa",0.8,fixture.profileId),
    {...proposal("merge-source-a","identity_term","alexa-plus","Alexa Plus",0.8,fixture.profileId),
      source_refs:[{source_type:"brand_os_profile" as const,source_id:fixture.profileId,
        relation_type:"limits" as const}]},
    {...proposal("merge-source-b","identity_term","alexa-plus-variant","Alexa+",0.8,fixture.profileId),
      source_refs:[{source_type:"brand_os_profile" as const,source_id:fixture.profileId,
        relation_type:"contradicts" as const}]},
    proposal("correction-pending","identity_term","echo","Echo",0.8,fixture.profileId),
    proposal("correction-rejected","identity_term","echo-dot","Echo Dot",0.8,fixture.profileId)
  ];
  await transaction((queryable)=>appendSignalSemanticContextProposalsV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-review-proposals",
    generationKey:draft.generation_key,proposals:elements}));
  await transaction((queryable)=>annotateSignalSemanticContextElementV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-source-a-near-duplicate",
    generationKey:draft.generation_key,elementKey:"merge-source-a",annotationKey:"near-a",
    annotationType:"near_duplicate",reason:"duplicate_same_concept",rationale:"Same governed identity.",
    relatedElementKeys:["merge-target"]}));
  await assert.rejects(transaction((queryable)=>resolveSignalSemanticContextAnnotationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-new-annotation-cannot-resolve",
    generationKey:draft.generation_key,elementKey:"merge-source-a",annotationKey:"invalid-resolve",
    reason:"insufficient_context",rationale:"Cannot resolve before opening.",resolution:"context_sufficient",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONFIRMATION_V1})),
  /semantic_context_annotation_not_found/u);
  await transaction((queryable)=>annotateSignalSemanticContextElementV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-source-a-blocker",
    generationKey:draft.generation_key,elementKey:"merge-source-a",annotationKey:"uncertain-a",
    annotationType:"uncertain",reason:"insufficient_context",rationale:"Needs an explicit review.",
    relatedElementKeys:[]}));
  await assert.rejects(transaction((queryable)=>resolveSignalSemanticContextAnnotationV1({queryable,
    workspace:fixture.otherWorkspace,actor:fixture.actor,idempotencyKey:"v2-cross-workspace-annotation-resolution",
    generationKey:draft.generation_key,elementKey:"merge-source-a",annotationKey:"uncertain-a",
    resolution:"context_sufficient",reason:"insufficient_context",
    rationale:"Cross-workspace resolution authority must fail closed.",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONFIRMATION_V1})),/not_found/u);
  await assert.rejects(transaction((queryable)=>resolveSignalSemanticContextAnnotationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-stale-annotation-subject-resolution",
    generationKey:draft.generation_key,elementKey:"merge-target",annotationKey:"uncertain-a",
    resolution:"context_sufficient",reason:"insufficient_context",
    rationale:"A mismatched current subject must fail closed.",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONFIRMATION_V1})),
  /semantic_context_annotation_cas_conflict/u);
  const annotationVersionsBeforeMissingBasis=await scalar(`SELECT count(*)::int count
    FROM signal_semantic_context_review_annotations WHERE workspace_id=$1::uuid
      AND annotation_key='uncertain-a'`,[fixture.workspace.id]);
  await assert.rejects(transaction(async(queryable)=>{
    const predecessor=(await queryable.query<{id:string;generation_id:string;subject_element_id:string}>(
      `SELECT id::text,generation_id::text,subject_element_id::text
       FROM signal_semantic_context_review_annotations WHERE workspace_id=$1::uuid
         AND annotation_key='uncertain-a' AND NOT EXISTS(SELECT 1
           FROM signal_semantic_context_review_annotations successor
           WHERE successor.supersedes_annotation_id=signal_semantic_context_review_annotations.id)`,
      [fixture.workspace.id])).rows[0]!;
    const operation=(await queryable.query<{id:string}>(`INSERT INTO signal_governance_control_operations(
      workspace_id,actor_user_id,action,request_digest,idempotency_key,status)
      VALUES($1::uuid,$2::uuid,'annotate-semantic-context-element',$3,$4,'in_progress') RETURNING id::text`,
    [fixture.workspace.id,fixture.actor.id,digest("missing-annotation-basis-request"),
      digest("missing-annotation-basis-key")])).rows[0]!;
    await queryable.query(`INSERT INTO signal_semantic_context_review_annotations(
      workspace_id,generation_id,annotation_key,annotation_version,annotation_type,state,resolution,
      subject_element_id,related_element_ids,reason_code,rationale,supersedes_annotation_id,
      operation_id,actor_user_id) VALUES($1::uuid,$2::uuid,'uncertain-a',2,'uncertain','resolved',
      'context_sufficient',$3::uuid,'{}'::uuid[],'insufficient_context','A direct SQL bypass.',
      $4::uuid,$5::uuid,$6::uuid)`,[fixture.workspace.id,predecessor.generation_id,
      predecessor.subject_element_id,predecessor.id,operation.id,fixture.actor.id]);
  }),hasCode("23514"),"PostgreSQL rejects a resolved annotation without explicit sealed basis");
  assert.equal(await scalar(`SELECT count(*)::int count FROM signal_semantic_context_review_annotations
    WHERE workspace_id=$1::uuid AND annotation_key='uncertain-a'`,[fixture.workspace.id]),
  annotationVersionsBeforeMissingBasis,"the failed direct SQL bypass appends no partial annotation version");
  for(const annotationKey of ["direct-resolution-control","direct-resolution-false-element",
    "direct-resolution-extra-open","direct-resolution-extra-open-source",
    "direct-resolution-extra-resolved","direct-resolution-extra-resolved-source"]){
    await transaction((queryable)=>annotateSignalSemanticContextElementV2({queryable,
      workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:`open-${annotationKey}`,
      generationKey:draft.generation_key,elementKey:"correction-pending",annotationKey,
      annotationType:"uncertain",reason:"insufficient_context",
      rationale:"Direct SQL annotation-resolution backstop fixture.",relatedElementKeys:[]}));
  }
  assert.deepEqual(await attemptDirectAnnotationResolutionGraph(fixture,draft.generation_key,
    "direct-resolution-control"),{committed:true},
  "a completely valid direct-SQL resolution graph commits before adversarial mutations");
  await assert.rejects(attemptDirectAnnotationResolutionGraph(fixture,draft.generation_key,
    "direct-resolution-false-element",{inputElementKey:"merge-target"}),
  /element key does not match its current subject/u,
  "the deferred DB backstop binds the sealed element_key to the actual current subject");
  await assert.rejects(attemptDirectAnnotationResolutionGraph(fixture,draft.generation_key,
    "direct-resolution-extra-open",{extraAnnotationKey:"direct-resolution-extra-open-source",extraState:"open"}),
  /must own exactly one row/u,
  "a valid resolved successor plus an extra open annotation row cannot share one resolution operation");
  await assert.rejects(attemptDirectAnnotationResolutionGraph(fixture,draft.generation_key,
    "direct-resolution-extra-resolved",{
      extraAnnotationKey:"direct-resolution-extra-resolved-source",extraState:"resolved"}),
  hasCode("23514"),
  "a second resolved annotation row cannot share one direct resolution operation");
  for(const annotationKey of ["direct-resolution-false-element","direct-resolution-extra-open",
    "direct-resolution-extra-open-source","direct-resolution-extra-resolved",
    "direct-resolution-extra-resolved-source"]){
    assert.equal(await scalar(`SELECT count(*)::int count FROM signal_semantic_context_review_annotations
      WHERE workspace_id=$1::uuid AND annotation_key=$2`,[fixture.workspace.id,annotationKey]),1,
    `${annotationKey} remains on its original open leaf after the rejected direct-SQL transaction`);
    await transaction((queryable)=>resolveSignalSemanticContextAnnotationV1({queryable,
      workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:`resolve-after-direct-rejection-${annotationKey}`,
      generationKey:draft.generation_key,elementKey:"correction-pending",annotationKey,
      reason:"insufficient_context",rationale:"The adversarial transaction was rejected; resolve the isolated fixture.",
      resolution:"context_sufficient",
      confirmation:SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONFIRMATION_V1}));
  }
  await transaction((queryable)=>annotateSignalSemanticContextElementV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-source-b-near-duplicate",
    generationKey:draft.generation_key,elementKey:"merge-source-b",annotationKey:"near-b",
    annotationType:"near_duplicate",reason:"duplicate_same_concept",rationale:"Same governed identity.",
    relatedElementKeys:["merge-target"]}));
  await transaction((queryable)=>annotateSignalSemanticContextElementV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-target-uncertain",
    generationKey:draft.generation_key,elementKey:"merge-target",annotationKey:"target-uncertain",
    annotationType:"uncertain",reason:"insufficient_context",rationale:"Confirm the target wording.",
    relatedElementKeys:[]}));
  await assert.rejects(transaction(async(queryable)=>{
    const authority=await queryable.query<{annotation_id:string;generation_id:string;wrong_subject_id:string;
      related_element_ids:string[]}>(`SELECT annotation.id::text annotation_id,annotation.generation_id::text,
        target.id::text wrong_subject_id,annotation.related_element_ids::text[]
      FROM signal_semantic_context_review_annotations annotation
      JOIN signal_semantic_context_element_versions target ON target.generation_id=annotation.generation_id
        AND target.element_key='merge-target' AND NOT EXISTS(SELECT 1
          FROM signal_semantic_context_element_versions successor WHERE successor.supersedes_element_id=target.id)
      WHERE annotation.workspace_id=$1::uuid AND annotation.annotation_key='near-a'
        AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_review_annotations successor
          WHERE successor.supersedes_annotation_id=annotation.id)`,[fixture.workspace.id]);
    const operation=await queryable.query<{id:string}>(`INSERT INTO signal_governance_control_operations(
      workspace_id,actor_user_id,action,request_digest,idempotency_key,status)
      VALUES($1::uuid,$2::uuid,'annotate-semantic-context-element',$3,$4,'in_progress') RETURNING id::text`,
    [fixture.workspace.id,fixture.actor.id,digest("invalid-annotation-rebind-request"),
      digest("invalid-annotation-rebind-key")]);
    const row=authority.rows[0]!;
    await queryable.query(`INSERT INTO signal_semantic_context_review_annotations(
      workspace_id,generation_id,annotation_key,annotation_version,annotation_type,state,resolution,
      subject_element_id,related_element_ids,reason_code,rationale,supersedes_annotation_id,
      operation_id,actor_user_id) VALUES($1::uuid,$2::uuid,'near-a',2,'near_duplicate','resolved',
      'kept_distinct',$3::uuid,$4::uuid[],'duplicate_same_concept','Invalid arbitrary rebind.',
      $5::uuid,$6::uuid,$7::uuid)`,[fixture.workspace.id,row.generation_id,row.wrong_subject_id,
      row.related_element_ids,row.annotation_id,operation.rows[0]!.id,fixture.actor.id]);
  }),hasCode("23514"),"the DB backstop rejects an arbitrary annotation subject rebind");
  await assert.rejects(transaction((queryable)=>mergeSignalSemanticContextElementsV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-duplicate-annotation-resolution",
    generationKey:draft.generation_key,targetElementKey:"merge-target",
    sourceElementKeys:["merge-source-a","merge-source-b"],reason:"duplicate_same_concept",
    rationale:"Duplicate resolution fixture.",targetCorrection:{canonical_key:"amazon-alexa",
      display_text:"Amazon Alexa",scope:"primary_brand",relation_kind:null,
      relation_target_key:null},targetAnnotationResolutions:[
      {annotation_key:"target-uncertain",resolution:"context_sufficient"},
      {annotation_key:"target-uncertain",resolution:"not_supported"}]})),
  /semantic_context_duplicate_annotation_resolution/u,
  "the service rejects contradictory duplicate annotation resolutions before any write");
  await assert.rejects(transaction((queryable)=>resolveSignalSemanticContextAnnotationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-near-duplicate-merge-requires-merge-operation",
    generationKey:draft.generation_key,elementKey:"merge-source-b",annotationKey:"near-b",
    reason:"duplicate_same_concept",rationale:"A merged resolution requires the atomic N-to-1 writer.",
    resolution:"merged",confirmation:SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONFIRMATION_V1})),
  /semantic_context_merge_operation_required/u);
  const versionsBeforeFailedMerge=await scalar(`SELECT count(*)::int count FROM signal_semantic_context_element_versions
    WHERE workspace_id=$1::uuid`,[fixture.workspace.id]);
  await assert.rejects(transaction((queryable)=>mergeSignalSemanticContextElementsV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-merge-blocked-by-extra-annotation",
    generationKey:draft.generation_key,targetElementKey:"merge-target",
    sourceElementKeys:["merge-source-a","merge-source-b"],reason:"duplicate_same_concept",
    rationale:"Merge duplicate identity variants.",targetCorrection:{canonical_key:"amazon-alexa",
      display_text:"Amazon Alexa",scope:"primary_brand",relation_kind:null,
      relation_target_key:null}})),/semantic_context_merge_source_annotation_blocked/u);
  assert.equal(await scalar(`SELECT count(*)::int count FROM signal_semantic_context_element_versions
    WHERE workspace_id=$1::uuid`,[fixture.workspace.id]),versionsBeforeFailedMerge,"failed merge is atomic");
  const resolvedSourceBlocker=await transaction((queryable)=>resolveSignalSemanticContextAnnotationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-source-a-resolve-blocker",
    generationKey:draft.generation_key,elementKey:"merge-source-a",annotationKey:"uncertain-a",
    reason:"insufficient_context",rationale:"Context is now sufficient.",resolution:"context_sufficient",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONFIRMATION_V1}));
  assert.deepEqual(await transaction((queryable)=>resolveSignalSemanticContextAnnotationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-source-a-resolve-blocker",
    generationKey:draft.generation_key,elementKey:"merge-source-a",annotationKey:"uncertain-a",
    reason:"insufficient_context",rationale:"Context is now sufficient.",resolution:"context_sufficient",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONFIRMATION_V1})),resolvedSourceBlocker,
  "direct resolution replay returns the exact sealed result without another successor or event");
  const merged=await transaction((queryable)=>mergeSignalSemanticContextElementsV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-merge-two-into-one",
    generationKey:draft.generation_key,targetElementKey:"merge-target",
    sourceElementKeys:["merge-source-a","merge-source-b"],reason:"duplicate_same_concept",
    rationale:"Merge duplicate identity variants.",targetCorrection:{canonical_key:"amazon-alexa",
      display_text:"Amazon Alexa",scope:"primary_brand",relation_kind:null,
      relation_target_key:null},targetAnnotationResolutions:[{annotation_key:"target-uncertain",
      resolution:"context_sufficient"}]}));
  assert.equal(merged.merged,2);
  assert.deepEqual(merged.annotation_reconciliation,{source_count:2,
    source_matching_near_duplicate_resolved:2,source_other_open_annotations:0,
    target_open_annotations_before:1,target_annotations_rebound_open:0,
    target_annotations_resolved_in_merge:1,merged_successor_open_annotations:0,
    open_annotations_before:3,open_annotations_after:0});
  const mergeEvents=await pool.query<{event_kind:string;count:number}>(`SELECT event.event_kind,count(*)::int count
    FROM signal_semantic_context_events event JOIN signal_governance_control_operations operation
      ON operation.id=event.operation_id WHERE event.workspace_id=$1::uuid
      AND operation.action='merge-semantic-context-elements' GROUP BY event.event_kind ORDER BY event.event_kind`,
  [fixture.workspace.id]);
  assert.deepEqual(mergeEvents.rows,[{event_kind:"elements_merged",count:1},
    {event_kind:"review_annotation_resolved",count:3}],
  "merge records each annotation resolution and the N-to-1 authority event");
  const leaves=await pool.query<{disposition:string;count:number}>(`SELECT disposition,count(*)::int count
    FROM signal_semantic_context_element_versions element WHERE workspace_id=$1::uuid AND generation_id=(
      SELECT id FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid AND generation_key=$2)
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor
        WHERE successor.supersedes_element_id=element.id) GROUP BY disposition ORDER BY disposition`,
  [fixture.workspace.id,draft.generation_key]);
  assert.deepEqual(leaves.rows,[{disposition:"merged",count:2},{disposition:"pending",count:3}]);
  assert.equal(await scalar(`SELECT count(*)::int count FROM signal_semantic_context_merge_edges
    WHERE workspace_id=$1::uuid`,[fixture.workspace.id]),2);
  const unionRelations=await pool.query<{relation_type:string}>(`SELECT DISTINCT link.relation_type
    FROM signal_semantic_context_element_versions element JOIN analysis_evidence_links link
      ON link.evidence_group_id=element.evidence_group_id
    WHERE element.workspace_id=$1::uuid AND element.element_key='merge-target'
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor
        WHERE successor.supersedes_element_id=element.id) ORDER BY link.relation_type`,[fixture.workspace.id]);
  assert.deepEqual(unionRelations.rows.map((row)=>row.relation_type),["contradicts","limits","supports"]);
  const mergedPage=await transaction((queryable)=>loadSignalSemanticContextReviewPageV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key,
    filters:parseSignalSemanticContextReviewFiltersV1(new URLSearchParams("disposition=merged"))}));
  assert.equal(mergedPage.total,2);
  await assert.rejects(transaction((queryable)=>correctSignalSemanticContextElementV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-merged-is-terminal",
    generationKey:draft.generation_key,elementKey:"merge-source-a",reason:"operator_correction",
    rationale:"A merged leaf cannot reopen.",correction:{canonical_key:"alexa-plus",display_text:"Alexa Plus",
      scope:"primary_brand",relation_kind:null,relation_target_key:null}})),
  /semantic_context_merged_terminal/u);
  await transaction((queryable)=>annotateSignalSemanticContextElementV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-correction-open-annotation",
    generationKey:draft.generation_key,elementKey:"correction-pending",annotationKey:"correction-context",
    annotationType:"needs_more_context",reason:"insufficient_context",rationale:"Review before correction.",
    relatedElementKeys:[]}));
  await transaction((queryable)=>correctSignalSemanticContextElementV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-correct-pending",
    generationKey:draft.generation_key,elementKey:"correction-pending",reason:"operator_correction",
    rationale:"Apply the governed canonical wording.",correction:{canonical_key:"amazon-echo",
      display_text:"Amazon Echo",scope:"primary_brand",relation_kind:null,
      relation_target_key:null}}));
  const carried=await pool.query<{subject_current:boolean;state:string}>(`SELECT annotation.state,
    annotation.subject_element_id=(SELECT id FROM signal_semantic_context_element_versions element
      WHERE element.workspace_id=$1::uuid AND element.element_key='correction-pending'
        AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor
          WHERE successor.supersedes_element_id=element.id)) subject_current
    FROM signal_semantic_context_review_annotations annotation WHERE annotation.workspace_id=$1::uuid
      AND annotation.annotation_key='correction-context' AND NOT EXISTS(
        SELECT 1 FROM signal_semantic_context_review_annotations successor
        WHERE successor.supersedes_annotation_id=annotation.id)`,[fixture.workspace.id]);
  assert.deepEqual(carried.rows,[{state:"open",subject_current:true}]);
  await transaction((queryable)=>annotateSignalSemanticContextElementV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-concurrent-resolution-open",
    generationKey:draft.generation_key,elementKey:"correction-pending",annotationKey:"concurrent-resolution",
    annotationType:"uncertain",reason:"insufficient_context",rationale:"Resolve once under concurrency.",
    relatedElementKeys:[]}));
  const concurrentResolution=await Promise.allSettled(["a","b"].map((suffix)=>transaction((queryable)=>
    resolveSignalSemanticContextAnnotationV1({queryable,workspace:fixture.workspace,actor:fixture.actor,
      idempotencyKey:`v2-concurrent-resolution-${suffix}`,generationKey:draft.generation_key,
      elementKey:"correction-pending",annotationKey:"concurrent-resolution",reason:"insufficient_context",
      rationale:"The current context is sufficient after deliberate review.",resolution:"context_sufficient",
      confirmation:SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONFIRMATION_V1}))));
  assert.equal(concurrentResolution.filter((entry)=>entry.status==="fulfilled").length,1);
  assert.equal(concurrentResolution.filter((entry)=>entry.status==="rejected").length,1);
  assert.equal(await scalar(`SELECT count(*)::int count FROM signal_semantic_context_review_annotations
    WHERE workspace_id=$1::uuid AND annotation_key='concurrent-resolution'`,[fixture.workspace.id]),2,
  "two distinct concurrent commands converge on exactly one resolved successor");
  assert.equal(await scalar(`SELECT count(*)::int count FROM signal_semantic_context_events event
    JOIN signal_governance_control_operations operation ON operation.id=event.operation_id
    WHERE event.workspace_id=$1::uuid AND operation.action='resolve-semantic-context-annotation'
      AND operation.semantic_context_decision_input->>'annotation_key'='concurrent-resolution'`,
  [fixture.workspace.id]),1,"concurrent resolution records exactly one authority event");
  await transaction((queryable)=>resolveSignalSemanticContextAnnotationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-resolve-correction-context",
    generationKey:draft.generation_key,elementKey:"correction-pending",annotationKey:"correction-context",
    reason:"insufficient_context",rationale:"Context is sufficient.",resolution:"context_sufficient",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONFIRMATION_V1}));
  await pool.query(`CREATE OR REPLACE FUNCTION signal_semantic_context_decision_fault_fixture_v2()
    RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.event_kind='element_rejected' THEN RAISE EXCEPTION 'fixture decision fault' USING ERRCODE='40001'; END IF;
      RETURN NEW; END $$;
    CREATE TRIGGER trg_signal_semantic_context_decision_fault_fixture_v2
      BEFORE INSERT ON signal_semantic_context_events FOR EACH ROW
      EXECUTE FUNCTION signal_semantic_context_decision_fault_fixture_v2()`);
  await assert.rejects(transaction((queryable)=>rejectSignalSemanticContextElementV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-reject-fault-boundary",
    generationKey:draft.generation_key,elementKey:"correction-rejected",reason:"insufficient_context",
    rationale:"Reject only when the terminal decision is committed."})),/fixture decision fault/u);
  await pool.query(`DROP TRIGGER trg_signal_semantic_context_decision_fault_fixture_v2
      ON signal_semantic_context_events;
    DROP FUNCTION signal_semantic_context_decision_fault_fixture_v2()`);
  assert.equal(await scalar(`SELECT count(*)::int count FROM signal_semantic_context_review_annotations annotation
    JOIN signal_semantic_context_element_versions element ON element.id=annotation.subject_element_id
    WHERE annotation.workspace_id=$1::uuid AND element.element_key='correction-rejected'`,
  [fixture.workspace.id]),0,"rejection never fabricates rationale annotations");
  assert.equal(await scalar(`SELECT count(*)::int count FROM signal_semantic_context_element_versions element
    WHERE element.workspace_id=$1::uuid AND element.element_key='correction-rejected'
      AND element.disposition='pending' AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor
        WHERE successor.supersedes_element_id=element.id)`,[fixture.workspace.id]),1,
  "the faulted first-class decision preserves the pending predecessor");
  await transaction((queryable)=>rejectSignalSemanticContextElementV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-reject-before-correction",
    generationKey:draft.generation_key,elementKey:"correction-rejected",reason:"insufficient_context",
    rationale:"The governed evidence does not support the current wording."}));
  await transaction((queryable)=>correctSignalSemanticContextElementV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-correct-rejected",
    generationKey:draft.generation_key,elementKey:"correction-rejected",reason:"operator_correction",
    rationale:"Reopen a rejected candidate with governed wording.",correction:{canonical_key:"amazon-echo-dot",
      display_text:"Amazon Echo Dot",scope:"primary_brand",relation_kind:null,
      relation_target_key:null}}));
  for(const key of ["merge-target","correction-pending","correction-rejected"]){
    await approveElement(fixture,draft.generation_key,key,`v2-approve-${key}`);
  }
  const beforePreflightOps=await scalar(`SELECT count(*)::int count FROM signal_governance_control_operations
    WHERE workspace_id=$1::uuid`,[fixture.workspace.id]);
  let preflight=await transaction((queryable)=>loadSignalSemanticContextPublicationPreflightV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key}));
  assert.equal(preflight.publishable,true);
  assert.deepEqual(preflight.blockers,[]);
  assert.equal(await scalar(`SELECT count(*)::int count FROM signal_governance_control_operations
    WHERE workspace_id=$1::uuid`,[fixture.workspace.id]),beforePreflightOps,"V2 preflight is read-only");
  await transaction((queryable)=>correctSignalSemanticContextElementV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-stale-review-correction",
    generationKey:draft.generation_key,elementKey:"merge-target",reason:"operator_correction",
    rationale:"Reconfirm the reviewed target wording.",correction:{canonical_key:"amazon-alexa",
      display_text:"Amazon Alexa",scope:"primary_brand",relation_kind:null,
      relation_target_key:null}}));
  await approveElement(fixture,draft.generation_key,"merge-target","v2-stale-review-reapprove");
  await assert.rejects(transaction((queryable)=>publishSignalSemanticContextGenerationV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-stale-publication",
    generationKey:draft.generation_key,preflightDigest:preflight.preflight_digest,
    confirmation:SIGNAL_SEMANTIC_CONTEXT_PUBLICATION_CONFIRMATION_V2})),/semantic_context_stale_preflight/u);
  preflight=await transaction((queryable)=>loadSignalSemanticContextPublicationPreflightV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key}));
  await pool.query(`CREATE OR REPLACE FUNCTION signal_semantic_context_publication_fault_fixture_v2()
    RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.event_kind='generation_published' THEN
        RAISE EXCEPTION 'fixture publication fault' USING ERRCODE='40001';
      END IF; RETURN NEW; END $$;
    CREATE TRIGGER trg_signal_semantic_context_publication_fault_fixture_v2
      BEFORE INSERT ON signal_semantic_context_events FOR EACH ROW
      EXECUTE FUNCTION signal_semantic_context_publication_fault_fixture_v2()`);
  await assert.rejects(transaction((queryable)=>publishSignalSemanticContextGenerationV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-faulted-publish",
    generationKey:draft.generation_key,preflightDigest:preflight.preflight_digest,
    confirmation:SIGNAL_SEMANTIC_CONTEXT_PUBLICATION_CONFIRMATION_V2})),/fixture publication fault/u);
  await pool.query(`DROP TRIGGER trg_signal_semantic_context_publication_fault_fixture_v2
      ON signal_semantic_context_events;
    DROP FUNCTION signal_semantic_context_publication_fault_fixture_v2()`);
  const afterFault=await pool.query<{status:string;published_operation_id:string|null}>(
    `SELECT status,published_operation_id::text FROM signal_semantic_context_generations
      WHERE workspace_id=$1::uuid AND generation_key=$2`,[fixture.workspace.id,draft.generation_key]);
  assert.deepEqual(afterFault.rows,[{status:"draft",published_operation_id:null}],
  "fault injection rolls publication back atomically");
  const concurrentPublish=await Promise.all([1,2].map(()=>transaction((queryable)=>
    publishSignalSemanticContextGenerationV2({queryable,workspace:fixture.workspace,actor:fixture.actor,
      idempotencyKey:"v2-sealed-publish",generationKey:draft.generation_key,
      preflightDigest:preflight.preflight_digest,
      confirmation:SIGNAL_SEMANTIC_CONTEXT_PUBLICATION_CONFIRMATION_V2}))));
  assert.deepEqual(concurrentPublish[0],concurrentPublish[1],"concurrent publication converges by idempotency key");
  const published=concurrentPublish[0]!;
  assert.equal(published.lifecycle_state,"published");
  assert.deepEqual(await transaction((queryable)=>publishSignalSemanticContextGenerationV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-sealed-publish",
    generationKey:draft.generation_key,preflightDigest:preflight.preflight_digest,
    confirmation:SIGNAL_SEMANTIC_CONTEXT_PUBLICATION_CONFIRMATION_V2})),published,"V2 publish replay is exact");
  await assert.rejects(transaction((queryable)=>publishSignalSemanticContextGenerationV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-sealed-publish",
    generationKey:draft.generation_key,preflightDigest:digest("different-preflight"),
    confirmation:SIGNAL_SEMANTIC_CONTEXT_PUBLICATION_CONFIRMATION_V2})),/semantic_context_idempotency_conflict/u);
  await assert.rejects(transaction((queryable)=>publishSignalSemanticContextGenerationV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-second-publish-key",
    generationKey:draft.generation_key,preflightDigest:preflight.preflight_digest,
    confirmation:SIGNAL_SEMANTIC_CONTEXT_PUBLICATION_CONFIRMATION_V2})),/semantic_context_draft_not_found/u);
  await assert.rejects(pool.query(`UPDATE signal_semantic_context_generations SET review_graph_digest=$2
    WHERE workspace_id=$1::uuid AND generation_key=$3`,[fixture.workspace.id,digest("tamper"),draft.generation_key]),
  hasCode("55000"));
  assert.deepEqual(await protectedCounts(fixture.workspace.id),protectedBefore);
}

async function exerciseDeliberateApprovalV2(){
  const operationKeys={initial:"v2-deliberate-initial",lineage:"v2-deliberate-lineage",
    proposals:"v2-deliberate-proposals",blank:"v2-deliberate-blank",legacySingle:"v1-retired-single",
    legacyBulk:"v1-retired-bulk",rationaleFirst:"v2-rationale-probe-first",
    rationaleSecond:"v2-rationale-probe-second",singleReplay:"v2-deliberate-single-replay",
    bulkOne:"v2-deliberate-bulk-one",
    bulk:"v2-deliberate-bulk",overLimit:"v2-deliberate-over-limit",
    crossKind:"v2-deliberate-cross-kind",duplicate:"v2-deliberate-duplicate",
    bulkFifteen:"v2-deliberate-bulk-fifteen"} as const;
  const fixture=await seedFixture();
  const initial=await transaction((queryable)=>createSignalSemanticContextDraftV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:operationKeys.initial}));
  const lineage=await fullLineageForDraft(fixture,initial.generation_key,terminalPreflightConfiguration);
  const draft=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:operationKeys.lineage,
    reason:"provider_lineage_missing",proposalLineage:lineage}));
  const proposals=[...Array.from({length:20},(_,index)=>proposal(`alias-${String(index).padStart(2,"0")}`,
    "alias",`alias-${String(index).padStart(2,"0")}`,`Alias ${index}`,0.5,fixture.profileId)),
    proposal("alias-rationale-probe","alias","alias-rationale-probe","Alias rationale probe",0.5,
      fixture.profileId),
    proposal("product-one","product","product-one","Product one",0.5,fixture.productId)];
  await transaction((queryable)=>appendSignalSemanticContextProposalsV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:operationKeys.proposals,
    generationKey:draft.generation_key,proposals}));
  const whitespaceVectors=[
    {label:"space",raw:"  Governed basis  ",expected:"Governed basis"},
    {label:"tab",raw:"\tGoverned basis\t",expected:"Governed basis"},
    {label:"CRLF",raw:"\r\nGoverned basis\r\n",expected:"Governed basis"},
    {label:"NBSP",raw:"\u00a0Governed basis\u00a0",expected:"Governed basis"},
    {label:"astral scalar",raw:"  🧠 governed basis  ",expected:"🧠 governed basis"},
    {label:"NFC",raw:"  Cafe\u0301 governed basis  ",expected:"Café governed basis"}
  ];
  for(const vector of whitespaceVectors){
    const service=normalizeSignalSemanticContextDecisionBasisV2({reason:"semantic_boundary",
      rationale:vector.raw}).rationale;
    const database=(await pool.query<{value:string}>(`SELECT signal_semantic_context_trim_ecmascript_v2(
      normalize($1::text,NFC)) value`,[vector.raw])).rows[0]!.value;
    assert.equal(service,vector.expected,`${vector.label}: service normalization is canonical`);
    assert.equal(database,vector.expected,`${vector.label}: PostgreSQL normalization matches ECMAScript`);
  }
  const defaultDirectBasis={contract_version:"signal-semantic-context-decision-v2" as const,
    reason:"alias_or_variant",rationale:"The same explicit basis applies to every selected fixture alias."};
  const bulkInput=(elementKeys:string[],overrides:Record<string,unknown>={})=>({
    contract_version:"signal-semantic-context-decision-v2",generation_key:draft.generation_key,
    element_keys:elementKeys,decision_basis:defaultDirectBasis,
    confirmation:"apply_shared_decision_basis_to_all_selected_elements",...overrides});
  const directReject=async(label:string,spec:DirectDecisionGraphSpec,message:RegExp)=>{
    const before=await directDecisionState(fixture.workspace.id,draft.generation_key);
    await assert.rejects(attemptDirectDecisionGraph(fixture,draft.generation_key,spec),
      hasCodeAndMessage("23514",message),label);
    assert.deepEqual(await directDecisionState(fixture.workspace.id,draft.generation_key),before,
      `${label}: rollback must preserve every measured row count and the stored/recomputed digest`);
  };
  const validSingle=await attemptDirectDecisionGraph(fixture,draft.generation_key,{
    operationAction:"decide-semantic-context-element",operationInput:{
      contract_version:"signal-semantic-context-decision-v2",generation_key:draft.generation_key,
      element_key:"alias-17",action:"approve",decision_basis:defaultDirectBasis,
      confirmation:"approve_selected_semantic_context_element"},successors:[{predecessorKey:"alias-17"}]});
  assert.equal(validSingle.committed,true,"the direct-SQL single control commits a complete graph");
  const validBulk=await attemptDirectDecisionGraph(fixture,draft.generation_key,{
    operationAction:"bulk-approve-semantic-context-elements",
    operationInput:bulkInput(["alias-18","alias-19"]),
    successors:[{predecessorKey:"alias-18"},{predecessorKey:"alias-19"}]});
  assert.equal(validBulk.committed,true,"the direct-SQL bulk control commits a complete graph");
  assert.notEqual(validBulk.preDraftDigest,validBulk.postDraftDigest);
  assert.equal((await directDecisionState(fixture.workspace.id,draft.generation_key)).storedDigest,
    validBulk.postDraftDigest,"the valid control stores the independently computed post-state digest");
  await directReject("PostgreSQL rejects a string single element_version result",{
    operationAction:"decide-semantic-context-element",operationInput:{
      contract_version:"signal-semantic-context-decision-v2",generation_key:draft.generation_key,
      element_key:"alias-00",action:"approve",decision_basis:defaultDirectBasis,
      confirmation:"approve_selected_semantic_context_element"},successors:[{predecessorKey:"alias-00"}],
    mutation:{resultElementVersionAsString:true}},/Single Semantic Context decision result is invalid/u);
  await directReject("PostgreSQL rejects a string bulk approved result",{
    operationAction:"bulk-approve-semantic-context-elements",
    operationInput:bulkInput(["alias-00","alias-01"]),
    successors:[{predecessorKey:"alias-00"},{predecessorKey:"alias-01"}],
    mutation:{resultApprovedAsString:true}},/Bulk Semantic Context decision result is invalid/u);
  const sixteen=Array.from({length:16},(_,index)=>`alias-${String(index).padStart(2,"0")}`);
  await directReject("PostgreSQL rejects a sixteen-successor bulk graph",{
    operationAction:"bulk-approve-semantic-context-elements",operationInput:bulkInput(sixteen),
    successors:sixteen.map((predecessorKey)=>({predecessorKey}))},/cardinality/u);
  await directReject("PostgreSQL rejects a partial bulk graph",{
    operationAction:"bulk-approve-semantic-context-elements",
    operationInput:bulkInput(["alias-00","alias-01"]),successors:[{predecessorKey:"alias-00"}]},
  /cardinality/u);
  await directReject("PostgreSQL rejects a substituted bulk key",{
    operationAction:"bulk-approve-semantic-context-elements",
    operationInput:bulkInput(["alias-00","alias-01"]),
    successors:[{predecessorKey:"alias-00"},{predecessorKey:"alias-02"}]},/successor keys/u);
  await directReject("PostgreSQL rejects mixed element kinds",{
    operationAction:"bulk-approve-semantic-context-elements",
    operationInput:bulkInput(["alias-00","product-one"]),
    successors:[{predecessorKey:"alias-00"},{predecessorKey:"product-one"}]},/shared authority/u);
  await directReject("PostgreSQL rejects mixed decision bases",{
    operationAction:"bulk-approve-semantic-context-elements",
    operationInput:bulkInput(["alias-00","alias-01"]),successors:[{predecessorKey:"alias-00"},
      {predecessorKey:"alias-01",basis:{...defaultDirectBasis,reason:"semantic_boundary",
        rationale:"This second otherwise-valid basis must not split the collective authority."}}]},
  /shared authority/u);
  await directReject("PostgreSQL rejects a rejected successor under bulk approval",{
    operationAction:"bulk-approve-semantic-context-elements",
    operationInput:bulkInput(["alias-00","alias-01"]),successors:[{predecessorKey:"alias-00"},
      {predecessorKey:"alias-01",disposition:"rejected"}]},/shared authority/u);
  await directReject("PostgreSQL rejects two successors under a single decision",{
    operationAction:"decide-semantic-context-element",operationInput:{
      contract_version:"signal-semantic-context-decision-v2",generation_key:draft.generation_key,
      element_key:"alias-00",action:"approve",decision_basis:defaultDirectBasis,
      confirmation:"approve_selected_semantic_context_element"},
    successors:[{predecessorKey:"alias-00"},{predecessorKey:"alias-01"}]},/cardinality/u);
  await directReject("PostgreSQL rejects a single action/disposition mismatch",{
    operationAction:"decide-semantic-context-element",operationInput:{
      contract_version:"signal-semantic-context-decision-v2",generation_key:draft.generation_key,
      element_key:"alias-00",action:"reject",decision_basis:defaultDirectBasis,
      confirmation:"reject_selected_semantic_context_element"},successors:[{predecessorKey:"alias-00"}]},
  /does not match its sealed input/u);
  await directReject("PostgreSQL rejects bulk input without confirmation",{
    operationAction:"bulk-approve-semantic-context-elements",operationInput:{
      contract_version:"signal-semantic-context-decision-v2",generation_key:draft.generation_key,
      element_keys:["alias-00","alias-01"],decision_basis:defaultDirectBasis},
    successors:[{predecessorKey:"alias-00"},{predecessorKey:"alias-01"}]},/Bulk Semantic Context decision input is invalid/u);
  await directReject("PostgreSQL rejects bulk input without basis",{
    operationAction:"bulk-approve-semantic-context-elements",operationInput:{
      contract_version:"signal-semantic-context-decision-v2",generation_key:draft.generation_key,
      element_keys:["alias-00","alias-01"],
      confirmation:"apply_shared_decision_basis_to_all_selected_elements"},
    successors:[{predecessorKey:"alias-00"},{predecessorKey:"alias-01"}]},/basis is invalid/u);
  await directReject("PostgreSQL rejects a forged stored generation digest",{
    operationAction:"bulk-approve-semantic-context-elements",
    operationInput:bulkInput(["alias-00","alias-01"]),
    successors:[{predecessorKey:"alias-00"},{predecessorKey:"alias-01"}],
    mutation:{storedDraftDigest:digest("forged-stored-draft"),
      repeatStoredDigestInResultAndBulkEvent:true}},/stored draft digest/u);
  await directReject("PostgreSQL rejects a forged bulk previous-state digest",{
    operationAction:"bulk-approve-semantic-context-elements",
    operationInput:bulkInput(["alias-00","alias-01"]),
    successors:[{predecessorKey:"alias-00"},{predecessorKey:"alias-01"}],
    mutation:{eventPreviousDigest:digest("forged-bulk-previous")}},/pre\/post graphs/u);
  await directReject("PostgreSQL rejects a forged bulk next-state digest",{
    operationAction:"bulk-approve-semantic-context-elements",
    operationInput:bulkInput(["alias-00","alias-01"]),
    successors:[{predecessorKey:"alias-00"},{predecessorKey:"alias-01"}],
    mutation:{eventNextDigest:digest("forged-bulk-next")}},/pre\/post graphs/u);
  await directReject("PostgreSQL rejects a mismatched result draft digest ref",{
    operationAction:"bulk-approve-semantic-context-elements",
    operationInput:bulkInput(["alias-00","alias-01"]),
    successors:[{predecessorKey:"alias-00"},{predecessorKey:"alias-01"}],
    mutation:{resultDraftDigestRef:"sha256:mismatch"}},/result is incomplete/u);
  await assert.rejects(transaction((queryable)=>decideSignalSemanticContextElementV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:operationKeys.blank,
    generationKey:draft.generation_key,elementKey:"alias-00",action:"approve",reason:"semantic_boundary",
    rationale:"   ",confirmation:SIGNAL_SEMANTIC_CONTEXT_APPROVAL_CONFIRMATION_V2})),
  /semantic_context_rationale_invalid/u);
  await assert.rejects(decideSignalSemanticContextElementV1({queryable:pool,workspace:fixture.workspace,
    actor:fixture.actor,idempotencyKey:operationKeys.legacySingle,generationKey:draft.generation_key,
    elementKey:"alias-00",action:"approve"}),/semantic_context_decision_v1_retired/u);
  await assert.rejects(decideSignalSemanticContextElementV1({queryable:pool,workspace:fixture.workspace,
    actor:fixture.actor,idempotencyKey:operationKeys.legacySingle,generationKey:draft.generation_key,
    elementKey:"alias-00",action:"reject"}),/semantic_context_decision_v1_retired/u);
  await assert.rejects(bulkApproveSignalSemanticContextElementsV1({queryable:pool,workspace:fixture.workspace,
    actor:fixture.actor,idempotencyKey:operationKeys.legacyBulk,generationKey:draft.generation_key,
    elementKeys:["alias-00","alias-01"]}),/semantic_context_bulk_approval_v1_retired/u);

  const rationaleClient=await pool.connect();
  try{
    await rationaleClient.query("BEGIN");await rationaleClient.query("SAVEPOINT rationale_variant");
    await decideSignalSemanticContextElementV2({queryable:rationaleClient,workspace:fixture.workspace,
      actor:fixture.actor,idempotencyKey:operationKeys.rationaleFirst,generationKey:draft.generation_key,
      elementKey:"alias-rationale-probe",action:"approve",reason:"semantic_boundary",
      rationale:"🧠".repeat(1000),confirmation:SIGNAL_SEMANTIC_CONTEXT_APPROVAL_CONFIRMATION_V2});
    const firstRationale=await loadSignalSemanticContextPublicationPreflightV2({queryable:rationaleClient,
      workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key});
    await rationaleClient.query("ROLLBACK TO SAVEPOINT rationale_variant");
    await decideSignalSemanticContextElementV2({queryable:rationaleClient,workspace:fixture.workspace,
      actor:fixture.actor,idempotencyKey:operationKeys.rationaleSecond,generationKey:draft.generation_key,
      elementKey:"alias-rationale-probe",action:"approve",reason:"semantic_boundary",
      rationale:`${"🧠".repeat(999)}✅`,confirmation:SIGNAL_SEMANTIC_CONTEXT_APPROVAL_CONFIRMATION_V2});
    const secondRationale=await loadSignalSemanticContextPublicationPreflightV2({queryable:rationaleClient,
      workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key});
    assert.equal(firstRationale.digest_refs.candidate,secondRationale.digest_refs.candidate,
      "rationale-only review changes preserve candidate semantics");
    assert.equal(firstRationale.digest_refs.evidence,secondRationale.digest_refs.evidence,
      "rationale-only review changes preserve evidence semantics");
    assert.notEqual(firstRationale.digest_refs.review,secondRationale.digest_refs.review);
    assert.notEqual(firstRationale.preflight_digest,secondRationale.preflight_digest);
    await rationaleClient.query("ROLLBACK");
  }finally{await rationaleClient.query("ROLLBACK").catch(()=>undefined);rationaleClient.release();}

  const singleReplayBasis=normalizeSignalSemanticContextDecisionBasisV2({reason:"semantic_boundary",
    rationale:"This fixture decision proves canonical numeric replay from the operation ledger."});
  const singleReplayInput={contract_version:"signal-semantic-context-decision-v2" as const,
    generation_key:draft.generation_key,element_key:"alias-rationale-probe",action:"approve" as const,
    decision_basis:singleReplayBasis,confirmation:SIGNAL_SEMANTIC_CONTEXT_APPROVAL_CONFIRMATION_V2};
  await transaction((queryable)=>decideSignalSemanticContextElementV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:operationKeys.singleReplay,
    generationKey:draft.generation_key,elementKey:"alias-rationale-probe",action:"approve",
    reason:"semantic_boundary",
    rationale:"This fixture decision proves canonical numeric replay from the operation ledger.",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_APPROVAL_CONFIRMATION_V2}));
  const singleLedgerReplay=await transaction((queryable)=>beginSignalProductOperationV1<{
    element_key:string;element_version:number;disposition:"approved"|"rejected";draft_digest_ref:string
  }>({queryable,workspace:fixture.workspace,actor:fixture.actor,
    action:"decide-semantic-context-element",idempotencyKey:operationKeys.singleReplay,input:singleReplayInput,
    semanticContextDecisionInput:{payload:singleReplayInput,digest:digestCanonicalJsonV2(singleReplayInput)}}));
  assert.equal(singleLedgerReplay.created,false);
  assert.equal(typeof singleLedgerReplay.replay?.element_version,"number",
    "single operation replay preserves a canonical JSON number");

  const before=await transaction((queryable)=>loadSignalSemanticContextPublicationPreflightV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key}));
  await assert.rejects(transaction((queryable)=>bulkApproveSignalSemanticContextElementsV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:operationKeys.bulkOne,
    generationKey:draft.generation_key,elementKeys:["alias-00"],reason:"alias_or_variant",
    rationale:"A bulk decision requires at least two explicit leaves.",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_BULK_APPROVAL_CONFIRMATION_V2})),
  /semantic_context_bulk_scope_invalid/u);
  const bulk=await transaction((queryable)=>bulkApproveSignalSemanticContextElementsV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:operationKeys.bulk,
    generationKey:draft.generation_key,elementKeys:["alias-00","alias-01"],reason:"alias_or_variant",
    rationale:"  Cafe\u0301 aliases share the same governed identity basis.  ",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_BULK_APPROVAL_CONFIRMATION_V2}));
  assert.equal(bulk.approved,2);
  assert.deepEqual(await transaction((queryable)=>bulkApproveSignalSemanticContextElementsV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:operationKeys.bulk,
    generationKey:draft.generation_key,elementKeys:["alias-00","alias-01"],reason:"alias_or_variant",
    rationale:"Café aliases share the same governed identity basis.",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_BULK_APPROVAL_CONFIRMATION_V2})),bulk,
  "NFC-equivalent replay is exact");
  const bulkReplayBasis=normalizeSignalSemanticContextDecisionBasisV2({reason:"alias_or_variant",
    rationale:"Café aliases share the same governed identity basis."});
  const bulkReplayInput={contract_version:"signal-semantic-context-decision-v2" as const,
    generation_key:draft.generation_key,element_keys:["alias-00","alias-01"],
    decision_basis:bulkReplayBasis,confirmation:SIGNAL_SEMANTIC_CONTEXT_BULK_APPROVAL_CONFIRMATION_V2};
  const bulkLedgerReplay=await transaction((queryable)=>beginSignalProductOperationV1<{
    generation_key:string;approved:number;draft_digest_ref:string
  }>({queryable,workspace:fixture.workspace,actor:fixture.actor,
    action:"bulk-approve-semantic-context-elements",idempotencyKey:operationKeys.bulk,input:bulkReplayInput,
    semanticContextDecisionInput:{payload:bulkReplayInput,digest:digestCanonicalJsonV2(bulkReplayInput)}}));
  assert.equal(bulkLedgerReplay.created,false);
  assert.equal(typeof bulkLedgerReplay.replay?.approved,"number",
    "bulk operation replay preserves a canonical JSON number");
  await directReject("PostgreSQL rejects terminal-to-terminal redecision",{
    operationAction:"decide-semantic-context-element",operationInput:{
      contract_version:"signal-semantic-context-decision-v2",generation_key:draft.generation_key,
      element_key:"alias-00",action:"approve",decision_basis:defaultDirectBasis,
      confirmation:"approve_selected_semantic_context_element"},successors:[{predecessorKey:"alias-00"}]},
  /does not match its sealed input/u);
  await assert.rejects(transaction((queryable)=>bulkApproveSignalSemanticContextElementsV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:operationKeys.bulk,
    generationKey:draft.generation_key,elementKeys:["alias-00","alias-01"],reason:"alias_or_variant",
    rationale:"A different rationale must alter the operation request digest.",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_BULK_APPROVAL_CONFIRMATION_V2})),
  /Idempotency-Key was reused with incompatible product input/u);
  await assert.rejects(transaction((queryable)=>bulkApproveSignalSemanticContextElementsV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:operationKeys.overLimit,
    generationKey:draft.generation_key,elementKeys:Array.from({length:16},(_,index)=>`alias-${String(index).padStart(2,"0")}`),
    reason:"alias_or_variant",rationale:"Shared basis.",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_BULK_APPROVAL_CONFIRMATION_V2})),/semantic_context_merge_scope_invalid/u);
  await assert.rejects(transaction((queryable)=>bulkApproveSignalSemanticContextElementsV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:operationKeys.crossKind,
    generationKey:draft.generation_key,elementKeys:["alias-02","product-one"],reason:"semantic_boundary",
    rationale:"This must not cross kinds.",confirmation:SIGNAL_SEMANTIC_CONTEXT_BULK_APPROVAL_CONFIRMATION_V2})),
  /semantic_context_bulk_kind_mismatch/u);
  await assert.rejects(transaction((queryable)=>bulkApproveSignalSemanticContextElementsV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:operationKeys.duplicate,
    generationKey:draft.generation_key,elementKeys:["alias-02","alias-02"],reason:"alias_or_variant",
    rationale:"Duplicate browser authority is invalid.",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_BULK_APPROVAL_CONFIRMATION_V2})),/semantic_context_duplicate_key/u);
  const fifteen=await transaction((queryable)=>bulkApproveSignalSemanticContextElementsV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:operationKeys.bulkFifteen,
    generationKey:draft.generation_key,elementKeys:Array.from({length:15},(_,index)=>
      `alias-${String(index+2).padStart(2,"0")}`),reason:"alias_or_variant",
    rationale:"The same explicit alias basis applies to this bounded set of fifteen.",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_BULK_APPROVAL_CONFIRMATION_V2}));
  assert.equal(fifteen.approved,15);
  const competing=await Promise.allSettled([
    approveElement(fixture,draft.generation_key,"product-one","v2-deliberate-race-a"),
    approveElement(fixture,draft.generation_key,"product-one","v2-deliberate-race-b")
  ]);
  assert.equal(competing.filter((result)=>result.status==="fulfilled").length,1);
  assert.equal(competing.filter((result)=>result.status==="rejected").length,1,
    "distinct idempotency keys cannot fork one pending leaf");
  const basis=await pool.query<{decision_contract_version:string;decision_reason_code:string;
    decision_rationale:string;decision_basis_digest:string}>(`SELECT decision_contract_version,
      decision_reason_code,decision_rationale,decision_basis_digest
    FROM signal_semantic_context_element_versions element WHERE workspace_id=$1::uuid
      AND element_key='alias-00' AND disposition='approved' AND NOT EXISTS(
        SELECT 1 FROM signal_semantic_context_element_versions successor
        WHERE successor.supersedes_element_id=element.id)`,[fixture.workspace.id]);
  assert.deepEqual(basis.rows.map(({decision_contract_version,decision_reason_code,decision_rationale})=>({
    decision_contract_version,decision_reason_code,decision_rationale})),[{
      decision_contract_version:"signal-semantic-context-decision-v2",decision_reason_code:"alias_or_variant",
      decision_rationale:"Café aliases share the same governed identity basis."}]);
  assert.match(basis.rows[0]!.decision_basis_digest,/^sha256:[0-9a-f]{64}$/u);
  const decisionDetail=await transaction((queryable)=>loadSignalSemanticContextReviewDetailV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key,
    elementKey:"alias-00"}));
  assert.deepEqual(decisionDetail.decision_basis,{state:"complete",
    contract_version:"signal-semantic-context-decision-v2",reason:"alias_or_variant",
    rationale:"Café aliases share the same governed identity basis.",
    decided_at:decisionDetail.decision_basis.decided_at,reviewer:"authenticated_operator"});
  const after=await transaction((queryable)=>loadSignalSemanticContextPublicationPreflightV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key}));
  assert.notEqual(after.digest_refs.review,before.digest_refs.review,"decision basis changes the review graph digest");
  assert.notEqual(after.preflight_digest,before.preflight_digest,"decision basis invalidates the publication token");
  await assert.rejects(pool.query(`INSERT INTO signal_semantic_context_element_versions(
    workspace_id,generation_id,artifact_id,evidence_group_id,element_key,element_version,element_kind,canonical_key,
    display_text,scope,entity_type,entity_id,locale,relation_kind,relation_target_key,confidence,disposition,origin_kind,
    supersedes_element_id,original_proposal_element_id,source_refs_digest,element_digest,operation_id,proposed_by_user_id,
    decided_by_user_id,decided_at)
    SELECT workspace_id,generation_id,artifact_id,evidence_group_id,element_key,element_version+1,element_kind,
      canonical_key,display_text,scope,entity_type,entity_id,locale,relation_kind,relation_target_key,confidence,
      'approved','operator_decision',id,COALESCE(original_proposal_element_id,id),source_refs_digest,element_digest,
      operation_id,proposed_by_user_id,decided_by_user_id,clock_timestamp()
    FROM signal_semantic_context_element_versions element WHERE workspace_id=$1::uuid AND element_key='alias-02'
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor
        WHERE successor.supersedes_element_id=element.id)`,[fixture.workspace.id]),hasCode("23514"));
}

async function exerciseLocaleAuthorityV1(){
  const fixture=await seedFixture();
  const protectedBefore=await protectedCounts(fixture.workspace.id);
  const initial=await transaction((queryable)=>createSignalSemanticContextDraftV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"locale-authority-initial"}));
  const lineage=await fullLineageForDraft(fixture,initial.generation_key,terminalPreflightConfiguration);
  const draft=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"locale-authority-lineage",
    reason:"provider_lineage_missing",proposalLineage:lineage}));
  const localeKeys=Array.from({length:6},(_,index)=>`locale-authority-${index}`);
  await transaction((queryable)=>appendSignalSemanticContextProposalsV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"fixture-locale-proposals",
    generationKey:draft.generation_key,proposals:localeKeys.map((key,index)=>({
      ...proposal(key,"alias",key,`Locale authority ${index}`,0.5,fixture.profileId),locale:null
    }))}));
  for(const [index,key] of localeKeys.entries())await approveElement(
    fixture,draft.generation_key,key,`locale-authority-initial-approval-${index}`);

  let preflight=await transaction((queryable)=>loadSignalSemanticContextPublicationPreflightV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key}));
  assert.equal(preflight.counts.locale_market_required_unresolved,6);
  assert.ok(preflight.blockers.includes("locale_market_required_unresolved"));

  const versionsBeforeInvalid=await scalar(`SELECT count(*)::int count
    FROM signal_semantic_context_element_versions WHERE workspace_id=$1::uuid AND generation_id=(
      SELECT id FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid AND generation_key=$2)`,
  [fixture.workspace.id,draft.generation_key]);
  await assert.rejects(transaction((queryable)=>decideSignalSemanticContextLocaleAuthorityV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"locale-authority-invalid-locale",
    generationKey:draft.generation_key,elementKeys:[localeKeys[0]!],disposition:"locale_specific",
    locale:"fr-FR",reason:"semantic_boundary",rationale:"A locale outside the sealed generation must fail.",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_LOCALE_DECISION_CONFIRMATION_V1})),
  /semantic_context_locale_outside_generation/u);
  assert.equal(await scalar(`SELECT count(*)::int count FROM signal_semantic_context_element_versions
    WHERE workspace_id=$1::uuid AND generation_id=(SELECT id FROM signal_semantic_context_generations
      WHERE workspace_id=$1::uuid AND generation_key=$2)`,[fixture.workspace.id,draft.generation_key]),
  versionsBeforeInvalid,"invalid locale writes no successor");

  const globalResult=await transaction((queryable)=>decideSignalSemanticContextLocaleAuthorityV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"locale-authority-global-one",
    generationKey:draft.generation_key,elementKeys:[localeKeys[0]!],disposition:"global",locale:null,
    reason:"semantic_boundary",rationale:"This operator decision explicitly keeps the candidate workspace-global.",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_LOCALE_DECISION_CONFIRMATION_V1}));
  assert.deepEqual(await transaction((queryable)=>decideSignalSemanticContextLocaleAuthorityV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"locale-authority-global-one",
    generationKey:draft.generation_key,elementKeys:[localeKeys[0]!],disposition:"global",locale:null,
    reason:"semantic_boundary",rationale:"This operator decision explicitly keeps the candidate workspace-global.",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_LOCALE_DECISION_CONFIRMATION_V1})),globalResult,
  "same idempotency key replays the exact locale-authority result");

  const afterGlobalVersions=await scalar(`SELECT count(*)::int count FROM signal_semantic_context_element_versions
    WHERE workspace_id=$1::uuid AND generation_id=(SELECT id FROM signal_semantic_context_generations
      WHERE workspace_id=$1::uuid AND generation_key=$2)`,[fixture.workspace.id,draft.generation_key]);
  await assert.rejects(transaction((queryable)=>decideSignalSemanticContextLocaleAuthorityV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"locale-authority-atomic-stale",
    generationKey:draft.generation_key,elementKeys:[localeKeys[0]!,localeKeys[1]!],disposition:"global",locale:null,
    reason:"semantic_boundary",rationale:"Every selected leaf must still be eligible at the same locked boundary.",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_LOCALE_DECISION_CONFIRMATION_V1})),
  /semantic_context_locale_decision_not_eligible/u);
  assert.equal(await scalar(`SELECT count(*)::int count FROM signal_semantic_context_element_versions
    WHERE workspace_id=$1::uuid AND generation_id=(SELECT id FROM signal_semantic_context_generations
      WHERE workspace_id=$1::uuid AND generation_key=$2)`,[fixture.workspace.id,draft.generation_key]),
  afterGlobalVersions,"a stale member rolls the homogeneous batch back atomically");

  await transaction((queryable)=>decideSignalSemanticContextLocaleAuthorityV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"locale-authority-es-mx",
    generationKey:draft.generation_key,elementKeys:[localeKeys[1]!],disposition:"locale_specific",locale:"es-MX",
    reason:"locale_resolution",rationale:"The operator explicitly scopes this candidate to the sealed es-MX locale.",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_LOCALE_DECISION_CONFIRMATION_V1}));
  await transaction((queryable)=>decideSignalSemanticContextLocaleAuthorityV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"locale-authority-en-us",
    generationKey:draft.generation_key,elementKeys:[localeKeys[2]!],disposition:"locale_specific",locale:"en-US",
    reason:"locale_resolution",rationale:"The operator explicitly scopes this candidate to the sealed en-US locale.",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_LOCALE_DECISION_CONFIRMATION_V1}));
  await transaction((queryable)=>decideSignalSemanticContextLocaleAuthorityV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"locale-authority-global-batch",
    generationKey:draft.generation_key,elementKeys:[localeKeys[3]!,localeKeys[4]!],disposition:"global",locale:null,
    reason:"semantic_boundary",rationale:"One shared explicit basis governs this bounded homogeneous batch.",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_LOCALE_DECISION_CONFIRMATION_V1}));

  const concurrent=await Promise.allSettled(["a","b"].map((suffix)=>transaction((queryable)=>
    decideSignalSemanticContextLocaleAuthorityV1({queryable,workspace:fixture.workspace,actor:fixture.actor,
      idempotencyKey:`locale-authority-concurrent-${suffix}`,generationKey:draft.generation_key,
      elementKeys:[localeKeys[5]!],disposition:"locale_specific",locale:"es-MX",
      reason:"locale_resolution",rationale:"Concurrent requests must converge on one current successor.",
      confirmation:SIGNAL_SEMANTIC_CONTEXT_LOCALE_DECISION_CONFIRMATION_V1}))));
  assert.equal(concurrent.filter((entry)=>entry.status==="fulfilled").length,1);
  assert.equal(concurrent.filter((entry)=>entry.status==="rejected").length,1);

  const reopened=await pool.query<{element_key:string;disposition:string;origin_kind:string;locale:string|null;
    locale_decision_disposition:string|null;locale_decision_locale:string|null;decided_by_user_id:string|null}>(
    `SELECT element_key,disposition,origin_kind,locale,locale_decision_disposition,
      locale_decision_locale,decided_by_user_id::text FROM signal_semantic_context_element_versions element
     WHERE workspace_id=$1::uuid AND generation_id=(SELECT id FROM signal_semantic_context_generations
       WHERE workspace_id=$1::uuid AND generation_key=$2)
       AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor
         WHERE successor.supersedes_element_id=element.id)
     ORDER BY convert_to(element_key,'UTF8')`,[fixture.workspace.id,draft.generation_key]);
  assert.equal(reopened.rows.length,6);assert.ok(reopened.rows.every((row)=>row.disposition==="pending"));
  assert.ok(reopened.rows.every((row)=>row.origin_kind==="operator_correction"));
  assert.ok(reopened.rows.every((row)=>row.decided_by_user_id===null),
    "locale authority never auto-approves a reopened leaf");
  assert.equal(reopened.rows.find((row)=>row.element_key===localeKeys[0])?.locale,null);
  assert.equal(reopened.rows.find((row)=>row.element_key===localeKeys[1])?.locale,"es-MX");
  assert.equal(reopened.rows.find((row)=>row.element_key===localeKeys[2])?.locale,"en-US");
  assert.equal(await scalar(`SELECT count(*)::int count FROM signal_semantic_context_review_annotations
    WHERE generation_id=(SELECT id FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid
      AND generation_key=$2) AND annotation_type='locale_unresolved' AND state='resolved'
      AND resolution='global'`,[fixture.workspace.id,draft.generation_key]),3);

  await assert.rejects(transaction((queryable)=>decideSignalSemanticContextLocaleAuthorityV1({queryable,
    workspace:fixture.otherWorkspace,actor:fixture.actor,idempotencyKey:"locale-authority-cross-workspace",
    generationKey:draft.generation_key,elementKeys:[localeKeys[0]!],disposition:"global",locale:null,
    reason:"semantic_boundary",rationale:"Cross-workspace authority must fail closed.",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_LOCALE_DECISION_CONFIRMATION_V1})),/not_found/u);

  for(const [index,key] of localeKeys.entries())await approveElement(
    fixture,draft.generation_key,key,`locale-authority-deliberate-reapproval-${index}`);
  preflight=await transaction((queryable)=>loadSignalSemanticContextPublicationPreflightV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key}));
  assert.equal(preflight.counts.locale_market_required_unresolved,0);
  assert.equal(preflight.blockers.includes("locale_market_required_unresolved"),false);
  const approved=await pool.query<{disposition:string;locale_decision_contract_version:string|null;
    decision_contract_version:string|null}>(`SELECT disposition,locale_decision_contract_version,
      decision_contract_version FROM signal_semantic_context_element_versions element
    WHERE workspace_id=$1::uuid AND generation_id=(SELECT id FROM signal_semantic_context_generations
      WHERE workspace_id=$1::uuid AND generation_key=$2)
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor
        WHERE successor.supersedes_element_id=element.id)`,[fixture.workspace.id,draft.generation_key]);
  assert.equal(approved.rows.length,6);assert.ok(approved.rows.every((row)=>row.disposition==="approved"));
  assert.ok(approved.rows.every((row)=>row.locale_decision_contract_version!==null));
  assert.ok(approved.rows.every((row)=>row.decision_contract_version!==null));

  const lineageBeforeGeneric=await pool.query(`SELECT locale,locale_decision_contract_version,
    locale_decision_disposition,locale_decision_locale,locale_decision_reason_code,
    locale_decision_rationale,locale_decision_basis_digest,locale_decision_input_digest,
    locale_decision_authority_snapshot,locale_decision_authority_digest,
    locale_decision_prestate_digest,locale_decision_poststate_digest
    FROM signal_semantic_context_element_versions element
    WHERE workspace_id=$1::uuid AND element_key=$2 AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions child WHERE child.supersedes_element_id=element.id)`,
  [fixture.workspace.id,localeKeys[1]]);
  await transaction((queryable)=>correctSignalSemanticContextElementV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"locale-authority-generic-correction",
    generationKey:draft.generation_key,elementKey:localeKeys[1]!,reason:"operator_correction",
    rationale:"A generic wording correction must preserve the sealed locale authority.",
    correction:{canonical_key:"locale-authority-one-corrected",display_text:"Locale authority one corrected",
      scope:"primary_brand",relation_kind:null,relation_target_key:null}}));
  const lineageAfterGeneric=await pool.query(`SELECT locale,locale_decision_contract_version,
    locale_decision_disposition,locale_decision_locale,locale_decision_reason_code,
    locale_decision_rationale,locale_decision_basis_digest,locale_decision_input_digest,
    locale_decision_authority_snapshot,locale_decision_authority_digest,
    locale_decision_prestate_digest,locale_decision_poststate_digest
    FROM signal_semantic_context_element_versions element
    WHERE workspace_id=$1::uuid AND element_key=$2 AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions child WHERE child.supersedes_element_id=element.id)`,
  [fixture.workspace.id,localeKeys[1]]);
  assert.deepEqual(lineageAfterGeneric.rows,lineageBeforeGeneric.rows,
    "generic correction preserves locale and all eleven locale-decision columns byte-for-byte");
  await approveElement(fixture,draft.generation_key,localeKeys[1]!,"locale-authority-generic-reapproval");
  preflight=await transaction((queryable)=>loadSignalSemanticContextPublicationPreflightV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key}));
  assert.equal(preflight.counts.locale_market_required_unresolved,0,
    "preserved dedicated lineage remains publication-valid after generic correction and reapproval");

  const versionsBeforeBypass=await scalar(`SELECT count(*)::int count
    FROM signal_semantic_context_element_versions WHERE workspace_id=$1::uuid`,[fixture.workspace.id]);
  const bypassInsert=`INSERT INTO signal_semantic_context_element_versions(
    workspace_id,generation_id,artifact_id,evidence_group_id,element_key,element_version,element_kind,canonical_key,
    display_text,scope,entity_type,entity_id,locale,relation_kind,relation_target_key,confidence,disposition,origin_kind,
    supersedes_element_id,original_proposal_element_id,source_refs_digest,element_digest,operation_id,proposed_by_user_id,
    locale_decision_contract_version,locale_decision_disposition,locale_decision_locale,locale_decision_reason_code,
    locale_decision_rationale,locale_decision_basis_digest,locale_decision_input_digest,
    locale_decision_authority_snapshot,locale_decision_authority_digest,
    locale_decision_prestate_digest,locale_decision_poststate_digest)
    SELECT workspace_id,generation_id,artifact_id,evidence_group_id,element_key,element_version+1,element_kind,
      canonical_key,display_text,scope,entity_type,entity_id,$3,relation_kind,relation_target_key,confidence,
      'pending','operator_correction',id,COALESCE(original_proposal_element_id,id),source_refs_digest,element_digest,
      $5::uuid,proposed_by_user_id,locale_decision_contract_version,locale_decision_disposition,
      locale_decision_locale,$4,locale_decision_rationale,locale_decision_basis_digest,
      locale_decision_input_digest,locale_decision_authority_snapshot,locale_decision_authority_digest,
      locale_decision_prestate_digest,locale_decision_poststate_digest
    FROM signal_semantic_context_element_versions element WHERE workspace_id=$1::uuid AND element_key=$2
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions child
        WHERE child.supersedes_element_id=element.id)`;
  const attemptGenericLocaleBypass=async(locale:string,reason:string|null)=>transaction(async(queryable)=>{
    const operation=await queryable.query<{id:string}>(`INSERT INTO signal_governance_control_operations(
      workspace_id,actor_user_id,action,request_digest,idempotency_key,status)
      VALUES($1::uuid,$2::uuid,'correct-semantic-context-element',$3,$4,'in_progress') RETURNING id::text`,
    [fixture.workspace.id,fixture.actor.id,digest(`generic-locale-bypass-request:${locale}:${reason}`),
      digest(`generic-locale-bypass-key:${locale}:${reason}`)]);
    await queryable.query(bypassInsert,[fixture.workspace.id,localeKeys[1],locale,reason,operation.rows[0]!.id]);
  });
  await assert.rejects(attemptGenericLocaleBypass("fr-FR",
    lineageAfterGeneric.rows[0]!.locale_decision_reason_code),
  hasCodeAndMessage("23514",/preserve locale authority byte-for-byte/u),
  "direct SQL cannot mutate locale outside the dedicated authority operation");
  await assert.rejects(attemptGenericLocaleBypass("es-MX","operator_correction"),
  hasCodeAndMessage("23514",/preserve locale authority byte-for-byte/u),
  "direct SQL cannot mutate one locale-lineage field under a generic successor");
  assert.equal(await scalar(`SELECT count(*)::int count FROM signal_semantic_context_element_versions
    WHERE workspace_id=$1::uuid`,[fixture.workspace.id]),versionsBeforeBypass,
  "causal direct-SQL negatives roll back without graph drift");

  await seedOpenNearDuplicateAnnotation(fixture,draft.generation_key,localeKeys[2]!,localeKeys[1]!,
    "locale-authority-merge-lineage");
  const mergeLineageBefore=await pool.query(`SELECT element_key,locale,locale_decision_contract_version,
    locale_decision_disposition,locale_decision_locale,locale_decision_reason_code,
    locale_decision_rationale,locale_decision_basis_digest,locale_decision_input_digest,
    locale_decision_authority_snapshot,locale_decision_authority_digest,
    locale_decision_prestate_digest,locale_decision_poststate_digest
    FROM signal_semantic_context_element_versions element
    WHERE workspace_id=$1::uuid AND element_key=ANY($2::text[]) AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions child WHERE child.supersedes_element_id=element.id)
    ORDER BY element_key`,[fixture.workspace.id,[localeKeys[1],localeKeys[2]]]);
  await transaction((queryable)=>mergeSignalSemanticContextElementsV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"locale-authority-generic-merge",
    generationKey:draft.generation_key,targetElementKey:localeKeys[1]!,sourceElementKeys:[localeKeys[2]!],
    reason:"duplicate_same_concept",rationale:"Merge while preserving each predecessor locale lineage.",
    targetCorrection:{canonical_key:"locale-authority-one-merged",display_text:"Locale authority one merged",
      scope:"primary_brand",relation_kind:null,relation_target_key:null}}));
  const mergeLineageAfter=await pool.query(`SELECT element_key,locale,locale_decision_contract_version,
    locale_decision_disposition,locale_decision_locale,locale_decision_reason_code,
    locale_decision_rationale,locale_decision_basis_digest,locale_decision_input_digest,
    locale_decision_authority_snapshot,locale_decision_authority_digest,
    locale_decision_prestate_digest,locale_decision_poststate_digest
    FROM signal_semantic_context_element_versions element
    WHERE workspace_id=$1::uuid AND element_key=ANY($2::text[]) AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions child WHERE child.supersedes_element_id=element.id)
    ORDER BY element_key`,[fixture.workspace.id,[localeKeys[1],localeKeys[2]]]);
  assert.deepEqual(mergeLineageAfter.rows,mergeLineageBefore.rows,
    "generic N-to-1 merge preserves target and source locale lineage byte-for-byte");

  const directInput={contract_version:"signal-semantic-context-locale-decision-v1",
    generation_key:draft.generation_key,element_keys:[localeKeys[0]],disposition:"global",locale:null,
    reason:"semantic_boundary",rationale:"A completed operation without its exact graph must fail at commit.",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_LOCALE_DECISION_CONFIRMATION_V1};
  await assert.rejects(transaction(async(queryable)=>{
    const operation=await queryable.query<{id:string}>(`INSERT INTO signal_governance_control_operations(
      workspace_id,actor_user_id,action,request_digest,idempotency_key,status,
      semantic_context_decision_input,semantic_context_decision_input_digest)
      VALUES($1::uuid,$2::uuid,'decide-semantic-context-locale-authority',$3,$4,'in_progress',$5::jsonb,$6)
      RETURNING id::text`,[fixture.workspace.id,fixture.actor.id,digest("locale-direct-request"),
      digest("locale-direct-key"),JSON.stringify(directInput),digestCanonicalJsonV2(directInput)]);
    await queryable.query(`UPDATE signal_governance_control_operations SET status='completed',completed_at=clock_timestamp(),
      result=$2::jsonb WHERE id=$1::uuid`,[operation.rows[0]!.id,JSON.stringify({generation_key:draft.generation_key,
      decided:1,disposition:"global",locale:null,pending:1,draft_digest_ref:"sha256:forged"})]);
  }),/Locale authority successor cohort is incomplete or heterogeneous/u,
  "the deferred PostgreSQL backstop rejects a completed writer operation without its exact graph");
  const immutableTarget=(await pool.query<{id:string}>(`SELECT id::text FROM signal_semantic_context_element_versions
    WHERE workspace_id=$1::uuid AND locale_decision_contract_version IS NOT NULL LIMIT 1`,[fixture.workspace.id])).rows[0]!.id;
  await assert.rejects(pool.query(`UPDATE signal_semantic_context_element_versions
    SET locale_decision_rationale='tampered' WHERE id=$1::uuid`,[immutableTarget]),hasCode("55000"));
  assert.deepEqual(await protectedCounts(fixture.workspace.id),protectedBefore);

  const staleFixture=await seedFixture();
  const staleInitial=await transaction((queryable)=>createSignalSemanticContextDraftV1({queryable,
    workspace:staleFixture.workspace,actor:staleFixture.actor,idempotencyKey:"locale-stale-initial"}));
  const staleLineage=await fullLineageForDraft(staleFixture,staleInitial.generation_key,terminalPreflightConfiguration);
  const staleDraft=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:staleFixture.workspace,actor:staleFixture.actor,idempotencyKey:"locale-stale-lineage",
    reason:"provider_lineage_missing",proposalLineage:staleLineage}));
  await transaction((queryable)=>appendSignalSemanticContextProposalsV1({queryable,
    workspace:staleFixture.workspace,actor:staleFixture.actor,idempotencyKey:"locale-stale-proposal",
    generationKey:staleDraft.generation_key,proposals:[{
      ...proposal("locale-stale","alias","locale-stale","Locale stale",0.5,staleFixture.profileId),locale:null}]}));
  await approveElement(staleFixture,staleDraft.generation_key,"locale-stale","locale-stale-approval");
  await pool.query(`UPDATE brand_os_profiles SET metadata=jsonb_set(metadata,'{snapshot_hash}',to_jsonb($2::text),true)
    WHERE id=$1::uuid`,[staleFixture.profileId,digest("locale-authority-brand-os-drift")]);
  await assert.rejects(transaction((queryable)=>decideSignalSemanticContextLocaleAuthorityV1({queryable,
    workspace:staleFixture.workspace,actor:staleFixture.actor,idempotencyKey:"locale-stale-blocked",
    generationKey:staleDraft.generation_key,elementKeys:["locale-stale"],disposition:"global",locale:null,
    reason:"semantic_boundary",rationale:"A stale generation cannot receive locale authority.",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_LOCALE_DECISION_CONFIRMATION_V1})),
  /semantic_context_authority_drift/u);
}

async function exerciseDirectLocaleAuthorityMatrixV1(){
  const fixture=await seedFixture();
  const initial=await transaction((queryable)=>createSignalSemanticContextDraftV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"direct-locale-matrix-initial"}));
  const lineage=await fullLineageForDraft(fixture,initial.generation_key,terminalPreflightConfiguration);
  const draft=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"direct-locale-matrix-lineage",
    reason:"provider_lineage_missing",proposalLineage:lineage}));
  const keys=["direct-locale-a","direct-locale-b","direct-locale-c","direct-locale-control"];
  await transaction((queryable)=>appendSignalSemanticContextProposalsV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"direct-locale-matrix-proposals",
    generationKey:draft.generation_key,proposals:keys.map((key)=>({
      ...proposal(key,"alias",key,key,0.5,fixture.profileId),locale:null}))}));
  for(const [index,key] of keys.entries())await approveElement(fixture,draft.generation_key,key,
    `direct-locale-matrix-approval-${index}`);
  const before=await directDecisionState(fixture.workspace.id,draft.generation_key);
  const cases:Array<{label:string;inputKeys:string[];successorKeys:string[];disposition:"global"|"locale_specific";
    locale:string|null;mutation?:DirectLocaleGraphMutation;message:RegExp}>=[
    {label:"partial successor",inputKeys:[keys[0]!,keys[1]!],successorKeys:[keys[0]!],
      disposition:"locale_specific",locale:"es-MX",message:/successor cohort is incomplete/u},
    {label:"substituted successor",inputKeys:[keys[0]!,keys[1]!],successorKeys:[keys[0]!,keys[2]!],
      disposition:"locale_specific",locale:"es-MX",message:/successor cohort is incomplete/u},
    {label:"extra successor",inputKeys:[keys[0]!],successorKeys:[keys[0]!,keys[1]!],
      disposition:"locale_specific",locale:"es-MX",message:/successor cohort is incomplete/u},
    {label:"missing global annotation",inputKeys:[keys[0]!],successorKeys:[keys[0]!],
      disposition:"global",locale:null,mutation:{omitAnnotation:true},message:/global-resolution cohort is incomplete/u},
    {label:"extra annotation",inputKeys:[keys[0]!],successorKeys:[keys[0]!],
      disposition:"locale_specific",locale:"es-MX",mutation:{extraAnnotation:true},message:/locale authority|annotation/iu},
    {label:"missing event",inputKeys:[keys[0]!],successorKeys:[keys[0]!],
      disposition:"locale_specific",locale:"es-MX",mutation:{omitEvent:true},message:/event cohort is incomplete/u},
    {label:"extra event",inputKeys:[keys[0]!],successorKeys:[keys[0]!],
      disposition:"locale_specific",locale:"es-MX",mutation:{extraEvent:true},message:/event cohort is incomplete/u},
    {label:"wrong event digest",inputKeys:[keys[0]!],successorKeys:[keys[0]!],
      disposition:"locale_specific",locale:"es-MX",mutation:{wrongEventPrevious:true},message:/event cohort is incomplete/u},
    {label:"wrong result",inputKeys:[keys[0]!],successorKeys:[keys[0]!],
      disposition:"locale_specific",locale:"es-MX",mutation:{wrongResultCount:true},message:/result or draft seal is incomplete/u},
    {label:"wrong draft digest",inputKeys:[keys[0]!],successorKeys:[keys[0]!],
      disposition:"locale_specific",locale:"es-MX",mutation:{wrongStoredDraft:true},message:/result or draft seal is incomplete/u}
  ];
  for(const testCase of cases){
    await assert.rejects(attemptDirectLocaleAuthorityGraph(fixture,draft.generation_key,testCase),
      hasCodeAndMessage("23514",testCase.message),testCase.label);
    assert.deepEqual(await directDecisionState(fixture.workspace.id,draft.generation_key),before,
      `${testCase.label} rolls back without graph drift`);
  }
  assert.deepEqual(await attemptDirectLocaleAuthorityGraph(fixture,draft.generation_key,{
    inputKeys:[keys[3]!],successorKeys:[keys[3]!],disposition:"locale_specific",locale:"en-US"}),
  {committed:true},"the causally complete direct-SQL control commits");
}

async function exerciseLocalePublicationLineageGuardV1(){
  const fixture=await seedFixture();
  const initial=await transaction((queryable)=>createSignalSemanticContextDraftV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"locale-lineage-guard-initial"}));
  const lineage=await fullLineageForDraft(fixture,initial.generation_key,terminalPreflightConfiguration);
  const draft=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"locale-lineage-guard-lineage",
    reason:"provider_lineage_missing",proposalLineage:lineage}));
  await transaction((queryable)=>appendSignalSemanticContextProposalsV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"locale-lineage-guard-proposals",
    generationKey:draft.generation_key,proposals:[
      {...proposal("locale-historical-bypass","alias","locale-historical-bypass","Historical bypass",0.5,
        fixture.profileId),locale:null},
      {...proposal("locale-variant-en","locale_variant","locale-variant-en","English variant",0.5,
        fixture.profileId),locale:"en-US"},
      {...proposal("locale-variant-es","locale_variant","locale-variant-es","Spanish variant",0.5,
        fixture.profileId),locale:"es-MX"}
    ]}));
  for(const [index,key] of ["locale-historical-bypass","locale-variant-en","locale-variant-es"].entries())
    await approveElement(fixture,draft.generation_key,key,`locale-lineage-guard-approval-${index}`);
  let preflight=await transaction((queryable)=>loadSignalSemanticContextPublicationPreflightV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key}));
  assert.equal(preflight.counts.locale_market_required_unresolved,1,
    "the two legitimate provider-origin locale variants pass while the null-locale leaf remains blocked");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");await client.query("SET LOCAL session_replication_role='replica'");
    await client.query(`UPDATE signal_semantic_context_element_versions SET locale='es-MX'
      WHERE workspace_id=$1::uuid AND element_key='locale-historical-bypass' AND disposition='approved'
        AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions child
          WHERE child.supersedes_element_id=signal_semantic_context_element_versions.id)`,[fixture.workspace.id]);
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();}
  preflight=await transaction((queryable)=>loadSignalSemanticContextPublicationPreflightV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key}));
  assert.equal(preflight.counts.locale_market_required_unresolved,1,
    "a historical operator-derived es-MX value remains blocked without dedicated lineage");
  assert.ok(preflight.blockers.includes("locale_market_required_unresolved"));
}

async function exerciseOrdinaryEditingV1(){
  const fixture=await seedFixture();const protectedBefore=await protectedCounts(fixture.workspace.id);
  const initial=await transaction((queryable)=>createSignalSemanticContextDraftV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"ordinary-edit-initial"}));
  const lineage=await fullLineageForDraft(fixture,initial.generation_key,terminalPreflightConfiguration);
  const draft=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"ordinary-edit-lineage",
    reason:"provider_lineage_missing",proposalLineage:lineage}));
  await transaction((queryable)=>appendSignalSemanticContextProposalsV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"ordinary-edit-proposals",
    generationKey:draft.generation_key,proposals:[
      {...proposal("ordinary-target","identity_term","ordinary-target","Original target",0.8,fixture.profileId),locale:null},
      {...proposal("ordinary-archive","identity_term","ordinary-archive","Original archive",0.8,fixture.profileId),locale:null},
      {...proposal("ordinary-relation","identity_term","ordinary-relation","Target relation",0.8,fixture.profileId),
        element_kind:"typed_relation" as const,locale:null,relation_kind:"associated_with" as const,
        relation_target_key:"ordinary-target"}
    ]}));
  for(const key of ["ordinary-target","ordinary-archive","ordinary-relation"])
    await approveElement(fixture,draft.generation_key,key,`ordinary-edit-approve-${key}`);
  const immutableHistoryBefore=await fingerprint(`SELECT element.element_key,element.element_version,
    element.element_digest,element.source_refs_digest,link.source_type,link.source_id,link.relation_type
    FROM signal_semantic_context_element_versions element
    JOIN analysis_evidence_links link ON link.evidence_group_id=element.evidence_group_id
    WHERE element.generation_id=(SELECT id FROM signal_semantic_context_generations
      WHERE workspace_id=$1::uuid AND generation_key=$2) AND element.element_version<=2
    ORDER BY element.element_key,element.element_version,link.position`,[fixture.workspace.id,draft.generation_key]);
  const detail=async(key:string)=>transaction((queryable)=>loadSignalSemanticContextReviewDetailV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key,elementKey:key}));
  const values=(element:Awaited<ReturnType<typeof detail>>["element"],display=element.display_text,
    applicability:{state:"preserve"|"workspace_inherited"|"explicit_global"|"explicit_locale";locale:string|null}
      ={state:"preserve",locale:null}):SignalSemanticContextOrdinaryValuesV1=>({display_text:display,canonical_key:element.canonical_key,scope:element.scope,
        relation_kind:element.relation_kind as "is_a"|"part_of"|"surface_of"|"competes_with"|"associated_with"|null,
        relation_target_key:element.relation_target_key,applicability:applicability.state==="explicit_locale"
          ?{state:"explicit_locale",locale:applicability.locale!}
          :{state:applicability.state,locale:null}});
  const original=await detail("ordinary-target");
  const noOp=await transaction((queryable)=>editSignalSemanticContextElementV1({queryable,workspace:fixture.workspace,
    actor:fixture.actor,idempotencyKey:"ordinary-save-noop",generationKey:draft.generation_key,
    elementKey:"ordinary-target",expectedVersion:original.element.element_version,stateToken:original.element.state_token,
    action:"save",values:values(original.element)}));
  assert.equal(noOp.changed,false);assert.equal(noOp.element_version,original.element.element_version);
  const saved=await transaction((queryable)=>editSignalSemanticContextElementV1({queryable,workspace:fixture.workspace,
    actor:fixture.actor,idempotencyKey:"ordinary-save-content",generationKey:draft.generation_key,
    elementKey:"ordinary-target",expectedVersion:original.element.element_version,stateToken:original.element.state_token,
    action:"save",values:values(original.element,"Edited target")}));
  assert.equal(saved.changed,true);assert.equal(saved.disposition,"approved");
  const replay=await transaction((queryable)=>editSignalSemanticContextElementV1({queryable,workspace:fixture.workspace,
    actor:fixture.actor,idempotencyKey:"ordinary-save-content",generationKey:draft.generation_key,
    elementKey:"ordinary-target",expectedVersion:original.element.element_version,stateToken:original.element.state_token,
    action:"save",values:values(original.element,"Edited target")}));
  assert.deepEqual(replay,saved,"ordinary command replay is idempotent");
  await assert.rejects(transaction((queryable)=>editSignalSemanticContextElementV1({queryable,workspace:fixture.workspace,
    actor:fixture.actor,idempotencyKey:"ordinary-save-content",generationKey:draft.generation_key,
    elementKey:"ordinary-target",expectedVersion:original.element.element_version,stateToken:original.element.state_token,
    action:"save",values:values(original.element,"Conflicting replay")})),/Idempotency-Key/u);
  await assert.rejects(transaction((queryable)=>editSignalSemanticContextElementV1({queryable,workspace:fixture.workspace,
    actor:fixture.actor,idempotencyKey:"ordinary-save-stale",generationKey:draft.generation_key,
    elementKey:"ordinary-target",expectedVersion:original.element.element_version,stateToken:original.element.state_token,
    action:"save",values:values(original.element,"Stale edit")})),/semantic_context_ordinary_stale/u);
  const afterSave=await detail("ordinary-target");
  const global=await transaction((queryable)=>editSignalSemanticContextElementV1({queryable,workspace:fixture.workspace,
    actor:fixture.actor,idempotencyKey:"ordinary-save-global",generationKey:draft.generation_key,
    elementKey:"ordinary-target",expectedVersion:afterSave.element.element_version,stateToken:afterSave.element.state_token,
    action:"save",values:values(afterSave.element,afterSave.element.display_text,{state:"explicit_global",locale:null})}));
  assert.equal(global.changed,true);
  const globalRow=(await pool.query<{ordinary_command_basis:{diff:Array<{field:string}>}}>(`SELECT ordinary_command_basis
    FROM signal_semantic_context_element_versions WHERE generation_id=(SELECT id FROM signal_semantic_context_generations
      WHERE workspace_id=$1::uuid AND generation_key=$2) AND element_key='ordinary-target'
      AND element_version=$3`,[fixture.workspace.id,draft.generation_key,global.element_version])).rows[0]!;
  assert.ok(globalRow.ordinary_command_basis.diff.some((entry)=>entry.field==="applicability"),
    "inherited to explicit-global is sealed in the exact TypeScript/PostgreSQL audit diff");
  const globalDetail=await detail("ordinary-target");
  assert.ok(globalDetail.element.undo_target_version);
  const globalLineageBefore=await fingerprint(`SELECT locale,locale_decision_contract_version,
    locale_decision_disposition,locale_decision_locale,locale_decision_reason_code,locale_decision_rationale,
    locale_decision_basis_digest,locale_decision_input_digest,locale_decision_authority_snapshot,
    locale_decision_authority_digest,locale_decision_prestate_digest,locale_decision_poststate_digest
    FROM signal_semantic_context_element_versions WHERE generation_id=(SELECT id FROM signal_semantic_context_generations
      WHERE workspace_id=$1::uuid AND generation_key=$2) AND element_key='ordinary-target'
      AND element_version=$3`,[fixture.workspace.id,draft.generation_key,globalDetail.element.element_version]);
  await transaction((queryable)=>editSignalSemanticContextElementV1({queryable,workspace:fixture.workspace,
    actor:fixture.actor,idempotencyKey:"ordinary-global-preserve",generationKey:draft.generation_key,
    elementKey:"ordinary-target",expectedVersion:globalDetail.element.element_version,stateToken:globalDetail.element.state_token,
    action:"save",values:values(globalDetail.element,"Global authority preserved")}));
  const preservedGlobal=await detail("ordinary-target");
  const globalLineageAfter=await fingerprint(`SELECT locale,locale_decision_contract_version,
    locale_decision_disposition,locale_decision_locale,locale_decision_reason_code,locale_decision_rationale,
    locale_decision_basis_digest,locale_decision_input_digest,locale_decision_authority_snapshot,
    locale_decision_authority_digest,locale_decision_prestate_digest,locale_decision_poststate_digest
    FROM signal_semantic_context_element_versions WHERE generation_id=(SELECT id FROM signal_semantic_context_generations
      WHERE workspace_id=$1::uuid AND generation_key=$2) AND element_key='ordinary-target'
      AND element_version=$3`,[fixture.workspace.id,draft.generation_key,preservedGlobal.element.element_version]);
  assert.equal(globalLineageAfter,globalLineageBefore,"preserve copies all explicit-global locale authority byte-for-byte");
  const undoGlobal=await transaction((queryable)=>editSignalSemanticContextElementV1({queryable,workspace:fixture.workspace,
    actor:fixture.actor,idempotencyKey:"ordinary-undo-global-content",generationKey:draft.generation_key,
    elementKey:"ordinary-target",expectedVersion:preservedGlobal.element.element_version,
    stateToken:preservedGlobal.element.state_token,action:"undo",targetVersion:preservedGlobal.element.undo_target_version!}));
  const globalRestored=await detail("ordinary-target");
  assert.equal(globalRestored.element.applicability.effective_state,"explicit_global");
  await assert.rejects(transaction((queryable)=>editSignalSemanticContextElementV1({queryable,workspace:fixture.workspace,
    actor:fixture.actor,idempotencyKey:"ordinary-undo-arbitrary-old",generationKey:draft.generation_key,
    elementKey:"ordinary-target",expectedVersion:globalRestored.element.element_version,
    stateToken:globalRestored.element.state_token,action:"undo",targetVersion:afterSave.element.element_version})),
  /semantic_context_ordinary_target_stale/u,"browser cannot select an arbitrary older lineage version");
  const inheritedCommand=await transaction((queryable)=>editSignalSemanticContextElementV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"ordinary-save-inherited",
    generationKey:draft.generation_key,elementKey:"ordinary-target",expectedVersion:globalRestored.element.element_version,
    stateToken:globalRestored.element.state_token,action:"save",
    values:values(globalRestored.element,globalRestored.element.display_text,{state:"workspace_inherited",locale:null})}));
  assert.equal(undoGlobal.disposition,"approved");assert.equal(inheritedCommand.disposition,"approved");
  const inheritedAgain=await detail("ordinary-target");
  assert.equal(inheritedAgain.element.applicability.effective_state,"workspace_inherited");
  await assert.rejects(transaction((queryable)=>editSignalSemanticContextElementV1({queryable,
    workspace:fixture.otherWorkspace,actor:fixture.actor,idempotencyKey:"ordinary-cross-workspace",
    generationKey:draft.generation_key,elementKey:"ordinary-target",expectedVersion:inheritedAgain.element.element_version,
    stateToken:inheritedAgain.element.state_token,action:"save",values:values(inheritedAgain.element)})),
  /semantic_context_draft_not_found|cross-workspace|not_found/u);
  const explicitLocale=await transaction((queryable)=>editSignalSemanticContextElementV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"ordinary-explicit-locale",
    generationKey:draft.generation_key,elementKey:"ordinary-target",expectedVersion:inheritedAgain.element.element_version,
    stateToken:inheritedAgain.element.state_token,action:"save",
    values:values(inheritedAgain.element,inheritedAgain.element.display_text,{state:"explicit_locale",locale:"es-MX"})}));
  const explicitLocaleDetail=await detail("ordinary-target");
  assert.equal(explicitLocaleDetail.element.locale,"es-MX");
  assert.equal(explicitLocaleDetail.element.applicability.effective_state,"explicit_locale");
  await assert.rejects(transaction((queryable)=>editSignalSemanticContextElementV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"ordinary-invalid-locale",
    generationKey:draft.generation_key,elementKey:"ordinary-target",expectedVersion:explicitLocale.element_version,
    stateToken:explicitLocale.state_token,action:"save",
    values:values(explicitLocaleDetail.element,explicitLocaleDetail.element.display_text,{state:"explicit_locale",locale:"fr-FR"})})),
  /semantic_context_locale_invalid/u);
  await transaction((queryable)=>editSignalSemanticContextElementV1({queryable,workspace:fixture.workspace,
    actor:fixture.actor,idempotencyKey:"ordinary-explicit-locale-undo",generationKey:draft.generation_key,
    elementKey:"ordinary-target",expectedVersion:explicitLocaleDetail.element.element_version,
    stateToken:explicitLocaleDetail.element.state_token,action:"undo",
    targetVersion:explicitLocaleDetail.element.undo_target_version!}));
  const relationTargetCurrent=await detail("ordinary-target");
  await assert.rejects(transaction((queryable)=>editSignalSemanticContextElementV1({queryable,workspace:fixture.workspace,
    actor:fixture.actor,idempotencyKey:"ordinary-archive-relation-target",generationKey:draft.generation_key,
    elementKey:"ordinary-target",expectedVersion:relationTargetCurrent.element.element_version,
    stateToken:relationTargetCurrent.element.state_token,action:"archive"})),/semantic_context_archive_relation_target/u);
  const archiveOriginal=await detail("ordinary-archive");
  await transaction((queryable)=>editSignalSemanticContextElementV1({queryable,workspace:fixture.workspace,
    actor:fixture.actor,idempotencyKey:"ordinary-archive-save",generationKey:draft.generation_key,
    elementKey:"ordinary-archive",expectedVersion:archiveOriginal.element.element_version,
    stateToken:archiveOriginal.element.state_token,action:"save",values:values(archiveOriginal.element,"Edited archive")}));
  const archiveEdited=await detail("ordinary-archive");
  await transaction((queryable)=>editSignalSemanticContextElementV1({queryable,workspace:fixture.workspace,
    actor:fixture.actor,idempotencyKey:"ordinary-archive-command",generationKey:draft.generation_key,
    elementKey:"ordinary-archive",expectedVersion:archiveEdited.element.element_version,
    stateToken:archiveEdited.element.state_token,action:"archive"}));
  const archived=await detail("ordinary-archive");assert.equal(archived.element.lifecycle_state,"archived");
  const archivedPreflight=await transaction((queryable)=>loadSignalSemanticContextPublicationPreflightV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key}));
  assert.equal(archivedPreflight.counts.archived,1);
  assert.equal(archivedPreflight.blockers.includes("archived_elements"),false,
    "archived leaves are counted and excluded, never misrepresented as an unresolved review blocker");
  assert.equal(archivedPreflight.blockers.includes("graph_count_inconsistent"),false,
    "a terminal archived leaf balances the publication graph equation");
  const archivedSnapshot=(await pool.query<{snapshot:{counts:Record<string,number>;blockers:string[];publishable:boolean;
    preflight:Record<string,unknown>;publish_preflight_digest:string}}>(`SELECT signal_semantic_context_publication_snapshot_v2(
      generation.id,jsonb_build_object('brand_os_digest',generation.brand_os_digest,
      'knowledge_digest',generation.knowledge_digest,'locale_context_digest',generation.locale_context_digest,
      'proposal_provider_lineage',generation.proposal_provider_lineage,
      'proposal_provider_lineage_digest',generation.proposal_provider_lineage_digest)) snapshot
    FROM signal_semantic_context_generations generation WHERE generation.workspace_id=$1::uuid
      AND generation.generation_key=$2`,[fixture.workspace.id,draft.generation_key])).rows[0]!.snapshot;
  assert.deepEqual(archivedSnapshot.counts,(archivedSnapshot.preflight as {counts:Record<string,number>}).counts);
  assert.deepEqual(archivedSnapshot.blockers,(archivedSnapshot.preflight as {blockers:string[]}).blockers);
  assert.equal(archivedSnapshot.publishable,(archivedSnapshot.preflight as {publishable:boolean}).publishable);
  assert.equal(archivedSnapshot.publish_preflight_digest,digestCanonicalJsonV2(archivedSnapshot.preflight),
    "top-level and nested preflight derive from one exact object and digest");
  await transaction((queryable)=>editSignalSemanticContextElementV1({queryable,workspace:fixture.workspace,
    actor:fixture.actor,idempotencyKey:"ordinary-restore-command",generationKey:draft.generation_key,
    elementKey:"ordinary-archive",expectedVersion:archived.element.element_version,
    stateToken:archived.element.state_token,action:"restore"}));
  const restored=await detail("ordinary-archive");assert.equal(restored.element.lifecycle_state,"active");
  assert.equal(restored.element.undo_target_version,archiveOriginal.element.element_version,
    "archive to restore exposes the last active approved semantically distinct target, not version minus one");
  await transaction((queryable)=>editSignalSemanticContextElementV1({queryable,workspace:fixture.workspace,
    actor:fixture.actor,idempotencyKey:"ordinary-restore-undo",generationKey:draft.generation_key,
    elementKey:"ordinary-archive",expectedVersion:restored.element.element_version,
    stateToken:restored.element.state_token,action:"undo",targetVersion:restored.element.undo_target_version!}));
  assert.equal((await detail("ordinary-archive")).element.display_text,"Original archive");
  const targetForAdversarial=await detail("ordinary-target");
  await transaction((queryable)=>editSignalSemanticContextElementV1({queryable,workspace:fixture.workspace,
    actor:fixture.actor,idempotencyKey:"ordinary-adversarial-global",generationKey:draft.generation_key,
    elementKey:"ordinary-target",expectedVersion:targetForAdversarial.element.element_version,
    stateToken:targetForAdversarial.element.state_token,action:"save",
    values:values(targetForAdversarial.element,targetForAdversarial.element.display_text,
      {state:"explicit_global",locale:null})}));
  const safeIntegers=await pool.query<{missing:number|null;word:number|null;huge:number|null}>(`SELECT
    signal_semantic_context_safe_positive_int_v1('null'::jsonb) missing,
    signal_semantic_context_safe_positive_int_v1('"word"'::jsonb) word,
    signal_semantic_context_safe_positive_int_v1('999999999999999999999'::jsonb) huge`);
  assert.deepEqual(safeIntegers.rows,[{missing:null,word:null,huge:null}],"malformed versions fail closed without exceptions");
  const adversarial=(await pool.query<{element_id:string;operation_id:string}>(`SELECT element.id::text element_id,
    element.operation_id::text operation_id FROM signal_semantic_context_element_versions element
    JOIN signal_semantic_context_generations generation ON generation.id=element.generation_id
    WHERE generation.workspace_id=$1::uuid AND generation.generation_key=$2
      AND element.element_key='ordinary-target' AND NOT EXISTS(SELECT 1
        FROM signal_semantic_context_element_versions successor WHERE successor.supersedes_element_id=element.id)`,
  [fixture.workspace.id,draft.generation_key])).rows[0]!;
  const assertForgedAuthorityFails=async(label:string,sql:string)=>{
    const client=new pg.Client({connectionString:DB_URL,ssl:false});await client.connect();
    try{await client.query("BEGIN");await client.query("SET LOCAL session_replication_role=replica");
      await client.query(sql,[adversarial.element_id,adversarial.operation_id]);
      await client.query("SET LOCAL session_replication_role=origin");
      const valid=(await client.query<{valid:boolean}>(
        `SELECT signal_semantic_context_ordinary_authority_valid_v1($1::uuid) valid`,[adversarial.element_id])).rows[0]!.valid;
      assert.equal(valid,false,`${label}: forged ordinary authority is rejected by the DB resolver`);
      const snapshot=(await client.query<{snapshot:{counts:{decision_basis_missing:number};blockers:string[]} }>(`SELECT
        signal_semantic_context_publication_snapshot_v2(generation.id,jsonb_build_object(
          'brand_os_digest',generation.brand_os_digest,'knowledge_digest',generation.knowledge_digest,
          'locale_context_digest',generation.locale_context_digest,
          'proposal_provider_lineage',generation.proposal_provider_lineage,
          'proposal_provider_lineage_digest',generation.proposal_provider_lineage_digest)) snapshot
        FROM signal_semantic_context_generations generation WHERE generation.workspace_id=$1::uuid
          AND generation.generation_key=$2`,[fixture.workspace.id,draft.generation_key])).rows[0]!.snapshot;
      assert.ok(snapshot.counts.decision_basis_missing>0,`${label}: preflight observes the invalid authority`);
      assert.ok(snapshot.blockers.includes("decision_basis_missing"));
    }finally{await client.query("ROLLBACK").catch(()=>undefined);await client.end();}
  };
  await assertForgedAuthorityFails("malformed operation version",`UPDATE signal_governance_control_operations
    SET semantic_context_decision_input=jsonb_set(semantic_context_decision_input,'{target_version}','"bad"'::jsonb),
      semantic_context_decision_input_digest=signal_semantic_context_digest_json_v2(
        jsonb_set(semantic_context_decision_input,'{target_version}','"bad"'::jsonb))
    WHERE id=$2::uuid AND $1::uuid IS NOT NULL`);
  await assertForgedAuthorityFails("malformed expected version",`UPDATE signal_governance_control_operations
    SET semantic_context_decision_input=jsonb_set(semantic_context_decision_input,'{expected_version}','"bad"'::jsonb),
      semantic_context_decision_input_digest=signal_semantic_context_digest_json_v2(
        jsonb_set(semantic_context_decision_input,'{expected_version}','"bad"'::jsonb))
    WHERE id=$2::uuid AND $1::uuid IS NOT NULL`);
  await assertForgedAuthorityFails("cross-element input",`UPDATE signal_governance_control_operations
    SET semantic_context_decision_input=jsonb_set(semantic_context_decision_input,'{element_key}',
        '"ordinary-archive"'::jsonb),
      semantic_context_decision_input_digest=signal_semantic_context_digest_json_v2(
        jsonb_set(semantic_context_decision_input,'{element_key}','"ordinary-archive"'::jsonb))
    WHERE id=$2::uuid AND $1::uuid IS NOT NULL`);
  await assertForgedAuthorityFails("extra input key",`UPDATE signal_governance_control_operations
    SET semantic_context_decision_input=semantic_context_decision_input||'{"unexpected":true}'::jsonb,
      semantic_context_decision_input_digest=signal_semantic_context_digest_json_v2(
        semantic_context_decision_input||'{"unexpected":true}'::jsonb)
    WHERE id=$2::uuid AND $1::uuid IS NOT NULL`);
  await assertForgedAuthorityFails("forged payload",`UPDATE signal_semantic_context_element_versions
    SET display_text=display_text||' forged' WHERE id=$1::uuid AND $2::uuid IS NOT NULL`);
  await assertForgedAuthorityFails("forged applicability",`UPDATE signal_semantic_context_element_versions
    SET locale='es-MX',locale_decision_disposition='locale_specific',locale_decision_locale='es-MX'
    WHERE id=$1::uuid AND $2::uuid IS NOT NULL`);
  await assertForgedAuthorityFails("forged authority",`UPDATE signal_semantic_context_element_versions
    SET locale_decision_authority_digest='sha256:${"0".repeat(64)}'
    WHERE id=$1::uuid AND $2::uuid IS NOT NULL`);
  const assertEventCohortRejected=async(label:string,expectedCode:"23514"|"55000",
    mutation:(client:pg.Client)=>Promise<unknown>)=>{
    const client=new pg.Client({connectionString:DB_URL,ssl:false});await client.connect();
    try{await client.query("BEGIN");let rejected:unknown=null;
      try{await mutation(client);await client.query("COMMIT");}catch(error){rejected=error;}
      assert.ok(rejected,`${label}: the direct SQL mutation must fail`);
      assert.equal((rejected as {code?:string}).code,expectedCode,label);
    }finally{await client.query("ROLLBACK").catch(()=>undefined);await client.end();}
  };
  await assertEventCohortRejected("a second event cannot join one ordinary operation","23514",(client)=>client.query(`INSERT INTO
    signal_semantic_context_events(workspace_id,generation_id,element_id,operation_id,event_index,event_kind,
      previous_state_digest,next_state_digest,actor_user_id)
    SELECT workspace_id,generation_id,element_id,operation_id,1,event_kind,previous_state_digest,next_state_digest,
      actor_user_id FROM signal_semantic_context_events WHERE operation_id=$1::uuid AND event_index=0`,
  [adversarial.operation_id]));
  await assertEventCohortRejected("append-only authority prevents an ordinary successor from losing its event","55000",
    (client)=>client.query(
    `DELETE FROM signal_semantic_context_events WHERE operation_id=$1::uuid AND event_index=0`,[adversarial.operation_id]));
  assert.equal(await fingerprint(`SELECT element.element_key,element.element_version,
    element.element_digest,element.source_refs_digest,link.source_type,link.source_id,link.relation_type
    FROM signal_semantic_context_element_versions element
    JOIN analysis_evidence_links link ON link.evidence_group_id=element.evidence_group_id
    WHERE element.generation_id=(SELECT id FROM signal_semantic_context_generations
      WHERE workspace_id=$1::uuid AND generation_key=$2) AND element.element_version<=2
    ORDER BY element.element_key,element.element_version,link.position`,[fixture.workspace.id,draft.generation_key]),
  immutableHistoryBefore,"ordinary edits leave predecessor history and evidence byte-for-byte immutable");
  assert.deepEqual(await protectedCounts(fixture.workspace.id),protectedBefore,"ordinary editing never changes protected state");
}

async function exerciseSimpleCreationV1(){
  const fixture=await seedFixture();const protectedBefore=await protectedCounts(fixture.workspace.id);
  const initial=await transaction((queryable)=>createSignalSemanticContextDraftV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"simple-create-initial"}));
  const lineage=await fullLineageForDraft(fixture,initial.generation_key,terminalPreflightConfiguration);
  const draft=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"simple-create-lineage",
    reason:"provider_lineage_missing",proposalLineage:lineage}));
  const values=(overrides:Partial<Parameters<typeof createSignalSemanticContextElementV1>[0]["values"]>={})=>({
    element_kind:"benefit" as const,display_text:"Operator-authored benefit",canonical_key:"operator-benefit",
    scope:"workspace",relation_kind:null,relation_target_key:null,
    applicability:{state:"workspace_inherited" as const,locale:null},...overrides});
  const create=(idempotencyKey:string,input=values())=>transaction((queryable)=>createSignalSemanticContextElementV1({
    queryable,workspace:fixture.workspace,actor:fixture.actor,idempotencyKey,
    generationKey:draft.generation_key,values:input}));
  const inherited=await create("simple-create-inherited");
  assert.equal(inherited.collision,false);assert.equal(inherited.element_version,1);
  assert.equal(inherited.element_key,"operator.benefit.operator-benefit");
  assert.deepEqual(await create("simple-create-inherited"),inherited,"exact creation replay is stable");
  await assert.rejects(create("simple-create-inherited",values({display_text:"Conflicting replay"})),/Idempotency-Key/u);

  const detail=async(key:string)=>transaction((queryable)=>loadSignalSemanticContextReviewDetailV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key,elementKey:key}));
  const inheritedDetail=await detail(inherited.element_key);
  assert.equal(inheritedDetail.element.disposition,"approved");
  assert.equal(inheritedDetail.element.lifecycle_state,"active");
  assert.equal(inheritedDetail.element.applicability.effective_state,"workspace_inherited");
  assert.equal(inheritedDetail.evidence.length,1);
  assert.equal(inheritedDetail.evidence[0]!.source_type,"semantic_context_operator_input");
  assert.equal(inheritedDetail.evidence[0]!.source_context.label,"operator_authored_input");
  assert.equal(inheritedDetail.evidence[0]!.current_state,"current");

  const ordinaryValues:SignalSemanticContextOrdinaryValuesV1={display_text:"Edited operator-authored benefit",
    canonical_key:inheritedDetail.element.canonical_key,scope:inheritedDetail.element.scope,relation_kind:null,
    relation_target_key:null,applicability:{state:"preserve",locale:null}};
  const edited=await transaction((queryable)=>editSignalSemanticContextElementV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"simple-create-edit",
    generationKey:draft.generation_key,elementKey:inherited.element_key,
    expectedVersion:inheritedDetail.element.element_version,stateToken:inheritedDetail.element.state_token,
    action:"save",values:ordinaryValues}));
  assert.equal(edited.element_version,2,"created elements immediately use ordinary editing");
  const semanticWritesBeforeCollision=await pool.query<{operations:number;elements:number;events:number}>(`SELECT
    (SELECT count(*)::int FROM signal_governance_control_operations WHERE workspace_id=$1::uuid) operations,
    (SELECT count(*)::int FROM signal_semantic_context_element_versions WHERE workspace_id=$1::uuid) elements,
    (SELECT count(*)::int FROM signal_semantic_context_events WHERE workspace_id=$1::uuid) events`,[fixture.workspace.id]);
  const collision=await create("simple-create-collision",values({display_text:"Collision is not written",
    applicability:{state:"explicit_global",locale:null}}));
  assert.equal(collision.collision,true);assert.equal(collision.element_key,inherited.element_key);
  assert.equal(collision.element_version,2,"collision points to the current real version");
  assert.deepEqual((await pool.query<{operations:number;elements:number;events:number}>(`SELECT
    (SELECT count(*)::int FROM signal_governance_control_operations WHERE workspace_id=$1::uuid) operations,
    (SELECT count(*)::int FROM signal_semantic_context_element_versions WHERE workspace_id=$1::uuid) elements,
    (SELECT count(*)::int FROM signal_semantic_context_events WHERE workspace_id=$1::uuid) events`,
  [fixture.workspace.id])).rows,semanticWritesBeforeCollision.rows,"exact active canonical collision writes nothing");

  const global=await create("simple-create-global",values({canonical_key:"operator-global",
    display_text:"Explicit global operator value",applicability:{state:"explicit_global",locale:null}}));
  const es=await create("simple-create-es",values({canonical_key:"operator-locale-shared",
    display_text:"Localized operator value",applicability:{state:"explicit_locale",locale:"es-MX"}}));
  const en=await create("simple-create-en",values({canonical_key:"operator-locale-shared",
    display_text:"Localized operator value",applicability:{state:"explicit_locale",locale:"en-US"}}));
  assert.notEqual(es.element_key,en.element_key,"raw locale participates in deterministic key identity");
  assert.match(es.element_key,/\.es-mx$/u);assert.match(en.element_key,/\.en-us$/u);
  assert.equal((await detail(global.element_key)).element.applicability.effective_state,"explicit_global");
  assert.equal((await detail(es.element_key)).element.applicability.effective_state,"explicit_locale");
  const variant=await create("simple-create-variant",values({element_kind:"locale_variant",
    canonical_key:"operator-variant",display_text:"Qué onda Alexa",
    applicability:{state:"explicit_locale",locale:"es-MX"}}));
  assert.equal((await detail(variant.element_key)).element.locale,"es-MX");
  await assert.rejects(create("simple-create-variant-inherited",values({element_kind:"locale_variant",
    canonical_key:"operator-invalid-variant",applicability:{state:"workspace_inherited",locale:null}})),
  /semantic_context_locale_variant_requires_locale/u);
  await assert.rejects(create("simple-create-invalid-locale",values({canonical_key:"operator-invalid-locale",
    applicability:{state:"explicit_locale",locale:"fr-FR"}})),/Semantic Context applicability authority|locale/u);

  const relation=await create("simple-create-relation",values({element_kind:"typed_relation",
    canonical_key:"operator-relation",display_text:"Operator relation",relation_kind:"associated_with",
    relation_target_key:inherited.element_key}));
  assert.equal((await detail(relation.element_key)).element.relation_target_key,inherited.element_key);
  await assert.rejects(create("simple-create-self-relation",values({element_kind:"typed_relation",
    canonical_key:"operator-self",display_text:"Self relation",relation_kind:"associated_with",
    relation_target_key:"operator.typed_relation.operator-self"})),/semantic_context_relation_invalid/u);
  await assert.rejects(create("simple-create-missing-relation",values({element_kind:"typed_relation",
    canonical_key:"operator-missing",display_text:"Missing relation",relation_kind:"associated_with",
    relation_target_key:"identity.missing"})),/semantic_context_element_cas_conflict/u);
  await assert.rejects(transaction((queryable)=>createSignalSemanticContextElementV1({queryable,
    workspace:fixture.otherWorkspace,actor:fixture.actor,idempotencyKey:"simple-create-cross-workspace",
    generationKey:draft.generation_key,values:values({canonical_key:"operator-cross-workspace"})})),
  /semantic_context_draft_not_found|not_found/u);

  for(let index=0;index<6;index++)await create(`simple-create-suggestion-${index}`,values({
    element_kind:index%2===0?"need":"friction",canonical_key:`operator-suggestion-${index}`,
    display_text:"Shared display suggestion"}));
  const guidanceWritesBefore=(await pool.query<{elements:string;operations:string;events:string}>(`SELECT
    (SELECT count(*)::text FROM signal_semantic_context_element_versions element
      JOIN signal_semantic_context_generations generation ON generation.id=element.generation_id
      WHERE generation.workspace_id=$1::uuid) elements,
    (SELECT count(*)::text FROM signal_governance_control_operations WHERE workspace_id=$1::uuid) operations,
    (SELECT count(*)::text FROM signal_semantic_context_events event
      JOIN signal_semantic_context_generations generation ON generation.id=event.generation_id
      WHERE generation.workspace_id=$1::uuid) events`,[fixture.workspace.id])).rows[0]!;
  const guidance=await transaction((queryable)=>loadSignalSemanticContextCreationGuidanceV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key,elementKind:"surface",
    canonicalKey:"new-surface",displayText:"  Shared   display suggestion  ",locale:null}));
  assert.equal(guidance.exact_collision,null);assert.equal(guidance.suggestions.length,5);
  assert.deepEqual(guidance.suggestions.map((item)=>item.element_key),
    [...guidance.suggestions].map((item)=>item.element_key).sort(),"suggestions are bounded and deterministic");
  assert.equal(guidance.writes_performed,false);assert.equal(guidance.provider_calls,0);
  assert.deepEqual((await pool.query<{elements:string;operations:string;events:string}>(`SELECT
    (SELECT count(*)::text FROM signal_semantic_context_element_versions element
      JOIN signal_semantic_context_generations generation ON generation.id=element.generation_id
      WHERE generation.workspace_id=$1::uuid) elements,
    (SELECT count(*)::text FROM signal_governance_control_operations WHERE workspace_id=$1::uuid) operations,
    (SELECT count(*)::text FROM signal_semantic_context_events event
      JOIN signal_semantic_context_generations generation ON generation.id=event.generation_id
      WHERE generation.workspace_id=$1::uuid) events`,[fixture.workspace.id])).rows[0],guidanceWritesBefore,
  "read-only duplicate suggestions create no element, operation, or event");

  const createdAuthority=(await pool.query<{element_id:string;operation_id:string;evidence_group_id:string}>(`SELECT
    element.id::text element_id,element.operation_id::text operation_id,element.evidence_group_id::text evidence_group_id
    FROM signal_semantic_context_element_versions element JOIN signal_semantic_context_generations generation
      ON generation.id=element.generation_id WHERE generation.workspace_id=$1::uuid
      AND generation.generation_key=$2 AND element.element_key=$3 AND element.element_version=1`,
  [fixture.workspace.id,draft.generation_key,inherited.element_key])).rows[0]!;
  const assertForgeryFails=async(label:string,mutation:string,params:unknown[])=>{
    const client=new pg.Client({connectionString:DB_URL,ssl:false});await client.connect();
    try{await client.query("BEGIN");await client.query("SET LOCAL session_replication_role=replica");
      await client.query(mutation,params);await client.query("SET LOCAL session_replication_role=origin");
      assert.equal((await client.query<{valid:boolean}>(`SELECT signal_semantic_context_creation_authority_valid_v1(
        $1::uuid) valid`,[createdAuthority.element_id])).rows[0]!.valid,false,`${label} fails DB authority`);
      const snapshot=(await client.query<{snapshot:{counts:{invalid_evidence_refs:number;decision_basis_missing:number}}}>(
        `SELECT signal_semantic_context_publication_snapshot_v2(generation.id,jsonb_build_object(
          'brand_os_digest',generation.brand_os_digest,'knowledge_digest',generation.knowledge_digest,
          'locale_context_digest',generation.locale_context_digest,
          'proposal_provider_lineage',generation.proposal_provider_lineage,
          'proposal_provider_lineage_digest',generation.proposal_provider_lineage_digest)) snapshot
        FROM signal_semantic_context_generations generation WHERE generation.workspace_id=$1::uuid
          AND generation.generation_key=$2`,[fixture.workspace.id,draft.generation_key])).rows[0]!.snapshot;
      assert.ok(snapshot.counts.invalid_evidence_refs>0||snapshot.counts.decision_basis_missing>0,
        `${label} remains visible to publication preflight`);
    }finally{await client.query("ROLLBACK").catch(()=>undefined);await client.end();}
  };
  await assertForgeryFails("extra operation input",`UPDATE signal_governance_control_operations SET
    semantic_context_decision_input=semantic_context_decision_input||'{"extra":true}'::jsonb,
    semantic_context_decision_input_digest=signal_semantic_context_digest_json_v2(
      semantic_context_decision_input||'{"extra":true}'::jsonb) WHERE id=$1::uuid`,[createdAuthority.operation_id]);
  await assertForgeryFails("forged operator payload",`UPDATE signal_semantic_context_element_versions
    SET display_text=display_text||' forged' WHERE id=$1::uuid`,[createdAuthority.element_id]);
  await assertForgeryFails("wrong source action",`UPDATE signal_governance_control_operations
    SET action='decide-semantic-context-element' WHERE id=$1::uuid`,[createdAuthority.operation_id]);
  await assertForgeryFails("malformed applicability input",`UPDATE signal_governance_control_operations SET
    semantic_context_decision_input=jsonb_set(semantic_context_decision_input,'{values,applicability}',
      '{"state":7,"locale":null}'::jsonb),semantic_context_decision_input_digest=signal_semantic_context_digest_json_v2(
      jsonb_set(semantic_context_decision_input,'{values,applicability}','{"state":7,"locale":null}'::jsonb))
    WHERE id=$1::uuid`,[createdAuthority.operation_id]);
  await assertForgeryFails("unresolved operator source",`UPDATE analysis_evidence_links SET source_id=$1::uuid
    WHERE evidence_group_id=$2::uuid`,[randomUUID(),createdAuthority.evidence_group_id]);
  await assertForgeryFails("cross-workspace operator source",`WITH foreign_operation AS (
    INSERT INTO signal_governance_control_operations(workspace_id,actor_user_id,action,request_digest,
      idempotency_key,status,result,completed_at) VALUES($1::uuid,$2::uuid,
      'create-semantic-context-element-v1',$4,$5,'completed','{}'::jsonb,clock_timestamp()) RETURNING id)
    UPDATE analysis_evidence_links SET source_id=(SELECT id FROM foreign_operation)
    WHERE evidence_group_id=$3::uuid`,[fixture.otherWorkspace.id,fixture.actor.id,
    createdAuthority.evidence_group_id,digest("foreign-create-request"),digest("foreign-create-key")]);

  const secondEventClient=new pg.Client({connectionString:DB_URL,ssl:false});await secondEventClient.connect();
  try{await secondEventClient.query("BEGIN");let rejected:unknown=null;
    try{await secondEventClient.query(`INSERT INTO signal_semantic_context_events(workspace_id,generation_id,
      element_id,operation_id,event_index,event_kind,previous_state_digest,next_state_digest,actor_user_id)
      SELECT workspace_id,generation_id,element_id,operation_id,1,event_kind,previous_state_digest,
        next_state_digest,actor_user_id FROM signal_semantic_context_events
      WHERE operation_id=$1::uuid AND event_index=0`,[createdAuthority.operation_id]);
      await secondEventClient.query("COMMIT");}catch(error){rejected=error;}
    assert.equal((rejected as {code?:string}|null)?.code,"23514","a second creation event fails the deferred cohort");
  }finally{await secondEventClient.query("ROLLBACK").catch(()=>undefined);await secondEventClient.end();}

  const relationTargetDetail=await detail(inherited.element_key);
  await assert.rejects(transaction((queryable)=>editSignalSemanticContextElementV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"simple-create-archive-relation-target",
    generationKey:draft.generation_key,elementKey:inherited.element_key,
    expectedVersion:relationTargetDetail.element.element_version,stateToken:relationTargetDetail.element.state_token,
    action:"archive"})),/semantic_context_archive_relation_target/u);
  const historyBefore=await fingerprint(`SELECT element_version,element_digest,source_refs_digest,
    link.source_type,link.source_id,link.relation_type FROM signal_semantic_context_element_versions element
    JOIN analysis_evidence_links link ON link.evidence_group_id=element.evidence_group_id
    WHERE element.generation_id=(SELECT id FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid
      AND generation_key=$2) AND element.element_key=$3 ORDER BY element_version,link.position`,
  [fixture.workspace.id,draft.generation_key,global.element_key]);
  const globalOperationId=(await pool.query<{operation_id:string}>(
    `SELECT operation_id::text FROM signal_semantic_context_element_versions WHERE generation_id=(SELECT id
      FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid AND generation_key=$2)
      AND element_key=$3 AND element_version=1`,[fixture.workspace.id,draft.generation_key,global.element_key])).rows[0]!.operation_id;
  const operationBefore=await fingerprint(`SELECT action,request_digest,idempotency_key,status,result,
    semantic_context_decision_input,semantic_context_decision_input_digest,actor_user_id,completed_at
    FROM signal_governance_control_operations WHERE id=$1::uuid`,[globalOperationId]);
  const current=await detail(global.element_key);
  await transaction((queryable)=>editSignalSemanticContextElementV1({queryable,workspace:fixture.workspace,
    actor:fixture.actor,idempotencyKey:"simple-create-archive",generationKey:draft.generation_key,
    elementKey:global.element_key,expectedVersion:current.element.element_version,stateToken:current.element.state_token,
    action:"archive"}));
  const archived=await detail(global.element_key);assert.equal(archived.element.lifecycle_state,"archived");
  const archivedPreflight=await transaction((queryable)=>loadSignalSemanticContextPublicationPreflightV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key}));
  assert.equal(archivedPreflight.counts.archived,1);assert.equal(archivedPreflight.counts.approved,
    11,"archived operator creation is excluded from active approved candidates");
  assert.equal(archivedPreflight.blockers.includes("graph_count_inconsistent"),false,
    "an archived operator-created leaf is excluded without corrupting graph accounting");
  const archivedSnapshot=(await pool.query<{snapshot:{counts:Record<string,number>;blockers:string[];
    publishable:boolean;preflight:Record<string,unknown>;publish_preflight_digest:string}}>(`SELECT
      signal_semantic_context_publication_snapshot_v2(generation.id,jsonb_build_object(
        'brand_os_digest',generation.brand_os_digest,'knowledge_digest',generation.knowledge_digest,
        'locale_context_digest',generation.locale_context_digest,
        'proposal_provider_lineage',generation.proposal_provider_lineage,
        'proposal_provider_lineage_digest',generation.proposal_provider_lineage_digest)) snapshot
      FROM signal_semantic_context_generations generation WHERE generation.workspace_id=$1::uuid
        AND generation.generation_key=$2`,[fixture.workspace.id,draft.generation_key])).rows[0]!.snapshot;
  assert.deepEqual(archivedSnapshot.counts,(archivedSnapshot.preflight as {counts:Record<string,number>}).counts);
  assert.deepEqual(archivedSnapshot.blockers,(archivedSnapshot.preflight as {blockers:string[]}).blockers);
  assert.equal(archivedSnapshot.publishable,(archivedSnapshot.preflight as {publishable:boolean}).publishable);
  assert.equal(archivedSnapshot.publish_preflight_digest,digestCanonicalJsonV2(archivedSnapshot.preflight),
    "created-element archive keeps top/nested publication snapshot and digest exact");
  await transaction((queryable)=>editSignalSemanticContextElementV1({queryable,workspace:fixture.workspace,
    actor:fixture.actor,idempotencyKey:"simple-create-restore",generationKey:draft.generation_key,
    elementKey:global.element_key,expectedVersion:archived.element.element_version,stateToken:archived.element.state_token,
    action:"restore"}));
  const restored=await detail(global.element_key);assert.equal(restored.element.lifecycle_state,"active");
  assert.equal(restored.element.applicability.effective_state,"explicit_global");
  assert.equal(await fingerprint(`SELECT element_version,element_digest,source_refs_digest,
    link.source_type,link.source_id,link.relation_type FROM signal_semantic_context_element_versions element
    JOIN analysis_evidence_links link ON link.evidence_group_id=element.evidence_group_id
    WHERE element.generation_id=(SELECT id FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid
      AND generation_key=$2) AND element.element_key=$3 AND element_version<=2 ORDER BY element_version,link.position`,
  [fixture.workspace.id,draft.generation_key,global.element_key]),historyBefore,
  "archive/restore preserves created history and operator evidence byte-for-byte");
  assert.equal(await fingerprint(`SELECT action,request_digest,idempotency_key,status,result,
    semantic_context_decision_input,semantic_context_decision_input_digest,actor_user_id,completed_at
    FROM signal_governance_control_operations WHERE id=$1::uuid`,[globalOperationId]),operationBefore,
  "ordinary archive/restore never rewrites the original creation operation");
  await assert.rejects(transaction(async(queryable)=>{await queryable.query(`SET LOCAL session_replication_role=replica`);
    await queryable.query(`UPDATE signal_semantic_context_generations SET brand_os_digest=$3 WHERE workspace_id=$1::uuid
      AND generation_key=$2`,[fixture.workspace.id,draft.generation_key,digest("stale-create-authority")]);
    await queryable.query(`SET LOCAL session_replication_role=origin`);
    return createSignalSemanticContextElementV1({queryable,workspace:fixture.workspace,actor:fixture.actor,
      idempotencyKey:"simple-create-stale-authority",generationKey:draft.generation_key,
      values:values({canonical_key:"operator-stale-authority"})});}),/drift|authority|digest/u,
  "creation fails closed when the sealed generation authority drifts");
  assert.deepEqual(await protectedCounts(fixture.workspace.id),protectedBefore,
    "simple creation and reversal do not change protected downstream state");
}

async function exerciseArchivedAccountingAdversarialV1(){
  const snapshot=async(client:pg.PoolClient,generationId:string)=>
    (await client.query<{blockers:string[]}>(`SELECT snapshot->'blockers' blockers FROM (
      SELECT signal_semantic_context_publication_snapshot_v2(generation.id,jsonb_build_object(
        'brand_os_digest',generation.brand_os_digest,'knowledge_digest',generation.knowledge_digest,
        'locale_context_digest',generation.locale_context_digest,
        'proposal_provider_lineage',generation.proposal_provider_lineage,
        'proposal_provider_lineage_digest',generation.proposal_provider_lineage_digest)) snapshot
      FROM signal_semantic_context_generations generation WHERE generation.id=$1::uuid
    ) publication`,[generationId])).rows[0]!.blockers;
  const inRollback=async(run:(client:pg.PoolClient)=>Promise<void>)=>{
    const client=await pool.connect();
    try{await client.query("BEGIN");await run(client);await client.query("ROLLBACK");}
    catch(error){await client.query("ROLLBACK");throw error;}
    finally{client.release();}
  };

  await inRollback(async(client)=>{
    await client.query(`ALTER TABLE signal_semantic_context_merge_edges DISABLE TRIGGER USER`);
    const cycle=(await client.query<{generation_id:string}>(`WITH edge AS (
      SELECT * FROM signal_semantic_context_merge_edges ORDER BY created_at LIMIT 1
    ), inserted AS (
      INSERT INTO signal_semantic_context_merge_edges(
        workspace_id,generation_id,operation_id,source_predecessor_id,source_element_key,source_element_version,
        source_merged_successor_id,target_predecessor_id,target_element_key,target_element_version,
        target_pending_successor_id,reason_code,rationale,actor_user_id
      ) SELECT workspace_id,generation_id,operation_id,target_predecessor_id,target_element_key,target_element_version,
        target_pending_successor_id,source_predecessor_id,source_element_key,source_element_version,
        source_merged_successor_id,reason_code,'Adversarial reverse edge for local preflight verification.',actor_user_id
      FROM edge RETURNING generation_id
    ) SELECT generation_id FROM inserted`)).rows[0]!;
    await client.query(`ALTER TABLE signal_semantic_context_merge_edges ENABLE TRIGGER USER`);
    const blockers=await snapshot(client,cycle.generation_id);
    assert.ok(blockers.includes("graph_count_inconsistent"),"a merge cycle remains graph-inconsistent");
    assert.ok(blockers.includes("merge_cycle"),"a merge cycle remains independently fail-closed");
  });

  await inRollback(async(client)=>{
    await client.query(`DROP INDEX uq_signal_semantic_context_element_successor`);
    await client.query(`ALTER TABLE signal_semantic_context_element_versions DISABLE TRIGGER USER`);
    const fork=(await client.query<{generation_id:string}>(`WITH target_generation AS (
      SELECT generation_id FROM signal_semantic_context_element_versions
      GROUP BY generation_id HAVING count(*) FILTER(WHERE supersedes_element_id IS NOT NULL)>=2 LIMIT 1
    ), ranked AS (
      SELECT id,generation_id,supersedes_element_id,row_number() OVER(ORDER BY created_at,id) position
      FROM signal_semantic_context_element_versions
      WHERE generation_id=(SELECT generation_id FROM target_generation) AND supersedes_element_id IS NOT NULL
    ), chosen AS (
      SELECT parent.supersedes_element_id parent_id,child.id child_id,child.generation_id
      FROM ranked parent CROSS JOIN ranked child WHERE parent.position=1 AND child.position=2
    ), updated AS (
      UPDATE signal_semantic_context_element_versions element SET supersedes_element_id=chosen.parent_id
      FROM chosen WHERE element.id=chosen.child_id RETURNING element.generation_id
    ) SELECT generation_id FROM updated`)).rows[0]!;
    await client.query(`ALTER TABLE signal_semantic_context_element_versions ENABLE TRIGGER USER`);
    const blockers=await snapshot(client,fork.generation_id);
    assert.ok(blockers.includes("graph_count_inconsistent"),"a successor fork remains fail-closed");
  });
}

async function seedHistoricalV2PublicationBefore0101(){
  const fixture=await seedFixture();
  const initial=await transaction((queryable)=>createSignalSemanticContextDraftV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"historical-v2-before-0101-initial"}));
  const lineage=await fullLineageForDraft(fixture,initial.generation_key,terminalPreflightConfiguration);
  const draft=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"historical-v2-before-0101-lineage",
    reason:"provider_lineage_missing",proposalLineage:lineage}));
  await transaction((queryable)=>appendSignalSemanticContextProposalsV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"historical-v2-before-0101-proposal",
    generationKey:draft.generation_key,proposals:[{...proposal("historical-v2-explicit-variant","locale_variant",
      "historical-v2-explicit-variant","Historical explicit variant",0.8,fixture.profileId),locale:"en-US"}]}));
  await approveElement(fixture,draft.generation_key,"historical-v2-explicit-variant",
    "historical-v2-before-0101-approval");
  const preflight=await transaction((queryable)=>loadSignalSemanticContextPublicationPreflightV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key}));
  assert.equal(preflight.publishable,true,"the pre-0101 V2 control is independently publishable");
  await transaction((queryable)=>publishSignalSemanticContextGenerationV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"historical-v2-before-0101-publish",
    generationKey:draft.generation_key,preflightDigest:preflight.preflight_digest,
    confirmation:SIGNAL_SEMANTIC_CONTEXT_PUBLICATION_CONFIRMATION_V2}));
  const immutableFingerprint=await fingerprint(`SELECT status,pack_digest,publication_schema_version,
    candidate_pack_digest,evidence_graph_digest,review_graph_digest,publication_authority_digest,
    publication_authority_snapshot,semantic_context_pack_digest,publish_preflight_digest,publication_counts,
    published_operation_id,published_by_user_id,published_at FROM signal_semantic_context_generations
    WHERE workspace_id=$1::uuid AND generation_key=$2`,[fixture.workspace.id,draft.generation_key]);
  return{workspaceId:fixture.workspace.id,generationKey:draft.generation_key,immutableFingerprint};
}

async function seedInheritedApplicabilityFailingBeforeV1(){
  const fixture=await seedFixture();
  const initial=await transaction((queryable)=>createSignalSemanticContextDraftV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"inherited-applicability-initial"}));
  const lineage=await fullLineageForDraft(fixture,initial.generation_key,terminalPreflightConfiguration);
  const draft=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"inherited-applicability-lineage",
    reason:"provider_lineage_missing",proposalLineage:lineage}));
  await transaction((queryable)=>appendSignalSemanticContextProposalsV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"inherited-applicability-proposals",
    generationKey:draft.generation_key,proposals:[
      {...proposal("ordinary-null","identity_term","ordinary-null","Ordinary null locale",0.8,
        fixture.profileId),locale:null},
      {...proposal("variant-en","locale_variant","variant-en","English explicit variant",0.8,
        fixture.profileId),locale:"en-US"},
      {...proposal("variant-es","locale_variant","variant-es","Spanish explicit variant",0.8,
        fixture.profileId),locale:"es-MX"},
      {...proposal("explicit-global-existing","identity_term","explicit-global-existing",
        "Existing explicit global",0.8,fixture.profileId),locale:null}
    ]}));
  for(const [index,key] of ["ordinary-null","variant-en","variant-es","explicit-global-existing"].entries())
    await approveElement(fixture,draft.generation_key,key,`inherited-applicability-approval-${index}`);
  await transaction((queryable)=>decideSignalSemanticContextLocaleAuthorityV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"inherited-existing-global-decision",
    generationKey:draft.generation_key,elementKeys:["explicit-global-existing"],disposition:"global",locale:null,
    reason:"locale_resolution",rationale:"This fixture explicitly records pre-0101 global authority.",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_LOCALE_DECISION_CONFIRMATION_V1}));
  await approveElement(fixture,draft.generation_key,"explicit-global-existing",
    "inherited-existing-global-reapproval");
  const failingBefore=await transaction((queryable)=>loadSignalSemanticContextPublicationPreflightV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key}));
  assert.equal(failingBefore.counts.locale_market_required_unresolved,1,
    "failing-before: V1 incorrectly treats one ordinary approved null-locale leaf as unresolved");
  assert.ok(failingBefore.blockers.includes("locale_market_required_unresolved"));
  return{fixture,draft};
}

async function exerciseInheritedApplicabilityPassingAfterV1(args:Awaited<ReturnType<
  typeof seedInheritedApplicabilityFailingBeforeV1>>,
  historicalPublishedV2:Awaited<ReturnType<typeof seedHistoricalV2PublicationBefore0101>>){
  const{fixture,draft}=args;
  const passingAfter=await transaction((queryable)=>loadSignalSemanticContextPublicationPreflightV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key}));
  assert.equal(passingAfter.counts.locale_market_required_unresolved,0);
  assert.equal(passingAfter.blockers.includes("locale_market_required_unresolved"),false,
    "passing-after: the sealed MX+US parent resolves an ordinary null-locale leaf without a form");
  const snapshot=(await pool.query<{snapshot:{candidate_pack:{elements:Array<Record<string,unknown>>};
    preflight:Record<string,unknown>}}>(`SELECT signal_semantic_context_publication_snapshot_v2(generation.id,
      jsonb_build_object('brand_os_digest',generation.brand_os_digest,
        'knowledge_digest',generation.knowledge_digest,'locale_context_digest',generation.locale_context_digest,
        'proposal_provider_lineage',generation.proposal_provider_lineage,
        'proposal_provider_lineage_digest',generation.proposal_provider_lineage_digest)) snapshot
    FROM signal_semantic_context_generations generation
    WHERE generation.workspace_id=$1::uuid AND generation.generation_key=$2`,
  [fixture.workspace.id,draft.generation_key])).rows[0]!.snapshot;
  const byKey=new Map(snapshot.candidate_pack.elements.map((element)=>[element.element_key,element]));
  const inherited=byKey.get("ordinary-null")!;
  assert.equal(inherited.locale,null,"workspace inheritance never fabricates the primary en-US leaf locale");
  assert.deepEqual(inherited.applicability,{contract_version:"signal-semantic-context-effective-applicability-v1",
    state:"workspace_inherited",locale:null,locales:["en-US","es-MX"],markets:["MX","US"],
    source:"sealed_generation_locale_context",
    parent_authority:(inherited.applicability as Record<string,unknown>).parent_authority,
    parent_authority_digest:(inherited.applicability as Record<string,unknown>).parent_authority_digest,
    explicit_authority_digest:null});
  assert.deepEqual((inherited.applicability as {parent_authority:{primary_locale:string;locales:string[];
    markets:string[];source:string}}).parent_authority,{contract_version:"signal-semantic-context-parent-applicability-v1",
    source:"sealed_generation_locale_context",generation:{key:draft.generation_key,version:draft.generation_version},
    primary_locale:"en-US",locales:["en-US","es-MX"],markets:["MX","US"],
    timezone:"America/Mexico_City",locale_context_digest:(inherited.applicability as {parent_authority:{
      locale_context_digest:string}}).parent_authority.locale_context_digest});
  for(const [key,locale] of [["variant-en","en-US"],["variant-es","es-MX"]] as const){
    const explicit=byKey.get(key)!;
    assert.equal(explicit.locale,locale);assert.equal((explicit.applicability as {state:string}).state,"explicit_locale");
    assert.equal((explicit.applicability as {source:string}).source,"sealed_element_locale",
      "a provider-origin sealed locale is distinguished from dedicated operator locale authority");
    assert.deepEqual((explicit.applicability as {locales:string[]}).locales,[locale]);
  }
  const explicitGlobal=byKey.get("explicit-global-existing")!;
  assert.equal(explicitGlobal.locale,null);assert.deepEqual({
    state:(explicitGlobal.applicability as {state:string}).state,
    source:(explicitGlobal.applicability as {source:string}).source},
  {state:"explicit_global",source:"operator_locale_authority"},
  "explicit Global lineage created before 0101 remains valid and is never rewritten");
  const reviewPage=await transaction((queryable)=>loadSignalSemanticContextReviewPageV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key,
    filters:parseSignalSemanticContextReviewFiltersV1(new URLSearchParams())}));
  const inheritedReview=reviewPage.elements.find((element)=>element.element_key==="ordinary-null")!;
  assert.equal(inheritedReview.applicability.effective_state,"workspace_inherited");
  assert.deepEqual(inheritedReview.applicability.generation_markets,["MX","US"]);
  assert.equal(inheritedReview.locale,null);assert.equal(inheritedReview.attention.needs_locale_review,false);
  assert.equal(inheritedReview.locale_authority.state,"workspace_inherited");

  const candidateContract=(snapshot.candidate_pack as unknown as {contract_version:string}).contract_version;
  assert.equal(candidateContract,"signal-semantic-context-candidate-pack-v3");
  const historicalAfter0101=await fingerprint(`SELECT status,pack_digest,publication_schema_version,
    candidate_pack_digest,evidence_graph_digest,review_graph_digest,publication_authority_digest,
    publication_authority_snapshot,semantic_context_pack_digest,publish_preflight_digest,publication_counts,
    published_operation_id,published_by_user_id,published_at FROM signal_semantic_context_generations
    WHERE workspace_id=$1::uuid AND generation_key=$2`,[historicalPublishedV2.workspaceId,
    historicalPublishedV2.generationKey]);
  assert.equal(historicalAfter0101,historicalPublishedV2.immutableFingerprint,
    "0101 leaves a previously published publication-v2 row byte-for-byte immutable");
  const historicalSchema=(await pool.query<{publication_schema_version:string;status:string}>(
    `SELECT publication_schema_version,status FROM signal_semantic_context_generations
      WHERE workspace_id=$1::uuid AND generation_key=$2`,[historicalPublishedV2.workspaceId,
      historicalPublishedV2.generationKey])).rows[0]!;
  assert.deepEqual(historicalSchema,{publication_schema_version:"signal-semantic-context-publication-v2",
    status:"published"},"candidate-pack-v3/publication-graph-v3 are forward content contracts under the unchanged V2 writer envelope");

  const authority=(await pool.query<{generation_id:string;authority:Record<string,unknown>}>(`SELECT id::text generation_id,
    jsonb_build_object('brand_os_digest',brand_os_digest,'knowledge_digest',knowledge_digest,
      'locale_context_digest',locale_context_digest,'proposal_provider_lineage',proposal_provider_lineage,
      'proposal_provider_lineage_digest',proposal_provider_lineage_digest) authority
    FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid AND generation_key=$2`,
  [fixture.workspace.id,draft.generation_key])).rows[0]!;
  const inheritedParentDigest=(inherited.applicability as {parent_authority_digest:string}).parent_authority_digest;
  const lineageBeforeCorrection=(await pool.query<{locale:string|null;origin_kind:string;
    original_proposal_element_id:string;source_refs_digest:string}>(`SELECT locale,origin_kind,
      original_proposal_element_id::text,source_refs_digest FROM signal_semantic_context_element_versions element
    WHERE generation_id=$1::uuid AND element_key='ordinary-null' AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions child WHERE child.supersedes_element_id=element.id)`,
  [authority.generation_id])).rows[0]!;
  await transaction((queryable)=>correctSignalSemanticContextElementV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"inherited-post-0101-correction",
    generationKey:draft.generation_key,elementKey:"ordinary-null",reason:"operator_correction",
    rationale:"Correct wording while preserving the inherited workspace envelope.",correction:{
      canonical_key:"ordinary-null-corrected",display_text:"Ordinary corrected null locale",
      scope:"primary_brand",relation_kind:null,relation_target_key:null}}));
  const correctedPending=(await pool.query<{locale:string|null;origin_kind:string;
    original_proposal_element_id:string;source_refs_digest:string;locale_decision_contract_version:string|null}>(
    `SELECT locale,origin_kind,original_proposal_element_id::text,source_refs_digest,
      locale_decision_contract_version FROM signal_semantic_context_element_versions element
    WHERE generation_id=$1::uuid AND element_key='ordinary-null' AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions child WHERE child.supersedes_element_id=element.id)`,
  [authority.generation_id])).rows[0]!;
  assert.equal(correctedPending.locale,null);assert.equal(correctedPending.origin_kind,"operator_correction");
  assert.equal(correctedPending.original_proposal_element_id,lineageBeforeCorrection.original_proposal_element_id);
  assert.equal(correctedPending.source_refs_digest,lineageBeforeCorrection.source_refs_digest);
  assert.equal(correctedPending.locale_decision_contract_version,null,
    "generic correction cannot fabricate explicit global or locale authority");
  await approveElement(fixture,draft.generation_key,"ordinary-null","inherited-post-0101-correction-reapproval");
  const correctedApplicability=(await pool.query<{value:{valid:boolean;applicability:{state:string;locale:null;
    parent_authority_digest:string}}}>(`SELECT signal_semantic_context_effective_applicability_v1(element.id,$2::jsonb) value
    FROM signal_semantic_context_element_versions element WHERE generation_id=$1::uuid
      AND element_key='ordinary-null' AND disposition='approved' AND NOT EXISTS(
        SELECT 1 FROM signal_semantic_context_element_versions child WHERE child.supersedes_element_id=element.id)`,
  [authority.generation_id,JSON.stringify(authority.authority)])).rows[0]!.value;
  assert.equal(correctedApplicability.valid,true);assert.equal(correctedApplicability.applicability.state,
    "workspace_inherited");assert.equal(correctedApplicability.applicability.locale,null);
  assert.equal(correctedApplicability.applicability.parent_authority_digest,inheritedParentDigest,
    "reapproval resolves the corrected raw-null leaf through the same sealed parent authority");

  await transaction((queryable)=>appendSignalSemanticContextProposalsV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"inherited-post-0101-merge-source",
    generationKey:draft.generation_key,proposals:[{...proposal("ordinary-null-merge-source","identity_term",
      "ordinary-null-merge-source","Ordinary merge source",0.7,fixture.profileId),locale:null}]}));
  await approveElement(fixture,draft.generation_key,"ordinary-null-merge-source",
    "inherited-post-0101-merge-source-approval");
  const mergeBefore=await pool.query<{element_key:string;locale:string|null;original_proposal_element_id:string}>(
    `SELECT element_key,locale,original_proposal_element_id::text FROM signal_semantic_context_element_versions element
    WHERE generation_id=$1::uuid AND element_key=ANY($2::text[]) AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions child WHERE child.supersedes_element_id=element.id)
    ORDER BY element_key`,[authority.generation_id,["ordinary-null","ordinary-null-merge-source"]]);
  await seedOpenNearDuplicateAnnotation(fixture,draft.generation_key,"ordinary-null-merge-source",
    "ordinary-null","inherited-post-0101-near-duplicate");
  await transaction((queryable)=>mergeSignalSemanticContextElementsV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"inherited-post-0101-merge",
    generationKey:draft.generation_key,targetElementKey:"ordinary-null",
    sourceElementKeys:["ordinary-null-merge-source"],reason:"duplicate_same_concept",
    rationale:"Merge equivalent null-locale leaves without fabricating applicability authority.",targetCorrection:{
      canonical_key:"ordinary-null-corrected",display_text:"Ordinary corrected null locale",
      scope:"primary_brand",relation_kind:null,relation_target_key:null}}));
  const mergeAfter=await pool.query<{element_key:string;locale:string|null;disposition:string;
    origin_kind:string;original_proposal_element_id:string;locale_decision_contract_version:string|null}>(
    `SELECT element_key,locale,disposition,origin_kind,original_proposal_element_id::text,
      locale_decision_contract_version FROM signal_semantic_context_element_versions element
    WHERE generation_id=$1::uuid AND element_key=ANY($2::text[]) AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions child WHERE child.supersedes_element_id=element.id)
    ORDER BY element_key`,[authority.generation_id,["ordinary-null","ordinary-null-merge-source"]]);
  assert.deepEqual(mergeAfter.rows.map((row)=>({key:row.element_key,locale:row.locale,
    disposition:row.disposition,origin:row.origin_kind,proposal:row.original_proposal_element_id,
    localeAuthority:row.locale_decision_contract_version})),[
    {key:"ordinary-null",locale:null,disposition:"pending",origin:"operator_correction",
      proposal:mergeBefore.rows[0]!.original_proposal_element_id,localeAuthority:null},
    {key:"ordinary-null-merge-source",locale:null,disposition:"merged",origin:"operator_merge",
      proposal:mergeBefore.rows[1]!.original_proposal_element_id,localeAuthority:null}
  ],"generic merge preserves raw locale and proposal lineage and cannot mint explicit authority");
  await approveElement(fixture,draft.generation_key,"ordinary-null","inherited-post-0101-merge-reapproval");
  const mergedApplicability=(await pool.query<{value:{valid:boolean;applicability:{state:string;locale:null;
    parent_authority_digest:string}}}>(`SELECT signal_semantic_context_effective_applicability_v1(element.id,$2::jsonb) value
    FROM signal_semantic_context_element_versions element WHERE generation_id=$1::uuid
      AND element_key='ordinary-null' AND disposition='approved' AND NOT EXISTS(
        SELECT 1 FROM signal_semantic_context_element_versions child WHERE child.supersedes_element_id=element.id)`,
  [authority.generation_id,JSON.stringify(authority.authority)])).rows[0]!.value;
  assert.equal(mergedApplicability.valid,true);assert.equal(mergedApplicability.applicability.state,
    "workspace_inherited");assert.equal(mergedApplicability.applicability.locale,null);
  assert.equal(mergedApplicability.applicability.parent_authority_digest,inheritedParentDigest);

  const versionsBeforeGenericBypass=await scalar(`SELECT count(*)::int count
    FROM signal_semantic_context_element_versions WHERE workspace_id=$1::uuid`,[fixture.workspace.id]);
  const attemptInheritedAuthorityBypass=async(mode:"explicit_locale"|"explicit_global")=>transaction(async(queryable)=>{
    const operation=await queryable.query<{id:string}>(`INSERT INTO signal_governance_control_operations(
      workspace_id,actor_user_id,action,request_digest,idempotency_key,status)
      VALUES($1::uuid,$2::uuid,'correct-semantic-context-element',$3,$4,'in_progress') RETURNING id::text`,
    [fixture.workspace.id,fixture.actor.id,digest(`inherited-bypass-request:${mode}`),
      digest(`inherited-bypass-key:${mode}`)]);
    const fakeDigest=digest(`inherited-bypass:${mode}`);
    await queryable.query(`INSERT INTO signal_semantic_context_element_versions(
      workspace_id,generation_id,artifact_id,evidence_group_id,element_key,element_version,element_kind,
      canonical_key,display_text,scope,entity_type,entity_id,locale,relation_kind,relation_target_key,
      confidence,disposition,origin_kind,supersedes_element_id,original_proposal_element_id,source_refs_digest,
      element_digest,operation_id,proposed_by_user_id,locale_decision_contract_version,
      locale_decision_disposition,locale_decision_locale,locale_decision_reason_code,locale_decision_rationale,
      locale_decision_basis_digest,locale_decision_input_digest,locale_decision_authority_snapshot,
      locale_decision_authority_digest,locale_decision_prestate_digest,locale_decision_poststate_digest)
      SELECT workspace_id,generation_id,artifact_id,evidence_group_id,element_key,element_version+1,element_kind,
        canonical_key,display_text,scope,entity_type,entity_id,
        CASE WHEN $3='explicit_locale' THEN 'es-MX' ELSE locale END,relation_kind,relation_target_key,confidence,
        'pending','operator_correction',id,COALESCE(original_proposal_element_id,id),source_refs_digest,element_digest,
        $4::uuid,proposed_by_user_id,
        CASE WHEN $3='explicit_global' THEN 'signal-semantic-context-locale-decision-v1' ELSE NULL END,
        CASE WHEN $3='explicit_global' THEN 'global' ELSE NULL END,NULL,
        CASE WHEN $3='explicit_global' THEN 'locale_resolution' ELSE NULL END,
        CASE WHEN $3='explicit_global' THEN 'A generic path must not mint global authority.' ELSE NULL END,
        CASE WHEN $3='explicit_global' THEN $5 ELSE NULL END,CASE WHEN $3='explicit_global' THEN $5 ELSE NULL END,
        CASE WHEN $3='explicit_global' THEN '{}'::jsonb ELSE NULL END,
        CASE WHEN $3='explicit_global' THEN $5 ELSE NULL END,CASE WHEN $3='explicit_global' THEN $5 ELSE NULL END,
        CASE WHEN $3='explicit_global' THEN $5 ELSE NULL END
      FROM signal_semantic_context_element_versions element WHERE workspace_id=$1::uuid
        AND element_key=$2 AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions child
          WHERE child.supersedes_element_id=element.id)`,[fixture.workspace.id,"ordinary-null",mode,
      operation.rows[0]!.id,fakeDigest]);
  });
  for(const mode of ["explicit_locale","explicit_global"] as const){
    const error=await attemptInheritedAuthorityBypass(mode).then(()=>null,(caught:unknown)=>caught as {code?:string;message?:string});
    assert.ok(error,`generic SQL ${mode} fabrication fails closed after 0101`);
    assert.equal(error.code,"23514",`generic SQL ${mode} failed with ${error.code}: ${error.message}`);
  }
  assert.equal(await scalar(`SELECT count(*)::int count FROM signal_semantic_context_element_versions
    WHERE workspace_id=$1::uuid`,[fixture.workspace.id]),versionsBeforeGenericBypass,
  "failed inherited authority fabrication rolls back without graph drift");

  await transaction((queryable)=>decideSignalSemanticContextLocaleAuthorityV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"inherited-dedicated-explicit-locale",
    generationKey:draft.generation_key,elementKeys:["ordinary-null"],disposition:"locale_specific",locale:"es-MX",
    reason:"locale_resolution",rationale:"A dedicated operator decision explicitly scopes this test leaf to es-MX.",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_LOCALE_DECISION_CONFIRMATION_V1}));
  await approveElement(fixture,draft.generation_key,"ordinary-null","inherited-dedicated-explicit-reapproval");
  const dedicatedApplicability=(await pool.query<{value:{valid:boolean;applicability:{state:string;source:string;
    locale:string}}}>(`SELECT signal_semantic_context_effective_applicability_v1(element.id,$2::jsonb) value
    FROM signal_semantic_context_element_versions element WHERE generation_id=$1::uuid
      AND element_key='ordinary-null' AND disposition='approved' AND NOT EXISTS(
        SELECT 1 FROM signal_semantic_context_element_versions child WHERE child.supersedes_element_id=element.id)`,
  [authority.generation_id,JSON.stringify(authority.authority)])).rows[0]!.value;
  assert.deepEqual({valid:dedicatedApplicability.valid,state:dedicatedApplicability.applicability.state,
    source:dedicatedApplicability.applicability.source,locale:dedicatedApplicability.applicability.locale},
  {valid:true,state:"explicit_locale",source:"operator_locale_authority",locale:"es-MX"},
  "dedicated explicit locale uses operator authority in the shared SQL resolver");
  const dedicatedReviewPage=await transaction((queryable)=>loadSignalSemanticContextReviewPageV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key,
    filters:parseSignalSemanticContextReviewFiltersV1(new URLSearchParams())}));
  const dedicatedReview=dedicatedReviewPage.elements.find((element)=>element.element_key==="ordinary-null")!;
  assert.deepEqual({state:dedicatedReview.applicability.effective_state,
    source:dedicatedReview.applicability.source,locale:dedicatedReview.applicability.locale},
  {state:"explicit_locale",source:"operator_locale_authority",locale:"es-MX"},
  "operator-safe Review projection matches the SQL source distinction");

  const inheritedId=(await pool.query<{id:string}>(`SELECT id::text FROM signal_semantic_context_element_versions element
    WHERE generation_id=$1::uuid AND element_key='ordinary-null' AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions child WHERE child.supersedes_element_id=element.id)`,
  [authority.generation_id])).rows[0]!.id;
  for(const [label,expected] of [
    ["missing",{valid:false,reason:"parent_authority_missing"}],
    ["spoofed",{valid:false,reason:"live_authority_drift"}]
  ] as const){
    const value=label==="missing"
      ?(await pool.query<{value:unknown}>(`SELECT signal_semantic_context_parent_applicability_v1($1::uuid,$2::jsonb) value`,
        [randomUUID(),JSON.stringify(authority.authority)])).rows[0]!.value
      :(await pool.query<{value:unknown}>(`SELECT signal_semantic_context_parent_applicability_v1($1::uuid,$2::jsonb) value`,
        [authority.generation_id,JSON.stringify({...authority.authority,locale_context_digest:digest("spoof")})])).rows[0]!.value;
    assert.deepEqual(value,expected,`${label} parent authority fails closed`);
  }
  await assert.rejects(pool.query(`SELECT signal_semantic_context_publication_snapshot_v2($1::uuid,NULL)`,
    [authority.generation_id]),/live authority is required/u);
  const malformedClient=await pool.connect();let malformed:unknown;let malformedReviewState:unknown;
  try{await malformedClient.query("BEGIN");await malformedClient.query("SET LOCAL session_replication_role='replica'");
    await malformedClient.query(`UPDATE signal_semantic_context_generations SET locale_context_digest=$2
      WHERE id=$1::uuid`,[authority.generation_id,digest("malformed-sealed-parent")]);
    malformed=(await malformedClient.query<{value:unknown}>(`SELECT signal_semantic_context_effective_applicability_v1(
      $1::uuid,$2::jsonb) value`,[inheritedId,JSON.stringify(authority.authority)])).rows[0]!.value;
    const driftedReview=await loadSignalSemanticContextReviewPageV1({queryable:malformedClient,
      workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key,
      filters:parseSignalSemanticContextReviewFiltersV1(new URLSearchParams()),parentApplicabilityValid:false});
    malformedReviewState=driftedReview.elements.find((element)=>element.element_key==="ordinary-null")
      ?.applicability.effective_state;
    await malformedClient.query("ROLLBACK");
  }catch(error){await malformedClient.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{malformedClient.release();}
  assert.deepEqual(malformed,{valid:false,reason:"parent_authority_digest_invalid"});
  assert.equal(malformedReviewState,"unresolved",
    "Review fails closed instead of projecting inherited or explicit applicability from an invalid parent seal");

  const variantFixture=await seedFixture();
  const variantInitial=await transaction((queryable)=>createSignalSemanticContextDraftV1({queryable,
    workspace:variantFixture.workspace,actor:variantFixture.actor,idempotencyKey:"null-variant-initial"}));
  const variantLineage=await fullLineageForDraft(variantFixture,variantInitial.generation_key,
    terminalPreflightConfiguration);
  const variantDraft=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:variantFixture.workspace,actor:variantFixture.actor,idempotencyKey:"null-variant-lineage",
    reason:"provider_lineage_missing",proposalLineage:variantLineage}));
  await transaction((queryable)=>appendSignalSemanticContextProposalsV1({queryable,
    workspace:variantFixture.workspace,actor:variantFixture.actor,idempotencyKey:"null-variant-proposal",
    generationKey:variantDraft.generation_key,proposals:[{...proposal("variant-null","locale_variant",
      "variant-null","Null true locale variant",0.8,variantFixture.profileId),locale:null}]}));
  await approveElement(variantFixture,variantDraft.generation_key,"variant-null","null-variant-approval");
  const variantPreflight=await transaction((queryable)=>loadSignalSemanticContextPublicationPreflightV2({queryable,
    workspace:variantFixture.workspace,actor:variantFixture.actor,generationKey:variantDraft.generation_key}));
  assert.equal(variantPreflight.counts.locale_market_required_unresolved,1);
  assert.ok(variantPreflight.blockers.includes("locale_market_required_unresolved"),
    "a true locale-specific null leaf never inherits the workspace envelope");
}

async function exercisePublicationPreflightScaleV2(){
  const fixture=await seedFixture();
  const protectedBefore=await protectedCounts(fixture.workspace.id);
  const initial=await transaction((queryable)=>createSignalSemanticContextDraftV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-scale-initial-draft"}));
  const lineage=await fullLineageForDraft(fixture,initial.generation_key,terminalPreflightConfiguration);
  const draft=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-scale-lineage",
    reason:"provider_lineage_missing",proposalLineage:lineage}));
  const proposals=Array.from({length:250},(_,index)=>proposal(`scale-${String(index).padStart(3,"0")}`,
    "identity_term",`scale-canonical-${String(index).padStart(3,"0")}`,
    `Scale candidate ${String(index).padStart(3,"0")}`,0.5,fixture.profileId));
  const appended=await transaction((queryable)=>appendSignalSemanticContextProposalsV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-scale-250-proposals",
    generationKey:draft.generation_key,proposals}));
  assert.equal(appended.created,250);
  const operationsBefore=await scalar(`SELECT count(*)::int count FROM signal_governance_control_operations
    WHERE workspace_id=$1::uuid`,[fixture.workspace.id]);
  const startedAt=performance.now();
  const preflight=await transaction((queryable)=>loadSignalSemanticContextPublicationPreflightV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key}));
  const elapsedMs=performance.now()-startedAt;
  assert.equal(preflight.publishable,false);
  assert.equal(preflight.counts.total_leaves,250);
  assert.equal(preflight.counts.pending,250);
  assert.equal(preflight.blockers.includes("pending_elements"),true);
  assert.equal(await scalar(`SELECT count(*)::int count FROM signal_governance_control_operations
    WHERE workspace_id=$1::uuid`,[fixture.workspace.id]),operationsBefore,
  "250-element publication preflight remains read-only");
  assert.ok(elapsedMs<5_000,`250-element publication preflight exceeded 5 seconds: ${elapsedMs}ms`);
  assert.deepEqual(await protectedCounts(fixture.workspace.id),protectedBefore);
}

async function exerciseMutationAuthorityDriftV2(){
  const fixture=await seedFixture();
  const protectedBefore=await protectedCounts(fixture.workspace.id);
  const initial=await transaction((queryable)=>createSignalSemanticContextDraftV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-drift-initial-draft"}));
  const lineage=await fullLineageForDraft(fixture,initial.generation_key,terminalPreflightConfiguration);
  const draft=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-drift-lineage",
    reason:"provider_lineage_missing",proposalLineage:lineage}));
  await transaction((queryable)=>appendSignalSemanticContextProposalsV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-drift-proposals",
    generationKey:draft.generation_key,proposals:[
      proposal("drift-target","identity_term","drift-target","Drift target",0.5,fixture.profileId),
      proposal("drift-source","identity_term","drift-source","Drift source",0.5,fixture.profileId)
    ]}));
  await transaction((queryable)=>annotateSignalSemanticContextElementV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-drift-open-annotation",
    generationKey:draft.generation_key,elementKey:"drift-target",annotationKey:"drift-open-annotation",
    annotationType:"uncertain",reason:"insufficient_context",rationale:"Open before authority drift.",
    relatedElementKeys:[]}));
  const versionsBefore=await scalar(`SELECT count(*)::int count FROM signal_semantic_context_element_versions
    WHERE workspace_id=$1::uuid`,[fixture.workspace.id]);
  const operationsBefore=await scalar(`SELECT count(*)::int count FROM signal_governance_control_operations
    WHERE workspace_id=$1::uuid`,[fixture.workspace.id]);
  await pool.query(`UPDATE brand_os_profiles SET metadata=jsonb_set(metadata,'{snapshot_hash}',to_jsonb($2::text),true)
    WHERE id=$1::uuid`,[fixture.profileId,digest("brand-os-drift")]);
  await assert.rejects(transaction((queryable)=>correctSignalSemanticContextElementV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-drift-correction-blocked",
    generationKey:draft.generation_key,elementKey:"drift-target",reason:"operator_correction",
    rationale:"A stale authority must block correction.",correction:{canonical_key:"drift-target",
      display_text:"Drift target",scope:"primary_brand",relation_kind:null,
      relation_target_key:null}})),/semantic_context_authority_drift/u);
  await assert.rejects(transaction((queryable)=>annotateSignalSemanticContextElementV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-drift-annotation-blocked",
    generationKey:draft.generation_key,elementKey:"drift-target",annotationKey:"drift-annotation",
    annotationType:"uncertain",reason:"insufficient_context",rationale:"Stale authority blocks review.",
    relatedElementKeys:[]})),/semantic_context_authority_drift/u);
  await assert.rejects(transaction((queryable)=>resolveSignalSemanticContextAnnotationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-drift-resolution-blocked",
    generationKey:draft.generation_key,elementKey:"drift-target",annotationKey:"drift-open-annotation",
    resolution:"not_supported",reason:"insufficient_context",
    rationale:"A stale authority cannot seal a new resolution basis.",
    confirmation:SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONFIRMATION_V1})),
  /semantic_context_authority_drift/u);
  await assert.rejects(transaction((queryable)=>mergeSignalSemanticContextElementsV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-drift-merge-blocked",
    generationKey:draft.generation_key,targetElementKey:"drift-target",sourceElementKeys:["drift-source"],
    reason:"duplicate_same_concept",rationale:"Stale authority blocks merge.",targetCorrection:{
      canonical_key:"drift-target",display_text:"Drift target",scope:"primary_brand",
      relation_kind:null,relation_target_key:null}})),/semantic_context_authority_drift/u);
  assert.equal(await scalar(`SELECT count(*)::int count FROM signal_semantic_context_element_versions
    WHERE workspace_id=$1::uuid`,[fixture.workspace.id]),versionsBefore);
  assert.equal(await scalar(`SELECT count(*)::int count FROM signal_governance_control_operations
    WHERE workspace_id=$1::uuid`,[fixture.workspace.id]),operationsBefore,
  "authority drift rejects every mutation before a durable operation survives rollback");
  assert.deepEqual(await protectedCounts(fixture.workspace.id),protectedBefore);
}

async function exerciseProviderAuthorityDriftV2(){
  const fixture=await seedFixture();
  const draft=await withProductProviderEnvironment(()=>createSignalSemanticContextDraftProductV1({
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-provider-authority-draft"}));
  await transaction((queryable)=>appendSignalSemanticContextProposalsV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-provider-authority-proposal",
    generationKey:draft.generation_key,proposals:[proposal("provider-authority","identity_term",
      "provider-authority","Provider authority",0.5,fixture.profileId)]}));
  await withProductProviderEnvironment(()=>approveElement(fixture,draft.generation_key,
    "provider-authority","v2-provider-authority-approve"));
  const baseline=await withProductProviderEnvironment(()=>transaction((queryable)=>
    loadSignalSemanticContextPublicationPreflightV2({queryable,workspace:fixture.workspace,
      actor:fixture.actor,generationKey:draft.generation_key})));
  assert.equal(baseline.publishable,true);
  const modelDrift=await withProductProviderEnvironment(()=>transaction((queryable)=>
    loadSignalSemanticContextPublicationPreflightV2({queryable,workspace:fixture.workspace,
      actor:fixture.actor,generationKey:draft.generation_key})),{
    NOISIA_SEMANTIC_CONTEXT_MODEL:"unregistered-model"
  });
  assert.equal(modelDrift.publishable,false);
  assert.ok(modelDrift.blockers.includes("provider_lineage_not_current"));
  assert.notEqual(modelDrift.preflight_digest,baseline.preflight_digest);
  const pricingDrift=await withProductProviderEnvironment(()=>transaction((queryable)=>
    loadSignalSemanticContextPublicationPreflightV2({queryable,workspace:fixture.workspace,
      actor:fixture.actor,generationKey:draft.generation_key})),{
    NOISIA_SEMANTIC_CONTEXT_PRICING_VERSION:"pricing-drift"
  });
  assert.equal(pricingDrift.publishable,false);
  assert.notEqual(pricingDrift.preflight_digest,baseline.preflight_digest);
  const lineageDrift=await withProductProviderEnvironment(()=>transaction((queryable)=>
    loadSignalSemanticContextPublicationPreflightV2({queryable,workspace:fixture.workspace,
      actor:fixture.actor,generationKey:draft.generation_key})),{
    NOISIA_SEMANTIC_CONTEXT_INPUT_USD_PER_MILLION_TOKENS:"3.100000"
  });
  assert.equal(lineageDrift.publishable,false);
  assert.notEqual(lineageDrift.preflight_digest,baseline.preflight_digest);
}

async function exerciseRelationTargetAuthorityV2(){
  const fixture=await seedFixture();
  const initial=await transaction((queryable)=>createSignalSemanticContextDraftV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-relation-initial"}));
  const lineage=await fullLineageForDraft(fixture,initial.generation_key,terminalPreflightConfiguration);
  const draft=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-relation-lineage",
    reason:"provider_lineage_missing",proposalLineage:lineage}));
  const relation=(key:string,target:string)=>({
    element_key:key,element_kind:"typed_relation" as const,canonical_key:key,display_text:key,
    scope:"primary_brand",entity_type:null,entity_id:null,locale:"es-MX",
    relation_kind:"associated_with" as const,relation_target_key:target,confidence:0.5,
    origin_kind:"server_projection" as const,source_refs:[{source_type:"brand_os_profile" as const,
      source_id:fixture.profileId,relation_type:"supports" as const}]
  });
  await transaction((queryable)=>appendSignalSemanticContextProposalsV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-relation-proposals",
    generationKey:draft.generation_key,proposals:[
      proposal("relation-target-approved","identity_term","target-approved","Target approved",0.5,fixture.profileId),
      proposal("relation-target-pending","identity_term","target-pending","Target pending",0.5,fixture.profileId),
      proposal("relation-target-rejected","identity_term","target-rejected","Target rejected",0.5,fixture.profileId),
      proposal("relation-merge-target","identity_term","merge-target","Merge target",0.5,fixture.profileId),
      proposal("relation-target-merged","identity_term","target-merged","Target merged",0.5,fixture.profileId),
      proposal("relation-target-superseded","identity_term","target-superseded","Target superseded",0.5,fixture.profileId),
      relation("relation-valid","relation-target-approved"),relation("relation-missing","missing-target"),
      relation("relation-pending","relation-target-pending"),relation("relation-rejected","relation-target-rejected"),
      relation("relation-merged","relation-target-merged"),relation("relation-self","relation-self"),
      relation("relation-current-successor","relation-target-superseded")
    ]}));
  for(const key of ["relation-target-approved","relation-valid","relation-missing","relation-pending",
    "relation-rejected","relation-merged","relation-self","relation-current-successor"]){
    await approveElement(fixture,draft.generation_key,key,`v2-relation-approve-${key}`);
  }
  await rejectElement(fixture,draft.generation_key,"relation-target-rejected","v2-relation-reject-target");
  await seedOpenNearDuplicateAnnotation(fixture,draft.generation_key,"relation-target-merged",
    "relation-merge-target","relation-merge-review");
  await transaction((queryable)=>mergeSignalSemanticContextElementsV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-relation-merge-target",
    generationKey:draft.generation_key,targetElementKey:"relation-merge-target",
    sourceElementKeys:["relation-target-merged"],reason:"duplicate_same_concept",
    rationale:"Merge relation target fixture.",targetCorrection:{canonical_key:"merge-target",
      display_text:"Merge target",scope:"primary_brand",relation_kind:null,
      relation_target_key:null}}));
  await transaction((queryable)=>correctSignalSemanticContextElementV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-relation-correct-successor",
    generationKey:draft.generation_key,elementKey:"relation-target-superseded",reason:"operator_correction",
    rationale:"Create a current successor for target resolution.",correction:{canonical_key:"target-superseded-current",
      display_text:"Target superseded current",scope:"primary_brand",relation_kind:null,
      relation_target_key:null}}));
  await approveElement(fixture,draft.generation_key,"relation-target-superseded",
    "v2-relation-approve-successor");
  const blocked=await transaction((queryable)=>loadSignalSemanticContextPublicationPreflightV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key}));
  assert.equal(blocked.counts.invalid_relation_targets,5,
  "missing, pending, rejected, merged and self targets are invalid; approved current/successor targets are valid");
  assert.ok(blocked.blockers.includes("invalid_relation_target"));
  const tokenBefore=blocked.preflight_digest;
  await transaction((queryable)=>correctSignalSemanticContextElementV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-relation-target-change",
    generationKey:draft.generation_key,elementKey:"relation-target-approved",reason:"operator_correction",
    rationale:"Changing target authority invalidates the prior preflight.",correction:{canonical_key:"target-approved-v2",
      display_text:"Target approved v2",scope:"primary_brand",relation_kind:null,
      relation_target_key:null}}));
  const changed=await transaction((queryable)=>loadSignalSemanticContextPublicationPreflightV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key}));
  assert.equal(changed.counts.invalid_relation_targets,6);
  assert.notEqual(changed.preflight_digest,tokenBefore,"target authority changes invalidate the preflight token");
}

async function exerciseMixedStateMergeV2(){
  const fixture=await seedFixture();
  const protectedBefore=await protectedCounts(fixture.workspace.id);
  const initial=await transaction((queryable)=>createSignalSemanticContextDraftV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-mixed-initial-draft"}));
  const lineage=await fullLineageForDraft(fixture,initial.generation_key,terminalPreflightConfiguration);
  const draft=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-mixed-lineage",
    reason:"provider_lineage_missing",proposalLineage:lineage}));
  await transaction((queryable)=>appendSignalSemanticContextProposalsV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-mixed-proposals",
    generationKey:draft.generation_key,proposals:[
      proposal("mixed-target","identity_term","mixed-target","Mixed target",0.5,fixture.profileId),
      proposal("mixed-approved","identity_term","mixed-approved","Mixed approved",0.5,fixture.profileId),
      proposal("mixed-rejected","identity_term","mixed-rejected","Mixed rejected",0.5,fixture.profileId)
    ]}));
  await approveElement(fixture,draft.generation_key,"mixed-approved","v2-mixed-approve-source");
  await rejectElement(fixture,draft.generation_key,"mixed-rejected","v2-mixed-reject-source");
  await seedOpenNearDuplicateAnnotation(fixture,draft.generation_key,"mixed-approved","mixed-target",
    "mixed-approved-near-target");
  await seedOpenNearDuplicateAnnotation(fixture,draft.generation_key,"mixed-rejected","mixed-target",
    "mixed-rejected-near-target");
  const counts=async()=>pool.query<{disposition:string;count:number}>(`SELECT disposition,count(*)::int count
    FROM signal_semantic_context_element_versions element WHERE workspace_id=$1::uuid AND generation_id=(
      SELECT id FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid AND generation_key=$2)
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor
        WHERE successor.supersedes_element_id=element.id) GROUP BY disposition ORDER BY disposition`,
  [fixture.workspace.id,draft.generation_key]).then((result)=>result.rows);
  assert.deepEqual(await counts(),[{disposition:"approved",count:1},{disposition:"pending",count:1},
    {disposition:"rejected",count:1}]);
  await transaction((queryable)=>mergeSignalSemanticContextElementsV2({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"v2-mixed-state-merge",
    generationKey:draft.generation_key,targetElementKey:"mixed-target",
    sourceElementKeys:["mixed-approved","mixed-rejected"],reason:"duplicate_same_concept",
    rationale:"Resolve reviewed same-kind variants into one pending target.",targetCorrection:{
      canonical_key:"mixed-target",display_text:"Mixed target",scope:"primary_brand",
      relation_kind:null,relation_target_key:null}}));
  assert.deepEqual(await counts(),[{disposition:"merged",count:2},{disposition:"pending",count:1}],
  "mixed approved/rejected sources reconcile to merged while total leaves remain constant");
  assert.deepEqual(await protectedCounts(fixture.workspace.id),protectedBefore);
}

async function attemptRawCrossAuthorityElementInsert(queryable:SignalBrandPolicyQueryable,
  fixture:Awaited<ReturnType<typeof seedFixture>>,generationKey:string){
  const generation=await queryable.query<{id:string}>(`SELECT id::text FROM signal_semantic_context_generations
    WHERE workspace_id=$1::uuid AND generation_key=$2`,[fixture.workspace.id,generationKey]);
  const operation=await queryable.query<{id:string}>(`INSERT INTO signal_governance_control_operations(
    workspace_id,actor_user_id,action,request_digest,idempotency_key,status)
    VALUES($1::uuid,$2::uuid,'append-semantic-context-proposals',$3,$4,'in_progress') RETURNING id::text`,
  [fixture.workspace.id,fixture.actor.id,digest("raw-cross-authority-request"),
    digest("raw-cross-authority-key")]);
  const elementDigest=digest("raw-cross-authority-element");
  const artifact=await queryable.query<{id:string}>(`INSERT INTO analysis_artifacts(
    workspace_id,workspace_artifact_kind,workspace_authority_digest,artifact_key,artifact_type,
    content,confidence,review_status,revision,metadata)
    VALUES($1::uuid,'semantic_context',$2,'raw-cross-authority','semantic_context_element',
      '{}'::jsonb,'0.5','needs_review',1,'{}'::jsonb) RETURNING id::text`,
  [fixture.workspace.id,elementDigest]);
  const group=await queryable.query<{id:string}>(`INSERT INTO analysis_evidence_groups(
    artifact_id,group_key,role,label,summary,position,metadata)
    VALUES($1::uuid,'source-authority','supporting','Source authority',NULL,0,'{}'::jsonb)
    RETURNING id::text`,[artifact.rows[0]!.id]);
  await queryable.query(`INSERT INTO analysis_evidence_links(evidence_group_id,source_type,source_id,
    relation_type,evidence_role,locator,position,metadata) VALUES($1::uuid,'brand_os_profile',$2::uuid,
    'supports','supporting','{}'::jsonb,0,'{}'::jsonb)`,[group.rows[0]!.id,fixture.otherProfileId]);
  await queryable.query(`INSERT INTO signal_semantic_context_element_versions(
    workspace_id,generation_id,artifact_id,evidence_group_id,element_key,element_version,element_kind,
    canonical_key,display_text,scope,locale,confidence,disposition,origin_kind,source_refs_digest,
    element_digest,operation_id,proposed_by_user_id)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'raw-cross-authority',1,'identity_term',
      'raw-cross-authority','Raw cross authority','primary_brand','es-MX',0.5,'pending','server_projection',
      $5,$6,$7::uuid,$8::uuid)`,[fixture.workspace.id,generation.rows[0]!.id,artifact.rows[0]!.id,
    group.rows[0]!.id,digest("raw-cross-authority-refs"),elementDigest,operation.rows[0]!.id,
    fixture.actor.id]);
}

async function seedOpenNearDuplicateAnnotation(fixture:Awaited<ReturnType<typeof seedFixture>>,
  generationKey:string,subjectKey:string,targetKey:string,annotationKey:string){
  const row=await pool.query<{generation_id:string;subject_id:string;target_id:string}>(`SELECT generation.id::text generation_id,
    subject.id::text subject_id,target.id::text target_id FROM signal_semantic_context_generations generation
    JOIN signal_semantic_context_element_versions subject ON subject.generation_id=generation.id AND subject.element_key=$3
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor
        WHERE successor.supersedes_element_id=subject.id)
    JOIN signal_semantic_context_element_versions target ON target.generation_id=generation.id AND target.element_key=$4
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor
        WHERE successor.supersedes_element_id=target.id)
    WHERE generation.workspace_id=$1::uuid AND generation.generation_key=$2`,
  [fixture.workspace.id,generationKey,subjectKey,targetKey]);
  const authority=row.rows[0]!;
  const operation=await pool.query<{id:string}>(`INSERT INTO signal_governance_control_operations(
    workspace_id,actor_user_id,action,request_digest,idempotency_key,status)
    VALUES($1::uuid,$2::uuid,'annotate-semantic-context-element',$3,$4,'in_progress') RETURNING id::text`,
  [fixture.workspace.id,fixture.actor.id,digest(`fixture-request:${annotationKey}`),
    digest(`fixture-key:${annotationKey}`)]);
  const annotation=await pool.query<{id:string}>(`INSERT INTO signal_semantic_context_review_annotations(
    workspace_id,generation_id,annotation_key,annotation_version,annotation_type,state,resolution,
    subject_element_id,related_element_ids,reason_code,rationale,operation_id,actor_user_id)
    VALUES($1::uuid,$2::uuid,$3,1,'near_duplicate','open',NULL,$4::uuid,ARRAY[$5::uuid],
      'duplicate_same_concept','Mixed-state fixture review.',$6::uuid,$7::uuid) RETURNING id::text`,
  [fixture.workspace.id,authority.generation_id,annotationKey,authority.subject_id,authority.target_id,
    operation.rows[0]!.id,fixture.actor.id]);
  await pool.query(`INSERT INTO signal_semantic_context_events(workspace_id,generation_id,element_id,operation_id,
    event_index,event_kind,previous_state_digest,next_state_digest,actor_user_id)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,0,'review_annotation_created',NULL,$5,$6::uuid)`,
  [fixture.workspace.id,authority.generation_id,authority.subject_id,operation.rows[0]!.id,
    digest(`fixture-annotation:${annotation.rows[0]!.id}`),fixture.actor.id]);
  await pool.query(`UPDATE signal_governance_control_operations SET status='completed',result=$2::jsonb,
    completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid`,
  [operation.rows[0]!.id,JSON.stringify({annotation_key:annotationKey,annotation_version:1,state:"open",
    resolution:null})]);
}

type DirectAnnotationResolutionMutation={inputElementKey?:string;extraAnnotationKey?:string;
  extraState?:"open"|"resolved"};

async function attemptDirectAnnotationResolutionGraph(
  fixture:Awaited<ReturnType<typeof seedFixture>>,generationKey:string,annotationKey:string,
  mutation:DirectAnnotationResolutionMutation={}){
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const current=(await client.query<{id:string;generation_id:string;annotation_version:number;
      annotation_type:"uncertain";subject_element_id:string;subject_element_key:string;
      related_element_ids:string[];proposal_provider_lineage:unknown;brand_os_digest:string;
      knowledge_digest:string;locale_context_digest:string;proposal_provider_lineage_digest:string;
      actor_user_type:string;actor_primary_role:string}>(`SELECT annotation.id::text,annotation.generation_id::text,
        annotation.annotation_version,annotation.annotation_type,annotation.subject_element_id::text,
        subject.element_key subject_element_key,annotation.related_element_ids::text[],
        generation.proposal_provider_lineage,generation.brand_os_digest,generation.knowledge_digest,
        generation.locale_context_digest,generation.proposal_provider_lineage_digest,
        actor.user_type actor_user_type,actor.primary_role actor_primary_role
      FROM signal_semantic_context_review_annotations annotation
      JOIN signal_semantic_context_generations generation ON generation.id=annotation.generation_id
      JOIN signal_semantic_context_element_versions subject ON subject.id=annotation.subject_element_id
      JOIN users actor ON actor.id=$4::uuid
      WHERE annotation.workspace_id=$1::uuid AND generation.generation_key=$2
        AND annotation.annotation_key=$3 AND annotation.state='open'
        AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_review_annotations successor
          WHERE successor.supersedes_annotation_id=annotation.id)
        AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor
          WHERE successor.supersedes_element_id=subject.id)
      FOR UPDATE OF annotation`,[fixture.workspace.id,generationKey,annotationKey,fixture.actor.id])).rows[0]!;
    const basis=normalizeSignalSemanticContextAnnotationResolutionBasisV1({annotationType:current.annotation_type,
      resolution:"context_sufficient",reason:"insufficient_context",
      rationale:"The direct SQL control seals a complete operator resolution basis."});
    const input={contract_version:SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONTRACT_V1,
      generation_key:generationKey,element_key:mutation.inputElementKey??current.subject_element_key,
      annotation_key:annotationKey,action:"resolve",annotation_type:current.annotation_type,
      resolution:"context_sufficient",decision_basis:basis,
      confirmation:SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONFIRMATION_V1};
    const authority={brand_os_digest:current.brand_os_digest,knowledge_digest:current.knowledge_digest,
      locale_context_digest:current.locale_context_digest,
      proposal_provider_lineage:current.proposal_provider_lineage,
      proposal_provider_lineage_digest:current.proposal_provider_lineage_digest,
      actor:{id:fixture.actor.id.toLowerCase(),user_type:current.actor_user_type,
        primary_role:current.actor_primary_role}};
    const inputDigest=digestCanonicalJsonV2(input),basisDigest=digestCanonicalJsonV2(basis);
    const authorityDigest=digestCanonicalJsonV2(authority);
    const predecessorState=(await client.query<{digest:string}>(`SELECT
      signal_semantic_context_annotation_state_digest_v1(annotation) digest
      FROM signal_semantic_context_review_annotations annotation WHERE id=$1::uuid`,[current.id])).rows[0]!.digest;
    const successorState={annotation_key:annotationKey,annotation_version:current.annotation_version+1,
      annotation_type:current.annotation_type,state:"resolved" as const,resolution:"context_sufficient" as const,
      subject_element_id:current.subject_element_id,related_element_ids:current.related_element_ids,
      reason_code:"insufficient_context" as const,rationale:basis.rationale,
      resolution_contract_version:SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONTRACT_V1,
      resolution_basis_digest:basisDigest,resolution_input_digest:inputDigest,
      resolution_authority_digest:authorityDigest};
    const poststateDigest=signalSemanticContextAnnotationStateDigestV1(successorState);
    const operation=(await client.query<{id:string}>(`INSERT INTO signal_governance_control_operations(
      workspace_id,actor_user_id,action,request_digest,idempotency_key,status,
      semantic_context_decision_input,semantic_context_decision_input_digest)
      VALUES($1::uuid,$2::uuid,'resolve-semantic-context-annotation',$3,$4,'in_progress',$5::jsonb,$6)
      RETURNING id::text`,[fixture.workspace.id,fixture.actor.id,digest(`direct-resolution-request:${randomUUID()}`),
      digest(`direct-resolution-key:${randomUUID()}`),JSON.stringify(input),inputDigest])).rows[0]!;
    await client.query(`INSERT INTO signal_semantic_context_review_annotations(
      workspace_id,generation_id,annotation_key,annotation_version,annotation_type,state,resolution,
      subject_element_id,related_element_ids,reason_code,rationale,supersedes_annotation_id,
      operation_id,actor_user_id,resolution_contract_version,resolution_basis_digest,
      resolution_input_digest,resolution_authority_snapshot,resolution_authority_digest,
      resolution_prestate_digest,resolution_poststate_digest)
      VALUES($1::uuid,$2::uuid,$3,$4,$5,'resolved','context_sufficient',$6::uuid,$7::uuid[],
        'insufficient_context',$8,$9::uuid,$10::uuid,$11::uuid,$12,$13,$14,$15::jsonb,$16,$17,$18)
      `,[fixture.workspace.id,current.generation_id,annotationKey,
      successorState.annotation_version,current.annotation_type,current.subject_element_id,
      current.related_element_ids,basis.rationale,current.id,operation.id,fixture.actor.id,
      SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONTRACT_V1,basisDigest,inputDigest,
      JSON.stringify(authority),authorityDigest,predecessorState,poststateDigest]);
    if(mutation.extraAnnotationKey){
      const extra=(await client.query<{id:string;annotation_version:number;annotation_type:string;
        subject_element_id:string;related_element_ids:string[];reason_code:string;rationale:string}>(`SELECT
          annotation.id::text,annotation.annotation_version,annotation.annotation_type,
          annotation.subject_element_id::text,annotation.related_element_ids::text[],
          annotation.reason_code,annotation.rationale
        FROM signal_semantic_context_review_annotations annotation
        WHERE annotation.workspace_id=$1::uuid AND annotation.generation_id=$2::uuid
          AND annotation.annotation_key=$3 AND annotation.state='open'
          AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_review_annotations successor
            WHERE successor.supersedes_annotation_id=annotation.id) FOR UPDATE`,
      [fixture.workspace.id,current.generation_id,mutation.extraAnnotationKey])).rows[0]!;
      if(mutation.extraState==="open"){
        await client.query(`INSERT INTO signal_semantic_context_review_annotations(workspace_id,generation_id,
          annotation_key,annotation_version,annotation_type,state,resolution,subject_element_id,related_element_ids,
          reason_code,rationale,supersedes_annotation_id,operation_id,actor_user_id)
          VALUES($1::uuid,$2::uuid,$3,$4,$5,'open',NULL,$6::uuid,$7::uuid[],$8,$9,$10::uuid,$11::uuid,$12::uuid)`,
        [fixture.workspace.id,current.generation_id,mutation.extraAnnotationKey,extra.annotation_version+1,
          extra.annotation_type,extra.subject_element_id,extra.related_element_ids,extra.reason_code,extra.rationale,
          extra.id,operation.id,fixture.actor.id]);
      }else{
        await client.query(`INSERT INTO signal_semantic_context_review_annotations(workspace_id,generation_id,
          annotation_key,annotation_version,annotation_type,state,resolution,subject_element_id,related_element_ids,
          reason_code,rationale,supersedes_annotation_id,operation_id,actor_user_id,resolution_contract_version,
          resolution_basis_digest,resolution_input_digest,resolution_authority_snapshot,resolution_authority_digest,
          resolution_prestate_digest,resolution_poststate_digest)
          SELECT $1::uuid,$2::uuid,$3,$4,$5,'resolved','context_sufficient',$6::uuid,$7::uuid[],$8,$9,$10::uuid,
            $11::uuid,$12::uuid,$13,$14,$15,$16::jsonb,$17,$18,$19`,[fixture.workspace.id,current.generation_id,
          mutation.extraAnnotationKey,extra.annotation_version+1,extra.annotation_type,extra.subject_element_id,
          extra.related_element_ids,extra.reason_code,basis.rationale,extra.id,operation.id,fixture.actor.id,
          SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONTRACT_V1,basisDigest,inputDigest,
          JSON.stringify(authority),authorityDigest,predecessorState,poststateDigest]);
      }
    }
    await client.query(`INSERT INTO signal_semantic_context_events(workspace_id,generation_id,element_id,
      operation_id,event_index,event_kind,previous_state_digest,next_state_digest,actor_user_id)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,0,'review_annotation_resolved',$5,$6,$7::uuid)`,
    [fixture.workspace.id,current.generation_id,current.subject_element_id,operation.id,predecessorState,
      poststateDigest,fixture.actor.id]);
    await client.query(`UPDATE signal_governance_control_operations SET status='completed',result=$2::jsonb,
      completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid`,[operation.id,
      JSON.stringify({annotation_key:annotationKey,annotation_version:successorState.annotation_version,
        state:"resolved",resolution:"context_sufficient",resolution_basis:"complete"})]);
    await client.query("COMMIT");
    return{committed:true as const};
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();}
}

type DirectDecisionBasis={contract_version:"signal-semantic-context-decision-v2";reason:string;rationale:string};
type DirectDecisionGraphSpec={
  operationAction:"decide-semantic-context-element"|"bulk-approve-semantic-context-elements";
  operationInput:Record<string,unknown>;
  successors:Array<{predecessorKey:string;disposition?:"approved"|"rejected";basis?:DirectDecisionBasis}>;
  mutation?:{
    storedDraftDigest?:string;
    eventPreviousDigest?:string;
    eventNextDigest?:string;
    resultDraftDigestRef?:string;
    repeatStoredDigestInResultAndBulkEvent?:boolean;
    resultElementVersionAsString?:boolean;
    resultApprovedAsString?:boolean;
  };
};

async function directDraftDigest(queryable:SignalBrandPolicyQueryable,generationId:string){
  const rows=await queryable.query<{element_key:string;element_version:number;element_digest:string;
    disposition:string}>(`SELECT element_key,element_version,element_digest,disposition
    FROM signal_semantic_context_element_versions element WHERE generation_id=$1::uuid
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor
        WHERE successor.supersedes_element_id=element.id)
    ORDER BY convert_to(element_key,'UTF8')`,[generationId]);
  return digestCanonicalJsonV2({contract_version:"signal-semantic-context-draft-v2",elements:rows.rows});
}

async function directDecisionState(workspaceId:string,generationKey:string){
  const generation=(await pool.query<{id:string;draft_digest:string}>(`SELECT id::text,draft_digest
    FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid AND generation_key=$2`,
  [workspaceId,generationKey])).rows[0]!;
  const counts=(await pool.query<{operations:number;elements:number;events:number;artifacts:number;
    evidence_groups:number;evidence_links:number}>(`SELECT
      (SELECT count(*)::int FROM signal_governance_control_operations WHERE workspace_id=$1::uuid) operations,
      (SELECT count(*)::int FROM signal_semantic_context_element_versions WHERE workspace_id=$1::uuid) elements,
      (SELECT count(*)::int FROM signal_semantic_context_events WHERE workspace_id=$1::uuid) events,
      (SELECT count(*)::int FROM analysis_artifacts WHERE workspace_id=$1::uuid) artifacts,
      (SELECT count(*)::int FROM analysis_evidence_groups evidence_group JOIN analysis_artifacts artifact
        ON artifact.id=evidence_group.artifact_id WHERE artifact.workspace_id=$1::uuid) evidence_groups,
      (SELECT count(*)::int FROM analysis_evidence_links link JOIN analysis_evidence_groups evidence_group
        ON evidence_group.id=link.evidence_group_id JOIN analysis_artifacts artifact
        ON artifact.id=evidence_group.artifact_id WHERE artifact.workspace_id=$1::uuid) evidence_links`,
  [workspaceId])).rows[0]!;
  return{...counts,storedDigest:generation.draft_digest,recomputedDigest:await directDraftDigest(pool,generation.id)};
}

const shortDirectDigest=(value:string)=>`${value.slice(0,15)}…${value.slice(-8)}`;

type DirectLocaleGraphMutation={omitEvent?:boolean;extraEvent?:boolean;omitAnnotation?:boolean;
  extraAnnotation?:boolean;wrongEventPrevious?:boolean;wrongResultCount?:boolean;wrongStoredDraft?:boolean};

async function attemptDirectLocaleAuthorityGraph(fixture:Awaited<ReturnType<typeof seedFixture>>,
  generationKey:string,args:{inputKeys:string[];successorKeys:string[];disposition:"global"|"locale_specific";
    locale:string|null;mutation?:DirectLocaleGraphMutation}){
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const generation=(await client.query<{id:string;generation_key:string;brand_os_digest:string;
      knowledge_digest:string;locale_context_digest:string;proposal_provider_lineage:unknown;
      proposal_provider_lineage_digest:string}>(`SELECT id::text,generation_key,brand_os_digest,knowledge_digest,
      locale_context_digest,proposal_provider_lineage,proposal_provider_lineage_digest
      FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid AND generation_key=$2`,
    [fixture.workspace.id,generationKey])).rows[0]!;
    const keys=[...args.inputKeys].sort();const basis={contract_version:"signal-semantic-context-locale-decision-v1" as const,
      disposition:args.disposition,locale:args.locale,reason:"locale_resolution" as const,
      rationale:"Direct SQL control seals one explicit locale authority basis."};
    const input={...basis,generation_key:generationKey,element_keys:keys,
      confirmation:SIGNAL_SEMANTIC_CONTEXT_LOCALE_DECISION_CONFIRMATION_V1};
    const inputDigest=digestCanonicalJsonV2(input);
    const operation=(await client.query<{id:string}>(`INSERT INTO signal_governance_control_operations(
      workspace_id,actor_user_id,action,request_digest,idempotency_key,status,
      semantic_context_decision_input,semantic_context_decision_input_digest)
      VALUES($1::uuid,$2::uuid,'decide-semantic-context-locale-authority',$3,$4,'in_progress',$5::jsonb,$6)
      RETURNING id::text`,[fixture.workspace.id,fixture.actor.id,digest(`direct-locale-request:${randomUUID()}`),
      digest(`direct-locale-key:${randomUUID()}`),JSON.stringify(input),inputDigest])).rows[0]!;
    const authority={brand_os_digest:generation.brand_os_digest,knowledge_digest:generation.knowledge_digest,
      locale_context_digest:generation.locale_context_digest,
      proposal_provider_lineage:generation.proposal_provider_lineage,
      proposal_provider_lineage_digest:generation.proposal_provider_lineage_digest,
      actor:{id:fixture.actor.id.toLowerCase(),user_type:fixture.actor.userType,
        primary_role:fixture.actor.primaryRole}};
    const authorityDigest=digestCanonicalJsonV2(authority);const basisDigest=digestCanonicalJsonV2(basis);
    const created:Array<{id:string;key:string;previous:string;next:string}>=[];
    for(const key of args.successorKeys){
      const current=(await client.query<{id:string;artifact_id:string;evidence_group_id:string;element_key:string;
        element_version:number;element_kind:string;canonical_key:string;display_text:string;scope:string|null;
        entity_type:string|null;entity_id:string|null;relation_kind:string|null;relation_target_key:string|null;
        confidence:string|null;original_proposal_element_id:string|null;source_refs_digest:string;element_digest:string}>(
        `SELECT id::text,artifact_id::text,evidence_group_id::text,element_key,element_version,element_kind,
        canonical_key,display_text,scope,entity_type,entity_id::text,relation_kind,relation_target_key,confidence::text,
        original_proposal_element_id::text,source_refs_digest,element_digest
        FROM signal_semantic_context_element_versions element WHERE generation_id=$1::uuid AND element_key=$2
          AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor
            WHERE successor.supersedes_element_id=element.id) FOR UPDATE`,[generation.id,key])).rows[0]!;
      const definition={element_key:current.element_key,element_kind:current.element_kind,
        canonical_key:current.canonical_key,display_text:current.display_text,scope:current.scope,
        entity_type:current.entity_type,entity_id:current.entity_id,locale:args.locale,
        relation_kind:current.relation_kind,relation_target_key:current.relation_target_key};
      const elementDigest=signalSemanticContextLocaleDecisionElementDigestV1({definition,
        elementVersion:current.element_version+1,sourceRefsDigest:current.source_refs_digest,basis});
      const artifact=(await client.query<{id:string}>(`INSERT INTO analysis_artifacts(workspace_id,
        workspace_artifact_kind,workspace_authority_digest,artifact_key,artifact_type,content,confidence,
        review_status,revision,metadata) VALUES($1::uuid,'semantic_context',$2,$3,'semantic_context_element',
        $4::jsonb,$5,'needs_review',$6,$7::jsonb) RETURNING id::text`,[fixture.workspace.id,elementDigest,
        `direct-locale-${operation.id}-${key}`,JSON.stringify(definition),current.confidence,current.element_version+1,
        JSON.stringify({authority_only:true,confidence_authoritative:false,locale_decision_basis_digest:basisDigest})])).rows[0]!;
      const group=(await client.query<{id:string}>(`INSERT INTO analysis_evidence_groups(artifact_id,group_key,role,
        label,summary,position,metadata) VALUES($1::uuid,'source-authority','supporting','Source authority',NULL,0,
        jsonb_build_object('source_refs_digest',$2::text)) RETURNING id::text`,
      [artifact.id,current.source_refs_digest])).rows[0]!;
      await client.query(`INSERT INTO analysis_evidence_links(evidence_group_id,source_type,source_id,relation_type,
        evidence_role,quote,locator,position,metadata) SELECT $1::uuid,source_type,source_id,relation_type,
        evidence_role,quote,locator,position,metadata FROM analysis_evidence_links WHERE evidence_group_id=$2::uuid`,
      [group.id,current.evidence_group_id]);
      const successor=(await client.query<{id:string}>(`INSERT INTO signal_semantic_context_element_versions(
        workspace_id,generation_id,artifact_id,evidence_group_id,element_key,element_version,element_kind,canonical_key,
        display_text,scope,entity_type,entity_id,locale,relation_kind,relation_target_key,confidence,disposition,origin_kind,
        supersedes_element_id,original_proposal_element_id,source_refs_digest,element_digest,operation_id,proposed_by_user_id,
        locale_decision_contract_version,locale_decision_disposition,locale_decision_locale,locale_decision_reason_code,
        locale_decision_rationale,locale_decision_basis_digest,locale_decision_input_digest,
        locale_decision_authority_snapshot,locale_decision_authority_digest,
        locale_decision_prestate_digest,locale_decision_poststate_digest)
        VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12::uuid,$13,$14,$15,$16,
        'pending','operator_correction',$17::uuid,$18::uuid,$19,$20,$21::uuid,$22::uuid,$23,$24,$25,$26,$27,$28,
        $29,$30::jsonb,$31,$32,$33) RETURNING id::text`,[fixture.workspace.id,generation.id,artifact.id,group.id,
        current.element_key,current.element_version+1,current.element_kind,current.canonical_key,current.display_text,
        current.scope,current.entity_type,current.entity_id,args.locale,current.relation_kind,current.relation_target_key,
        current.confidence,current.id,current.original_proposal_element_id??current.id,current.source_refs_digest,
        elementDigest,operation.id,fixture.actor.id,basis.contract_version,basis.disposition,basis.locale,basis.reason,
        basis.rationale,basisDigest,inputDigest,JSON.stringify(authority),authorityDigest,current.element_digest,
        elementDigest])).rows[0]!;
      created.push({id:successor.id,key,previous:current.element_digest,next:elementDigest});
      if(args.disposition==="global"&&!args.mutation?.omitAnnotation){
        const annotationKey=`locale-authority.${createHash("sha256").update(key).digest("hex")}`;
        const resolutionBasis={contract_version:SIGNAL_SEMANTIC_CONTEXT_ANNOTATION_RESOLUTION_CONTRACT_V1,
          annotation_type:"locale_unresolved" as const,resolution:"global" as const,
          reason:basis.reason,rationale:basis.rationale};
        const annotationState={annotation_key:annotationKey,annotation_version:1,
          annotation_type:"locale_unresolved" as const,state:"resolved" as const,resolution:"global" as const,
          subject_element_id:successor.id,related_element_ids:[],reason_code:basis.reason,rationale:basis.rationale,
          resolution_contract_version:resolutionBasis.contract_version,
          resolution_basis_digest:digestCanonicalJsonV2(resolutionBasis),resolution_input_digest:inputDigest,
          resolution_authority_digest:authorityDigest};
        await client.query(`INSERT INTO signal_semantic_context_review_annotations(workspace_id,generation_id,
          annotation_key,annotation_version,annotation_type,state,resolution,subject_element_id,related_element_ids,
          reason_code,rationale,operation_id,actor_user_id,resolution_contract_version,resolution_basis_digest,
          resolution_input_digest,resolution_authority_snapshot,resolution_authority_digest,
          resolution_prestate_digest,resolution_poststate_digest)
          VALUES($1::uuid,$2::uuid,$3,1,'locale_unresolved','resolved','global',$4::uuid,'{}'::uuid[],$5,$6,
          $7::uuid,$8::uuid,$9,$10,$11,$12::jsonb,$13,$14,$15)`,[fixture.workspace.id,generation.id,annotationKey,
          successor.id,basis.reason,basis.rationale,operation.id,fixture.actor.id,resolutionBasis.contract_version,
          digestCanonicalJsonV2(resolutionBasis),inputDigest,JSON.stringify(authority),authorityDigest,
          digestCanonicalJsonV2({contract_version:"signal-semantic-context-annotation-absent-v1",annotation_key:annotationKey}),
          signalSemanticContextAnnotationStateDigestV1(annotationState)]);
      }
    }
    if(args.mutation?.extraAnnotation&&created[0]){
      await client.query(`INSERT INTO signal_semantic_context_review_annotations(workspace_id,generation_id,
        annotation_key,annotation_version,annotation_type,state,resolution,subject_element_id,related_element_ids,
        reason_code,rationale,operation_id,actor_user_id) VALUES($1::uuid,$2::uuid,'locale-authority.extra',1,
        'locale_unresolved','open',NULL,$3::uuid,'{}'::uuid[],'locale_resolution','Extra annotation.',$4::uuid,$5::uuid)`,
      [fixture.workspace.id,generation.id,created[0].id,operation.id,fixture.actor.id]);
    }
    for(const [index,entry] of created.entries())if(!args.mutation?.omitEvent){
      await client.query(`INSERT INTO signal_semantic_context_events(workspace_id,generation_id,element_id,operation_id,
        event_index,event_kind,previous_state_digest,next_state_digest,actor_user_id)
        VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'locale_authority_decided',$6,$7,$8::uuid)`,
      [fixture.workspace.id,generation.id,entry.id,operation.id,index,
        args.mutation?.wrongEventPrevious?digest("wrong-locale-prestate"):entry.previous,entry.next,fixture.actor.id]);
    }
    if(args.mutation?.extraEvent&&created[0])await client.query(`INSERT INTO signal_semantic_context_events(
      workspace_id,generation_id,element_id,operation_id,event_index,event_kind,previous_state_digest,
      next_state_digest,actor_user_id) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,99,
      'locale_authority_decided',$5,$6,$7::uuid)`,[fixture.workspace.id,generation.id,created[0].id,operation.id,
      created[0].previous,created[0].next,fixture.actor.id]);
    const postDigest=await directDraftDigest(client,generation.id);
    const storedDigest=args.mutation?.wrongStoredDraft?digest("wrong-locale-draft"):postDigest;
    await client.query(`UPDATE signal_semantic_context_generations SET draft_digest=$2 WHERE id=$1::uuid`,
    [generation.id,storedDigest]);
    const result={generation_key:generationKey,decided:args.mutation?.wrongResultCount?created.length+1:created.length,
      disposition:args.disposition,locale:args.locale,pending:created.length,draft_digest_ref:shortDirectDigest(postDigest)};
    await client.query(`UPDATE signal_governance_control_operations SET status='completed',result=$2::jsonb,
      completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid`,[operation.id,JSON.stringify(result)]);
    await client.query("COMMIT");return{committed:true as const};
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();}
}

async function attemptDirectDecisionGraph(
  fixture:Awaited<ReturnType<typeof seedFixture>>,generationKey:string,spec:DirectDecisionGraphSpec){
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const generation=(await client.query<{id:string;draft_digest:string}>(`SELECT id::text,draft_digest
      FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid AND generation_key=$2`,
    [fixture.workspace.id,generationKey])).rows[0]!;
    const preDraftDigest=await directDraftDigest(client,generation.id);
    const defaultBasis:DirectDecisionBasis={contract_version:"signal-semantic-context-decision-v2",reason:"alias_or_variant",
      rationale:"The same explicit basis applies to every selected fixture alias."};
    const operation=(await client.query<{id:string}>(`INSERT INTO signal_governance_control_operations(
      workspace_id,actor_user_id,action,request_digest,idempotency_key,status,
      semantic_context_decision_input,semantic_context_decision_input_digest)
      VALUES($1::uuid,$2::uuid,$3,$4,$5,'in_progress',$6::jsonb,
        signal_semantic_context_digest_json_v2($6::jsonb))
      RETURNING id::text`,[fixture.workspace.id,fixture.actor.id,spec.operationAction,
      digest(`direct-decision-request:${randomUUID()}`),digest(`direct-decision-key:${randomUUID()}`),
      JSON.stringify(spec.operationInput)])).rows[0]!;
    const inserted:Array<{id:string;elementKey:string;version:number;disposition:"approved"|"rejected";
      previousDigest:string;nextDigest:string}>=[];
    for(const successorSpec of spec.successors){
      const basis=successorSpec.basis??defaultBasis;
      const disposition=successorSpec.disposition??"approved";
      const current=(await client.query<{id:string;artifact_id:string;evidence_group_id:string;
        element_key:string;element_version:number;element_kind:string;canonical_key:string;display_text:string;
        scope:string|null;entity_type:string|null;entity_id:string|null;locale:string|null;
        relation_kind:string|null;relation_target_key:string|null;confidence:string|null;
        original_proposal_element_id:string|null;source_refs_digest:string;element_digest:string}>(`
        SELECT id::text,artifact_id::text,evidence_group_id::text,element_key,element_version,element_kind,
          canonical_key,display_text,scope,entity_type,entity_id::text,locale,relation_kind,
          relation_target_key,confidence::text,original_proposal_element_id::text,source_refs_digest,element_digest
        FROM signal_semantic_context_element_versions element
        WHERE generation_id=$1::uuid AND element_key=$2 AND NOT EXISTS(
          SELECT 1 FROM signal_semantic_context_element_versions successor
          WHERE successor.supersedes_element_id=element.id) FOR UPDATE`,
      [generation.id,successorSpec.predecessorKey])).rows[0]!;
      const digests=(await client.query<{basis_digest:string;element_digest:string}>(`SELECT
        signal_semantic_context_digest_json_v2($1::jsonb) basis_digest,
        signal_semantic_context_digest_json_v2(jsonb_build_object(
          'contract_version','signal-semantic-context-element-v3','element_key',$2::text,
          'element_kind',$3::text,'canonical_key',$4::text,'display_text',$5::text,'scope',$6::text,
          'entity_type',$7::text,'entity_id',lower($8::text),'locale',$9::text,
          'relation_kind',$10::text,'relation_target_key',$11::text,'element_version',$12::int,
          'disposition',$14::text,'source_refs_digest',$13::text,'decision_basis',$1::jsonb)) element_digest`,
      [JSON.stringify(basis),current.element_key,current.element_kind,current.canonical_key,current.display_text,
        current.scope,current.entity_type,current.entity_id,current.locale,current.relation_kind,
        current.relation_target_key,current.element_version+1,current.source_refs_digest,disposition])).rows[0]!;
      const artifact=(await client.query<{id:string}>(`INSERT INTO analysis_artifacts(workspace_id,
        workspace_artifact_kind,workspace_authority_digest,artifact_key,artifact_type,content,confidence,
        review_status,revision,metadata) VALUES($1::uuid,'semantic_context',$2,$3,
        'semantic_context_element','{}'::jsonb,$4,'accepted',$5,
        '{"authority_only":true,"confidence_authoritative":false}'::jsonb) RETURNING id::text`,
      [fixture.workspace.id,digests.element_digest,`direct-${operation.id}-${current.element_key}`,
        current.confidence,current.element_version+1])).rows[0]!;
      const group=(await client.query<{id:string}>(`INSERT INTO analysis_evidence_groups(artifact_id,
        group_key,role,label,summary,position,metadata) VALUES($1::uuid,'source-authority','supporting',
        'Source authority',NULL,0,jsonb_build_object('source_refs_digest',$2::text)) RETURNING id::text`,
      [artifact.id,current.source_refs_digest])).rows[0]!;
      await client.query(`INSERT INTO analysis_evidence_links(evidence_group_id,source_type,source_id,
        relation_type,evidence_role,quote,locator,position,metadata)
        SELECT $1::uuid,source_type,source_id,relation_type,evidence_role,quote,locator,position,metadata
        FROM analysis_evidence_links WHERE evidence_group_id=$2::uuid`,[group.id,current.evidence_group_id]);
      const successor=(await client.query<{id:string}>(`INSERT INTO signal_semantic_context_element_versions(workspace_id,generation_id,
        artifact_id,evidence_group_id,element_key,element_version,element_kind,canonical_key,display_text,
        scope,entity_type,entity_id,locale,relation_kind,relation_target_key,confidence,disposition,origin_kind,
        supersedes_element_id,original_proposal_element_id,source_refs_digest,element_digest,operation_id,
        proposed_by_user_id,decided_by_user_id,decided_at,decision_contract_version,decision_reason_code,
        decision_rationale,decision_basis_digest) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,
        $10,$11,$12::uuid,$13,$14,$15,$16,$17,'operator_decision',$18::uuid,$19::uuid,$20,$21,
        $22::uuid,$23::uuid,$23::uuid,clock_timestamp(),$24,$25,$26,$27) RETURNING id::text`,[fixture.workspace.id,
        generation.id,artifact.id,group.id,current.element_key,current.element_version+1,current.element_kind,
        current.canonical_key,current.display_text,current.scope,current.entity_type,current.entity_id,current.locale,
        current.relation_kind,current.relation_target_key,current.confidence,disposition,current.id,
        current.original_proposal_element_id??current.id,current.source_refs_digest,digests.element_digest,
        operation.id,fixture.actor.id,basis.contract_version,basis.reason,basis.rationale,digests.basis_digest])).rows[0]!;
      inserted.push({id:successor.id,elementKey:current.element_key,version:current.element_version+1,
        disposition,previousDigest:current.element_digest,nextDigest:digests.element_digest});
    }
    const first=inserted[0]!;
    const isBulk=spec.operationAction==="bulk-approve-semantic-context-elements";
    const singleAction=String(spec.operationInput.action??"approve");
    const postDraftDigest=await directDraftDigest(client,generation.id);
    const storedDraftDigest=spec.mutation?.storedDraftDigest??postDraftDigest;
    await client.query(`UPDATE signal_semantic_context_generations SET draft_digest=$2
      WHERE id=$1::uuid`,[generation.id,storedDraftDigest]);
    const repeatStored=spec.mutation?.repeatStoredDigestInResultAndBulkEvent===true;
    await client.query(`INSERT INTO signal_semantic_context_events(workspace_id,generation_id,element_id,
      operation_id,event_index,event_kind,previous_state_digest,next_state_digest,actor_user_id)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,0,$5,$6,$7,$8::uuid)`,
    [fixture.workspace.id,generation.id,isBulk?null:first.id,operation.id,
      isBulk?"elements_bulk_approved":singleAction==="reject"?"element_rejected":"element_approved",
      isBulk?(spec.mutation?.eventPreviousDigest??preDraftDigest):first.previousDigest,
      isBulk?(spec.mutation?.eventNextDigest??(repeatStored?storedDraftDigest:postDraftDigest)):first.nextDigest,
      fixture.actor.id]);
    const resultDigestRef=spec.mutation?.resultDraftDigestRef??shortDirectDigest(
      repeatStored?storedDraftDigest:postDraftDigest);
    const result=isBulk?{generation_key:generationKey,
      approved:spec.mutation?.resultApprovedAsString?String(inserted.length):inserted.length,
      draft_digest_ref:resultDigestRef}:{
      element_key:first.elementKey,
      element_version:spec.mutation?.resultElementVersionAsString?String(first.version):first.version,
      disposition:first.disposition,
      draft_digest_ref:resultDigestRef};
    await client.query(`UPDATE signal_governance_control_operations SET status='completed',result=$2::jsonb,
      completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid`,[operation.id,
      JSON.stringify(result)]);
    await client.query("COMMIT");
    return{committed:true as const,preDraftDigest,postDraftDigest};
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();}
}

async function seedHistoricalV1Publication(){
  const fixture=await seedFixture();
  const initial=await transaction((queryable)=>createSignalSemanticContextDraftV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"historical-v1-initial"}));
  const lineage=await fullLineageForDraft(fixture,initial.generation_key,terminalPreflightConfiguration);
  const draft=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"historical-v1-lineage",
    reason:"provider_lineage_missing",proposalLineage:lineage}));
  await transaction((queryable)=>appendSignalSemanticContextProposalsV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"historical-v1-proposal",
    generationKey:draft.generation_key,proposals:[proposal("historical-v1-element","identity_term",
      "historical-v1","Historical V1",0.5,fixture.profileId)]}));
  const operation=await pool.query<{id:string}>(`INSERT INTO signal_governance_control_operations(
    workspace_id,actor_user_id,action,request_digest,idempotency_key,status)
    VALUES($1::uuid,$2::uuid,'publish-semantic-context-generation',$3,$4,'in_progress') RETURNING id::text`,
  [fixture.workspace.id,fixture.actor.id,digest("historical-v1-publish-request"),
    digest("historical-v1-publish-key")]);
  await pool.query(`UPDATE signal_semantic_context_generations SET status='published',pack_digest=$3,
    published_operation_id=$4::uuid,published_by_user_id=$5::uuid,published_at=clock_timestamp()
    WHERE workspace_id=$1::uuid AND generation_key=$2`,[fixture.workspace.id,draft.generation_key,
    digest("historical-v1-pack"),operation.rows[0]!.id,fixture.actor.id]);
  await pool.query(`UPDATE signal_governance_control_operations SET status='completed',result=$2::jsonb,
    completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid`,
  [operation.rows[0]!.id,JSON.stringify({generation_key:draft.generation_key,lifecycle_state:"published"})]);
  return{workspaceId:fixture.workspace.id,generationKey:draft.generation_key};
}

async function seedHistoricalRationaleLessDraft(){
  const historicalKeys={initial:"historical-decision-initial",lineage:"historical-decision-lineage",
    proposal:"historical-decision-proposal"} as const;
  const fixture=await seedFixture();
  const initial=await transaction((queryable)=>createSignalSemanticContextDraftV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:historicalKeys.initial}));
  const lineage=await fullLineageForDraft(fixture,initial.generation_key,terminalPreflightConfiguration);
  const draft=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:historicalKeys.lineage,
    reason:"provider_lineage_missing",proposalLineage:lineage}));
  await transaction((queryable)=>appendSignalSemanticContextProposalsV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:historicalKeys.proposal,
    generationKey:draft.generation_key,proposals:[proposal("historical-rationaleless","identity_term",
      "historical-rationaleless","Historical rationale-less decision",0.5,fixture.profileId)]}));
  const current=(await pool.query<{id:string;generation_id:string;artifact_id:string;evidence_group_id:string;
    element_key:string;element_version:number;element_kind:string;canonical_key:string;display_text:string;
    scope:string|null;entity_type:string|null;entity_id:string|null;locale:string|null;relation_kind:string|null;
    relation_target_key:string|null;confidence:string|null;original_proposal_element_id:string|null;
    source_refs_digest:string}>(`SELECT id::text,generation_id::text,artifact_id::text,evidence_group_id::text,
      element_key,element_version,element_kind,canonical_key,display_text,scope,entity_type,entity_id::text,
      locale,relation_kind,relation_target_key,confidence::text,original_proposal_element_id::text,source_refs_digest
    FROM signal_semantic_context_element_versions element WHERE workspace_id=$1::uuid AND element_key=$2
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor
        WHERE successor.supersedes_element_id=element.id)`,[fixture.workspace.id,"historical-rationaleless"])).rows[0]!;
  const elementDigest=digest("historical-rationaleless-approved");
  const operation=(await pool.query<{id:string}>(`INSERT INTO signal_governance_control_operations(
    workspace_id,actor_user_id,action,request_digest,idempotency_key,status)
    VALUES($1::uuid,$2::uuid,'decide-semantic-context-element',$3,$4,'in_progress') RETURNING id::text`,
  [fixture.workspace.id,fixture.actor.id,digest("historical-decision-request"),digest("historical-decision-key")])).rows[0]!;
  const artifact=(await pool.query<{id:string}>(`INSERT INTO analysis_artifacts(workspace_id,
    workspace_artifact_kind,workspace_authority_digest,artifact_key,artifact_type,content,confidence,
    review_status,revision,metadata) VALUES($1::uuid,'semantic_context',$2,$3,'semantic_context_element',
    $4::jsonb,$5,'accepted',2,'{"authority_only":true,"confidence_authoritative":false}'::jsonb)
    RETURNING id::text`,[fixture.workspace.id,elementDigest,current.element_key,JSON.stringify({
      element_kind:current.element_kind,canonical_key:current.canonical_key,display_text:current.display_text,
      scope:current.scope,locale:current.locale,relation_kind:current.relation_kind,
      relation_target_key:current.relation_target_key}),current.confidence])).rows[0]!;
  const group=(await pool.query<{id:string}>(`INSERT INTO analysis_evidence_groups(artifact_id,group_key,role,
    label,summary,position,metadata) VALUES($1::uuid,'source-authority','supporting','Source authority',NULL,0,
    jsonb_build_object('source_refs_digest',$2::text)) RETURNING id::text`,
  [artifact.id,current.source_refs_digest])).rows[0]!;
  await pool.query(`INSERT INTO analysis_evidence_links(evidence_group_id,source_type,source_id,relation_type,
    evidence_role,quote,locator,position,metadata) SELECT $1::uuid,source_type,source_id,relation_type,
    evidence_role,quote,locator,position,metadata FROM analysis_evidence_links WHERE evidence_group_id=$2::uuid`,
  [group.id,current.evidence_group_id]);
  const successor=(await pool.query<{id:string}>(`INSERT INTO signal_semantic_context_element_versions(
    workspace_id,generation_id,artifact_id,evidence_group_id,element_key,element_version,element_kind,canonical_key,
    display_text,scope,entity_type,entity_id,locale,relation_kind,relation_target_key,confidence,disposition,origin_kind,
    supersedes_element_id,original_proposal_element_id,source_refs_digest,element_digest,operation_id,proposed_by_user_id,
    decided_by_user_id,decided_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12::uuid,
    $13,$14,$15,$16,'approved','operator_decision',$17::uuid,$18::uuid,$19,$20,$21::uuid,$22::uuid,$22::uuid,
    clock_timestamp()) RETURNING id::text`,[fixture.workspace.id,current.generation_id,artifact.id,group.id,
    current.element_key,current.element_version+1,current.element_kind,current.canonical_key,current.display_text,
    current.scope,current.entity_type,current.entity_id,current.locale,current.relation_kind,current.relation_target_key,
    current.confidence,current.id,current.original_proposal_element_id??current.id,current.source_refs_digest,
    elementDigest,operation.id,fixture.actor.id])).rows[0]!;
  await pool.query(`INSERT INTO signal_semantic_context_events(workspace_id,generation_id,element_id,operation_id,
    event_index,event_kind,previous_state_digest,next_state_digest,actor_user_id)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,0,'element_approved',$5,$6,$7::uuid)`,
  [fixture.workspace.id,current.generation_id,successor.id,operation.id,digest("historical-pending"),elementDigest,
    fixture.actor.id]);
  await pool.query(`UPDATE signal_governance_control_operations SET status='completed',result=$2::jsonb,
    completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid`,[operation.id,
    JSON.stringify({element_key:current.element_key,element_version:2,disposition:"approved"})]);
  return{workspace:fixture.workspace,actor:fixture.actor,generationKey:draft.generation_key,
    generationId:current.generation_id};
}

async function seedHistoricalResolvedAnnotationWithoutBasis(fixture:Awaited<ReturnType<typeof seedHistoricalRationaleLessDraft>>){
  const annotationKey="historical-resolution-without-basis";
  const subject=(await pool.query<{id:string}>(`SELECT id::text FROM signal_semantic_context_element_versions element
    WHERE generation_id=$1::uuid AND element_key='historical-rationaleless' AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_element_versions successor WHERE successor.supersedes_element_id=element.id)`,
  [fixture.generationId])).rows[0]!;
  const openOperation=(await pool.query<{id:string}>(`INSERT INTO signal_governance_control_operations(
    workspace_id,actor_user_id,action,request_digest,idempotency_key,status)
    VALUES($1::uuid,$2::uuid,'annotate-semantic-context-element',$3,$4,'in_progress') RETURNING id::text`,
  [fixture.workspace.id,fixture.actor.id,digest("historical-annotation-open-request"),
    digest("historical-annotation-open-key")])).rows[0]!;
  const opened=(await pool.query<{id:string}>(`INSERT INTO signal_semantic_context_review_annotations(
    workspace_id,generation_id,annotation_key,annotation_version,annotation_type,state,resolution,
    subject_element_id,related_element_ids,reason_code,rationale,supersedes_annotation_id,operation_id,actor_user_id)
    VALUES($1::uuid,$2::uuid,$3,1,'uncertain','open',NULL,$4::uuid,'{}'::uuid[],
      'insufficient_context','Historical observation rationale.',NULL,$5::uuid,$6::uuid) RETURNING id::text`,
  [fixture.workspace.id,fixture.generationId,annotationKey,subject.id,openOperation.id,fixture.actor.id])).rows[0]!;
  await pool.query(`INSERT INTO signal_semantic_context_events(workspace_id,generation_id,element_id,operation_id,
    event_index,event_kind,previous_state_digest,next_state_digest,actor_user_id)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,0,'review_annotation_created',NULL,$5,$6::uuid)`,
  [fixture.workspace.id,fixture.generationId,subject.id,openOperation.id,digest("historical-annotation-open-state"),
    fixture.actor.id]);
  await pool.query(`UPDATE signal_governance_control_operations SET status='completed',result=$2::jsonb,
    completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid`,[openOperation.id,
    JSON.stringify({annotation_key:annotationKey,annotation_version:1,state:"open",resolution:null})]);
  const resolveOperation=(await pool.query<{id:string}>(`INSERT INTO signal_governance_control_operations(
    workspace_id,actor_user_id,action,request_digest,idempotency_key,status)
    VALUES($1::uuid,$2::uuid,'annotate-semantic-context-element',$3,$4,'in_progress') RETURNING id::text`,
  [fixture.workspace.id,fixture.actor.id,digest("historical-annotation-resolve-request"),
    digest("historical-annotation-resolve-key")])).rows[0]!;
  const resolved=(await pool.query<{id:string}>(`INSERT INTO signal_semantic_context_review_annotations(
    workspace_id,generation_id,annotation_key,annotation_version,annotation_type,state,resolution,
    subject_element_id,related_element_ids,reason_code,rationale,supersedes_annotation_id,operation_id,actor_user_id)
    VALUES($1::uuid,$2::uuid,$3,2,'uncertain','resolved','not_supported',$4::uuid,'{}'::uuid[],
      'insufficient_context','Historical observation rationale.',$5::uuid,$6::uuid,$7::uuid) RETURNING id::text`,
  [fixture.workspace.id,fixture.generationId,annotationKey,subject.id,opened.id,resolveOperation.id,fixture.actor.id])).rows[0]!;
  await pool.query(`INSERT INTO signal_semantic_context_events(workspace_id,generation_id,element_id,operation_id,
    event_index,event_kind,previous_state_digest,next_state_digest,actor_user_id)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,0,'review_annotation_resolved',$5,$6,$7::uuid)`,
  [fixture.workspace.id,fixture.generationId,subject.id,resolveOperation.id,
    digest("historical-annotation-open-state"),digest("historical-annotation-resolved-state"),fixture.actor.id]);
  await pool.query(`UPDATE signal_governance_control_operations SET status='completed',result=$2::jsonb,
    completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid`,[resolveOperation.id,
    JSON.stringify({annotation_key:annotationKey,annotation_version:2,state:"resolved",resolution:"not_supported"})]);
  return{annotationKey,resolvedId:resolved.id};
}

function installProviderEnvironment(configuration:SignalSemanticContextProposalRuntimeConfigurationV1,
  overrides:Record<string,string>={}){
  const values:Record<string,string>={
    NOISIA_SEMANTIC_CONTEXT_MODEL:configuration.model,
    NOISIA_SEMANTIC_CONTEXT_MODEL_VERSION:configuration.model_version,
    NOISIA_SEMANTIC_CONTEXT_PRICING_VERSION:configuration.pricing_version,
    NOISIA_SEMANTIC_CONTEXT_MAX_INPUT_TOKENS:String(configuration.max_input_tokens),
    NOISIA_SEMANTIC_CONTEXT_MAX_OUTPUT_TOKENS:String(configuration.max_output_tokens),
    NOISIA_SEMANTIC_CONTEXT_INPUT_USD_PER_MILLION_TOKENS:
      configuration.input_usd_per_million_tokens,
    NOISIA_SEMANTIC_CONTEXT_OUTPUT_USD_PER_MILLION_TOKENS:
      configuration.output_usd_per_million_tokens,
    NOISIA_SEMANTIC_CONTEXT_HARD_CAP_MICRO_USD:
      configuration.platform_hard_cap_micro_usd.toString(),
    ...overrides
  };
  const previous=new Map(Object.keys(values).map((key)=>[key,process.env[key]]));
  Object.assign(process.env,values);
  return()=>{for(const[key,value]of previous){if(value===undefined)delete process.env[key];
    else process.env[key]=value;}};
}

async function withProductProviderEnvironment<T>(run:()=>Promise<T>,overrides:Record<string,string>={}){
  const restore=installProviderEnvironment(productLineageConfiguration,overrides);
  try{return await run();}finally{restore();}
}

async function generationProviderLineage(workspaceId:string,generationKey:string){
  return pool.query<{lineage:SignalSemanticContextProviderLineageV1}>(`
    SELECT proposal_provider_lineage lineage FROM signal_semantic_context_generations
    WHERE workspace_id=$1::uuid AND generation_key=$2`,[workspaceId,generationKey])
    .then((result)=>result.rows[0]!.lineage);
}

async function fullLineageForDraft(fixture:Awaited<ReturnType<typeof seedFixture>>,
  generationKey:string,configuration:SignalSemanticContextProposalRuntimeConfigurationV1){
  const prepared=await prepareSignalSemanticContextProposalInputV1({queryable:pool,
    workspace:{id:fixture.workspace.id,organization_id:fixture.workspace.organizationId,
      brand_id:fixture.workspace.subject.id},generation_key:generationKey});
  return buildSignalSemanticContextProposalRuntimeLineageV1(configuration,prepared.capacity);
}

function proposal(elementKey:string,kind:"identity_term"|"alias"|"product"|"need"|"friction"|"locale_variant",
  canonicalKey:string,displayText:string,confidence:number,sourceId:string){
  const sourceType=kind==="identity_term"||kind==="alias"||kind==="locale_variant"?"brand_os_profile":kind==="product"?"brand_os_product":
    kind==="need"?"knowledge_chunk":"knowledge_source";
  return{element_key:elementKey,element_kind:kind,canonical_key:canonicalKey,display_text:displayText,
    scope:"primary_brand",entity_type:null,entity_id:null,locale:"es-MX",relation_kind:null,
    relation_target_key:null,confidence,origin_kind:"server_projection" as const,
    source_refs:[{source_type:sourceType as "brand_os_profile"|"brand_os_product"|"knowledge_chunk"|"knowledge_source",
      source_id:sourceId,relation_type:"supports" as const}]};
}

async function seedQueuedProposalRun(fixture:Awaited<ReturnType<typeof seedFixture>>,
  generationKey:string,lineage:SignalSemanticContextProviderLineageV1){
  const generation=await pool.query<{id:string;brand_os_digest:string;knowledge_digest:string;
    locale_context_digest:string}>(`SELECT id::text,brand_os_digest,knowledge_digest,locale_context_digest
    FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid AND generation_key=$2`,
  [fixture.workspace.id,generationKey]);
  const operation=await pool.query<{id:string}>(`INSERT INTO signal_governance_control_operations(
    workspace_id,actor_user_id,action,request_digest,idempotency_key,status)
    VALUES($1::uuid,$2::uuid,'start-semantic-context-proposal-run',$3,$4,'in_progress')
    RETURNING id::text`,[fixture.workspace.id,fixture.actor.id,digest("queued-run-request"),
    digest("queued-run-key")]);
  const row=generation.rows[0]!;
  await pool.query(`INSERT INTO signal_semantic_context_proposal_runs(
    workspace_id,generation_id,operation_id,run_key,status,preflight_digest,brand_os_digest,
    knowledge_digest,locale_context_digest,prompt_digest,context_input_digest,provider,model,
    model_version,pricing_version,max_input_tokens,max_output_tokens,input_usd_per_million_tokens,
    output_usd_per_million_tokens,hard_cap_micro_usd,reservation_micro_usd,
    provider_lineage_digest,provider_request_identity,created_by_user_id)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4,'queued',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
      $15,$16,$17,$18,$19,$20,$21,$22,$23::uuid)`,[fixture.workspace.id,row.id,operation.rows[0]!.id,
    `semantic-context-proposal-${randomUUID().replaceAll("-","").slice(0,16)}`,digest("preflight"),
    row.brand_os_digest,row.knowledge_digest,row.locale_context_digest,lineage.prompt.digest,
    digest("context-input"),lineage.provider,lineage.model,lineage.model_version,lineage.pricing.version,
    lineage.token_ceilings.max_input_tokens,lineage.capacity.output_token_budget,
    lineage.pricing.input_usd_per_million_tokens,lineage.pricing.output_usd_per_million_tokens,
    lineage.platform_hard_cap_micro_usd,"2000",lineage.lineage_digest,
    digest("provider-request"),fixture.actor.id]);
}

async function seedTerminalProposalRun(fixture:Awaited<ReturnType<typeof seedFixture>>,
  generationKey:string,lineage:SignalSemanticContextProviderLineageV1,
  mode:"safe_failed"|"ambiguous_dead_letter"){
  const generation=await pool.query<{id:string;brand_os_digest:string;knowledge_digest:string;
    locale_context_digest:string}>(`SELECT id::text,brand_os_digest,knowledge_digest,locale_context_digest
    FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid AND generation_key=$2`,
  [fixture.workspace.id,generationKey]);
  const operation=await pool.query<{id:string}>(`INSERT INTO signal_governance_control_operations(
    workspace_id,actor_user_id,action,request_digest,idempotency_key,status)
    VALUES($1::uuid,$2::uuid,'start-semantic-context-proposal-run',$3,$4,'in_progress')
    RETURNING id::text`,[fixture.workspace.id,fixture.actor.id,digest(`terminal-run-request-${randomUUID()}`),
    digest(`terminal-run-key-${randomUUID()}`)]);
  const row=generation.rows[0]!;const runId=randomUUID();
  const safe=mode==="safe_failed";const response=safe?JSON.stringify({fixture:"closed-response"}):null;
  await pool.query(`INSERT INTO signal_semantic_context_proposal_runs(
    id,workspace_id,generation_id,operation_id,run_key,status,preflight_digest,brand_os_digest,
    knowledge_digest,locale_context_digest,prompt_digest,context_input_digest,provider,model,
    model_version,pricing_version,max_input_tokens,max_output_tokens,input_usd_per_million_tokens,
    output_usd_per_million_tokens,hard_cap_micro_usd,reservation_micro_usd,
    provider_lineage_digest,provider_request_identity,provider_call_state,provider_call_count,provider_response_private,
    provider_response_digest,input_tokens,output_tokens,settled_micro_usd,error_code,error_summary,
    failed_at,dead_lettered_at,created_by_user_id)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
      $17,$18,$19,$20,$21,2000,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35::uuid)`,[
    runId,fixture.workspace.id,row.id,operation.rows[0]!.id,
    `semantic-context-proposal-${randomUUID().replaceAll("-","").slice(0,16)}`,
    safe?"failed":"dead_letter",digest("terminal-preflight"),row.brand_os_digest,
    row.knowledge_digest,row.locale_context_digest,lineage.prompt.digest,digest("terminal-context"),
    lineage.provider,lineage.model,lineage.model_version,lineage.pricing.version,
    lineage.token_ceilings.max_input_tokens,lineage.capacity.output_token_budget,
    lineage.pricing.input_usd_per_million_tokens,lineage.pricing.output_usd_per_million_tokens,
    lineage.platform_hard_cap_micro_usd,lineage.lineage_digest,digest("terminal-provider-request"),
    safe?"settled":"outcome_unknown",1,response,response?digest(response):null,
    safe?10:null,safe?10:null,safe?100:null,
    safe?"semantic_context_provider_response_schema_invalid":"provider_outcome_ambiguous",
    "sanitized fixture",safe?new Date():null,safe?null:new Date(),fixture.actor.id]);
  if(safe){
    await pool.query(`INSERT INTO signal_semantic_context_budget_reservations(
      workspace_id,run_id,status,reservation_micro_usd,reserved_input_tokens,reserved_output_tokens,
      input_tokens,output_tokens,actual_micro_usd,reservation_digest,settled_at)
      VALUES($1::uuid,$2::uuid,'settled',2000,1000,500,10,10,100,$3,clock_timestamp())`,
    [fixture.workspace.id,runId,digest("terminal-reservation")]);
    await pool.query(`INSERT INTO signal_semantic_context_proposal_outbox(
      workspace_id,run_id,status,worker_job_id,attempt_count,dead_lettered_at)
      VALUES($1::uuid,$2::uuid,'dead_letter',$3,1,clock_timestamp())`,
    [fixture.workspace.id,runId,`terminal-fixture-${runId}`]);
  }
  return{id:runId,generationId:row.id};
}

async function seedFixture(){const suffix=randomUUID().slice(0,8);const orgId=randomUUID(),otherOrgId=randomUUID();
  const brandId=randomUUID(),otherBrandId=randomUUID(),userId=randomUUID();
  await pool.query(`INSERT INTO organizations(id,slug,legal_name,display_name,status) VALUES
    ($1::uuid,$2,$3,$3,'active'),($4::uuid,$5,$6,$6,'active')`,[orgId,`context-${suffix}`,
    `Context ${suffix}`,otherOrgId,`other-${suffix}`,`Other ${suffix}`]);
  await pool.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,status)
    VALUES($1::uuid,$2,$3,'noisia_internal','noisia_admin','active')`,[userId,`context-${suffix}@example.test`,
    `Context operator ${suffix}`]);
  await pool.query(`INSERT INTO brands(id,organization_id,slug,name,display_name,countries,status) VALUES
    ($1::uuid,$2::uuid,$3,$4,$4,ARRAY['MX']::char(2)[],'active'),
    ($5::uuid,$6::uuid,$7,$8,$8,ARRAY['US']::char(2)[],'active')`,[brandId,orgId,`brand-${suffix}`,
    `Brand ${suffix}`,otherBrandId,otherOrgId,`other-brand-${suffix}`,`Other brand ${suffix}`]);
  const workspaces=await pool.query<{id:string;brand_id:string;slug:string;timezone:string}>(`
    SELECT id::text,brand_id::text,slug,timezone FROM signal_workspaces WHERE brand_id=ANY($1::uuid[])`,
  [[brandId,otherBrandId]]);const workspaceRow=workspaces.rows.find((row)=>row.brand_id===brandId)!;
  const otherRow=workspaces.rows.find((row)=>row.brand_id===otherBrandId)!;
  await pool.query(`UPDATE signal_workspaces SET timezone='America/Mexico_City' WHERE id=$1::uuid`,[workspaceRow.id]);
  const profileId=randomUUID(),otherProfileId=randomUUID(),productId=randomUUID();const brandOsDigest=digest("brand-os-v1");
  await pool.query(`INSERT INTO brand_os_profiles(id,organization_id,brand_id,name,status,version,metadata)
    VALUES($1::uuid,$2::uuid,$3::uuid,'Profile v1','active',1,jsonb_build_object('snapshot_hash',$4::text)),
      ($5::uuid,$6::uuid,$7::uuid,'Other profile','active',1,jsonb_build_object('snapshot_hash',$8::text))`,
  [profileId,orgId,brandId,brandOsDigest,otherProfileId,otherOrgId,otherBrandId,digest("other-brand-os")]);
  await pool.query(`INSERT INTO brand_os_products(id,brand_os_profile_id,name,status)
    VALUES($1::uuid,$2::uuid,'Smart speaker','active')`,[productId,profileId]);
  const sourceId=randomUUID(),chunkId=randomUUID();
  await pool.query(`INSERT INTO brand_knowledge_sources(id,organization_id,brand_id,source_kind,title,
    raw_text,extracted_payload,status) VALUES($1::uuid,$2::uuid,$3::uuid,'operator-note','Knowledge fixture',
      'Private fixture narrative','{}'::jsonb,'active')`,[sourceId,orgId,brandId]);
  await pool.query(`INSERT INTO knowledge_chunks(id,knowledge_source_id,chunk_index,chunk_text)
    VALUES($1::uuid,$2::uuid,0,'Private fixture block')`,[chunkId,sourceId]);
  const planId=randomUUID(),planDigest=digest("plan"),identityDigest=digest("identity");
  const planOperationKey=digest("plan-operation-key");
  const brief={contract_version:"signal-acquisition-brief-v1",objective:"Understand governed context",
    purpose:"Local integration",market:"MX",countries:["MX","US"],languages:["es-MX","en-US"],
    timezone:"America/Mexico_City",default_capture_period:null,target_window_months:null,
    construction_mode:"exploratory",brand_os_profile_version:1,brand_os_digest:brandOsDigest,
    identity_catalog_digest:identityDigest,knowledge_context_digest:digest("brief-knowledge"),
    knowledge_context_refs:[],provider_key:"sentione",provider_syntax_version:"v1",
    provider_schema_version:"csv-v1",optional_study_context:null};
  await pool.query(`INSERT INTO signal_governance_control_operations(workspace_id,actor_user_id,
    action,request_digest,idempotency_key,status) VALUES($1::uuid,$2::uuid,
      'reconcile-acquisition-plan',$3,$4,'in_progress')`,[workspaceRow.id,userId,
      digest("plan-operation-request"),planOperationKey]);
  await pool.query(`INSERT INTO signal_acquisition_plans(id,workspace_id,plan_version,status,
    brand_os_profile_id,brand_os_profile_version,brand_os_digest,identity_catalog_digest,
    acquisition_brief_contract_version,acquisition_brief,acquisition_brief_digest,draft_revision,
    draft_digest,definition_hash,effective_from,created_by_user_id,promoted_by_user_id,promoted_at,
    creation_idempotency_key,request_digest)
    VALUES($1::uuid,$2::uuid,1,'current',$3::uuid,1,$4,$5,'signal-acquisition-brief-v1',$6::jsonb,
      $7,1,$8,$8,clock_timestamp(),$9::uuid,$9::uuid,clock_timestamp(),$10,$11)`,[planId,
      workspaceRow.id,profileId,brandOsDigest,identityDigest,JSON.stringify(brief),digest("brief"),planDigest,
      userId,planOperationKey,digest("request")]);
  const workspace={contractVersion:"signal-backend-v1" as const,id:workspaceRow.id,organizationId:orgId,
    slug:workspaceRow.slug,name:`Brand ${suffix}`,subject:{type:"brand" as const,id:brandId},
    timezone:"America/Mexico_City",status:"active" as const,corpora:[]};
  const otherWorkspace={contractVersion:"signal-backend-v1" as const,id:otherRow.id,organizationId:otherOrgId,
    slug:otherRow.slug,name:`Other ${suffix}`,subject:{type:"brand" as const,id:otherBrandId},
    timezone:otherRow.timezone,status:"active" as const,corpora:[]};
  const actor={id:userId,userType:"noisia_internal" as const,primaryRole:"noisia_admin",organizationId:null};
  return{workspace,otherWorkspace,actor,profileId,otherProfileId,productId,sourceId,chunkId};}

async function transaction<T>(fn:(queryable:SignalBrandPolicyQueryable)=>Promise<T>){return withSignalAcquisitionTransactionV1(fn);}
async function approveElement(fixture:Awaited<ReturnType<typeof seedFixture>>,generationKey:string,
  elementKey:string,idempotencyKey:string){return transaction((queryable)=>decideSignalSemanticContextElementV2({
  queryable,workspace:fixture.workspace,actor:fixture.actor,idempotencyKey,generationKey,elementKey,
  action:"approve",reason:"semantic_boundary",rationale:`Reviewed boundary for ${elementKey}.`,
  confirmation:SIGNAL_SEMANTIC_CONTEXT_APPROVAL_CONFIRMATION_V2}));}
async function rejectElement(fixture:Awaited<ReturnType<typeof seedFixture>>,generationKey:string,
  elementKey:string,idempotencyKey:string){return transaction((queryable)=>rejectSignalSemanticContextElementV2({
  queryable,workspace:fixture.workspace,actor:fixture.actor,idempotencyKey,generationKey,elementKey,
  reason:"insufficient_context",rationale:`Governed evidence does not support ${elementKey}.`}));}
async function scalar(sql:string,params:unknown[]){return(await pool.query<{count:number}>(sql,params)).rows[0]!.count;}
async function fingerprint(sql:string,params:unknown[]){return(await pool.query<{value:string}>(
  `SELECT encode(digest(row_to_json(value)::text,'sha256'),'hex') value FROM (${sql}) value`,params)).rows[0]!.value;}
async function protectedCounts(workspaceId:string){return{
  assignments:await scalar(`SELECT count(*)::int count FROM signal_classification_assignments WHERE workspace_id=$1::uuid`,[workspaceId]),
  record_tags:await scalar(`SELECT count(*)::int count FROM record_tags`,[]),
  pointers:await scalar(`SELECT count(*)::int count FROM signal_workspace_population_pointers WHERE workspace_id=$1::uuid`,[workspaceId]),
  bindings:await scalar(`SELECT count(*)::int count FROM signal_governed_view_bindings WHERE workspace_id=$1::uuid`,[workspaceId])};}
function hasCode(code:string){return(error:unknown)=>(error as {code?:string}).code===code;}
function hasCodeAndMessage(code:string,message:RegExp){return(error:unknown)=>
  (error as {code?:string}).code===code&&message.test(String((error as {message?:string}).message??""));}
function requireLocal(url:string){const host=new URL(url).hostname;if(!["localhost","127.0.0.1","::1"].includes(host))
  throw new Error(`Refusing non-local PostgreSQL target: ${host}`);}
