type AnalysisProgressState = {
  analysis: {
    status: string;
  };
  steps: Array<{
    step: string;
    status: string;
  }>;
};

export function computeAnalysisProgress(
  state: AnalysisProgressState | null,
  pipelineStepIds: readonly string[]
) {
  if (!state) return 0;
  if (state.analysis.status === "needs_review" || state.analysis.status.startsWith("approved")) {
    return 100;
  }

  const completed = new Set(
    state.steps
      .filter((step) => step.status === "completed" || step.status === "skipped")
      .map((step) => step.step)
  );
  let count = 1; // corpus approved
  for (const stepId of pipelineStepIds.slice(0, -1)) {
    if (completed.has(stepId)) count += 1;
  }
  return Math.max(8, Math.min(96, Math.round((count / pipelineStepIds.length) * 100)));
}
