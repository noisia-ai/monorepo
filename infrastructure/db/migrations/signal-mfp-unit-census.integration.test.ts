import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import {readFile} from 'node:fs/promises';

// Acceptance first. Only temporary tables/functions are changed, including
// corruption checks; the source ledgers and concurrent H1 run stay untouched.
test('MFP unit reads evaluate one validated census and preserve complete row semantics', {
 skip:process.env.NOISIA_MFP_PG_CI!=='true'&&!process.env.NOISIA_MFP_UNIT_CENSUS_TARGET,timeout:120_000,
},async()=>{
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:false},max:1});
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const original=(await readFile(new URL('./0148_signal_workspace_incremental_editorial.sql',import.meta.url),'utf8'))
   .match(/CREATE FUNCTION workspace_incremental_editorial_units_v1[\s\S]*?\$\$;/)![0];
  const current=process.env.NOISIA_MFP_UNIT_CENSUS_CANDIDATE
   ?(await readFile(process.env.NOISIA_MFP_UNIT_CENSUS_CANDIDATE,'utf8')).match(/CREATE OR REPLACE FUNCTION workspace_incremental_editorial_units_v1[\s\S]*?\$\$;/)![0]
   :(await c.query("SELECT pg_get_functiondef('workspace_incremental_editorial_units_v1(uuid)'::regprocedure) body")).rows[0].body as string;
  assert.match(current,/AS MATERIALIZED/,'the expensive census is evaluated once per target');
  await c.query(original.replace('workspace_incremental_editorial_units_v1(', 'pg_temp.units_baseline('));
  await c.query(current.replace(/(?:public\.)?workspace_incremental_editorial_units_v1\(/,'pg_temp.units_candidate('));
  const target=process.env.NOISIA_MFP_UNIT_CENSUS_TARGET;
  if(target){
   const r=(await c.query(`SELECT (SELECT jsonb_agg(to_jsonb(u) ORDER BY census_artifact_id) FROM pg_temp.units_baseline($1) u) old,
    (SELECT jsonb_agg(to_jsonb(u) ORDER BY census_artifact_id) FROM pg_temp.units_candidate($1) u) current`,[target])).rows[0];
   assert.ok(r.old?.length);assert.deepEqual(r.current,r.old);
  }
  await c.query('CREATE TEMP TABLE unit_read_artifacts AS SELECT * FROM analysis_artifacts WITH NO DATA');
  await c.query('CREATE TEMP TABLE unit_read_origins AS SELECT * FROM signal_topic_catalog_executions WITH NO DATA');
  const shadow=(body:string)=>body.replaceAll('analysis_artifacts','pg_temp.unit_read_artifacts')
   .replaceAll('signal_topic_catalog_executions','pg_temp.unit_read_origins');
  for(const [name,alias] of [['signal_workspace_incremental_unit_census_valid_v1','census_valid'],['workspace_incremental_editorial_census_v1','census']] as const){
   const body=(await c.query('SELECT pg_get_functiondef($1::regprocedure) body',[`${name}(${name.includes('valid')?'uuid,text':'uuid'})`])).rows[0].body as string;
   await c.query(shadow(body).replace(`public.${name}(`,`pg_temp.${alias}(`)
    .replaceAll('signal_workspace_incremental_unit_census_valid_v1(', 'pg_temp.census_valid('));
  }
  for(const [body,alias] of [[original,'units_old'],[current,'units_new']] as const){
   await c.query(shadow(body).replace(/(?:public\.)?workspace_incremental_editorial_units_v1\(/,`pg_temp.${alias}(`)
    .replaceAll('workspace_incremental_editorial_census_v1(', 'pg_temp.census('));
  }
  const ids=(await c.query('SELECT gen_random_uuid() target,gen_random_uuid() other,gen_random_uuid() workspace,gen_random_uuid() foreign_workspace,gen_random_uuid() owner,gen_random_uuid() component')).rows[0];
  await c.query(`INSERT INTO pg_temp.unit_read_origins(id,workspace_id,input_snapshot) VALUES($1,$2,'{"numeric_descriptor":{}}')`,[ids.target,ids.workspace]);
  const units=[0,1].map(local_label=>({local_label,unit_key:`open:unit-${local_label}`,birth_membership_digest:`sha256:${'a'.repeat(64)}`}));
  const digest=(await c.query('SELECT workspace_incremental_editorial_digest_v1($1::jsonb) digest',[JSON.stringify(units)])).rows[0].digest;
  const component={contract_version:'workspace-incremental-component-v1',component_key:'test-component',model_origin:{execution_id:ids.target},unit_count:2,unit_digest:digest};
  await c.query('INSERT INTO pg_temp.unit_read_artifacts(id,engine_execution_id,workspace_id,metadata) VALUES($1,$2,$3,$4)',[ids.component,ids.target,ids.workspace,JSON.stringify(component)]);
  for(const unit of units){
   await c.query(`INSERT INTO pg_temp.unit_read_artifacts(id,engine_execution_id,workspace_id,metadata,created_at) VALUES(gen_random_uuid(),$1,$2,$3,now())`,[ids.target,ids.workspace,
    JSON.stringify({contract_version:'workspace-incremental-unit-census-v1',derivation_digest:digest,component_key:'test-component',unit})]);
  }
  await c.query(`INSERT INTO pg_temp.unit_read_artifacts(id,engine_execution_id,workspace_id,metadata) VALUES(gen_random_uuid(),$1,$2,$3)`,[ids.owner,ids.workspace,
   JSON.stringify({contract_version:'workspace-incremental-editorial-unit-claim-v1',component_key:'test-component',unit:units[0]})]);
  // A foreign claim with the same content key must never claim this workspace.
  await c.query(`INSERT INTO pg_temp.unit_read_artifacts(id,engine_execution_id,workspace_id,metadata) VALUES(gen_random_uuid(),$1,$2,$3)`,[ids.owner,ids.foreign_workspace,
   JSON.stringify({contract_version:'workspace-incremental-editorial-unit-claim-v1',component_key:'test-component',unit:units[1]})]);
  const compare=async(targetId=ids.target)=>{
   const r=(await c.query(`SELECT (SELECT jsonb_agg(to_jsonb(u) ORDER BY census_artifact_id) FROM pg_temp.units_old($1) u) old,
    (SELECT jsonb_agg(to_jsonb(u) ORDER BY census_artifact_id) FROM pg_temp.units_new($1) u) current`,[targetId])).rows[0];
   assert.deepEqual(r.current,r.old);return r.current as Array<{claimed_by:string|null;emergent:boolean}>|null;
  };
  const rows=await compare();assert.equal(rows?.length,2);assert.deepEqual(rows?.map(r=>r.claimed_by).sort(),[ids.owner,null].sort());
  assert.ok(rows?.every(r=>r.emergent));assert.equal(await compare(ids.other),null);
  for(const patch of [{unit_count:3},{unit_digest:`sha256:${'0'.repeat(64)}`}]){
   await c.query('SAVEPOINT corrupt');
   await c.query('UPDATE pg_temp.unit_read_artifacts SET metadata=metadata||$1::jsonb WHERE id=$2',[JSON.stringify(patch),ids.component]);
   assert.equal(await compare(),null,'corrupt census does not expose any unit');
   await c.query('ROLLBACK TO SAVEPOINT corrupt');
  }
 }finally{await c.query('ROLLBACK');c.release();await pool.end();}
});
