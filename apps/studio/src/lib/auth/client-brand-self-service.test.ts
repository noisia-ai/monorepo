import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  resolveSignalWorkspaceCapabilitiesV1,
  signalBrandContextPreparationRuntimeFromEnvV1,
  signalSemanticContextProposalRuntimeConfigurationFromEnvV1
} from "@noisia/db";

import {
  clientBrandContextAccessDecisionV1,
  clientBrandCreationDecisionV1,
  canonicalClientBrandCreateRequestV1,
  canonicalClientBrandUpdateRequestV1
} from "./client-brand-self-service";

const clientAdmin = {
  id: "00000000-0000-4000-8000-000000000001",
  userType: "client",
  primaryRole: "client_admin",
  organizationId: "00000000-0000-4000-8000-000000000002",
  status: "active"
};

test("only an active client admin with a DB organization can start self-service brand creation", () => {
  assert.deepEqual(clientBrandCreationDecisionV1(clientAdmin), {
    allowed: true,
    organizationId: clientAdmin.organizationId,
    accessLevel: "admin"
  });
  for (const actor of [
    { ...clientAdmin, userType: "noisia_internal" },
    { ...clientAdmin, primaryRole: "client_viewer" },
    { ...clientAdmin, primaryRole: "brand_manager" },
    { ...clientAdmin, primaryRole: "client_owner" },
    { ...clientAdmin, organizationId: null },
    { ...clientAdmin, status: "suspended" }
  ]) assert.deepEqual(clientBrandCreationDecisionV1(actor), { allowed: false });
});

test("the new brand creator can request a policy-bound quote without receiving execution or adoption rights", () => {
  const creation = clientBrandCreationDecisionV1(clientAdmin);
  assert.equal(creation.allowed, true);
  if (!creation.allowed) throw new Error("expected creation authority");
  const authority = {
    workspace_status: "active", brand_status: "active", actor_status: clientAdmin.status,
    user_type: clientAdmin.userType, primary_role: clientAdmin.primaryRole,
    same_organization: true, brand_access_level: creation.accessLevel,
    organization_status: "active", brand_same_organization: true
  };
  const capability = resolveSignalWorkspaceCapabilitiesV1(authority);
  assert.equal(capability.can_request_processing, true);
  assert.equal(capability.can_execute_topics, false);
  assert.equal(capability.can_adopt_topics, false);
  for (const changed of [
    { ...authority, brand_access_level: null }, // revoked grant is absent from the live reader
    { ...authority, brand_access_level: "comment" }, // existing grants are not upgraded
    { ...authority, primary_role: "client_viewer" },
    { ...authority, primary_role: "brand_manager" },
    { ...authority, primary_role: "client_owner" },
    { ...authority, actor_status: "suspended" },
    { ...authority, organization_status: "suspended" },
    { ...authority, workspace_status: "archived" },
    { ...authority, brand_status: "archived" },
    { ...authority, same_organization: false },
    { ...authority, brand_same_organization: false }
  ]) assert.equal(resolveSignalWorkspaceCapabilitiesV1(changed).can_request_processing, false);
});

test("Brand OS editing requires an unrevoked writable grant in the actor's current organization", () => {
  const base = {
    actor: clientAdmin,
    brandOrganizationId: clientAdmin.organizationId,
    brandStatus: "active",
    workspaceStatus: "active",
    accessLevel: "comment",
    revokedAt: null
  };
  assert.equal(clientBrandContextAccessDecisionV1(base).allowed, true);
  assert.equal(clientBrandContextAccessDecisionV1({ ...base, accessLevel: "admin" }).allowed, true);
  for (const input of [
    { ...base, accessLevel: "read" },
    { ...base, revokedAt: new Date() },
    { ...base, brandOrganizationId: "00000000-0000-4000-8000-000000000099" },
    { ...base, actor: { ...clientAdmin, organizationId: "00000000-0000-4000-8000-000000000099" } },
    { ...base, actor: { ...clientAdmin, primaryRole: "client_viewer" } },
    { ...base, workspaceStatus: "archived" },
    { ...base, brandStatus: "archived" }
  ]) assert.equal(clientBrandContextAccessDecisionV1(input).allowed, false);
});

