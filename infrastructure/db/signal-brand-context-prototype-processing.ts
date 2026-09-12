import {createHash} from "node:crypto";
import type {Pool,PoolClient} from "pg";
import {signalSemanticContextProposalDigestV1} from "@noisia/query-engine";
import {loadSignalWorkspaceTopicPrototypePlanV1} from "./signal-workspace-topic-prototype-inputs";
import {ensureSignalBrandContextPrototypeCatalogStoreV1,SignalTopicCatalogError} from "./signal-topic-catalog";
import {publishSignalBrandContextComposedGenerationWithQueryableV1} from "./signal-brand-context-preparation";
import {SignalSemanticContextProposalExecutionError,type SignalSemanticContextProposalRuntimeConfigurationV1} from "./signal-semantic-context-proposal";

type Database=Pick<Pool,"connect">;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const digest=/^sha256:[0-9a-f]{64}$/u;
const key=/^[A-Za-z0-9._:-]{8,200}$/u;
const confirmation="prepare_brand_context_prototypes_within_shown_cap" as const;
const fail=(code:string,status=409):never=>{throw new SignalSemanticContextProposalExecutionError(code,status);};
type Receipt={id:string;parent_receipt_id:string;workspace_id:string;generation_id:string;actor_user_id:string;
  admission_id:string;run_id:string;pack_digest:string;plan:Record<string,unknown>;quote_digest:string;confirmation:string|null};
type Authorization={replayed:boolean;run_id:string;receipt:Receipt};
type Quote={quote_digest:string;quote_snapshot:{requires_provider:boolean;requires_confirmation:boolean;
  refreshes_completed_plan?:boolean;
  authorization_state:string;pack_digest:string;supersedes_receipt_id:string|null;execution_cap_micro_usd:number|string;quote_expires_at:string;
  exposure:{confirmed_micro_usd:number|string;reserved_micro_usd:number|string;
    ambiguous_micro_usd:number|string;total_micro_usd:number|string}}};

export type SignalBrandContextPrototypeQuoteV1={contract_version:"brand-context-prototype-quote-v1";
  parent_receipt_id:string;workspace_id:string;supersedes_receipt_id:string|null;quote_digest:string;quoted_at:string;quote_expires_at:string;
  maximum_micro_usd:string;available_today_micro_usd:string;requires_provider:boolean;requires_confirmation:boolean;
  refreshes_completed_plan?:boolean;
  authorization_state:"automatic_ready"|"awaiting_authorization"};

function mapError(error:unknown):never{
  if(error instanceof SignalSemanticContextProposalExecutionError)throw error;
  if(error instanceof SignalTopicCatalogError)return fail(error.code,error.status);
  const message=error instanceof Error?error.message:"";
  if(/^(?:brand_context|processing|workspace_embedding)_[a-z_]+$/u.test(message))
    return fail(message,message==="processing_forbidden"?403:message.endsWith("request_invalid")?422:409);
  throw error;
}
const operationKey=(value:string)=>`sha256:${createHash("sha256").update(`signal-product-operation-v1\u001f${value}`,"utf8").digest("hex")}`;
async function authorize(client:PoolClient,args:{parent_receipt_id:string;actor_user_id:string;idempotency_key:string;
  pack_digest:string;plan:Record<string,unknown>;quote_digest:string;confirmation:string|null}){
  return(await client.query<{result:Authorization}>(`SELECT authorize_signal_brand_context_prototypes_v1(
    $1::uuid,$2::uuid,$3,$4,$5::jsonb,$6,$7) result`,[args.parent_receipt_id,args.actor_user_id,args.idempotency_key,
    args.pack_digest,JSON.stringify(args.plan),args.quote_digest,args.confirmation])).rows[0]?.result;
}

const prototypeStates=["queued","running","completed","failed","canceled","stale","outcome_unknown"] as const;
export type SignalBrandContextPrototypeProcessingV1={contract_version:"brand-context-prototype-processing-v1";
  workspace_id:string;generation_id:string;run_id:string;receipt_id:string;state:typeof prototypeStates[number];
  replayed:boolean;requires_provider:boolean};

type CompletedSemanticParent={parent_receipt_id:string;workspace_id:string;actor_user_id:string;
  child_receipt_id:string|null;child_run_id:string|null;child_status:string|null;child_idempotency_key:string|null};

