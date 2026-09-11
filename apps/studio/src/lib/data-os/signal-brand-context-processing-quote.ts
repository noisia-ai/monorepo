import {
  loadSignalBrandContextProcessingQuoteV1,
  loadSignalBrandContextPrototypeQuoteV1,
  startSignalBrandContextComposedSemanticRunV1,
  startSignalBrandContextPrototypeProcessingV1,
  signalBrandContextPreparationRuntimeFromEnvV1,
  SignalSemanticContextProposalExecutionError,
  type SignalBrandContextPreparationRuntimeV1
} from "@noisia/db";
import type { Pool } from "pg";

import { loadSemanticContextProposalRuntimeReadiness } from "@/lib/queue/data-os";
import {
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
  authorization_current: boolean;
  source_current: boolean;
  generation_status: string;
  semantic_status: string;
  child_receipt_id: string | null;
  child_idempotency_key: string | null;
  prototype_status: string | null;
};

function operationState(row: ProcessingRowV1, prototypeAvailable: boolean,
  prototypeQuote: Awaited<ReturnType<typeof loadSignalBrandContextPrototypeQuoteV1>> | null): {
  state: ClientBrandContextProcessingOperationStateV1;
  phase: ClientBrandContextProcessingPhaseV1 | null;
} {
  if (!row.source_current || row.semantic_status === "stale" || row.prototype_status === "stale") {
    return { state: "stale", phase: null };
  }
  if (["failed", "dead_letter", "canceled"].includes(row.prototype_status ?? "")
    || ["failed", "dead_letter", "canceled"].includes(row.semantic_status)) {
    return { state: "failed", phase: null };
  }
  if (row.prototype_status === "completed") return { state: "completed", phase: null };
  if (row.prototype_status === "running") return { state: "running", phase: "preparing_interests" };
  if (row.prototype_status === "queued") return { state: "queued", phase: "waiting" };
  if (row.semantic_status === "completed" && prototypeQuote?.requires_confirmation && prototypeAvailable) return {
    state: "awaiting_authorization", phase: null
  };
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
    receipt.id::text receipt_id,receipt.authorization_not_after::text,
    receipt.authorization_not_after>clock_timestamp() authorization_current,
    receipt.semantic_cap_micro_usd::text,receipt.prototype_cap_micro_usd::text,
    greatest(policy.daily_cap_micro_usd-(signal_processing_org_exposure_v1(receipt.organization_id,
      (clock_timestamp() AT TIME ZONE policy.budget_timezone)::date,policy.budget_timezone)).total_micro_usd,0)::text
      available_today_micro_usd,
    signal_brand_context_processing_source_current_v1(receipt.generation_id) source_current,
    generation.status generation_status,semantic.status semantic_status,
    child.id::text child_receipt_id,child.idempotency_key child_idempotency_key,prototype.status prototype_status
   FROM signal_brand_context_processing_receipts receipt
   JOIN signal_semantic_context_generations generation ON generation.id=receipt.generation_id
   JOIN signal_semantic_context_proposal_runs semantic ON semantic.id=receipt.semantic_run_id
   JOIN signal_processing_policy_versions policy ON policy.id=receipt.policy_version_id
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
}): Promise<ClientBrandContextProcessingViewV1> {
  const database = args.database ?? (await import("@/lib/db")).pool;
  const runtime = await (args.runtimeLoader ?? loadSignalBrandContextProcessingRuntimeV1)();
  const [quote, operation] = await Promise.all([
    loadClientBrandContextProcessingQuoteForActorV1({ ...args, runtimeLoader: async () => runtime }),
    loadLatestProcessingRowV1(database, args.workspaceId, args.actorUserId)
  ]);
  let prototypeQuote: Awaited<ReturnType<typeof loadSignalBrandContextPrototypeQuoteV1>> | null = null;
  if (operation?.semantic_status === "completed" && operation.generation_status === "published"
    && !operation.child_receipt_id) {
    try { prototypeQuote = await loadSignalBrandContextPrototypeQuoteV1({ database,
      parent_receipt_id: operation.receipt_id, actor_user_id: args.actorUserId }); }
    catch { /* The Worker may still be finalizing publication/catalog. Polling remains read-only here. */ }
  }
  const current = operation ? operationState(operation, runtime.prototype.available, prototypeQuote) : null;
  const canStartStage2 = current?.state === "awaiting_authorization" && Boolean(prototypeQuote)
    && runtime.prototype.available && Date.parse(prototypeQuote!.quote_expires_at) > Date.now();
  const canStartStage1 = quote.status === "quote_available" && Boolean(quote.quote_expires_at)
    && (!current || ["stale", "failed"].includes(current.state));
  const canStart = canStartStage1 || canStartStage2;
  const immutableQuote = operation ? {
    maximum_micro_usd: (BigInt(operation.semantic_cap_micro_usd)
      + BigInt(operation.prototype_cap_micro_usd)).toString(),
    available_today_micro_usd: operation.available_today_micro_usd,
    expires_at: new Date(operation.authorization_not_after).toISOString()
  } : null;
  const activeQuote = prototypeQuote?.requires_confirmation ? {
    maximum_micro_usd: prototypeQuote.maximum_micro_usd,
    available_today_micro_usd: prototypeQuote.available_today_micro_usd,
    expires_at: prototypeQuote.quote_expires_at
  } : operation ? immutableQuote
    : quote.status === "quote_available" && quote.maximum_micro_usd && quote.available_today_micro_usd
    && quote.quote_expires_at ? {
      maximum_micro_usd: quote.maximum_micro_usd,
      available_today_micro_usd: quote.available_today_micro_usd,
      expires_at: quote.quote_expires_at
    } : immutableQuote;
  return {
    contract_version: "client-brand-context-processing-view-v1",
    workspace_id: quote.workspace_id,
    observed_at: prototypeQuote?.requires_confirmation ? prototypeQuote.quoted_at
      : operation ? new Date(operation.observed_at).toISOString() : quote.observed_at,
    can_start: canStart,
    status: canStartStage2 ? "quote_available" : quote.status,
    quote: activeQuote,
    operation: operation && current ? { ...current, request_observed: true } : null
  };
}

