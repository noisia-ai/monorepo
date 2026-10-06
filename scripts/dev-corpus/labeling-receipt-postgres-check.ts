/** Remote MFP runner only. Exercises production SQL and store against disposable PG temp tables. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createSignalLabelingStoreV1, type LabelingRunV1 } from "../../infrastructure/db/signal-labeling-runs";
import { main, openDatabase } from "./guard.mjs";

await main(async () => {
  const pool = await openDatabase();
  const client = await pool.connect();
  let stage = "setup";
  try {
    await client.query(`CREATE TEMP TABLE signal_labeling_calls (
      id uuid PRIMARY KEY,run_id uuid NOT NULL,status text NOT NULL,
      raw_body text,raw_storage_key text,raw_sha256 text,
      raw_storage_verified_at timestamptz,raw_storage_verified_key text,
      raw_size_bytes bigint,results_applied boolean NOT NULL DEFAULT false,created_at timestamptz DEFAULT now(),
      settled_micro_usd bigint,reserved_micro_usd bigint NOT NULL,updated_at timestamptz DEFAULT now()
    )`);
    const migration = await readFile(new URL("../../infrastructure/db/migrations/0254_signal_labeling_receipt_verified_gate.sql", import.meta.url), "utf8");
    stage="empty_gate";
    await client.query(migration); // Empty table is safe.
    const callId = randomUUID(), runId = randomUUID(), lease = randomUUID();
    await client.query(`INSERT INTO signal_labeling_calls(id,run_id,status,raw_body,reserved_micro_usd)
      VALUES($1,$2,'submitted','receipt',47)`, [callId,runId]);
    stage="unverified_body";
    await assert.rejects(client.query(migration), /signal_labeling_receipt_unverified/u);
    await client.query(`UPDATE signal_labeling_calls SET raw_storage_key='private/key',
      raw_storage_verified_key='private/key',raw_storage_verified_at=now() WHERE id=$1`,[callId]);
    const reservedId = randomUUID();
    await client.query(`INSERT INTO signal_labeling_calls(id,run_id,status,reserved_micro_usd)
      VALUES($1,$2,'reserved',13)`,[reservedId,runId]);
    stage="unverified_reserved";
    await assert.rejects(client.query(migration), /signal_labeling_receipt_unverified/u);
    await client.query(`UPDATE signal_labeling_calls SET raw_storage_verified_at=now() WHERE id=$1`,[reservedId]);
    stage="verified_gate";
    await client.query(migration);
    await client.query(`UPDATE signal_labeling_calls SET raw_body=NULL,raw_sha256='sha256:'||repeat('0',64),raw_size_bytes=7 WHERE id=$1`,[callId]);
    await client.query(`CREATE TEMP TABLE signal_labeling_runs (
      id uuid PRIMARY KEY,lease_token uuid,lease_until timestamptz,status text,
      error_code text,updated_at timestamptz DEFAULT now()
    )`);
    await client.query(`INSERT INTO signal_labeling_runs(id,lease_token,lease_until,status)
      VALUES($1,$2,now()+interval '5 minutes','running')`,[runId,lease]);
    const database = {connect:async()=>({query:client.query.bind(client),release(){}}),query:client.query.bind(client)};
    const store=createSignalLabelingStoreV1({database:database as never,storeRaw:async()=>"unused"});
    const transientStore=createSignalLabelingStoreV1({database:database as never,storeRaw:async()=>"unused",
      loadRaw:async()=>{throw new Error("workspace_engine_storage_unavailable");}});
    stage="transient_read";
    await assert.rejects(transientStore.calls({id:runId,workspace_id:randomUUID()} as LabelingRunV1),
      /labeling_raw_storage_unavailable/u);
    const {rows:[afterTransient]}=await client.query(`SELECT r.status,r.lease_until>now() lease_valid,c.status call_status
      FROM signal_labeling_runs r JOIN signal_labeling_calls c ON c.run_id=r.id WHERE r.id=$1 AND c.id=$2`,[runId,callId]);
    assert.deepEqual(afterTransient,{status:"running",lease_valid:true,call_status:"submitted"});
    const missingStore=createSignalLabelingStoreV1({database:database as never,storeRaw:async()=>"unused",
      loadRaw:async()=>{throw new Error("workspace_engine_storage_object_missing");}});
    stage="missing_read";
    await assert.rejects(missingStore.calls({id:runId,workspace_id:randomUUID()} as LabelingRunV1),
      /labeling_raw_receipt_invalid/u);
    stage="terminal_close";
    await store.fail({id:runId,lease_token:lease} as LabelingRunV1,"labeling_raw_receipt_invalid");
    const {rows:calls}=await client.query(`SELECT status,settled_micro_usd FROM signal_labeling_calls WHERE run_id=$1 ORDER BY reserved_micro_usd`,[runId]);
    assert.deepEqual(calls,[{status:"failed",settled_micro_usd:null},{status:"failed",settled_micro_usd:"47"}]);
    const {rows:[run]}=await client.query(`SELECT status,error_code FROM signal_labeling_runs WHERE id=$1`,[runId]);
    assert.deepEqual(run,{status:"failed",error_code:"labeling_raw_receipt_invalid"});
    console.log(JSON.stringify({status:"passed",gate:"0254",cases:5,provider_calls:0,cost_micro_usd:0}));
  } catch(error) {
    console.error(JSON.stringify({status:"check_failed",stage,code:(error as {code?:string}).code??null,
      message:error instanceof Error?error.message.slice(0,180):"unknown"}));
    throw error;
  } finally { client.release(); await pool.end(); }
});
