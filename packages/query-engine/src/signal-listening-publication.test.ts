import assert from 'node:assert/strict';
import test from 'node:test';
import {signalListeningBaseTemplateV1,validateSignalListeningConfigurationV1,validateSignalListeningPublicationDeltaV1,
 validateSignalListeningTopicLocalizationV1,signalListeningQuestionDigestV1,buildSignalListeningJevRequestV1,compileSignalListeningSnapshotV1,
 type SignalListeningQuestionV1} from './signal-listening-contracts';
const base=()=>signalListeningBaseTemplateV1({category:'synthetic bikes',lexicon_terms:['bike']});
const topic={key:'repair',type:'noul' as const,text:'Is repair discussed?',positive:'Repair experiences',negative:'Other matters',scope:'all' as const,
 origin:'brand_os' as const,human_locked:false,topic_source:'defined' as const};
const localization={original_language:'en',original:{name:'Repairs',definition:'Repair experiences'},en:{name:'Repairs',definition:'Repair experiences'},es:{name:'Reparaciones',definition:'Experiencias de reparación'}};
const configuration=(q:SignalListeningQuestionV1=topic)=>validateSignalListeningConfigurationV1({...base(),questions:[...base().questions,q]});
test('new defined, discovered and untagged non-base noul topics cannot publish without all three localizations',()=>{
 const {topic_source:_,...untagged}=topic;
 for(const q of [topic,{...topic,topic_source:'discovered' as const},untagged]){
  assert.throws(()=>validateSignalListeningPublicationDeltaV1(configuration(q),base()),/listening_topic_localization_required/);
  assert.doesNotThrow(()=>validateSignalListeningPublicationDeltaV1(configuration({...q,localization}),base()));
 }
});
test('localizations require bounded nonempty original, EN and ES and a well-formed original-language tag',()=>{
 assert.deepEqual(validateSignalListeningTopicLocalizationV1(localization),localization);
 for(const locale of ['original','en','es']as const)for(const field of ['name','definition']as const){
  assert.throws(()=>validateSignalListeningTopicLocalizationV1({...localization,[locale]:{...localization[locale],[field]:'   '}}),/localization_required/);
 }
 for(const original_language of ['', 'not a language', 'en_US'])assert.throws(()=>validateSignalListeningTopicLocalizationV1({...localization,original_language}),/localization_required/);
 assert.throws(()=>validateSignalListeningTopicLocalizationV1({...localization,es:{name:'x'.repeat(161),definition:'Valid'}}));
 assert.throws(()=>validateSignalListeningTopicLocalizationV1({...localization,en:{name:'Valid',definition:'x'.repeat(1201)}}));
});
test('historical topics still parse, compile and carry forward with identical wires/digests and no invented translations',()=>{
 const legacy=configuration(),before=JSON.stringify(legacy),q=legacy.questions.find(q=>q.key===topic.key)!;
 assert.doesNotThrow(()=>compileSignalListeningSnapshotV1(legacy));
 for(const next of [legacy,{...legacy,questions:legacy.questions.map(q=>q.origin==='base'?q:{...q,human_locked:true,origin:'agent' as const})}]){
  const saved=validateSignalListeningPublicationDeltaV1(next,legacy);assert.equal(saved.questions.find(q=>q.key===topic.key)!.localization,undefined);
  assert.equal(signalListeningQuestionDigestV1(saved,q),signalListeningQuestionDigestV1(legacy,q));
 }
 assert.equal(JSON.stringify(legacy),before);
 const localized=configuration({...topic,localization}),input={text:'Synthetic bike repair',question_keys:[topic.key]};
 assert.deepEqual(buildSignalListeningJevRequestV1(input,localized),buildSignalListeningJevRequestV1(input,legacy));
 assert.equal(signalListeningQuestionDigestV1(localized,localized.questions.find(q=>q.key===topic.key)!),signalListeningQuestionDigestV1(legacy,q));
});
test('semantic edits and removing supplied localization require a complete localization, including effective configuration changes',()=>{
 const legacy=configuration();
 for(const patch of [{text:'Different question'},{positive:'Different meaning'},{negative:'Different contrast'},{scope:'consumer_category' as const},
  {topic_source:'discovered' as const},{domain:'outside' as const},{prototype_embedding_id:'00000000-0000-4000-8000-000000000001'}])
  assert.throws(()=>validateSignalListeningPublicationDeltaV1(configuration({...topic,...patch}),legacy),/localization_required/);
 assert.throws(()=>validateSignalListeningPublicationDeltaV1({...legacy,instructions:'Changed classification rules'},legacy),/localization_required/);
 const scoped=configuration({...topic,scope:'consumer_category'});
 assert.throws(()=>validateSignalListeningPublicationDeltaV1({...scoped,lexicon_terms:['different']},scoped),/localization_required/);
 const complete=configuration({...topic,localization});assert.throws(()=>validateSignalListeningPublicationDeltaV1(legacy,complete),/localization_required/);
 const invalidLanguage=configuration({...topic,localization:{...localization,original_language:'not a language'}});
 assert.doesNotThrow(()=>validateSignalListeningConfigurationV1(invalidLanguage));
 assert.throws(()=>validateSignalListeningPublicationDeltaV1(invalidLanguage,invalidLanguage),/localization_required/);
});
test('base and choice questions remain outside the new publication requirement',()=>{
 const c=base(),choice={key:'tone',type:'choice' as const,text:'Which tone?',scope:'all' as const,origin:'brand_os' as const,human_locked:false,
 options:[{key:'a',definition:'One'},{key:'b',definition:'Two'}]};
 assert.doesNotThrow(()=>validateSignalListeningPublicationDeltaV1({...c,questions:[...c.questions,choice]},c));
 assert.doesNotThrow(()=>validateSignalListeningPublicationDeltaV1(c,null));
});
