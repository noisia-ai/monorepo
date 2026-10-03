import {
  normalizeSignalFilterV1,
  type SignalFilterV1
} from "@noisia/query-engine";

export const SIGNAL_GOVERNED_MULTI_VIEW_MAX_RESTORE_AGE_MS = 24 * 60 * 60 * 1000;

export type SignalGovernedObservedPeriodV1 = {
  period_start: string;
  period_end: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

export function resolveSignalGovernedMultiViewRestorePointV1(
  value: string,
  now = Date.now()
) {
  const restorePointMs = Date.parse(value);
  const ageMs = now - restorePointMs;
  if (!Number.isFinite(restorePointMs) || ageMs < 0
    || ageMs > SIGNAL_GOVERNED_MULTI_VIEW_MAX_RESTORE_AGE_MS) {
    throw new Error("Backend 06 requires a restore point no older than 24 hours.");
  }
  return {
    restore_point_at: new Date(restorePointMs).toISOString(),
    restore_point_age_hours: Math.round(ageMs / 36e5 * 10) / 10
  };
}

/**
 * Builds the one server-owned request window used by every module in a view rehearsal.
 * The caller must derive the periods from canonical candidate roots, never from a browser.
 */
export function resolveSignalGovernedMultiViewFilterV1(
  periods: readonly SignalGovernedObservedPeriodV1[],
  timezone: string
): SignalFilterV1 {
  if (periods.length === 0 || !timezone.trim()
    || periods.some((period) => !ISO_DATE.test(period.period_start)
      || !ISO_DATE.test(period.period_end)
      || period.period_start > period.period_end)) {
    throw new Error("Backend 06 requires an observed canonical-root date window.");
  }
  const starts = periods.map((period) => period.period_start).sort();
  const ends = periods.map((period) => period.period_end).sort();
  return normalizeSignalFilterV1({
    contract_version: "signal-backend-v1",
    date_range: { start: starts[0]!,end: ends.at(-1)! },
    timezone: timezone.trim(),
    granularity: "month",
    dimensions: {}
  });
}

export function signalGovernedRegistryMatchesFrozenV1(
  frozen: readonly string[],
  registry: readonly string[]
) {
  const normalize = (values: readonly string[]) => [...new Set(values)].sort();
  return JSON.stringify(normalize(frozen)) === JSON.stringify(normalize(registry));
}

export function resolveSignalGovernedBindingResumeV1(args: {
  currentBindingCount: number;
  currentMatchesKnownPromote: boolean;
  ownCompensationProven: boolean;
}) {
  if (args.currentBindingCount === 3 && args.currentMatchesKnownPromote) return "current" as const;
  if (args.currentBindingCount === 0 && args.ownCompensationProven) return "recover" as const;
  throw new Error("Backend 06 refuses an unproven or stale binding resume state.");
}

/**
 * Runs a visible binding phase and compensates only binding sets first created by this
 * invocation. Derived drafts/compilations remain resumable, but no newly exposed binding
 * survives a failed shadow.
 */
export async function runSignalGovernedBindingPhaseWithCompensationV1<View extends string,
  Result, Shadow>(args: {
    views: readonly View[];
    promote(view: View): Promise<{ created_by_invocation: boolean;result: Result }>;
    shadow(): Promise<Shadow>;
    postcondition?(shadow: Shadow): Promise<void>;
    compensate(view: View): Promise<void>;
    onPhase?(phase: { kind: "promoted" | "compensated";view: View }): Promise<void>;
  }) {
  const promoted: Array<{ view: View;created: boolean;result: Result }> = [];
  try {
    for (const view of args.views) {
      const entry = await args.promote(view);
      promoted.push({ view,created: entry.created_by_invocation,result: entry.result });
      await args.onPhase?.({ kind: "promoted",view });
    }
    const shadow = await args.shadow();
    await args.postcondition?.(shadow);
    return { promoted,shadow,compensated: [] as View[] };
  } catch (error) {
    const compensated: View[] = [];
    const compensationErrors: string[] = [];
    for (const entry of [...promoted].reverse()) {
      if (!entry.created) continue;
      try {
        await args.compensate(entry.view);
        compensated.push(entry.view);
        await args.onPhase?.({ kind: "compensated",view: entry.view });
      } catch (compensationError) {
        compensationErrors.push(compensationError instanceof Error
          ? compensationError.message : "unknown compensation error");
      }
    }
    if (compensationErrors.length > 0) {
      throw new AggregateError([error,...compensationErrors.map((message) => new Error(message))],
        "Backend 06 failed and could not fully compensate newly-created bindings.");
    }
    throw error;
  }
}
