import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {guardEnvironment,sealedTableCount} from './target-guard.mjs';
import {publicTables,verifyEmpty,schemaFingerprint} from './database-checks.mjs';
import {assertImportedServingSchema} from './signal-imported-transaction.mjs';

const fail=code=>{throw Error(`noi19_dev_test_${code}`);};
export function guardUpgradeEnvironment(env,seal,args){
 if(args.length!==1||args[0]!=='--commit-empty-0152-to-0182')fail('upgrade_command_required');
 if(sealedTableCount(seal,{requireExplicit:true})!==269)fail('upgrade_source_invalid');
 return guardEnvironment(env,seal,'NOISIA_DEV_TEST_SCHEMA_UPGRADE_APPROVED');
}

/** Exact reviewed bytes, loaded once before any connection. No SQL substitution,
 * discovery of newer migrations, runtime manifest override or automatic repair. */
export async function loadUpgradePlan(manifest,read=readFile){
 if(manifest.contract_version!=='dev-test-empty-0152-to-0182-manifest-v1'
  ||manifest.from_migration!=='0152'||manifest.to_migration!=='0182'
  ||manifest.before_table_count!==269||manifest.after_table_count!==299
  ||manifest.migrations?.length!==30||manifest.added_tables?.length!==30
  ||new Set(manifest.added_tables).size!==30
  ||manifest.added_tables.some(name=>!/^signal_[a-z_]+$/u.test(name)))fail('upgrade_manifest_invalid');
 const migrations=[];
 for(const [index,item] of manifest.migrations.entries()){
  if(!new RegExp(`^${String(153+index).padStart(4,'0')}_[a-z0-9_]+\\.sql$`,'u').test(item.file)
   ||!/^[a-f0-9]{64}$/u.test(item.sha256))fail('upgrade_manifest_invalid');
  const bytes=await read(new URL(`../../migrations/${item.file}`,import.meta.url));
  if(createHash('sha256').update(bytes).digest('hex')!==item.sha256)fail('upgrade_source_hash_mismatch');
  migrations.push({...item,sql:bytes.toString('utf8')});
 }
 return {...manifest,migrations};
}

export async function assertUpgradeSource(client){
 const row=(await client.query(`SELECT
  NOT EXISTS(SELECT 1 FROM pg_attribute WHERE NOT attisdropped AND
    ((attrelid=to_regclass('public.signal_governance_control_operations') AND attname IN('brand_context_preparation','brand_context_progress'))
     OR (attrelid IN(to_regclass('public.signal_semantic_context_proposal_runs'),to_regclass('public.signal_workspace_embedding_runs')) AND attname='brand_context_preparation_operation_id')
     OR (attrelid=to_regclass('public.signal_semantic_context_element_versions') AND attname='carried_from_element_id'))) absent_0153,
  to_regprocedure('public.signal_topic_editorial_execution_replaceable_v1(uuid)') IS NULL
    AND NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.signal_topic_editorial_executions')
      AND attname='supersedes_execution_id' AND NOT attisdropped) absent_0182,
  EXISTS(SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
    WHERE e.extname='pgcrypto' AND n.nspname='extensions')
    AND to_regprocedure('extensions.digest(bytea,text)') IS NOT NULL digest_ready,
  NOT EXISTS(SELECT 1 FROM pg_event_trigger WHERE evtenabled<>'D') no_event_triggers`)).rows[0];
 if(!row||['absent_0153','absent_0182','digest_ready','no_event_triggers'].some(key=>row[key]!==true))fail('upgrade_source_invalid');
}

/** Called only by the explicit upgrade entrypoint after connected identity is
 * verified. The caller owns BEGIN/COMMIT/ROLLBACK and uncertain-outcome handling. */
export async function applyEmptyUpgrade(client,seal,plan,receipt){
 await client.query("SET LOCAL TIME ZONE 'UTC'; SET LOCAL search_path=public,extensions,pg_temp; SET LOCAL lock_timeout='5s'; SET LOCAL check_function_bodies=on");
 if(!(await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended('noi19-private-dev-test-single-runner-v1',0)) locked")).rows[0].locked)fail('runner_busy');
 const before=await publicTables(client,plan.before_table_count);
 await client.query(`LOCK TABLE ${before.map(row=>row.quoted).join(',')} IN ACCESS EXCLUSIVE MODE`);
 await verifyEmpty(client,before,plan.before_table_count);
 const beforeSha=await schemaFingerprint(client);
 if(beforeSha!==seal.schema_sha256)fail('schema_mismatch');
 await assertUpgradeSource(client);
 if(before.some(row=>plan.added_tables.includes(row.name)))fail('upgrade_source_invalid');
 receipt.before={schema_sha256:beforeSha,table_count:before.length,empty:true};
 for(const migration of plan.migrations){
  // With no mentions, the staged backfill returns zero without changing a
  // business row. Keep its own completion guard; never skip stages 0168/0169.
  if(migration.file.startsWith('0168_')){
   const row=(await client.query(`SELECT NOT EXISTS(SELECT 1 FROM public.mentions) empty,
    public.backfill_signal_mention_text_clean_sha256_v1(1) updated`)).rows[0];
   if(row?.empty!==true||row.updated!==0)fail('upgrade_backfill_not_empty');
  }
  receipt.mutations_started=true;
  await client.query(migration.sql);
  receipt.applied_migrations.push({file:migration.file,sha256:migration.sha256});
 }
 await client.query('SET CONSTRAINTS ALL IMMEDIATE');
 await assertImportedServingSchema(client);
 const target=(await client.query(`SELECT
  EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.signal_topic_editorial_executions')
   AND attname='supersedes_execution_id' AND NOT attisdropped) column_0182,
  EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.signal_topic_editorial_executions')
   AND tgname='topic_editorial_successor_guard' AND tgenabled IN('O','A')) trigger_0182`)).rows[0];
 if(target?.column_0182!==true||target.trigger_0182!==true)fail('upgrade_target_invalid');
 const after=await publicTables(client,plan.after_table_count);
 const expected=before.map(row=>row.name).concat(plan.added_tables).sort();
 if(JSON.stringify(after.map(row=>row.name).sort())!==JSON.stringify(expected))fail('upgrade_table_inventory_mismatch');
 await verifyEmpty(client,after,plan.after_table_count);
 if((await client.query("SELECT to_regclass('public.signal_mention_text_digest_backfill_state') IS NULL absent")).rows[0]?.absent!==true)fail('upgrade_scratch_retained');
 const afterSha=await schemaFingerprint(client);
 if(afterSha===beforeSha)fail('upgrade_schema_unchanged');
 receipt.after={schema_sha256:afterSha,table_count:after.length,empty:true};
 return after;
}

/** The only physical commit. A lost acknowledgment stays uncertain. The caller
 * must destroy the connection on any error here, never replay the migration. */
export async function commitAndVerifyUpgrade(client,plan,receipt,verifyIdentity){
 if(receipt.applied_migrations.length!==30||receipt.before?.empty!==true||receipt.after?.empty!==true
  ||receipt.before.table_count!==269||receipt.after.table_count!==299)fail('upgrade_incomplete');
 receipt.commit_attempted=true;
 if((await client.query('COMMIT')).command!=='COMMIT')fail('upgrade_commit_unverified');
 receipt.commit_acknowledged=true;
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 await verifyIdentity();
 await verifyEmpty(client,await publicTables(client,plan.after_table_count),plan.after_table_count);
 if(await schemaFingerprint(client)!==receipt.after.schema_sha256)fail('schema_changed');
 await client.query('ROLLBACK');
 receipt.post_commit_verified=true;receipt.status='committed';
}
