export type MfpFacetRunObservation = { workspace_id: string; id: string; status: string };

/** A terminal transition invalidates dependent reads once, never a paid intent. */
export function mfpFacetTerminalReceipt(previous: MfpFacetRunObservation | null, next: MfpFacetRunObservation | null) {
  if (!previous || !next || previous.workspace_id !== next.workspace_id
    || !["completed", "failed", "canceled"].includes(next.status)
    || previous.id === next.id && previous.status === next.status) return null;
  return `${next.workspace_id}:${next.id}:${next.status}`;
}
