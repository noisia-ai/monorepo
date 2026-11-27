import Anthropic from "@anthropic-ai/sdk";
import type { Pool } from "pg";
import {
  claimSignalListeningCycleV1, finishSignalListeningCycleV1, getSignalListeningCycleV1, measureSignalListeningRoundV1, openSignalListeningNextRoundV1,
  listSignalListeningOrphanRootsV1, readSignalListeningCycleConfigurationV1, readSignalListeningRootVectorsV1, releaseSignalListeningCycleV1, renewSignalListeningCycleV1,
  requestSignalListeningRoundRunV1, saveSignalListeningOrphanGroupsV1, saveSignalListeningReviewV1, settleSignalListeningRoundRunV1,
  type SignalListeningCycleV1, type SignalListeningRoundV1, type SignalListeningStoredOrphanGroupV1,
} from "@noisia/db";
import {
  applySignalListeningReviewV1, buildSignalListeningReviewPayloadV1, clusterSignalListeningOrphansV1, decideSignalListeningCycleStopV1,
  signalListeningReviewCostMicroUsdV1, SIGNAL_LISTENING_REVIEW_MODEL_V1, SIGNAL_LISTENING_REVIEW_SCHEMA_V1, SIGNAL_LISTENING_REVIEW_SYSTEM_V1,
} from "@noisia/query-engine";

type Database = Pick<Pool, "connect" | "query">;
export type ListeningReviewUsageV1 = { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null };
/** One review of the map: a system prompt, one JSON document, one JSON answer. */
export type ListeningReviewerV1 = (request: { system: string; payload: string }) => Promise<{ output: unknown; usage: ListeningReviewUsageV1; model: string }>;

/** Largest review this job will pay for, used to refuse a step the remaining budget cannot cover. */
const REVIEW_RESERVE_MICRO_USD = 3_000_000;

/**
 * The map review runs on Claude Sonnet 4.6, streamed because the answer can be
 * long. The answer is constrained to the review schema; a refusal or a
 * truncated answer is an error, never a partial map.
 */
export function createSonnetListeningReviewerV1(options: { apiKey: string; client?: Pick<Anthropic, "messages"> }): ListeningReviewerV1 {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 2 });
  return async request => {
    const message = await client.messages.stream({
      model: SIGNAL_LISTENING_REVIEW_MODEL_V1, max_tokens: 64_000, thinking: { type: "adaptive" },
      system: request.system,
      output_config: { format: { type: "json_schema", schema: SIGNAL_LISTENING_REVIEW_SCHEMA_V1 as unknown as Record<string, unknown> } },
      messages: [{ role: "user", content: request.payload }],
    }).finalMessage();
    if (message.stop_reason === "refusal") throw new Error("listening_review_refused");
    if (message.stop_reason === "max_tokens") throw new Error("listening_review_truncated");
    const text = message.content.flatMap(block => block.type === "text" ? [block.text] : []).join("");
    let output: unknown;
    try { output = JSON.parse(text); } catch { throw new Error("listening_review_output_invalid"); }
    return { output, usage: message.usage, model: message.model };
  };
}

