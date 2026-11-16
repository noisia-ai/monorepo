import assert from 'node:assert/strict';
import test from 'node:test';

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
