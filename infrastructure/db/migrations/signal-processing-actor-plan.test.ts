import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('0324 changes only actor execution boundary and preserves the exact 0218 SELECT and function contract',async()=>{
 const old=await readFile(new URL('./0218_signal_processing_internal_admin_actor.sql',import.meta.url),'utf8');
 const next=await readFile(new URL('./0324_signal_processing_actor_prepared_plan.sql',import.meta.url),'utf8');
 const signature='CREATE OR REPLACE FUNCTION signal_processing_actor_v1(target_workspace uuid,target_actor uuid)';
 const body=old.slice(old.indexOf('AS $$')+5,old.lastIndexOf('$$;'));
 assert.ok(body.trimStart().startsWith('SELECT EXISTS('));
 const expected=signature+'\nRETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public,extensions,pg_temp AS $$\nBEGIN\n RETURN ('+body+');\nEND\n$$;\n';
 assert.equal(next.slice(next.indexOf(signature)),expected,'no role, grant, organization, status, NULL or SELECT predicate may change');
 assert.ok(!/\b(?:STRICT|SECURITY DEFINER|GRANT|REVOKE|ALTER FUNCTION|IMMUTABLE|RETURN QUERY)\b/iu.test(next));
 assert.equal((next.match(/CREATE OR REPLACE FUNCTION/g)??[]).length,1);
});
