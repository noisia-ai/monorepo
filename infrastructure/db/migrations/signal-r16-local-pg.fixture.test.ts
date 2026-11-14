import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import {assertR16LocalPostgresPoolV1,openR16LocalPostgresV1} from './signal-r16-local-pg.fixture';

test('local R16 fixture rejects an arbitrary pool, remote URL and CI impersonation before access',async()=>{
  const pool=new pg.Pool({connectionString:'postgresql://postgres:synthetic@example.invalid/noisia_mfp_ci'});
  try{assert.throws(()=>assertR16LocalPostgresPoolV1(pool),/exact pool must be accredited/);}
  finally{await pool.end();}
  const before={GITHUB_ACTIONS:process.env.GITHUB_ACTIONS,DATABASE_URL:process.env.DATABASE_URL,
    NOISIA_R16_LOCAL_PG_LAB:process.env.NOISIA_R16_LOCAL_PG_LAB};
  try{
    delete process.env.GITHUB_ACTIONS;process.env.NOISIA_R16_LOCAL_PG_LAB='r16-durable-pages-pg17';
    process.env.DATABASE_URL='postgresql://postgres:synthetic@example.invalid:5432/noisia_mfp_ci';
    await assert.rejects(openR16LocalPostgresV1(),/127\.0\.0\.1/);
    process.env.DATABASE_URL='postgresql://postgres:synthetic@127.0.0.1:5432/noisia_mfp_ci';
    process.env.GITHUB_ACTIONS='true';
    await assert.rejects(openR16LocalPostgresV1(),/not a CI target override/);
  }finally{
    for(const [key,value] of Object.entries(before))if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
});
