import {z} from 'zod';
import type {SignalStudySubjectV1,SignalStudyV1} from '@noisia/query-engine';
import type {SignalStudyConfigurationRecordV1,SignalStudyExecutionStatusV1,SignalStudyReportOverviewV1,SignalStudyReportSectionV1} from '@noisia/db';
const uuid=z.string().uuid(), sha=z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const text=(max:number)=>z.string().trim().min(1).max(max);
const subject=z.object({kind:z.enum(['category','own_brand','alternative']),name:text(240),category:text(240),own_brand:text(240),
 competitors:z.array(text(80)).max(10),alternatives:z.array(text(80)).max(10),conventional_category:text(240).optional()}).strict();
export const studyCreateRequestSchemaV1=z.object({source:z.object({binding_kind:z.enum(['serving','human_edit']),snapshot_id:uuid,configuration_id:uuid,configuration_digest:sha}).strict(),
 subject,business_question:text(2000),cut:z.object({start_at:z.string().datetime({offset:true}),end_at:z.string().datetime({offset:true}),timezone:text(100)}).strict()}).strict();
const execution=z.object({operation:z.literal('execute'),configuration_id:uuid,cap_micro_usd:z.number().int().positive().safe()}).strict();
const promotion=z.object({operation:z.literal('promote'),execution_id:uuid,motive_keys:z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u)).min(1).max(256),expected_listening_revision:z.number().int().positive().safe()}).strict();
const mutation=z.discriminatedUnion('operation',[execution,promotion]);
const page=z.object({execution_id:uuid,section:z.enum(['motives','topics','channels','series','evidence']),offset:z.coerce.number().int().min(0).max(100000000).default(0),limit:z.coerce.number().int().min(1).max(100).default(30)}).strict();
export type StudyCreateRequestV1=z.infer<typeof studyCreateRequestSchemaV1>;
export type StudySourceV1=StudyCreateRequestV1['source']&{revision:number;configuration_is_latest:boolean;category:string};
export type StudyMetadataV1={study_id:string;configuration_id:string;revision:number;configuration_digest:string;study:Omit<SignalStudyV1,'template_snapshot'>;listening_source:{kind:'serving'|'human_edit'|null;id:string|null;base_snapshot_id:string}};
export function studyMetadataV1(row:SignalStudyConfigurationRecordV1):StudyMetadataV1{
 const {template_snapshot,...study}=row.envelope.study;void template_snapshot;
 return{study_id:row.study_id,configuration_id:row.id,revision:row.revision,configuration_digest:row.configuration_digest,
 study,listening_source:{kind:row.listening_source_kind??null,id:row.listening_source_id??null,base_snapshot_id:row.listening_snapshot_id}};
}
export type StudyOverviewV1=Omit<SignalStudyReportOverviewV1,'configuration'>;
export type StudyScopeV1={workspace_id:string;actor_user_id:string};
export type StudyApiDependenciesV1={
 load(workspace_id:string):Promise<StudyScopeV1|{response:Response}>;
 ready():boolean;
 canEdit(scope:StudyScopeV1):Promise<boolean>;
 canExecute(scope:StudyScopeV1):Promise<boolean>;
 source(scope:StudyScopeV1):Promise<StudySourceV1|null>;
 list(scope:StudyScopeV1,args:{limit:number;after_study_id?:string}):Promise<unknown>;
 create(scope:StudyScopeV1,body:StudyCreateRequestV1,key:string):Promise<StudyMetadataV1>;
 configuration(scope:StudyScopeV1,study_id:string):Promise<SignalStudyConfigurationRecordV1|null>;
 executionConfiguration(scope:StudyScopeV1,configuration_id:string):Promise<SignalStudyConfigurationRecordV1|null>;
 latestExecution(scope:StudyScopeV1,study_id:string):Promise<SignalStudyExecutionStatusV1|null>;
 status(scope:StudyScopeV1,execution_id:string):Promise<SignalStudyExecutionStatusV1|null>;
 overview(scope:StudyScopeV1,execution_id:string):Promise<SignalStudyReportOverviewV1|null>;
 page(scope:StudyScopeV1,args:{execution_id:string;section:SignalStudyReportSectionV1;offset:number;limit:number}):Promise<unknown>;
 execute(scope:StudyScopeV1,args:{configuration_id:string;cap_micro_usd:number;idempotency_key:string}):Promise<{id:string}>;
 promote(scope:StudyScopeV1,args:{execution_id:string;motive_keys:string[];expected_listening_revision:number;idempotency_key:string}):Promise<unknown>;
 currentListeningRevision(scope:StudyScopeV1):Promise<number|null>;
};
export const studyResponseV1=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
function studyErrorV1(error:unknown){
 if(error instanceof z.ZodError||error instanceof SyntaxError)return studyResponseV1({error:'study_request_invalid'},422);
 if(error instanceof Error&&'code'in error&&typeof error.code==='string'){
  const status='status'in error&&typeof error.status==='number'?error.status:409;
  return studyResponseV1({error:error.code},[403,404,409,422,503].includes(status)?status:409);
 }
 return studyResponseV1({error:'study_unavailable'},503);
}
function requestKey(request:Request){const key=request.headers.get('Idempotency-Key')?.trim()??'';
 if(!/^[A-Za-z0-9._:-]{8,200}$/u.test(key))throw new z.ZodError([]);return key;}
