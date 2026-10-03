import { and, eq, sql } from "drizzle-orm";
import { signalGovernanceControlOperations } from "@noisia/db";
import { signalSemanticContextProposalDigestV1 as digest } from "@noisia/query-engine";

import { db } from "@/lib/db";

export type BrandContextDomainMutationActionV1 =
  | "update-brand-context"
  | "update-brand-knowledge"
  | "delete-brand-knowledge";

type DomainMutationTx = Pick<typeof db, "execute" | "insert" | "select" | "update">;

export class BrandContextDomainMutationError extends Error {
  constructor(public readonly code: "idempotency_key_required" | "idempotency_conflict") {
    super(code);
  }
}

export function requireBrandContextDomainMutationKeyV1(
  request: Request,
  preparation: { idempotency_key: string } | undefined
) {
  const key = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,200}$/u.test(key)) {
    throw new BrandContextDomainMutationError("idempotency_key_required");
  }
  if (!preparation || preparation.idempotency_key !== key) {
    throw new BrandContextDomainMutationError("idempotency_conflict");
  }
  return key;
}

export async function beginBrandContextDomainMutationV1<T>(args: {
  tx: DomainMutationTx;
  workspaceId: string;
  actorUserId: string;
  action: BrandContextDomainMutationActionV1;
  idempotencyKey: string;
  input: unknown;
}): Promise<{ key: string; operationId: string; replay: T | null }> {
  const key = digest(`brand-context-domain-mutation-v1\u001f${args.idempotencyKey}`);
  const requestDigest = digest({
    contract_version: "brand-context-domain-mutation-v1",
    workspace_id: args.workspaceId,
    action: args.action,
    input: args.input
  });
  await args.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`brand-context-domain:${args.workspaceId}:${key}`},0))`);
  const [inserted] = await args.tx.insert(signalGovernanceControlOperations).values({
    workspaceId: args.workspaceId,
    actorUserId: args.actorUserId,
    action: args.action,
    requestDigest,
    idempotencyKey: key,
    status: "in_progress"
  }).onConflictDoNothing({
    target: [signalGovernanceControlOperations.workspaceId, signalGovernanceControlOperations.idempotencyKey]
  }).returning({ id: signalGovernanceControlOperations.id });
  const [operation] = await args.tx.select({
    id: signalGovernanceControlOperations.id,
    actorUserId: signalGovernanceControlOperations.actorUserId,
    action: signalGovernanceControlOperations.action,
    requestDigest: signalGovernanceControlOperations.requestDigest,
    status: signalGovernanceControlOperations.status,
    result: signalGovernanceControlOperations.result
  }).from(signalGovernanceControlOperations).where(and(
    eq(signalGovernanceControlOperations.workspaceId, args.workspaceId),
    eq(signalGovernanceControlOperations.idempotencyKey, key)
  )).limit(1);
  if (!operation || operation.actorUserId !== args.actorUserId || operation.action !== args.action
      || operation.requestDigest !== requestDigest) {
    throw new BrandContextDomainMutationError("idempotency_conflict");
  }
  if (operation.status === "completed" && operation.result !== null) {
    return { key, operationId: operation.id, replay: operation.result as T };
  }
  if (!inserted || operation.status !== "in_progress") {
    throw new BrandContextDomainMutationError("idempotency_conflict");
  }
  return { key, operationId: operation.id, replay: null };
}

export async function completeBrandContextDomainMutationV1(args: {
  tx: DomainMutationTx;
  workspaceId: string;
  operationId: string;
  result: unknown;
}) {
  const [completed] = await args.tx.update(signalGovernanceControlOperations).set({
    status: "completed",
    result: args.result,
    completedAt: new Date(),
    updatedAt: new Date()
  }).where(and(
    eq(signalGovernanceControlOperations.id, args.operationId),
    eq(signalGovernanceControlOperations.workspaceId, args.workspaceId),
    eq(signalGovernanceControlOperations.status, "in_progress")
  )).returning({ id: signalGovernanceControlOperations.id });
  if (!completed) throw new BrandContextDomainMutationError("idempotency_conflict");
}
