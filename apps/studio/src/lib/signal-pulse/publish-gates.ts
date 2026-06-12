export type SignalPulseGate = {
  id: string;
  passed: boolean;
  detail: string;
};

export const SIGNAL_PULSE_PUBLISH_BLOCKER_GATES = new Set([
  "source_presence",
  "period_coverage",
  "period_comparability",
  "performance_structured",
  "signal_min_evidence",
  "chart_data_available",
  "move_has_signal",
  "cost_within_budget",
  "no_invented_numbers"
]);

export function validateSignalPulsePublishReadiness(metaJson: unknown):
  | { ok: true; checks: SignalPulseGate[] }
  | {
      ok: false;
      error: "signal_pulse_gates_failed" | "signal_pulse_gates_missing";
      message: string;
      failedChecks: Array<{ id: string; detail: string }>;
      checks: SignalPulseGate[];
    } {
  const meta = asRecord(metaJson);
  const checks = Array.isArray(meta.quality_gates)
    ? meta.quality_gates.map(normalizeSignalPulseGate).filter((gate): gate is SignalPulseGate => Boolean(gate))
    : [];
  if (checks.length === 0) {
    return {
      ok: false,
      error: "signal_pulse_gates_missing",
      message: "Faltan quality gates de Signal Pulse antes de publicar.",
      failedChecks: [],
      checks
    };
  }
  const failedChecks = checks
    .filter((gate) => SIGNAL_PULSE_PUBLISH_BLOCKER_GATES.has(gate.id) && !gate.passed)
    .map((gate) => ({ id: gate.id, detail: gate.detail }));
  if (failedChecks.length > 0) {
    return {
      ok: false,
      error: "signal_pulse_gates_failed",
      message: "Signal Pulse no puede publicarse con blockers activos.",
      failedChecks,
      checks
    };
  }
  return { ok: true, checks };
}

function normalizeSignalPulseGate(value: unknown) {
  const gate = asRecord(value);
  const id = typeof gate.id === "string" ? gate.id : "";
  if (!id) return null;
  return {
    id,
    passed: gate.passed === true,
    detail: typeof gate.detail === "string" ? gate.detail : ""
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
