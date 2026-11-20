import {SIGNAL_STUDY_TB_TEMPLATE_V1,SIGNAL_STUDY_TB_TEMPLATE_DIGEST_V1,signalStudyTemplateSnapshotSchemaV1,validateSignalStudyTemplateSnapshotV1,assertSignalStudyTbTemplateV1,type SignalStudyTemplateSnapshotV1}from'./signal-study-template-data';
import {z} from 'zod';
import {signalWorkspaceEmbeddingDigestV1 as digest} from './signal-workspace-embeddings-v1';
import {signalListeningBaseTemplateV1,validateSignalListeningConfigurationV1,signalListeningConsumerCutV1,buildSignalListeningJevRequestV1,
  type SignalListeningConfigurationV1} from './signal-listening-contracts';
import type {JevAnswerV1,JevRequestV1} from './signal-mention-facets-jev-v1';

const text=z.string().trim().min(1),key=text.regex(/^[a-z][a-z0-9_]{0,63}$/u);
export const SIGNAL_STUDY_DIRECTIONS_V1=['trigger','barrier','mixed','none'] as const;
export const SIGNAL_STUDY_TARGETS_V1=['category','own_brand','competitor_brand','alternative'] as const;
export const SIGNAL_STUDY_USES_V1=['literal','figurative_or_ironic','other'] as const;
export const SIGNAL_STUDY_LAYERS_V1=['psychological','personal','social','cultural','unclear'] as const;
export type SignalStudyDirectionV1=typeof SIGNAL_STUDY_DIRECTIONS_V1[number];
export type SignalStudyTargetV1=typeof SIGNAL_STUDY_TARGETS_V1[number];
export type SignalStudyUseV1=typeof SIGNAL_STUDY_USES_V1[number];
export type SignalStudyLayerV1=typeof SIGNAL_STUDY_LAYERS_V1[number];
export type SignalStudyPermissionV1='movable'|'partial'|'structural_align_or_exit'|'no_permission';

const subjectSchema=z.object({kind:z.enum(['category','own_brand','alternative']),name:text.max(240),
  category:text.max(240),own_brand:text.max(240),competitors:z.array(text.max(80)).max(10),
  alternatives:z.array(text.max(80)).max(10),conventional_category:text.max(240).optional()}).strict();
const studySchema=z.object({contract_version:z.literal('signal-study-v1'),workspace_id:z.string().uuid(),corpus_id:z.string().uuid(),
  listening_configuration_id:z.string().uuid(),listening_configuration_digest:text.regex(/^sha256:[a-f0-9]{64}$/u),
  methodology:z.object({key,version:text.max(80),template_digest:text.regex(/^sha256:[a-f0-9]{64}$/u)}).strict(),
  subject:subjectSchema,business_question:text.max(2000),
  cut:z.object({start_at:z.string().datetime({offset:true}),end_at:z.string().datetime({offset:true}),
    timezone:text.max(100),voice:z.literal('individual'),promotion_max:z.literal(.7),exclude_hashtag_only:z.literal(true),
    require_category_lexicon:z.literal(true),filters:z.record(z.array(text.max(240)).max(100)).default({})}).strict(),
  template_snapshot:signalStudyTemplateSnapshotSchemaV1.optional(),
  provenance:z.enum(['human','agent']),revision:z.number().int().positive()}).strict();
export type SignalStudyV1=z.infer<typeof studySchema>;
export type SignalStudySubjectV1=z.infer<typeof subjectSchema>;

/** Legacy seed exports remain stable; new execution uses an explicit snapshot. */
export * from'./signal-study-template-data';

export function validateSignalStudyV1(value:unknown,template?:SignalStudyTemplateSnapshotV1):SignalStudyV1{
  const parsed=studySchema.safeParse(value);if(!parsed.success)throw Error('study_invalid');
  const study=parsed.data;
  const explicit=template??study.template_snapshot;
  if(explicit){
    const snapshot=validateSignalStudyTemplateSnapshotV1(explicit);
    if(snapshot.template.key==='triggers_barriers')assertSignalStudyTbTemplateV1(snapshot);
    if(study.methodology.key!==snapshot.template.key||study.methodology.version!==snapshot.template.version
      ||study.methodology.template_digest!==snapshot.template_digest
      ||study.template_snapshot&&digest(study.template_snapshot)!==digest(snapshot))throw Error('study_template_scope_mismatch');
  }else if(study.methodology.key!=='triggers_barriers'||study.methodology.version!=='r16-v1'
    ||study.methodology.template_digest!==SIGNAL_STUDY_TB_TEMPLATE_DIGEST_V1)throw Error('study_invalid');
  if(Date.parse(study.cut.start_at)>=Date.parse(study.cut.end_at)
    ||study.subject.kind==='alternative'&&!study.subject.conventional_category)throw Error('study_invalid');
  try{new Intl.DateTimeFormat('en',{timeZone:study.cut.timezone});}catch{throw Error('study_timezone_invalid');}
  return study;
}
export function interpolateSignalStudyTemplateTextV1(value:string,subject:SignalStudySubjectV1):string{
  const variables:Record<string,string>={subject:subject.name,category:subject.category,own_brand:subject.own_brand,
    competitors:subject.competitors.join('; ')||'(not configured)',alternatives:subject.alternatives.join('; ')||'(not configured)',
    conventional_category:subject.conventional_category??subject.category};
  return value.replace(/\{\{([a-z_]+)\}\}/gu,(_match,key:string)=>variables[key]??(()=>{throw Error('study_template_variable_invalid');})());
}
export function buildSignalStudyListeningConfigurationV1(value:SignalStudyV1,lexicon_terms:string[]):SignalListeningConfigurationV1{
  const study=validateSignalStudyV1(value);
  if(study.methodology.template_digest!==SIGNAL_STUDY_TB_TEMPLATE_DIGEST_V1)throw Error('study_explicit_configuration_required');
  const base=signalListeningBaseTemplateV1({category:study.subject.category,lexicon_terms});
  return validateSignalListeningConfigurationV1({...base,instructions:interpolateSignalStudyTemplateTextV1(SIGNAL_STUDY_TB_TEMPLATE_V1.instructions,study.subject),
    questions:[...base.questions,...SIGNAL_STUDY_TB_TEMPLATE_V1.questions.map(q=>({key:q.key,type:'choice' as const,
      text:interpolateSignalStudyTemplateTextV1(q.text,study.subject),options:q.options.map(o=>({key:o.key,definition:interpolateSignalStudyTemplateTextV1(o.definition,study.subject)})),
      scope:'all' as const,origin:'methodology' as const,human_locked:false}))]});
}
/** The cut has already reused the original Listening base answers. A Study
 * requests only its three newly configured axes; it must not repay voice or
 * promotion under the methodology-specific instructions. */
