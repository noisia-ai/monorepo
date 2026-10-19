import { pool } from "./client.js";
import { requireSafeDatabaseWriteTarget } from "./connection.js";
import { requireEnv } from "./env.js";
import { seedMethodologies } from "./methodologies.js";

async function main() {
  requireSafeDatabaseWriteTarget(requireEnv("DATABASE_URL"), {
    operation: "db:seed:methodologies",
    allowRemoteEnv: "NOISIA_DB_SEED_ALLOW_REMOTE"
  });

  const methodologies = await seedMethodologies();

  console.log(
    JSON.stringify(
      {
        ok: true,
        methodologies
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
