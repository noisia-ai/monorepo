/**
 * Operator entry for Listening JEV runs. Environment comes from the caller
 * (for UAT: `railway run -s workers-uat -e uat -- pnpm ...`); nothing is read
 * from or written to a file, and no secret or identifier is printed.
 *
 *   request  --workspace <uuid> --map <uuid> --roots <n> --cap-usd <n>   queue a run for the workers
 *   status   --run <uuid>                                                print its receipt
 *   local    --run <uuid>                                                process it in this process
 *   requeue  --run <uuid> [--cap-usd <n>]                                resume a failed or capped run
 */
import pg from "pg";
import {
  claimSignalListeningRunV1, getSignalListeningRunV1, requestSignalListeningRunV1, requeueSignalListeningRunV1, SIGNAL_LISTENING_DEFAULT_PRICE_V1,
} from "@noisia/db";
import { createJevAccountRateLimiter } from "../src/providers/jev-account-rate-limit";
import { createJevPacedClientV1, createLocalJevRateLimiterV1 } from "../src/providers/jev-paced-client";
import { createListeningRawStoreV1, processSignalListeningRunV1, readListeningJevSettingsV1 } from "../src/workers/signal-listening-job";

const [mode, ...rest] = process.argv.slice(2);
const flag = (name: string) => { const index = rest.indexOf(`--${name}`); return index >= 0 ? rest[index + 1] : undefined; };
const required = (name: string) => flag(name) ?? (() => { throw new Error(`--${name} is required`); })();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const ssl = ["0", "false", "off", "disable"].includes((process.env.DATABASE_SSL ?? "").toLowerCase()) ? false : { rejectUnauthorized: false };
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl, max: 4 });

function report(run: NonNullable<Awaited<ReturnType<typeof getSignalListeningRunV1>>>) {
  console.log(JSON.stringify({ status: run.status, kind: run.kind, roots_done: run.roots_done, roots_failed: run.roots_failed,
    pages: run.pages, input_tokens: run.input_tokens, spent_usd: run.spent_micro_usd / 1e6, cap_usd: run.cap_micro_usd / 1e6,
    error_code: run.error_code, started_at: run.started_at, completed_at: run.completed_at, receipt: run.receipt }, null, 1));
}

try {
  if (mode === "request") {
    const run = await requestSignalListeningRunV1({ database: pool, workspace_id: required("workspace"), kind: "legacy_request",
      cap_micro_usd: Math.round(Number(required("cap-usd")) * 1e6),
      plan: { planner: "r15_request_v2", map_id: required("map"), root_limit: Number(required("roots")),
        input_usd_per_mtok: SIGNAL_LISTENING_DEFAULT_PRICE_V1, reask: true } });
    console.log(JSON.stringify({ run_id: run.id, status: run.status }));
  } else if (mode === "status") {
    const run = await getSignalListeningRunV1(pool, required("run"));
    if (!run) throw new Error("run not found");
    report(run);
  } else if (mode === "local") {
    const claimed = await claimSignalListeningRunV1(pool, required("run"));
    if (!claimed) throw new Error("the run is not claimable: it is finished or another worker holds it");
    const settings = readListeningJevSettingsV1();
    let quit: (() => Promise<unknown>) | undefined;
    let limiter = createLocalJevRateLimiterV1(settings);
    if (process.env.REDIS_URL) {
      const { default: Redis } = await import("ioredis");
      const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 2, tls: process.env.REDIS_URL.startsWith("rediss://") ? {} : undefined });
      quit = () => redis.quit();
      limiter = createJevAccountRateLimiter(settings, (script, keys, values) => redis.eval(script, keys.length, ...keys, ...values));
    }
    const client = createJevPacedClientV1({ api_key: process.env.TYPESAFE_API_KEY ?? "", limiter,
      max_input_tokens_per_request: Math.min(65_536, settings.input_tokens_per_second) });
    try {
      await processSignalListeningRunV1({ database: pool, run: claimed, client, store_raw: createListeningRawStoreV1(),
        max_in_flight: settings.max_in_flight, page_size: settings.page_size });
    } finally { await quit?.().catch(() => undefined); }
    report((await getSignalListeningRunV1(pool, claimed.id))!);
  } else if (mode === "requeue") {
    const cap = flag("cap-usd");
    console.log(JSON.stringify({ requeued: await requeueSignalListeningRunV1(pool, required("run"), cap ? Math.round(Number(cap) * 1e6) : undefined) }));
  } else throw new Error("usage: signal-listening-run.ts request|status|local|requeue");
} finally { await pool.end(); }
