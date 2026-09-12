import {
  loadSignalBrandContextProcessingQuoteV1,
  loadSignalBrandContextPrototypeQuoteV1,
  loadSignalBrandContextPrototypePlanStateV1,
  quoteSignalBrandContextSemanticRenewalV1,
  renewSignalBrandContextSemanticAdmissionV1,
  retrySignalBrandContextComposedSemanticRunV1,
  startSignalBrandContextComposedSemanticRunV1,
  startSignalBrandContextPrototypeProcessingV1,
  signalBrandContextPreparationRuntimeFromEnvV1,
  SignalSemanticContextProposalExecutionError,
  type SignalBrandContextPreparationRuntimeV1
} from "@noisia/db";
import type { Pool } from "pg";

import { loadSemanticContextProposalRuntimeReadiness } from "@/lib/queue/data-os";
import {
  clientBrandContextProcessingQuoteReferenceV1,
  toClientBrandContextProcessingQuoteViewV1,
  type ClientBrandContextProcessingConfirmationV1,
  type ClientBrandContextProcessingOperationStateV1,
  type ClientBrandContextProcessingPhaseV1,
  type ClientBrandContextProcessingViewV1
} from "./client-brand-context-processing-quote";

type Database = Pick<Pool, "connect" | "query">;

export function signalBrandContextProcessingActionAvailabilityV1(runtime: SignalBrandContextPreparationRuntimeV1) {
  const workerReady = runtime.queue_configured && runtime.worker_alive;
  return {
    brand_context_proposal: workerReady && runtime.recovery_alive && runtime.semantic.available,
    topic_prototype_embeddings: workerReady && runtime.prototype.available
  };
}

export async function loadSignalBrandContextProcessingRuntimeV1() {
  return signalBrandContextPreparationRuntimeFromEnvV1(
    process.env,
    await loadSemanticContextProposalRuntimeReadiness()
  );
}

export async function loadClientBrandContextProcessingQuoteForActorV1(args: {
  workspaceId: string;
  actorUserId: string;
  database?: Database;
  runtimeLoader?: () => Promise<SignalBrandContextPreparationRuntimeV1>;
}) {
  const database = args.database ?? (await import("@/lib/db")).pool;
  let actionAvailability = {
    brand_context_proposal: false,
    topic_prototype_embeddings: false
  };
  try {
    actionAvailability = signalBrandContextProcessingActionAvailabilityV1(
      await (args.runtimeLoader ?? loadSignalBrandContextProcessingRuntimeV1)()
    );
  } catch {
    // A missing or invalid server configuration is unavailable. It never becomes browser authority.
  }
  const quote = await loadSignalBrandContextProcessingQuoteV1({
    database,
    workspace_id: args.workspaceId,
    actor_user_id: args.actorUserId,
    action_availability: actionAvailability
  });
  return toClientBrandContextProcessingQuoteViewV1(quote);
}

type ProcessingRowV1 = {
  observed_at: string;
  receipt_id: string;
  authorization_not_after: string;
  semantic_cap_micro_usd: string;
  prototype_cap_micro_usd: string;
  available_today_micro_usd: string;
  quote_digest?: string;
  semantic_retry_maximum_micro_usd: string;
  semantic_renewal_idempotency_key: string | null;
  semantic_renewal_quote_expires_at: string | null;
  semantic_renewal_available_today_micro_usd: string | null;
  authorization_current: boolean;
  source_current: boolean;
  generation_status: string;
  semantic_status: string;
  semantic_retry_safe?: boolean;
  child_receipt_id: string | null;
  child_idempotency_key: string | null;
  prototype_status: string | null;
};

