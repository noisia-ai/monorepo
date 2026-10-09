/** Opt-in provider demo. Never imported by unit suites. Run only through guarded MFP runner. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { main, openDatabase } from "./guard.mjs";
await main(async () => {
  const mode = process.argv.includes("--real") ? "real" : "fake";
  if (
    mode === "real" &&
    (process.env.NOISIA_MENTION_FACETS_ENABLED !== "true" ||
      process.env.NOISIA_MENTION_FACETS_PROVIDER_ENABLED !== "true")
  )
    throw new Error("mfp_facets_provider_disabled");
  const identity = JSON.parse(
      await readFile(".data/dev-corpus/identity.json", "utf8"),
    ),
    pool = await openDatabase();
  try {
    const { provisionSignalLabelingPolicyV1 } = await import(
      "../../infrastructure/db/signal-labeling-policy-provisioning"
    );
    const {
      requestMentionFacetsV1,
      loadMentionFacetsStatusV1,
      createSignalLabelingStoreV1,
    } = await import("../../infrastructure/db/signal-labeling-runs");
    const { inspectFacetContextChangeV1 } = await import(
      "../../infrastructure/db/signal-mention-facets"
    );
    const { labelerDigestV1 } = await import(
      "../../packages/query-engine/src/signal-mention-labeler-v1"
    );
    const { facetLabelerIdentityV1 } = await import(
      "../../packages/query-engine/src/signal-mention-facets-v1"
    );
    const { runMentionFacetsTickV1, createMentionFacetsRuntimeStoreV1 } =
      await import(
        "../../services/workers/src/workers/signal-mention-facets-batch"
      );
    const { createAnthropicMessageBatchesClient } = await import(
      "../../services/workers/src/providers/anthropic-message-batches"
    );
    const access = {
      database: pool,
      workspace_id: identity.workspace_id,
      actor_user_id: identity.internal_user_id,
    };
    await provisionSignalLabelingPolicyV1({
      ...access,
      initiator_user_id: identity.internal_user_id,
      creator_user_id: identity.internal_user_id,
      upgrade_existing: true,
      daily_cap_micro_usd: null,
      cap_micro_usd: null,
    });
    const change = await inspectFacetContextChangeV1(
        pool,
        identity.workspace_id,
      ),
      labeler = facetLabelerIdentityV1();
    if (mode === "fake")
      labeler.params = { ...labeler.params, simulated_transport: true };
    const count = (
      await pool.query(
        "SELECT count(*)::int count FROM signal_mention_facets_current_v1 WHERE workspace_id=$1",
        [identity.workspace_id],
      )
    ).rows[0].count;
    const estimateStatus = await loadMentionFacetsStatusV1({
      ...access,
      identity: labeler,
    });
    console.log(
      JSON.stringify({
        stage: "facets_estimate",
        mode,
        eligible: count,
        estimated_micro_usd: estimateStatus.estimated_micro_usd,
        estimate: estimateStatus.estimate,
        cap_micro_usd: null,
        entity_context_changed: change.changed,
        affected: change.affected.length,
        affected_mode: change.diff.affected_mode,
      }),
    );
    const keyArg = process.argv.find((x) => x.startsWith("--key="))?.slice(6);
    const run = await requestMentionFacetsV1({
      ...access,
      identity: labeler,
      idempotency_key:
        keyArg ??
        `mfp-facets-${mode}-${labelerDigestV1(labeler).slice(7, 23)}-${change.digest.slice(7, 23)}`,
      provider_available: true,
      full_recalculation: process.argv.includes("--full"),
    });
    console.log(JSON.stringify({ stage: "facets_requested", mode, ...run }));
    if (run.waiting_full_confirmation) return;
    const responses = new Map<string, any[]>();
    let sends = 0;
    const fake = {
      async create(requests: any[]) {
        sends += requests.length;
        const id = `msgbatch_fake${sends}`;
        responses.set(
          id,
          requests.map((request) => {
            const body = JSON.parse(request.params.messages[0].content);
            const inputs = Array.isArray(body) ? body : body.roots,
              dim = (value: any) => ({
                value,
                confidence: "low",
                abstained: false,
              });
            return {
              custom_id: request.custom_id,
              result: {
                type: "succeeded",
                message: {
                  stop_reason: "end_turn",
                  usage: { input_tokens: 0, output_tokens: 0 },
                  content: [
                    { type: "thinking", thinking: "" },
                    {
                      type: "text",
                      text: JSON.stringify({
                        roots: Object.fromEntries(
                          inputs.map((_: any, ordinal: number) => [
                            `r${ordinal}`,
                            {
                              entities: dim([]),
                              unrelated_reason: "off_topic",
                              voice: dim("unknown"),
                              act: dim("other"),
                              spam_or_bot: dim(false),
                              language: dim("es"),
                              asunto: dim(null),
                            },
                          ]),
                        ),
                      }),
                    },
                  ],
                },
              },
            };
          }),
        );
        return {
          id,
          processing_status: "ended" as const,
          request_counts: {
            processing: 0,
            succeeded: requests.length,
            errored: 0,
            canceled: 0,
            expired: 0,
          },
          ended_at: new Date().toISOString(),
          results_url: null,
        };
      },
      async get(id: string) {
        return {
          id,
          processing_status: "ended" as const,
          request_counts: {
            processing: 0,
            succeeded: responses.get(id)!.length,
            errored: 0,
            canceled: 0,
            expired: 0,
          },
          ended_at: new Date().toISOString(),
          results_url: null,
        };
      },
      async cancel() {
        throw new Error("unsupported");
      },
      async *results(batch: any) {
        for (const item of responses.get(batch.id) ?? [])
          yield { item, rawText: JSON.stringify(item) };
      },
    };
    const store =
      mode === "real"
        ? createMentionFacetsRuntimeStoreV1(pool)
        : createSignalLabelingStoreV1({
            database: pool,
            storeRaw: async (args) => {
              await mkdir(".data/dev-corpus/facet-mock-receipts", {
                recursive: true,
                mode: 0o700,
              });
              const key = `.data/dev-corpus/facet-mock-receipts/${args.call_id}.json`;
              await writeFile(key, args.raw_text, { mode: 0o600 });
              return key;
            },
            loadRaw: async (args) => readFile(args.storage_key, "utf8"),
          });
    const provider =
      mode === "real"
        ? createAnthropicMessageBatchesClient({
            apiKey: process.env.ANTHROPIC_API_KEY ?? "",
          })
        : fake;
    const started = Date.now();
    let state = "running";
    for (let n = 0; n < 1000 && state === "running"; n++) {
      const result = await runMentionFacetsTickV1({
        run_id: run.run_id,
        store,
        provider,
      });
      state = result.status;
      if (state === "not_claimed") {
        state = (
          await pool.query(
            "SELECT status FROM signal_labeling_runs WHERE id=$1",
            [run.run_id],
          )
        ).rows[0].status;
      }
      if (state === "running" && mode === "real")
        await new Promise((resolve) => setTimeout(resolve, 15000));
      if (mode === "real" && n % 4 === 0)
        console.log(
          JSON.stringify({
            stage: "facets_poll",
            status: state,
            elapsed_seconds: Math.round((Date.now() - started) / 1000),
          }),
        );
    }
    const status = await loadMentionFacetsStatusV1({
      ...access,
      identity: labeler,
    });
    console.log(
      JSON.stringify({
        stage: "facets_result",
        mode,
        status: state,
        elapsed_ms: Date.now() - started,
        simulated_calls: mode === "fake" ? sends : null,
        ...status,
      }),
    );
  } finally {
    await pool.end();
  }
});
