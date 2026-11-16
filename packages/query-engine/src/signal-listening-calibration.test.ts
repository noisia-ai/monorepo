import assert from 'node:assert/strict';
import test from 'node:test';
import {signalListeningBaseTemplateV1,compileSignalListeningSnapshotV1} from './signal-listening-contracts';
import {signalListeningCalibrationShapeV1 as shape,createSignalListeningShapeCompilerV1} from './signal-listening-calibration';
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


test('compiled shape oracle preserves all subsets/permutations and hashes each repeated shape once',()=>{
 const base=signalListeningBaseTemplateV1({category:'beer',lexicon_terms:['beer']});
 const cfg={...base,questions:[...base.questions,...Array.from({length:4},(_,i)=>({key:`topic_${i}`,type:'noul' as const,text:`T${i}`,positive:'Yes',negative:'No',scope:i%2?'all' as const:'consumer_category' as const,origin:'brand_os' as const,human_locked:false,topic_source:i%2?'defined' as const:'discovered' as const}))]};
 const snapshot=compileSignalListeningSnapshotV1(cfg),compiler=createSignalListeningShapeCompilerV1(snapshot),keys=cfg.questions.map(q=>q.key);
 assert.equal(createSignalListeningShapeCompilerV1(snapshot),compiler,'derived shape work belongs to the immutable snapshot, not a new parser per consumer');
 for(let mask=1;mask<1<<keys.length;mask++){
  const selected=keys.filter((_,i)=>mask&(1<<i));for(const question_keys of [selected,selected.slice().reverse()])assert.deepEqual(compiler.shape({question_keys}),shape(cfg,{question_keys}));
 }
 const input={question_keys:['voice','promotion']};compiler.shape(input);const before=compiler.work();
 for(let i=0;i<4096;i++)assert.deepEqual(compiler.shape(input),shape(base,input));
 assert.deepEqual(compiler.work(),before,'same snapshot/shape has O(1) digest work regardless of input count');
 const mutated=compiler.shape(input);mutated.questions[0]!.option_count=999;
 assert.deepEqual(compiler.shape(input),shape(base,input));
 assert.throws(()=>compiler.shape({question_keys:['unknown']}),/unknown/);assert.throws(()=>compiler.shape({question_keys:['voice','voice']}),/invalid/);
 assert.throws(()=>createSignalListeningShapeCompilerV1({} as never),/compiled_snapshot_invalid/);
 const other=createSignalListeningShapeCompilerV1(compileSignalListeningSnapshotV1({...cfg,questions:cfg.questions.map(q=>q.key==='topic_1'?{...q,scope:'consumer_category' as const}:q)}));
 assert.notEqual(other.shape({question_keys:['topic_1']}).shape_digest,compiler.shape({question_keys:['topic_1']}).shape_digest);
});
