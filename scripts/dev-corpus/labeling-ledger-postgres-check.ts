/** Paid terminal call exposure on migrated public schema, with full rollback. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readSignalLabelingRunExposureV1} from "../../infrastructure/db/signal-labeling-runs";
import {createMigratedLabelingFixture} from "./migrated-labeling-fixture";
import {main,openDatabase} from "./guard.mjs";

await main(async()=>{
 const pool=await openDatabase(),client=await pool.connect();let stage="fixture";
 try{
  await client.query("BEGIN");
  const f=await createMigratedLabelingFixture(pool,client);
  assert.equal((await client.query(`SELECT count(*)::int n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='signal_labeling_calls' AND column_name='raw_body'`)).rows[0].n,0);
  const exposure=async()=>{
   const row=(await client.query(`SELECT confirmed_micro_usd::text,total_micro_usd::text
    FROM signal_processing_org_exposure_v1($1,current_date,'UTC')`,[f.organizationId])).rows[0];
   return{confirmed:BigInt(row.confirmed_micro_usd),total:BigInt(row.total_micro_usd)};
  };
  const before=await exposure(),beforeRun=BigInt(await readSignalLabelingRunExposureV1(client,f.runId));
  stage="terminal_call";
  const id=randomUUID();
  await client.query(`INSERT INTO signal_labeling_calls
   (id,run_id,workspace_id,provider,model,transport,custom_id,request_digest,request,inputs,
   status,reserved_micro_usd,settled_micro_usd,budget_date,budget_timezone,stop_reason)
   VALUES($1,$2,$3,'anthropic','claude-sonnet-5-5','batch',$4,$5,'{}'::jsonb,'[]'::jsonb,
   'failed',83,83,current_date,'UTC','labeling_raw_receipt_invalid')`,
   [id,f.runId,f.workspaceId,`ci-${id}`,`sha256:${"6".repeat(64)}`]);
  const after=await exposure(),afterRun=BigInt(await readSignalLabelingRunExposureV1(client,f.runId));
  assert.equal(after.confirmed-before.confirmed,83n);
  assert.equal(after.total-before.total,83n);
  assert.equal(afterRun-beforeRun,83n);
  await client.query("ROLLBACK");
  assert.equal((await pool.query("SELECT count(*)::int n FROM signal_labeling_calls WHERE id=$1",[id])).rows[0].n,0);
  console.log(JSON.stringify({status:"passed",gate:"migrated_ledger",cases:4,provider_calls:0,cost_micro_usd:0}));
 }catch(error){console.error(JSON.stringify({status:"check_failed",stage,code:(error as {code?:string}).code??null}));throw error;}
 finally{await client.query("ROLLBACK").catch(()=>{});client.release();await pool.end();}
});
