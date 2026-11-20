import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import type {PoolClient} from 'pg';

// Shared assertion helpers only. Importing this module registers no tests and
// never opens a database; each acceptance owns its guarded fixture lifecycle.
export async function installBoundedCustomPlanOracleV1(c:PoolClient){
 await c.query('CREATE TEMP TABLE r16_bounded_custom_plan_probe(probe boolean) ON COMMIT DROP');
 const raw=(await readFile(new URL('./0317_signal_listening_bounded_provenance_plan.sql',import.meta.url),'utf8'))
  .replace('CREATE OR REPLACE FUNCTION signal_listening_population_roots_v1(','CREATE FUNCTION pg_temp.r16_population_before_0321(');
 await c.query(raw);
 const previous=await readFile(new URL('./0321_signal_listening_bounded_custom_plan.sql',import.meta.url),'utf8');
 await c.query(previous.replace('CREATE OR REPLACE FUNCTION signal_listening_population_roots_v1(','CREATE FUNCTION pg_temp.r16_population_before_0325('));
 const slices=await readFile(new URL('./0325_signal_listening_reader_slices.sql',import.meta.url),'utf8');
 await c.query(slices.replace('CREATE OR REPLACE FUNCTION signal_listening_population_roots_v1(','CREATE FUNCTION pg_temp.r16_population_before_0326('));
 const source=await readFile(new URL('./0316_signal_listening_human_revision_plan.sql',import.meta.url),'utf8');
 const start=source.indexOf('CREATE OR REPLACE FUNCTION signal_listening_effective_population_roots_v2(');
 assert.ok(start>=0);const end=source.indexOf('$$;',source.indexOf('AS $$',start))+3;
 await c.query(source.slice(start,end).replace('CREATE OR REPLACE FUNCTION signal_listening_effective_population_roots_v2(',
  'CREATE FUNCTION pg_temp.r16_effective_before_0321(').replace('signal_listening_population_roots_v1(w,cid,mid,ctx,roots,purpose)',
   'pg_temp.r16_population_before_0321(w,cid,mid,ctx,roots,purpose)'));
 await c.query(source.slice(start,end).replace('CREATE OR REPLACE FUNCTION signal_listening_effective_population_roots_v2(',
  'CREATE FUNCTION pg_temp.r16_effective_before_0325(').replace('signal_listening_population_roots_v1(w,cid,mid,ctx,roots,purpose)',
   'pg_temp.r16_population_before_0325(w,cid,mid,ctx,roots,purpose)'));
 await c.query(source.slice(start,end).replace('CREATE OR REPLACE FUNCTION signal_listening_effective_population_roots_v2(',
  'CREATE FUNCTION pg_temp.r16_effective_before_0326(').replace('signal_listening_population_roots_v1(w,cid,mid,ctx,roots,purpose)',
   'pg_temp.r16_population_before_0326(w,cid,mid,ctx,roots,purpose)'));
}
export async function assertBoundedCustomPlanOracleV1(c:PoolClient,scope:unknown[],roots:Array<string|null>|null=null,purpose='client-derived-metrics',effective=false){
 // Keep timestamptz JSON serialization inside PostgreSQL: Date parsing loses microseconds.
 const params=[...scope,roots,purpose];const read=(fn:string)=>c.query(`SELECT to_jsonb(p) value FROM ${fn}($1,$2,$3,$4,$5::uuid[],$6) p ORDER BY root_id,question_key`,params);
 const before=(await read(effective?'pg_temp.r16_effective_before_0321':'pg_temp.r16_population_before_0321')).rows.map(r=>r.value);
 const after=(await read(effective?'signal_listening_effective_population_roots_v2':'signal_listening_population_roots_v1')).rows.map(r=>r.value);
 const previous=(await read(effective?'pg_temp.r16_effective_before_0325':'pg_temp.r16_population_before_0325')).rows.map(r=>r.value);
 const slices=(await read(effective?'pg_temp.r16_effective_before_0326':'pg_temp.r16_population_before_0326')).rows.map(r=>r.value);
 assert.deepEqual(after,slices,'the final answer slice preserves 0325 raw/effective fields and exact timestamps');
 assert.deepEqual(after,previous,'statement-local slices preserve 0321 raw/effective fields and exact timestamps');
 assert.deepEqual(after,before,'custom bounded dispatch preserves every raw/effective field including SQL timestamp microseconds');
 if(after.length)assert.equal(Object.keys(after[0]!).length,effective?20:14);return after;
}
