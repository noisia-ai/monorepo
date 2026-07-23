export type AnalysisArtifactReviewAction = "accept" | "correct" | "limit" | "reject";

export type AnalysisArtifactReviewPatch = {
  title?: string | null;
  summary?: string | null;
  content?: unknown;
  confidence?: string | null;
  metadata?: Record<string, unknown>;
};

export type AnalysisArtifactReviewResult = {
  artifact_id: string;
  previous_artifact_id: string | null;
  review_status: "accepted" | "corrected" | "limited" | "rejected";
  revision: number;
  created_revision: boolean;
};

export function planAnalysisArtifactReview(args: {
  action: AnalysisArtifactReviewAction;
  published: boolean;
}) {
  const nextStatus = {
    accept: "accepted",
    correct: "corrected",
    limit: "limited",
    reject: "rejected"
  }[args.action] as AnalysisArtifactReviewResult["review_status"];
  return {
    nextStatus,
    createRevision: args.published || args.action === "correct" || args.action === "limit"
  };
}
