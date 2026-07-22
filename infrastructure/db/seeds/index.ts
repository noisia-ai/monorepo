import { pool } from "./client.js";
import { seedBrandSeeds } from "./brand-seeds.js";
import { requireSafeDatabaseWriteTarget } from "./connection.js";
import { seedDemoData } from "./demo-data.js";
import { requireEnv } from "./env.js";
import { seedMemory } from "./memory.js";
import { seedMethodologies } from "./methodologies.js";
import { seedSignalMetricCatalogV1 } from "./signal-metric-catalog.js";

async function main() {
  requireSafeDatabaseWriteTarget(requireEnv("DATABASE_URL"), {
    operation: "db:seed",
    allowRemoteEnv: "NOISIA_DB_SEED_ALLOW_REMOTE"
  });

  const methodologies = await seedMethodologies();
  const brandSeeds = await seedBrandSeeds();
  const demo = await seedDemoData();
  const memory = await seedMemory();
  const signalMetrics = await seedSignalMetricCatalogV1();

  console.log(
    JSON.stringify(
      {
        ok: true,
        methodologies,
        brandSeeds,
        demo,
        memory,
        signalMetrics
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
