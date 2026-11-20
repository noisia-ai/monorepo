import assert from 'node:assert/strict';
import {
 buildSignalListeningJevRequestV1,signalListeningQuestionDigestV1,type SignalListeningConfigurationV1,
 type SignalListeningQuestionV1,
} from '@noisia/query-engine';

const SYNTHETIC_ORIGINAL_LANGUAGE='en';
const SYNTHETIC_LOCALIZATION={
 en:{name:(key:string)=>`Synthetic topic ${key}`,definition:'Synthetic test metadata; classification uses the unchanged question wire.'},
 es:{name:(key:string)=>`Tema sintético ${key}`,definition:'Metadatos sintéticos de prueba; la clasificación usa el cable de pregunta sin cambios.'},
} as const;

function isNonBaseNoul(question:SignalListeningQuestionV1){return question.type==='noul'&&question.origin!=='base';}
function fixtureLocalization(key:string){
 return{original_language:SYNTHETIC_ORIGINAL_LANGUAGE,
  original:{name:SYNTHETIC_LOCALIZATION.en.name(key),definition:SYNTHETIC_LOCALIZATION.en.definition},
  en:{name:SYNTHETIC_LOCALIZATION.en.name(key),definition:SYNTHETIC_LOCALIZATION.en.definition},
  es:{name:SYNTHETIC_LOCALIZATION.es.name(key),definition:SYNTHETIC_LOCALIZATION.es.definition}};
}
function requestSnapshot(configuration:SignalListeningConfigurationV1){
 const question_keys=configuration.questions.map(question=>question.key).sort();
 return{request:buildSignalListeningJevRequestV1({text:'Synthetic fixture localization probe',question_keys},configuration),
  digests:Object.fromEntries(configuration.questions.map(question=>[question.key,signalListeningQuestionDigestV1(configuration,question)]))};
}

/** Test-data adapter only: fill missing display metadata for non-base topics.
 * Localization is excluded from the production JEV wire and question digest. */
export function localizeSyntheticListeningConfigurationV1(configuration:SignalListeningConfigurationV1):SignalListeningConfigurationV1{
 const before=requestSnapshot(configuration),localized:SignalListeningConfigurationV1={...structuredClone(configuration),questions:configuration.questions.map(question=>
  isNonBaseNoul(question)&&!question.localization?{...question,localization:fixtureLocalization(question.key)}:structuredClone(question))};
 const after=requestSnapshot(localized);
 assert.deepEqual(after.request,before.request,'synthetic localizations must not change the JEV request wire');
 assert.deepEqual(after.digests,before.digests,'synthetic localizations must not change any question digest');
 return localized;
}
