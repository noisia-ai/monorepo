import{z}from'zod';
import seed from'./data/study-templates/triggers-barriers.r16-v1.json';
import{signalWorkspaceEmbeddingDigestV1 as digest}from'./signal-workspace-embeddings-v1';
const key=z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u);
const text=(max:number)=>z.string().min(1).max(max).refine(value=>Boolean(value.trim()));
const option=z.object({key,definition:text(1600)}).strict();
const common={key,text:text(1600),human_locked:z.boolean().optional()};
const question=z.discriminatedUnion('type',[
 z.object({...common,type:z.literal('choice'),options:z.array(option).min(2).max(32)}).strict(),
 z.object({...common,type:z.literal('noul'),positive:text(1600),negative:text(1600)}).strict(),
]);
const json:z.ZodType<unknown>=z.lazy(()=>z.union([z.null(),z.boolean(),z.number().finite(),z.string(),z.array(json),z.record(json)]));
export const signalStudyTemplateDataSchemaV1=z.object({contract_version:z.literal('signal-study-template-v1'),key,version:text(80),model:z.literal('jev-1.13.0'),
 instructions:text(2000),questions:z.array(question).min(1).max(256),diagnostics:z.array(z.object({key,layer:key,question:text(1600)}).strict()).max(32),
 rules:z.record(json)}).strict();
export type SignalStudyTemplateDataV1=z.infer<typeof signalStudyTemplateDataSchemaV1>;
export const signalStudyTemplateSnapshotSchemaV1=z.object({contract_version:z.literal('signal-study-template-snapshot-v1'),template:signalStudyTemplateDataSchemaV1,
 template_digest:z.string().regex(/^sha256:[a-f0-9]{64}$/u),roles:z.record(key,key),roles_digest:z.string().regex(/^sha256:[a-f0-9]{64}$/u),
 provenance:z.enum(['human','agent']),revision:z.number().int().positive(),human_locked:z.boolean()}).strict();
export type SignalStudyTemplateSnapshotV1=z.infer<typeof signalStudyTemplateSnapshotSchemaV1>;
export function freezeSignalStudyDataV1<T>(value:T):Readonly<T>{
 if(value&&typeof value==='object'){for(const item of Object.values(value))freezeSignalStudyDataV1(item);Object.freeze(value);}return value;
}
/** This historical seed is data, never a replacement for a saved revision. */
export const SIGNAL_STUDY_TB_TEMPLATE_V1=freezeSignalStudyDataV1(seed);
export const SIGNAL_STUDY_TB_TEMPLATE_DIGEST_V1=digest(SIGNAL_STUDY_TB_TEMPLATE_V1);
export const SIGNAL_STUDY_TB_ROLES_V1=Object.freeze({direction:'study_direction',target:'study_target',use:'study_use'});
export function validateSignalStudyTemplateSnapshotV1(value:unknown):SignalStudyTemplateSnapshotV1{
 const parsed=signalStudyTemplateSnapshotSchemaV1.safeParse(value);if(!parsed.success)throw Error('study_template_snapshot_invalid');
 const s=parsed.data,keys=s.template.questions.map(q=>q.key),roles=Object.entries(s.roles);
 if(digest(s.template)!==s.template_digest||digest(s.roles)!==s.roles_digest||!roles.length||roles.length>256
  ||new Set(keys).size!==keys.length||new Set(roles.map(([,key])=>key)).size!==roles.length
  ||roles.some(([,key])=>!keys.includes(key))||s.template.questions.some(q=>['voice','promotion'].includes(q.key)
   ||q.type==='choice'&&new Set(q.options.map(o=>o.key)).size!==q.options.length))throw Error('study_template_snapshot_invalid');
 return freezeSignalStudyDataV1(s);
}
export function createSignalStudyTemplateSnapshotV1(args:{template:unknown;roles:Record<string,string>;
 provenance:'human'|'agent';revision:number;human_locked:boolean}):SignalStudyTemplateSnapshotV1{
 return validateSignalStudyTemplateSnapshotV1({contract_version:'signal-study-template-snapshot-v1',...structuredClone(args),
  template_digest:digest(args.template),roles_digest:digest(args.roles)});
}
/** Explicit R16 protocol invariants. Wording/version may be revised; approved
 * semantics are not silently replaced or weakened by a template revision. */
export function assertSignalStudyTbTemplateV1(value:SignalStudyTemplateSnapshotV1){
 const s=validateSignalStudyTemplateSnapshotV1(value),t=s.template;
 const choices={direction:['trigger','barrier','mixed','none'],target:['category','own_brand','competitor_brand','alternative'],use:['literal','figurative_or_ironic','other']};
 if(t.key!=='triggers_barriers'||Object.keys(s.roles).sort().join(',')!=='direction,target,use'||t.questions.length!==3)throw Error('study_tb_template_invalid');
 for(const[role,options]of Object.entries(choices)){
  const q=t.questions.find(q=>q.key===s.roles[role]);if(q?.type!=='choice'||q.options.map(o=>o.key).sort().join(',')!==[...options].sort().join(','))throw Error('study_tb_template_invalid');
 }
 if(t.diagnostics.map(d=>d.key+':'+d.layer).join(',')!=='island:psychological,money_time:personal,nobody_knows:social,without_network:cultural'
  ||digest(t.rules)!==digest(SIGNAL_STUDY_TB_TEMPLATE_V1.rules))throw Error('study_tb_protocol_invalid');
 return s;
}
