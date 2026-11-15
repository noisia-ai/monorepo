import type {SignalListeningAccessV1} from './signal-listening-configuration';
import {listeningFailV1 as fail,authorizeSignalListeningV1,listeningTransactionV1} from './signal-listening-configuration';
import {SignalLabelingError} from './signal-labeling-runs';
import {mapCurrent} from './signal-mass-labeling';
import type {ListeningDiscoveryLeaseV1,ListeningDiscoveryRoundV1} from './signal-listening-discovery-money';

type WorkerArgs={database:SignalListeningAccessV1['database'];lease:ListeningDiscoveryLeaseV1};
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
function values(args:WorkerArgs){
  const lease=args.lease;
  if(!lease||![lease.round_id,lease.workspace_id,lease.execution_token].every(value=>typeof value==='string'&&uuid.test(value)))
    fail('listening_discovery_lease_invalid',422);
  return[lease.round_id,lease.workspace_id,lease.execution_token];
}

/** Private worker custody only. A valid lease can reconcile financial evidence
 * after feature or actor revocation; publication still uses the authorized owner. */
export async function getSignalListeningDiscoveryWorkerContextV1(args:WorkerArgs){
  return(await args.database.query<{round_id:string;workspace_id:string;actor_user_id:string;execution_id:string;
    status:ListeningDiscoveryRoundV1['status'];request_body:string;output_configuration_id:string|null;
    classification_preparation_id:string|null;classification_run_id:string|null;classification_status:string|null;preparation_status:string|null}>(`
    SELECT r.id round_id,r.workspace_id,p.actor_user_id,r.execution_id,r.status,r.request_body,r.output_configuration_id,
      r.classification_preparation_id,r.classification_run_id,child.status classification_status,flow.status preparation_status
    FROM signal_listening_discovery_rounds r
    JOIN signal_listening_discovery_executions p ON p.id=r.execution_id AND p.workspace_id=r.workspace_id
    LEFT JOIN signal_labeling_runs child ON child.id=r.classification_run_id AND child.workspace_id=r.workspace_id
    LEFT JOIN signal_listening_preparations flow ON flow.id=r.classification_preparation_id AND flow.workspace_id=r.workspace_id
    WHERE r.id=$1::uuid AND r.workspace_id=$2::uuid AND r.execution_token=$3::uuid
      AND r.execution_expires_at>clock_timestamp() AND r.status NOT IN('completed','failed','stale')`,values(args))).rows[0]??null;
}

/** Check the clock AFTER acquiring the exact row lock. An expired or replaced
 * lease cannot be renewed merely because its UPDATE waited behind another writer. */
export async function renewSignalListeningDiscoveryRoundV1(args:WorkerArgs):Promise<boolean>{
  return(await args.database.query(`WITH locked AS MATERIALIZED (
      SELECT id,execution_expires_at,status FROM signal_listening_discovery_rounds
      WHERE id=$1::uuid AND workspace_id=$2::uuid AND execution_token=$3::uuid FOR UPDATE
    ) UPDATE signal_listening_discovery_rounds r
      SET execution_expires_at=clock_timestamp()+interval '300 seconds'
      FROM locked WHERE r.id=locked.id AND r.execution_token=$3::uuid
        AND locked.execution_expires_at>clock_timestamp() AND locked.status NOT IN('completed','failed','stale') RETURNING r.id`,values(args))).rows.length===1;
}

/** Releasing a live scheduling lease creates no admission, send, settlement or
 * label. The next worker must claim its own token and inspect the durable ledger. */
export async function releaseSignalListeningDiscoveryRoundV1(args:WorkerArgs):Promise<boolean>{
  return(await args.database.query(`WITH locked AS MATERIALIZED (
      SELECT id,execution_expires_at,status FROM signal_listening_discovery_rounds
      WHERE id=$1::uuid AND workspace_id=$2::uuid AND execution_token=$3::uuid FOR UPDATE
    ) UPDATE signal_listening_discovery_rounds r SET execution_token=NULL,execution_expires_at=NULL
      FROM locked WHERE r.id=locked.id AND r.execution_token=$3::uuid
        AND locked.execution_expires_at>clock_timestamp() AND locked.status NOT IN('completed','failed','stale') RETURNING r.id`,values(args))).rows.length===1;
}

/** A completed round is immutable and cannot acquire another processing lease.
 * Recover only its missing publication; the activation owner rechecks authority
 * and serializes idempotently, so this path cannot create a provider attempt. */
