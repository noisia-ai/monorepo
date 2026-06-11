export type SelectedEngineLaunchOptions = {
  launchSurface?: string;
  resultMetaKey?: string;
  triggerReason?: string;
};

const DEFAULT_LAUNCH_SURFACE = "tb_quality_gates_auto_selected_lenses";
const DEFAULT_RESULT_META_KEY = "selected_engine_lenses_after_tb";

export function resolveSelectedEngineLaunchOptions(options: SelectedEngineLaunchOptions = {}) {
  return {
    launchSurface: options.launchSurface?.trim() || DEFAULT_LAUNCH_SURFACE,
    resultMetaKey: options.resultMetaKey?.trim() || DEFAULT_RESULT_META_KEY,
    triggerReason: options.triggerReason?.trim() || null
  };
}

export function isCompletedEngineAnalysisUsable(analysis: {
  retrieved_units: number;
  coding_provider: string | null;
  coding_fixture: boolean | null;
}) {
  return analysis.retrieved_units > 0 &&
    analysis.coding_provider === "anthropic" &&
    analysis.coding_fixture === false;
}
