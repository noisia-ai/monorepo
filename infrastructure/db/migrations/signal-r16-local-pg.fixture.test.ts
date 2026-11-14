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

test('R16 benchmark callback retains the exact accredited base pool and native admission',{
  skip:process.env.NOISIA_R16_BENCHMARK_FIXTURE_PG!=='true',timeout:120000,
},async()=>{
  const {runMassLabelingAcceptanceFixtureV1}=await import('./signal-mass-labeling-acceptance.synthetic.fixture');
  let callbacks=0;
  await runMassLabelingAcceptanceFixtureV1('product-recovery',{benchmark:{root_count:1002,
    execution_cap_micro_usd:20000000,beforeProcessing:async context=>{
      callbacks++;
      assertR16LocalPostgresPoolV1(context.database as pg.Pool);
      const {rows:[scope]}=await context.database.query(`SELECT current_database() database,r.processing_admission_id,
        count(i.root_id)::int roots FROM signal_labeling_runs r JOIN signal_mass_labeling_runs m ON m.run_id=r.id
        JOIN signal_mass_labeling_items i ON i.workspace_id=m.workspace_id AND i.map_id=m.map_id
        WHERE r.id=$1 AND r.workspace_id=$2 GROUP BY r.id`,[context.run_id,context.workspace_id]);
      assert.equal(scope.database,'noisia_mfp_ci');assert.ok(scope.processing_admission_id);assert.equal(scope.roots,1002);
      assert.equal((await context.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[context.run_id])).rows[0].n,0,
        'the benchmark callback executes before any provider submission or reservation');
    }}});
  assert.equal(callbacks,1);
});
