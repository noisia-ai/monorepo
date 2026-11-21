// EXPERIMENT ONLY. This module is imported by tests, never by the product reader.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {SURVEY_SCALAR_BEFORE_SQL_V1,SURVEY_SCALAR_BEFORE_RAW_SHA_V1,surveyScalarShaV1} from './signal-listening-survey-wire-scalars.test-support';

const tail='\n   , root_metadata AS MATERIALIZED(';
const candidatePrefix=`/* labeling_listening_input_metadata_v1 */ WITH native_candidates AS MATERIALIZED(
 SELECT p.root_id,p.input_digest,p.question_key,p.question_digest,p.scope_basis,
  p.body_octets::bigint text_bytes,p.platform_octets::bigint platform_bytes
 FROM signal_listening_wire_population_roots_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$8::uuid[],'llm-processing') p
 WHERE p.candidate AND p.scope_state='included' AND p.answer IS NULL
),sent AS MATERIALIZED(
 SELECT root_id,question_digest FROM signal_listening_call_questions WHERE workspace_id=$1 AND run_id=$5 AND root_id=ANY($8::uuid[])
),reservation_matches AS MATERIALIZED(
 SELECT p.*,sent.root_id reserved_root_id FROM native_candidates p FULL JOIN sent ON sent.root_id=p.root_id AND sent.question_digest=p.question_digest
),pending_native AS MATERIALIZED(
 SELECT root_id,input_digest,question_key,question_digest,scope_basis,text_bytes,platform_bytes,
  row_number() OVER(PARTITION BY root_id ORDER BY question_key) n
 FROM reservation_matches p WHERE p.root_id IS NOT NULL AND p.reserved_root_id IS NULL
  AND NOT signal_listening_human_decision_exists_v1($1::uuid,$2::uuid,$3::uuid,p.root_id,p.input_digest,$4::text,p.question_digest)
),question_roots AS MATERIALIZED(
 SELECT DISTINCT ON(p.question_key COLLATE "C",p.question_digest COLLATE "C") p.root_id,p.question_key,p.question_digest
 FROM pending_native p
 ORDER BY p.question_key COLLATE "C",p.question_digest COLLATE "C",p.root_id
),representative_args AS MATERIALIZED(
 SELECT COALESCE(array_agg(DISTINCT root_id ORDER BY root_id),ARRAY[]::uuid[]) roots FROM question_roots
 HAVING count(*)>0
),question_scalars AS MATERIALIZED(
 SELECT needed.question_key,needed.question_digest,octet_length(p.wire::text)::bigint wire_bytes,
  (octet_length(p.question_key)+octet_length(p.question_digest))::bigint question_fixed_bytes
 FROM representative_args args
 CROSS JOIN LATERAL signal_listening_wire_population_roots_v1($1::uuid,$2::uuid,$3::uuid,$4::text,args.roots,'llm-processing') p
 JOIN question_roots needed ON needed.root_id=p.root_id
  AND needed.question_key COLLATE "C" IS NOT DISTINCT FROM p.question_key COLLATE "C"
  AND needed.question_digest COLLATE "C" IS NOT DISTINCT FROM p.question_digest COLLATE "C"
 WHERE p.candidate AND p.scope_state='included' AND p.answer IS NULL
),pending AS MATERIALIZED(
 SELECT p.root_id,p.input_digest,p.question_key,p.question_digest,p.scope_basis,p.text_bytes,s.wire_bytes,
  (s.question_fixed_bytes+octet_length(COALESCE(p.scope_basis,'')))::bigint question_metadata_bytes,p.platform_bytes,p.n
 FROM pending_native p LEFT JOIN question_scalars s
  ON s.question_key COLLATE "C" IS NOT DISTINCT FROM p.question_key COLLATE "C"
   AND s.question_digest COLLATE "C" IS NOT DISTINCT FROM p.question_digest COLLATE "C")`;
