import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {SIGNAL_STUDY_TB_TEMPLATE_V1,SIGNAL_STUDY_TB_TEMPLATE_DIGEST_V1,validateSignalStudyV1,
  buildSignalStudyListeningConfigurationV1,buildSignalStudyAxesRequestV1,signalStudyCutV1,resolveSignalStudyAxesV1,
  SIGNAL_STUDY_DIRECTIONS_V1,SIGNAL_STUDY_TARGETS_V1,SIGNAL_STUDY_USES_V1,type SignalStudyV1,type SignalStudyLayerV1} from './signal-study-contracts';
import {signalListeningBaseTemplateV1,buildSignalListeningJevRequestV1} from './signal-listening-contracts';
import {signalWorkspaceEmbeddingDigestV1 as digest} from './signal-workspace-embeddings-v1';
import {buildSignalStudyMotivePopulationV1,buildSignalStudyMotiveFitPlanV1,sampleSignalStudyGroupV1,signalStudyConfirmedCentroidV1,signalStudyNearestMotivesV1,
  signalStudySourceUrlStateV1,signalStudyEvidencePublishableV1,signalStudyDominancePlanV1,verifySignalStudyVerbatimV1,signalStudyQueryBiasV1,signalStudyPromotionProposalV1,
  type SignalStudyRootV1,type SignalStudyMotiveV1,type SignalStudySampleV1} from './signal-study-evidence';
import {buildSignalStudyMotiveReviewV1,validateSignalStudyMotiveReviewV1,buildSignalStudyLayerReviewV1,
  validateSignalStudyLayerReviewV1,signalStudyLayerStabilityV1,applySignalStudyBoundaryRecodeV1,
  buildSignalStudyContrastReviewV1,validateSignalStudyContrastReviewV1,type SignalStudyLayerDecisionV1} from './signal-study-editorial';
import {buildSignalStudyMotiveConfigurationV1,buildSignalStudyMotiveRequestV1,buildSignalStudySummaryV1} from './signal-study-output';
import type {JevAnswerV1} from './signal-mention-facets-jev-v1';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const base=signalListeningBaseTemplateV1({category:'synthetic bicycles',lexicon_terms:['bicycle']});
const study:SignalStudyV1={contract_version:'signal-study-v1',workspace_id:id(1),corpus_id:id(2),listening_configuration_id:id(3),
  listening_configuration_digest:digest(base),methodology:{key:'triggers_barriers',version:'r16-v1',template_digest:SIGNAL_STUDY_TB_TEMPLATE_DIGEST_V1},
  subject:{kind:'category',name:'synthetic bicycles',category:'synthetic bicycles',own_brand:'Fixture brand',competitors:['Fixture competitor'],alternatives:['Fixture alternative']},
  business_question:'Which forces move the synthetic decision?',cut:{start_at:'2026-01-01T00:00:00Z',end_at:'2027-01-01T00:00:00Z',timezone:'America/Sao_Paulo',
    voice:'individual',promotion_max:.7,exclude_hashtag_only:true,require_category_lexicon:true,filters:{}},provenance:'human',revision:1};
function choice(allowed:readonly string[],value:string):JevAnswerV1{return{type:'choice',choice:value,confidence:.9,
  probabilities:Object.fromEntries(allowed.map(key=>[key,key===value?.9:.1/(allowed.length-1)]))};}
function axes(direction='trigger',target='category',use='literal'){
  return resolveSignalStudyAxesV1(study.subject,{study_direction:choice(SIGNAL_STUDY_DIRECTIONS_V1,direction),
    study_target:choice(SIGNAL_STUDY_TARGETS_V1,target),study_use:choice(SIGNAL_STUDY_USES_V1,use)});
}
function root(n:number,direction='trigger',target='category',use='literal'):SignalStudyRootV1{
  const text=`Synthetic bicycle choice ${n}: I enjoy it with @fixture and Private Fixture. We should respect its heritage.`;
  const vector=Array.from({length:1024},(_,i)=>i===0?1:i===1?n/100:0);
  return{root_id:id(100+n),text,text_sha256:'sha256:'+createHash('sha256').update(text).digest('hex'),vector,axes:axes(direction,target,use),
    occurred_at:'2026-02-01T01:30:00Z',channel:n%2?'forum':'video',source_url:'https://example.invalid/post/'+n,
    listening_topic_keys:['cycling','cycling'],private_person_names:['Private Fixture']};
}
const motive=(key='enjoyment',layer:SignalStudyLayerV1='psychological'):SignalStudyMotiveV1=>({key,name:'Enjoyment',definition:'Pleasure as an expressed reason, excluding price or peer approval.',
  centroid:root(0).vector,layer,human_locked:false});
function samples(key='enjoyment',n=100){const roots=Array.from({length:n},(_,i)=>root(i));
  return sampleSignalStudyGroupV1({study_digest:digest(study),group_key:key,roots,centroid:signalStudyConfirmedCentroidV1(roots),seed:'frozen-synthetic-seed'});}