async function loadCompletedSemanticParentV1(database:Database,semanticRunId:string){
  const client=await database.connect();
  try{
    await client.query("BEGIN READ ONLY");
    const row=(await client.query<CompletedSemanticParent>(`SELECT receipt.id::text parent_receipt_id,
      receipt.workspace_id::text,receipt.actor_user_id::text,child.id::text child_receipt_id,
      child.run_id::text child_run_id,prototype.status child_status,child.idempotency_key child_idempotency_key
      FROM signal_brand_context_processing_receipts receipt
      JOIN signal_processing_admissions admission ON admission.id=receipt.semantic_admission_id
       AND admission.brand_context_processing_receipt_id=receipt.id
       AND admission.target_id=receipt.semantic_run_id AND admission.action='brand_context_proposal'
      JOIN signal_semantic_context_proposal_runs run ON run.id=receipt.semantic_run_id
       AND run.processing_admission_id=admission.id AND run.workspace_id=receipt.workspace_id
       AND run.generation_id=receipt.generation_id AND run.created_by_user_id=receipt.actor_user_id
      JOIN signal_semantic_context_budget_reservations reservation ON reservation.run_id=run.id
       AND reservation.workspace_id=run.workspace_id
      LEFT JOIN LATERAL(SELECT candidate.* FROM signal_brand_context_prototype_receipts candidate
       WHERE candidate.parent_receipt_id=receipt.id
        AND NOT EXISTS(SELECT 1 FROM signal_brand_context_prototype_receipts successor
          WHERE successor.supersedes_receipt_id=candidate.id)
       ORDER BY candidate.created_at DESC,candidate.id DESC LIMIT 1) child ON true
      LEFT JOIN signal_workspace_embedding_runs prototype ON prototype.id=child.run_id
       AND prototype.workspace_id=child.workspace_id AND prototype.input_contract='topic_prototypes'
      WHERE run.id=$1::uuid AND run.status='completed' AND run.provider_call_state='settled'
       AND run.provider_call_count=1 AND run.provider_response_private IS NOT NULL
       AND run.provider_response_digest IS NOT NULL AND run.appended_operation_id IS NOT NULL
       AND run.result_digest IS NOT NULL AND run.lease_token IS NULL
       AND reservation.status='settled' AND reservation.actual_micro_usd=run.settled_micro_usd
       AND reservation.reservation_micro_usd=run.reservation_micro_usd`,[semanticRunId])).rows[0];
    await client.query("COMMIT");return row??null;
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{client.release();}
}

function prototypeQuoteView(parent:{parent_receipt_id:string;workspace_id:string},quoted:Quote,observedAt:string,
  dailyCapMicroUsd:string):SignalBrandContextPrototypeQuoteV1{
  const snapshot=quoted.quote_snapshot;const exposure=BigInt(String(snapshot.exposure.total_micro_usd));
  const dailyCap=BigInt(dailyCapMicroUsd);
  return{contract_version:"brand-context-prototype-quote-v1",parent_receipt_id:parent.parent_receipt_id,
    workspace_id:parent.workspace_id,supersedes_receipt_id:snapshot.supersedes_receipt_id,
    quote_digest:quoted.quote_digest,quoted_at:new Date(observedAt).toISOString(),
    quote_expires_at:new Date(snapshot.quote_expires_at).toISOString(),maximum_micro_usd:String(snapshot.execution_cap_micro_usd),
    available_today_micro_usd:(dailyCap>exposure?dailyCap-exposure:0n).toString(),
    requires_provider:snapshot.requires_provider,requires_confirmation:snapshot.requires_confirmation,
    refreshes_completed_plan:snapshot.refreshes_completed_plan===true,
    authorization_state:snapshot.authorization_state as "automatic_ready"|"awaiting_authorization"};
}

async function quotePreparedPrototypePlanV1(client:PoolClient,parent:{parent_receipt_id:string;workspace_id:string;
  actor_user_id:string},plan:Record<string,unknown>){
  const row=(await client.query<{value:Quote;observed_at:string;daily_cap_micro_usd:string}>(`WITH quoted AS (
    SELECT quote_signal_brand_context_prototypes_v1($1::uuid,$2::uuid,$3::jsonb) value
  ) SELECT value,clock_timestamp()::text observed_at,policy.daily_cap_micro_usd::text
    FROM quoted JOIN signal_brand_context_processing_receipts receipt ON receipt.id=$1::uuid
    JOIN signal_processing_policy_versions policy ON policy.id=(value#>>'{quote_snapshot,policy_version_id}')::uuid`,
    [parent.parent_receipt_id,parent.actor_user_id,JSON.stringify(plan)])).rows[0];
  if(!row||!digest.test(row.value.quote_digest)
    ||row.value.quote_snapshot.supersedes_receipt_id!==null&&!uuid.test(row.value.quote_snapshot.supersedes_receipt_id)
    ||row.value.quote_snapshot.authorization_state!=="automatic_ready"
    &&row.value.quote_snapshot.authorization_state!=="awaiting_authorization")return fail("brand_context_prototype_quote_invalid");
  return{internal:row.value,public:prototypeQuoteView(parent,row.value,row.observed_at,row.daily_cap_micro_usd)};
}

/** Worker preparation step. It publishes the already-paid Claude result and
 * materializes an empty/default catalog before deciding whether Stage2 needs a
 * fresh user confirmation. It never creates an admission, reservation or run. */
export async function prepareSignalBrandContextPrototypeQuoteV1(args:{database:Database;parent_receipt_id:string;
  actor_user_id:string}){
  if(!uuid.test(args.parent_receipt_id)||!uuid.test(args.actor_user_id))return fail("brand_context_prototype_request_invalid",422);
  const client=await args.database.connect();
  try{
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    const parent=(await client.query<{parent_receipt_id:string;workspace_id:string;generation_id:string;actor_user_id:string}>(
      `SELECT id::text parent_receipt_id,workspace_id::text,generation_id::text,actor_user_id::text
       FROM signal_brand_context_processing_receipts WHERE id=$1::uuid AND actor_user_id=$2::uuid`,
      [args.parent_receipt_id,args.actor_user_id])).rows[0];
    if(!parent)return fail("processing_forbidden",403);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`signal-semantic-context:${parent.workspace_id}`]);
    const published=await publishSignalBrandContextComposedGenerationWithQueryableV1({queryable:client,
      parent_receipt_id:parent.parent_receipt_id,actor_user_id:parent.actor_user_id});
    await ensureSignalBrandContextPrototypeCatalogStoreV1({client,workspace_id:parent.workspace_id,
      actor_user_id:parent.actor_user_id,parent_receipt_id:parent.parent_receipt_id,
      generation_id:published.generation_id,pack_digest:published.pack_digest});
    const plan=await loadSignalWorkspaceTopicPrototypePlanV1({queryable:client,workspace_id:parent.workspace_id,
      actor_user_id:parent.actor_user_id});
    const quoted=await quotePreparedPrototypePlanV1(client,parent,plan);
    await client.query("COMMIT");return quoted.public;
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);mapError(error);}finally{client.release();}
}

