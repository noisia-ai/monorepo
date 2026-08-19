import { createHash } from "node:crypto";

import type {
  SignalBrandServingModuleKeyV1,
  SignalModuleShadowAuthorityV1
} from "./signal-module-serving-scope";

export type SignalOperationalShadowModuleV1 =
  | "brand_monitoring"
  | "mentions"
  | "topics_narratives";

const SHADOW_AUTHORITY_KEY = "__governed_shadow_authority";
const SHADOW_REQUESTER_KEY = "__shadow_requester_authority";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export type SignalModuleShadowRequesterAuthorityV1 = {
  contract_version: "signal-module-shadow-requester-v1";
  user_id: string;
  organization_id: string | null;
  visibility_class: "internal" | "client";
};

export function signalModuleShadowAuthorityHashV1(
  authority: SignalModuleShadowAuthorityV1
) {
  return `sha256:${createHash("sha256")
    .update(stableJson(authority), "utf8")
    .digest("hex")}`;
}

export function sameSignalModuleShadowAuthorityV1(
  left: SignalModuleShadowAuthorityV1,
  right: SignalModuleShadowAuthorityV1
) {
  return signalModuleShadowAuthorityHashV1(left)
    === signalModuleShadowAuthorityHashV1(right);
}

export function parseSignalModuleShadowAuthorityV1(
  request: Record<string, unknown>
): SignalModuleShadowAuthorityV1 {
  const authority = recordValue(request[SHADOW_AUTHORITY_KEY]);
  const binding = recordValue(authority?.binding);
  const policy = recordValue(authority?.policy);
  const population = recordValue(authority?.population);
  const compilation = recordValue(authority?.compilation);
  const watermark = recordValue(authority?.watermark);
  if (!authority
    || authority.contract_version !== "signal-module-shadow-authority-v1"
    || !isUuid(authority.workspace_id)
    || !isBrandServingModule(authority.module_key)
    || authority.view_key !== "brand"
    || authority.resolution_source !== "governed-binding"
    || !binding
    || !isUuid(binding.id)
    || !isPositiveInteger(binding.version)
    || !policy
    || !isUuid(policy.bundle_id)
    || !isNonEmptyString(policy.key)
    || !isPositiveInteger(policy.version)
    || !isSha256(policy.definition_hash)
    || !population
    || !isUuid(population.id)
    || !isNonEmptyString(population.key)
    || !isPositiveInteger(population.version)
    || !isSha256(population.definition_hash)
    || !isSha256(population.membership_digest)
    || !compilation
    || !isUuid(compilation.id)
    || !isSha256(compilation.plan_hash)
    || compilation.status !== "ready"
    || !watermark
    || !isUuid(watermark.id)
    || !isSha256(watermark.data_hash)
    || !isSha256(watermark.source_hash)
    || !isSha256(watermark.governance_digest)
    || !isTimestamp(watermark.captured_at)
    || (watermark.next_policy_transition_at !== null
      && !isTimestamp(watermark.next_policy_transition_at))) {
    throw new Error("signal_shadow_authority_invalid");
  }
  return authority as unknown as SignalModuleShadowAuthorityV1;
}

export function withSignalModuleShadowAuthorityV1(
  request: Record<string, unknown>,
  authority: SignalModuleShadowAuthorityV1
) {
  return { ...request, [SHADOW_AUTHORITY_KEY]: authority };
}

/**
 * Captures only the authenticated request identity, organization identity and
 * visibility class used for the visible response. The background worker must
 * re-load the user and re-authorize the workspace; this persisted value is a CAS
 * expectation, not an authorization decision.
 */
export function signalModuleShadowRequesterAuthorityV1(input: {
  userId: string;
  organizationId: string | null;
  isInternalUser: boolean;
}): SignalModuleShadowRequesterAuthorityV1 {
  if (!isUuid(input.userId)
    || (input.organizationId !== null && !isUuid(input.organizationId))) {
    throw new Error("signal_shadow_requester_authority_invalid");
  }
  return {
    contract_version: "signal-module-shadow-requester-v1",
    user_id: input.userId,
    organization_id: input.organizationId,
    visibility_class: input.isInternalUser ? "internal" : "client"
  };
}

export function parseSignalModuleShadowRequesterAuthorityV1(
  request: Record<string, unknown>
): SignalModuleShadowRequesterAuthorityV1 {
  const authority = recordValue(request[SHADOW_REQUESTER_KEY]);
  if (!authority
    || authority.contract_version !== "signal-module-shadow-requester-v1"
    || !isUuid(authority.user_id)
    || (authority.organization_id !== null && !isUuid(authority.organization_id))
    || (authority.visibility_class !== "internal"
      && authority.visibility_class !== "client")) {
    throw new Error("signal_shadow_requester_authority_invalid");
  }
  return authority as SignalModuleShadowRequesterAuthorityV1;
}

export function withSignalModuleShadowRequesterAuthorityV1(
  request: Record<string, unknown>,
  authority: SignalModuleShadowRequesterAuthorityV1
) {
  return { ...request, [SHADOW_REQUESTER_KEY]: authority };
}

export function signalServingModuleKeyForShadowV1(
  module: SignalOperationalShadowModuleV1
): SignalBrandServingModuleKeyV1 {
  if (module === "brand_monitoring") return "brand-monitoring";
  if (module === "topics_narratives") return "topics-narratives";
  return "mentions";
}

function isBrandServingModule(value: unknown): value is SignalBrandServingModuleKeyV1 {
  return value === "brand-monitoring"
    || value === "mentions"
    || value === "topics-narratives";
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value) ?? "null";
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
    .join(",")}}`;
}
