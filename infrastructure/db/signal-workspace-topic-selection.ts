import type {PoolClient} from 'pg';
import {signalWorkspaceEmbeddingDigestV1 as digest} from '@noisia/query-engine';
import {loadSignalWorkspaceCapabilitiesStoreV1} from './signal-workspace-capabilities';
import {loadSignalWorkspaceTopicProjectionStatusWithQueryableV1,type SignalWorkspaceProjectionQueryableV1} from './signal-workspace-topic-projection';
import type {SignalWorkspaceClassificationDatabaseV1} from './signal-workspace-classification';
export class SignalWorkspaceTopicSelectionError extends Error {
 constructor(readonly code:string,readonly status=409){super(code);this.name='SignalWorkspaceTopicSelectionError';}
}
export type SignalWorkspaceTopicSelectionV1={selected:boolean;definition_digest:string;definition_revision:number;generation_id:string|null;
 source_engine_execution_id:string|null;mapping_digest:string|null;selected_by_user_id:string;selected_at:string};
export type SignalWorkspaceTopicSelectionReceiptV1={operation_id:string;term_key:string;revision:number;selection:SignalWorkspaceTopicSelectionV1};
export type SignalWorkspaceTopicSelectionStatusV1={contract_version:'signal-workspace-topic-selection-v1';workspace_id:string;observed_at:string;
 revision:number;items:Record<string,SignalWorkspaceTopicSelectionV1>;request_receipt:SignalWorkspaceTopicSelectionReceiptV1|null};
