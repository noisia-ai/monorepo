import { z } from "zod";

export const WORKSPACE_MANUAL_IMPORT_SETUP_VERSION = "signal-workspace-manual-import-setup-v1" as const;

const inputSchema = z.object({
  contract_version: z.literal(WORKSPACE_MANUAL_IMPORT_SETUP_VERSION),
  provider: z.literal("sentione"),
  source_name: z.string().trim().min(2).max(240),
  category_name: z.string().trim().min(2).max(240),
  rights: z.object({
    storage_and_analysis: z.literal(true),
    external_ai_processing: z.boolean(),
    retention_until: z.string().datetime({ offset: true }).nullable()
  }).strict()
}).strict();

export type WorkspaceManualImportSetupInputV1 = z.infer<typeof inputSchema>;

export function validateWorkspaceManualImportSetupInputV1(value: unknown, now = Date.now()) {
  const input = inputSchema.parse(value);
  if (input.rights.retention_until !== null && Date.parse(input.rights.retention_until) <= now) {
    throw new Error("retention_must_be_future");
  }
  return input;
}

/** A source's permission declaration does not grant permission to any other source. */
export function manualImportUsageDecisionsV1(input: WorkspaceManualImportSetupInputV1) {
  return [
    { usage_purpose: "internal-qa", decision: "allowed" },
    { usage_purpose: "client-derived-metrics", decision: "allowed" },
    { usage_purpose: "client-mention-list", decision: "allowed" },
    { usage_purpose: "client-text-or-excerpt", decision: "allowed" },
    { usage_purpose: "llm-processing", decision: input.rights.external_ai_processing ? "allowed" : "prohibited" },
    { usage_purpose: "strategic-analysis", decision: "not_available" }
  ] as const;
}
