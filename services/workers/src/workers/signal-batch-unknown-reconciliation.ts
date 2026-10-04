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

/** Read-only discovery of a lost POST receipt. Never creates a replacement batch. */
export async function reconcileUnknownBatchCallsV1<Input extends FacetInput>(
  run: LabelingRunV1,
  current: LabelingCallV1<Input>[],
  store: Store<Input>,
  provider: Provider,
) {
  const unknown = current.filter((call) => call.status === "unknown");
  if (!unknown.length) return;
  for (const call of unknown.filter((item) => item.provider_batch_id)) {
    const batch = await provider.get(call.provider_batch_id!);
    if (batch.processing_status !== "ended") continue;
    for await (const { item } of provider.results(batch)) {
      if (item.custom_id === call.custom_id) {
        await store.recoverUnknownBatch(run, [call], batch.id);
        break;
      }
    }
  }
  const withoutId = unknown.filter((call) => !call.provider_batch_id);
  const now = Date.now();
  const eligible = withoutId.filter((call) => {
    const created = new Date(call.created_at ?? "").getTime();
    const unknownSince = new Date(call.updated_at ?? "").getTime();
    return Number.isFinite(created) && Number.isFinite(unknownSince)
      && created <= unknownSince && unknownSince <= now && now - created < RETENTION_MS;
  });
  if (eligible.length) {
    const earliest = Math.min(...eligible.map((call) => new Date(call.created_at!).getTime()));
    const latestUnknown = Math.max(...eligible.map((call) => new Date(call.updated_at!).getTime()));
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
        now - new Date(call.updated_at!).getTime() >= SETTLEMENT_GRACE_MS
        && !inProgressDates.some((date) => date >= new Date(call.created_at!).getTime() - CLOCK_SKEW_MS
          && date <= new Date(call.updated_at!).getTime() + CLOCK_SKEW_MS));
      if (releasable.length)
        await store.releaseUnknown(run, releasable, "batch_not_found_after_complete_scan");
    }
  }
  if (!(await store.calls(run)).some((call) => call.status === "unknown")) {
    await store.clearUnknownFailure(run);
    if (run.error_code === "labeling_outcome_unknown") run.error_code = null;
  }
}
