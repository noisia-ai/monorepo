import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {fixtureSha} from './signal-workspace-topic-projection.fixture';
import test from 'node:test';
import {signalTopicConsolidationDigestV1 as digest} from '../signal-topic-consolidation';
import {indexSyntheticTopicAssignmentsByRootV1} from './signal-topic-assignment-index.synthetic.fixture';
type Assignment={ordinal:number;root_id:string;chunk_index:number;start:number;end:number;chunk_sha256:string};
const assignment=(root_id:string,ordinal:number,chunk_index=0):Assignment=>({ordinal,root_id,chunk_index,start:ordinal*11,end:ordinal*11+7,chunk_sha256:'sha256:'+ordinal.toString(16).padStart(64,'0')});
// Independent pre-change algorithm, including object key insertion order and sorting.
function previous(assignments:Assignment[],roots:Array<{root_id:string;chunk_count:number}>){
 return ['open','guided'].map(lane=>({lane,assignments,roots:roots.map(root=>({root_id:root.root_id,chunk_count:root.chunk_count,
  strength:.8,assignment_digest:digest(assignments.filter(item=>item.root_id===root.root_id).map(item=>({...item,strength:.8})))})).sort((a,b)=>a.root_id.localeCompare(b.root_id)),
  group_digest:fixtureSha(assignments.map(item=>`${JSON.stringify(item)}\n`).join(''))}));
}
function indexed(assignments:Assignment[],roots:Array<{root_id:string;chunk_count:number}>){
 const byRoot=indexSyntheticTopicAssignmentsByRootV1(assignments);
 return ['open','guided'].map(lane=>({lane,assignments,roots:roots.map(root=>({root_id:root.root_id,chunk_count:root.chunk_count,
  strength:.8,assignment_digest:digest((byRoot.get(root.root_id)??[]).map(item=>({...item,strength:.8})))})).sort((a,b)=>a.root_id.localeCompare(b.root_id)),
  group_digest:fixtureSha(assignments.map(item=>`${JSON.stringify(item)}\n`).join(''))}));
}
test('linear index preserves previous bytes and native digests for asymmetric, empty and unordered roots',()=>{
 const assignments=[assignment('z',8,3),assignment('a',2,7),assignment('z',1,0),assignment('unlisted',9),assignment('a',6,1)];
 const roots=[{root_id:'z',chunk_count:2},{root_id:'empty',chunk_count:0},{root_id:'a',chunk_count:2},{root_id:'z',chunk_count:17}];
 for(const [items,selected] of [[assignments,roots],[[],roots],[assignments,[]],[[],[]]] as Array<[Assignment[],typeof roots]>){
  const frozen=JSON.stringify({items,selected}),before=previous(items,selected),after=indexed(items,selected);
  assert.deepEqual(after,before);assert.equal(JSON.stringify(after),JSON.stringify(before));assert.equal(digest(after),digest(before));
  assert.equal(JSON.stringify({items,selected}),frozen,'indexing never mutates input arrays or assignment objects');
 }
 const index=indexSyntheticTopicAssignmentsByRootV1(assignments);assert.equal(index.get('z')![0],assignments[0]);assert.equal(index.get('z')![1],assignments[2]);
});
test('32768-root fixture index remains linear and preserves both lanes without corpus or vectors',t=>{
 const n=32768,roots=Array.from({length:n},(_,i)=>({root_id:`root-${(n-i-1).toString().padStart(5,'0')}`,chunk_count:1}));
 const assignments=roots.map((root,i)=>assignment(root.root_id,i));
 let reads=0;const observed=assignments.map(item=>Object.defineProperty({...item},'root_id',{enumerable:true,get(){reads++;return item.root_id;}}));
 const started=performance.now(),actual=indexed(observed,roots),elapsed=performance.now()-started,indexingReads=reads;
 // Unique-root stress oracle is direct construction, not another 2^30 scan.
 const expected=['open','guided'].map(lane=>({lane,assignments,roots:assignments.map(item=>({root_id:item.root_id,chunk_count:1,strength:.8,
  assignment_digest:digest([{...item,strength:.8}])})).sort((a,b)=>a.root_id.localeCompare(b.root_id)),
  group_digest:fixtureSha(assignments.map(item=>`${JSON.stringify(item)}\n`).join(''))}));
 assert.deepEqual(actual,expected);assert.equal(JSON.stringify(actual),JSON.stringify(expected));assert.equal(digest(actual),digest(expected));
 assert.equal(indexingReads,5*n,'one index pass plus one digest/serialization pass per lane; no per-root assignment scan');
 for(const root of [roots[0]!,roots[123]!,roots[n-1]!]){
  const prior=digest(assignments.filter(item=>item.root_id===root.root_id).map(item=>({...item,strength:.8})));
  assert.equal(actual[0]!.roots.find(item=>item.root_id===root.root_id)!.assignment_digest,prior);
 }
 t.diagnostic(`32768 roots; indexed construction ${elapsed.toFixed(2)} ms; assignment root accesses ${indexingReads}; native digest ${digest(actual)}`);
});
