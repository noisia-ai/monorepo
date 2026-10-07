import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {assertLabelingReceiptGateV1} from './labeling-receipt-gate.mjs';

test('0255 migrator aborts when any recoverable row lacks a verified storage mark',async()=>{
  await assert.rejects(assertLabelingReceiptGateV1({query:async(sql)=>({rows:[sql.includes('information_schema')?{present:false}:{n:1}]})}),
    /labeling_receipt_verification_missing/u);
  await assert.rejects(assertLabelingReceiptGateV1({query:async(sql)=>({rows:[sql.includes('information_schema')?{present:true}:{n:1}]})}),
    /labeling_receipt_verification_missing/u);
  await assert.rejects(assertLabelingReceiptGateV1({query:async(sql)=>({rows:[sql.includes("column_name='raw_storage_verified_key'")?{present:false}:
    sql.includes('information_schema')?{present:true}:{n:1}]})}),
    /labeling_receipt_verification_missing/u);
  let queries=0;
  await assertLabelingReceiptGateV1({query:async()=>{queries++;return{rows:[{n:0}]};}});
  assert.equal(queries,1,'an empty table may proceed without object storage');
  const migrator=await readFile(new URL('./migrate.mjs',import.meta.url),'utf8');
  const lock=migrator.indexOf('LOCK TABLE signal_labeling_calls IN ACCESS EXCLUSIVE MODE');
  const assertGate=migrator.indexOf('assertLabelingReceiptGateV1(client)');
  const drop=migrator.indexOf('await client.query(sql)');
  assert.ok(lock>0&&lock<assertGate&&assertGate<drop,'gate and DROP share the exclusive-lock transaction');
});
