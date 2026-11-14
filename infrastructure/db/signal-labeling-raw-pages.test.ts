import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import test from 'node:test';
import {buildLabelingRawPageV1, parseLabelingRawPageV1} from './signal-labeling-raw-pages';

const sha=(v:string)=>'sha256:'+createHash('sha256').update(v).digest('hex');
const scope=()=>({workspace_id:randomUUID(),run_id:randomUUID()});
test('raw page retains exact UTF-8 receipt bytes and deterministic call ordering',()=>{
  const s=scope(),receipts=[{call_id:randomUUID(),request_digest:sha('one'),raw:'{"body":"café\\n🍵","latency_ms":80}\n'},
    {call_id:randomUUID(),request_digest:sha('two'),raw:' { "body": "second" } '}];
  const p=buildLabelingRawPageV1({...s,receipts});
  assert.deepEqual(buildLabelingRawPageV1({...s,receipts:[...receipts].reverse()}),p);
  const read=parseLabelingRawPageV1({...s,...p});
  for(const row of receipts)assert.equal(read.get(row.call_id),row.raw);
  assert.equal(p.members.length,2);
  assert.equal(p.size_bytes,Buffer.byteLength(p.raw_text));
});
test('page reader rejects corruption, substitutions, foreign scope and offset/length tampering',()=>{
  const s=scope(),p=buildLabelingRawPageV1({...s,receipts:[{call_id:randomUUID(),request_digest:sha('request'),raw:'raw-original'}]});
  for(const edit of [
    {raw_text:p.raw_text+' '}, {workspace_id:randomUUID()}, {run_id:randomUUID()},
    {members:[{...p.members[0]!,call_id:randomUUID()}]},
    {members:[{...p.members[0]!,request_digest:sha('other')}]},
    {members:[{...p.members[0]!,raw_sha256:sha('other')}]},
    {members:[{...p.members[0]!,raw_size_bytes:p.members[0]!.raw_size_bytes+1}]},
    {members:[{...p.members[0]!,byte_offset:1}]},
    {members:[{...p.members[0]!,byte_length:p.members[0]!.byte_length-1}]},
    {members:[]}, {members:[p.members[0]!,p.members[0]!]},
  ])assert.throws(()=>parseLabelingRawPageV1({...s,...p,...edit}),/labeling_raw_page_invalid/);
});
test('raw page has bounded members/bytes and cannot duplicate a call or use malformed identities',()=>{
  const s=scope(),r={call_id:randomUUID(),request_digest:sha('request'),raw:'a'};
  for(const receipts of [[],[r,r],[{...r,call_id:'not-a-call'}],[{...r,request_digest:'not-a-digest'}],
    [{...r,raw:'x'.repeat(8*1024*1024+1)}]])
    assert.throws(()=>buildLabelingRawPageV1({...s,receipts}),/labeling_raw_page_invalid/);
});
