/** Runner-only rollback gate for a paid terminal labeling call. No provider transport. */
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {readSignalLabelingRunExposureV1} from "../../infrastructure/db/signal-labeling-runs";
import {main,openDatabase} from "./guard.mjs";

await main(async()=>{
  const pool=await openDatabase(),client=await pool.connect();
  let stage="preflight",begun=false;
  try{
    const identity=JSON.parse(await readFile(".data/dev-corpus/identity.json","utf8"));
    assert.match(identity.fixture_key,/^[a-z0-9-]+$/u);
    const {rows:[fixture]}=await client.query(`SELECT w.id workspace_id,w.organization_id,o.slug
      FROM signal_workspaces w JOIN organizations o ON o.id=w.organization_id
      WHERE w.id=$1 AND o.id=$2`,[identity.workspace_id,identity.organization_id]);
    assert.equal(fixture?.slug,`mfp-${identity.fixture_key}`);
    const {rows:[run]}=await client.query(`SELECT id FROM signal_labeling_runs WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 1`,[fixture.workspace_id]);
    assert.ok(run?.id,"fixture requires an existing labeling run");
    const old0255=await readFile(new URL("../../infrastructure/db/migrations/0255_signal_labeling_receipts_in_object_storage.sql",import.meta.url));
    const hash=createHash("sha256").update(old0255).digest("hex");
    const {rows:[applied]}=await client.query(`SELECT sha256 FROM mfp_harness.migrations WHERE name='0255_signal_labeling_receipts_in_object_storage.sql'`);
    assert.equal(applied?.sha256,hash,"applied 0255 hash must remain exact");
    const migration=await readFile(new URL("../../infrastructure/db/migrations/0252_signal_labeling_failed_charge_exposure.sql",import.meta.url),"utf8");
    stage="transaction";
    await client.query("BEGIN");begun=true;
    await client.query(migration);
    const {rows:[day]}=await client.query(`SELECT (now() AT TIME ZONE 'UTC')::date::text AS day`);
    const exposure=async()=>((await client.query(
      `SELECT confirmed_micro_usd::text,total_micro_usd::text FROM signal_processing_org_exposure_v1($1,$2::date,'UTC')`,
      [fixture.organization_id,day.day])).rows[0]!);
    const before=await exposure(),beforeRun=BigInt(await readSignalLabelingRunExposureV1(client,run.id));
    stage="terminal_insert";
    const customId=`receipt-ledger-${randomUUID()}`;
    await client.query(`INSERT INTO signal_labeling_calls
      (run_id,workspace_id,provider,model,transport,custom_id,request_digest,request,inputs,
       status,reserved_micro_usd,settled_micro_usd,budget_date,budget_timezone,stop_reason)
      VALUES($1,$2,'anthropic','claude-sonnet-5-5','batch',$3,$4,'{}'::jsonb,'[]'::jsonb,
       'failed',83,83,$5::date,'UTC','labeling_raw_receipt_invalid')`,
      [run.id,fixture.workspace_id,customId,`sha256:${"0".repeat(64)}`,day.day]);
    const after=await exposure(),afterRun=BigInt(await readSignalLabelingRunExposureV1(client,run.id));
    assert.equal(BigInt(after.confirmed_micro_usd)-BigInt(before.confirmed_micro_usd),83n);
    assert.equal(BigInt(after.total_micro_usd)-BigInt(before.total_micro_usd),83n);
    assert.equal(afterRun-beforeRun,83n);
    await client.query("ROLLBACK");begun=false;
    const {rows:[remaining]}=await client.query(`SELECT count(*)::int n FROM signal_labeling_calls WHERE custom_id=$1`,[customId]);
    assert.equal(remaining.n,0);
    console.log(JSON.stringify({status:"passed",cases:4,migration:"0252_rollback",applied_0255_hash_verified:true,
      persisted_calls:0,provider_calls:0,cost_micro_usd:0}));
  }catch(error){
    console.error(JSON.stringify({status:"check_failed",stage,code:(error as {code?:string}).code??null,
      message:error instanceof Error?error.message.slice(0,180):"unknown"}));
    throw error;
  }finally{if(begun)await client.query("ROLLBACK").catch(()=>{});client.release();await pool.end();}
});
