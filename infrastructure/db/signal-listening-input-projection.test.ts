import assert from 'node:assert/strict';
import test from 'node:test';
import type {PoolClient} from 'pg';
import {hydrateListeningInputProjectionV1,type ListeningInputProjectionRowV1} from './signal-listening-input-projection';
const scope={workspace_id:'workspace',map_id:'map',configuration_digest:'native-configuration'};
const projection=(keys=['a','b'])=>({input_digest:'native-digest-not-the-item-digest',question_keys:keys,
 question_digests:Object.fromEntries(keys.map(k=>[k,'shared-digest'])),scope_basis:{b:'native-basis'}});
const row=(root_id:string,bytes=8192):ListeningInputProjectionRowV1=>({root_id,working_bytes:String(bytes),projection:projection()});
function client(bodies:Array<{root_id:string;body:string;published_at:string;platform:string|null}>){
 const queries:Array<{sql:string;params:unknown[]}>=[];
 return{queries,c:{query:async(sql:string,params:unknown[])=>{queries.push({sql,params});return{rows:bodies};}}as unknown as Pick<PoolClient,'query'>};
}
test('oversized first root is decided by the canonical guard before any text read',async()=>{
 const fake=client([]),rows=[{...row('a',8193),projection:null},row('b')];
 assert.deepEqual(await hydrateListeningInputProjectionV1(fake.c,scope,rows,{max_rows:2,max_working_bytes:8192}),[]);
 await assert.rejects(hydrateListeningInputProjectionV1(fake.c,scope,rows,{max_rows:2,max_working_bytes:8192,on_oversize:'error'}),/labeling_input_memory_bound/);
 assert.equal(fake.queries.length,0);
});
test('exact boundary and first non-fitting sentinel preserve the contiguous native prefix',async()=>{
 const fake=client([{root_id:'a',body:'café 😀 "\\\n',published_at:'2025-01-01T00:00:00.123456Z',platform:null}]);
 const rows=[row('a'),{...row('b',8193),projection:null},row('c')];
 const result=await hydrateListeningInputProjectionV1(fake.c,scope,rows,{max_rows:3,max_working_bytes:8192});
 assert.deepEqual(fake.queries[0]!.params,['workspace','map',['a']]);assert.equal(fake.queries.length,1);
 assert.equal(result[0]!.text,'café 😀 "\\\n');assert.equal(result[0]!.input_digest,'native-digest-not-the-item-digest');
 assert.deepEqual(result[0]!.question_keys,['a','b']);assert.deepEqual(result[0]!.question_digests,{a:'shared-digest',b:'shared-digest'});assert.deepEqual(result[0]!.scope_basis,{b:'native-basis'});
 assert.equal(result[0]!.published_at,'2025-01-01T00:00:00.123Z');assert.equal(result[0]!.platform,null);
 assert.deepEqual([result[0]!.author,result[0]!.title,result[0]!.content_type,result[0]!.language],[null,null,null,null]);
});
test('a missing selected projection fails closed and no body is requested',async()=>{
 const fake=client([]);await assert.rejects(hydrateListeningInputProjectionV1(fake.c,scope,[{...row('a'),projection:null}],{max_rows:1,max_working_bytes:8192}),/labeling_input_metadata_invalid/);assert.equal(fake.queries.length,0);
});
test('native body mismatch fails closed instead of returning a partial or foreign hydration',async()=>{
 for(const bodies of [[],[{root_id:'foreign',body:'foreign',published_at:'2025-01-01',platform:'x'}]]){
  const fake=client(bodies);await assert.rejects(hydrateListeningInputProjectionV1(fake.c,scope,[row('a')],{max_rows:1,max_working_bytes:8192}),/labeling_input_metadata_invalid/);
 }
});
test('projection is read-local and a later call uses its own native digest and question set',async()=>{
 const fake=client([{root_id:'a',body:'native',published_at:'2025-01-01',platform:'x'}]);
 const first=await hydrateListeningInputProjectionV1(fake.c,scope,[row('a')],{max_rows:1,max_working_bytes:8192});
 const next={...row('a'),projection:{...projection(['changed']),input_digest:'new-native-digest',scope_basis:{}}};
 const second=await hydrateListeningInputProjectionV1(fake.c,scope,[next],{max_rows:1,max_working_bytes:8192});
 assert.equal(first[0]!.input_digest,'native-digest-not-the-item-digest');assert.equal(second[0]!.input_digest,'new-native-digest');assert.deepEqual(second[0]!.question_keys,['changed']);assert.equal(fake.queries.length,2);
});
test('all 256 native keys survive, including equal digests without key deduplication',async()=>{
 const keys=Array.from({length:256},(_,i)=>`key_${String(i).padStart(3,'0')}`),fake=client([{root_id:'a',body:'native',published_at:'2025-01-01',platform:null}]);
 const result=await hydrateListeningInputProjectionV1(fake.c,scope,[{...row('a'),projection:projection(keys)}],{max_rows:1,max_working_bytes:8192});
 assert.deepEqual(result[0]!.question_keys,keys);assert.equal(Object.keys(result[0]!.question_digests).length,256);
});

test('invalid metadata weights retain the canonical failure before any body read',async()=>{
 for(const weight of ['NaN','-1','8191','9007199254740992']){
  const fake=client([]);await assert.rejects(hydrateListeningInputProjectionV1(fake.c,scope,[{...row('a'),working_bytes:weight}],{max_rows:1,max_working_bytes:8192}),/labeling_input_metadata_invalid/);assert.equal(fake.queries.length,0);
 }
});
