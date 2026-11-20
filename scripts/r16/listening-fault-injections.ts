import type {WorkspaceEngineStorageV1} from '../../services/workers/src/workers/signal-workspace-engine-storage';

type Put=Parameters<WorkspaceEngineStorageV1['put']>[0];
export async function r16NativeCommitBoundaryV1<T>(sql:string,mode:'rollback_before_commit'|'ack_after_commit'|null,
 query:(sql:string)=>Promise<T>):Promise<T>{
 if(!mode||sql.trim().toUpperCase()!=='COMMIT')return query(sql);
 if(mode==='rollback_before_commit'){
  await query('ROLLBACK');throw Error('r16_listening_native_precommit_rollback');
 }
 await query(sql);throw Error('r16_listening_native_commit_ack_lost');
}
export function createR16PutFaultV1(base:WorkspaceEngineStorageV1,mode:'reject_before_put'|'ack_after_put'|null){
 let injected=false,affected_sha256:string|undefined;
 return{get injected(){return injected;},get affected_sha256(){return affected_sha256;},storage:{...base,async put(input:Put){
  if(mode==='reject_before_put'&&!injected){affected_sha256=input.sha256;injected=true;throw Error('r16_listening_storage_rejected_before_blob');}
  const stored=await base.put(input);
  if(mode==='ack_after_put'&&!injected){affected_sha256=input.sha256;injected=true;throw Error('r16_listening_storage_ack_lost');}
  return stored;
 }}satisfies WorkspaceEngineStorageV1};
}

export function selectR16AffectedCallsV1<T extends{id:string}>(rows:T[],affected_ids:string[]):T[]{
 const ids=new Set(affected_ids),byId=new Map(rows.map(row=>[row.id,row]));
 if(!ids.size||ids.size!==affected_ids.length||byId.size!==rows.length||affected_ids.some(id=>!byId.has(id)))throw Error('r16_fault_affected_calls_invalid');
 return affected_ids.map(id=>byId.get(id)!);
}
export function r16AffectedPageMembersV1(page:{sha256:string;member_count:number},affected_sha256:string|undefined,call_ids:string[]){
 if(!affected_sha256||page.sha256!==affected_sha256||!Number.isSafeInteger(page.member_count)||page.member_count<1||page.member_count>4096
  ||call_ids.length!==page.member_count||new Set(call_ids).size!==call_ids.length)throw Error('r16_fault_affected_page_invalid');
 return[...call_ids];
}

/** One recovery-only job settles existing custody; a later normal job may then
 * classify newly eligible questions. A real readback witness is mandatory when
 * an ACK loss left the exact page planned but call-level references unattached. */
export function continueR16ListeningFaultJobsV1(args:{kind:string;unknown_without_call_raw:boolean;verified_affected_page:boolean;attempt:number}){
 if(args.unknown_without_call_raw&&!(args.kind==='raw_page_ack_lost'&&args.verified_affected_page))return false;
 if(['429','529','lease_expiry','raw_page_write'].includes(args.kind)&&args.attempt>=1)return false;
 return true;
}
