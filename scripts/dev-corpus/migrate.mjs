import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDatabase, main, fail } from './guard.mjs';
import {assertLabelingReceiptGateV1} from './labeling-receipt-gate.mjs';
await main(async () => {
  const pool = await openDatabase(); const client = await pool.connect();
  let stage = 'inventory';
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended('mfp-migrations',0))");
    const { rows: [inventory] } = await client.query(`SELECT to_regclass('mfp_harness.migrations')::text AS history,
      (SELECT count(*)::int FROM pg_tables WHERE schemaname='public') AS tables`);
    if (!inventory.history && inventory.tables !== 0) fail('existing_schema_without_migration_history');
    await client.query('CREATE SCHEMA IF NOT EXISTS mfp_harness');
    await client.query(`CREATE TABLE IF NOT EXISTS mfp_harness.migrations(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Map((await client.query('SELECT name,sha256 FROM mfp_harness.migrations')).rows.map(row => [row.name,row.sha256]));
    const directory = new URL('../../infrastructure/db/migrations/', import.meta.url);
    const files = (await readdir(directory)).filter(file => /^\d{4}_.+\.sql$/u.test(file)).sort();
    const sources = await Promise.all(files.map(async file => ({ file, sql:await readFile(new URL(file,directory),'utf8') })));
    for (const source of sources) { source.digest=createHash('sha256').update(source.sql).digest('hex');
      if (applied.has(source.file) && applied.get(source.file)!==source.digest) fail('applied_migration_changed'); }
    if ([...applied.keys()].some(file => !files.includes(file))) fail('migration_history_ahead_of_checkout');
    let count = 0;
    for (const { file, sql, digest } of sources) {
      if (applied.has(file)) continue;
      stage=file;
      if (file === '0255_signal_labeling_receipts_in_object_storage.sql') {
        const {rows:[inventory]}=await client.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE raw_body IS NOT NULL');
        if(inventory.n>0){
          const gate=spawnSync(process.execPath,['--import','tsx',fileURLToPath(new URL('./verify-labeling-receipts-before-0255.ts',import.meta.url))],
            {cwd:fileURLToPath(new URL('../../',import.meta.url)),env:process.env,encoding:'utf8',timeout:30*60_000,maxBuffer:1024*1024});
          if(gate.status!==0)fail('labeling_receipt_verification_failed');
          let receipt;try{receipt=JSON.parse(gate.stdout.trim().split('\n').at(-1));}catch{fail('labeling_receipt_verification_failed');}
          if(receipt.status!=='verified'||receipt.receipts!==inventory.n)fail('labeling_receipt_verification_failed');
        }
      }
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL statement_timeout='5min'");
        if(file==='0255_signal_labeling_receipts_in_object_storage.sql'){
          await client.query('LOCK TABLE signal_labeling_calls IN ACCESS EXCLUSIVE MODE');
          await assertLabelingReceiptGateV1(client);
        }
        await client.query(sql);
        await client.query('INSERT INTO mfp_harness.migrations(name,sha256) VALUES($1,$2)',[file,digest]);
        await client.query('COMMIT'); count++;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
    console.log(JSON.stringify({ status:'migrated', newly_applied:count, previously_applied:applied.size,
      total:files.length, target:'mfp_dedicated', historical_database_untouched:true }));
  } catch (error) {
    console.error(JSON.stringify({status:'migration_failed',stage,sqlstate:/^[A-Z0-9]{5}$/u.test(error?.code??'')?error.code:null}));
    throw error;
  } finally { await client.query("SELECT pg_advisory_unlock(hashtextextended('mfp-migrations',0))").catch(()=>{}); client.release(); await pool.end(); }
});
