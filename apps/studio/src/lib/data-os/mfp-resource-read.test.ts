import assert from 'node:assert/strict';
import test from 'node:test';
import {createMfpResourceReader} from './mfp-resource-read';
test('slow MFP reads leave pool capacity available; queued aborts never reach HTTP',async()=>{
 const started:string[]=[],release:Array<()=>void>=[];let active=0,maximum=0;
 const read=createMfpResourceReader(async(endpoint,options)=>{
  assert.equal(options.method,'GET');assert.equal(options.cache,'no-store');started.push(endpoint);active++;maximum=Math.max(maximum,active);
  await new Promise<void>(resolve=>release.push(resolve));active--;return new Response('{}');
 });
 const first=read('/api/data-os/signal/a/facets'),abort=new AbortController(),canceled=read('/api/data-os/signal/a/facets?aborted',abort.signal),last=read('/api/data-os/signal/a/memberships');
 abort.abort();await assert.rejects(canceled,{name:'AbortError'});assert.deepEqual(started,['/api/data-os/signal/a/facets']);
 release.shift()!();await first;await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(started,['/api/data-os/signal/a/facets','/api/data-os/signal/a/memberships']);
 release.shift()!();await last;assert.equal(maximum,1);
});
test('a failed read releases the queue without retrying or sending a mutation',async()=>{
 const calls:string[]=[];const read=createMfpResourceReader(async(endpoint)=>{calls.push(endpoint);if(endpoint==='/api/data-os/signal/a/facets?failed')throw Error('transport');return new Response('{}');});
 const failed=read('/api/data-os/signal/a/facets?failed'),next=read('/api/data-os/signal/a/memberships');await assert.rejects(failed,/transport/);assert.equal((await next).status,200);
 assert.deepEqual(calls,['/api/data-os/signal/a/facets?failed','/api/data-os/signal/a/memberships']);
 const abort=new AbortController();abort.abort();await assert.rejects(read('/never',abort.signal),{name:'AbortError'});assert.deepEqual(calls,['/api/data-os/signal/a/facets?failed','/api/data-os/signal/a/memberships']);
});

test('three population reads fit pool3 while access reads, other workspaces and previews remain independent; queue is bounded',async()=>{
 const started:string[]=[],release:Array<()=>void>=[];let active=0,max=0;
 const read=createMfpResourceReader(async endpoint=>{started.push(endpoint);
  if(/\/a\/(?:facets|memberships)(?:\?|$)/u.test(endpoint)){active++;max=Math.max(max,active);await new Promise<void>(resolve=>release.push(resolve));active--;}
  return Response.json({ok:true});
 });
 const reads=['facets?view=labeling','facets?view=mentions','memberships?concept_key=c'].map(path=>read(`/api/data-os/signal/a/${path}`));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(started.length,1);
 for(const endpoint of ['/api/data-os/signal/b/facets','/api/data-os/signal/a/memberships/preview','/api/data-os/signal/a/analysis'])assert.equal((await read(endpoint)).status,200);
 const fourth=read('/api/data-os/signal/a/facets?fourth');
 await assert.rejects(read('/api/data-os/signal/a/facets?overflow'),/^Error: request$/);
 for(let i=0;i<4;i++){release.shift()!();await new Promise(resolve=>setImmediate(resolve));}
 assert.deepEqual((await Promise.all([...reads,fourth])).map(r=>r.status),[200,200,200,200]);assert.equal(max,1);
 // Active population reads consume at most one of three slots; two remain for context/metadata reads.
 assert.equal(3-max,2);assert.ok(!started.some(url=>url.includes('overflow')));
});
