import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import pg from "pg";

/**
 * Shared setup for the content scripts. Keys live in the repo root's `.env.local` (ignored by
 * git); the scripts walk up from the working directory to find it. Values are never printed.
 */

function loadEnvFile() {
  let dir = resolve(process.cwd());
  for (;;) {
    const file = join(dir, ".env.local");
    if (existsSync(file)) {
      for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
        const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!match || match[1] in process.env) continue;
        process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
      }
      return;
    }
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return;
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

loadEnvFile();

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Add it to the repo root's .env.local (see apps/website-next/content-db/README.md).`);
    process.exit(1);
  }
  return value;
}

export function connect(envName: string): pg.Client {
  const url = requireEnv(envName);
  const host = new URL(url).hostname;
  const local = host === "localhost" || host === "127.0.0.1";
  const ca = process.env.CONTENT_DATABASE_CA?.replace(/\\n/g, "\n");
  return new pg.Client({
    connectionString: url,
    ssl: local ? undefined : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false }
  });
}

/** Tells the site to refresh the feed. Without the URL and secret it only says what to do. */
export async function revalidateSite(): Promise<void> {
  const site = process.env.CONTENT_SITE_URL;
  const secret = process.env.CONTENT_REVALIDATE_SECRET;
  if (!site || !secret) {
    console.log("Site not refreshed: set CONTENT_SITE_URL and CONTENT_REVALIDATE_SECRET to update it right away.");
    return;
  }
  let response: Response;
  try {
    response = await fetch(new URL("/api/content/revalidate", site), { method: "POST", headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    console.error(`Could not reach ${new URL(site).host} (${(error as Error).message}). The change is saved; it shows after the next refresh or deploy.`);
    process.exitCode = 1;
    return;
  }
  if (!response.ok) {
    console.error(`The site did not refresh (${response.status}). The change is saved; it shows after the next refresh or deploy.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Site refreshed: ${new URL(site).host}`);
}

/** Flags that take a value (`--study <id>`); every other flag is a switch. */
const VALUE_FLAGS = ["shape", "study", "status", "days", "out", "base", "lang", "revoke", "n"];

export function parseArgs(argv: string[]) {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--") && VALUE_FLAGS.includes(name)) {
      flags.set(name, next);
      i++;
    } else flags.set(name, true);
  }
  return { flags, positional };
}
