WITH requested AS MATERIALIZED(
 SELECT q.question_key,q.question_digest,q.definition->>'type' question_type,q.wire
 FROM signal_listening_questions q WHERE q.workspace_id=$1 AND q.configuration_id=$2 AND q.question_key=ANY($5::text[])),
p AS MATERIALIZED(
 SELECT root_id,question_key,has_topic_source,candidate,scope_state,answer,human_belongs,effective_belongs,published_at,
  CASE WHEN human_belongs IS NOT NULL THEN CASE WHEN human_belongs THEN 'positive' ELSE 'negative' END
   WHEN(answer->>'noul')::double precision>=.7 THEN 'positive' WHEN(answer->>'noul')::double precision<=.3 THEN 'negative'
   WHEN answer->>'noul' IS NOT NULL THEN 'uncertain' END effective_class
 FROM signal_listening_effective_compact_population_roots_v1($1::uuid,$2::uuid,$3::uuid,$4,NULL::uuid[],'client-derived-metrics')
 WHERE($11::boolean OR COALESCE(domain,'category')<>'outside')
  AND($6::timestamptz IS NULL OR published_at>=$6) AND($7::timestamptz IS NULL OR published_at<$7)),
root_topics AS MATERIALIZED(
 SELECT root_id,array_agg(question_key ORDER BY question_key) FILTER(WHERE candidate AND scope_state='included'
  AND has_topic_source AND effective_belongs) topic_keys FROM p GROUP BY root_id),
target AS MATERIALIZED(
 SELECT t.* FROM p t JOIN root_topics topics ON topics.root_id=t.root_id
 WHERE t.question_key=ANY($5::text[]) AND($10::text IS NULL OR $10=ANY(topics.topic_keys))),
counts AS(
 SELECT q.question_key,count(t.root_id)::int corpus_eligible,count(t.root_id) FILTER(WHERE t.candidate)::int candidate,
 count(t.root_id) FILTER(WHERE t.candidate AND t.scope_state='included')::int eligible,
 count(t.root_id) FILTER(WHERE t.candidate AND t.scope_state='included' AND t.answer IS NOT NULL)::int asked,
 count(t.root_id) FILTER(WHERE t.candidate AND t.scope_state='included' AND t.answer IS NULL AND t.human_belongs IS NULL)::int pending,
 count(t.root_id) FILTER(WHERE t.candidate AND t.scope_state='awaiting_base')::int awaiting_base,
 count(t.root_id) FILTER(WHERE t.candidate AND t.scope_state='excluded')::int excluded_scope,
 count(t.root_id) FILTER(WHERE NOT t.candidate)::int not_candidate,
 count(t.root_id) FILTER(WHERE t.candidate AND t.scope_state='included' AND t.human_belongs IS NOT NULL)::int human_resolved,
 count(t.root_id) FILTER(WHERE t.candidate AND t.scope_state='included' AND t.human_belongs)::int human_positive,
 count(t.root_id) FILTER(WHERE t.candidate AND t.scope_state='included' AND t.human_belongs=false)::int human_negative
 FROM requested q LEFT JOIN target t ON t.question_key=q.question_key GROUP BY q.question_key),
options AS(
 SELECT q.question_key,q.question_type,option.key FROM requested q CROSS JOIN LATERAL jsonb_each(q.wire->'criteria') option WHERE q.question_type='choice'
 UNION ALL SELECT q.question_key,q.question_type,unnest(ARRAY['positive','negative','uncertain']) FROM requested q WHERE q.question_type='noul'),
dist AS(
 SELECT option.question_key,option.key option_key,count(t.root_id) FILTER(WHERE CASE WHEN option.question_type='choice'
  THEN t.answer->>'choice'=option.key ELSE t.effective_class=option.key END)::int count,
 sum(CASE WHEN option.question_type='choice' THEN(t.answer->'probabilities'->>option.key)::double precision
  ELSE CASE WHEN t.human_belongs IS NULL AND t.effective_class=option.key THEN(t.answer->>'noul')::double precision END END) probability_sum
 FROM options option LEFT JOIN target t ON t.question_key=option.question_key AND t.candidate AND t.scope_state='included'
  AND(t.answer IS NOT NULL OR t.human_belongs IS NOT NULL) GROUP BY option.question_key,option.key),
trend_choices AS(
 SELECT question_key,date_trunc($9,published_at AT TIME ZONE $8)::text bucket,answer->>'choice' choice,count(*)::int n
 FROM target WHERE candidate AND scope_state='included' AND answer->>'type'='choice' GROUP BY 1,2,3),
trend_choice_buckets AS(SELECT question_key,bucket,jsonb_object_agg(choice,n) choices FROM trend_choices GROUP BY question_key,bucket),
trend_base AS(
 SELECT question_key,date_trunc($9,published_at AT TIME ZONE $8)::text bucket,
 count(*) FILTER(WHERE candidate AND scope_state='included')::int eligible,
 count(*) FILTER(WHERE candidate AND scope_state='included' AND answer IS NOT NULL)::int asked,
 count(*) FILTER(WHERE candidate AND scope_state='included' AND answer IS NULL AND human_belongs IS NULL)::int pending,
 count(*) FILTER(WHERE candidate AND scope_state='included' AND effective_class='positive')::int positive,
 count(*) FILTER(WHERE candidate AND scope_state='included' AND effective_class='negative')::int negative,
 count(*) FILTER(WHERE candidate AND scope_state='included' AND effective_class='uncertain')::int uncertain FROM target GROUP BY 1,2),
trend AS(SELECT tb.*,COALESCE(ch.choices,'{}'::jsonb) choices FROM trend_base tb LEFT JOIN trend_choice_buckets ch USING(question_key,bucket)),
pairs AS MATERIALIZED(
 SELECT t.question_key,topic.topic_key,t.root_id,t.answer,t.effective_class FROM target t JOIN root_topics topics ON topics.root_id=t.root_id
 CROSS JOIN LATERAL unnest(topics.topic_keys) topic(topic_key) WHERE t.candidate AND t.scope_state='included'),
topic_counts AS(
 SELECT question_key,topic_key,count(*)::int eligible,count(answer)::int asked,count(*) FILTER(WHERE effective_class='positive')::int positive
 FROM pairs GROUP BY question_key,topic_key),
topic_choices AS(
 SELECT question_key,topic_key,answer->>'choice' choice,count(*)::int n FROM pairs WHERE answer->>'type'='choice' GROUP BY 1,2,3),
topic_choice_groups AS(SELECT question_key,topic_key,jsonb_object_agg(choice,n) choices FROM topic_choices GROUP BY question_key,topic_key),
cross_counts AS(SELECT tc.*,COALESCE(ch.choices,'{}'::jsonb) choices FROM topic_counts tc LEFT JOIN topic_choice_groups ch USING(question_key,topic_key))
SELECT q.question_key,q.question_digest,to_jsonb(counts)-'question_key' counts,
 COALESCE((SELECT jsonb_agg(to_jsonb(d)-'question_key' ORDER BY option_key) FROM dist d WHERE d.question_key=q.question_key),'[]'::jsonb) distribution,
 COALESCE((SELECT jsonb_agg(to_jsonb(t)-'question_key' ORDER BY bucket) FROM trend t WHERE t.question_key=q.question_key),'[]'::jsonb) trend,
 COALESCE((SELECT jsonb_agg(to_jsonb(c)-'question_key' ORDER BY topic_key) FROM cross_counts c WHERE c.question_key=q.question_key),'[]'::jsonb) topic_cross
FROM requested q JOIN counts USING(question_key) ORDER BY q.question_key
