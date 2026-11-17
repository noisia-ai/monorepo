import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import type {PoolClient} from 'pg';
import {runPrefixFunctionProfileV1,writePrefixFunctionProfileV1,extractPrefixBoundedV1,
 prefixFunctionDeltasV1,withPrefixReadOnlyV1,releasePrefixClientV1,prefixSetupLedgerSqlV1} from './signal-listening-prefix-function-profile.fixture';
const pure=process.env.NOISIA_R16_PREFIX_FUNCTION_PROFILE_PURE==='true';
const native=process.env.NOISIA_R16_PREFIX_FUNCTION_PROFILE_PG==='true';
assert.ok(!(pure&&native),'pure mode cannot enable the PostgreSQL acceptance');
test('native FULL consumer prefix exposes one inner plan and transaction-local function counters',{
 skip:!native,timeout:900000,
},async()=>writePrefixFunctionProfileV1(await runPrefixFunctionProfileV1()));
if(pure){
 test('prefix extraction is exact bounded0326 and rejects changed source',async()=>{
  const source=await readFile(new URL('./0326_signal_listening_final_answer_slice.sql',import.meta.url),'utf8'),result=extractPrefixBoundedV1(source);
  assert.equal(Buffer.byteLength(result.sql),8426);assert.equal(result.sha256,'22aa122d25e9da2d9ba236527bb02e23053d296a83f9d53a1b5ba9096f8cb9a9');
  assert.throws(()=>extractPrefixBoundedV1(source.replace("m.inclusion_status='included'","m.inclusion_status='excluded'")));
 });
 test('prefix RAW witness columns exist on their native call member and page tables',async()=>{
  // DDL contract check only: PostgreSQL compilation remains a native-only gate.
  const ddl=await Promise.all(['0221_signal_labeling_core.sql','0255_signal_labeling_receipts_in_object_storage.sql',
   '0257_signal_labeling_receipt_verification.sql','0261_signal_hybrid_batch_confirmation.sql','0295_signal_labeling_raw_pages.sql']
   .map(name=>readFile(new URL(name,import.meta.url),'utf8')));
  const columns=(table:string)=>{
   const source=ddl.find(s=>s.includes('CREATE TABLE '+table+' ('))!;
   const body=source.split('CREATE TABLE '+table+' (')[1]!.split('\n);')[0]!;
   const fields=new Set([...body.matchAll(/(?:^|,)\s*(\w+)\s+(?:uuid|text|jsonb|integer|bigint|boolean|timestamptz|date)\b/gu)].map(m=>m[1]));
   for(const source of ddl)for(const m of source.matchAll(new RegExp('ALTER TABLE '+table+' ADD COLUMN (?:IF NOT EXISTS )?(\\w+)','gu')))fields.add(m[1]);
   return fields;
  };
  const tables={c:columns('signal_labeling_calls'),member:columns('signal_labeling_raw_page_members'),page:columns('signal_labeling_raw_pages')};
  const check=(sql:string)=>{for(const m of sql.matchAll(/\b(c|member|page)\.(\w+)\b/gu))assert.ok(tables[m[1] as keyof typeof tables].has(m[2]),'missing native column '+m[0]);};
  check(prefixSetupLedgerSqlV1);
  assert.throws(()=>check(prefixSetupLedgerSqlV1.replace('c.raw_sha256','c.raw_page_id')),/missing native column c.raw_page_id/);
  // Page and individual-response digests have different grains. The exact
  // writer is the authority for which one attaches to each call.
  const writer=await readFile(new URL('../signal-labeling-raw-page-store.ts',import.meta.url),'utf8');
  assert.ok(writer.includes('raw_storage_verified_at=COALESCE(c.raw_storage_verified_at,(SELECT verified_at FROM raw_attach_page))'));
  assert.ok(writer.includes('raw_storage_verified_key=(SELECT storage_key FROM raw_attach_page)'));
 });
 test('prefix function counters retain absent entries as unknown and never fabricate CPU',()=>{
  const row={funcid:'1',schemaname:'public',funcname:'sample',calls:'2',total_time:4,self_time:3};
  const deltas=prefixFunctionDeltasV1(['1','2','3'],[row],[{...row,calls:'5',total_time:9,self_time:6},{...row,funcid:'2'}]);
  assert.deepEqual(deltas[0]?.delta,{calls:'3',total_time_ms:5,self_time_ms:3});
  assert.equal(deltas[1]?.status,'entry_created_baseline_absent');assert.equal(deltas[1]?.delta,null);
  assert.equal(deltas[2]?.status,'unobserved_unknown');assert.equal(deltas[2]?.after,null);assert.equal(deltas[2]?.delta,null);
  assert.throws(()=>prefixFunctionDeltasV1(['1'],[row],[{...row,calls:'1'}]));
 });
 test('prefix rollback preserves dual failures and destroys only uncertain clients once',async()=>{
  for(const kind of ['none','body','rollback','dual'] as const){
   const primary=Error('primary'),secondary=Error('rollback'),releases:boolean[]=[];
   const c={query:async(sql:string)=>{if(sql==='ROLLBACK'&&(kind==='rollback'||kind==='dual'))throw secondary;return{rows:[]};},release:(destroy:boolean)=>releases.push(destroy)} as unknown as PoolClient;
   let caught:unknown;
   try{await withPrefixReadOnlyV1(c,async()=>{if(kind==='body'||kind==='dual')throw primary;});}catch(error){caught=error;}finally{releasePrefixClientV1(c);}
   if(kind==='dual'){assert.ok(caught instanceof AggregateError);assert.deepEqual(caught.errors,[primary,secondary]);assert.equal(caught.cause,primary);}
   else assert.equal(caught,kind==='none'?undefined:kind==='body'?primary:secondary);
   assert.deepEqual(releases,[kind==='rollback'||kind==='dual']);
  }
 });
}
