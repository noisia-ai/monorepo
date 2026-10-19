import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import type {Pool} from 'pg';
import {quoteSignalBrandContextSemanticRenewalV1,renewSignalBrandContextSemanticAdmissionV1} from './signal-brand-context-semantic-renewal';
import type {SignalSemanticContextProposalRuntimeConfigurationV1} from './signal-semantic-context-proposal';
const semanticConfiguration:SignalSemanticContextProposalRuntimeConfigurationV1={available:true,provider:'anthropic',model:'claude-sonnet-4-6',
 model_version:'claude-sonnet-4-6',pricing_version:'synthetic-sonnet-pricing-v1',max_input_tokens:20000,max_output_tokens:64000,
 model_max_output_tokens:64000,input_usd_per_million_tokens:'3',output_usd_per_million_tokens:'15',platform_hard_cap_micro_usd:1000000n};
const composedRuntime={queue_configured:true,worker_alive:true,recovery_alive:true};
const parent='a1111111-1111-4111-8111-111111111111',actor='b1111111-1111-4111-8111-111111111111';
const hash=`sha256:${'a'.repeat(64)}`;
const result={contract_version:'brand-context-semantic-renewal-v1',parent_receipt_id:parent,workspace_id:parent,
 run_id:parent,admission_id:parent,reservation_id:parent,renewal_id:parent,status:'failed',replayed:true,
 admission_not_after:'2026-09-12T00:00:00.000Z'};
const database=(value:unknown,error?:Error)=>{const sql:string[]=[];const params:unknown[][]=[];let released=false;
 const client={query:async(text:string,args?:unknown[])=>{sql.push(text);params.push(args??[]);
  if(/^(SELECT|WITH)/u.test(text)){if(error)throw error;return{rows:[{value,compatible:true}]};}return{rows:[]};},release:()=>{released=true;}};
 return{db:{connect:async()=>client} as unknown as Pick<Pool,'connect'>,sql,params,released:()=>released};};
const args={parent_receipt_id:parent,actor_user_id:actor,configuration:semanticConfiguration,runtime:composedRuntime};
test('renewal replay returns current failed state and accepts runtime off without new work',async()=>{
 const d=database(result);const actual=await renewSignalBrandContextSemanticAdmissionV1({...args,database:d.db,
  runtime:{queue_configured:false,worker_alive:false,recovery_alive:false},idempotency_key:'renewal-key',expected_quote_digest:hash,
  confirmation:'renew_brand_context_semantic_within_shown_cap'});
 assert.deepEqual(actual,result);assert.equal(d.sql.filter(s=>s.startsWith('SELECT')).length,1);
 assert.match(d.sql[1]!,/renew_signal_brand_context_semantic_admission_v1/u);assert.equal(d.sql.at(-1),'COMMIT');assert.ok(d.released());
 assert.equal(d.params[1]![7],false);
});
test('typed source/policy/authority failures roll back and preserve exact codes',async()=>{
 for(const [code,status] of [['brand_context_source_stale',409],['processing_forbidden',403],['brand_context_semantic_policy_incompatible',409]] as const){
  const d=database(null,new Error(code));await assert.rejects(renewSignalBrandContextSemanticAdmissionV1({...args,database:d.db,
   idempotency_key:'renewal-key',expected_quote_digest:hash,confirmation:'renew_brand_context_semantic_within_shown_cap'}),
   e=>e instanceof Error&&'code'in e&&e.code===code&&'status'in e&&e.status===status);
  assert.equal(d.sql.at(-1),'ROLLBACK');assert.ok(d.released());
 }
});
test('quote keeps canonical money strings and excludes provider/configuration from its DTO',async()=>{
 const snapshot={parent_receipt_id:parent,workspace_id:parent,run_id:parent,quote_expires_at:'2026-09-11T23:55:00Z',
  admission_not_after:'2026-09-12T00:00:00Z',reservation_micro_usd:'9007199254740993',available_today_micro_usd:'2'};
 const d=database({quote_digest:hash,quote_snapshot:snapshot});const q=await quoteSignalBrandContextSemanticRenewalV1({...args,database:d.db});
 assert.equal(q.maximum_micro_usd,'9007199254740993');assert.equal(q.available_today_micro_usd,'2');
 assert.equal(q.contract_version,'brand-context-semantic-renewal-quote-v1');assert.equal(q.quote_digest,hash);
 assert.ok(!('configuration'in q));assert.match(d.sql[0]!,/READ ONLY/u);assert.equal(d.sql.at(-1),'COMMIT');
});
test('malformed request is rejected before connecting',async()=>{
 const d=database(null);await assert.rejects(renewSignalBrandContextSemanticAdmissionV1({...args,database:d.db,
  idempotency_key:'short',expected_quote_digest:hash,confirmation:'renew_brand_context_semantic_within_shown_cap'}),/brand_context_semantic_renewal_request_invalid/u);
 assert.deepEqual(d.sql,[]);
});
const sql=()=>readFileSync(new URL('./migrations/0160_signal_brand_context_semantic_admission_renewal.sql',import.meta.url),'utf8');
test('0160 grants are immutable; no replacement admission, owner, call or reserve is inserted',()=>{
 const s=sql();assert.match(s,/CREATE TABLE signal_brand_context_semantic_renewals/u);
 assert.doesNotMatch(s,/INSERT INTO (?:signal_processing_admissions|signal_semantic_context_(?:proposal_runs|budget_reservations|proposal_outbox))/u);
 assert.doesNotMatch(s,/UPDATE signal_(?:processing_admissions|brand_context_processing_receipts|semantic_context_budget_reservations)/u);
 for(const marker of ['semantic_renewal_immutable','FOR UPDATE NOWAIT','SET search_path','DEFERRABLE INITIALLY DEFERRED',
  'signal_brand_context_processing_source_current_v1','provider_call_count=0','provider_response_private IS NULL','reservation.status=\'reserved\''])assert.ok(s.includes(marker),marker);
});
test('0160 accounting uses the latest unique reservation renewal and keeps other ledgers unchanged',()=>{
 const s=sql();assert.match(s,/COALESCE\(renewal\.budget_date,\(r\.reserved_at AT TIME ZONE target_timezone\)::date\)=target_day/u);
 assert.match(s,/UNIQUE\(supersedes_renewal_id\)/u);assert.match(s,/WHERE supersedes_renewal_id IS NULL/u);
 assert.match(s,/ALTER TABLE signal_brand_context_semantic_renewals ENABLE ROW LEVEL SECURITY/u);
 assert.match(s,/REVOKE ALL ON signal_brand_context_semantic_renewals FROM PUBLIC/u);
 assert.match(s,/signal_processing_capacity_pre0160_v1/u);
});
