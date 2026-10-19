export function engineLensParamsFromTbMeta(metaJson: unknown) {
  const meta = asRecord(metaJson);
  const analysisSample = asRecord(meta.analysis_sample);
  const targetMentions = positiveInteger(analysisSample.target_mentions);
  if (!targetMentions) return {};
  return {
    max_units: targetMentions,
    budget_source: "tb_analysis_sample",
    study_size: typeof analysisSample.resolved_study_size === "string" ? analysisSample.resolved_study_size : null,
    sampling_strategy: typeof analysisSample.strategy === "string" ? analysisSample.strategy : null
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function positiveInteger(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.floor(number);
}
