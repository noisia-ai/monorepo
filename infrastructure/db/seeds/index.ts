import { pool } from "./client.js";
import { seedBrandSeeds } from "./brand-seeds.js";
import { seedDemoData } from "./demo-data.js";
import { seedMemory } from "./memory.js";
import { seedMethodologies } from "./methodologies.js";

async function main() {
  const methodologies = await seedMethodologies();
  const brandSeeds = await seedBrandSeeds();
  const demo = await seedDemoData();
  const memory = await seedMemory();

  console.log(
    JSON.stringify(
      {
        ok: true,
        methodologies,
        brandSeeds,
        demo,
        memory
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
