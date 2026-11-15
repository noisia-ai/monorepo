import {createHash} from 'node:crypto';
import{signalStudyKnownAuthorPrivacyV1,type SignalStudyAuthorMetadataV1}from'./signal-study-author-privacy';
import{signalStudyConfiguredCutV1}from'@noisia/query-engine';
import type{StudyRuntimeRootV1}from'../../services/workers/src/workers/signal-study-runtime';
import{studyDigestV1 as digest,studyFailV1 as fail,type SignalStudyConfigurationRecordV1}from'./signal-study-core';
const sha=(body:string)=>'sha256:'+createHash('sha256').update(body).digest('hex');
export const baseSql=`FROM signal_study_configuration_sources_v1 snapshot
 JOIN signal_listening_configurations cfg ON cfg.id=snapshot.configuration_id AND cfg.workspace_id=snapshot.workspace_id
 JOIN signal_listening_discovery_roots frozen ON frozen.generation_id=snapshot.generation_id AND frozen.workspace_id=snapshot.workspace_id
 JOIN signal_mass_labeling_maps map ON map.id=snapshot.map_id AND map.workspace_id=snapshot.workspace_id
 JOIN signal_mass_labeling_items item ON item.map_id=map.id AND item.workspace_id=map.workspace_id AND item.root_id=frozen.root_id
 JOIN mentions mention ON mention.id=item.root_id AND mention.workspace_id=item.workspace_id AND mention.canonical_mention_id=mention.id AND mention.inclusion_status='included'
 LEFT JOIN authors mention_author ON mention_author.id=mention.author_id
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
export const filteredSql=`mention.published_at>=($3::jsonb#>>'{study,cut,start_at}')::timestamptz AND mention.published_at<($3::jsonb#>>'{study,cut,end_at}')::timestamptz
 AND NOT EXISTS(SELECT 1 FROM jsonb_each($3::jsonb#>'{study,cut,filters}') f WHERE NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements_text(f.value) allowed(value) WHERE attributes.value->f.key ? allowed.value))`;
export const eligibleSql=`frozen.proof->'in_category'='true'::jsonb AND answers.cache ?& ARRAY['voice','promotion']`;
export const validSql=`asset.text_sha256 IS NOT NULL AND embedding.id IS NOT NULL AND embedding.config_digest=map.embedding_config_digest
 AND embedding.http_status=200 AND embedding.response_digest IS NOT NULL AND embedding_run.profile->>'model'='voyage-4-large'
 AND chunk.value->>'sha256'=item.chunk_sha256 AND cached.response_index=array_position(embedding.input_keys,item.chunk_sha256)-1
 AND vector_norm(cached.embedding)>0 AND vector_dims(cached.embedding)=1024`;
export const rowFields=`frozen.root_id,frozen.proof_digest listening_proof_digest,frozen.proof->'evaluations' listening_evaluations,frozen.proof->>'input_digest' input_digest,map.preparation_run_id corpus_preparation_run_id,map.entity_context_digest,
 asset.text_sha256 asset_sha256,prepared.chunk_policy_version,item.chunk_sha256,item.chunk_index,(chunk.value->>'start')::int start_offset,(chunk.value->>'end')::int end_offset,
 asset.full_text,item.text fragment,cached.embedding::text vector_json,cached.response_index embedding_response_index,embedding.id embedding_call_id,embedding.run_id embedding_run_id,
 embedding_run.preparation_run_id embedding_preparation_run_id,embedding_run.input_contract embedding_input_contract,embedding_run.profile embedding_profile,
 embedding.request_digest embedding_request_digest,embedding.batch_digest embedding_batch_digest,embedding.response_digest embedding_raw_sha256,map.embedding_config_digest,
 answers.cache base_cache,attributes.value attributes,topics.keys listening_topic_keys,hints.ids question_cache_ids,
 mention.published_at occurred_at,COALESCE(mention.platform,'unknown') channel,COALESCE(mention.url,'') source_url,mention.author_id source_author_id,mention.source_author_label_recorded,CASE WHEN mention.source_author_label_recorded THEN mention.source_author_label END source_author_label,
 CASE WHEN NOT mention.source_author_label_recorded AND jsonb_typeof(mention.raw_metadata->'author')='string' THEN mention.raw_metadata->>'author' END legacy_author,
 CASE WHEN NOT mention.source_author_label_recorded THEN mention_author.display_name END linked_author_display_name,CASE WHEN NOT mention.source_author_label_recorded THEN mention_author.handle END linked_author_handle`;
export type NativeRow=SignalStudyAuthorMetadataV1&{source_author_id:string|null;root_id:string;listening_proof_digest:string;listening_evaluations:unknown[];input_digest:string;corpus_preparation_run_id:string;entity_context_digest:string;asset_sha256:string;chunk_policy_version:string;chunk_sha256:string;chunk_index:number;
 start_offset:number;end_offset:number;full_text:string;fragment:string;vector_json:string;embedding_call_id:string;embedding_run_id:string;embedding_preparation_run_id:string|null;
 embedding_response_index:number;embedding_input_contract:string;embedding_profile:Record<string,unknown>;embedding_request_digest:string;embedding_batch_digest:string;embedding_raw_sha256:string;embedding_config_digest:string;
 base_cache:Record<string,{answer:StudyRuntimeRootV1['base_answers'][string];call_id:string;question_digest:string}>;attributes:Record<string,string[]>;listening_topic_keys:string[];question_cache_ids:string[];
 occurred_at:Date|string;channel:string;source_url:string};

export type StudySourceCacheValueV1=NonNullable<StudyRuntimeRootV1['question_cache']>[number];
export function hydrateStudySourceNativeRowV1(row:NativeRow,cfg:SignalStudyConfigurationRecordV1,executionId:string,
 configuration:SignalStudyConfigurationRecordV1['envelope'],cacheById:Map<string,{root_id:string;answer:StudySourceCacheValueV1}>){

  if(sha(row.full_text)!==row.asset_sha256||sha(row.fragment)!==row.chunk_sha256||row.full_text.slice(row.start_offset,row.end_offset)!==row.fragment||row.fragment.length>1400)fail('fragment_provenance_invalid');
  const privacy=signalStudyKnownAuthorPrivacyV1(row);
  const vector=JSON.parse(row.vector_json) as number[];if(vector.length!==1024||vector.some(v=>!Number.isFinite(v))||Math.abs(Math.hypot(...vector)-1)>.0001)fail('cached_vector_invalid');
  const proof={contract_version:'signal-study-cached-vector-source-proof-v1',workspace_id:cfg.workspace_id,execution_id:executionId,root_id:row.root_id,input_digest:row.input_digest,
   source_text_sha256:row.chunk_sha256,original_source_text_sha256:row.asset_sha256,chunk_sha256:row.chunk_sha256,
   selected_fragment:{start:row.start_offset,end:row.end_offset,text_sha256:row.chunk_sha256},corpus_preparation_run_id:row.corpus_preparation_run_id,
   embedding_call_id:row.embedding_call_id,embedding_run_id:row.embedding_run_id,embedding_preparation_run_id:row.embedding_preparation_run_id,
   embedding_input_contract:row.embedding_input_contract,embedding_response_index:row.embedding_response_index,embedding_raw_sha256:row.embedding_raw_sha256,embedding_request_digest:row.embedding_request_digest,
   embedding_batch_digest:row.embedding_batch_digest,embedding_chunk_sha256:row.chunk_sha256,embedding_model:row.embedding_profile.model,embedding_profile:row.embedding_profile,
   embedding_config_digest:row.embedding_config_digest,context_digest:row.entity_context_digest,embedding_sha256:sha(row.vector_json),base_cache:row.base_cache,listening_proof_digest:row.listening_proof_digest,listening_evaluations:row.listening_evaluations,author_privacy:{contract_version:privacy.contract_version,provenance:privacy.provenance,author_id:row.source_author_id,metadata_snapshot:privacy.metadata_snapshot,metadata_digest:privacy.metadata_digest,roster_digest:privacy.roster_digest}};
  const proof_json=JSON.stringify(proof),proof_digest=sha(proof_json);
  const cache=row.question_cache_ids.map(id=>{const saved=cacheById.get(id);if(!saved||saved.root_id!==row.root_id)fail('question_cache_provenance_invalid');return saved.answer;});
  const root:StudyRuntimeRootV1={root_id:row.root_id,text:row.full_text,text_sha256:row.asset_sha256,vector,occurred_at:new Date(row.occurred_at).toISOString(),channel:row.channel,source_url:row.source_url,
   listening_topic_keys:row.listening_topic_keys,private_person_names:privacy.private_person_names,attributes:row.attributes,base_answers:{voice:row.base_cache.voice!.answer,promotion:row.base_cache.promotion!.answer},question_cache:cache,
   selected_fragment:{text:row.fragment,text_sha256:row.chunk_sha256,start:row.start_offset,end:row.end_offset},
   embedding_proof:{embedding_call_id:row.embedding_call_id,embedding_run_id:row.embedding_run_id,preparation_run_id:row.embedding_preparation_run_id,input_contract:row.embedding_input_contract,
    text_sha256:row.chunk_sha256,vector_digest:digest(vector),proof_json,proof_digest,vector_json:row.vector_json}};
  if(signalStudyConfiguredCutV1({configuration,text:root.text,occurred_at:root.occurred_at,answers:root.base_answers,attributes:root.attributes})!=='included')fail('native_cut_mismatch');
  return{row:{...row,private_person_names:privacy.private_person_names},root,proof_json,proof_digest};
}

export function hydrateFrozenStudySourceRootV1(row:{root_id:string;asset_sha256:string;full_text:string;fragment:string;vector_json:string;source:Record<string,unknown>},cacheById:Map<string,{root_id:string;answer:StudySourceCacheValueV1}>):StudyRuntimeRootV1{
const saved=row.source as unknown as NativeRow&{proof_json:string;proof_digest:string;native_vector_sha256:string;private_person_names:string[]};
  if(sha(row.full_text)!==saved.asset_sha256||sha(row.vector_json)!==saved.native_vector_sha256||sha(row.fragment)!==saved.chunk_sha256||row.full_text.slice(saved.start_offset,saved.end_offset)!==row.fragment)fail('source_changed');
  const proof=JSON.parse(saved.proof_json);if(proof.author_privacy&&(proof.author_privacy.roster_digest!==digest(saved.private_person_names)||proof.author_privacy.metadata_digest!==digest(proof.author_privacy.metadata_snapshot)))fail('author_privacy_provenance_invalid');
  const cache=saved.question_cache_ids.map(id=>{const hit=cacheById.get(id);if(!hit||hit.root_id!==row.root_id)fail('question_cache_provenance_invalid');return hit.answer;});
  const vector=JSON.parse(row.vector_json) as number[];
  return{root_id:row.root_id,text:row.full_text,text_sha256:saved.asset_sha256,vector,occurred_at:new Date(saved.occurred_at).toISOString(),channel:saved.channel,source_url:saved.source_url,listening_topic_keys:saved.listening_topic_keys,private_person_names:saved.private_person_names,
   attributes:saved.attributes,base_answers:{voice:saved.base_cache.voice!.answer,promotion:saved.base_cache.promotion!.answer},question_cache:cache as StudyRuntimeRootV1['question_cache'],
   selected_fragment:{text:row.fragment,text_sha256:saved.chunk_sha256,start:saved.start_offset,end:saved.end_offset},embedding_proof:{embedding_call_id:saved.embedding_call_id,embedding_run_id:saved.embedding_run_id,preparation_run_id:proof.embedding_preparation_run_id,input_contract:proof.embedding_input_contract,
    vector_digest:digest(vector),text_sha256:saved.chunk_sha256,proof_json:saved.proof_json,proof_digest:saved.proof_digest,vector_json:row.vector_json}};
}
