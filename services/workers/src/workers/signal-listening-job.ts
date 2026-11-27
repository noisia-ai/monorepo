import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { Pool } from "pg";
import {
  claimSignalListeningRunV1, createSignalListeningLegacySourceV1, createSignalListeningSourceV1, finishSignalListeningRunV1, releaseSignalListeningRunV1,
  renewSignalListeningRunV1, SIGNAL_LISTENING_MAX_CLAIMS_V1, writeSignalListeningPageV1, type SignalListeningRunV1,
} from "@noisia/db";
import { mapSignalListeningAnswersV1, signalListeningCostMicroUsdV1, type SignalListeningItemV1 } from "@noisia/query-engine";
import { createJevAccountRateLimiter, type JevAccountRateLimiter } from "../providers/jev-account-rate-limit";
import { createJevPacedClientV1, createLocalJevRateLimiterV1, type JevPacedClientV1 } from "../providers/jev-paced-client";
import { runListeningStreamV1, type ListeningStreamPageV1, type ListeningStreamReceiptV1 } from "./signal-listening-runner";

type Database = Pick<Pool, "connect" | "query">;
export type ListeningRawStoreV1 = (args: { workspace_id: string; run_id: string; page_no: number; content: Buffer; sha256: string }) => Promise<string>;

const positive = (value: string | undefined, fallback: number, max: number) => {
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : fallback;
};
/** Account limits observed in the provider console on 2026-11-21: 80 requests/s and
 * 100,000 input tokens/s for every key of the organization. The defaults keep 10 % free. */
export function readListeningJevSettingsV1(env: NodeJS.ProcessEnv = process.env) {
  return {
    account_id: env.NOISIA_TYPESAFE_ACCOUNT_ID?.trim() || "noisia",
    requests_per_second: positive(env.NOISIA_TYPESAFE_ACCOUNT_RPS, 72, 100_000),
    input_tokens_per_second: positive(env.NOISIA_TYPESAFE_ACCOUNT_INPUT_TPS, 90_000, 100_000_000),
    max_in_flight: positive(env.NOISIA_LISTENING_MAX_IN_FLIGHT, 64, 1024),
    page_size: positive(env.NOISIA_LISTENING_PAGE_SIZE, 1000, 10_000),
  };
}

