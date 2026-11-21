import assert from 'node:assert/strict';
import test from 'node:test';
import {jevResponseTreeStorageV3,jevLegacyPhaseFlushBytesV3,jevLegacyPhaseMaximumFlushBytesV3,
  jevDeferredRetainedBytesV3,jevPhaseQuestionSlotsV3} from './signal-jev-phase-geometry-v3';
import {createJevDeferredRawWitnessV1,captureJevDeferredRawV1,packJevDeferredRawV3,materializeJevDeferredRawV1} from '../providers/jev-deferred-raw';

test('phase geometry counts full nested answers/usage and array primitive slots without parsing the receipt',()=>{
  const base={model:'jev',answers:{q:{type:'noul',noul:1}},usage:{input_tokens:1,output_tokens:0}};
  const body=JSON.stringify({...base,extras:[0,0,'é😀',{a:['\ud800',1e20]}]});
  const tree=jevResponseTreeStorageV3(body);
  assert.ok(tree>2*body.length);assert.ok(tree<jevResponseTreeStorageV3(body+' '.repeat(100)));
  assert.ok(jevLegacyPhaseFlushBytesV3(body,body.length+100,1)>3*tree);
});

test('phase maximum dominates observed flush quotes for all retained representations, escaping and numeric expansion',()=>{
  const bound=16384,rawBound=bound*24+65536;
  const bodies=[' '.repeat(bound),'\u0000'.repeat(bound),'"\\'.repeat(bound/2),
    JSON.stringify({a:Array.from({length:3000},()=>0)}),'{"a":['+Array.from({length:2000},()=>'1e20').join(',')+']}',
    JSON.stringify({a:'é😀\ud800'.repeat(1000)}),'{"a":[0,0,0]}', '{"a":"unterminated\\'];
  for(const body of bodies){assert.ok(Buffer.byteLength(body)<=bound);
    for(const q of [1,6,256]){
      const raw=JSON.stringify({body,http_status:200,latency_ms:1}),bytes=Buffer.byteLength(raw);
      assert.ok(jevLegacyPhaseFlushBytesV3(body,bytes,q)<=jevLegacyPhaseMaximumFlushBytesV3(bound,rawBound,q));
    }
  }
});

test('retained phase has exact unpooled UTF8 payload, all code points and leading BOM byte parity',()=>{
 for(const body of [JSON.stringify({unicode:'é😀'+String.fromCharCode(0xd800)}),'\ufeff{}','\u0000'.repeat(16384),'é😀'.repeat(1000)]){
  const owner={},witness=createJevDeferredRawWitnessV1(owner),raw=witness({body,http_status:200,latency_ms:1,retry_after:'é'});
  const snapshot=captureJevDeferredRawV1(owner,raw)!,packed=packJevDeferredRawV3(snapshot);
  assert.equal(jevDeferredRetainedBytesV3(packed),Buffer.byteLength(snapshot.body)+Buffer.byteLength(snapshot.shell));
  assert.ok(jevDeferredRetainedBytesV3(packed)<=snapshot.bytes);
  assert.equal(packed.body.buffer.byteLength,packed.body.byteLength);assert.equal(packed.shell.buffer.byteLength,packed.shell.byteLength);
  assert.equal(materializeJevDeferredRawV1(packed),JSON.stringify(raw));
 }
});

test('phase F prices complete input lineage when an attempt asks a smaller question subset',()=>{
 assert.equal(jevPhaseQuestionSlotsV3({request:{questions:{q:{}}},inputs:[{question_digests:{q:'one',a:'two',b:'three'}}]}),3);
 assert.equal(jevPhaseQuestionSlotsV3({request:{questions:{q:{},a:{}}},inputs:[{question_digests:{q:'one'}}]}),2);
});
