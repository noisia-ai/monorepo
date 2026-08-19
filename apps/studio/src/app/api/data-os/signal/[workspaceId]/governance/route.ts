import { z } from "zod";

import { loadSignalWorkspaceContextForManagement } from "@/app/api/data-os/_lib/load";
import {
  executeSignalGovernanceControlCommandInTransactionV1,
  loadSignalGovernancePreparationForWorkspaceV1,
  type SignalGovernanceControlCommandV1
} from "@/lib/data-os/signal-governance-control-plane";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nullableTimestamp = z.string().datetime({ offset: true }).nullable().default(null);
const usagePurpose = z.enum([
  "internal-qa",
  "client-derived-metrics",
  "client-mention-list",
  "client-text-or-excerpt",
  "llm-processing",
  "strategic-analysis"
]);
const commandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create-quality-draft"),
    min_quality_score: z.number().int().min(0).max(100).nullable(),
    required_quality_flags: z.array(z.string().min(1).max(120)).max(40).default([]),
    forbidden_quality_flags: z.array(z.string().min(1).max(120)).max(40).default([]),
    canonical_root_disposition: z.enum(["evaluate", "blocked", "not_available"]),
    effective_from: nullableTimestamp,
    effective_to: nullableTimestamp
  }).strict(),
  z.object({
    action: z.literal("create-retention-draft"),
    retention_state: z.enum(["allowed", "blocked", "not_available"]),
    retention_mode: z.enum(["indefinite", "until", "not_available"]),
    retain_until: nullableTimestamp,
    expiry_action: z.enum(["block_use", "review_required", "not_available"]),
    approval_evidence: z.string().min(8).max(1000).nullable(),
    effective_from: nullableTimestamp,
    effective_to: nullableTimestamp
  }).strict(),
  z.object({
    action: z.literal("create-licensing-draft"),
    usages: z.array(z.object({
      usage_purpose: usagePurpose,
      decision: z.enum(["allowed", "prohibited", "not_available"])
    }).strict()).length(6),
    approval_evidence: z.string().min(8).max(1000).nullable(),
    effective_from: nullableTimestamp,
    effective_to: nullableTimestamp
  }).strict(),
  z.object({
    action: z.literal("activate-policy"),
    policy_kind: z.enum(["quality-policy", "retention-policy", "licensing-policy"]),
    policy_version: z.number().int().positive()
  }).strict(),
  z.object({
    action: z.literal("create-provenance-binding-draft"),
    source_id: z.string().uuid(),
    import_batch_id: z.string().uuid().nullable(),
    effective_from: nullableTimestamp,
    effective_to: nullableTimestamp
  }).strict(),
  z.object({
    action: z.literal("activate-provenance-binding"),
    source_id: z.string().uuid(),
    import_batch_id: z.string().uuid().nullable(),
    binding_version: z.number().int().positive()
  }).strict(),
  z.object({
    action: z.literal("upsert-identity"),
    entity_type: z.enum(["category", "reference"]),
    canonical_name: z.string().trim().min(2).max(240),
    external_id: z.string().trim().min(1).max(240).nullable()
  }).strict(),
  z.object({
    action: z.literal("update-timezone"),
    timezone: z.string().trim().min(1).max(120)
  }).strict(),
  z.object({ action: z.literal("reconcile-brand-os") }).strict()
]);

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  if (loaded.session.appUser.userType !== "noisia_internal") return forbiddenGovernance();

  const preparation = await loadSignalGovernancePreparationForWorkspaceV1(loaded.workspace);
  return Response.json(preparation, {
    headers: { "Cache-Control": "private, no-store" }
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await context.params;
  const loaded = await loadSignalWorkspaceContextForManagement(workspaceId);
  if ("response" in loaded) return loaded.response;
  if (loaded.session.appUser.userType !== "noisia_internal") return forbiddenGovernance();

  const key = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (key.length < 8 || key.length > 500) {
    return Response.json({
      error: "idempotency_key_required",
      message: "Idempotency-Key must be between 8 and 500 characters."
    }, { status: 400 });
  }
  const parsed = commandSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({
      error: "invalid_governance_command",
      message: "The governance command is invalid.",
      details: parsed.error.flatten()
    }, { status: 422 });
  }

  try {
    const result = await executeSignalGovernanceControlCommandInTransactionV1({
      workspace: loaded.workspace,
      actor: loaded.session.appUser,
      idempotencyKey: key,
      command: parsed.data as SignalGovernanceControlCommandV1
    });
    return Response.json({
      contract_version: "signal-governance-control-plane-v1",
      result: operatorSafeResult(parsed.data as SignalGovernanceControlCommandV1,result)
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (isContractError(error)) {
      return Response.json({
        error: "governance_command_rejected",
        message: "The governance command could not be applied to the current workspace state."
      }, { status: 409 });
    }
    throw error;
  }
}

function operatorSafeResult(command: SignalGovernanceControlCommandV1,result: unknown) {
  const value = result && typeof result === "object"
    ? result as Record<string,unknown> : {};
  if (command.action.startsWith("create-") && command.action!=="create-provenance-binding-draft") {
    return {
      action: command.action,
      created: value.created === true,
      status: typeof value.status === "string" ? value.status : "draft",
      policy_version: "policy_version" in command ? command.policy_version : undefined
    };
  }
  if (command.action==="create-provenance-binding-draft") {
    return { action: command.action,created: value.created===true,status: "draft" };
  }
  if (command.action==="activate-policy" || command.action==="activate-provenance-binding") {
    return { action: command.action,status: "active" };
  }
  if (command.action==="upsert-identity") {
    return { action: command.action,created: value.created===true };
  }
  if (command.action==="update-timezone") {
    return { action: command.action,changed: value.changed===true,timezone: value.timezone };
  }
  return { action: command.action,created: value.created===true,version: value.version };
}

function forbiddenGovernance() {
  return Response.json({
    error: "forbidden",
    message: "Data governance decisions require an internal operator."
  }, { status: 403 });
}

function isContractError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /governance|policy|binding|retention|licensing|quality|authority|workspace|identity|timezone|evidence|idempotency/iu
    .test(error.message);
}
