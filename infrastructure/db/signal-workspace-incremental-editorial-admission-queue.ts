import {SignalWorkspaceEngineError,withSignalWorkspaceEngineTransactionV1} from './signal-workspace-engine';
import {beginSignalWorkspaceIncrementalEditorialWithClientV1,
 type SignalWorkspaceIncrementalEditorialBeginArgsV1,
 type SignalWorkspaceIncrementalEditorialResultV1} from './signal-workspace-incremental-editorial';
import {enqueueSignalWorkspaceIncrementalEditorialWithClientV1} from './signal-workspace-incremental-editorial-execution';

export type SignalWorkspaceIncrementalEditorialQueuedResultV1 = SignalWorkspaceIncrementalEditorialResultV1 & {
 dispatch: {execution_id:string;worker_job_id:string}|null;
};

/** Only a new, explicitly accepted admission creates a dispatch. Replays are receipt reads. */
export async function beginAndEnqueueSignalWorkspaceIncrementalEditorialV1(
 args:SignalWorkspaceIncrementalEditorialBeginArgsV1&{provider_available:boolean},
):Promise<SignalWorkspaceIncrementalEditorialQueuedResultV1>{
 return withSignalWorkspaceEngineTransactionV1(args.database,async client=>{
  const accepted=await beginSignalWorkspaceIncrementalEditorialWithClientV1(client,args);
  if(accepted.replayed){
   // A historical inert admission remains inert. A lost ACK must not renew or retry work.
   const dispatch=(await client.query<{execution_id:string;worker_job_id:string}>(
    `SELECT execution_id,worker_job_id FROM signal_topic_classification_outbox
     WHERE execution_id=$1::uuid AND workspace_id=$2::uuid AND dispatch_kind='execution'`,
    [accepted.execution_id,args.workspace_id],
   )).rows[0]??null;
   return{...accepted,dispatch};
  }
  // The server kill switch blocks new admission; an accepted receipt still resolves
  // after a lost ACK. Throwing here rolls back the new owner, claims and grant too.
  if(!args.provider_available)throw new SignalWorkspaceEngineError('workspace_analysis_interpretation_unavailable',422);
  // Budget ownership is sealed by the server receipt; the UI supplies only the authorizing user.
  const dispatch=await enqueueSignalWorkspaceIncrementalEditorialWithClientV1(client,{
   database:args.database,workspace_id:args.workspace_id,
   actor_user_id:accepted.receipt.budget_actor_user_id,execution_id:accepted.execution_id,
  });
  return{...accepted,dispatch};
 });
}
