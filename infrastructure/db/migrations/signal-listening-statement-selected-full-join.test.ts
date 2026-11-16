import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('0323 only changes selected LEFT to FULL; statement authority and every validation remain exact',async()=>{
 const before=await readFile(new URL('./0322_signal_listening_statement_selected_materialization.sql',import.meta.url),'utf8');
 const after=await readFile(new URL('./0323_signal_listening_statement_selected_full_join.sql',import.meta.url),'utf8');
 const signature='CREATE OR REPLACE FUNCTION signal_listening_statement_money_v1()';
 const body=before.slice(before.indexOf(signature)).trimEnd();
 const join='FROM batch n LEFT JOIN selected s ON s.id=n.id';
 assert.equal(body.split(join).length-1,1);
 assert.equal(after.slice(after.indexOf(signature)).trimEnd(),body.replace(join,'FROM batch n FULL JOIN selected s ON s.id=n.id'));
 assert.equal((after.match(/signal_listening_call_authority_v1\(target,/g)??[]).length,2);
 assert.ok(after.includes('selected AS MATERIALIZED('));
 assert.ok(!/force_(generic|custom)_plan|SET\s+(?:LOCAL\s+)?work_mem|SECURITY DEFINER/iu.test(after));
});