/** Read-only exact Stage2 quote for the product endpoint after the Worker has
 * prepared publication/catalog. Hidden plan bytes and quote digest stay server-side. */
export async function loadSignalBrandContextPrototypeQuoteV1(args:{database:Database;parent_receipt_id:string;
  actor_user_id:string}){
  if(!uuid.test(args.parent_receipt_id)||!uuid.test(args.actor_user_id))return fail("brand_context_prototype_request_invalid",422);
  const client=await args.database.connect();
  try{
    await client.query("BEGIN READ ONLY");
    const parent=(await client.query<{parent_receipt_id:string;workspace_id:string;actor_user_id:string}>(
      `SELECT id::text parent_receipt_id,workspace_id::text,actor_user_id::text
       FROM signal_brand_context_processing_receipts WHERE id=$1::uuid AND actor_user_id=$2::uuid`,
      [args.parent_receipt_id,args.actor_user_id])).rows[0];
    if(!parent)return fail("processing_forbidden",403);
    const plan=await loadSignalWorkspaceTopicPrototypePlanV1({queryable:client,workspace_id:parent.workspace_id,
      actor_user_id:parent.actor_user_id});
    const quoted=await quotePreparedPrototypePlanV1(client,parent,plan);
    await client.query("COMMIT");return quoted.public;
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);mapError(error);}finally{client.release();}
}

/** Readiness is independent of a current spending quote. An expired policy must
 * not turn changed guides back into a claim that they are prepared. */
export async function loadSignalBrandContextPrototypePlanStateV1(args:{database:Database;parent_receipt_id:string;
  actor_user_id:string},dependencies:{load_plan?:typeof loadSignalWorkspaceTopicPrototypePlanV1}={}){
  if(!uuid.test(args.parent_receipt_id)||!uuid.test(args.actor_user_id))return fail("brand_context_prototype_request_invalid",422);
  const client=await args.database.connect();
  try{
    await client.query("BEGIN READ ONLY");
    const prior=(await client.query<{workspace_id:string;plan_digest:string;status:string}>(`SELECT parent.workspace_id::text,
      child.plan_digest,run.status FROM signal_brand_context_processing_receipts parent
      JOIN signal_brand_context_prototype_receipts child ON child.parent_receipt_id=parent.id
      JOIN signal_workspace_embedding_runs run ON run.id=child.run_id AND run.processing_admission_id=child.admission_id
      WHERE parent.id=$1::uuid AND parent.actor_user_id=$2::uuid
       AND NOT EXISTS(SELECT 1 FROM signal_brand_context_prototype_receipts successor WHERE successor.supersedes_receipt_id=child.id)`,
      [args.parent_receipt_id,args.actor_user_id])).rows[0];
    if(!prior)return fail("brand_context_prototype_receipt_invalid");
    const plan=await (dependencies.load_plan??loadSignalWorkspaceTopicPrototypePlanV1)({queryable:client,
      workspace_id:prior.workspace_id,actor_user_id:args.actor_user_id});
    await client.query("COMMIT");
    return{guides_pending:prior.status==="completed"&&prior.plan_digest!==plan.plan_digest};
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);mapError(error);}finally{client.release();}
}

