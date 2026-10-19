import type { Pool } from 'pg';
import { loadSignalWorkspaceCapabilitiesStoreV1 } from './signal-workspace-capabilities';
import { SignalTopicEditorialStoreError } from './signal-topic-consolidation-editorial';

type Db = { database: Pick<Pool, 'connect'> };
type Scope = Db & { workspace_id: string; actor_user_id: string; numeric_execution_id: string };
type Start = { id: string; workspace_id: string; actor_user_id: string; numeric_execution_id: string;
  idempotency_key: string; status: 'queued' | 'running' | 'completed' | 'failed'; execution_id: string | null;
  error_code: string | null; lease_token: string | null; attempt_count: number };
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
const key = (value: string) => /^[A-Za-z0-9._:-]{8,200}$/u.test(value);
const fail = (code: string, status = 409): never => { throw new SignalTopicEditorialStoreError(code, status); };

/** Cheap, idempotent admission *intent*. No policy grant, exposure or provider
 * call is created. The Worker repeats source and policy checks at real admission. */
export async function enqueueSignalTopicEditorialStartV2(args: Scope & { idempotency_key: string }) {
  if (![args.workspace_id,args.actor_user_id,args.numeric_execution_id].every(uuid) || !key(args.idempotency_key))
    fail('topic_editorial_request_invalid',422);
  const client = await args.database.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL search_path=public,extensions,pg_temp');
    const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, workspace_id: args.workspace_id,
      actor_user_id: args.actor_user_id, lock_authority: true });
    if (!caps.can_view || !caps.can_request_processing) fail('processing_forbidden',403);
    const numeric = (await client.query<{run_id:string}>(`SELECT r.id::text run_id
      FROM signal_topic_consolidation_executions e JOIN signal_topic_consolidation_runs r
        ON r.id=e.consolidation_run_id AND r.workspace_id=e.workspace_id
      WHERE e.workspace_id=$1::uuid AND e.id=$2::uuid AND e.status='ready'`,
      [args.workspace_id,args.numeric_execution_id])).rows[0];
    if (!numeric) fail('topic_editorial_source_stale');
    const paid = (await client.query<{execution_id:string;numeric_run_id:string;contract_version:string}>(`SELECT e.id::text execution_id,
      e.numeric_run_id::text,e.plan->>'contract_version' contract_version
      FROM signal_topic_editorial_request_keys k JOIN signal_topic_editorial_executions e ON e.id=k.execution_id
      WHERE k.workspace_id=$1::uuid AND k.actor_user_id=$2::uuid AND k.idempotency_key=$3`,
      [args.workspace_id,args.actor_user_id,args.idempotency_key])).rows[0];
    if (paid) {
      if (paid.numeric_run_id!==numeric!.run_id || paid.contract_version!=='signal-topic-editorial-screening-plan-v2')
        fail('processing_idempotency_conflict');
      await client.query('COMMIT');
      return { start_id: null, execution_id: paid.execution_id, status: 'completed' as const, replayed: true };
    }
    const prior = (await client.query<Start>(`SELECT * FROM signal_topic_editorial_start_intents_v2
      WHERE workspace_id=$1::uuid AND actor_user_id=$2::uuid AND idempotency_key=$3 FOR UPDATE`,
      [args.workspace_id,args.actor_user_id,args.idempotency_key])).rows[0];
    if (prior) {
      if (prior.numeric_execution_id!==args.numeric_execution_id) fail('processing_idempotency_conflict');
      await client.query('COMMIT');
      return { start_id: prior.id, execution_id: prior.execution_id, status: prior.status, replayed: true };
    }
    const active = (await client.query<Start>(`SELECT * FROM signal_topic_editorial_start_intents_v2
      WHERE workspace_id=$1::uuid AND numeric_execution_id=$2::uuid AND status IN('queued','running','completed') FOR UPDATE`,
      [args.workspace_id,args.numeric_execution_id])).rows[0];
    if (active) fail('topic_editorial_existing_execution');
    const created = (await client.query<Start>(`INSERT INTO signal_topic_editorial_start_intents_v2
      (workspace_id,actor_user_id,numeric_execution_id,idempotency_key) VALUES($1::uuid,$2::uuid,$3::uuid,$4)
      RETURNING *`,[args.workspace_id,args.actor_user_id,args.numeric_execution_id,args.idempotency_key])).rows[0]!;
    await client.query('COMMIT');
    return { start_id: created.id, execution_id: null, status: 'queued' as const, replayed: false };
  } catch (error) { await client.query('ROLLBACK').catch(()=>undefined); throw error; }
  finally { client.release(); }
}

