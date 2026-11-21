import type{SignalStudyQueryMetadataV1}from'./signal-study-query-metadata';
import{SIGNAL_STUDY_BOUNDARY_RULE_VERSION_V1}from'@noisia/query-engine';
import type{PoolClient}from'pg';
import{validateSignalStudyExecutionConfigurationV1,signalStudyJevTargetDigestV1,signalStudySourceUrlStateV1,SIGNAL_STUDY_EDITORIAL_COMPILER_V2}from'@noisia/query-engine';
import type{StudyRuntimeRootV1,StudyRuntimeSourceV1}from'../../services/workers/src/workers/signal-study-runtime';
import{createStudySourcePagesV1,bindStudySourcePagesV1,STUDY_SOURCE_PAGES_V1,STUDY_SOURCE_PAGE_WORKING_BYTES_V1}from'../../services/workers/src/workers/signal-study-source-pages';
import{baseSql,filteredSql,eligibleSql,validSql,rowFields,hydrateStudySourceNativeRowV1,hydrateFrozenStudySourceRootV1,type NativeRow,type StudySourceCacheValueV1}from'./signal-study-source-native';
import{selectLabelingInputPrefixV1}from'./signal-labeling-input-bounds';
import{studyDigestV1 as digest,studyFailV1 as fail,type SignalStudyConfigurationRecordV1,type SignalStudyExecutionRecordV1}from'./signal-study-core';
const MAX_ROOTS=32768,MAX_BYTES=128*1024*1024;
const params=(cfg:SignalStudyConfigurationRecordV1,ids:string[]|null=null)=>[cfg.id,cfg.workspace_id,JSON.stringify(cfg.envelope),signalStudyJevTargetDigestV1(cfg.envelope),ids];
const workingSql=`(16::bigint*(COALESCE(octet_length(asset.full_text),0)+2*COALESCE(octet_length(cached.embedding::text),0)+octet_length(answers.cache::text)+octet_length(attributes.value::text)+hints.bytes+12*(CASE WHEN mention.source_author_label_recorded THEN COALESCE(octet_length(mention.source_author_label),0) ELSE COALESCE(octet_length(mention.raw_metadata->>'author'),0)+COALESCE(octet_length(mention_author.display_name),0)+COALESCE(octet_length(mention_author.handle),0) END)+16384)+8192)`;
async function cacheFor(c:PoolClient,workspace_id:string,ids:string[]){
 const rows=ids.length?(await c.query<{id:string;root_id:string}&StudySourceCacheValueV1>(`SELECT a.id,a.root_id,a.question_key,a.question_identity_digest identity_digest,a.state_sha256,a.call_id jev_call_id,a.answer,
  jsonb_build_object('page_id',p.id,'sha256',p.sha256,'verified',true) receipt_page FROM signal_study_answers a JOIN signal_labeling_raw_pages p ON p.id=a.raw_page_id AND p.status='verified'
  WHERE a.id=ANY($1::uuid[]) AND a.workspace_id=$2 ORDER BY a.id`,[ids,workspace_id])).rows:[];
 return new Map(rows.map(({id,root_id,...answer})=>[id,{root_id,answer}]));
}
export async function prepareSignalStudyPagedSourceWithClientV1(c:PoolClient,cfg:SignalStudyConfigurationRecordV1,executionId:string,metadata:SignalStudyQueryMetadataV1){
 const configuration=validateSignalStudyExecutionConfigurationV1(cfg.envelope),validFilters=new Set(['platform','channel','topic',...configuration.source_listening.configuration.questions.map(q=>q.key)]);
 if(Object.keys(configuration.study.cut.filters).some(key=>!validFilters.has(key)))fail('cut_filter_invalid',422);
 const bound=(await c.query<{eligible:number;pending_base:number;invalid:number;max_working_bytes:string;ids:string[]}>(`WITH selected AS MATERIALIZED(SELECT frozen.root_id,${eligibleSql} eligible,NOT(answers.cache ?& ARRAY['voice','promotion']) pending,
  NOT COALESCE(${validSql},false) invalid,${workingSql} working_bytes ${baseSql} AND ${filteredSql})
  SELECT count(*) FILTER(WHERE eligible)::int eligible,count(*) FILTER(WHERE pending)::int pending_base,count(*) FILTER(WHERE eligible AND invalid)::int invalid,
  COALESCE(max(working_bytes) FILTER(WHERE eligible),0)::text max_working_bytes,
  ARRAY(SELECT root_id::text FROM selected WHERE eligible ORDER BY root_id LIMIT ${MAX_ROOTS+1}) ids FROM selected`,params(cfg))).rows[0]!;
 if(bound.pending_base)fail('base_pending',409);if(bound.invalid)fail('cached_source_incomplete',409);
 if(bound.eligible>MAX_ROOTS)fail('source_root_capacity_exceeded',422);
 if(BigInt(bound.max_working_bytes)>BigInt(STUDY_SOURCE_PAGE_WORKING_BYTES_V1))fail('source_root_page_oversize',422);
 if(bound.ids.length!==bound.eligible)fail('source_census_incomplete');
 const pages=await createStudySourcePagesV1(),proofCensus:Array<[string,string]>=[],preparations=new Set<string>();
 let embeddingSpace:string|undefined,validUrls=0,missingUrls=0,invalidUrls=0;
 try{
  for(let offset=0;offset<bound.ids.length;){
   const remaining=bound.ids.slice(offset,offset+512);
   const weights=(await c.query<{root_id:string;working_bytes:string}>(`/* study_source_page_metadata_v1 */ SELECT frozen.root_id,${workingSql}::text working_bytes ${baseSql} AND ${filteredSql} AND ${eligibleSql} AND ${validSql} ORDER BY frozen.root_id`,params(cfg,remaining))).rows;
   const ids=selectLabelingInputPrefixV1(weights,{max_rows:512,max_working_bytes:STUDY_SOURCE_PAGE_WORKING_BYTES_V1,on_oversize:'error'});
   if(!ids.length||ids.some((id,i)=>id!==remaining[i]))fail('source_census_changed');
   const rows=(await c.query<NativeRow>(`/* study_source_page_hydrate_v1 */ SELECT ${rowFields} ${baseSql} AND ${filteredSql} AND ${eligibleSql} AND ${validSql} ORDER BY frozen.root_id`,params(cfg,ids))).rows;
   if(rows.length!==ids.length||rows.some((row,i)=>row.root_id!==ids[i]))fail('source_changed');
   const cache=await cacheFor(c,cfg.workspace_id,[...new Set(rows.flatMap(row=>row.question_cache_ids))]);
   for(const row of rows){const item=hydrateStudySourceNativeRowV1(row,cfg,executionId,configuration,cache),{full_text:_text,fragment:_fragment,vector_json:_vector,...saved}=item.row;
    const record={...saved,native_vector_sha256:JSON.parse(item.proof_json).embedding_sha256,proof_json:item.proof_json,proof_digest:item.proof_digest};
    await pages.append(item.root,record);proofCensus.push([row.root_id,item.proof_digest]);
    if(embeddingSpace!==undefined&&embeddingSpace!==row.embedding_config_digest)fail('embedding_space_changed');embeddingSpace=row.embedding_config_digest;
    if(row.embedding_preparation_run_id)preparations.add(row.embedding_preparation_run_id);
    const url=signalStudySourceUrlStateV1(row.source_url);if(url==='valid')validUrls++;else if(url==='missing')missingUrls++;else invalidUrls++;
   }
   offset+=ids.length;
  }
  const baseline=(await c.query<{corpus:number;brand:number}>(`SELECT count(*)::int corpus,count(*) FILTER(WHERE mention.published_at>=($3::jsonb#>>'{study,cut,start_at}')::timestamptz AND mention.published_at<($3::jsonb#>>'{study,cut,end_at}')::timestamptz)::int brand
   FROM signal_study_configuration_sources_v1 snapshot JOIN signal_listening_discovery_roots r ON r.generation_id=snapshot.generation_id AND r.workspace_id=snapshot.workspace_id
   JOIN mentions mention ON mention.id=r.root_id AND mention.workspace_id=r.workspace_id WHERE snapshot.study_configuration_id=$1 AND snapshot.workspace_id=$2 AND signal_listening_root_right_v1(r.workspace_id,r.root_id,'client-derived-metrics')`,params(cfg).slice(0,3))).rows[0]!;
  const binding=(await c.query<{source_kind:'serving'|'human_edit';id:string;configuration_id:string;generation_id:string;snapshot_digest:string;base_snapshot_id:string;embedding_config_digest:string}>(`SELECT s.*,m.embedding_config_digest FROM signal_study_configuration_sources_v1 s JOIN signal_mass_labeling_maps m ON m.id=s.map_id AND m.workspace_id=s.workspace_id WHERE s.study_configuration_id=$1 AND s.workspace_id=$2`,[cfg.id,cfg.workspace_id])).rows[0];if(!binding)fail('listening_source_unavailable');
  const complete=await pages.finish(),body={configuration,editorial_compiler_version:SIGNAL_STUDY_EDITORIAL_COMPILER_V2,layer_boundary_rule_version:SIGNAL_STUDY_BOUNDARY_RULE_VERSION_V1,evidence_association_version:'signal-study-evidence-association-v1' as const,
   source_storage:complete.manifest,evidence_source_census:{valid_url_roots:validUrls,missing_url_roots:missingUrls,invalid_url_roots:invalidUrls},
   listening_source_binding:{kind:binding.source_kind,id:binding.id,configuration_id:binding.configuration_id,generation_id:binding.generation_id,source_digest:binding.snapshot_digest,base_snapshot_id:binding.base_snapshot_id},
   selection:{scope:'listening_consumer_cut' as const,source_listening_digest:configuration.source_listening.configuration_digest,cut_digest:digest(configuration.study.cut),eligible_root_ids_digest:digest(bound.ids),eligible_roots:bound.eligible,pending_base_roots:0,corpus_roots:baseline.corpus},
   embedding_space_digest:embeddingSpace??binding.embedding_config_digest,source_preparation_run_ids:[...preparations].sort(),sampling_seed:digest({execution_id:executionId,study_digest:configuration.study_digest}),query_terms:metadata.query_terms,problem_terms:metadata.problem_terms,
   ...(metadata.acquisition_query_metadata?{acquisition_query_metadata:metadata.acquisition_query_metadata}:{}),query_metadata:{query_terms_declared:metadata.acquisition_query_metadata?.complete??metadata.query_terms.length>0,problem_terms_declared:metadata.problem_terms.length>0},brand_baseline_roots:baseline.brand,human_revision_digest:cfg.human_revision_digest,max_roots:MAX_ROOTS,max_bytes:MAX_BYTES};
  if(Buffer.byteLength(JSON.stringify(body))>MAX_BYTES)fail('source_manifest_capacity_exceeded',422);
  const source=bindStudySourcePagesV1({...body,roots:complete.roots,source_digest:digest(body)},pages);
  return{source,pages,census:digest(proofCensus),working_bytes:String(complete.manifest.descriptor_working_limit_bytes+complete.manifest.cache_working_limit_bytes+complete.manifest.page_working_limit_bytes),root_count:bound.eligible};
 }catch(error){await pages.dispose();throw error;}
}

