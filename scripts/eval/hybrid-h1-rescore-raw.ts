/** Offline, receipt-only R11 re-score. Never sends, settles or publishes a pair. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {parseAnthropicResponseV1,anthropicUsageV1} from '../../packages/query-engine/src/anthropic-response-v1';
import {parseHybridCitationGroupV1,mapHybridCitationVerificationV1} from '../../packages/query-engine/src/signal-hybrid-citation-quality-v1';
import {membershipResultsForV1} from '../../packages/query-engine/src/signal-concept-membership-v1';
import {decideHybridMembershipV1} from '../../packages/query-engine/src/signal-hybrid-membership-v1';
import {validateJevResponseV1} from '../../services/workers/src/providers/typesafe-jev';
import {reduceHybridWindowResultsV1} from '../../infrastructure/db/signal-hybrid-window-results';
import type {HybridStageInputV1,HybridStageResultV1} from '../../infrastructure/db/signal-hybrid-runs';
import type {JevRequestV1} from '../../packages/query-engine/src/signal-mention-facets-jev-v1';
import type {LlmUsageV1} from '../../packages/query-engine/src/llm-pricing-v1';
import type {Gold} from './contract';

type Call={id:string;custom_id:string;provider:string;request:JevRequestV1;inputs:HybridStageInputV1[];
 status:string;results_applied:boolean;results:HybridStageResultV1[];usage:LlmUsageV1;settled_micro_usd:string;
 raw_sha256:string;raw_size_bytes:string;created_at:string;membership_snapshot:{hybrid_stage:string;citation_retry?:boolean;route_digest:string}};
type Pair=HybridStageResultV1&{source:string;verdict:string;labeler_digest:string};
const hash=(text:string)=>`sha256:${createHash('sha256').update(text).digest('hex')}`;
const key=(r:Pick<HybridStageResultV1,'root_id'|'root_fingerprint'|'concept_key'|'definition_digest'|'entity_context_digest'|'effective_entities_digest'>)=>JSON.stringify([r.root_id,r.root_fingerprint,r.concept_key,r.definition_digest,r.entity_context_digest,r.effective_entities_digest]);

export function reparseHybridWindowRawV1(call:Call,raw:string):HybridStageResultV1[]{
 assert.equal(hash(raw),call.raw_sha256);assert.equal(Buffer.byteLength(raw),Number(call.raw_size_bytes));
 assert.equal(call.status,'settled');assert.equal(call.results_applied,true);assert.notEqual(call.settled_micro_usd,null);
 const body=JSON.parse(raw);
 if(call.membership_snapshot.hybrid_stage==='citation'){
  const parsed=validateJevResponseV1(call.request,body),support=mapHybridCitationVerificationV1(parsed);
  return call.results.map(prior=>{
   assert.equal(prior.claude?.verification?.supported,support.supported);
   assert.equal(prior.claude?.verification?.probability,support.probability);
   return prior;
  });
 }
 assert.equal(call.membership_snapshot.hybrid_stage,'claude');assert.equal(body.custom_id,call.custom_id);
 assert.equal(body.result.type,'succeeded');assert.deepEqual(anthropicUsageV1(body.result.message),call.usage);
 const parsed=parseAnthropicResponseV1(body.result.message);
 const group=parsed.status==='ok'?parseHybridCitationGroupV1(parsed.text!,call.inputs):null;
 const results=group?.split?membershipResultsForV1(call.inputs,'error','incomplete_single_root')
  :group?.results??membershipResultsForV1(call.inputs,parsed.status==='refused'?'refused':'error',parsed.error_code??'incomplete_single_root');
 assert.equal(results.length,call.results.length,'raw coverage must match the paid parsed receipt');
 return results.map(result=>{
  const saved=call.results.find(r=>key(r)===key(result));assert.ok(saved);
  assert.equal(result.verdict,saved.claude?.verdict);
  const citations=result.citations.map(c=>({quote:c.quote,start:c.quote_start,end:c.quote_end}));
  assert.deepEqual(citations,saved.claude?.citations??[]);
  assert.equal(result.error_code,saved.error_code);
  return saved;
 });
}

export function rescoreHybridWindowReceiptsV1(calls:Call[],raw:Map<string,string>,pairs:Pair[],text:Map<string,string>){
 const windows=calls.filter(c=>c.inputs.some(i=>i.citation_window));
 const reparsed=windows.map(call=>({call,results:reparseHybridWindowRawV1(call,raw.get(call.id)!)}));
 const verified=new Map<string,HybridStageResultV1>();
 for(const {call,results} of reparsed.filter(r=>r.call.membership_snapshot.hybrid_stage==='citation')
  .sort((a,b)=>a.call.created_at.localeCompare(b.call.created_at)))
  for(const result of results)verified.set(JSON.stringify([key(result),result.claude_call_id]),result);
 const latest=new Map<string,HybridStageResultV1>();
 for(const {call,results} of reparsed.filter(r=>r.call.membership_snapshot.hybrid_stage==='claude')
  .sort((a,b)=>a.call.created_at.localeCompare(b.call.created_at)||a.call.id.localeCompare(b.call.id)))
  for(const result of results){
   const proof=verified.get(JSON.stringify([key(result),result.claude_call_id]));
   if(proof)assert.deepEqual(proof.claude?.citations,result.claude?.citations);
   latest.set(JSON.stringify([key(result),result.citation_window?.index]),proof??result);
  }
 const decisions=reduceHybridWindowResultsV1([...latest.values()].map(r=>({...r,text:text.get(r.root_id)!})));
 const indexed=new Map(pairs.map(p=>[key(p),p])),changes=[];
 for(const selected of decisions){
  const current=indexed.get(key(selected));if(!current||current.source==='human')continue;
  const call=calls.find(c=>c.id===selected.claude_call_id)!;
  assert.equal(current.labeler_digest,call.membership_snapshot.route_digest,'only the frozen current route is re-scored');
  const value=decideHybridMembershipV1(selected.text,selected.jev,selected.claude);
  const missing=selected.claude?.verdict==='belongs'&&!selected.claude.verification;
  const verdict=missing?'pending':value.verdict;
  if(verdict!==current.verdict)changes.push({root_id:selected.root_id,concept_key:selected.concept_key,
   before:current.verdict,after:verdict,reason:missing?'citation_verification_receipt_missing':'window_receipts_reduced',
   claude_call_id:selected.claude_call_id,citation_call_id:selected.citation_call_id??null});
 }
 return {changes,reparsed_calls:windows.length,complete_window_pairs:decisions.length};
}

function goldScore(gold:Gold[],concepts:string[],predictions:Map<string,string>){
 const scored=gold.flatMap(g=>concepts.map(c=>({truth:g.memberships[c],predicted:predictions.get(`${g.root_id}:${c}`)??'pending'})))
  .filter(p=>p.truth!=='insufficient');
 const positive=scored.filter(p=>p.truth==='belongs'),tp=positive.filter(p=>p.predicted==='belongs').length;
 const falsePositive=scored.filter(p=>p.truth==='not_belongs'&&p.predicted==='belongs').length;
 const review=positive.filter(p=>p.predicted==='review_required').length;
 return {positive_pairs:positive.length,published_positive:tp,false_positive:falsePositive,recall_common_denominator:tp/positive.length,
  positive_in_review:review,positive_pending:positive.filter(p=>p.predicted==='pending').length,
  recall_excluding_review:tp/(positive.length-review)};
}

async function main(){
 const [h1Path,standardPath,goldPath,selectionPath,rawDir,outputPath]=process.argv.slice(2);
 assert.ok(outputPath,'usage: h1-export standard-export gold.jsonl selection.json raw-dir output.json');
 const h1Text=await readFile(h1Path!,'utf8'),standardText=await readFile(standardPath!,'utf8');
 const h1=JSON.parse(h1Text),standard=JSON.parse(standardText);
 assert.equal(h1.root_count,1086);assert.equal(standard.root_count,1086);
 assert.equal(h1.corpus_sha256,standard.corpus_sha256);assert.equal(h1.concept_set_digest,standard.concept_set_digest);
 const calls=h1.calls as Call[],raw=new Map<string,string>();
 for(const call of calls.filter(c=>c.inputs.some(i=>i.citation_window)))raw.set(call.id,await readFile(`${rawDir}/${call.id}.json`,'utf8'));
 const ledgerHash=hash(JSON.stringify(calls.map(c=>({id:c.id,settled_micro_usd:c.settled_micro_usd,usage:c.usage}))));
 const result=rescoreHybridWindowReceiptsV1(calls,raw,h1.memberships,new Map(h1.facets.map((f:{root_id:string;full_text:string})=>[f.root_id,f.full_text])));
 const gold=(await readFile(goldPath!,'utf8')).trim().split('\n').map(line=>JSON.parse(line) as Gold);
 const concepts=JSON.parse(await readFile(selectionPath!,'utf8')).concepts.map((c:{concept_key:string})=>c.concept_key);
 const prediction=(data:{memberships:Pair[]})=>new Map(data.memberships.filter(p=>p.source!=='human').map(p=>[`${p.root_id}:${p.concept_key}`,p.verdict]));
 const before=prediction(h1),after=new Map(before);for(const change of result.changes)after.set(`${change.root_id}:${change.concept_key}`,change.after);
 const states=(p:Map<string,string>)=>Object.fromEntries(['belongs','not_belongs','review_required','error','pending','refused','insufficient'].map(v=>[v,[...p.values()].filter(x=>x===v).length]));
 assert.equal(hash(JSON.stringify(calls.map(c=>({id:c.id,settled_micro_usd:c.settled_micro_usd,usage:c.usage})))),ledgerHash);
 const report={at:new Date().toISOString(),provider_calls:0,database_writes:0,published_changes:0,ledger_unchanged:true,
  input_sha256:{h1:hash(h1Text),standard:hash(standardText),gold:hash(await readFile(goldPath!,'utf8'))},root_count:1086,
  reparsed_calls:result.reparsed_calls,complete_window_pairs:result.complete_window_pairs,
  changes_by_category:result.changes.reduce<Record<string,number>>((counts,r)=>(counts[`${r.before}->${r.after}`]=(counts[`${r.before}->${r.after}`]??0)+1,counts),{}),
  before:states(before),rescored:states(after),review_per_1000:1000*[...after.values()].filter(v=>v==='review_required').length/1086,
  gold:Object.fromEntries(['dev','test'].map(part=>[part,{standard:goldScore(gold.filter(g=>g.partition===part),concepts,prediction(standard)),
   h1_before:goldScore(gold.filter(g=>g.partition===part),concepts,before),h1_rescored:goldScore(gold.filter(g=>g.partition===part),concepts,after)}])),
  limitation:'Offline re-score only; missing verification stays pending. No new blind quality sample or publication.'};
 await writeFile(outputPath,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 await writeFile(`${outputPath}.changes-private.json`,JSON.stringify(result.changes,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify(report));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error);process.exitCode=1;});
