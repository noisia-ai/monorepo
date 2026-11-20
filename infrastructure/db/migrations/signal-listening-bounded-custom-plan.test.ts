import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('0321 only changes bounded plan dispatch; full SQL, predicates, fourteen fields and function authority stay exact',async()=>{
 const before=await readFile(new URL('./0317_signal_listening_bounded_provenance_plan.sql',import.meta.url),'utf8');
 const after=await readFile(new URL('./0321_signal_listening_bounded_custom_plan.sql',import.meta.url),'utf8');
 const functionText=(s:string)=>s.slice(s.indexOf('CREATE OR REPLACE FUNCTION'));
 const expected=functionText(before)
  .replace(' ELSE\n  RETURN QUERY\n',' ELSE\n  RETURN QUERY EXECUTE $bounded$\n')
  .replace(' manual ON true;\n END IF;',' manual ON true\n  $bounded$ USING w,cid,mid,ctx,roots,purpose;\n END IF;');
 assert.notEqual(expected,functionText(before),'reference must contain the old static bounded branch');
 assert.equal(functionText(after),expected,'no predicate, field, privilege, stability or NULL branch may change');
 assert.equal((after.match(/RETURN QUERY EXECUTE/g)??[]).length,2);
 assert.equal((after.match(/USING w,cid,mid,ctx,roots,purpose;/g)??[]).length,2);
 assert.ok(!/force_(generic|custom)_plan|SET\s+(?:LOCAL\s+)?work_mem|SECURITY DEFINER|ROWS\s+\d/iu.test(after));
});
