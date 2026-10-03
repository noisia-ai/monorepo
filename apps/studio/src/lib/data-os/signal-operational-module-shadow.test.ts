import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import type { SignalModuleShadowAuthorityV1 } from "./signal-module-serving-scope";
import {
  parseSignalModuleShadowAuthorityV1,
  parseSignalModuleShadowRequesterAuthorityV1,
  sameSignalModuleShadowAuthorityV1,
  signalModuleShadowAuthorityHashV1,
  signalModuleShadowRequesterAuthorityV1,
  withSignalModuleShadowRequesterAuthorityV1
} from "./signal-module-shadow-authority";

const authority: SignalModuleShadowAuthorityV1 = {
  contract_version: "signal-module-shadow-authority-v1",
  workspace_id: "75000000-0000-4000-8000-000000000001",
  module_key: "mentions",
  view_key: "brand",
  resolution_source: "governed-binding",
  binding: {
    id: "75000000-0000-4000-8000-000000000002",
    version: 3
  },
  policy: {
    bundle_id: "75000000-0000-4000-8000-000000000003",
    key: "operational-brand-governed",
    version: 1,
    definition_hash: `sha256:${"1".repeat(64)}`
  },
  population: {
    id: "75000000-0000-4000-8000-000000000004",
    key: "signal-governed-brand-mentions",
    version: 1,
    definition_hash: `sha256:${"2".repeat(64)}`,
    membership_digest: `sha256:${"3".repeat(64)}`
  },
  compilation: {
    id: "75000000-0000-4000-8000-000000000005",
    plan_hash: `sha256:${"4".repeat(64)}`,
    status: "ready"
  },
  watermark: {
    id: "75000000-0000-4000-8000-000000000006",
    data_hash: `sha256:${"5".repeat(64)}`,
    source_hash: `sha256:${"6".repeat(64)}`,
    governance_digest: `sha256:${"7".repeat(64)}`,
    captured_at: "2026-08-12T12:00:00.000Z",
    next_policy_transition_at: null
  }
};

function request(value: SignalModuleShadowAuthorityV1) {
  return { __governed_shadow_authority: value, limit: 50 };
}

test("durable module shadow authority parses and hashes deterministically", () => {
  const parsed = parseSignalModuleShadowAuthorityV1(request(authority));
  assert.deepEqual(parsed, authority);
  assert.equal(
    signalModuleShadowAuthorityHashV1(parsed),
    signalModuleShadowAuthorityHashV1(structuredClone(authority))
  );
});

test("binding, policy, population, compilation and watermark changes supersede a request", () => {
  const changes: SignalModuleShadowAuthorityV1[] = [
    { ...authority, binding: { ...authority.binding, version: 4 } },
    { ...authority, policy: { ...authority.policy, version: 2 } },
    {
      ...authority,
      population: {
        ...authority.population,
        membership_digest: `sha256:${"8".repeat(64)}`
      }
    },
    {
      ...authority,
      compilation: {
        ...authority.compilation,
        plan_hash: `sha256:${"9".repeat(64)}`
      }
    },
    {
      ...authority,
      watermark: {
        ...authority.watermark,
        source_hash: `sha256:${"a".repeat(64)}`
      }
    }
  ];
  assert.ok(changes.every((changed) => (
    !sameSignalModuleShadowAuthorityV1(authority, changed)
  )));
});

test("stored authority fails closed when its identity or digest is malformed", () => {
  assert.throws(
    () => parseSignalModuleShadowAuthorityV1({ limit: 50 }),
    /authority_invalid/u
  );
  assert.throws(
    () => parseSignalModuleShadowAuthorityV1(request({
      ...authority,
      population: { ...authority.population, membership_digest: "not-a-hash" }
    })),
    /authority_invalid/u
  );
  assert.throws(
    () => parseSignalModuleShadowAuthorityV1(request({
      ...authority,
      module_key: "competition" as never
    })),
    /authority_invalid/u
  );
});

test("durable requester stores identity as a CAS expectation, not a capability grant", () => {
  const requester = signalModuleShadowRequesterAuthorityV1({
    userId: "75000000-0000-4000-8000-000000000010",
    organizationId: null,
    isInternalUser: true
  });
  assert.deepEqual(
    parseSignalModuleShadowRequesterAuthorityV1(
      withSignalModuleShadowRequesterAuthorityV1(request(authority), requester)
    ),
    requester
  );
  assert.throws(
    () => parseSignalModuleShadowRequesterAuthorityV1(request(authority)),
    /requester_authority_invalid/u
  );
});

test("outbox processing re-authorizes a real requester and surfaces persistence failures", async () => {
  const source = await readFile(
    new URL("./signal-operational-module-shadow.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /loadSignalModuleShadowRequesterV1/u);
  assert.match(source, /requester: SignalWorkspaceUser/u);
  assert.match(source, /failure_kind: "result_persistence_failure"/u);
  assert.match(source, /persistence_state: "failed"/u);
  assert.match(source, /signal_shadow_governed_resolution_dependency_failure/u);
  assert.match(source, /error instanceof SignalBackendContractError/u);
  assert.match(source, /evaluationState: "execution_failed"/u);
  assert.doesNotMatch(source, /00000000-0000-4000-8000-000000000001/u);
  assert.doesNotMatch(source, /row\.is_internal_user/u);
  assert.doesNotMatch(source, /contractViolationCount: 1/u);
  assert.doesNotMatch(source, /unexplainedCount: 1/u);
  assert.doesNotMatch(source, /\.catch\(\(\) => undefined\)/u);
});
