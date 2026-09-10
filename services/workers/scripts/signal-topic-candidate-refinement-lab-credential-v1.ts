/** Local-only credential custody for the proposal-only refinement Lab.
 *
 * UAT service variables and `.env` are intentionally rejected. The launcher reads a distinct
 * Keychain item immediately before one child process and constructs an allowlisted environment.
 */
import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import { promisify } from "node:util";

export const SIGNAL_TOPIC_REFINEMENT_LAB_KEYCHAIN_SERVICE =
  "noisia.topic-refinement-lab.anthropic" as const;
export const SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_NAME =
  "NOISIA_TOPIC_REFINEMENT_LAB_ANTHROPIC_API_KEY" as const;
export const SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_SOURCE =
  "NOISIA_TOPIC_REFINEMENT_LAB_CREDENTIAL_SOURCE" as const;
export const SIGNAL_TOPIC_REFINEMENT_LAB_RUNTIME_PROFILE =
  "local_disposable_topic_refinement_lab_v1" as const;

const execFileAsync = promisify(execFile);
const FORBIDDEN = /^(?:ANTHROPIC_API_KEY|RAILWAY_|DATABASE_URL$|SUPABASE_|UPSTASH_|REDIS_URL$)/u;
const ALLOWED_PARENT = new Set(["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL",
  "NOISIA_TOPIC_REFINEMENT_LAB_EXECUTION_ENABLED",
  "NOISIA_TOPIC_REFINEMENT_LAB_EXECUTION_CONFIRMATION",
  "NOISIA_TOPIC_REFINEMENT_LAB_IDEMPOTENCY_KEY",
  "NOISIA_TOPIC_REFINEMENT_LAB_FLIGHT_KEY"]);

export class SignalTopicCandidateRefinementCredentialError extends Error {
  constructor(readonly code: string) { super(code); }
}

/** The child can assert a composition created by the fixed launcher without reading its value. */
export function assertSignalTopicCandidateRefinementLabCredentialCustodyV1(env: NodeJS.ProcessEnv) {
  if (env.NOISIA_RUNTIME_PROFILE !== SIGNAL_TOPIC_REFINEMENT_LAB_RUNTIME_PROFILE
      || env[SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_SOURCE] !== "keychain-child") {
    throw new SignalTopicCandidateRefinementCredentialError("topic_refinement_local_credential_custody_invalid");
  }
  if (Object.keys(env).some((key) => FORBIDDEN.test(key))) {
    throw new SignalTopicCandidateRefinementCredentialError("topic_refinement_local_credential_inherited");
  }
  const credential = env[SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_NAME];
  if (typeof credential !== "string" || credential.trim() === "") {
    throw new SignalTopicCandidateRefinementCredentialError("topic_refinement_local_credential_missing");
  }
}

/** This returns only a scrubbed child environment. It never logs, stores or returns the secret. */
export function buildSignalTopicCandidateRefinementLabChildEnvironmentV1(
  parent: NodeJS.ProcessEnv, credential: string
): NodeJS.ProcessEnv {
  if (typeof credential !== "string" || credential.trim() === "") {
    throw new SignalTopicCandidateRefinementCredentialError("topic_refinement_local_credential_missing");
  }
  const child: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(parent)) {
    if (ALLOWED_PARENT.has(key) && typeof value === "string") child[key] = value;
  }
  child.NOISIA_RUNTIME_PROFILE = SIGNAL_TOPIC_REFINEMENT_LAB_RUNTIME_PROFILE;
  child[SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_SOURCE] = "keychain-child";
  child[SIGNAL_TOPIC_REFINEMENT_LAB_CREDENTIAL_NAME] = credential;
  return child;
}

/** Fixed Keychain service/account lookup for action-time launch. The value is returned only to
 * the caller so it can immediately build the single child's scrubbed environment. */
export async function readSignalTopicCandidateRefinementLabKeychainCredentialV1(
  account = userInfo().username,
  runner: typeof execFileAsync = execFileAsync
) {
  let stdout: string;
  try {
    ({ stdout } = await runner("/usr/bin/security", ["find-generic-password", "-s",
      SIGNAL_TOPIC_REFINEMENT_LAB_KEYCHAIN_SERVICE, "-a", account, "-w"], { maxBuffer: 8_192 }));
  } catch {
    // Native Keychain errors can reveal account or implementation details. The caller only needs
    // the stable fact that the dedicated, local credential is unavailable.
    throw new SignalTopicCandidateRefinementCredentialError("topic_refinement_local_credential_missing");
  }
  const credential = stdout.trim();
  if (!credential) throw new SignalTopicCandidateRefinementCredentialError("topic_refinement_local_credential_missing");
  return credential;
}
