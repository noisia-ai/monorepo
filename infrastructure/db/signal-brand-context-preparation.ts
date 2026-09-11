import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_CONFIRMATION, SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, SIGNAL_WORKSPACE_EMBEDDING_DEFAULT_MAX_COST_MICRO_USD_V1,
  signalSemanticContextProposalDigestV1 as digest } from '@noisia/query-engine';
import { canonicalBrandContextLocaleV1, resolveSignalBrandContextAuthorityV1,
  type BrandContextWorkspaceV1, type SignalBrandContextAuthorityV1 } from './signal-brand-context-authority';
import { signalSemanticContextProposalRuntimeConfigurationFromEnvV1, buildSignalSemanticContextProposalRuntimeLineageV1, planSignalSemanticContextProposalCapacityForAuthorityV1,
  loadSignalSemanticContextProposalPreflightRuntimeV1, startSignalSemanticContextProposalRunWithClientV1, retrySignalSemanticContextProposalRunWithClientV1,
  SignalSemanticContextProposalExecutionError, type SignalSemanticContextProposalRuntimeConfigurationV1,
  type SignalSemanticContextQueryable } from './signal-semantic-context-proposal';
import { loadSignalWorkspaceCapabilitiesStoreV1 } from './signal-workspace-capabilities';
import { ensureSignalTopicCatalogStoreV1 } from './signal-topic-catalog';
import { quoteSignalWorkspaceTopicPrototypesWithQueryableV1, requestSignalWorkspaceTopicPrototypesWithClientV1 } from './signal-workspace-topic-prototypes-management';

export type SignalBrandContextPreparationRuntimeV1={semantic:SignalSemanticContextProposalRuntimeConfigurationV1;
  prototype:{available:boolean;max_run_cost_micro_usd:number};queue_configured:boolean;worker_alive:boolean;recovery_alive:boolean};
/** The proposal preflight hashes this closed health object. Never forward provider configuration or money here. */
export function signalBrandContextProposalRuntimeCapabilitiesV1(
  runtime:Parameters<typeof loadSignalSemanticContextProposalPreflightRuntimeV1>[0]['runtime']
):Parameters<typeof loadSignalSemanticContextProposalPreflightRuntimeV1>[0]['runtime']{
  return{queue_configured:runtime.queue_configured,worker_alive:runtime.worker_alive,recovery_alive:runtime.recovery_alive};
}
export type SignalBrandContextPreparationAdmissionV1={quote_digest:string;confirmation:'prepare_brand_context_within_shown_cap'};
export type SignalBrandContextPreparationStateV1='awaiting_authorization'|'queued'|'generating'|'activating'|'preparing_prototypes'|'ready'|'failed'|'stale';
export type SignalBrandContextPreparationV1={contract_version:'brand-context-preparation-v1';operation_id:string;
  workspace_id:string;generation_id:string;generation_key:string;state:SignalBrandContextPreparationStateV1;
  semantic_run_id:string|null;prototype_run_id:string|null;active_elements:number;exceptions:number;error_code:string|null;replayed:boolean};
export type SignalBrandContextPreparationQuoteV1={contract_version:'brand-context-preparation-quote-v1';quote_digest:string;
  available:boolean;semantic_cap_micro_usd:string;prototype_cap_micro_usd:string;quote_expires_at:string;admission_not_after:string;
  model:'claude-sonnet-4-6';embedding_model:string;blocked_reason:string|null};
type Database=Pick<Pool,'query'|'connect'>;
type Scope={workspace_id:string;actor_user_id:string};
type PreparationInput={contract_version:'brand-context-preparation-input-v1';primary_locale:string;source_authority_digest:string;
  generation_id:string;generation_key:string;admission:(SignalBrandContextPreparationQuoteV1&{configuration_digest:string})|null;
  reconciliation_reason?:'terminal_provider_run';expected_generation_key?:string;replaced_prototype_run_ids?:string[]};
type Operation={brand_context_progress:{attempt:number;last_error:string;retry_at:string}|null;action:string;id:string;workspace_id:string;actor_user_id:string;request_digest:string;status:string;result:SignalBrandContextPreparationV1|null;
  brand_context_preparation:PreparationInput};
const fail=(code:string,status=409):never=>{throw new SignalSemanticContextProposalExecutionError(code,status);};
const configDigest=(runtime:SignalBrandContextPreparationRuntimeV1)=>digest({semantic:{...runtime.semantic,
  platform_hard_cap_micro_usd:runtime.semantic.platform_hard_cap_micro_usd.toString(),available:true},
  prototype:{profile:SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,max_run_cost_micro_usd:runtime.prototype.max_run_cost_micro_usd}});
