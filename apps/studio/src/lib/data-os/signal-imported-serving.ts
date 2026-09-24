import type { ResolvedSignalWorkspace } from "./signal-workspace";

/** Only the authenticated workspace resolver may choose this source. Existing
 * corpus bindings (including ambiguous ones) keep their serving/rights path. */
export function allowImportedSignalFallbackV1(workspace: Pick<ResolvedSignalWorkspace, "corpora">): boolean {
  return !workspace.corpora.some(corpus => corpus.role === "operational" || corpus.role === "legacy");
}
