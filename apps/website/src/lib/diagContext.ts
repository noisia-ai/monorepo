const KEY = "noisia-diag-ctx";
const TTL_MS = 48 * 60 * 60 * 1000; // 48h

export type DiagContext = {
  wizardSituation?: string;  // label from MethodologyWizard
  caseSlug?: string;         // slug from UseCaseSelector / case detail
  timestamp: number;
};

export function saveDiagContext(patch: Omit<DiagContext, "timestamp">): void {
  if (typeof window === "undefined") return;
  try {
    const prev = readDiagContext() ?? ({} as Partial<DiagContext>);
    const next: DiagContext = { ...prev, ...patch, timestamp: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
}

export function readDiagContext(): DiagContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const ctx = JSON.parse(raw) as DiagContext;
    if (Date.now() - ctx.timestamp > TTL_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return ctx;
  } catch {
    return null;
  }
}

export function clearDiagContext(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