const quoteWindow=15*60*1000;
/** Read-only quote: a bounded server clock window can be reconstructed at submit; no bearer grant. */
export function quoteSignalBrandContextPreparationV1(args:{actor_user_id:string;runtime:SignalBrandContextPreparationRuntimeV1;now?:Date}):SignalBrandContextPreparationQuoteV1 {
  const now=args.now??new Date();
  const available=args.runtime.queue_configured&&args.runtime.worker_alive&&args.runtime.recovery_alive&&args.runtime.semantic.available&&args.runtime.semantic.model==='claude-sonnet-4-6'
    &&args.runtime.semantic.model_version==='claude-sonnet-4-6'&&args.runtime.semantic.platform_hard_cap_micro_usd>0n
    &&args.runtime.prototype.available&&Number.isSafeInteger(args.runtime.prototype.max_run_cost_micro_usd)&&args.runtime.prototype.max_run_cost_micro_usd>=0;
  const payload={contract_version:'brand-context-preparation-quote-v1' as const,available,
    semantic_cap_micro_usd:args.runtime.semantic.platform_hard_cap_micro_usd.toString(),
    prototype_cap_micro_usd:String(args.runtime.prototype.max_run_cost_micro_usd),
    quote_expires_at:new Date((Math.floor(now.getTime()/quoteWindow)+2)*quoteWindow).toISOString(),
    admission_not_after:new Date(Math.floor(now.getTime()/quoteWindow)*quoteWindow+24*60*60*1000).toISOString(),
    model:'claude-sonnet-4-6' as const,embedding_model:SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1.model,
    blocked_reason:available?null:'brand_context_provider_configuration_unavailable'};
  return {...payload,quote_digest:digest({actor_user_id:args.actor_user_id.toLowerCase(),configuration_digest:configDigest(args.runtime),...payload})};
}
function acceptedQuote(args:{actor_user_id:string;runtime:SignalBrandContextPreparationRuntimeV1;admission:SignalBrandContextPreparationAdmissionV1;now:Date}){
  if(args.admission.confirmation!=='prepare_brand_context_within_shown_cap')return fail('brand_context_confirmation_required',422);
  for(const offset of [0,quoteWindow]){const quote=quoteSignalBrandContextPreparationV1({...args,now:new Date(args.now.getTime()-offset)});
    if(quote.quote_digest===args.admission.quote_digest&&quote.available&&Date.parse(quote.quote_expires_at)>args.now.getTime())
      return {...quote,configuration_digest:configDigest(args.runtime)};}
  return fail('brand_context_quote_changed',409);
}
async function transaction<T>(database:Database,work:(client:PoolClient)=>Promise<T>,readOnly=false){const c=await database.connect();
  try{await c.query(readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');const result=await work(c);await c.query('COMMIT');return result;}
  catch(error){await c.query('ROLLBACK').catch(()=>undefined);throw error;}finally{c.release();}}
async function workspace(c:SignalSemanticContextQueryable,args:Scope,mutate:boolean):Promise<BrandContextWorkspaceV1>{
  const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:c,...args});
  if(!caps.can_view||mutate&&!caps.can_execute_topics)return fail('brand_context_forbidden',403);
  const row=(await c.query<{organization_id:string;brand_id:string;timezone:string;internal:boolean}>(`SELECT w.organization_id::text,w.brand_id::text,w.timezone,
    u.user_type='noisia_internal' internal FROM signal_workspaces w JOIN users u ON u.id=$2::uuid WHERE w.id=$1::uuid AND w.status='active'`,[args.workspace_id,args.actor_user_id])).rows[0];
  if(!row?.brand_id||mutate&&!row.internal)return fail('brand_context_forbidden',403);
  return{id:args.workspace_id,organizationId:row.organization_id,subject:{type:'brand',id:row.brand_id},timezone:row.timezone};
}
async function beginOperation(c:SignalSemanticContextQueryable,args:Scope,key:string,action:string,input:unknown,preparation?:PreparationInput){
  const hashed=digest(key);const requestDigest=digest({contract_version:'signal-product-operation-v1',workspace_id:args.workspace_id,action,input});
  const prior=(await c.query<Operation>('SELECT * FROM signal_governance_control_operations WHERE workspace_id=$1::uuid AND idempotency_key=$2',[args.workspace_id,hashed])).rows[0];
  if(prior){if(prior.actor_user_id!==args.actor_user_id||prior.action!==action||prior.request_digest!==requestDigest)return fail('brand_context_idempotency_conflict');return prior;}
  // This insertion follows the workspace lock. now() would retain transaction
  // start time and let an older transaction or UUID order win over acceptance.
  return(await c.query<Operation>(`INSERT INTO signal_governance_control_operations(workspace_id,actor_user_id,action,request_digest,idempotency_key,brand_context_preparation,created_at)
    VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::jsonb,clock_timestamp()) RETURNING *`,[args.workspace_id,args.actor_user_id,action,requestDigest,hashed,preparation?JSON.stringify(preparation):null])).rows[0]!;
}
async function completeOperation(c:SignalSemanticContextQueryable,id:string,result:unknown){const changed=await c.query(`UPDATE signal_governance_control_operations SET status='completed',result=$2::jsonb,
  completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid AND status='in_progress'`,[id,JSON.stringify(result)]);if(changed.rowCount!==1)return fail('brand_context_operation_conflict');}
export type SignalBrandContextPreparationEnsureArgsV1=Scope&{database:Database;idempotency_key:string;primary_locale?:string;
  admission?:SignalBrandContextPreparationAdmissionV1;runtime:SignalBrandContextPreparationRuntimeV1;
  reconciliation_reason?:'terminal_provider_run';expected_generation_key?:string};
