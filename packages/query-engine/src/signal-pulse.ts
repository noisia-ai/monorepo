export type SignalPulsePeriod = {
  periodStart: string;
  periodEnd: string;
  label: string;
};

export type ImpactV1Input = {
  volumeNorm: number;
  engagementNorm: number;
  recency: number;
  sourceDiversity: number;
  temporalConsistency: number;
};

export type SignalPulseLifecycle = "new" | "emerging" | "reappeared" | "accelerating" | "mature" | "declining" | "dormant" | "volatile";

export type SignalPulseKnowledgeContextAssessment = {
  knowledgeSources: number;
  marketingBriefSignals: number;
  marketingBriefCategories: string[];
  minimumBriefSignals: number;
  minimumBriefCategories: number;
  knowledgeContextReady: boolean;
  reasons: string[];
};

const SIGNAL_PULSE_BRIEF_SIGNAL_KEYS = new Set([
  "active_campaigns",
  "audience_segment",
  "audiences",
  "background",
  "brand_context",
  "brand_tone",
  "business_question",
  "campaign_results",
  "campaigns",
  "campaign_calendar",
  "category_context",
  "claims",
  "allowed_claims",
  "claims_allowed",
  "claims_prohibited",
  "competitive_context",
  "competitors",
  "context",
  "creative_territories",
  "ecomm",
  "ecommerce",
  "key_dates",
  "legal_constraints",
  "marketing_objective",
  "marketing_objectives",
  "monthly_brief",
  "objective",
  "objectives",
  "organic_activity",
  "paid_activity",
  "performance_notes",
  "prohibited_claims",
  "reviews",
  "results",
  "sales",
  "search",
  "search_data",
  "target_audience",
  "territories",
  "tone"
]);

const SIGNAL_PULSE_BRIEF_CATEGORY_KEYS: Record<string, string> = {
  active_campaigns: "marketing_activity",
  audience_segment: "audience_calendar_results",
  audiences: "audience_calendar_results",
  background: "brand_market_context",
  brand_context: "brand_market_context",
  brand_tone: "brand_market_context",
  business_question: "business_objective",
  campaign_calendar: "audience_calendar_results",
  campaign_results: "audience_calendar_results",
  campaigns: "marketing_activity",
  category_context: "brand_market_context",
  claims: "marketing_activity",
  allowed_claims: "marketing_activity",
  claims_allowed: "marketing_activity",
  claims_prohibited: "marketing_activity",
  competitive_context: "brand_market_context",
  competitors: "brand_market_context",
  context: "brand_market_context",
  creative_territories: "marketing_activity",
  ecomm: "audience_calendar_results",
  ecommerce: "audience_calendar_results",
  key_dates: "audience_calendar_results",
  legal_constraints: "marketing_activity",
  marketing_objective: "business_objective",
  marketing_objectives: "business_objective",
  monthly_brief: "business_objective",
  objective: "business_objective",
  objectives: "business_objective",
  organic_activity: "marketing_activity",
  paid_activity: "marketing_activity",
  performance_notes: "audience_calendar_results",
  prohibited_claims: "marketing_activity",
  reviews: "audience_calendar_results",
  results: "audience_calendar_results",
  sales: "audience_calendar_results",
  search: "audience_calendar_results",
  search_data: "audience_calendar_results",
  target_audience: "audience_calendar_results",
  territories: "marketing_activity",
  tone: "brand_market_context"
};

const SIGNAL_PULSE_BRIEF_IGNORED_KEYS = new Set([
  "budget_cap_usd",
  "review_mode",
  "target_window_months",
  "window_months"
]);

