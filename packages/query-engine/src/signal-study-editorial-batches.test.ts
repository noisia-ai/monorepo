import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {signalWorkspaceEmbeddingDigestV1 as digest} from './signal-workspace-embeddings-v1';
import {signalStudyJevMotiveConfigurationV1} from './signal-study-jev-contracts';
import {signalListeningBaseTemplateV1} from './signal-listening-contracts';
import {SIGNAL_STUDY_TB_TEMPLATE_V1,SIGNAL_STUDY_TB_ROLES_V1,createSignalStudyTemplateSnapshotV1} from './signal-study-template-data';
import {buildSignalStudyExecutionConfigurationV1} from './signal-study-configuration';
import type {SignalStudyV1,SignalStudyAxesV1} from './signal-study-contracts';
import type {SignalStudySampleV1} from './signal-study-evidence';
import {validateSignalStudyLayerReviewV1,buildSignalStudyConfiguredLayerReviewV1,buildSignalStudyMotiveReviewV1,SignalStudyEditorialRequestSizeErrorV1} from './signal-study-editorial';
import {compileSignalStudyDiscoveryBatchesV2,compileSignalStudyLayerPairV2,compileSignalStudyContrastBatchesV2,
 buildSignalStudyMotiveReconciliationV2,validateSignalStudyMotiveReconciliationV2,validateSignalStudyDiscoveryBatchPrefixV2,
 assertSignalStudyLayerDecisionPrefixV1,aggregateSignalStudyLayerBatchesV2,validateSignalStudyLayerBatchV2,signalStudyLayerPartitionKeysV2,type SignalStudyEditorialBatchPlanV2} from './signal-study-editorial-batches';
const sha=(s:string)=>'sha256:'+createHash('sha256').update(s).digest('hex');
const uuid=(s:string)=>{const h=createHash('sha256').update(s).digest('hex');return`${h.slice(0,8)}-${h.slice(8,12)}-4000-8000-${h.slice(20,32)}`;};
const listening=signalListeningBaseTemplateV1({category:'bicycle',lexicon_terms:['bicycle']}),snapshot=createSignalStudyTemplateSnapshotV1({template:SIGNAL_STUDY_TB_TEMPLATE_V1,roles:SIGNAL_STUDY_TB_ROLES_V1,provenance:'agent',revision:1,human_locked:false});
const study:SignalStudyV1={contract_version:'signal-study-v1',workspace_id:uuid('workspace'),corpus_id:uuid('corpus'),listening_configuration_id:uuid('listening'),listening_configuration_digest:digest(listening),
 methodology:{key:'triggers_barriers',version:snapshot.template.version,template_digest:snapshot.template_digest},subject:{kind:'category',name:'bicycle',category:'bicycle',own_brand:'Fixture',competitors:[],alternatives:[]},
 business_question:'Which forces move the synthetic choice?',cut:{start_at:'2026-01-01T00:00:00Z',end_at:'2027-01-01T00:00:00Z',timezone:'UTC',voice:'individual',promotion_max:.7,exclude_hashtag_only:true,require_category_lexicon:true,filters:{}},provenance:'agent',revision:1};
const configuration=buildSignalStudyExecutionConfigurationV1({study,template_snapshot:snapshot,source_listening:{configuration_id:study.listening_configuration_id,configuration_digest:digest(listening),configuration:listening}});
const axes:SignalStudyAxesV1={direction:'trigger',source_direction:'trigger',target:'category',use:'literal',aggregate:'subject',alternative_inverted:false};
function sample(group_key:string,length=1400,pass:'a'|'b'='a',symbol='x'):SignalStudySampleV1{
 const text='literal evidence. '+symbol.repeat(Math.max(0,length-18));
 const rows=Array.from({length:40},(_,i)=>({root_id:uuid(group_key+pass+i),text,text_sha256:sha(text),source:i<35?'random' as const:'far' as const,axes,evidence_publishable:true}));
 const body={contract_version:'signal-study-sample-v1' as const,study_digest:configuration.study_digest,group_key,pass,random_count:35,far_count:5,population_count:100,
  independence:'disjoint' as const,sampling_policy:{seed_digest:digest('frozen-seed'),population_digest:digest(group_key),centroid_digest:digest('real-fixture-centroid'),requested_random:35,requested_far:5},insufficient_sample:false,rows};
 return{...body,sample_digest:digest(body)};
}
const motive=(key:string,length=1400,symbol='x')=>({key,name:'Synthetic motive '+key,definition:'A shared choice force.',human_locked:false,samples:[sample(key,length,'a',symbol),sample(key,length,'b',symbol)]as[SignalStudySampleV1,SignalStudySampleV1]});
function ready(value:ReturnType<typeof compileSignalStudyDiscoveryBatchesV2>):SignalStudyEditorialBatchPlanV2{assert.equal(value.status,'ready');if(value.status!=='ready')throw Error('fixture format stop');return value;}
function localValue(plan:SignalStudyEditorialBatchPlanV2,index:number){const node=plan.nodes[index]!;return{contract_version:'signal-study-motive-output-v1',input_digest:node.request.input_digest,
 motives:node.item_keys.map(key=>({key:'same_local_key_'+key,name:'Shared comfort',definition:'The same explicitly shared force across local groups.',group_keys:[key],evidence_root_ids:[node.request.source_samples.find(s=>s.group_key===key)!.rows[0]!.root_id]})),insufficient_group_keys:[]};}
