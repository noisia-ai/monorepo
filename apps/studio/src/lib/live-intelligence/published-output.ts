export type PublishedOutputLiveIntelligence = {
  status: string;
  signals: number;
  observations: number;
  evidence: number;
  mappings: unknown[];
};

export function attachLiveIntelligenceLinksToPayload<TPayload extends Record<string, unknown>>(
  payload: TPayload,
  liveIntelligence: PublishedOutputLiveIntelligence
) {
  return {
    ...payload,
    live_intelligence: {
      status: liveIntelligence.status,
      signals: liveIntelligence.signals,
      observations: liveIntelligence.observations,
      evidence: liveIntelligence.evidence,
      finding_links: liveIntelligence.mappings
    }
  };
}
