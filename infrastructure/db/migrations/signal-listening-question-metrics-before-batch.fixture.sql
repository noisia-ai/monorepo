-- Frozen pre-batch production query: native equivalence oracle, not a new serving path.
WITH p AS MATERIALIZED(
    SELECT *,CASE WHEN human_belongs IS NOT NULL THEN CASE WHEN human_belongs THEN 'positive' ELSE 'negative' END
     WHEN (answer->>'noul')::double precision>=.7 THEN 'positive' WHEN (answer->>'noul')::double precision<=.3 THEN 'negative'
     WHEN answer->>'noul' IS NOT NULL THEN 'uncertain' END effective_class
    FROM signal_listening_effective_population_roots_v2($1::uuid,$2::uuid,$3::uuid,$4,NULL::uuid[],'client-derived-metrics')
    WHERE ($12::boolean OR COALESCE(definition->>'domain','category')<>'outside') AND ($6::timestamptz IS NULL OR published_at>=$6) AND ($7::timestamptz IS NULL OR published_at<$7)),
   target AS MATERIALIZED(SELECT t.* FROM p t WHERE t.question_key=$5 AND ($10::text IS NULL OR EXISTS(
    SELECT 1 FROM p topic WHERE topic.root_id=t.root_id AND topic.question_key=$10 AND topic.candidate AND topic.scope_state='included'
     AND topic.effective_belongs))),
   counts AS(SELECT count(*)::int corpus_eligible,count(*) FILTER(WHERE candidate)::int candidate,
    count(*) FILTER(WHERE candidate AND scope_state='included')::int eligible,
    count(*) FILTER(WHERE candidate AND scope_state='included' AND answer IS NOT NULL)::int asked,
    count(*) FILTER(WHERE candidate AND scope_state='included' AND answer IS NULL AND human_belongs IS NULL)::int pending,
    count(*) FILTER(WHERE candidate AND scope_state='awaiting_base')::int awaiting_base,
    count(*) FILTER(WHERE candidate AND scope_state='excluded')::int excluded_scope,
    count(*) FILTER(WHERE NOT candidate)::int not_candidate,
    count(*) FILTER(WHERE candidate AND scope_state='included' AND human_belongs IS NOT NULL)::int human_resolved,
    count(*) FILTER(WHERE candidate AND scope_state='included' AND human_belongs)::int human_positive,
    count(*) FILTER(WHERE candidate AND scope_state='included' AND human_belongs=false)::int human_negative FROM target),
   options AS(SELECT option.key FROM signal_listening_questions q CROSS JOIN LATERAL jsonb_each(q.wire->'criteria') option
     WHERE q.configuration_id=$2 AND q.question_key=$5 AND q.definition->>'type'='choice'
    UNION ALL SELECT unnest(ARRAY['positive','negative','uncertain']) WHERE $11='noul'),
   dist AS(SELECT option.key option_key,count(t.root_id) FILTER(WHERE CASE WHEN $11='choice' THEN t.answer->>'choice'=option.key
     ELSE t.effective_class=option.key END)::int count,
    sum(CASE WHEN $11='choice' THEN (t.answer->'probabilities'->>option.key)::double precision ELSE CASE WHEN t.human_belongs IS NULL AND t.effective_class=option.key THEN (t.answer->>'noul')::double precision END END) probability_sum
    FROM options option LEFT JOIN target t ON t.candidate AND t.scope_state='included' AND (t.answer IS NOT NULL OR t.human_belongs IS NOT NULL) GROUP BY option.key),
   trend_choices AS(SELECT date_trunc($9,published_at AT TIME ZONE $8)::text bucket,answer->>'choice' choice,count(*)::int n
    FROM target WHERE candidate AND scope_state='included' AND answer->>'type'='choice' GROUP BY 1,2),
   trend_base AS(SELECT date_trunc($9,published_at AT TIME ZONE $8)::text bucket,
    count(*) FILTER(WHERE candidate AND scope_state='included')::int eligible,
    count(*) FILTER(WHERE candidate AND scope_state='included' AND answer IS NOT NULL)::int asked,
    count(*) FILTER(WHERE candidate AND scope_state='included' AND answer IS NULL AND human_belongs IS NULL)::int pending,
    count(*) FILTER(WHERE candidate AND scope_state='included' AND effective_class='positive')::int positive,
    count(*) FILTER(WHERE candidate AND scope_state='included' AND effective_class='negative')::int negative,
    count(*) FILTER(WHERE candidate AND scope_state='included' AND effective_class='uncertain')::int uncertain
    FROM target GROUP BY 1),
   trend AS(SELECT tb.*,COALESCE((SELECT jsonb_object_agg(choice,n) FROM trend_choices tc WHERE tc.bucket=tb.bucket),'{}'::jsonb) choices FROM trend_base tb),
   pairs AS MATERIALIZED(SELECT topic.question_key topic_key,t.root_id,t.answer,t.effective_class FROM target t JOIN p topic ON topic.root_id=t.root_id
    WHERE t.candidate AND t.scope_state='included' AND topic.candidate AND topic.scope_state='included'
     AND topic.definition ? 'topic_source' AND topic.effective_belongs),
   topic_counts AS(SELECT topic_key,count(*)::int eligible,count(answer)::int asked,
    count(*) FILTER(WHERE effective_class='positive')::int positive FROM pairs GROUP BY topic_key),
   topic_choices AS(SELECT topic_key,answer->>'choice' choice,count(*)::int n FROM pairs WHERE answer->>'type'='choice' GROUP BY 1,2),
   cross_counts AS(SELECT tc.*,COALESCE((SELECT jsonb_object_agg(choice,n) FROM topic_choices ch WHERE ch.topic_key=tc.topic_key),'{}'::jsonb) choices FROM topic_counts tc)
   SELECT to_jsonb(counts) counts,COALESCE((SELECT jsonb_agg(dist ORDER BY option_key) FROM dist),'[]'::jsonb) distribution,
    COALESCE((SELECT jsonb_agg(trend ORDER BY bucket) FROM trend),'[]'::jsonb) trend,
    COALESCE((SELECT jsonb_agg(cross_counts ORDER BY topic_key) FROM cross_counts),'[]'::jsonb) topic_cross,
    (SELECT question_digest FROM signal_listening_questions WHERE configuration_id=$2 AND question_key=$5) question_digest FROM counts