function operationState(row: ProcessingRowV1, prototypeAvailable: boolean,
  prototypeQuote: Awaited<ReturnType<typeof loadSignalBrandContextPrototypeQuoteV1>> | null, guidesPending = false): {
  state: ClientBrandContextProcessingOperationStateV1;
  phase: ClientBrandContextProcessingPhaseV1 | null;
} {
  if (!row.source_current || row.semantic_status === "stale" || row.prototype_status === "stale") {
    return { state: "stale", phase: null };
  }
  if (guidesPending) return { state: "guides_pending", phase: null };
  if (row.semantic_status === "completed" && prototypeQuote?.requires_confirmation && prototypeAvailable) return {
    state: "awaiting_authorization", phase: null
  };
  if (["failed", "dead_letter", "canceled", "outcome_unknown"].includes(row.prototype_status ?? "")
    || ["failed", "dead_letter", "canceled", "outcome_unknown"].includes(row.semantic_status)) {
    return { state: "failed", phase: null };
  }
  if (row.prototype_status === "completed") return { state: "completed", phase: null };
  if (row.prototype_status === "running") return { state: "running", phase: "preparing_interests" };
  if (row.prototype_status === "queued") return { state: "queued", phase: "waiting" };
  if (row.semantic_status === "completed") return {
    state: prototypeAvailable ? "running" : "recovering",
    phase: row.generation_status === "published" ? "preparing_interests" : "finalizing"
  };
  if (["processing", "validating"].includes(row.semantic_status)) {
    return { state: "running", phase: "preparing_context" };
  }
  return { state: "queued", phase: "waiting" };
}

async function loadLatestProcessingRowV1(database: Database, workspaceId: string, actorUserId: string) {
  const result = await database.query<ProcessingRowV1>(`SELECT clock_timestamp()::text observed_at,
    receipt.id::text receipt_id,COALESCE(renewal.admission_not_after,receipt.authorization_not_after)::text authorization_not_after,
    COALESCE(renewal.quote_digest,receipt.quote_digest) quote_digest,
    COALESCE(renewal.quote_snapshot->>'reservation_micro_usd',
      (receipt.semantic_cap_micro_usd+receipt.prototype_cap_micro_usd)::text) semantic_retry_maximum_micro_usd,
    COALESCE(renewal.admission_not_after,receipt.authorization_not_after)>clock_timestamp() authorization_current,
    renewal.idempotency_key semantic_renewal_idempotency_key,
    renewal.quote_snapshot->>'quote_expires_at' semantic_renewal_quote_expires_at,
    renewal.quote_snapshot->>'available_today_micro_usd' semantic_renewal_available_today_micro_usd,
    receipt.semantic_cap_micro_usd::text,receipt.prototype_cap_micro_usd::text,
    greatest(policy.daily_cap_micro_usd-(signal_processing_org_exposure_v1(receipt.organization_id,
      (clock_timestamp() AT TIME ZONE policy.budget_timezone)::date,policy.budget_timezone)).total_micro_usd,0)::text
      available_today_micro_usd,
    signal_brand_context_processing_source_current_v1(receipt.generation_id) source_current,
    generation.status generation_status,semantic.status semantic_status,
    semantic.status='failed' AND semantic.provider_call_state='not_started'
      AND semantic.provider_call_count=0 AND semantic.provider_response_private IS NULL
      AND semantic.lease_token IS NULL semantic_retry_safe,
    child.id::text child_receipt_id,child.idempotency_key child_idempotency_key,prototype.status prototype_status
   FROM signal_brand_context_processing_receipts receipt
   JOIN signal_semantic_context_generations generation ON generation.id=receipt.generation_id
   JOIN signal_semantic_context_proposal_runs semantic ON semantic.id=receipt.semantic_run_id
   LEFT JOIN LATERAL(SELECT candidate.* FROM signal_brand_context_semantic_renewals candidate
     WHERE candidate.parent_receipt_id=receipt.id
       AND NOT EXISTS(SELECT 1 FROM signal_brand_context_semantic_renewals successor
         WHERE successor.supersedes_renewal_id=candidate.id)
     ORDER BY candidate.created_at DESC,candidate.id DESC LIMIT 1) renewal ON true
   JOIN signal_processing_policy_versions policy ON policy.id=COALESCE(renewal.policy_version_id,receipt.policy_version_id)
   LEFT JOIN LATERAL(SELECT candidate.* FROM signal_brand_context_prototype_receipts candidate
     WHERE candidate.parent_receipt_id=receipt.id
       AND NOT EXISTS(SELECT 1 FROM signal_brand_context_prototype_receipts successor
         WHERE successor.supersedes_receipt_id=candidate.id)
     ORDER BY candidate.created_at DESC,candidate.id DESC LIMIT 1) child ON true
   LEFT JOIN signal_workspace_embedding_runs prototype ON prototype.id=child.run_id
   WHERE receipt.workspace_id=$1::uuid AND receipt.actor_user_id=$2::uuid
   ORDER BY receipt.created_at DESC,receipt.id DESC LIMIT 1`, [workspaceId, actorUserId]);
  return result.rows[0] ?? null;
}

