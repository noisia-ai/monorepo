import assert from'node:assert/strict';
import test from'node:test';
import{syntheticStudyEmbeddingVectorV1 as vector}from'./signal-client-workspace-entry.synthetic.fixture';
test('Study fixture clouds are exact deterministic unit vectors, not fabricated fit groups',()=>{
 for(let i=0;i<240;i++){const text=`Synthetic fixture root ${i.toString().padStart(4,'0')}.`,v=vector(text);assert.deepEqual(v,vector(text));assert.equal(v.length,1024);assert.ok(Math.abs(Math.hypot(...v)-1)<1e-12);assert.equal(v.indexOf(Math.max(...v)),i%3);}
 assert.throws(()=>vector('customer data'),/synthetic_study_vector_input_invalid/);assert.throws(()=>vector('Synthetic fixture root 0240.'),/synthetic_study_vector_input_invalid/);
});
