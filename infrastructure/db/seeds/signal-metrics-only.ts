import { pool } from "./client.js";
import { requireSafeDatabaseWriteTarget } from "./connection.js";
import { requireEnv } from "./env.js";
import { seedSignalMetricCatalogV1 } from "./signal-metric-catalog.js";

async function main() {
  requireSafeDatabaseWriteTarget(requireEnv("DATABASE_URL"), {
    operation: "db:seed:signal-metrics",
    allowRemoteEnv: "NOISIA_DB_SEED_ALLOW_REMOTE"
  });
  console.log(JSON.stringify({ ok: true, signal_metrics: await seedSignalMetricCatalogV1() }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
