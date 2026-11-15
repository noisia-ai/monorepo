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
 let injected=false;
 return{get injected(){return injected;},storage:{...base,async put(input:Put){
  if(mode==='reject_before_put'&&!injected){injected=true;throw Error('r16_listening_storage_rejected_before_blob');}
  const stored=await base.put(input);
  if(mode==='ack_after_put'&&!injected){injected=true;throw Error('r16_listening_storage_ack_lost');}
  return stored;
 }}satisfies WorkspaceEngineStorageV1};
}
