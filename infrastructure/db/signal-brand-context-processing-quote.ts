import type { Pool } from "pg";
import { signalSemanticContextProposalDigestV1 as digest } from "@noisia/query-engine";
import { resolveSignalBrandContextAuthorityV1, type SignalBrandContextAuthorityV1 } from "./signal-brand-context-authority";
import { SignalSemanticContextProposalExecutionError, type SignalSemanticContextQueryable } from "./signal-semantic-context-proposal";
import { readSignalProcessingPolicyWithQueryableV1, SignalProcessingPolicyError,
  type SignalProcessingPolicyActionV1, type SignalProcessingPolicyViewV1 } from "./signal-processing-policy";

const actions = ["brand_context_proposal", "topic_prototype_embeddings"] as const;
type Action = typeof actions[number];
export type SignalBrandContextProcessingAvailabilityV1 = Partial<Record<Action, boolean>>;
export type SignalBrandContextProcessingQuoteStatusV1 = "quoted" | "processing_forbidden" | "policy_missing"
  | "policy_expired" | "policy_revoked" | "action_missing" | "action_incompatible" | "action_unavailable"
  | "daily_cap_insufficient" | "budget_date_changed" | "source_required" | "source_stale"
  | "locale_required" | "cache_coverage_required";
export type SignalBrandContextProcessingQuoteV1 = {
  contract_version: "brand-context-processing-quote-v1";
  workspace_id: string;
  can_request_processing: boolean;
  can_start: false;
  blocked_reason: "joint_admission_required";
  /** "quoted" describes the two policy ceilings, never executable readiness or estimated provider cost. */
  quote_status: SignalBrandContextProcessingQuoteStatusV1;
  quote_digest: string | null;
  quoted_at: string;
  quote_expires_at: string | null;
  policy: SignalProcessingPolicyViewV1["policy"];
  budget_date: string | null;
  exposure: SignalProcessingPolicyViewV1["exposure"];
  remaining_micro_usd: string;
  /** Policy ceilings, not estimates or reserved money. Neither cap is silently reduced to the daily balance. */
  maximum_total_micro_usd: string | null;
  actions: Array<Omit<SignalProcessingPolicyActionV1, "action"> & { action: Action }>;
  source: null | { authority_digest: string; brand_os_digest: string; knowledge_digest: string;
    locale_context_digest: string; primary_locale: string; locale_variants: string[]; markets: string[] };
};
type ReadArgs = { queryable: SignalSemanticContextQueryable; workspace_id: string; actor_user_id: string;
  /** Exact action health from the server. Missing means unavailable; this cannot grant authority. */
  action_availability?: SignalBrandContextProcessingAvailabilityV1 };

function sourceStatus(error: unknown): SignalBrandContextProcessingQuoteStatusV1 | null {
  if (!(error instanceof SignalSemanticContextProposalExecutionError)) return null;
  if (error.code === "locale_market_authority_required" && (error.status === 409 || error.status === 422)) return "locale_required";
  if (error.status !== 409) return null;
  if (error.code === "brand_os_snapshot_required") return "source_required";
  if (error.code === "brand_os_snapshot_stale") return "source_stale";
  return null;
}

/** Informational workspace quote only. configuration_digest identifies an immutable policy action;
 * it is NOT a grant, a provider configuration supplied by the browser, or proof of admission.
 *
 * Activation requires migration 0156 and a composed transaction contract: exact policy/source CAS,
 * both actions validated before Claude, then each run + admission + outbox created atomically.
 * It must also prove effective provider configuration against the policy (including the proposal's
 * input-dependent output budget). This reader exposes its digest but cannot certify that future plan.
 * The prototype target/plan only exists after semantic publication. Its future admission cannot
 * be fabricated now. Preserve paid results if that later step needs fresh authority.
 * Existing 0153 internal actor guards and 0155 reserve/send fences remain unchanged.
 * This distinct digest domain is deliberately not accepted by the existing preparation mutator.
 * Call within one READ ONLY transaction; use the public loader when owning the connection. */
