import { signalWorkspaceMonitoringInsightsJobV1, safeMonitoringInsightErrorV1 } from "./signal-workspace-monitoring-insights";

type WorkerOptions = NonNullable<Parameters<typeof signalWorkspaceMonitoringInsightsJobV1>[1]>;
type Options = {
  database?: WorkerOptions["database"];
  env?: Record<string, string | undefined>;
  list?: typeof import("@noisia/db").listMonitoringInsightRunsV1;
  run?: typeof signalWorkspaceMonitoringInsightsJobV1;
  worker_options?: Omit<WorkerOptions, "database" | "env">;
  interval_ms?: number; run_immediately?: boolean; should_stop?: () => boolean;
};

/** Database discovery recovers a committed intent even if queue publication was
 * lost. SQL claims fence queue/drainer races. Unknown calls never become sends. */
export async function drainSignalWorkspaceMonitoringInsightsV1(options: Options = {}) {
  const database = options.database ?? (await import("../db/client")).pool;
  const list = options.list ?? (await import("@noisia/db")).listMonitoringInsightRunsV1;
  const env = options.env ?? process.env;
  const rows = await list({ database, limit: 10, enabled: env.NOISIA_MONITORING_INSIGHTS_ENABLED === "true" });
  const result = { candidates: rows.length, completed: 0, reconciled: 0, failed: 0 };
  const run = options.run ?? signalWorkspaceMonitoringInsightsJobV1;
  for (const run_id of new Set(rows)) {
    if (options.should_stop?.()) break;
    if (typeof run_id !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(run_id)) { result.failed++; continue; }
    try {
      const outcome = await run({ id: `monitoring-insights-${run_id}`, data: { run_id }, updateProgress: async () => undefined },
        { ...options.worker_options, database, env });
      if (outcome.status === "completed") result.completed++; else result.reconciled++;
    } catch { result.failed++; }
  }
  return result;
}

export function startSignalWorkspaceMonitoringInsightsDrainerV1(options: Options = {}) {
  let closed = false; let inFlight: Promise<unknown> | null = null;
  const drainNow = () => {
    if (closed) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = drainSignalWorkspaceMonitoringInsightsV1({ ...options, should_stop: () => closed || Boolean(options.should_stop?.()) })
      .catch(error => { console.warn(`[monitoring-insights] ${safeMonitoringInsightErrorV1(error)}`); })
      .finally(() => { inFlight = null; });
    return inFlight;
  };
  const timer = setInterval(() => { void drainNow(); }, options.interval_ms ?? 2_500);
  timer.unref?.();
  if (options.run_immediately !== false) void drainNow();
  return { drainNow, close: async () => { closed = true; clearInterval(timer); await inFlight; } };
}
