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
import { withSignalAcquisitionTransactionV1 } from "@/lib/data-os/signal-acquisition-plan";
import type { SignalBrandPolicyQueryable } from "@/lib/data-os/signal-governed-brand-policy";
import { pool } from "@/lib/db";

const DB_URL=process.env.NOISIA_SIGNAL_SEMANTIC_CONTEXT_INTEGRATION_URL;
const APPROVED=process.env.NOISIA_SIGNAL_SEMANTIC_CONTEXT_INTEGRATION_APPROVED==="true";
const digest=(value:string)=>`sha256:${createHash("sha256").update(value).digest("hex")}`;
const terminalPreflightConfiguration:SignalSemanticContextProposalRuntimeConfigurationV1={
  available:true,provider:"anthropic",model:"fixture-model",model_version:"immutable-v1",
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
},async()=>{
  assert.ok(DB_URL);requireLocal(DB_URL);
  const admin=new pg.Client({connectionString:DB_URL,ssl:false});await admin.connect();
  try{await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    const directory=resolve(process.cwd(),"../../infrastructure/db/migrations");
    const files=(await readdir(directory)).filter((file)=>/^\d{4}_.+\.sql$/u.test(file)).sort();
    for(const file of files)await admin.query(await readFile(join(directory,file),"utf8"));
  }finally{await admin.end();}

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
  let readiness=await loadSignalSemanticContextReadinessV1({queryable:pool,workspace:fixture.workspace,
    actor:fixture.actor});
  assert.deepEqual(readiness.counts,{pending:4,approved:0,rejected:0});
  assert.equal(readiness.ready_for_context_aware_discovery,false);
  assert.equal(readiness.counts.approved,0,"confidence=1.0 never approves a proposal");

  const concurrentApprovals=await Promise.all([1,2].map(()=>transaction((queryable)=>
    decideSignalSemanticContextElementV1({queryable,workspace:fixture.workspace,actor:fixture.actor,
      idempotencyKey:"approve-identity-idempotent",generationKey:draft.generation_key,
      elementKey:"identity-main",action:"approve"}))));
  assert.deepEqual(concurrentApprovals[0],concurrentApprovals[1],"concurrent same-key replay is exact");
  const edited=await transaction((queryable)=>decideSignalSemanticContextElementV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"edit-product-idempotent",
    generationKey:draft.generation_key,elementKey:"product-main",action:"edit",
    edit:{canonical_key:"smart-speaker-current",display_text:"Current smart speaker",locale:"es-MX",
      relation_kind:null,relation_target_key:null}}));
  assert.equal(edited.disposition,"pending","an operator edit remains pending");
  await transaction((queryable)=>decideSignalSemanticContextElementV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"approve-product-idempotent",
    generationKey:draft.generation_key,elementKey:"product-main",action:"approve"}));
  const bulk=await transaction((queryable)=>bulkApproveSignalSemanticContextElementsV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"bulk-approve-idempotent",
    generationKey:draft.generation_key,elementKeys:["need-main","friction-main"]}));
  assert.equal(bulk.approved,2);
  assert.deepEqual(await transaction((queryable)=>bulkApproveSignalSemanticContextElementsV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"bulk-approve-idempotent",
    generationKey:draft.generation_key,elementKeys:["need-main","friction-main"]})),bulk);

  const published=await transaction((queryable)=>publishSignalSemanticContextGenerationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"publish-context-idempotent",
    generationKey:draft.generation_key}));
  assert.deepEqual(await transaction((queryable)=>publishSignalSemanticContextGenerationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"publish-context-idempotent",
    generationKey:draft.generation_key})),published);
  readiness=await loadSignalSemanticContextReadinessV1({queryable:pool,workspace:fixture.workspace,
    actor:fixture.actor});
  assert.equal(readiness.ready_for_context_aware_discovery,true);
  assert.deepEqual(readiness.counts,{pending:0,approved:4,rejected:0});
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

  await assert.rejects(transaction((queryable)=>decideSignalSemanticContextElementV1({queryable,
    workspace:fixture.otherWorkspace,actor:fixture.actor,idempotencyKey:"cross-workspace-rejected",
    generationKey:draft.generation_key,elementKey:"identity-main",action:"approve"})),/not_found/u);

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

  const canonical='{"a":1,"b":[2,3]}';
  const postgresDigest=(await pool.query<{digest:string}>(
    `SELECT signal_semantic_context_digest_v1($1) digest`,[canonical])).rows[0]!.digest;
  assert.equal(postgresDigest,digest(canonical),"TypeScript and PostgreSQL hash identical canonical bytes");
  await pool.end();
});

