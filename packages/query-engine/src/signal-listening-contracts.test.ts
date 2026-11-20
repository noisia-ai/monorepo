import assert from 'node:assert/strict';
import test from 'node:test';
import {signalListeningBaseTemplateV1,validateSignalListeningConfigurationV1,signalListeningQuestionDigestV1,
  buildSignalListeningJevRequestV1,selectSignalListeningQuestionsV1,signalListeningConsumerCutV1,signalListeningJevIdentityV1,
  compileSignalListeningSnapshotV1,readSignalListeningSnapshotV1,signalListeningSnapshotWorkV1,buildSignalListeningCompiledRequestV1,
  mapSignalListeningJevResponseV1,mapSignalListeningCompiledResponseV1,type SignalListeningInputV1} from './signal-listening-contracts';

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
  assert.equal(signalListeningConsumerCutV1(c,'#bike!',base),'excluded');
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

test('one eligible phase compiles every configured question without a separate internal batch ceiling',()=>{
 const base=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['bike']});
 const c=validateSignalListeningConfigurationV1({...base,questions:[...base.questions,...Array.from({length:254},(_,i)=>({key:`question_${i}`,
  type:'choice',text:`What is answer ${i}?`,scope:'all',origin:'brand_os',human_locked:false,options:[{key:'yes',definition:'Yes'},{key:'other',definition:'Other'}]}))]});
 const request=buildSignalListeningJevRequestV1({text:'My bike',question_keys:c.questions.map(q=>q.key)},c);
 assert.equal(Object.keys(request.questions).length,256);
});


test('trusted snapshots preserve raw compiler bytes/identity and response mapping over config variants and input order',()=>{
 const base=signalListeningBaseTemplateV1({category:'té y bicicletas',lexicon_terms:['bike','té']});
 const extra={key:'repairs',type:'noul' as const,text:'¿Se habla de reparación?',positive:'Sí: reparación',negative:'No',scope:'consumer_category' as const,
  origin:'brand_os' as const,human_locked:true,topic_source:'defined' as const};
 for(const config of [base,{...base,instructions:'  Rules té ☕ with whitespace  ',questions:[extra,...base.questions].reverse()},
  {...base,questions:[...base.questions,{...extra,scope:'all' as const,domain:'outside' as const}]}]){
  const snapshot=compileSignalListeningSnapshotV1(config),state=readSignalListeningSnapshotV1(snapshot);
  assert.equal(JSON.stringify(state.identity),JSON.stringify(signalListeningJevIdentityV1(config)));
  const before=signalListeningSnapshotWorkV1(snapshot);
  for(let i=0;i<80;i++){
   const keys=(i%2?config.questions:config.questions.slice().reverse()).filter((_,n)=>n===0||i%3!==0).map(q=>q.key);
   const input={root_id:'root',input_digest:'input',text:`  Mi té ☕ y bicicleta ${i}  `,title:null,platform:null,content_type:null,author:null,published_at:'2026-01-01',language:'es',map_id:'map',configuration_digest:state.configuration_digest,question_keys:keys,question_digests:{},scope_basis:{}} as SignalListeningInputV1;
   const raw=buildSignalListeningJevRequestV1(input,config),compiled=buildSignalListeningCompiledRequestV1(input,snapshot);
   assert.equal(JSON.stringify(compiled),JSON.stringify(raw));assert.deepEqual(Buffer.from(JSON.stringify(compiled)),Buffer.from(JSON.stringify(raw)));
   const answers=Object.fromEntries(Object.entries(raw.questions).map(([key,q])=>[key,q.type==='noul'?{type:'noul' as const,noul:.4}:
    {type:'choice' as const,choice:Object.keys(q.criteria)[0]!,confidence:1,probabilities:Object.fromEntries(Object.keys(q.criteria).map((k,n)=>[k,n===0?1:0]))}]));
   const response={model:raw.model,usage:{input_tokens:20,output_tokens:0},answers};
   assert.deepEqual(mapSignalListeningCompiledResponseV1(input,{entities:[]},snapshot,response),mapSignalListeningJevResponseV1(input,{entities:[]},config,response));
  }
  assert.deepEqual(signalListeningSnapshotWorkV1(snapshot),before);assert.deepEqual(before,{validations:1,digests:3,wires:config.questions.length});
 }
});

test('snapshots isolate raw/caller mutations and forged or raw handles never bypass validation',()=>{
 const raw=signalListeningBaseTemplateV1({category:'bike',lexicon_terms:['bike']}),snapshot=compileSignalListeningSnapshotV1(raw);
 const input={text:'My bike',question_keys:['voice','promotion']},before=JSON.stringify(buildSignalListeningCompiledRequestV1(input,snapshot));
 raw.instructions='Changed rules';raw.questions[0]!.text='Changed question';
 assert.equal(JSON.stringify(buildSignalListeningCompiledRequestV1(input,snapshot)),before);
 assert.notEqual(JSON.stringify(buildSignalListeningJevRequestV1(input,raw)),before,'raw mutable callers are still parsed on each call');
 const request=buildSignalListeningCompiledRequestV1(input,snapshot);(request.questions.voice!.instructions as {rules:string}).rules='poison';
 assert.equal(JSON.stringify(buildSignalListeningCompiledRequestV1(input,snapshot)),before);
 assert.throws(()=>{readSignalListeningSnapshotV1(snapshot).configuration.questions[0]!.text='poison';},TypeError);
 const next=compileSignalListeningSnapshotV1(raw);assert.notEqual(next,snapshot);assert.notEqual(readSignalListeningSnapshotV1(next).identity_digest,readSignalListeningSnapshotV1(snapshot).identity_digest);
 for(const fake of [{},raw,{...snapshot},structuredClone(snapshot),Object.create(snapshot)])assert.throws(()=>buildSignalListeningCompiledRequestV1(input,fake),/compiled_snapshot_invalid/);
 assert.throws(()=>buildSignalListeningJevRequestV1(input,snapshot as never),/configuration_invalid/);
 assert.throws(()=>compileSignalListeningSnapshotV1(snapshot),/configuration_invalid/);
 for(const bad of [{...input,text:' '},{...input,question_keys:[]},{...input,question_keys:['voice','voice']},{...input,question_keys:['missing']}]){
  assert.throws(()=>buildSignalListeningCompiledRequestV1(bad,snapshot),/input_invalid/);assert.throws(()=>buildSignalListeningJevRequestV1(bad,raw),/input_invalid/);
 }
});
