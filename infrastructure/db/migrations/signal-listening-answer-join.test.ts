import assert from 'node:assert/strict';
import test from 'node:test';
import {answerGuardSourcesV1,answerGuardJoinedSourceV1,restoreAnswerGuardSourceV1,answerGuardPartsV1,answerGuardContractV1,
 answerGuardProjectionOracleV1,assertAnswerGuardRowV1,ANSWER_GUARD_FILE_SHA_V1,answerGuardProductSqlV1,drainAnswerGuardWaitersV1} from './signal-listening-answer-join.oracle';
test('E derives only the frozen answer BEFORE function from0296 and inverts all executable C bytes',async()=>{
 const {file,c,e}=await answerGuardSourcesV1();assert.equal(file.sha256,ANSWER_GUARD_FILE_SHA_V1);
 assert.equal(restoreAnswerGuardSourceV1(e),c);assert.throws(()=>answerGuardJoinedSourceV1(c+'\n'));
 assert.throws(()=>answerGuardJoinedSourceV1(e));assert.throws(()=>restoreAnswerGuardSourceV1(e.replace('listening_answer_invalid','forged')));
});
test('the joined read is anchored independently of call presence and uses all four original lookup predicates',async()=>{
 const {c}=await answerGuardSourcesV1(),p=answerGuardPartsV1(c);
 assert.equal((p.loadC.match(/SELECT \*/g)??[]).length,4);assert.equal((p.loadE.match(/\bSELECT\b/g)??[]).length,2);
 for(const clause of ['FROM (SELECT 1) anchor','LEFT JOIN signal_labeling_calls loaded_call ON loaded_call.id=NEW.call_id AND loaded_call.workspace_id=NEW.workspace_id AND loaded_call.run_id=NEW.run_id',
  'LEFT JOIN signal_labeling_runs loaded_run ON loaded_run.id=NEW.run_id',
  'LEFT JOIN signal_listening_runs loaded_owner ON loaded_owner.run_id=loaded_run.id AND loaded_owner.workspace_id=NEW.workspace_id',
  'LEFT JOIN signal_listening_questions loaded_question ON loaded_question.configuration_id=loaded_owner.configuration_id AND loaded_question.question_key=NEW.question_key'])assert.ok(p.loadE.includes(clause),clause);
 assert.ok(!/loaded_run\.id=loaded_call|FOR UPDATE|FOR SHARE|jsonb_|to_jsonb|DISTINCT|LIMIT |COALESCE|GROUP BY/.test(p.loadE));
});
test('native composite assignments preserve the final question FOUND without treating nullable row fields as absence',async()=>{
 const {c}=await answerGuardSourcesV1(),p=answerGuardPartsV1(c);
 assert.ok(p.declarationE.includes('answer_join record;'));
 for(const assignment of ['call:=answer_join.call_row;','r:=answer_join.run_row;','owner:=answer_join.owner_row;','q:=answer_join.question_row;'])assert.ok(p.loadE.includes(assignment));
 assert.ok(p.loadE.includes('FOUND:=q.configuration_id IS NOT NULL;'));
 assert.ok(!p.loadE.includes('q.id'));assert.ok(!p.loadE.includes('q IS NOT NULL'));
});
test('missing joined rows become typed all-NULL composites while present rows keep their original datum',async()=>{
 const {c}=await answerGuardSourcesV1(),{loadE}=answerGuardPartsV1(c);
 for(const [alias,key,type]of [['loaded_call','id','signal_labeling_calls'],['loaded_run','id','signal_labeling_runs'],
  ['loaded_owner','run_id','signal_listening_runs'],['loaded_question','configuration_id','signal_listening_questions']])
  assert.ok(loadE.includes(`CASE WHEN ${alias}.${key} IS NULL THEN ROW(${alias}.*)::${type} ELSE ${alias} END`));
 assert.ok(!loadE.includes('CASE WHEN loaded_question IS NULL'));
});
test('receipt error order, root rights, actor locks and answer shape checks remain byte-identical',async()=>{
 const {c,e}=await answerGuardSourcesV1(),p=answerGuardPartsV1(c);
 assert.equal(p.checks,c.slice(c.indexOf(' result:=call.results->0;')));
 assert.equal(p.checks,e.slice(e.indexOf(' result:=call.results->0;')));
 assert.ok(p.checks.indexOf('signal_listening_root_right_v1')<p.checks.indexOf('signal_processing_lock_actor_v1'));
 assert.ok(p.checks.indexOf('listening_answer_receipt_invalid')<p.checks.indexOf('signal_processing_lock_actor_v1'));
 assert.ok(p.checks.indexOf('signal_processing_lock_actor_v1')<p.checks.indexOf('listening_answer_invalid'));
 assert.ok(!/latest|pending|population|configuration_revision|current_setting/.test(p.loadE));
});
test('E preserves function metadata and rejects wrong runtime bodies or authorization metadata',async()=>{
 const {c,e}=await answerGuardSourcesV1(),current=answerGuardContractV1(c),candidate=answerGuardContractV1(e);
 assert.deepEqual(candidate.metadata,current.metadata);assert.notEqual(candidate.prosrc_sha256,current.prosrc_sha256);
 const row={prosrc:candidate.prosrc,...candidate.metadata};assert.equal(assertAnswerGuardRowV1(row,candidate).actual_prosrc_sha256,candidate.prosrc_sha256);
 assert.throws(()=>assertAnswerGuardRowV1({...row,prosrc:current.prosrc},candidate));
 for(const patch of [{prosecdef:true},{proconfig:['search_path=public']},{return_type:'jsonb'},{provolatile:'s'}])assert.throws(()=>assertAnswerGuardRowV1({...row,...patch},candidate));
});
test('projection oracle compares native rowtypes plus FOUND with independent C/E reads, not an answer cache',async()=>{
 const {c}=await answerGuardSourcesV1();
 for(const arm of ['C','E']as const){const sql=answerGuardProjectionOracleV1(c,arm);assert.ok(sql.includes('pg_temp.noisia_answer_projection_'+arm.toLowerCase()));
  assert.ok(sql.includes('attempt signal_listening_answers'));assert.ok(sql.includes("'found',FOUND"));
  assert.ok(sql.includes('pg_typeof(call)::text'));assert.ok(sql.includes('pg_typeof(q)::text'));
  assert.ok(!sql.includes('INSERT INTO'));assert.ok(!sql.includes('CREATE TABLE'));assert.ok(!sql.includes('signal_processing_lock_actor'));
 }
});
test('native INSERT and result staging are extracted from the exact production files with their existing fences',async()=>{
 const {sql,hashes,files}=await answerGuardProductSqlV1();assert.equal(files.length,2);
 assert.ok(sql.answers.includes('call.request_digest,call.raw_sha256'));
 assert.ok(sql.answers.includes('ON CONFLICT(workspace_id,root_id,input_digest,entity_context_digest,question_digest) DO NOTHING'));
 assert.ok(sql.results.includes('WHERE call.run_id=$1 AND call.id=page.id'));
 assert.ok(sql.runFence.includes('lease_until>clock_timestamp()'));assert.ok(sql.callLock.includes('ORDER BY id FOR UPDATE'));
 assert.ok(sql.replay.includes('call.results IS NOT DISTINCT FROM planned.results'));assert.ok(sql.mutationFence.includes('VALUES($1,$2,$3,$4)'));
 assert.ok(Object.values(hashes).every(value=>/^[0-9a-f]{64}$/.test(value)));
});