export async function loadSignalTopicEditorialStartV2(args: Scope) {
  if (![args.workspace_id,args.actor_user_id,args.numeric_execution_id].every(uuid)) fail('topic_editorial_request_invalid',422);
  const client = await args.database.connect();
  try {
    const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, workspace_id: args.workspace_id,
      actor_user_id: args.actor_user_id });
    if (!caps.can_view) fail('processing_forbidden',403);
    return (await client.query<Start>(`SELECT * FROM signal_topic_editorial_start_intents_v2
      WHERE workspace_id=$1::uuid AND actor_user_id=$2::uuid AND numeric_execution_id=$3::uuid
      ORDER BY created_at DESC,id DESC LIMIT 1`,
      [args.workspace_id,args.actor_user_id,args.numeric_execution_id])).rows[0]??null;
  } finally { client.release(); }
}

/** Claim is in PostgreSQL, never Redis. Expired claims are recoverable and the
 * paid admission still has its own immutable idempotency key. */
export async function claimSignalTopicEditorialStartV2(args: Db & { start_id: string }) {
  if (!uuid(args.start_id)) fail('topic_editorial_request_invalid',422);
  const client = await args.database.connect();
  try {
    return (await client.query<Start>(`UPDATE signal_topic_editorial_start_intents_v2 s SET
      status='running',lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '15 minutes',
      attempt_count=attempt_count+1,updated_at=clock_timestamp()
      WHERE s.id=$1::uuid AND s.attempt_count<20 AND s.next_attempt_at<=clock_timestamp()
        AND (s.status='queued' OR s.status='running' AND s.lease_expires_at<=clock_timestamp())
      RETURNING *`,[args.start_id])).rows[0]??null;
  } finally { client.release(); }
}
export async function completeSignalTopicEditorialStartV2(args: Db & { start_id: string; lease_token: string; execution_id: string }) {
  const client=await args.database.connect();
  try {
    const row=(await client.query<Start>(`UPDATE signal_topic_editorial_start_intents_v2 SET
      status='completed',execution_id=$3::uuid,lease_token=NULL,lease_expires_at=NULL,
      error_code=NULL,updated_at=clock_timestamp()
      WHERE id=$1::uuid AND lease_token=$2::uuid AND status='running' RETURNING *`,
      [args.start_id,args.lease_token,args.execution_id])).rows[0];
    if(!row)fail('topic_editorial_start_lease_conflict');
    return row;
  } finally { client.release(); }
}
export async function renewSignalTopicEditorialStartLeaseV2(args:Db&{start_id:string;lease_token:string}){
  const client=await args.database.connect();
  try{
    return (await client.query(`UPDATE signal_topic_editorial_start_intents_v2 SET
      lease_expires_at=clock_timestamp()+interval '15 minutes',updated_at=clock_timestamp()
      WHERE id=$1::uuid AND lease_token=$2::uuid AND status='running' AND lease_expires_at>clock_timestamp()
      RETURNING id`,[args.start_id,args.lease_token])).rowCount===1;
  }finally{client.release();}
}
export async function failSignalTopicEditorialStartV2(args: Db & { start_id: string; lease_token: string; terminal: boolean; error_code: string }) {
  if(!/^[a-z][a-z0-9_]{1,119}$/u.test(args.error_code))fail('topic_editorial_request_invalid',422);
  const client=await args.database.connect();
  try {
    const row=(await client.query<Start>(`UPDATE signal_topic_editorial_start_intents_v2 SET
      status=CASE WHEN $3::boolean THEN 'failed' ELSE 'queued' END,
      error_code=CASE WHEN $3::boolean THEN $4 ELSE NULL END,
      lease_token=NULL,lease_expires_at=NULL,
      next_attempt_at=clock_timestamp()+CASE WHEN $3::boolean THEN interval '0 seconds' ELSE interval '30 seconds' END,
      updated_at=clock_timestamp()
      WHERE id=$1::uuid AND lease_token=$2::uuid AND status='running' RETURNING *`,
      [args.start_id,args.lease_token,args.terminal,args.error_code])).rows[0];
    if(!row)fail('topic_editorial_start_lease_conflict');
    return row;
  } finally { client.release(); }
}
