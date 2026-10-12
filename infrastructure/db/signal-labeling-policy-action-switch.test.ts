import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import {
  assertMfpJevPolicyFixtureV1,
  assertOnlyMentionFacetsChangedV1,
  switchMfpMentionFacetsProviderV1,
} from "./signal-labeling-policy-action-switch";

const mention = { action: "mention_facets", kind: "provider", provider: "typesafe", model: "jev-1.13.0",
  configuration: { provider: "typesafe", model: "jev-1.13.0", prompt_version: "v2" },
  configuration_digest: "sha256:old", max_execution_micro_usd: "100", automatic_allowed: false };
const other = { action: "concept_membership", kind: "provider", provider: "anthropic", model: "claude-sonnet-4-6",
  configuration: { provider: "anthropic", model: "claude-sonnet-4-6", contract_version: "v1" },
  configuration_digest: "sha256:other", max_execution_micro_usd: "200", automatic_allowed: true };

test("MFP provider switch changes only mention_facets and preserves every other action field", () => {
  const afterMention = { ...mention, provider: "anthropic", model: "claude-sonnet-5-5",
    configuration: { ...mention.configuration, provider: "anthropic", model: "claude-sonnet-5-5" },
    configuration_digest: "sha256:new" };
  assert.doesNotThrow(() => assertOnlyMentionFacetsChangedV1([mention, other], [other, afterMention], "anthropic", "claude-sonnet-5-5"));
  assert.throws(() => assertOnlyMentionFacetsChangedV1([mention, other], [
    afterMention, { ...other, max_execution_micro_usd: "0" },
  ], "anthropic", "claude-sonnet-5-5"), /mfp_jev_policy_copy_mismatch/u);
});

test("MFP switch fixture key is bound to the disposable organization slug", () => {
  assert.doesNotThrow(() => assertMfpJevPolicyFixtureV1("jev-policy-abc123", "mfp-jev-policy-abc123"));
  assert.doesNotThrow(() => assertMfpJevPolicyFixtureV1("rental-corpus-voyage-v1", "mfp-rental-corpus-voyage-v1"));
  assert.throws(() => assertMfpJevPolicyFixtureV1("voyage-real", "mfp-voyage-real"), /mfp_jev_policy_fixture_required/u);
  assert.throws(() => assertMfpJevPolicyFixtureV1("jev-policy-abc123", "customer-real"), /mfp_jev_policy_fixture_required/u);
});

test("a real workspace is rejected and the policy transaction rolls back before writes", async () => {
  const statements: string[] = [];
  let released = false;
  const database = { connect: async () => ({
    query: async (sql: string) => {
      statements.push(sql);
      if (sql.includes("SELECT w.organization_id,o.slug"))
        return { rows: [{ organization_id: "org-real", organization_slug: "brand-acme" }] };
      return { rows: [] };
    },
    release: () => { released = true; },
  }) };
  await assert.rejects(switchMfpMentionFacetsProviderV1({ database: database as unknown as Pick<Pool, "connect">,
    fixture_key: "jev-policy-abc123", workspace_id: "workspace-real", organization_id: "org-real",
    actor_user_id: "actor", provider: "typesafe", execute: true }),
  /mfp_jev_policy_operation_failed/u);
  assert.equal(statements.filter(sql => /^(INSERT|UPDATE|DELETE)\b/iu.test(sql.trim())).length, 0);
  assert.ok(statements.some(sql => sql.trim() === "ROLLBACK"));
  assert.equal(released, true);
});
