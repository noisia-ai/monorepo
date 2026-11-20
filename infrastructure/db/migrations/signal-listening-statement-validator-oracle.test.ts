import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {anchorListeningStatementOracleParametersV1,listeningStatementOracleParameterTypesV1} from './signal-listening-statement-validator.oracle';

test('both extracted oracle queries bind all eight native parameter types without changing their SELECT bodies',async()=>{
 // EXECUTE USING: target/workspace/config/map UUIDs, context text, roots UUID[],
 // configuration digest text; the oracle alone adds its typed JSON batch.
 assert.deepEqual(listeningStatementOracleParameterTypesV1,['uuid','uuid','uuid','uuid','text','uuid[]','text','jsonb']);
 for(const name of ['0318_signal_listening_statement_population.sql','0322_signal_listening_statement_selected_materialization.sql','0323_signal_listening_statement_selected_full_join.sql']){
  const source=await readFile(new URL('./'+name,import.meta.url),'utf8');
  const raw=source.match(/EXECUTE format\(\$validation\$([\s\S]*?)\$validation\$,batch_sql\)/u)?.[1];assert.ok(raw);
  assert.ok(source.includes('USING target,r.workspace_id,owner.configuration_id,owner.map_id,r.entity_context_digest,root_ids,c.configuration_digest;'));
  const flags=raw.replace('%s','SELECT n.* FROM jsonb_to_recordset($8::jsonb) n(id uuid,inputs jsonb,request jsonb,request_digest text)');
  assert.ok(flags.includes("'run_id',$1,"),'the failing flags query uses $1 in polymorphic JSON');
  assert.ok(!flags.includes('$1::uuid'),'untyped $1 reproduces the original binding gap');
  const end=flags.indexOf('\n   SELECT COALESCE(');assert.ok(end>0);
  const perCall=flags.slice(0,end)+"\nSELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]'::jsonb) expected FROM expected e WHERE $1::uuid IS NOT NULL AND $7::text IS NOT NULL";
  for(const sql of [flags,perCall]){
   assert.ok(!sql.includes('$2::uuid'),'neither raw query explicitly types every parameter');
   const typed=anchorListeningStatementOracleParametersV1(sql),body=sql.replace(/^\s*WITH\b/u,'');
   assert.ok(typed.endsWith(body),'all original CTEs and the complete SELECT body remain literal');
   for(const [n,type]of listeningStatementOracleParameterTypesV1.entries())assert.ok(typed.includes('$'+(n+1)+'::'+type+' AS p'+(n+1)),`slot${n+1}`);
  }
 }
});
