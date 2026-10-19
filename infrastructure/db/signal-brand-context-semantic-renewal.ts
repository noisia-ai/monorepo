import type {Pool} from 'pg';
import {SignalSemanticContextProposalExecutionError,type SignalSemanticContextProposalRuntimeConfigurationV1} from './signal-semantic-context-proposal';

type Identity={database:Pick<Pool,'connect'>;parent_receipt_id:string;actor_user_id:string;
 /** Server runtime only. SQL derives policy/configuration/cost from the original receipt. */
 configuration:SignalSemanticContextProposalRuntimeConfigurationV1;
 runtime:{queue_configured:boolean;worker_alive:boolean;recovery_alive:boolean}};
export type SignalBrandContextSemanticRenewalQuoteV1={contract_version:'brand-context-semantic-renewal-quote-v1';
 parent_receipt_id:string;workspace_id:string;run_id:string;quote_digest:string;quote_expires_at:string;
 admission_not_after:string;maximum_micro_usd:string;reservation_micro_usd:string;available_today_micro_usd:string};
export type SignalBrandContextSemanticRenewalV1={contract_version:'brand-context-semantic-renewal-v1';
 parent_receipt_id:string;workspace_id:string;run_id:string;admission_id:string;reservation_id:string;renewal_id:string;
 status:'queued'|'processing'|'validating'|'completed'|'failed'|'stale'|'dead_letter';replayed:boolean;admission_not_after:string};
export type SignalBrandContextSemanticRenewalArgsV1=Identity&{idempotency_key:string;expected_quote_digest:string;
 confirmation:'renew_brand_context_semantic_within_shown_cap'};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const digest=/^sha256:[0-9a-f]{64}$/u;
const fail=(code:string,status=409):never=>{throw new SignalSemanticContextProposalExecutionError(code,status);};
const money=(value:unknown)=>{if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/u.test(value))return fail('brand_context_semantic_renewal_invalid');return value;};
const timestamp=(value:unknown)=>{if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))return fail('brand_context_semantic_renewal_invalid');return new Date(value).toISOString();};
function configuration(args:Identity){const c=args.configuration;return {provider:c.provider,model:c.model,model_version:c.model_version,
 pricing_version:c.pricing_version,max_input_tokens:c.max_input_tokens,max_output_tokens:c.max_output_tokens,
 input_usd_per_million_tokens:c.input_usd_per_million_tokens,output_usd_per_million_tokens:c.output_usd_per_million_tokens};}
const available=(args:Identity)=>args.configuration.available===true&&args.configuration.provider==='anthropic'
 &&args.configuration.model==='claude-sonnet-4-6'&&args.runtime.queue_configured===true
 &&args.runtime.worker_alive===true&&args.runtime.recovery_alive===true;
function identity(args:Identity){if(!uuid.test(args.parent_receipt_id)||!uuid.test(args.actor_user_id))return fail('brand_context_semantic_renewal_request_invalid',422);}
function mapError(error:unknown):never{
 if(error instanceof SignalSemanticContextProposalExecutionError)throw error;
 if(error instanceof Error&&/^(?:brand_context|processing)_[a-z_]+$/u.test(error.message))
  return fail(error.message,error.message.endsWith('_forbidden')?403:error.message.endsWith('_request_invalid')?422:
   error.message.endsWith('_runtime_unavailable')?503:409);
 throw error;
}

/** Read-only Stage1 renewal quote. The fixed original reservation is the maximum
 * remaining cost; available_today already includes its single new-day imputation.
 * A quote digest does not itself authorize a claim, provider or new reservation. */
