/** The caller supplies the native population/authorized_imports CTEs and $1..$8.
 * $8 is the already-validated generation's currentness, never a browser flag.
 * Provider observations are deduplicated to the canonical record and a current
 * authorized import before their typed counters enter any aggregate. */
const providerNumber = (expression: string) => `CASE
  WHEN replace(btrim(COALESCE(${expression},'')),',','') ~ '^[0-9]+(?:[.][0-9]+)?$'
    THEN replace(btrim(${expression}),',','')::numeric
  ELSE NULL::numeric END`;

const fallbackInteractions = providerNumber("COALESCE(NULLIF(m.raw_metadata->'row'->>'total interactions',''),NULLIF(m.raw_metadata->'row'->>'interactions',''),NULLIF(m.engagement->>'interactions',''))");
const componentInteractions = ["likes", "comments", "shares", "reposts", "saves"]
  .map(key => providerNumber(`m.engagement->>'${key}'`));
const anyComponent = componentInteractions.map(expression => `(${expression}) IS NOT NULL`).join(" OR ");
const componentTotal = componentInteractions.map(expression => `COALESCE((${expression}),0)`).join("+");

export const nativeMonitoringCtesV1 = `,
monitoring_roots AS MATERIALIZED (
  SELECT root.root_id,root.published_at,root.metrics,root.evidence,
    root.llm canonical_llm,
    COALESCE(NULLIF(m.resolved_platform,''),NULLIF(m.platform,''),'unknown') platform,
    NULLIF(lower(btrim(m.content_type)),'') content_type,m.sentiment_score,
    m.source_file_id,m.text_clean_sha256,
    'sha256:'||encode(sha256(convert_to(m.provider_record_id,'UTF8')),'hex') provider_record_hash,
    COALESCE(prepared.asset_sha256=m.text_clean_sha256,false) text_valid
  FROM population root
  JOIN mass_mentions m ON m.workspace_id=$1::uuid AND m.id=root.root_id
  LEFT JOIN signal_mass_labeling_maps map ON map.workspace_id=$1::uuid AND map.id=$2::uuid
  LEFT JOIN signal_corpus_preparation_items prepared ON prepared.workspace_id=$1::uuid
    AND prepared.run_id=map.preparation_run_id AND prepared.root_id=root.root_id
  WHERE root.metrics
), monitoring_observations AS MATERIALIZED (
  SELECT DISTINCT ON(observation.mention_id) observation.mention_id root_id,
    observation.provider_thread_key_hash,observation.engagement_total,observation.views_count,rights.llm observation_llm
  FROM signal_provider_mention_observations observation
  JOIN monitoring_roots root ON root.root_id=observation.mention_id
    AND root.provider_record_hash=observation.provider_record_key_hash
  JOIN authorized_imports rights ON rights.id=observation.import_batch_id
    AND rights.data_source_id=observation.data_source_id AND rights.metrics
    AND (observation.provenance_binding_id IS NULL OR observation.provenance_binding_id=rights.provenance_binding_id)
    AND (observation.rights_definition_hash IS NULL OR observation.rights_definition_hash=rights.rights_definition_hash)
  WHERE observation.workspace_id=$1::uuid
    AND (observation.retention_until IS NULL OR observation.retention_until>now())
  ORDER BY observation.mention_id,(observation.import_batch_id=root.source_file_id) DESC,
    observation.observation_version DESC,observation.imported_at DESC,observation.id DESC
), monitoring_missing_observations AS MATERIALIZED (
  SELECT root.root_id FROM monitoring_roots root
  LEFT JOIN monitoring_observations observation ON observation.root_id=root.root_id
  WHERE observation.root_id IS NULL OR observation.provider_thread_key_hash IS NULL
    OR observation.engagement_total IS NULL OR observation.views_count IS NULL
), monitoring_fallback AS MATERIALIZED (
  SELECT root.root_id,NULLIF(m.raw_metadata->'row'->>'thread id','') thread_key,
    COALESCE((${fallbackInteractions}),CASE WHEN ${anyComponent} THEN ${componentTotal} END) interactions,
    ${providerNumber("COALESCE(NULLIF(m.raw_metadata->'row'->>'views',''),NULLIF(m.engagement->>'views',''))")} views
  FROM monitoring_missing_observations root
  JOIN LATERAL(SELECT raw_metadata,engagement FROM mentions
    WHERE workspace_id=$1::uuid AND id=root.root_id OFFSET 0) m ON true
), monitoring_data AS MATERIALIZED (
  SELECT root.*,root.canonical_llm AND COALESCE(observation.observation_llm,true) llm,
    to_char((root.published_at AT TIME ZONE $5::text)::date,'YYYY-MM-DD') period_start,
    COALESCE(observation.provider_thread_key_hash,
      CASE WHEN fallback.thread_key IS NOT NULL THEN
        'sha256:'||encode(sha256(convert_to(fallback.thread_key,'UTF8')),'hex') END,
      root.root_id::text) thread_key,
    (observation.provider_thread_key_hash IS NOT NULL OR fallback.thread_key IS NOT NULL) thread_known,
    (observation.root_id IS NOT NULL) provider_observation,
    CASE WHEN root.content_type='comment' THEN 'comment'
      WHEN root.content_type IS NOT NULL THEN 'root' ELSE 'unknown' END conversation_role,
    COALESCE(observation.engagement_total::numeric,fallback.interactions) interactions,
    COALESCE(observation.views_count::numeric,fallback.views) views
  FROM monitoring_roots root
  LEFT JOIN monitoring_observations observation ON observation.root_id=root.root_id
  LEFT JOIN monitoring_fallback fallback ON fallback.root_id=root.root_id
), monitoring_emotions AS MATERIALIZED (
  SELECT DISTINCT ON(feature.subject_id) feature.subject_id root_id,
    lower(btrim(feature.feature_value#>>'{}')) emotion
  FROM record_feature_values feature JOIN monitoring_data root ON root.root_id=feature.subject_id
  WHERE feature.subject_type='mention' AND feature.feature_key='emotion'
    AND jsonb_typeof(feature.feature_value)='string' AND btrim(feature.feature_value#>>'{}')<>''
  ORDER BY feature.subject_id,feature.created_at DESC,feature.id DESC
), monitoring_periods AS MATERIALIZED (
  SELECT period_start,count(*)::int mentions,count(DISTINCT thread_key)::int conversations,
    count(*) FILTER(WHERE conversation_role='root')::int root_posts,
    count(*) FILTER(WHERE conversation_role='comment')::int comments,
    jsonb_build_object('positive',count(*) FILTER(WHERE sentiment_score>0.2),
      'neutral',count(*) FILTER(WHERE sentiment_score BETWEEN -0.2 AND 0.2),
      'negative',count(*) FILTER(WHERE sentiment_score< -0.2),
      'classified',count(sentiment_score)) sentiment
  FROM monitoring_data GROUP BY period_start
), monitoring_threads AS MATERIALIZED (
  SELECT thread_key,count(*)::int mention_count,
    count(*) FILTER(WHERE conversation_role='root')::int root_post_count,
    count(*) FILTER(WHERE conversation_role='comment')::int comment_count,
    COALESCE(sum(interactions) FILTER(WHERE conversation_role='root'),0)::float8 interaction_count,
    COALESCE(sum(views) FILTER(WHERE conversation_role='root'),0)::float8 view_count
  FROM monitoring_data GROUP BY thread_key
), monitoring_representatives AS MATERIALIZED (
  SELECT DISTINCT ON(thread_key) thread_key,root_id
  FROM monitoring_data WHERE evidence AND text_valid AND $8::boolean
  ORDER BY thread_key,(conversation_role='root') DESC,published_at,root_id
), monitoring_selected_drivers AS MATERIALIZED (
  SELECT representative.root_id,thread.* FROM monitoring_threads thread
  JOIN monitoring_representatives representative USING(thread_key)
  ORDER BY thread.mention_count DESC,thread.comment_count DESC,representative.root_id LIMIT 6
), monitoring_ranked_highlights AS MATERIALIZED (
  SELECT root_id,CASE WHEN sentiment_score>0.2 THEN 'positive' ELSE 'negative' END polarity,
    row_number() OVER(PARTITION BY (sentiment_score>0.2)
      ORDER BY COALESCE(interactions,0) DESC,published_at DESC,root_id) rank
  FROM monitoring_data WHERE evidence AND text_valid AND $8::boolean
    AND (sentiment_score>0.2 OR sentiment_score< -0.2)
), monitoring_selected_highlights AS MATERIALIZED (
  SELECT * FROM monitoring_ranked_highlights WHERE rank<=2
), monitoring_selected_evidence AS MATERIALIZED (
  SELECT root_id FROM monitoring_selected_drivers UNION SELECT root_id FROM monitoring_selected_highlights
), monitoring_evidence AS MATERIALIZED (
  SELECT selected.root_id,mention.title,left(mention.text_clean,420) text,
    CASE WHEN mention.url ~* '^https?://' THEN mention.url ELSE NULL END url,
    mention.text_clean_sha256 source_sha256
  FROM monitoring_selected_evidence selected
  JOIN LATERAL(SELECT title,text_clean,url,text_clean_sha256 FROM mentions
    WHERE workspace_id=$1::uuid AND id=selected.root_id OFFSET 0) mention ON true
  WHERE mention.text_clean_sha256='sha256:'||encode(sha256(convert_to(mention.text_clean,'UTF8')),'hex')
), monitoring_highlights AS MATERIALIZED (
  SELECT selected.polarity,selected.rank,jsonb_build_object('id',selected.root_id,
    'occurred_at',to_char(root.published_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'title',evidence.title,'text',evidence.text,'url',evidence.url,'platform',root.platform,
    'sentiment',root.sentiment_score,'engagement',COALESCE(root.interactions,0)::float8,
    'reach',NULL,'source_sha256',evidence.source_sha256) item
  FROM monitoring_selected_highlights selected JOIN monitoring_data root USING(root_id)
  JOIN monitoring_evidence evidence USING(root_id)
)
`;

