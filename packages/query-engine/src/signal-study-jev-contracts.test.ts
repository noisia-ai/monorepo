import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {SIGNAL_STUDY_TB_TEMPLATE_V1,SIGNAL_STUDY_TB_ROLES_V1,createSignalStudyTemplateSnapshotV1} from './signal-study-template-data';
import {buildSignalStudyExecutionConfigurationV1,buildSignalStudyConfiguredAxesRequestV1} from './signal-study-configuration';
import {signalListeningBaseTemplateV1} from './signal-listening-contracts';
import {signalStudyJevAxesConfigurationV1,signalStudyJevMotiveConfigurationV1,signalStudyJevIdentityV1,signalStudyJevQuestionDigestV1,validateSignalStudyJevBindingV1,validateSignalStudyJevRequestV1,type SignalStudyJevBindingV1} from './signal-study-jev-contracts';
import {labelerDigestV1} from './signal-mention-labeler-v1';
import {signalWorkspaceEmbeddingDigestV1 as digest} from './signal-workspace-embeddings-v1';
import type {SignalStudyV1} from './signal-study-contracts';
const sha=(text:string)=>'sha256:'+createHash('sha256').update(text).digest('hex');
function fixture(){
 const workspace_id=randomUUID(),listening=signalListeningBaseTemplateV1({category:'synthetic tea',lexicon_terms:['tea']});
 listening.retired_question_keys=['study_direction']; // Listening retirement is not the Study namespace.
 const template={...structuredClone(SIGNAL_STUDY_TB_TEMPLATE_V1),version:'saved-stage-v2',instructions:'  Saved café ☕ wording  '};
 const snapshot=createSignalStudyTemplateSnapshotV1({template,roles:SIGNAL_STUDY_TB_ROLES_V1,provenance:'human',revision:2,human_locked:true});
 const study:SignalStudyV1={contract_version:'signal-study-v1',workspace_id,corpus_id:randomUUID(),listening_configuration_id:randomUUID(),listening_configuration_digest:digest(listening),methodology:{key:'triggers_barriers',version:template.version,template_digest:snapshot.template_digest},
  subject:{kind:'category',name:'synthetic tea',category:'synthetic tea',own_brand:'Synthetic',competitors:[],alternatives:[]},business_question:'Synthetic forces?',cut:{start_at:'2026-01-01T00:00:00Z',end_at:'2027-01-01T00:00:00Z',timezone:'UTC',voice:'individual',promotion_max:.7,exclude_hashtag_only:true,require_category_lexicon:true,filters:{}},provenance:'human',revision:2};
 const configuration=buildSignalStudyExecutionConfigurationV1({study,template_snapshot:snapshot,source_listening:{configuration_id:study.listening_configuration_id,configuration_digest:study.listening_configuration_digest,configuration:listening}});
 const stage_configuration=signalStudyJevAxesConfigurationV1(configuration),request=buildSignalStudyConfiguredAxesRequestV1({text:'I enjoy tea ☕'},configuration),request_body=JSON.stringify(request);
 const binding:SignalStudyJevBindingV1={contract_version:'signal-study-jev-native-binding-v1',scope:'study',batch_id:randomUUID(),run_id:randomUUID(),actor_user_id:randomUUID(),configuration,stage_configuration,
  plan:{contract_version:'signal-study-jev-plan-header-v1',execution_id:randomUUID(),workspace_id,source_digest:digest('source'),stage:'axes',model:'jev-1.13.0',stage_configuration_digest:digest(stage_configuration),stage_dependencies:[],request_count:1,plan_digest:digest('sealed-native-plan')},
  human_revision_digest:digest('human'),policy_version_id:randomUUID(),entity_context_digest:digest('context'),stage_checkpoint:{id:randomUUID(),digest:digest('native-stage')},labeler_digest:''};
 binding.labeler_digest=labelerDigestV1(signalStudyJevIdentityV1(binding));return{binding,listening,row:{root_id:randomUUID(),request_body,request_sha256:sha(request_body)}};
}
test('Study compiler data preserves the explicit saved text and original Listening independently',()=>{
 const f=fixture(),source=digest(f.binding.configuration.source_listening.configuration);assert.equal(validateSignalStudyJevBindingV1(f.binding),f.binding);
 assert.equal(f.binding.stage_configuration.instructions,'  Saved café ☕ wording  ');assert.equal(f.binding.stage_configuration.questions.length,5);
 assert.deepEqual(f.binding.stage_configuration.retired_question_keys,[]);assert.deepEqual(f.binding.configuration.source_listening.configuration.retired_question_keys,['study_direction']);
 assert.equal(digest(f.listening),source);assert.equal(JSON.stringify(validateSignalStudyJevRequestV1(f.binding,f.row)),f.row.request_body);
 assert.equal('requests'in f.binding.plan,false);
});
test('scope, saved axes, exact byte digest and no-base requests are checked independently of native owner authority',()=>{
 const f=fixture();for(const edit of [(b:SignalStudyJevBindingV1)=>{b.scope='listening' as never;},(b:SignalStudyJevBindingV1)=>{b.plan.source_digest='invalid';},
  (b:SignalStudyJevBindingV1)=>{b.stage_configuration.instructions='Defaults';},(b:SignalStudyJevBindingV1)=>{b.plan.request_count=0;}]){
  const b=structuredClone(f.binding);edit(b);b.labeler_digest=labelerDigestV1(signalStudyJevIdentityV1(b));assert.throws(()=>validateSignalStudyJevBindingV1(b),/binding_invalid/);
 }
 assert.throws(()=>validateSignalStudyJevRequestV1(f.binding,{...f.row,request_sha256:digest('wrong-bytes')}),/binding_invalid/);
 const request=JSON.parse(f.row.request_body);request.questions.voice=request.questions.study_direction;const body=JSON.stringify(request);
 assert.throws(()=>validateSignalStudyJevRequestV1(f.binding,{...f.row,request_body:body,request_sha256:sha(body)}),/binding_invalid/);
});
test('question cache digest uses exact model/question/target semantics, not unrelated provenance metadata',()=>{
 const {binding}=fixture(),key='study_direction',before=signalStudyJevQuestionDigestV1(binding,key),changed=structuredClone(binding);
 changed.stage_configuration.questions.find(q=>q.key===key)!.human_locked=false;
 assert.equal(signalStudyJevQuestionDigestV1(changed,key),before);
 const question=changed.stage_configuration.questions.find(q=>q.key===key)!;if(question.type==='choice')question.options.reverse();assert.equal(signalStudyJevQuestionDigestV1(changed,key),before);
 changed.stage_configuration.instructions+=' Changed rule';assert.notEqual(signalStudyJevQuestionDigestV1(changed,key),before);
});
test('internal motive namespace avoids Listening retirement and axes keys without changing the frozen source',()=>{
 const {binding}=fixture(),source=digest(binding.configuration.source_listening);
 const config=signalStudyJevMotiveConfigurationV1(binding.configuration,[{key:'study_direction',name:'Saved motive',definition:'Saved motive definition',
  centroid:Array.from({length:1024},(_,i)=>i?0:1),layer:'unclear',human_locked:true}]);
 assert.deepEqual(config.questions.map(q=>q.key).sort(),['promotion','study_direction','voice']);
 assert.equal(config.questions.find(q=>q.key==='study_direction')!.type,'noul');assert.equal(digest(binding.configuration.source_listening),source);
 assert.equal(config.instructions,binding.configuration.source_listening.configuration.instructions);
});
