import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {captureNativeLateSnapshotV1,NATIVE_LATE_SNAPSHOT_FETCH_ROWS_V1} from './signal-listening-native-dml-late-snapshot.test-support';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
function fixture(options:{rows?:Array<Record<string,unknown>>;failFetch?:boolean;failClose?:boolean;oversized?:boolean;invalid?:boolean}={}){
 const commands:string[]=[],unknown:unknown[]=[];let fetched=false;
 const rows=(options.rows??[{id:'a',all_fields:{added:'á😀',money:'9007199254740993'}},{id:'b',extra:null}]).map(value=>{
  const raw=JSON.stringify(value);return{row_bytes:Buffer.byteLength(raw),row_sha256:digest(raw)};
 });
 const client={async query(sql:string){commands.push(sql);
  if(sql.startsWith('FETCH')){if(options.failFetch)throw Error('fetch_failed');if(fetched)return{rows:[]};fetched=true;
   if(options.oversized)return{rows:Array.from({length:129},()=>rows[0]!)};
   if(options.invalid)return{rows:[{row_bytes:1,row_sha256:'invalid'}]};return{rows};}
  if(sql.startsWith('CLOSE')&&options.failClose)throw Error('close_failed');
  if(sql==='EXPOSURE')return{rows:[{organization:'12',run:'7'}]};return{rows:[]};
 }};
 return{commands,unknown,rows,args:{client,tables:[{name:'calls',sql:'SELECT to_jsonb(t) row FROM calls t ORDER BY id',values:[]}],scope:{run_id:'synthetic'},exposure:{sql:'EXPOSURE',values:[]},onUnknown:(e:unknown)=>{unknown.push(e);}}};
}
test('late snapshot hashes every complete ordered row with length framing and closes cursor',async()=>{
 const f=fixture(),s=await captureNativeLateSnapshotV1(f.args),envelope=JSON.parse(s.raw);
 const framed=f.rows.map(row=>String(row.row_bytes)+':'+row.row_sha256+'\n').join('');
 assert.equal(envelope.tables.calls.rows_sha256,digest(framed));assert.equal(s.counts.calls,2);
 assert.equal(envelope.tables.calls.cursor_close_ack,true);assert.equal(f.unknown.length,0);
 assert.ok(f.commands[0]!.includes('to_jsonb(t)::text'));assert.ok(f.commands.some(sql=>sql==='FETCH FORWARD '+NATIVE_LATE_SNAPSHOT_FETCH_ROWS_V1+' FROM r16_native_late_snapshot_0'));
});
test('late snapshot detects a changed field including nonmoney fields and unsafe-size numeric strings',async()=>{
 const a=await captureNativeLateSnapshotV1(fixture().args),b=await captureNativeLateSnapshotV1(fixture({rows:[{id:'a',all_fields:{added:'á😀',money:'9007199254740992'}},{id:'b',extra:null}]}).args);
 assert.notEqual(a.raw,b.raw);
});
test('late snapshot retains the empty table census and digest',async()=>{
 const s=await captureNativeLateSnapshotV1(fixture({rows:[]}).args);assert.equal(s.counts.calls,0);
 assert.equal(JSON.parse(s.raw).tables.calls.rows_sha256,digest(''));
});
test('late snapshot rejects a cursor response beyond128 and closes without retry',async()=>{
 const f=fixture({oversized:true});await assert.rejects(captureNativeLateSnapshotV1(f.args),/late_snapshot_fetch_bound/u);
 assert.equal(f.commands.filter(sql=>sql.startsWith('FETCH')).length,1);assert.equal(f.commands.filter(sql=>sql.startsWith('CLOSE')).length,1);
});
test('late snapshot rejects a malformed row digest rather than omitting the row',async()=>{
 const f=fixture({invalid:true});await assert.rejects(captureNativeLateSnapshotV1(f.args),/late_snapshot_row_digest/u);assert.equal(f.commands.filter(sql=>sql.startsWith('CLOSE')).length,1);
});
test('late snapshot cursor close failure marks sticky uncertainty and never returns a digest',async()=>{
 const f=fixture({failClose:true});await assert.rejects(captureNativeLateSnapshotV1(f.args),/close_failed/u);assert.equal(f.unknown.length,1);
 assert.equal(f.commands.filter(sql=>sql.startsWith('CLOSE')).length,1);
});
test('late snapshot preserves FETCH and CLOSE failures together with no retry',async()=>{
 const f=fixture({failFetch:true,failClose:true});await assert.rejects(captureNativeLateSnapshotV1(f.args),e=>e instanceof AggregateError&&e.message==='late_snapshot_body_and_close_failed');
 assert.equal(f.commands.filter(sql=>sql.startsWith('FETCH')).length,1);assert.equal(f.unknown.length,1);
});

test('late snapshot DECLARE timeout marks uncertainty before any FETCH or reuse',async()=>{
 const f=fixture();const error=Object.assign(Error('declare_timeout'),{code:'57014'});
 f.args.client.query=async(sql:string)=>{f.commands.push(sql);throw error;};
 await assert.rejects(captureNativeLateSnapshotV1(f.args),e=>e===error);assert.equal(f.unknown.length,1);
 assert.equal(f.commands.length,1);assert.ok(f.commands[0]!.startsWith('DECLARE '));
});

test('late snapshot preserves null and undefined FETCH rejections despite a confirmed CLOSE',async()=>{
 for(const rejected of [undefined,null]){
  const f=fixture(),original=f.args.client.query;let returned=false,caught=false,seen:unknown;
  f.args.client.query=async(sql:string)=>{if(sql.startsWith('FETCH')){f.commands.push(sql);throw rejected;}return original(sql);};
  try{await captureNativeLateSnapshotV1(f.args);returned=true;}catch(error){caught=true;seen=error;}
  assert.equal(returned,false);assert.equal(caught,true);assert.equal(seen,rejected);
  assert.equal(f.commands.filter(sql=>sql.startsWith('CLOSE')).length,1);assert.equal(f.unknown.length,0);
 }
});
