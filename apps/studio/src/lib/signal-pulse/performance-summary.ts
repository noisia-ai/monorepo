type JsonRecord = Record<string, unknown>;

export type PulsePerformancePeriodInput = {
  period_id?: unknown;
  label?: unknown;
  spend?: unknown;
  impressions?: unknown;
  clicks?: unknown;
  engagement?: unknown;
  conversions?: unknown;
  records?: unknown;
};

export type PulsePerformanceCampaignInput = {
  entity_name?: unknown;
  campaign_name?: unknown;
  creative_text?: unknown;
  platform?: unknown;
  channel?: unknown;
  spend?: unknown;
  impressions?: unknown;
};

export type PulseOrganicPaidSignalInput = {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  signal_type?: unknown;
  lifecycle_state?: unknown;
  polarity_bucket?: unknown;
  confidence?: unknown;
  volume?: unknown;
  impact_v1?: unknown;
};

export type PulseOrganicPaidCandidate = {
  signalId: string;
  title: string;
  volume: number;
  impact: number;
  rationale: string;
  suggestedTest: string;
  guardrail: string;
  matchedCampaigns: string[];
};

export type PulseReportPeriodInput = {
  id?: unknown;
  label?: unknown;
  coverage?: unknown;
};

export type PulsePerformanceSummary = {
  totals: {
    conversation: number;
    spend: number;
    impressions: number;
    clicks: number;
    engagement: number;
    conversions: number;
    records: number;
  };
  efficiency: {
    ctr: number | null;
    cpm: number | null;
    cpc: number | null;
    costPerConversation: number | null;
  };
  coverage: {
    periods: number;
    periodsWithPerformance: number;
    periodsWithConversation: number;
    spendWithoutConversation: number;
    conversationWithoutSpend: number;
  };
  read: string;
  alerts: string[];
};

export type PulsePerformancePeriodAlignment = {
  period: PulseReportPeriodInput;
  performance: PulsePerformancePeriodInput;
};

export function summarizePulsePerformance(args: {
  periods: PulseReportPeriodInput[];
  performancePeriods: PulsePerformancePeriodInput[];
}): PulsePerformanceSummary {
  const alignedPeriods = alignPulsePerformancePeriods({
    periods: args.periods,
    performancePeriods: args.performancePeriods
  });
  const totals = {
    conversation: 0,
    spend: 0,
    impressions: 0,
    clicks: 0,
    engagement: 0,
    conversions: 0,
    records: 0
  };
  let periodsWithPerformance = 0;
  let periodsWithConversation = 0;
  let spendWithoutConversation = 0;
  let conversationWithoutSpend = 0;

  for (const { period, performance } of alignedPeriods) {
    const coverage = asRecord(period.coverage);
    const conversation = numberFrom(coverage.conversation);
    const spend = numberFrom(performance.spend);
    const records = numberFrom(performance.records);

    totals.conversation += conversation;
    totals.spend += spend;
    totals.impressions += numberFrom(performance.impressions);
    totals.clicks += numberFrom(performance.clicks);
    totals.engagement += numberFrom(performance.engagement);
    totals.conversions += numberFrom(performance.conversions);
    totals.records += records;

    if (conversation > 0) periodsWithConversation += 1;
    if (records > 0 || spend > 0) periodsWithPerformance += 1;
    if (spend > 0 && conversation === 0) spendWithoutConversation += 1;
    if (conversation > 0 && spend === 0) conversationWithoutSpend += 1;
  }

  const efficiency = {
    ctr: totals.impressions > 0 ? round(totals.clicks / totals.impressions, 4) : null,
    cpm: totals.impressions > 0 ? round((totals.spend / totals.impressions) * 1000, 2) : null,
    cpc: totals.clicks > 0 ? round(totals.spend / totals.clicks, 2) : null,
    costPerConversation: totals.conversation > 0 ? round(totals.spend / totals.conversation, 2) : null
  };
  const coverage = {
    periods: args.periods.length,
    periodsWithPerformance,
    periodsWithConversation,
    spendWithoutConversation,
    conversationWithoutSpend
  };

  return {
    totals: {
      ...totals,
      spend: round(totals.spend, 2),
      conversions: round(totals.conversions, 2)
    },
    efficiency,
    coverage,
    read: buildRead({ totals, coverage }),
    alerts: buildAlerts({ coverage, totals })
  };
}

