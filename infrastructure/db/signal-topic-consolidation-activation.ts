import type { Pool, PoolClient } from 'pg';
import { signalTopicConsolidationActivationCommandV1, signalTopicConsolidationActivationStatusSchemaV1, signalTopicConsolidationBindingSchemaV1, signalTopicConsolidationSnapshotReceiptSchemaV1, signalTopicConsolidationMutationReceiptSchemaV1, signalTopicConsolidationServingSnapshotSchemaV1, type SignalTopicConsolidationBindingV1 } from '@noisia/query-engine';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,digest=/^sha256:[a-f0-9]{64}$/u;
import { loadSignalWorkspaceCapabilitiesStoreV1 } from './signal-workspace-capabilities';

type Database=Pick<Pool,'connect'>;
type Scope={database:Database;workspace_id:string;actor_user_id:string};
export class SignalTopicConsolidationActivationError extends Error {
 constructor(readonly code:string,readonly status=409){super(code);}
}
const fail=(code:string,status=409):never=>{throw new SignalTopicConsolidationActivationError(code,status);};
async function tx<T>(args:Scope,readOnly:boolean,work:(client:PoolClient,capabilities:Awaited<ReturnType<typeof loadSignalWorkspaceCapabilitiesStoreV1>>)=>Promise<T>){
 if(!uuid.test(args.workspace_id)||!uuid.test(args.actor_user_id))fail('topic_consolidation_activation_scope_invalid',422);
 const client=await args.database.connect();
 try{
  await client.query(`${readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN'}; SET LOCAL search_path=public,extensions,pg_temp`);
  const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,...args});
  if(!caps.can_view||!readOnly&&!caps.can_request_processing)fail('topic_consolidation_activation_forbidden',403);
  const result=await work(client,caps);await client.query('COMMIT');return result;
 }catch(error){await client.query('ROLLBACK').catch(()=>undefined);
  if(error instanceof SignalTopicConsolidationActivationError)throw error;
  if(error instanceof Error&&/^(topic_consolidation_activation|processing)_[a-z_]+$/u.test(error.message))throw new SignalTopicConsolidationActivationError(error.message,error.message.endsWith('forbidden')?403:409);
  throw error;}finally{client.release();}
}
export async function loadSignalTopicConsolidationBindingV1(args:Scope){
 return tx(args,true,async client=>{
  const row=(await client.query<{value:unknown}>('SELECT signal_topic_consolidation_binding_v1($1::uuid) value',[args.workspace_id])).rows[0];
  return signalTopicConsolidationBindingSchemaV1.parse(row?.value);
 });
}
export async function prepareSignalTopicConsolidationSnapshotV1(args:Scope&{revision_id:string;revision_digest:string}){
 if(!uuid.test(args.revision_id)||!digest.test(args.revision_digest))fail('topic_consolidation_activation_request_invalid',422);
 return tx(args,false,async client=>{
  const row=(await client.query<{value:unknown}>('SELECT prepare_signal_topic_consolidation_snapshot_v1($1::uuid,$2::uuid,$3::uuid,$4) value',
   [args.workspace_id,args.actor_user_id,args.revision_id,args.revision_digest])).rows[0];
  return signalTopicConsolidationSnapshotReceiptSchemaV1.parse(row?.value);
 });
}
export async function mutateSignalTopicConsolidationBindingV1(args:Scope&{idempotency_key:string;command:unknown}){
 const parsed=signalTopicConsolidationActivationCommandV1.safeParse(args.command);
 if(!parsed.success||!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key))fail('topic_consolidation_activation_request_invalid',422);
 return tx(args,false,async client=>{
  const row=(await client.query<{value:unknown}>('SELECT mutate_signal_topic_consolidation_binding_v1($1::uuid,$2::uuid,$3,$4::jsonb) value',
   [args.workspace_id,args.actor_user_id,args.idempotency_key,JSON.stringify(parsed.data)])).rows[0];
  return signalTopicConsolidationMutationReceiptSchemaV1.parse(row?.value);
 });
}

export type SignalTopicConsolidationServingSnapshotV1={id:string;revision_id:string;revision_digest:string;snapshot_digest:string;
 source_engine_execution_id:string;preparation_run_id:string;input_revision:string;current_revision:string;source_valid:boolean;
 catalog:Array<{concept_key:string;concept_id:string;kind:'topic'|'narrative';locale:string;semantic_identity_digest:string;
 term_key:string;label:string;definition:string;definition_digest:string;definition_revision:number;created_at:string;updated_at:string}>;
 expected_group_count:number;binding:SignalTopicConsolidationBindingV1};
