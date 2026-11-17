import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {PoolClient} from 'pg';
export const ANSWER_GUARD_FILE_SHA_V1='03a4cafd5e923bc6b94ca080b70e433213deb3f79bf5fc3e5f395b857047f954';
export const ANSWER_GUARD_C_SHA_V1='12356439d80648f2ee54c0a3267a562778b8e189bf06a4e365933bc2bb7605d5';
const sha=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex');
const loadC=` SELECT * INTO call FROM signal_labeling_calls WHERE id=NEW.call_id AND workspace_id=NEW.workspace_id AND run_id=NEW.run_id;
 SELECT * INTO r FROM signal_labeling_runs WHERE id=NEW.run_id;
 SELECT * INTO owner FROM signal_listening_runs WHERE run_id=r.id AND workspace_id=NEW.workspace_id;
 SELECT * INTO q FROM signal_listening_questions WHERE configuration_id=owner.configuration_id AND question_key=NEW.question_key;
`;
// No filters on the anchor or on another LEFT JOIN's absent row. The original
// run lookup depends on NEW.run_id, independently of whether call was found.
// Native composites retain their PostgreSQL row types; no JSON conversion.
const loadE=` /* answer_guard_join_begin */
 SELECT CASE WHEN loaded_call.id IS NULL THEN ROW(loaded_call.*)::signal_labeling_calls ELSE loaded_call END AS call_row,
 CASE WHEN loaded_run.id IS NULL THEN ROW(loaded_run.*)::signal_labeling_runs ELSE loaded_run END AS run_row,
 CASE WHEN loaded_owner.run_id IS NULL THEN ROW(loaded_owner.*)::signal_listening_runs ELSE loaded_owner END AS owner_row,
 CASE WHEN loaded_question.configuration_id IS NULL THEN ROW(loaded_question.*)::signal_listening_questions ELSE loaded_question END AS question_row
 INTO answer_join FROM (SELECT 1) anchor
 LEFT JOIN signal_labeling_calls loaded_call ON loaded_call.id=NEW.call_id AND loaded_call.workspace_id=NEW.workspace_id AND loaded_call.run_id=NEW.run_id
 LEFT JOIN signal_labeling_runs loaded_run ON loaded_run.id=NEW.run_id
 LEFT JOIN signal_listening_runs loaded_owner ON loaded_owner.run_id=loaded_run.id AND loaded_owner.workspace_id=NEW.workspace_id
 LEFT JOIN signal_listening_questions loaded_question ON loaded_question.configuration_id=loaded_owner.configuration_id AND loaded_question.question_key=NEW.question_key;
 call:=answer_join.call_row;
 r:=answer_join.run_row;
 owner:=answer_join.owner_row;
 q:=answer_join.question_row;
 FOUND:=q.configuration_id IS NOT NULL;
 /* answer_guard_join_end */
`;
function once(text:string,from:string,to:string){assert.equal(text.split(from).length,2);return text.replace(from,to);}
export async function answerGuardSourcesV1(){
 const body=await readFile(new URL('./0296_signal_listening_configuration.sql',import.meta.url),'utf8');
 assert.equal(sha(body),ANSWER_GUARD_FILE_SHA_V1,'the complete0296 source is frozen');
 const start=body.indexOf('CREATE FUNCTION signal_listening_answer_guard_v1()'),end=body.indexOf('\nCREATE TRIGGER signal_listening_answer_guard',start);
 assert.ok(start>=0&&end>start);const original=body.slice(start,end);
 assert.equal(sha(original),'a95bf5b0e43ac3217994c137a362f652cdc3d575249b4c1102a00fb8c1886b05');
 const c=once(original,'CREATE FUNCTION','CREATE OR REPLACE FUNCTION');assert.equal(sha(c),ANSWER_GUARD_C_SHA_V1);
 return{file:{file:'0296_signal_listening_configuration.sql',sha256:sha(body)},c,e:answerGuardJoinedSourceV1(c)};
}
export function answerGuardJoinedSourceV1(c:string){
 assert.equal(sha(c),ANSWER_GUARD_C_SHA_V1,'E requires the complete original executable answer guard');
 return once(once(c,'result jsonb;','result jsonb;answer_join record;'),loadC,loadE);
}
export function restoreAnswerGuardSourceV1(e:string){
 const c=once(once(e,loadE,loadC),'result jsonb;answer_join record;','result jsonb;');
 assert.equal(sha(c),ANSWER_GUARD_C_SHA_V1,'restores every original receipt, right, actor and shape check');return c;
}
export function answerGuardPartsV1(c:string){
 const e=answerGuardJoinedSourceV1(c);assert.equal(restoreAnswerGuardSourceV1(e),c);
 const a=c.indexOf('DECLARE '),b=c.indexOf('\nBEGIN',a);assert.ok(a>=0&&b>a);
 return{loadC,loadE,declarationC:c.slice(a,b),declarationE:c.slice(a,b).replace('result jsonb;','result jsonb;answer_join record;'),
  checks:c.slice(c.indexOf(' result:=call.results->0;'))};
}
export function answerGuardContractV1(source:string){
 assert.ok(sha(source)===ANSWER_GUARD_C_SHA_V1||restoreAnswerGuardSourceV1(source));
 const marker=' AS $$',a=source.indexOf(marker),b=source.lastIndexOf('$$;');assert.ok(a>=0&&b>a);
 const prosrc=source.slice(a+marker.length,b);
 return{source_sha256:sha(source),prosrc,prosrc_sha256:sha(prosrc),metadata:{proconfig:['search_path=public, extensions, pg_temp'],lanname:'plpgsql',
  prosecdef:false,return_type:'trigger',pronargs:0,proretset:false,provolatile:'v',proisstrict:false,proparallel:'u',proleakproof:false,prokind:'f'}};
}
export function assertAnswerGuardRowV1(row:Record<string,unknown>|undefined,expected:ReturnType<typeof answerGuardContractV1>){
 assert.ok(row&&typeof row.prosrc==='string');assert.equal(row.prosrc,expected.prosrc);
 const {prosrc,...metadata}=row;assert.deepEqual(metadata,expected.metadata);
 return{contract:'r16-answer-guard-runtime-v1',source_sha256:expected.source_sha256,actual_prosrc_sha256:sha(prosrc),actual_pg_proc_checked:true,metadata};
}
export async function assertAnswerGuardRuntimeV1(raw:Pick<PoolClient,'query'>,source:string){
 const rows=(await raw.query(`SELECT p.prosrc,p.proconfig,l.lanname,p.prosecdef,p.prorettype::regtype::text return_type,
 p.pronargs,p.proretset,p.provolatile,p.proisstrict,p.proparallel,p.proleakproof,p.prokind
 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid='public.signal_listening_answer_guard_v1()'::regprocedure`)).rows;
 assert.equal(rows.length,1);return assertAnswerGuardRowV1(rows[0],answerGuardContractV1(source));
}
/** Test-only readback in the same native backend; never authorizes an answer. */
export function answerGuardProjectionOracleV1(c:string,arm:'C'|'E'){
 const p=answerGuardPartsV1(c),declaration=arm==='C'?p.declarationC:p.declarationE,load=(arm==='C'?p.loadC:p.loadE).replaceAll('NEW.','attempt.');
 return `CREATE OR REPLACE FUNCTION pg_temp.noisia_answer_projection_${arm.toLowerCase()}(attempt signal_listening_answers)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $answer_projection$
${declaration}
BEGIN
${load} RETURN jsonb_build_object('call',to_jsonb(call),'run',to_jsonb(r),'owner',to_jsonb(owner),'question',to_jsonb(q),
 'field_types',jsonb_build_object('call',pg_typeof(call)::text,'run',pg_typeof(r)::text,'owner',pg_typeof(owner)::text,'question',pg_typeof(q)::text),'found',FOUND);
END $answer_projection$;`;
}
/** Read the literal production APPLY statements; these are not a new protocol. */
export async function answerGuardProductSqlV1(){
 const files=[{file:'signal-listening-runs.ts',sha256:'86b080e064dbb97a80e11bec610f52a99b4101aacc6b51c8a88928a9ad69add2'},
  {file:'signal-labeling-runs.ts',sha256:'b46e0b8d7a6d7b4957dd447d52c6b91ad9d9f1472bbe1d66d8a2842f8bd15646'}]as const;
 const bodies=await Promise.all(files.map(async file=>{const text=await readFile(new URL('../'+file.file,import.meta.url),'utf8');assert.equal(sha(text),file.sha256);return text;}));
 const literal=(body:string,needle:string)=>{assert.equal(body.split(needle).length,2);const at=body.indexOf(needle),a=body.lastIndexOf('`',at),b=body.indexOf('`',at);assert.ok(a>=0&&b>at);
  const sql=body.slice(a+1,b);assert.ok(sql.startsWith(needle));assert.ok(!sql.includes('${'));return sql;};
 const sql={answers:literal(bodies[0]!, 'INSERT INTO signal_listening_answers(workspace_id,root_id,input_digest,entity_context_digest,'),
  results:literal(bodies[1]!, 'UPDATE signal_labeling_calls call SET results_applied=true,results=page.results,updated_at=now()'),
  runFence:literal(bodies[1]!, 'WITH raw_run_fence AS MATERIALIZED('),
  callLock:literal(bodies[1]!, 'SELECT id FROM signal_labeling_calls\n      WHERE workspace_id=$1 AND run_id=$2 AND id=ANY($3::uuid[]) ORDER BY id FOR UPDATE'),
  replay:literal(bodies[1]!, 'SELECT call.id,call.results_applied,'),
  mutationFence:literal(bodies[1]!, 'INSERT INTO signal_labeling_page_mutation_fences(workspace_id,run_id,lease_token,operation)')};
 return{files,sql,hashes:Object.fromEntries(Object.entries(sql).map(([name,text])=>[name,sha(text)]))};
}

/** Drain native lock contenders before the caller restores the public C body.
 * Even failed rollback/release must not abandon the other live query. */
export async function drainAnswerGuardWaitersV1(holder:Pick<PoolClient,'query'|'release'>,pending:Promise<unknown>|undefined,contender?:Pick<PoolClient,'query'|'release'>){
 const errors:unknown[]=[];
 const close=async(client:Pick<PoolClient,'query'|'release'>)=>{let broken=false;try{await client.query('ROLLBACK');}catch(error){broken=true;errors.push(error);}
  try{client.release(broken);}catch(error){errors.push(error);}};
 await close(holder);if(pending)try{await pending;}catch(error){errors.push(error);}
 if(contender)await close(contender);if(errors.length)throw new AggregateError(errors,'answer_guard_waiter_cleanup_failed');
}
