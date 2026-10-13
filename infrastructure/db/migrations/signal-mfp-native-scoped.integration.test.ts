import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Acceptance before SQL0266: execute the exact migration with temporary function
// names against both supported view histories, then compare every returned column.
test('MFP native scoped readers preserve 0259 and current serving history and workspace isolation',{
 skip:process.env.NOISIA_MFP_PG_CI!=='true'&&!process.env.NOISIA_MFP_NATIVE_SCOPED_WORKSPACE,timeout:180_000,
},async()=>{
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:false},max:1});
 const c=await pool.connect();
 try{
  await c.query('BEGIN');await c.query('SET LOCAL search_path=public,extensions');
  const migration=await readFile(new URL('./0266_mfp_scoped_native_reads.sql',import.meta.url),'utf8');
  const workspace=process.env.NOISIA_MFP_NATIVE_SCOPED_WORKSPACE??(await c.query('SELECT gen_random_uuid() id')).rows[0].id;
  const missing=(await c.query('SELECT gen_random_uuid() id')).rows[0].id;
  const stock=(await readFile(new URL('./0259_signal_hybrid_h1_experiment.sql',import.meta.url),'utf8'))
   .split('CREATE OR REPLACE VIEW signal_concept_memberships_current_v1 AS')[1]!;
  const live=(await c.query("SELECT pg_get_viewdef('signal_concept_memberships_current_v1'::regclass,false) body")).rows[0].body as string;
  for(const [index,body] of [stock,live].entries()){
   await c.query(`CREATE TEMP VIEW native_original_${index} AS ${body}`);
   const scoped=migration.replaceAll("'signal_concept_memberships_current_v1'::regclass",`'pg_temp.native_original_${index}'::regclass`)
    .replaceAll('signal_workspace_mention_facets_read_v1',`pg_temp.native_facets_${index}`)
    .replaceAll('signal_workspace_concept_memberships_read_v1',`pg_temp.native_members_${index}`);
   await c.query(scoped);
   for(const [baseline,candidate,sort] of [['signal_mention_facets_current_v1',`pg_temp.native_facets_${index}`,'root_id'],
    [`pg_temp.native_original_${index}`,`pg_temp.native_members_${index}`,'root_id,concept_key']] as const){
    const old=(await c.query(`SELECT * FROM ${baseline} WHERE workspace_id=$1 ORDER BY ${sort}`,[workspace])).rows;
    const current=(await c.query(`SELECT * FROM ${candidate}($1) ORDER BY ${sort}`,[workspace])).rows;
    if(process.env.NOISIA_MFP_NATIVE_SCOPED_WORKSPACE)assert.ok(old.length,'remote acceptance requires real current rows');
    assert.deepEqual(current,old,'all columns, including timestamps, CE, technical errors and human overrides');
    assert.ok(current.every(row=>row.workspace_id===workspace));
    assert.deepEqual((await c.query(`SELECT * FROM ${candidate}($1)`,[missing])).rows,[],'missing/foreign workspace never leaks rows');
    const grants=(await c.query(`SELECT has_function_privilege('anon',$1,'EXECUTE') anon,
      has_function_privilege('authenticated',$1,'EXECUTE') authenticated`,[`${candidate}(uuid)`])).rows[0];
    assert.deepEqual(grants,{anon:false,authenticated:false});
   }
   if(index===0){
    await c.query(`CREATE OR REPLACE TEMP VIEW native_original_0 AS ${live}`);
    const old=(await c.query('SELECT * FROM pg_temp.native_original_0 WHERE workspace_id=$1 ORDER BY root_id,concept_key',[workspace])).rows;
    const current=(await c.query('SELECT * FROM pg_temp.native_members_0($1) ORDER BY root_id,concept_key',[workspace])).rows;
    const hash=(rows:unknown)=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    assert.equal(hash(current),hash(old),'a later supported history must not leave the reader on stale 0259 semantics');
   }
  }
  // The exact migration must reject any third history before creating readers.
  await c.query('CREATE TEMP VIEW native_drift AS SELECT * FROM signal_concept_memberships_current_v1 WHERE false');
  await c.query('SAVEPOINT drift');
  await assert.rejects(c.query(migration.replaceAll("'signal_concept_memberships_current_v1'::regclass","'pg_temp.native_drift'::regclass")),
   /mfp_native_membership_preimage_changed/);
  await c.query('ROLLBACK TO SAVEPOINT drift');
 }finally{await c.query('ROLLBACK');c.release();await pool.end();}
});
