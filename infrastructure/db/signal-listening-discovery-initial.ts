import type {PoolClient} from 'pg';
import {authorizeSignalListeningV1,listeningTransactionV1,listeningFailV1 as fail,type SignalListeningAccessV1} from './signal-listening-configuration';
import {mapCurrent} from './signal-mass-labeling';
import {lockSignalListeningDiscoveryPolicyWithClientV1,startSignalListeningDiscoveryExecutionWithClientV1,type ListeningDiscoveryExecutionV1} from './signal-listening-discovery-money';
import {refreshSignalListeningDiscoveryWithClientV1,bootstrapEmptySignalListeningDiscoveryWithClientV1} from './signal-listening-discovery';
import type {SignalListeningPreparationV1} from './signal-listening-preparation';
type Database=SignalListeningAccessV1['database'];
export type ListeningDiscoveryInitialIntentV1={id:string;workspace_id:string;organization_id:string;actor_user_id:string;preparation_id:string;
 configuration_id:string;map_id:string;policy_version_id:string;configuration_digest:string;human_revision_digest:string;seed_generation_id:string;
 seed_generation_digest:string;source_census_digest:string;cap_micro_usd:string;auto_discovery:true;origin:'initial';automatic:false;request_digest:string;
 initial_run_id:string|null;processing_admission_id:string|null;confirmed_generation_id:string|null;execution_id:string|null;
 status:'preparing'|'admitted'|'waiting_recovery'|'started'|'stale'|'failed';error_code:string|null};
export type ListeningDiscoveryInitialResultV1={intent:ListeningDiscoveryInitialIntentV1;execution:ListeningDiscoveryExecutionV1|null};
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
/** Same monetary locks as the native owner, then configuration and mutable actor. */
export async function lockSignalListeningDiscoveryInitialRequestWithClientV1(c:PoolClient,args:SignalListeningAccessV1){
 const policy=await lockSignalListeningDiscoveryPolicyWithClientV1(c,args.workspace_id);
 await c.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-listening-config:'||$1,0))",[args.workspace_id]);
 await authorizeSignalListeningV1(c,args,'process');return policy;
}
export async function createSignalListeningDiscoveryInitialIntentWithClientV1(c:PoolClient,args:SignalListeningAccessV1&{preparation:SignalListeningPreparationV1}){
 const f=args.preparation,policy=await lockSignalListeningDiscoveryInitialRequestWithClientV1(c,args);
 if(f.policy_version_id!==policy.id)fail('listening_discovery_initial_policy_changed');
 const map=await mapCurrent(c,args.workspace_id,f.map_id);
 const g=(await c.query<{id:string;snapshot_digest:string}>(`SELECT id,snapshot_digest FROM signal_listening_discovery_generations
  WHERE workspace_id=$1 AND configuration_id=$2 AND map_id=$3 AND status='ready' ORDER BY created_at DESC,id DESC LIMIT 1`,[f.workspace_id,f.configuration_id,f.map_id])).rows[0]
  ??await bootstrapEmptySignalListeningDiscoveryWithClientV1(c,{...args,configuration_id:f.configuration_id,map_id:f.map_id});
 if((await c.query<{blocked:boolean}>('SELECT signal_listening_prior_outcome_unresolved_v1($1,$2,$3,$4) blocked',[f.workspace_id,f.configuration_id,f.map_id,map.entity_context_digest])).rows[0]?.blocked)fail('listening_discovery_initial_prior_outcome_unresolved');
 return(await c.query<ListeningDiscoveryInitialIntentV1>(`INSERT INTO signal_listening_discovery_initial_intents(workspace_id,organization_id,actor_user_id,preparation_id,
  configuration_id,map_id,policy_version_id,configuration_digest,human_revision_digest,map_digest,preparation_run_id,input_revision,entity_context_digest,embedding_config_digest,
  seed_generation_id,seed_generation_digest,source_census_digest,cap_micro_usd,auto_discovery,origin,automatic,review_configuration_digest,jev_configuration_digest)
 SELECT f.workspace_id,$3,f.actor_user_id,f.id,f.configuration_id,f.map_id,f.policy_version_id,cfg.configuration_digest,signal_listening_discovery_human_revision_v1(cfg.id),
  $4,$5,$6,$7,$8,$9,$10,signal_listening_discovery_initial_census_v1($9),f.cap_micro_usd,true,'initial',false,review.configuration_digest,jev.configuration_digest
 FROM signal_listening_preparations f JOIN signal_listening_configurations cfg ON cfg.id=f.configuration_id AND cfg.workspace_id=f.workspace_id
 JOIN signal_processing_policy_actions review ON review.policy_version_id=f.policy_version_id AND review.action='listening_discovery_review'
 JOIN signal_processing_policy_actions jev ON jev.policy_version_id=f.policy_version_id AND jev.action='mass_labeling_jev'
 WHERE f.id=$1 AND f.workspace_id=$2 RETURNING *`,[f.id,f.workspace_id,policy.organization_id,map.map_digest,map.preparation_run_id,map.input_revision,map.entity_context_digest,map.embedding_config_digest,g.id,g.snapshot_digest])).rows[0]!;
}
export async function assertSignalListeningDiscoveryInitialPreparationWithClientV1(c:PoolClient,args:SignalListeningAccessV1&{preparation_id:string}){
 const flow=(await c.query<{auto_discovery:boolean|null}>('SELECT auto_discovery FROM signal_listening_preparations WHERE id=$1 AND workspace_id=$2',[args.preparation_id,args.workspace_id])).rows[0];
 if(!flow?.auto_discovery)return null;
 await lockSignalListeningDiscoveryInitialRequestWithClientV1(c,args);
 const i=(await c.query<ListeningDiscoveryInitialIntentV1&{current:boolean}>('SELECT i.*,signal_listening_discovery_initial_current_v1(i) current FROM signal_listening_discovery_initial_intents i WHERE preparation_id=$1 AND workspace_id=$2 AND actor_user_id=$3',[args.preparation_id,args.workspace_id,args.actor_user_id])).rows[0];
 if(!i?.current||i.status!=='preparing')return fail('listening_discovery_initial_authority_changed');await mapCurrent(c,args.workspace_id,i.map_id);return i;
}
export async function bindSignalListeningDiscoveryInitialAdmissionWithClientV1(c:PoolClient,args:SignalListeningAccessV1&{preparation_id:string;run_id:string}){
 const i=await assertSignalListeningDiscoveryInitialPreparationWithClientV1(c,args);if(!i)return;
 await c.query(`UPDATE signal_listening_discovery_initial_intents i SET initial_run_id=r.id,processing_admission_id=r.processing_admission_id,status='admitted',updated_at=clock_timestamp()
 FROM signal_labeling_runs r WHERE i.id=$1 AND r.id=$2 AND r.workspace_id=i.workspace_id`,[i.id,args.run_id]);
}
async function close(c:PoolClient,i:ListeningDiscoveryInitialIntentV1,status:'stale'|'failed',error:string):Promise<ListeningDiscoveryInitialResultV1>{
 const intent=(await c.query<ListeningDiscoveryInitialIntentV1>('UPDATE signal_listening_discovery_initial_intents SET status=$2,error_code=$3,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',[i.id,status,error])).rows[0]!;return{intent,execution:null};
}
/** Only a sealed original intent may start this automatic parent. No provider,
 * reserve or new processing admission is produced by this transition. */