/** Only this independently pinned existing statement can opt into the experiment.
 * Unknown SQL returns byte-for-byte legacy; no new format/domain rejection.
 * The native0337 lineage proof is a fixture prerequisite, not an authority seal.
 * Original roots keep their complete native SHA/rights evaluation. A second
 * native read uses only already-eligible representatives on this SAME SELECT/RR.
 * No wire/body is retained by native_candidates and an empty set cannot become
 * NULL/full population. No fixed question-count truncation is introduced. */
export function buildSurveyWireScalarCandidateV1(sql:string):string{
 if(surveyScalarShaV1(sql)!==SURVEY_SCALAR_BEFORE_RAW_SHA_V1)return sql;
 const at=sql.indexOf(tail);if(at<0||sql.split(tail).length!==2)return sql;
 return candidatePrefix+sql.slice(at);
}
export const SURVEY_SCALAR_SEQUENCE_V1=['old','new','new','old','new','old','old','new'] as const;
export type SurveyScalarSampleV1={arm:'old'|'new';index:number;client_wall_ms:number;server_execution_ms:number;server_planning_ms:number;
 result_read_client_ms?:number;rows:number;rows_sha256:string;snapshot_sha256:string;plan:unknown};
const median=(v:number[])=>{const a=[...v].sort((x,y)=>x-y);return a.length%2?a[(a.length-1)/2]!:((a[a.length/2-1]!+a[a.length/2]!)/2);};
export function summarizeSurveyScalarAbbaV1(samples:SurveyScalarSampleV1[]){
 assert.deepEqual(samples.map(s=>s.arm),[...SURVEY_SCALAR_SEQUENCE_V1]);
 for(const s of samples){assert.ok([s.client_wall_ms,s.server_execution_ms,s.server_planning_ms].every(n=>Number.isFinite(n)&&n>=0));assert.ok(Number.isSafeInteger(s.rows)&&s.rows>=0);}
 const old=samples.filter(s=>s.arm==='old'),next=samples.filter(s=>s.arm==='new');
 const ratio=(field:'client_wall_ms'|'server_execution_ms')=>{const before=median(old.map(v=>v[field]));return before>0?median(next.map(v=>v[field]))/before:null;};
 const readBefore=old.map(s=>s.result_read_client_ms),readAfter=next.map(s=>s.result_read_client_ms);
 const result_read_client_ratio=readBefore.every((n):n is number=>typeof n==='number'&&Number.isFinite(n))&&readAfter.every((n):n is number=>typeof n==='number'&&Number.isFinite(n))&&median(readBefore)>0?median(readAfter)/median(readBefore):null;
 return{order:[...SURVEY_SCALAR_SEQUENCE_V1],samples,client_wall_ratio:ratio('client_wall_ms'),server_execution_ratio:ratio('server_execution_ms'),result_read_client_ratio,
  client_clock:'EXPLAIN request through driver return; inclusive wall',server_clock:'PostgreSQL EXPLAIN Execution Time; instrumented backend elapsed, not CPU',
  result_clock:'separate ordinary SELECT through driver return, complete results compared',cpu:'UNKNOWN' as const,gain_claim:false as const,capacity_claim:false as const,materiality_gate:false as const};
}
const safeStrings=new Set(['Node Type','Parent Relationship','Join Type','Strategy','Schema','Relation Name','Alias','Index Name','CTE Name','Subplan Name','Sort Method','Sort Space Type','Function Name','Operation']);
/** Keep every numeric timing/buffer metric and structure; omit argument values
 * and verbose expressions even though this fixture is synthetic-only. */
