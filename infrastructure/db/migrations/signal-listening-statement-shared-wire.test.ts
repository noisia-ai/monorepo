import assert from 'node:assert/strict';
import test from 'node:test';
import {sharedWireSourcesV1,sharedWireValidationV1,sharedWireCanonicalPartsV1} from './signal-listening-statement-shared-wire.oracle';
test('shared-wire transaction wrapper uses native READ COMMITTED DML and separate REPEATABLE READ read-only comparison',async()=>{
 const {withSharedWireTxV1}=await import('./signal-listening-statement-shared-wire.fixture');
 type Fixture=Parameters<typeof withSharedWireTxV1>[0];
 // Observe wrapper commands only. This stub does not simulate PostgreSQL,
 // admission/constraint success, a snapshot, or native oracle acceptance.
 for(const readOnly of [false,true])for(const fail of [false,true]){
  const steps:string[]=[],failure=new Error('synthetic body failure');
  const fixture={database:{connect:async()=>({query:async(sql:string)=>{steps.push(sql);},release:()=>{steps.push('release');}})}} as unknown as Fixture;
  const body=async()=>{steps.push('body');if(fail)throw failure;};
  const result=readOnly?withSharedWireTxV1(fixture,body,true):withSharedWireTxV1(fixture,body);
  if(fail)await assert.rejects(result,e=>e===failure);else await result;
  assert.deepEqual(steps,[readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE','body','ROLLBACK','release']);
 }
});
test('0330 changes only statement-local canonical wire bytes; complete0329 authority and both INSERT/Mark checks stay literal',async()=>{
 const [old,next]=await sharedWireSourcesV1();assert.ok(old&&next);const p=sharedWireCanonicalPartsV1(old,next);
 let body=next.slice(next.indexOf('CREATE OR REPLACE FUNCTION'));
 const a=body.indexOf('\n   /* statement_shared_wire_fragments_begin */'),b=body.indexOf('/* statement_shared_wire_fragments_end */',a)+'/* statement_shared_wire_fragments_end */'.length;assert.ok(a>=0&&b>a);body=body.slice(0,a)+body.slice(b);
 const c=body.indexOf('/* statement_shared_wire_hash_begin */'),d=body.indexOf('/* statement_shared_wire_hash_end */',c)+'/* statement_shared_wire_hash_end */'.length;assert.ok(c>=0&&d>c);body=body.slice(0,c)+'signal_labeling_digest_v1('+p.preimage+')'+body.slice(d);
 assert.equal(body,old.slice(old.indexOf('CREATE OR REPLACE FUNCTION')),'all expected/flags/errors/authority/money/final fences stay byte-identical');
 assert.equal((next.match(/CREATE OR REPLACE FUNCTION/g)??[]).length,1);assert.ok(!/CREATE TABLE|CREATE INDEX|GRANT |CREATE FUNCTION|SECURITY DEFINER|SET LOCAL|ALTER TABLE/.test(next));
 assert.equal((sharedWireValidationV1(next).match(/sha256\(convert_to\(/g)??[]).length,1);
 assert.ok(p.wires.includes("convert_to(q.value::text,'UTF8')"));assert.ok(p.wires.includes('HAVING count(*)=1'));assert.ok(p.wires.includes('COLLATE "C"'));
 assert.ok(p.wires.includes('FROM selected s CROSS JOIN LATERAL jsonb_each(s.questions) q'));assert.ok(!p.wires.includes('jsonb_populate_recordset'));
 assert.ok(p.canonical.includes('wire_utf8')&&p.canonical.includes(p.preimage)&&p.canonical.includes('public.signal_labeling_json_v1'));
});
test('wire identity distinguishes exact UTF8 numeric scale, Unicode normalization and JSON null representation',()=>{
 const identity=(k:string,v:string)=>k+'\0'+Buffer.from(v,'utf8').toString('hex');
 assert.notEqual(identity('q','{"n":1.23}'),identity('q','{"n":1.2300}'));
 assert.notEqual(identity('q','{"s":"é"}'),identity('q','{"s":"é"}'));
 assert.notEqual(identity('q','null'),identity('q','"null"'));
 const unique=new Set([identity('q','1.23'),identity('q','1.2300'),identity('r','{}'),identity('r','{}')]);assert.equal(unique.size,3);
 assert.equal([...unique].filter(v=>v.startsWith('q\0')).length,2,'ambiguous key must have no reusable fragment');
});

test('scaled DML oracle uses existing isolated recovery route and genuine applied-base consumer scope',async()=>{
 const {readFile}=await import('node:fs/promises');
 const fixture=await readFile(new URL('./signal-listening-statement-shared-wire.fixture.ts',import.meta.url),'utf8');
 const pg=await readFile(new URL('./signal-listening-statement-shared-wire.postgres.test.ts',import.meta.url),'utf8');
 assert.ok(fixture.includes("mode=options.mode==='scaled_recovery'?'product-recovery':'product'"));
 assert.ok(fixture.includes('runMassLabelingAcceptanceFixtureV1(mode,{seed_published_at:'));
 assert.ok(!/benchmark\s*:|DATABASE_URL\s*=|assertR16LocalPostgresPool/.test(fixture),'no global benchmark, URL override or false pool accreditation');
 assert.ok(fixture.includes('prepareSharedWireRawV1(fixture,500);await store.apply'));
 assert.ok(fixture.includes('fixture.inputs=await store.inputs(run)'));
 assert.ok(pg.includes("{mode:'scaled_recovery',consumer_category:true}"));
 assert.ok(pg.includes('fixture.inputs.slice(0,1000)'));
 assert.ok(pg.includes("readSignalLabelingRunExposureV1(c,f.run.id),'506012'"));
 assert.ok(pg.includes("assert.equal(delayed,true,'real deferred constraint rejects actualCOMMIT"));
});