export const nativeMonitoringAggregateV1 = `(SELECT jsonb_build_object(
  'contract_version','signal-workspace-monitoring-v1','denominator',count(*),
  'metadata_digest','sha256:'||encode(sha256(convert_to(COALESCE(string_agg(
    jsonb_build_array(root_id,published_at,platform,content_type,sentiment_score,text_clean_sha256,
      thread_key,interactions,views,evidence,text_valid,llm)::text,'' ORDER BY root_id),'')||
      COALESCE((SELECT string_agg(jsonb_build_array(root_id,emotion)::text,'' ORDER BY root_id) FROM monitoring_emotions),''),'UTF8')),'hex'),
  'summary',jsonb_build_object('mentions',count(*),'conversations',count(DISTINCT thread_key),
    'root_posts',count(*) FILTER(WHERE conversation_role='root'),
    'comments',count(*) FILTER(WHERE conversation_role='comment'),
    'unknown_roles',count(*) FILTER(WHERE conversation_role='unknown'),'classified_sentiment',count(sentiment_score)),
  'sentiment',jsonb_build_object('positive',count(*) FILTER(WHERE sentiment_score>0.2),
    'neutral',count(*) FILTER(WHERE sentiment_score BETWEEN -0.2 AND 0.2),
    'negative',count(*) FILTER(WHERE sentiment_score< -0.2),'unclassified',count(*) FILTER(WHERE sentiment_score IS NULL)),
  'source_coverage',jsonb_build_object('sentiment_known',count(sentiment_score),
    'emotion_classified',(SELECT count(*) FROM monitoring_emotions),'thread_id_known',count(*) FILTER(WHERE thread_known),
    'content_type_known',count(content_type),'engagement_known',count(interactions),'views_known',count(views),
    'engagement_known_root_posts',count(*) FILTER(WHERE conversation_role='root' AND interactions IS NOT NULL),
    'views_known_root_posts',count(*) FILTER(WHERE conversation_role='root' AND views IS NOT NULL),
    'provider_observation_roots',count(*) FILTER(WHERE provider_observation),
    'evidence_eligible',count(*) FILTER(WHERE evidence AND text_valid AND $8::boolean),
    'llm_eligible_roots',count(*) FILTER(WHERE llm)),
  'series',COALESCE((SELECT jsonb_agg(period ORDER BY period_start) FROM monitoring_periods period),'[]'::jsonb),
  'platforms',COALESCE((SELECT jsonb_agg(mix ORDER BY mix.count DESC,mix.key)
    FROM(SELECT platform key,count(*)::int count FROM monitoring_data GROUP BY platform) mix),'[]'::jsonb),
  'emotions',COALESCE((SELECT jsonb_agg(mix ORDER BY mix.count DESC,mix.key)
    FROM(SELECT emotion key,count(*)::int count FROM monitoring_emotions GROUP BY emotion) mix),'[]'::jsonb),
  'attention',jsonb_build_object('root_posts',count(*) FILTER(WHERE conversation_role='root'),
    'total_interactions',COALESCE(sum(interactions) FILTER(WHERE conversation_role='root'),0)::float8,
    'median_interactions',COALESCE(percentile_cont(0.5) WITHIN GROUP(ORDER BY interactions) FILTER(WHERE conversation_role='root'),0)::float8,
    'p90_interactions',COALESCE(percentile_cont(0.9) WITHIN GROUP(ORDER BY interactions) FILTER(WHERE conversation_role='root'),0)::float8,
    'active_root_posts',count(*) FILTER(WHERE conversation_role='root' AND interactions>0),
    'active_ratio',(count(*) FILTER(WHERE conversation_role='root' AND interactions>0))::float8 /
      NULLIF(count(*) FILTER(WHERE conversation_role='root' AND interactions IS NOT NULL),0),
    'total_views',COALESCE(sum(views) FILTER(WHERE conversation_role='root'),0)::float8,
    'viewed_root_posts',count(*) FILTER(WHERE conversation_role='root' AND views>0)),
  'drivers',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',selected.root_id,
    'title',evidence.title,'text',evidence.text,'url',evidence.url,'platform',root.platform,
    'mention_count',selected.mention_count,'root_post_count',selected.root_post_count,
    'comment_count',selected.comment_count,'interaction_count',selected.interaction_count,
    'view_count',selected.view_count,'source_sha256',evidence.source_sha256)
    ORDER BY selected.mention_count DESC,selected.comment_count DESC,selected.root_id)
    FROM monitoring_selected_drivers selected JOIN monitoring_data root USING(root_id)
    JOIN monitoring_evidence evidence USING(root_id)),'[]'::jsonb),
  'highlights',jsonb_build_object('positive',COALESCE((SELECT jsonb_agg(item ORDER BY rank)
    FROM monitoring_highlights WHERE polarity='positive'),'[]'::jsonb),
    'negative',COALESCE((SELECT jsonb_agg(item ORDER BY rank) FROM monitoring_highlights WHERE polarity='negative'),'[]'::jsonb))
) FROM monitoring_data)`;
