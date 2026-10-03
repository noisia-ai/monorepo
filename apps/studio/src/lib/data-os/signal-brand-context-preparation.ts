import {
  advanceSignalBrandContextPreparationsV1,
  ensureSignalBrandContextPreparationV1,
  loadSignalBrandContextPreparationV1,
  quoteSignalBrandContextPreparationV1,
  reconcileSignalBrandContextSourceV1,
  signalBrandContextPreparationRuntimeFromEnvV1,
  signalSemanticContextProposalRuntimeConfigurationFromEnvV1,
  type SignalBrandContextPreparationAdmissionV1,
  type SignalBrandContextPreparationRuntimeV1,
  type SignalBrandContextPreparationV1
} from "@noisia/db";

import { pool } from "@/lib/db";
import { loadSemanticContextProposalRuntimeReadiness } from "@/lib/queue/data-os";
import type { SignalWorkspaceUser } from "@/lib/data-os/signal-workspace";
import { reconcileSignalBrandOsForBrandMutationV1 } from "@/lib/data-os/signal-governance-control-plane";

export type BrandContextPreparationIntentV1 = {
  idempotency_key: string;
  quote_digest?: string;
  confirmation?: "prepare_brand_context_within_shown_cap";
};

export type BrandContextPreparationMutationResultV1 = {
  preparation: SignalBrandContextPreparationV1 | null;
  advancement: Awaited<ReturnType<typeof advanceSignalBrandContextPreparationsV1>>;
  error_code: string | null;
};

export async function loadBrandContextPreparationRuntimeV1(
  env: Record<string, string | undefined> = process.env
): Promise<SignalBrandContextPreparationRuntimeV1> {
  return signalBrandContextPreparationRuntimeFromEnvV1(
    env,
    await loadSemanticContextProposalRuntimeReadiness()
  );
}

export async function quoteBrandContextPreparationForActorV1(actor: SignalWorkspaceUser) {
  return quoteSignalBrandContextPreparationV1({
    actor_user_id: actor.id,
    runtime: await loadBrandContextPreparationRuntimeV1()
  });
}

export async function loadBrandContextPreparationForWorkspaceV1(args: {
  workspaceId: string;
  actor: SignalWorkspaceUser;
  idempotencyKey?: string;
}) {
  return loadSignalBrandContextPreparationV1({
    database: pool,
    workspace_id: args.workspaceId,
    actor_user_id: args.actor.id,
    idempotency_key: args.idempotencyKey
  });
}

export async function ensureBrandContextPreparationForWorkspaceV1(args: {
  workspaceId: string;
  actor: SignalWorkspaceUser;
  preparation: BrandContextPreparationIntentV1;
  reconciliationReason?: "terminal_provider_run";
  expectedGenerationKey?: string;
}) {
  if (args.reconciliationReason && (args.preparation.quote_digest || args.preparation.confirmation)) {
    throw Object.assign(new Error("Terminal recovery cannot authorize provider spend."), {
      code: "brand_context_terminal_recovery_admission_forbidden"
    });
  }
  const runtime = await loadBrandContextPreparationRuntimeV1();
  const admission: SignalBrandContextPreparationAdmissionV1 | undefined =
    args.preparation.quote_digest && args.preparation.confirmation
      ? {
          quote_digest: args.preparation.quote_digest,
          confirmation: args.preparation.confirmation
        }
      : undefined;
  const ensured = await ensureSignalBrandContextPreparationV1({
    database: pool,
    workspace_id: args.workspaceId,
    actor_user_id: args.actor.id,
    idempotency_key: args.preparation.idempotency_key,
    admission,
    runtime,
    reconciliation_reason: args.reconciliationReason,
    expected_generation_key: args.expectedGenerationKey
  });
  const advancement = admission
    ? await advanceSignalBrandContextPreparationsV1({
        database: pool,
        runtime,
        workspace_id: args.workspaceId,
        limit: 1
      })
    : [];
  const loaded = await loadSignalBrandContextPreparationV1({
    database: pool,
    workspace_id: args.workspaceId,
    actor_user_id: args.actor.id,
    idempotency_key: args.preparation.idempotency_key
  });
  return { preparation: loaded.request ?? loaded.current ?? ensured, advancement };
}

/**
 * Brand and Knowledge writes are already committed when this hook runs. A preparation
 * outage must stay visible without turning a successful save into an ambiguous 500.
 */
export async function ensureBrandContextAfterCommittedMutationV1(args: {
  brandId: string;
  actor: SignalWorkspaceUser;
  preparation?: BrandContextPreparationIntentV1;
  fallbackIdempotencyKey: string;
  enabled?: boolean;
}): Promise<BrandContextPreparationMutationResultV1> {
  if (args.enabled === false) {
    return { preparation: null, advancement: [], error_code: null };
  }
  if (args.actor.userType === "client") {
    return reconcileClientBrandContextAfterCommittedMutationV1({ brandId: args.brandId,
      actor: args.actor, idempotencyKey: args.fallbackIdempotencyKey });
  }
  if (args.actor.userType !== "noisia_internal") return {
    preparation: null, advancement: [], error_code: null
  };
  let workspaceId: string | null = null;
  try {
    const lookup = await pool.query<{ workspace_id: string }>(`
      SELECT id::text AS workspace_id
      FROM signal_workspaces
      WHERE brand_id=$1::uuid AND status='active'
    `, [args.brandId]);
    if (lookup.rowCount !== 1) {
      return { preparation: null, advancement: [], error_code: "brand_context_workspace_unavailable" };
    }
    workspaceId = lookup.rows[0]!.workspace_id;
    const preparation = args.preparation ?? { idempotency_key: args.fallbackIdempotencyKey };
    const result = await ensureBrandContextPreparationForWorkspaceV1({
      workspaceId,
      actor: args.actor,
      preparation
    });
    return { ...result, error_code: null };
  } catch (error) {
    const code = error instanceof Error && "code" in error
      ? String((error as Error & { code: unknown }).code)
      : "brand_context_preparation_unavailable";
    if (workspaceId && args.preparation?.quote_digest) {
      try {
        const pending = await ensureBrandContextPreparationForWorkspaceV1({
          workspaceId,
          actor: args.actor,
          preparation: { idempotency_key: args.fallbackIdempotencyKey }
        });
        return { ...pending, error_code: code };
      } catch {
        // The committed Brand/Knowledge mutation remains authoritative. The caller
        // receives the original preparation failure without an ambiguous save retry.
      }
    }
    return { preparation: null, advancement: [], error_code: code };
  }
}

