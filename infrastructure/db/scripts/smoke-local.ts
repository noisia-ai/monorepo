import pg from "pg";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@localhost:55432/noisia_migration_smoke";

function run(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  });
}

async function waitForDatabase(databaseUrl: string) {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < 60_000) {
    const client = new pg.Client({ connectionString: databaseUrl, ssl: false });
    try {
      await client.connect();
      await client.query("select 1");
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }

  throw new Error(`Local smoke database did not become ready within 60s: ${String(lastError)}`);
}

async function main() {
  const dbRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const repoRoot = dirname(dirname(dbRoot));
  const composeFile = join(repoRoot, "infrastructure", "docker", "docker-compose.yml");
  const databaseUrl = process.env.NOISIA_DB_SMOKE_LOCAL_DATABASE_URL ?? DEFAULT_DATABASE_URL;

  if (process.env.NOISIA_DB_SMOKE_SKIP_DOCKER !== "true") {
    await run("docker", ["compose", "-f", composeFile, "--profile", "migration-smoke", "up", "-d", "postgres-smoke"], {
      cwd: repoRoot
    });
  }

  await waitForDatabase(databaseUrl);

  await run("pnpm", ["exec", "tsx", "scripts/smoke-migrations.ts"], {
    cwd: dbRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DATABASE_SSL: "false",
      NOISIA_DB_SMOKE_RESET_SCHEMA: "true"
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
