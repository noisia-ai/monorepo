import assert from 'node:assert/strict';
import test from 'node:test';
import {sharedWireSourcesV1,sharedWireValidationV1,sharedWireCanonicalPartsV1,sharedWirePayloadBarrierSourceV1,restoreSharedWirePayloadSourceV1,sharedWireCanonicalProjectionV1,sharedWirePlanSummaryV1,sharedWireShaV1,sharedWireFunctionStatsV1,sharedWireFunctionDeltaV1,sharedWireDefaultContractV1,sharedWireDefaultContractFromSourcesV1,assertSharedWireDefaultRowV1,withSharedWireDefaultPostcheckV1} from './signal-listening-statement-shared-wire.oracle';
test('DEFAULT postcheck preserves the primary body error and aggregates both failures without embedding source',async()=>{
 const primary=new Error('private SQL body detail'),after=new Error('private postcheck SQL detail');let checked=0;
 assert.equal(await withSharedWireDefaultPostcheckV1(async()=>7,async()=>{checked++;}),7);assert.equal(checked,1);
 await assert.rejects(withSharedWireDefaultPostcheckV1(async()=>{throw primary;},async()=>{checked++;}),e=>e===primary);
 await assert.rejects(withSharedWireDefaultPostcheckV1(async()=>7,async()=>{throw after;}),e=>e===after);
 await assert.rejects(withSharedWireDefaultPostcheckV1(async()=>{throw primary;},async()=>{throw after;}),error=>{
  assert.ok(error instanceof AggregateError);assert.deepEqual(error.errors,[primary,after]);assert.equal(error.cause,primary);
  assert.ok(!error.message.includes(primary.message)&&!error.message.includes(after.message));return true;
 });
 assert.equal(checked,2);
});
test('0331 is the exact proved C source and reverses all bytes to frozen0330',async()=>{
 const {readFile}=await import('node:fs/promises');const [,next]=await sharedWireSourcesV1();assert.ok(next);
 const product=await readFile(new URL('./0331_signal_listening_statement_payload.sql',import.meta.url),'utf8');
 assert.equal(sharedWireShaV1(product),'cabed81234f56cf2647368aab03be14817d8de99073929f0d255b2a1f1153cf5');
 assert.equal(product,sharedWirePayloadBarrierSourceV1(next));assert.equal(restoreSharedWirePayloadSourceV1(product),next);
});
test('default runtime contract is source-aware and rejects B body or altered metadata when0331 exists',async()=>{
 const [,sourceB]=await sharedWireSourcesV1();assert.ok(sourceB);const sourceC=sharedWirePayloadBarrierSourceV1(sourceB);
 const prior=sharedWireDefaultContractFromSourcesV1(sourceB),expected=await sharedWireDefaultContractV1();
 assert.equal(prior.default_arm,'B');assert.equal(expected.default_arm,'C');assert.equal(expected.source_sha256,sharedWireShaV1(sourceC));
 assert.equal(assertSharedWireDefaultRowV1({prosrc:prior.prosrc,...prior.metadata},prior).default_arm,'B');
 assert.notEqual(prior.prosrc_sha256,expected.prosrc_sha256);
 // Pure contract fixtures only, never evidence that PostgreSQL accepted0331.
 const row={prosrc:expected.prosrc,...expected.metadata};
 assert.equal(assertSharedWireDefaultRowV1(row,expected).prosrc_sha256,expected.prosrc_sha256);
 assert.throws(()=>assertSharedWireDefaultRowV1({...row,prosrc:prior.prosrc},expected));
 for(const patch of [{proconfig:['search_path=public']},{lanname:'sql'},{prosecdef:true},{return_type:'void'},{pronargs:1},{provolatile:'s'}])assert.throws(()=>assertSharedWireDefaultRowV1({...row,...patch},expected));
 assert.throws(()=>sharedWireDefaultContractFromSourcesV1(sourceB,sourceC+'\n'));
});
test('payload C is test-only and reverses exactly to frozen0330 with its scalar CASE and authority intact',async()=>{
 const [old,next]=await sharedWireSourcesV1();assert.ok(old&&next);
 assert.equal(sharedWireShaV1(next),'94fb81156f9ba8aa8faf3dc3502195998e701dc76e12a636418d8ef0df502305');
 const variant=sharedWirePayloadBarrierSourceV1(next);
 assert.equal(restoreSharedWirePayloadSourceV1(variant),next);
 assert.equal((variant.match(/WITH native AS MATERIALIZED\(/g)??[]).length,1);
 const before=sharedWireCanonicalPartsV1(old,next),after=sharedWireCanonicalPartsV1(old,variant);
 assert.equal(after.wires,before.wires);assert.equal(after.preimage,before.preimage);
 assert.equal(after.canonical.match(/SELECT (CASE[\s\S]*\n      END) FROM native\)$/)?.[1],before.canonical.match(/^\(SELECT (CASE[\s\S]*\n      END) FROM \(SELECT /)?.[1]);
 assert.throws(()=>sharedWirePayloadBarrierSourceV1(variant));
 assert.throws(()=>sharedWirePayloadBarrierSourceV1(next+'\n'));
 assert.throws(()=>restoreSharedWirePayloadSourceV1(variant.replace("'listening_request_invalid'","'changed_error'")));
});
test('all three byte oracles materialize serialized canonical while native validation remains separate',async()=>{
 const [old,next]=await sharedWireSourcesV1();assert.ok(old&&next);
 for(const arm of ['before','after','variant']as const){
  const sql=sharedWireCanonicalProjectionV1(old,next,arm);
  assert.ok(sql.includes('serialized AS MATERIALIZED(SELECT id,'));
  assert.ok(sql.includes('FROM serialized e ORDER BY id'));
  assert.ok(!sharedWireValidationV1(arm==='variant'?sharedWirePayloadBarrierSourceV1(next):arm==='before'?old:next).includes('serialized AS MATERIALIZED'));
 }
});
test('payload plan summary retains scoped loops and expression hashes without leaking plan literals or identities',()=>{
 const secret='https://private.invalid/00000000-0000-4000-8000-000000000123';
 const summary=sharedWirePlanSummaryV1({Plan:{'Node Type':'Aggregate','Actual Rows':1,'Actual Loops':1,Output:["jsonb_build_object('state','"+secret+"')"],Plans:[{'Node Type':'Result','Subplan Name':'CTE native','Actual Rows':1,'Actual Loops':32,Output:['jsonb_build_object($1,$2)']},{'Node Type':'CTE Scan','CTE Name':'native','Actual Rows':1,'Actual Loops':32,Output:['native.payload']},{'Node Type':'Result','Subplan Name':'SubPlan 7','Actual Rows':0,'Actual Loops':0,Output:['native.payload']}]},'Execution Time':1.2});
 const json=JSON.stringify(summary);assert.ok(!json.includes(secret)&&!json.includes('00000000-'));
 assert.ok(summary.nodes.some(n=>n.role==='CTE native'&&n.actual_loops===32));
 assert.ok(summary.nodes.some(n=>n.actual_loops===0));
 assert.ok(summary.nodes.some(n=>n.native_payload_static_refs===1));
 assert.ok(summary.nodes.every(n=>/^[0-9a-f]{64}$/.test(n.expression_sha256)));
 assert.equal(sharedWirePlanSummaryV1({Plan:{'Node Type':'Result',Plans:Array.from({length:80},()=>({'Node Type':'CTE Scan','CTE Name':'native','Actual Rows':1,'Actual Loops':32,Output:['native.payload']}))}}).emitted_nodes,64);
 const late=sharedWirePlanSummaryV1({Plan:{'Node Type':'Result',Plans:[...Array.from({length:80},()=>({'Node Type':'Result','Subplan Name':'SubPlan 1'})),{'Node Type':'Result','Subplan Name':'CTE native','Actual Rows':1,'Actual Loops':32,Output:['jsonb_build_object($1,$2)']}]}});
 assert.equal(late.total_nodes,82);assert.equal(late.selection_count,64);assert.equal(late.omission_reason,'configured_focal_summary_limit64');assert.equal(late.native_focal_complete,true);
 assert.ok(late.nodes.some(n=>n.role==='CTE native'));
});
test('optional function counters never enable tracking and refuse regressed deltas',async()=>{
 const commands:string[]=[];
 // Observe stats-reader requests only; no native function success is simulated.
 const c={query:async(sql:string)=>{commands.push(sql);return{rows:[{tracking:'none'}]};}}as unknown as Parameters<typeof sharedWireFunctionStatsV1>[0];
 const unavailable=await sharedWireFunctionStatsV1(c);assert.equal(unavailable.status,'unavailable_not_enabled');
 assert.deepEqual(commands,["SELECT current_setting('track_functions') tracking"]);
 assert.equal(sharedWireFunctionDeltaV1(unavailable,unavailable).status,'unavailable');
 const observed={status:'observed' as const,tracking:'all',rows:[{name:'signal_labeling_json_v1',calls:3,total_ms:2,self_ms:1}]};
 assert.equal(sharedWireFunctionDeltaV1(observed,{...observed,rows:[{...observed.rows[0]!,calls:2}]}).status,'unavailable_counter_regressed');
});
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
