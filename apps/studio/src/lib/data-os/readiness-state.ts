export type DataOsReadinessStatus = "ready" | "building" | "attention" | "empty" | "unavailable";

export function resolveReadinessOverall(
  stages: Array<{ status: DataOsReadinessStatus }>,
  blockers: string[]
): DataOsReadinessStatus {
  if (stages.some((stage) => stage.status === "unavailable")) return "unavailable";
  if (blockers.length > 0 || stages.some((stage) => stage.status === "attention")) return "attention";
  return stages.every((stage) => stage.status === "ready") ? "ready" : "building";
}
