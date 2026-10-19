export type BrandDeleteDisposition =
  | "archive"
  | "archive_required"
  | "permanent"
  | "workspace_owned_blocked";

export function resolveBrandDeleteDisposition(input: {
  permanent: boolean;
  status: string;
  corporaCount: number;
  workspaceCount: number;
}): BrandDeleteDisposition {
  if (input.workspaceCount > 0) {
    return input.permanent ? "workspace_owned_blocked" : "archive";
  }
  if (input.permanent) {
    return input.status === "archived" ? "permanent" : "archive_required";
  }
  return input.corporaCount > 0 ? "archive" : "permanent";
}