/** Called inside the already authorized serving transaction. No fallback when an
 * explicit snapshot is stale: the UI receives the stale binding, not other data. */
export async function readSignalTopicConsolidationServingBindingV1(client:PoolClient,workspace:string):Promise<{
 binding:SignalTopicConsolidationBindingV1;snapshot:SignalTopicConsolidationServingSnapshotV1|null}|null>{
 const row=(await client.query<{binding:unknown;snapshot:Omit<SignalTopicConsolidationServingSnapshotV1,'binding'>|null}>(`
  SELECT signal_topic_consolidation_binding_v1(b.workspace_id) binding,
   CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('id',s.id,'revision_id',s.revision_id,'revision_digest',s.revision_digest,
    'snapshot_digest',s.snapshot_digest,'source_engine_execution_id',s.source_engine_execution_id,'preparation_run_id',s.preparation_run_id,
    'input_revision',s.input_revision::text,'current_revision',state.input_revision::text,'catalog',s.catalog,
    'expected_group_count',(s.source_binding->>'expected_group_count')::int,'source_valid',signal_topic_consolidation_snapshot_current_v1(s.id)) END snapshot
  FROM signal_topic_consolidation_bindings b LEFT JOIN signal_topic_consolidation_snapshots s ON s.id=b.snapshot_id AND s.workspace_id=b.workspace_id
  LEFT JOIN signal_corpus_preparation_input_state state ON state.workspace_id=b.workspace_id WHERE b.workspace_id=$1::uuid`,[workspace])).rows[0];
 if(!row)return null;
 const binding=signalTopicConsolidationBindingSchemaV1.parse(row.binding);
 if(binding.snapshot_id&&!row.snapshot)fail('topic_consolidation_activation_binding_invalid',503);
 const snapshot=row.snapshot?signalTopicConsolidationServingSnapshotSchemaV1.parse(row.snapshot):null;
 if(snapshot&&snapshot.id!==binding.snapshot_id)fail('topic_consolidation_activation_binding_invalid',503);
 return{binding,snapshot:snapshot?{...snapshot,binding}:null};
}

/** UI-ready catalog and activation status, never raw evidence or provider input. */
export async function loadSignalTopicConsolidationActivationStatusV1(args:Scope){
 return tx(args,true,async(client,capabilities)=>{
  const binding=signalTopicConsolidationBindingSchemaV1.parse((await client.query<{value:unknown}>(
   'SELECT signal_topic_consolidation_binding_v1($1::uuid) value',[args.workspace_id])).rows[0]?.value);
  const revisions=(await client.query<{revision_id:string;revision:number;revision_digest:string;validated_at:string;snapshot_id:string|null;snapshot_digest:string|null;source_valid:boolean|null;catalog:unknown}>(`
   SELECT r.id revision_id,r.revision,r.revision_digest,
    to_char(r.validated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') validated_at,
    s.id snapshot_id,s.snapshot_digest,
    CASE WHEN s.id IS NULL THEN NULL ELSE signal_topic_consolidation_snapshot_current_v1(s.id) END source_valid,s.catalog
   FROM signal_topic_consolidation_revisions r LEFT JOIN signal_topic_consolidation_snapshots s ON s.revision_id=r.id AND s.workspace_id=r.workspace_id
    WHERE r.workspace_id=$1::uuid AND r.status='validated' ORDER BY r.validated_at DESC,r.id LIMIT 10`,[args.workspace_id])).rows;
  const activeRevision=binding.snapshot_id?(await client.query<{revision:number}>(`
   SELECT r.revision FROM signal_topic_consolidation_snapshots s JOIN signal_topic_consolidation_revisions r ON r.id=s.revision_id
   WHERE s.workspace_id=$1::uuid AND s.id=$2::uuid`,[args.workspace_id,binding.snapshot_id])).rows[0]?.revision??null:null;
  return signalTopicConsolidationActivationStatusSchemaV1.parse({contract_version:'signal-topic-consolidation-activation-status-v1',
   workspace_id:args.workspace_id,can_activate:capabilities.can_request_processing,active_revision:activeRevision,binding,revisions});
 });
}
