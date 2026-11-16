import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {listeningUpdateBatchSqlV1} from './signal-listening-transition-set.oracle';

test('0327 changes only the UPDATE batch selector; validation, errors, all locks and monetary checks stay literal',async()=>{
 const previous=await readFile(new URL('./0323_signal_listening_statement_selected_full_join.sql',import.meta.url),'utf8');
 const next=await readFile(new URL('./0327_signal_listening_transition_set.sql',import.meta.url),'utf8');
 const signature='CREATE OR REPLACE FUNCTION signal_listening_statement_money_v1()';
 const oldBatch=listeningUpdateBatchSqlV1(previous),batch=listeningUpdateBatchSqlV1(next);
 const replacement="batch_sql:='"+oldBatch.replace(/'/g,"''")+"';";
 const assignment='batch_sql:=$transition_batch$'+batch+'$transition_batch$;';
 assert.equal(next.split(assignment).length-1,1);
 assert.equal(next.slice(next.indexOf(signature)).replace(assignment,replacement),previous.slice(previous.indexOf(signature)));
 const barrier=batch.match(/WITH transition_matches AS MATERIALIZED\(([\s\S]*?)\n  \)/u)?.[1];assert.ok(barrier);
 assert.ok(barrier.includes('n::signal_labeling_calls new_call'));assert.ok(barrier.includes('FULL JOIN listening_old_calls o ON o.id=n.id'));
 assert.ok(!/\bWHERE\b/iu.test(barrier),'discard unmatched records only after the full-join materialization barrier');
 assert.ok(batch.includes('SELECT (matched.new_call).* FROM transition_matches matched'));
 assert.ok(batch.includes('matched.new_id IS NOT NULL AND matched.old_id IS NOT NULL'));
 assert.ok(batch.includes("(matched.new_call).run_id=$1 AND matched.old_status='reserved' AND (matched.new_call).status='submitting'"));
 assert.ok(!/CREATE INDEX|force_(?:generic|custom)_plan|SET\s+(?:LOCAL\s+)?work_mem|SECURITY DEFINER/iu.test(next));
});

type Row={id:string|null;run:string;status:string;value:string};
const canonical=(rows:unknown[])=>rows.map(row=>JSON.stringify(row)).sort();
test('FULL with both matched IDs reproduces INNER bags for different ID sets, mixed owners, NULLs and hypothetical duplicates',()=>{
 const old:Row[]=[{id:'one',run:'target',status:'reserved',value:'old one'},{id:'two',run:'target',status:'reserved',value:'old two'},
  {id:'other',run:'elsewhere',status:'reserved',value:'old foreign'},{id:null,run:'target',status:'reserved',value:'old null'}];
 const next:Row[]=[{...old[0]!,status:'submitting',value:'new one'},{id:'changed',run:'target',status:'submitting',value:'changed ID'},
  {...old[2]!,status:'submitting',value:'new foreign'},{id:null,run:'target',status:'submitting',value:'new null'}];
 for(const n of [next,[],[...next,next[0]!],next.map(r=>({...r,status:'settled'}))])for(const o of [old,[],[...old,old[0]!],old.map(r=>({...r,status:'submitted'}))]){
  const matched=new Set<number>(),full:Array<[Row|null,Row|null]>=[],inner:Array<[Row,Row]>=[];
  for(const a of n){let found=false;o.forEach((b,j)=>{if(a.id!==null&&b.id!==null&&a.id===b.id){inner.push([a,b]);full.push([a,b]);matched.add(j);found=true;}});if(!found)full.push([a,null]);}
  o.forEach((b,j)=>{if(!matched.has(j))full.push([null,b]);});
  const expected=inner.filter(([a,b])=>a.run==='target'&&b.status==='reserved'&&a.status==='submitting').map(([a])=>a);
  const actual=full.filter(([a,b])=>a?.id!==null&&a?.id!==undefined&&b?.id!==null&&b?.id!==undefined&&a.run==='target'&&b.status==='reserved'&&a.status==='submitting').map(([a])=>a);
  assert.deepEqual(canonical(actual),canonical(expected));
 }
});
