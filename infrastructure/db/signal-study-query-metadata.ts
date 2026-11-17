import type{PoolClient}from'pg';
import{studyFailV1 as fail,type SignalStudyConfigurationRecordV1}from'./signal-study-core';
export type SignalStudyQueryMetadataV1={query_terms:string[];problem_terms:string[];acquisition_query_metadata?:{
 contract_version:'signal-study-acquisition-query-metadata-v1';complete:boolean;source_batches:number;unavailable_batches:number}};
/** Acquisition include terms are factual provenance, not a classification of
 * problem vocabulary. Missing evidence keeps the bias assessment unknown. */
export async function loadSignalStudyAcquisitionQueryMetadataV1(c:PoolClient,cfg:SignalStudyConfigurationRecordV1):Promise<SignalStudyQueryMetadataV1>{
 const value=(await c.query<{source_batches:number;unavailable_batches:number;terms:string[]}>(`WITH eligible_batches AS MATERIALIZED(
 SELECT batch.id,batch.data_source_id FROM import_batches batch
 JOIN data_sources source ON source.id=batch.data_source_id AND source.workspace_id=$1 AND source.status='active'
 JOIN LATERAL(SELECT b.* FROM signal_provenance_policy_bindings b WHERE b.workspace_id=$1 AND b.data_source_id=batch.data_source_id
   AND b.status='active' AND b.effective_from<=now() AND (b.effective_to IS NULL OR b.effective_to>now())
   AND (b.import_batch_id=batch.id OR b.import_batch_id IS NULL)
   ORDER BY (b.import_batch_id IS NOT NULL) DESC,b.binding_version DESC,b.id LIMIT 1) binding ON true
 JOIN signal_licensing_policies license ON license.id=binding.licensing_policy_id AND license.workspace_id=$1 AND license.status='active'
   AND license.effective_from<=now() AND (license.effective_to IS NULL OR license.effective_to>now())
 JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id AND retention.workspace_id=$1
   AND retention.status='active' AND retention.retention_state='allowed' AND retention.effective_from<=now()
   AND (retention.effective_to IS NULL OR retention.effective_to>now())
   AND (retention.retention_mode='indefinite' OR retention.retention_mode='until' AND retention.retain_until>now())
 WHERE batch.workspace_id=$1 AND batch.status='completed'
 AND EXISTS(SELECT 1 FROM signal_licensing_policy_usages u WHERE u.workspace_id=$1 AND u.licensing_policy_id=license.id AND u.usage_purpose='llm-processing' AND u.decision='allowed')),

 source_batches AS MATERIALIZED(
  SELECT DISTINCT batch.id,batch.acquisition_query_version_id,batch.acquisition_query_digest,batch.data_source_id,batch.acquisition_query_evidence_class
  FROM signal_study_configuration_sources_v1 snapshot
  JOIN signal_listening_discovery_roots root ON root.generation_id=snapshot.generation_id AND root.workspace_id=snapshot.workspace_id
  JOIN mentions canonical ON canonical.id=root.root_id AND canonical.workspace_id=root.workspace_id
  JOIN mentions origin ON origin.canonical_mention_id=root.root_id AND origin.workspace_id=root.workspace_id
  JOIN signal_mention_import_memberships membership ON membership.mention_id=origin.id AND membership.workspace_id=origin.workspace_id
  JOIN eligible_batches allowed ON allowed.id=membership.import_batch_id AND allowed.data_source_id=membership.data_source_id
  JOIN import_batches batch ON batch.id=allowed.id AND batch.workspace_id=$1
  WHERE snapshot.workspace_id=$1 AND snapshot.study_configuration_id=$2
   AND canonical.published_at>=($3::jsonb#>>'{study,cut,start_at}')::timestamptz AND canonical.published_at<($3::jsonb#>>'{study,cut,end_at}')::timestamptz
 ), linked AS MATERIALIZED(
  SELECT b.id,q.id query_id,q.structured_terms FROM source_batches b
  LEFT JOIN signal_acquisition_query_versions q ON q.id=b.acquisition_query_version_id AND q.workspace_id=$1 AND q.data_source_id=b.data_source_id
   AND q.definition_hash=b.acquisition_query_digest AND b.acquisition_query_evidence_class IN('provider_verified','operator_attested')
 ),terms AS MATERIALIZED(
  SELECT DISTINCT term.value FROM linked l CROSS JOIN LATERAL jsonb_array_elements_text(l.structured_terms->'include') term(value)
 )
 SELECT (SELECT count(*)::int FROM linked) source_batches,(SELECT count(*) FILTER(WHERE query_id IS NULL)::int FROM linked) unavailable_batches,
 ARRAY(SELECT value FROM terms ORDER BY value LIMIT 501) terms`,[cfg.workspace_id,cfg.id,JSON.stringify(cfg.envelope)])).rows[0];
 if(!value||!Number.isSafeInteger(value.source_batches)||!Number.isSafeInteger(value.unavailable_batches)
  ||value.source_batches<0||value.unavailable_batches<0||value.unavailable_batches>value.source_batches)fail('query_metadata_invalid',422);
 if(!Array.isArray(value.terms)||value.terms.length>500||value.terms.some(term=>typeof term!=='string'||!term.trim()||term.length>240))fail('query_metadata_capacity_exceeded',422);
 return{query_terms:value.terms,problem_terms:[],acquisition_query_metadata:{contract_version:'signal-study-acquisition-query-metadata-v1',
  complete:value.source_batches>0&&value.unavailable_batches===0&&value.terms.length>0,source_batches:value.source_batches,unavailable_batches:value.unavailable_batches}};
}

/** Defaults recover the original immutable provenance on a repeated request.
 * Explicit metadata remains explicit: omitting it on retry cannot silently
 * reinterpret the same idempotency key as a different declared input. */
export async function resolveSignalStudyQueryMetadataV1(c:PoolClient,cfg:SignalStudyConfigurationRecordV1,
 args:{query_terms?:string[];problem_terms?:string[]},old_header?:Record<string,unknown>):Promise<SignalStudyQueryMetadataV1>{
 const automatic=args.query_terms===undefined?(old_header?(old_header.acquisition_query_metadata?{
  query_terms:old_header.query_terms as string[],problem_terms:[],acquisition_query_metadata:old_header.acquisition_query_metadata as SignalStudyQueryMetadataV1['acquisition_query_metadata']}
  :{query_terms:[],problem_terms:[]}):await loadSignalStudyAcquisitionQueryMetadataV1(c,cfg)):null;
 return{...(automatic??{query_terms:args.query_terms??[],problem_terms:[]}),problem_terms:args.problem_terms??[]};
}