export async function startSignalListeningDiscoveryInitialV1(args:{database:Database;intent_id:string}):Promise<ListeningDiscoveryInitialResultV1|null>{
 if(!uuid.test(args.intent_id))fail('listening_discovery_initial_invalid',422);
 return listeningTransactionV1(args.database,async c=>{
  const scope=(await c.query<ListeningDiscoveryInitialIntentV1>('SELECT * FROM signal_listening_discovery_initial_intents WHERE id=$1',[args.intent_id])).rows[0];if(!scope)return null;
  const policy=(await c.query<{budget_timezone:string}>('SELECT budget_timezone FROM signal_processing_policy_versions WHERE id=$1',[scope.policy_version_id])).rows[0]!;
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||$1,0))",[scope.organization_id]);
  await c.query('SELECT signal_processing_lock_v1($1,(clock_timestamp() AT TIME ZONE $2)::date)',[scope.organization_id,policy.budget_timezone]);
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-listening-config:'||$1,0))",[scope.workspace_id]);
  const i=(await c.query<ListeningDiscoveryInitialIntentV1>('SELECT * FROM signal_listening_discovery_initial_intents WHERE id=$1 FOR UPDATE',[scope.id])).rows[0]!;
  if(i.status==='started')return{intent:i,execution:(await c.query<ListeningDiscoveryExecutionV1>('SELECT * FROM signal_listening_discovery_executions WHERE id=$1 AND workspace_id=$2',[i.execution_id,i.workspace_id])).rows[0]!};
  if(i.status==='stale'||i.status==='failed')return{intent:i,execution:null};
  const access={database:args.database,workspace_id:i.workspace_id,actor_user_id:i.actor_user_id};
  try{await authorizeSignalListeningV1(c,access,'process');await mapCurrent(c,i.workspace_id,i.map_id);}
  catch(error){if(error instanceof Error&&/^(listening_forbidden|listening_not_enabled|mass_labeling_map_stale|mass_labeling_context_changed)$/u.test(error.message))return close(c,i,'stale',error.message);throw error;}
  if(!(await c.query<{current:boolean}>('SELECT signal_listening_discovery_initial_current_v1(i) current FROM signal_listening_discovery_initial_intents i WHERE id=$1',[i.id])).rows[0]?.current)return close(c,i,'stale','listening_discovery_initial_authority_changed');
  const flow=(await c.query<{status:string;error_code:string|null;prototype_run_id:string|null}>('SELECT status,error_code,prototype_run_id FROM signal_listening_preparations WHERE id=$1',[i.preparation_id])).rows[0]!;
  if(flow.status==='failed'&&!i.initial_run_id)return close(c,i,'failed',flow.error_code??'listening_discovery_initial_preparation_failed');
  if(!i.initial_run_id)return{intent:i,execution:null};
  const run=(await c.query<{status:string;error_code:string|null}>('SELECT status,error_code FROM signal_labeling_runs WHERE id=$1 AND workspace_id=$2',[i.initial_run_id,i.workspace_id])).rows[0]!;
  if(['failed','running'].includes(run.status)&&(run.error_code==='labeling_outcome_unknown'||run.status==='failed'&&(await c.query('SELECT 1 FROM signal_labeling_calls WHERE run_id=$1 AND raw_storage_key IS NOT NULL AND NOT results_applied LIMIT 1',[i.initial_run_id])).rows.length)){
   // A paid ambiguous or already-durable result keeps its original intent.
   // The native labeling recovery drainer, never a new admission, resolves it.
   const parked=i.status==='waiting_recovery'?i:(await c.query<ListeningDiscoveryInitialIntentV1>("UPDATE signal_listening_discovery_initial_intents SET status='waiting_recovery',error_code=$2,updated_at=clock_timestamp() WHERE id=$1 RETURNING *",[i.id,run.error_code??'listening_discovery_initial_raw_recovery'])).rows[0]!;
   return{intent:parked,execution:null};
  }
  if(['failed','canceled','stale'].includes(run.status))return close(c,i,'failed',run.error_code??'listening_discovery_initial_labeling_failed');
  if(run.status!=='completed')return{intent:i,execution:null};
  const unresolved=(await c.query(`SELECT 1 FROM signal_labeling_calls WHERE run_id=$1 AND(status IN('reserved','submitting','submitted','unknown') OR terminal_exposure_micro_usd>0 OR raw_storage_key IS NOT NULL AND NOT results_applied) LIMIT 1`,[i.initial_run_id])).rows.length;
  if(unresolved)return close(c,i,'failed','listening_discovery_initial_outcome_unresolved');
  const generation=await refreshSignalListeningDiscoveryWithClientV1(c,{...access,configuration_id:i.configuration_id,map_id:i.map_id,round:1,source_generation_id:i.seed_generation_id});
  const execution=await startSignalListeningDiscoveryExecutionWithClientV1(c,{...access,generation_id:generation.id,classification_run_id:i.initial_run_id,preparation_id:i.preparation_id,
   cap_micro_usd:Number(i.cap_micro_usd),idempotency_key:'listening-initial:'+i.id,initial_intent_id:i.id});
  const intent=(await c.query<ListeningDiscoveryInitialIntentV1>(`UPDATE signal_listening_discovery_initial_intents SET status='started',confirmed_generation_id=$2,execution_id=$3,error_code=NULL,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,[i.id,generation.id,execution.id])).rows[0]!;
  return{intent,execution};
 });
}
/** Selection is restricted to explicit admitted intentions, including stale
 * authority needing terminal bookkeeping; a completed arbitrary run is absent. */
export async function pendingSignalListeningDiscoveryInitialV1(args:{database:Database;limit?:number}){
 const limit=args.limit??20;if(!Number.isInteger(limit)||limit<1||limit>200)fail('listening_discovery_initial_limit_invalid',422);
 return(await args.database.query<{intent_id:string}>(`SELECT i.id intent_id FROM signal_listening_discovery_initial_intents i
 JOIN signal_listening_preparations f ON f.id=i.preparation_id LEFT JOIN signal_labeling_runs r ON r.id=i.initial_run_id
 WHERE i.status IN('preparing','admitted','waiting_recovery') AND(i.initial_run_id IS NULL AND f.status='failed' OR r.status IN('completed','canceled') OR(r.status='failed' OR r.error_code='labeling_outcome_unknown') AND i.status<>'waiting_recovery' OR NOT COALESCE(signal_listening_discovery_initial_current_v1(i),false))
 ORDER BY i.created_at,i.id LIMIT $1`,[limit])).rows;
}
