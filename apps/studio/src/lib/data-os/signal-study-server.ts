import {getSignalListeningStatusV1,getSignalListeningHumanEditContextV1,ensureSignalStudyCorpusV1,saveSignalStudyConfigurationV1,getSignalListeningEffectiveServingSnapshotV1,getSignalListeningConfigurationV1,
 readSignalStudyConfigurationV1,listSignalStudiesV1,readLatestSignalStudyConfigurationV1,readLatestSignalStudyExecutionStatusV1,readSignalStudyExecutionStatusV1,
 requestSignalStudyExecutionV1,promoteSignalStudyMotivesV1,readSignalStudyReportOverviewV1,readSignalStudyReportPageV1} from '@noisia/db';
import {buildSignalStudyExecutionConfigurationV1,createSignalStudyTemplateSnapshotV1,SIGNAL_STUDY_TB_TEMPLATE_V1,SIGNAL_STUDY_TB_ROLES_V1,validateSignalStudyV1} from '@noisia/query-engine';
import {loadSignalWorkspaceContextForTopics} from '@/app/api/data-os/signal/[workspaceId]/topics/_lib';
import {pool} from '@/lib/db';
import {createSignalStudyApiV1,studyMetadataV1,studyResponseV1,type StudyScopeV1} from './signal-study-api';
function conflict():never{throw Object.assign(new Error('study_listening_source_unavailable'),{code:'study_listening_source_unavailable',status:409});}
export async function loadSignalWorkspaceContextForStudyV1(workspace_id:string){
 const loaded=await loadSignalWorkspaceContextForTopics(workspace_id);if(loaded.response)return{response:loaded.response};
 if(process.env.NOISIA_SIGNAL_STUDY_ENABLED!=='true'||process.env.NOISIA_SIGNAL_LISTENING_ENABLED!=='true')return{response:studyResponseV1({error:'study_not_enabled'},404)};
 const scope={workspace_id:loaded.workspace.id,actor_user_id:loaded.session.appUser.id};
 const access=(s:StudyScopeV1)=>({database:pool,...s});
 return{api:createSignalStudyApiV1({
  load:async id=>id===scope.workspace_id?scope:{response:studyResponseV1({error:'study_forbidden'},403)},
  ready:()=>process.env.NOISIA_STUDY_SCOPED_PROVIDER_READY==='true',
  canExecute:async s=>(await getSignalListeningStatusV1(access(s))).capabilities.can_request_processing,
  canEdit:async s=>{try{return(await getSignalListeningHumanEditContextV1(access(s))).can_edit;}catch(error){
   if(error instanceof Error&&'status'in error&&error.status===404)return false;throw error;
  }},
  source:async s=>{let snapshot;
   try{snapshot=await getSignalListeningEffectiveServingSnapshotV1(access(s));}catch(error){
    if(error instanceof Error&&'code'in error&&error.code==='listening_human_snapshot_unavailable')return null;throw error;
   }
   if(!snapshot)return null;
   const cfg=await getSignalListeningConfigurationV1({...access(s),configuration_id:snapshot.configuration_id});if(!cfg)return null;
   return{binding_kind:snapshot.binding_kind==='human'?'human_edit':'serving',snapshot_id:snapshot.id,configuration_id:cfg.id,configuration_digest:cfg.configuration_digest,revision:cfg.revision,category:cfg.configuration.category,configuration_is_latest:snapshot.configuration_is_latest??false};},
  list:(s,args)=>listSignalStudiesV1({...access(s),...args}),
  create:async(s,body,idempotency_key)=>{
   // Browser fields are expectations. The native save resolves and validates
   // the exact effective source (including human edits) in its transaction.
   // Let native idempotency recover an earlier receipt before current-source CAS.
   const cfg=await getSignalListeningConfigurationV1({...access(s),configuration_id:body.source.configuration_id});
   if(!cfg||cfg.configuration_digest!==body.source.configuration_digest)conflict();
   if(cfg.configuration.category!==body.subject.category)throw Object.assign(new Error('study_category_scope_invalid'),{code:'study_category_scope_invalid',status:422});
   const corpus=await ensureSignalStudyCorpusV1(access(s));
   const template=createSignalStudyTemplateSnapshotV1({template:SIGNAL_STUDY_TB_TEMPLATE_V1,roles:SIGNAL_STUDY_TB_ROLES_V1,provenance:'human',revision:1,human_locked:true});
   const study=validateSignalStudyV1({contract_version:'signal-study-v1',workspace_id:s.workspace_id,corpus_id:corpus.id,
    listening_configuration_id:cfg.id,listening_configuration_digest:cfg.configuration_digest,
    methodology:{key:template.template.key,version:template.template.version,template_digest:template.template_digest},
    subject:body.subject,business_question:body.business_question,
    cut:{...body.cut,voice:'individual',promotion_max:.7,exclude_hashtag_only:true,require_category_lexicon:true,filters:{}},provenance:'human',revision:1},template);
   const configuration=buildSignalStudyExecutionConfigurationV1({study,template_snapshot:template,source_listening:{configuration_id:cfg.id,configuration_digest:cfg.configuration_digest,configuration:cfg.configuration}});
   return studyMetadataV1(await saveSignalStudyConfigurationV1({...access(s),expected_revision:0,configuration,listening_snapshot_id:body.source.snapshot_id,listening_source_kind:body.source.binding_kind,provenance:'human',idempotency_key}));
  },
  configuration:(s,study_id)=>readLatestSignalStudyConfigurationV1({...access(s),study_id}),
  executionConfiguration:(s,configuration_id)=>readSignalStudyConfigurationV1({...access(s),configuration_id}),
  latestExecution:(s,study_id)=>readLatestSignalStudyExecutionStatusV1({...access(s),study_id}),
  status:(s,execution_id)=>readSignalStudyExecutionStatusV1({...access(s),execution_id}),
  overview:(s,execution_id)=>readSignalStudyReportOverviewV1({...access(s),execution_id}),
  page:(s,args)=>readSignalStudyReportPageV1({...access(s),...args}),
  execute:(s,args)=>requestSignalStudyExecutionV1({...access(s),...args}),
  promote:(s,args)=>promoteSignalStudyMotivesV1({...access(s),...args}),
  currentListeningRevision:async s=>(await getSignalListeningConfigurationV1(access(s)))?.revision??null,
 })};
}
