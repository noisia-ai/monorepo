import Anthropic from "@anthropic-ai/sdk";
import type { Pool } from "pg";
import {
  beginSignalListeningReviewV1, chargeSignalListeningCycleV1, claimSignalListeningCycleV1, finishSignalListeningCycleV1, recordSignalListeningReviewAnswerV1, recordSignalListeningClosingMergesV1, lockSignalListeningEditedTopicsV1, signalListeningCarriedClosingMergesV1, getSignalListeningCycleV1, measureSignalListeningRoundV1, openSignalListeningNextRoundV1, readSignalListeningConfirmedCentroidsV1, settleSignalListeningPairChoicesV1,
  listSignalListeningOrphanRootsV1, readSignalListeningCycleConfigurationV1, readSignalListeningRootVectorsV1, releaseSignalListeningCycleV1, renewSignalListeningCycleV1,
  requestSignalListeningRoundRunV1, saveSignalListeningOrphanGroupsV1, saveSignalListeningReviewV1, settleSignalListeningRoundRunV1,
  type SignalListeningCycleV1, type SignalListeningRoundV1, type SignalListeningStoredOrphanGroupV1,
} from "@noisia/db";
import {
  applySignalListeningReviewV1, applySignalListeningRuleMergesV1, buildSignalListeningReviewPayloadV1, clusterSignalListeningOrphansV1, decideSignalListeningCycleStopV1,
  signalListeningReviewCostMicroUsdV1, SIGNAL_LISTENING_REVIEW_MODEL_V1, SIGNAL_LISTENING_REVIEW_SCHEMA_V1, SIGNAL_LISTENING_REVIEW_SYSTEM_V1,
} from "@noisia/query-engine";

type Database = Pick<Pool, "connect" | "query">;
export type ListeningReviewUsageV1 = { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null };
/** One review of the map: a system prompt, one JSON document, one JSON answer. */
export type ListeningReviewerV1 = (request: { system: string; payload: string }) => Promise<{ output: unknown; usage: ListeningReviewUsageV1; model: string }>;

/** A review that was paid for but cannot be used. Its usage is kept so the cycle is still charged. */
export class ListeningReviewErrorV1 extends Error {
  constructor(readonly code: string, readonly usage?: ListeningReviewUsageV1) { super(code); this.name = "ListeningReviewErrorV1"; }
}
/** Largest review this job will pay for, used to refuse a step the remaining budget cannot cover. */
const REVIEW_RESERVE_MICRO_USD = 1_500_000;
/** A review that fails is tried once more; after that the cycle stops instead of paying again. */
const MAX_REVIEW_ATTEMPTS = 2;

/**
 * The map review runs on Claude Sonnet 4.6, streamed because the answer can be
 * long. The answer is constrained to the review schema; a refusal or a
 * truncated answer is an error, never a partial map.
 */
