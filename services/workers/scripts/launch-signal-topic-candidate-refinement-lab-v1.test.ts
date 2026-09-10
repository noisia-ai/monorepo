import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { launchSignalTopicCandidateRefinementLabV1 } from
  "./launch-signal-topic-candidate-refinement-lab-v1";

const valid = {
  NOISIA_RUNTIME_PROFILE: "local_disposable_lab_v1",
  NOISIA_TOPIC_REFINEMENT_LAB_EXECUTION_ENABLED: "true",
  NOISIA_TOPIC_REFINEMENT_LAB_EXECUTION_CONFIRMATION:
    "EXECUTE_ONE_LOCAL_DISPOSABLE_TOPIC_CANDIDATE_REFINEMENT_FLIGHT",
  NOISIA_TOPIC_REFINEMENT_LAB_FLIGHT_KEY: "topic-refinement-flight-0123456789abcdef",
  ANTHROPIC_API_KEY: "must-be-excluded"
} satisfies NodeJS.ProcessEnv;

test("fixed launcher reads once and gives a scrubbed one-shot child no inherited UAT credential", async () => {
  let reads = 0;
  let childEnvironment: NodeJS.ProcessEnv | undefined;
  await launchSignalTopicCandidateRefinementLabV1(valid, {
    verifyHostReceipt: async () => ({ receipt: {} as never, container: {} as never }),
    readCredential: async () => { reads += 1; return "test-key-not-logged"; },
    spawnChild: (_command, _args, options) => {
      childEnvironment = options.env as NodeJS.ProcessEnv;
      const child = new EventEmitter() as ReturnType<typeof import("node:child_process").spawn>;
      queueMicrotask(() => child.emit("exit", 0));
      return child;
    }
  });
  assert.equal(reads, 1);
  assert.equal(childEnvironment?.ANTHROPIC_API_KEY, undefined);
  assert.equal(childEnvironment?.NOISIA_TOPIC_REFINEMENT_LAB_ANTHROPIC_API_KEY, "test-key-not-logged");
  assert.equal(childEnvironment?.NOISIA_TOPIC_REFINEMENT_LAB_CREDENTIAL_SOURCE, "keychain-child");
});

test("fixed launcher rejects a missing action-time confirmation before Keychain access", async () => {
  let reads = 0;
  await assert.rejects(launchSignalTopicCandidateRefinementLabV1({ ...valid,
    NOISIA_TOPIC_REFINEMENT_LAB_EXECUTION_CONFIRMATION: "wrong" }, {
    readCredential: async () => { reads += 1; return "must-not-read"; }
  }), /topic_refinement_local_launcher_disabled/u);
  assert.equal(reads, 0);
});
