import assert from 'node:assert/strict';
/** Coverage failures remain technical; this function never supplies negative defaults. */
export function indexStandardBaselineV2(rows:any[],roots:Array<{root_id:string;input_digest:string}>,expectedPairs=2757){
 assert.equal(rows.length,expectedPairs,'baseline_pair_coverage');
 const inputs=new Map(roots.map(root=>[root.root_id,root.input_digest]));
 const pairs=new Map<string,any>();
 for(const row of rows){
  assert.equal(row.input_digest,inputs.get(row.root_id),'baseline_root_input');
  const key=`${row.root_id}:${row.concept_key}`;
  assert.equal(pairs.has(key),false,'baseline_duplicate_pair');pairs.set(key,row);
 }
 return pairs;
}
