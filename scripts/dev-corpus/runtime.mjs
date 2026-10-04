import { main, openDatabase } from './guard.mjs';

await main(async () => {
  if (process.env.NOISIA_MFP_WORKER_ENABLED === 'true') {
    // Pin the existing Worker pools only after verifying the dedicated remote target.
    await openDatabase();
    await import('../../services/workers/src/index.ts');
    return;
  }
  console.log(JSON.stringify({ status: 'ready', execution: 'remote_private', automatic_work: false }));
  setInterval(() => {}, 60000);
});