/** One compressed JSONL object per page in the private corpus bucket. */
export function createListeningRawStoreV1(options: { url?: string; service_role_key?: string; bucket?: string; fetch?: typeof fetch } = {}): ListeningRawStoreV1 {
  const url = (options.url ?? process.env.SUPABASE_URL ?? "").replace(/\/$/u, "");
  const key = options.service_role_key ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const bucket = options.bucket ?? process.env.SUPABASE_STORAGE_BUCKET_IMPORTS ?? process.env.SUPABASE_STORAGE_BUCKET_CORPUS_FILES ?? "corpus-files";
  if (!url || !key || !/^[A-Za-z0-9._-]+$/u.test(bucket)) throw new Error("listening_raw_storage_unconfigured");
  const transport = options.fetch ?? fetch;
  const headers = { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}) };
  let checked: Promise<void> | undefined;
  const privateBucket = () => checked ??= (async () => {
    const response = await transport(`${url}/storage/v1/bucket/${encodeURIComponent(bucket)}`, { headers, signal: AbortSignal.timeout(30_000) });
    const body = response.ok ? await response.json() as { public?: boolean } : null;
    if (body?.public !== false) throw new Error("listening_raw_storage_not_private");
  })().catch(error => { checked = undefined; throw error; });
  return async args => {
    await privateBucket();
    const path = `signal-listening/${args.workspace_id}/${args.run_id}/page-${String(args.page_no).padStart(6, "0")}-${args.sha256.slice(7, 19)}.jsonl.gz`;
    for (let attempt = 0; ; attempt++) {
      const response = await transport(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${path}`, { method: "POST",
        // The bucket only admits a short list of content types; gzip is stored as opaque bytes.
        headers: { ...headers, "Content-Type": "application/octet-stream", "x-upsert": "true" }, body: new Uint8Array(args.content),
        signal: AbortSignal.timeout(120_000) }).catch(() => null);
      await response?.body?.cancel().catch(() => undefined);
      if (response?.ok) return `${bucket}/${path}`;
      if (attempt >= 3 || (response && response.status < 500 && response.status !== 429)) throw new Error("listening_raw_storage_failed");
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
    }
  };
}

/** Runs one claimed run to its end: stream, pages, cap, receipt. */
export async function processSignalListeningRunV1(args: {
  database: Database; run: SignalListeningRunV1; client: JevPacedClientV1; store_raw: ListeningRawStoreV1;
  max_in_flight: number; page_size: number; signal?: AbortSignal; lease_renewal_ms?: number;
}): Promise<ListeningStreamReceiptV1 & { status: string; spent_micro_usd: number }> {
  const { database, run } = args;
  if (Number(run.receipt.claims ?? 0) > SIGNAL_LISTENING_MAX_CLAIMS_V1) {
    await finishSignalListeningRunV1(database, run, { status: "failed", receipt: {}, error_code: "listening_run_claims_exhausted" });
    throw new Error("listening_run_claims_exhausted");
  }
  const source = run.plan.planner === "listening_v1" ? await createSignalListeningSourceV1(database, run)
    : await createSignalListeningLegacySourceV1(database, run);
  let spent = run.spent_micro_usd, leaseLost = false, rawMs = 0, dbMs = 0, rawFailures = 0, pricedTokens = 0;
  const heartbeat = setInterval(() => {
    void renewSignalListeningRunV1(database, run).then(owned => { if (!owned) leaseLost = true; }).catch(() => undefined);
  }, args.lease_renewal_ms ?? 30_000); heartbeat.unref?.();
  const flush = async (page: ListeningStreamPageV1<SignalListeningItemV1 & { request: SignalListeningItemV1["request"] }>) => {
    const tokens = page.done.reduce((sum, entry) => sum + entry.response.usage.input_tokens, 0);
    let raw: { storage_key: string; sha256: string; size_bytes: number } | null = null;
    if (page.done.length) {
      const started = performance.now();
      const content = gzipSync(Buffer.from(page.done.map(entry => JSON.stringify({ root_id: entry.item.root_id,
        input_digest: entry.item.input_digest, latency_ms: Math.round(entry.latency_ms), body: entry.raw_body })).join("\n") + "\n"));
      const sha256 = `sha256:${createHash("sha256").update(content).digest("hex")}`;
      // Answers that were paid for are kept even when the raw copy cannot be stored.
      try {
        raw = { storage_key: await args.store_raw({ workspace_id: run.workspace_id, run_id: run.id, page_no: run.pages + page.page_no, content, sha256 }),
          sha256, size_bytes: content.length };
      } catch { rawFailures++; }
      rawMs += performance.now() - started;
    }
    const started = performance.now();
    const written = await writeSignalListeningPageV1({ database, run, page_no: run.pages + page.page_no, model: source.model,
      questions: page.done.flatMap(entry => entry.item.questions),
      answers: page.done.flatMap(entry => mapSignalListeningAnswersV1(entry.item, entry.response)), raw,
      roots_done: page.done.length, roots_failed: page.failed.length, input_tokens: tokens,
      cost_micro_usd: signalListeningCostMicroUsdV1(tokens, source.input_usd_per_mtok) });
    dbMs += performance.now() - started;
    spent = written.spent_micro_usd; pricedTokens += tokens;
  };
  // Spending is recorded when a page is written. The cap therefore counts three
  // things before a new slice may load: what is written, what was answered but
  // is not written yet, and room for the slice plus the requests in flight.
  let answeredTokens = 0, answeredRoots = 0, settledRoots = 0, loadedRoots = 0, capped = false;
  const metered: JevPacedClientV1 = { async evaluate(request, options) {
    try {
      const result = await args.client.evaluate(request, options);
      if (result.ok) { answeredTokens += result.response.usage.input_tokens; answeredRoots++; }
      return result;
    } finally { settledRoots++; }
  } };
  // How many more roots the remaining budget can pay for, at the observed size
  // per root with a quarter of slack. A slice is never larger than that, so a
  // small pass runs with a small cap and a large one stops exactly at its cap.
  const affordableRoots = () => {
    const perRoot = (answeredRoots ? answeredTokens / answeredRoots : 2000) * 1.25;
    const remaining = run.cap_micro_usd - spent - Math.ceil((answeredTokens - pricedTokens) * source.input_usd_per_mtok);
    return Math.floor(remaining / (perRoot * source.input_usd_per_mtok)) - (loadedRoots - settledRoots);
  };
  const overCap = () => { if (affordableRoots() < 1) capped = true; return capped; };
  const nextSlice = async () => {
    const items = await source.next(Math.max(1, Math.min(args.page_size, affordableRoots())));
    loadedRoots += items.length;
    return items;
  };
  const rescans = "rescans" in source && source.rescans;
  let receipt!: ListeningStreamReceiptV1;
  const totals = { roots_done: 0, roots_failed: 0, input_tokens: 0, pages: 0, requests: 0, throttled: 0, wall_ms: 0, load_ms: 0, flush_ms: 0 };
  try {
    // Roots that failed stay pending; two more passes give transient failures another chance.
    for (let pass = 0; pass < 3; pass++) {
      receipt = await runListeningStreamV1({ client: metered, max_in_flight: args.max_in_flight, page_size: args.page_size,
        next: nextSlice, flush, should_stop: () => leaseLost || overCap(), signal: args.signal });
      run.pages += receipt.pages;
      for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += receipt[key];
      // Another pass serves two cases: roots that failed, and questions that were
      // waiting for the base answers this pass just wrote. A pass that asked nothing ends the run.
      if (receipt.stop_reason !== "exhausted" || pass === 2 || !(receipt.roots_failed || (rescans && receipt.roots_done))) break;
      totals.roots_failed -= receipt.roots_failed;
      source.rewind();
    }
  } finally { clearInterval(heartbeat); }
  const summary = { ...receipt, ...totals, roots_per_second: totals.wall_ms ? Math.round(totals.roots_done / (totals.wall_ms / 1000) * 10) / 10 : 0 };
  const status = receipt.stop_reason === "fatal" ? "failed" : receipt.stop_reason === "exhausted" ? "completed"
    : leaseLost ? "running" : capped ? "cap_reached" : "running";
  const stored = { stream: summary, raw_upload_ms: Math.round(rawMs), database_write_ms: Math.round(dbMs), raw_pages_failed: rawFailures,
    tokens_per_root: summary.roots_done ? Math.round(summary.input_tokens / summary.roots_done) : null,
    settings: { max_in_flight: args.max_in_flight, page_size: args.page_size } };
  if (status === "running") await releaseSignalListeningRunV1(database, run);
  else await finishSignalListeningRunV1(database, run, { status, receipt: stored, error_code: receipt.fatal_code ?? null });
  return { ...summary, status, spent_micro_usd: spent };
}

/** Polls for queued runs. Off unless `NOISIA_SIGNAL_LISTENING_ENABLED=true`. */
export function startSignalListeningDrainerV1(options: { database?: Database; env?: NodeJS.ProcessEnv; interval_ms?: number } = {}) {
  const env = options.env ?? process.env;
  let active: Promise<void> | undefined, ready = false, limiter: JevAccountRateLimiter | undefined, client: JevPacedClientV1 | undefined;
  let redis: { quit(): Promise<unknown> } | undefined;
  const stop = new AbortController();
  const tick = async () => {
    if (env.NOISIA_SIGNAL_LISTENING_ENABLED !== "true" || env.NOISIA_JEV_PROVIDER_ENABLED === "false") return;
    const database = options.database ?? (await import("../db/client")).pool;
    ready ||= Boolean((await database.query("SELECT to_regclass('signal_listening_runs') IS NOT NULL ready")).rows[0]?.ready);
    if (!ready) return;
    const settings = readListeningJevSettingsV1(env);
    if (!client) {
      if (env.REDIS_URL) {
        const { default: Redis } = await import("ioredis");
        const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, tls: env.REDIS_URL.startsWith("rediss://") ? {} : undefined });
        redis = connection;
        limiter = createJevAccountRateLimiter(settings, (script, keys, values) => connection.eval(script, keys.length, ...keys, ...values));
      } else limiter = createLocalJevRateLimiterV1(settings);
      client = createJevPacedClientV1({ api_key: env.TYPESAFE_API_KEY ?? "", limiter,
        max_input_tokens_per_request: Math.min(65_536, settings.input_tokens_per_second) });
    }
    for (;;) {
      if (stop.signal.aborted) return;
      const run = await claimSignalListeningRunV1(database);
      if (!run) return;
      try {
        const outcome = await processSignalListeningRunV1({ database, run, client, store_raw: createListeningRawStoreV1(),
          max_in_flight: settings.max_in_flight, page_size: settings.page_size, signal: stop.signal });
        console.log(`[listening] run ${run.id} ${outcome.status}: ${outcome.roots_done} roots, ${outcome.roots_per_second}/s, ${outcome.spent_micro_usd} micro USD`);
        if (outcome.status === "running") return;
      } catch (error) {
        const code = error instanceof Error && /^[a-z0-9_]{1,80}$/u.test(error.message) ? error.message : "listening_run_failed";
        console.warn(`[listening] run ${run.id} failed: ${code}`);
        await finishSignalListeningRunV1(database, run, { status: "failed", receipt: {}, error_code: code }).catch(() => undefined);
      }
    }
  };
  const start = () => { active ??= tick().catch(() => console.warn("[listening] drainer unavailable")).finally(() => { active = undefined; }); };
  const timer = setInterval(start, options.interval_ms ?? 5000); timer.unref?.();
  start();
  return { async close() { clearInterval(timer); stop.abort(); if (active) await active; await redis?.quit().catch(() => undefined); } };
}
