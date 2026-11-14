import assert from 'node:assert/strict';
import test from 'node:test';
import {signalListeningBaseTemplateV1,validateSignalListeningConfigurationV1,signalListeningQuestionDigestV1,
  buildSignalListeningJevRequestV1,selectSignalListeningQuestionsV1,signalListeningConsumerCutV1} from './signal-listening-contracts';

test('listening questions are versioned data; adding a question preserves unrelated cache identities',()=>{
  const config=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['bike']});
  assert.deepEqual(config.questions.map(q=>q.key).sort(),['promotion','voice']);
  const before=config.questions.map(q=>signalListeningQuestionDigestV1(config,q));
  const extra={key:'tone',type:'choice' as const,text:'What type of comment is this?',scope:'all' as const,
    origin:'brand_os' as const,human_locked:false,options:[{key:'praise',definition:'Praises the product'},{key:'other',definition:'Other comment'}]};
  const next=validateSignalListeningConfigurationV1({...config,questions:[...config.questions,extra]});
  assert.deepEqual(next.questions.filter(q=>q.key!=='tone').map(q=>signalListeningQuestionDigestV1(next,q)),before);
  const keys=next.questions.map(q=>q.key),request=buildSignalListeningJevRequestV1({root_id:'root',input_digest:'input',text:'My bike',
    title:null,platform:null,content_type:null,author:null,published_at:'2026-01-01',language:'en',question_keys:keys,question_digests:{}},next);
  assert.deepEqual(Object.keys(request.questions).sort(),['promotion','tone','voice']);
  assert.doesNotMatch(JSON.stringify(request),/trigger_barrier|barrier|methodology/u);
});

test('consumer scope waits for known base answers and includes filter/base identity in its cache',()=>{
  const config=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['bike']});
  const scoped={key:'usage',type:'choice' as const,text:'How is this used?',scope:'consumer_category' as const,
    origin:'brand_os' as const,human_locked:false,options:[{key:'personal',definition:'Personal use'},{key:'other',definition:'Other use'}]};
  const c=validateSignalListeningConfigurationV1({...config,questions:[...config.questions,scoped]});
  assert.equal(signalListeningConsumerCutV1(c,'My bike',{}),'awaiting_base');
  const base={voice:{type:'choice' as const,choice:'individual',confidence:.9,probabilities:{individual:.9,unknown:.1}},promotion:{type:'noul' as const,noul:.1}};
  assert.equal(signalListeningConsumerCutV1(c,'My bike',base),'included');
  assert.equal(signalListeningConsumerCutV1(c,'#bike',base),'excluded');
  assert.equal(signalListeningConsumerCutV1(c,'bikeway',base),'excluded');
  assert.notEqual(signalListeningQuestionDigestV1(c,scoped),signalListeningQuestionDigestV1({...c,lexicon_terms:['bicycle']},scoped));
  assert.equal(signalListeningQuestionDigestV1(c,c.questions[0]!),signalListeningQuestionDigestV1({...c,lexicon_terms:['bicycle']},c.questions[0]!));
});

test('defined topics are universal through eight; larger catalogs and discovered topics need vector candidates',()=>{
  const config=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['bike']});
  const topics=Array.from({length:9},(_,i)=>({key:`topic_${i}`,type:'noul' as const,text:`Is topic ${i} discussed?`,positive:`Topic ${i}`,negative:'Other topics',
    scope:'all' as const,origin:'brand_os' as const,human_locked:false,topic_source:'defined' as const}));
  const c=validateSignalListeningConfigurationV1({...config,questions:[...config.questions,...topics]});
  assert.equal(selectSignalListeningQuestionsV1({...c,questions:[...config.questions,...topics.slice(0,8)]},[]).filter(q=>q.topic_source).length,8);
  assert.equal(selectSignalListeningQuestionsV1(c,topics.map((q,i)=>({key:q.key,similarity:i/10}))).filter(q=>q.topic_source).length,4);
  assert.equal(selectSignalListeningQuestionsV1(c,[]).filter(q=>q.topic_source).length,0);
  assert.throws(()=>validateSignalListeningConfigurationV1({...c,questions:[...c.questions,c.questions[0]]}),/listening_configuration_invalid/);
});

test('two-level themes and outside metadata preserve semantic caches and retired keys cannot reappear silently',()=>{
 const base=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['bike']});
 const topic={key:'repairs',type:'noul' as const,text:'Is repair discussed?',positive:'Repair experiences',negative:'Other subjects',
  scope:'all' as const,origin:'agent' as const,human_locked:false,topic_source:'discovered' as const,domain:'category' as const,parent_theme_key:'maintenance'};
 const c=validateSignalListeningConfigurationV1({...base,themes:[{key:'maintenance',name:'Maintenance',origin:'agent',human_locked:false}],questions:[...base.questions,topic]});
 const changed=validateSignalListeningConfigurationV1({...c,questions:c.questions.map(q=>q.key==='repairs'?{...q,domain:'outside'}:q)});
 assert.equal(signalListeningQuestionDigestV1(c,topic),signalListeningQuestionDigestV1(changed,changed.questions.find(q=>q.key==='repairs')!));
 assert.throws(()=>validateSignalListeningConfigurationV1({...c,themes:[]}),/listening_configuration_invalid/);
 assert.throws(()=>validateSignalListeningConfigurationV1({...c,retired_question_keys:['repairs']}),/listening_configuration_invalid/);
});
