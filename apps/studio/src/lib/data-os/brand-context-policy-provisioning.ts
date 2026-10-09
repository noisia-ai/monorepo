import {
  provisionSignalBrandContextPolicyV1,
  type SignalBrandContextPolicyProvisioningV1,
} from "@noisia/db";
import type { SignalWorkspaceUser } from "./signal-workspace";

type ProvisioningState =
  | SignalBrandContextPolicyProvisioningV1
  | {
      contract_version: "brand-context-policy-provisioning-v1";
      status: "unavailable";
    };

/** The brand transaction has already committed. A retry may provision missing setup
 * or a successor policy for an opted-in MFP workspace after active work drains.
 * This server-owned hook never accepts browser money or changes grants. */
export async function provisionBrandContextPolicyAfterCreationV1(
  args: {
    brandId: string;
    workspaceId: string;
    actor: SignalWorkspaceUser;
    enabled: boolean;
  },
  dependencies: {
    database?: Parameters<
      typeof provisionSignalBrandContextPolicyV1
    >[0]["database"];
    provision?: typeof provisionSignalBrandContextPolicyV1;
  } = {},
): Promise<ProvisioningState> {
  if (
    !args.enabled ||
    !["noisia_internal", "client"].includes(args.actor.userType)
  )
    return {
      contract_version: "brand-context-policy-provisioning-v1",
      status: "not_eligible",
    };
  try {
    const database = dependencies.database ?? (await import("@/lib/db")).pool;
    return await (
      dependencies.provision ?? provisionSignalBrandContextPolicyV1
    )({
      database,
      workspace_id: args.workspaceId,
      brand_id: args.brandId,
      initiator_user_id: args.actor.id,
    });
  } catch {
    // Do not leak SQL/configuration or make the committed create appear unsuccessful.
    return {
      contract_version: "brand-context-policy-provisioning-v1",
      status: "unavailable",
    };
  }
}