function layerValue(node:SignalStudyEditorialBatchPlanV2['nodes'][number]){return{contract_version:'signal-study-layer-output-v1',input_digest:node.request.input_digest,motives:node.item_keys.map(key=>({motive_key:key,partitions:[{key:signalStudyLayerPartitionKeysV2(key)[0],name:'Synthetic partition',definition:'Literal choice force.',sample_root_ids:node.request.source_samples.find(s=>s.group_key===key)!.rows.map(r=>r.root_id),layer:'psychological',
 diagnostics:SIGNAL_STUDY_TB_TEMPLATE_V1.diagnostics.map(d=>({key:d.key,result:d.layer==='psychological'?'yes':'no',force_disappears_without:d.layer==='psychological',reason:'Synthetic evidence-grounded counterfactual.'})),evidence:{root_id:node.request.source_samples.find(s=>s.group_key===key)!.rows[0]!.root_id,quote:'literal evidence',private_person_names:[]},normative_evidence:null,permission_override:null}]}))};}

test('eight full 1400-byte groups batch by actual UTF8 and output estimate; both blind passes preflight without reducing samples',()=>{
 const items=Array.from({length:8},(_,i)=>motive('group_'+i));
 assert.throws(()=>buildSignalStudyMotiveReviewV1({study,template_snapshot:snapshot,samples:items.map(m=>m.samples[0])}),SignalStudyEditorialRequestSizeErrorV1);
 const discovery=ready(compileSignalStudyDiscoveryBatchesV2({configuration,samples:items.map(m=>m.samples[0])}));assert.ok(discovery.nodes.length>1);
 assert.deepEqual(discovery.nodes.flatMap(n=>n.item_keys).sort(),items.map(m=>m.key).sort());
 const layers=ready(compileSignalStudyLayerPairV2({configuration,motives:items}));assert.ok(layers.nodes.length>2);
 for(const pass of['a','b'])assert.deepEqual(layers.nodes.filter(n=>n.request.pass===pass).flatMap(n=>n.item_keys).sort(),items.map(m=>m.key).sort());
 for(const node of[...discovery.nodes,...layers.nodes]){assert.ok(node.input_bytes<=524288);assert.ok(node.estimated_output_tokens<=32768);assert.equal(node.input_bytes,Buffer.byteLength(node.request.request_body));
  for(const s of node.request.source_samples){assert.equal(s.rows.length,40);assert.equal(s.random_count,35);assert.equal(s.far_count,5);assert.ok(s.rows.every(r=>r.text.length===1400));}}
 assert.deepEqual(compileSignalStudyLayerPairV2({configuration,motives:[...items].reverse()}),layers);
 const unicode=ready(compileSignalStudyLayerPairV2({configuration,motives:Array.from({length:8},(_,i)=>motive('unicode_'+i,1400,'漢'))}));
 assert.ok(unicode.nodes.length>layers.nodes.length);assert.ok(unicode.nodes.every(n=>n.input_bytes<=524288));
});

test('more than forty motives retain both pass census and full-kappa aggregation; boundary recode only exact keys',()=>{
 const items=Array.from({length:45},(_,i)=>motive('motive_'+String(i).padStart(2,'0'),40)),plan=ready(compileSignalStudyLayerPairV2({configuration,motives:items}));
 const values=plan.nodes.map(n=>validateSignalStudyLayerBatchV2(n.request,layerValue(n))),pair=aggregateSignalStudyLayerBatchesV2(plan,values);
 assert.equal(pair[0].motives.length,45);assert.equal(pair[1].motives.length,45);assert.ok(plan.nodes.length>2);
 const partial=values[0]!,second={...partial,motives:partial.motives.map(m=>({...m,motive_key:'another_'+m.motive_key}))};
 assert.throws(()=>assertSignalStudyLayerDecisionPrefixV1([partial],second),/partition_collision/);
 assert.throws(()=>aggregateSignalStudyLayerBatchesV2(plan,values.slice(1)),/coverage_invalid/);
 const selected=items.slice(0,3),repair=ready(compileSignalStudyLayerPairV2({configuration,motives:selected,recode:{attempt:1,boundary_keys:selected.map(m=>m.key),contrast_rule:'Only these frozen boundaries.'}}));
 assert.ok(repair.nodes.every(n=>n.request.recode_attempt===1));assert.deepEqual(repair.item_keys,selected.map(m=>m.key));
 assert.throws(()=>compileSignalStudyLayerPairV2({configuration,motives:selected,recode:{attempt:1,boundary_keys:[items[4]!.key],contrast_rule:'Incorrect scope.'}}),/recode_scope/);
});

