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
  // These three amount buckets sum to native run exposure without overlap.
  // A failed outcome retains its booked settlement and terminal uncertainty.
  const run=(await c.query<{id:string;status:string;error_code:string|null;counts:Record<string,number>;configuration_id:string;
   cap_micro_usd:string;estimated_micro_usd:string;confirmed_micro_usd:string;reserved_micro_usd:string;unknown_micro_usd:string}>(`SELECT r.id,r.status,r.error_code,r.counts,o.configuration_id,
    r.cap_micro_usd::text,r.estimated_micro_usd::text,
    COALESCE(sum(call.settled_micro_usd) FILTER(WHERE call.status IN('settled','failed')),0)::text confirmed_micro_usd,
    COALESCE(sum(call.reserved_micro_usd) FILTER(WHERE call.status IN('reserved','submitting','submitted')),0)::text reserved_micro_usd,
    (COALESCE(sum(call.reserved_micro_usd) FILTER(WHERE call.status='unknown'),0)
     +COALESCE(sum(call.terminal_exposure_micro_usd) FILTER(WHERE call.status IN('settled','failed')),0))::text unknown_micro_usd
   FROM signal_listening_runs o JOIN signal_labeling_runs r ON r.id=o.run_id AND r.workspace_id=o.workspace_id
   LEFT JOIN signal_labeling_calls call ON call.run_id=r.id
   WHERE o.workspace_id=$1 GROUP BY r.id,o.run_id ORDER BY r.created_at DESC,r.id DESC LIMIT 1`,[args.workspace_id])).rows[0]??null;
  const preparation=(await c.query<{id:string;status:string;configuration_id:string;prototype_run_id:string|null;listening_run_id:string|null;cap_micro_usd:string;error_code:string|null}>(
   `SELECT id,status,configuration_id,prototype_run_id,listening_run_id,cap_micro_usd::text,error_code FROM signal_listening_preparations
    WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`,[args.workspace_id])).rows[0]??null;
  const initialReady=(await c.query("SELECT to_regclass('signal_listening_discovery_initial_intents') IS NOT NULL ready")).rows[0]?.ready;
  const discovery=initialReady?(await c.query<{intent_id:string;status:string;execution_id:string|null;execution_status:string|null;error_code:string|null}>(
   `SELECT i.id intent_id,i.status,i.execution_id,e.status execution_status,COALESCE(e.error_code,i.error_code) error_code
    FROM signal_listening_discovery_initial_intents i LEFT JOIN signal_listening_discovery_executions e ON e.id=i.execution_id AND e.workspace_id=i.workspace_id
    WHERE i.workspace_id=$1 ORDER BY i.created_at DESC,i.id DESC LIMIT 1`,[args.workspace_id])).rows[0]??null:null;
  const change=await inspectFacetContextChangeV1(c,args.workspace_id);
  return {contract_version:'signal-listening-status-v1' as const,configuration,map,run,preparation,discovery,capabilities,
   map_stale:map?map.entity_context_digest!==change.digest:true};
 });
}
export type SignalListeningMetricCountsV1={corpus_eligible:number;candidate:number;eligible:number;asked:number;pending:number;
 awaiting_base:number;excluded_scope:number;not_candidate:number;human_resolved?:number;human_positive?:number;human_negative?:number};
export type SignalListeningMetricDistributionV1={option_key:string;count:number;probability_sum:number|null};
export type SignalListeningQuestionMetricsV1={contract_version:'signal-listening-question-metrics-v1';configuration_id:string;
 question_key:string;question_digest:string;scope:string;counts:SignalListeningMetricCountsV1;coverage:number|null;
 distribution:SignalListeningMetricDistributionV1[];
 trend:Array<{bucket:string;eligible:number;asked:number;pending:number;choices:Record<string,number>;positive:number;negative:number;uncertain:number}>;
 topic_cross:Array<{topic_key:string;eligible:number;asked:number;positive:number;choices:Record<string,number>}>;
 limitations:string[]};
export type SignalListeningMetricsFiltersV1={configuration_id:string;map_id:string;
 from?:string;to?:string;timezone?:string;granularity?:'day'|'week'|'month';topic_key?:string;include_outside?:boolean};
export async function readSignalListeningQuestionMetricsV1(args:SignalListeningAccessV1&SignalListeningMetricsFiltersV1&{
 question_key:string}):Promise<SignalListeningQuestionMetricsV1>{
 return (await readSignalListeningQuestionsMetricsV1({...args,question_keys:[args.question_key]}))[0]!;
}
/** All requested questions share one governed population and one statement snapshot.
 * Roots without confirmed topics remain in the population and coverage counts. */
