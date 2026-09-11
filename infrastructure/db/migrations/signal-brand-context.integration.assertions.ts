import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  ensureSignalBrandContextPreparationV1,
  loadSignalBrandContextPreparationV1,
  quoteSignalBrandContextPreparationV1,
  advanceSignalBrandContextPreparationsV1,
  type SignalBrandContextPreparationRuntimeV1, type SignalBrandContextPreparationV1
} from "../signal-brand-context-preparation";
import { prepareSignalSemanticContextProposalInputV1, processSignalSemanticContextProposalRunV1,
  SignalSemanticContextProposalExecutionError, SignalSemanticContextProviderCallError } from "../signal-semantic-context-proposal";
import { loadSignalWorkspaceTopicPrototypesV1 } from "../signal-workspace-topic-prototypes-management";
import { loadSignalWorkspaceTopicPrototypePlanV1 } from "../signal-workspace-topic-prototype-inputs";
import { loadSignalTopicInheritedContextStoreV1 } from "../signal-topic-catalog";
import {assertBrandContextPreAdmissionBranchesV1} from './signal-brand-context-pre-admission.assertions';
import {assertBrandContextLegacyPrototypeIsolationV1,assertBrandContextPrototypeReplacementV1} from './signal-brand-context-prototype-recovery.assertions';
import {assertBrandContextPrototypeAuthorityFenceV1,assertBrandContextMissingPublicationFenceV1} from './signal-brand-context-prototype-authority.assertions';
import {
  BRAND_CONTEXT_SYNTHETIC_INTAKE_V1, BRAND_CONTEXT_SYNTHETIC_ADDITIONAL_KB_V1, BRAND_CONTEXT_SYNTHETIC_UPDATED_KB_V1,
  createBrandContextSyntheticSemanticProviderV1, createBrandContextSyntheticVoyageProviderV1,
  executeBrandContextSyntheticPrototypeRunV1, type BrandContextSyntheticRevisionV1
} from "./signal-brand-context.synthetic.fixture";

type Transaction = { database: Pool; scoped: PoolClient };
/** Bindings invoke the real product routes/services; none may seed generation,
 * publication, prototypes or ready receipts. The runner supplies no mock DB. */
export type BrandContextSyntheticSaveBindingsV1 = {
  createBrand: (args: Transaction & { actor_user_id: string; organization_id: string;
    intake: typeof BRAND_CONTEXT_SYNTHETIC_INTAKE_V1 & { slug: string } }) => Promise<{ brand_id: string; workspace_id: string }>;
  saveKnowledge: (args: Transaction & { actor_user_id: string; organization_id: string;
    brand_id: string; source_id?: string; idempotency_key?: string; title: string; raw_text: string }) => Promise<{ source_id: string }>;
  exercisePublishedEdits: (args: Transaction & { actor_user_id: string; organization_id: string;
    workspace_id: string; generation_key: string }) => Promise<{ no_op: true; approved_edit: true; exception_edit: true; exception_archive: true;restore:true;archive_all:true }>;
  exerciseCompetitorMutation: (args: Transaction & { actor_user_id: string; organization_id: string;
    workspace_id: string; brand_id: string }) => Promise<{ successor: true; replay: true }>;
  exerciseCountryMutation: (args: Transaction & { actor_user_id: string; organization_id: string;
    workspace_id: string; brand_id: string }) => Promise<{ inferred_locale_changed: true; paid_rows_preserved: true }>;
  requestTerminalSuccessor: (args: Transaction & { actor_user_id: string; workspace_id: string;
    generation_key: string; idempotency_key: string }) => Promise<SignalBrandContextPreparationV1>;
  exerciseCompletedAuthorityDrift: (args: Transaction & { actor_user_id: string; organization_id: string;
    workspace_id: string; brand_id: string; source_id: string; generation_id: string; run_id: string;
    runtime: SignalBrandContextPreparationRuntimeV1 }) => Promise<{ successor_awaiting: true; simulated_calls: number }>;
  exerciseDomainMutationReceipts: (args: Transaction & { actor_user_id: string; organization_id: string;
    workspace_id: string; brand_id: string; source_id: string }) => Promise<{ brand_patch: true; knowledge_patch: true;
      knowledge_delete: true; automatic_knowledge_chars: number; editable_knowledge_chars: number }>;
  exerciseCorpusKnowledgeIsolation: (args: Transaction & { actor_user_id: string; organization_id: string;
    workspace_id: string; brand_id: string }) => Promise<{ brand_os_hidden: true; brand_os_immutable: true;
      own_corpus_readable: true; other_corpus_hidden: true; snapshot_authority_unchanged: true; prototypes_current: true }>;
};

/** Synthetic integration body only: no connection, migrations, env or default
 * providers. The guarded runner owns the physical rollback and global baseline. */
