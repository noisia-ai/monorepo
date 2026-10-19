import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadInitialSignalMonitoringV1 } from "./initial-monitoring";

test("Topics returns existing shell/filter state without invoking the monitoring loader", async () => {
  const shell = { filter: { start: "2026-09-01", end: "2026-09-12" }, comparison: "previous_period", workspace: "workspace" };
  let calls = 0;
  const result = await loadInitialSignalMonitoringV1({ activeModule: "topics", buildShellData: () => shell,
    loadMonitoring: async () => { calls++; throw new Error("unrelated monitoring unavailable"); } });
  assert.equal(calls, 0); assert.equal(result, shell);
});
test("monitoring keeps the original payload and propagates original errors", async () => {
  const payload = { mentions: 43159 }; let calls = 0;
  assert.equal(await loadInitialSignalMonitoringV1({ activeModule: "monitoring", buildShellData: () => { throw new Error("shell must not replace monitoring"); },
    loadMonitoring: async () => { calls++; return payload; } }), payload);
  assert.equal(calls, 1);
  const failure = new Error("monitoring_scope_revoked");
  await assert.rejects(loadInitialSignalMonitoringV1({ activeModule: "monitoring", buildShellData: () => payload,
    loadMonitoring: async () => { throw failure; } }), error => error === failure);
});
test("existing non-Topics entry behavior remains intact", async () => {
  for (const activeModule of ["mentions", "settings"] as const) {
    let calls = 0;
    await loadInitialSignalMonitoringV1({ activeModule, buildShellData: () => null, loadMonitoring: async () => { calls++; return null; } });
    assert.equal(calls, 1);
  }
});
test("the page passes the monitoring call lazily and native Topics returns before legacy module loading", async () => {
  const page = await readFile(new URL("../../components/signal-v2/SignalV2WorkspacePage.tsx", import.meta.url), "utf8");
  assert.equal((page.match(/loadSignalBrandMonitoringV1\(\{/g) ?? []).length, 1);
  assert.match(page, /loadMonitoring: \(\) => loadSignalBrandMonitoringV1\(\{/);
  assert.match(page, /loadInitialSignalMonitoringV1\(\{\s+activeModule,/);
  const native = page.indexOf("const native = await loadNativeSignalTopicsV1");
  const nativeReturn = page.indexOf("return <SignalV2BrandMonitoring activeModule={activeModule}", native);
  const monitoring = page.indexOf("loadMonitoring: () => loadSignalBrandMonitoringV1");
  assert.ok(native > 0 && nativeReturn > native && monitoring > nativeReturn);
});
