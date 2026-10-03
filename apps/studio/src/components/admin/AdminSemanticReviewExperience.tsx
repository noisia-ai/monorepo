import { SemanticReviewQueue } from "@/components/admin/SemanticReviewQueue";
import type { AdminWorkspaceSource } from "@/lib/data/admin-workspace";

type AdminSemanticReviewExperienceProps = {
  sources: AdminWorkspaceSource[];
  workspaceId: string;
};

export function AdminSemanticReviewExperience({
  sources,
  workspaceId
}: AdminSemanticReviewExperienceProps) {
  return (
    <SemanticReviewQueue
      sources={sources}
      workspaceId={workspaceId}
    />
  );
}
