import {
  runWorkspaceIncrementalEditorialConsumerV1,
  type WorkspaceIncrementalEditorialConsumerOptionsV1,
} from './signal-workspace-incremental-editorial-consumer';

export const SIGNAL_WORKSPACE_INCREMENTAL_EDITORIAL_JOB_NAME = 'signal_workspace_incremental_editorial_v1';
type Job = {name:string;id?:string;data:unknown};
type Options = {database?:WorkspaceIncrementalEditorialConsumerOptionsV1['database'];run?:typeof runWorkspaceIncrementalEditorialConsumerV1};

/** Queue payload identifies an admitted execution. Context, claims and spending
 * authority are loaded by the consumer from the database, never from job data. */
export async function signalWorkspaceIncrementalEditorialJobV1(job:Job,options:Options={}) {
  const data = job.data as {execution_id?:unknown}|null;
  const execution_id = data && typeof data.execution_id === 'string' ? data.execution_id : '';
  if (job.name !== SIGNAL_WORKSPACE_INCREMENTAL_EDITORIAL_JOB_NAME
    || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(execution_id)
    || job.id !== `signal-workspace-incremental-editorial-${execution_id}-1`)
    throw new Error('workspace_incremental_editorial_job_invalid');
  try {
    const database=options.database??(await import('../db/client')).pool;
    return await (options.run??runWorkspaceIncrementalEditorialConsumerV1)({database,execution_id,worker_job_id:job.id});
  } catch(error) {
    const message=error instanceof Error?error.message:'';
    // BullMQ persists failedReason. Never carry SQL, storage or provider details
    // from setup/claim failures into that user-visible transport record.
    throw new Error(/^workspace_(?:engine_interpretation|incremental_editorial)_[a-z_]{1,100}$/u.test(message)
      ?message:'workspace_incremental_editorial_worker_failed');
  }
}
