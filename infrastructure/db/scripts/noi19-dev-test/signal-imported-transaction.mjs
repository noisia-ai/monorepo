/** Synthetic test transactions share one physical connection and use savepoints.
 * Preserve the production reader's SET LOCAL fences instead of discarding the
 * statements after BEGIN. Never commit the runner's outer physical transaction. */
export function savepointQueryable(client){
 const stack=[];let serial=0;
 const query=async(sql,params)=>{
  if(/^BEGIN(?:\s|;|$)/u.test(sql)){
   const [begin,...settings]=sql.split(';').map(value=>value.trim()).filter(Boolean);
   // Nested SERIALIZABLE requests are represented by savepoints inside the
   // runner's rollback-only READ COMMITTED transaction. This rehearses the
   // sequential path; it does not certify isolation or concurrent writers.
   if(params?.length||!/^BEGIN(?: ISOLATION LEVEL (?:READ COMMITTED|REPEATABLE READ|SERIALIZABLE)(?: READ ONLY)?)?$/u.test(begin)
    ||settings.some(value=>!/^SET LOCAL (?:TIME ZONE 'UTC'|search_path=public,extensions,pg_temp|enable_nestloop=off|jit=off)$/u.test(value)))
    throw Error('noi19_dev_test_transaction_setup_invalid');
   const key=`signal_imported_${++serial}`;
   const result=await client.query(`SAVEPOINT ${key}`);stack.push(key);
   for(const setting of settings)await client.query(setting);
   return result;
  }
  if(sql==='COMMIT'||sql==='ROLLBACK'){
   const key=stack.pop();if(!key)throw Error('noi19_dev_test_unbalanced_transaction');
   if(sql==='ROLLBACK')await client.query(`ROLLBACK TO SAVEPOINT ${key}`);
   return client.query(`RELEASE SAVEPOINT ${key}`);
  }
  return client.query(sql,params);
 };
 return {query,get depth(){return stack.length;}};
}

/** Check marker signatures and the exact-text invariant before fixture mutation.
 * The full reviewed schema fingerprint remains mandatory in addition to these. */
export async function assertImportedServingSchema(client){
 const row=(await client.query(`SELECT
  to_regprocedure('public.signal_topic_consolidation_binding_v1(uuid)') IS NOT NULL binding,
  to_regprocedure('public.signal_topic_consolidation_snapshot_current_v1(uuid)') IS NOT NULL snapshot,
  to_regprocedure('public.signal_topic_editorial_execution_replaceable_v1(uuid)') IS NOT NULL successor,
  to_regprocedure('public.signal_workspace_projection_source_current_v1(public.signal_classification_generations)') IS NOT NULL projection,
  EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.mentions')
    AND conname='mentions_text_clean_sha256_exact' AND convalidated) digest_validated,
  EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.mentions')
    AND attname='text_clean_sha256' AND attnotnull AND NOT attisdropped) digest_required,
  EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.mentions')
    AND tgname='trg_signal_mention_text_clean_sha256' AND tgenabled IN('O','A')) digest_maintained`)).rows[0];
 if(!row||['binding','snapshot','successor','projection','digest_validated','digest_required','digest_maintained'].some(key=>row[key]!==true))
  throw Error('noi19_dev_test_schema_mismatch');
}
