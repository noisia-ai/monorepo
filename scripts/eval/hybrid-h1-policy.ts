/** Guarded MFP fixture successor. Default is a rollback-only plan. */
// @ts-expect-error guarded private runner JavaScript
import { main, openDatabase } from "../dev-corpus/guard.mjs";
import { planMfpHybridPolicyV1 } from "../../infrastructure/db/index";
import { loadMfpEvalIdentity } from "./fixture-identity";

void main(async () => {
  const execute = process.argv.includes("--execute");
  if (execute && process.env.NOISIA_MFP_HYBRID_POLICY_EXECUTE !== "true")
    throw new Error("mfp_hybrid_policy_execute_disabled");
  const identity = await loadMfpEvalIdentity();
  const database = await openDatabase();
  try {
    const receipt = await planMfpHybridPolicyV1({
      database, fixture_key: identity.fixture_key, workspace_id: identity.workspace_id,
      organization_id: identity.organization_id, internal_user_id: identity.internal_user_id, execute,
    });
    console.log(JSON.stringify(receipt));
    if (receipt.status === "blocked") process.exitCode = 2;
  } finally {
    await database.end();
  }
});
