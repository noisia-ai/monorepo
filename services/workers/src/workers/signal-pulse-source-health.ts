export type SignalPulseSourceHealth = {
  expected_months: number;
  performance: {
    records: number;
    months_with_records: number;
    missing_months_estimate: number;
    source_types: string[];
    providers: string[];
    channels: string[];
    has_paid: boolean;
    has_organic: boolean;
  };
  knowledge: {
    sources: number;
    semantic_chunks: number;
    marketing_brief_signals: number;
    ready: boolean;
  };
  conversation: {
    semantic_mentions: number;
    semantic_available: boolean;
    ready: boolean;
  };
  gaps: string[];
};

type SourceHealthPerformanceMonth = {
  month: string;
  records: number;
  channels: string[];
  [key: string]: unknown;
};

type SourceHealthStructuredSourceMonth = {
  month: string;
  source_type: string;
  provider: string;
  channel: string;
  records: number;
  [key: string]: unknown;
};

export function buildSignalPulseSourceHealth(args: {
  expectedMonths: number;
  knowledgeSources: number;
  marketingBrief: Record<string, unknown>;
  performanceWindow: SourceHealthPerformanceMonth[];
  structuredSourceWindow: SourceHealthStructuredSourceMonth[];
  semanticCoverage: { semanticMentions: number; semanticKnowledgeChunks: number };
  semanticAvailable: boolean;
}): SignalPulseSourceHealth {
  const expectedMonths = Math.max(1, Math.min(36, Math.floor(args.expectedMonths || 12)));
  const performanceMonths = new Set(args.performanceWindow.filter((month) => month.records > 0).map((month) => month.month));
  const sourceTypes = uniqueStrings(args.structuredSourceWindow.map((source) => source.source_type)).slice(0, 16);
  const providers = uniqueStrings(args.structuredSourceWindow.map((source) => source.provider)).slice(0, 16);
  const channels = uniqueStrings([
    ...args.performanceWindow.flatMap((month) => month.channels),
    ...args.structuredSourceWindow.map((source) => source.channel)
  ]).slice(0, 16);
  const marketingBriefSignals = countMarketingBriefSignals(args.marketingBrief);
  const knowledgeReady = args.knowledgeSources > 0 || marketingBriefSignals >= 2;
  const semanticReady = args.semanticAvailable && args.semanticCoverage.semanticMentions > 0;
  const performanceRecords = args.performanceWindow.reduce((sum, month) => sum + month.records, 0);
  const hasPaid = channels.some((channel) => normalizeSourceHealthValue(channel) === "paid");
  const hasOrganic = channels.some((channel) => normalizeSourceHealthValue(channel) === "organic");
  const gaps: string[] = [];

  if (performanceRecords === 0) gaps.push("missing_performance_records");
  if (performanceMonths.size > 0 && performanceMonths.size < expectedMonths) gaps.push("partial_performance_window");
  if (!hasPaid) gaps.push("missing_paid_source");
  if (!hasOrganic) gaps.push("missing_organic_source");
  if (!knowledgeReady) gaps.push("missing_knowledge_context");
  if (!args.semanticAvailable) gaps.push("missing_embedding_provider");
  if (args.semanticAvailable && args.semanticCoverage.semanticMentions === 0) gaps.push("missing_semantic_mention_embeddings");
  if (args.knowledgeSources > 0 && args.semanticCoverage.semanticKnowledgeChunks === 0) gaps.push("missing_semantic_knowledge_embeddings");
  if (sourceTypes.length === 0) gaps.push("missing_structured_source_types");

  return {
    expected_months: expectedMonths,
    performance: {
      records: performanceRecords,
      months_with_records: performanceMonths.size,
      missing_months_estimate: Math.max(0, expectedMonths - performanceMonths.size),
      source_types: sourceTypes,
      providers,
      channels,
      has_paid: hasPaid,
      has_organic: hasOrganic
    },
    knowledge: {
      sources: args.knowledgeSources,
      semantic_chunks: args.semanticCoverage.semanticKnowledgeChunks,
      marketing_brief_signals: marketingBriefSignals,
      ready: knowledgeReady
    },
    conversation: {
      semantic_mentions: args.semanticCoverage.semanticMentions,
      semantic_available: args.semanticAvailable,
      ready: semanticReady
    },
    gaps
  };
}

function countMarketingBriefSignals(value: unknown) {
  const seen = new Set<string>();
  const visit = (item: unknown, prefix: string) => {
    if (typeof item === "string") {
      if (item.trim().replace(/\s+/g, " ").length >= 20) seen.add(prefix);
      return;
    }
    if (Array.isArray(item)) {
      if (item.some((entry) => typeof entry === "string" && entry.trim().length >= 8)) seen.add(prefix);
      item.slice(0, 12).forEach((entry, index) => visit(entry, `${prefix}.${index}`));
      return;
    }
    if (item && typeof item === "object") {
      for (const [key, nested] of Object.entries(item as Record<string, unknown>)) {
        visit(nested, prefix ? `${prefix}.${key}` : key);
      }
    }
  };
  visit(value, "marketing_brief");
  return seen.size;
}

function uniqueStrings(values: unknown[]) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function normalizeSourceHealthValue(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}
