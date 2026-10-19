import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { isLocalDatabaseUrl, requireRemoteDatabaseTarget } from "../seeds/connection.js";
import { requireEnv } from "../seeds/env.js";

type StepResult = {
  step: string;
  script: string;
  duration_ms: number;
};

const REMOTE_REQUIRED_FLAGS = [
  "NOISIA_DATA_OS_PREFLIGHT_ALLOW_REMOTE",
  "NOISIA_DATA_OS_BACKFILL_ALLOW_REMOTE",
  "NOISIA_DATA_OS_SHADOW_ALLOW_REMOTE",
  "NOISIA_DATA_OS_VERIFY_ALLOW_REMOTE"
];

function requireShadowRunEnabled() {
  if (process.env.NOISIA_DATA_OS_SHADOW_RUN_ENABLED === "true") return;

  throw new Error(
    [
      "Refusing to run Data OS shadow rollout while NOISIA_DATA_OS_SHADOW_RUN_ENABLED is not true.",
      "Run data-os:candidates and data-os:preflight first, then set the flag only for an isolated staging/throwaway target."
    ].join(" ")
  );
}

function requireRemoteOverrides(databaseUrl: string) {
  if (isLocalDatabaseUrl(databaseUrl)) return;

  const missing = REMOTE_REQUIRED_FLAGS.filter((flag) => process.env[flag] !== "true");
  if (missing.length === 0) {
    requireRemoteDatabaseTarget(databaseUrl, "data-os:shadow-run");
    return;
  }

  const parsed = new URL(databaseUrl);
  throw new Error(
    [
      "Refusing to run Data OS shadow rollout against a non-local database without all step-level remote overrides.",
      `Host: ${parsed.hostname}`,
      `Missing: ${missing.join(", ")}`
    ].join(" ")
  );
}

function runStep(step: string, script: string, env: NodeJS.ProcessEnv) {
  const dbRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const startedAt = Date.now();

  return new Promise<StepResult>((resolve, reject) => {
    const child = spawn("corepack", ["pnpm", "exec", "tsx", script], {
      cwd: dbRoot,
      env,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("close", (code) => {
      const durationMs = Date.now() - startedAt;
      if (code === 0) {
        resolve({ step, script, duration_ms: durationMs });
        return;
      }
      reject(new Error(`${step} failed: ${script} exited with code ${code ?? "unknown"}`));
    });
  });
}

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const corpusId = requireEnv("NOISIA_DATA_OS_BACKFILL_CORPUS_ID");
  const outputId = requireEnv("NOISIA_DATA_OS_SHADOW_OUTPUT_ID");
  const strict = process.env.NOISIA_DATA_OS_SHADOW_RUN_STRICT !== "false";

  requireShadowRunEnabled();
  requireRemoteOverrides(databaseUrl);

  const baseEnv = {
    ...process.env,
    NOISIA_DATA_OS_BACKFILL_CORPUS_ID: corpusId,
    NOISIA_DATA_OS_SHADOW_OUTPUT_ID: outputId
  };

  const steps: StepResult[] = [];
  steps.push(await runStep("preflight", "scripts/data-os-preflight.ts", {
    ...baseEnv,
    NOISIA_DATA_OS_PREFLIGHT_STRICT: strict ? "true" : process.env.NOISIA_DATA_OS_PREFLIGHT_STRICT ?? "false"
  }));
  steps.push(await runStep("backfill", "scripts/data-os-backfill.ts", {
    ...baseEnv,
    NOISIA_DATA_OS_BACKFILL_ENABLED: "true"
  }));
  steps.push(await runStep("shadow_qa", "scripts/data-os-shadow-qa.ts", {
    ...baseEnv,
    NOISIA_DATA_OS_SHADOW_STRICT: strict ? "true" : process.env.NOISIA_DATA_OS_SHADOW_STRICT ?? "false"
  }));
  steps.push(await runStep("verify", "scripts/verify-data-os-readiness.ts", {
    ...baseEnv,
    NOISIA_DATA_OS_VERIFY_DB: "true",
    NOISIA_DATA_OS_VERIFY_CORPUS_ID: corpusId
  }));

  console.log(JSON.stringify({
    ok: true,
    strict,
    corpus_id: corpusId,
    output_id: outputId,
    steps,
    ready_for_live_api_shadow: true,
    next_flags: {
      NOISIA_DATA_OS_ENABLED: "true",
      NOISIA_DATA_OS_SERVING_ENABLED: "true",
      NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED: "true",
      NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED: "false",
      NOISIA_DATA_OS_SHADOW_MODE: "true"
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