export async function reconcileAndEnsureBrandContextAfterCommittedMutationV1(args: {
  brandId: string;
  actor: SignalWorkspaceUser;
  preparation?: BrandContextPreparationIntentV1;
  fallbackIdempotencyKey: string;
  reconciliationIdempotencyKey: string;
  enabled?: boolean;
}): Promise<BrandContextPreparationMutationResultV1> {
  if (args.enabled === false) {
    return { preparation: null, advancement: [], error_code: null };
  }
  if (args.actor.userType === "client") {
    return reconcileClientBrandContextAfterCommittedMutationV1({ brandId: args.brandId,
      actor: args.actor, idempotencyKey: args.reconciliationIdempotencyKey });
  }
  if (args.actor.userType !== "noisia_internal") return {
    preparation: null, advancement: [], error_code: null
  };
  try {
    await reconcileSignalBrandOsForBrandMutationV1({
      brandId: args.brandId,
      actor: args.actor,
      idempotencyKey: args.reconciliationIdempotencyKey
    });
  } catch (error) {
    const code = error instanceof Error && "code" in error
      ? String((error as Error & { code: unknown }).code)
      : "brand_context_reconciliation_unavailable";
    return { preparation: null, advancement: [], error_code: code };
  }
  return ensureBrandContextAfterCommittedMutationV1(args);
}

async function reconcileClientBrandContextAfterCommittedMutationV1(args: {
  brandId: string;
  actor: SignalWorkspaceUser;
  idempotencyKey: string;
}): Promise<BrandContextPreparationMutationResultV1> {
  let workspaceId: string | null = null;
  try {
    const lookup = await pool.query<{ workspace_id: string }>(`
      SELECT id::text AS workspace_id
      FROM signal_workspaces
      WHERE brand_id=$1::uuid AND status='active'
    `, [args.brandId]);
    if (lookup.rowCount !== 1) return {
      preparation: null, advancement: [], error_code: "brand_context_workspace_unavailable"
    };
    workspaceId = lookup.rows[0]!.workspace_id;
    return reconcileClientBrandContextForWorkspaceV1({ workspaceId,
      actor: args.actor, idempotencyKey: args.idempotencyKey });
  } catch (error) {
    const code = error instanceof Error && "code" in error
      ? String((error as Error & { code: unknown }).code)
      : error instanceof Error && /^(brand_context|processing)_[a-z_]+$/u.test(error.message)
        ? error.message : "brand_context_reconciliation_unavailable";
    return { preparation: null, advancement: [], error_code: code };
  }
}

export async function reconcileClientBrandContextForWorkspaceV1(args: {
  workspaceId: string;
  actor: SignalWorkspaceUser;
  idempotencyKey: string;
}): Promise<BrandContextPreparationMutationResultV1> {
  if (args.actor.userType !== "client") return {
    preparation: null, advancement: [], error_code: "brand_context_reconciliation_forbidden"
  };
  try {
    const head = await pool.query<{ generation_id: string }>(`
      SELECT id::text AS generation_id
      FROM signal_semantic_context_generations
      WHERE workspace_id=$1::uuid
      ORDER BY generation_version DESC
      LIMIT 1
    `, [args.workspaceId]);
    // This free reconciliation seals source lineage, not permission to send. It
    // needs valid server configuration but neither provider credentials nor queue health.
    const configuration = signalSemanticContextProposalRuntimeConfigurationFromEnvV1();
    const reconciliation = await reconcileSignalBrandContextSourceV1({
      database: pool,
      workspace_id: args.workspaceId,
      actor_user_id: args.actor.id,
      idempotency_key: args.idempotencyKey,
      expected_generation_id: head.rows[0]?.generation_id ?? null,
      configuration
    });
    const loaded = await loadSignalBrandContextPreparationV1({
      database: pool,
      workspace_id: args.workspaceId,
      actor_user_id: args.actor.id
    }).catch(() => null);
    return {
      preparation: loaded?.request ?? loaded?.current ?? null,
      advancement: [],
      error_code: reconciliation.state === "awaiting_settlement"
        ? "brand_context_reconciliation_awaiting_settlement" : null
    };
  } catch (error) {
    const code = error instanceof Error && "code" in error
      ? String((error as Error & { code: unknown }).code)
      : error instanceof Error && /^(brand_context|processing)_[a-z_]+$/u.test(error.message)
        ? error.message : "brand_context_reconciliation_unavailable";
    return { preparation: null, advancement: [], error_code: code };
  }
}