export function buildMonthlyReportPeriods(args: {
  windowEnd: string | Date;
  months: number;
}): SignalPulsePeriod[] {
  const months = Math.max(1, Math.min(36, Math.floor(args.months)));
  const end = toUtcDate(args.windowEnd);
  const endMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  const periods: SignalPulsePeriod[] = [];

  for (let index = months - 1; index >= 0; index -= 1) {
    const start = new Date(Date.UTC(endMonth.getUTCFullYear(), endMonth.getUTCMonth() - index, 1));
    const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const periodEnd = new Date(next.getTime() - 24 * 60 * 60 * 1000);
    periods.push({
      periodStart: isoDate(start),
      periodEnd: isoDate(periodEnd),
      label: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`
    });
  }

  return periods;
}

export function buildWeeklyReportPeriods(args: {
  windowEnd: string | Date;
  weeks: number;
}): SignalPulsePeriod[] {
  const weeks = Math.max(1, Math.min(156, Math.floor(args.weeks)));
  const end = toUtcDate(args.windowEnd);
  const endWeekStart = startOfIsoWeek(end);
  const periods: SignalPulsePeriod[] = [];

  for (let index = weeks - 1; index >= 0; index -= 1) {
    const start = addDays(endWeekStart, -7 * index);
    const periodEnd = addDays(start, 6);
    const isoWeek = isoWeekLabel(start);
    periods.push({
      periodStart: isoDate(start),
      periodEnd: isoDate(periodEnd),
      label: isoWeek
    });
  }

  return periods;
}

export function calculateImpactV1(input: ImpactV1Input): number {
  const score = 100 * (
    0.35 * clamp01(input.volumeNorm) +
    0.25 * clamp01(input.engagementNorm) +
    0.15 * clamp01(input.recency) +
    0.15 * clamp01(input.sourceDiversity) +
    0.10 * clamp01(input.temporalConsistency)
  );
  return Math.round(score * 100) / 100;
}

export function classifySignalPulseLifecycle(args: {
  currentVolume: number;
  previousVolume?: number | null;
  periodsSeen: number;
  volatility?: number | null;
}): SignalPulseLifecycle {
  const current = Math.max(0, args.currentVolume);
  const previous = Math.max(0, args.previousVolume ?? 0);
  const periodsSeen = Math.max(0, args.periodsSeen);
  const volatility = Math.max(0, args.volatility ?? 0);

  if (current === 0) return "dormant";
  if (volatility >= 0.7 && periodsSeen >= 3) return "volatile";
  if (previous === 0 && periodsSeen <= 1) return "new";
  if (previous === 0 && periodsSeen > 1) return "reappeared";
  if (previous === 0) return "emerging";
  if (current >= previous * 1.5) return "accelerating";
  if (current <= previous * 0.55) return "declining";
  return "mature";
}

export function assessSignalPulseKnowledgeContext(args: {
  analysisPlan?: unknown;
  requestParams?: unknown;
  knowledgeSources?: unknown;
  minimumBriefSignals?: unknown;
  minimumBriefCategories?: unknown;
}): SignalPulseKnowledgeContextAssessment {
  const knowledgeSources = wholeNumberValue(args.knowledgeSources);
  const minimumBriefSignals = Math.max(1, wholeNumberValue(args.minimumBriefSignals) || 4);
  const minimumBriefCategories = Math.max(1, wholeNumberValue(args.minimumBriefCategories) || 3);
  const marketingBriefSignals = countSignalPulseMarketingBriefSignals({
    analysisPlan: args.analysisPlan,
    requestParams: args.requestParams
  });
  const marketingBriefCategories = collectSignalPulseMarketingBriefCategories({
    analysisPlan: args.analysisPlan,
    requestParams: args.requestParams
  });
  const briefContextReady = marketingBriefSignals >= minimumBriefSignals
    && marketingBriefCategories.length >= minimumBriefCategories;
  const knowledgeContextReady = knowledgeSources > 0 || briefContextReady;
  const reasons = [];
  if (!knowledgeContextReady) {
    reasons.push("missing_knowledge_context");
    if (marketingBriefSignals < minimumBriefSignals) reasons.push("missing_marketing_brief_depth");
    if (marketingBriefCategories.length < minimumBriefCategories) reasons.push("missing_marketing_brief_categories");
  }
  return {
    knowledgeSources,
    marketingBriefSignals,
    marketingBriefCategories,
    minimumBriefSignals,
    minimumBriefCategories,
    knowledgeContextReady,
    reasons
  };
}

export function countSignalPulseMarketingBriefSignals(args: {
  analysisPlan?: unknown;
  requestParams?: unknown;
}): number {
  const seen = new Set<string>();
  let count = 0;
  for (const source of [args.analysisPlan, args.requestParams]) {
    count += countMarketingBriefSignalsFromRecord(asPlainRecord(source), seen, "root");
  }
  return count;
}

export function collectSignalPulseMarketingBriefCategories(args: {
  analysisPlan?: unknown;
  requestParams?: unknown;
}): string[] {
  const categories = new Set<string>();
  for (const source of [args.analysisPlan, args.requestParams]) {
    collectMarketingBriefCategoriesFromRecord(asPlainRecord(source), categories);
  }
  return Array.from(categories).sort();
}

function toUtcDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid Signal Pulse period date");
  return date;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function startOfIsoWeek(date: Date) {
  const normalized = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = normalized.getUTCDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  return addDays(normalized, -daysFromMonday);
}

function isoWeekLabel(date: Date) {
  const weekDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = weekDate.getUTCDay() || 7;
  weekDate.setUTCDate(weekDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(weekDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((weekDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${weekDate.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function countMarketingBriefSignalsFromRecord(record: Record<string, unknown>, seen: Set<string>, path: string) {
  let count = 0;

  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = normalizeBriefKey(key);
    if (!normalizedKey || SIGNAL_PULSE_BRIEF_IGNORED_KEYS.has(normalizedKey)) continue;

    if (normalizedKey === "marketing_brief") {
      count += countMarketingBriefObjectSignals(asPlainRecord(value), seen, `${path}.marketing_brief`);
      continue;
    }

    if (SIGNAL_PULSE_BRIEF_SIGNAL_KEYS.has(normalizedKey) && hasSubstantiveBriefValue(value)) {
      count += addBriefSignal(seen, `${path}.${normalizedKey}`, briefFieldWeight(normalizedKey, value));
    }
  }

  return count;
}

function countMarketingBriefObjectSignals(record: Record<string, unknown>, seen: Set<string>, path: string) {
  let count = 0;

  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = normalizeBriefKey(key);
    if (!normalizedKey || SIGNAL_PULSE_BRIEF_IGNORED_KEYS.has(normalizedKey)) continue;
    if (!hasSubstantiveBriefValue(value)) continue;

    const signalKey = SIGNAL_PULSE_BRIEF_SIGNAL_KEYS.has(normalizedKey) ? normalizedKey : `field_${normalizedKey}`;
    count += addBriefSignal(seen, `${path}.${signalKey}`, briefFieldWeight(signalKey, value));
  }

  return count;
}

function collectMarketingBriefCategoriesFromRecord(record: Record<string, unknown>, categories: Set<string>) {
  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = normalizeBriefKey(key);
    if (!normalizedKey || SIGNAL_PULSE_BRIEF_IGNORED_KEYS.has(normalizedKey)) continue;

    if (normalizedKey === "marketing_brief") {
      collectMarketingBriefCategoriesFromRecord(asPlainRecord(value), categories);
      continue;
    }

    if (!hasSubstantiveBriefValue(value)) continue;
    const category = SIGNAL_PULSE_BRIEF_CATEGORY_KEYS[normalizedKey];
    if (category) categories.add(category);
  }
}

function addBriefSignal(seen: Set<string>, key: string, weight: number) {
  if (seen.has(key)) return 0;
  seen.add(key);
  return Math.max(0, Math.trunc(weight));
}

function briefFieldWeight(key: string, value: unknown) {
  const textLength = collectSubstantiveBriefText(value).join(" ").length;
  if (["background", "brand_context", "category_context", "competitive_context", "context", "performance_notes"].includes(key)) {
    return textLength >= 160 ? 2 : 1;
  }
  return 1;
}

function hasSubstantiveBriefValue(value: unknown): boolean {
  return collectSubstantiveBriefText(value).length > 0;
}

function collectSubstantiveBriefText(value: unknown): string[] {
  if (typeof value === "string") {
    const normalized = value.trim().replace(/\s+/g, " ");
    if (!isSubstantiveBriefString(normalized)) return [];
    return [normalized];
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectSubstantiveBriefText(item));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SIGNAL_PULSE_BRIEF_IGNORED_KEYS.has(normalizeBriefKey(key)))
      .flatMap(([, nested]) => collectSubstantiveBriefText(nested));
  }
  return [];
}

function isSubstantiveBriefString(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 12) return false;
  if (["n/a", "na", "none", "sin info", "sin informacion", "sin información", "test", "prueba", "pendiente"].includes(normalized)) return false;
  return true;
}

function asPlainRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeBriefKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function wholeNumberValue(value: unknown) {
  const number = Math.trunc(Number(value ?? 0));
  return Number.isFinite(number) && number > 0 ? number : 0;
}