function layerOutput(review:ReturnType<typeof buildSignalStudyLayerReviewV1>,layer:SignalStudyLayerV1='psychological'){
  const sample=review.source_samples[0]!,evidence={root_id:sample.rows[0]!.root_id,quote:'I enjoy it',private_person_names:[] as string[]};
  return{contract_version:'signal-study-layer-output-v1',input_digest:review.input_digest,motives:[{motive_key:sample.group_key,partitions:[{
    key:sample.group_key,name:'Enjoyment',definition:'The individual pleasure force.',sample_root_ids:sample.rows.map(r=>r.root_id),layer,
    diagnostics:SIGNAL_STUDY_TB_TEMPLATE_V1.diagnostics.map(d=>({key:d.key,result:d.layer===layer?'yes':'no',force_disappears_without:d.layer===layer,reason:'Counterfactual grounded in sample.'})),
    evidence,normative_evidence:layer==='cultural'?{root_id:sample.rows[0]!.root_id,quote:'We should respect its heritage.',private_person_names:[],norm_kind:'heritage',reason:'Explicit normative claim.'}:null,
    permission_override:null}]}]};
}
function layerReview(sample:SignalStudySampleV1){return buildSignalStudyLayerReviewV1({study,pass:sample.pass,
  motives:[{key:sample.group_key,name:'Enjoyment',definition:'The individual pleasure force.',sample}]});}

