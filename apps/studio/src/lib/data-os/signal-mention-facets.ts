import {
  confirmMentionFacetsV1,
  loadMentionFacetsStatusV1,
  requestMentionFacetsV1,
} from "@noisia/db";
import { pool } from "@/lib/db";

export { SignalLabelingError } from "@noisia/db";

type FacetAccess = { workspace_id: string; actor_user_id: string };
type FacetRequest = FacetAccess & {
  idempotency_key: string;
  budget_micro_usd?: number | null;
  cap_micro_usd?: number | null;
  full_recalculation?: boolean;
};

// The DB service revalidates workspace grants and financial authority in its
// transaction. Runtime provider availability is owned by this server boundary.
export function loadMentionFacetsStatusForActorV1(args: FacetAccess) {
  return loadMentionFacetsStatusV1({ ...args, database: pool });
}

export function requestMentionFacetsForActorV1(args: FacetRequest) {
  return requestMentionFacetsV1({
    ...args,
    database: pool,
    provider_available:
      process.env.NOISIA_MENTION_FACETS_ENABLED === "true" &&
      process.env.NOISIA_MENTION_FACETS_PROVIDER_ENABLED === "true",
  });
}

export function confirmMentionFacetsForActorV1(
  args: FacetAccess & { run_id: string; entity_context_digest: string },
) {
  return confirmMentionFacetsV1({ ...args, database: pool });
}
