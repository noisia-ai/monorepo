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
 const source=await readFile(new URL('./0316_signal_listening_human_revision_plan.sql',import.meta.url),'utf8');
 const start=source.indexOf('CREATE OR REPLACE FUNCTION signal_listening_effective_population_roots_v2(');
 assert.ok(start>=0);const end=source.indexOf('$$;',source.indexOf('AS $$',start))+3;
 await c.query(source.slice(start,end).replace('CREATE OR REPLACE FUNCTION signal_listening_effective_population_roots_v2(',
  'CREATE FUNCTION pg_temp.r16_effective_before_0321(').replace('signal_listening_population_roots_v1(w,cid,mid,ctx,roots,purpose)',
   'pg_temp.r16_population_before_0321(w,cid,mid,ctx,roots,purpose)'));
}
export async function assertBoundedCustomPlanOracleV1(c:PoolClient,scope:unknown[],roots:Array<string|null>|null=null,purpose='client-derived-metrics',effective=false){
 // Keep timestamptz JSON serialization inside PostgreSQL: Date parsing loses microseconds.
 const params=[...scope,roots,purpose];const read=(fn:string)=>c.query(`SELECT to_jsonb(p) value FROM ${fn}($1,$2,$3,$4,$5::uuid[],$6) p ORDER BY root_id,question_key`,params);
 const before=(await read(effective?'pg_temp.r16_effective_before_0321':'pg_temp.r16_population_before_0321')).rows.map(r=>r.value);
 const after=(await read(effective?'signal_listening_effective_population_roots_v2':'signal_listening_population_roots_v1')).rows.map(r=>r.value);
 assert.deepEqual(after,before,'custom bounded dispatch preserves every raw/effective field including SQL timestamp microseconds');
 if(after.length)assert.equal(Object.keys(after[0]!).length,effective?20:14);return after;
}
