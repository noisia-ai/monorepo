import {inspectFacetContextChangeV1} from './signal-mention-facets';
import {mapCurrent} from './signal-mass-labeling';
import {authorizeSignalListeningV1,loadSignalListeningConfigurationWithClientV1,listeningTransactionV1,
 listeningFailV1 as fail,type SignalListeningAccessV1} from './signal-listening-configuration';

export async function getSignalListeningStatusV1(args:SignalListeningAccessV1){
 return listeningTransactionV1(args.database,async c=>{
  const capabilities=await authorizeSignalListeningV1(c,args);
  const configuration=await loadSignalListeningConfigurationWithClientV1(c,args.workspace_id);
  const map=(await c.query<{id:string;root_count:number;map_digest:string;entity_context_digest:string}>(`SELECT id,root_count,map_digest,entity_context_digest
   FROM signal_mass_labeling_maps WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`,[args.workspace_id])).rows[0]??null;
  const run=(await c.query<{id:string;status:string;error_code:string|null;counts:Record<string,number>;configuration_id:string;
   cap_micro_usd:string;estimated_micro_usd:string;confirmed_micro_usd:string;reserved_micro_usd:string;unknown_micro_usd:string}>(`SELECT r.id,r.status,r.error_code,r.counts,o.configuration_id,
    r.cap_micro_usd::text,r.estimated_micro_usd::text,
    COALESCE(sum(call.settled_micro_usd) FILTER(WHERE call.status='settled'),0)::text confirmed_micro_usd,
    COALESCE(sum(call.reserved_micro_usd) FILTER(WHERE call.status IN('reserved','submitting','submitted')),0)::text reserved_micro_usd,
    COALESCE(sum(call.reserved_micro_usd) FILTER(WHERE call.status='unknown'),0)::text unknown_micro_usd
   FROM signal_listening_runs o JOIN signal_labeling_runs r ON r.id=o.run_id AND r.workspace_id=o.workspace_id
   LEFT JOIN signal_labeling_calls call ON call.run_id=r.id
   WHERE o.workspace_id=$1 GROUP BY r.id,o.run_id ORDER BY r.created_at DESC,r.id DESC LIMIT 1`,[args.workspace_id])).rows[0]??null;
  const change=await inspectFacetContextChangeV1(c,args.workspace_id);
  return {contract_version:'signal-listening-status-v1' as const,configuration,map,run,capabilities,
   map_stale:map?map.entity_context_digest!==change.digest:true};
 });
}
export type SignalListeningMetricCountsV1={corpus_eligible:number;candidate:number;eligible:number;asked:number;pending:number;
 awaiting_base:number;excluded_scope:number;not_candidate:number};
export type SignalListeningMetricDistributionV1={option_key:string;count:number;probability_sum:number|null};
export type SignalListeningQuestionMetricsV1={contract_version:'signal-listening-question-metrics-v1';configuration_id:string;
 question_key:string;question_digest:string;scope:string;counts:SignalListeningMetricCountsV1;coverage:number|null;
 distribution:SignalListeningMetricDistributionV1[];
 trend:Array<{bucket:string;eligible:number;asked:number;pending:number;choices:Record<string,number>;positive:number;negative:number;uncertain:number}>;
 topic_cross:Array<{topic_key:string;eligible:number;asked:number;positive:number;choices:Record<string,number>}>;
 limitations:string[]};
