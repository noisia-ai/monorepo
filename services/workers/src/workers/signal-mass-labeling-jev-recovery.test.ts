import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import test from 'node:test';
import {buildLabelingRawPageV1,createLabelingRawCallPageReaderV1} from '@noisia/db';
import {groupMassLabelingRecoveryCallsV1} from './signal-mass-labeling-jev-recovery';
const sha=(text:string)=>'sha256:'+createHash('sha256').update(text).digest('hex');
test('interleaved recovery members use two page loads and retain historical receipts',async()=>{
  const scope={workspace_id:randomUUID(),run_id:randomUUID()};
  const receipt=(name:string)=>({call_id:randomUUID(),request_digest:sha(name),raw:name});
  const a=[receipt('A1'),receipt('A2')],b=[receipt('B1'),receipt('B2')],legacy=receipt('legacy');
  const pages=[buildLabelingRawPageV1({...scope,receipts:a}),buildLabelingRawPageV1({...scope,receipts:b})]
    .sort((a,b)=>a.page_id.localeCompare(b.page_id));
  const orderedNames=new Map(pages.flatMap((page,index)=>page.members.map((member,offset)=>[member.call_id,`${index===0?'A':'B'}${offset+1}`])));
  const pageRows=pages.map(page=>({...scope,id:page.page_id,name:page.name,storage_key:`private/${page.name}`,
    sha256:page.raw_sha256,size_bytes:page.size_bytes,member_count:page.members.length,status:'verified'}));
  const members=pages.flatMap(page=>page.members.map(member=>({...member,page_id:page.page_id})));
  const rows=members.map(member=>({...member,recovery_page_id:member.page_id,recovery_byte_offset:member.byte_offset}));
  const interleaved=[rows[0]!,rows[2]!,rows[1]!,rows[3]!,{...legacy,recovery_page_id:null,recovery_byte_offset:null}];
  const grouped=groupMassLabelingRecoveryCallsV1(interleaved);
  assert.deepEqual(grouped.map(row=>orderedNames.get(row.call_id)??'legacy'),['A1','A2','B1','B2','legacy']);
  let gets=0;
  const database={async query(sql:string,values:unknown[]){
    if(sql.includes('JOIN signal_labeling_calls')){
      const member=members.find(row=>row.call_id===values[2]);
      return {rows:member?[{...member,call_request_digest:member.request_digest}]:[]};
    }
    if(sql.includes('FROM signal_labeling_raw_pages'))return {rows:pageRows.filter(page=>page.id===values[2])};
    if(sql.includes('FROM signal_labeling_raw_page_members'))return {rows:members.filter(row=>row.page_id===values[2])};
    throw Error('unexpected_query');
  }};
  const reader=createLabelingRawCallPageReaderV1({database:database as never,loadPage:async ref=>{
    gets++;return pages.find(page=>page.page_id===ref.page_id)!.raw_text;
  }});
  let historical=0;
  for(const row of grouped){
    const raw=await reader({...scope,call_id:row.call_id,request_digest:row.request_digest});
    if(row.call_id===legacy.call_id){assert.equal(raw,null);historical++;}
    else assert.ok(raw?.raw_text);
  }
  assert.equal(gets,2);assert.equal(historical,1);
  const first=grouped[0]!;
  await assert.rejects(reader({...scope,call_id:first.call_id,request_digest:sha('wrong-request')}),/labeling_raw_receipt_invalid/);
  await assert.rejects(reader({...scope,workspace_id:randomUUID(),call_id:first.call_id,request_digest:first.request_digest}),/labeling_raw_receipt_invalid/);
});
