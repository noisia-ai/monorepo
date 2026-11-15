import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {signalStudyConfiguredCutV1,signalStudyJevTargetDigestV1,validateSignalStudyExecutionConfigurationV1,type SignalStudyExecutionConfigurationV1} from '@noisia/query-engine';
import type {StudyRuntimeRootV1,StudyRuntimeSourceV1} from '../../services/workers/src/workers/signal-study-runtime';
import {studyDigestV1 as digest,studyFailV1 as fail,type SignalStudyConfigurationRecordV1,type SignalStudyExecutionRecordV1} from './signal-study-core';
export function signalStudySourceUrlStateV1(value:string):'valid'|'missing'|'invalid'{if(!value.trim())return'missing';try{const url=new URL(value);return['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?'valid':'invalid';}catch{return'invalid';}}
export const STUDY_SOURCE_MAX_ROOTS_V1=32768;
export const STUDY_SOURCE_MAX_BYTES_V1=128*1024*1024;
const sha=(body:string)=>'sha256:'+createHash('sha256').update(body).digest('hex');
const baseSql=`FROM signal_study_configuration_sources_v1 snapshot
 JOIN signal_listening_configurations cfg ON cfg.id=snapshot.configuration_id AND cfg.workspace_id=snapshot.workspace_id
 JOIN signal_listening_discovery_roots frozen ON frozen.generation_id=snapshot.generation_id AND frozen.workspace_id=snapshot.workspace_id
 JOIN signal_mass_labeling_maps map ON map.id=snapshot.map_id AND map.workspace_id=snapshot.workspace_id
 JOIN signal_mass_labeling_items item ON item.map_id=map.id AND item.workspace_id=map.workspace_id AND item.root_id=frozen.root_id
 JOIN mentions mention ON mention.id=item.root_id AND mention.workspace_id=item.workspace_id AND mention.canonical_mention_id=mention.id AND mention.inclusion_status='included'
 LEFT JOIN signal_corpus_preparation_items prepared ON prepared.workspace_id=item.workspace_id AND prepared.run_id=map.preparation_run_id AND prepared.root_id=item.root_id AND prepared.disposition='eligible'
 LEFT JOIN signal_corpus_text_assets asset ON asset.workspace_id=item.workspace_id AND asset.text_sha256=prepared.asset_sha256 AND asset.chunk_policy_version=prepared.chunk_policy_version
 LEFT JOIN LATERAL(SELECT asset.chunks->'chunks'->item.chunk_index value) chunk ON true
 LEFT JOIN signal_workspace_chunk_embeddings cached ON cached.workspace_id=item.workspace_id AND cached.config_digest=map.embedding_config_digest AND cached.chunk_sha256=item.chunk_sha256
 LEFT JOIN signal_workspace_embedding_calls embedding ON embedding.id=cached.call_id AND embedding.workspace_id=cached.workspace_id AND embedding.status='settled'
 LEFT JOIN signal_workspace_embedding_runs embedding_run ON embedding_run.id=embedding.run_id AND embedding_run.workspace_id=embedding.workspace_id
 CROSS JOIN LATERAL(SELECT COALESCE(jsonb_object_agg(q.question_key,jsonb_build_object('answer',a.answer,'call_id',a.call_id,'question_digest',q.question_digest)),'{}'::jsonb) cache,
  COALESCE(jsonb_object_agg(q.question_key,CASE WHEN a.answer->>'type'='choice' THEN jsonb_build_array(a.answer->>'choice')
   WHEN(a.answer->>'noul')::numeric>=.7 THEN '["positive"]'::jsonb WHEN(a.answer->>'noul')::numeric<=.3 THEN '["negative"]'::jsonb ELSE '["uncertain"]'::jsonb END),'{}'::jsonb) attributes
  FROM signal_listening_answers a JOIN signal_listening_questions q ON q.configuration_id=cfg.id AND q.question_digest=a.question_digest AND q.workspace_id=a.workspace_id
  JOIN signal_labeling_calls call ON call.id=a.call_id AND call.workspace_id=a.workspace_id AND call.status='settled' AND call.raw_storage_verified_at IS NOT NULL
   AND call.raw_storage_verified_key=call.raw_storage_key AND call.results_applied
  WHERE a.workspace_id=item.workspace_id AND a.root_id=item.root_id AND a.input_digest=frozen.proof->>'input_digest' AND a.entity_context_digest=map.entity_context_digest) answers
 CROSS JOIN LATERAL(SELECT ARRAY(SELECT e->>'question_key' FROM jsonb_array_elements(frozen.proof->'evaluations') e
  WHERE COALESCE((e->>'human_belongs')::boolean,(e->>'probability')::numeric>=.7) ORDER BY e->>'question_key') keys) topics
 CROSS JOIN LATERAL(SELECT answers.attributes||COALESCE((SELECT jsonb_object_agg(e->>'question_key',CASE WHEN e->>'human_belongs'='true' THEN '["positive"]'::jsonb WHEN e->>'human_belongs'='false' THEN '["negative"]'::jsonb WHEN(e->>'probability')::numeric>=.7 THEN '["positive"]'::jsonb WHEN(e->>'probability')::numeric<=.3 THEN '["negative"]'::jsonb WHEN e->>'probability' IS NOT NULL THEN '["uncertain"]'::jsonb ELSE '[]'::jsonb END) FROM jsonb_array_elements(frozen.proof->'evaluations') e),'{}'::jsonb)||jsonb_build_object('platform',jsonb_build_array(COALESCE(mention.platform,'unknown')),'channel',jsonb_build_array(COALESCE(mention.platform,'unknown')),'topic',to_jsonb(topics.keys)) value) attributes
 CROSS JOIN LATERAL(SELECT COALESCE(array_agg(a.id ORDER BY a.id),'{}'::uuid[]) ids,COALESCE(sum(octet_length(a.answer::text)+1024),0)::bigint bytes
  FROM signal_study_answers a WHERE a.workspace_id=item.workspace_id AND a.root_id=item.root_id AND a.target_digest=$4
   AND a.state_sha256 IN(prepared.asset_sha256,item.chunk_sha256)) hints
 WHERE snapshot.study_configuration_id=$1 AND snapshot.workspace_id=$2 AND($5::uuid[] IS NULL OR frozen.root_id=ANY($5))`;
const filteredSql=`mention.published_at>=($3::jsonb#>>'{study,cut,start_at}')::timestamptz AND mention.published_at<($3::jsonb#>>'{study,cut,end_at}')::timestamptz
 AND NOT EXISTS(SELECT 1 FROM jsonb_each($3::jsonb#>'{study,cut,filters}') f WHERE NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements_text(f.value) allowed(value) WHERE attributes.value->f.key ? allowed.value))`;
const eligibleSql=`frozen.proof->'in_category'='true'::jsonb AND answers.cache ?& ARRAY['voice','promotion']`;
const validSql=`asset.text_sha256 IS NOT NULL AND embedding.id IS NOT NULL AND embedding.config_digest=map.embedding_config_digest
 AND embedding.http_status=200 AND embedding.response_digest IS NOT NULL AND embedding_run.profile->>'model'='voyage-4-large'
 AND chunk.value->>'sha256'=item.chunk_sha256 AND cached.response_index=array_position(embedding.input_keys,item.chunk_sha256)-1
 AND vector_norm(cached.embedding)>0 AND vector_dims(cached.embedding)=1024`;
const rowFields=`frozen.root_id,frozen.proof_digest listening_proof_digest,frozen.proof->'evaluations' listening_evaluations,frozen.proof->>'input_digest' input_digest,map.preparation_run_id corpus_preparation_run_id,map.entity_context_digest,
 asset.text_sha256 asset_sha256,prepared.chunk_policy_version,item.chunk_sha256,item.chunk_index,(chunk.value->>'start')::int start_offset,(chunk.value->>'end')::int end_offset,
 asset.full_text,item.text fragment,cached.embedding::text vector_json,cached.response_index embedding_response_index,embedding.id embedding_call_id,embedding.run_id embedding_run_id,
 embedding_run.preparation_run_id embedding_preparation_run_id,embedding_run.input_contract embedding_input_contract,embedding_run.profile embedding_profile,
 embedding.request_digest embedding_request_digest,embedding.batch_digest embedding_batch_digest,embedding.response_digest embedding_raw_sha256,map.embedding_config_digest,
 answers.cache base_cache,attributes.value attributes,topics.keys listening_topic_keys,hints.ids question_cache_ids,
 mention.published_at occurred_at,COALESCE(mention.platform,'unknown') channel,COALESCE(mention.url,'') source_url`;
type NativeRow={root_id:string;listening_proof_digest:string;listening_evaluations:unknown[];input_digest:string;corpus_preparation_run_id:string;entity_context_digest:string;asset_sha256:string;chunk_policy_version:string;chunk_sha256:string;chunk_index:number;
 start_offset:number;end_offset:number;full_text:string;fragment:string;vector_json:string;embedding_call_id:string;embedding_run_id:string;embedding_preparation_run_id:string|null;
 embedding_response_index:number;embedding_input_contract:string;embedding_profile:Record<string,unknown>;embedding_request_digest:string;embedding_batch_digest:string;embedding_raw_sha256:string;embedding_config_digest:string;
 base_cache:Record<string,{answer:StudyRuntimeRootV1['base_answers'][string];call_id:string;question_digest:string}>;attributes:Record<string,string[]>;listening_topic_keys:string[];question_cache_ids:string[];
 occurred_at:Date|string;channel:string;source_url:string};
function params(cfg:SignalStudyConfigurationRecordV1,ids:string[]|null=null){return[cfg.id,cfg.workspace_id,JSON.stringify(cfg.envelope),signalStudyJevTargetDigestV1(cfg.envelope),ids];}
export async function prepareSignalStudySourceWithClientV1(c:PoolClient,cfg:SignalStudyConfigurationRecordV1,executionId:string,metadata:{query_terms:string[];problem_terms:string[]}){
 const configuration=validateSignalStudyExecutionConfigurationV1(cfg.envelope),validFilters=new Set(['platform','channel','topic',...configuration.source_listening.configuration.questions.map(q=>q.key)]);
 if(Object.keys(configuration.study.cut.filters).some(key=>!validFilters.has(key)))fail('cut_filter_invalid',422);
 const bound=(await c.query<{eligible:number;pending_base:number;invalid:number;working_bytes:string;ids:string[]}>(`WITH selected AS MATERIALIZED(SELECT frozen.root_id,${eligibleSql} eligible,NOT(answers.cache ?& ARRAY['voice','promotion']) pending,
  NOT COALESCE(${validSql},false) invalid,
  (4*(COALESCE(octet_length(asset.full_text),0)+COALESCE(octet_length(cached.embedding::text),0)+octet_length(answers.cache::text)+octet_length(attributes.value::text)+hints.bytes+4096)+8192)::bigint working_bytes
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
 const records=rows.map(row=>{
  if(sha(row.full_text)!==row.asset_sha256||sha(row.fragment)!==row.chunk_sha256||row.full_text.slice(row.start_offset,row.end_offset)!==row.fragment||row.fragment.length>1400)fail('fragment_provenance_invalid');
  const vector=JSON.parse(row.vector_json) as number[];if(vector.length!==1024||vector.some(v=>!Number.isFinite(v))||Math.abs(Math.hypot(...vector)-1)>.0001)fail('cached_vector_invalid');
  const proof={contract_version:'signal-study-cached-vector-source-proof-v1',workspace_id:cfg.workspace_id,execution_id:executionId,root_id:row.root_id,input_digest:row.input_digest,
   source_text_sha256:row.chunk_sha256,original_source_text_sha256:row.asset_sha256,chunk_sha256:row.chunk_sha256,
   selected_fragment:{start:row.start_offset,end:row.end_offset,text_sha256:row.chunk_sha256},corpus_preparation_run_id:row.corpus_preparation_run_id,
   embedding_call_id:row.embedding_call_id,embedding_run_id:row.embedding_run_id,embedding_preparation_run_id:row.embedding_preparation_run_id,
   embedding_input_contract:row.embedding_input_contract,embedding_response_index:row.embedding_response_index,embedding_raw_sha256:row.embedding_raw_sha256,embedding_request_digest:row.embedding_request_digest,
   embedding_batch_digest:row.embedding_batch_digest,embedding_chunk_sha256:row.chunk_sha256,embedding_model:row.embedding_profile.model,embedding_profile:row.embedding_profile,
   embedding_config_digest:row.embedding_config_digest,context_digest:row.entity_context_digest,embedding_sha256:sha(row.vector_json),base_cache:row.base_cache,listening_proof_digest:row.listening_proof_digest,listening_evaluations:row.listening_evaluations};
  const proof_json=JSON.stringify(proof),proof_digest=sha(proof_json);
  const cache=row.question_cache_ids.map(id=>{const saved=cacheById.get(id);if(!saved||saved.root_id!==row.root_id)fail('question_cache_provenance_invalid');return saved.answer;});
  const root:StudyRuntimeRootV1={root_id:row.root_id,text:row.full_text,text_sha256:row.asset_sha256,vector,occurred_at:new Date(row.occurred_at).toISOString(),channel:row.channel,source_url:row.source_url,
   listening_topic_keys:row.listening_topic_keys,private_person_names:[],attributes:row.attributes,base_answers:{voice:row.base_cache.voice!.answer,promotion:row.base_cache.promotion!.answer},question_cache:cache,
   selected_fragment:{text:row.fragment,text_sha256:row.chunk_sha256,start:row.start_offset,end:row.end_offset},
   embedding_proof:{embedding_call_id:row.embedding_call_id,embedding_run_id:row.embedding_run_id,preparation_run_id:row.embedding_preparation_run_id,input_contract:row.embedding_input_contract,
    text_sha256:row.chunk_sha256,vector_digest:digest(vector),proof_json,proof_digest,vector_json:row.vector_json}};
  if(signalStudyConfiguredCutV1({configuration,text:root.text,occurred_at:root.occurred_at,answers:root.base_answers,attributes:root.attributes})!=='included')fail('native_cut_mismatch');
  return{row,root,proof_json,proof_digest};
 });
 const baseline=(await c.query<{corpus:number;brand:number}>(`SELECT count(*)::int corpus,count(*) FILTER(WHERE mention.published_at>=($3::jsonb#>>'{study,cut,start_at}')::timestamptz AND mention.published_at<($3::jsonb#>>'{study,cut,end_at}')::timestamptz)::int brand
  FROM signal_study_configuration_sources_v1 snapshot JOIN signal_listening_discovery_roots r ON r.generation_id=snapshot.generation_id AND r.workspace_id=snapshot.workspace_id
  JOIN mentions mention ON mention.id=r.root_id AND mention.workspace_id=r.workspace_id WHERE snapshot.study_configuration_id=$1 AND snapshot.workspace_id=$2 AND signal_listening_root_right_v1(r.workspace_id,r.root_id,'client-derived-metrics')`,params(cfg).slice(0,3))).rows[0]!;
 const roots=records.map(r=>r.root),evidence_source_census={valid_url_roots:roots.filter(r=>signalStudySourceUrlStateV1(r.source_url)==='valid').length,missing_url_roots:roots.filter(r=>signalStudySourceUrlStateV1(r.source_url)==='missing').length,invalid_url_roots:roots.filter(r=>signalStudySourceUrlStateV1(r.source_url)==='invalid').length};
 const binding=(await c.query<{source_kind:'serving'|'human_edit';id:string;configuration_id:string;generation_id:string;snapshot_digest:string;base_snapshot_id:string}>('SELECT * FROM signal_study_configuration_sources_v1 WHERE study_configuration_id=$1 AND workspace_id=$2',[cfg.id,cfg.workspace_id])).rows[0];if(!binding)fail('listening_source_unavailable');
 const listening_source_binding={kind:binding.source_kind,id:binding.id,configuration_id:binding.configuration_id,generation_id:binding.generation_id,source_digest:binding.snapshot_digest,base_snapshot_id:binding.base_snapshot_id};
 const body:Omit<StudyRuntimeSourceV1,'source_digest'>&{evidence_source_census:typeof evidence_source_census;listening_source_binding:typeof listening_source_binding}={configuration,roots,evidence_source_census,listening_source_binding,
  selection:{scope:'listening_consumer_cut',source_listening_digest:configuration.source_listening.configuration_digest,cut_digest:digest(configuration.study.cut),eligible_root_ids_digest:digest(roots.map(r=>r.root_id).sort()),eligible_roots:roots.length,pending_base_roots:0,corpus_roots:baseline.corpus},
  embedding_space_digest:rows[0]?.embedding_config_digest??String((await c.query('SELECT m.embedding_config_digest FROM signal_study_configuration_sources_v1 s JOIN signal_mass_labeling_maps m ON m.id=s.map_id WHERE s.study_configuration_id=$1',[cfg.id])).rows[0].embedding_config_digest),
  source_preparation_run_ids:[...new Set(rows.flatMap(r=>r.embedding_preparation_run_id?[r.embedding_preparation_run_id]:[]))].sort(),sampling_seed:digest({execution_id:executionId,study_digest:configuration.study_digest}),
  query_terms:metadata.query_terms,problem_terms:metadata.problem_terms,query_metadata:{query_terms_declared:metadata.query_terms.length>0,problem_terms_declared:metadata.problem_terms.length>0},brand_baseline_roots:baseline.brand,human_revision_digest:cfg.human_revision_digest,max_roots:STUDY_SOURCE_MAX_ROOTS_V1,max_bytes:STUDY_SOURCE_MAX_BYTES_V1};
 const source={...body,source_digest:digest(body)};if(Buffer.byteLength(JSON.stringify(source))>STUDY_SOURCE_MAX_BYTES_V1)fail('source_requires_paged_spool',422);
 return{source,records,census:digest(records.map(r=>[r.row.root_id,r.proof_digest])),working_bytes:bound.working_bytes};
}

/** Reload the exact cut and frozen cache hints. Source metadata never switches
 * to latest Listening or hydrates an outside-cut root. */
export async function readSignalStudySourceWithClientV1(c:PoolClient,execution:SignalStudyExecutionRecordV1):Promise<StudyRuntimeSourceV1>{
 const cfg=(await c.query<SignalStudyConfigurationRecordV1>('SELECT * FROM signal_study_configurations WHERE id=$1 AND workspace_id=$2',[execution.configuration_id,execution.workspace_id])).rows[0]!;
 const bounds=(await c.query<{n:number;bytes:string}>(`SELECT count(*)::int n,COALESCE(sum(4*(octet_length(asset.full_text)+octet_length(cached.embedding::text)+octet_length(saved.base_cache::text)+octet_length(saved.attributes::text)+octet_length(saved.proof_json)+8192+cardinality(saved.question_cache_ids)*2048)),0)::text bytes
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
 for(const row of rows){const saved=row.source as unknown as NativeRow&{proof_json:string;proof_digest:string;native_vector_sha256:string;private_person_names:string[]};
  if(sha(row.full_text)!==saved.asset_sha256||sha(row.vector_json)!==saved.native_vector_sha256||sha(row.fragment)!==saved.chunk_sha256||row.full_text.slice(saved.start_offset,saved.end_offset)!==row.fragment)fail('source_changed');
  const proof=JSON.parse(saved.proof_json),cache=saved.question_cache_ids.map(id=>{const hit=cacheById.get(id);if(!hit||hit.root_id!==row.root_id)fail('question_cache_provenance_invalid');return hit.answer;});
  const vector=JSON.parse(row.vector_json) as number[];
  roots.push({root_id:row.root_id,text:row.full_text,text_sha256:saved.asset_sha256,vector,occurred_at:new Date(saved.occurred_at).toISOString(),channel:saved.channel,source_url:saved.source_url,listening_topic_keys:saved.listening_topic_keys,private_person_names:saved.private_person_names,
   attributes:saved.attributes,base_answers:{voice:saved.base_cache.voice!.answer,promotion:saved.base_cache.promotion!.answer},question_cache:cache as StudyRuntimeRootV1['question_cache'],
   selected_fragment:{text:row.fragment,text_sha256:saved.chunk_sha256,start:saved.start_offset,end:saved.end_offset},embedding_proof:{embedding_call_id:saved.embedding_call_id,embedding_run_id:saved.embedding_run_id,preparation_run_id:proof.embedding_preparation_run_id,input_contract:proof.embedding_input_contract,
    vector_digest:digest(vector),text_sha256:saved.chunk_sha256,proof_json:saved.proof_json,proof_digest:saved.proof_digest,vector_json:row.vector_json}});
 }
 const source={...execution.source_header,configuration:cfg.envelope,roots,source_digest:execution.source_digest} as StudyRuntimeSourceV1;
 const{source_digest,...body}=source;if(digest(body)!==source_digest)fail('source_digest_invalid');return source;
}
