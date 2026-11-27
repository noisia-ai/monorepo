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
 *   cycle    --workspace <uuid> --actor <uuid> --cap-usd <n>             queue the automatic discovery loop
 *   cycle-status --cycle <uuid>                                          rounds, signals and spending of a loop
 *   cycle-local  --cycle <uuid> [--steps <n>]                            advance a loop in this process (no JEV pass)
 *   study    --workspace <uuid> --actor <uuid> --name <text> --subject-file <json> --cap-usd <n>   queue a study
 *   study-status --study <uuid>                                          steps, counts and spending of a study
 *   study-local  --study <uuid> [--steps <n>]                            advance a study in this process (no JEV pass)
 *   study-requeue --study <uuid>                                         put a failed study back in the queue; paid steps are kept
 *   promote  --workspace <uuid> --actor <uuid> --study <uuid> --motives <key,key>   carry motives to the defined topics
 */
import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  claimSignalStudyV1, getSignalStudyV1, listSignalStudyMotivesV1, promoteSignalStudyMotivesV1, releaseSignalStudyV1, renewSignalStudyV1, requestSignalStudyV1, requeueSignalStudyV1,
  claimSignalListeningCycleV1, getSignalListeningCycleV1, releaseSignalListeningCycleV1, renewSignalListeningCycleV1, requestSignalListeningCycleV1,
  claimSignalListeningRunV1, estimateSignalListeningV1, getSignalListeningRunV1, getSignalListeningStateV1, importSignalListeningLegacyAnswersV1,
  readSignalListeningQuestionMetricsV1, requestSignalListeningRunV1, requestSignalListeningV1, requeueSignalListeningRunV1,
  saveSignalListeningQuestionsV1, SIGNAL_LISTENING_DEFAULT_PRICE_V1,
} from "@noisia/db";
import { createJevAccountRateLimiter } from "../src/providers/jev-account-rate-limit";
import { createJevPacedClientV1, createLocalJevRateLimiterV1 } from "../src/providers/jev-paced-client";
import { createListeningRawStoreV1, processSignalListeningRunV1, readListeningJevSettingsV1 } from "../src/workers/signal-listening-job";
import { createSonnetListeningReviewerV1, stepSignalListeningCycleV1 } from "../src/workers/signal-listening-cycle-job";
import { createSonnetJsonAgentV1 } from "../src/providers/sonnet-json-agent";
import { stepSignalStudyV1 } from "../src/workers/signal-study-job";

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

/** Counts and decisions only: no post text and no topic wording is printed. */
async function cycleStatus(cycle_id: string) {
  const state = await getSignalListeningCycleV1(pool, cycle_id);
  if (!state) throw new Error("cycle not found");
  console.log(JSON.stringify({ status: state.cycle.status, stop_reason: state.cycle.stop_reason, error_code: state.cycle.error_code,
    spent_usd: state.cycle.spent_micro_usd / 1e6, cap_usd: state.cycle.cap_micro_usd / 1e6,
    rounds: state.rounds.map(round => ({ round: round.round_no, step: round.step, topics: round.catalog.length, themes: round.themes.length,
      outside: round.catalog.filter(topic => topic.domain === "outside").length, run_id: round.run_id,
      signals: round.evidence ? { category_roots: round.evidence.category_roots, orphan_roots: round.evidence.orphan_roots,
        orphan_rate: round.evidence.orphan_rate, twin_pairs: round.evidence.twins.length, twin_roots: round.evidence.twin_roots,
        twin_root_rate: round.evidence.twin_root_rate } : null,
      orphan_groups: round.orphan_groups?.map(group => ({ roots: group.roots, cohesion: group.cohesion })) ?? null,
      review: round.review ? { summary: round.review.summary, rejected: round.review.rejected, usage: round.review.usage,
        cost_usd: Number(round.review.cost_micro_usd) / 1e6, duration_ms: round.review.duration_ms, payload_bytes: round.review.payload_bytes } : null })) }, null, 1));
}