function expectedQuoteMatchesV1(body: ClientBrandContextProcessingConfirmationV1,
  quote: { observed_at:string;maximum_micro_usd:string|null;available_today_micro_usd:string|null;
    quote_expires_at:string|null }) {
  const observed = Date.parse(body.expected_quote.observed_at);
  return quote.maximum_micro_usd !== null && quote.available_today_micro_usd !== null && quote.quote_expires_at !== null
    && body.expected_quote.maximum_micro_usd === quote.maximum_micro_usd
    && body.expected_quote.available_today_micro_usd === quote.available_today_micro_usd
    && body.expected_quote.expires_at === quote.quote_expires_at
    && Number.isFinite(observed) && observed <= Date.parse(quote.observed_at)
    && observed >= Date.parse(quote.observed_at) - 300_000;
}

type Stage2StartArgsV1={workspaceId:string;actorUserId:string;idempotencyKey:string;
  body:ClientBrandContextProcessingConfirmationV1;database:Database;runtime:SignalBrandContextPreparationRuntimeV1};
export async function startClientBrandContextPrototypeProcessingForActorV1(args:Stage2StartArgsV1,
  dependencies:{loadOperation?:typeof loadLatestProcessingRowV1;
    loadQuote?:typeof loadSignalBrandContextPrototypeQuoteV1;
    start?:typeof startSignalBrandContextPrototypeProcessingV1;
    loadView?:typeof loadClientBrandContextProcessingViewForActorV1}={}){
  const operation=await (dependencies.loadOperation??loadLatestProcessingRowV1)(args.database,args.workspaceId,args.actorUserId);
  if(!operation||operation.semantic_status!=="completed"||operation.generation_status!=="published")
    throw new SignalSemanticContextProposalExecutionError("brand_context_prototype_quote_changed",409);
  if(operation.child_receipt_id){
    if(operation.child_idempotency_key!==args.idempotencyKey)
      throw new SignalSemanticContextProposalExecutionError("brand_context_prototype_quote_changed",409);
    await (dependencies.start??startSignalBrandContextPrototypeProcessingV1)({database:args.database,
      parent_receipt_id:operation.receipt_id,actor_user_id:args.actorUserId,idempotency_key:args.idempotencyKey,
      confirmation:"prepare_brand_context_prototypes_within_shown_cap",provider_available:args.runtime.prototype.available});
    return (dependencies.loadView??loadClientBrandContextProcessingViewForActorV1)({workspaceId:args.workspaceId,
      actorUserId:args.actorUserId,database:args.database,runtimeLoader:async()=>args.runtime});
  }
  if(!args.runtime.prototype.available)
    throw new SignalSemanticContextProposalExecutionError("brand_context_prototype_runtime_unavailable",503);
  const prototypeQuote=await (dependencies.loadQuote??loadSignalBrandContextPrototypeQuoteV1)({database:args.database,
    parent_receipt_id:operation.receipt_id,actor_user_id:args.actorUserId});
  if(!prototypeQuote.requires_confirmation||!expectedQuoteMatchesV1(args.body,{
    observed_at:prototypeQuote.quoted_at,maximum_micro_usd:prototypeQuote.maximum_micro_usd,
    available_today_micro_usd:prototypeQuote.available_today_micro_usd,
    quote_expires_at:prototypeQuote.quote_expires_at
  }))throw new SignalSemanticContextProposalExecutionError("brand_context_prototype_quote_changed",409);
  await (dependencies.start??startSignalBrandContextPrototypeProcessingV1)({database:args.database,
    parent_receipt_id:operation.receipt_id,actor_user_id:args.actorUserId,idempotency_key:args.idempotencyKey,
    confirmation:"prepare_brand_context_prototypes_within_shown_cap",provider_available:args.runtime.prototype.available});
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
}) {
  const database = args.database ?? (await import("@/lib/db")).pool;
  const runtime = await (args.runtimeLoader ?? loadSignalBrandContextProcessingRuntimeV1)();
  if (args.body.confirmation === "prepare_brand_context_prototypes_within_shown_cap") {
    return startClientBrandContextPrototypeProcessingForActorV1({workspaceId:args.workspace.id,
      actorUserId:args.actorUserId,idempotencyKey:args.idempotencyKey,body:args.body,database,runtime});
  }
  const internal = await loadSignalBrandContextProcessingQuoteV1({ database,
    workspace_id: args.workspace.id, actor_user_id: args.actorUserId,
    action_availability: signalBrandContextProcessingActionAvailabilityV1(runtime) });
  const publicQuote = toClientBrandContextProcessingQuoteViewV1(internal);
  if (!internal.quote_digest || !expectedQuoteMatchesV1(args.body, publicQuote)) {
    throw new SignalSemanticContextProposalExecutionError("brand_context_quote_changed", 409);
  }
  await startSignalBrandContextComposedSemanticRunV1({ pool: database,
    workspace: { id: args.workspace.id, organization_id: args.workspace.organizationId,
      brand_id: args.workspace.brandId }, actor: { id: args.actorUserId, user_type: "client" },
    idempotency_key: args.idempotencyKey, quote_digest: internal.quote_digest,
    confirmation: args.body.confirmation, configuration: runtime.semantic,
    runtime: { queue_configured: runtime.queue_configured, worker_alive: runtime.worker_alive,
      recovery_alive: runtime.recovery_alive, prototype_available: runtime.prototype.available } });
  return loadClientBrandContextProcessingViewForActorV1({ workspaceId: args.workspace.id,
    actorUserId: args.actorUserId, database, runtimeLoader: async () => runtime });
}
