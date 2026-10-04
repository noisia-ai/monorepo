import { main, openDatabase } from './guard.mjs';

await main(async () => {
  if (process.env.NOISIA_MFP_WORKER_ENABLED === 'true') {
    // Pin the existing Worker pools only after verifying the dedicated remote target.
    await openDatabase();
    // This entry point is checked by the Worker project, separately from Studio's
    // Next.js ambient ProcessEnv types used by the harness TypeScript project.
    await import(new URL('../../services/workers/src/index.ts', import.meta.url).href);
    return;
  }
  console.log(JSON.stringify({ status: 'ready', execution: 'remote_private', automatic_work: false }));
  setInterval(() => {}, 60000);
});