test('Study binds existing corpus, versioned template and exact subject; configuration supplies all methodological text',()=>{
  assert.equal(validateSignalStudyV1(study).corpus_id,id(2));
  const config=buildSignalStudyListeningConfigurationV1(study,['bicycle']);
  const request=buildSignalListeningJevRequestV1({text:'I enjoy this bicycle',question_keys:['study_direction','study_target','study_use']},config);
  assert.deepEqual(Object.keys(request.questions),['study_direction','study_target','study_use']);
  assert.match((request.questions.study_direction!.instructions as {question:string}).question,/synthetic bicycles/u);
  assert.equal(config.questions.find(q=>q.key==='study_direction')!.origin,'methodology');
  const changed={...config,questions:config.questions.map(q=>q.key==='study_direction'?{...q,text:'Persisted custom wording'}:q)};
  assert.equal((buildSignalListeningJevRequestV1({text:'bicycle',question_keys:['study_direction']},changed).questions.study_direction!.instructions as {question:string}).question,'Persisted custom wording');
  assert.equal(base.questions.some(q=>q.key==='study_direction'||q.key==='trigger_barrier'),false);
  assert.throws(()=>validateSignalStudyV1({...study,methodology:{...study.methodology,template_digest:digest('another-template')}}),/study_invalid/);
  assert.throws(()=>validateSignalStudyV1({...study,cut:{...study.cut,end_at:study.cut.start_at}}),/study_invalid/);
  assert.throws(()=>validateSignalStudyV1({...study,subject:{...study.subject,kind:'alternative'}}),/study_invalid/);
  assert.throws(()=>validateSignalStudyV1({...study,cut:{...study.cut,timezone:'Not/AZone'}}),/timezone_invalid/);
  assert.ok(Object.isFrozen(SIGNAL_STUDY_TB_TEMPLATE_V1.questions[0]!.options));
});
test('consumer cut uses cached base, exact listening scope, period and additional filters without charging again',()=>{
  const included={voice:choice(['individual','brand'],'individual'),promotion:{type:'noul' as const,noul:.7}};
  const args={study,listening:base,text:'I choose a bicycle',occurred_at:'2026-01-15T00:00:00Z',answers:included};
  assert.equal(signalStudyCutV1(args),'included');
  assert.equal(signalStudyCutV1({...args,answers:{}}),'awaiting_base');
  assert.equal(signalStudyCutV1({...args,answers:{...included,promotion:{type:'noul',noul:.70001}}}),'excluded');
  assert.equal(signalStudyCutV1({...args,text:'#bicycle #ride'}),'excluded');
  assert.equal(signalStudyCutV1({...args,text:'bicycles are mentioned, no exact lexical token'}),'excluded');
  assert.equal(signalStudyCutV1({...args,occurred_at:study.cut.end_at}),'excluded');
  assert.throws(()=>signalStudyCutV1({...args,listening:{...base,lexicon_terms:['unrelated']}}),/scope_mismatch/);
  const filtered={...study,cut:{...study.cut,filters:{channel:['forum']}}};
  assert.equal(signalStudyCutV1({...args,study:filtered,attributes:{channel:['video']}}),'excluded');
  assert.equal(signalStudyCutV1({...args,study:filtered,attributes:{channel:['forum']}}),'included');
});
test('Study axes request asks only the three new configured questions and keeps the cut bound to original base answers',()=>{
  const config=buildSignalStudyListeningConfigurationV1(study,['bicycle']);
  const input={text:'I want this bicycle but I cannot afford it.'},request=buildSignalStudyAxesRequestV1(input,config);
  assert.deepEqual(Object.keys(request.questions),['study_direction','study_target','study_use']);
  assert.equal('voice'in request.questions,false);assert.equal('promotion'in request.questions,false);assert.equal(request.state,input.text);
  const source={study,listening:base,text:input.text,occurred_at:'2026-02-15T00:00:00Z',
    answers:{voice:choice(['individual','brand'],'individual'),promotion:{type:'noul' as const,noul:.1}}};
  assert.equal(signalStudyCutV1(source),'included');
  assert.throws(()=>signalStudyCutV1({...source,listening:config}),/listening_scope_mismatch/);
  assert.throws(()=>buildSignalStudyAxesRequestV1(input,base),/axes_configuration_invalid/);
  assert.equal(signalStudyCutV1(source),'included','building a methodology request does not replace the original scope or cached base');
});
test('axes preserve mixed, isolate competitor rejection and irony, and invert conventional rejection only for an alternative subject',()=>{
  assert.equal(axes('mixed').direction,'mixed');
  assert.equal(axes('barrier','competitor_brand').aggregate,'competitor');
  assert.equal(axes('barrier','category','figurative_or_ironic').aggregate,'figurative_or_ironic');
  const alternative={...study.subject,kind:'alternative' as const,name:'Fixture alternative',conventional_category:'conventional bicycles'};
  const answers={study_direction:choice(SIGNAL_STUDY_DIRECTIONS_V1,'barrier'),study_target:choice(SIGNAL_STUDY_TARGETS_V1,'category'),study_use:choice(SIGNAL_STUDY_USES_V1,'literal')};
  const resolved=resolveSignalStudyAxesV1(alternative,answers);
  assert.equal(resolved.direction,'trigger');assert.equal(resolved.source_direction,'barrier');assert.equal(resolved.alternative_inverted,true);
  assert.equal(resolveSignalStudyAxesV1(study.subject,answers).direction,'barrier');
  assert.equal(resolveSignalStudyAxesV1(alternative,{...answers,study_target:choice(SIGNAL_STUDY_TARGETS_V1,'competitor_brand')}).direction,'barrier');
  assert.throws(()=>resolveSignalStudyAxesV1(study.subject,{...answers,study_use:{type:'choice',choice:'literal',confidence:.9,probabilities:{literal:1,other:1,figurative_or_ironic:1}}}),/axes_invalid/);
});
test('one motive fit pools opposing directions with mixed while literal none/irony are kept outside discovery',()=>{
  const selected=buildSignalStudyMotivePopulationV1([root(1),root(2,'barrier'),root(3,'mixed'),root(4,'none'),root(5,'trigger','category','figurative_or_ironic')]);
  assert.deepEqual(selected.direction_counts,{trigger:1,barrier:1,mixed:1,none:0});assert.equal(selected.roots.length,3);
  assert.equal(new Set(selected.roots.map(r=>r.axes.direction)).size,3);
  const fit=buildSignalStudyMotiveFitPlanV1({study,roots:selected.roots,embedding_space_digest:digest('existing-voyage-profile')});
  assert.equal(fit.source,'existing_corpus_vectors');assert.equal(fit.rows.length,3);assert.deepEqual(fit.guides,[]);
  assert.deepEqual(fit.rows[0]!.vector,selected.roots[0]!.vector);assert.equal(fit.configuration.fit_unit,'canonical-root-centroid-v1');
  assert.throws(()=>buildSignalStudyMotivePopulationV1([{...root(1),text:'changed after sealing'}]),/root_invalid/);
  assert.throws(()=>signalStudyConfirmedCentroidV1([{...root(1),vector:[0]}]),/vector_invalid/);
});
test('random plus distant samples preserve bytes, are order-independent, and use different blind evidence',()=>{
  const [a,b]=samples();assert.equal(a.random_count,35);assert.equal(a.far_count,5);assert.equal(b.random_count,35);assert.equal(b.far_count,5);
  assert.equal(b.independence,'disjoint');assert.equal(a.rows.some(row=>b.rows.some(other=>other.root_id===row.root_id)),false);
  const roots=Array.from({length:100},(_,i)=>root(i));
  const reversed=sampleSignalStudyGroupV1({study_digest:digest(study),group_key:'enjoyment',roots:roots.reverse(),centroid:signalStudyConfirmedCentroidV1(roots),seed:'frozen-synthetic-seed'});
  assert.deepEqual([a,b],reversed);
  const small=samples('small',20);assert.equal(small[0].insufficient_sample,true);assert.equal(small[0].independence,'small_group');
  const minimum=samples('minimum',36);assert.equal(minimum[0].random_count,30);assert.equal(minimum[1].random_count,30);
  assert.notDeepEqual(minimum[0].rows.map(row=>row.root_id).sort(),minimum[1].rows.map(row=>row.root_id).sort());
});
test('nearest four motifs are asked together only for directed literal roots, from persisted definitions',()=>{
  const motives=Array.from({length:8},(_,i)=>({...motive('motive_'+i),centroid:root(i).vector}));
  const config=buildSignalStudyMotiveConfigurationV1(buildSignalStudyListeningConfigurationV1(study,['bicycle']),motives);
  const selected=signalStudyNearestMotivesV1(root(2),motives);assert.equal(selected.length,4);
  assert.equal(selected[0]!.key,'motive_2');
  const request=buildSignalStudyMotiveRequestV1(root(2),motives,config)!;assert.equal(Object.keys(request.questions).length,4);
  const selectedRoot=root(2),fragment='I enjoy it',start=selectedRoot.text.indexOf(fragment);
  selectedRoot.selected_fragment={text:fragment,text_sha256:'sha256:'+createHash('sha256').update(fragment).digest('hex'),start,end:start+fragment.length};
  assert.equal(buildSignalStudyMotiveRequestV1(selectedRoot,motives,config)!.state,fragment);
  assert.throws(()=>buildSignalStudyMotiveRequestV1({...selectedRoot,selected_fragment:{...selectedRoot.selected_fragment!,start:0}},motives,config),/fragment_invalid/);
  assert.equal(Object.keys(request.questions).some(key=>key==='voice'||key==='study_direction'),false);
  assert.equal(buildSignalStudyMotiveRequestV1(root(2,'none'),motives,config),null);
  assert.equal(buildSignalStudyMotiveRequestV1(root(2,'trigger','category','figurative_or_ironic'),motives,config),null);
  assert.throws(()=>buildSignalStudyMotiveRequestV1(root(2),motives,{...config,questions:config.questions.filter(q=>q.key!=='motive_2')}),/configuration_mismatch/);
});
test('motive editorial partitions every group exactly once and rejects invented evidence or cross-study samples',()=>{
  const [sample]=samples(),review=buildSignalStudyMotiveReviewV1({study,samples:[sample]});
  const result={contract_version:'signal-study-motive-output-v1',input_digest:review.input_digest,motives:[{key:'enjoyment',name:'Pleasure',definition:'Reason for consumption.',
    group_keys:['enjoyment'],evidence_root_ids:[sample.rows[0]!.root_id]}],insufficient_group_keys:[]};
  assert.equal(validateSignalStudyMotiveReviewV1(review,result).motives.length,1);
  assert.throws(()=>validateSignalStudyMotiveReviewV1(review,{...result,insufficient_group_keys:['enjoyment']}),/coverage_invalid/);
  assert.throws(()=>validateSignalStudyMotiveReviewV1(review,{...result,motives:[{...result.motives[0]!,evidence_root_ids:['invented']}]}),/evidence_invalid/);
  assert.throws(()=>buildSignalStudyMotiveReviewV1({study:{...study,business_question:'Other study'},samples:[sample]}),/scope_invalid/);
  assert.throws(()=>validateSignalStudyMotiveReviewV1({...review,request_body:'changed'},result),/request_invalid/);
});
test('blind layer requests use Sonnet4.6 and separate samples with no previous coder labels',()=>{
  const [a,b]=samples(),ra=layerReview(a),rb=layerReview(b),bodyA=JSON.parse(ra.request_body),bodyB=JSON.parse(rb.request_body);
  assert.equal(bodyA.model,'claude-sonnet-4-6');assert.notEqual(ra.request_digest,rb.request_digest);
  const inputA=JSON.parse(bodyA.messages[0].content).untrusted_data,inputB=JSON.parse(bodyB.messages[0].content).untrusted_data;
  assert.equal(Object.keys(inputA).some(k=>k.includes('previous')||k.includes('decision')),false);
  assert.notDeepEqual(inputA.motives[0].sample,inputB.motives[0].sample);
  assert.match(bodyA.system,/four hours PER MONTH/u);
  assert.equal(validateSignalStudyLayerReviewV1(ra,layerOutput(ra)).motives[0]!.partitions[0]!.permission,'movable');
});
test('layer evidence is literal, absent evidence stays unclear, and normative cultural evidence is mandatory',()=>{
  const review=layerReview(samples()[0]);let output=layerOutput(review);
  output.motives[0]!.partitions[0]!.evidence.quote='invented quote';assert.throws(()=>validateSignalStudyLayerReviewV1(review,output),/not_literal/);
  output=layerOutput(review);const noEvidence={...output,motives:[{...output.motives[0]!,partitions:[{...output.motives[0]!.partitions[0]!,evidence:null}]}]};
  const unclear=validateSignalStudyLayerReviewV1(review,noEvidence).motives[0]!.partitions[0]!;
  assert.equal(unclear.layer,'unclear');assert.equal(unclear.permission,'no_permission');
  const cultural=layerOutput(review,'cultural');assert.equal(validateSignalStudyLayerReviewV1(review,cultural).motives[0]!.partitions[0]!.layer,'cultural');
  cultural.motives[0]!.partitions[0]!.normative_evidence=null;
  assert.equal(validateSignalStudyLayerReviewV1(review,cultural).motives[0]!.partitions[0]!.layer,'unclear');
});
test('two dominant layers require a split, all sample members remain accounted for, diagnostic order and permission override are checked',()=>{
  const review=layerReview(samples()[0]),output=layerOutput(review),partition=output.motives[0]!.partitions[0]!;
  partition.diagnostics[1]={...partition.diagnostics[1]!,result:'yes',force_disappears_without:true};
  assert.throws(()=>validateSignalStudyLayerReviewV1(review,output),/split_required/);
  const valid=layerOutput(review),p=valid.motives[0]!.partitions[0]!;
  const split={...valid,motives:[{motive_key:'enjoyment',partitions:[{...p,key:'personal_half',sample_root_ids:p.sample_root_ids.slice(0,20),
    diagnostics:p.diagnostics.map(d=>({...d,result:d.key==='money_time'?'yes':'no',force_disappears_without:d.key==='money_time'})),layer:'personal',
    evidence:{root_id:p.sample_root_ids[0]!,quote:'I enjoy it',private_person_names:[]}},{...p,key:'pleasure_half',sample_root_ids:p.sample_root_ids.slice(20),evidence:{root_id:p.sample_root_ids[20]!,quote:'I enjoy it',private_person_names:[]}}]}]};
  assert.equal(validateSignalStudyLayerReviewV1(review,split).motives[0]!.partitions.length,2);
  assert.throws(()=>validateSignalStudyLayerReviewV1(review,{...valid,motives:[{motive_key:'enjoyment',partitions:[{...p,sample_root_ids:p.sample_root_ids.slice(1)}]}]}),/evidence_not_literal|coverage_invalid/);
  const wrongOrder=layerOutput(review);wrongOrder.motives[0]!.partitions[0]!.diagnostics.reverse();assert.throws(()=>validateSignalStudyLayerReviewV1(review,wrongOrder),/diagnostic_order_invalid/);
  const override={...valid,motives:[{motive_key:'enjoyment',partitions:[{...p,permission_override:{permission:'partial',reason:'Specific distribution constraints.'}}]}]};
  assert.equal(validateSignalStudyLayerReviewV1(review,override).motives[0]!.partitions[0]!.permission_overridden,true);
});
function decisions(a:SignalStudyLayerV1[],b:SignalStudyLayerV1[],attempt:0|1=0):[SignalStudyLayerDecisionV1,SignalStudyLayerDecisionV1]{
  const partition=validateSignalStudyLayerReviewV1(layerReview(samples()[0]),layerOutput(layerReview(samples()[0]))).motives[0]!.partitions[0]!;
  return([a,b] as const).map((values,index)=>({contract_version:'signal-study-layer-decision-v1',request_digest:digest({values,index,attempt}),study_digest:digest(study),
    pass:index===0?'a':'b',recode_attempt:attempt,motives:values.map((layer,i)=>({motive_key:'motive_'+i,partitions:[{...partition,key:'motive_'+i,layer}]}))})) as [SignalStudyLayerDecisionV1,SignalStudyLayerDecisionV1];
}
test('kappa uses all motifs, boundary recode is limited to once, unchanged motifs remain in final denominator',()=>{
  const first:SignalStudyLayerV1[]=['psychological','personal','social','cultural','psychological','personal','social','cultural'];
  const second=[...first];second[0]='social';second[1]='cultural';
  const initial=decisions(first,second),reliability=signalStudyLayerStabilityV1(...initial);
  assert.equal(reliability.kappa,2/3);assert.equal(reliability.action,'recode_boundary_once');assert.deepEqual(reliability.boundary_keys,['motive_0','motive_1']);
  const recoded=decisions(first,first,1).map(d=>({...d,motives:d.motives.slice(0,2)})) as [SignalStudyLayerDecisionV1,SignalStudyLayerDecisionV1];
  const combined=applySignalStudyBoundaryRecodeV1({initial,recoded});assert.equal(combined.stability.kappa,1);assert.equal(combined.stability.compared_motives,8);
  const stillBad=decisions(first,second,1);assert.equal(signalStudyLayerStabilityV1(...stillBad).action,'unstable_report');
  assert.throws(()=>applySignalStudyBoundaryRecodeV1({initial:stillBad,recoded}),/recode_not_allowed/);
  assert.throws(()=>applySignalStudyBoundaryRecodeV1({initial,recoded:decisions(first,first,1)}),/scope_invalid/);
  assert.equal(signalStudyLayerStabilityV1(...decisions(['personal','personal'],['personal','personal'])).action,'not_estimable');
});
test('a split in one of nine motifs prevents publishing kappa from the other eight',()=>{
  const labels:SignalStudyLayerV1[]=['psychological','personal','social','cultural','psychological','personal','social','cultural','personal'];
  const [a,b]=decisions(labels,labels),last=b.motives[8]!;
  last.partitions=[{...last.partitions[0]!,key:'split_personal'},{...last.partitions[0]!,key:'split_social',layer:'social'}];
  const estimate=signalStudyLayerStabilityV1(a,b);
  assert.equal(estimate.compared_motives,8);assert.equal(estimate.total_motives,9);
  assert.equal(estimate.kappa,null);assert.equal(estimate.observed_agreement,null);assert.equal(estimate.expected_agreement,null);
  assert.equal(estimate.estimation_status,'not_estimable');
  assert.deepEqual(estimate.boundary_keys,['motive_8']);assert.equal(estimate.action,'recode_boundary_once');
  const recoded=decisions(labels,labels,1).map(d=>({...d,motives:[d.motives[8]!]})) as [SignalStudyLayerDecisionV1,SignalStudyLayerDecisionV1];
  const final=applySignalStudyBoundaryRecodeV1({initial:[a,b],recoded});
  assert.equal(final.stability.total_motives,9);assert.equal(final.stability.compared_motives,9);assert.equal(final.stability.kappa,1);
});
test('dominance uses the full cut, strict >50%, targets only affected questions and all previously asked roots, including rejected ones',()=>{
  const roots=Array.from({length:6},(_,i)=>root(i)),m= motive();
  const memberships=roots.map((r,i)=>({root_id:r.root_id,motive_key:m.key,probability:i<3?.9:.1,source:'jev' as const,human_locked:false}));
  assert.deepEqual(signalStudyDominancePlanV1({roots,motives:[m],memberships,cut_root_ids:roots.map(r=>r.root_id)}).motive_keys,[]);
  memberships[3]!.probability=.9;
  const plan=signalStudyDominancePlanV1({roots,motives:[m],memberships,cut_root_ids:roots.map(r=>r.root_id)});
  assert.deepEqual(plan.motive_keys,[m.key]);assert.equal(plan.reask_root_ids.length,6,'rejected answers must also see the contrastive definition');
  const locked=signalStudyDominancePlanV1({roots,motives:[{...m,human_locked:true}],memberships,cut_root_ids:roots.map(r=>r.root_id)});
  assert.deepEqual(locked.motive_keys,[]);assert.deepEqual(locked.locked_motive_keys,[m.key]);
  const sample=samples()[0],review=buildSignalStudyContrastReviewV1({study,motives:[{...m,sample}],affected_keys:[m.key]});
  assert.equal(validateSignalStudyContrastReviewV1(review,{contract_version:'signal-study-contrast-output-v1',input_digest:review.input_digest,definitions:[{key:m.key,name:m.name,
    definition:'Pleasure explicitly contrasted with price.',contrast_reason:'Price alone does not qualify.',evidence_root_ids:[sample.rows[0]!.root_id]}]}).definitions.length,1);
  assert.throws(()=>buildSignalStudyContrastReviewV1({study,motives:[{...m,human_locked:true,sample}],affected_keys:[m.key]}),/contrast_scope_invalid/);
});
test('contrast sees unmodified neighboring definitions as readonly context while its output is limited to affected keys',()=>{
  const m=motive(),neighbor={...motive('price','personal'),name:'Price feasibility',definition:'Material affordability only; not pleasure.',human_locked:true,sample:samples('price')[0]};
  const review=buildSignalStudyContrastReviewV1({study,motives:[{...m,sample:samples()[0]},neighbor],affected_keys:[m.key]});
  const payload=JSON.parse(JSON.parse(review.request_body).messages[0].content).untrusted_data;
  assert.deepEqual(payload.neighbor_context,[{key:neighbor.key,name:neighbor.name,definition:neighbor.definition,human_locked:true}]);
  assert.equal(payload.motives.length,1);assert.equal(review.source_samples.length,1);
  const output={contract_version:'signal-study-contrast-output-v1',input_digest:review.input_digest,definitions:[{key:neighbor.key,
    name:'Changed neighbor',definition:'An unauthorized new definition.',contrast_reason:'Must not change this context.',evidence_root_ids:[review.source_samples[0]!.rows[0]!.root_id]}]};
  assert.throws(()=>validateSignalStudyContrastReviewV1(review,output),/contrast_scope_invalid/);
});
test('verbatims verify original bytes before redacting handles and private names and require source provenance',()=>{
  const original=root(1),quote='I enjoy it with @fixture and Private Fixture.';
  const verified=verifySignalStudyVerbatimV1(original,quote);assert.equal(verified.display_text,'I enjoy it with [usuario] and [persona].');assert.equal(verified.redacted,true);
  assert.equal(verified.literal_sha256,'sha256:'+createHash('sha256').update(quote).digest('hex'));assert.equal(verified.channel,'forum');
  assert.throws(()=>verifySignalStudyVerbatimV1(original,'I enjoyed it'),/not_literal/);
  assert.throws(()=>verifySignalStudyVerbatimV1({...original,source_url:'javascript:alert(1)'},quote),/source_invalid/);
});
test('deterministic output reports category, competitor, irony and tensions separately with local-date/channel/topic intersections',()=>{
  const roots=[root(0),root(1,'barrier','competitor_brand'),root(2,'mixed'),root(3,'barrier','category','figurative_or_ironic'),root(4,'none')],m=motive();
  const memberships=roots.map(r=>({root_id:r.root_id,motive_key:m.key,probability:.9,source:'jev' as const,human_locked:false}));
  const census={cut_root_ids:roots.map(r=>r.root_id),unresolved_root_ids:[]};
  const output=buildSignalStudySummaryV1({study,roots,motives:[m],memberships,...census});
  assert.equal(output.status,'directional');assert.equal(output.denominator,5);assert.equal(output.subject_direction.trigger,1);assert.equal(output.competitor_direction.barrier,1);
  assert.equal(output.figurative_or_ironic,1);assert.equal(output.motives[0]!.mentions,3);assert.equal(output.motives[0]!.mixed,1);
  assert.equal(output.layers[0]!.mentions,2,'competitor is not a category layer signal');
  assert.equal(output.motive_by_topic.reduce((sum,row)=>sum+row.mentions,0),3,'duplicate listening topic does not duplicate its root');
  assert.equal(output.motive_by_topic.find(row=>row.aggregate==='subject')!.mentions,2);
  assert.equal(output.series[0]!.date,'2026-01-31');assert.equal(output.motive_by_channel.reduce((n,row)=>n+row.mentions,0),3);
  assert.throws(()=>buildSignalStudySummaryV1({study,roots,motives:[m],memberships:[...memberships,memberships[0]!],...census}),/membership_invalid/);
  assert.throws(()=>buildSignalStudySummaryV1({study,roots,motives:[m],memberships,...census,cut_root_ids:[...census.cut_root_ids,id(999)]}),/coverage_incomplete/);
  const partial=buildSignalStudySummaryV1({study,roots,motives:[m],memberships,cut_root_ids:[...census.cut_root_ids,id(999)],unresolved_root_ids:[id(999)]});
  assert.equal(partial.denominator,6);assert.equal(partial.unresolved_axes,1);assert.equal(partial.motives[0]!.share_of_cut,.5);
});
test('direction balance excludes figurative and other uses without erasing their original axis distribution',()=>{
  const roots=[root(0,'trigger'),root(1,'barrier','category','figurative_or_ironic'),root(2,'mixed','category','other')];
  const output=buildSignalStudySummaryV1({study,roots,motives:[],memberships:[],cut_root_ids:roots.map(r=>r.root_id),unresolved_root_ids:[]});
  assert.deepEqual(output.direction,{trigger:1,barrier:0,mixed:0,none:0});
  assert.deepEqual(output.axes_raw_direction,{trigger:1,barrier:1,mixed:1,none:0});
  assert.equal(output.figurative_or_ironic,1);assert.equal(output.other_use,1);assert.equal(output.denominator,3);
});
test('query bias carries an actual brand baseline and promotion requires an explicit action with revision, never mutating BrandOS',()=>{
  assert.equal(signalStudyQueryBiasV1({query_terms:['problem'],problem_terms:['problem'],subject_roots:20,brand_baseline_roots:200}).base_ratio,.1);
  assert.equal(signalStudyQueryBiasV1({query_terms:['problem'],problem_terms:['problem'],subject_roots:20,brand_baseline_roots:200}).status,'possible_query_bias');
  assert.equal(signalStudyQueryBiasV1({query_terms:[],problem_terms:[],subject_roots:0,brand_baseline_roots:0}).base_ratio,null);
  assert.throws(()=>signalStudyPromotionProposalV1({study,motive:motive(),explicit_action:false,target_revision:1}),/explicit_action_required/);
  const localization={original_language:'en',original:{name:motive().name,definition:motive().definition},en:{name:'Enjoyment',definition:'Pleasure as a reason for the choice.'},es:{name:'Disfrute',definition:'Placer como motivo de la elección.'}};
  assert.throws(()=>signalStudyPromotionProposalV1({study,motive:motive(),explicit_action:true,target_revision:8}),/localization_required/);
  assert.throws(()=>signalStudyPromotionProposalV1({study,motive:motive(),explicit_action:true,target_revision:8,localization:{...localization,original:{...localization.original,definition:'Forged original'}}}),/original_mismatch/);
  const proposal=signalStudyPromotionProposalV1({study,motive:motive(),explicit_action:true,target_revision:8,localization});
  assert.deepEqual(proposal.question.localization,localization);
  assert.equal(proposal.target_revision,8);assert.equal(proposal.question.topic_source,'defined');assert.equal(proposal.question.human_locked,true);
  assert.equal(base.questions.length,2);
});

