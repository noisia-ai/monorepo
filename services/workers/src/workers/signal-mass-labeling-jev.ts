import { materializeMassLabelingProductMapV2 } from "./signal-mass-labeling-product-map";
import {assertMassJevConsumerV1} from "../providers/mass-labeling-consumer";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMassLabelingStoreV1,
  publishMassLabelingProductResultV2,
  signalWorkspaceFeatureEnabledV1,
  type LabelingRunV1,
} from "@noisia/db";
import {
  buildMassLabelingJevRequestV1,
  buildMassLabelingJevRequestV2,
  mapMassLabelingJevResponseV2,
  massLabelingJevIdentityV2,
  massLabelingConfigurationV2,
  mapMassLabelingJevResponseV1,
  massLabelingJevIdentityV1,
  labelerDigestV1,
  llmPriceV1,
  llmCostMicroUsdV1,
  signalWorkspaceEmbeddingDigestV1 as digest,
  type MassLabelingInputV1,
  type MassLabelingResultV1,
} from "@noisia/query-engine";
import {
  createTypesafeJevClientV1,
  type JevProviderV1,
} from "../providers/typesafe-jev";
import {
  processJevLabelingPageV1,
  jevUsageV1,
} from "./signal-jev-labeling-page";
import { createWorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";
import { readSignalLabelingReceiptV1 } from "./signal-labeling-receipt-storage";

type Store = ReturnType<typeof createMassLabelingStoreV1>;
function priceOf(run: LabelingRunV1) {
  if (
    run.kind !== "mass_labeling" ||
    labelerDigestV1(run.identity) !==
      labelerDigestV1(run.identity.params.request_version === "mass-labeling-jev-v2"
        ? massLabelingJevIdentityV2(massLabelingConfigurationV2(run.identity.params))
        : massLabelingJevIdentityV1())
  )
    throw new Error("mass_labeling_identity_invalid");
  return llmPriceV1(
    "typesafe",
    run.identity.model,
    "sync",
    Number(run.identity.params.input_usd_per_mtok),
  );
}

/** Each root has one frozen fragment and one request. Every completed response
 * is made durable before waiting for unrelated provider requests to finish. */
export function processMassLabelingJevV1(args: {
  run_id: string;
  store: Store;
  provider: JevProviderV1;
  lease_renewal_ms?: number;
  recovery_only?: boolean;
}) {
  return processJevLabelingPageV1<MassLabelingInputV1, MassLabelingResultV1>({
    ...args,
    hooks: {
      price: priceOf,
      propose: (run, inputs) =>
        inputs.map((input) => {
          const request = run.identity.params.request_version === "mass-labeling-jev-v2"
            ? buildMassLabelingJevRequestV2(input, run.context, massLabelingConfigurationV2(run.identity.params), run.identity.model)
            : buildMassLabelingJevRequestV1(input, run.context, run.identity.model);
          const request_digest = digest({
            request_version: run.identity.params.request_version,
            run_id: run.id,
            root_id: input.root_id,
            input_digest: input.input_digest,
            map_digest: input.map_digest,
            entity_context_digest: run.entity_context_digest,
            labeler_digest: run.labeler_digest,
            request,
          });
          return {
            custom_id: `mass_${request_digest.slice(7, 67)}`,
            request_digest,
            request,
            inputs: [input],
            reserved_micro_usd: llmCostMicroUsdV1(
              jevUsageV1({
                input_tokens:
                  Buffer.byteLength(JSON.stringify(request)) * 4 + 8192,
                output_tokens: 0,
              }),
              priceOf(run),
            ),
          };
        }),
      map: (run, call, parsed) => {
        if (call.inputs.length !== 1)
          throw new Error("mass_labeling_input_invalid");
        return [
          run.identity.params.request_version === "mass-labeling-jev-v2"
            ? mapMassLabelingJevResponseV2(call.inputs[0]!, run.context, massLabelingConfigurationV2(run.identity.params), parsed)
            : mapMassLabelingJevResponseV1(call.inputs[0]!, run.context, parsed),
        ];
      },
      error: (run, call, code) =>
        call.inputs.map((input) => ({
          root_id: input.root_id,
          input_digest: input.input_digest,
          entity_context_digest: run.entity_context_digest,
          status: "error" as const,
          error_code: code,
        })),
      labeled: (result) => result.status === "labeled",
      durable_raw_per_response: true,
      recovery_only: args.recovery_only,
    },
  });
}

export function createMassLabelingRuntimeStoreV1(
  database: Parameters<typeof createMassLabelingStoreV1>[0]["database"],
) {
  const storage = createWorkspaceEngineStorageV1();
  return createMassLabelingStoreV1({
    database,
    assertRawReady: async () => {
      await storage.assertReady?.();
    },
    storeRaw: async (args) => {
      const directory = await mkdtemp(join(tmpdir(), "noisia-mass-labeling-"));
      try {
        const file = join(directory, `response-${args.call_id}.json`);
        await writeFile(file, args.raw_text, { mode: 0o600 });
        return (
          await storage.put({
            workspace_id: args.workspace_id,
            execution_id: args.run_id,
            file,
            sha256: args.raw_sha256,
            size_bytes: Buffer.byteLength(args.raw_text),
            media_type: "application/json",
          })
        ).storage_key;
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    loadRaw: async (args) =>
      readSignalLabelingReceiptV1({
        storage,
        workspace_id: args.workspace_id,
        run_id: args.run_id,
        storage_key: args.storage_key,
        raw_sha256: args.raw_sha256,
        size_bytes: args.size_bytes,
      }),
  });
}

export const SIGNAL_MASS_LABELING_JEV_JOB_V1 = "signal-mass-labeling-jev-v1";
let runtimeProvider: JevProviderV1 | undefined;
export async function signalMassLabelingJevJobV1(job: {
  data: { run_id: string };
}) {
  if (
    process.env.NOISIA_MASS_LABELING_ENABLED === "false" ||
    process.env.NOISIA_JEV_PROVIDER_ENABLED === "false"
  )
    throw new Error("mass_labeling_provider_disabled");
  await assertMassJevConsumerV1({api_key:process.env.TYPESAFE_API_KEY??"",
    enabled:process.env.NOISIA_JEV_PROVIDER_ENABLED!=="false"});
  const { pool } = await import("../db/client");
  const run = (
    await pool.query<{ workspace_id: string }>(
      "SELECT workspace_id FROM signal_labeling_runs WHERE id=$1::uuid AND kind='mass_labeling'",
      [job.data.run_id],
    )
  ).rows[0];
  if (
    !run ||
    !(await signalWorkspaceFeatureEnabledV1({
      queryable: pool,
      workspace_id: run.workspace_id,
      feature: "mass_labeling",
    }))
  )
    throw new Error("mass_labeling_not_enabled");
  runtimeProvider ??= createTypesafeJevClientV1({ enabled: process.env.NOISIA_JEV_PROVIDER_ENABLED !== "false" });
  const outcome = await processMassLabelingJevV1({
    run_id: job.data.run_id,
    store: createMassLabelingRuntimeStoreV1(pool),
    provider: runtimeProvider,
  });
  await publishMassLabelingProductResultV2({ database: pool, run_id: job.data.run_id });
  return outcome;
}

export function startMassLabelingJevDrainerV1() {
  let active: Promise<void> | undefined;
  const tick = async () => {
    if (
      process.env.NOISIA_MASS_LABELING_ENABLED === "false" ||
      process.env.NOISIA_JEV_PROVIDER_ENABLED === "false"
    )
      return;
    const { pool } = await import("../db/client");
    if (
      !(
        await pool.query(
          "SELECT to_regclass('signal_mass_labeling_runs') IS NOT NULL ready",
        )
      ).rows[0]?.ready
    )
      return;
    await materializeMassLabelingProductMapV2({ database: pool });
    const runs = (
      await pool.query<{
        id: string;
      }>(`SELECT run.id FROM signal_labeling_runs run
      JOIN signal_labeler_versions labeler ON labeler.id=run.labeler_version_id
      WHERE run.kind='mass_labeling' AND labeler.provider='typesafe' AND run.status IN('queued','running')
        AND NOT run.waiting_full_confirmation AND run.next_poll_at<=now()
        AND (run.lease_until IS NULL OR run.lease_until<now()) ORDER BY run.created_at LIMIT 1`)
    ).rows;
    for (const run of runs)
      await signalMassLabelingJevJobV1({ data: { run_id: run.id } });
  };
  const start = () => {
    if (!active)
      active = tick()
        .catch(() => console.warn("[mass-labeling] page unavailable"))
        .finally(() => {
          active = undefined;
        });
  };
  const timer = setInterval(start, 10_000);
  timer.unref?.();
  start();
  return {
    async close() {
      clearInterval(timer);
      if (active) await active;
    },
  };
}