test("client create derives ownership and strips provider admission or privileged lifecycle input", () => {
  const decision = clientBrandCreationDecisionV1(clientAdmin);
  assert.equal(decision.allowed, true);
  if (!decision.allowed) throw new Error("expected authority");
  const key = "10000000-0000-4000-8000-000000000001";
  const result = canonicalClientBrandCreateRequestV1({
    actor: clientAdmin,
    authority: decision,
    mutationId: key,
    input: {
      organization_id: clientAdmin.organizationId,
      slug: "new-brand",
      name: "New brand",
      countries: ["MX"],
      brand_seed_handles: [],
      competitors: [],
      timezone: "America/Mexico_City",
      status: "active",
      preparation: {
        idempotency_key: key,
        quote_digest: `sha256:${"a".repeat(64)}`,
        confirmation: "prepare_brand_context_within_shown_cap"
      }
    }
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected canonical input");
  assert.equal(result.value.organization_id, clientAdmin.organizationId);
  assert.equal(result.value.slug, "new-brand-10000000");
  assert.equal(result.value.primary_brand_manager_user_id, clientAdmin.id);
  assert.deepEqual(result.value.preparation, { idempotency_key: key });
  assert.equal("organization_name" in result.value, false);

  const sameNameDifferentRequest = canonicalClientBrandCreateRequestV1({
    actor: clientAdmin, authority: decision, mutationId: "20000000-0000-4000-8000-000000000001",
    input: { ...result.value, slug: "ignored-client-value", name: "New brand" }
  });
  assert.equal(sameNameDifferentRequest.ok, true);
  if (sameNameDifferentRequest.ok) assert.equal(sameNameDifferentRequest.value.slug, "new-brand-20000000");

  assert.equal(canonicalClientBrandCreateRequestV1({ actor: clientAdmin, authority: decision, mutationId: key,
    input: { ...result.value, organization_id: "00000000-0000-4000-8000-000000000099" } }).ok, false);
  assert.equal(canonicalClientBrandCreateRequestV1({ actor: clientAdmin, authority: decision, mutationId: key,
    input: { ...result.value, status: "paused" } }).ok, false);
});

test("client update keeps organization, slug and lifecycle immutable and removes paid admission", () => {
  const current = { organizationId: clientAdmin.organizationId!, slug: "new-brand", status: "active" };
  const key = "10000000-0000-4000-8000-000000000002";
  const result = canonicalClientBrandUpdateRequestV1({ actor: clientAdmin, current, mutationId: key,
    input: { organization_id: current.organizationId, slug: current.slug, status: current.status,
      name: "Renamed", countries: ["MX"], brand_seed_handles: [], timezone: "UTC",
      preparation: { idempotency_key: key, quote_digest: `sha256:${"b".repeat(64)}`,
        confirmation: "prepare_brand_context_within_shown_cap" } } });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected canonical update");
  assert.equal(result.value.organization_id, current.organizationId);
  assert.equal(result.value.slug, current.slug);
  assert.equal(result.value.status, current.status);
  assert.deepEqual(result.value.preparation, { idempotency_key: key });
  assert.equal(canonicalClientBrandUpdateRequestV1({ actor: clientAdmin, current, mutationId: key,
    input: { ...result.value, organization_id: "00000000-0000-4000-8000-000000000099" } }).ok, false);
});

test("session and team updates never grant every brand in an organization", async () => {
  const [session, teamRoute, orgSync] = await Promise.all([
    readFile(new URL("./session.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/api/team/users/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("./org-sync.ts", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(session, /syncClientBrandAccessForOrganization/u);
  assert.doesNotMatch(teamRoute, /syncClientBrandAccessForOrganization/u);
  assert.match(teamRoute, /db\.transaction\(async \(tx\)/u);
  assert.match(teamRoute, /revokeAllClientBrandAccess\(row\.id, tx\)/u);
  assert.match(teamRoute, /revokeClientBrandAccessOutsideOrganization\([\s\S]*?, tx\)/u);
  assert.doesNotMatch(orgSync, /onConflictDoUpdate[\s\S]*revokedAt:\s*null/u);
  assert.doesNotMatch(orgSync, /SET access_level/u);
  assert.doesNotMatch(orgSync, /\.from\(brands\)[\s\S]*eq\(brands\.organizationId/u);
  assert.match(orgSync, /SET revoked_at = COALESCE\(revoked_at, now\(\)\)/u);
});

test("brand creation grant and workspace are committed by the same transaction and replay never restores access", async () => {
  const route = await readFile(new URL("../../app/api/brands/route.ts", import.meta.url), "utf8");
  assert.match(route, /db\.transaction\(async \(tx\) =>/u);
  assert.match(route, /tx\s*\.insert\(userBrandAccess\)/u);
  assert.match(route, /createdByUserId:\s*session\.appUser\.id/u);
  assert.match(route, /verifyClientBrandCreationReplayV1/u);
  assert.doesNotMatch(route, /insert\(userBrandAccess\)[\s\S]{0,500}onConflictDoUpdate/u);
  assert.match(route, /primary_role = 'client_admin'[\s\S]*organization\.status = 'active'[\s\S]*FOR UPDATE OF app_user, organization/u);
  assert.match(route, /\.returning\(\{ id: userBrandAccess\.id \}\)[\s\S]{0,120}if \(!granted\) throw/u);
  assert.match(route, /existingWorkspace\.status !== "active"[\s\S]{0,150}existingWorkspace\.organizationId !== expectedOrganizationId/u);
  assert.match(route, /existingWorkspace\.status !== "active"[\s\S]{0,150}existingWorkspace\.organizationId !== organizationId/u);
  const replay = route.slice(route.indexOf("async function verifyClientBrandCreationReplayV1"),
    route.indexOf("function clientBrandScopeForbidden"));
  assert.match(replay, /metadata\.created_by_user_id !== args\.actorUserId/u);
  assert.match(replay, /eq\(userBrandAccess\.userId, args\.actorUserId\)/u);
  assert.match(replay, /eq\(userBrandAccess\.brandId, args\.brandId\)/u);
  assert.match(replay, /userBrandAccess\.revokedAt\} IS NULL/u);
  assert.match(replay, /userBrandAccess\.accessLevel\} IN \('comment','admin'\)/u);
  assert.doesNotMatch(replay, /\.(?:insert|update|delete)\(/u);
  assert.equal((route.match(/\.insert\(userBrandAccess\)/gu) ?? []).length, 1);
});

test("client Brand OS routes recheck exact writable authority and expose no global Studio entrance", async () => {
  const [brandRoute, knowledgeRoute, knowledgeItemRoute, competitorRoute, competitorItemRoute,
    newPage, brandOsPage, roles, brandsData, productOperation] = await Promise.all([
    readFile(new URL("../../app/api/brands/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/api/brands/[id]/knowledge/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/api/brands/[id]/knowledge/[sourceId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/api/brands/[id]/competitors/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/api/brands/[id]/competitors/[competitorId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/signal/brands/new/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/signal/[outputId]/manage/brand-os/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("./roles.ts", import.meta.url), "utf8"),
    readFile(new URL("../data/brands.ts", import.meta.url), "utf8"),
    readFile(new URL("../data-os/signal-product-operation.ts", import.meta.url), "utf8")
  ]);
  for (const source of [brandRoute, knowledgeRoute, knowledgeItemRoute]) {
    assert.match(source, /lockClientBrandContextAccessV1/u);
  }
  assert.match(brandRoute, /clientEdit\.allowed \? \{\} : \{[\s\S]{0,160}slug: parsed\.data\.slug/u);
  assert.match(brandRoute, /mutationInput = clientEdit\.allowed \? editableMutationInput : \{/u);
  for (const source of [competitorRoute, competitorItemRoute]) {
    assert.match(source, /loadClientBrandContextAccessV1/u);
  }
  assert.match(newPage, /requirePortalUser\("\/signal\/brands\/new"\)/u);
  assert.match(newPage, /loadClientBrandCreationContextV1/u);
  assert.match(brandOsPage, /loadClientBrandContextAccessV1/u);
  assert.match(brandOsPage, /<KnowledgeBaseManager[^>]*unfunded/u);
  assert.match(brandOsPage, /<CompetitorManager[^>]*unfunded/u);
  assert.doesNotMatch(`${newPage}\n${brandOsPage}`, /\/studio|SemanticContextPackManager/u);
  assert.match(roles, /canCreateBrandOrTheme[\s\S]{0,180}canonical === "noisia_admin" \|\| canonical === "analyst"/u);
  assert.match(brandsData, /eq\(brands\.organizationId, appUser\.organizationId\)/u);
  assert.match(productOperation, /access\?: "manual-import" \| "brand-context-editor"/u);
  assert.doesNotMatch(productOperation, /brand-context-editor[\s\S]{0,300}(?:execute-topics|prepare-brand-context)/u);
});

test("committed client Brand OS mutations reconcile source authority without admitting provider work", async () => {
  const [source, route] = await Promise.all([
    readFile(new URL("../data-os/signal-brand-context-preparation.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/api/data-os/signal/[workspaceId]/semantic-context/reconcile/route.ts", import.meta.url), "utf8")
  ]);
  assert.match(source, /args\.actor\.userType === "client"[\s\S]{0,220}reconcileClientBrandContextAfterCommittedMutationV1/u);
  assert.match(source, /FROM signal_semantic_context_generations[\s\S]{0,180}ORDER BY generation_version DESC/u);
  assert.match(source, /reconcileSignalBrandContextSourceV1\(\{[\s\S]{0,360}expected_generation_id:\s*head\.rows\[0\]\?\.generation_id \?\? null/u);
  assert.match(source, /reconciliation\.state === "awaiting_settlement"/u);
  const clientBranch = source.slice(source.indexOf("async function reconcileClientBrandContextAfterCommittedMutationV1"));
  assert.doesNotMatch(clientBranch, /advanceSignalBrandContextPreparationsV1|quote_digest|processing_admission/u);
  assert.doesNotMatch(clientBranch, /loadBrandContextPreparationRuntimeV1|loadSemanticContextProposalRuntimeReadiness/u);
  assert.match(clientBranch, /configuration\s*=\s*signalSemanticContextProposalRuntimeConfigurationFromEnvV1\(\)/u);
  const postRoute=route.slice(route.indexOf("export async function POST"));
  assert.match(postRoute, /loadSignalWorkspaceContextForTopics\(workspaceId\)/u);
  assert.doesNotMatch(postRoute.slice(0,postRoute.indexOf("const idempotencyKey")),
    /loadSignalWorkspaceContextForSemanticContextManagement/u);
  assert.match(route, /appUser\.userType === "client"[\s\S]{0,260}reconcileClientBrandContextForWorkspaceV1/u);
  assert.ok(route.indexOf("reconcileClientBrandContextForWorkspaceV1({")
    < route.indexOf("refreshAutomaticBrandContextKnowledgeV1("));
});

test("valid source configuration needs no provider credentials or queue health; paid runtime remains unavailable", () => {
  const env = {
    NOISIA_SEMANTIC_CONTEXT_MODEL: "claude-sonnet-4-6",
    NOISIA_SEMANTIC_CONTEXT_MODEL_VERSION: "claude-sonnet-4-6",
    NOISIA_SEMANTIC_CONTEXT_PRICING_VERSION: "synthetic-source-only-v1",
    NOISIA_SEMANTIC_CONTEXT_MAX_INPUT_TOKENS: "20000",
    NOISIA_SEMANTIC_CONTEXT_MAX_OUTPUT_TOKENS: "64000",
    NOISIA_SEMANTIC_CONTEXT_INPUT_USD_PER_MILLION_TOKENS: "3",
    NOISIA_SEMANTIC_CONTEXT_OUTPUT_USD_PER_MILLION_TOKENS: "15",
    NOISIA_SEMANTIC_CONTEXT_HARD_CAP_MICRO_USD: "1000000"
  };
  const configuration = signalSemanticContextProposalRuntimeConfigurationFromEnvV1(env);
  assert.equal(configuration.available, true);
  for (const key of ["NOISIA_SEMANTIC_CONTEXT_MODEL", "NOISIA_SEMANTIC_CONTEXT_MAX_INPUT_TOKENS",
    "NOISIA_SEMANTIC_CONTEXT_PRICING_VERSION", "NOISIA_SEMANTIC_CONTEXT_HARD_CAP_MICRO_USD"] as const) {
    assert.equal(signalSemanticContextProposalRuntimeConfigurationFromEnvV1({ ...env, [key]: "" }).available, false);
  }
  const runtime = signalBrandContextPreparationRuntimeFromEnvV1(env, {
    queue_configured: false, worker_alive: false, recovery_alive: false
  });
  assert.equal(runtime.semantic.available, false);
  assert.equal(runtime.prototype.available, false);
  assert.deepEqual({ ...runtime.semantic, available: true }, configuration);
});