export async function readSignalListeningQuestionMetricsV1(args:SignalListeningAccessV1&{configuration_id:string;map_id:string;
 question_key:string;from?:string;to?:string;timezone?:string;granularity?:'day'|'week'|'month';topic_key?:string;include_outside?:boolean}):Promise<SignalListeningQuestionMetricsV1>{
 if(args.from&&!Number.isFinite(Date.parse(args.from))||args.to&&!Number.isFinite(Date.parse(args.to))
  ||args.from&&args.to&&Date.parse(args.from)>=Date.parse(args.to)||!['day','week','month'].includes(args.granularity??'day'))fail('listening_filters_invalid',422);
 try{new Intl.DateTimeFormat('en',{timeZone:args.timezone??'UTC'}).format();}catch{fail('listening_filters_invalid',422);}
 return listeningTransactionV1(args.database,async c=>{
  await authorizeSignalListeningV1(c,args);
  const configuration=await loadSignalListeningConfigurationWithClientV1(c,args.workspace_id,args.configuration_id);
  if(!configuration||configuration.state!=='published')return fail('listening_configuration_unavailable');
  const question=configuration.configuration.questions.find(q=>q.key===args.question_key);
  if(question?.domain==='outside'&&!args.include_outside)return fail('listening_question_hidden',404);
  if(!question||args.topic_key&&!configuration.configuration.questions.some(q=>q.key===args.topic_key&&q.topic_source))return fail('listening_question_unavailable',404);
  const map=await mapCurrent(c,args.workspace_id,args.map_id);
  const result=(await c.query<{counts:SignalListeningMetricCountsV1;distribution:SignalListeningMetricDistributionV1[];
   trend:SignalListeningQuestionMetricsV1['trend'];topic_cross:SignalListeningQuestionMetricsV1['topic_cross'];question_digest:string}>(`WITH p AS MATERIALIZED(
    SELECT * FROM signal_listening_population_v1($1::uuid,$2::uuid,$3::uuid,$4,'client-derived-metrics')
    WHERE ($12::boolean OR COALESCE(definition->>'domain','category')<>'outside') AND ($6::timestamptz IS NULL OR published_at>=$6) AND ($7::timestamptz IS NULL OR published_at<$7)),
   target AS MATERIALIZED(SELECT t.* FROM p t WHERE t.question_key=$5 AND ($10::text IS NULL OR EXISTS(
    SELECT 1 FROM p topic WHERE topic.root_id=t.root_id AND topic.question_key=$10 AND topic.candidate AND topic.scope_state='included'
     AND (topic.answer->>'noul')::double precision>=0.7))),
   counts AS(SELECT count(*)::int corpus_eligible,count(*) FILTER(WHERE candidate)::int candidate,
    count(*) FILTER(WHERE candidate AND scope_state='included')::int eligible,
    count(*) FILTER(WHERE candidate AND scope_state='included' AND answer IS NOT NULL)::int asked,
    count(*) FILTER(WHERE candidate AND scope_state='included' AND answer IS NULL)::int pending,
    count(*) FILTER(WHERE candidate AND scope_state='awaiting_base')::int awaiting_base,
    count(*) FILTER(WHERE candidate AND scope_state='excluded')::int excluded_scope,
    count(*) FILTER(WHERE NOT candidate)::int not_candidate FROM target),
   options AS(SELECT option.key FROM signal_listening_questions q CROSS JOIN LATERAL jsonb_each(q.wire->'criteria') option
     WHERE q.configuration_id=$2 AND q.question_key=$5 AND q.definition->>'type'='choice'
    UNION ALL SELECT unnest(ARRAY['positive','negative','uncertain']) WHERE $11='noul'),
   dist AS(SELECT option.key option_key,count(t.root_id) FILTER(WHERE CASE WHEN $11='choice' THEN t.answer->>'choice'=option.key
     ELSE CASE WHEN (t.answer->>'noul')::double precision>=.7 THEN 'positive' WHEN (t.answer->>'noul')::double precision<=.3 THEN 'negative'
      ELSE 'uncertain' END=option.key END)::int count,
    sum(CASE WHEN $11='choice' THEN (t.answer->'probabilities'->>option.key)::double precision ELSE CASE WHEN CASE WHEN (t.answer->>'noul')::double precision>=.7 THEN 'positive' WHEN (t.answer->>'noul')::double precision<=.3 THEN 'negative' ELSE 'uncertain' END=option.key THEN (t.answer->>'noul')::double precision END END) probability_sum
    FROM options option LEFT JOIN target t ON t.candidate AND t.scope_state='included' AND t.answer IS NOT NULL GROUP BY option.key),
   trend_choices AS(SELECT date_trunc($9,published_at AT TIME ZONE $8)::text bucket,answer->>'choice' choice,count(*)::int n
    FROM target WHERE candidate AND scope_state='included' AND answer->>'type'='choice' GROUP BY 1,2),
   trend_base AS(SELECT date_trunc($9,published_at AT TIME ZONE $8)::text bucket,
    count(*) FILTER(WHERE candidate AND scope_state='included')::int eligible,
    count(*) FILTER(WHERE candidate AND scope_state='included' AND answer IS NOT NULL)::int asked,
    count(*) FILTER(WHERE candidate AND scope_state='included' AND answer IS NULL)::int pending,
    count(*) FILTER(WHERE candidate AND scope_state='included' AND (answer->>'noul')::double precision>=.7)::int positive,
    count(*) FILTER(WHERE candidate AND scope_state='included' AND (answer->>'noul')::double precision<=.3)::int negative,
    count(*) FILTER(WHERE candidate AND scope_state='included' AND (answer->>'noul')::double precision>.3 AND (answer->>'noul')::double precision<.7)::int uncertain
    FROM target GROUP BY 1),
   trend AS(SELECT tb.*,COALESCE((SELECT jsonb_object_agg(choice,n) FROM trend_choices tc WHERE tc.bucket=tb.bucket),'{}'::jsonb) choices FROM trend_base tb),
   pairs AS MATERIALIZED(SELECT topic.question_key topic_key,t.root_id,t.answer FROM target t JOIN p topic ON topic.root_id=t.root_id
    WHERE t.candidate AND t.scope_state='included' AND topic.candidate AND topic.scope_state='included'
     AND topic.definition ? 'topic_source' AND (topic.answer->>'noul')::double precision>=.7),
   topic_counts AS(SELECT topic_key,count(*)::int eligible,count(answer)::int asked,
    count(*) FILTER(WHERE (answer->>'noul')::double precision>=.7)::int positive FROM pairs GROUP BY topic_key),
   topic_choices AS(SELECT topic_key,answer->>'choice' choice,count(*)::int n FROM pairs WHERE answer->>'type'='choice' GROUP BY 1,2),
   cross_counts AS(SELECT tc.*,COALESCE((SELECT jsonb_object_agg(choice,n) FROM topic_choices ch WHERE ch.topic_key=tc.topic_key),'{}'::jsonb) choices FROM topic_counts tc)
   SELECT to_jsonb(counts) counts,COALESCE((SELECT jsonb_agg(dist ORDER BY option_key) FROM dist),'[]'::jsonb) distribution,
    COALESCE((SELECT jsonb_agg(trend ORDER BY bucket) FROM trend),'[]'::jsonb) trend,
    COALESCE((SELECT jsonb_agg(cross_counts ORDER BY topic_key) FROM cross_counts),'[]'::jsonb) topic_cross,
    (SELECT question_digest FROM signal_listening_questions WHERE configuration_id=$2 AND question_key=$5) question_digest FROM counts`,
   [args.workspace_id,configuration.id,map.id,map.entity_context_digest,args.question_key,args.from??null,args.to??null,args.timezone??'UTC',
    args.granularity??'day',args.topic_key??null,question.type,args.include_outside===true])).rows[0]!;
  return {contract_version:'signal-listening-question-metrics-v1',configuration_id:configuration.id,question_key:question.key,
   question_digest:result.question_digest,scope:question.scope,counts:result.counts,
   coverage:result.counts.eligible?result.counts.asked/result.counts.eligible:null,distribution:result.distribution,
   trend:result.trend,topic_cross:result.topic_cross,
   limitations:['Unasked, awaiting-base and out-of-scope roots are never negative answers.','Topic cross denominators include only confirmed topic memberships.']};
 });
}
