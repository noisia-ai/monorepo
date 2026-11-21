import type{SignalStudyQueryMetadataV1}from'./signal-study-query-metadata';
import{SIGNAL_STUDY_BOUNDARY_RULE_VERSION_V1}from'@noisia/query-engine';
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {signalStudyJevTargetDigestV1,validateSignalStudyExecutionConfigurationV1,signalStudySourceUrlStateV1,SIGNAL_STUDY_EDITORIAL_COMPILER_V2} from '@noisia/query-engine';
import type {StudyRuntimeRootV1,StudyRuntimeSourceV1} from '../../services/workers/src/workers/signal-study-runtime';
import {studyDigestV1 as digest,studyFailV1 as fail,type SignalStudyConfigurationRecordV1,type SignalStudyExecutionRecordV1} from './signal-study-core';
export {signalStudySourceUrlStateV1} from '@noisia/query-engine';
export const STUDY_SOURCE_MAX_ROOTS_V1=32768;
export const STUDY_SOURCE_MAX_BYTES_V1=128*1024*1024;
const sha=(body:string)=>'sha256:'+createHash('sha256').update(body).digest('hex');
import{readSignalStudyPagedSourceWithClientV1}from'./signal-study-source-paged';
import{disposeStudySourcePagesV1}from'../../services/workers/src/workers/signal-study-source-pages';
export{prepareSignalStudyPagedSourceWithClientV1 as prepareSignalStudySourceWithClientV1}from'./signal-study-source-paged';
import{baseSql,filteredSql,eligibleSql,validSql,rowFields,hydrateStudySourceNativeRowV1,hydrateFrozenStudySourceRootV1,type NativeRow}from'./signal-study-source-native';
function params(cfg:SignalStudyConfigurationRecordV1,ids:string[]|null=null){return[cfg.id,cfg.workspace_id,JSON.stringify(cfg.envelope),signalStudyJevTargetDigestV1(cfg.envelope),ids];}
export async function prepareSignalStudyInlineSourceWithClientV1(c:PoolClient,cfg:SignalStudyConfigurationRecordV1,executionId:string,metadata:SignalStudyQueryMetadataV1){
 const configuration=validateSignalStudyExecutionConfigurationV1(cfg.envelope),validFilters=new Set(['platform','channel','topic',...configuration.source_listening.configuration.questions.map(q=>q.key)]);
 if(Object.keys(configuration.study.cut.filters).some(key=>!validFilters.has(key)))fail('cut_filter_invalid',422);
 // Author metadata can appear in both the private proof JSON and the roster.
 // Account for both JSON escaping layers BEFORE hydrating those known labels.
 const bound=(await c.query<{eligible:number;pending_base:number;invalid:number;working_bytes:string;ids:string[]}>(`WITH selected AS MATERIALIZED(SELECT frozen.root_id,${eligibleSql} eligible,NOT(answers.cache ?& ARRAY['voice','promotion']) pending,
  NOT COALESCE(${validSql},false) invalid,
  (4*(COALESCE(octet_length(asset.full_text),0)+COALESCE(octet_length(cached.embedding::text),0)+octet_length(answers.cache::text)+octet_length(attributes.value::text)+hints.bytes+12*(CASE WHEN mention.source_author_label_recorded THEN COALESCE(octet_length(mention.source_author_label),0) ELSE COALESCE(octet_length(mention.raw_metadata->>'author'),0)+COALESCE(octet_length(mention_author.display_name),0)+COALESCE(octet_length(mention_author.handle),0) END)+4096)+8192)::bigint working_bytes
  ${baseSql} AND ${filteredSql}) SELECT count(*) FILTER(WHERE eligible)::int eligible,count(*) FILTER(WHERE pending)::int pending_base,
  count(*) FILTER(WHERE eligible AND invalid)::int invalid,COALESCE(sum(working_bytes) FILTER(WHERE eligible),0)::text working_bytes,
  ARRAY(SELECT root_id::text FROM selected WHERE eligible ORDER BY root_id LIMIT ${STUDY_SOURCE_MAX_ROOTS_V1+1}) ids FROM selected`,params(cfg))).rows[0]!;
 if(bound.pending_base)fail('base_pending',409);if(bound.invalid)fail('cached_source_incomplete',409);
 if(bound.eligible>STUDY_SOURCE_MAX_ROOTS_V1||BigInt(bound.working_bytes)>BigInt(4*STUDY_SOURCE_MAX_BYTES_V1))fail('source_requires_paged_spool',422);
 if(bound.ids.length!==bound.eligible)fail('source_census_incomplete');
 const rows=bound.ids.length?(await c.query<NativeRow>(`SELECT ${rowFields} ${baseSql} AND ${filteredSql} AND ${eligibleSql} AND ${validSql} ORDER BY frozen.root_id`,params(cfg,bound.ids))).rows:[];
 if(rows.length!==bound.eligible)fail('source_changed');
 const cacheIds=[...new Set(rows.flatMap(r=>r.question_cache_ids))],cachedRows=cacheIds.length?(await c.query<{id:string;root_id:string;question_key:string;identity_digest:string;state_sha256:string;jev_call_id:string;answer:StudyRuntimeRootV1['base_answers'][string];receipt_page:{page_id:string;sha256:string;verified:true}}>(`SELECT a.id,a.root_id,a.question_key,a.question_identity_digest identity_digest,a.state_sha256,a.call_id jev_call_id,a.answer,
  jsonb_build_object('page_id',p.id,'sha256',p.sha256,'verified',true) receipt_page FROM signal_study_answers a JOIN signal_labeling_raw_pages p ON p.id=a.raw_page_id AND p.status='verified'
  WHERE a.id=ANY($1::uuid[]) AND a.workspace_id=$2 ORDER BY a.id`,[cacheIds,cfg.workspace_id])).rows:[];
 const cacheById=new Map(cachedRows.map(({id,root_id,...answer})=>[id,{root_id,answer}]));
 const records=rows.map(row=>hydrateStudySourceNativeRowV1(row,cfg,executionId,configuration,cacheById));
 const baseline=(await c.query<{corpus:number;brand:number}>(`SELECT count(*)::int corpus,count(*) FILTER(WHERE mention.published_at>=($3::jsonb#>>'{study,cut,start_at}')::timestamptz AND mention.published_at<($3::jsonb#>>'{study,cut,end_at}')::timestamptz)::int brand
  FROM signal_study_configuration_sources_v1 snapshot JOIN signal_listening_discovery_roots r ON r.generation_id=snapshot.generation_id AND r.workspace_id=snapshot.workspace_id
  JOIN mentions mention ON mention.id=r.root_id AND mention.workspace_id=r.workspace_id WHERE snapshot.study_configuration_id=$1 AND snapshot.workspace_id=$2 AND signal_listening_root_right_v1(r.workspace_id,r.root_id,'client-derived-metrics')`,params(cfg).slice(0,3))).rows[0]!;
 const roots=records.map(r=>r.root),evidence_source_census={valid_url_roots:roots.filter(r=>signalStudySourceUrlStateV1(r.source_url)==='valid').length,missing_url_roots:roots.filter(r=>signalStudySourceUrlStateV1(r.source_url)==='missing').length,invalid_url_roots:roots.filter(r=>signalStudySourceUrlStateV1(r.source_url)==='invalid').length};
 const binding=(await c.query<{source_kind:'serving'|'human_edit';id:string;configuration_id:string;generation_id:string;snapshot_digest:string;base_snapshot_id:string}>('SELECT * FROM signal_study_configuration_sources_v1 WHERE study_configuration_id=$1 AND workspace_id=$2',[cfg.id,cfg.workspace_id])).rows[0];if(!binding)fail('listening_source_unavailable');
 const listening_source_binding={kind:binding.source_kind,id:binding.id,configuration_id:binding.configuration_id,generation_id:binding.generation_id,source_digest:binding.snapshot_digest,base_snapshot_id:binding.base_snapshot_id};
 const body:Omit<StudyRuntimeSourceV1,'source_digest'>&{evidence_source_census:typeof evidence_source_census;listening_source_binding:typeof listening_source_binding}={configuration,roots,evidence_source_census,listening_source_binding,editorial_compiler_version:SIGNAL_STUDY_EDITORIAL_COMPILER_V2,layer_boundary_rule_version:SIGNAL_STUDY_BOUNDARY_RULE_VERSION_V1,evidence_association_version:'signal-study-evidence-association-v1' as const,
  selection:{scope:'listening_consumer_cut',source_listening_digest:configuration.source_listening.configuration_digest,cut_digest:digest(configuration.study.cut),eligible_root_ids_digest:digest(roots.map(r=>r.root_id).sort()),eligible_roots:roots.length,pending_base_roots:0,corpus_roots:baseline.corpus},
  embedding_space_digest:rows[0]?.embedding_config_digest??String((await c.query('SELECT m.embedding_config_digest FROM signal_study_configuration_sources_v1 s JOIN signal_mass_labeling_maps m ON m.id=s.map_id WHERE s.study_configuration_id=$1',[cfg.id])).rows[0].embedding_config_digest),
  source_preparation_run_ids:[...new Set(rows.flatMap(r=>r.embedding_preparation_run_id?[r.embedding_preparation_run_id]:[]))].sort(),sampling_seed:digest({execution_id:executionId,study_digest:configuration.study_digest}),
  query_terms:metadata.query_terms,problem_terms:metadata.problem_terms,...(metadata.acquisition_query_metadata?{acquisition_query_metadata:metadata.acquisition_query_metadata}:{}),query_metadata:{query_terms_declared:metadata.acquisition_query_metadata?.complete??metadata.query_terms.length>0,problem_terms_declared:metadata.problem_terms.length>0},brand_baseline_roots:baseline.brand,human_revision_digest:cfg.human_revision_digest,max_roots:STUDY_SOURCE_MAX_ROOTS_V1,max_bytes:STUDY_SOURCE_MAX_BYTES_V1};
 const source={...body,source_digest:digest(body)};if(Buffer.byteLength(JSON.stringify(source))>STUDY_SOURCE_MAX_BYTES_V1)fail('source_requires_paged_spool',422);
 return{source,records,census:digest(records.map(r=>[r.row.root_id,r.proof_digest])),working_bytes:bound.working_bytes};
}

