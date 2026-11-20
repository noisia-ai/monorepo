import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const servingTailOriginalSqlShaV1='e9d3813e9885353bfcaf0d6bf2178f0fbddc4b216d33a440fe377ff28e05347e';
// Only integer topic-cross aggregation changes. The complete requested/p/
// root_topics/target/counts/options/dist/trend and every SUM producer stay N.
const rewrites:Array<[string,string,number]>=[
 [
  " SELECT t.question_key,topic.topic_key,t.root_id,t.answer,t.effective_class FROM target t JOIN root_topics topics ON topics.root_id=t.root_id\n CROSS JOIN LATERAL unnest(topics.topic_keys) topic(topic_key) WHERE t.candidate AND t.scope_state='included'),",
  " SELECT t.question_key,topic.topic_key,t.answer IS NOT NULL answered,t.answer->>'choice' choice_key,\n  t.answer->>'type'='choice' is_choice,t.effective_class FROM target t JOIN root_topics topics ON topics.root_id=t.root_id\n CROSS JOIN LATERAL unnest(topics.topic_keys) topic(topic_key) WHERE t.candidate AND t.scope_state='included'),",
  1
 ],
 [
  "topic_counts AS(\n SELECT question_key,topic_key,count(*)::int eligible,count(answer)::int asked,count(*) FILTER(WHERE effective_class='positive')::int positive\n FROM pairs GROUP BY question_key,topic_key),",
  "pair_counts AS MATERIALIZED(\n SELECT question_key,topic_key,choice_key,grouping(choice_key) choice_grouping,\n count(*)::int eligible,count(*) FILTER(WHERE answered)::int asked,\n count(*) FILTER(WHERE effective_class='positive')::int positive,count(*) FILTER(WHERE is_choice)::int choice_n\n FROM pairs GROUP BY GROUPING SETS((question_key,topic_key),(question_key,topic_key,choice_key))),\ntopic_counts AS(\n SELECT question_key,topic_key,eligible,asked,positive FROM pair_counts WHERE choice_grouping=1),",
  1
 ],
 [
  " SELECT question_key,topic_key,answer->>'choice' choice,count(*)::int n FROM pairs WHERE answer->>'type'='choice' GROUP BY 1,2,3),",
  " SELECT question_key,topic_key,choice_key choice,choice_n n FROM pair_counts WHERE choice_grouping=0 AND choice_n>0),",
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