export function buildOrganicPaidCandidates(args: {
  signals: PulseOrganicPaidSignalInput[];
  campaigns: PulsePerformanceCampaignInput[];
  limit?: number;
}): PulseOrganicPaidCandidate[] {
  const campaigns = args.campaigns.map(normalizeCampaign).filter((campaign) => campaign.label);
  const scored = args.signals
    .map((signal) => scoreOrganicSignal(signal, campaigns))
    .filter((candidate): candidate is PulseOrganicPaidCandidate & { score: number } => Boolean(candidate))
    .sort((a, b) => b.score - a.score || b.impact - a.impact || b.volume - a.volume);
  return scored.slice(0, Math.max(1, args.limit ?? 5)).map(stripCandidateScore);
}

export function alignPulsePerformancePeriods(args: {
  periods: PulseReportPeriodInput[];
  performancePeriods: PulsePerformancePeriodInput[];
}): PulsePerformancePeriodAlignment[] {
  const performanceByKey = indexPerformancePeriods(args.performancePeriods);
  return args.periods.map((period) => ({
    period,
    performance: performanceByKey.get(stringValue(period.id)) ?? performanceByKey.get(stringValue(period.label)) ?? {}
  }));
}

function indexPerformancePeriods(periods: PulsePerformancePeriodInput[]) {
  const index = new Map<string, PulsePerformancePeriodInput>();
  for (const period of periods) {
    addIndexKey(index, period.period_id, period);
    addIndexKey(index, period.label, period);
  }
  return index;
}

function addIndexKey(index: Map<string, PulsePerformancePeriodInput>, key: unknown, period: PulsePerformancePeriodInput) {
  const normalized = stringValue(key);
  if (normalized) index.set(normalized, period);
}

function buildRead(args: {
  totals: PulsePerformanceSummary["totals"];
  coverage: PulsePerformanceSummary["coverage"];
}) {
  if (args.totals.records === 0) {
    return "Todavía no hay performance estructurada suficiente para comparar inversión contra conversación.";
  }
  if (args.coverage.spendWithoutConversation > 0) {
    return "Hay periodos con inversión pero sin conversación capturada: conviene revisar cobertura antes de leer eficiencia.";
  }
  if (args.coverage.conversationWithoutSpend > 0) {
    return "Hay conversación sin inversión registrada: puede ser tracción orgánica o falta de archivo paid/organic.";
  }
  return "La comparación está lista para lectura táctica: inversión, alcance y conversación viven en datos estructurados.";
}

function buildAlerts(args: {
  coverage: PulsePerformanceSummary["coverage"];
  totals: PulsePerformanceSummary["totals"];
}) {
  const alerts: string[] = [];
  if (args.totals.records === 0) alerts.push("Sube performance de 12 meses para activar lectura paid/organic.");
  if (args.coverage.periodsWithPerformance < args.coverage.periods) {
    alerts.push(`${args.coverage.periodsWithPerformance}/${args.coverage.periods} periodos tienen performance estructurada.`);
  }
  if (args.coverage.spendWithoutConversation > 0) {
    alerts.push(`${args.coverage.spendWithoutConversation} periodos tienen spend sin conversación incluida.`);
  }
  if (args.coverage.conversationWithoutSpend > 0) {
    alerts.push(`${args.coverage.conversationWithoutSpend} periodos tienen conversación sin spend registrado.`);
  }
  return alerts.slice(0, 4);
}

