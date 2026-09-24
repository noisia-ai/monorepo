import {createHash} from 'node:crypto';
const fail=(code)=>{throw Error(`noi19_dev_test_${code}`);};
export function validateInterestPreparationMigration(manifest,bytes){
 if(manifest?.contract_version!=='interest-preparation-rehearsal-manifest-v1'
  ||manifest.base_table_count!==299||manifest.installed_table_count!==300
  ||manifest.migration_file!=='0183_signal_topic_interest_review.sql'
  ||!/^[a-f0-9]{64}$/u.test(manifest.migration_sha256??'')
  ||createHash('sha256').update(bytes).digest('hex')!==manifest.migration_sha256)fail('migration_mismatch');
}
export async function assertInterestPreparationBase(client){
 const row=(await client.query(`SELECT
  to_regprocedure('public.signal_topic_editorial_execution_replaceable_v1(uuid)') IS NOT NULL successor,
  to_regprocedure('public.signal_topic_editorial_plan_valid_v1(uuid,jsonb)') IS NOT NULL plan,
  to_regprocedure('public.signal_topic_editorial_digest_json_v1(jsonb)') IS NOT NULL digest,
  to_regclass('public.signal_topic_interest_review_preparations') IS NULL preparation_absent,
  NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND (p.proname LIKE 'signal_topic_interest_review_%'
    OR p.proname IN('prepare_signal_topic_interest_review_v1','load_signal_topic_interest_review_preparation_v1'))) functions_absent,
  NOT EXISTS(SELECT 1 FROM pg_event_trigger WHERE evtenabled<>'D') no_event_triggers`)).rows[0];
 if(!row||Object.values(row).length!==6||Object.values(row).some(value=>value!==true))fail('schema_mismatch');
}
