import {
  loadConceptMembershipsStatusV1,
  requestConceptMembershipsV1,
  loadConceptMembershipPreviewV1,
  overrideConceptMembershipsV1,
  selectConceptMembershipV1,
  confirmMentionFacetsV1,
} from "@noisia/db";
import { pool } from "@/lib/db";
export { SignalLabelingError } from "@noisia/db";
const enabled = () => process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED === "true";
const providerAvailable = () =>
  enabled() &&
  process.env.NOISIA_CONCEPT_MEMBERSHIP_PROVIDER_ENABLED === "true";
type WithoutDatabase<T> = Omit<T, "database">;
export async function loadMembershipStatusForActorV1(
  args: WithoutDatabase<Parameters<typeof loadConceptMembershipsStatusV1>[0]>,
) {
  return {
    ...(await loadConceptMembershipsStatusV1({ ...args, database: pool })),
    enabled: enabled(),
    provider_available: providerAvailable(),
  };
}
export function requestMembershipsForActorV1(
  args: Omit<
    Parameters<typeof requestConceptMembershipsV1>[0],
    "database" | "provider_available"
  >,
) {
  return requestConceptMembershipsV1({
    ...args,
    database: pool,
    provider_available: providerAvailable(),
  });
}
export function loadMembershipPreviewForActorV1(
  args: WithoutDatabase<Parameters<typeof loadConceptMembershipPreviewV1>[0]>,
) {
  return loadConceptMembershipPreviewV1({ ...args, database: pool });
}
export function overrideMembershipsForActorV1(
  args: WithoutDatabase<Parameters<typeof overrideConceptMembershipsV1>[0]>,
) {
  return overrideConceptMembershipsV1({ ...args, database: pool });
}
export function selectMembershipForActorV1(
  args: WithoutDatabase<Parameters<typeof selectConceptMembershipV1>[0]>,
) {
  return selectConceptMembershipV1({ ...args, database: pool });
}
export function confirmMembershipsForActorV1(
  args: WithoutDatabase<Parameters<typeof confirmMentionFacetsV1>[0]>,
) {
  return confirmMentionFacetsV1({ ...args, database: pool });
}