test('query bias stays unknown without acquisition metadata and distinguishes explicitly declared empty vocabularies',()=>{
 const counts={subject_roots:0,brand_baseline_roots:0};
 assert.equal(signalStudyQueryBiasV1({...counts,query_terms:[],problem_terms:[]}).status,'unknown_query_metadata');
 assert.equal(signalStudyQueryBiasV1({...counts,query_terms:['tea'],problem_terms:[]}).status,'unknown_query_metadata');
 assert.equal(signalStudyQueryBiasV1({...counts,query_terms:['tea'],problem_terms:['problem'],metadata:{query_terms_declared:false,problem_terms_declared:true}}).status,'unknown_query_metadata');
 assert.equal(signalStudyQueryBiasV1({...counts,query_terms:['tea'],problem_terms:[],metadata:{query_terms_declared:true,problem_terms_declared:true}}).status,'query_not_problem_selected');
 assert.equal(signalStudyQueryBiasV1({...counts,query_terms:['problem'],problem_terms:['problem']}).status,'possible_query_bias');
});

test('original URL publishability is canonical and does not alter roots, axes, sampling IDs or denominators',()=>{
 const urls=['https://example.invalid/p','http://example.invalid/p','','  ','not a URL','ftp://example.invalid/p','https://fixture:placeholder@example.invalid/p'];
 assert.deepEqual(urls.map(signalStudySourceUrlStateV1),['valid','valid','missing','missing','invalid','invalid','invalid']);
 const roots=Array.from({length:100},(_,i)=>root(i)),mixed=roots.map((r,i)=>({...r,source_url:urls[i%urls.length]!}));
 const args={study_digest:digest(study),group_key:'enjoyment',centroid:signalStudyConfirmedCentroidV1(roots),seed:'same-frozen-seed'};
 const original=sampleSignalStudyGroupV1({...args,roots}),changed=sampleSignalStudyGroupV1({...args,roots:mixed});
 assert.equal(buildSignalStudyMotivePopulationV1(mixed).population_digest,buildSignalStudyMotivePopulationV1(roots).population_digest);
 for(const pass of[0,1]as const){const a=original[pass],b=changed[pass];
  assert.deepEqual(b.rows.map(({evidence_publishable,...row})=>row),a.rows.map(({evidence_publishable,...row})=>row));
  assert.deepEqual(b.sampling_policy,a.sampling_policy);assert.equal(b.population_count,100);assert.equal(b.random_count,35);assert.equal(b.far_count,5);
  assert.equal(b.independence,a.independence);assert.equal(b.insufficient_sample,a.insufficient_sample);assert.notEqual(b.sample_digest,a.sample_digest);
  const before=layerReview(a),after=layerReview(b);assert.notEqual(after.input_digest,before.input_digest);assert.notEqual(after.request_digest,before.request_digest);
  const body=JSON.parse(after.request_body);assert.equal(body.model,'claude-sonnet-4-6');assert.equal(body.max_tokens,32768);
  for(const row of b.rows)assert.equal(row.evidence_publishable,signalStudyEvidencePublishableV1(mixed.find(r=>r.root_id===row.root_id)!));
 }
 const invalid=mixed.find(r=>!signalStudyEvidencePublishableV1(r))!;
 assert.throws(()=>verifySignalStudyVerbatimV1(invalid,'I enjoy it'),/source_invalid/);
});