export async function getSignalListeningDiscoveryPublicationRecoveryV1(args:{database:WorkerArgs['database'];round_id:string}){
  if(!uuid.test(args.round_id))fail('listening_discovery_round_invalid',422);
  return listeningTransactionV1(args.database,async client=>{
    const row=(await client.query<{round_id:string;workspace_id:string;actor_user_id:string}>(`
    SELECT r.id round_id,r.workspace_id,p.actor_user_id FROM signal_listening_discovery_rounds r
    JOIN signal_listening_discovery_executions p ON p.id=r.execution_id AND p.workspace_id=r.workspace_id
    JOIN signal_processing_policy_versions policy ON policy.id=p.policy_version_id AND policy.organization_id=p.organization_id
      AND policy.status='active' AND policy.valid_from<=clock_timestamp() AND policy.valid_until>clock_timestamp()
    JOIN signal_listening_configurations cfg ON cfg.id=r.output_configuration_id AND cfg.workspace_id=r.workspace_id
      AND cfg.state='published' AND cfg.revision=(SELECT max(revision) FROM signal_listening_configurations
        WHERE workspace_id=r.workspace_id AND state='published')
    WHERE r.id=$1::uuid AND r.status='completed' AND p.status IN('active','completed')
      AND signal_listening_discovery_exposure_v1(p.id)<=p.cap_micro_usd
      AND NOT EXISTS(SELECT 1 FROM signal_listening_discovery_rounds stage JOIN engine_cost_events call ON call.listening_round_id=stage.id
        WHERE stage.execution_id=p.id AND call.call_state<>'settled')
      AND NOT EXISTS(SELECT 1 FROM signal_listening_serving_snapshots snapshot
        WHERE snapshot.round_id=r.id AND snapshot.workspace_id=r.workspace_id)`,[args.round_id])).rows[0];
    if(!row)return null;
    try{
      const capabilities=await authorizeSignalListeningV1(client,row);
      if(!capabilities.can_edit_topics||!capabilities.can_request_processing)return null;
      const source=(await client.query<{map_id:string;current:boolean}>(`SELECT map_id,
        signal_listening_discovery_current_v1(id) current FROM signal_listening_discovery_generations
        WHERE workspace_id=$1 AND id=(SELECT output_generation_id FROM signal_listening_discovery_rounds WHERE id=$2 AND workspace_id=$1)`,
        [row.workspace_id,row.round_id])).rows[0];
      if(!source?.current)return null;
      await mapCurrent(client,row.workspace_id,source.map_id);
      return {round_id:row.round_id,workspace_id:row.workspace_id,actor_user_id:row.actor_user_id};
    }catch(error){
      if(error instanceof SignalLabelingError&&([403,404].includes(error.status)
        ||['mass_labeling_map_stale','mass_labeling_context_changed'].includes(error.code)))return null;
      throw error;
    }
  });
}

/** Scheduling hint only. Financial custody is selected independently, even when
 * authorization is revoked. Every mutating owner rechecks inside its own lock. */
export async function canScheduleSignalListeningDiscoveryAnalysisV1(args:{database:WorkerArgs['database'];round_id:string}){
  if(!uuid.test(args.round_id))fail('listening_discovery_round_invalid',422);
  return listeningTransactionV1(args.database,async client=>{
    const row=(await client.query<{workspace_id:string;actor_user_id:string;map_id:string}>(`SELECT r.workspace_id,p.actor_user_id,p.map_id
      FROM signal_listening_discovery_rounds r JOIN signal_listening_discovery_executions p ON p.id=r.execution_id AND p.workspace_id=r.workspace_id
      JOIN signal_processing_policy_versions policy ON policy.id=p.policy_version_id AND policy.organization_id=p.organization_id
        AND policy.status='active' AND policy.valid_from<=clock_timestamp() AND policy.valid_until>clock_timestamp()
      JOIN signal_listening_configurations cfg ON cfg.id=COALESCE(r.output_configuration_id,r.configuration_id) AND cfg.workspace_id=r.workspace_id
        AND cfg.state='published' AND cfg.revision=(SELECT max(revision) FROM signal_listening_configurations WHERE workspace_id=r.workspace_id AND state='published')
      WHERE r.id=$1::uuid AND r.status IN('queued','reviewing','reviewed','classifying','outcome_unknown') AND p.status='active'
        AND signal_listening_discovery_exposure_v1(p.id)<=p.cap_micro_usd`,[args.round_id])).rows[0];
    if(!row)return false;
    try{
      const caps=await authorizeSignalListeningV1(client,row);
      if(!caps.can_edit_topics||!caps.can_request_processing)return false;
      await mapCurrent(client,row.workspace_id,row.map_id);return true;
    }catch(error){
      if(error instanceof SignalLabelingError&&([403,404].includes(error.status)
        ||['mass_labeling_map_stale','mass_labeling_context_changed'].includes(error.code)))return false;
      throw error;
    }
  });
}
