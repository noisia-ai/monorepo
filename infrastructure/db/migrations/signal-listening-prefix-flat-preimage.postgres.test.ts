import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {flatPreimageSourceV1,flatGatesV1,runFlatFullV1,runFlatHistoryV1,writeFlatEvidenceV1,type FlatObservationV1} from './signal-listening-prefix-flat-preimage.fixture';
const native=process.env.NOISIA_R16_PREFIX_FLAT_PREIMAGE_PG==='true',pure=process.env.NOISIA_R16_PREFIX_FLAT_PREIMAGE_PURE==='true';
assert.ok(!(native&&pure));let full:Record<string,unknown>|undefined;
test('flat prefix preimages preserve native scalar bytes and FULL consumer population',{skip:!native,timeout:900000},async()=>{full=await runFlatFullV1();});
test('flat prefix preimages preserve historical population and paired full reads',{skip:!native,timeout:900000},async()=>{
 assert.ok(full,'the real FULL consumer native case must precede the historical control');const history=await runFlatHistoryV1();await writeFlatEvidenceV1(full,history);
});
if(pure){
 test('flat prefix candidate reverses exactly to both native0326 branches',async()=>{
  const source=await readFile(new URL('./0326_signal_listening_final_answer_slice.sql',import.meta.url),'utf8'),candidate=await readFile(new URL('./signal-listening-prefix-flat-preimage.candidate.sql',import.meta.url),'utf8');
  const expressions=flatPreimageSourceV1(source,candidate);assert.ok(expressions.input_preimage.startsWith("'{\"contract_version\""));assert.ok(expressions.basis_preimage.startsWith("'{\"promotion\""));
  assert.throws(()=>flatPreimageSourceV1(source,candidate.replace('d.created_at','d.changed_at')));
  assert.throws(()=>flatPreimageSourceV1(source,candidate.replace('COALESCE(to_jsonb(i.text)', 'COALESCE(to_jsonb(i.root_fingerprint)')));
 });
 const observations=()=>{const rows:FlatObservationV1[]=[];for(const scenario of ['FULL_consumer','historical_control']as const)for(const root_mode of ['all','bounded4096']as const)for(const[position,arm]of(['old','new','new','old']as const).entries())rows.push({scenario,root_mode,arm,position,wall_ms:arm==='old'?100:80,rows:16384,snapshot_sha256:scenario+root_mode});return rows;};
 test('flat prefix gates require all sixteen ABBA observations and four independent strata',()=>{
  assert.ok(flatGatesV1(observations()).every(g=>g.accepted));assert.throws(()=>flatGatesV1(observations().slice(1)));
  const rows=observations();rows[1]!.snapshot_sha256='different';assert.throws(()=>flatGatesV1(rows));
 });
 test('flat prefix gates reject a single bad pair without pooling faster strata',()=>{const rows=observations();rows[1]!.wall_ms=111;const gates=flatGatesV1(rows);assert.equal(gates[0]!.accepted,false);assert.ok(gates.slice(1).every(g=>g.accepted));});
 test('flat prefix gates reject less than ten percent median gain',()=>{const rows=observations();rows[1]!.wall_ms=95;rows[2]!.wall_ms=95;assert.equal(flatGatesV1(rows)[0]!.accepted,false);});
}
