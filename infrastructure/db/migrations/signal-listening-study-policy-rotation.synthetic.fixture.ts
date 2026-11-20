import assert from 'node:assert/strict';
import type {Pool} from 'pg';
/** Synthetic policy rotation through the native inheritance guard. There is no
 * action/receipt bypass and no mutation of active or historical policy rows. */
export async function rotateSyntheticListeningStudyDailyCapV1(args:{database:Pick<Pool,'connect'>;prior_policy_id:string;actor_user_id:string;daily_cap_micro_usd:string|null}){
 const c=await args.database.connect();try{
  await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  const prior=(await c.query<{organization_id:string}>('SELECT organization_id FROM signal_processing_policy_versions WHERE id=$1',[args.prior_policy_id])).rows[0];assert.ok(prior);
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||$1::uuid::text,0))",[prior.organization_id]);
  const next=(await c.query<{id:string}>(`INSERT INTO signal_processing_policy_versions(organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
   SELECT organization_id,version+1,'draft',clock_timestamp(),valid_until,budget_timezone,$3::bigint,$2
   FROM signal_processing_policy_versions WHERE id=$1 AND status='active' RETURNING id`,[args.prior_policy_id,args.actor_user_id,args.daily_cap_micro_usd])).rows[0];assert.ok(next);
  await c.query(`INSERT INTO signal_processing_policy_actions SELECT $2,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed
   FROM signal_processing_policy_actions WHERE policy_version_id=$1`,[args.prior_policy_id,next.id]);
  const scope=(await c.query<{id:string}>('SELECT signal_listening_study_policy_inherit_v1($1,$2,$3) id',[args.prior_policy_id,next.id,args.actor_user_id])).rows[0];assert.ok(scope?.id);
  assert.equal((await c.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1 AND status='active' RETURNING id",[args.prior_policy_id])).rows.length,1);
  assert.equal((await c.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1 AND status='draft' RETURNING id",[next.id])).rows.length,1);
  await c.query('COMMIT');return{policy_id:next.id,scope_id:scope.id};
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
}