export async function loadClientBrandContextProcessingViewForActorV1(args: {
  workspaceId: string;
  actorUserId: string;
  database?: Database;
  runtimeLoader?: () => Promise<SignalBrandContextPreparationRuntimeV1>;
}, dependencies: {
  loadQuote?: typeof loadClientBrandContextProcessingQuoteForActorV1;
  loadOperation?: typeof loadLatestProcessingRowV1;
  loadPrototypeQuote?: typeof loadSignalBrandContextPrototypeQuoteV1;
  loadPlanState?: typeof loadSignalBrandContextPrototypePlanStateV1;
} = {}): Promise<ClientBrandContextProcessingViewV1> {
  const database = args.database ?? (await import("@/lib/db")).pool;
  const runtime = await (args.runtimeLoader ?? loadSignalBrandContextProcessingRuntimeV1)();
  const [quote, operation] = await Promise.all([
    (dependencies.loadQuote ?? loadClientBrandContextProcessingQuoteForActorV1)({ ...args, runtimeLoader: async () => runtime }),
    (dependencies.loadOperation ?? loadLatestProcessingRowV1)(database, args.workspaceId, args.actorUserId)
  ]);
  let prototypeQuote: Awaited<ReturnType<typeof loadSignalBrandContextPrototypeQuoteV1>> | null = null;
  if (operation?.semantic_status === "completed" && operation.generation_status === "published") {
    try { prototypeQuote = await (dependencies.loadPrototypeQuote ?? loadSignalBrandContextPrototypeQuoteV1)({ database,
      parent_receipt_id: operation.receipt_id, actor_user_id: args.actorUserId }); }
    catch { /* The Worker may still be finalizing publication/catalog. Polling remains read-only here. */ }
  }
  let renewalQuote: Awaited<ReturnType<typeof quoteSignalBrandContextSemanticRenewalV1>> | null = null;
  if (operation?.semantic_retry_safe && operation.source_current && !operation.authorization_current) {
    try { renewalQuote = await quoteSignalBrandContextSemanticRenewalV1({ database,
      parent_receipt_id:operation.receipt_id,actor_user_id:args.actorUserId,configuration:runtime.semantic,
      runtime:{queue_configured:runtime.queue_configured,worker_alive:runtime.worker_alive,
        recovery_alive:runtime.recovery_alive} }); }
    catch { /* A missing compatible renewal remains a read-only failed state with no CTA. */ }
  }
  let guidesPending = false;
  if (operation?.semantic_status === "completed" && operation.prototype_status === "completed" && operation.source_current) {
    try { guidesPending = (await (dependencies.loadPlanState ?? loadSignalBrandContextPrototypePlanStateV1)({ database,
      parent_receipt_id: operation.receipt_id, actor_user_id: args.actorUserId })).guides_pending; }
    catch { guidesPending = true; /* Unknown readiness cannot claim that current interests are prepared. */ }
  }
  const current = operation ? operationState(operation, runtime.prototype.available, prototypeQuote, guidesPending || prototypeQuote?.refreshes_completed_plan === true) : null;
  const canStartStage2 = Boolean(current && ["awaiting_authorization", "guides_pending"].includes(current.state)
    && prototypeQuote?.requires_confirmation && runtime.queue_configured && runtime.worker_alive
    && (!prototypeQuote.requires_provider || runtime.prototype.available)
    && Date.parse(prototypeQuote.quote_expires_at) > Date.now());
  const retryReference=clientBrandContextProcessingQuoteReferenceV1(operation?.quote_digest);
  const canRetryStage1 = current?.state === "failed" && operation?.semantic_retry_safe === true
    && retryReference!==null
    && operation.source_current && operation.authorization_current
    && runtime.queue_configured && runtime.worker_alive && runtime.recovery_alive && runtime.semantic.available;
  const canRenewStage1 = current?.state === "failed" && operation?.semantic_retry_safe === true
    && operation.source_current && !operation.authorization_current && renewalQuote !== null;
  const canStartStage1 = quote.status === "quote_available" && Boolean(quote.quote_expires_at)
    && (!current || current.state === "stale");
  const canStart = canRetryStage1 || canRenewStage1 || canStartStage1 || canStartStage2;
  const immutableQuote = operation ? {
    reference: null,
    maximum_micro_usd: (BigInt(operation.semantic_cap_micro_usd)
      + BigInt(operation.prototype_cap_micro_usd)).toString(),
    available_today_micro_usd: operation.available_today_micro_usd,
    expires_at: new Date(operation.authorization_not_after).toISOString()
  } : null;
  const activeQuote = prototypeQuote?.requires_confirmation ? {
    reference: clientBrandContextProcessingQuoteReferenceV1(prototypeQuote.quote_digest),
    maximum_micro_usd: prototypeQuote.maximum_micro_usd,
    available_today_micro_usd: prototypeQuote.available_today_micro_usd,
    expires_at: prototypeQuote.quote_expires_at
  } : canRenewStage1 ? {
    reference: clientBrandContextProcessingQuoteReferenceV1(renewalQuote!.quote_digest),
    maximum_micro_usd: renewalQuote!.maximum_micro_usd,
    available_today_micro_usd: renewalQuote!.available_today_micro_usd,
    expires_at: renewalQuote!.quote_expires_at
  } : canRetryStage1 ? {
    reference: retryReference!,
    maximum_micro_usd: operation!.semantic_retry_maximum_micro_usd,
    available_today_micro_usd: immutableQuote!.available_today_micro_usd,
    expires_at: immutableQuote!.expires_at
  } : canStartStage1 && quote.maximum_micro_usd && quote.available_today_micro_usd
    && quote.quote_expires_at ? {
      reference: quote.quote_reference,
      maximum_micro_usd: quote.maximum_micro_usd,
      available_today_micro_usd: quote.available_today_micro_usd,
      expires_at: quote.quote_expires_at
    } : guidesPending ? null : immutableQuote;
  return {
    contract_version: "client-brand-context-processing-view-v1",
    workspace_id: quote.workspace_id,
    observed_at: prototypeQuote?.requires_confirmation ? prototypeQuote.quoted_at
      : operation ? new Date(operation.observed_at).toISOString() : quote.observed_at,
    can_start: canStart,
    status: canStartStage2 || canRetryStage1 || canRenewStage1 ? "quote_available"
      : current?.state === "failed" || guidesPending && quote.status === "quote_available" ? "temporarily_unavailable" : quote.status,
    quote: activeQuote,
    operation: operation && current ? { ...current, request_observed: true,
      next_action:canRenewStage1 ? "renew_semantic" : canRetryStage1 ? "retry_semantic" : null } : null
  };
}