test('local group provenance is reconciled globally once, shared motives merge across batches, missing/duplicate candidates fail',()=>{
 const samples=Array.from({length:8},(_,i)=>sample('group_'+i)),plan=ready(compileSignalStudyDiscoveryBatchesV2({configuration,samples}));
 const local=plan.nodes.map((_,i)=>localValue(plan,i)),prefix=validateSignalStudyDiscoveryBatchPrefixV2(plan,local);
 assert.equal(prefix.candidates.length,8);assert.equal(new Set(prefix.candidates.map(c=>c.candidate_id)).size,8);
 const request=buildSignalStudyMotiveReconciliationV2({configuration,discovery_plan:plan,local_values:local});assert.ok('request_body'in request);if(!('request_body'in request))throw Error('expected reconciliation');
 const ids=request.candidates.map(c=>c.candidate_id),output={contract_version:'signal-study-reconciliation-output-v2',input_digest:request.input_digest,clusters:[{representative_id:ids[0],member_ids:ids}]};
 const merged=validateSignalStudyMotiveReconciliationV2(request,output);assert.equal(merged.motives.length,1);assert.equal(merged.motives[0]!.group_keys.length,8);assert.equal(merged.motives[0]!.evidence_root_ids.length,8);
 assert.equal(merged.motives[0]!.definition,request.candidates[0]!.definition);assert.ok(request.estimated_output_tokens<32768);
 assert.throws(()=>validateSignalStudyMotiveReconciliationV2(request,{...output,clusters:[{representative_id:ids[0],member_ids:ids.slice(1)}]}),/representative_invalid/);
 assert.throws(()=>validateSignalStudyMotiveReconciliationV2(request,{...output,clusters:[...output.clusters,...output.clusters]}),/coverage_invalid/);
 assert.throws(()=>buildSignalStudyMotiveReconciliationV2({configuration,discovery_plan:plan,local_values:local.slice(1)}),/coverage_invalid/);
 const payload=JSON.parse(JSON.parse(request.request_body).messages[0].content).untrusted_data;assert.equal(payload.candidates.length,8);assert.ok(payload.candidates.every((c:unknown)=>!('rows'in(c as object))));
});

test('contrast batches retain all original neighbor definitions and locked guards; single oversized units stop rather than truncate',()=>{
 const items=Array.from({length:12},(_,i)=>motive('contrast_'+i)),motives=items.map(m=>({...m,sample:m.samples[0]}));
 const plan=ready(compileSignalStudyContrastBatchesV2({configuration,motives,affected_keys:items.slice(0,8).map(m=>m.key)}));assert.ok(plan.nodes.length>1);
 for(const node of plan.nodes){const payload=JSON.parse(JSON.parse(node.request.request_body).messages[0].content).untrusted_data;
  assert.equal(payload.neighbor_context.length+payload.motives.length,12);assert.equal(payload.motives.length,node.item_keys.length);}
 assert.throws(()=>compileSignalStudyContrastBatchesV2({configuration,motives:motives.map((m,i)=>({...m,human_locked:i===0})),affected_keys:[motives[0]!.key]}),/contrast_scope_invalid/);
 const giant=motive('giant',14000),result=compileSignalStudyDiscoveryBatchesV2({configuration,samples:[giant.samples[0]]});
 assert.equal(result.status,'format_stop');if(result.status==='format_stop'){assert.equal(result.reason,'request_bytes');assert.ok(result.observed>524288);assert.deepEqual(result.unit_keys,['giant']);}
 const layers=compileSignalStudyLayerPairV2({configuration,motives:[giant]});assert.equal(layers.status,'format_stop');
});