export async function ensureSignalBrandContextPreparationV1(args:SignalBrandContextPreparationEnsureArgsV1):Promise<SignalBrandContextPreparationV1>{
  if(!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key))return fail('brand_context_idempotency_key_required',422);
  const terminal=args.reconciliation_reason==='terminal_provider_run';
  if(args.reconciliation_reason!==undefined&&!terminal||terminal&&(typeof args.expected_generation_key!=='string'||!args.expected_generation_key
    ||!/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u.test(args.expected_generation_key)||args.expected_generation_key.length>160)
    ||!terminal&&args.expected_generation_key!==undefined)return fail('brand_context_reconciliation_invalid',422);
  if(terminal&&args.admission!==undefined)return fail('brand_context_terminal_admission_forbidden',422);
  const reconciliation=terminal?{reconciliation_reason:'terminal_provider_run' as const,expected_generation_key:args.expected_generation_key!}:{};
  return transaction(args.database,async c=>{
    const ws=await workspace(c,args,true);await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`signal-semantic-context:${args.workspace_id}`]);
    const request={primary_locale:args.primary_locale?canonicalBrandContextLocaleV1(args.primary_locale):null,admission:args.admission??null,...reconciliation};
    const key=digest(args.idempotency_key);const requestDigest=digest({contract_version:'signal-product-operation-v1',workspace_id:args.workspace_id,action:'prepare-brand-context',input:request});
    const prior=(await c.query<Operation>('SELECT * FROM signal_governance_control_operations WHERE workspace_id=$1::uuid AND idempotency_key=$2',[args.workspace_id,key])).rows[0];
    if(prior){if(prior.action!=='prepare-brand-context'||prior.actor_user_id!==args.actor_user_id||prior.request_digest!==requestDigest||!prior.result)return fail('brand_context_idempotency_conflict');
      return{...prior.result,replayed:true};}
    const now=(await c.query<{now:Date}>('SELECT clock_timestamp() now')).rows[0]!.now;
    let admission=args.admission?acceptedQuote({...args,admission:args.admission,now:new Date(now)}):null;
    const live=await resolveSignalBrandContextAuthorityV1({queryable:c,workspace:ws,primary_locale:request.primary_locale??undefined});
    const generation=await ensureGeneration(c,{...args,admitted_configuration_digest:admission?.configuration_digest},ws,live);
    if(generation.completed_stale_predecessor_run_id)admission=null;
    const replacements:string[]=[];
    if(admission){
      const incompatible=await c.query<{id:string;actor_user_id:string;safe_unspent:boolean}>(`SELECT run.id,run.actor_user_id,
        signal_brand_context_prototype_unspent_v1(run.id) safe_unspent FROM signal_workspace_embedding_runs run
        JOIN signal_governance_control_operations origin ON origin.id=run.brand_context_preparation_operation_id
        WHERE origin.brand_context_preparation->>'generation_id'=$1 AND run.status<>'canceled'
          AND origin.brand_context_preparation->'admission'->>'configuration_digest' IS DISTINCT FROM $2
        ORDER BY run.id FOR UPDATE OF run`,[generation.id,admission.configuration_digest]);
      for(const run of incompatible.rows){
        if(generation.status!=='published'||!run.safe_unspent||run.actor_user_id!==args.actor_user_id)
          return fail('brand_context_existing_run_configuration_changed');
        replacements.push(run.id);
      }
    }
    const input:PreparationInput={contract_version:'brand-context-preparation-input-v1',primary_locale:live.primaryLocale,
      source_authority_digest:live.sourceAuthorityDigest,generation_id:generation.id,generation_key:generation.generation_key,admission,...reconciliation,...(replacements.length?{replaced_prototype_run_ids:replacements}:{})};
    const op=await beginOperation(c,args,args.idempotency_key,'prepare-brand-context',request,input);
    const result:SignalBrandContextPreparationV1={contract_version:'brand-context-preparation-v1',operation_id:op.id,workspace_id:args.workspace_id,
      generation_id:generation.id,generation_key:generation.generation_key,state:admission?'queued':'awaiting_authorization',
      semantic_run_id:null,prototype_run_id:null,active_elements:0,exceptions:0,error_code:null,replayed:false};
    for(const runId of replacements){
      const closed=await c.query(`UPDATE signal_workspace_embedding_runs SET status='canceled',updated_at=clock_timestamp()
        WHERE id=$1::uuid AND workspace_id=$2::uuid AND actor_user_id=$3::uuid AND status='failed'
          AND signal_brand_context_prototype_unspent_v1(id)`,[runId,args.workspace_id,args.actor_user_id]);
      if(closed.rowCount!==1)return fail('brand_context_existing_run_configuration_changed');
    }
    await completeOperation(c,op.id,result);return result;
  });
}
type Generation={id:string;generation_key:string;generation_version:number;status:'draft'|'published';source_digest:string;
  brand_os_profile_id:string;brand_os_digest:string;knowledge_digest:string;locale_context_digest:string;
  proposal_provider_lineage:Record<string,unknown>|null;proposal_provider_lineage_digest:string|null;
  draft_digest:string;pack_digest:string|null;completed_stale_predecessor_run_id?:string};
