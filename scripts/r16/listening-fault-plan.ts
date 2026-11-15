import {signalWorkspaceEmbeddingDigestV1 as digest} from '../../packages/query-engine/src/index';
import {r16ListeningWorkloadV1,R16_LISTENING_PREREGISTRATION_V1 as registration} from './listening-workload';

export type R16ListeningFaultKindV1=typeof registration.faults[number];
/** This is an execution plan, not proof that the native faults were exercised. */
export function r16ListeningNativeFaultPlanV1(source:{source_tree_sha256:string;policy_configuration_digest:string;postgres_system_identifier:string}){
 const workload=r16ListeningWorkloadV1('defined_consumer_second_pass');
 if(!/^sha256:[0-9a-f]{64}$/.test(source.source_tree_sha256)||!/^sha256:[0-9a-f]{64}$/.test(source.policy_configuration_digest)
  ||!source.postgres_system_identifier)throw Error('r16_listening_fault_source_invalid');
 const cases=registration.faults.map(kind=>({kind,root_count:3,
  request_version:'listening-jev-v1' as const,configuration_digest:workload.configuration_digest,
  native_owner:'signalListeningJevJobV1' as const,
  injection:kind==='429'||kind==='529'?'synthetic_http_rejection_before_usage'
   :kind==='raw_page_write'?'storage_write_failure_before_durable_ack'
   :kind==='postgres_commit'?'native_transaction_commit_failure'
   :kind==='settlement_ack_lost'?'throw_after_native_settlement_commit'
   :kind==='worker_restart_after_page'?'throw_after_native_page_commit_then_new_job'
   :kind==='lease_expiry'?'expire_own_native_lease_before_durable_custody'
   :'expire_own_native_lease_after_durable_custody',
  // Read these from native ledger/Storage receipts, never from mocked counters.
  required_evidence:['source_policy_pg_binding','native_listening_admission','exact_question_digests',
   'call_and_root_census','raw_page_readback','native_money_events','lease_rights_guards',
   'zero_paid_physical_replay','no_technical_result_for_never_sent_reservation'],
 }));
 return{contract_version:'r16-listening-native-fault-plan-v1' as const,status:'execution_pending' as const,
  source,workload,cases,plan_digest:digest({source,workload,cases})};
}

/** Useful for ACK-loss faults only: the real native commit MUST finish first.
 * This decorator does not replace PG, Storage, reservation or result semantics. */
export function afterNativeAckLossOnceV1<A extends unknown[],R>(operation:(...args:A)=>Promise<R>,code:string){
 let injected=false;
 return async(...args:A):Promise<R>=>{
  const result=await operation(...args);
  if(!injected){injected=true;throw Error(code);}
  return result;
 };
}
