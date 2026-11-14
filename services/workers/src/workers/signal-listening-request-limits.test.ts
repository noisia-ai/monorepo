import assert from 'node:assert/strict';
import test from 'node:test';
import {JevProviderErrorV1,type JevRequestV1} from '../providers/typesafe-jev';
import {assertSignalListeningRequestTransportV1,signalListeningResponseBoundV1,assertSignalListeningMeasuredContextV1} from './signal-listening-request-limits';
const request=(count=2):JevRequestV1=>({model:'jev-1.13.0',state:'Synthetic mention',questions:Object.fromEntries(Array.from({length:count},(_,i)=>[
  `question_${i}`,{type:'choice' as const,instructions:'Configured question',criteria:Object.fromEntries(Array.from({length:32},(_,j)=>[`option_${j}`,'Configured definition']))}]))});
const unsent=(error:unknown)=>error instanceof JevProviderErrorV1&&error.outcome==='definitely_not_sent';
test('response capture grows with the complete schema instead of truncating many choice probability maps at 16KiB',()=>{
  assert.equal(signalListeningResponseBoundV1(request(2)),16384);
  assert.ok(signalListeningResponseBoundV1(request(256))>16384);
  assert.ok(signalListeningResponseBoundV1(request(256))<=2*1024*1024);
});
test('official transport guards reject malformed UTF8, excessive nesting and body bytes before sending',()=>{
  assert.ok(assertSignalListeningRequestTransportV1(request())>0);
  const invalid=request();invalid.state='\ud800';assert.throws(()=>assertSignalListeningRequestTransportV1(invalid),unsent);
  const nested=request();let value:unknown='leaf';for(let i=0;i<65;i++)value={next:value};nested.state=value;
  assert.throws(()=>assertSignalListeningRequestTransportV1(nested),unsent);
  const huge=request();huge.state='x'.repeat(32*1024*1024);assert.throws(()=>assertSignalListeningRequestTransportV1(huge),unsent);
});
test('measured context guards enforce per-request and state-plus-question estimates without truncation',()=>{
  const small=request();assert.ok(assertSignalListeningMeasuredContextV1(small,.25)>0);
  assert.throws(()=>assertSignalListeningMeasuredContextV1(small,1000),unsent);
  const perQuestion=request(1);perQuestion.state='x'.repeat(35000);
  assert.throws(()=>assertSignalListeningMeasuredContextV1(perQuestion,1),(error:unknown)=>unsent(error)&&(error as Error).message==='listening_question_context_estimate_exceeded');
});
