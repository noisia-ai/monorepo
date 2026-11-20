import assert from 'node:assert/strict';
import test from 'node:test';
import {createAnthropicListeningDiscoveryProviderV1,ListeningDiscoveryProviderErrorV1,LISTENING_DISCOVERY_RESPONSE_BYTES_V1,
  encodeListeningDiscoveryTransportV1,decodeListeningDiscoveryTransportV1} from './anthropic-listening-discovery';
const request=JSON.stringify({model:'claude-sonnet-4-6',max_tokens:64000,stream:false,messages:[{role:'user',content:'Synthetic governed group review'}]});
test('discovery sends the sealed bytes exactly once and preserves HTTP failures without interpreting JSON',async()=>{
  for(const status of [200,400,429,529]){
    let sends=0;const bytes=Buffer.from('not JSON; physical evidence');
    const provider=createAnthropicListeningDiscoveryProviderV1({apiKey:'synthetic-only',fetch:async(url,init)=>{
      sends++;assert.equal(String(url),'https://api.anthropic.com/v1/messages');assert.equal(init?.body,request);assert.equal(init?.redirect,'error');
      return new Response(bytes,{status,headers:{'request-id':'physical-request'}});
    }});
    provider.assertReady(request);assert.equal(sends,0);
    const receipt=await provider.generate(request);assert.equal(sends,1);assert.deepEqual(receipt,{bytes,http_status:status,provider_request_id:'physical-request',complete:true});
  }
});
test('invalid provider configuration is proven unsent and never falls back to another model',async()=>{
  let sends=0;const provider=createAnthropicListeningDiscoveryProviderV1({apiKey:'synthetic-only',fetch:async()=>{sends++;return Response.json({});}});
  for(const body of ['bad json',JSON.stringify({model:'claude-opus-4-6',max_tokens:64000,stream:false}),JSON.stringify({model:'claude-sonnet-4-6',max_tokens:64001,stream:false})])
    await assert.rejects(provider.generate(body),error=>error instanceof ListeningDiscoveryProviderErrorV1&&error.outcome==='definitely_not_sent');
  assert.equal(sends,0);
});
test('oversized and stuck responses retain bounded physical prefixes and never retry',async()=>{
  let sends=0;const size=LISTENING_DISCOVERY_RESPONSE_BYTES_V1;
  const oversized=createAnthropicListeningDiscoveryProviderV1({apiKey:'synthetic-only',fetch:async()=>{sends++;return new Response(Buffer.alloc(size+1,97));}});
  const over=await oversized.generate(request);assert.equal(over.complete,false);assert.equal(over.bytes.length,size);assert.equal(over.http_status,200);
  const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(Buffer.from('prefix'));}});
  const stuck=createAnthropicListeningDiscoveryProviderV1({apiKey:'synthetic-only',timeoutMs:10,fetch:async()=>{sends++;return new Response(stream,{status:529});}});
  const timed=await stuck.generate(request);assert.equal(timed.http_status,529);assert.equal(timed.complete,false);assert.equal(timed.bytes.toString(),'prefix');assert.equal(sends,2);
});
test('a missing header response is uncertain and never invents an HTTP status or free usage',async()=>{
  let sends=0;const provider=createAnthropicListeningDiscoveryProviderV1({apiKey:'synthetic-only',fetch:async()=>{sends++;throw Error('synthetic transport reset');}});
  await assert.rejects(provider.generate(request),error=>error instanceof ListeningDiscoveryProviderErrorV1&&error.outcome==='outcome_unknown');assert.equal(sends,1);
});
test('transport codec preserves invalid UTF-8 and complete=false even when the body looks like valid usage JSON',()=>{
  for(const bytes of [Buffer.from('{"model":"claude-sonnet-4-6","usage":{"input_tokens":1,"output_tokens":1}}'),Buffer.from([0xff,0xc3]),Buffer.from([0xef,0xbb,0xbf,0x61])]){
    const raw=encodeListeningDiscoveryTransportV1({bytes,http_status:200,provider_request_id:null,complete:false});
    const value=decodeListeningDiscoveryTransportV1(raw);assert.deepEqual(Buffer.from(value.body_base64,'base64'),bytes);assert.equal(value.complete,false);
  }
  const raw=encodeListeningDiscoveryTransportV1({bytes:Buffer.from([0xff]),http_status:200,provider_request_id:null,complete:true});
  const decoded=decodeListeningDiscoveryTransportV1(raw);assert.equal(decoded.utf8_valid,false);assert.equal(decoded.body,'');assert.equal(decoded.complete,false);
});
test('a complete valid UTF-8 BOM remains in the body and its exact byte proof',()=>{
  const bytes=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from('{"text":"cerveja 🍺"}')]);
  const raw=encodeListeningDiscoveryTransportV1({bytes,http_status:200,provider_request_id:'synthetic-bom',complete:true});
  const value=decodeListeningDiscoveryTransportV1(raw);
  assert.equal(value.utf8_valid,true);assert.equal(value.complete,true);assert.equal(value.body.charCodeAt(0),0xfeff);
  assert.equal(value.body_bytes,bytes.length);assert.deepEqual(Buffer.from(value.body,'utf8'),bytes);
  assert.deepEqual(Buffer.from(value.body_base64,'base64'),bytes);
  assert.throws(()=>decodeListeningDiscoveryTransportV1(JSON.stringify({...value,body:value.body.slice(1)})),/raw_invalid/);
});
test('worst JSON escaping remains inside the eight MiB wrapper bound and altered byte claims are rejected',()=>{
  const raw=encodeListeningDiscoveryTransportV1({bytes:Buffer.alloc(LISTENING_DISCOVERY_RESPONSE_BYTES_V1),http_status:200,provider_request_id:null,complete:true});
  assert.ok(Buffer.byteLength(raw)<8*1024*1024-8192);decodeListeningDiscoveryTransportV1(raw);
  const modified=JSON.parse(raw);modified.body_bytes--;assert.throws(()=>decodeListeningDiscoveryTransportV1(JSON.stringify(modified)),/raw_invalid/);
  const valid=JSON.parse(encodeListeningDiscoveryTransportV1({bytes:Buffer.from('{}'),http_status:200,provider_request_id:null,complete:true}));
  const reordered=JSON.stringify(Object.fromEntries(Object.entries(valid).reverse()),null,2);
  assert.equal(decodeListeningDiscoveryTransportV1(reordered).body,'{}','recovery validates byte proof without rewriting immutable wrapper whitespace or key order');
});
