import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import test from 'node:test';
import {buildLabelingRawPageV1, parseLabelingRawPageV1} from './signal-labeling-raw-pages';
import {createLabelingRawCallPageReaderV1} from './signal-labeling-raw-page-store';

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

function fixture(){
  const scope={workspace_id:randomUUID(),run_id:randomUUID()};
  const receipts=Array.from({length:3},(_,i)=>({call_id:randomUUID(),request_digest:sha(`request-${i}`),raw:`raw-${i}-café`}));
  const built=buildLabelingRawPageV1({...scope,receipts});
  const page={...scope,id:built.page_id,name:built.name,storage_key:`private/${built.name}`,
    sha256:built.raw_sha256,size_bytes:built.size_bytes,member_count:built.members.length,status:'verified'};
  const members=built.members.map(member=>({...member,page_id:built.page_id}));
  let downloads=0,raw_text=built.raw_text;
  const database={async query(sql:string,values:unknown[]){
    if(sql.includes('JOIN signal_labeling_calls')){
      const member=members.find(member=>member.call_id===values[2]);
      return {rows:member?[{page_id:member.page_id,request_digest:member.request_digest,call_request_digest:member.request_digest}]:[]};
    }
    if(sql.includes('FROM signal_labeling_raw_pages'))return {rows:[{...page}]};
    if(sql.includes('FROM signal_labeling_raw_page_members'))return {rows:members.map(member=>({...member}))};
    throw Error('unexpected_query');
  }};
  const reader=createLabelingRawCallPageReaderV1({database:database as never,loadPage:async()=>{downloads++;return raw_text;}});
  return {scope,receipts,built,page,members,reader,downloads:()=>downloads,setRaw:(raw:string)=>{raw_text=raw;}};
}
test('one recovery reader downloads and decodes a page once for multiple authenticated members',async()=>{
  const f=fixture();
  for(const receipt of f.receipts){
    const raw=await f.reader({...f.scope,call_id:receipt.call_id,request_digest:receipt.request_digest});
    assert.equal(raw?.raw_text,receipt.raw);assert.equal(raw?.raw_sha256,sha(receipt.raw));
  }
  assert.equal(f.downloads(),1);
  // The reader owns independent snapshots, never references that a DB adapter can mutate.
  f.members[0]!.raw_sha256=sha('substitution');
  await assert.rejects(f.reader({...f.scope,call_id:f.members[0]!.call_id,request_digest:f.members[0]!.request_digest}),/labeling_raw_page_invalid/);
  assert.equal(f.downloads(),2);
});
test('cached page rejects changed SHA, requested digest and cross-tenant scope',async()=>{
  for(const mode of ['sha','request','scope','run','member-count']as const){
    const f=fixture(),receipt=f.receipts[0]!,args={...f.scope,call_id:receipt.call_id,request_digest:receipt.request_digest};
    await f.reader(args);
    if(mode==='sha')f.page.sha256=sha('changed-page');
    if(mode==='request')args.request_digest=sha('different-request');
    if(mode==='scope')args.workspace_id=randomUUID();
    if(mode==='run')args.run_id=randomUUID();
    if(mode==='member-count')f.page.member_count++;
    await assert.rejects(f.reader(args),/labeling_raw_(?:page|receipt)_invalid/);
  }
});
test('changed key or size cannot reuse the authenticated cache entry',async()=>{
  for(const mode of ['key','size']as const){
    const f=fixture(),receipt=f.receipts[0]!,args={...f.scope,call_id:receipt.call_id,request_digest:receipt.request_digest};
    await f.reader(args);
    if(mode==='key')f.page.storage_key+='-different';else f.page.size_bytes++;
    if(mode==='key'){await f.reader(args);assert.equal(f.downloads(),2);}
    else await assert.rejects(f.reader(args),/labeling_raw_page_invalid/);
  }
});
test('separate recovery passes never share a cached page',async()=>{
  const a=fixture(),b=fixture();
  await a.reader({...a.scope,call_id:a.receipts[0]!.call_id,request_digest:a.receipts[0]!.request_digest});
  await b.reader({...b.scope,call_id:b.receipts[0]!.call_id,request_digest:b.receipts[0]!.request_digest});
  assert.equal(a.downloads(),1);assert.equal(b.downloads(),1);
});

test('recovery cache retains at most the latest decoded page',async()=>{
  const f=fixture(),firstPage={...f.page},firstMembers=f.members.map(row=>({...row}));
  const first=f.receipts[0]!,firstArgs={...f.scope,call_id:first.call_id,request_digest:first.request_digest};
  await f.reader(firstArgs);
  const otherReceipt={call_id:randomUUID(),request_digest:sha('other-page'),raw:'other raw'};
  const other=buildLabelingRawPageV1({...f.scope,receipts:[otherReceipt]});
  Object.assign(f.page,{id:other.page_id,name:other.name,storage_key:`private/${other.name}`,
    sha256:other.raw_sha256,size_bytes:other.size_bytes,member_count:other.members.length});
  f.members.splice(0,f.members.length,...other.members.map(row=>({...row,page_id:other.page_id})));f.setRaw(other.raw_text);
  await f.reader({...f.scope,call_id:otherReceipt.call_id,request_digest:otherReceipt.request_digest});
  Object.assign(f.page,firstPage);f.members.splice(0,f.members.length,...firstMembers);f.setRaw(f.built.raw_text);
  await f.reader(firstArgs);
  assert.equal(f.downloads(),3,'returning to an evicted page must authenticate it again');
});
