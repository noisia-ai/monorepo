import assert from 'node:assert/strict';
import test from 'node:test';
import {indexStandardBaselineV2} from './standard-v2-baseline';
test('sealed baseline rejects missing, duplicate or changed-root pairs and preserves technical outcomes',()=>{
 const roots=[{root_id:'a',input_digest:'input-a'}];
 const rows=[{root_id:'a',concept_key:'one',input_digest:'input-a',verdict:'error'},{root_id:'a',concept_key:'two',input_digest:'input-a',verdict:'belongs'}];
 assert.equal(indexStandardBaselineV2(rows,roots,2).get('a:one')?.verdict,'error');
 assert.throws(()=>indexStandardBaselineV2(rows.slice(1),roots,2),/coverage/);
 assert.throws(()=>indexStandardBaselineV2([rows[0],rows[0]],roots,2),/duplicate/);
 assert.throws(()=>indexStandardBaselineV2([{...rows[0],input_digest:'changed'},rows[1]],roots,2),/input/);
});
