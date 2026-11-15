import assert from'node:assert/strict';
import test from'node:test';
import{randomUUID,createHash}from'node:crypto';
import{SIGNAL_STUDY_TB_TEMPLATE_V1,SIGNAL_STUDY_TB_TEMPLATE_DIGEST_V1,SIGNAL_STUDY_TB_ROLES_V1,createSignalStudyTemplateSnapshotV1,
 validateSignalStudyTemplateSnapshotV1}from'./signal-study-template-data';
import{validateSignalStudyV1,buildSignalStudyListeningConfigurationV1,type SignalStudyV1}from'./signal-study-contracts';
import{buildSignalStudyExecutionConfigurationV1,validateSignalStudyExecutionConfigurationV1,buildSignalStudyConfiguredAxesRequestV1,
 signalStudyConfiguredCutV1,resolveSignalStudyConfiguredAxesV1,assertSignalStudyConfigurationRevisionV1,type SignalStudyExecutionConfigurationV1}from'./signal-study-configuration';
import{buildSignalStudyConfiguredLayerReviewV1,buildSignalStudyLayerReviewV1,validateSignalStudyLayerReviewV1}from'./signal-study-editorial';
import{sampleSignalStudyGroupV1,type SignalStudyRootV1}from'./signal-study-evidence';
import{signalListeningBaseTemplateV1,validateSignalListeningConfigurationV1}from'./signal-listening-contracts';
import{signalWorkspaceEmbeddingDigestV1 as digest}from'./signal-workspace-embeddings-v1';
import type{JevAnswerV1}from'./signal-mention-facets-jev-v1';
function fixture(){
 const template={...structuredClone(SIGNAL_STUDY_TB_TEMPLATE_V1)};template.version='r16-analyst-v2';template.instructions='Stored {{subject}} instructions with analyst wording.';
 const roles={direction:'saved_direction',target:'saved_target',use:'saved_use'};
 for(const q of template.questions){q.key=({study_direction:roles.direction,study_target:roles.target,study_use:roles.use}as Record<string,string>)[q.key]!;}
 template.questions[0]!.text='Saved direction wording for {{subject}}.';template.diagnostics[1]!.question='Saved monthly resource diagnostic, preserve this wording.';
 const snapshot=createSignalStudyTemplateSnapshotV1({template,roles,provenance:'agent',revision:2,human_locked:false});
 const listening=structuredClone(signalListeningBaseTemplateV1({category:'synthetic bicycles',lexicon_terms:['bicycle']}));
 listening.instructions='Exact original Listening rules supplied by the analyst.';listening.questions.find(q=>q.key==='voice')!.text='Original saved voice question.';
 listening.questions.reverse(); // The pinned original is not silently reordered.
 const study:SignalStudyV1={contract_version:'signal-study-v1',workspace_id:randomUUID(),corpus_id:randomUUID(),listening_configuration_id:randomUUID(),
  listening_configuration_digest:digest(listening),methodology:{key:'triggers_barriers',version:template.version,template_digest:snapshot.template_digest},
  subject:{kind:'category',name:'synthetic bicycles',category:'synthetic bicycles',own_brand:'Synthetic brand',competitors:['Synthetic competitor'],alternatives:['Synthetic alternative']},
  business_question:'Which configured forces move the decision?',cut:{start_at:'2026-01-01T00:00:00Z',end_at:'2027-01-01T00:00:00Z',timezone:'America/Sao_Paulo',
   voice:'individual',promotion_max:.7,exclude_hashtag_only:true,require_category_lexicon:true,filters:{}},provenance:'agent',revision:1};
 const configuration=buildSignalStudyExecutionConfigurationV1({study,template_snapshot:snapshot,
  source_listening:{configuration_id:study.listening_configuration_id,configuration_digest:study.listening_configuration_digest,configuration:listening}});
 return{template,snapshot,listening,study,configuration,roles};
}
function choice(values:string[],selected:string):JevAnswerV1{return{type:'choice',choice:selected,confidence:1,probabilities:Object.fromEntries(values.map(value=>[value,value===selected?1:0]))};}
function answers(e:SignalStudyExecutionConfigurationV1,direction='mixed',target='category',use='literal'){
 const choices={direction,target,use};return Object.fromEntries(Object.entries(e.question_configuration.roles).map(([role,key])=>{
  const q=e.question_configuration.questions.find(q=>q.key===key)!;assert.equal(q.type,'choice');
  return[key,choice(q.type==='choice'?q.options.map(o=>o.key):[],choices[role as keyof typeof choices])];
 }));
}
function revision(e:SignalStudyExecutionConfigurationV1,actor:'human'|'agent'){
 const next=structuredClone(e);next.study.revision++;next.study.provenance=actor;next.study_digest=digest(next.study);
 next.question_configuration.study_digest=next.study_digest;next.question_configuration.revision++;next.question_configuration.provenance=actor;return next;
}
function seal(e:SignalStudyExecutionConfigurationV1){e.question_configuration_digest=digest(e.question_configuration);return e;}

