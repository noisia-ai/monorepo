import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const explicitEnv = { ...process.env };

// Load with override so empty-string env vars set by parent shells
// (e.g. ANTHROPIC_API_KEY="") can still be filled from local env files.
dotenv.config({ path: resolve(workerRoot, "../../apps/studio/.env.local"), override: true });
dotenv.config({ path: resolve(workerRoot, ".env"), override: true });

for (const [key, value] of Object.entries(explicitEnv)) {
  if (value) process.env[key] = value;
}
