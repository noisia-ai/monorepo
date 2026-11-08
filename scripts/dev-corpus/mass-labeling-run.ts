import {provisionMassLabelingScopedPolicyV1} from "../../infrastructure/db/signal-mass-labeling-scoped-policy";
import { readFile } from "node:fs/promises";
import {
  createMassLabelingMapV1,
  provisionMassLabelingPolicyV1,
  requestMassLabelingV1,
  continueMassLabelingV1,
  measureMassLabelingSmokeV1,
  selectMassLabelingTopicsV1,
  exportMassLabelingSnapshotV1,
  loadMassLabelingServingContextV1,
} from "../../infrastructure/db/signal-mass-labeling";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "../../infrastructure/db/signal-workspace-capabilities";
import { massLabelingJevIdentityV1 } from "../../packages/query-engine/src/signal-mass-labeling-jev-v1";

/** Root operates one stage at a time. Identity, paths and receipts stay private
 * on stdin/stdout; the existing MFP target guard supplies the connection. */
async function main() {
  const action = process.argv[2];
  if (
    ![
      "map",
      "policy",
      "policy-scoped",
      "request",
      "step",
      "recover",
      "smoke",
      "continue",
      "select",
      "status",
      "export",
    ].includes(action ?? "")
  )
    throw new Error("mass_run_action_invalid");
  const raw = await readFile("/dev/stdin", "utf8");
  if (Buffer.byteLength(raw) > 16384) throw new Error("mass_run_input_invalid");
  const input = JSON.parse(raw),
    uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
  const fields = [
    "workspace_id",
    "actor_user_id",
    "source_engine_execution_id",
    "assignments_artifact_id",
    "assignments_path",
    "consolidation_artifact_id",
    "consolidation_path",
    "source_checkpoints_path",
    "cap_micro_usd",
    "idempotency_key",
    "map_id",
    "run_id",
    "topic_keys",
    "expected_revision",
  ];
  if (
    !input ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !fields.includes(key)) ||
    !uuid.test(input.workspace_id) ||
    !uuid.test(input.actor_user_id)
  )
    throw new Error("mass_run_input_invalid");
  const { openDatabase } = await import(
    new URL("./guard.mjs", import.meta.url).href
  );
  const database = await openDatabase();
  try {
    const access = {
      database,
      workspace_id: input.workspace_id as string,
      actor_user_id: input.actor_user_id as string,
    };
    const scopedRun = { ...access, run_id: String(input.run_id ?? "") };
    let result: unknown;
    if (action === "map") {
      const consolidation_raw = await readFile(
        String(input.consolidation_path),
        "utf8",
      );
      const consolidation = JSON.parse(consolidation_raw);
      result = await createMassLabelingMapV1({
        ...access,
        source_engine_execution_id: String(input.source_engine_execution_id),
        assignments_artifact_id: String(input.assignments_artifact_id),
        assignments_raw: await readFile(String(input.assignments_path), "utf8"),
        consolidation_artifact_id: String(input.consolidation_artifact_id),
        consolidation_raw,
        source_checkpoints: JSON.parse(
          await readFile(String(input.source_checkpoints_path), "utf8"),
        ),
        catalog: consolidation.output.topics,
      });
    } else if (action === "policy-scoped") {
      result = await provisionMassLabelingScopedPolicyV1({...access,map_id:String(input.map_id),cap_micro_usd:Number(input.cap_micro_usd)});
    } else if (action === "policy") {
      result = await provisionMassLabelingPolicyV1({
        ...access,
        cap_micro_usd: Number(input.cap_micro_usd),
      });
    } else if (action === "request") {
      if (
        process.env.NOISIA_JEV_PROVIDER_ENABLED !== "true" ||
        !process.env.TYPESAFE_API_KEY?.trim()
      )
        throw new Error("mass_run_provider_disabled");
      const response = await fetch("https://api.typesafe.ai/v1/models", {
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}` },
      });
      await response.body?.cancel().catch(() => undefined);
      if (response.status !== 200)
        throw new Error("mass_run_provider_unavailable");
      result = await requestMassLabelingV1({
        ...access,
        map_id: String(input.map_id),
        idempotency_key: String(input.idempotency_key),
        identity: massLabelingJevIdentityV1(),
        provider_available: true,
        cap_micro_usd: Number(input.cap_micro_usd),
      });
    } else if (action === "step" || action === "recover") {
      const {assertMassJevConsumerV1} = await import(new URL("../../services/workers/src/providers/mass-labeling-consumer.ts",import.meta.url).href);
      if(action==="step") await assertMassJevConsumerV1({api_key:process.env.TYPESAFE_API_KEY??"",
        enabled:process.env.NOISIA_JEV_PROVIDER_ENABLED==="true"});
      const { createMassLabelingRuntimeStoreV1, processMassLabelingJevV1 } =
        await import(
          new URL(
            "../../services/workers/src/workers/signal-mass-labeling-jev.ts",
            import.meta.url,
          ).href
        );
      const { createTypesafeJevClientV1 } = await import(
        new URL(
          "../../services/workers/src/providers/typesafe-jev.ts",
          import.meta.url,
        ).href
      );
      const actor = (
        await database.query(
          "SELECT id FROM signal_labeling_runs WHERE id=$1::uuid AND workspace_id=$2::uuid AND actor_user_id=$3::uuid AND kind='mass_labeling'",
          [input.run_id, input.workspace_id, input.actor_user_id],
        )
      ).rows[0];
      if (!actor) throw new Error("mass_run_unavailable");
      result = await processMassLabelingJevV1({
        run_id: input.run_id,
        recovery_only: action === "recover",
        store: createMassLabelingRuntimeStoreV1(database),
        provider: createTypesafeJevClientV1({
          api_key: process.env.TYPESAFE_API_KEY,
          enabled: action === "step",
        }),
      });
    } else if (action === "smoke")
      result = await measureMassLabelingSmokeV1(scopedRun);
    else if (action === "continue")
      result = await continueMassLabelingV1(scopedRun);
    else if (action === "select")
      result = await selectMassLabelingTopicsV1({
        ...access,
        map_id: String(input.map_id),
        expected_revision: Number(input.expected_revision),
        topic_keys: input.topic_keys,
      });
    else if (action === "status") {
      if (
        !(
          await loadSignalWorkspaceCapabilitiesStoreV1({
            queryable: database,
            ...access,
          })
        ).can_view
      )
        throw new Error("mass_run_forbidden");
      result = await loadMassLabelingServingContextV1(
        database,
        access.workspace_id,
      );
    } else
      result = await exportMassLabelingSnapshotV1({
        ...access,
        map_id: String(input.map_id),
      });
    process.stdout.write(JSON.stringify(result) + "\n");
  } finally {
    await database.end();
  }
}
void main().catch((error) => {
  const code =
    error instanceof Error && /^[a-z_]{3,120}$/u.test(error.message)
      ? error.message
      : "mass_run_operation_failed";
  process.stderr.write(JSON.stringify({ error: code }) + "\n");
  process.exitCode = 1;
});