function expectedQuoteMatchesV1(body: ClientBrandContextProcessingConfirmationV1,
  quote: { observed_at:string;maximum_micro_usd:string|null;available_today_micro_usd:string|null;
    quote_expires_at:string|null;quote_digest:string|null }) {
  const observed = Date.parse(body.expected_quote.observed_at);
  return quote.maximum_micro_usd !== null && quote.available_today_micro_usd !== null && quote.quote_expires_at !== null
    && body.expected_quote.reference === clientBrandContextProcessingQuoteReferenceV1(quote.quote_digest)
    && body.expected_quote.maximum_micro_usd === quote.maximum_micro_usd
    && body.expected_quote.available_today_micro_usd === quote.available_today_micro_usd
    && body.expected_quote.expires_at === quote.quote_expires_at
    && Number.isFinite(observed) && observed <= Date.parse(quote.observed_at)
    && observed >= Date.parse(quote.observed_at) - 300_000;
}

type PrototypeRequestReceiptV1 = { parent_receipt_id: string; quote_digest: string; confirmation: string | null;
  maximum_micro_usd: string; available_today_micro_usd: string; expires_at: string };
async function loadPrototypeRequestReceiptV1(database: Database, workspaceId: string, actorId: string, requestKey: string) {
  return (await database.query<PrototypeRequestReceiptV1>(`SELECT child.parent_receipt_id::text,child.quote_digest,child.confirmation,
    child.execution_cap_micro_usd::text maximum_micro_usd,
    greatest(policy.daily_cap_micro_usd-(child.quote_snapshot#>>'{exposure,total_micro_usd}')::bigint,0)::text available_today_micro_usd,
    child.quote_snapshot->>'quote_expires_at' expires_at
    FROM signal_brand_context_prototype_receipts child
    JOIN signal_processing_policy_versions policy ON policy.id=child.policy_version_id
    WHERE child.workspace_id=$1::uuid AND child.actor_user_id=$2::uuid AND child.idempotency_key=$3`,
    [workspaceId,actorId,requestKey])).rows[0] ?? null;
}

