import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {nativeDmlPlanShaV1,type NativeDmlPlanClientV1,type NativeDmlPlanSnapshotV1} from './signal-listening-native-dml-plan.test-support';

export const NATIVE_LATE_SNAPSHOT_CONTRACT_V1='r16-native-late-fullstate-stream-v1';
export const NATIVE_LATE_SNAPSHOT_FETCH_ROWS_V1=128;
export type NativeLateSnapshotTableV1={name:string;sql:string;values:unknown[]};
/** Every SQL row hashes its complete to_jsonb(t)::text in PostgreSQL. The cursor
 * transfers only length+SHA, never a growing ledger or string_agg. Ordered row
 * digests are length-framed into an incremental digest; no field/row is sampled. */
export async function captureNativeLateSnapshotV1(args:{client:NativeDmlPlanClientV1;
 tables:readonly NativeLateSnapshotTableV1[];scope:Record<string,string>;
 exposure:{sql:string;values:unknown[]};onUnknown:(error:unknown)=>void}):Promise<NativeDmlPlanSnapshotV1>{
 assert.ok(args.tables.length>0);assert.equal(new Set(args.tables.map(t=>t.name)).size,args.tables.length);
 const tables:Record<string,unknown>={},counts:Record<string,number>={};
 for(let ordinal=0;ordinal<args.tables.length;ordinal++){
  const table=args.tables[ordinal]!;assert.match(table.name,/^[a-z_]{1,32}$/u);
  const cursor='r16_native_late_snapshot_'+ordinal,hash=createHash('sha256');let count=0,bytes=0n;
  let sent=false,opened=false,closeAck=false,primaryKnown=false,primary:unknown;
  try{
   sent=true;
   const projection='SELECT to_jsonb(t) row';assert.ok(table.sql.startsWith(projection+' FROM '),'late_snapshot_fullrow_source_required');
   const sql='SELECT octet_length(to_jsonb(t)::text)::int row_bytes,'+
    "encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') row_sha256"+table.sql.slice(projection.length);
   await args.client.query('DECLARE '+cursor+' NO SCROLL CURSOR FOR '+sql,table.values);
   opened=true;
   for(;;){
    const rows=(await args.client.query('FETCH FORWARD '+NATIVE_LATE_SNAPSHOT_FETCH_ROWS_V1+' FROM '+cursor)).rows;
    assert.ok(Array.isArray(rows)&&rows.length<=NATIVE_LATE_SNAPSHOT_FETCH_ROWS_V1,'late_snapshot_fetch_bound');
    if(!rows.length)break;
    for(const row of rows){
     assert.deepEqual(Object.keys(row).sort(),['row_bytes','row_sha256']);
     assert.ok(Number.isSafeInteger(row.row_bytes)&&Number(row.row_bytes)>0,'late_snapshot_row_bytes');
     assert.ok(typeof row.row_sha256==='string'&&/^[a-f0-9]{64}$/u.test(row.row_sha256),'late_snapshot_row_digest');
     hash.update(String(row.row_bytes)+':'+row.row_sha256+'\n','utf8');bytes+=BigInt(Number(row.row_bytes));count++;
     assert.ok(Number.isSafeInteger(count),'late_snapshot_count_bound');
    }
   }
  }catch(error){primaryKnown=true;primary=error;if(sent&&!opened)args.onUnknown(error);}
  finally{
   if(opened)try{await args.client.query('CLOSE '+cursor);closeAck=true;}
   catch(error){args.onUnknown(error);primary=primaryKnown?new AggregateError([primary,error],'late_snapshot_body_and_close_failed',{cause:primary}):error;primaryKnown=true;}
  }
  if(primaryKnown)throw primary;
  assert.equal(closeAck,true,'late_snapshot_close_ack_missing');
  counts[table.name]=count;tables[table.name]={rows:count,row_utf8_bytes:bytes.toString(),rows_sha256:hash.digest('hex'),sql_sha256:nativeDmlPlanShaV1(table.sql),cursor_close_ack:closeAck};
 }
 const exposure=(await args.client.query(args.exposure.sql,args.exposure.values)).rows;
 assert.equal(exposure.length,1,'late_snapshot_exposure_row_count');
 assert.deepEqual(Object.keys(exposure[0]!).sort(),['organization','run']);
 for(const value of Object.values(exposure[0]!))assert.ok(typeof value==='string'&&/^[0-9]+$/u.test(value),'late_snapshot_exposure_invalid');
 const streamed={contract:NATIVE_LATE_SNAPSHOT_CONTRACT_V1,scope:{...args.scope},fetch_rows_max:NATIVE_LATE_SNAPSHOT_FETCH_ROWS_V1,
  row_encoding:'PostgreSQL complete to_jsonb(row)::text UTF8',framing:'decimal_utf8_byte_length:sha256_of_complete_row\n;ordered;allrows',
  tables,exposure,exposure_sql_sha256:nativeDmlPlanShaV1(args.exposure.sql)};
 return{raw:JSON.stringify(streamed),counts,streamed};
}