async function withProductProviderEnvironment<T>(run:()=>Promise<T>,overrides:Record<string,string>={}){
  const values:Record<string,string>={
    NOISIA_SEMANTIC_CONTEXT_MODEL:productLineageConfiguration.model,
    NOISIA_SEMANTIC_CONTEXT_MODEL_VERSION:productLineageConfiguration.model_version,
    NOISIA_SEMANTIC_CONTEXT_PRICING_VERSION:productLineageConfiguration.pricing_version,
    NOISIA_SEMANTIC_CONTEXT_MAX_INPUT_TOKENS:String(productLineageConfiguration.max_input_tokens),
    NOISIA_SEMANTIC_CONTEXT_MAX_OUTPUT_TOKENS:String(productLineageConfiguration.max_output_tokens),
    NOISIA_SEMANTIC_CONTEXT_INPUT_USD_PER_MILLION_TOKENS:
      productLineageConfiguration.input_usd_per_million_tokens,
    NOISIA_SEMANTIC_CONTEXT_OUTPUT_USD_PER_MILLION_TOKENS:
      productLineageConfiguration.output_usd_per_million_tokens,
    NOISIA_SEMANTIC_CONTEXT_HARD_CAP_MICRO_USD:
      productLineageConfiguration.platform_hard_cap_micro_usd.toString(),
    ...overrides
  };
  const previous=new Map(Object.keys(values).map((key)=>[key,process.env[key]]));
  Object.assign(process.env,values);
  try{return await run();}
  finally{for(const[key,value]of previous){if(value===undefined)delete process.env[key];
    else process.env[key]=value;}}
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

function proposal(elementKey:string,kind:"identity_term"|"product"|"need"|"friction",
  canonicalKey:string,displayText:string,confidence:number,sourceId:string){
  const sourceType=kind==="identity_term"?"brand_os_profile":kind==="product"?"brand_os_product":
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
  const profileId=randomUUID(),productId=randomUUID();const brandOsDigest=digest("brand-os-v1");
  await pool.query(`INSERT INTO brand_os_profiles(id,organization_id,brand_id,name,status,version,metadata)
    VALUES($1::uuid,$2::uuid,$3::uuid,'Profile v1','active',1,jsonb_build_object('snapshot_hash',$4::text))`,
  [profileId,orgId,brandId,brandOsDigest]);
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
    purpose:"Local integration",market:"MX",countries:["MX"],languages:["es-MX"],
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
  return{workspace,otherWorkspace,actor,profileId,productId,sourceId,chunkId};}

async function transaction<T>(fn:(queryable:SignalBrandPolicyQueryable)=>Promise<T>){return withSignalAcquisitionTransactionV1(fn);}
async function scalar(sql:string,params:unknown[]){return(await pool.query<{count:number}>(sql,params)).rows[0]!.count;}
async function fingerprint(sql:string,params:unknown[]){return(await pool.query<{value:string}>(
  `SELECT encode(digest(row_to_json(value)::text,'sha256'),'hex') value FROM (${sql}) value`,params)).rows[0]!.value;}
async function protectedCounts(workspaceId:string){return{
  assignments:await scalar(`SELECT count(*)::int count FROM signal_classification_assignments WHERE workspace_id=$1::uuid`,[workspaceId]),
  record_tags:await scalar(`SELECT count(*)::int count FROM record_tags`,[]),
  pointers:await scalar(`SELECT count(*)::int count FROM signal_workspace_population_pointers WHERE workspace_id=$1::uuid`,[workspaceId]),
  bindings:await scalar(`SELECT count(*)::int count FROM signal_governed_view_bindings WHERE workspace_id=$1::uuid`,[workspaceId])};}
function hasCode(code:string){return(error:unknown)=>(error as {code?:string}).code===code;}
function requireLocal(url:string){const host=new URL(url).hostname;if(!["localhost","127.0.0.1","::1"].includes(host))
  throw new Error(`Refusing non-local PostgreSQL target: ${host}`);}
