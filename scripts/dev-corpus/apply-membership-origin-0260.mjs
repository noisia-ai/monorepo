/** Single named migration only; tolerates an experimental 0259 without changing it. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {main,openDatabase} from './guard.mjs';
const file='0260_signal_membership_decision_origin.sql';
const expected='b66643e960bba08af6d5386b2bbf50c33c0c26f874aad81d52953d4c003afc7f';
const hash=value=>createHash('sha256').update(value).digest('hex');
await main(async()=>{
 assert.equal(process.env.NOISIA_MFP_APPLY_0260_APPROVED,'true');
 assert.ok(process.env.NOISIA_MFP_APPLY_0260_RECEIPT,'private receipt required');
 const sql=await readFile(new URL(`../../infrastructure/db/migrations/${file}`,import.meta.url),'utf8');
 assert.equal(hash(sql),expected,'migration SHA must match reviewed source');
 const baseFile='0258_signal_membership_context_review.sql';
 const baseSha=hash(await readFile(new URL(`../../infrastructure/db/migrations/${baseFile}`,import.meta.url)));
 const pool=await openDatabase(),c=await pool.connect();let committed=false;
 try{await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtextextended('mfp-migrations',0))");
  await c.query("SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';SET LOCAL search_path=public,pg_catalog");
  const history=(await c.query('SELECT name,sha256 FROM mfp_harness.migrations ORDER BY name')).rows;
  assert.equal(history.find(r=>r.name===baseFile)?.sha256,baseSha,'fixed develop schema required');
  const recorded=history.find(r=>r.name===file);
  if(recorded)assert.equal(recorded.sha256,expected,'changed applied migration rejected');
  else{await c.query(sql);await c.query('INSERT INTO mfp_harness.migrations(name,sha256) VALUES($1,$2)',[file,expected]);}
  const after=(await c.query('SELECT name,sha256 FROM mfp_harness.migrations ORDER BY name')).rows;
  assert.deepEqual(after.filter(r=>r.name!==file),history.filter(r=>r.name!==file),'other migration history preserved');
  assert.equal((await c.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public'
    AND table_name='signal_concept_membership_overrides' AND column_name='decided_via'`)).rows[0].n,1);
  assert.equal((await c.query("SELECT to_regclass('public.signal_concept_membership_human_evaluation_v1') IS NOT NULL ready")).rows[0].ready,true);
  const receipt={status:'committed',migration:file,sha256:expected,replayed:Boolean(recorded),other_history_sha256:hash(JSON.stringify(after.filter(r=>r.name!==file))),
   target:'mfp_dedicated',provider_requests:0,at:new Date().toISOString()};
  await c.query('COMMIT');committed=true;
  await writeFile(process.env.NOISIA_MFP_APPLY_0260_RECEIPT,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(receipt));
 }catch(error){if(!committed)await c.query('ROLLBACK');throw error;}finally{c.release();await pool.end();}
});
