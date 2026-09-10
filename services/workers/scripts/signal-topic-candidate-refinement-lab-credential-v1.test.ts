import assert from "node:assert/strict";
import test from "node:test";

import { assertSignalTopicCandidateRefinementLabCredentialCustodyV1,
  buildSignalTopicCandidateRefinementLabChildEnvironmentV1,
  readSignalTopicCandidateRefinementLabKeychainCredentialV1,
  SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_NAME,
  SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_SOURCE,
  SIGNAL_TOPIC_REFINEMENT_LAB_RUNTIME_PROFILE } from "./signal-topic-candidate-refinement-lab-credential-v1";

test("local refinement child composition keeps only the dedicated credential", () => {
  const child = buildSignalTopicCandidateRefinementLabChildEnvironmentV1({ PATH: "/bin", HOME: "/tmp",
    ANTHROPIC_API_KEY: "uat-value", DATABASE_URL: "remote", RAILWAY_ENVIRONMENT: "uat",
    NOISIA_TOPIC_REFINEMENT_LAB_FLIGHT_KEY: "topic-refinement-flight-0000000000000000" }, "local-value");
  assert.equal(child.ANTHROPIC_API_KEY, undefined);
  assert.equal(child.DATABASE_URL, undefined);
  assert.equal(child.RAILWAY_ENVIRONMENT, undefined);
  assert.equal(child[SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_NAME], "local-value");
  assert.doesNotThrow(() => assertSignalTopicCandidateRefinementLabCredentialCustodyV1(child));
});

test("local refinement rejects UAT inheritance before any provider edge", () => {
  const valid = { NOISIA_RUNTIME_PROFILE: SIGNAL_TOPIC_REFINEMENT_LAB_RUNTIME_PROFILE,
    [SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_SOURCE]: "keychain-child",
    [SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_NAME]: "local-value" };
  assert.doesNotThrow(() => assertSignalTopicCandidateRefinementLabCredentialCustodyV1(valid));
  assert.throws(() => assertSignalTopicCandidateRefinementLabCredentialCustodyV1({ ...valid,
    ANTHROPIC_API_KEY: "must-not-inherit" }), /topic_refinement_local_credential_inherited/u);
  assert.throws(() => assertSignalTopicCandidateRefinementLabCredentialCustodyV1({ ...valid,
    NOISIA_RUNTIME_PROFILE: "uat" }), /topic_refinement_local_credential_custody_invalid/u);
});

test("missing dedicated Keychain entry becomes a stable local credential blocker", async () => {
  await assert.rejects(readSignalTopicCandidateRefinementLabKeychainCredentialV1("tester", (async () => {
    throw new Error("native keychain detail must not escape");
  }) as never), /topic_refinement_local_credential_missing/u);
});
