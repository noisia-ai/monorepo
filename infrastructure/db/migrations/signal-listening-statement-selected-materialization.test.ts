import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('0322 only materializes selected; all authority, request, population and money checks remain exact',async()=>{
 const before=await readFile(new URL('./0318_signal_listening_statement_population.sql',import.meta.url),'utf8');
 const after=await readFile(new URL('./0322_signal_listening_statement_selected_materialization.sql',import.meta.url),'utf8');
 const signature='CREATE OR REPLACE FUNCTION signal_listening_statement_money_v1()';
 const start=before.indexOf(signature),end=before.indexOf('\nCREATE OR REPLACE FUNCTION signal_listening_discovery_child_capacity_v1()',start);
 assert.ok(start>=0&&end>start);const original=before.slice(start,end).trimEnd();
 assert.equal((original.match(/   selected AS\(/g)??[]).length,1);
 assert.equal(after.slice(after.indexOf(signature)).trimEnd(),original.replace('   selected AS(','   selected AS MATERIALIZED('));
 assert.equal((after.match(/signal_listening_call_authority_v1\(target,/g)??[]).length,2,'both physical authority fences remain');
 assert.ok(!/force_(generic|custom)_plan|SET\s+(?:LOCAL\s+)?work_mem|SECURITY DEFINER/iu.test(after));
});
