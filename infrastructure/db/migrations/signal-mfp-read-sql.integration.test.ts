import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
const id='10000000-0000-4000-8000-000000000001';
// Plans the actual application query strings in a read-only snapshot; never executes jobs.
test('MFP reads: PostgreSQL accepts editorial JSON keys and both scoped analysis parameters',
 {skip:process.env.NOISIA_MFP_READ_SQL_PG_APPROVED!=='true'&&process.env.NOISIA_MFP_PG_CI!=='true',timeout:30_000},async()=>{
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:false},max:1});
 const c=await pool.connect();
 try{await c.query('BEGIN READ ONLY');
  const analysis=await readFile(new URL('../signal-workspace-incremental-projection.ts',import.meta.url),'utf8');
  const sql=analysis.slice(analysis.indexOf('const dispatch=(await client.query<{status:string;error_code:string|null;attempt_count:number;profile_current:boolean}>')).match(/`([^`]+)`/u)?.[1];
  assert.ok(sql,'analysis status dispatch query found');
  assert.equal(Math.max(...[...sql.matchAll(/\$(\d+)/g)].map(m=>Number(m[1]))),2);
  assert.match(sql,/dispatch\.workspace_id=\$2::uuid/);
  await c.query(`EXPLAIN ${sql}`,[id,id]);
  const editorial=await readFile(new URL('../../../apps/studio/src/lib/data-os/workspace-topic-editorial-outcomes-v2.ts',import.meta.url),'utf8');
  const outcome=editorial.match(/measure\("outcomes_read", \(\) => client\.query<OutcomeRow>\(`([\s\S]*?)`/u)?.[1];
  assert.ok(outcome,'editorial outcome query found');
  await c.query(`EXPLAIN ${outcome}`,[id,id,['open:example']]);
 }finally{await c.query('ROLLBACK');c.release();await pool.end();}
});