export function createSonnetListeningReviewerV1(options: { apiKey: string; client?: Pick<Anthropic, "messages"> }): ListeningReviewerV1 {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 2 });
  return async request => {
    const message = await client.messages.stream({
      // Thinking shares the output limit with the answer, and a whole map is a long answer: two real
      // reviews with thinking on ran out of room before finishing. The evidence is explicit in the
      // request, so the answer is written directly.
      model: SIGNAL_LISTENING_REVIEW_MODEL_V1, max_tokens: 64_000, thinking: { type: "disabled" },
      system: request.system,
      output_config: { format: { type: "json_schema", schema: SIGNAL_LISTENING_REVIEW_SCHEMA_V1 as unknown as Record<string, unknown> } },
      messages: [{ role: "user", content: request.payload }],
    }).finalMessage();
    if (message.stop_reason === "refusal") throw new ListeningReviewErrorV1("listening_review_refused", message.usage);
    if (message.stop_reason === "max_tokens") throw new ListeningReviewErrorV1("listening_review_truncated", message.usage);
    const text = message.content.flatMap(block => block.type === "text" ? [block.text] : []).join("");
    let output: unknown;
    try { output = JSON.parse(text); } catch { throw new ListeningReviewErrorV1("listening_review_output_invalid", message.usage); }
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
  // A settling round only makes the last merges real: it is asked and measured, never reviewed.
  const settling = Boolean((round.review as { settling?: boolean } | null)?.settling);
  if (round.step === "created") {
    if (!round.run_id) {
      // A round that may still be reviewed leaves the price of that review untouched.
      const reserve = !settling && round.round_no < cycle.policy.stop.max_rounds ? REVIEW_RESERVE_MICRO_USD : 0;
      if (remaining - reserve < 50_000) { await finishSignalListeningCycleV1(database, cycle, { status: "failed", error_code: "listening_cycle_cap_reached" }); return "done"; }
      await requestSignalListeningRoundRunV1(database, cycle, round, remaining - reserve);
      return "waiting";
    }
    const run = await settleSignalListeningRoundRunV1(database, cycle, round);
    if (run.status === "completed") return "continue";
    if (run.status === "queued" || run.status === "running") return "waiting";
    await finishSignalListeningCycleV1(database, cycle, { status: "failed", error_code: `listening_round_run_${run.status}` });
    return "done";
  }
  if (round.step === "asked") {
    // What the classifier chose for the pairs of this round becomes membership before anything is counted.
    await measureSignalListeningRoundV1(database, cycle, round, await settleSignalListeningPairChoicesV1(database, cycle, round));
    return "continue";
  }
  // What people corrected while the loop ran is locked before the rules or the review decide on this round.
  if (round.step === "measured" || round.step === "regrouped") round.catalog = await lockSignalListeningEditedTopicsV1(database, cycle, round);
  if (round.step === "measured") {
    if (settling) {
      // The choices of this last pass can show that two topics are one. Their merge is recorded with the round and
      // applied where the map is read, so the published map does not carry them as two.
      const closing = applySignalListeningRuleMergesV1({ catalog: round.catalog, themes: round.themes, policy: cycle.policy, evidence: round.evidence! }).rule_merges;
      if (closing.length) {
        // Added to the merges this map already carried from an earlier loop; a topic is folded once.
        const merges = [...signalListeningCarriedClosingMergesV1(round.review, round.catalog), ...closing.map(item => ({ stays: item.stays, folded: item.folded }))];
        await recordSignalListeningClosingMergesV1(database, cycle, round, merges.filter((item, index) => merges.findIndex(other => other.folded === item.folded) === index));
      }
      const reason = (previous?.review as { settled?: { stop_reason?: string } } | null)?.settled?.stop_reason ?? "max_rounds";
      await finishSignalListeningCycleV1(database, cycle, { status: "completed", stop_reason: reason });
      return "done";
    }
    const decision = decideSignalListeningCycleStopV1({ policy: cycle.policy, current: round.evidence!, previous: previous?.evidence ?? null, map_changed: true });
    if (decision.stop) {
      // The loop ends here. Pairs the classifier found to be one topic are merged now, and the pairs still above the
      // line that it was never asked about go to it as they are worded. One last pass asks what that leaves pending,
      // so the map that is published carries neither two topics that are one nor posts counted in both of a pair.
      const merges = decision.reason === "no_category_population" ? null
        : applySignalListeningRuleMergesV1({ catalog: round.catalog, themes: round.themes, policy: cycle.policy, evidence: round.evidence! });
      if (merges && (merges.rule_merges.length || merges.probation.length) && remaining >= 50_000) {
        if (merges.rule_merges.length) await settleSignalListeningPairChoicesV1(database, cycle, round, merges.rule_merges);
        const confirmed = await readSignalListeningConfirmedCentroidsV1(database, cycle, round, args.heartbeat);
        await openSignalListeningNextRoundV1({ database, cycle, round, catalog: merges.catalog, themes: merges.themes, confirmed, settling: true, pairs: merges.probation,
          review: { ...(round.review ?? {}), settled: { stop_reason: decision.reason, rule_merges: merges.rule_merges, rejected: merges.rejected, pairs_asked: merges.probation.length } } });
        return "continue";
      }
      await finishSignalListeningCycleV1(database, cycle, { status: "completed", stop_reason: decision.reason });
      return "done";
    }
    await saveSignalListeningOrphanGroupsV1(database, round, await regroupListeningOrphansV1(database, cycle, round, args.heartbeat));
    return "continue";
  }
  if (round.step === "regrouped") {
    const groups = round.orphan_groups ?? [];
    type StoredAnswer = { model: string; usage: ListeningReviewUsageV1; cost_micro_usd: number; duration_ms: number; payload_bytes: number; output: unknown };
    let answer = (round.review as { answer?: StoredAnswer } | null)?.answer;
    if (!answer) {
      // The measured round is a valid result on its own: when the budget cannot pay for a review, the cycle ends there.
      if (remaining < REVIEW_RESERVE_MICRO_USD) { await finishSignalListeningCycleV1(database, cycle, { status: "completed", stop_reason: "budget" }); return "done"; }
      if (await beginSignalListeningReviewV1(database, round) > MAX_REVIEW_ATTEMPTS) {
        await finishSignalListeningCycleV1(database, cycle, { status: "failed", error_code: "listening_review_attempts_exhausted" }); return "done";
      }
      const configuration = await readSignalListeningCycleConfigurationV1(database, cycle);
      const payload = buildSignalListeningReviewPayloadV1({ category: configuration.category, question_language: configuration.candidate_language,
        catalog: round.catalog, themes: round.themes, evidence: round.evidence!, policy: cycle.policy,
        orphan_groups: groups.map(({ centroid: _centroid, ...group }) => group) });
      const started = Date.now();
      let reviewed: Awaited<ReturnType<ListeningReviewerV1>>;
      try { reviewed = await args.reviewer({ system: SIGNAL_LISTENING_REVIEW_SYSTEM_V1, payload }); }
      catch (error) {
        // An unusable answer was still billed: the cycle is charged before it stops.
        if (error instanceof ListeningReviewErrorV1 && error.usage) await chargeSignalListeningCycleV1(database, cycle, signalListeningReviewCostMicroUsdV1(error.usage));
        throw error;
      }
      answer = { model: reviewed.model, usage: reviewed.usage, cost_micro_usd: signalListeningReviewCostMicroUsdV1(reviewed.usage),
        duration_ms: Date.now() - started, payload_bytes: Buffer.byteLength(payload), output: reviewed.output };
      // The paid answer is stored and charged before anything is built on it.
      await recordSignalListeningReviewAnswerV1(database, cycle, round, answer, answer.cost_micro_usd);
    }
    const result = applySignalListeningReviewV1({ catalog: round.catalog, themes: round.themes, orphan_groups: groups, output: answer.output,
      rules: { policy: cycle.policy, evidence: round.evidence! } });
    const review = { ...(round.review ?? {}), answer, summary: result.summary, rejected: result.rejected, map_changed: result.map_changed,
      rule_merges: result.rule_merges, probation: result.probation,
      usage: answer.usage, cost_micro_usd: answer.cost_micro_usd, duration_ms: answer.duration_ms, payload_bytes: answer.payload_bytes };
    if (!result.map_changed) {
      // Nothing to ask again: the map keeps its wording and only gains its themes and domains.
      await saveSignalListeningReviewV1(database, cycle, round, review, { catalog: result.catalog, themes: result.themes });
      await finishSignalListeningCycleV1(database, cycle, { status: "completed", stop_reason: "map_unchanged" });
      return "done";
    }
    // A pair the rule merged gives back the decisions it made: its posts belong to the topic that stays.
    if (result.rule_merges.length) await settleSignalListeningPairChoicesV1(database, cycle, round, result.rule_merges);
    const confirmed = await readSignalListeningConfirmedCentroidsV1(database, cycle, round, args.heartbeat);
    await openSignalListeningNextRoundV1({ database, cycle, round, catalog: result.catalog, themes: result.themes, review, confirmed, pairs: result.probation });
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
    let owned = true;
    const heartbeat = async () => { owned = await renewSignalListeningCycleV1(database, cycle) && owned; };
    const beat = setInterval(() => void heartbeat().catch(() => undefined), 60_000); beat.unref?.();
    try {
      for (;;) {
        const outcome = await stepSignalListeningCycleV1({ database, cycle, reviewer, heartbeat });
        if (outcome === "done") { console.log(`[listening-cycle] ${cycle.id} finished`); return; }
        // While JEV answers a round, the cycle is released and looked at again on a later tick.
        if (outcome === "waiting") { await releaseSignalListeningCycleV1(database, cycle); return; }
        await heartbeat();
        // Another worker owns the cycle now: this one stops without touching it.
        if (!owned) { console.warn(`[listening-cycle] ${cycle.id} lease lost`); return; }
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
