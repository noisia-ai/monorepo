import type { DataOsCorpusAudit, DataOsCorpusAuditStage } from "@noisia/query-engine";

const AUDIT_META_KEYS: Record<DataOsCorpusAuditStage, string> = {
  pre_analysis: "data_os_preflight",
  post_coding: "data_os_post_coding",
  release: "data_os_release"
};

export function dataOsAuditGateName(stage: DataOsCorpusAuditStage): string {
  return `data_os_${stage}`;
}

export function dataOsAuditMetaKey(stage: DataOsCorpusAuditStage): string {
  return AUDIT_META_KEYS[stage];
}

export function summarizeCorpusDataOsAudit(audit: DataOsCorpusAudit) {
  return {
    contract: audit.contract,
    stage: audit.stage,
    status: audit.status,
    ready: audit.ready_for_claude,
    blocker_codes: audit.blockers.map((issue) => issue.code),
    warning_codes: audit.warnings.map((issue) => issue.code)
  };
}

export function assertCorpusDataOsAuditReady(
  audit: DataOsCorpusAudit,
  context = "Data OS"
): void {
  if (audit.ready_for_claude) return;
  const blockers = audit.blockers
    .map((issue) => `${issue.code}: ${issue.message}`)
    .join(" | ");
  throw new Error(`${context} blocked (${audit.stage}): ${blockers || "contract checks failed"}`);
}