/** Groups the roots about the category that no topic accepted, to show the reviewer what may be missing. */
export async function regroupListeningOrphansV1(database: Database, cycle: SignalListeningCycleV1, round: Pick<SignalListeningRoundV1, "id">,
  heartbeat: () => Promise<void> = async () => undefined): Promise<SignalListeningStoredOrphanGroupV1[]> {
  const policy = cycle.policy.orphan, excerpts: string[] = [], chunks: Float32Array[] = [];
  let dimensions = 0;
  const roots = await listSignalListeningOrphanRootsV1(database, cycle, round);
  if (roots.length < policy.min_roots_to_regroup) return [];
  for (let from = 0; from < roots.length; from += 500) {
    for (const row of await readSignalListeningRootVectorsV1(database, cycle, roots.slice(from, from + 500))) {
      dimensions ||= row.vector.length;
      if (row.vector.length !== dimensions) continue;
      excerpts.push(row.excerpt); chunks.push(Float32Array.from(row.vector));
    }
    await heartbeat();
  }
  if (excerpts.length < policy.min_roots_to_regroup) return [];
  const vectors = new Float32Array(excerpts.length * dimensions);
  chunks.forEach((chunk, index) => vectors.set(chunk, index * dimensions));
  const wanted = Math.max(2, Math.min(policy.max_groups, Math.round(excerpts.length / policy.roots_per_group)));
  const clustered = clusterSignalListeningOrphansV1({ vectors, dimensions, groups: wanted });
  const members = new Map<number, number[]>();
  clustered.assignments.forEach((group, row) => { const list = members.get(group); if (list) list.push(row); else members.set(group, [row]); });
  return [...members].filter(([, rows]) => rows.length >= policy.min_group).sort((a, b) => b[1].length - a[1].length).slice(0, policy.max_groups)
    .map(([group, rows], index) => {
      const ranked = [...rows].sort((a, b) => clustered.similarities[b]! - clustered.similarities[a]!);
      // Half of the examples are the most typical posts; the rest are spread over the group so its edges are visible too.
      const typical = ranked.slice(0, Math.ceil(policy.examples / 2));
      const step = Math.max(1, Math.floor(ranked.length / Math.max(1, policy.examples - typical.length)));
      const spread = ranked.filter((_, position) => position >= typical.length && (position - typical.length) % step === 0).slice(0, policy.examples - typical.length);
      return { group_key: `orphans_${index + 1}`, roots: rows.length,
        cohesion: Math.round(rows.reduce((sum, row) => sum + clustered.similarities[row]!, 0) / rows.length * 1000) / 1000,
        examples: [...typical, ...spread].map(row => excerpts[row]!),
        centroid: Array.from(clustered.centroids.subarray(group * dimensions, (group + 1) * dimensions)) };
    });
}

export type ListeningCycleStepV1 = "continue" | "waiting" | "done";
/**
 * Advances a claimed cycle by one step. Every step is recorded before the next
 * begins, so a restart resumes after the last finished one. The order is:
 * ask (rounds after the first) → measure → stop or regroup orphans → review → next round.
 */
export async function stepSignalListeningCycleV1(args: { database: Database; cycle: SignalListeningCycleV1; reviewer: ListeningReviewerV1;
  heartbeat?: () => Promise<void> }): Promise<ListeningCycleStepV1> {
  const { database, cycle } = args, state = await getSignalListeningCycleV1(database, cycle.id);
  if (!state || !state.rounds.length) throw new Error("listening_cycle_unavailable");
  const round = state.rounds.at(-1)!, previous = state.rounds.at(-2) ?? null;
  const remaining = state.cycle.cap_micro_usd - state.cycle.spent_micro_usd;
  if (round.step === "created") {
    if (!round.run_id) {
      if (remaining < 50_000) { await finishSignalListeningCycleV1(database, cycle, { status: "failed", error_code: "listening_cycle_cap_reached" }); return "done"; }
      await requestSignalListeningRoundRunV1(database, cycle, round, remaining);
      return "waiting";
    }
    const run = await settleSignalListeningRoundRunV1(database, cycle, round);
    if (run.status === "completed") return "continue";
    if (run.status === "queued" || run.status === "running") return "waiting";
    await finishSignalListeningCycleV1(database, cycle, { status: "failed", error_code: `listening_round_run_${run.status}` });
    return "done";
  }
  if (round.step === "asked") { await measureSignalListeningRoundV1(database, cycle, round); return "continue"; }
  if (round.step === "measured") {
    const decision = decideSignalListeningCycleStopV1({ policy: cycle.policy, current: round.evidence!, previous: previous?.evidence ?? null, map_changed: true });
    if (decision.stop) { await finishSignalListeningCycleV1(database, cycle, { status: "completed", stop_reason: decision.reason }); return "done"; }
    await saveSignalListeningOrphanGroupsV1(database, round, await regroupListeningOrphansV1(database, cycle, round, args.heartbeat));
    return "continue";
  }
  if (round.step === "regrouped") {
    if (remaining < REVIEW_RESERVE_MICRO_USD) { await finishSignalListeningCycleV1(database, cycle, { status: "failed", error_code: "listening_cycle_cap_reached" }); return "done"; }
    const configuration = await readSignalListeningCycleConfigurationV1(database, cycle);
    const groups = round.orphan_groups ?? [];
    const payload = buildSignalListeningReviewPayloadV1({ category: configuration.category, question_language: configuration.candidate_language,
      catalog: round.catalog, themes: round.themes, evidence: round.evidence!, policy: cycle.policy,
      orphan_groups: groups.map(({ centroid: _centroid, ...group }) => group) });
    const started = Date.now();
    const answer = await args.reviewer({ system: SIGNAL_LISTENING_REVIEW_SYSTEM_V1, payload });
    const cost_micro_usd = signalListeningReviewCostMicroUsdV1(answer.usage);
    const result = applySignalListeningReviewV1({ catalog: round.catalog, orphan_groups: groups, output: answer.output });
    const review = { model: answer.model, usage: answer.usage, cost_micro_usd, duration_ms: Date.now() - started, payload_bytes: Buffer.byteLength(payload),
      summary: result.summary, rejected: result.rejected, map_changed: result.map_changed, output: answer.output };
    if (!result.map_changed) {
      // Nothing to ask again: the map keeps its wording and only gains its themes and domains.
      await saveSignalListeningReviewV1(database, cycle, round, review, { catalog: result.catalog, themes: result.themes }, cost_micro_usd);
      await finishSignalListeningCycleV1(database, cycle, { status: "completed", stop_reason: "map_unchanged" });
      return "done";
    }
    await openSignalListeningNextRoundV1({ database, cycle, round, catalog: result.catalog, themes: result.themes, review, cost_micro_usd });
    return "continue";
  }
  // `reviewed` on the last round means the review changed nothing and the cycle only needs closing.
  await finishSignalListeningCycleV1(database, cycle, { status: "completed", stop_reason: "map_unchanged" });
  return "done";
}