test('the exact 524288 UTF8 boundary fits, one extra byte stops the same whole unit',()=>{
 let s=sample('boundary',100),base=buildSignalStudyMotiveReviewV1({study,template_snapshot:snapshot,samples:[s]});
 const delta=524288-Buffer.byteLength(base.request_body);assert.ok(delta>0);
 const replace=(value:SignalStudySampleV1,extra:number)=>{const rows=value.rows.map((row,i)=>i===0?{...row,text:row.text+'x'.repeat(extra),text_sha256:sha(row.text+'x'.repeat(extra))}:row);
  const {sample_digest,...body}=value;const changed={...body,rows};return{...changed,sample_digest:digest(changed)};};
 s=replace(s,delta);base=buildSignalStudyMotiveReviewV1({study,template_snapshot:snapshot,samples:[s]});assert.equal(Buffer.byteLength(base.request_body),524288);
 const plan=ready(compileSignalStudyDiscoveryBatchesV2({configuration,samples:[s]}));assert.equal(plan.nodes[0]!.input_bytes,524288);
 const stopped=compileSignalStudyDiscoveryBatchesV2({configuration,samples:[replace(s,1)]});assert.equal(stopped.status,'format_stop');
 if(stopped.status==='format_stop'){assert.equal(stopped.reason,'request_bytes');assert.equal(stopped.observed,524289);}
});

test('all-insufficient discovery skips global HTTP; oversized known global definitions stop without claiming a partial reconciliation',()=>{
 const plan=ready(compileSignalStudyDiscoveryBatchesV2({configuration,samples:[sample('insufficient',40)]}));
 const values=plan.nodes.map(node=>({contract_version:'signal-study-motive-output-v1',input_digest:node.request.input_digest,motives:[],insufficient_group_keys:node.item_keys}));
 const skipped=buildSignalStudyMotiveReconciliationV2({configuration,discovery_plan:plan,local_values:values});assert.ok('status'in skipped&&skipped.status==='no_candidates');
 const many=ready(compileSignalStudyDiscoveryBatchesV2({configuration,samples:Array.from({length:160},(_,i)=>sample('global_'+i,40))}));
 const long=many.nodes.map((_,i)=>{const value=localValue(many,i);return{...value,motives:value.motives.map(m=>({...m,definition:'漢'.repeat(1200)}))};});
 const result=buildSignalStudyMotiveReconciliationV2({configuration,discovery_plan:many,local_values:long});
 assert.ok('status'in result&&result.status==='format_stop');if('status'in result&&result.status==='format_stop')assert.equal(result.phase,'discovery-global');
});

test('semantic motive and membership identities survive execution sampling changes, while changed meaning misses cache and collisions fail closed',()=>{
 function run(seed:string,definition='A precise shared bicycle choice force.',split=false){
  const samples=['one','two'].map(key=>{const prior=sample(key,60),{sample_digest:_old,...body}=prior;body.sampling_policy={...body.sampling_policy,seed_digest:digest(seed)};return{...body,sample_digest:digest(body)};});
  const plan=ready(compileSignalStudyDiscoveryBatchesV2({configuration,samples})),values=plan.nodes.map((_,i)=>localValue(plan,i));
  for(const value of values)for(const m of value.motives){m.definition=definition;}
  const request=buildSignalStudyMotiveReconciliationV2({configuration,discovery_plan:plan,local_values:values});if(!('request_body'in request))throw Error('expected request');
  const ids=request.candidates.map(c=>c.candidate_id),clusters=split?ids.map(id=>({representative_id:id,member_ids:[id]})):[{representative_id:ids[0],member_ids:ids}];
  const output=validateSignalStudyMotiveReconciliationV2(request,{contract_version:'signal-study-reconciliation-output-v2',input_digest:request.input_digest,clusters});
  const motives=output.motives.map(m=>({...m,centroid:[1,0],layer:'personal' as const,human_locked:false}));
  const membership=signalStudyJevMotiveConfigurationV1(configuration,motives);
  return{plan,request,output,membership};
 }
 const a=run('execution-a'),b=run('execution-b');assert.notEqual(a.plan.plan_digest,b.plan.plan_digest);assert.notEqual(a.request.stage,b.request.stage);assert.notDeepEqual(a.request.candidates.map(c=>c.candidate_id),b.request.candidates.map(c=>c.candidate_id));
 assert.deepEqual(a.output.motives.map(m=>m.key),b.output.motives.map(m=>m.key));assert.equal(digest(a.membership.questions),digest(b.membership.questions));
 assert.deepEqual(signalStudyLayerPartitionKeysV2(a.output.motives[0]!.key),signalStudyLayerPartitionKeysV2(b.output.motives[0]!.key));
 const changed=run('execution-a','A different counterfactual force with distinct inclusion boundaries.');assert.notEqual(a.output.motives[0]!.key,changed.output.motives[0]!.key);assert.notEqual(digest(a.membership.questions),digest(changed.membership.questions));
 assert.throws(()=>run('execution-a',undefined,true),/semantic_identity_collision/u);
});
