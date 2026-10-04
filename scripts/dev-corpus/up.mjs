import { openDatabase, main } from './guard.mjs';
await main(async () => {
  const pool = await openDatabase();
  try {
    const { rows: [row] } = await pool.query(`SELECT (SELECT count(*)::int FROM pg_tables WHERE schemaname='public') AS tables,
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()) AS other_connections,
      pg_database_size(current_database())::text AS database_bytes`);
    console.log(JSON.stringify({ contract_version: 'mfp-environment-v1', status: 'observed', ...row,
      execution: 'remote_private', application_ready: false, note: 'Run migration inventory before seed; observation is not acceptance.' }));
  } finally { await pool.end(); }
});