export function buildSignalStudyAxesRequestV1(input:{text:string},configuration:SignalListeningConfigurationV1):JevRequestV1{
  const config=validateSignalListeningConfigurationV1(configuration);
  for(const expected of SIGNAL_STUDY_TB_TEMPLATE_V1.questions){
    const actual=config.questions.find(question=>question.key===expected.key);
    if(actual?.type!=='choice'||actual.origin!=='methodology'
      ||actual.options.map(option=>option.key).sort().join(',')!==expected.options.map(option=>option.key).sort().join(','))throw Error('study_axes_configuration_invalid');
  }
  return buildSignalListeningJevRequestV1({text:input.text,question_keys:SIGNAL_STUDY_TB_TEMPLATE_V1.questions.map(question=>question.key)},config);
}
export function signalStudyCutV1(args:{study:SignalStudyV1;listening:SignalListeningConfigurationV1;text:string;
  occurred_at:string;answers:Record<string,JevAnswerV1>;attributes?:Record<string,string[]>;template_snapshot?:SignalStudyTemplateSnapshotV1}):'awaiting_base'|'included'|'excluded'{
  const study=validateSignalStudyV1(args.study,args.template_snapshot),at=Date.parse(args.occurred_at);
  const listening=validateSignalListeningConfigurationV1(args.listening);
  if(digest(args.listening)!==study.listening_configuration_digest||listening.category!==study.subject.category)throw Error('study_listening_scope_mismatch');
  if(!Number.isFinite(at)||at<Date.parse(study.cut.start_at)||at>=Date.parse(study.cut.end_at))return'excluded';
  if(Object.entries(study.cut.filters).some(([key,allowed])=>!allowed.length||!(args.attributes?.[key]??[]).some(value=>allowed.includes(value))))return'excluded';
  return signalListeningConsumerCutV1(listening,args.text,args.answers);
}
export type SignalStudyAxesV1={direction:SignalStudyDirectionV1;target:SignalStudyTargetV1;use:SignalStudyUseV1;
  source_direction:SignalStudyDirectionV1;alternative_inverted:boolean;aggregate:'subject'|'competitor'|'alternative'|'figurative_or_ironic'|'other'};
export function resolveSignalStudyAxesV1(subject:SignalStudySubjectV1,answers:Record<string,JevAnswerV1>):SignalStudyAxesV1{
  subjectSchema.parse(subject);
  function choice<T extends string>(key:string,allowed:readonly T[]):T{
    const value=answers[key];if(value?.type!=='choice'||!allowed.includes(value.choice as T))throw Error('study_axes_invalid');
    if(!Number.isFinite(value.confidence)||value.confidence<0||value.confidence>1
      ||Object.keys(value.probabilities).sort().join(',')!==[...allowed].sort().join(',')
      ||Object.values(value.probabilities).some(p=>!Number.isFinite(p)||p<0||p>1)
      ||Math.abs(Object.values(value.probabilities).reduce((a,b)=>a+b,0)-1)>.001)throw Error('study_axes_invalid');
    return value.choice as T;
  }
  const source_direction=choice('study_direction',SIGNAL_STUDY_DIRECTIONS_V1),target=choice('study_target',SIGNAL_STUDY_TARGETS_V1),use=choice('study_use',SIGNAL_STUDY_USES_V1);
  const alternative_inverted=subject.kind==='alternative'&&Boolean(subject.conventional_category)&&target==='category'&&source_direction==='barrier'&&use==='literal';
  return {source_direction,direction:alternative_inverted?'trigger':source_direction,target,use,alternative_inverted,
    aggregate:use==='figurative_or_ironic'?'figurative_or_ironic':use==='other'?'other':target==='competitor_brand'?'competitor':
      target==='alternative'&&subject.kind!=='alternative'?'alternative':'subject'};
}
export function signalStudyPermissionForLayerV1(layer:SignalStudyLayerV1):SignalStudyPermissionV1{
  switch(layer){case'psychological':case'personal':return'movable';case'social':return'partial';case'cultural':return'structural_align_or_exit';case'unclear':return'no_permission';}
}
