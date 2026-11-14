import type {SignalListeningCalibrationProfileV1} from '@noisia/query-engine';
import {authorizeSignalListeningV1,listeningTransactionV1,listeningFailV1 as fail,type SignalListeningAccessV1} from './signal-listening-configuration';
export async function loadSignalListeningCalibrationV1(args:SignalListeningAccessV1&{configuration_digest:string;model:string;shape_digest:string}):Promise<SignalListeningCalibrationProfileV1|null>{
 return listeningTransactionV1(args.database,async c=>{await authorizeSignalListeningV1(c,args,'process');
  return (await c.query<{profile:SignalListeningCalibrationProfileV1}>(`SELECT profile FROM signal_listening_calibrations
   WHERE workspace_id=$1 AND profile#>>'{scope,configuration_digest}'=$2 AND profile#>>'{scope,model}'=$3
    AND profile#>>'{scope,shape_digest}'=$4 ORDER BY created_at DESC,id DESC LIMIT 1`,
   [args.workspace_id,args.configuration_digest,args.model,args.shape_digest])).rows[0]?.profile??null;
 });
}
/** The database derives measured values from normal, paid, verified receipts.
 * Callers supply no token ratios, source ids or byte estimates. */
export async function deriveSignalListeningCalibrationV1(args:SignalListeningAccessV1&{run_id:string;shape_digest:string;max_sample?:number}):Promise<SignalListeningCalibrationProfileV1|null>{
 if(args.max_sample!==undefined&&args.max_sample!==32)fail('listening_calibration_sample_invalid',422);
 return listeningTransactionV1(args.database,async c=>{await authorizeSignalListeningV1(c,args,'process');
  const owner=(await c.query(`SELECT 1 FROM signal_listening_runs o JOIN signal_labeling_runs r ON r.id=o.run_id
   WHERE o.workspace_id=$1 AND o.run_id=$2 AND r.actor_user_id=$3`,[args.workspace_id,args.run_id,args.actor_user_id])).rows[0];
  if(!owner)fail('listening_calibration_run_forbidden',403);
  const value=(await c.query<{profile:SignalListeningCalibrationProfileV1|null}>(`SELECT signal_listening_calibration_evidence_v1($1,$2,$3) profile`,
   [args.workspace_id,args.run_id,args.shape_digest])).rows[0]?.profile??null;
  if(!value)return null;
  await c.query(`INSERT INTO signal_listening_calibrations(workspace_id,source_run_id,scope_digest,source_digest,profile,created_by_user_id)
   SELECT $1,$2,profile->>'scope_digest',profile->>'source_digest',profile,$4 FROM
    (SELECT signal_listening_calibration_evidence_v1($1,$2,$3) profile) evidence
   WHERE profile IS NOT NULL ON CONFLICT(scope_digest,source_digest) DO NOTHING`,
   [args.workspace_id,args.run_id,args.shape_digest,args.actor_user_id]);
  return value;
 });
}
