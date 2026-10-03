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
    assert.equal(result.llm_spend_usd, 1.25);
    assert.equal(result.llm_authorized_budget_usd, 25);
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
      llm_spend_usd: 1.25,
      llm_authorized_budget_usd: 25,
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

test("Signal V2 backend gate fails closed when legacy payload parity is behind", async () => {
  const dir = await createEvidenceDir();
  try {
    await writeJson(dir, "serving-smoke.json", servingSmokeEvidence({
      live_payload_parity: { live_behind_payload: true }
    }));
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
          && stdout.includes('"legacy_payload_parity_preserved"');
      }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Signal V2 backend gate fails closed when legacy fallback is unsafe", async () => {
  const dir = await createEvidenceDir();
  try {
    await writeJson(dir, "serving-smoke.json", servingSmokeEvidence({
      fallback_checks: {
        data_os_disabled_ready: false,
        signal_pulse_live_disabled_ready: true
      }
    }));
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
          && stdout.includes('"legacy_fallback_safe"');
      }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function createEvidenceDir() {
  const dir = await mkdtemp(resolve(tmpdir(), "noisia-signal-v2-gate-"));
  await writeFile(resolve(dir, "staging-check.txt"), "ready_for_staging_shadow=true\n");
  await writeJson(dir, "serving-smoke.json", servingSmokeEvidence());
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
    operational_charting_eligible: true,
    query_plans_within_budget: true,
    required_indexes_present: true,
    representative_volume: false,
    identifiers_redacted: true
  });
  await writeJson(dir, "signal-v2-shadow.json", {
    ready_for_backend_signal_v2: true,
    identifiers_redacted: true,
    llm_spend_usd: 1.25,
    llm_authorized_budget_usd: 25,
    client_activation: false
  });
  return dir;
}

function servingSmokeEvidence(
  overrides: Partial<Record<
    "live_payload_parity" | "fallback_checks" | "visibility_checks",
    Record<string, boolean>
  >> = {}
) {
  return {
    ok: true,
    ready_for_serving_shadow: true,
    corpus_id: "set_redacted",
    output_id: "set_redacted",
    contains_sensitive_ids: false,
    live_payload_parity: {
      live_behind_payload: false,
      ...overrides.live_payload_parity
    },
    fallback_checks: {
      data_os_disabled_ready: true,
      signal_pulse_live_disabled_ready: true,
      ...overrides.fallback_checks
    },
    visibility_checks: {
      client_source_health_hidden: true,
      client_internal_dashboard_refs_hidden: true,
      internal_source_health_visible: true,
      internal_dashboard_refs_preserved: true,
      ...overrides.visibility_checks
    }
  };
}

function writeJson(dir: string, name: string, value: unknown) {
  return writeFile(resolve(dir, name), `${JSON.stringify(value, null, 2)}\n`);
}