/** Capacity stays sealed to the source; compare the complete canonical runtime portion before reusing an unconsumed draft. */
export function signalBrandContextGenerationRuntimeMatchesV1(lineage:Record<string,unknown>,configuration:SignalSemanticContextProposalRuntimeConfigurationV1){
  if(!configuration.available)return false;
  const expected=buildSignalSemanticContextProposalRuntimeLineageV1(configuration);
  return Object.entries(expected).filter(([key])=>key!=='capacity'&&key!=='lineage_digest')
    .every(([key,value])=>lineage[key]!==undefined&&digest(lineage[key])===digest(value));
}
async function ensureGeneration(c:PoolClient,args:Scope&{runtime:SignalBrandContextPreparationRuntimeV1;admitted_configuration_digest?:string;
  reconciliation_reason?:'terminal_provider_run';expected_generation_key?:string},ws:BrandContextWorkspaceV1,live:SignalBrandContextAuthorityV1):Promise<Generation>{
  const current=(await c.query<Generation>(`SELECT gen.*,artifact.workspace_authority_digest source_digest FROM signal_semantic_context_generations gen
    JOIN analysis_artifacts artifact ON artifact.id=gen.artifact_id WHERE gen.workspace_id=$1::uuid
    ORDER BY gen.generation_version DESC LIMIT 1 FOR UPDATE OF gen`,[ws.id])).rows[0];
  const explicitTerminal=args.reconciliation_reason==='terminal_provider_run';
  if(explicitTerminal){
    if(!current||current.generation_key!==args.expected_generation_key)return fail('brand_context_generation_changed');
    if(current.status!=='draft')return fail('semantic_context_terminal_run_not_eligible');
    await assertTerminalGeneration(c,ws.id,current.id);
  }
  const previousRun=current&&!explicitTerminal?(await c.query<{id:string;created_by_user_id:string;configuration_digest:string|null;safe_unspent:boolean;completed_history:boolean}>(`SELECT run.id,run.created_by_user_id,
    origin.brand_context_preparation->'admission'->>'configuration_digest' configuration_digest,
    signal_brand_context_unspent_run_v1(run.id) safe_unspent,signal_brand_context_completed_history_v1(run.id) completed_history FROM signal_semantic_context_proposal_runs run
    LEFT JOIN signal_governance_control_operations origin ON origin.id=run.brand_context_preparation_operation_id
    WHERE run.generation_id=$1::uuid FOR UPDATE OF run`,[current.id])).rows[0]:undefined;
  const changedConfiguration=Boolean(current?.status==='draft'&&args.admitted_configuration_digest&&(
    previousRun?previousRun.configuration_digest!==args.admitted_configuration_digest:
      current.proposal_provider_lineage&&!signalBrandContextGenerationRuntimeMatchesV1(current.proposal_provider_lineage,args.runtime.semantic)));
  if(changedConfiguration&&!previousRun&&(await c.query(`SELECT 1 FROM signal_semantic_context_element_versions
    WHERE generation_id=$1::uuid LIMIT 1`,[current!.id])).rows.length)return fail('brand_context_existing_run_configuration_changed');
  if(!explicitTerminal&&current?.source_digest===live.sourceAuthorityDigest&&(!args.runtime.semantic.available||current.proposal_provider_lineage)&&!changedConfiguration)return current;
  const completedDrift=Boolean(current?.status==='draft'&&current.source_digest!==live.sourceAuthorityDigest
    &&previousRun?.completed_history&&previousRun.created_by_user_id===args.actor_user_id);
  let terminal=explicitTerminal;
  if(!completedDrift&&current?.status==='draft'&&previousRun){
    if(!args.admitted_configuration_digest||!previousRun.safe_unspent||previousRun.created_by_user_id!==args.actor_user_id)
      return fail(changedConfiguration?'brand_context_existing_run_configuration_changed':'brand_context_previous_generation_unfinished');
    // The old immutable run and its error remain. Only its proven unspent reservation and dispatch close.
    await c.query(`UPDATE signal_semantic_context_budget_reservations SET status='released',released_at=clock_timestamp(),
      release_reason='brand_context_unspent_successor' WHERE run_id=$1::uuid AND status='reserved'`,[previousRun.id]);
    const outbox=await c.query(`UPDATE signal_semantic_context_proposal_outbox SET status='completed',lease_token=NULL,lease_expires_at=NULL,
      completed_at=clock_timestamp(),updated_at=clock_timestamp(),error_summary='brand_context_unspent_successor' WHERE run_id=$1::uuid`,[previousRun.id]);
    if(outbox.rowCount!==1)return fail('brand_context_outbox_missing');
    terminal=true;
  }
  const driftReason=completedDrift?(current!.brand_os_profile_id!==live.brandOsProfileId||current!.brand_os_digest!==live.brandOsDigest?'brand_os_drift':
    current!.knowledge_digest!==live.knowledgeDigest?'knowledge_drift':'locale_market_drift'):null;
  const version=(current?.generation_version??0)+1;const generationKey=`semantic-context-v${version}`;
  const capacity=args.runtime.semantic.available?await planSignalSemanticContextProposalCapacityForAuthorityV1({queryable:c,
    workspace:{id:ws.id,organization_id:ws.organizationId,brand_id:ws.subject.id},authority:{generation_key:generationKey,
      brand_os_profile_id:live.brandOsProfileId,brand_os_digest:live.brandOsDigest,knowledge_digest:live.knowledgeDigest,
      locale_context_digest:live.localeContextDigest,primary_locale:live.primaryLocale,locale_variants:live.localeVariants,markets:live.markets,timezone:live.timezone}}):null;
  const lineage=capacity?buildSignalSemanticContextProposalRuntimeLineageV1(args.runtime.semantic,capacity):null;
  const draftDigest=digest({contract_version:'signal-semantic-context-pack-v1',generation_key:generationKey,source_authority_digest:live.sourceAuthorityDigest,elements:[]});
  const operation=await beginOperation(c,args,`brand-context-generation:${ws.id}:${version}:${live.sourceAuthorityDigest}`,
    current?'reconcile-semantic-context-generation':'create-semantic-context-draft',{source_authority_digest:live.sourceAuthorityDigest,
      ...(explicitTerminal?{reconciliation_reason:'terminal_provider_run',expected_generation_key:args.expected_generation_key}:{})});
  const artifact=(await c.query<{id:string}>(`INSERT INTO analysis_artifacts(workspace_id,workspace_artifact_kind,workspace_authority_digest,
    artifact_key,artifact_type,content,review_status,revision,metadata) VALUES($1::uuid,'semantic_context',$2,$3,'semantic_context_pack_generation',
    $4::jsonb,'needs_review',1,$5::jsonb) RETURNING id`,[ws.id,live.sourceAuthorityDigest,generationKey,
    JSON.stringify({contract_version:'signal-semantic-context-pack-v1',generation_version:version,lifecycle_state:'draft'}),
    JSON.stringify({authority_only:true,...(completedDrift?{completed_stale_predecessor_run_id:previousRun!.id}:{})})])).rows[0]!;
  const generation=(await c.query<Generation>(`INSERT INTO signal_semantic_context_generations(workspace_id,artifact_id,generation_key,generation_version,
    status,supersedes_generation_id,supersession_reason,brand_os_profile_id,brand_os_profile_version,brand_os_digest,knowledge_generation_key,
    knowledge_digest,locale_context_digest,primary_locale,locale_variants,markets,timezone,proposal_model,proposal_model_version,proposal_prompt_digest,
    proposal_pricing_version,proposal_provider_lineage,proposal_provider_lineage_digest,draft_digest,created_operation_id,created_by_user_id)
    VALUES($1::uuid,$2::uuid,$3,$4,'draft',$5::uuid,$6,$7::uuid,$8,$9,$10,$11,$12,$13,$14::text[],$15::text[],$16,
      $17,$18,$19,$20,$21::jsonb,$22,$23,$24::uuid,$25::uuid) RETURNING *`,[ws.id,artifact.id,generationKey,version,current?.id??null,
    current?driftReason??(terminal?'terminal_provider_run':'operator_requested_reconciliation'):null,live.brandOsProfileId,live.brandOsProfileVersion,live.brandOsDigest,live.knowledgeGenerationKey,
    live.knowledgeDigest,live.localeContextDigest,live.primaryLocale,live.localeVariants,live.markets,live.timezone,lineage?.model??null,lineage?.model_version??null,
    lineage?.prompt.digest??null,lineage?.pricing.version??null,lineage?JSON.stringify(lineage):null,lineage?.lineage_digest??null,draftDigest,operation.id,args.actor_user_id])).rows[0]!;
  await event(c,args,generation.id,operation.id,current?'generation_reconciled':'generation_created',current?.pack_digest??current?.draft_digest??null,draftDigest);
  await completeOperation(c,operation.id,{generation_key:generationKey,generation_version:version,status:'draft'});
  return completedDrift?{...generation,completed_stale_predecessor_run_id:previousRun!.id}:generation;
}
/** Mirrors the existing terminal successor boundary. No retirement, revalidation or result reuse occurs here. */
async function assertTerminalGeneration(c:PoolClient,workspaceId:string,generationId:string){
  const run=(await c.query<{status:string;provider_call_state:string;provider_call_count:number;provider_response_digest:string|null;
    reviewable_elements:boolean;executable_outbox:boolean;reserved_budget:boolean}>(`SELECT run.status,
    run.provider_call_state,run.provider_call_count,run.provider_response_digest,
    EXISTS(SELECT 1 FROM signal_semantic_context_element_versions element WHERE element.generation_id=run.generation_id
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor
        WHERE successor.supersedes_element_id=element.id)) reviewable_elements,
    EXISTS(SELECT 1 FROM signal_semantic_context_proposal_outbox outbox WHERE outbox.run_id=run.id
      AND outbox.status IN ('pending','failed','dispatching','dispatched')) executable_outbox,
    EXISTS(SELECT 1 FROM signal_semantic_context_budget_reservations reservation WHERE reservation.run_id=run.id
      AND reservation.status='reserved') reserved_budget
    FROM signal_semantic_context_proposal_runs run WHERE run.workspace_id=$1::uuid AND run.generation_id=$2::uuid
    FOR UPDATE OF run`,[workspaceId,generationId])).rows[0];
  if(!run)return fail('semantic_context_terminal_run_not_eligible');
  if(['queued','processing','validating'].includes(run.status))return fail('semantic_context_proposal_run_active');
  if(['in_flight','response_persisted','outcome_unknown'].includes(run.provider_call_state))
    return fail('semantic_context_provider_outcome_ambiguous');
  if(run.reviewable_elements)return fail('semantic_context_generation_review_required');
  if(run.executable_outbox||run.reserved_budget)return fail('semantic_context_proposal_run_active');
  const eligible=run.status==='failed'&&run.provider_call_state==='settled'
      &&run.provider_call_count===1&&Boolean(run.provider_response_digest)
    ||run.status==='stale'&&['not_started','settled'].includes(run.provider_call_state)
    ||run.status==='dead_letter'&&run.provider_call_state==='not_started'&&run.provider_call_count===0;
  if(!eligible)return fail(run.status==='failed'&&run.provider_call_state==='not_started'
    ?'semantic_context_terminal_run_retry_required':'semantic_context_terminal_run_not_eligible');
}
async function event(c:SignalSemanticContextQueryable,args:Scope,generationId:string,opId:string,kind:string,prior:string|null,next:string){await c.query(`INSERT INTO signal_semantic_context_events
  (workspace_id,generation_id,operation_id,event_index,event_kind,previous_state_digest,next_state_digest,actor_user_id)
  VALUES($1::uuid,$2::uuid,$3::uuid,0,$4,$5,$6,$7::uuid)`,[args.workspace_id,generationId,opId,kind,prior,next,args.actor_user_id]);}
