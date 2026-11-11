import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {MASS_LABELING_PAID_ADMISSION_GUARD_V1} from '../../../services/workers/src/workers/signal-topic-classification-outbox';

/** Independent expiration fixture, created only after the full replay journey.
 * Real public policy/admission guards remain active. This unbound test grant
 * exercises exactly the relay's paid predicate, not a second engine execution. */
export async function assertNativePaidAdmissionExpiryV2(args:{database:Pool;execution_id:string}){
 const {database,execution_id}=args;
 const base=(await database.query(`SELECT e.processing_admission_id,a.policy_version_id FROM signal_topic_catalog_executions e
  JOIN signal_processing_admissions a ON a.id=e.processing_admission_id WHERE e.id=$1`,[execution_id])).rows[0];
 const policy=randomUUID(),admission=randomUUID();
 const client=await database.connect();
 try{
  await client.query('BEGIN');
  await client.query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
   SELECT $1,organization_id,version+1,'draft',valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id
   FROM signal_processing_policy_versions WHERE id=$2`,[policy,base.policy_version_id]);
  await client.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
   SELECT $1,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed
   FROM signal_processing_policy_actions WHERE policy_version_id=$2`,[policy,base.policy_version_id]);
  await client.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[policy]);
  // No corpus preparation, negative matrix, fit or provider work occurs under
  // this deadline: creation and its positive proof are one server statement.
  const pilot=`SELECT (jsonb_populate_record(NULL::signal_topic_catalog_executions,to_jsonb(e)||jsonb_build_object('processing_admission_id',$2::uuid))).*
    FROM signal_topic_catalog_executions e WHERE e.id=$1`;
  const predicate=`WITH pilot AS(${pilot}) SELECT ${MASS_LABELING_PAID_ADMISSION_GUARD_V1} eligible FROM pilot`;
  const created=(await client.query(`WITH new_grant AS (
   INSERT INTO signal_processing_admissions SELECT
   (jsonb_populate_record(NULL::signal_processing_admissions,to_jsonb(original)||jsonb_build_object(
    'id',$2::uuid,'policy_version_id',$3::uuid,'idempotency_key',$4::text,
    'admission_not_after',clock_timestamp()+interval '5 seconds','created_at',clock_timestamp()))).*
   FROM signal_processing_admissions original WHERE original.id=$5 RETURNING *
   ),signal_processing_admissions AS(SELECT * FROM new_grant),pilot AS(${pilot})
   SELECT new_grant.admission_not_after,${MASS_LABELING_PAID_ADMISSION_GUARD_V1} eligible
   FROM new_grant CROSS JOIN pilot`,[execution_id,admission,policy,randomUUID(),base.processing_admission_id])).rows[0];
  assert.equal(created.eligible,true);
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,created.admission_not_after.getTime()-Date.now()+100)));
  assert.equal((await client.query('SELECT admission_not_after<=clock_timestamp() expired FROM signal_processing_admissions WHERE id=$1',[admission])).rows[0].expired,true);
  assert.equal((await client.query(predicate,[execution_id,admission])).rows[0].eligible,false);
  assert.equal((await client.query('SELECT processing_admission_id FROM signal_topic_catalog_executions WHERE id=$1',[execution_id])).rows[0].processing_admission_id,base.processing_admission_id);
 }finally{await client.query('ROLLBACK');client.release();}
}