test('the JSON seed keeps the historical semantic digest; revised data and role bindings retain their own digests',()=>{
 assert.equal(SIGNAL_STUDY_TB_TEMPLATE_DIGEST_V1,'sha256:419f1417652af6d9d010d1f755f7a83265aeebd452300e327de0675771f76561');
 assert.equal('roles'in SIGNAL_STUDY_TB_TEMPLATE_V1,false);assert.ok(Object.isFrozen(SIGNAL_STUDY_TB_TEMPLATE_V1.questions[0]!.options));
 const f=fixture();assert.notEqual(f.snapshot.template_digest,SIGNAL_STUDY_TB_TEMPLATE_DIGEST_V1);assert.equal(f.snapshot.template_digest,digest(f.template));
 assert.equal(f.snapshot.roles_digest,digest(f.roles));assert.equal(validateSignalStudyV1(f.study,f.snapshot).methodology.version,'r16-analyst-v2');
 assert.throws(()=>validateSignalStudyV1(f.study),/study_invalid/);
 assert.equal(validateSignalStudyV1({...f.study,template_snapshot:f.snapshot}).methodology.template_digest,f.snapshot.template_digest);
 assert.throws(()=>buildSignalStudyListeningConfigurationV1({...f.study,template_snapshot:f.snapshot},['bicycle']),/explicit_configuration_required/);
 assert.throws(()=>validateSignalStudyTemplateSnapshotV1({...f.snapshot,template_digest:SIGNAL_STUDY_TB_TEMPLATE_DIGEST_V1}),/snapshot_invalid/);
 const changed=structuredClone(f.configuration);changed.template_snapshot.template.rules.kappa_min=.6;changed.template_snapshot.template_digest=digest(changed.template_snapshot.template);
 changed.study.methodology.template_digest=changed.template_snapshot.template_digest;assert.throws(()=>validateSignalStudyExecutionConfigurationV1(changed),/tb_protocol_invalid/);
});
test('new runtime requires explicit frozen data and asks only its three declared axes while preserving exact original Listening',()=>{
 const f=fixture(),e=JSON.parse(JSON.stringify(f.configuration))as SignalStudyExecutionConfigurationV1;
 assert.deepEqual(e.source_listening.configuration,f.listening);assert.equal(e.source_listening.configuration_digest,digest(f.listening));
 const request=buildSignalStudyConfiguredAxesRequestV1({text:'I enjoy this bicycle.'},e);
 assert.deepEqual(Object.keys(request.questions),Object.values(f.roles).sort());assert.equal('voice'in request.questions,false);assert.equal('promotion'in request.questions,false);
 assert.equal((request.questions[f.roles.direction]!.instructions as{question:string}).question,'Saved direction wording for synthetic bicycles.');
 assert.equal((request.questions[f.roles.direction]!.instructions as{rules:string}).rules,'Stored synthetic bicycles instructions with analyst wording.');
 const base={voice:choice(['individual','brand'],'individual'),promotion:{type:'noul' as const,noul:.1}};
 assert.equal(signalStudyConfiguredCutV1({configuration:e,text:'I enjoy a bicycle',occurred_at:'2026-02-01T00:00:00Z',answers:base}),'included');
 assert.equal(signalStudyConfiguredCutV1({configuration:e,text:'bicycle',occurred_at:'2026-02-01T00:00:00Z',answers:{}}),'awaiting_base');
 assert.equal(signalStudyConfiguredCutV1({configuration:e,text:'#bicycle',occurred_at:'2026-02-01T00:00:00Z',answers:base}),'excluded');
 assert.throws(()=>validateSignalListeningConfigurationV1(e.question_configuration),/listening_configuration_invalid/,'Study configuration cannot become latest Listening');
 const missing=structuredClone(e)as Partial<SignalStudyExecutionConfigurationV1>;delete missing.template_snapshot;
 assert.throws(()=>validateSignalStudyExecutionConfigurationV1(missing),/configuration_invalid/);
 const implicit=JSON.parse(JSON.stringify(e));delete implicit.study.cut.filters;
 assert.throws(()=>validateSignalStudyExecutionConfigurationV1(implicit),/binding_invalid/,'frozen runtime cannot add omitted defaults while reading');
 const swapped=structuredClone(e);swapped.source_listening.configuration=signalListeningBaseTemplateV1({category:f.study.subject.category,lexicon_terms:['bicycle']});
 swapped.source_listening.configuration_digest=digest(swapped.source_listening.configuration);assert.throws(()=>validateSignalStudyExecutionConfigurationV1(swapped),/binding_invalid/);
});
test('persisted human question revisions are consumed exactly and agent proposals cannot overwrite or unlock them',()=>{
 const f=fixture(),human=revision(f.configuration,'human'),direction=human.question_configuration.questions.find(q=>q.key===f.roles.direction)!;
 direction.text='Human stored wording, never regenerate.';direction.human_locked=true;if(direction.type==='choice')direction.options[0]!.definition='Human stored criterion.';seal(human);
 const saved=assertSignalStudyConfigurationRevisionV1({current:f.configuration,next:human,actor:'human',expected_revision:1});
 const wire=buildSignalStudyConfiguredAxesRequestV1({text:'A bicycle mention'},JSON.parse(JSON.stringify(saved)));
 assert.equal((wire.questions[f.roles.direction]!.instructions as{question:string}).question,direction.text);
 assert.equal(wire.questions[f.roles.direction]!.type,'choice');assert.equal((wire.questions[f.roles.direction]as{criteria:Record<string,string>}).criteria[direction.type==='choice'?direction.options[0]!.key:''], 'Human stored criterion.');
 assert.deepEqual(saved.source_listening,f.configuration.source_listening);assert.notEqual(saved.study_digest,f.configuration.study_digest);
 const agent=revision(saved,'agent');agent.question_configuration.questions.find(q=>q.key===f.roles.direction)!.text='Agent replacement';seal(agent);
 assert.throws(()=>assertSignalStudyConfigurationRevisionV1({current:saved,next:agent,actor:'agent',expected_revision:2}),/human_precedence/);
 const unlock=revision(saved,'agent');unlock.question_configuration.questions.find(q=>q.key===f.roles.direction)!.human_locked=false;seal(unlock);
 assert.throws(()=>assertSignalStudyConfigurationRevisionV1({current:saved,next:unlock,actor:'agent',expected_revision:2}),/human_precedence/);
 const globals=revision(saved,'agent');globals.question_configuration.instructions='Agent global rewrite';seal(globals);
 assert.throws(()=>assertSignalStudyConfigurationRevisionV1({current:saved,next:globals,actor:'agent',expected_revision:2}),/human_precedence/);
 assert.throws(()=>assertSignalStudyConfigurationRevisionV1({current:f.configuration,next:human,actor:'human',expected_revision:0}),/revision_conflict/);
});
test('declared persisted roles preserve mixed, competitor separation, irony and alternative inversion',()=>{
 const f=fixture();assert.equal(resolveSignalStudyConfiguredAxesV1(f.configuration,answers(f.configuration)).direction,'mixed');
 assert.equal(resolveSignalStudyConfiguredAxesV1(f.configuration,answers(f.configuration,'barrier','competitor_brand')).aggregate,'competitor');
 assert.equal(resolveSignalStudyConfiguredAxesV1(f.configuration,answers(f.configuration,'barrier','category','figurative_or_ironic')).aggregate,'figurative_or_ironic');
 const study={...f.study,subject:{...f.study.subject,kind:'alternative' as const,name:'Synthetic alternative',conventional_category:'synthetic bicycles'}};
 const e=buildSignalStudyExecutionConfigurationV1({study,template_snapshot:f.snapshot,source_listening:f.configuration.source_listening});
 const resolved=resolveSignalStudyConfiguredAxesV1(e,answers(e,'barrier'));assert.equal(resolved.direction,'trigger');assert.equal(resolved.alternative_inverted,true);
 assert.throws(()=>resolveSignalStudyConfiguredAxesV1(e,{...answers(e),voice:choice(['individual','brand'],'individual')}),/axes_response_keys_invalid/);
});
test('new layer review uses the exact saved diagnostic revision and validates against its sealed protocol',()=>{
 const f=fixture(),vector=Array.from({length:1024},(_,i)=>i===0?1:0),raw='I enjoy this bicycle, it makes me feel calm.';
 const axes=resolveSignalStudyConfiguredAxesV1(f.configuration,answers(f.configuration,'trigger'));
 const roots:SignalStudyRootV1[]=Array.from({length:3},()=>({root_id:randomUUID(),text:raw,text_sha256:'sha256:'+createHash('sha256').update(raw).digest('hex'),vector,
  axes,occurred_at:'2026-02-01T00:00:00Z',channel:'synthetic',source_url:'https://example.invalid/post',listening_topic_keys:[],private_person_names:[]}));
 const[sample]=sampleSignalStudyGroupV1({study_digest:f.configuration.study_digest,group_key:'motive',roots,centroid:vector,seed:'synthetic'});
 const args={configuration:f.configuration,pass:'a' as const,motives:[{key:'motive',name:'Comfort',definition:'Feeling comfort from use.',sample}]};
 const request=buildSignalStudyConfiguredLayerReviewV1(args),body=JSON.parse(request.request_body),payload=JSON.parse(body.messages[0].content).untrusted_data;
 assert.deepEqual(payload.diagnostics,f.snapshot.template.diagnostics);assert.equal(payload.question_configuration_digest,f.configuration.question_configuration_digest);
 assert.equal(payload.protocol_rules.kappa_min,.8);assert.doesNotMatch(body.system,/four hours PER MONTH/);
 const partition={key:'part',name:'Comfort',definition:'Psychological comfort.',sample_root_ids:sample.rows.map(r=>r.root_id),layer:'psychological',
  diagnostics:f.snapshot.template.diagnostics.map(d=>({key:d.key,result:d.layer==='psychological'?'yes':'no',force_disappears_without:d.layer==='psychological',reason:'Diagnostic applied to the supplied evidence.'})),
  evidence:{root_id:sample.rows[0]!.root_id,quote:'makes me feel calm',private_person_names:[]},normative_evidence:null,permission_override:null};
 const decision=validateSignalStudyLayerReviewV1(request,{contract_version:'signal-study-layer-output-v1',input_digest:request.input_digest,motives:[{motive_key:'motive',partitions:[partition]}]});
 assert.equal(decision.motives[0]!.partitions[0]!.permission,'movable');
 assert.throws(()=>buildSignalStudyLayerReviewV1({...args,study:{...f.study,template_snapshot:f.snapshot}}),/explicit_configuration_required/);
});
