import assert from 'node:assert/strict';
import test from 'node:test';
import {
 buildSignalListeningJevRequestV1,signalListeningBaseTemplateV1,signalListeningQuestionDigestV1,
 selectSignalListeningQuestionsV1,type SignalListeningConfigurationV1,
} from '@noisia/query-engine';
import {localizeSyntheticListeningConfigurationV1} from './signal-listening-localized.synthetic.fixture';

const configured=():SignalListeningConfigurationV1=>{
 const base=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']});
 return{...base,questions:[...base.questions,
  {key:'new_topic',type:'noul',text:'Synthetic topic question',positive:'Synthetic positive',negative:'Other content',scope:'consumer_category',origin:'agent',human_locked:false},
  {key:'discovered_topic',type:'noul',text:'Synthetic discovered topic',positive:'Synthetic discovered positive',negative:'Other content',scope:'all',origin:'agent',human_locked:false,topic_source:'discovered'},
  {key:'localized_topic',type:'noul',text:'Already localized synthetic topic',positive:'Existing positive',negative:'Other content',scope:'all',origin:'brand_os',human_locked:true,
   topic_source:'defined',localization:{original_language:'pt-BR',original:{name:'Tópico original sintético',definition:'Definição original sintética'},
    en:{name:'Existing English name',definition:'Existing English definition'},es:{name:'Nombre español existente',definition:'Definición española existente'}}},
  {key:'choice_topic',type:'choice',text:'Synthetic choice topic',scope:'all',origin:'brand_os',human_locked:false,
   options:[{key:'yes',definition:'Yes'},{key:'no',definition:'No'}]},
 ]};
};

test('fixture localization fills non-base noul topics without changing wire or digests',()=>{
 const before=configured(),after=localizeSyntheticListeningConfigurationV1(before),keys=before.questions.map(q=>q.key);
 assert.deepEqual(buildSignalListeningJevRequestV1({text:'same synthetic text',question_keys:keys},after),
  buildSignalListeningJevRequestV1({text:'same synthetic text',question_keys:keys},before));
 const candidates=before.questions.filter(q=>q.type==='noul').map((q,i)=>({key:q.key,similarity:1-i/10}));
 const selectedBefore=selectSignalListeningQuestionsV1(before,candidates),selectedAfter=selectSignalListeningQuestionsV1(after,candidates);
 assert.deepEqual(selectedAfter.map(q=>q.key),selectedBefore.map(q=>q.key),'selection ignores test-only display metadata');
 assert.deepEqual(selectedAfter.map(q=>signalListeningQuestionDigestV1(after,q)),selectedBefore.map(q=>signalListeningQuestionDigestV1(before,q)));
 for(const question of before.questions){
  const next=after.questions.find(q=>q.key===question.key)!;
  assert.equal(signalListeningQuestionDigestV1(before,question),signalListeningQuestionDigestV1(after,next));
  if(question.type==='noul'){
   const{localization:_before,...beforeWire}=question,{localization:_after,...afterWire}=next;
   assert.deepEqual(afterWire,beforeWire,'all question semantics and controls are preserved');
  }
 }
 assert.equal(after.questions.find(q=>q.key==='voice')?.localization,undefined);
 assert.equal(after.questions.find(q=>q.key==='promotion')?.localization,undefined);
 assert.ok(after.questions.find(q=>q.key==='new_topic')?.localization);
 assert.ok(after.questions.find(q=>q.key==='discovered_topic')?.localization);
 assert.deepEqual(after.questions.find(q=>q.key==='localized_topic')?.localization,before.questions.find(q=>q.key==='localized_topic')?.localization);
 assert.equal(after.questions.find(q=>q.key==='choice_topic')?.localization,undefined);
});

test('localization is metadata-only, deterministic, and leaves unrelated configuration data intact',()=>{
 const source=configured(),first=localizeSyntheticListeningConfigurationV1(source),second=localizeSyntheticListeningConfigurationV1(source);
 assert.deepEqual(first,second);assert.deepEqual(source,configured());
 const question=first.questions.find(q=>q.key==='new_topic')!;
 assert.equal(question.type,'noul');if(question.type!=='noul')assert.fail();
 assert.equal(question.localization?.original_language,'en');
 assert.deepEqual(question.localization?.original,question.localization?.en);
 assert.deepEqual(question.localization?.es,{name:'Tema sintético new_topic',definition:'Metadatos sintéticos de prueba; la clasificación usa el cable de pregunta sin cambios.'});
 assert.deepEqual(first.retired_question_keys,source.retired_question_keys);
 assert.deepEqual(first.retired_theme_keys,source.retired_theme_keys);
 assert.deepEqual(first.themes,source.themes);
});
