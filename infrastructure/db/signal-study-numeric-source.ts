import{createHash,randomUUID}from'node:crypto';
import type{StudyNumericAdapterV1,StudyNumericContextV1,StudyNumericRowV1}from'@noisia/query-engine';
import type{StudyRuntimeLeaseV1,StudyRuntimeNumericPlanV1}from'../../services/workers/src/workers/signal-study-runtime';
import{studyTransactionV1,studyFailV1 as fail,studyDigestV1 as digest,type StudyDatabaseV1,type SignalStudyExecutionRecordV1}from'./signal-study-core';
import{lockSignalStudyExecutionWithClientV1}from'./signal-study-executions';
import{readSignalStudySourceWithClientV1}from'./signal-study-source';
import{replaySignalStudyWithClientV1}from'./signal-study-replay';
import{selectLabelingInputPrefixV1}from'./signal-labeling-input-bounds';
const sha=(value:string)=>'sha256:'+createHash('sha256').update(value).digest('hex');
export async function loadSignalStudyNumericSourceWithClientV1(c:import('pg').PoolClient,p:SignalStudyExecutionRecordV1,plan:StudyRuntimeNumericPlanV1){
 if(plan.source_digest!==p.source_digest||sha(plan.request_body)!==plan.request_sha256||plan.kind!=='numeric')fail('numeric_plan_invalid',422);
 return(await c.query<{id:string;context:StudyNumericContextV1;fit_plan_digest:string;request_sha256:string}>('SELECT * FROM signal_study_numeric_sources WHERE execution_id=$1 AND workspace_id=$2 AND numeric_key=$3',[p.id,p.workspace_id,plan.key])).rows[0]??null;
}
export function createSignalStudyNumericNativeAdapterV1(options:{database:StudyDatabaseV1}):StudyNumericAdapterV1{
 return{
  async load({lease,numeric_plan,fit_plan}){return studyTransactionV1(options.database,async c=>{
   const p=await lockSignalStudyExecutionWithClientV1(c,lease),old=await loadSignalStudyNumericSourceWithClientV1(c,p,numeric_plan);
   if(old){if(old.fit_plan_digest!==fit_plan.plan_digest||old.request_sha256!==numeric_plan.request_sha256)fail('numeric_plan_conflict');return old.context;}
   const source=await readSignalStudySourceWithClientV1(c,p),next=(await replaySignalStudyWithClientV1(c,p.id,source)).operation;
   if(next.kind!=='numeric'||digest(next.plan)!==digest(numeric_plan)||digest(next.fit)!==digest(fit_plan))fail('numeric_not_next');
   const byId=new Map(next.roots.map(root=>[root.root_id,root])),selected=next.fit.rows.map(row=>byId.get(row.root_id)??fail('numeric_root_missing'));
   const proofs=selected.map(root=>{const proof={...JSON.parse(root.embedding_proof.proof_json),contract_version:'signal-study-cached-vector-proof-v1',source_proof_digest:root.embedding_proof.proof_digest,source_digest:p.source_digest,
    cut_digest:digest(source.configuration.study.cut),study_digest:source.configuration.study_digest,fit_plan_digest:fit_plan.plan_digest,in_consumer_cut:true,axes:root.axes};const proof_json=JSON.stringify(proof);return{root_id:root.root_id,proof_json,proof_digest:sha(proof_json)};});
   const proof_census_digest=digest({execution_id:p.id,fit_plan_digest:fit_plan.plan_digest,roots:proofs.map(row=>[row.root_id,row.proof_digest]),source_digest:p.source_digest,workspace_id:p.workspace_id});
   const nativeMap=(await c.query<{input_revision:string;embedding_config_digest:string}>('SELECT input_revision::text,embedding_config_digest FROM signal_mass_labeling_maps WHERE id=$1 AND workspace_id=$2',[p.map_id,p.workspace_id])).rows[0]!;
   const context:StudyNumericContextV1={workspace_id:p.workspace_id,execution_id:p.id,study_digest:source.configuration.study_digest,source_digest:p.source_digest,cut_digest:digest(source.configuration.study.cut),fit_plan_digest:fit_plan.plan_digest,proof_census_digest,
    context_digest:p.entity_context_digest,embedding_config_digest:nativeMap.embedding_config_digest,embedding_space_digest:source.embedding_space_digest,input_revision:Number(nativeMap.input_revision),root_count:selected.length,
    source_preparation_run_ids:[...new Set(selected.flatMap(root=>root.embedding_proof.preparation_run_id?[root.embedding_proof.preparation_run_id]:[]))].sort(),preparation_unknown_root_ids:selected.filter(root=>root.embedding_proof.preparation_run_id===null).map(root=>root.root_id).sort(),sampling_seed:source.sampling_seed};
   const id=randomUUID();await c.query("SELECT set_config('noisia.study_numeric_source_v1',$1,true)",[JSON.stringify({execution_id:p.id,execution_token:lease.execution_token,source_id:id,numeric_key:numeric_plan.key,fit_plan_digest:fit_plan.plan_digest})]);
   await c.query('INSERT INTO signal_study_numeric_sources(id,workspace_id,execution_id,numeric_key,request_sha256,fit_plan_digest,context) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[id,p.workspace_id,p.id,numeric_plan.key,numeric_plan.request_sha256,fit_plan.plan_digest,JSON.stringify(context)]);
   if(proofs.length)await c.query(`INSERT INTO signal_study_numeric_source_roots(source_id,workspace_id,execution_id,root_id,proof_json,proof_digest)
    SELECT $1,$2,$3,x.root_id,x.proof_json,x.proof_digest FROM jsonb_to_recordset($4::jsonb)x(root_id uuid,proof_json text,proof_digest text)`,[id,p.workspace_id,p.id,JSON.stringify(proofs)]);
   await c.query('ANALYZE signal_study_numeric_source_roots');return context;});},
  async assertCurrent({lease,context}){await studyTransactionV1(options.database,async c=>{const p=await lockSignalStudyExecutionWithClientV1(c,lease,'owner');const saved=(await c.query('SELECT context FROM signal_study_numeric_sources WHERE execution_id=$1 AND workspace_id=$2 AND fit_plan_digest=$3',[p.id,p.workspace_id,context.fit_plan_digest])).rows[0];if(!saved||digest(saved.context)!==digest(context))fail('numeric_source_changed');});},
  async read({lease,context,after_root_id,limit,max_working_bytes}){if(!Number.isSafeInteger(limit)||limit<1||limit>1024||!Number.isSafeInteger(max_working_bytes)||max_working_bytes<8192||max_working_bytes>32*1024*1024)fail('numeric_read_bounds_invalid',422);
   return studyTransactionV1(options.database,async c=>{const p=await lockSignalStudyExecutionWithClientV1(c,lease),s=(await c.query<{id:string;context:StudyNumericContextV1}>('SELECT id,context FROM signal_study_numeric_sources WHERE execution_id=$1 AND workspace_id=$2 AND fit_plan_digest=$3',[p.id,p.workspace_id,context.fit_plan_digest])).rows[0];if(!s||digest(s.context)!==digest(context))fail('numeric_source_changed');
    const joins=`FROM signal_study_numeric_source_roots n JOIN signal_study_source_roots saved ON saved.execution_id=n.execution_id AND saved.root_id=n.root_id AND saved.workspace_id=n.workspace_id
     JOIN signal_mass_labeling_items item ON item.map_id=saved.map_id AND item.root_id=saved.root_id AND item.workspace_id=saved.workspace_id
     JOIN signal_workspace_chunk_embeddings cached ON cached.workspace_id=saved.workspace_id AND cached.config_digest=saved.embedding_config_digest AND cached.chunk_sha256=saved.chunk_sha256
     WHERE n.source_id=$1 AND n.workspace_id=$2 AND($3::uuid IS NULL OR n.root_id>$3::uuid)`;
    const rows=(await c.query<{root_id:string;working_bytes:string}>(`/* study_numeric_metadata_v1 */ SELECT n.root_id,(16::bigint*(octet_length(item.text)+2*octet_length(cached.embedding::text)+2*octet_length(n.proof_json)+4096)+8192)::text working_bytes ${joins} ORDER BY n.root_id LIMIT $4`,[s.id,p.workspace_id,after_root_id??null,limit+1])).rows;
    const ids=selectLabelingInputPrefixV1(rows,{max_rows:limit,max_working_bytes,on_oversize:'error'});
    if(!ids.length)return{proof_census_digest:context.proof_census_digest,roots:[],next_root_id:null};
    const hydrated=(await c.query<StudyNumericRowV1&{native_vector_sha256:string}>(`/* study_numeric_hydrate_v1 */ SELECT n.root_id,item.text,cached.embedding::text vector_json,n.proof_json,n.proof_digest,saved.native_vector_sha256 ${joins} AND n.root_id=ANY($4::uuid[]) ORDER BY n.root_id`,[s.id,p.workspace_id,after_root_id??null,ids])).rows;
    if(hydrated.length!==ids.length)fail('numeric_census_changed');const roots=hydrated.map(({native_vector_sha256,...row})=>{if(sha(row.vector_json)!==native_vector_sha256||sha(row.proof_json)!==row.proof_digest)fail('numeric_proof_changed');return{...row,vector:JSON.parse(row.vector_json)};});
    return{proof_census_digest:context.proof_census_digest,roots,next_root_id:ids.at(-1)!};});},
 };
}