export async function readSignalBrandContextProcessingQuoteWithQueryableV1(args: ReadArgs): Promise<SignalBrandContextProcessingQuoteV1> {
  const policy = await readSignalProcessingPolicyWithQueryableV1(args);
  const workspace = (await args.queryable.query<{ organization_id: string; brand_id: string; timezone: string }>(`
    SELECT w.organization_id::text,w.brand_id::text,w.timezone
    FROM signal_workspaces w JOIN brands b ON b.id=w.brand_id AND b.organization_id=w.organization_id
    WHERE w.id=$1::uuid AND w.status='active' AND b.status='active'`, [args.workspace_id])).rows[0];
  if (!workspace) throw new SignalProcessingPolicyError("processing_forbidden", 403);
  let authority: SignalBrandContextAuthorityV1 | null = null;
  let sourceBlocked: SignalBrandContextProcessingQuoteStatusV1 | null = null;
  try {
    authority = await resolveSignalBrandContextAuthorityV1({ queryable: args.queryable,
      workspace: { id: args.workspace_id, organizationId: workspace.organization_id,
        subject: { type: "brand", id: workspace.brand_id }, timezone: workspace.timezone } });
  } catch (error) {
    sourceBlocked = sourceStatus(error);
    if (!sourceBlocked) throw error;
  }
  // PostgreSQL owns the clock and IANA day boundary, including DST. A rollover
  // between the exposure query and this statement cannot produce a usable quote.
  const clock = (await args.queryable.query<{ quoted_at: string; budget_date: string | null; expires_at: string | null }>(`
    WITH quote_clock AS (SELECT clock_timestamp() instant)
    SELECT instant::text quoted_at,
      CASE WHEN $1::text IS NOT NULL THEN (instant AT TIME ZONE $1)::date::text END budget_date,
      CASE WHEN $1::text IS NOT NULL THEN LEAST(instant+interval '5 minutes',$2::timestamptz,
        (((instant AT TIME ZONE $1)::date+1)::timestamp AT TIME ZONE $1))::text END expires_at
    FROM quote_clock`, [policy.policy?.budget_timezone ?? null, policy.policy?.valid_until ?? null])).rows[0];
  if (!clock) throw new SignalProcessingPolicyError("processing_quote_clock_unavailable");
  const quotedAt = new Date(clock.quoted_at).toISOString();
  const expiresAt = clock.expires_at ? new Date(clock.expires_at).toISOString() : null;
  const selected = actions.flatMap(action => {
    const entry = policy.actions.find(candidate => candidate.action === action);
    return entry ? [{ ...entry, action }] : [];
  });
  const semantic = selected.find(action => action.action === "brand_context_proposal");
  const prototype = selected.find(action => action.action === "topic_prototype_embeddings");
  const compatible = semantic?.kind === "provider" && semantic.provider === "anthropic" && semantic.model === "claude-sonnet-4-6"
    && prototype?.kind === "provider" && prototype.provider === "voyage" && prototype.model === "voyage-4-large"
    && selected.every(action => /^sha256:[0-9a-f]{64}$/u.test(action.configuration_digest)
      && /^(0|[1-9][0-9]{0,14})$/u.test(action.max_execution_micro_usd))
    && BigInt(semantic.max_execution_micro_usd) > 0n;
  const maximum = compatible ? BigInt(semantic.max_execution_micro_usd) + BigInt(prototype.max_execution_micro_usd) : null;
  let status: SignalBrandContextProcessingQuoteStatusV1;
  if (!policy.can_request_processing) status = "processing_forbidden";
  else if (!policy.policy) status = "policy_missing";
  else if (policy.status === "revoked") status = "policy_revoked";
  else if (policy.status === "expired" || Date.parse(policy.policy.valid_from) > Date.parse(quotedAt)
    || Date.parse(policy.policy.valid_until) <= Date.parse(quotedAt)) status = "policy_expired";
  else if (policy.budget_date !== clock.budget_date) status = "budget_date_changed";
  else if (sourceBlocked) status = sourceBlocked;
  else if (!semantic || !prototype) status = "action_missing";
  else if (!compatible) status = "action_incompatible";
  else if (maximum! > BigInt(policy.remaining_micro_usd)) status = "daily_cap_insufficient";
  else if (prototype.max_execution_micro_usd === "0") status = "cache_coverage_required";
  else if (selected.some(action => !action.available)) status = "action_unavailable";
  else status = "quoted";
  const result: SignalBrandContextProcessingQuoteV1 = {
    contract_version: "brand-context-processing-quote-v1", workspace_id: args.workspace_id.toLowerCase(),
    can_request_processing: policy.can_request_processing, can_start: false, blocked_reason: "joint_admission_required",
    quote_status: status, quote_digest: null, quoted_at: quotedAt, quote_expires_at: status === "quoted" ? expiresAt : null,
    policy: policy.policy, budget_date: policy.budget_date, exposure: policy.exposure, remaining_micro_usd: policy.remaining_micro_usd,
    maximum_total_micro_usd: maximum?.toString() ?? null, actions: selected,
    source: authority ? { authority_digest: authority.sourceAuthorityDigest, brand_os_digest: authority.brandOsDigest,
      knowledge_digest: authority.knowledgeDigest, locale_context_digest: authority.localeContextDigest,
      primary_locale: authority.primaryLocale, locale_variants: authority.localeVariants, markets: authority.markets } : null,
  };
  if (status === "quoted") result.quote_digest = digest({ actor_user_id: args.actor_user_id.toLowerCase(),
    organization_id: workspace.organization_id, ...result });
  return result;
}

/** No environment lookup or default database: the server must supply the connection and exact action health. */
export async function loadSignalBrandContextProcessingQuoteV1(args: Omit<ReadArgs, "queryable"> & {
  database: Pick<Pool, "connect">;
}): Promise<SignalBrandContextProcessingQuoteV1> {
  const client = await args.database.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await readSignalBrandContextProcessingQuoteWithQueryableV1({ ...args, queryable: client });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
