export type AnalysisStudySize = "small" | "medium" | "large" | "full_power";

export type AnalysisStudyPlan = {
  size: AnalysisStudySize;
  label: string;
  coveragePct: number;
  mentionLimit: number;
  estimatedMentions: number;
  estimatedCostUsd: number;
  isAutoFull: boolean;
};

export const ANALYSIS_COST_PER_MENTION_USD = 0.00125;
export const AUTO_FULL_THRESHOLD = 5000;

const PLAN_CONFIG: Record<AnalysisStudySize, { label: string; coveragePct: number; mentionLimit: number }> = {
  small: { label: "Small", coveragePct: 0.15, mentionLimit: 5000 },
  medium: { label: "Medium", coveragePct: 0.25, mentionLimit: 20000 },
  large: { label: "Large", coveragePct: 0.45, mentionLimit: 50000 },
  full_power: { label: "Full Power", coveragePct: 1, mentionLimit: 100000 }
};

export const ANALYSIS_STUDY_SIZES = (Object.keys(PLAN_CONFIG) as AnalysisStudySize[]).map((size) => ({
  size,
  ...PLAN_CONFIG[size]
}));

export function resolveAnalysisStudyPlan(args: {
  corpusMentions: number;
  requestedSize?: AnalysisStudySize;
}): AnalysisStudyPlan {
  const corpusMentions = Math.max(0, Math.floor(args.corpusMentions));
  const requestedSize = args.requestedSize ?? "medium";

  if (corpusMentions <= AUTO_FULL_THRESHOLD) {
    return {
      size: "full_power",
      label: "Full auto",
      coveragePct: 1,
      mentionLimit: AUTO_FULL_THRESHOLD,
      estimatedMentions: corpusMentions,
      estimatedCostUsd: estimateAnalysisCost(corpusMentions),
      isAutoFull: true
    };
  }

  const config = PLAN_CONFIG[requestedSize];
  const estimatedMentions = Math.min(
    corpusMentions,
    config.mentionLimit,
    Math.max(1, Math.round(corpusMentions * config.coveragePct))
  );

  return {
    size: requestedSize,
    label: config.label,
    coveragePct: config.coveragePct,
    mentionLimit: config.mentionLimit,
    estimatedMentions,
    estimatedCostUsd: estimateAnalysisCost(estimatedMentions),
    isAutoFull: false
  };
}

export function estimateAnalysisCost(mentions: number) {
  return Math.round(Math.max(0, mentions) * ANALYSIS_COST_PER_MENTION_USD * 100) / 100;
}
