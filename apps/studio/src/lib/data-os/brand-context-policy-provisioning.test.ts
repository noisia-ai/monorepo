import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { provisionBrandContextPolicyAfterCreationV1 } from "./brand-context-policy-provisioning";

const args = { brandId: "10000000-0000-4000-8000-000000000001", workspaceId: "10000000-0000-4000-8000-000000000002",
  actor: { id: "10000000-0000-4000-8000-000000000003", userType: "noisia_internal", organizationId: null }, enabled: true };
const database = {} as NonNullable<Parameters<typeof provisionBrandContextPolicyAfterCreationV1>[1]>["database"];

test("committed creation passes only server scope and configuration to policy provisioning, including retries", async () => {
  const calls: unknown[] = [];
  for (const status of ["provisioned", "existing_policy", "configuration_required"] as const) {
    const value = await provisionBrandContextPolicyAfterCreationV1(args, { database, provision: async input => {
      calls.push(input); return { contract_version: "brand-context-policy-provisioning-v1", status };
    } });
    assert.deepEqual(value, { contract_version: "brand-context-policy-provisioning-v1", status });
  }
  assert.deepEqual(calls, Array.from({ length: 3 }, () => ({ database, workspace_id: args.workspaceId,
    brand_id: args.brandId, initiator_user_id: args.actor.id })));
});

test("client self-service passes the authenticated initiator and never supplies a policy creator", async () => {
  let called = false;
  const value = await provisionBrandContextPolicyAfterCreationV1({ ...args, actor: { ...args.actor, userType: "client" } }, {
    database, provision: async input => {
      called = true;
      assert.deepEqual(input, { database, workspace_id: args.workspaceId, brand_id: args.brandId, initiator_user_id: args.actor.id });
      return { contract_version: "brand-context-policy-provisioning-v1", status: "provisioned" };
    }
  });
  assert.equal(called, true); assert.equal(value.status, "provisioned");
});

test("unknown actor types and inactive brands never call provisioning", async () => {
  for (const input of [{ ...args, actor: { ...args.actor, userType: "unknown" } }, { ...args, enabled: false }]) {
    const value = await provisionBrandContextPolicyAfterCreationV1(input, { database,
      provision: async () => { throw new Error("must not call DB"); } });
    assert.equal(value.status, "not_eligible");
  }
});

test("provisioning failure is sanitized and cannot turn committed brand creation into a rejected save", async () => {
  const value = await provisionBrandContextPolicyAfterCreationV1(args, { database,
    provision: async () => { throw new Error("private SQL credentials and provider configuration"); } });
  assert.deepEqual(value, { contract_version: "brand-context-policy-provisioning-v1", status: "unavailable" });
  assert.doesNotMatch(JSON.stringify(value), /private|SQL|credentials|provider/u);
});

test("POST brands provisions after creation commit, preserves 201/replay and never takes policy fields from the browser", async () => {
  const route = await readFile(new URL("../../app/api/brands/route.ts", import.meta.url), "utf8");
  const boundary = route.indexOf("const processingPolicy = await provisionBrandContextPolicyAfterCreationV1(");
  assert.ok(boundary > route.indexOf("return { brand: createdBrand, signalWorkspace, replayed: false };"));
  const hook = route.slice(boundary, route.indexOf("const preparation =", boundary));
  assert.match(hook, /brandId: created\.brand\.id/u);
  assert.match(hook, /workspaceId: created\.signalWorkspace\.id/u);
  assert.match(hook, /actor: session\.appUser/u);
  assert.doesNotMatch(hook, /rawInput|parsed\.data|replayed|env|cap|policy_version/u);
  assert.match(route.slice(boundary), /brand_context_policy: processingPolicy/u);
  assert.match(route.slice(boundary), /replayed: created\.replayed[\s\S]{0,50}status: 201/u);
});