export async function readSignalStudyPagedSourceWithClientV1(c:PoolClient,execution:Pick<SignalStudyExecutionRecordV1,'id'|'workspace_id'|'configuration_id'|'source_roots'|'source_header'|'source_digest'>):Promise<StudyRuntimeSourceV1>{
 const header=execution.source_header,manifest=header.source_storage as {contract_version?:unknown;root_count?:unknown}|undefined;
 if(manifest?.contract_version!==STUDY_SOURCE_PAGES_V1||manifest.root_count!==execution.source_roots||execution.source_roots>MAX_ROOTS)fail('source_manifest_invalid');
 const cfg=(await c.query<SignalStudyConfigurationRecordV1>('SELECT * FROM signal_study_configurations WHERE id=$1 AND workspace_id=$2',[execution.configuration_id,execution.workspace_id])).rows[0];if(!cfg)fail('configuration_unavailable');
 if(digest(cfg.envelope)!==digest(header.configuration))fail('source_configuration_changed');
 const pages=await createStudySourcePagesV1();let count=0,cursor:string|undefined;
 const joins=`FROM signal_study_source_roots saved JOIN signal_corpus_text_assets asset ON asset.workspace_id=saved.workspace_id AND asset.text_sha256=saved.asset_sha256 AND asset.chunk_policy_version=saved.chunk_policy_version
  JOIN signal_mass_labeling_items item ON item.map_id=saved.map_id AND item.root_id=saved.root_id AND item.workspace_id=saved.workspace_id
  JOIN signal_workspace_chunk_embeddings cached ON cached.workspace_id=saved.workspace_id AND cached.config_digest=saved.embedding_config_digest AND cached.chunk_sha256=saved.chunk_sha256
  WHERE saved.execution_id=$1 AND saved.workspace_id=$2 AND($3::uuid IS NULL OR saved.root_id>$3::uuid)`;
 try{
  for(;;){
   const weights=(await c.query<{root_id:string;working_bytes:string}>(`/* study_frozen_source_page_metadata_v1 */ SELECT saved.root_id,(16::bigint*(octet_length(asset.full_text)+2*octet_length(cached.embedding::text)+2*octet_length(saved.proof_json)+octet_length(saved.base_cache::text)+octet_length(saved.attributes::text)+octet_length(saved.private_person_names::text)+cardinality(saved.question_cache_ids)*2048+16384)+8192)::text working_bytes ${joins} ORDER BY saved.root_id LIMIT 513`,[execution.id,execution.workspace_id,cursor??null])).rows;
   const ids=selectLabelingInputPrefixV1(weights,{max_rows:512,max_working_bytes:STUDY_SOURCE_PAGE_WORKING_BYTES_V1,on_oversize:'error'});if(!ids.length)break;
   const rows=(await c.query<{root_id:string;asset_sha256:string;fragment:string;full_text:string;vector_json:string;source:NativeRow&{proof_json:string;proof_digest:string;native_vector_sha256:string;private_person_names:string[]}}>(`/* study_frozen_source_page_hydrate_v1 */ SELECT saved.root_id,saved.asset_sha256,asset.full_text,item.text fragment,cached.embedding::text vector_json,to_jsonb(saved) source ${joins} AND saved.root_id=ANY($4::uuid[]) ORDER BY saved.root_id`,[execution.id,execution.workspace_id,cursor??null,ids])).rows;
   if(rows.length!==ids.length||rows.some((row,i)=>row.root_id!==ids[i]))fail('source_census_changed');
   const cache=await cacheFor(c,execution.workspace_id,[...new Set(rows.flatMap(row=>row.source.question_cache_ids))]);
   for(const row of rows){const root=hydrateFrozenStudySourceRootV1({...row,source:row.source as unknown as Record<string,unknown>},cache);await pages.append(root,row.source);count++;}
   if(count>execution.source_roots)fail('source_census_changed');cursor=ids.at(-1)!;
  }
  if(count!==execution.source_roots)fail('source_census_incomplete');const complete=await pages.finish();
  if(digest(header.source_storage)!==digest(complete.manifest))fail('source_manifest_changed');
  const source=bindStudySourcePagesV1({...header,configuration:cfg.envelope,roots:complete.roots,source_digest:execution.source_digest}as StudyRuntimeSourceV1,pages);
  if(digest(header)!==execution.source_digest)fail('source_digest_invalid');return source;
 }catch(error){await pages.dispose();throw error;}
}