test('layer schema and parser allow literal quotes only from publishable original rows while diagnosing the entire sample',()=>{
 const roots=Array.from({length:100},(_,i)=>({...root(i),source_url:i%2?'https://example.invalid/p/'+i:''}));
 const [sample]=sampleSignalStudyGroupV1({study_digest:digest(study),group_key:'enjoyment',roots,centroid:signalStudyConfirmedCentroidV1(roots),seed:'publishability-mixed'});
 const review=layerReview(sample),body=JSON.parse(review.request_body),payload=JSON.parse(body.messages[0].content).untrusted_data;
 const pub=sample.rows.filter(r=>r.evidence_publishable),unpub=sample.rows.filter(r=>!r.evidence_publishable);assert.ok(pub.length&&unpub.length);
 assert.deepEqual(payload.motives[0].sample,sample.rows);assert.match(body.system,/ALL supplied sample rows/);assert.match(body.system,/OWN partition/);
 const wire=body.output_config.format.schema.properties.motives.items.properties.partitions.items.properties;
 assert.deepEqual(wire.evidence.anyOf[0].properties.root_id.enum,pub.map(r=>r.root_id).sort());
 assert.deepEqual(wire.normative_evidence.anyOf[0].properties.root_id.enum,pub.map(r=>r.root_id).sort());
 const output=layerOutput(review),partition=output.motives[0]!.partitions[0]!;
 partition.evidence.root_id=unpub[0]!.root_id;assert.throws(()=>validateSignalStudyLayerReviewV1(review,output),/evidence_not_literal/);
 partition.evidence.root_id=pub[0]!.root_id;assert.equal(validateSignalStudyLayerReviewV1(review,output).motives[0]!.partitions[0]!.layer,'psychological');
 const cultural=layerOutput(review,'cultural');cultural.motives[0]!.partitions[0]!.evidence.root_id=pub[0]!.root_id;
 cultural.motives[0]!.partitions[0]!.normative_evidence!.root_id=unpub[0]!.root_id;
 assert.throws(()=>validateSignalStudyLayerReviewV1(review,cultural),/evidence_not_literal/);
 const basePartition=output.motives[0]!.partitions[0]!;
 const split={...output,motives:[{motive_key:'enjoyment',partitions:[
  {...basePartition,key:'unpublishable',sample_root_ids:unpub.map(r=>r.root_id),evidence:{root_id:pub[0]!.root_id,quote:'I enjoy it',private_person_names:[]}},
  {...basePartition,key:'publishable',sample_root_ids:pub.map(r=>r.root_id)},
 ]}]};
 assert.throws(()=>validateSignalStudyLayerReviewV1(review,split),/evidence_not_literal/,'publishable root in another partition is not usable proof');
 const validSplit={...split,motives:[{...split.motives[0]!,partitions:split.motives[0]!.partitions.map(p=>p.key==='unpublishable'?{...p,evidence:null,layer:'unclear'}:p)}]};
 const result=validateSignalStudyLayerReviewV1(review,validSplit);assert.equal(result.motives[0]!.partitions[0]!.layer,'unclear');
 assert.equal(result.motives[0]!.partitions.reduce((n,p)=>n+p.sample_root_ids.length,0),sample.rows.length);
 assert.equal(result.motives[0]!.partitions[0]!.diagnostics.length,4);
});

