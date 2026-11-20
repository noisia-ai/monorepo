import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import type {QueryResult} from 'pg';
import type {SignalListeningQuestionMetricsV1 as CrossMetricsV1} from '../signal-listening-serving';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {withSignalStudyFixtureV1} from './signal-study.synthetic.fixture';
import {saveSignalListeningConfigurationV1,loadSignalListeningConfigurationWithClientV1,type SignalListeningAccessV1} from '../signal-listening-configuration';
import {readSignalListeningQuestionsMetricsV1,readSignalListeningQuestionMetricsV1,type SignalListeningMetricsFiltersV1,type SignalListeningQuestionMetricsV1} from '../signal-listening-serving';
import * as human from '../signal-listening-human-edits';
import {setSignalListeningDiscoveryManualV1} from '../signal-listening-discovery';
import {localizeSyntheticListeningConfigurationV1} from './signal-listening-localized.synthetic.fixture';
import {r16ListeningWorkloadV1} from '../../../scripts/r16/listening-workload';
import {assertServingTailOriginalSqlV1,invertSignalListeningServingTailV1} from './signal-listening-serving-tail.oracle';
import {sanitizeProjectionLinearPlanV1} from './signal-listening-projection-linear-joins.oracle';
import {assertCompactNativeCasesV1} from './signal-listening-compact-population.synthetic.fixture';
const enabled=process.env.NOISIA_R16_LISTENING_METRICS_BATCH_PG==='true';
async function parity(access:SignalListeningAccessV1,args:SignalListeningMetricsFiltersV1,profile=false,requestedKeys?:string[],edges=false){
 const frozen=await readFile(new URL('./signal-listening-question-metrics-before-tail.fixture.sql',import.meta.url),'utf8');
 assertServingTailOriginalSqlV1(frozen);
 const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
 const c=await access.database.connect();let configuration;try{
  configuration=await loadSignalListeningConfigurationWithClientV1(c,access.workspace_id,args.configuration_id);
 }finally{c.release();}assert.ok(configuration);const capturedConfiguration=configuration;
 const questions=configuration.configuration.questions.filter(q=>(args.include_outside||q.domain!=='outside')&&(!requestedKeys||requestedKeys.includes(q.key)));
 const map=(await access.database.query('SELECT entity_context_digest FROM signal_mass_labeling_maps WHERE id=$1',[args.map_id])).rows[0]!;
 let populationReads=0;
 const database={query:access.database.query.bind(access.database),connect:async()=>{
  const client=await access.database.connect();return new Proxy(client,{get(target,key){
   if(key!=='query'){const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}
   return async(sql:string,values?:unknown[])=>{
   if(sql==='BEGIN')return client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   if(!sql.includes("FROM signal_listening_effective_compact_population_roots_v1("))return client.query(sql,values);
   populationReads++;
   assert.equal(invertSignalListeningServingTailV1(sql)+'\n',frozen,'actual SQL must invert exactly to the frozen original batchN');
   const identity=async()=>(await client.query("SELECT pg_current_snapshot()::text snapshot,current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') read_only")).rows[0];
   const anchor=await identity();assert.ok(anchor);assert.equal(anchor.isolation,'repeatable read');assert.equal(anchor.read_only,'on');
   const observations:Array<{arm:string;wall_ms:number;result_sha256:string}>=[];
   let current:QueryResult|undefined,expected:unknown;
   for(const arm of profile?['original','optimized','optimized','original']:['original','optimized']){
    const start=process.hrtime.bigint(),result=await client.query(arm==='original'?frozen:sql,values);
    observations.push({arm,wall_ms:Number(process.hrtime.bigint()-start)/1e6,result_sha256:sha(JSON.stringify(result.rows))});
    if(arm==='original'){if(expected)assert.deepEqual(result.rows,expected);else expected=result.rows;}
    else{assert.deepEqual(result.rows,expected,'complete original batch and optimized metrics in the SAME RR snapshot');current=result;}
    assert.deepEqual(await identity(),anchor,'both arms retain the same PostgreSQL snapshot');
   }
   if(profile){
    const plans:Record<string,unknown>={};
    for(const [arm,statement]of [['original',frozen],['optimized',sql]]as const){
     const result=(await client.query('EXPLAIN (ANALYZE,BUFFERS,TIMING OFF,FORMAT JSON) '+statement,values)).rows[0]['QUERY PLAN'][0];
     plans[arm]={planning_ms:result['Planning Time'],execution_ms:result['Execution Time'],plan:sanitizeProjectionLinearPlanV1(result.Plan)};assert.deepEqual(await identity(),anchor);
    }
    console.log('# serving tail native pair '+JSON.stringify({contract:'r16-serving-tail-native-pair-v1',evidence_kind:'SUPPLEMENTAL',order:'ORIGINAL-OPTIMIZED-OPTIMIZED-ORIGINAL',original_sql_sha256:sha(frozen),optimized_sql_sha256:sha(sql),snapshot_sha256:sha(anchor.snapshot),observations,plans,cpu_claim:false,gain_claim:false,h1_accepted:false}));
   }
   if(edges){
    // Supplemental real-PG aggregation edge cases, separate from the actual
    // native population comparison above. No table/history/trigger is changed.
    const records=capturedConfiguration.configuration.questions.flatMap(q=>Array.from({length:12},(_,i)=>{
     const noul=([.3,.7,.5,null,null,.9,.8,.8,null,.9,.6,.7][i]??null),human=q.topic_source?(i===4?true:i===5?false:null):null;
     const answer=noul===null?null:q.type==='noul'?{type:'noul',noul}:{type:'choice',choice:q.options[0]!.key,confidence:1,
      probabilities:Object.fromEntries(q.options.map((option,index)=>[option.key,index===0?1:0]))};
     return{root_id:i===11?null:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),question_key:q.key,
      has_topic_source:!!q.topic_source,candidate:i!==8,scope_state:i===6?'awaiting_base':i===7?'excluded':'included',
      answer,human_belongs:human,effective_belongs:q.topic_source?(human??(noul!==null&&noul>=.7)):null,
      published_at:i===10?null:'2026-01-02T01:30:00.123456Z',domain:i===9?'outside':q.domain??'category'};
    }));
    const call="signal_listening_effective_compact_population_roots_v1($1::uuid,$2::uuid,$3::uuid,$4,NULL::uuid[],'client-derived-metrics')";
    const replacement='jsonb_to_recordset(CASE WHEN $3::uuid IS NOT NULL AND $4::text IS NOT NULL THEN $12::jsonb END) AS population(root_id uuid,question_key text,has_topic_source boolean,candidate boolean,scope_state text,answer jsonb,human_belongs boolean,effective_belongs boolean,published_at timestamptz,domain text)';
    for(const statement of [frozen,sql])assert.equal(statement.split(call).length,2);
    const expected=(await client.query(frozen.replace(call,replacement),[...values!,JSON.stringify(records)])).rows;
    const actual=(await client.query(sql.replace(call,replacement),[...values!,JSON.stringify(records)])).rows;
    assert.deepEqual(actual,expected,'real PG preserves .3/.7 thresholds, uncertain/null, human precedence, null dates/roots, scopes and zero choice options');
    const topic=capturedConfiguration.configuration.questions.find(q=>q.topic_source&&q.domain!=='outside');assert.ok(topic);
    const distribution=actual.find(row=>row.question_key===topic.key).distribution;
    assert.deepEqual(distribution.map((row:{option_key:string;count:number})=>[row.option_key,row.count]),[['negative',2],['positive',2],['uncertain',2]]);
    const voice=capturedConfiguration.configuration.questions.find(q=>q.key==='voice');assert.ok(voice&&voice.type==='choice');
    const crossVoice:Pick<CrossMetricsV1,'question_key'|'distribution'|'topic_cross'>|undefined=actual.find(row=>row.question_key===voice.key);assert.ok(crossVoice);
    assert.ok(crossVoice.topic_cross.length>0);
    for(const cross of crossVoice.topic_cross){
     assert.ok(Object.values(cross.choices).every(count=>count>0),'unobserved choice options never acquire zero-valued topic-cross keys');
     assert.ok(Object.keys(cross.choices).every(key=>key===voice.options[0]!.key));
    }
    assert.ok(crossVoice.distribution.some(option=>option.count===0),'zero choice distribution options coexist with sparse topic-cross choices');
    for(const row of actual.filter(row=>capturedConfiguration.configuration.questions.some(q=>q.key===row.question_key&&q.type==='noul'))){
     assert.ok(row.topic_cross.every((cross:{choices:Record<string,number>})=>Object.keys(cross.choices).length===0),'non-choice NULL grouping keys cannot enter jsonb_object_agg');
    }
    const zeroRecords=records.map(row=>row.question_key===voice.key?{...row,candidate:false}:row),zeroParameters=[...values!,JSON.stringify(zeroRecords)];
    const zeroBefore=(await client.query(frozen.replace(call,replacement),zeroParameters)).rows;
    const zeroAfter=(await client.query(sql.replace(call,replacement),zeroParameters)).rows;
    assert.deepEqual(zeroAfter,zeroBefore,'integer rollup preserves zero eligible cross denominators under the same topic memberships');
    const zeroVoice:Pick<CrossMetricsV1,'question_key'|'counts'|'topic_cross'>|undefined=zeroAfter.find(row=>row.question_key===voice.key);assert.ok(zeroVoice);
    assert.equal(zeroVoice.counts.eligible,0);assert.deepEqual(zeroVoice.topic_cross,[]);
    const nullRoot='00000000-0000-4000-8000-000000000002';
    const nullChoiceRecords=records.map(row=>row.question_key===voice.key&&row.root_id===nullRoot&&row.answer
     ?{...row,answer:{...row.answer,choice:null}}:row);
    assert.equal(nullChoiceRecords.filter(row=>row.question_key===voice.key&&row.root_id===nullRoot&&row.answer?.choice===null).length,1,'one real NULL choice key belongs to a confirmed topic');
    const nullChoiceCode=async(statement:string)=>{
     await client.query('SAVEPOINT serving_cross_null_choice');
     try{await client.query(statement.replace(call,replacement),[...values!,JSON.stringify(nullChoiceRecords)]);assert.fail('a real NULL choice key must retain the original JSON object aggregate error');}
     catch(error){return(error as {code?:string}).code;}
     finally{await client.query('ROLLBACK TO SAVEPOINT serving_cross_null_choice');await client.query('RELEASE SAVEPOINT serving_cross_null_choice');}
    };
    const originalNullCode=await nullChoiceCode(frozen);assert.equal(originalNullCode,'22023');
    assert.equal(await nullChoiceCode(sql),originalNullCode,'GROUPING(choice_key) distinguishes the total row from a real NULL choice and preserves the original SQLSTATE');
    assert.deepEqual(await identity(),anchor);
    // SUM(double precision) is order-sensitive. Exercise at least three
    // heterogeneous summands per effective noul class and per choice option,
    // under identical reproducible input order/settings for both SQL arms.
    const scores=[.7,.8,.9,.1,.2,.3,.4,.5,.6],choiceScores=[.7,.8,.9];
    for(const group of [scores.slice(0,3),scores.slice(3,6),scores.slice(6)])assert.equal(new Set(group).size,3);
    const floatRecords=capturedConfiguration.configuration.questions.flatMap(q=>scores.map((noul,i)=>{
     const selected=choiceScores[i%choiceScores.length]!,probabilities=q.type==='choice'
      ?Object.fromEntries(q.options.map((option,index)=>[option.key,index===0?selected:(1-selected)/(q.options.length-1)])):null;
     return{root_id:'00000000-0000-4000-8000-'+String(i+101).padStart(12,'0'),question_key:q.key,
      has_topic_source:!!q.topic_source,candidate:true,scope_state:'included',human_belongs:null,
      answer:q.type==='noul'?{type:'noul',noul}:{type:'choice',choice:q.options[0]!.key,confidence:selected,probabilities},
      effective_belongs:q.topic_source?noul>=.7:null,published_at:'2026-01-02T01:30:00.123456Z',domain:q.domain??'category'};
    }));
    const choiceKey=capturedConfiguration.configuration.questions.find(q=>q.type==='choice')!.key;
    const choiceInputs=floatRecords.filter(row=>row.question_key===choiceKey).map(row=>row.answer.probabilities!);
    for(const option of Object.keys(choiceInputs[0]!))assert.equal(new Set(choiceInputs.map(input=>input[option])).size,3,'each choice option has three heterogeneous double inputs');
    const orders=[{name:'question_root_ascending',records:floatRecords},
     {name:'question_root_descending',records:[...floatRecords].reverse()},
     {name:'sha256_permutation',records:floatRecords.map(row=>({row,key:sha(row.question_key+':'+row.root_id)})).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0).map(value=>value.row)}];
    assert.equal(new Set(orders.map(order=>sha(JSON.stringify(order.records)))).size,3,'three reproducible and different physical recordset orders');
    const aggregateStrategies=(node:Record<string,unknown>):string[]=>[
     ...(typeof node.Strategy==='string'?[node.Strategy]:[]),
     ...(Array.isArray(node.Plans)?node.Plans.flatMap(child=>aggregateStrategies(child as Record<string,unknown>)):[])];
    const settings=(await client.query("SELECT current_setting('enable_hashagg') hashagg")).rows[0];assert.ok(settings);
    const floatObservations:Array<Record<string,unknown>>=[];
    try{
     for(const hashagg of ['on','off']){
      await client.query("SELECT set_config('enable_hashagg',$1,true)",[hashagg]);
      assert.equal((await client.query("SELECT current_setting('enable_hashagg') hashagg")).rows[0].hashagg,hashagg);
      for(const order of orders){
       const parameters=[...values!,JSON.stringify(order.records)],plans:Record<string,unknown>={};
       const expected=(await client.query(frozen.replace(call,replacement),parameters)).rows;
       const actual=(await client.query(sql.replace(call,replacement),parameters)).rows;
       for(const [arm,statement]of [['original',frozen],['optimized',sql]]as const){
        const plan=(await client.query('EXPLAIN (ANALYZE,BUFFERS,TIMING OFF,FORMAT JSON) '+statement.replace(call,replacement),parameters)).rows[0]['QUERY PLAN'][0];
        const strategies=aggregateStrategies(plan.Plan);
        if(hashagg==='off')assert.ok(strategies.every(strategy=>strategy!=='Hashed'&&strategy!=='Mixed'),'hash aggregation is actually absent from sort-only plans');
        plans[arm]={aggregate_strategies:strategies,plan:sanitizeProjectionLinearPlanV1(plan.Plan)};
       }
       const observation={order:order.name,input_sha256:sha(JSON.stringify(order.records)),enable_hashagg:hashagg,
        original_result_sha256:sha(JSON.stringify(expected)),optimized_result_sha256:sha(JSON.stringify(actual)),plans};
       floatObservations.push(observation);
       // Keep the exact case/actual plans even if strict comparison rejects it.
       console.log('# serving tail heterogeneous sum pair '+JSON.stringify({contract:'r16-serving-tail-heterogeneous-sum-pair-v2',evidence_kind:'SUPPLEMENTAL',snapshot_sha256:sha(anchor.snapshot),observation,cpu_claim:false,gain_claim:false,h1_accepted:false}));
       assert.deepEqual(actual,expected,'strict heterogeneous double SUM equality; order='+order.name+'; enable_hashagg='+hashagg);
       const actualTopic:Pick<SignalListeningQuestionMetricsV1,'question_key'|'distribution'>|undefined=actual.find(row=>row.question_key===topic.key);assert.ok(actualTopic);
       assert.deepEqual(actualTopic.distribution.map((row:{option_key:string;count:number})=>[row.option_key,row.count]),[['negative',3],['positive',3],['uncertain',3]]);
       assert.deepEqual(await identity(),anchor);
      }
     }
    }finally{await client.query("SELECT set_config('enable_hashagg',$1,true)",[settings.hashagg]);}
    assert.equal((await client.query("SELECT current_setting('enable_hashagg') hashagg")).rows[0].hashagg,settings.hashagg);
    console.log('# serving tail heterogeneous sums '+JSON.stringify({contract:'r16-serving-tail-heterogeneous-sums-v2',evidence_kind:'SUPPLEMENTAL',comparison:'strict full JSON; no rounding or tolerance',snapshot_sha256:sha(anchor.snapshot),strict_pairs_compared:floatObservations.length,cpu_claim:false,gain_claim:false,h1_accepted:false}));
    assert.deepEqual(await identity(),anchor);
   }
   assert.ok(current);return current;
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
},async()=>{await runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async f=>{
 const configuration=structuredClone(r16ListeningWorkloadV1('defined_consumer_second_pass').configuration);
 const topic=configuration.questions.find(q=>q.topic_source)!;
 configuration.questions.push({...topic,key:'outside_probe',domain:'outside'});
 const cfg=await saveSignalListeningConfigurationV1({...f,expected_revision:0,provenance:'human',configuration});
 const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};const args={configuration_id:cfg.id,map_id:f.map_id};
 await assertCompactNativeCasesV1(access,args,{extended:true,expected_scope:'awaiting_base',execute_authority:true});
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
 await assertCompactNativeCasesV1(access,args,{empty:true});
 await assert.rejects(readSignalListeningQuestionsMetricsV1({...access,...args,question_keys:['voice']}),/mass_labeling_map_stale/);
}});
 // Existing product-recovery scale and ordinary widths, under this same gate/title.
 await runMassLabelingAcceptanceFixtureV1('product-recovery',{beforeProcessing:async f=>{
  const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
  assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$2',[f.workspace_id,f.map_id])).rows[0].n,1002);
  const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:r16ListeningWorkloadV1('defined_consumer_second_pass').configuration});
  await assertCompactNativeCasesV1(access,{configuration_id:cfg.id,map_id:f.map_id},{profile_full:true});
  await parity(access,{configuration_id:cfg.id,map_id:f.map_id},true);
 }});
});
test('batch metrics preserve completed classifier probabilities, H5 precedence and confirmed topic cross denominators',{
 skip:!enabled,timeout:600000,
},async()=>withSignalStudyFixtureV1(async f=>{
 const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
 const ctx=await human.getSignalListeningHumanEditContextV1(access);const key=ctx.configuration.questions.find(q=>q.topic_source==='discovered')!.key;
 await assertCompactNativeCasesV1(access,{configuration_id:ctx.expected.configuration_id,map_id:f.map_id});
 await parity(access,{configuration_id:ctx.expected.configuration_id,map_id:f.map_id,topic_key:key});
 await parity(access,{configuration_id:ctx.expected.configuration_id,map_id:f.map_id},false,undefined,true);
 const subset=await parity(access,{configuration_id:ctx.expected.configuration_id,map_id:f.map_id,topic_key:key},false,['voice','promotion']);
 assert.ok(subset.every(metric=>metric.topic_cross.some(topic=>topic.topic_key===key)),'unrequested topics still govern filtering and cross denominators');
 const ordered=await readSignalListeningQuestionsMetricsV1({...access,configuration_id:ctx.expected.configuration_id,map_id:f.map_id,topic_key:key,question_keys:['voice','promotion','voice']});
 assert.deepEqual(ordered, [...subset].reverse(),'requested order and first-occurrence deduplication remain part of the public result');
 const changed=await human.correctSignalListeningTopicMembershipV1({...access,expected:ctx.expected,root_id:f.roots[0]!,from_question_key:key,idempotency_key:randomUUID()});
 await assertCompactNativeCasesV1(access,{configuration_id:changed.configuration_id,map_id:f.map_id},{extended:true});
 const results=await parity(access,{configuration_id:changed.configuration_id,map_id:f.map_id});
 const removed=results.find(r=>r.question_key===key)!;assert.equal(removed.counts.human_negative,1);assert.equal(removed.distribution.find(d=>d.option_key==='positive')!.count,2);
 assert.equal(removed.distribution.find(d=>d.option_key==='negative')!.probability_sum,null,'a human negative is not a provider probability');
 const filtered=await parity(access,{configuration_id:changed.configuration_id,map_id:f.map_id,topic_key:key,timezone:'America/Sao_Paulo'});
 assert.ok(filtered.every(r=>r.counts.corpus_eligible===2),'the removed root is excluded by its effective topic membership');
 // Legacy and native H5 paths deliberately coexist. Their map predicates are
 // asymmetric in0333/0316 and the compact reader must preserve both.
 const manualConfiguration=await loadSignalListeningConfigurationWithClientV1(f.database,access.workspace_id,changed.configuration_id);
 const manualTopic=manualConfiguration?.configuration.questions.find(q=>q.key===key);
 assert.equal(manualTopic?.topic_source,'discovered');
 assert.equal(manualTopic?.human_locked,true,'the real H5 correction freezes the discovered topic before legacy manual membership');
 await setSignalListeningDiscoveryManualV1({...access,configuration_id:changed.configuration_id,map_id:f.map_id,question_key:key,root_id:f.roots[2]!,belongs:false});
 await assertCompactNativeCasesV1(access,{configuration_id:changed.configuration_id,map_id:f.map_id});
 await parity(access,{configuration_id:changed.configuration_id,map_id:f.map_id});
 const latest=await human.getSignalListeningHumanEditContextV1(access);
 const moved=await human.correctSignalListeningTopicMembershipV1({...access,expected:latest.expected,root_id:f.roots[1]!,from_question_key:key,to_question_key:'additional_defined_topic',idempotency_key:randomUUID()});
 await assertCompactNativeCasesV1(access,{configuration_id:moved.configuration_id,map_id:f.map_id});
 await parity(access,{configuration_id:moved.configuration_id,map_id:f.map_id});
 const current=await loadSignalListeningConfigurationWithClientV1(f.database,access.workspace_id,moved.configuration_id);assert.ok(current);
 const template=current.configuration.questions.find(q=>q.topic_source==='defined');assert.ok(template);
 const excluded=await saveSignalListeningConfigurationV1({...access,expected_revision:current.revision,provenance:'human',configuration:localizeSyntheticListeningConfigurationV1({...current.configuration,lexicon_terms:['compact_no_lexical_match_7f34'],questions:[...current.configuration.questions,...Array.from({length:9},(_,i)=>({...template,key:'compact_defined_'+i,scope:'consumer_category' as const,human_locked:false}))]})});
 assert.ok(excluded.configuration.questions.filter(q=>q.topic_source==='defined').length>8);
 assert.equal(excluded.configuration.questions.filter(q=>q.key.startsWith('compact_defined_')&&q.scope==='consumer_category').length,9,'all new published topics exercise consumer-category scope');
 await assertCompactNativeCasesV1(access,{configuration_id:excluded.id,map_id:f.map_id},{extended:true,expected_scope:'excluded'});
 await parity(access,{configuration_id:excluded.id,map_id:f.map_id,include_outside:true});
 await f.database.query("UPDATE users SET status='inactive' WHERE id=$1",[f.actor_user_id]);
 await assert.rejects(readSignalListeningQuestionsMetricsV1({...access,configuration_id:changed.configuration_id,map_id:f.map_id,question_keys:['voice']}),/listening_forbidden/);
},{complete_listening:true,additional_defined_topic:true}));
