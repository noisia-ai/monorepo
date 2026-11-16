import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {ownerTargetFunctionV1,listeningUpdateTargetsV1,scopedUpdateTargetsV1} from './signal-listening-owner-target-sets.oracle';

test('0328 changes only the two UPDATE owner target selectors, retaining every other guard and both INSERT paths',async()=>{
 const [listening,scoped,next]=await Promise.all([
  readFile(new URL('./0327_signal_listening_transition_set.sql',import.meta.url),'utf8'),
  readFile(new URL('./0278_signal_mass_labeling_scoped_authority.sql',import.meta.url),'utf8'),
  readFile(new URL('./0328_signal_listening_owner_target_sets.sql',import.meta.url),'utf8')]);
 for(const [previous,name,extract]of [[listening,'signal_listening_statement_money_v1',listeningUpdateTargetsV1],[scoped,'guard_mass_labeling_scoped_money_total_v1',scopedUpdateTargetsV1]]as const){
  const old=ownerTargetFunctionV1(previous,name).replace(/^CREATE FUNCTION/u,'CREATE OR REPLACE FUNCTION');
  const body=ownerTargetFunctionV1(next,name),before=extract(previous),after=extract(next);
  assert.equal(body.split(after.raw).length-1,1);assert.equal(body.replace(after.raw,before.raw),old);
  const barrier=after.raw.match(/WITH target_matches AS MATERIALIZED\(([\s\S]*?)\n  \)/u)?.[1];assert.ok(barrier);
  assert.ok(barrier.includes('FULL JOIN'));assert.ok(!/\bWHERE\b/iu.test(barrier));
  assert.ok(after.raw.includes('matched.new_id IS NOT NULL AND matched.old_id IS NOT NULL'));
 }
 const a=listeningUpdateTargetsV1(next).sql,b=scopedUpdateTargetsV1(next).sql;
 assert.ok(a.includes('array_agg(DISTINCT matched.run_id ORDER BY matched.run_id)'));
 assert.ok(a.includes('call_owner.run_id=matched.run_id AND call_owner.workspace_id=matched.workspace_id'));
 assert.ok(b.includes('SELECT DISTINCT matched.run_id'));assert.ok(b.includes('a.target_id=matched.run_id'));assert.ok(!/ORDER BY/u.test(b));
 assert.ok(!/CREATE INDEX|force_(?:generic|custom)_plan|SET\s+(?:LOCAL\s+)?work_mem|SECURITY DEFINER/iu.test(next));
});

type R={id:string|null;run:string;ws:string;status:string};
test('both target reductions preserve INNER bags for different IDs, foreign owners, NULLs, empty relations and hypothetical duplicates',()=>{
 const old:R[]=[{id:'a',run:'one',ws:'owned',status:'reserved'},{id:'b',run:'two',ws:'owned',status:'reserved'},{id:null,run:'one',ws:'owned',status:'reserved'}];
 const next:R[]=[{...old[0]!,status:'submitting'},{...old[1]!,status:'submitting'},
  {id:'changed',run:'one',ws:'owned',status:'submitting'},{id:null,run:'one',ws:'owned',status:'submitting'}];
 for(const ns of [next,[],[...next,next[0]!],next.map(r=>({...r,ws:'foreign'})),next.map(r=>({...r,run:'foreign'}))])for(const os of [old,[],[...old,old[0]!],old.map(r=>({...r,status:'submitted'}))]){
  const inner:Array<[R,R]>=[],full:Array<[R|null,R|null]>=[],matched=new Set<number>();
  for(const n of ns){let found=false;os.forEach((o,j)=>{if(n.id!==null&&o.id!==null&&n.id===o.id){inner.push([n,o]);full.push([n,o]);matched.add(j);found=true;}});if(!found)full.push([n,null]);}
  os.forEach((o,j)=>{if(!matched.has(j))full.push([null,o]);});
  const restored=full.filter((pair):pair is [R,R]=>pair[0]?.id!==null&&pair[0]?.id!==undefined&&pair[1]?.id!==null&&pair[1]?.id!==undefined);
  for(const scoped of [false,true]){
   const reduce=(pairs:Array<[R,R]>)=>{const values=[...new Set(pairs.filter(([n,o])=>n.status==='submitting'&&o.status==='reserved'&&['one','two'].includes(n.run)&&(scoped||n.ws==='owned')).map(([n])=>n.run))].sort();return scoped?values:values.length?values:null;};
   assert.deepEqual(reduce(restored),reduce(inner));
  }
 }
});