async function activate(c:SignalSemanticContextQueryable,args:Scope,gen:Generation,live:SignalBrandContextAuthorityV1){
  const authority={brand_os_digest:live.brandOsDigest,knowledge_digest:live.knowledgeDigest,locale_context_digest:live.localeContextDigest,
    proposal_provider_lineage:gen.proposal_provider_lineage,proposal_provider_lineage_digest:gen.proposal_provider_lineage_digest};
  const snapshot=(await c.query<{snapshot:{publishable:boolean;blockers:string[];semantic_context_pack_digest:string;candidate_pack_digest:string;
    evidence_graph_digest:string;review_graph_digest:string;publication_authority_digest:string;publish_preflight_digest:string;counts:Record<string,number>}}>(
    'SELECT signal_semantic_context_publication_snapshot_v2($1::uuid,$2::jsonb) snapshot',[gen.id,JSON.stringify(authority)])).rows[0]!.snapshot;
  if(!snapshot.publishable)return fail(`brand_context_activation_${snapshot.blockers[0]??'blocked'}`);
  const op=await beginOperation(c,args,`brand-context-activation:${gen.id}`,'publish-semantic-context-generation',
    {generation_key:gen.generation_key,preflight_digest:snapshot.publish_preflight_digest});
  const updated=await c.query(`UPDATE signal_semantic_context_generations SET status='published',pack_digest=$2,
    publication_schema_version='signal-semantic-context-publication-v2',candidate_pack_digest=$3,evidence_graph_digest=$4,review_graph_digest=$5,
    publication_authority_digest=$6,publication_authority_snapshot=$7::jsonb,semantic_context_pack_digest=$2,publish_preflight_digest=$8,
    publication_counts=$9::jsonb,published_operation_id=$10::uuid,published_by_user_id=$11::uuid,published_at=clock_timestamp()
    WHERE id=$1::uuid AND status='draft'`,[gen.id,snapshot.semantic_context_pack_digest,snapshot.candidate_pack_digest,snapshot.evidence_graph_digest,
    snapshot.review_graph_digest,snapshot.publication_authority_digest,JSON.stringify(authority),snapshot.publish_preflight_digest,JSON.stringify(snapshot.counts),op.id,args.actor_user_id]);
  if(updated.rowCount!==1)return fail('brand_context_activation_conflict');
  await event(c,args,gen.id,op.id,'generation_published',gen.draft_digest,snapshot.semantic_context_pack_digest);
  await completeOperation(c,op.id,{generation_key:gen.generation_key,lifecycle_state:'published',semantic_context_pack_digest:snapshot.semantic_context_pack_digest});
}
/** Coordinator performs DB work only. Both providers continue through their original ledgers/outboxes.
 * Each step is idempotent and transactionally fenced; a completed proposal never hides a failed next step. */
