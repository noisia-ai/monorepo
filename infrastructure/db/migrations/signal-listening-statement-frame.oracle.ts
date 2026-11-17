import assert from 'node:assert/strict';
import type {PoolClient} from 'pg';
import {sharedWireShaV1,sharedWireValidationV1} from './signal-listening-statement-shared-wire.oracle';
import {anchorListeningStatementOracleParametersV1,listeningExpectedProjectionOracleSqlV1} from './signal-listening-statement-validator.oracle';
export const STATEMENT_FRAME_C_SHA_V1='cabed81234f56cf2647368aab03be14817d8de99073929f0d255b2a1f1153cf5';
export const STATEMENT_FRAME_ORDER_V1=['C','D','D','C']as const;
const canonicalBegin='/* statement_shared_wire_canonical_begin */',canonicalEnd='/* statement_shared_wire_canonical_end */';
const framesBegin='/* statement_frame_ctes_begin */',framesEnd='/* statement_frame_ctes_end */';
const fallbackBegin='/* statement_frame_fallback_begin */',fallbackEnd='/* statement_frame_fallback_end */';
const fragmentEnd='/* statement_shared_wire_fragments_end */';
function region(source:string,begin:string,end:string){assert.equal(source.split(begin).length,2);assert.equal(source.split(end).length,2);const a=source.indexOf(begin)+begin.length,b=source.indexOf(end,a);assert.ok(b>a);return{a,b,text:source.slice(a,b)};}
function once(source:string,from:string,to:string){assert.equal(source.split(from).length,2);return source.replace(from,to);}
// Every input comes from THIS statement's native selected rows. Bytea identity
// distinguishes numeric scale and NFC/NFD. No hash, keyset or cached authority.
const frames=`,
   statement_frame_inputs AS MATERIALIZED(
    SELECT s.id,s.questions,s.digests,convert_to(s.questions::text,'UTF8') questions_utf8,
     convert_to(s.digests::text,'UTF8') digests_utf8 FROM selected s
    WHERE jsonb_typeof(s.questions)='object' AND jsonb_typeof(s.digests)='object'
   ),
   statement_frame_shapes AS MATERIALIZED(
    SELECT DISTINCT ON(questions_utf8,digests_utf8) questions_utf8,digests_utf8,questions,digests
    FROM statement_frame_inputs ORDER BY questions_utf8,digests_utf8
   ),
   statement_frame_values AS MATERIALIZED(
    SELECT s.questions_utf8,s.digests_utf8,CASE WHEN EXISTS(
     SELECT 1 FROM jsonb_each(s.questions) q CROSS JOIN statement_native_fragments nf
     WHERE jsonb_typeof(nf.value->q.key->'canonical') IS DISTINCT FROM 'string'
      OR decode(nf.value->q.key->>'wire_utf8','hex') IS DISTINCT FROM convert_to(q.value::text,'UTF8')) THEN NULL
     ELSE ',"question_digests":'||public.signal_labeling_json_v1(s.digests)
      ||',"request":{"model":"jev-1.13.0","questions":'||public.signal_labeling_json_v1(s.questions)||',"state":' END frame_middle
    FROM statement_frame_shapes s
   ),
   expected AS(
    SELECT e.*,f.frame_middle,fi.questions_utf8 frame_questions_utf8,fi.digests_utf8 frame_digests_utf8
    FROM statement_frame_expected e LEFT JOIN statement_frame_inputs fi ON fi.id=e.id
    LEFT JOIN statement_frame_values f ON f.questions_utf8=fi.questions_utf8 AND f.digests_utf8=fi.digests_utf8
   )`;
function canonicalD(c:string){return `(CASE WHEN CASE
      WHEN frame_middle IS NULL THEN false
      WHEN $1 IS NULL OR $5 IS NULL OR basis IS NULL OR jsonb_typeof(i->'root_id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(i->'input_digest') IS DISTINCT FROM 'string' THEN false
      WHEN jsonb_typeof(expected_request) IS DISTINCT FROM 'object' THEN false
      WHEN ARRAY(SELECT key FROM jsonb_object_keys(expected_request) key ORDER BY key COLLATE "C")
       IS DISTINCT FROM ARRAY['model','questions','state']::text[] THEN false
      WHEN expected_request->'model' IS DISTINCT FROM to_jsonb('jev-1.13.0'::text)
       OR jsonb_typeof(expected_request->'state') IS DISTINCT FROM 'string'
       OR jsonb_typeof(expected_request->'questions') IS DISTINCT FROM 'object' THEN false
      WHEN convert_to((expected_request->'questions')::text,'UTF8') IS DISTINCT FROM frame_questions_utf8
       OR convert_to(digests::text,'UTF8') IS DISTINCT FROM frame_digests_utf8 THEN false
      ELSE true END THEN '{"entity_context_digest":'||to_jsonb($5)::text
       ||',"input_digest":'||(i->'input_digest')::text||frame_middle||(expected_request->'state')::text
       ||'},"request_version":"listening-jev-v1","root_id":'||(i->'root_id')::text
       ||',"run_id":'||to_jsonb($1)::text||',"scope_basis":'||public.signal_labeling_json_v1(basis)||'}'
      ELSE ${fallbackBegin}${c}${fallbackEnd} END)`;}
