import{z}from'zod';
import{signalWorkspaceEmbeddingDigestV1 as digest}from'./signal-workspace-embeddings-v1';
import{validateSignalStudyV1,interpolateSignalStudyTemplateTextV1,signalStudyCutV1,resolveSignalStudyAxesV1,
 type SignalStudyV1,type SignalStudyAxesV1}from'./signal-study-contracts';
import{assertSignalStudyTbTemplateV1,freezeSignalStudyDataV1,signalStudyTemplateSnapshotSchemaV1,
 type SignalStudyTemplateSnapshotV1}from'./signal-study-template-data';
import{validateSignalListeningConfigurationV1,type SignalListeningConfigurationV1}from'./signal-listening-contracts';
import type{JevRequestV1,JevAnswerV1}from'./signal-mention-facets-jev-v1';
const key=z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),hash=z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const text=(max:number)=>z.string().min(1).max(max).refine(value=>Boolean(value.trim()));
const question=z.discriminatedUnion('type',[
 z.object({key,type:z.literal('choice'),text:text(1600),options:z.array(z.object({key,definition:text(1600)}).strict()).min(2).max(32),
  origin:z.enum(['methodology','brand_os','agent']),human_locked:z.boolean()}).strict(),
 z.object({key,type:z.literal('noul'),text:text(1600),positive:text(1600),negative:text(1600),
  origin:z.enum(['methodology','brand_os','agent']),human_locked:z.boolean()}).strict(),
]);
export const signalStudyScopedQuestionsSchemaV1=z.object({contract_version:z.literal('signal-study-scoped-questions-v1'),scope:z.literal('study'),stage:key,
 study_digest:hash,template_digest:hash,roles:z.record(key,key),roles_digest:hash,model:z.literal('jev-1.13.0'),instructions:text(2000),
 questions:z.array(question).min(1).max(256),revision:z.number().int().positive(),provenance:z.enum(['human','agent']),human_locked:z.boolean()}).strict();
export type SignalStudyScopedQuestionsV1=z.infer<typeof signalStudyScopedQuestionsSchemaV1>;
const envelope=z.object({contract_version:z.literal('signal-study-execution-configuration-v1'),executor_contract:z.literal('triggers-barriers-r16-v1'),
 study:z.unknown(),study_digest:hash,template_snapshot:signalStudyTemplateSnapshotSchemaV1,
 source_listening:z.object({configuration_id:z.string().uuid(),configuration_digest:hash,configuration:z.unknown()}).strict(),
 question_configuration:signalStudyScopedQuestionsSchemaV1,question_configuration_digest:hash}).strict();
export type SignalStudyExecutionConfigurationV1=Omit<z.infer<typeof envelope>,'study'|'source_listening'>&{
 study:SignalStudyV1;source_listening:{configuration_id:string;configuration_digest:string;configuration:SignalListeningConfigurationV1}};
function fail(reason:string):never{throw Error('study_configuration_'+reason);}
export function validateSignalStudyExecutionConfigurationV1(value:unknown):SignalStudyExecutionConfigurationV1{
 const parsed=envelope.safeParse(value);if(!parsed.success)fail('invalid');const e=parsed.data;
 const snapshot=assertSignalStudyTbTemplateV1(e.template_snapshot),study=validateSignalStudyV1(e.study,snapshot),q=e.question_configuration;
 validateSignalListeningConfigurationV1(e.source_listening.configuration);
 const original=e.source_listening.configuration as SignalListeningConfigurationV1;
 if(digest(e.study)!==e.study_digest||digest(study)!==e.study_digest||e.source_listening.configuration_id!==study.listening_configuration_id
  ||e.source_listening.configuration_digest!==study.listening_configuration_digest||digest(original)!==study.listening_configuration_digest
  ||original.category!==study.subject.category||digest(q)!==e.question_configuration_digest||q.study_digest!==e.study_digest
  ||q.template_digest!==snapshot.template_digest||q.roles_digest!==snapshot.roles_digest||digest(q.roles)!==q.roles_digest
  ||digest(q.roles)!==digest(snapshot.roles)||q.model!==snapshot.template.model||q.stage!=='axes'||q.questions.length!==3)fail('binding_invalid');
 const keys=new Set(q.questions.map(question=>question.key));
 if(keys.size!==q.questions.length||q.questions.some(q=>['voice','promotion'].includes(q.key))
  ||Object.values(q.roles).some(key=>!keys.has(key)))fail('roles_invalid');
 for(const role of ['direction','target','use']){
  const expected=snapshot.template.questions.find(question=>question.key===snapshot.roles[role]),actual=q.questions.find(question=>question.key===q.roles[role]);
  if(expected?.type!=='choice'||actual?.type!=='choice'||actual.options.map(o=>o.key).sort().join(',')!==expected.options.map(o=>o.key).sort().join(','))fail('roles_invalid');
 }
 // Preserve the source object exactly. Parsing Listening validates it but never
 // substitutes a freshly generated base or changes its frozen wording.
 return freezeSignalStudyDataV1({...e,study,template_snapshot:snapshot,source_listening:{...e.source_listening,configuration:structuredClone(original)}});
}
/** Materialize once from Brand OS data, then persist this entire envelope.
 * Subsequent requests consume its frozen questions rather than regenerating. */
