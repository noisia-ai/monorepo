import{createHash}from'node:crypto';
import type{PoolClient}from'pg';
import{validateSignalStudyJevBindingV1,signalStudyJevIdentityV1,labelerDigestV1,signalWorkspaceEmbeddingDigestV1 as digest}from'@noisia/query-engine';
import type{StudyJevNativeAdapterV1,StudyJevInputV1,StudyJevResultV1}from'../../services/workers/src/workers/signal-study-jev';
import type{StudyRuntimeLeaseV1,StudyRuntimeJevBatchCheckpointV1}from'../../services/workers/src/workers/signal-study-runtime';
import{studyTransactionV1,studyFailV1 as fail,type StudyDatabaseV1,type SignalStudyExecutionRecordV1}from'./signal-study-core';
import{lockSignalStudyExecutionWithClientV1}from'./signal-study-executions';
import{loadStudyBatchWithClientV1,studyJevBindingWithClientV1,type StudyBatchRowV1}from'./signal-study-jev-batches';
import{createSignalLabelingStoreV1,type LabelingRunV1}from'./signal-labeling-runs';
import{loadSignalWorkspaceCapabilitiesStoreV1}from'./signal-workspace-capabilities';
import{selectLabelingInputPrefixV1,type LabelingInputBoundsV1}from'./signal-labeling-input-bounds';
const sha=(body:string)=>'sha256:'+createHash('sha256').update(body).digest('hex');
async function bindingAuthority(c:PoolClient,lease:StudyRuntimeLeaseV1,binding:Parameters<StudyJevNativeAdapterV1['createStore']>[0]['binding'],current=true){
 const p=await lockSignalStudyExecutionWithClientV1(c,lease,current?'owner':false),b=await loadStudyBatchWithClientV1(c,lease,binding.batch_id,current);if(!b||b.run_id!==binding.run_id||b.plan_digest!==binding.plan.plan_digest||p.actor_user_id!==binding.actor_user_id)fail('batch_binding_changed');return{p,b};
}
/** Read-only previews run inside H1's RR/READ ONLY snapshot. They acquire no
 * monetary lock and grant no authority; reserve/mark/apply recheck the native CAS. */
