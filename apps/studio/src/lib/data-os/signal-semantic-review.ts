import {
  createManualSignalSemanticAssertionV1,
  generateSignalSemanticCandidatesV1,
  inspectSignalSemanticReviewInvariantsV1,
  listSignalSemanticAssertionHistoryV1,
  loadSignalSemanticReviewQueueV1,
  reviewSignalSemanticAssertionV1,
  SignalSemanticReviewContractError,
  supersedeSignalSemanticAssertionV1,
  type SignalSemanticReviewFiltersV1
} from "@noisia/db";
import type { SignalSemanticScopeV1 } from "@noisia/query-engine";
import type { PoolClient } from "pg";

import { pool } from "@/lib/db";

export { SignalSemanticReviewContractError };

export async function listWorkspaceSemanticReviewQueue(args: {
  workspaceId: string;
  filters: SignalSemanticReviewFiltersV1;
  cursor: string | null;
  limit: number;
}) {
  return loadSignalSemanticReviewQueueV1(pool, {
    workspace_id: args.workspaceId,
    filters: args.filters,
    cursor: args.cursor,
    limit: args.limit
  });
}

export async function generateWorkspaceSemanticCandidates(args: {
  workspaceId: string;
  mode: "dry-run" | "apply";
}) {
  return withTransaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`${args.workspaceId}:signal-semantic-candidate-generation-v1`]
    );
    const before = await inspectSignalSemanticReviewInvariantsV1(client, args.workspaceId);
    const generated = await generateSignalSemanticCandidatesV1(client, {
      workspace_id: args.workspaceId,
      mode: args.mode
    });
    const after = await inspectSignalSemanticReviewInvariantsV1(client, args.workspaceId);
    assertCandidateGenerationInvariants(before, after, generated.created_count);
    if (args.mode === "dry-run") {
      return { ...generated, writes_performed: false, invariants: summarizeInvariantComparison(before, after) };
    }
    return { ...generated, invariants: summarizeInvariantComparison(before, after) };
  });
}

export async function createWorkspaceManualSemanticAssertion(args: {
  workspaceId: string;
  reviewerUserId: string;
  mentionId: string;
  scope: SignalSemanticScopeV1;
  entityId: string | null;
  confidence: number;
  rationale: string;
  idempotencyKey: string;
}) {
  return withTransaction((client) => createManualSignalSemanticAssertionV1(client, {
    workspace_id: args.workspaceId,
    mention_id: args.mentionId,
    reviewer_user_id: args.reviewerUserId,
    scope: args.scope,
    entity_id: args.entityId,
    confidence: args.confidence,
    rationale: args.rationale,
    idempotency_key: args.idempotencyKey
  }));
}

export async function decideWorkspaceSemanticAssertion(args: {
  workspaceId: string;
  reviewerUserId: string;
  assertionId: string;
  decision: "approve" | "reject";
  rationale: string;
  idempotencyKey: string;
}) {
  return withTransaction((client) => reviewSignalSemanticAssertionV1(client, {
    workspace_id: args.workspaceId,
    attribution_id: args.assertionId,
    reviewer_user_id: args.reviewerUserId,
    decision: args.decision,
    rationale: args.rationale,
    idempotency_key: args.idempotencyKey
  }));
}

export async function supersedeWorkspaceSemanticAssertion(args: {
  workspaceId: string;
  reviewerUserId: string;
  assertionId: string;
  scope: SignalSemanticScopeV1;
  entityId: string | null;
  confidence: number;
  rationale: string;
  idempotencyKey: string;
}) {
  return withTransaction((client) => supersedeSignalSemanticAssertionV1(client, {
    workspace_id: args.workspaceId,
    attribution_id: args.assertionId,
    reviewer_user_id: args.reviewerUserId,
    scope: args.scope,
    entity_id: args.entityId,
    confidence: args.confidence,
    rationale: args.rationale,
    idempotency_key: args.idempotencyKey
  }));
}

export function listWorkspaceSemanticAssertionHistory(args: {
  workspaceId: string;
  assertionId: string;
}) {
  return listSignalSemanticAssertionHistoryV1(pool, {
    workspace_id: args.workspaceId,
    attribution_id: args.assertionId
  });
}

async function withTransaction<T>(operation: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;
    const result = await operation(client);
    if (inTransaction) {
      await client.query("COMMIT");
      inTransaction = false;
    }
    return result;
  } catch (error) {
    if (inTransaction) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

type InvariantState = Awaited<ReturnType<typeof inspectSignalSemanticReviewInvariantsV1>>;

function assertCandidateGenerationInvariants(
  before: InvariantState,
  after: InvariantState,
  createdCount: number
) {
  const unchanged: Array<keyof InvariantState> = [
    "v1_definition_digest",
    "v1_pointer_digest",
    "v1_membership_count",
    "v1_membership_digest",
    "v1_active_membership_count",
    "v1_active_membership_digest",
    "source_intent_count",
    "source_intent_digest",
    "approved_semantic_count",
    "review_event_count",
    "v2_definition_count",
    "v2_pointer_count",
    "v2_membership_count",
    "included_root_count",
    "candidate_digest"
  ];
  for (const key of unchanged) {
    if (before[key] !== after[key]) {
      throw new SignalSemanticReviewContractError(
        "forbidden_state",
        `Candidate generation changed protected state: ${String(key)}.`
      );
    }
  }
  if (after.semantic_assertion_count !== before.semantic_assertion_count + createdCount) {
    throw new SignalSemanticReviewContractError(
      "forbidden_state",
      "Candidate generation semantic assertion count does not reconcile."
    );
  }
}

function summarizeInvariantComparison(before: InvariantState, after: InvariantState) {
  return {
    v1_definition_unchanged: before.v1_definition_digest === after.v1_definition_digest,
    v1_pointer_unchanged: before.v1_pointer_digest === after.v1_pointer_digest,
    v1_memberships_unchanged: before.v1_membership_digest === after.v1_membership_digest,
    v1_active_memberships_unchanged:
      before.v1_active_membership_digest === after.v1_active_membership_digest,
    source_intent_unchanged: before.source_intent_digest === after.source_intent_digest,
    v2_pointer_count: after.v2_pointer_count,
    v2_membership_count: after.v2_membership_count,
    approved_semantic_count: after.approved_semantic_count,
    review_event_count: after.review_event_count
  };
}
