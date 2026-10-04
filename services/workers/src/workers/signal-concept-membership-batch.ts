import { createHash } from "node:crypto";
import type { Job } from "bullmq";
import {
  groupMembershipInputsV1,
  buildMembershipRequestV1,
  parseMembershipGroupV1,
  parseAnthropicResponseV1,
  anthropicUsageV1,
  llmPriceV1,
  llmCostMicroUsdV1,
  signalWorkspaceEmbeddingDigestV1 as digest,
  type MembershipInputV1,
  type MembershipResultV1,
  type LlmUsageV1,
  membershipResultsForV1,
} from "@noisia/query-engine";
import {
  createConceptMembershipStoreV1,
  type ConceptMembershipStoreV1,
  type LabelingRunV1,
  type MembershipRunV1,
  type LabelingCallV1,
  type LabelingCallProposalV1,
} from "@noisia/db";
import {
  createAnthropicMessageBatchesClient,
  AnthropicBatchTransportError,
  type AnthropicBatchItem,
  type AnthropicBatchRequest,
} from "../providers/anthropic-message-batches";
import { createWorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMfpInFlightPages } from "./signal-labeling-parallelism";
export const SIGNAL_CONCEPT_MEMBERSHIP_JOB_V1 = "signal-concept-membership-v1";
type Provider = ReturnType<typeof createAnthropicMessageBatchesClient>;
const zeroUsage = (): LlmUsageV1 => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_creation: {
    ephemeral_5m_input_tokens: 0,
    ephemeral_1h_input_tokens: 0,
  },
});
export function membershipCallProposalV1(
  run: LabelingRunV1,
  inputs: MembershipInputV1[],
  retryDepth = 0,
  parent: string | null = null,
): LabelingCallProposalV1<MembershipInputV1> {
  const request = buildMembershipRequestV1(
      inputs,
      run.context,
      (run as MembershipRunV1).membership_snapshot.concepts,
      run.identity,
    ),
    request_digest = digest({
      run_id: run.id,
      inputs: inputs.map((r) => ({
        root_id: r.root_id,
        root_fingerprint: r.root_fingerprint,
        entity_context_digest: r.entity_context_digest,
        effective_entities_digest: r.effective_entities_digest,
        evaluated_concepts: r.evaluated_concepts.map((c) => [
          c.concept_key,
          c.definition_digest,
        ]),
      })),
      request,
      parent,
      retryDepth,
    });
  const tokens = Math.ceil(JSON.stringify(request).length / 3.5);
  // Reservation is accounted exposure, not a strict cap. Settlement uses actual cache usage.
  const reserved = Math.ceil(tokens * 2 + request.max_tokens * 5);
  return {
    custom_id: `cm1_${request_digest.slice(7, 67)}`,
    request_digest,
    request,
    inputs,
    reserved_micro_usd: reserved,
    retry_depth: retryDepth,
  };
}
function resultsFor(
  call: LabelingCallV1<MembershipInputV1>,
  _run: LabelingRunV1,
  status: "error" | "refused",
  error_code?: string,
  refusal_category?: string,
) {
  return membershipResultsForV1(
    call.inputs,
    status,
    error_code,
    refusal_category,
  );
}
/** One leased page tick. Every transport is at most once; persisted receipts replay independently of provider authority. */
export async function runConceptMembershipTickV1(args: {
  run_id: string;
  store: ConceptMembershipStoreV1;
  provider: Provider;
}) {
  const { store, provider } = args,
    run = await store.claim(args.run_id);
  if (!run) return { status: "not_claimed" };
  try {
    let calls = await store.calls(run);
    if (calls.some((c) => c.status === "unknown") && !run.error_code) {
      await store.fail(run, "labeling_outcome_unknown");
      run.error_code = "labeling_outcome_unknown";
      calls = await store.calls(run);
    }
    if (!run.error_code && !calls.some((c) =>
      ["reserved", "submitting", "submitted"].includes(c.status))) {
      for (let page = 0; page < readMfpInFlightPages(); page++) {
        const inputs = await store.inputs(run);
        if (!inputs.length) break;
        await store.reserve(run, groupMembershipInputsV1(inputs).map((group) =>
          membershipCallProposalV1(run, group)));
      }
      calls = await store.calls(run);
    }
    const reserved = run.error_code
      ? []
      : calls.filter((c) => c.status === "reserved");
    if (reserved.length) {
      await store.markSubmitting(run, reserved);
      try {
        const batch = await provider.create(
          reserved.map(
            (c) =>
              ({
                custom_id: c.custom_id,
                params: c.request,
              }) as AnthropicBatchRequest,
          ),
        );
        await store.markSubmitted(run, reserved, batch.id);
      } catch (error) {
        await store.markFailed(
          run,
          reserved,
          !(
            error instanceof AnthropicBatchTransportError &&
            error.submission === "not_submitted"
          ),
        );
        throw error;
      }
    }
    calls = await store.calls(run);
    const batches = [
      ...new Set(
        calls
          .filter(
            (c) =>
              c.status === "submitted" && c.provider_batch_id && !c.raw_body,
          )
          .map((c) => c.provider_batch_id!),
      ),
    ];
    for (const id of batches) {
      const batch = await provider.get(id);
      if (batch.processing_status !== "ended") continue;
      const pages: Array<{
        call: LabelingCallV1<MembershipInputV1>;
        raw: string;
      }> = [];
      for await (const result of provider.results(batch)) {
        const call = calls.find(
          (c) =>
            c.provider_batch_id === id && c.custom_id === result.item.custom_id,
        );
        if (!call) throw new Error("labeling_unknown_custom_id");
        if (!call.raw_body) pages.push({ call, raw: result.rawText });
      }
      if (pages.length) await store.persistRawPage(run, pages);
      const missing = calls.filter(
        (c) =>
          c.provider_batch_id === id &&
          c.status === "submitted" &&
          !c.raw_body &&
          !pages.some((p) => p.call.id === c.id),
      );
      if (missing.length) {
        await store.markFailed(run, missing, true);
        await store.apply(
          run,
          missing.map((call) => ({
            call,
            results: resultsFor(call, run, "error", "provider_result_missing"),
          })),
        );
        await store.fail(run, "labeling_outcome_unknown");
        run.error_code = "labeling_outcome_unknown";
      }
    }
    calls = await store.calls(run);
    const apply: Array<{
        call: LabelingCallV1<MembershipInputV1>;
        results: MembershipResultV1[];
      }> = [],
      settle: Array<{
        call: LabelingCallV1<MembershipInputV1>;
        usage: LlmUsageV1;
        settled_micro_usd: number;
        stop_reason: string | null;
        refusal_category?: string;
      }> = [];
    const retry: LabelingCallProposalV1<MembershipInputV1>[] = [];
    for (const call of calls.filter((c) => c.raw_body && !c.results_applied)) {
      const raw = JSON.parse(call.raw_body!) as AnthropicBatchItem;
      if (raw.custom_id !== call.custom_id)
        throw new Error("labeling_receipt_identity_invalid");
      if (raw.result.type !== "succeeded") {
        settle.push({
          call,
          usage: zeroUsage(),
          settled_micro_usd: 0,
          stop_reason: raw.result.type,
        });
        apply.push({
          call,
          results: resultsFor(
            call,
            run,
            "error",
            `provider_${raw.result.type}`,
          ),
        });
        continue;
      }
      let usage: LlmUsageV1;
      try {
        usage = anthropicUsageV1(raw.result.message);
      } catch {
        await store.markFailed(run, [call], true);
        apply.push({
          call,
          results: resultsFor(call, run, "error", "provider_usage_invalid"),
        });
        continue;
      }
      const parsed = parseAnthropicResponseV1(raw.result.message);
      settle.push({
        call,
        usage,
        settled_micro_usd: llmCostMicroUsdV1(
          usage,
          llmPriceV1("anthropic", run.identity.model, "batch"),
        ),
        stop_reason: parsed.stop_reason,
        refusal_category: parsed.refusal_category,
      });
      if (parsed.status === "refused") {
        apply.push({
          call,
          results: resultsFor(
            call,
            run,
            "refused",
            undefined,
            parsed.refusal_category,
          ),
        });
        continue;
      }
      if (parsed.status === "error") {
        apply.push({
          call,
          results: resultsFor(call, run, "error", parsed.error_code),
        });
        continue;
      }
      const group =
        parsed.status === "split"
          ? { split: true, results: [] }
          : parseMembershipGroupV1(parsed.text!, call.inputs);
      if (group.split) {
        if (run.error_code) {
          apply.push({
            call,
            results: resultsFor(call, run, "error", "retry_requires_authority"),
          });
        } else if (call.inputs.length > 1 && call.retry_depth < 8) {
          const half = Math.ceil(call.inputs.length / 2);
          for (const split of [
            call.inputs.slice(0, half),
            call.inputs.slice(half),
          ])
            retry.push(
              membershipCallProposalV1(
                run,
                split,
                call.retry_depth + 1,
                call.id,
              ),
            );
          apply.push({ call, results: [] });
        } else
          apply.push({
            call,
            results: resultsFor(call, run, "error", "incomplete_single_root"),
          });
      } else {
        for (const ordinal of group.retry_ordinals ?? []) {
          if (run.error_code || call.retry_depth >= 8) {
            group.results.push(...resultsFor(
              {...call, inputs: [call.inputs[ordinal]!]}, run, "error",
              run.error_code ? "retry_requires_authority" : "incomplete_single_root",
            ));
          } else {
            retry.push(membershipCallProposalV1(
              run, [call.inputs[ordinal]!], call.retry_depth + 1, call.id,
            ));
          }
        }
        apply.push({ call, results: group.results });
      }
    }
    if (settle.length) await store.settlePage(run, settle);
    // Reserve children before marking parent applied: a crash cannot lose the split/retry intent.
    if (retry.length) await store.reserve(run, retry, false);
    if (apply.length) await store.apply(run, apply);
    const failed = calls.filter(
      (c) => c.status === "failed" && !c.results_applied,
    );
    if (failed.length)
      await store.apply(
        run,
        failed.map((call) => ({
          call,
          results: resultsFor(call, run, "error", "definitely_not_sent"),
        })),
      );
    return { status: await store.finish(run) };
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (
      /^labeling_(concepts_changed|context_changed|preparation_changed|policy_changed|forbidden|cap_exhausted|daily_cap_exhausted)$/u.test(
        code,
      )
    )
      await store.fail(run, code);
    throw error;
  } finally {
    await store.release(run);
  }
}
export function createConceptMembershipRuntimeStoreV1(
  database: Parameters<typeof createConceptMembershipStoreV1>[0]["database"],
) {
  const storage = createWorkspaceEngineStorageV1();
  return createConceptMembershipStoreV1({
    database,
    assertRawReady: async () => {
      await storage.assertReady?.();
    },
    storeRaw: async (args) => {
      const directory = await mkdtemp(join(tmpdir(), "noisia-facets-"));
      try {
        const file = join(directory, `facets-${args.call_id}.json`);
        await writeFile(file, args.raw_text, { mode: 0o600 });
        const stored = await storage.put({
          workspace_id: args.workspace_id,
          execution_id: args.run_id,
          file,
          sha256: args.raw_sha256,
          size_bytes: Buffer.byteLength(args.raw_text),
          media_type: "application/json",
        });
        return stored.storage_key;
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  });
}
export async function signalConceptMembershipJobV1(
  job: Pick<Job, "data">,
  options: { store?: ConceptMembershipStoreV1; provider?: Provider } = {},
) {
  if (
    process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED !== "true" ||
    process.env.NOISIA_CONCEPT_MEMBERSHIP_PROVIDER_ENABLED !== "true"
  )
    throw new Error("labeling_provider_disabled");
  const { pool } = await import("../db/client");
  const store = options.store ?? createConceptMembershipRuntimeStoreV1(pool);
  return runConceptMembershipTickV1({
    run_id: job.data.run_id,
    store,
    provider:
      options.provider ??
      createAnthropicMessageBatchesClient({
        apiKey: process.env.ANTHROPIC_API_KEY ?? "",
      }),
  });
}
export function startConceptMembershipDrainerV1() {
  let running = false;
  const tick = async () => {
    if (
      running ||
      process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED !== "true" ||
      process.env.NOISIA_CONCEPT_MEMBERSHIP_PROVIDER_ENABLED !== "true"
    )
      return;
    running = true;
    try {
      const { pool } = await import("../db/client");
      const exists = (
        await pool.query(
          "SELECT to_regclass('signal_labeling_runs') IS NOT NULL ready",
        )
      ).rows[0]?.ready;
      if (!exists) return;
      const rows = (
        await pool.query(
          `SELECT r.id FROM signal_labeling_runs r JOIN signal_labeler_versions l ON l.id=r.labeler_version_id WHERE r.kind='membership' AND l.provider='anthropic' AND r.status IN('queued','running') AND NOT r.waiting_full_confirmation AND r.next_poll_at<=now() AND (r.lease_until IS NULL OR r.lease_until<now()) ORDER BY r.created_at LIMIT 4`,
        )
      ).rows;
      for (const row of rows)
        await signalConceptMembershipJobV1({ data: { run_id: row.id } }).catch(
          (error) =>
            console.warn("[concept-membership] tick unavailable", {
              name: error instanceof Error ? error.name : "Error",
            }),
        );
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 30000);
  timer.unref();
  void tick();
  return {
    async close() {
      clearInterval(timer);
    },
  };
}