/** All authority remains in native stores. These bodies carry immutable input,
 * compare-and-swap expectations and a bounded cap, never an actor or provider. */
export function createSignalStudyApiV1(deps:StudyApiDependenciesV1){
 async function scoped(workspace_id:string,fn:(scope:StudyScopeV1)=>Promise<Response>){
  const loaded=await deps.load(workspace_id);if('response'in loaded)return loaded.response;
  try{return await fn(loaded);}catch(error){return studyErrorV1(error);}
 }
 async function boundExecution(scope:StudyScopeV1,study_id:string,execution_id:string){
  const status=await deps.status(scope,execution_id);
  return status?.study_id===study_id?status:null;
 }
 return{
  list:(workspace_id:string,request:Request)=>scoped(workspace_id,async scope=>{
   const search=new URL(request.url).searchParams;
   if(search.get('context')==='true')return studyResponseV1({source:await deps.source(scope),processing_ready:deps.ready(),can_edit:await deps.canEdit(scope),can_execute:await deps.canExecute(scope)});
   const args=z.object({limit:z.coerce.number().int().min(1).max(100).default(20),after_study_id:uuid.optional()}).strict().parse(Object.fromEntries(search));
   return studyResponseV1(await deps.list(scope,args));
  }),
  create:(workspace_id:string,request:Request)=>scoped(workspace_id,async scope=>{
   const key=requestKey(request),body=studyCreateRequestSchemaV1.parse(await request.json());
   if(body.subject.kind==='alternative'&&!body.subject.conventional_category)return studyResponseV1({error:'study_subject_invalid'},422);
   if(Date.parse(body.cut.start_at)>=Date.parse(body.cut.end_at))return studyResponseV1({error:'study_cut_invalid'},422);
   try{new Intl.DateTimeFormat('en',{timeZone:body.cut.timezone}).format();}catch{return studyResponseV1({error:'study_cut_invalid'},422);}
   return studyResponseV1(await deps.create(scope,body,key),201);
  }),
  detail:(workspace_id:string,study_id:string,request:Request)=>scoped(workspace_id,async scope=>{
   uuid.parse(study_id);const cfg=await deps.configuration(scope,study_id);if(!cfg)return studyResponseV1({error:'study_not_found'},404);
   const search=new URL(request.url).searchParams;
   if(search.has('section')){
    const args=page.parse(Object.fromEntries(search)),status=await boundExecution(scope,study_id,args.execution_id);
    if(!status)return studyResponseV1({error:'study_execution_not_found'},404);
    const result=await deps.page(scope,args);return result?studyResponseV1(result):studyResponseV1({error:'study_output_unavailable'},409);
   }
   const requested=search.get('execution_id');if(requested)uuid.parse(requested);
   const status=requested?await boundExecution(scope,study_id,requested):await deps.latestExecution(scope,study_id);
   if(requested&&!status)return studyResponseV1({error:'study_execution_not_found'},404);
   const reportCfg=status&&status.configuration_id!==cfg.id?await deps.executionConfiguration(scope,status.configuration_id):cfg;
   if(!reportCfg||reportCfg.study_id!==study_id)return studyResponseV1({error:'study_configuration_unavailable'},409);
   const raw=status?.status==='completed'?await deps.overview(scope,status.id):null;
   const overview:StudyOverviewV1|null=raw?{execution_id:raw.execution_id,study_id:raw.study_id,configuration_id:raw.configuration_id,configuration_is_latest:raw.configuration_is_latest,source_digest:raw.source_digest,output_digest:raw.output_digest,listening_source_binding:raw.listening_source_binding,overview:raw.overview,section_counts:raw.section_counts}:null;
   return studyResponseV1({configuration:studyMetadataV1(reportCfg),configuration_is_latest:reportCfg.id===cfg.id,execution:status,overview,processing_ready:deps.ready(),can_edit:await deps.canEdit(scope),can_execute:await deps.canExecute(scope),current_listening_revision:await deps.currentListeningRevision(scope)});
  }),
  mutate:(workspace_id:string,study_id:string,request:Request)=>scoped(workspace_id,async scope=>{
   uuid.parse(study_id);const key=requestKey(request),body=mutation.parse(await request.json()),cfg=await deps.configuration(scope,study_id);
   if(!cfg)return studyResponseV1({error:'study_not_found'},404);
   if(body.operation==='execute'){
    if(cfg.id!==body.configuration_id)return studyResponseV1({error:'study_configuration_revision_conflict'},409);
    if(!deps.ready())return studyResponseV1({error:'study_provider_not_ready'},503);
    const queued=await deps.execute(scope,{configuration_id:body.configuration_id,cap_micro_usd:body.cap_micro_usd,idempotency_key:key});
    return studyResponseV1({execution_id:queued.id},202);
   }
   if(new Set(body.motive_keys).size!==body.motive_keys.length)return studyResponseV1({error:'study_request_invalid'},422);
   if(!await boundExecution(scope,study_id,body.execution_id))return studyResponseV1({error:'study_execution_not_found'},404);
   return studyResponseV1(await deps.promote(scope,{execution_id:body.execution_id,motive_keys:body.motive_keys,expected_listening_revision:body.expected_listening_revision,idempotency_key:key}));
  }),
 };
}
export type StudySubjectV1=SignalStudySubjectV1;
