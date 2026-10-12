/** Guarded MFP operator wrapper. The product API owns policy authority and transition. */
import { switchMfpMentionFacetsProviderV1 } from "../../infrastructure/db/signal-labeling-policy-action-switch";
import { main, openDatabase } from "../dev-corpus/guard.mjs";
import { loadMfpEvalIdentity } from "../eval/fixture-identity";

void main(async () => {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--execute" && !/^--provider=(anthropic|typesafe)$/u.test(arg))
    || args.filter(arg => arg.startsWith("--provider=")).length > 1) throw new Error("mfp_jev_policy_arguments_invalid");
  const provider = (args.find(arg => arg.startsWith("--provider="))?.slice(11) ?? "typesafe") as "anthropic" | "typesafe";
  const identity = await loadMfpEvalIdentity();
  const pool = await openDatabase();
  try {
    const receipt = await switchMfpMentionFacetsProviderV1({ database: pool,
      fixture_key: identity.fixture_key, workspace_id: identity.workspace_id, organization_id: identity.organization_id,
      actor_user_id: identity.internal_user_id, provider, execute: args.includes("--execute") });
    console.log(JSON.stringify(receipt));
    if (args.includes("--execute") && receipt.status === "blocked") throw new Error("mfp_jev_policy_work_active");
  } finally { await pool.end(); }
});