type Stage2StartArgsV1={workspaceId:string;actorUserId:string;idempotencyKey:string;
  body:ClientBrandContextProcessingConfirmationV1;database:Database;runtime:SignalBrandContextPreparationRuntimeV1};
export async function startClientBrandContextPrototypeProcessingForActorV1(args:Stage2StartArgsV1,
  dependencies:{loadOperation?:typeof loadLatestProcessingRowV1;
    loadReceipt?:typeof loadPrototypeRequestReceiptV1;
    loadQuote?:typeof loadSignalBrandContextPrototypeQuoteV1;
    start?:typeof startSignalBrandContextPrototypeProcessingV1;
    loadView?:typeof loadClientBrandContextProcessingViewForActorV1}={}){
  const prior=await (dependencies.loadReceipt??loadPrototypeRequestReceiptV1)(args.database,args.workspaceId,args.actorUserId,args.idempotencyKey);
  if(prior){
    if(args.body.confirmation!==prior.confirmation
      ||args.body.expected_quote.reference!==clientBrandContextProcessingQuoteReferenceV1(prior.quote_digest)
      ||args.body.expected_quote.maximum_micro_usd!==prior.maximum_micro_usd
      ||args.body.expected_quote.available_today_micro_usd!==prior.available_today_micro_usd
      ||args.body.expected_quote.expires_at!==new Date(prior.expires_at).toISOString())
      throw new SignalSemanticContextProposalExecutionError("processing_idempotency_conflict",409);
    await (dependencies.start??startSignalBrandContextPrototypeProcessingV1)({database:args.database,
      parent_receipt_id:prior.parent_receipt_id,actor_user_id:args.actorUserId,idempotency_key:args.idempotencyKey,
      confirmation:"prepare_brand_context_prototypes_within_shown_cap",provider_available:args.runtime.prototype.available,
      expected_quote_digest:prior.quote_digest});
    return (dependencies.loadView??loadClientBrandContextProcessingViewForActorV1)({workspaceId:args.workspaceId,
      actorUserId:args.actorUserId,database:args.database,runtimeLoader:async()=>args.runtime});
  }
  const operation=await (dependencies.loadOperation??loadLatestProcessingRowV1)(args.database,args.workspaceId,args.actorUserId);
  if(!operation||operation.semantic_status!=="completed"||operation.generation_status!=="published")
    throw new SignalSemanticContextProposalExecutionError("brand_context_prototype_quote_changed",409);
  const prototypeQuote=await (dependencies.loadQuote??loadSignalBrandContextPrototypeQuoteV1)({database:args.database,
    parent_receipt_id:operation.receipt_id,actor_user_id:args.actorUserId});
  if(!args.runtime.queue_configured||!args.runtime.worker_alive
    ||prototypeQuote.requires_provider&&!args.runtime.prototype.available)
    throw new SignalSemanticContextProposalExecutionError("brand_context_prototype_runtime_unavailable",503);
  if(!prototypeQuote.requires_confirmation||!expectedQuoteMatchesV1(args.body,{
    observed_at:prototypeQuote.quoted_at,maximum_micro_usd:prototypeQuote.maximum_micro_usd,
    available_today_micro_usd:prototypeQuote.available_today_micro_usd,
    quote_expires_at:prototypeQuote.quote_expires_at,quote_digest:prototypeQuote.quote_digest
  }))throw new SignalSemanticContextProposalExecutionError("brand_context_prototype_quote_changed",409);
  await (dependencies.start??startSignalBrandContextPrototypeProcessingV1)({database:args.database,
    parent_receipt_id:operation.receipt_id,actor_user_id:args.actorUserId,idempotency_key:args.idempotencyKey,
    confirmation:"prepare_brand_context_prototypes_within_shown_cap",provider_available:args.runtime.prototype.available,
    expected_quote_digest:prototypeQuote.quote_digest});
  return (dependencies.loadView??loadClientBrandContextProcessingViewForActorV1)({workspaceId:args.workspaceId,
    actorUserId:args.actorUserId,database:args.database,runtimeLoader:async()=>args.runtime});
}

