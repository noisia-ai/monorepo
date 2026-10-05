import type { FacetInput } from "@noisia/query-engine";
import type { LabelingCallV1, LabelingRunV1 } from "@noisia/db";
import type { createAnthropicMessageBatchesClient } from "../providers/anthropic-message-batches";

type Provider = Pick<ReturnType<typeof createAnthropicMessageBatchesClient>, "get" | "list" | "results">;
type Store<Input extends FacetInput> = {
  recoverUnknownBatch(run: LabelingRunV1, calls: LabelingCallV1<Input>[], batchId: string): Promise<void>;
  releaseUnknown(run: LabelingRunV1, calls: LabelingCallV1<Input>[], reason: string): Promise<void>;
  clearUnknownFailure(run: LabelingRunV1): Promise<void>;
  calls(run: LabelingRunV1): Promise<LabelingCallV1<Input>[]>;
};

const RETENTION_MS = 29 * 24 * 60 * 60 * 1000;
const SETTLEMENT_GRACE_MS = 25 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_PAGES_PER_TICK = 100;
const time = (value: Date | string | null | undefined) => new Date(value ?? "").getTime();

/** Read-only discovery of a lost POST receipt. Never creates a replacement batch. */
export async function reconcileUnknownBatchCallsV1<Input extends FacetInput>(
  run: LabelingRunV1,
  current: LabelingCallV1<Input>[],
  store: Store<Input>,
  provider: Provider,
) {
  // Durable raw is handled by the normal replay path, even after provider retention.
  const unknown = current.filter((call) => call.status === "unknown" && !call.results_applied && !call.raw_body);
  if (!unknown.length) return;
  const now = Date.now();
  const started = (call: LabelingCallV1<Input>) => {
    const callTime=time(call.created_at),runTime=time(run.created_at);
    return Number.isFinite(callTime)?callTime:runTime;
  };
  const unbounded=unknown.filter(call=>!Number.isFinite(started(call)));
  if(unbounded.length)await store.releaseUnknown(run,unbounded,"unresolvable_timestamp");
  const bounded=unknown.filter(call=>!unbounded.includes(call));
  const expired = bounded.filter((call) => now - started(call) >= RETENTION_MS);
  if (expired.length) await store.releaseUnknown(run, expired, "unresolvable_after_window");
  const recoverable = bounded.filter((call) => !expired.includes(call));
  for (const call of recoverable.filter((item) => item.provider_batch_id)) {
    const batch = await provider.get(call.provider_batch_id!);
    if (batch.processing_status !== "ended") continue;
    for await (const { item } of provider.results(batch)) {
      if (item.custom_id === call.custom_id) {
        await store.recoverUnknownBatch(run, [call], batch.id);
        break;
      }
    }
  }
  const withoutId = recoverable.filter((call) => !call.provider_batch_id);
  const eligible = withoutId.filter((call) => {
    const created = started(call);
    const updated = time(call.updated_at);
    const unknownSince = Number.isFinite(updated) && updated>=created ? updated : now;
    return Number.isFinite(created) && Number.isFinite(unknownSince)
      && created <= unknownSince && unknownSince <= now && now - created < RETENTION_MS;
  });
  if (eligible.length) {
    const earliest = Math.min(...eligible.map(started));
    const latestUnknown = Math.max(...eligible.map((call) => Number.isFinite(time(call.updated_at)) ? time(call.updated_at) : now));
    const pending = new Map(eligible.map((call) => [call.custom_id, call]));
    let cursor: string | undefined;
    let covered = false;
    const inProgressDates: number[] = [];
    for (let pageNumber = 0; pageNumber < MAX_PAGES_PER_TICK; pageNumber++) {
      const page = await provider.list(cursor);
      for (const batch of page.data) {
        const created = new Date(batch.created_at!).getTime();
        if (created < earliest - CLOCK_SKEW_MS) { covered = true; break; }
        if (created > latestUnknown + CLOCK_SKEW_MS) continue;
        if (batch.processing_status !== "ended") { inProgressDates.push(created); continue; }
        for await (const { item } of provider.results(batch)) {
          const call = pending.get(item.custom_id);
          if (!call) continue;
          await store.recoverUnknownBatch(run, [call], batch.id);
          pending.delete(item.custom_id);
        }
        if (!pending.size) break;
      }
      if (!pending.size) break;
      if (!page.has_more) covered = true;
      if (covered) break;
      if (!page.last_id || page.last_id === cursor) break;
      cursor = page.last_id;
    }
    // An exhaustive, mature provider ledger with no active batches is evidence
    // that a lost POST was not accepted. Before then the reservation stays held.
    if (covered) {
      const releasable = [...pending.values()].filter((call) =>
        now - (Number.isFinite(time(call.updated_at)) ? time(call.updated_at) : now) >= SETTLEMENT_GRACE_MS
        && !inProgressDates.some((date) => date >= started(call) - CLOCK_SKEW_MS
          && date <= (Number.isFinite(time(call.updated_at)) ? time(call.updated_at) : now) + CLOCK_SKEW_MS));
      if (releasable.length)
        await store.releaseUnknown(run, releasable, "batch_not_found_after_complete_scan");
    }
  }
  if (!(await store.calls(run)).some((call) => call.status === "unknown")) {
    await store.clearUnknownFailure(run);
    if (run.error_code === "labeling_outcome_unknown") run.error_code = null;
  }
}
