import assert from 'node:assert/strict';
import test from 'node:test';
import {parseSignalListeningDiscoveryTransportV1 as parse,LISTENING_DISCOVERY_RESPONSE_PREFIX_BYTES_V1 as max} from '../signal-listening-discovery-transport';
function wrapper(bytes:Buffer,complete=true){let body='',utf8_valid=true;try{body=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{utf8_valid=false;}return{contract_version:'listening-discovery-transport-v1',body,body_base64:bytes.toString('base64'),body_bytes:bytes.length,utf8_valid,complete,http_status:200,provider_request_id:null};}
test('discovery transport preserves complete, partial, invalid UTF8 and legacy bytes',()=>{
 for(const bytes of [Buffer.from('café 😀'),Buffer.from([0xef,0xbb,0xbf,65]),Buffer.from([0]),Buffer.from([0xc3]),Buffer.alloc(0)])for(const complete of [true,false]){
  const source=wrapper(bytes,complete),actual=parse(JSON.stringify(source));assert.equal(actual.body,source.body);assert.equal(actual.utf8_valid,source.utf8_valid);assert.equal(actual.complete,complete);
 }
 assert.equal(parse(JSON.stringify({http_status:200,body:'{}'})).complete,true);
 assert.equal(parse(JSON.stringify({http_status:200,body:'{}',complete:false})).complete,false);
});
test('discovery transport rejects noncanonical or mismatched byte proofs',()=>{
 const base=wrapper(Buffer.from('a'));
 for(const change of [{body_base64:'YQ'},{body_base64:'YQ==\n'},{body_bytes:2},{utf8_valid:false},{body:'b'},{complete:'false'},{contract_version:'unknown'},{http_status:0},{extra:true}])assert.throws(()=>parse(JSON.stringify({...base,...change})),/transport_invalid/);
 const worst=JSON.stringify(wrapper(Buffer.alloc(max),false));assert.ok(Buffer.byteLength(worst)<8*1024*1024);assert.equal(parse(worst).body_bytes,max);
 assert.throws(()=>parse(JSON.stringify(wrapper(Buffer.alloc(max+1),false))),/transport_invalid/);
});
