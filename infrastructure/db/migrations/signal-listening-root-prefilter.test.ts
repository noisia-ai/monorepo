import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('the root prefilter changes only the ID page query and binds contiguous owner/run/cursor parameters',async()=>{
 const source=await readFile(new URL('../signal-listening-runs.ts',import.meta.url),'utf8');
 const start=source.indexOf('  const ids:string[]='),end=source.indexOf('\n  if(!ids.length)break;',start);assert.ok(start>=0&&end>start);
 const page=source.slice(start,end);
 assert.ok(page.includes('q.configuration_id=$4::uuid'));
 assert.ok(page.includes('sent.workspace_id=$1 AND sent.run_id=$5::uuid AND sent.root_id=i.root_id AND sent.question_digest=q.question_digest'));
 assert.ok(page.includes('AND EXISTS(')&&page.includes('AND NOT EXISTS('));
 assert.ok(page.includes("${cursor?'AND i.root_id>$6::uuid':''} ORDER BY i.root_id LIMIT $3"));
 assert.ok(page.includes('[run.workspace_id,o.map_id,sliceSize,o.configuration_id,run.id,...(cursor?[cursor]:[])]'));
 assert.ok(!/status|input_digest|entity_context_digest|answer|human|COUNT|DISTINCT/u.test(page),'this is only the necessary same-run question-link condition, with no extra result/authority assumptions');
 // Source frozen at product 9e2834b2. The entire remainder, including RR reset,
 // metadata, hydrate, bytes, bounds, rights, authority and error paths, is exact.
 assert.equal(createHash('sha256').update(source.slice(0,start)+'  /* root page query */'+source.slice(end)).digest('hex'),
  '494acf7ad10af4299ed0f26a5ca019624b27d1424c8004c2c313d20e9a5f299e');
});

type Link={ws:string;run:string;root:string;digest:string};
test('the necessary condition preserves earlier consumers, duplicate digests, foreign links and empty configurations',()=>{
 const questions=['voice','promotion','consumer','consumer'];
 const links:Link[]=[...['voice','promotion'].map(digest=>({ws:'owned',run:'current',root:'early',digest})),
  ...['voice','promotion','consumer'].map(digest=>({ws:'owned',run:'current',root:'complete',digest})),
  ...['voice','promotion','consumer'].map(digest=>({ws:'owned',run:'other',root:'foreign-run',digest})),
  ...['voice','promotion','consumer'].map(digest=>({ws:'other',run:'current',root:'foreign-workspace',digest}))];
 const sent=(root:string,digest:string)=>links.some(s=>s.ws==='owned'&&s.run==='current'&&s.root===root&&s.digest===digest);
 const passes=(root:string,qs:string[])=>qs.some(digest=>!sent(root,digest));
 assert.equal(passes('early',questions),true,'base-only links never suppress the consumer that a later transaction can enable');
 assert.equal(passes('complete',questions),false,'one link covers every question key with that same digest, just like the existing sent join');
 assert.equal(passes('foreign-run',questions),true);assert.equal(passes('foreign-workspace',questions),true);assert.equal(passes('early',[]),false);
 for(const root of ['early','complete','foreign-run','foreign-workspace','fresh'])for(const qs of [questions,questions.slice(0,2),[]])for(let mask=0;mask<1<<qs.length;mask++){
  // Any candidate/scope/cache/H5 outcome can only remove native question rows.
  const pending=qs.filter((digest,index)=>(mask&(1<<index))!==0&&!sent(root,digest));
  assert.ok(!pending.length||passes(root,qs),'every actually pending row passes the prefilter; false positives remain the native population reader responsibility');
  if(!passes(root,qs))assert.equal(pending.length,0);
 }
});