export async function advanceSignalBrandContextPreparationsV1(args:{database:Database;runtime:SignalBrandContextPreparationRuntimeV1;limit?:number;workspace_id?:string}){
  const candidates=await args.database.query<Operation>(`SELECT op.* FROM signal_governance_control_operations op
    JOIN signal_semantic_context_generations gen ON gen.id=(op.brand_context_preparation->>'generation_id')::uuid
    LEFT JOIN signal_semantic_context_proposal_runs run ON run.generation_id=gen.id
    WHERE op.action='prepare-brand-context' AND op.status='completed' AND op.brand_context_preparation->'admission'<>'null'::jsonb
      AND ($1::uuid IS NULL OR op.workspace_id=$1::uuid)
      AND (op.brand_context_progress IS NULL OR ((op.brand_context_progress->>'attempt')::int<8
        AND (op.brand_context_progress->>'retry_at')::timestamptz<=clock_timestamp()))
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_generations successor WHERE successor.supersedes_generation_id=gen.id)
      AND NOT EXISTS(SELECT 1 FROM signal_workspace_embedding_runs embed JOIN signal_governance_control_operations origin
        ON origin.id=embed.brand_context_preparation_operation_id WHERE origin.brand_context_preparation->>'generation_id'=gen.id::text
          AND NOT (embed.status='canceled' AND signal_brand_context_prototype_unspent_v1(embed.id))
          AND NOT signal_brand_context_prototype_retryable_v1(embed.id))
      AND (run.id IS NULL OR run.status='completed' OR signal_brand_context_semantic_retryable_v1(run.id))
      AND NOT EXISTS(SELECT 1 FROM signal_governance_control_operations later WHERE later.workspace_id=op.workspace_id
        AND later.action='prepare-brand-context' AND later.brand_context_preparation->>'generation_id'=gen.id::text
        AND later.brand_context_preparation->'admission'<>'null'::jsonb AND (later.created_at,later.id)>(op.created_at,op.id))
    ORDER BY op.created_at,op.id LIMIT $2`,[args.workspace_id??null,Math.min(50,Math.max(1,args.limit??20))]);
  const results:Array<{operation_id:string;state:SignalBrandContextPreparationStateV1;error_code?:string}>=[];
  for(const candidate of candidates.rows){try{
    const step=()=>transaction(args.database,async c=>{
      const scope={workspace_id:candidate.workspace_id,actor_user_id:candidate.actor_user_id};const ws=await workspace(c,scope,true);
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`signal-semantic-context:${ws.id}`]);
      const op=(await c.query<Operation>('SELECT * FROM signal_governance_control_operations WHERE id=$1::uuid FOR UPDATE',[candidate.id])).rows[0]!;
      const input=op.brand_context_preparation;const gen=(await c.query<Generation>('SELECT * FROM signal_semantic_context_generations WHERE id=$1::uuid',[input.generation_id])).rows[0]!;
      const live=await resolveSignalBrandContextAuthorityV1({queryable:c,workspace:ws});
      if(live.sourceAuthorityDigest!==input.source_authority_digest)return 'stale' as const;
      const run=(await c.query<{id:string;run_key:string;status:string;retryable:boolean;recovery_count:number}>(`SELECT id,run_key,status,
        signal_brand_context_semantic_retryable_v1(run.id) retryable,(SELECT count(*)::int FROM signal_governance_control_operations recovery
          WHERE recovery.workspace_id=run.workspace_id AND recovery.action='retry-semantic-context-proposal-run' AND recovery.status='completed'
            AND recovery.result->>'run_key'=run.run_key) recovery_count FROM signal_semantic_context_proposal_runs run WHERE generation_id=$1::uuid`,[gen.id])).rows[0];
      if(run?.status==='failed'&&run.retryable){
        if(!args.runtime.semantic.available||!args.runtime.queue_configured||!args.runtime.worker_alive||!args.runtime.recovery_alive)return 'awaiting_authorization' as const;
        await retrySignalSemanticContextProposalRunWithClientV1(c,{pool:args.database,
          workspace:{id:ws.id,organization_id:ws.organizationId,brand_id:ws.subject.id},actor:{id:scope.actor_user_id,user_type:'noisia_internal'},
          run_key:run.run_key,idempotency_key:`brand-context-proposal-recovery:${run.id}:${run.recovery_count+1}`});
        return 'generating' as const;
      }
      if(!run&&gen.status!=='published'){
        if(!input.admission||input.admission.configuration_digest!==configDigest(args.runtime))return 'awaiting_authorization' as const;
        const valid=(await c.query<{valid:boolean}>('SELECT $1::timestamptz>clock_timestamp() valid',[input.admission.admission_not_after])).rows[0]!.valid;
        if(!valid)return 'awaiting_authorization' as const;
        const shared={workspace:{id:ws.id,organization_id:ws.organizationId,brand_id:ws.subject.id},actor:{id:scope.actor_user_id,user_type:'noisia_internal' as const},
          generation_key:gen.generation_key,configuration:args.runtime.semantic,runtime:signalBrandContextProposalRuntimeCapabilitiesV1(args.runtime)};
        const preflight=await loadSignalSemanticContextProposalPreflightRuntimeV1({queryable:c,...shared});
        await startSignalSemanticContextProposalRunWithClientV1(c,{pool:args.database,...shared,idempotency_key:`brand-context-proposal:${gen.id}`,
          preflight_digest:preflight.preflight_digest,confirmation:SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_CONFIRMATION,
          hard_cap_micro_usd:BigInt(input.admission.semantic_cap_micro_usd),brand_context_preparation_operation_id:op.id});
        return 'generating' as const;
      }
      if(run&&run.status!=='completed')return 'generating' as const;
      if(gen.status==='draft'){await activate(c,scope,gen,live);return 'activating' as const;}
      await ensureSignalTopicCatalogStoreV1({client:c,...scope});
      const existing=(await c.query<{id:string;status:string;dispatch_generation:number;hard_cap_micro_usd:string;retryable:boolean}>(`SELECT embed.id,embed.status,embed.dispatch_generation,embed.hard_cap_micro_usd::text,signal_brand_context_prototype_retryable_v1(embed.id) retryable FROM signal_workspace_embedding_runs embed JOIN signal_governance_control_operations origin ON origin.id=embed.brand_context_preparation_operation_id
        WHERE origin.brand_context_preparation->>'generation_id'=$1
          AND NOT (embed.status='canceled' AND signal_brand_context_prototype_unspent_v1(embed.id)) ORDER BY embed.created_at DESC,embed.id DESC LIMIT 1`,[gen.id])).rows[0];
      if(existing&&!existing.retryable)return existing.status==='completed'?'ready' as const:existing.status==='failed'?'failed' as const:'preparing_prototypes' as const;
      const quote=await quoteSignalWorkspaceTopicPrototypesWithQueryableV1(c,{database:args.database,...scope,brand_context_preparation_operation_id:op.id});
      if((!existing||quote.requires_provider)&&(!input.admission||input.admission.configuration_digest!==configDigest(args.runtime)))return fail('brand_context_admission_changed');
      await requestSignalWorkspaceTopicPrototypesWithClientV1(c,{database:args.database,...scope,idempotency_key:existing?`brand-context-prototypes:${gen.id}:recovery:${existing.dispatch_generation}`:`brand-context-prototypes:${gen.id}:${op.id}`,
        plan_digest:quote.plan_digest,quote_digest:quote.quote_digest,hard_cap_micro_usd:existing?Number(existing.hard_cap_micro_usd):Number(input.admission!.prototype_cap_micro_usd),
        max_run_cost_micro_usd:args.runtime.prototype.max_run_cost_micro_usd,provider_available:args.runtime.prototype.available,
        brand_context_preparation_operation_id:op.id});
      return 'preparing_prototypes' as const;
    });let state=await step();if(state==='activating')state=await step();results.push({operation_id:candidate.id,state});
  }catch(error){const code=error instanceof Error&&'code' in error&&typeof error.code==='string'&&/^[a-z_]{1,140}$/u.test(error.code)?error.code:'brand_context_coordinator_failed';
    await args.database.query(`UPDATE signal_governance_control_operations SET brand_context_progress=jsonb_build_object(
      'attempt',COALESCE((brand_context_progress->>'attempt')::int,0)+1,'last_error',$2::text,
      'retry_at',to_char((clock_timestamp()+make_interval(secs=>least(900,5*power(2,COALESCE((brand_context_progress->>'attempt')::int,0)))::int)) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      WHERE id=$1::uuid AND COALESCE((brand_context_progress->>'attempt')::int,0)<8`,[candidate.id,code]);
    results.push({operation_id:candidate.id,state:'failed',error_code:code});}}
  return results;
}
export async function loadSignalBrandContextPreparationV1(args:Scope&{database:Database;idempotency_key?:string}):Promise<{
  current:SignalBrandContextPreparationV1|null;request:SignalBrandContextPreparationV1|null}>{
  return transaction(args.database,async c=>{
    const ws=await workspace(c,args,false);
    const request=args.idempotency_key?(await c.query<Operation>(`SELECT * FROM signal_governance_control_operations WHERE workspace_id=$1::uuid
      AND actor_user_id=$2::uuid AND action='prepare-brand-context' AND idempotency_key=$3`,[args.workspace_id,args.actor_user_id,digest(args.idempotency_key)])).rows[0]?.result??null:null;
    const op=(await c.query<Operation>(`SELECT * FROM signal_governance_control_operations WHERE workspace_id=$1::uuid AND action='prepare-brand-context'
      AND status='completed' ORDER BY created_at DESC,id DESC LIMIT 1`,[args.workspace_id])).rows[0];
    if(!op?.result)return {current:null,request};
    const current={...op.result,replayed:false};
    const row=(await c.query<{generation_status:string;has_successor:boolean;semantic_run_id:string|null;semantic_status:string|null;error_code:string|null;
      prototype_run_id:string|null;prototype_status:string|null;prototype_error:string|null;active_elements:number;exceptions:number;admission_current:boolean}>(`SELECT gen.status generation_status,
      EXISTS(SELECT 1 FROM signal_semantic_context_generations successor WHERE successor.supersedes_generation_id=gen.id) has_successor,
      run.id::text semantic_run_id,run.status semantic_status,run.error_code,embed.id::text prototype_run_id,embed.status prototype_status,embed.error_code prototype_error,
      (SELECT count(*)::int FROM signal_semantic_context_element_versions element WHERE element.generation_id=gen.id AND disposition='approved' AND lifecycle_state='active'
       AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor WHERE successor.supersedes_element_id=element.id)) active_elements,
      (SELECT count(*)::int FROM signal_semantic_context_element_versions element WHERE element.generation_id=gen.id AND disposition='pending' AND automatic_policy_outcome='exception'
       AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor WHERE successor.supersedes_element_id=element.id)) exceptions,
      COALESCE($2::timestamptz>clock_timestamp(),false) admission_current
      FROM signal_semantic_context_generations gen LEFT JOIN signal_semantic_context_proposal_runs run ON run.generation_id=gen.id
      LEFT JOIN LATERAL(SELECT e.id,e.status,e.error_code FROM signal_workspace_embedding_runs e JOIN signal_governance_control_operations origin
        ON origin.id=e.brand_context_preparation_operation_id WHERE origin.brand_context_preparation->>'generation_id'=gen.id::text
        AND NOT (e.status='canceled' AND signal_brand_context_prototype_unspent_v1(e.id))
        ORDER BY e.created_at DESC,e.id DESC LIMIT 1) embed ON true WHERE gen.id=$1::uuid`,
      [current.generation_id,op.brand_context_preparation.admission?.admission_not_after??null])).rows[0];
    if(!row)return{current:null,request};
    current.semantic_run_id=row.semantic_run_id;current.prototype_run_id=row.prototype_run_id;current.active_elements=row.active_elements;current.exceptions=row.exceptions;
    let isCurrent=!row.has_successor;
    try{const live=await resolveSignalBrandContextAuthorityV1({queryable:c,workspace:ws});isCurrent&&=live.sourceAuthorityDigest===op.brand_context_preparation.source_authority_digest;}
    catch(error){if(error instanceof SignalSemanticContextProposalExecutionError)isCurrent=false;else throw error;}
    current.state=!isCurrent?'stale':row.prototype_status==='completed'?'ready':row.prototype_status==='failed'?'failed':row.prototype_run_id?'preparing_prototypes':
      row.semantic_status==='completed'?(row.generation_status==='draft'?'activating':row.admission_current?'preparing_prototypes':'awaiting_authorization'):
      row.semantic_status&&['failed','stale','dead_letter'].includes(row.semantic_status)?'failed':row.semantic_run_id?'generating':row.admission_current?'queued':'awaiting_authorization';
    current.error_code=row.prototype_error??row.error_code??op.brand_context_progress?.last_error??null;
    if(isCurrent&&!row.prototype_run_id&&op.brand_context_progress&&(!row.semantic_run_id||row.semantic_status==='completed')){current.state='failed';}
    if(current.state==='ready'||current.state==='generating'||current.state==='preparing_prototypes')current.error_code=null;
    return{current,request};
  },true);
}
/** Server runtime adapter. Money defaults are the existing embedding profile's defaults. */
export function signalBrandContextPreparationRuntimeFromEnvV1(env:Record<string,string|undefined>,health:{queue_configured:boolean;worker_alive:boolean;recovery_alive:boolean}):SignalBrandContextPreparationRuntimeV1{
  const semantic=signalSemanticContextProposalRuntimeConfigurationFromEnvV1(env);
  const raw=env.NOISIA_WORKSPACE_EMBEDDINGS_MAX_COST_MICRO_USD;
  const cap=raw===undefined?SIGNAL_WORKSPACE_EMBEDDING_DEFAULT_MAX_COST_MICRO_USD_V1:/^\d+$/u.test(raw)?Number(raw):NaN;
  if(!Number.isSafeInteger(cap)||cap<0)return fail('workspace_embedding_budget_configuration_invalid',503);
  return{...health,semantic:{...semantic,available:semantic.available&&Boolean(env.ANTHROPIC_API_KEY?.trim())},
    prototype:{available:env.NOISIA_WORKSPACE_EMBEDDINGS_PROVIDER_ENABLED==='true'&&Boolean(env.VOYAGE_API_KEY?.trim()),max_run_cost_micro_usd:cap}};
}

