import { createHash } from "node:crypto";

import type { QueryResult, QueryResultRow } from "pg";

export type SignalMentionGovernanceActionV1 = "include" | "exclude" | "revert" | "send_to_review";

export type SignalMentionGovernanceQueryable = {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
};

export class SignalMentionGovernanceContractError extends Error {
  constructor(
    public readonly code: "invalid_input" | "not_found" | "conflict",
    message: string
  ) {
    super(message);
    this.name = "SignalMentionGovernanceContractError";
  }
}

export async function mutateSignalCanonicalMentionGovernanceV1(
  queryable: SignalMentionGovernanceQueryable,
  args: {
    workspace_id: string;
    mention_id: string;
    actor_user_id: string;
    action: SignalMentionGovernanceActionV1;
    reason: string;
    idempotency_key: string;
  }
) {
  const reason = cleanReason(args.reason);
  const suppliedKey = cleanIdempotencyKey(args.idempotency_key);
  const idempotencyKey = `sha256:${createHash("sha256").update(JSON.stringify({
    operation: "signal-canonical-mention-governance-v1",
    supplied_key: suppliedKey,
    workspace_id: args.workspace_id,
    mention_id: args.mention_id,
    actor_user_id: args.actor_user_id,
    action: args.action,
    reason
  }), "utf8").digest("hex")}`;
  try {
    const result = await queryable.query<{
      event_id: string;
      canonical_mention_id: string;
      action: SignalMentionGovernanceActionV1;
      inclusion_status: "pending" | "included" | "excluded";
      exclusion_reason: string | null;
      was_replayed: boolean;
      changed: boolean;
    }>(`
      SELECT event_id::text, canonical_mention_id::text, action,
        inclusion_status, exclusion_reason, was_replayed, changed
      FROM mutate_signal_canonical_mention_governance(
        $1::uuid, $2::uuid, $3::uuid, $4, $5, $6
      )
    `, [
      args.workspace_id,
      args.mention_id,
      args.actor_user_id,
      args.action,
      reason,
      idempotencyKey
    ]);
    const row = result.rows[0];
    if (!row) throw new SignalMentionGovernanceContractError("not_found", "Canonical mention was not found.");
    return {
      contract_version: "signal-canonical-mention-governance-v1" as const,
      ...row,
      idempotency_key: idempotencyKey,
      population_pointer_changed: false as const
    };
  } catch (error) {
    if (error instanceof SignalMentionGovernanceContractError) throw error;
    if (error instanceof Error && "code" in error) {
      const code = String((error as Error & { code: string }).code);
      if (code === "23514") {
        throw new SignalMentionGovernanceContractError("invalid_input", error.message);
      }
      if (code === "23505") {
        throw new SignalMentionGovernanceContractError("conflict", "Mention governance action conflicted.");
      }
    }
    throw error;
  }
}

function cleanReason(value: string) {
  const cleaned = value.replace(/\s+/gu, " ").trim();
  if (cleaned.length < 3 || cleaned.length > 1_000) {
    throw new SignalMentionGovernanceContractError(
      "invalid_input",
      "Governance reason must be between 3 and 1000 characters."
    );
  }
  return cleaned;
}

function cleanIdempotencyKey(value: string) {
  const cleaned = value.trim();
  if (cleaned.length < 8 || cleaned.length > 500) {
    throw new SignalMentionGovernanceContractError(
      "invalid_input",
      "Idempotency-Key must be between 8 and 500 characters."
    );
  }
  return cleaned;
}
