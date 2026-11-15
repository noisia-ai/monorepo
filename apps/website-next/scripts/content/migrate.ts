import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "./env";

/**
 * Applies the content database migrations that have not run yet, in order, each in its own
 * transaction. Needs the owner connection (CONTENT_OWNER_DATABASE_URL), because the first
 * migration creates the schema and the roles.
 */

const dir = join(process.cwd(), "content-db/migrations");
const files = readdirSync(dir).filter((file) => file.endsWith(".sql")).sort();

const db = connect("CONTENT_OWNER_DATABASE_URL");
await db.connect();
try {
  const exists = await db.query<{ table: string | null }>("select to_regclass('content.schema_migrations')::text as table");
  const applied = new Set<string>();
  if (exists.rows[0]?.table) {
    const { rows } = await db.query<{ name: string }>("select name from content.schema_migrations");
    for (const row of rows) applied.add(row.name);
  }
  const pending = files.filter((file) => !applied.has(file));
  if (pending.length === 0) console.log("Content database is up to date.");
  for (const file of pending) {
    await db.query("begin");
    try {
      await db.query(readFileSync(join(dir, file), "utf8"));
      await db.query("insert into content.schema_migrations (name) values ($1)", [file]);
      await db.query("commit");
      console.log(`Applied ${file}`);
    } catch (error) {
      await db.query("rollback");
      throw new Error(`${file} failed and was rolled back: ${(error as Error).message}`);
    }
  }
} finally {
  await db.end();
}
