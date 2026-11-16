import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('0326 only widens the statement answer slice to all question digests and reuses it for the final five-key join',async()=>{
 const signature='CREATE OR REPLACE FUNCTION signal_listening_population_roots_v1(';
 const previous=await readFile(new URL('./0325_signal_listening_reader_slices.sql',import.meta.url),'utf8');
 const next=await readFile(new URL('./0326_signal_listening_final_answer_slice.sql',import.meta.url),'utf8');
 let body=next.slice(next.indexOf(signature));
 const all='AND a.question_digest=ANY(ARRAY(SELECT q.question_digest FROM qs q))';
 assert.equal(body.split(all).length-1,2);body=body.replaceAll(all,"AND a.question_digest=ANY(ARRAY(SELECT q.question_digest FROM qs q WHERE q.question_key IN('voice','promotion')))");
 const final='FROM prepared i CROSS JOIN qs q FULL JOIN base_answers a';
 assert.equal(body.split(final).length-1,2);body=body.replaceAll(final,'FROM prepared i CROSS JOIN qs q LEFT JOIN signal_listening_answers a');
 assert.equal(body,previous.slice(previous.indexOf(signature)),'raw14, scope, manual overlay, rights, dispatch, barriers and every other clause stay literal');
 assert.equal((next.match(/FROM signal_listening_answers a/g)??[]).length,2,'one raw answer source per function arm');
 assert.equal((next.match(/WHERE selected_root_id IS NOT NULL AND call_id IS NOT NULL/g)??[]).length,2,'stale input history is rejected after the full-set materialization barrier');
 assert.ok(!/CREATE INDEX|force_(?:generic|custom)_plan|SET\s+(?:LOCAL\s+)?work_mem|SECURITY DEFINER/iu.test(next));
});

// A multiset proof of the relation change, independent of PostgreSQL planning.
// In particular, questions are unique by key; their digests need not be unique.
type Item={root:string;input:string};type Question={key:string;digest:string};
type Answer={root:string;input:string;ws:string;ctx:string;digest:string;answer:string;call:string};
function join<L,R>(left:L[],right:R[],on:(l:L,r:R)=>boolean,full=false):Array<[L|null,R|null]>{
 const matched=new Set<number>(),out:Array<[L|null,R|null]>=[];
 for(const l of left){let found=false;right.forEach((r,index)=>{if(on(l,r)){found=true;matched.add(index);out.push([l,r]);}});if(!found)out.push([l,null]);}
 if(full)right.forEach((r,index)=>{if(!matched.has(index))out.push([null,r]);});return out;
}
test('the final FULL preserves bags with repeated question digests, missing answers and foreign/stale cache history',()=>{
 const selected:Item[]=[{root:'one',input:'new'},{root:'two',input:'new'},{root:'empty',input:'new'}];
 const cache:Answer[]=[{root:'one',input:'new',ws:'owned',ctx:'current',digest:'shared',answer:'A',call:'a'},
  {root:'two',input:'new',ws:'owned',ctx:'current',digest:'other',answer:'B',call:'b'},
  {root:'one',input:'old',ws:'owned',ctx:'current',digest:'shared',answer:'old',call:'old'},
  {root:'one',input:'new',ws:'foreign',ctx:'current',digest:'shared',answer:'foreign',call:'foreign'},
  {root:'one',input:'new',ws:'owned',ctx:'previous',digest:'shared',answer:'context',call:'context'},
  {root:'unknown',input:'new',ws:'owned',ctx:'current',digest:'shared',answer:'unknown',call:'unknown'},
  {root:'one',input:'new',ws:'owned',ctx:'current',digest:'not-configured',answer:'retired',call:'retired'}];
 const qs:Question[]=[{key:'first',digest:'shared'},{key:'second',digest:'shared'},{key:'third',digest:'other'}];
 const canonical=(rows:unknown[])=>rows.map(row=>JSON.stringify(row)).sort();
 for(const items of [selected,selected.slice(0,1),[]])for(const questions of [qs,qs.slice(0,1),[]]){
  const left=items.flatMap(item=>questions.map(question=>({item,question})));
  const exact=(item:Item,a:Answer)=>a.ws==='owned'&&a.ctx==='current'&&a.root===item.root&&a.input===item.input;
  const match=(l:typeof left[number],a:Answer)=>exact(l.item,a)&&a.digest===l.question.digest;
  const slice=cache.filter(a=>a.ws==='owned'&&a.ctx==='current'&&items.some(i=>i.root===a.root)&&questions.some(q=>q.digest===a.digest));
  // ANY membership does not multiply records when two question keys share a digest.
  const matches=join(items,slice,exact,true),answers=matches.filter(([i,a])=>i!==null&&a!==null).map(([,a])=>a!);
  const old=join(left,cache,match),next=join(left,answers,match,true);
  assert.ok(next.every(([l])=>l!==null),'every surviving answer has a prepared-item/question partner; no unmatched right row');
  const output=([l,a]:typeof old[number])=>[l!.item.root,l!.question.key,l!.question.digest,a?.answer??null,a?.call??null];
  assert.deepEqual(canonical(next.map(output)),canonical(old.map(output)));
  assert.equal(next.length,items.length*questions.length,'PK cache permits at most one answer per item/question even with repeated digests');
 }
});