export async function forkSignalBrandContextForEditingWithQueryableV1(args:Scope&{queryable:SignalSemanticContextQueryable;generation_key:string;edit_operation_id:string}){
  return (await args.queryable.query<{generation_key:string}>(`SELECT fork_signal_brand_context_for_edit_v1($1::uuid,$2::uuid,$3,$4::uuid) generation_key`,
    [args.workspace_id,args.actor_user_id,args.generation_key,args.edit_operation_id])).rows[0]!.generation_key;
}
export async function activateSignalBrandContextGenerationWithQueryableV1(args:Scope&{queryable:SignalSemanticContextQueryable;generation_key:string}){
  const ws=await workspace(args.queryable,args,true);
  const gen=(await args.queryable.query<Generation>('SELECT * FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid AND generation_key=$2',[args.workspace_id,args.generation_key])).rows[0];
  if(!gen)return fail('brand_context_generation_not_found',404);
  const automatic=(await args.queryable.query(`SELECT 1 FROM signal_governance_control_operations WHERE action='prepare-brand-context' AND status='completed'
    AND brand_context_preparation->>'generation_id'=$1 LIMIT 1`,[gen.id])).rows.length>0;
  if(!automatic||gen.status==='published')return;
  const live=await resolveSignalBrandContextAuthorityV1({queryable:args.queryable,workspace:ws});
  if(gen.brand_os_digest!==live.brandOsDigest||gen.knowledge_digest!==live.knowledgeDigest||gen.locale_context_digest!==live.localeContextDigest)return fail('brand_context_source_stale');
  return activate(args.queryable,args,gen,live);
}
