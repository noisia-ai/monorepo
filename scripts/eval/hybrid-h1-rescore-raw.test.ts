import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {parseHybridCitationGroupV1,buildHybridCitationVerificationV1} from '../../packages/query-engine/src/signal-hybrid-citation-quality-v1';
import {reparseHybridWindowRawV1,rescoreHybridWindowReceiptsV1} from './hybrid-h1-rescore-raw';
const sha=(raw:string)=>`sha256:${createHash('sha256').update(raw).digest('hex')}`;
const concept={concept_key:'activity',definition_digest:'d',label:'Activity',definition:'A completed activity',scope:'all_conversations',inclusion:[],exclusion:[],positive_examples:[],negative_examples:[]} as const;
const text='Done. Rest.';
const usage={input_tokens:10,output_tokens:10,cache_read_input_tokens:0,cache_creation_input_tokens:0,
 cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:0}};
function fixture(){
 const raw=new Map<string,string>();
 const calls=[0,1].map(index=>{
  const input={root_id:'root',root_fingerprint:'f',input_digest:'i',text,entity_context_digest:'ce',effective_entities_digest:'e',
   evaluated_concepts:[concept],title:null,platform:null,content_type:null,author:null,entities:[],voice:null,act:null,
   citation_window:{start:index===0?0:6,end:index===0?6:text.length,index,count:2}};
  const output=JSON.stringify({contract_version:'concept-membership-judge-v1',roots:[{root_ordinal:0,memberships:[{
   concept_key:'activity',verdict:'belongs',span_ids:['r0c0s1'],rationale:'The cited activity is explicit.'}]}]});
  const body={custom_id:`c${index}`,result:{type:'succeeded',message:{stop_reason:'end_turn',usage,
   content:[{type:'text',text:index===0?'invalid JSON':output}]}}};
  const content=JSON.stringify(body);raw.set(`c${index}`,content);
  const parsed=parseHybridCitationGroupV1(body.result.message.content[0]!.text,[input] as never).results[0]!;
  const citations=parsed.citations.map(c=>({quote:c.quote,start:c.quote_start,end:c.quote_end}));
  return {id:`c${index}`,custom_id:`c${index}`,provider:'anthropic',request:{},inputs:[input],status:'settled',results_applied:true,
   usage,settled_micro_usd:'10',raw_sha256:sha(content),raw_size_bytes:String(Buffer.byteLength(content)),created_at:String(index),
   membership_snapshot:{hybrid_stage:'claude',route_digest:'route'},results:[{...parsed,citation_window:input.citation_window,
    jev:{verdict:'belongs',probability:.9,citation:{quote:text,start:0,end:text.length}},jev_call_id:'j',claude_call_id:`c${index}`,
    claude:{verdict:parsed.verdict,citations,citation:citations[0]??null}}]};
 });
 return {raw,calls};
}
test('a raw positive hidden by another window error becomes pending until verified, with no receipt mutation',()=>{
 const f=fixture(),before=JSON.stringify(f.calls);
 assert.equal(f.calls[1]!.results[0]!.claude.verdict,'belongs');
 const pairs=[{...f.calls[1]!.results[0],verdict:'error',source:'model',labeler_digest:'route'}];
 const result=rescoreHybridWindowReceiptsV1(f.calls as never,f.raw,pairs as never,new Map([['root',text]]));
 assert.deepEqual(result.changes.map(c=>[c.before,c.after,c.reason]),[['error','pending','citation_verification_receipt_missing']]);
 assert.equal(JSON.stringify(f.calls),before);
 assert.throws(()=>reparseHybridWindowRawV1(f.calls[1] as never,f.raw.get('c1')+' '));
});
test('only a paid verifier raw matching the positive confirmation permits belongs in the offline score',()=>{
 const f=fixture(),prior=f.calls[1]!.results[0]!,request=buildHybridCitationVerificationV1(concept as never,prior.claude.citations);
 const response=JSON.stringify({http_status:200,latency_ms:1,body:JSON.stringify({model:'jev-1.13.0',usage:{input_tokens:10,output_tokens:0},
  answers:{support:{type:'noul',noul:.9}}})});
 const verifier={...f.calls[1]!,id:'v',provider:'typesafe',request,usage:{...usage,output_tokens:0},raw_sha256:sha(response),raw_size_bytes:String(Buffer.byteLength(response)),
  membership_snapshot:{hybrid_stage:'citation',route_digest:'route'},results:[{...prior,citation_call_id:'v',claude:{...prior.claude,
   verification:{supported:true,probability:.9,attempt:0,call_id:'v'}}}]};
 f.raw.set('v',response);
 const result=rescoreHybridWindowReceiptsV1([...f.calls,verifier] as never,f.raw,
  [{...prior,verdict:'error',source:'model',labeler_digest:'route'}] as never,new Map([['root',text]]));
 assert.equal(result.changes[0]?.after,'belongs');assert.equal(result.changes[0]?.citation_call_id,'v');
});
