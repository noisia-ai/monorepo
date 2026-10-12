import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {verifyLabelingReceiptObjectV1,verifyLabelingReceiptsBefore0255V1} from "./verify-labeling-receipts-before-0255";

test("0255 verifier marks only objects matching PG body, SHA and byte size",async()=>{
  const body="recibo con acento á";
  const row={id:"call",run_id:"run",workspace_id:"workspace",raw_body:body,
    raw_sha256:`sha256:${createHash("sha256").update(body).digest("hex")}`,raw_storage_key:"private/receipt.parts.json"};
  assert.deepEqual(await verifyLabelingReceiptObjectV1(row,async args=>{
    assert.equal(args.size_bytes,Buffer.byteLength(body));return body;
  }),{sha:row.raw_sha256,size:Buffer.byteLength(body)});
  for(const read of [async()=>{throw new Error("object_missing");},async()=>"corrupt"])
    await assert.rejects(verifyLabelingReceiptObjectV1(row,read),/labeling_receipt_verification_failed/u);
  await assert.rejects(verifyLabelingReceiptObjectV1({...row,raw_sha256:"sha256:"+"0".repeat(64)},async()=>body),
    /labeling_receipt_verification_failed/u);
  await assert.rejects(verifyLabelingReceiptObjectV1({...row,raw_storage_key:null},async()=>body),
    /labeling_receipt_verification_failed/u);
});

test("0255 verifier rolls back every mark if a private object is missing",async()=>{
  const body="receipt";
  const queries:string[]=[];
  const row={id:"00000000-0000-0000-0000-000000000001",run_id:"run",workspace_id:"workspace",
    raw_body:body,raw_sha256:`sha256:${createHash("sha256").update(body).digest("hex")}`,
    raw_storage_key:"private/missing.json"};
  const client={query:async <Row extends Record<string,unknown>>(sql:string):Promise<{rows:Row[]}>=>{
    queries.push(sql);return{rows:(sql.includes("FOR UPDATE")?[row]:[]) as unknown as Row[]};},release:()=>{}};
  const database={connect:async()=>client,end:async()=>{}};
  await assert.rejects(verifyLabelingReceiptsBefore0255V1(database,async()=>{throw new Error("object_missing");}),
    /labeling_receipt_verification_failed/u);
  assert.ok(queries.some(sql=>sql==="ROLLBACK"));
  assert.ok(!queries.some(sql=>sql==="COMMIT"||sql.startsWith("UPDATE signal_labeling_calls")));
});
