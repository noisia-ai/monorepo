/** MFP-only route rollback through the product transaction; no provider transport. */
// @ts-expect-error guarded private runner JavaScript
import { main, openDatabase } from "../dev-corpus/guard.mjs";
import { configureHybridMembershipRouteV1, loadHybridMembershipRouteV1 } from "../../infrastructure/db/index";
import { loadMfpEvalIdentity } from "./fixture-identity";

void main(async () => {
  if (!process.argv.includes("--real")) throw new Error("mfp_hybrid_rollback_real_flag_required");
  const execute = process.argv.includes("--execute");
  if (execute && process.env.NOISIA_MFP_HYBRID_ROLLBACK_EXECUTE !== "true")
    throw new Error("mfp_hybrid_rollback_execute_disabled");
  const identity = await loadMfpEvalIdentity();
  const database = await openDatabase();
  try {
    const scope = (await database.query<{slug:string;organization_id:string}>(`
      SELECT organization.slug,workspace.organization_id FROM signal_workspaces workspace
      JOIN organizations organization ON organization.id=workspace.organization_id WHERE workspace.id=$1`,
      [identity.workspace_id])).rows[0];
    if (!scope || scope.organization_id !== identity.organization_id ||
      scope.slug !== `mfp-${identity.fixture_key}`) throw new Error("mfp_hybrid_rollback_fixture_invalid");
    const access = { database, workspace_id: identity.workspace_id, actor_user_id: identity.internal_user_id };
    const before = await loadHybridMembershipRouteV1(access);
    if (!execute || before.route === "standard") {
      console.log(JSON.stringify({ stage: "mfp_hybrid_rollback", status: before.route === "standard" ? "unchanged" : "planned",
        current_route: before.route }));
      return;
    }
    const after = await configureHybridMembershipRouteV1({ ...access, route: "standard", provider_available: false,
      expected_route_digest:before.route_digest,confirm_unresolved_jev:process.argv.includes("--confirm-unresolved-jev") });
    console.log(JSON.stringify({ stage: "mfp_hybrid_rollback", status: "restored", current_route: after.route }));
  } finally {
    await database.end();
  }
});