export async function quoteSignalBrandContextSemanticRenewalV1(args:Identity):Promise<SignalBrandContextSemanticRenewalQuoteV1>{
 identity(args);if(!available(args))return fail('brand_context_processing_runtime_unavailable',503);
 const client=await args.database.connect();
 try{
  await client.query('BEGIN READ ONLY');
  const row=(await client.query<{value:{quote_digest:string;quote_snapshot:Record<string,unknown>};compatible:boolean}>(`WITH q AS (
   SELECT quote_signal_brand_context_semantic_renewal_v1($1::uuid,$2::uuid) value
  ) SELECT value,signal_processing_configuration_allows_v1('brand_context_proposal',$3::jsonb,value#>'{quote_snapshot,configuration}')
   AND $4::bigint>=(value#>>'{quote_snapshot,execution_cap_micro_usd}')::bigint compatible FROM q`,
  [args.parent_receipt_id,args.actor_user_id,JSON.stringify(configuration(args)),args.configuration.platform_hard_cap_micro_usd.toString()])).rows[0];
  if(!row||row.compatible!==true)return fail('brand_context_processing_runtime_drift');
  const q=row.value,s=q.quote_snapshot;
  if(!digest.test(q.quote_digest)||s.parent_receipt_id!==args.parent_receipt_id
   ||typeof s.workspace_id!=='string'||!uuid.test(s.workspace_id)||typeof s.run_id!=='string'||!uuid.test(s.run_id))
   return fail('brand_context_semantic_renewal_invalid');
  const result:SignalBrandContextSemanticRenewalQuoteV1={contract_version:'brand-context-semantic-renewal-quote-v1',
   parent_receipt_id:args.parent_receipt_id,workspace_id:s.workspace_id,run_id:s.run_id,quote_digest:q.quote_digest,
   quote_expires_at:timestamp(s.quote_expires_at),admission_not_after:timestamp(s.admission_not_after),
   maximum_micro_usd:money(s.reservation_micro_usd),reservation_micro_usd:money(s.reservation_micro_usd),
   available_today_micro_usd:money(s.available_today_micro_usd)};
  await client.query('COMMIT');return result;
 }catch(error){await client.query('ROLLBACK').catch(()=>undefined);mapError(error);}finally{client.release();}
}

/** Explicit fresh authority for one expired, provably-unsent Stage1. SQL atomically
 * appends its grant and rearms the same run/outbox. Historical replay precedes
 * runtime/expiry checks and returns current state without requeueing or spending. */
export async function renewSignalBrandContextSemanticAdmissionV1(args:SignalBrandContextSemanticRenewalArgsV1):Promise<SignalBrandContextSemanticRenewalV1>{
 identity(args);if(!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key)||!digest.test(args.expected_quote_digest)
  ||args.confirmation!=='renew_brand_context_semantic_within_shown_cap')return fail('brand_context_semantic_renewal_request_invalid',422);
 const client=await args.database.connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  const value=(await client.query<{value:SignalBrandContextSemanticRenewalV1}>(`SELECT renew_signal_brand_context_semantic_admission_v1(
   $1::uuid,$2::uuid,$3,$4,$5,$6::jsonb,$7::bigint,$8::boolean) value`,[args.parent_receipt_id,args.actor_user_id,
   args.idempotency_key,args.expected_quote_digest,args.confirmation,JSON.stringify(configuration(args)),
   args.configuration.platform_hard_cap_micro_usd.toString(),available(args)])).rows[0]?.value;
  if(!value||value.contract_version!=='brand-context-semantic-renewal-v1'||value.parent_receipt_id!==args.parent_receipt_id
   ||![value.workspace_id,value.run_id,value.admission_id,value.reservation_id,value.renewal_id].every(v=>typeof v==='string'&&uuid.test(v))
   ||!['queued','processing','validating','completed','failed','stale','dead_letter'].includes(value.status)
   ||typeof value.replayed!=='boolean'||(!value.replayed&&value.status!=='queued'))return fail('brand_context_semantic_renewal_invalid');
  const result={...value,admission_not_after:timestamp(value.admission_not_after)};
  await client.query('COMMIT');return result;
 }catch(error){await client.query('ROLLBACK').catch(()=>undefined);mapError(error);}finally{client.release();}
}
