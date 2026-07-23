import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("Signal V2 backend gate accepts only the complete redacted runtime evidence set", async () => {
  const dir = await createEvidenceDir();
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "scripts/signal-v2-backend-gate.ts"],
      {
        cwd: process.cwd(),
        env: { ...process.env, NOISIA_DATA_OS_EVIDENCE_PACK_DIR: dir }
      }
    );
    const result = JSON.parse(stdout);
    assert.equal(result.backend_ready_for_signal_v2, true);
    assert.equal(result.llm_spend_usd, 0);
    assert.equal(result.client_activation, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Signal V2 backend gate fails closed when facade shadow is not ready", async () => {
  const dir = await createEvidenceDir();
  try {
    await writeJson(dir, "signal-v2-shadow.json", {
      ready_for_backend_signal_v2: false,
      identifiers_redacted: true,
      llm_spend_usd: 0,
      client_activation: false
    });
    await assert.rejects(
      execFileAsync(
        process.execPath,
        ["--import", "tsx", "scripts/signal-v2-backend-gate.ts"],
        {
          cwd: process.cwd(),
          env: { ...process.env, NOISIA_DATA_OS_EVIDENCE_PACK_DIR: dir }
        }
      ),
      (error: unknown) => {
        const stdout = String((error as { stdout?: unknown }).stdout ?? "");
        return stdout.includes('"backend_ready_for_signal_v2": false')
          && stdout.includes('"facade_shadow_ready"');
      }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function createEvidenceDir() {
  const dir = await mkdtemp(resolve(tmpdir(), "noisia-signal-v2-gate-"));
  await writeFile(resolve(dir, "staging-check.txt"), "ready_for_staging_shadow=true\n");
  await writeJson(dir, "signal-v2-backfill.json", {
    ok: true,
    mode: "apply",
    payload_preserved: true,
    identifiers_redacted: true,
    llm_spend_usd: 0,
    client_activation: false
  });
  await writeJson(dir, "signal-v2-reconcile.json", {
    ok: true,
    identifiers_redacted: true
  });
  await writeJson(dir, "signal-v2-explain.json", {
    ok: true,
    analyze: true,
    representative_volume: true,
    identifiers_redacted: true
  });
  await writeJson(dir, "signal-v2-shadow.json", {
    ready_for_backend_signal_v2: true,
    identifiers_redacted: true,
    llm_spend_usd: 0,
    client_activation: false
  });
  return dir;
}

function writeJson(dir: string, name: string, value: unknown) {
  return writeFile(resolve(dir, name), `${JSON.stringify(value, null, 2)}\n`);
}
