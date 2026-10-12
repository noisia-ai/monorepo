import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {createWorkspaceEngineStorageV1} from "../../services/workers/src/workers/signal-workspace-engine-storage";
import {readSignalLabelingReceiptV1} from "../../services/workers/src/workers/signal-labeling-receipt-storage";

type Receipt={id:string;run_id:string;workspace_id:string;raw_body:string;raw_sha256:string|null;raw_storage_key:string|null};
type Queryable={query<Row extends Record<string,unknown>>(sql:string,params?:unknown[]):Promise<{rows:Row[]}>};
type Database={connect():Promise<Queryable&{release():void}>;end():Promise<void>};
export async function verifyLabelingReceiptObjectV1(row:Receipt,read:(args:{workspace_id:string;run_id:string;
  storage_key:string;raw_sha256:string;size_bytes:number})=>Promise<string>){
  const size=Buffer.byteLength(row.raw_body);
  const sha=`sha256:${createHash("sha256").update(row.raw_body).digest("hex")}`;
  if(!row.raw_storage_key||row.raw_sha256!==sha||size>8_388_608)throw new Error("labeling_receipt_verification_failed");
  let stored:string;
  try{stored=await read({workspace_id:row.workspace_id,run_id:row.run_id,storage_key:row.raw_storage_key,
    raw_sha256:sha,size_bytes:size});}catch{throw new Error("labeling_receipt_verification_failed");}
  if(stored!==row.raw_body||Buffer.byteLength(stored)!==size)throw new Error("labeling_receipt_verification_failed");
  return {sha,size};
}

export async function verifyLabelingReceiptsBefore0255V1(database:Database,read:(args:{workspace_id:string;run_id:string;
  storage_key:string;raw_sha256:string;size_bytes:number})=>Promise<string>){
  const client=await database.connect();
  try{
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await client.query("ALTER TABLE signal_labeling_calls ADD COLUMN IF NOT EXISTS raw_storage_verified_at timestamptz");
    await client.query("ALTER TABLE signal_labeling_calls ADD COLUMN IF NOT EXISTS raw_storage_verified_key text");
    const rows=(await client.query<Receipt>(`SELECT call.id::text,call.run_id::text,run.workspace_id::text,
      call.raw_body,call.raw_sha256,call.raw_storage_key
      FROM signal_labeling_calls call JOIN signal_labeling_runs run ON run.id=call.run_id
      WHERE call.raw_body IS NOT NULL ORDER BY call.id FOR UPDATE OF call`)).rows;
    for(const row of rows){
      await verifyLabelingReceiptObjectV1(row,read);
      const marked=await client.query(`UPDATE signal_labeling_calls SET raw_storage_verified_at=clock_timestamp(),raw_storage_verified_key=$3
        WHERE id=$1::uuid AND raw_sha256=$2 AND raw_storage_key=$3 AND raw_body=$4 RETURNING id`,
      [row.id,row.raw_sha256,row.raw_storage_key,row.raw_body]);
      assert.equal(marked.rows.length,1,"receipt changed during verification");
    }
    await client.query("COMMIT");
    return rows.length;
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();}
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  const {openDatabase}=await import("./guard.mjs");
  const database:Database=await openDatabase();
  try{
    const storage=createWorkspaceEngineStorageV1();
    const verified=await verifyLabelingReceiptsBefore0255V1(database,args=>readSignalLabelingReceiptV1({storage,...args}));
    console.log(JSON.stringify({status:"verified",receipts:verified}));
  }catch{
    console.error(JSON.stringify({status:"failed",code:"labeling_receipt_verification_failed"}));
    process.exitCode=1;
  }finally{await database.end();}
}
