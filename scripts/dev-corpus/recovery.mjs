import { createHash } from 'node:crypto';
export function queueNameForJob(id) { return `mfp-${createHash('sha256').update(id).digest('hex').slice(0,32)}`; }
/** A retry is an explicit recovery of a known safe product state, never a new paid attempt. */
export function recoveryIntent(stage, status, key, retry, identity = {}) {
  const current=status.active_run??status.latest_run;
  if (current && (current.unknown_reserved_micro_usd>0 || current.error_code?.includes('outcome_unknown'))) throw new Error('mfp_outcome_unknown_requires_reconciliation');
  if (status.is_current && status.latest_completed) return {kind:'completed',run_id:status.latest_completed.id};
  if(status.active_run)return {kind:'existing',run_id:status.active_run.id};
  const sameInput = !current || Object.entries(identity).every(([field,value]) => current[field] === value);
  const beforeSnapshot = identity.input_revision !== undefined && current?.input_revision === null;
  if(current?.status==='failed' && (sameInput || beforeSnapshot)){
    if(!current.retryable)throw new Error('mfp_run_not_retryable');
    if(!retry)throw new Error('mfp_explicit_retry_required');
    return {kind:'request',idempotency_key:`${stage}-retry-${current.id}-${createHash('sha256').update(current.updated_at).digest('hex').slice(0,16)}`,resume_run_id:sameInput?current.id:undefined};
  }
  return {kind:'request',idempotency_key:key};
}
