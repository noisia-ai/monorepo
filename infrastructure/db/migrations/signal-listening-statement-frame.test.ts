import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {statementFrameSourceV1,restoreStatementFrameSourceV1,statementFramePartsV1,statementFrameCanonicalProjectionV1,
 statementFrameKernelV1,statementFrameDimensionsV1,STATEMENT_FRAME_ORDER_V1} from './signal-listening-statement-frame.oracle';
import {sharedWireShaV1,sharedWireValidationV1} from './signal-listening-statement-shared-wire.oracle';
const source=()=>readFile(new URL('./0331_signal_listening_statement_payload.sql',import.meta.url),'utf8');
test('D is strictly test-only and inverses every byte to frozen installed C',async()=>{
 const c=await source(),d=statementFrameSourceV1(c);
 assert.equal(sharedWireShaV1(c),'cabed81234f56cf2647368aab03be14817d8de99073929f0d255b2a1f1153cf5');
 assert.equal(restoreStatementFrameSourceV1(d),c);assert.notEqual(d,c);
 assert.throws(()=>statementFrameSourceV1(d));assert.throws(()=>statementFrameSourceV1(c+'\n'));
 assert.throws(()=>restoreStatementFrameSourceV1(d.replace('listening_prior_outcome_unresolved','forged')));
});
test('fallback is the literal complete C canonical expression and outside SQL restores unchanged',async()=>{
 const c=await source(),d=statementFrameSourceV1(c),parts=statementFramePartsV1(c,d);
 assert.ok(parts.canonicalD.includes(parts.canonicalC));assert.ok(parts.canonicalD.includes('statement_frame_fallback_begin'));
 assert.equal((sharedWireValidationV1(d).match(/sha256\(convert_to\(/g)??[]).length,1,'full SHA remains per expected row');
 assert.equal((d.match(/CREATE OR REPLACE FUNCTION/g)??[]).length,1);
 assert.ok(!/CREATE TABLE|CREATE INDEX|GRANT |SECURITY DEFINER|SET LOCAL|ALTER TABLE/.test(d));
});
test('frame identity uses complete fresh question AND digest UTF8, not keyset, JSONB equality or a hash',async()=>{
 const {frames}=statementFramePartsV1(await source());
 assert.ok(frames.includes('FROM selected s'));
 assert.ok(frames.includes("convert_to(s.questions::text,'UTF8')"));
 assert.ok(frames.includes("convert_to(s.digests::text,'UTF8')"));
 assert.ok(frames.includes('DISTINCT ON(questions_utf8,digests_utf8)'));
 assert.ok(frames.includes('f.questions_utf8=fi.questions_utf8 AND f.digests_utf8=fi.digests_utf8'));
 assert.ok(!/md5\(|sha256\(|jsonb_populate_recordset|pg_advisory|signal_processing/.test(frames));
});
test('fast frame keeps every dynamic hole and checks exact binding with scalar type fallback',async()=>{
 const {canonicalD}=statementFramePartsV1(await source());
 for(const term of ["i->'root_id'","i->'input_digest'","expected_request->'state'",'signal_labeling_json_v1(basis)',
  'to_jsonb($1)::text','to_jsonb($5)::text',"convert_to((expected_request->'questions')::text,'UTF8')",'frame_digests_utf8'])assert.ok(canonicalD.includes(term),term);
 assert.ok(canonicalD.includes('basis IS NULL'),'SQL NULL must fall back before STRICT canonical concatenation');
 assert.ok(canonicalD.includes("ARRAY['model','questions','state']"));
});
test('byte projection and representation kernel retain canonical UTF8 and complete SHA for C and D',async()=>{
 const c=await source();for(const arm of ['C','D']as const){const sql=statementFrameCanonicalProjectionV1(c,arm);
  assert.ok(sql.includes('serialized AS MATERIALIZED'));assert.ok(sql.includes("encode(convert_to(canonical,'UTF8'),'hex')"));
  assert.ok(sql.includes("sha256(convert_to(canonical,'UTF8'))"));
 }
 const kernel=statementFrameKernelV1(c);assert.ok(kernel.includes('native_questions questions,native_digests digests'));
 assert.ok(kernel.includes('c_bytes'));assert.ok(kernel.includes('d_bytes'));assert.ok(kernel.includes('frame_used'));
 assert.ok(kernel.includes('count(*)=count(DISTINCT id) AND count(*)=count(id)'));
 assert.equal((kernel.match(/SELECT 1\/denominator FROM statement_frame_kernel_guard/g)??[]).length,2);
});
test('paired order is fixed CDDC and dimensions count actual generated wires without recording text',()=>{
 assert.deepEqual(STATEMENT_FRAME_ORDER_V1,['C','D','D','C']);
 const d=statementFrameDimensionsV1([{request:{model:'jev-1.13.0',state:'private root',questions:{q:{s:'é'},r:{s:'é'}}},inputs:[{question_digests:{q:'a',r:'b'},scope_basis:{q:'dynamic'}}]}]);
 assert.equal(d.calls,1);assert.deepEqual(d.selected_question_counts,[2]);assert.equal(d.distinct_exact_shapes,1);
 assert.ok(!JSON.stringify(d).includes('private root'));assert.ok(d.maximum_questions_wire_bytes>0);
});
