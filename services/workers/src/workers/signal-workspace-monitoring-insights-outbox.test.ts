import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { drainSignalWorkspaceMonitoringInsightsV1, startSignalWorkspaceMonitoringInsightsDrainerV1 } from "./signal-workspace-monitoring-insights-outbox";

const first = "00000000-0000-4000-8000-000000000001", second = "00000000-0000-4000-8000-000000000002";
type Options = NonNullable<Parameters<typeof drainSignalWorkspaceMonitoringInsightsV1>[0]>;
test("durable discovery resumes a second workspace after the first fails and carries only run identity", async () => {
  const calls: string[] = []; let listed = false;
  const result = await drainSignalWorkspaceMonitoringInsightsV1({ database: {} as Options["database"],
    env: { NOISIA_MONITORING_INSIGHTS_ENABLED: "true" },
    list: async args => { assert.equal(args.enabled, true); listed = true; return [first, second]; },
    run: async job => { assert.equal(listed, true); assert.deepEqual(Object.keys(job.data), ["run_id"]); calls.push(job.data.run_id);
      if (job.data.run_id === first) throw new Error("private failed workspace diagnostic");
      return { run_id: second, status: "completed" }; } });
  assert.deepEqual(calls, [first, second]); assert.deepEqual(result, { candidates: 2, completed: 1, reconciled: 0, failed: 1 });
});
test("disabled provider discovery requests only persisted response reconciliation and never enables a send", async () => {
  const env = { NOISIA_MONITORING_INSIGHTS_ENABLED: "false", ANTHROPIC_API_KEY: "unrelated" };
  const result = await drainSignalWorkspaceMonitoringInsightsV1({ database: {} as Options["database"], env,
    list: async args => { assert.equal(args.enabled, false); return [first]; }, run: async (_job, options) => {
      assert.equal(options?.env, env); return { run_id: first, status: "reconciliation_only" }; } });
  assert.equal(result.reconciled, 1);
});
test("duplicate and malformed discovery rows cannot create repeated consumers", async () => {
  let called = 0; const result = await drainSignalWorkspaceMonitoringInsightsV1({ database: {} as Options["database"],
    list: async () => [first, first, "malformed"], run: async () => { called++; return { run_id: first, status: "replayed" }; } });
  assert.equal(called, 1); assert.equal(result.failed, 1); assert.equal(result.reconciled, 1);
});
test("periodic recovery never overlaps and shutdown waits for its current attempt without starting another", async () => {
  let release!: () => void; let listed = 0; let ran = 0;
  const drainer = startSignalWorkspaceMonitoringInsightsDrainerV1({ database: {} as Options["database"], interval_ms: 5, run_immediately: false,
    list: async () => { listed++; return [first, second]; }, run: async job => { ran++; await new Promise<void>(resolve => { release = resolve; }); return { run_id: job.data.run_id, status: "completed" }; } });
  const one = drainer.drainNow(); const two = drainer.drainNow(); assert.equal(one, two);
  const deadline = Date.now() + 1000;
  while (!release && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 1));
  assert.ok(release); await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(listed, 1); assert.equal(ran, 1);
  let closed = false; const shutdown = drainer.close().then(() => { closed = true; });
  await Promise.resolve(); assert.equal(closed, false); release(); await Promise.all([one, shutdown]);
  await drainer.drainNow(); assert.equal(listed, 1); assert.equal(ran, 1);
});
test("runtime consumes only the new closed job and starts and closes durable recovery with Data OS", async () => {
  const [queue, entry] = await Promise.all([readFile(new URL("../queues/data-os.ts", import.meta.url), "utf8"),
    readFile(new URL("../index.ts", import.meta.url), "utf8")]);
  assert.match(queue, /job\.name === SIGNAL_WORKSPACE_MONITORING_INSIGHTS_JOB_NAME\) return signalWorkspaceMonitoringInsightsJobV1\(job\)/u);
  assert.match(entry, /dataOsWorker \? startSignalWorkspaceMonitoringInsightsDrainerV1\(\) : null/u);
  assert.match(entry, /await workspaceMonitoringInsightsDrainer\?\.close\(\)/u);
});
