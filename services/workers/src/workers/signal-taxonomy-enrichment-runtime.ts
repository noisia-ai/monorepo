import type { JobsOptions } from "bullmq";

export const SIGNAL_TAXONOMY_ENRICHMENT_RETIRED_REASON =
  "signal_taxonomy_enrichment_retired_10b" as const;

/**
 * Gate 10B permanent kill switch. Environment flags and provider keys cannot
 * reactivate the full-pop provider drain. Kept as a function for compatibility
 * with callers that render historical readiness.
 */
export function isSignalTaxonomyEnrichmentEnabled(
  _env: Record<string, string | undefined> = process.env
) {
  return false;
}

export function isSignalTaxonomyLlmEnabled(
  _env: Record<string, string | undefined> = process.env
) {
  return false;
}

/** @deprecated The legacy job is retired and cannot be enqueued. */
export function buildSignalTaxonomyEnrichmentOptions(_jobId: string): JobsOptions {
  throw new SignalTaxonomyEnrichmentRetiredError();
}

export class SignalTaxonomyEnrichmentRetiredError extends Error {
  readonly code = SIGNAL_TAXONOMY_ENRICHMENT_RETIRED_REASON;

  constructor() {
    super(SIGNAL_TAXONOMY_ENRICHMENT_RETIRED_REASON);
    this.name = "SignalTaxonomyEnrichmentRetiredError";
  }
}

export function assertSignalTaxonomyJobNotRetiredV1(jobName: string) {
  if (jobName === "signal.taxonomy-enrichment.v1") {
    throw new SignalTaxonomyEnrichmentRetiredError();
  }
}
