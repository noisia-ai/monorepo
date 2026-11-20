import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {answerGuardBefore0334SqlV1,answerGuardBefore0334BodySha256V1,answerGuardAfter0334BodySha256V1,
 answerGuardBefore0334LookupV1,answerGuardAfter0334LookupV1,answerGuardBodyV1,answerGuardShaV1,
 assertAnswerGuard0334SourceV1} from './signal-listening-answer-guard.oracle';
import {answerGuardBefore0339SqlV1,answerGuard0339AliasesV1,answerGuard0339LookupV1,answerGuard0339TailV1,
 answerGuardAfter0339BodySha256V1,assertAnswerGuard0339SourceV1,answerGuard0339WitnessSqlV1} from './signal-listening-answer-guard-narrow.oracle';

test('answer lookup oracle freezes the complete 0296 guard and its unchanged later history',async()=>{
 const source=await readFile(new URL('./0296_signal_listening_configuration.sql',import.meta.url),'utf8');
 const begin=source.indexOf('CREATE FUNCTION signal_listening_answer_guard_v1()'),end=source.indexOf('END $$;',begin)+'END $$;'.length;
 assert.ok(begin>=0&&end>begin);
 assert.equal(source.slice(begin,end).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')+'\n',answerGuardBefore0334SqlV1);
 assert.equal(answerGuardShaV1(answerGuardBodyV1(answerGuardBefore0334SqlV1)),answerGuardBefore0334BodySha256V1);
 for(const name of ['0330_signal_listening_statement_shared_wire.sql','0331_signal_listening_statement_payload.sql',
  '0332_signal_listening_flat_prefix_preimages.sql','0333_signal_listening_bounded_mentions.sql'])
  assert.ok(!(await readFile(new URL('./'+name,import.meta.url),'utf8')).includes('FUNCTION signal_listening_answer_guard_v1('));
});
test('0334 changes only four receipt reads to one seed LEFT join and keeps all guard bytes',async()=>{
 const migration=await readFile(new URL('./0334_signal_listening_answer_guard_lookup.sql',import.meta.url),'utf8');
 const sql=assertAnswerGuard0334SourceV1(migration);
 assert.equal(answerGuardShaV1(answerGuardBodyV1(sql)),answerGuardAfter0334BodySha256V1);
 assert.equal((answerGuardBefore0334LookupV1.match(/\bSELECT\b/g)??[]).length,4);
 assert.equal((answerGuardAfter0334LookupV1.match(/\bSELECT\b/g)??[]).length,1);
 assert.equal((answerGuardAfter0334LookupV1.match(/LEFT JOIN/g)??[]).length,4);
 assert.ok(answerGuardAfter0334LookupV1.includes('FROM (VALUES(true)) AS seed(present)'));
 assert.ok(answerGuardAfter0334LookupV1.includes('answer_run ON answer_run.id=NEW.run_id'));
 assert.equal(sql.slice(sql.indexOf(' result:=')),answerGuardBefore0334SqlV1.slice(answerGuardBefore0334SqlV1.indexOf(' result:=')));
});
test('0334 source chain rejects a call-driven run, reduced joins and changed rights or actor guards',async()=>{
 const migration=await readFile(new URL('./0334_signal_listening_answer_guard_lookup.sql',import.meta.url),'utf8');
 for(const changed of [
  migration.replace('answer_run.id=NEW.run_id','answer_run.id=answer_call.run_id'),
  migration.replace('LEFT JOIN signal_labeling_calls','JOIN signal_labeling_calls'),
  migration.replace("'llm-processing'","'client-derived-metrics'"),
  migration.replace('PERFORM signal_processing_lock_actor_v1(r.workspace_id,r.actor_user_id);','PERFORM 1;'),
  migration+'SELECT 1;\n',
 ]){assert.notEqual(changed,migration);assert.throws(()=>assertAnswerGuard0334SourceV1(changed));}
});

test('0339 OLD source is the frozen 0334 guard and later migrations do not redefine it',async()=>{
 const before=assertAnswerGuard0334SourceV1(await readFile(new URL('./0334_signal_listening_answer_guard_lookup.sql',import.meta.url),'utf8'));
 assert.equal(answerGuardBefore0339SqlV1,before);
 for(const name of ['0335_signal_listening_compact_population.sql','0336_signal_listening_statement_native_projection.sql',
  '0337_signal_listening_wire_population.sql','0338_signal_listening_compact_full_stream.sql'])
  assert.ok(!(await readFile(new URL('./'+name,import.meta.url),'utf8')).includes('FUNCTION signal_listening_answer_guard_v1('));
});
test('0339 projects only seventeen used fields and inverses every unchanged BEFORE guard byte',async()=>{
 const sql=assertAnswerGuard0339SourceV1(await readFile(new URL('./0339_signal_listening_answer_guard_narrow.sql',import.meta.url),'utf8'));
 assert.equal(answerGuardShaV1(answerGuardBodyV1(sql)),answerGuardAfter0339BodySha256V1);
 assert.equal(answerGuard0339AliasesV1.length,17);
 assert.equal((answerGuard0339LookupV1.match(/\bSELECT\b/g)??[]).length,1);
 assert.equal((answerGuard0339LookupV1.match(/LEFT JOIN/g)??[]).length,4);
 assert.ok(answerGuard0339LookupV1.includes('FROM (VALUES(true)) AS seed(present)'));
 assert.ok(answerGuard0339LookupV1.includes('answer_run ON answer_run.id=NEW.run_id'));
 assert.deepEqual([...answerGuard0339LookupV1.matchAll(/CASE WHEN false THEN (answer_\w+) END permission_(\w+)/gu)].map(match=>[match[1],match[2]]),
  [['answer_call','call'],['answer_run','run'],['answer_owner','owner'],['answer_question','question']],
  'permission-only whole-row references stay on the same original RTEs and always return NULL');
 assert.doesNotMatch(answerGuard0339LookupV1,/\banswer_(?:call|run|owner|question) AS\b|\bSELECT \*|answer_call\.(?:request|inputs)\b/u);
 const before=answerGuardBefore0339SqlV1.slice(answerGuardBefore0339SqlV1.indexOf(' result:='));
 assert.equal(answerGuard0339TailV1(sql.slice(sql.indexOf(' result:=')),true),before);
 assert.equal(answerGuard0339TailV1(before),sql.slice(sql.indexOf(' result:=')));
 for(const attribute of ['proretset','pronargs','pronargdefaults','default_arguments','prosupport','proallargtypes',
  'proargmodes','proargnames','protrftypes','probin','prosqlbody'])assert.ok(answerGuard0339WitnessSqlV1.includes(attribute),'native identity witness retains '+attribute);
});
test('0339 source chain rejects altered joins, wide reads, missing aliases and changed checks',async()=>{
 const migration=await readFile(new URL('./0339_signal_listening_answer_guard_narrow.sql',import.meta.url),'utf8');
 for(const changed of [
  migration.replace('answer_run.id=NEW.run_id','answer_run.id=answer_call.run_id'),
  migration.replace('LEFT JOIN signal_labeling_calls','JOIN signal_labeling_calls'),
  migration.replace('answer_call.id call_id','answer_call.request call_id'),
  migration.replace('CASE WHEN false THEN answer_call END permission_call','NULL permission_call'),
  migration.replace('looked_up.call_usage IS NULL','false'),
  migration.replace("'llm-processing'","'client-derived-metrics'"),
  migration.replace('PERFORM signal_processing_lock_actor_v1(looked_up.run_workspace_id,looked_up.run_actor_user_id);','PERFORM 1;'),
  migration+'SELECT 1;\n',
 ]){assert.notEqual(changed,migration);assert.throws(()=>assertAnswerGuard0339SourceV1(changed));}
});