export function statementFrameSourceV1(sourceC:string){
 assert.equal(sharedWireShaV1(sourceC),STATEMENT_FRAME_C_SHA_V1,'D requires all frozen0331 bytes');
 const p=region(sourceC,canonicalBegin,canonicalEnd);
 let d=sourceC.slice(0,p.a)+canonicalD(p.text)+sourceC.slice(p.b);
 d=once(d,'   expected AS(','   statement_frame_expected AS(');
 return once(d,fragmentEnd,fragmentEnd+framesBegin+frames+framesEnd);
}
export function restoreStatementFrameSourceV1(sourceD:string){
 const p=region(sourceD,canonicalBegin,canonicalEnd),fallback=region(p.text,fallbackBegin,fallbackEnd);
 let c=sourceD.slice(0,p.a)+fallback.text+sourceD.slice(p.b);
 const f=region(c,framesBegin,framesEnd);assert.equal(f.text,frames);
 c=c.slice(0,f.a-framesBegin.length)+c.slice(f.b+framesEnd.length);
 c=once(c,'   statement_frame_expected AS(','   expected AS(');
 assert.equal(sharedWireShaV1(c),STATEMENT_FRAME_C_SHA_V1,'inverse restores all C authority and bytes');return c;
}
export function statementFramePartsV1(c:string,d=statementFrameSourceV1(c)){
 assert.equal(restoreStatementFrameSourceV1(d),c);
 const canonicalD=region(d,canonicalBegin,canonicalEnd).text,match=/^\(CASE WHEN (CASE[\s\S]*?\n      ELSE true END) THEN /.exec(canonicalD);assert.ok(match);
 return{canonicalC:region(c,canonicalBegin,canonicalEnd).text,canonicalD,fastPathPredicate:match[1]!,frames};
}
export function statementFrameCanonicalProjectionV1(c:string,arm:'C'|'D'){
 const sql=sharedWireValidationV1(arm==='C'?c:statementFrameSourceV1(c)),p=statementFramePartsV1(c),end=sql.indexOf('\n   SELECT COALESCE(');assert.ok(end>=0);
 return anchorListeningStatementOracleParametersV1(sql.slice(0,end)+`,serialized AS MATERIALIZED(SELECT id,${arm==='C'?p.canonicalC:p.canonicalD} canonical FROM expected)
 SELECT id,encode(convert_to(canonical,'UTF8'),'hex') bytes,'sha256:'||encode(sha256(convert_to(canonical,'UTF8')),'hex') digest FROM serialized ORDER BY id`);
}
export async function compareStatementFrameValidationV1(raw:PoolClient,c:string,values:unknown[]){
 const out=[];for(const arm of ['C','D']as const){const sql=sharedWireValidationV1(arm==='C'?c:statementFrameSourceV1(c));
  const result=await raw.query(anchorListeningStatementOracleParametersV1(sql),values);
  const fields=await raw.query(listeningExpectedProjectionOracleSqlV1(sql),values);
  const exact=(await raw.query(listeningExpectedProjectionOracleSqlV1(sql,true),values)).rows;
  const canonical=(await raw.query(statementFrameCanonicalProjectionV1(c,arm),values)).rows;
  out.push({flags:result.rows[0],fields:fields.fields.map(f=>[f.name,f.dataTypeID]),exact,canonical});
 }assert.deepEqual(out[1],out[0],'C/D all flags, eight typed fields, multiplicity, canonical UTF8 and full SHA equal');return out[0]!;
}
export function statementFrameKernelV1(c:string){
 const p=statementFramePartsV1(c),sql=sharedWireValidationV1(c),a=sql.indexOf('statement_wire_values AS MATERIALIZED('),b=sql.indexOf(fragmentEnd,a);assert.ok(a>=0&&b>a);
 const wires=sql.slice(a,b);
 return anchorListeningStatementOracleParametersV1(`WITH selected AS MATERIALIZED(
 SELECT id,native_questions questions,native_digests digests FROM jsonb_to_recordset($8::jsonb) e(id uuid,native_questions jsonb,native_digests jsonb)),
 statement_frame_expected AS MATERIALIZED(SELECT id,i,digests,basis,expected_request FROM jsonb_to_recordset($8::jsonb) e(id uuid,i jsonb,digests jsonb,basis jsonb,expected_request jsonb)),${wires}${frames},
 serialized AS MATERIALIZED(SELECT id,${p.canonicalC} c_canonical,${p.canonicalD} d_canonical,${p.fastPathPredicate} frame_used FROM expected)
 SELECT id,encode(convert_to(c_canonical,'UTF8'),'hex') c_bytes,encode(convert_to(d_canonical,'UTF8'),'hex') d_bytes,
 'sha256:'||encode(sha256(convert_to(c_canonical,'UTF8')),'hex') c_digest,'sha256:'||encode(sha256(convert_to(d_canonical,'UTF8')),'hex') d_digest,
 frame_used FROM serialized ORDER BY id`);
}
export function statementFrameDimensionsV1(rows:Array<{request:unknown;inputs:unknown[]}>){
 const shapes=new Set<string>(),counts=new Set<number>();let maxQuestions=0,maxDigests=0;
 for(const row of rows){const request=row.request as{questions:Record<string,unknown>},input=row.inputs[0]as{question_digests:unknown};
  const questions=JSON.stringify(request.questions),digests=JSON.stringify(input.question_digests);
  shapes.add(questions+'\0'+digests);counts.add(Object.keys(request.questions).length);
  maxQuestions=Math.max(maxQuestions,Buffer.byteLength(questions));maxDigests=Math.max(maxDigests,Buffer.byteLength(digests));
 }return{calls:rows.length,selected_question_counts:[...counts].sort((a,b)=>a-b),distinct_exact_shapes:shapes.size,
  maximum_questions_wire_bytes:maxQuestions,maximum_digests_wire_bytes:maxDigests,dimension_source:'synthetic generated JS wires; SQL identity separately uses native full UTF8',client_text_recorded:false};
}
