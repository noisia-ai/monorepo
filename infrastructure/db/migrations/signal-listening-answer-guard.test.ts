import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {answerGuardBefore0334SqlV1,answerGuardBefore0334BodySha256V1,answerGuardAfter0334BodySha256V1,
 answerGuardBefore0334LookupV1,answerGuardAfter0334LookupV1,answerGuardBodyV1,answerGuardShaV1,
 assertAnswerGuard0334SourceV1} from './signal-listening-answer-guard.oracle';

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
