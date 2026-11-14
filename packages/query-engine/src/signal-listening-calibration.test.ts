import assert from 'node:assert/strict';
import test from 'node:test';
import {signalListeningBaseTemplateV1} from './signal-listening-contracts';
import {signalListeningCalibrationShapeV1 as shape} from './signal-listening-calibration';
test('calibration shape follows compiler question kinds and scopes without candidate keys',()=>{
 const c=signalListeningBaseTemplateV1({category:'beer',lexicon_terms:['beer']});
 assert.equal(shape(c,{question_keys:['voice','promotion']}).phase,'base');
 assert.deepEqual(shape(c,{question_keys:['voice','promotion']}),shape(c,{question_keys:['promotion','voice']}));
 assert.throws(()=>shape(c,{question_keys:['missing']}),/unknown/);
 assert.throws(()=>shape(c,{question_keys:['voice','voice']}),/invalid/);
 const q={key:'topic_a',type:'noul' as const,text:'A',positive:'A',negative:'Other',scope:'all' as const,origin:'brand_os' as const,human_locked:false,topic_source:'defined' as const};
 const cfg={...c,questions:[...c.questions,q,{...q,key:'topic_b',text:'B',positive:'B'}]};
 assert.equal(shape(cfg,{question_keys:['topic_a']}).shape_digest,shape(cfg,{question_keys:['topic_b']}).shape_digest);
 assert.notEqual(shape(cfg,{question_keys:['topic_a']}).shape_digest,shape({...cfg,questions:cfg.questions.map(v=>v.key==='topic_a'?{...v,scope:'consumer_category' as const}:v)},{question_keys:['topic_a']}).shape_digest);
});
