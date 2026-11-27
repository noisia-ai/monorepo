/**
 * Operator entry for Listening JEV runs. Environment comes from the caller
 * (for UAT: `railway run -s workers-uat -e uat -- pnpm ...`); nothing is read
 * from or written to a file, and no secret or identifier is printed.
 *
 *   request  --workspace <uuid> --map <uuid> --roots <n> --cap-usd <n>   queue a run for the workers
 *   status   --run <uuid>                                                print its receipt
 *   local    --run <uuid>                                                process it in this process
 *   requeue  --run <uuid> [--cap-usd <n>]                                resume a failed or capped run
 *   import   --workspace <uuid> --map <uuid>                             copy the R15 answers into the cache (no provider call)
 *   estimate --workspace <uuid> --actor <uuid>                           what a listening pass would ask now
 *   question --workspace <uuid> --actor <uuid> --file <json>             add or replace one question with options
 *   listen   --workspace <uuid> --actor <uuid> --cap-usd <n>             queue a listening pass (asks only what is pending)
 *   metrics  --workspace <uuid> --actor <uuid> --question <key>          distribution of one question
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import {
  claimSignalListeningRunV1, estimateSignalListeningV1, getSignalListeningRunV1, getSignalListeningStateV1, importSignalListeningLegacyAnswersV1,
  readSignalListeningQuestionMetricsV1, requestSignalListeningRunV1, requestSignalListeningV1, requeueSignalListeningRunV1,
  saveSignalListeningQuestionsV1, SIGNAL_LISTENING_DEFAULT_PRICE_V1,
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
        input_usd_per_mtok: SIGNAL_LISTENING_DEFAULT_PRICE_V1 } });
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
  } else if (mode === "import") {
    const result = await importSignalListeningLegacyAnswersV1({ database: pool, workspace_id: required("workspace"), map_id: required("map"),
      on_progress: (done, total) => console.error(`imported roots ${done}/${total}`) });
    console.log(JSON.stringify({ answers: result.answers, questions: result.questions, roots: result.roots }));
  } else if (mode === "estimate") {
    const estimate = await estimateSignalListeningV1({ database: pool, workspace_id: required("workspace"), actor_user_id: required("actor") });
    console.log(JSON.stringify({ ...estimate, estimated_usd: estimate.estimated_micro_usd / 1e6 }, null, 1));
  } else if (mode === "question") {
    const access = { database: pool, workspace_id: required("workspace"), actor_user_id: required("actor") };
    const state = await getSignalListeningStateV1(access), question = JSON.parse(readFileSync(required("file"), "utf8")) as { key: string };
    const saved = await saveSignalListeningQuestionsV1({ ...access, expected_revision: state.revision,
      questions: [...state.configuration.questions.filter(existing => existing.key !== question.key), question] });
    console.log(JSON.stringify({ revision: saved.revision, questions: saved.configuration.questions.map(item => item.key) }));
  } else if (mode === "listen") {
    const queued = await requestSignalListeningV1({ database: pool, workspace_id: required("workspace"), actor_user_id: required("actor"),
      cap_micro_usd: Math.round(Number(required("cap-usd")) * 1e6) });
    console.log(JSON.stringify(queued));
  } else if (mode === "metrics") {
    const metrics = await readSignalListeningQuestionMetricsV1({ database: pool, workspace_id: required("workspace"), actor_user_id: required("actor"),
      question_key: required("question") });
    console.log(JSON.stringify({ ...metrics, by_topic: metrics.by_topic.slice(0, 12), trend: metrics.trend.slice(-12) }, null, 1));
  } else throw new Error("usage: signal-listening-run.ts request|status|local|requeue|import|estimate|question|listen|metrics");
} finally { await pool.end(); }
