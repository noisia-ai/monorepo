import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {createJevDeferredRawWitnessV1, captureJevDeferredRawV1, materializeJevDeferredRawV1,
  jevJsonStringUtf8BytesV1} from './jev-deferred-raw';
import type {JevRawResponseV1} from './typesafe-jev';

const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
function capture(raw:JevRawResponseV1){const owner={},witness=createJevDeferredRawWitnessV1(owner);witness(raw);
  const value=captureJevDeferredRawV1(owner,raw);assert.ok(value);return value;}

test('deferred RAW byte counter matches JSON stringify for every UTF16 code unit and pair boundary',()=>{
  for(let code=0;code<=0xffff;code++){
    const s=String.fromCharCode(code);assert.equal(jevJsonStringUtf8BytesV1(s),Buffer.byteLength(JSON.stringify(s)),String(code));
  }
  for(const s of ['','\u0000\n\t\b\f\r"\\','é中文😀','\ud800','\udfff','\ud800\ud800\udfff\udfff',
    String.fromCodePoint(0x10000,0x10ffff),' a '.repeat(5461)])
    assert.equal(jevJsonStringUtf8BytesV1(s),Buffer.byteLength(JSON.stringify(s)));
});

test('deferred RAW preserves exact wrapper, whitespace, nested extras, usage, checksum and invalid body',()=>{
  const nested={model:'jev-1.13.0',answers:{q:{type:'noul',noul:1,extra:{a:[1e20,'é','\ud800',{k:true}]}}},
    usage:{input_tokens:10,output_tokens:0,extra:{nested:['😀',1e20]}}};
  const compact=JSON.stringify(nested),body=compact+' '.repeat(16384-Buffer.byteLength(compact));
  for(const text of [body,'\u0000'.repeat(16384),'\n'.repeat(16384),'"\\'.repeat(8192),'é😀\ud800']){
    const raw={body:text,rate_reservation:{id:'id',estimated_input_tokens:10},http_status:200,latency_ms:1,
      retry_after:'é',rate_calibration:{labeler_digest:'digest',input_bytes:7,extra:{v:1e20}}} as unknown as JevRawResponseV1;
    const expected=JSON.stringify(raw),value=capture(raw);
    assert.equal(value.bytes,Buffer.byteLength(expected));assert.equal(value.body,text);
    assert.equal(materializeJevDeferredRawV1(value),expected);assert.equal(digest(materializeJevDeferredRawV1(value)),digest(expected));
    assert.equal(JSON.parse(materializeJevDeferredRawV1(value)).body,text);
  }
  assert.deepEqual(JSON.parse(JSON.parse(materializeJevDeferredRawV1(capture({body,http_status:200,latency_ms:1}))).body),nested);
});

test('deferred RAW takes metadata snapshot at capture, preserves ordering and does not retain physical aliases',()=>{
  const raw={body:'first',http_status:200,latency_ms:1,rate_reservation:{id:'old',estimated_input_tokens:10},
    rate_calibration:{labeler_digest:'old',input_bytes:3}} as unknown as JevRawResponseV1;
  const expected=JSON.stringify(raw),value=capture(raw);
  raw.body='later';raw.rate_reservation!.estimated_input_tokens=999;
  raw.rate_calibration!.input_bytes=999;
  assert.equal(materializeJevDeferredRawV1(value),expected);
  assert.deepEqual(Object.keys(value).sort(),['body','bytes','shell']);
  assert.equal(Object.isFrozen(value),true);
});

test('deferred RAW does not infer first-party identity from fields, provider spread or repeated receipt',()=>{
  const owner={},other={},witness=createJevDeferredRawWitnessV1(owner),raw={body:'{}',http_status:200,latency_ms:1};
  assert.equal(captureJevDeferredRawV1(owner,raw),null);witness(raw);
  assert.equal(captureJevDeferredRawV1(other,raw),null);
  assert.equal(captureJevDeferredRawV1(owner,{...raw}),null);
  assert.ok(captureJevDeferredRawV1(owner,raw));assert.equal(captureJevDeferredRawV1(owner,raw),null);
});

test('deferred RAW metadata getters and toJSON run once at the original capture boundary',()=>{
  function fixture(){const events:string[]=[];const raw={body:'original',http_status:200,latency_ms:1,
    get extra(){events.push('getter');return{toJSON(){events.push('toJSON');raw.body='changed-by-metadata';return{n:1e20,text:'😀'};}};}};
    return{raw,events};}
  const original=fixture(),deferred=fixture();
  const expected=JSON.stringify(original.raw),value=capture(deferred.raw);
  assert.deepEqual(deferred.events,original.events);assert.deepEqual(deferred.events,['getter','toJSON']);
  assert.equal(materializeJevDeferredRawV1(value),expected);assert.equal(value.body,'original');
  assert.deepEqual(deferred.events,['getter','toJSON'],'materialization cannot re-run mutable metadata');
});
