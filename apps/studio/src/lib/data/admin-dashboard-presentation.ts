import type { AdminBrandWorkspaceRow } from "./admin-workspace";
import { adminCorpusNeedsImport, adminCorpusState } from "./admin-corpus-presentation";

/** Sum workspace receipts, never the operational primary-brand population.
 * Unknown/partial measurements remain explicit; roots are not deduped across workspaces. */
export function adminDashboardCorpusTotals(brands: AdminBrandWorkspaceRow[]) {
  let received = 0, measured = 0, acceptedFiles = 0, recordsRead = 0, incompleteReceiptBrands = 0;
  for (const { corpus } of brands) {
    if (corpus?.received_unique_roots != null) { received += corpus.received_unique_roots; measured++; }
    if (!corpus || corpus.measurement_state !== "complete") incompleteReceiptBrands++;
    if (corpus) { acceptedFiles += corpus.accepted_files; recordsRead += corpus.records_read; }
  }
  return { receivedMentions: measured || brands.length === 0 ? received : null,
    acceptedFiles, recordsRead, incompleteReceiptBrands };
}
export function adminDashboardReceiptPriority(brand: AdminBrandWorkspaceRow) {
  const corpus = brand.corpus, state = adminCorpusState(corpus);
  if (state === "unavailable") return { code: "receipt_unavailable", state: "not_available" as const };
  if (state === "needs_attention") return { code: "receipt_attention", state: "warning" as const };
  if (state === "partial") return { code: "receipt_partial", state: "warning" as const };
  if (adminCorpusNeedsImport(corpus)) return { code: "receipt_empty", state: "not_available" as const };
  return null;
}
export function adminDashboardNeedsAttention(brand: AdminBrandWorkspaceRow) {
  return !brand.workspaceId || adminDashboardReceiptPriority(brand) !== null
    || ["danger", "warning"].includes(brand.freshnessState)
    || ["danger", "warning"].includes(brand.qualityState) || brand.reportsNeedingReview > 0;
}