/** Worker-only bridge from a settled Claude receipt to Stage2. The actor and
 * idempotency key are derived from immutable DB receipts. A disabled Voyage
 * runtime leaves the paid Claude result complete and returns a retryable state. */
export async function advanceSignalBrandContextComposedProcessingV1(args:{database:Database;
  semantic_run_id:string;provider_available:boolean;
  load_parent?:typeof loadCompletedSemanticParentV1;
  prepare_quote?:typeof prepareSignalBrandContextPrototypeQuoteV1;
  start_processing?:typeof startSignalBrandContextPrototypeProcessingV1}){
  if(!uuid.test(args.semantic_run_id))return fail("brand_context_semantic_run_invalid",422);
  const parent=await (args.load_parent??loadCompletedSemanticParentV1)(args.database,args.semantic_run_id);
  if(!parent)return{contract_version:"brand-context-composed-advance-v1" as const,
    state:"not_applicable" as const,semantic_run_id:args.semantic_run_id};
  if(parent.child_receipt_id&&parent.child_run_id&&parent.child_status==="completed")
    return{contract_version:"brand-context-composed-advance-v1" as const,state:"completed" as const,
      semantic_run_id:args.semantic_run_id,prototype_run_id:parent.child_run_id,
      prototype_receipt_id:parent.child_receipt_id,replayed:true};
  if(parent.child_receipt_id&&(!parent.child_run_id||!['failed','canceled'].includes(parent.child_status??'')))
    return{contract_version:"brand-context-composed-advance-v1" as const,
      state:"blocked" as const,semantic_run_id:args.semantic_run_id,error_code:"brand_context_prototype_prior_run_unresolved"};
  try{
    const quote=await (args.prepare_quote??prepareSignalBrandContextPrototypeQuoteV1)({database:args.database,
      parent_receipt_id:parent.parent_receipt_id,actor_user_id:parent.actor_user_id});
    if(parent.child_receipt_id&&quote.supersedes_receipt_id!==parent.child_receipt_id)
      return{contract_version:"brand-context-composed-advance-v1" as const,
        state:"blocked" as const,semantic_run_id:args.semantic_run_id,error_code:"brand_context_prototype_prior_run_unresolved"};
    if(quote.requires_confirmation)return{contract_version:"brand-context-composed-advance-v1" as const,
      state:"awaiting_authorization" as const,semantic_run_id:args.semantic_run_id,replayed:false};
    const idempotencyKey=parent.child_receipt_id
      ?`brand-context-prototypes:${parent.parent_receipt_id}:${parent.child_receipt_id}`
      :`brand-context-prototypes:${parent.parent_receipt_id}`;
    const started=await (args.start_processing??startSignalBrandContextPrototypeProcessingV1)({database:args.database,
      parent_receipt_id:parent.parent_receipt_id,actor_user_id:parent.actor_user_id,
      idempotency_key:idempotencyKey,confirmation:undefined,provider_available:args.provider_available,
      expected_quote_digest:parent.child_receipt_id?quote.quote_digest:undefined});
    return{contract_version:"brand-context-composed-advance-v1" as const,state:started.state,
      semantic_run_id:args.semantic_run_id,prototype_run_id:started.run_id,
      prototype_receipt_id:started.receipt_id,replayed:started.replayed};
  }catch(error){
    if(error instanceof SignalSemanticContextProposalExecutionError
      && error.code==="brand_context_prototype_runtime_unavailable")
      return{contract_version:"brand-context-composed-advance-v1" as const,state:"runtime_unavailable" as const,
        semantic_run_id:args.semantic_run_id,replayed:false};
    throw error;
  }
}

/** Periodic recovery seam for a worker drainer. It discovers only settled
 * composed parents with no Stage2 receipt, or a latest DNC-safe Stage2 leaf, and
 * advances each with a deterministic key derived only from immutable receipts. */