export function buildSignalStudyExecutionConfigurationV1(args:{study:SignalStudyV1;template_snapshot:SignalStudyTemplateSnapshotV1;
 source_listening:{configuration_id:string;configuration_digest:string;configuration:SignalListeningConfigurationV1}}):SignalStudyExecutionConfigurationV1{
 const snapshot=assertSignalStudyTbTemplateV1(args.template_snapshot),study=validateSignalStudyV1(args.study,snapshot),study_digest=digest(study);
 const q:SignalStudyScopedQuestionsV1={contract_version:'signal-study-scoped-questions-v1',scope:'study',stage:'axes',study_digest,
  template_digest:snapshot.template_digest,roles:structuredClone(snapshot.roles),roles_digest:snapshot.roles_digest,model:snapshot.template.model,
  instructions:interpolateSignalStudyTemplateTextV1(snapshot.template.instructions,study.subject),
  questions:snapshot.template.questions.map(question=>{
   const common={key:question.key,text:interpolateSignalStudyTemplateTextV1(question.text,study.subject),origin:'methodology' as const,
    human_locked:snapshot.human_locked||question.human_locked===true};
   return question.type==='choice'?{...common,type:'choice' as const,options:question.options.map(o=>({key:o.key,definition:interpolateSignalStudyTemplateTextV1(o.definition,study.subject)}))}
    :{...common,type:'noul' as const,positive:interpolateSignalStudyTemplateTextV1(question.positive,study.subject),negative:interpolateSignalStudyTemplateTextV1(question.negative,study.subject)};
  }),
  revision:1,provenance:snapshot.provenance,human_locked:snapshot.human_locked};
 return validateSignalStudyExecutionConfigurationV1({contract_version:'signal-study-execution-configuration-v1',executor_contract:'triggers-barriers-r16-v1',
  study,study_digest,template_snapshot:snapshot,source_listening:structuredClone(args.source_listening),question_configuration:q,question_configuration_digest:digest(q)});
}
export function buildSignalStudyConfiguredAxesRequestV1(input:{text:string},value:SignalStudyExecutionConfigurationV1):JevRequestV1{
 const e=validateSignalStudyExecutionConfigurationV1(value),q=e.question_configuration;if(!input.text.trim())fail('input_invalid');
 return{model:q.model,state:input.text,questions:Object.fromEntries(Object.values(q.roles).sort().map(key=>{
  const configured=q.questions.find(q=>q.key===key)!;if(configured.type!=='choice')return fail('roles_invalid');
  return[key,{type:'choice' as const,instructions:{rules:q.instructions,question:configured.text},criteria:Object.fromEntries(configured.options.map(o=>[o.key,o.definition]))}];
 }))};
}
export function resolveSignalStudyConfiguredAxesV1(value:SignalStudyExecutionConfigurationV1,answers:Record<string,JevAnswerV1>):SignalStudyAxesV1{
 const e=validateSignalStudyExecutionConfigurationV1(value),roles=e.question_configuration.roles;
 if(Object.keys(answers).sort().join(',')!==Object.values(roles).sort().join(','))fail('axes_response_keys_invalid');
 return resolveSignalStudyAxesV1(e.study.subject,{study_direction:answers[roles.direction!]!,study_target:answers[roles.target!]!,study_use:answers[roles.use!]!});
}
export function signalStudyConfiguredCutV1(args:{configuration:SignalStudyExecutionConfigurationV1;text:string;occurred_at:string;
 answers:Record<string,JevAnswerV1>;attributes?:Record<string,string[]>}){
 const e=validateSignalStudyExecutionConfigurationV1(args.configuration);
 return signalStudyCutV1({study:e.study,template_snapshot:e.template_snapshot,listening:e.source_listening.configuration,text:args.text,
  occurred_at:args.occurred_at,answers:args.answers,attributes:args.attributes});
}
/** History-aware checks belong in native CAS too. These data checks prevent an
 * agent proposal from replacing a human revision before it reaches persistence. */
export function assertSignalStudyConfigurationRevisionV1(args:{current:SignalStudyExecutionConfigurationV1;next:SignalStudyExecutionConfigurationV1;
 actor:'human'|'agent';expected_revision:number}):SignalStudyExecutionConfigurationV1{
 const current=validateSignalStudyExecutionConfigurationV1(args.current),next=validateSignalStudyExecutionConfigurationV1(args.next),a=current.question_configuration,b=next.question_configuration;
 const definition=(study:SignalStudyV1)=>{const{revision:_revision,provenance:_provenance,...body}=study;return body;};
 if(args.expected_revision!==a.revision||b.revision!==a.revision+1||b.provenance!==args.actor||next.study.revision!==current.study.revision+1
  ||next.study.provenance!==args.actor||digest(definition(current.study))!==digest(definition(next.study))
  ||digest(current.source_listening)!==digest(next.source_listening)||digest(current.template_snapshot)!==digest(next.template_snapshot))fail('revision_conflict');
 if(args.actor==='agent'){
  if(a.human_locked||a.questions.some(q=>q.human_locked&&(a.instructions!==b.instructions||digest(q)!==digest(b.questions.find(n=>n.key===q.key)))))fail('human_precedence');
 }else{
  const wording=(q:SignalStudyScopedQuestionsV1['questions'][number])=>{const{human_locked:_locked,...body}=q;return body;};
  if(a.instructions!==b.instructions&&!b.human_locked||b.questions.some(q=>digest(wording(q))!==digest(wording(a.questions.find(n=>n.key===q.key)!))&&!q.human_locked))fail('human_revision_must_lock');
 }
 return next;
}