/** Reload the exact cut and frozen cache hints. Source metadata never switches
 * to latest Listening or hydrates an outside-cut root. */
export async function readSignalStudySourceWithClientV1(c:PoolClient,execution:Pick<SignalStudyExecutionRecordV1,'id'|'workspace_id'|'configuration_id'|'source_roots'|'source_header'|'source_digest'>):Promise<StudyRuntimeSourceV1>{
 if(execution.source_header.source_storage!==undefined)return readSignalStudyPagedSourceWithClientV1(c,execution);
 const cfg=(await c.query<SignalStudyConfigurationRecordV1>('SELECT * FROM signal_study_configurations WHERE id=$1 AND workspace_id=$2',[execution.configuration_id,execution.workspace_id])).rows[0]!;
 const bounds=(await c.query<{n:number;bytes:string}>(`SELECT count(*)::int n,COALESCE(sum(4*(octet_length(asset.full_text)+octet_length(cached.embedding::text)+octet_length(saved.base_cache::text)+octet_length(saved.attributes::text)+octet_length(saved.proof_json)+octet_length(saved.private_person_names::text)+8192+cardinality(saved.question_cache_ids)*2048)),0)::text bytes
  FROM signal_study_source_roots saved JOIN signal_corpus_text_assets asset ON asset.workspace_id=saved.workspace_id AND asset.text_sha256=saved.asset_sha256 AND asset.chunk_policy_version=saved.chunk_policy_version
  JOIN signal_workspace_chunk_embeddings cached ON cached.workspace_id=saved.workspace_id AND cached.config_digest=saved.embedding_config_digest AND cached.chunk_sha256=saved.chunk_sha256
  WHERE saved.execution_id=$1 AND saved.workspace_id=$2`,[execution.id,execution.workspace_id])).rows[0]!;
 if(bounds.n!==execution.source_roots||bounds.n>STUDY_SOURCE_MAX_ROOTS_V1||BigInt(bounds.bytes)>BigInt(4*STUDY_SOURCE_MAX_BYTES_V1))fail('source_requires_paged_spool',422);
 const rows=(await c.query<{root_id:string;asset_sha256:string;fragment:string;full_text:string;vector_json:string;source:Record<string,unknown>}>(`SELECT saved.root_id,saved.asset_sha256,asset.full_text,item.text fragment,cached.embedding::text vector_json,to_jsonb(saved) source
  FROM signal_study_source_roots saved JOIN signal_corpus_text_assets asset ON asset.workspace_id=saved.workspace_id AND asset.text_sha256=saved.asset_sha256 AND asset.chunk_policy_version=saved.chunk_policy_version
  JOIN signal_mass_labeling_items item ON item.map_id=saved.map_id AND item.root_id=saved.root_id AND item.workspace_id=saved.workspace_id
  JOIN signal_workspace_chunk_embeddings cached ON cached.workspace_id=saved.workspace_id AND cached.config_digest=saved.embedding_config_digest AND cached.chunk_sha256=saved.chunk_sha256
  WHERE saved.execution_id=$1 AND saved.workspace_id=$2 ORDER BY saved.root_id`,[execution.id,execution.workspace_id])).rows;
 if(rows.length!==execution.source_roots)fail('source_census_incomplete');
 const savedRows=rows.map(r=>r.source as unknown as NativeRow&{proof_json:string;proof_digest:string;native_vector_sha256:string;private_person_names:string[]});
 const allCacheIds=[...new Set(savedRows.flatMap(r=>r.question_cache_ids))],cacheRows=allCacheIds.length?(await c.query<{id:string;root_id:string;question_key:string;identity_digest:string;state_sha256:string;jev_call_id:string;answer:StudyRuntimeRootV1['base_answers'][string];receipt_page:{page_id:string;sha256:string;verified:true}}>(`SELECT a.id,a.root_id,a.question_key,a.question_identity_digest identity_digest,a.state_sha256,a.call_id jev_call_id,a.answer,jsonb_build_object('page_id',p.id,'sha256',p.sha256,'verified',true) receipt_page FROM signal_study_answers a JOIN signal_labeling_raw_pages p ON p.id=a.raw_page_id AND p.status='verified' WHERE a.id=ANY($1::uuid[]) AND a.workspace_id=$2 ORDER BY a.id`,[allCacheIds,execution.workspace_id])).rows:[];
 const cacheById=new Map(cacheRows.map(({id,root_id,...answer})=>[id,{root_id,answer}]));
 const roots:StudyRuntimeRootV1[]=[];
 for(const row of rows)roots.push(hydrateFrozenStudySourceRootV1(row,cacheById));
 const source={...execution.source_header,configuration:cfg.envelope,roots,source_digest:execution.source_digest} as StudyRuntimeSourceV1;
 const{source_digest,...body}=source;if(digest(body)!==source_digest)fail('source_digest_invalid');return source;
}

export async function withSignalStudySourceWithClientV1<T>(c:PoolClient,execution:Parameters<typeof readSignalStudySourceWithClientV1>[1],work:(source:StudyRuntimeSourceV1)=>Promise<T>):Promise<T>{
 const source=await readSignalStudySourceWithClientV1(c,execution);try{return await work(source);}finally{await disposeStudySourcePagesV1(source);}
}
