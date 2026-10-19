export type AcquisitionSlotIdentity = {
  slot_key: string;
  label: string;
  scope: "primary_brand" | "competitor" | "category" | "reference";
  desired_state: "active" | "retired";
  plan_status: "current" | "draft" | "retired";
  plan_version: number;
};
export type AcquisitionSlotView<T extends AcquisitionSlotIdentity> = {
  slotKey: string; label: string; scope: T["scope"]; current: T | null; draft: T | null;
};

export function buildAcquisitionSlotViews<T extends AcquisitionSlotIdentity>(selected: T[], currentSlots: T[] = []) {
  const views = new Map<string, AcquisitionSlotView<T>>();
  for (const slot of [...currentSlots, ...selected]) {
    const view = views.get(slot.slot_key) ?? {
      slotKey: slot.slot_key, label: slot.label, scope: slot.scope, current: null, draft: null
    };
    view.label = slot.label; view.scope = slot.scope;
    if (slot.plan_status === "draft") view.draft = slot;
    if (slot.plan_status === "current") view.current = slot;
    views.set(slot.slot_key, view);
  }
  const rank = { primary_brand: 0, category: 1, competitor: 2, reference: 3 };
  return [...views.values()].sort((left, right) => rank[left.scope] - rank[right.scope] || left.label.localeCompare(right.label));
}

export function acquisitionSlotActions(args: {
  current: AcquisitionSlotIdentity | null;
  importAttempts: number;
  readyForImport: boolean;
  hasActiveSource: boolean;
}) {
  return {
    showHistory: Boolean(args.current) || args.importAttempts > 0,
    showImport: args.current?.desired_state === "active",
    canImport: args.current?.desired_state === "active" && args.readyForImport && args.hasActiveSource
  };
}

export function groupAcquisitionBlockers(blockers: string[]) {
  const grouped = new Map<string, { code: string; count: number }>();
  for (const blocker of blockers) {
    const code = blocker.split(":")[0]!;
    const key = ["slot_reconcile_required", "slot_authority_stale"].includes(code) ? code : blocker;
    const entry = grouped.get(key) ?? { code: key, count: 0 };
    entry.count++; grouped.set(key, entry);
  }
  return [...grouped.values()];
}