test('wait cleanup releases the holder then drains its contender before returning',async()=>{
 const events:string[]=[],holder={query:async()=>{events.push('rollback');},release:(broken?:boolean)=>{assert.equal(broken,false);events.push('release');}};
 const pending={then:(resolve:(value:unknown)=>void)=>{events.push('drain');resolve(undefined);}} as unknown as Promise<unknown>;
 await drainAnswerGuardWaitersV1(holder as any,pending);assert.deepEqual(events,['rollback','release','drain']);
});
test('wait cleanup retains rollback and pending failures while always closing the contender',async()=>{
 const a=Error('holder'),b=Error('pending'),events:string[]=[],holder={query:async()=>{throw a;},release:(broken?:boolean)=>{assert.equal(broken,true);events.push('holder_destroyed');}},
 contender={query:async()=>{events.push('contender_rollback');},release:()=>{events.push('contender_release');}},
 pending={then:(_resolve:unknown,reject:(error:unknown)=>void)=>{events.push('drain');reject(b);}}as unknown as Promise<unknown>;
 await assert.rejects(drainAnswerGuardWaitersV1(holder as any,pending,contender as any),error=>{assert.ok(error instanceof AggregateError);assert.deepEqual(error.errors,[a,b]);return true;});
 assert.deepEqual(events,['holder_destroyed','drain','contender_rollback','contender_release']);
});