export async function assertBrandContextSyntheticJourneyV1(args: Transaction & {
  runtime: SignalBrandContextPreparationRuntimeV1; saves: BrandContextSyntheticSaveBindingsV1;
}) {
  const { database, runtime } = args;
  const organization_id = randomUUID(), actor_user_id = randomUUID();
  await database.query("INSERT INTO organizations(id,slug,legal_name,status) VALUES($1,$2,'Invented Brand Context test organization','active')",
    [organization_id, `brand-context-${organization_id}`]);
  await database.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status)
    VALUES($1,$2,'Synthetic Brand Context operator','noisia_internal','noisia_admin',$3,'active')`,
    [actor_user_id, `${actor_user_id}@example.test`, organization_id]);
  const created = await args.saves.createBrand({ database, scoped: args.scoped, actor_user_id, organization_id,
    intake: { ...BRAND_CONTEXT_SYNTHETIC_INTAKE_V1, slug: `synthetic-${randomUUID()}` } });
  const scope = { database, workspace_id: created.workspace_id, actor_user_id };
  const advance = async () => {
    const result = await advanceSignalBrandContextPreparationsV1({ database, runtime, limit: 10,
      workspace_id: created.workspace_id });
    assert.ok(result.every(row => !["failed", "stale"].includes(row.state)),
      `synthetic coordinator failed: ${result.map(row => row.error_code ?? row.state).join(",")}`);
  };
  const identity = (await database.query(`SELECT b.organization_id::text,w.brand_id::text,w.timezone,
    (SELECT count(*)::int FROM brand_os_profiles p WHERE p.brand_id=b.id AND p.status='active') profiles,
    (SELECT count(*)::int FROM brand_knowledge_sources k WHERE k.brand_id=b.id AND k.organization_id=b.organization_id) sources,
    (SELECT count(*)::int FROM signal_acquisition_plans a WHERE a.workspace_id=w.id) acquisition_plans
    FROM brands b JOIN signal_workspaces w ON w.brand_id=b.id WHERE b.id=$1::uuid AND w.id=$2::uuid`,
    [created.brand_id, created.workspace_id])).rows[0];
  assert.equal(identity?.organization_id, organization_id);
  assert.equal(identity?.brand_id, created.brand_id);
  assert.equal(identity?.timezone, BRAND_CONTEXT_SYNTHETIC_INTAKE_V1.timezone);
  assert.equal(identity?.profiles, 1);
  assert.equal(identity?.sources, 1, "blank optional notes must still create one automatic KB source");
  assert.equal(identity?.acquisition_plans, 0, "this journey must not need a hidden acquisition brief");

  const waitingKey = randomUUID();
  const disabledRuntime = { ...runtime, semantic: { ...runtime.semantic, available: false },
    prototype: { ...runtime.prototype, available: false } };
  const waiting = await ensureSignalBrandContextPreparationV1({ ...scope, runtime: disabledRuntime,
    idempotency_key: waitingKey, primary_locale: "es-MX" });
  assert.equal(waiting.state, "awaiting_authorization");
  assert.equal(waiting.semantic_run_id, null);
  assert.equal(waiting.prototype_run_id, null);
  const empty = (await database.query(`SELECT signal_brand_context_automatic_generation_v1(g.id) automatic,
    signal_semantic_context_publication_snapshot_v2(g.id,jsonb_build_object(
      'brand_os_digest',g.brand_os_digest,'knowledge_digest',g.knowledge_digest,'locale_context_digest',g.locale_context_digest,
      'proposal_provider_lineage',g.proposal_provider_lineage,'proposal_provider_lineage_digest',g.proposal_provider_lineage_digest)) snapshot
    FROM signal_semantic_context_generations g WHERE g.id=$1::uuid`,[waiting.generation_id])).rows[0]!;
  assert.equal(empty.automatic,false,'a save-only preparation cannot certify an automatic empty pack');
  assert.equal(empty.snapshot.publishable,false);assert.ok(empty.snapshot.blockers.includes('zero_approved_elements'));
  const waitingReplay = await ensureSignalBrandContextPreparationV1({ ...scope, runtime: disabledRuntime,
    idempotency_key: waitingKey, primary_locale: "es-MX" });
  assert.equal(waitingReplay.operation_id, waiting.operation_id);
  assert.equal(waitingReplay.replayed, true);
  const waitingView = await loadSignalBrandContextPreparationV1({ ...scope, idempotency_key: waitingKey });
  assert.equal(waitingView.current?.state, "awaiting_authorization");
  assert.equal(waitingView.request?.operation_id, waiting.operation_id);
  await assert.rejects(ensureSignalBrandContextPreparationV1({ ...scope, runtime: disabledRuntime,
    idempotency_key: waitingKey, primary_locale: "en-US" }), error =>
    error instanceof SignalSemanticContextProposalExecutionError && error.code === "brand_context_idempotency_conflict");
  const quoteTime = (await database.query<{ now: Date }>("SELECT clock_timestamp() now")).rows[0]!.now;
  const foreignQuote = quoteSignalBrandContextPreparationV1({ actor_user_id: randomUUID(), runtime, now: quoteTime });
  await assert.rejects(ensureSignalBrandContextPreparationV1({ ...scope, runtime,
    idempotency_key: randomUUID(), primary_locale: "es-MX", admission: { quote_digest: foreignQuote.quote_digest,
      confirmation: "prepare_brand_context_within_shown_cap" } }), error =>
    error instanceof SignalSemanticContextProposalExecutionError && error.code === "brand_context_quote_changed");
  await advanceSignalBrandContextPreparationsV1({ database, runtime: disabledRuntime, limit: 10,
    workspace_id: created.workspace_id });
  const noSpend = (await database.query(`SELECT
    (SELECT count(*)::int FROM signal_semantic_context_proposal_runs WHERE workspace_id=$1::uuid) semantic,
    (SELECT count(*)::int FROM signal_semantic_context_budget_reservations WHERE workspace_id=$1::uuid) reservations,
    (SELECT count(*)::int FROM signal_workspace_embedding_runs WHERE workspace_id=$1::uuid) embeddings`,
    [created.workspace_id])).rows[0];
  assert.deepEqual(noSpend, { semantic: 0, reservations: 0, embeddings: 0 });
  await assertBrandContextMissingPublicationFenceV1({database,scoped:args.scoped,workspace_id:created.workspace_id,actor_user_id});

  const knowledgeKey = randomUUID();
  const knowledgeInput = { database, scoped: args.scoped, actor_user_id,
    organization_id, brand_id: created.brand_id, title: "Synthetic workshop note",
    raw_text: BRAND_CONTEXT_SYNTHETIC_ADDITIONAL_KB_V1, idempotency_key: knowledgeKey };
  const source = await args.saves.saveKnowledge(knowledgeInput);
  const beforeKnowledgeReplay = await stableReceiptSnapshot(database, created.workspace_id);
  assert.deepEqual(await args.saves.saveKnowledge(knowledgeInput), source);
  assert.equal(await stableReceiptSnapshot(database, created.workspace_id), beforeKnowledgeReplay,
    "same accepted KB POST cannot create a new generation or mutate its receipts");
  assert.equal((await database.query("SELECT count(*)::int n FROM brand_knowledge_sources WHERE brand_id=$1::uuid AND organization_id=$2::uuid",
    [created.brand_id, organization_id])).rows[0]?.n, 2);
  const domainReceipts=await args.saves.exerciseDomainMutationReceipts({database,scoped:args.scoped,actor_user_id,organization_id,
    workspace_id:created.workspace_id,brand_id:created.brand_id,source_id:source.source_id});
  const voyage = createBrandContextSyntheticVoyageProviderV1();
  const completed: Array<{ generation_id: string; generation_key: string; prototype_run_id: string }> = [];
  const semanticCalls: string[] = [];
  let terminalSimulatedCalls = 0;
  let completedDrift:Awaited<ReturnType<BrandContextSyntheticSaveBindingsV1['exerciseCompletedAuthorityDrift']>>|null=null;
  let prototypeRecovery:Awaited<ReturnType<typeof assertBrandContextPrototypeReplacementV1>>|null=null;
  const prepare = async (revision: BrandContextSyntheticRevisionV1) => {
    const now = (await database.query<{ now: Date }>("SELECT clock_timestamp() now")).rows[0]!.now;
    const quote = quoteSignalBrandContextPreparationV1({ actor_user_id, runtime, now });
    assert.equal(quote.available, true);
    const key = randomUUID();
    const request = { ...scope, runtime, idempotency_key: key, primary_locale: "es-MX",
      admission: { quote_digest: quote.quote_digest, confirmation: "prepare_brand_context_within_shown_cap" as const } };
    const accepted = await ensureSignalBrandContextPreparationV1(request);
    assert.equal(accepted.state, "queued");
    if(revision==='initial')await assertBrandContextPreAdmissionBranchesV1({database,scoped:args.scoped,runtime,
      actor_user_id,workspace_id:created.workspace_id,brand_id:created.brand_id,accepted});
    await advance();
    const run = (await database.query<{ id: string }>(`SELECT id::text FROM signal_semantic_context_proposal_runs
      WHERE workspace_id=$1::uuid AND generation_id=$2::uuid`, [created.workspace_id, accepted.generation_id])).rows;
    assert.equal(run.length, 1, "one durable semantic run per accepted generation");
    if (revision === "initial") {
      // A real paid validation failure, created by the real process/ledger from
      // an invalid synthetic response. This alternate branch rolls back before
      // the normal safe-unsent retry and successful first-generation journey.
      await args.scoped.query("BEGIN");
      try {
        await assert.rejects(processSignalSemanticContextProposalRunV1({ pool: database, run_id: run[0]!.id,
          provider: { async generate() { terminalSimulatedCalls++;
            return { text: '{"synthetic_invalid":true}', provider_request_id: 'synthetic-paid-terminal',
              usage: { input_tokens: 1000, output_tokens: 50 } }; } } }),
          error => error instanceof SignalSemanticContextProposalExecutionError && error.status === 422);
        assert.equal(terminalSimulatedCalls, 1);
        const terminal = (await database.query(`SELECT status,provider_call_state,provider_call_count,
          provider_response_digest,settled_micro_usd::text,
          (SELECT count(*)::int FROM signal_semantic_context_element_versions WHERE generation_id=run.generation_id) elements
          FROM signal_semantic_context_proposal_runs run WHERE id=$1::uuid`, [run[0]!.id])).rows[0]!;
        assert.equal(terminal.status, "failed"); assert.equal(terminal.provider_call_state, "settled");
        assert.equal(terminal.provider_call_count, 1); assert.match(terminal.provider_response_digest, /^sha256:[a-f0-9]{64}$/u);
        assert.ok(BigInt(terminal.settled_micro_usd) > 0n); assert.equal(terminal.elements, 0);
        const paidHistory = async () => JSON.stringify((await database.query(`SELECT
          (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM signal_semantic_context_proposal_runs r WHERE workspace_id=$1::uuid) runs,
          (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM signal_semantic_context_budget_reservations r WHERE workspace_id=$1::uuid) budgets,
          (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM signal_semantic_context_proposal_outbox r WHERE workspace_id=$1::uuid) outbox,
          (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM signal_workspace_embedding_runs r WHERE workspace_id=$1::uuid) embeddings,
          (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM signal_workspace_embedding_calls r WHERE workspace_id=$1::uuid) embedding_calls`,
          [created.workspace_id])).rows[0]);
        const beforePaid = await paidHistory();
        const parent = (await database.query("SELECT to_jsonb(g) row FROM signal_semantic_context_generations g WHERE id=$1::uuid",
          [accepted.generation_id])).rows[0]!.row;
        const successorRequest = { database, scoped: args.scoped, actor_user_id, workspace_id: created.workspace_id,
          generation_key: accepted.generation_key, idempotency_key: randomUUID() };
        const successor = await args.saves.requestTerminalSuccessor(successorRequest);
        assert.equal(successor.state, "awaiting_authorization"); assert.equal(successor.semantic_run_id, null);
        assert.equal(successor.prototype_run_id, null); assert.notEqual(successor.generation_id, accepted.generation_id);
        const child = (await database.query(`SELECT status,supersedes_generation_id::text parent,supersession_reason,
          (SELECT count(*)::int FROM signal_semantic_context_element_versions WHERE generation_id=g.id) elements,
          (SELECT count(*)::int FROM signal_semantic_context_proposal_runs WHERE generation_id=g.id) runs
          FROM signal_semantic_context_generations g WHERE id=$1::uuid`, [successor.generation_id])).rows[0]!;
        assert.deepEqual(child, { status: "draft", parent: accepted.generation_id,
          supersession_reason: "terminal_provider_run", elements: 0, runs: 0 });
        const beforeReplay = await stableReceiptSnapshot(database, created.workspace_id);
        const replay = await args.saves.requestTerminalSuccessor(successorRequest);
        assert.deepEqual(replay, successor, "the route returns the same durable historical receipt on replay");
        assert.equal(replay.operation_id, successor.operation_id);
        assert.equal(replay.generation_id, successor.generation_id); assert.equal(replay.generation_key, successor.generation_key);
        assert.equal(await stableReceiptSnapshot(database, created.workspace_id), beforeReplay);
        const current = await loadSignalBrandContextPreparationV1({ ...scope, idempotency_key: successorRequest.idempotency_key });
        assert.equal(current.current?.generation_id, successor.generation_id); assert.equal(current.current?.state, "awaiting_authorization");
        assert.equal(current.request?.operation_id, successor.operation_id);
        await advanceSignalBrandContextPreparationsV1({ database, runtime, workspace_id: created.workspace_id, limit: 10 });
        assert.equal(await paidHistory(), beforePaid, "a new terminal successor must not inherit admission or alter paid response/cost/history");
        assert.equal(terminalSimulatedCalls, 1, "successor creation/replay must not issue another simulated send");
        assert.deepEqual((await database.query("SELECT to_jsonb(g) row FROM signal_semantic_context_generations g WHERE id=$1::uuid",
          [accepted.generation_id])).rows[0]!.row, parent);
      } finally { await args.scoped.query("ROLLBACK"); }
      let noSendAttempts = 0;
      await assert.rejects(processSignalSemanticContextProposalRunV1({ pool: database, run_id: run[0]!.id,
        provider: { async generate() { noSendAttempts++; throw new SignalSemanticContextProviderCallError("synthetic_not_sent", true); } } }),
        error => error instanceof SignalSemanticContextProviderCallError && error.definitelyNotSent);
      assert.equal(noSendAttempts, 1);
      const failed = (await database.query(`SELECT id::text,status,provider_call_state,provider_call_count,
        brand_context_preparation_operation_id::text,settled_micro_usd::text FROM signal_semantic_context_proposal_runs WHERE id=$1::uuid`,
        [run[0]!.id])).rows[0]!;
      assert.equal(failed.status, "failed"); assert.equal(failed.provider_call_state, "not_started");
      assert.equal(failed.provider_call_count, 0); assert.equal(failed.settled_micro_usd, null);
      const valid = async (actor: string, cap: string, generation = accepted.generation_id) =>
        (await database.query("SELECT signal_brand_context_admission_valid_v1($1::uuid,$2::uuid,$3::uuid,$4::uuid,'anthropic',$5::bigint) valid",
          [failed.brand_context_preparation_operation_id, created.workspace_id, actor, generation, cap])).rows[0]!.valid;
      assert.equal(await valid(actor_user_id, quote.semantic_cap_micro_usd), true);
      assert.equal(await valid(randomUUID(), quote.semantic_cap_micro_usd), false);
      assert.equal(await valid(actor_user_id, String(BigInt(quote.semantic_cap_micro_usd) + 1n)), false);
      assert.equal(await valid(actor_user_id, quote.semantic_cap_micro_usd, randomUUID()), false);
      const staleQuote = quoteSignalBrandContextPreparationV1({ actor_user_id, runtime,
        now: new Date(now.getTime() - 48 * 60 * 60 * 1000) });
      await assert.rejects(ensureSignalBrandContextPreparationV1({ ...request, idempotency_key: randomUUID(),
        admission: { ...request.admission, quote_digest: staleQuote.quote_digest } }), error =>
        error instanceof SignalSemanticContextProposalExecutionError && error.code === "brand_context_quote_changed");

      // Config changes get a genuine new lineage only after a proven unsent
      // terminal run. This branch is rolled back before normal same-run retry.
      await args.scoped.query("BEGIN");
      try {
        const changedRuntime = { ...runtime, semantic: { ...runtime.semantic, pricing_version: `${runtime.semantic.pricing_version}-changed` } };
        const changedQuote = quoteSignalBrandContextPreparationV1({ actor_user_id, runtime: changedRuntime });
        const changed = await ensureSignalBrandContextPreparationV1({ ...scope, runtime: changedRuntime,
          idempotency_key: randomUUID(), primary_locale: "es-MX", admission: {
            quote_digest: changedQuote.quote_digest, confirmation: "prepare_brand_context_within_shown_cap" } });
        assert.notEqual(changed.generation_id, accepted.generation_id);
        assert.equal((await database.query("SELECT supersedes_generation_id::text parent FROM signal_semantic_context_generations WHERE id=$1::uuid",
          [changed.generation_id])).rows[0]!.parent, accepted.generation_id);
        assert.equal((await database.query("SELECT status,provider_call_count FROM signal_semantic_context_proposal_runs WHERE id=$1::uuid",
          [run[0]!.id])).rows[0]!.status, "failed");
        assert.equal(await valid(actor_user_id, quote.semantic_cap_micro_usd), false);
      } finally { await args.scoped.query("ROLLBACK"); }
      await args.scoped.query("BEGIN");
      try {
        await advance();
        await assert.rejects(processSignalSemanticContextProposalRunV1({ pool: database, run_id: run[0]!.id,
          provider: { async generate() { throw new Error("synthetic ambiguous provider transport"); } } }));
        assert.equal((await database.query("SELECT provider_call_state FROM signal_semantic_context_proposal_runs WHERE id=$1::uuid",
          [run[0]!.id])).rows[0]!.provider_call_state, "outcome_unknown");
        assert.equal((await database.query("SELECT signal_brand_context_semantic_retryable_v1($1::uuid) retryable",
          [run[0]!.id])).rows[0]!.retryable, false);
        const changedRuntime = { ...runtime, semantic: { ...runtime.semantic, pricing_version: `${runtime.semantic.pricing_version}-changed` } };
        const changedQuote = quoteSignalBrandContextPreparationV1({ actor_user_id, runtime: changedRuntime });
        await assert.rejects(ensureSignalBrandContextPreparationV1({ ...scope, runtime: changedRuntime,
          idempotency_key: randomUUID(), primary_locale: "es-MX", admission: {
            quote_digest: changedQuote.quote_digest, confirmation: "prepare_brand_context_within_shown_cap" } }), error =>
          error instanceof SignalSemanticContextProposalExecutionError && error.code === "brand_context_existing_run_configuration_changed");
      } finally { await args.scoped.query("ROLLBACK"); }
      const renewedQuote = quoteSignalBrandContextPreparationV1({ actor_user_id, runtime });
      const renewed = await ensureSignalBrandContextPreparationV1({ ...request, idempotency_key: randomUUID(),
        admission: { ...request.admission, quote_digest: renewedQuote.quote_digest } });
      assert.equal(renewed.generation_id, accepted.generation_id);
      await advance();
      const retry = (await database.query("SELECT id::text,brand_context_preparation_operation_id::text,status FROM signal_semantic_context_proposal_runs WHERE generation_id=$1::uuid",
        [accepted.generation_id])).rows;
      assert.equal(retry.length, 1); assert.equal(retry[0]!.id, failed.id);
      assert.equal(retry[0]!.brand_context_preparation_operation_id, failed.brand_context_preparation_operation_id);
      assert.equal(retry[0]!.status, "queued");
    }
    const prepared = await prepareSignalSemanticContextProposalInputV1({ queryable: database,
      workspace: { id: created.workspace_id, organization_id, brand_id: created.brand_id }, generation_key: accepted.generation_key });
    assert.ok(prepared.input.knowledge_blocks.some(block => block.content_kind === "identity"
      && block.text.includes(BRAND_CONTEXT_SYNTHETIC_INTAKE_V1.description)),
      "actual brand description must enter the prepared identity");
    assert.ok(prepared.prompt.includes(BRAND_CONTEXT_SYNTHETIC_INTAKE_V1.description),
      "brand description must reach the provider prompt");
    assert.ok(BRAND_CONTEXT_SYNTHETIC_ADDITIONAL_KB_V1.length > 4000);
    assert.ok(prepared.prompt.includes("SYNTHETIC_KB_COMPLETE_TAIL"), "semantic prompt must include the KB beyond the first 4000 characters");
    const alias=[...prepared.source_refs].find(([,ref])=>ref.source_type==='knowledge_source'&&ref.source_id===source.source_id)?.[0];
    assert.ok(alias);
    const sourceBlocks=prepared.input.knowledge_blocks.filter(block=>block.source_alias===alias);
    assert.ok(sourceBlocks.length>1);assert.ok(sourceBlocks.every(block=>block.text.length<=4000));
    assert.equal(sourceBlocks.map(block=>block.text).join(''),revision==='initial'?BRAND_CONTEXT_SYNTHETIC_ADDITIONAL_KB_V1:BRAND_CONTEXT_SYNTHETIC_UPDATED_KB_V1);
    const semantic = createBrandContextSyntheticSemanticProviderV1({ input: prepared.input,
      prompt: prepared.prompt, model: runtime.semantic.model, revision });
    const result = await processSignalSemanticContextProposalRunV1({ pool: database, run_id: run[0]!.id, provider: semantic.provider });
    assert.equal(result.status, "completed");
    assert.equal(semantic.calls.length, 1);
    semanticCalls.push(semantic.calls[0]!.request_identity);
    assert.equal((await database.query('SELECT signal_brand_context_automatic_generation_v1($1::uuid) automatic',
      [accepted.generation_id])).rows[0]!.automatic,true,'settled validated policy output must carry automatic authority');
    if(revision==='initial')completedDrift=await args.saves.exerciseCompletedAuthorityDrift({database,scoped:args.scoped,runtime,
      actor_user_id,organization_id,workspace_id:created.workspace_id,brand_id:created.brand_id,source_id:source.source_id,
      generation_id:accepted.generation_id,run_id:run[0]!.id});
    if(revision==='initial')await assertBrandContextLegacyPrototypeIsolationV1({database,scoped:args.scoped,runtime,
      actor_user_id,workspace_id:created.workspace_id,generation_id:accepted.generation_id,generation_key:accepted.generation_key});
    await advance();
    const generation = (await database.query(`SELECT status,pack_digest,supersedes_generation_id::text,
      (SELECT count(*)::int FROM signal_semantic_context_element_versions e WHERE e.generation_id=g.id
        AND e.disposition='approved' AND e.lifecycle_state='active' AND NOT EXISTS(
          SELECT 1 FROM signal_semantic_context_element_versions s WHERE s.supersedes_element_id=e.id)) active,
      (SELECT count(*)::int FROM signal_semantic_context_element_versions e WHERE e.generation_id=g.id
        AND e.disposition='pending' AND NOT EXISTS(
          SELECT 1 FROM signal_semantic_context_element_versions s WHERE s.supersedes_element_id=e.id)) exceptions
      FROM signal_semantic_context_generations g WHERE g.id=$1::uuid`, [accepted.generation_id])).rows[0];
    assert.equal(generation?.status, "published");
    assert.match(generation?.pack_digest, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(generation?.active, revision === "initial" ? 2 : 3);
    assert.equal(generation?.exceptions, 1);
    if (completed.length) {
      // The real KB route first records awaiting_authorization without provider
      // credentials. Sealing provider lineage may add an unpaid intermediate
      // generation; require a genuine ancestry path rather than guessing +1.
      const lineage = (await database.query<{ id: string; depth: number }>(`WITH RECURSIVE ancestors AS (
        SELECT id,supersedes_generation_id,0 depth FROM signal_semantic_context_generations
          WHERE id=$1::uuid AND workspace_id=$2::uuid
        UNION ALL SELECT parent.id,parent.supersedes_generation_id,child.depth+1
          FROM signal_semantic_context_generations parent JOIN ancestors child ON child.supersedes_generation_id=parent.id
          WHERE parent.workspace_id=$2::uuid AND child.depth<16
      ) SELECT id::text,depth FROM ancestors`, [accepted.generation_id, created.workspace_id])).rows;
      assert.ok(lineage.some(row => row.id === completed.at(-1)!.generation_id && row.depth > 0),
        "updated KB must descend from the prior completed generation");
      assert.equal(new Set(lineage.map(row => row.id)).size, lineage.length);
    }
    const context = await loadSignalTopicInheritedContextStoreV1({ queryable: database,
      workspace_id: created.workspace_id, complete_context: true });
    assert.ok(context.embedding_text.includes("Brand benefit: Scheduled bicycle repairs"));
    assert.ok(!context.embedding_text.includes("Brand benefit: Guaranteed repair time"),
      "exception must not enter the active context");
    assert.equal(context.context_refs.filter(ref => ref.source_type === "semantic_context_element").length,
      revision === "initial" ? 2 : 3);
    const prototypes = await loadSignalWorkspaceTopicPrototypesV1(scope);
    assert.ok(prototypes.active_run, "advance must durably queue the prototype run");
    assert.equal(prototypes.active_run.counts.total_topics,0,"preparing Brand OS context without corpus must not create Topics");
    if(revision==='initial')await assertBrandContextPrototypeAuthorityFenceV1({database,scoped:args.scoped,actor_user_id,
      workspace_id:created.workspace_id,brand_id:created.brand_id,source_id:source.source_id,prototype_run_id:prototypes.active_run.id});
    if(revision==='initial')prototypeRecovery=await assertBrandContextPrototypeReplacementV1({database,scoped:args.scoped,runtime,
      actor_user_id,workspace_id:created.workspace_id,generation_id:accepted.generation_id,generation_key:accepted.generation_key,
      prototype_run_id:prototypes.active_run.id});
    assert.equal((await database.query("SELECT signal_brand_context_prototype_receipts_complete_v1($1::uuid) complete",
      [prototypes.active_run.id])).rows[0]!.complete, false, "new uncached prototype inputs cannot be classified as recorded recovery");
    await executeBrandContextSyntheticPrototypeRunV1({ database, run_id: prototypes.active_run.id, provider: voyage.provider });
    assert.equal((await database.query("SELECT signal_brand_context_prototype_receipts_complete_v1($1::uuid) complete",
      [prototypes.active_run.id])).rows[0]!.complete, true, "every current prototype input has its own durable cache/receipt after completion");
    await advance();
    const ready = await loadSignalWorkspaceTopicPrototypesV1(scope);
    assert.equal(ready.is_current, true);
    assert.equal(ready.latest_completed?.status, "completed");
    assert.equal(ready.latest_completed?.counts.pending_topics, 0);
    assert.equal(ready.latest_completed?.counts.partial_topics, 0);
    assert.ok(ready.latest_completed!.counts.processed_unique_inputs > 0);
    const preparation = await loadSignalBrandContextPreparationV1({ ...scope, idempotency_key: key });
    assert.equal(preparation.current?.state, "ready");
    assert.equal(preparation.current?.generation_id, accepted.generation_id);
    assert.equal(preparation.current?.active_elements, revision === "initial" ? 2 : 3);
    assert.equal(preparation.current?.exceptions, 1);
    assert.equal(preparation.request?.operation_id, accepted.operation_id);
    assert.equal(preparation.request?.state, "queued", "historical admission receipt must remain distinct from current readiness");
    const snapshot = await stableReceiptSnapshot(database, created.workspace_id);
    const replay = await ensureSignalBrandContextPreparationV1(request);
    assert.equal(replay.operation_id, accepted.operation_id);
    assert.equal(replay.replayed, true);
    const seen = voyage.calls.length;
    await processSignalSemanticContextProposalRunV1({ pool: database, run_id: run[0]!.id, provider: semantic.provider });
    await executeBrandContextSyntheticPrototypeRunV1({ database, run_id: ready.latest_completed!.id, provider: voyage.provider });
    await advance();
    assert.equal(semantic.calls.length, 1);
    assert.equal(voyage.calls.length, seen);
    assert.equal(await stableReceiptSnapshot(database, created.workspace_id), snapshot);
    completed.push({ generation_id: accepted.generation_id, generation_key: accepted.generation_key,
      prototype_run_id: ready.latest_completed!.id });
  };
  await prepare("initial");
  const firstPlan = await loadSignalWorkspaceTopicPrototypePlanV1({ queryable: database, ...scope });
  const firstGeneration = (await database.query("SELECT to_jsonb(g) row FROM signal_semantic_context_generations g WHERE id=$1::uuid",
    [completed[0]!.generation_id])).rows[0]!.row;
  const beforeNewInputs = new Set(voyage.calls.flatMap(call => call.input_sha256));
  await args.saves.saveKnowledge({ database, scoped: args.scoped, actor_user_id, organization_id,
    brand_id: created.brand_id, source_id: source.source_id, title: "Synthetic workshop note",
    raw_text: BRAND_CONTEXT_SYNTHETIC_UPDATED_KB_V1 });
  await prepare("updated");
  const repeatedBenefit = (await database.query<{ generation_id: string; artifact_id: string; artifact_key: string; element_digest: string }>(`
    SELECT element.generation_id::text,element.artifact_id::text,artifact.artifact_key,element.element_digest
    FROM signal_semantic_context_element_versions element JOIN analysis_artifacts artifact ON artifact.id=element.artifact_id
    WHERE element.workspace_id=$1::uuid AND element.generation_id=ANY($2::uuid[])
      AND element.element_key='benefit.scheduled-repairs' AND element.element_version=1`,
    [created.workspace_id, completed.map(row => row.generation_id)])).rows;
  assert.equal(repeatedBenefit.length, 2, "both generations must retain the unchanged proposal");
  assert.equal(new Set(repeatedBenefit.map(row => row.element_digest)).size, 1,
    "unchanged semantics must retain their digest rather than evade artifact uniqueness");
  assert.equal(new Set(repeatedBenefit.map(row => row.artifact_id)).size, 2);
  assert.equal(new Set(repeatedBenefit.map(row => row.artifact_key)).size, 2,
    "each generation owns its artifact even when proposal content is identical");
  const secondPlan = await loadSignalWorkspaceTopicPrototypePlanV1({ queryable: database, ...scope });
  const commonInputs = Object.keys(firstPlan.texts).filter(hash => hash in secondPlan.texts);
  assert.ok(commonInputs.length > 0, "fixture must exercise genuine reuse, not merely different requests");
  for (const hash of commonInputs) assert.equal(voyage.calls.flatMap(call => call.input_sha256).filter(value => value === hash).length, 1);
  assert.ok(voyage.calls.flatMap(call => call.input_sha256).some(hash => !beforeNewInputs.has(hash)));
  assert.deepEqual((await database.query("SELECT to_jsonb(g) row FROM signal_semantic_context_generations g WHERE id=$1::uuid",
    [completed[0]!.generation_id])).rows[0]!.row, firstGeneration);
  assert.equal(new Set(semanticCalls).size, 2);
  const corpusKnowledge=await args.saves.exerciseCorpusKnowledgeIsolation({database,scoped:args.scoped,actor_user_id,organization_id,
    workspace_id:created.workspace_id,brand_id:created.brand_id});
  const edits = await args.saves.exercisePublishedEdits({ database, scoped: args.scoped, actor_user_id,
    organization_id, workspace_id: created.workspace_id, generation_key: completed.at(-1)!.generation_key });
  assert.deepEqual(edits, { no_op: true, approved_edit: true, exception_edit: true, exception_archive: true,restore:true,archive_all:true });
  const competitor = await args.saves.exerciseCompetitorMutation({ database, scoped: args.scoped, actor_user_id,
    organization_id, workspace_id: created.workspace_id, brand_id: created.brand_id });
  assert.deepEqual(competitor, { successor: true, replay: true });
  const country = await args.saves.exerciseCountryMutation({ database, scoped: args.scoped, actor_user_id,
    organization_id, workspace_id: created.workspace_id, brand_id: created.brand_id });
  assert.deepEqual(country, { inferred_locale_changed: true, paid_rows_preserved: true });
  const engines = (await database.query("SELECT count(*)::int n FROM signal_topic_catalog_executions WHERE workspace_id=$1::uuid",
    [created.workspace_id])).rows[0]?.n;
  assert.equal(engines, 0, "ready for corpus is not a numerical or interpretation execution");
  const totalGenerations = (await database.query("SELECT count(*)::int n FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid",
    [created.workspace_id])).rows[0]!.n as number;
  return { contract_version: "brand-context-synthetic-journey-receipt-v1", semantic_simulated_calls: semanticCalls.length,
    voyage_simulated_calls: voyage.calls.length, reused_inputs: commonInputs.length, completed_generations: completed.length,
    total_generations: totalGenerations, terminal_simulated_calls: terminalSimulatedCalls,prototype_recovery:prototypeRecovery,
    completed_paid_authority_drift:completedDrift,save_only_empty_blocked:true,automatic_authority_verified:true,
    domain_receipts:domainReceipts,prototype_context_required_blocks_send:true,prototype_context_drift_blocks_send:true,
    corpus_knowledge_isolation:corpusKnowledge,
    legacy_unbound_not_adopted:true,runless_configuration_successor:true,unreconciled_snapshot_blocks_admission:true,
    expired_quote_rejected_fresh_quote_accepted:true,actual_24h_permission_elapsed:false,
    terminal_successor_awaiting: true, country_mutation: country,
    same_run_unsent_retry: true, config_drift_unspent_successor: true, unknown_retry_blocked: true, published_edits: edits,
    competitor_mutation: competitor, kb_post_replay: true, brand_description_in_prompt: true,
    initial_active_elements: 2, successor_active_elements: 3, exceptions_per_generation: 1, real_provider_transports: 0 };
}

async function stableReceiptSnapshot(database: Pool, workspace_id: string) {
  const tables = ["signal_semantic_context_proposal_runs", "signal_semantic_context_budget_reservations",
    "signal_semantic_context_generations", "signal_semantic_context_element_versions", "signal_workspace_embedding_runs",
    "signal_workspace_embedding_calls", "signal_workspace_chunk_embeddings"];
  const result: unknown[] = [];
  for (const table of tables) result.push((await database.query(
    `SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text),'[]'::jsonb) rows FROM ${table} row WHERE workspace_id=$1::uuid`,
    [workspace_id])).rows[0]!.rows);
  return JSON.stringify(result);
}
