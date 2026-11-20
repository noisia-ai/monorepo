import assert from 'node:assert/strict';
import test from 'node:test';
import type {PoolClient} from 'pg';
import {verifyHybridProviderRightsOracleV1} from './signal-hybrid-provider-rights.assertions';

test('bounded scalar oracle covers every unique ID and preserves input multiplicity',async()=>{
 const ids=Array.from({length:47},(_,index)=>`call-${index}`),requested=[...ids,ids[0]!,ids[22]!,'absent'];
 const probes:Array<{scalar:boolean;ids:string[]}>=[];
 const client={query:async(sql:string,args:[string,string,string[]])=>{
  assert.equal(args[0],'run');assert.equal(args[1],'workspace');
  const scalar=sql.includes('Frozen prior native rights query');
  probes.push({scalar,ids:[...args[2]]});
  const present=[...new Set(args[2])].filter(id=>id!=='absent');
  // Each selected call has two inputs, only one of which has complete rights.
  return {rows:[{found:present.length,allowed:present.length,input_count:2*present.length}]};
 }} as unknown as PoolClient;
 assert.deepEqual(await verifyHybridProviderRightsOracleV1(client,'run','workspace',requested),
  {found:47,allowed:47,input_count:94});
 const scalar=probes.filter(probe=>probe.scalar);
 assert.deepEqual(scalar.map(probe=>probe.ids.length),[20,20,8]);
 assert.deepEqual(scalar.flatMap(probe=>probe.ids),[...ids,'absent']);
 assert.deepEqual(probes.at(-1),{scalar:false,ids:requested},'full-query comparison retains the original ANY arguments');
});

test('bounded scalar oracle rejects a semantic mismatch before continuing',async()=>{
 let calls=0;
 const client={query:async()=>({rows:[{found:1,allowed:++calls===1?1:0,input_count:1}]})} as unknown as PoolClient;
 await assert.rejects(verifyHybridProviderRightsOracleV1(client,'run','workspace',['call']),/complete frozen scalar oracle/);
 assert.equal(calls,2);
});
