import { chmod, writeFile } from "node:fs/promises";
import pg from "pg";
import { getDatabaseSslConfig, requireSafeDatabaseWriteTarget } from "../seeds/connection";
import { inspectTopicContextIdentityCutV1, sealTopicContextIdentityCutV1 } from "../signal-topic-context-identity-cut";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}
async function main() {
  const mode = argument("--mode"), actor = argument("--actor"), output = argument("--output");
  if (!mode || !["inspect", "seal"].includes(mode) || !actor || !output
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(actor)) {
    throw new Error("Pass --mode inspect|seal, --actor UUID and --output PRIVATE_PATH.");
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required.");
  if (mode === "seal") requireSafeDatabaseWriteTarget(url, { operation: "seal the historical topic context cut",
    allowRemoteEnv: "NOISIA_TOPIC_CONTEXT_IDENTITY_CUT_ALLOW_REMOTE" });
  const pool = new pg.Pool({ connectionString: url, ssl: getDatabaseSslConfig(), max: 1 });
  try {
    const expected = argument("--expected-inventory-digest");
    if (mode === "seal" && !expected) throw new Error("Pass the digest returned by the read-only inspect command.");
    const report = mode === "inspect"
      ? await inspectTopicContextIdentityCutV1({ database: pool, actor_user_id: actor })
      : await sealTopicContextIdentityCutV1({ database: pool, actor_user_id: actor, expected_inventory_digest: expected! });
    await writeFile(output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    await chmod(output, 0o600);
    console.log(JSON.stringify({ mode, inventory_digest: report.inventory_digest,
      transition_count: report.transition_count, already_sealed: report.already_sealed }));
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "topic_context_cut_failed"); process.exitCode = 1; });
