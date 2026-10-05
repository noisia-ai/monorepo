import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {createSignalLabelingStoreV1,type LabelingRunV1} from "../signal-labeling-runs";

test("0255 validates receipt references and size before dropping the recoverable body", async () => {
  const sql = await readFile(new URL("./0255_signal_labeling_receipts_in_object_storage.sql", import.meta.url), "utf8");
  const validateReferences = sql.indexOf("signal_labeling_receipt_reference_incomplete");
  const validateSize = sql.indexOf("signal_labeling_receipt_too_large");
  const dropBody = sql.indexOf("ALTER TABLE signal_labeling_calls DROP COLUMN raw_body");
  assert.ok(validateReferences > 0 && validateReferences < dropBody);
  assert.ok(validateSize > 0 && validateSize < dropBody);
  assert.match(sql, /raw_storage_key IS NULL OR raw_size_bytes IS NULL OR raw_size_bytes<>octet_length\(raw_body\)/u);
  assert.match(sql, /raw_body IS NOT NULL AND octet_length\(raw_body\)>8388608/u);
});

test("a corrupt object records a terminal run error even when a settled call still has a receipt key",async()=>{
  const statements:string[]=[];
  const query=async(sql:string)=>{
    statements.push(sql);
    return {rows:sql.includes("SELECT id FROM signal_labeling_runs")?[{id:"run"}]:[]};
  };
  const database={connect:async()=>({query,release(){}}),query};
  const store=createSignalLabelingStoreV1({database:database as never,storeRaw:async()=>"unused"});
  await store.fail({id:"run",lease_token:"lease"} as LabelingRunV1,"labeling_raw_receipt_invalid");
  assert.ok(statements.some(sql=>sql.includes("SET error_code=$2,status='failed'")));
  assert.ok(!statements.some(sql=>sql.includes("raw_storage_key IS NOT NULL AND NOT results_applied")),
    "a known corrupt object must not keep the run running");
});
