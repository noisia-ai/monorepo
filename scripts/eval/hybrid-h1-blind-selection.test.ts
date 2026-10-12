import assert from 'node:assert/strict';
import test from 'node:test';
import { selectDisjointHybridPositivesV1 } from './hybrid-h1-blind-selection';
test('blind sample excludes every old root across concepts and contains 30 distinct new roots',()=>{
 const rows=Array.from({length:40},(_,i)=>({root_id:`root${i}`,concept_key:`concept${i%3}`}));
 rows.push({root_id:'root35',concept_key:'other'});
 const selected=selectDisjointHybridPositivesV1(rows,new Set(rows.slice(0,10).map(r=>r.root_id)),'fresh-seed');
 assert.equal(selected.length,30);assert.equal(new Set(selected.map(r=>r.root_id)).size,30);
 assert.ok(selected.every(r=>!new Set(rows.slice(0,10).map(r=>r.root_id)).has(r.root_id)));
 assert.deepEqual(selectDisjointHybridPositivesV1(rows,new Set(rows.slice(0,10).map(r=>r.root_id)),'fresh-seed'),selected);
 assert.throws(()=>selectDisjointHybridPositivesV1(rows,new Set(rows.slice(0,11).map(r=>r.root_id)),'fresh-seed'),/insufficient/);
});
