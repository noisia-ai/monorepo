import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const servingTailOriginalSqlShaV1='e9d3813e9885353bfcaf0d6bf2178f0fbddc4b216d33a440fe377ff28e05347e';
const rewrites:Array<[string,string,number]>=[
 [
  "q.definition->>'type' question_type,q.wire",
  "q.definition->>'type' question_type,q.wire->'criteria' criteria",
  1
 ],
 [
  "scope_state,answer,human_belongs,effective_belongs,published_at,",
  "scope_state,answer IS NOT NULL answered,human_belongs,effective_belongs,published_at,\n  answer->>'choice' choice_key,answer->>'type'='choice' is_choice,\n  CASE WHEN question_key=ANY($5::text[]) THEN answer->'probabilities' END probabilities,\n  CASE WHEN human_belongs IS NULL THEN(answer->>'noul')::double precision END noul_value,",
  1
 ],
 [
  " SELECT root_id,array_agg(question_key ORDER BY question_key) FILTER(WHERE candidate AND scope_state='included'\n  AND has_topic_source AND effective_belongs) topic_keys FROM p GROUP BY root_id),",
  " SELECT root_id,array_agg(question_key ORDER BY question_key) topic_keys FROM p\n WHERE candidate AND scope_state='included' AND has_topic_source AND effective_belongs GROUP BY root_id),",
  1
 ],
 [
  " SELECT t.* FROM p t JOIN root_topics topics ON topics.root_id=t.root_id\n WHERE t.question_key=ANY($5::text[]) AND($10::text IS NULL OR $10=ANY(topics.topic_keys))),",
  " SELECT t.root_id,t.question_key,t.candidate,t.scope_state,t.answered,t.human_belongs,t.effective_class,\n  t.choice_key,t.is_choice,t.probabilities,t.noul_value,date_trunc($9,t.published_at AT TIME ZONE $8)::text bucket,\n  topics.topic_keys\n FROM p t LEFT JOIN root_topics topics ON topics.root_id=t.root_id\n WHERE t.root_id IS NOT NULL AND t.question_key=ANY($5::text[]) AND($10::text IS NULL OR $10=ANY(topics.topic_keys))),",
  1
 ],
 [
  "dist AS(\n SELECT option.question_key,option.key option_key,count(t.root_id) FILTER(WHERE CASE WHEN option.question_type='choice'\n  THEN t.answer->>'choice'=option.key ELSE t.effective_class=option.key END)::int count,\n sum(CASE WHEN option.question_type='choice' THEN(t.answer->'probabilities'->>option.key)::double precision\n  ELSE CASE WHEN t.human_belongs IS NULL AND t.effective_class=option.key THEN(t.answer->>'noul')::double precision END END) probability_sum\n FROM options option LEFT JOIN target t ON t.question_key=option.question_key AND t.candidate AND t.scope_state='included'\n  AND(t.answer IS NOT NULL OR t.human_belongs IS NOT NULL) GROUP BY option.question_key,option.key),\n",
  "noul_dist AS(\n SELECT question_key,effective_class option_key,count(root_id)::int count,\n sum(CASE WHEN human_belongs IS NULL THEN noul_value END) probability_sum\n FROM target WHERE candidate AND scope_state='included' AND(answered OR human_belongs IS NOT NULL)\n GROUP BY question_key,effective_class),\ndist AS(\n SELECT option.question_key,option.key option_key,count(t.root_id) FILTER(WHERE t.choice_key=option.key)::int count,\n sum((t.probabilities->>option.key)::double precision) probability_sum\n FROM options option LEFT JOIN target t ON t.question_key=option.question_key AND t.candidate AND t.scope_state='included'\n  AND(t.answered OR t.human_belongs IS NOT NULL) WHERE option.question_type='choice' GROUP BY option.question_key,option.key\n UNION ALL\n SELECT option.question_key,option.key option_key,COALESCE(n.count,0)::int count,n.probability_sum\n FROM options option LEFT JOIN noul_dist n ON n.question_key=option.question_key AND n.option_key=option.key\n WHERE option.question_type='noul'),\n",
  1
 ],
 [
  "AND t.answer IS NOT NULL)::int asked",
  "AND t.answered)::int asked",
  1
 ],
 [
  "AND t.answer IS NULL AND t.human_belongs IS NULL)::int pending",
  "AND NOT t.answered AND t.human_belongs IS NULL)::int pending",
  1
 ],
 [
  "AND answer IS NOT NULL)::int asked",
  "AND answered)::int asked",
  1
 ],
 [
  "AND answer IS NULL AND human_belongs IS NULL)::int pending",
  "AND NOT answered AND human_belongs IS NULL)::int pending",
  1
 ],
 [
  "jsonb_each(q.wire->'criteria')",
  "jsonb_each(q.criteria)",
  1
 ],
 [
  "SELECT question_key,date_trunc($9,published_at AT TIME ZONE $8)::text bucket,answer->>'choice' choice,count(*)::int n",
  "SELECT question_key,bucket,choice_key choice,count(*)::int n",
  1
 ],
 [
  "SELECT question_key,date_trunc($9,published_at AT TIME ZONE $8)::text bucket,\n count(*)",
  "SELECT question_key,bucket,\n count(*)",
  1
 ],
 [
  "topic_key,answer->>'choice' choice",
  "topic_key,choice_key choice",
  1
 ],
 [
  "AND answer->>'type'='choice'",
  "AND is_choice",
  1
 ],
 [
  "WHERE answer->>'type'='choice'",
  "WHERE is_choice",
  1
 ],
 [
  " SELECT t.question_key,topic.topic_key,t.root_id,t.answer,t.effective_class FROM target t JOIN root_topics topics ON topics.root_id=t.root_id\n CROSS JOIN LATERAL unnest(topics.topic_keys) topic(topic_key) WHERE t.candidate AND t.scope_state='included'),",
  " SELECT t.question_key,topic.topic_key,t.answered,t.choice_key,t.is_choice,t.effective_class FROM target t\n CROSS JOIN LATERAL unnest(t.topic_keys) topic(topic_key) WHERE t.candidate AND t.scope_state='included'),",
  1
 ],
 [
  "count(answer)::int asked",
  "count(*) FILTER(WHERE answered)::int asked",
  1
 ]
];
/** Invert only the registered SQL deltas; unrelated source bytes survive to the original SHA witness. */
export function invertSignalListeningServingTailV1(source:string){
 for(const [before,after,count]of [...rewrites].reverse()){
  assert.equal(source.split(after).length-1,count,'exact serving tail inverse: '+after.slice(0,70));source=source.replaceAll(after,before);
 }
 return source;
}
export function assertServingTailOriginalSqlV1(sql:string){
 assert.equal(createHash('sha256').update(sql).digest('hex'),servingTailOriginalSqlShaV1);
}
