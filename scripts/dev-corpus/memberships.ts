/** Real-provider demo tick. Root serializes execution on the verified private MFP runner. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { main, openDatabase } from "./guard.mjs";
import {
  loadConceptMembershipsStatusV1,
  requestConceptMembershipsV1,
} from "../../infrastructure/db/signal-concept-memberships";
import {
  runConceptMembershipTickV1,
  createConceptMembershipRuntimeStoreV1,
} from "../../services/workers/src/workers/signal-concept-membership-batch";
import { createAnthropicMessageBatchesClient } from "../../services/workers/src/providers/anthropic-message-batches";
await main(async () => {
  if (
    !process.argv.includes("--real") ||
    process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED !== "true" ||
    process.env.NOISIA_CONCEPT_MEMBERSHIP_PROVIDER_ENABLED !== "true"
  )
    throw new Error("mfp_membership_provider_disabled");
  const identity = JSON.parse(
      await readFile(
        process.env.NOISIA_MFP_IDENTITY_FILE ??
          ".data/dev-corpus/voyage-real/identity.json",
        "utf8",
      ),
    ),
    pool = await openDatabase();
  try {
    const access = {
      database: pool,
      workspace_id: identity.workspace_id,
      actor_user_id: identity.internal_user_id,
    };
    const status = await loadConceptMembershipsStatusV1(access);
    console.log(
      JSON.stringify({
        stage: "membership_estimate",
        estimated_micro_usd: status.estimated_micro_usd,
        population: status.population,
        concepts: status.concepts.length,
      }),
    );
    const given = process.argv.find((a) => a.startsWith("--run-id="))?.slice(9),
      key = process.argv.find((a) => a.startsWith("--key="))?.slice(6);
    const effort = process.argv.find((a) => a.startsWith("--effort="))?.slice(9);
    if (effort && effort !== "low" && effort !== "medium") throw new Error("mfp_membership_effort_invalid");
    if (!given && !key) throw new Error("mfp_membership_key_required");
    const run = given
      ? { run_id: given }
      : await requestConceptMembershipsV1({
          ...access,
          idempotency_key: key!,
          provider_available: true,
          evaluation_effort: effort as "low" | "medium" | undefined,
          full_recalculation: process.argv.includes("--full"),
        });
    const result = await runConceptMembershipTickV1({
      run_id: run.run_id,
      store: createConceptMembershipRuntimeStoreV1(pool),
      provider: createAnthropicMessageBatchesClient({
        apiKey: process.env.ANTHROPIC_API_KEY ?? "",
      }),
    });
    const after = await loadConceptMembershipsStatusV1(access);
    const receipt = {
      stage: "membership_tick",
      ...run,
      ...result,
      counts: after.counts,
      population: after.population,
      run: after.latest,
      semantic_acceptance: false,
    };
    await mkdir(".data/dev-corpus", { recursive: true });
    await writeFile(
      ".data/dev-corpus/membership-receipt.json",
      JSON.stringify(receipt, null, 2),
      { mode: 0o600 },
    );
    console.log(JSON.stringify(receipt));
  } finally {
    await pool.end();
  }
});
