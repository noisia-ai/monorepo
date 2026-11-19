import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {withSignalStudyFixtureV1} from './signal-study.synthetic.fixture';
import {saveSignalListeningConfigurationV1,loadSignalListeningConfigurationWithClientV1,type SignalListeningAccessV1} from '../signal-listening-configuration';
import {readSignalListeningQuestionsMetricsV1,readSignalListeningQuestionMetricsV1,type SignalListeningMetricsFiltersV1} from '../signal-listening-serving';
import * as human from '../signal-listening-human-edits';
import {r16ListeningWorkloadV1} from '../../../scripts/r16/listening-workload';
const enabled=process.env.NOISIA_R16_LISTENING_METRICS_BATCH_PG==='true';
async function parity(access:SignalListeningAccessV1,args:SignalListeningMetricsFiltersV1){
 const c=await access.database.connect();let configuration;try{
  configuration=await loadSignalListeningConfigurationWithClientV1(c,access.workspace_id,args.configuration_id);
 }finally{c.release();}assert.ok(configuration);
 const questions=configuration.configuration.questions.filter(q=>args.include_outside||q.domain!=='outside');
 const map=(await access.database.query('SELECT entity_context_digest FROM signal_mass_labeling_maps WHERE id=$1',[args.map_id])).rows[0]!;
 let populationReads=0;
 const database={query:access.database.query.bind(access.database),connect:async()=>{
  const client=await access.database.connect();return new Proxy(client,{get(target,key){
   if(key!=='query'){const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}
   return async(sql:string,values?:unknown[])=>{
   if(sql.includes("FROM signal_listening_effective_population_roots_v2("))populationReads++;
   return client.query(sql,values);
  };}});
 }};
 const result=await readSignalListeningQuestionsMetricsV1({...access,database,...args,question_keys:questions.map(q=>q.key)});
 assert.equal(populationReads,1,'all requested metrics share one native effective population');
 const sql=await readFile(new URL('./signal-listening-question-metrics-before-batch.fixture.sql',import.meta.url),'utf8');
 for(const q of questions){
  const expected=(await access.database.query(sql,[access.workspace_id,args.configuration_id,args.map_id,map.entity_context_digest,q.key,args.from??null,args.to??null,args.timezone??'UTC',args.granularity??'day',args.topic_key??null,q.type,args.include_outside===true])).rows[0]!;
  const actual=result.find(r=>r.question_key===q.key)!;assert.ok(actual);
  assert.deepEqual({counts:actual.counts,distribution:actual.distribution,trend:actual.trend,topic_cross:actual.topic_cross,question_digest:actual.question_digest},expected,'every original metric field remains equal: '+q.key);
  assert.equal(actual.scope,q.scope);assert.equal(actual.coverage,actual.counts.eligible?actual.counts.asked/actual.counts.eligible:null);
 }
 assert.deepEqual(await readSignalListeningQuestionMetricsV1({...access,...args,question_key:questions[0]!.key}),result[0],'singular product reader delegates to the batch semantics');
 return result;
}
test('batch metrics preserve pending roots, both scopes, zero options, periods and hidden questions',{
 skip:!enabled,timeout:600000,
},async()=>runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async f=>{
 const configuration=structuredClone(r16ListeningWorkloadV1('defined_consumer_second_pass').configuration);
 const topic=configuration.questions.find(q=>q.topic_source)!;
 configuration.questions.push({...topic,key:'outside_probe',domain:'outside'});
 const cfg=await saveSignalListeningConfigurationV1({...f,expected_revision:0,provenance:'human',configuration});
 const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};const args={configuration_id:cfg.id,map_id:f.map_id};
 const results=await parity(access,args);assert.ok(results.some(r=>r.scope==='consumer_category'&&r.counts.awaiting_base===3));
 assert.ok(results.every(r=>r.counts.asked===0&&r.distribution.every(d=>d.count===0&&d.probability_sum===null)));
 assert.ok(results.every(r=>r.counts.corpus_eligible>0&&r.topic_cross.length===0),'roots without confirmed topics remain in every requested population');
 const empty=await parity(access,{...args,from:'2100-01-01T00:00:00Z',to:'2100-02-01T00:00:00Z',timezone:'America/Sao_Paulo',granularity:'week'});
 assert.ok(empty.every(r=>r.counts.corpus_eligible===0&&r.coverage===null&&r.trend.length===0));
 await parity(access,{...args,include_outside:true,granularity:'month'});
 await assert.rejects(readSignalListeningQuestionsMetricsV1({...access,...args,question_keys:['voice','outside_probe']}),/listening_question_hidden/);
 await assert.rejects(readSignalListeningQuestionsMetricsV1({...access,...args,question_keys:['missing']}),/listening_question_unavailable/);
 await assert.rejects(readSignalListeningQuestionsMetricsV1({...access,...args,question_keys:['voice'],topic_key:'voice'}),/listening_question_unavailable/);
 await assert.rejects(readSignalListeningQuestionsMetricsV1({...access,...args,question_keys:['voice'],timezone:'invalid'}),/listening_filters_invalid/);
 await f.database.query("UPDATE data_sources SET status='archived' WHERE workspace_id=$1",[f.workspace_id]);
 await assert.rejects(readSignalListeningQuestionsMetricsV1({...access,...args,question_keys:['voice']}),/mass_labeling_map_stale/);
}}));
test('batch metrics preserve completed classifier probabilities, H5 precedence and confirmed topic cross denominators',{
 skip:!enabled,timeout:600000,
},async()=>withSignalStudyFixtureV1(async f=>{
 const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
 const ctx=await human.getSignalListeningHumanEditContextV1(access);const key=ctx.configuration.questions.find(q=>q.topic_source)!.key;
 await parity(access,{configuration_id:ctx.expected.configuration_id,map_id:f.map_id,topic_key:key});
 const changed=await human.correctSignalListeningTopicMembershipV1({...access,expected:ctx.expected,root_id:f.roots[0]!,from_question_key:key,idempotency_key:randomUUID()});
 const results=await parity(access,{configuration_id:changed.configuration_id,map_id:f.map_id});
 const removed=results.find(r=>r.question_key===key)!;assert.equal(removed.counts.human_negative,1);assert.equal(removed.distribution.find(d=>d.option_key==='positive')!.count,2);
 assert.equal(removed.distribution.find(d=>d.option_key==='negative')!.probability_sum,null,'a human negative is not a provider probability');
 const filtered=await parity(access,{configuration_id:changed.configuration_id,map_id:f.map_id,topic_key:key,timezone:'America/Sao_Paulo'});
 assert.ok(filtered.every(r=>r.counts.corpus_eligible===2),'the removed root is excluded by its effective topic membership');
 await f.database.query("UPDATE users SET status='inactive' WHERE id=$1",[f.actor_user_id]);
 await assert.rejects(readSignalListeningQuestionsMetricsV1({...access,configuration_id:changed.configuration_id,map_id:f.map_id,question_keys:['voice']}),/listening_forbidden/);
},{complete_listening:true,additional_defined_topic:true}));