export async function advancePendingSignalBrandContextComposedProcessingV1(args:{database:Database;
  provider_available:boolean;batch_size?:number}){
  const batchSize=Math.max(1,Math.min(args.batch_size??20,100));
  const client=await args.database.connect();let ids:string[]=[];
  try{await client.query("BEGIN READ ONLY");ids=(await client.query<{id:string}>(`SELECT run.id::text
    FROM signal_brand_context_processing_receipts receipt
    JOIN signal_semantic_context_proposal_runs run ON run.id=receipt.semantic_run_id
    JOIN signal_semantic_context_budget_reservations reservation ON reservation.run_id=run.id
    WHERE run.status='completed' AND run.provider_call_state='settled' AND run.provider_call_count=1
     AND run.appended_operation_id IS NOT NULL AND run.result_digest IS NOT NULL
     AND reservation.status='settled' AND reservation.actual_micro_usd=run.settled_micro_usd
     AND (NOT EXISTS(SELECT 1 FROM signal_brand_context_prototype_receipts child
       WHERE child.parent_receipt_id=receipt.id)
      OR EXISTS(SELECT 1 FROM signal_brand_context_prototype_receipts child
       WHERE child.parent_receipt_id=receipt.id
        AND NOT EXISTS(SELECT 1 FROM signal_brand_context_prototype_receipts successor
          WHERE successor.supersedes_receipt_id=child.id)
        AND signal_brand_context_prototype_retry_safe_v1(child.run_id)))
    ORDER BY run.completed_at,run.id LIMIT $1`,[batchSize])).rows.map(row=>row.id);
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{client.release();}
  const results=[];for(const semantic_run_id of ids){
    try{results.push(await advanceSignalBrandContextComposedProcessingV1({database:args.database,
      semantic_run_id,provider_available:args.provider_available}));}
    catch(error){results.push({contract_version:"brand-context-composed-advance-v1" as const,
      state:"blocked" as const,semantic_run_id,error_code:error instanceof SignalSemanticContextProposalExecutionError
        ?error.code:"brand_context_composed_advance_failed"});}
  }
  return results;
}

/** Server-only Stage2 adapter. Its caller supplies identity, intent and runtime
 * health only; all plan bytes, profile, provider, model, quote and caps are read
 * or rebuilt inside this transaction. A successor uses a new key and the exact
 * quote digest obtained server-side; SQL0157 proves the latest child is DNC.
 * Historical replay reports its current status and never rearms the old run. */
export async function startSignalBrandContextPrototypeProcessingV1(args:{database:Database;parent_receipt_id:string;
  actor_user_id:string;idempotency_key:string;confirmation?:typeof confirmation;provider_available:boolean;
  expected_quote_digest?:string
},dependencies:{publish?:typeof publishSignalBrandContextComposedGenerationWithQueryableV1;
  ensure_catalog?:typeof ensureSignalBrandContextPrototypeCatalogStoreV1;
  load_plan?:typeof loadSignalWorkspaceTopicPrototypePlanV1}={}):Promise<SignalBrandContextPrototypeProcessingV1>{
  if(!uuid.test(args.parent_receipt_id)||!uuid.test(args.actor_user_id)||!key.test(args.idempotency_key)
    ||args.confirmation!==undefined&&args.confirmation!==confirmation
    ||args.expected_quote_digest!==undefined&&!digest.test(args.expected_quote_digest))return fail("brand_context_prototype_request_invalid",422);
  const client=await args.database.connect();
  try{
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    const parent=(await client.query<{workspace_id:string;generation_id:string}>(`SELECT workspace_id::text,generation_id::text
      FROM signal_brand_context_processing_receipts WHERE id=$1::uuid AND actor_user_id=$2::uuid`,
      [args.parent_receipt_id,args.actor_user_id])).rows[0];
    if(!parent)return fail("processing_forbidden",403);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`signal-semantic-context:${parent.workspace_id}`]);
    const prior=(await client.query<Receipt>(`SELECT receipt.* FROM signal_brand_context_prototype_receipts receipt
      WHERE receipt.workspace_id=$1::uuid AND receipt.actor_user_id=$2::uuid AND receipt.idempotency_key=$3`,
      [parent.workspace_id,args.actor_user_id,args.idempotency_key])).rows[0];
    let result:Authorization|undefined;let requiresProvider:boolean;
    if(prior){
      if(prior.parent_receipt_id!==args.parent_receipt_id||(args.confirmation??null)!==prior.confirmation
        ||args.expected_quote_digest!==undefined&&args.expected_quote_digest!==prior.quote_digest)
        return fail("processing_idempotency_conflict");
      result=await authorize(client,{...args,pack_digest:prior.pack_digest,plan:prior.plan,
        quote_digest:prior.quote_digest,confirmation:prior.confirmation});
      requiresProvider=(await client.query<{required:boolean}>(`SELECT EXISTS(SELECT 1 FROM jsonb_object_keys($1::jsonb->'texts') input(text_sha256)
        WHERE NOT EXISTS(SELECT 1 FROM signal_workspace_chunk_embeddings cache WHERE cache.workspace_id=$2::uuid
          AND cache.config_digest=$1::jsonb->'embedding_profile'->>'config_digest' AND cache.chunk_sha256=input.text_sha256)) required`,
        [JSON.stringify(prior.plan),parent.workspace_id])).rows[0]?.required??true;
    }else{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`signal-taxonomy:${parent.workspace_id}:topic`]);
      const published=await (dependencies.publish??publishSignalBrandContextComposedGenerationWithQueryableV1)({queryable:client,
        parent_receipt_id:args.parent_receipt_id,actor_user_id:args.actor_user_id});
      await (dependencies.ensure_catalog??ensureSignalBrandContextPrototypeCatalogStoreV1)({client,workspace_id:parent.workspace_id,
        actor_user_id:args.actor_user_id,parent_receipt_id:args.parent_receipt_id,
        generation_id:published.generation_id,pack_digest:published.pack_digest});
      const plan=await (dependencies.load_plan??loadSignalWorkspaceTopicPrototypePlanV1)({queryable:client,workspace_id:parent.workspace_id,
        actor_user_id:args.actor_user_id});
      const quoted=(await client.query<{value:Quote}>("SELECT quote_signal_brand_context_prototypes_v1($1::uuid,$2::uuid,$3::jsonb) value",
        [args.parent_receipt_id,args.actor_user_id,JSON.stringify(plan)])).rows[0]?.value;
      if(!quoted||!digest.test(quoted.quote_digest)||quoted.quote_snapshot.pack_digest!==published.pack_digest
        ||quoted.quote_snapshot.supersedes_receipt_id!==null&&!uuid.test(quoted.quote_snapshot.supersedes_receipt_id))
        return fail("brand_context_prototype_quote_invalid");
      // The quote itself checks the latest child with the DB DNC predicate.
      // Do not infer retryability from a generic failed status or an error code.
      if(quoted.quote_snapshot.supersedes_receipt_id!==null&&args.expected_quote_digest===undefined
        ||args.expected_quote_digest!==undefined&&args.expected_quote_digest!==quoted.quote_digest)
        return fail("brand_context_prototype_quote_changed");
      if(quoted.quote_snapshot.refreshes_completed_plan===true&&args.confirmation!==confirmation)
        return fail("brand_context_prototype_awaiting_authorization");
      requiresProvider=quoted.quote_snapshot.requires_provider===true;
      if(requiresProvider&&!args.provider_available)return fail("brand_context_prototype_runtime_unavailable",503);
      result=await authorize(client,{parent_receipt_id:args.parent_receipt_id,actor_user_id:args.actor_user_id,
        idempotency_key:args.idempotency_key,pack_digest:published.pack_digest,plan,quote_digest:quoted.quote_digest,
        confirmation:args.confirmation??null});
    }
    const receipt=result?.receipt;
    if(!result||!receipt||!uuid.test(result.run_id)||result.run_id!==receipt.run_id||!uuid.test(receipt.id)
      ||receipt.parent_receipt_id!==args.parent_receipt_id||receipt.workspace_id!==parent.workspace_id
      ||receipt.generation_id!==parent.generation_id||receipt.actor_user_id!==args.actor_user_id)
      return fail("brand_context_prototype_receipt_invalid");
    const run=(await client.query<{status:string;processing_admission_id:string}>(`SELECT status,processing_admission_id::text
      FROM signal_workspace_embedding_runs WHERE id=$1::uuid AND workspace_id=$2::uuid AND input_contract='topic_prototypes'`,
      [receipt.run_id,parent.workspace_id])).rows[0];
    if(!run||run.processing_admission_id!==receipt.admission_id||!prototypeStates.some(state=>state===run.status)
      ||!result.replayed&&run.status!=="queued")
      return fail("brand_context_prototype_receipt_invalid");
    await client.query("COMMIT");
    return{contract_version:"brand-context-prototype-processing-v1",workspace_id:parent.workspace_id,
      generation_id:parent.generation_id,run_id:receipt.run_id,receipt_id:receipt.id,
      state:run.status as SignalBrandContextPrototypeProcessingV1["state"],replayed:result.replayed,requires_provider:requiresProvider};
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);mapError(error);}finally{client.release();}
}