/** Runs queued discovery cycles. Off unless `NOISIA_SIGNAL_LISTENING_ENABLED=true`. */
export function startSignalListeningCycleDrainerV1(options: { database?: Database; env?: NodeJS.ProcessEnv; interval_ms?: number; reviewer?: ListeningReviewerV1 } = {}) {
  const env = options.env ?? process.env;
  let active: Promise<void> | undefined, ready = false, reviewer = options.reviewer;
  const tick = async () => {
    if (env.NOISIA_SIGNAL_LISTENING_ENABLED !== "true") return;
    const database = options.database ?? (await import("../db/client")).pool;
    ready ||= Boolean((await database.query("SELECT to_regclass('signal_listening_cycles') IS NOT NULL ready")).rows[0]?.ready);
    if (!ready) return;
    const cycle = await claimSignalListeningCycleV1(database);
    if (!cycle) return;
    reviewer ??= createSonnetListeningReviewerV1({ apiKey: env.NOISIA_MASS_LABELING_ANTHROPIC_API_KEY ?? env.ANTHROPIC_API_KEY ?? "" });
    const heartbeat = async () => { await renewSignalListeningCycleV1(database, cycle); };
    const beat = setInterval(() => void heartbeat().catch(() => undefined), 60_000); beat.unref?.();
    try {
      for (;;) {
        const outcome = await stepSignalListeningCycleV1({ database, cycle, reviewer, heartbeat });
        if (outcome === "done") { console.log(`[listening-cycle] ${cycle.id} finished`); return; }
        // While JEV answers a round, the cycle is released and looked at again on a later tick.
        if (outcome === "waiting") { await releaseSignalListeningCycleV1(database, cycle); return; }
        await heartbeat();
      }
    } catch (error) {
      const code = error instanceof Error && /^[a-z0-9_]{1,80}$/u.test(error.message) ? error.message : "listening_cycle_failed";
      console.warn(`[listening-cycle] ${cycle.id} failed: ${code}`);
      await finishSignalListeningCycleV1(database, cycle, { status: "failed", error_code: code }).catch(() => undefined);
    } finally { clearInterval(beat); }
  };
  const start = () => { active ??= tick().catch(() => console.warn("[listening-cycle] drainer unavailable")).finally(() => { active = undefined; }); };
  const timer = setInterval(start, options.interval_ms ?? 10_000); timer.unref?.();
  start();
  return { async close() { clearInterval(timer); if (active) await active; } };
}