async function bindingReadAuthority(c:Pick<PoolClient,'query'>,lease:StudyRuntimeLeaseV1,binding:Parameters<StudyJevNativeAdapterV1['createStore']>[0]['binding']){
 const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:c,workspace_id:lease.workspace_id,actor_user_id:binding.actor_user_id,lock_authority:false});if(!caps.can_view||!caps.can_edit_topics||!caps.can_request_processing)fail('forbidden',403);
 const p=(await c.query<SignalStudyExecutionRecordV1&{live:boolean;current:boolean}>(`SELECT p.*,execution_token=$3::uuid AND execution_expires_at>clock_timestamp() live,signal_study_owner_current_v1(p.id) current FROM signal_study_executions p WHERE p.id=$1 AND p.workspace_id=$2`,[lease.execution_id,lease.workspace_id,lease.execution_token])).rows[0];
 if(!p?.live||!p.current||p.status!=='running'||p.source_digest!==lease.source_digest||p.configuration_digest!==lease.configuration_digest||p.human_revision_digest!==lease.human_revision_digest)fail('source_changed');
 const b=await loadStudyBatchWithClientV1(c,lease,binding.batch_id);if(!b||b.run_id!==binding.run_id||b.plan_digest!==binding.plan.plan_digest)fail('batch_binding_changed');return{p,b};
}
const pending=`NOT EXISTS(SELECT 1 FROM signal_study_jev_calls link WHERE link.batch_id=m.batch_id AND link.root_id=m.root_id)`;
async function readInputs(c:Pick<PoolClient,'query'>,run:LabelingRunV1,b:StudyBatchRowV1,p:SignalStudyExecutionRecordV1,bounds:LabelingInputBoundsV1):Promise<StudyJevInputV1[]>{
 // No request/state text leaves PostgreSQL before the conservative prefix fits.
 const fixed=Buffer.byteLength(JSON.stringify(run.identity))+Buffer.byteLength(JSON.stringify(run.context))+Buffer.byteLength(JSON.stringify(b.stage_configuration));
 const metadata=(await c.query<{root_id:string;working_bytes:string}>(`/* study_jev_input_metadata_v1 */ SELECT m.root_id,(4::bigint*(12*octet_length(m.request_body)+6*octet_length(m.question_digests::text)+$2::bigint+4096)+8192)::text working_bytes
 FROM signal_study_jev_members m WHERE m.batch_id=$1 AND m.workspace_id=$3 AND ${pending} ORDER BY m.root_id LIMIT $4`,[b.id,fixed,b.workspace_id,bounds.max_rows])).rows;
 const ids=selectLabelingInputPrefixV1(metadata,bounds);if(!ids.length)return[];if(!(await c.query<{allowed:boolean}>("SELECT bool_and(signal_listening_root_right_v1($1,root,'llm-processing')) allowed FROM unnest($2::uuid[]) root",[b.workspace_id,ids])).rows[0]?.allowed)fail('source_changed');
 const rows=(await c.query<{root_id:string;input_digest:string;request_body:string;request_sha256:string;question_digests:Record<string,string>;question_keys:string[];occurred_at:Date|string;channel:string}>(`/* study_jev_input_hydrate_v1 */ SELECT m.root_id,m.input_digest,m.request_body,m.request_sha256,m.question_digests,m.question_keys,s.occurred_at,s.channel
 FROM signal_study_jev_members m JOIN signal_study_source_roots s ON s.execution_id=m.execution_id AND s.root_id=m.root_id AND s.workspace_id=m.workspace_id
 WHERE m.batch_id=$1 AND m.workspace_id=$2 AND m.root_id=ANY($3::uuid[]) AND ${pending} ORDER BY m.root_id`,[b.id,b.workspace_id,ids])).rows;
 if(rows.length!==ids.length)fail('input_snapshot_changed');return rows.map(row=>({scope:'study',batch_id:b.id,plan_digest:b.plan_digest,target_digest:b.target_digest,request_body:row.request_body,request_sha256:row.request_sha256,
  root_id:row.root_id,input_digest:row.input_digest,text:JSON.parse(row.request_body).state,title:null,platform:row.channel,content_type:null,author:null,published_at:new Date(row.occurred_at).toISOString(),language:null,
  map_id:p.map_id,configuration_digest:b.stage_configuration_digest,question_keys:row.question_keys,question_digests:row.question_digests,scope_basis:{}}));
}
export function createSignalStudyJevNativeAdapterV1(options:{database:StudyDatabaseV1;page_size?:number;analysis_enabled:()=>boolean;sonnet_provider_available:()=>boolean}):StudyJevNativeAdapterV1{
 const leases=new WeakMap<object,StudyRuntimeLeaseV1>(),limit=options.page_size??4096;
 return{
  async load({lease,batch_id,plan_digest}){if(!options.analysis_enabled())return null;return studyTransactionV1(options.database,async c=>{const p=await lockSignalStudyExecutionWithClientV1(c,lease),b=await loadStudyBatchWithClientV1(c,lease,batch_id);if(!b||!b.run_id||b.plan_digest!==plan_digest)return null;
   const binding=validateSignalStudyJevBindingV1(await studyJevBindingWithClientV1(c,p,b));leases.set(binding,{...lease});return binding;});},
  createStore({binding,raw_pages}){
   const lease=leases.get(binding);if(!lease)fail('binding_not_loaded');validateSignalStudyJevBindingV1(binding);
   const identity=signalStudyJevIdentityV1(binding),native=createSignalLabelingStoreV1<StudyJevInputV1,StudyJevResultV1>({database:options.database,page_size:limit,rawPages:raw_pages,storeRaw:async()=>fail('page_writer_required'),
    adapter:{kind:'mass_labeling',policy_action:'mass_labeling_jev',feature:'mass_labeling',pending_calls_only:true,persist_results_before_write:true,
     authority:async(c,run)=>{if(!options.analysis_enabled()||!options.sonnet_provider_available())fail('analysis_disabled');if(run.id!==binding.run_id||labelerDigestV1(run.identity)!==labelerDigestV1(identity))fail('jev_run_identity_invalid');await bindingAuthority(c,lease,binding);},
     inputs:async(queryable,run)=>{const c=queryable as Pick<PoolClient,'query'>,{p,b}=await bindingReadAuthority(c,lease,binding);return readInputs(c,run,b,p,{max_rows:limit,max_working_bytes:512*1024*1024,on_oversize:'error'});},
     bounded_inputs:async(c,run,bounds)=>{const{p,b}=await bindingReadAuthority(c,lease,binding);return readInputs(c,run,b,p,bounds);},
     has_inputs:async c=>(await c.query(`SELECT 1 FROM signal_study_jev_members m WHERE m.batch_id=$1 AND ${pending} LIMIT 1`,[binding.batch_id])).rows.length>0,
     pending:async(c)=>Number((await c.query<{n:number}>(`SELECT count(*)::int n FROM signal_study_jev_members m WHERE m.batch_id=$1 AND ${pending}`,[binding.batch_id])).rows[0]!.n),
     beforeSubmit:async(c,run,calls)=>{if(!options.analysis_enabled()||!options.sonnet_provider_available())fail('analysis_disabled');await bindingAuthority(c,lease,binding);for(const call of calls){const i=call.inputs[0];if(call.inputs.length!==1||!i||digest(call.request)!==digest(JSON.parse(i.request_body))||i.batch_id!==binding.batch_id)fail('call_plan_invalid');}},
     write:async(c,run,pages)=>{
      if(!options.analysis_enabled())fail('analysis_disabled');await bindingAuthority(c,lease,binding);const rows=pages.flatMap(({call,results})=>{const input=call.inputs[0],result=results[0];if(call.inputs.length!==1||results.length!==1||!input||!result||input.batch_id!==binding.batch_id||result.batch_id!==binding.batch_id||result.scope!=='study'||result.root_id!==input.root_id||result.input_digest!==input.input_digest||result.entity_context_digest!==run.entity_context_digest||result.request_sha256!==input.request_sha256||result.target_digest!==input.target_digest||digest(result.question_digests)!==digest(input.question_digests))fail('result_lineage_invalid');
       if(result.status==='error')return[];if(Object.keys(result.answers).sort().join(',')!==[...input.question_keys].sort().join(','))fail('response_keys_invalid');const request=JSON.parse(input.request_body);
       return Object.entries(result.answers).map(([key,answer])=>({call_id:call.id,root_id:input.root_id,state_sha256:sha(request.state),target_digest:input.target_digest,question_key:key,question_digest:input.question_digests[key],
        question_identity_digest:digest({contract_version:'signal-study-jev-question-identity-v1',model:'jev-1.13.0',state:request.state,key,question:request.questions[key]}),answer,request_sha256:input.request_sha256}));});
      if(rows.length)await c.query(`INSERT INTO signal_study_answers(workspace_id,root_id,state_sha256,target_digest,model,question_key,question_identity_digest,question_digest,answer,call_id,batch_id,request_sha256,raw_page_id)
       SELECT $1,x.root_id,x.state_sha256,x.target_digest,'jev-1.13.0',x.question_key,x.question_identity_digest,x.question_digest,x.answer,x.call_id,$2,x.request_sha256,member.page_id
       FROM jsonb_to_recordset($3::jsonb)x(root_id uuid,state_sha256 text,target_digest text,question_key text,question_identity_digest text,question_digest text,answer jsonb,call_id uuid,request_sha256 text)
       JOIN signal_labeling_calls call ON call.id=x.call_id AND call.run_id=$4 AND call.workspace_id=$1
       JOIN signal_labeling_raw_page_members member ON member.call_id=call.id AND member.workspace_id=call.workspace_id AND member.run_id=call.run_id
       ON CONFLICT(workspace_id,root_id,state_sha256,target_digest,model,question_identity_digest) DO NOTHING`,[binding.plan.workspace_id,binding.batch_id,JSON.stringify(rows),run.id]);
     },
    }});
   return{...native,async claim(id){if(id!==binding.run_id)return null;
    await studyTransactionV1(options.database,async c=>{await bindingAuthority(c,lease,binding);await c.query(`UPDATE signal_labeling_runs r SET status='queued' WHERE r.id=$1 AND r.workspace_id=$2 AND r.status='failed'
     AND NOT EXISTS(SELECT 1 FROM signal_labeling_runs other WHERE other.workspace_id=r.workspace_id AND other.kind=r.kind AND other.id<>r.id AND other.status IN('queued','running'))
     AND EXISTS(SELECT 1 FROM signal_labeling_calls call WHERE call.run_id=r.id AND call.raw_storage_key IS NOT NULL AND NOT call.results_applied)
     AND NOT EXISTS(SELECT 1 FROM signal_labeling_calls call WHERE call.run_id=r.id AND call.status='unknown' AND call.raw_storage_key IS NULL)`,[id,binding.plan.workspace_id]);});return native.claim(id);}};
  },
  async loadCalibration({binding,run,shape_digest}){return studyTransactionV1(options.database,async c=>{const lease=leases.get(binding);if(!lease)fail('binding_not_loaded');await bindingAuthority(c,lease,binding);
   if(run.id!==binding.run_id)fail('calibration_run_invalid');return(await c.query<{profile:Awaited<ReturnType<StudyJevNativeAdapterV1['loadCalibration']>>}>(`SELECT profile FROM signal_study_calibrations WHERE workspace_id=$1 AND profile#>>'{scope,configuration_digest}'=$2 AND profile#>>'{scope,shape_digest}'=$3 ORDER BY created_at DESC,id DESC LIMIT 1`,[binding.plan.workspace_id,binding.plan.stage_configuration_digest,shape_digest])).rows[0]?.profile??null;});},
  async deriveCalibration({binding,run,shape_digest}){await studyTransactionV1(options.database,async c=>{const lease=leases.get(binding);if(!lease)fail('binding_not_loaded');await bindingAuthority(c,lease,binding);if(run.id!==binding.run_id)fail('calibration_run_invalid');
   await c.query(`INSERT INTO signal_study_calibrations(workspace_id,source_run_id,scope_digest,source_digest,profile,created_by_user_id)
    SELECT $1,$2,v->>'scope_digest',v->>'source_digest',v,$4 FROM(SELECT signal_study_calibration_evidence_v1($1,$2,$3) v)e WHERE v IS NOT NULL ON CONFLICT(scope_digest,source_digest) DO NOTHING`,[binding.plan.workspace_id,run.id,shape_digest,binding.actor_user_id]);});},
 };
}