/** Requeue only the original, definitely-unspent Claude run while its exact
 * Stage1 admission is still valid. It never creates another reservation, run,
 * admission, receipt or provider call. */
export async function retrySignalBrandContextComposedSemanticRunV1(args:{database:Database;parent_receipt_id:string;
  actor_user_id:string;idempotency_key:string;configuration:SignalSemanticContextProposalRuntimeConfigurationV1;
  runtime:{queue_configured:boolean;worker_alive:boolean;recovery_alive:boolean}
}){
  if(!uuid.test(args.parent_receipt_id)||!uuid.test(args.actor_user_id)||!key.test(args.idempotency_key))
    return fail("brand_context_semantic_retry_request_invalid",422);
  const configuration=args.configuration;
  const client=await args.database.connect();
  try{
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    const scope=(await client.query<{workspace_id:string}>(`SELECT workspace_id::text FROM signal_brand_context_processing_receipts
      WHERE id=$1::uuid AND actor_user_id=$2::uuid`,[args.parent_receipt_id,args.actor_user_id])).rows[0];
    if(!scope)return fail("processing_forbidden",403);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`signal-semantic-context:${scope.workspace_id}`]);
    const row=(await client.query<{workspace_id:string;organization_id:string;brand_id:string;actor_user_id:string;
      run_id:string;run_key:string;admission_id:string;hard_cap_micro_usd:string;admission_not_after:string;
      status:string;provider_call_state:string;provider_call_count:number;provider_response_private:string|null;lease_token:string|null;
      provider:string;model:string;configuration:Record<string,unknown>}>(`SELECT receipt.workspace_id::text,receipt.organization_id::text,
      receipt.brand_id::text,receipt.actor_user_id::text,run.id::text run_id,run.run_key,admission.id::text admission_id,
      run.hard_cap_micro_usd::text,admission.admission_not_after::text,run.status,run.provider_call_state,
      run.provider_call_count,run.provider_response_private,run.lease_token::text,run.provider,run.model,
      jsonb_build_object('provider',run.provider,'model',run.model,'model_version',run.model_version,
       'pricing_version',run.pricing_version,'max_input_tokens',run.max_input_tokens,'max_output_tokens',run.max_output_tokens,
       'input_usd_per_million_tokens',run.input_usd_per_million_tokens,
       'output_usd_per_million_tokens',run.output_usd_per_million_tokens) configuration
      FROM signal_brand_context_processing_receipts receipt
      JOIN signal_processing_admissions admission ON admission.id=receipt.semantic_admission_id
       AND admission.target_id=receipt.semantic_run_id AND admission.brand_context_processing_receipt_id=receipt.id
      JOIN signal_semantic_context_proposal_runs run ON run.id=receipt.semantic_run_id
       AND run.processing_admission_id=admission.id AND run.brand_context_preparation_operation_id IS NULL
      WHERE receipt.id=$1::uuid AND receipt.actor_user_id=$2::uuid FOR UPDATE OF run`,
      [args.parent_receipt_id,args.actor_user_id])).rows[0];
    if(!row)return fail("processing_forbidden",403);
    const hashed=operationKey(args.idempotency_key);
    const requestDigest=signalSemanticContextProposalDigestV1({contract_version:"signal-product-operation-v1",
      workspace_id:row.workspace_id,action:"retry-semantic-context-proposal-run",input:{run_key:row.run_key,parent_receipt_id:args.parent_receipt_id}});
    let operation=(await client.query<{id:string;actor_user_id:string;action:string;request_digest:string;status:string;result:{run_id?:string}|null}>(`
      SELECT id::text,actor_user_id::text,action,request_digest,status,result FROM signal_governance_control_operations
      WHERE workspace_id=$1::uuid AND idempotency_key=$2 FOR UPDATE`,[row.workspace_id,hashed])).rows[0];
    if(operation){
      if(operation.actor_user_id!==args.actor_user_id||operation.action!=="retry-semantic-context-proposal-run"
        ||operation.request_digest!==requestDigest)return fail("processing_idempotency_conflict");
      if(operation.status==="completed"&&operation.result?.run_id===row.run_id){await client.query("COMMIT");
        return{contract_version:"brand-context-semantic-retry-v1" as const,run_id:row.run_id,run_key:row.run_key,
          status:"queued" as const,replayed:true,admission_not_after:new Date(row.admission_not_after).toISOString()};}
      if(operation.status!=="in_progress")return fail("operation_state_invalid");
    }
    if(!args.runtime.queue_configured||!args.runtime.worker_alive||!args.runtime.recovery_alive||!configuration.available
      ||configuration.provider!=="anthropic"||configuration.model!=="claude-sonnet-4-6")
      return fail("brand_context_processing_runtime_unavailable",503);
    const actual={provider:configuration.provider,model:configuration.model,model_version:configuration.model_version,
      pricing_version:configuration.pricing_version,max_input_tokens:configuration.max_input_tokens,
      max_output_tokens:configuration.max_output_tokens,input_usd_per_million_tokens:configuration.input_usd_per_million_tokens,
      output_usd_per_million_tokens:configuration.output_usd_per_million_tokens};
    const compatible=(await client.query<{allowed:boolean}>(
      "SELECT signal_processing_configuration_allows_v1('brand_context_proposal',$1::jsonb,$2::jsonb) allowed",
      [JSON.stringify(actual),JSON.stringify(row.configuration)])).rows[0]?.allowed;
    if(!compatible||BigInt(row.hard_cap_micro_usd)>configuration.platform_hard_cap_micro_usd)
      return fail("brand_context_processing_runtime_drift");
    try{await client.query(`SELECT signal_processing_capacity_v1($1::uuid,$2::uuid,$3::uuid,$4::uuid,
      ARRAY['brand_context_proposal'],$5,$6,$7::jsonb,$8::bigint)`,[row.workspace_id,args.actor_user_id,row.run_id,
      row.admission_id,row.provider,row.model,JSON.stringify(row.configuration),row.hard_cap_micro_usd]);}
    catch(error){const message=error instanceof Error?error.message:"";
      if(["processing_policy_expired","processing_admission_invalid","processing_budget_date_expired"].includes(message))
        return fail("brand_context_semantic_authorization_expired");mapError(error);}
    if(!operation){
      await client.query(`INSERT INTO signal_governance_control_operations(workspace_id,actor_user_id,action,request_digest,idempotency_key,status)
        VALUES($1::uuid,$2::uuid,'retry-semantic-context-proposal-run',$3,$4,'in_progress')`,
        [row.workspace_id,args.actor_user_id,requestDigest,hashed]);
      operation=(await client.query<{id:string;actor_user_id:string;action:string;request_digest:string;status:string;result:null}>(`
        SELECT id::text,actor_user_id::text,action,request_digest,status,result FROM signal_governance_control_operations
        WHERE workspace_id=$1::uuid AND idempotency_key=$2 FOR UPDATE`,[row.workspace_id,hashed])).rows[0];
    }
    if(!operation||operation.status!=="in_progress")return fail("operation_state_invalid");
    const retries=(await client.query<{count:string}>(`SELECT ((SELECT count(*) FROM signal_governance_control_operations
      WHERE workspace_id=$1::uuid AND action='retry-semantic-context-proposal-run' AND status='completed'
       AND (result->>'run_id'=$2 OR result->>'run_key'=$3))+(SELECT count(*) FROM signal_brand_context_semantic_renewals
      WHERE workspace_id=$1::uuid AND run_id=$2::uuid))::text count`,[row.workspace_id,row.run_id,row.run_key])).rows[0]?.count??"0";
    if(operation.status!=="in_progress"||Number(retries)>=8||row.status!=="failed"||row.provider_call_state!=="not_started"
      ||row.provider_call_count!==0||row.provider_response_private!==null||row.lease_token!==null)
      return fail("semantic_context_proposal_run_not_retryable");
    const changed=await client.query(`UPDATE signal_semantic_context_proposal_runs SET status='queued',failed_at=NULL,
      error_code=NULL,error_summary=NULL,updated_at=clock_timestamp() WHERE id=$1::uuid AND status='failed'
       AND provider_call_state='not_started' AND provider_call_count=0 AND provider_response_private IS NULL AND lease_token IS NULL`,[row.run_id]);
    if(changed.rowCount!==1)return fail("semantic_context_proposal_run_not_retryable");
    const outbox=await client.query(`UPDATE signal_semantic_context_proposal_outbox SET status='pending',available_at=clock_timestamp(),
      error_summary=NULL,completed_at=NULL,updated_at=clock_timestamp() WHERE run_id=$1::uuid`,[row.run_id]);
    if(outbox.rowCount!==1)return fail("semantic_context_proposal_run_not_retryable");
    const result={run_id:row.run_id,run_key:row.run_key,status:"queued"};
    const eventDigest=signalSemanticContextProposalDigestV1({run_id:row.run_id,transition_key:`recovery-${operation.id}`,
      event_kind:"recovery_queued",detail:{}});
    await client.query(`INSERT INTO signal_semantic_context_proposal_run_events(workspace_id,run_id,transition_key,event_kind,state_digest,detail)
      VALUES($1::uuid,$2::uuid,$3,'recovery_queued',$4,'{}'::jsonb) ON CONFLICT(run_id,transition_key) DO NOTHING`,
      [row.workspace_id,row.run_id,`recovery-${operation.id}`,eventDigest]);
    const completed=await client.query(`UPDATE signal_governance_control_operations SET status='completed',result=$3::jsonb,
      completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE workspace_id=$1::uuid AND idempotency_key=$2 AND status='in_progress'`,
      [row.workspace_id,hashed,JSON.stringify(result)]);
    if(completed.rowCount!==1)return fail("operation_completion_failed");
    await client.query("COMMIT");
    return{contract_version:"brand-context-semantic-retry-v1" as const,...result,replayed:false,
      admission_not_after:new Date(row.admission_not_after).toISOString()};
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);mapError(error);}finally{client.release();}
}