export async function readSignalListeningQuestionsMetricsV1(args:SignalListeningAccessV1&SignalListeningMetricsFiltersV1&{
 question_keys:string[]}):Promise<SignalListeningQuestionMetricsV1[]>{
 if(!Array.isArray(args.question_keys)||!args.question_keys.length||args.question_keys.some(key=>typeof key!=='string')
  ||args.from&&!Number.isFinite(Date.parse(args.from))||args.to&&!Number.isFinite(Date.parse(args.to))
  ||args.from&&args.to&&Date.parse(args.from)>=Date.parse(args.to)||!['day','week','month'].includes(args.granularity??'day'))fail('listening_filters_invalid',422);
 try{new Intl.DateTimeFormat('en',{timeZone:args.timezone??'UTC'}).format();}catch{fail('listening_filters_invalid',422);}
 return listeningTransactionV1(args.database,async c=>{
  await authorizeSignalListeningV1(c,args);
  const configuration=await loadSignalListeningConfigurationWithClientV1(c,args.workspace_id,args.configuration_id);
  if(!configuration||configuration.state!=='published')return fail('listening_configuration_unavailable');
  const keys=[...new Set(args.question_keys)];
  const questions=keys.map(key=>{
   const question=configuration.configuration.questions.find(q=>q.key===key);
   if(question?.domain==='outside'&&!args.include_outside)return fail('listening_question_hidden',404);
   if(!question)return fail('listening_question_unavailable',404);
   return question;
  });
  if(args.topic_key&&!configuration.configuration.questions.some(q=>q.key===args.topic_key&&q.topic_source))return fail('listening_question_unavailable',404);
  const map=await mapCurrent(c,args.workspace_id,args.map_id);
  const results=(await c.query<{question_key:string;counts:SignalListeningMetricCountsV1;distribution:SignalListeningMetricDistributionV1[];
   trend:SignalListeningQuestionMetricsV1['trend'];topic_cross:SignalListeningQuestionMetricsV1['topic_cross'];question_digest:string}>(`WITH requested AS MATERIALIZED(
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
 SELECT t.question_key,topic.topic_key,t.answer IS NOT NULL answered,t.answer->>'choice' choice_key,
  t.answer->>'type'='choice' is_choice,t.effective_class FROM target t JOIN root_topics topics ON topics.root_id=t.root_id
 CROSS JOIN LATERAL unnest(topics.topic_keys) topic(topic_key) WHERE t.candidate AND t.scope_state='included'),
pair_counts AS MATERIALIZED(
 SELECT question_key,topic_key,choice_key,grouping(choice_key) choice_grouping,
 count(*)::int eligible,count(*) FILTER(WHERE answered)::int asked,
 count(*) FILTER(WHERE effective_class='positive')::int positive,count(*) FILTER(WHERE is_choice)::int choice_n
 FROM pairs GROUP BY GROUPING SETS((question_key,topic_key),(question_key,topic_key,choice_key))),
topic_counts AS(
 SELECT question_key,topic_key,eligible,asked,positive FROM pair_counts WHERE choice_grouping=1),
topic_choices AS(
 SELECT question_key,topic_key,choice_key choice,choice_n n FROM pair_counts WHERE choice_grouping=0 AND choice_n>0),
topic_choice_groups AS(SELECT question_key,topic_key,jsonb_object_agg(choice,n) choices FROM topic_choices GROUP BY question_key,topic_key),
cross_counts AS(SELECT tc.*,COALESCE(ch.choices,'{}'::jsonb) choices FROM topic_counts tc LEFT JOIN topic_choice_groups ch USING(question_key,topic_key))
SELECT q.question_key,q.question_digest,to_jsonb(counts)-'question_key' counts,
 COALESCE((SELECT jsonb_agg(to_jsonb(d)-'question_key' ORDER BY option_key) FROM dist d WHERE d.question_key=q.question_key),'[]'::jsonb) distribution,
 COALESCE((SELECT jsonb_agg(to_jsonb(t)-'question_key' ORDER BY bucket) FROM trend t WHERE t.question_key=q.question_key),'[]'::jsonb) trend,
 COALESCE((SELECT jsonb_agg(to_jsonb(c)-'question_key' ORDER BY topic_key) FROM cross_counts c WHERE c.question_key=q.question_key),'[]'::jsonb) topic_cross
FROM requested q JOIN counts USING(question_key) ORDER BY q.question_key`,
   [args.workspace_id,configuration.id,map.id,map.entity_context_digest,keys,args.from??null,args.to??null,args.timezone??'UTC',
    args.granularity??'day',args.topic_key??null,args.include_outside===true])).rows;
  return questions.map(question=>{
   const result=results.find(row=>row.question_key===question.key)!;
   return {contract_version:'signal-listening-question-metrics-v1' as const,configuration_id:configuration.id,question_key:question.key,
    question_digest:result.question_digest,scope:question.scope,counts:result.counts,
    coverage:result.counts.eligible?result.counts.asked/result.counts.eligible:null,distribution:result.distribution,
    trend:result.trend,topic_cross:result.topic_cross,
    limitations:['Human decisions change effective topic membership and volumes; provider coverage and probability sums count only original JEV answers.','Unasked, awaiting-base and out-of-scope roots are never negative answers.','Topic cross denominators include only confirmed topic memberships.']};
  });
 });
}
