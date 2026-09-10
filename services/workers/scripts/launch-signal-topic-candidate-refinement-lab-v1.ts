/**
 * The only supported parent-side launcher for a provider-enabled local refinement flight.
 *
 * It reads the dedicated Keychain item immediately before spawning one fixed child, builds a
 * scrubbed environment and never writes or prints the credential. The child is the only process
 * that receives the credential, and it exits after one terminal reconciliation.
 */
import { spawn, type SpawnOptions } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { buildSignalTopicCandidateRefinementLabChildEnvironmentV1,
  readSignalTopicCandidateRefinementLabKeychainCredentialV1,
  SignalTopicCandidateRefinementCredentialError,
  SIGNAL_TOPIC_REFINEMENT_LAB_RUNTIME_PROFILE } from
  "./signal-topic-candidate-refinement-lab-credential-v1";
import { verifyFixedSignalTopicCandidateRefinementSuccessorHostReceiptV1 } from
  "./signal-topic-candidate-refinement-successor-host-provenance-v1";

const CHILD = resolve(fileURLToPath(new URL("./run-signal-topic-candidate-refinement-lab-child-v1.ts", import.meta.url)));
const CONFIRMATION = "EXECUTE_ONE_LOCAL_DISPOSABLE_TOPIC_CANDIDATE_REFINEMENT_FLIGHT";

export class SignalTopicCandidateRefinementLabLaunchError extends Error {
  constructor(readonly code: string) { super(code); }
}

type SpawnChild = (command: string, args: string[], options: SpawnOptions) => ReturnType<typeof spawn>;

export async function launchSignalTopicCandidateRefinementLabV1(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: {
    readCredential?: typeof readSignalTopicCandidateRefinementLabKeychainCredentialV1;
    verifyHostReceipt?: typeof verifyFixedSignalTopicCandidateRefinementSuccessorHostReceiptV1;
    spawnChild?: SpawnChild;
    nodeBinary?: string;
  } = {}
) {
  if (environment.NOISIA_RUNTIME_PROFILE !== "local_disposable_lab_v1"
      || environment.NOISIA_TOPIC_REFINEMENT_LAB_EXECUTION_ENABLED !== "true"
      || environment.NOISIA_TOPIC_REFINEMENT_LAB_EXECUTION_CONFIRMATION !== CONFIRMATION
      || !/^topic-refinement-flight-[a-f0-9]{16}$/u.test(
        environment.NOISIA_TOPIC_REFINEMENT_LAB_FLIGHT_KEY ?? "")) {
    throw new SignalTopicCandidateRefinementLabLaunchError("topic_refinement_local_launcher_disabled");
  }
  let credential = "";
  try {
    // Verify the fixed direct successor before touching the dedicated Keychain lane.
    await (dependencies.verifyHostReceipt ?? verifyFixedSignalTopicCandidateRefinementSuccessorHostReceiptV1)();
    credential = await (dependencies.readCredential ?? readSignalTopicCandidateRefinementLabKeychainCredentialV1)();
    const childEnvironment = buildSignalTopicCandidateRefinementLabChildEnvironmentV1(environment, credential);
    const child = (dependencies.spawnChild ?? spawn)(dependencies.nodeBinary ?? process.execPath,
      ["--import", "tsx", CHILD], { env: childEnvironment, stdio: "inherit" });
    const status = await new Promise<number | null>((resolveChild, rejectChild) => {
      child.once("error", rejectChild);
      child.once("exit", (code) => resolveChild(code));
    });
    if (status !== 0) throw new SignalTopicCandidateRefinementLabLaunchError(
      "topic_refinement_local_child_failed");
  } finally {
    // The parent never keeps a reusable value after creating the one child.
    credential = "";
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  launchSignalTopicCandidateRefinementLabV1().catch((error: unknown) => {
    process.stderr.write(`${error instanceof SignalTopicCandidateRefinementLabLaunchError
      || error instanceof SignalTopicCandidateRefinementCredentialError
      ? error.code : "topic_refinement_local_launcher_failed"}\n`);
    process.exitCode = 1;
  });
}

export const signalTopicCandidateRefinementLabLauncherTestOnly = {
  child_path: CHILD,
  confirmation: CONFIRMATION,
  runtime_profile: SIGNAL_TOPIC_REFINEMENT_LAB_RUNTIME_PROFILE
};
