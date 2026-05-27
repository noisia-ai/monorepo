import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// override: true so that empty-string env vars set by the parent shell
// (e.g. ANTHROPIC_API_KEY="" from Claude Code sandbox) don't block loading.
dotenv.config({ path: resolve(workerRoot, "../../apps/studio/.env.local"), override: true });
dotenv.config({ path: resolve(workerRoot, ".env"), override: true });