function scoreOrganicSignal(signal: PulseOrganicPaidSignalInput, campaigns: Array<{ label: string; tokens: Set<string> }>) {
  const title = stringValue(signal.title).trim();
  if (!title) return null;
  const volume = numberFrom(signal.volume);
  const impact = numberFrom(signal.impact_v1);
  if (volume <= 0 && impact <= 0) return null;

  const polarity = stringValue(signal.polarity_bucket).toLowerCase();
  const confidence = stringValue(signal.confidence).toLowerCase();
  const lifecycle = stringValue(signal.lifecycle_state).toLowerCase();
  const type = stringValue(signal.signal_type).toLowerCase();
  const normalizedTitleTokens = tokensFor(`${title} ${stringValue(signal.description)}`);
  const matchedCampaigns = campaigns
    .filter((campaign) => intersects(normalizedTitleTokens, campaign.tokens))
    .map((campaign) => campaign.label)
    .slice(0, 3);
  const isRisk = polarity.includes("neg") || type.includes("risk") || type.includes("barrier");
  const confidenceScore = confidence.includes("alta") || confidence.includes("high")
    ? 18
    : confidence.includes("media") || confidence.includes("medium")
      ? 12
      : 5;
  const lifecycleScore = lifecycle.includes("accelerating") || lifecycle.includes("creciendo") || lifecycle.includes("emerging")
    ? 14
    : lifecycle.includes("new") || lifecycle.includes("nueva")
      ? 10
      : 4;
  const score = impact * 0.55 + Math.min(volume, 500) * 0.06 + confidenceScore + lifecycleScore - (isRisk ? 18 : 0) - matchedCampaigns.length * 4;
  if (score <= 0) return null;

  return {
    signalId: stringValue(signal.id) || title,
    title,
    volume: round(volume, 2),
    impact: round(impact, 2),
    rationale: matchedCampaigns.length > 0
      ? `Ya aparece cerca de ${matchedCampaigns[0]}; conviene probar una variante antes de escalar.`
      : "Tiene tracción orgánica suficiente y no aparece claramente cubierta por campañas activas.",
    suggestedTest: isRisk
      ? "Usar pauta de bajo riesgo para validar un mensaje de contención o aclaración."
      : lifecycle.includes("accelerating") || lifecycle.includes("creciendo")
        ? "Convertir la señal en un claim corto y testearlo contra la pieza actual."
        : "Probar un hook de contenido con audiencia pequeña antes de mover inversión fuerte.",
    guardrail: confidence.includes("baja") || confidence.includes("low")
      ? "Mantener presupuesto pequeño: la señal todavía es direccional."
      : "Comparar CTR, costo por conversación y comentarios cualitativos contra la base anterior.",
    matchedCampaigns,
    score
  };
}

function stripCandidateScore(candidate: PulseOrganicPaidCandidate & { score: number }): PulseOrganicPaidCandidate {
  return {
    signalId: candidate.signalId,
    title: candidate.title,
    volume: candidate.volume,
    impact: candidate.impact,
    rationale: candidate.rationale,
    suggestedTest: candidate.suggestedTest,
    guardrail: candidate.guardrail,
    matchedCampaigns: candidate.matchedCampaigns
  };
}

function normalizeCampaign(campaign: PulsePerformanceCampaignInput) {
  const label = stringValue(campaign.entity_name) || stringValue(campaign.campaign_name) || stringValue(campaign.creative_text).slice(0, 80);
  return {
    label,
    tokens: tokensFor(`${label} ${stringValue(campaign.creative_text)} ${stringValue(campaign.platform)} ${stringValue(campaign.channel)}`)
  };
}

function tokensFor(value: string) {
  const stopwords = new Set(["para", "con", "por", "una", "uno", "los", "las", "del", "que", "the", "and", "from", "this", "that", "signal", "pulse"]);
  return new Set(value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !stopwords.has(token)));
}

function intersects(a: Set<string>, b: Set<string>) {
  for (const token of a) {
    if (b.has(token)) return true;
  }
  return false;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function numberFrom(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