export function sanitizeSurveyScalarPlanV1(raw:unknown):unknown{
 let nodes=0;
 const visit=(v:unknown,key:string,depth:number):unknown=>{
  assert.ok(depth<=128&&++nodes<=65536,'bounded explain tree');
  if(v===null||typeof v==='boolean')return v;
  if(typeof v==='number'){assert.ok(Number.isFinite(v),'nonfinite explain metric');return v;}
  if(typeof v==='string')return safeStrings.has(key)&&v.length<=256?v:{redacted_sha256:surveyScalarShaV1(v),bytes:Buffer.byteLength(v)};
  if(Array.isArray(v))return v.map(x=>visit(x,key,depth+1));
  assert.ok(v&&typeof v==='object');return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,visit(x,k,depth+1)]));
 };
 const sanitized=visit(raw,'',0);assert.ok(Buffer.byteLength(JSON.stringify(sanitized))<=8*1024*1024,'bounded sanitized plan');return sanitized;
}
async function readIdentity(c:Pick<PoolClient,'query'>){
 const row=(await c.query<{pid:number;read_only:string;isolation:string;snapshot:string}>("SELECT pg_backend_pid() pid,current_setting('transaction_read_only') read_only,current_setting('transaction_isolation') isolation,txid_current_snapshot()::text snapshot")).rows[0]!;
 assert.equal(row.read_only,'on');assert.equal(row.isolation,'repeatable read');return row;
}
export async function compareSurveyScalarRowsV1(c:Pick<PoolClient,'query'>,params:unknown[],options:{old?:string;next?:string}={}){
 const old=options.old??SURVEY_SCALAR_BEFORE_SQL_V1,next=options.next??buildSurveyWireScalarCandidateV1(SURVEY_SCALAR_BEFORE_SQL_V1);
 const anchor=await readIdentity(c),before=(await c.query(old,params)).rows,after=(await c.query(next,params)).rows;
 assert.equal(isDeepStrictEqual(after,before),true,'every complete metadata field, row order and NULL sentinel must match Git353');assert.deepEqual(await readIdentity(c),anchor);
 return{rows:before,rows_sha256:surveyScalarShaV1(JSON.stringify(before)),snapshot_sha256:surveyScalarShaV1(anchor.snapshot),complete_equal:true as const};
}
export async function profileSurveyScalarAbbaV1(c:Pick<PoolClient,'query'>,params:unknown[],name:string){
 assert.equal(params.length,9);assert.ok(params[7]===null||Array.isArray(params[7])&&params[7].length<=4096);
 const anchor=await readIdentity(c),sql={old:SURVEY_SCALAR_BEFORE_SQL_V1,new:buildSurveyWireScalarCandidateV1(SURVEY_SCALAR_BEFORE_SQL_V1)};
 assert.notEqual(sql.old,sql.new);let reference:unknown[]|undefined;const samples:SurveyScalarSampleV1[]=[];
 for(const[index,arm]of SURVEY_SCALAR_SEQUENCE_V1.entries()){
  const resultStart=performance.now(),rows=(await c.query(sql[arm],params)).rows,result_read_client_ms=performance.now()-resultStart;
  if(reference===undefined)reference=rows;else assert.equal(isDeepStrictEqual(rows,reference),true,'balanced ordinary reads compare every result field');
  const start=performance.now(),planRaw=(await c.query('EXPLAIN (ANALYZE,BUFFERS,VERBOSE,SETTINGS,FORMAT JSON) '+sql[arm],params)).rows[0]!['QUERY PLAN'];
  const client_wall_ms=performance.now()-start,top=planRaw[0];assert.ok(top&&typeof top==='object');
  assert.ok(Number.isFinite(top['Execution Time'])&&Number.isFinite(top['Planning Time']));
  assert.deepEqual(await readIdentity(c),anchor,'every ABBA arm stays on the same real RR/read-only client and snapshot');
  samples.push({arm,index,client_wall_ms,server_execution_ms:top['Execution Time'],server_planning_ms:top['Planning Time'],result_read_client_ms,
   rows:rows.length,rows_sha256:surveyScalarShaV1(JSON.stringify(rows)),snapshot_sha256:surveyScalarShaV1(anchor.snapshot),plan:sanitizeSurveyScalarPlanV1(planRaw)});
 }
 assert.ok(reference);return{name,root_argument:params[7]===null?'FULL_NULL':{count:(params[7] as unknown[]).length,sha256:surveyScalarShaV1(JSON.stringify(params[7]))},
  bind_values_recorded:false,old_raw_sha256:surveyScalarShaV1(sql.old),new_raw_sha256:surveyScalarShaV1(sql.new),complete_row_count:reference.length,
  complete_rows_sha256:surveyScalarShaV1(JSON.stringify(reference)),parity:true,...summarizeSurveyScalarAbbaV1(samples)};
}
