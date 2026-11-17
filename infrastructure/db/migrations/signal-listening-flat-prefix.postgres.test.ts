import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import type {PoolClient} from 'pg';
import {runFlatPrefixAcceptanceV1,flatPreimageSourceV1} from './signal-listening-flat-prefix.oracle';
import {withFlatPrefixReadOnlyV1,releaseFlatPrefixClientV1,flatPrefixLedgerSqlV1} from './signal-listening-flat-prefix.synthetic.fixture';
const native=process.env.NOISIA_R16_FLAT_PREFIX_PG==='true',pure=process.env.NOISIA_R16_FLAT_PREFIX_PURE==='true';assert.ok(!(native&&pure));
test('flat prefix migration preserves native bytes, RAW lineage and function contracts',{skip:!native,timeout:900000},runFlatPrefixAcceptanceV1);
if(pure){
 test('0332 reverses precisely four expressions to the historical0326 source',async()=>{
  const source=await readFile(new URL('./0326_signal_listening_final_answer_slice.sql',import.meta.url),'utf8'),migration=await readFile(new URL('./0332_signal_listening_flat_prefix_preimages.sql',import.meta.url),'utf8');
  flatPreimageSourceV1(source,migration);assert.throws(()=>flatPreimageSourceV1(source,migration.replace('d.created_at','d.changed_at')));assert.throws(()=>flatPreimageSourceV1(source,migration.replace('to_jsonb(i.text)','to_jsonb(i.root_fingerprint)')));
  assert.equal((migration.match(/CREATE OR REPLACE FUNCTION/g)??[]).length,1);assert.ok(!/\b(?:GRANT|REVOKE|ALTER|SECURITY\s+DEFINER)\b/iu.test(migration));
 });
 test('flat acceptance rollback preserves primary and destroys only uncertain clients',async()=>{
  for(const kind of ['none','body','rollback','dual']as const){const primary=Error('primary'),secondary=Error('rollback'),releases:boolean[]=[];
   const c={query:async(s:string)=>{if(s==='ROLLBACK'&&(kind==='rollback'||kind==='dual'))throw secondary;return{rows:[]};},release:(destroy:boolean)=>releases.push(destroy)}as unknown as PoolClient;let caught:unknown;
   try{await withFlatPrefixReadOnlyV1(c,async()=>{if(kind==='body'||kind==='dual')throw primary;});}catch(e){caught=e;}finally{releaseFlatPrefixClientV1(c);}
   if(kind==='dual'){assert.ok(caught instanceof AggregateError);assert.deepEqual(caught.errors,[primary,secondary]);assert.equal(caught.cause,primary);}else assert.equal(caught,kind==='none'?undefined:kind==='body'?primary:secondary);
   assert.deepEqual(releases,[kind==='rollback'||kind==='dual']);
  }
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
  check(flatPrefixLedgerSqlV1);
  assert.throws(()=>check(flatPrefixLedgerSqlV1.replace('c.raw_sha256','c.raw_page_id')),/missing native column c.raw_page_id/);
  // Page and individual-response digests have different grains. The exact
  // writer is the authority for which one attaches to each call.
  const writer=await readFile(new URL('../signal-labeling-raw-page-store.ts',import.meta.url),'utf8');
  assert.ok(writer.includes('raw_storage_verified_at=COALESCE(c.raw_storage_verified_at,(SELECT verified_at FROM raw_attach_page))'));
  assert.ok(writer.includes('raw_storage_verified_key=(SELECT storage_key FROM raw_attach_page)'));
 });
}