const fail=(code:string,status=409):never=>{throw new SignalWorkspaceTopicSelectionError(code,status);};
async function tx<T>(database:SignalWorkspaceClassificationDatabaseV1,work:(client:PoolClient)=>Promise<T>,readonly=false){
 const client=await database.connect();try{await client.query(readonly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');
  await client.query('SET LOCAL search_path=public,extensions,pg_temp');await client.query("SET LOCAL TIME ZONE 'UTC'");
  const result=await work(client);await client.query('COMMIT');return result;
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
async function authorize(queryable:SignalWorkspaceProjectionQueryableV1,workspace_id:string,actor_user_id:string,select:boolean){
 const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable,workspace_id,actor_user_id});
 if(!caps.can_view||select&&!caps.can_select_signal)return fail('workspace_topic_selection_forbidden',403);
}
export async function loadSignalWorkspaceTopicSelectionWithQueryableV1(args:{queryable:SignalWorkspaceProjectionQueryableV1;workspace_id:string;actor_user_id:string;idempotency_key?:string}):Promise<SignalWorkspaceTopicSelectionStatusV1>{
 await authorize(args.queryable,args.workspace_id,args.actor_user_id,false);
 const row=(await args.queryable.query<{observed_at:string;state:{revision:number;items:Record<string,SignalWorkspaceTopicSelectionV1>};request_receipt:SignalWorkspaceTopicSelectionReceiptV1|null}>(`
  SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') observed_at,workspace.topic_signal_selection state,
   (SELECT operation.selection_result||jsonb_build_object('operation_id',operation.id,'term_key',operation.result_term_key)
    FROM signal_topic_catalog_operations operation WHERE operation.workspace_id=workspace.id AND operation.action='select_signal'
     AND operation.actor_user_id=$2::uuid AND operation.idempotency_key=$3) request_receipt
  FROM signal_workspaces workspace WHERE workspace.id=$1::uuid`,[args.workspace_id,args.actor_user_id,args.idempotency_key??null])).rows[0];
 if(!row)return fail('workspace_topic_selection_workspace_not_found',404);
 return{contract_version:'signal-workspace-topic-selection-v1',workspace_id:args.workspace_id,observed_at:row.observed_at,
  revision:row.state.revision,items:row.state.items,request_receipt:row.request_receipt};
}
export async function loadSignalWorkspaceTopicSelectionV1(args:{database:SignalWorkspaceClassificationDatabaseV1;workspace_id:string;actor_user_id:string;idempotency_key?:string}){
 return tx(args.database,queryable=>loadSignalWorkspaceTopicSelectionWithQueryableV1({...args,queryable}),true);
}
export async function selectSignalWorkspaceTopicV1(args:{database:SignalWorkspaceClassificationDatabaseV1;workspace_id:string;actor_user_id:string;term_key:string;selected:boolean;
 expected_selection_revision:number;expected_definition_revision:number;expected_definition_digest:string;generation_id:string|null;idempotency_key:string}){
 if(!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key)||!args.term_key||args.term_key.length>200||typeof args.selected!=='boolean'
  ||!Number.isSafeInteger(args.expected_selection_revision)||args.expected_selection_revision<0||!Number.isSafeInteger(args.expected_definition_revision)||args.expected_definition_revision<1
  ||!/^sha256:[0-9a-f]{64}$/u.test(args.expected_definition_digest)||args.selected&&!args.generation_id)return fail('workspace_topic_selection_request_invalid',422);
 const body={action:'select_signal',term_key:args.term_key,selected:args.selected,expected_selection_revision:args.expected_selection_revision,
  expected_definition_revision:args.expected_definition_revision,expected_definition_digest:args.expected_definition_digest,generation_id:args.generation_id};
 const request_digest=digest(body);
 return tx(args.database,async client=>{
  await authorize(client,args.workspace_id,args.actor_user_id,true);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`signal-taxonomy:${args.workspace_id}:topic`]);
  await authorize(client,args.workspace_id,args.actor_user_id,true);
  const prior=(await client.query<{id:string;actor_user_id:string;request_digest:string;action:string;selection_result:{revision:number;selection:SignalWorkspaceTopicSelectionV1}}>(`
   SELECT id,actor_user_id,request_digest,action,selection_result FROM signal_topic_catalog_operations WHERE workspace_id=$1::uuid AND idempotency_key=$2`,[args.workspace_id,args.idempotency_key])).rows[0];
  if(prior){if(prior.action!=='select_signal'||prior.actor_user_id!==args.actor_user_id||prior.request_digest!==request_digest)return fail('workspace_topic_selection_idempotency_conflict');
   return{...prior.selection_result,operation_id:prior.id,replayed:true};}
  const state=(await client.query<{topic_signal_selection:{revision:number;items:Record<string,SignalWorkspaceTopicSelectionV1>}}>(
   'SELECT topic_signal_selection FROM signal_workspaces WHERE id=$1::uuid FOR UPDATE',[args.workspace_id])).rows[0]?.topic_signal_selection;
  if(!state)return fail('workspace_topic_selection_workspace_not_found',404);
  await authorize(client,args.workspace_id,args.actor_user_id,true);
  if(state.revision!==args.expected_selection_revision)return fail('workspace_topic_selection_revision_conflict');
  const profile=(await client.query<{id:string;taxonomy_id:string}>(`SELECT id,taxonomy_id FROM signal_taxonomy_profiles
   WHERE workspace_id=$1::uuid AND kind='topic' AND status IN('draft','active','activating') ORDER BY version DESC LIMIT 1`,[args.workspace_id])).rows[0];
  if(!profile)return fail('workspace_topic_selection_catalog_unavailable');
  let source_engine_execution_id=state.items[args.term_key]?.source_engine_execution_id??null,mapping_digest=state.items[args.term_key]?.mapping_digest??null;
  if(args.selected){
   const projection=(await loadSignalWorkspaceTopicProjectionStatusWithQueryableV1({queryable:client,workspace_id:args.workspace_id,actor_user_id:args.actor_user_id})).latest_complete;
   if(!projection?.is_current||!projection.complete||projection.generation_id!==args.generation_id)return fail('workspace_topic_selection_projection_stale');
   const valid=(await client.query(`SELECT 1 FROM signal_classification_generations generation CROSS JOIN LATERAL jsonb_array_elements(generation.input_snapshot->'topics') topic
    JOIN taxonomy_terms term ON term.term_key=topic->'definition'->>'term_key' WHERE generation.id=$1::uuid AND generation.workspace_id=$2::uuid
     AND topic->'definition'->>'term_key'=$3 AND topic->'definition'->>'definition_digest'=$4
     AND (topic->'definition'->>'definition_revision')::int=$5 AND term.taxonomy_id=$6::uuid AND term.status IN('candidate','active')
     AND topic->'definition'->>'lifecycle'<>'archived' AND term.metadata->'topic'->>'definition_digest'=$4
     AND (term.metadata->'topic'->>'definition_revision')::int=$5 AND term.metadata->'topic'->>'lifecycle'<>'archived'`,[args.generation_id,args.workspace_id,args.term_key,args.expected_definition_digest,args.expected_definition_revision,profile.taxonomy_id])).rows.length>0;
   if(!valid)return fail('workspace_topic_selection_definition_changed');
   const membership=(await client.query(`SELECT 1 FROM signal_classification_assignments assignment
    JOIN signal_classification_generations generation ON generation.id=assignment.generation_id
    JOIN taxonomy_terms term ON term.id=assignment.taxonomy_term_id WHERE generation.id=$1::uuid AND term.term_key=$2
     AND assignment.definition_digest=$3 AND assignment.definition_revision=$4
     AND (assignment.membership_basis='computed_cluster' OR assignment.resolution_method='human' AND assignment.disposition='approved')
     AND signal_workspace_classification_assignment_current_v1(assignment,generation) LIMIT 1`,
    [args.generation_id,args.term_key,args.expected_definition_digest,args.expected_definition_revision])).rows.length>0;
   if(!membership)return fail('workspace_topic_selection_membership_required');
   source_engine_execution_id=projection.source_engine_execution_id;mapping_digest=projection.mapping_digest;
  }
  const selected_at=(await client.query<{value:string}>(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') value`)).rows[0]!.value;
  const selection:SignalWorkspaceTopicSelectionV1={selected:args.selected,definition_digest:args.expected_definition_digest,definition_revision:args.expected_definition_revision,
   generation_id:args.generation_id,source_engine_execution_id,mapping_digest,selected_by_user_id:args.actor_user_id,selected_at};
  const revision=state.revision+1;
  await client.query('UPDATE signal_workspaces SET topic_signal_selection=$2::jsonb WHERE id=$1::uuid',[args.workspace_id,JSON.stringify({revision,items:{...state.items,[args.term_key]:selection}})]);
  const operation=(await client.query<{id:string}>(`INSERT INTO signal_topic_catalog_operations(workspace_id,actor_user_id,action,idempotency_key,request_digest,
   result_profile_id,result_term_key,selection_result) VALUES($1::uuid,$2::uuid,'select_signal',$3,$4,$5::uuid,$6,$7::jsonb) RETURNING id`,
   [args.workspace_id,args.actor_user_id,args.idempotency_key,request_digest,profile.id,args.term_key,JSON.stringify({revision,selection})])).rows[0]!;
  return{revision,selection,operation_id:operation.id,replayed:false};
 });
}
