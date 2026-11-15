import {createHash} from 'node:crypto';
import {signalWorkspaceEmbeddingDigestV1 as digest} from './signal-workspace-embeddings-v1';
import {labelerDigestV1,type LabelerIdentity} from './signal-mention-labeler-v1';
import {validateSignalListeningConfigurationV1,signalListeningJevIdentityV1,type SignalListeningConfigurationV1} from './signal-listening-contracts';
import {validateSignalStudyExecutionConfigurationV1,type SignalStudyExecutionConfigurationV1} from './signal-study-configuration';
import type {JevRequestV1} from './signal-mention-facets-jev-v1';
export type SignalStudyJevPlanV1={contract_version:'signal-study-jev-batch-v1';execution_id:string;workspace_id:string;source_digest:string;
 stage:string;model:'jev-1.13.0';requests:Array<{root_id:string;request_body:string;request_sha256:string}>;plan_digest:string};
export type SignalStudyJevPlanHeaderV1=Omit<SignalStudyJevPlanV1,'contract_version'|'requests'>&{contract_version:'signal-study-jev-plan-header-v1';request_count:number};
export type SignalStudyJevBindingV1={contract_version:'signal-study-jev-native-binding-v1';scope:'study';batch_id:string;run_id:string;actor_user_id:string;
 configuration:SignalStudyExecutionConfigurationV1;stage_configuration:SignalListeningConfigurationV1;plan:SignalStudyJevPlanHeaderV1;
 human_revision_digest:string;policy_version_id:string;entity_context_digest:string;
 stage_checkpoint:{id:string;digest:string};labeler_digest:string};
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu,hash=/^sha256:[a-f0-9]{64}$/u;
const bytesDigest=(body:string)=>'sha256:'+createHash('sha256').update(body).digest('hex');
function fail():never{throw Error('study_jev_binding_invalid');}
/** Internal compiler data only. Neither this return value nor its base questions
 * is published or sent as a replacement Listening configuration. */
export function signalStudyJevAxesConfigurationV1(value:SignalStudyExecutionConfigurationV1):SignalListeningConfigurationV1{
 const c=validateSignalStudyExecutionConfigurationV1(value),base=structuredClone(c.source_listening.configuration);
 const configuration={...base,retired_question_keys:[],retired_theme_keys:[],themes:[],instructions:c.question_configuration.instructions,
  questions:[...base.questions.filter(q=>['voice','promotion'].includes(q.key)),...c.question_configuration.questions.map(q=>({...q,scope:'all' as const}))]};
 validateSignalListeningConfigurationV1(configuration);return configuration;
}
export function signalStudyJevTargetDigestV1(value:SignalStudyExecutionConfigurationV1){
 const c=validateSignalStudyExecutionConfigurationV1(value);return digest({scope:'study',subject:c.study.subject});
}
export function signalStudyJevIdentityV1(binding:Omit<SignalStudyJevBindingV1,'labeler_digest'>):LabelerIdentity{
 const c=validateSignalStudyExecutionConfigurationV1(binding.configuration),stage=binding.stage_configuration;
 validateSignalListeningConfigurationV1(stage);
 return{kind:'mass_labeling',provider:'typesafe',model:stage.model,prompt_digest:digest(stage),
  schema_digest:digest({contract_version:'study-jev-batch-v1',answers:'study-question-identity-cache-v1'}),
  params:{request_version:'study-jev-batch-v1',scope:'study',configuration:stage,configuration_digest:digest(stage),
   study_execution_id:binding.plan.execution_id,batch_id:binding.batch_id,batch_plan_digest:binding.plan.plan_digest,
   source_digest:binding.plan.source_digest,study_configuration_digest:digest(c),human_revision_digest:binding.human_revision_digest,
   target_digest:signalStudyJevTargetDigestV1(c),stage_checkpoint:binding.stage_checkpoint,policy_version_id:binding.policy_version_id,
   input_usd_per_mtok:signalListeningJevIdentityV1(stage).params.input_usd_per_mtok}};
}
export function validateSignalStudyJevBindingV1(binding:SignalStudyJevBindingV1):SignalStudyJevBindingV1{
 const c=validateSignalStudyExecutionConfigurationV1(binding.configuration),p=binding.plan,s=binding.stage_configuration;
 validateSignalListeningConfigurationV1(s);
 if(binding.contract_version!=='signal-study-jev-native-binding-v1'||binding.scope!=='study'||!uuid.test(binding.batch_id)||!uuid.test(binding.run_id)||!uuid.test(binding.actor_user_id)
  ||!uuid.test(p.execution_id)||p.workspace_id!==c.study.workspace_id||!uuid.test(binding.policy_version_id)||!uuid.test(binding.stage_checkpoint.id)
  ||!hash.test(binding.stage_checkpoint.digest)||!hash.test(binding.human_revision_digest)||!hash.test(binding.entity_context_digest)
  ||p.contract_version!=='signal-study-jev-plan-header-v1'||p.model!=='jev-1.13.0'||!hash.test(p.source_digest)
  ||!['axes','membership','dominance_membership'].includes(p.stage)||!Number.isSafeInteger(p.request_count)||p.request_count<1||!hash.test(p.plan_digest))fail();
 if(binding.labeler_digest!==labelerDigestV1(signalStudyJevIdentityV1(binding)))fail();
 if(p.stage==='axes'&&digest(s)!==digest(signalStudyJevAxesConfigurationV1(c)))fail();
 return binding;
}

