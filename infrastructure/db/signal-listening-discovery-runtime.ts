import type {SignalListeningAccessV1} from './signal-listening-configuration';
import {listeningFailV1 as fail} from './signal-listening-configuration';
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
  return(await args.database.query<{round_id:string;workspace_id:string;actor_user_id:string}>(`
    SELECT r.id round_id,r.workspace_id,p.actor_user_id FROM signal_listening_discovery_rounds r
    JOIN signal_listening_discovery_executions p ON p.id=r.execution_id AND p.workspace_id=r.workspace_id
    WHERE r.id=$1::uuid AND r.status='completed'
      AND NOT EXISTS(SELECT 1 FROM signal_listening_serving_snapshots snapshot
        WHERE snapshot.round_id=r.id AND snapshot.workspace_id=r.workspace_id)`,[args.round_id])).rows[0]??null;
}