test('zero publishable rows use null-only quote schema and preserve an unclear full-population blind assessment',()=>{
 const roots=Array.from({length:100},(_,i)=>({...root(i),source_url:''}));
 const pair=sampleSignalStudyGroupV1({study_digest:digest(study),group_key:'enjoyment',roots,centroid:signalStudyConfirmedCentroidV1(roots),seed:'no-url'});
 const decisions=pair.map(sample=>{const review=layerReview(sample),body=JSON.parse(review.request_body);
  const wire=body.output_config.format.schema.properties.motives.items.properties.partitions.items.properties;
  assert.deepEqual(wire.evidence,{type:'null'});assert.deepEqual(wire.normative_evidence,{type:'null'});
  assert.ok(!JSON.stringify(body.output_config).includes('"enum":[]'));
  const output=layerOutput(review),p=output.motives[0]!.partitions[0]!;
  return validateSignalStudyLayerReviewV1(review,{...output,motives:[{...output.motives[0]!,partitions:[{...p,evidence:null,normative_evidence:null}]}]});
 });
 assert.ok(decisions.every(d=>d.motives[0]!.partitions[0]!.layer==='unclear'&&d.motives[0]!.partitions[0]!.permission==='no_permission'));
 const stability=signalStudyLayerStabilityV1(decisions[0]!,decisions[1]!);assert.equal(stability.kappa,null);assert.notEqual(stability.action,'stable');
 const sample=pair[0],missing={...sample,rows:sample.rows.map(({evidence_publishable,...row})=>row)};const {sample_digest,...rest}=missing;
 assert.throws(()=>layerReview({...rest,sample_digest:digest(rest)}as SignalStudySampleV1),/sample_invalid/);
});