/** Counts and decisions only: no post text, no brand name and no motive wording is printed. */
async function studyStatus(study_id: string) {
  const study = await getSignalStudyV1(pool, study_id);
  if (!study) throw new Error("study not found");
  const state = study.state as Record<string, any>, motives = await listSignalStudyMotivesV1(pool, study_id), output = study.output as Record<string, any> | null;
  console.log(JSON.stringify({ status: study.status, step: study.step, error_code: study.error_code, spent_usd: study.spent_micro_usd / 1e6, cap_usd: study.cap_micro_usd / 1e6,
    runs: state.runs ?? {}, attempts: state.attempts ?? {}, pool_roots: state.pool_roots ?? null, directed_roots: state.directed_roots ?? null,
    groups: (state.groups ?? []).map((group: { roots: number }) => group.roots), naming: state.naming ? { ...state.naming, rejected: state.naming.rejected?.length } : null,
    layer_stability: state.layer_stability ? { ...state.layer_stability, decision_rules: undefined } : null, checks: state.checks ?? null,
    agent_costs_usd: Object.fromEntries(Object.entries(state.answers ?? {}).map(([key, value]: [string, any]) => [key, value.cost_micro_usd / 1e6])),
    motives: motives.length, layers: motives.reduce<Record<string, number>>((totals, motive) => { totals[motive.layer] = (totals[motive.layer] ?? 0) + 1; return totals; }, {}),
    output: output ? { status: output.status, cut: { mentions: output.cut?.mentions, corpus_mentions: output.cut?.corpus_mentions, answered: output.cut?.answered },
      axes: output.axes, directed: output.directed, query_bias: output.query_bias,
      layers: output.layers, motives: (output.motives ?? []).map((motive: Record<string, any>) => ({ layer: motive.layer, permission: motive.permission, mentions: motive.mentions,
        trigger: motive.mentions_with_trigger_signal, barrier: motive.mentions_with_barrier_signal, tension: motive.mentions_with_tension, verbatims: motive.verbatims?.length })) } : null }, null, 1));
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
      cap_micro_usd: Math.round(Number(required("cap-usd")) * 1e6), idempotency_key: flag("key") ?? randomUUID() });
    console.log(JSON.stringify(queued));
  } else if (mode === "metrics") {
    const metrics = await readSignalListeningQuestionMetricsV1({ database: pool, workspace_id: required("workspace"), actor_user_id: required("actor"),
      question_key: required("question") });
    console.log(JSON.stringify({ ...metrics, by_topic: metrics.by_topic.slice(0, 12), trend: metrics.trend.slice(-12) }, null, 1));
  } else if (mode === "cycle") {
    console.log(JSON.stringify(await requestSignalListeningCycleV1({ database: pool, workspace_id: required("workspace"), actor_user_id: required("actor"),
      cap_micro_usd: Math.round(Number(required("cap-usd")) * 1e6), idempotency_key: flag("key") ?? randomUUID() })));
  } else if (mode === "cycle-status") {
    await cycleStatus(required("cycle"));
  } else if (mode === "cycle-local") {
    const cycle = await claimSignalListeningCycleV1(pool, required("cycle"));
    if (!cycle) throw new Error("the cycle is not claimable: it is finished or another worker holds it");
    const reviewer = createSonnetListeningReviewerV1({ apiKey: process.env.NOISIA_MASS_LABELING_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "" });
    // A review can take longer than the lease: it is renewed so no worker starts a second, paid one.
    const beat = setInterval(() => void renewSignalListeningCycleV1(pool, cycle).catch(() => undefined), 60_000);
    try {
      for (let step = 0; step < Number(flag("steps") ?? 1); step++) {
        const outcome = await stepSignalListeningCycleV1({ database: pool, cycle, reviewer });
        console.error(`step ${step + 1}: ${outcome}`);
        if (outcome !== "continue") break;
      }
    } finally { clearInterval(beat); await releaseSignalListeningCycleV1(pool, cycle); }
    await cycleStatus(cycle.id);
  } else if (mode === "study") {
    // The subject names the brand and its competitors: it is read from a private file and never printed.
    console.log(JSON.stringify(await requestSignalStudyV1({ database: pool, workspace_id: required("workspace"), actor_user_id: required("actor"), name: required("name"),
      subject: JSON.parse(readFileSync(required("subject-file"), "utf8")), cap_micro_usd: Math.round(Number(required("cap-usd")) * 1e6),
      idempotency_key: flag("key") ?? randomUUID() })));
  } else if (mode === "study-status") {
    await studyStatus(required("study"));
  } else if (mode === "study-local") {
    const study = await claimSignalStudyV1(pool, required("study"));
    if (!study) throw new Error("the study is not claimable: it is finished or another worker holds it");
    const agent = createSonnetJsonAgentV1({ apiKey: process.env.NOISIA_MASS_LABELING_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "" });
    const beat = setInterval(() => void renewSignalStudyV1(pool, study).catch(() => undefined), 60_000);
    try {
      for (let step = 0; step < Number(flag("steps") ?? 1); step++) {
        const outcome = await stepSignalStudyV1({ database: pool, study, agent });
        console.error(`step ${step + 1}: ${outcome}`);
        if (outcome !== "continue") break;
      }
    } finally { clearInterval(beat); await releaseSignalStudyV1(pool, study); }
    await studyStatus(study.id);
  } else if (mode === "study-requeue") {
    console.log(JSON.stringify({ requeued: await requeueSignalStudyV1(pool, required("study")) }));
  } else if (mode === "promote") {
    console.log(JSON.stringify(await promoteSignalStudyMotivesV1({ database: pool, workspace_id: required("workspace"), actor_user_id: required("actor"),
      study_id: required("study"), motive_keys: required("motives").split(",").map(item => item.trim()).filter(Boolean) })));
  } else throw new Error("usage: signal-listening-run.ts request|status|local|requeue|import|estimate|question|listen|metrics|cycle|cycle-status|cycle-local|study|study-status|study-local|study-requeue|promote");
} finally { await pool.end(); }