export function signalStudyJevQuestionDigestV1(binding:SignalStudyJevBindingV1,key:string){
 const q=binding.stage_configuration.questions.find(q=>q.key===key);if(!q||['voice','promotion'].includes(key))fail();
 const wire=q.type==='choice'?{type:q.type,text:q.text,criteria:Object.fromEntries(q.options.map(o=>[o.key,o.definition]))}:{type:q.type,text:q.text,positive:q.positive,negative:q.negative};
 return digest({contract_version:'study-jev-question-v1',scope:'study',model:binding.plan.model,target_digest:signalStudyJevTargetDigestV1(binding.configuration),
  key,instructions:binding.stage_configuration.instructions,question:wire});
}

/** The adapter supplies ONLY members joined to this immutable native plan. The
 * driver's verification is deliberately per bounded input, not a corpus roster. */
export function validateSignalStudyJevRequestV1(binding:SignalStudyJevBindingV1,row:SignalStudyJevPlanV1['requests'][number]):JevRequestV1{
 const p=binding.plan,s=binding.stage_configuration;
  if(!row.root_id||bytesDigest(row.request_body)!==row.request_sha256)fail();
  let request:JevRequestV1;try{request=JSON.parse(row.request_body);}catch{return fail();}
  if(JSON.stringify(request)!==row.request_body||request.model!==p.model||typeof request.state!=='string'||!request.state.trim()
   ||Object.keys(request).sort().join(',')!=='model,questions,state'||!Object.keys(request.questions).length||Object.keys(request.questions).length>(p.stage==='axes'?3:4))fail();
  for(const [key,q]of Object.entries(request.questions)){
   const saved=s.questions.find(q=>q.key===key);
   if(!saved||['voice','promotion'].includes(key)||saved.scope!=='all'||saved.origin==='base'
    ||p.stage!=='axes'&&saved.type!=='noul')fail();
   const expected=saved.type==='choice'?{type:'choice',instructions:{rules:s.instructions,question:saved.text},criteria:Object.fromEntries(saved.options.map(o=>[o.key,o.definition]))}
    :{type:'noul',instructions:{rules:s.instructions,question:saved.text},criteria:{true:saved.positive,false:saved.negative}};
   if(digest(q)!==digest(expected))fail();
  }

 return JSON.parse(row.request_body) as JevRequestV1;
}