export async function startClientBrandContextProcessingForActorV1(args: {
  workspace: { id: string; organizationId: string; brandId: string };
  actorUserId: string;
  idempotencyKey: string;
  body: ClientBrandContextProcessingConfirmationV1;
  database?: Database;
  runtimeLoader?: () => Promise<SignalBrandContextPreparationRuntimeV1>;
},dependencies:{loadOperation?:typeof loadLatestProcessingRowV1;
  retry?:typeof retrySignalBrandContextComposedSemanticRunV1;
  quoteRenewal?:typeof quoteSignalBrandContextSemanticRenewalV1;
  renew?:typeof renewSignalBrandContextSemanticAdmissionV1;
  loadQuote?:typeof loadSignalBrandContextProcessingQuoteV1;
  start?:typeof startSignalBrandContextComposedSemanticRunV1;
  loadView?:typeof loadClientBrandContextProcessingViewForActorV1}={}) {
  const database = args.database ?? (await import("@/lib/db")).pool;
  const runtime = await (args.runtimeLoader ?? loadSignalBrandContextProcessingRuntimeV1)();
  if (args.body.confirmation === "prepare_brand_context_prototypes_within_shown_cap") {
    return startClientBrandContextPrototypeProcessingForActorV1({workspaceId:args.workspace.id,
      actorUserId:args.actorUserId,idempotencyKey:args.idempotencyKey,body:args.body,database,runtime});
  }
  const operation=await (dependencies.loadOperation??loadLatestProcessingRowV1)(database,args.workspace.id,args.actorUserId);
  if(args.body.confirmation==="renew_brand_context_semantic_within_shown_cap"
    && operation?.semantic_renewal_idempotency_key===args.idempotencyKey){
    const renewalDigest=operation.quote_digest??null;
    const renewalQuoteExpiresAt=operation.semantic_renewal_quote_expires_at
      ?new Date(operation.semantic_renewal_quote_expires_at).toISOString():null;
    if(!renewalDigest
      ||args.body.expected_quote.reference!==clientBrandContextProcessingQuoteReferenceV1(renewalDigest)
      ||args.body.expected_quote.maximum_micro_usd!==operation.semantic_retry_maximum_micro_usd
      ||args.body.expected_quote.available_today_micro_usd!==operation.semantic_renewal_available_today_micro_usd
      ||args.body.expected_quote.expires_at!==renewalQuoteExpiresAt)
      throw new SignalSemanticContextProposalExecutionError("brand_context_semantic_renewal_quote_changed",409);
    await (dependencies.renew??renewSignalBrandContextSemanticAdmissionV1)({database,
      parent_receipt_id:operation.receipt_id,actor_user_id:args.actorUserId,idempotency_key:args.idempotencyKey,
      expected_quote_digest:renewalDigest,confirmation:args.body.confirmation,configuration:runtime.semantic,
      runtime:{queue_configured:runtime.queue_configured,worker_alive:runtime.worker_alive,
        recovery_alive:runtime.recovery_alive}});
    return (dependencies.loadView??loadClientBrandContextProcessingViewForActorV1)({workspaceId:args.workspace.id,
      actorUserId:args.actorUserId,database,runtimeLoader:async()=>runtime});
  }
  if(operation?.semantic_retry_safe){
    if(!operation.authorization_current){
      if(args.body.confirmation!=="renew_brand_context_semantic_within_shown_cap")
        throw new SignalSemanticContextProposalExecutionError("brand_context_semantic_renewal_required",409);
      const renewalQuote=await (dependencies.quoteRenewal??quoteSignalBrandContextSemanticRenewalV1)({database,
        parent_receipt_id:operation.receipt_id,actor_user_id:args.actorUserId,configuration:runtime.semantic,
        runtime:{queue_configured:runtime.queue_configured,worker_alive:runtime.worker_alive,
          recovery_alive:runtime.recovery_alive}});
      if(!operation.source_current||!expectedQuoteMatchesV1(args.body,{observed_at:new Date(operation.observed_at).toISOString(),
        maximum_micro_usd:renewalQuote.maximum_micro_usd,available_today_micro_usd:renewalQuote.available_today_micro_usd,
        quote_expires_at:renewalQuote.quote_expires_at,quote_digest:renewalQuote.quote_digest}))
        throw new SignalSemanticContextProposalExecutionError("brand_context_semantic_renewal_quote_changed",409);
      await (dependencies.renew??renewSignalBrandContextSemanticAdmissionV1)({database,
        parent_receipt_id:operation.receipt_id,actor_user_id:args.actorUserId,idempotency_key:args.idempotencyKey,
        expected_quote_digest:renewalQuote.quote_digest,confirmation:args.body.confirmation,
        configuration:runtime.semantic,runtime:{queue_configured:runtime.queue_configured,
          worker_alive:runtime.worker_alive,recovery_alive:runtime.recovery_alive}});
      return (dependencies.loadView??loadClientBrandContextProcessingViewForActorV1)({workspaceId:args.workspace.id,
        actorUserId:args.actorUserId,database,runtimeLoader:async()=>runtime});
    }
    if(args.body.confirmation!=="prepare_brand_context_within_shown_cap")
      throw new SignalSemanticContextProposalExecutionError("brand_context_quote_changed",409);
    const retryQuote={observed_at:new Date(operation.observed_at).toISOString(),
      maximum_micro_usd:operation.semantic_retry_maximum_micro_usd,
      available_today_micro_usd:operation.available_today_micro_usd,
      quote_expires_at:new Date(operation.authorization_not_after).toISOString(),quote_digest:operation.quote_digest??null};
    if(!operation.source_current||!operation.authorization_current||!expectedQuoteMatchesV1(args.body,retryQuote))
      throw new SignalSemanticContextProposalExecutionError("brand_context_quote_changed",409);
    await (dependencies.retry??retrySignalBrandContextComposedSemanticRunV1)({database,parent_receipt_id:operation.receipt_id,
      actor_user_id:args.actorUserId,idempotency_key:args.idempotencyKey,configuration:runtime.semantic,
      runtime:{queue_configured:runtime.queue_configured,worker_alive:runtime.worker_alive,
        recovery_alive:runtime.recovery_alive}});
    return (dependencies.loadView??loadClientBrandContextProcessingViewForActorV1)({workspaceId:args.workspace.id,
      actorUserId:args.actorUserId,database,runtimeLoader:async()=>runtime});
  }
  if(operation?.source_current)
    throw new SignalSemanticContextProposalExecutionError("brand_context_quote_changed",409);
  if(args.body.confirmation==="renew_brand_context_semantic_within_shown_cap")
    throw new SignalSemanticContextProposalExecutionError("brand_context_semantic_renewal_quote_changed",409);
  const internal = await (dependencies.loadQuote??loadSignalBrandContextProcessingQuoteV1)({ database,
    workspace_id: args.workspace.id, actor_user_id: args.actorUserId,
    action_availability: signalBrandContextProcessingActionAvailabilityV1(runtime) });
  const publicQuote = toClientBrandContextProcessingQuoteViewV1(internal);
  if (!internal.quote_digest || !expectedQuoteMatchesV1(args.body, {
    observed_at: publicQuote.observed_at,
    maximum_micro_usd: publicQuote.maximum_micro_usd,
    available_today_micro_usd: publicQuote.available_today_micro_usd,
    quote_expires_at: publicQuote.quote_expires_at,
    quote_digest: internal.quote_digest
  })) {
    throw new SignalSemanticContextProposalExecutionError("brand_context_quote_changed", 409);
  }
  await (dependencies.start??startSignalBrandContextComposedSemanticRunV1)({ pool: database,
    workspace: { id: args.workspace.id, organization_id: args.workspace.organizationId,
      brand_id: args.workspace.brandId }, actor: { id: args.actorUserId },
    idempotency_key: args.idempotencyKey, quote_digest: internal.quote_digest,
    confirmation: args.body.confirmation, configuration: runtime.semantic,
    runtime: { queue_configured: runtime.queue_configured, worker_alive: runtime.worker_alive,
      recovery_alive: runtime.recovery_alive, prototype_available: runtime.prototype.available } });
  return (dependencies.loadView??loadClientBrandContextProcessingViewForActorV1)({ workspaceId: args.workspace.id,
    actorUserId: args.actorUserId, database, runtimeLoader: async () => runtime });
}
