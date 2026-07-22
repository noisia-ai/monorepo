import { createHash } from "node:crypto";

import { SIGNAL_DIMENSIONS, type SignalDimensionV1, type SignalGranularityV1 } from "./signal-backend-v1";

export const SIGNAL_METRIC_CATALOG_VERSION = "signal-metric-catalog-v1" as const;

export const SIGNAL_METRIC_GROUPS_V1 = [
  "conversation_volume_velocity",
  "sentiment_emotion",
  "platform_source_mix",
  "engagement",
  "topics_narratives_entities"
] as const;

export type SignalMetricGroupKeyV1 = (typeof SIGNAL_METRIC_GROUPS_V1)[number];
export type SignalMetricUnitV1 = "count" | "ratio" | "score";
export type SignalMetricVisibilityV1 = "internal" | "client" | "both";

export type SignalMetricFormulaV1 = {
  operator: "count" | "sum" | "divide" | "period_change";
  source: "mentions";
  expression: string;
  predicate: string;
};

export type SignalMetricDenominatorV1 =
  | { kind: "none"; description: string }
  | { kind: "count"; key: string; description: string };

export type SignalMetricDimensionCapabilityV1 = {
  key: SignalDimensionV1;
  visibility: SignalMetricVisibilityV1;
};

export type SignalMetricDefinitionV1 = {
  contract_version: typeof SIGNAL_METRIC_CATALOG_VERSION;
  key: string;
  version: 1;
  group: SignalMetricGroupKeyV1;
  name: string;
  description: string;
  formula: SignalMetricFormulaV1;
  formula_hash: string;
  unit: SignalMetricUnitV1;
  denominator: SignalMetricDenominatorV1;
  grains: SignalGranularityV1[];
  dimensions: SignalMetricDimensionCapabilityV1[];
  null_semantics: {
    state: "not_available" | "partial";
    rule: string;
    zero_is_observed_value: boolean;
  };
  comparability: {
    mode: "same_definition_watermark_and_scope";
    requires_equal_period_days: boolean;
    notes: string;
  };
  quality_rules: Array<{
    key: string;
    severity: "block" | "partial";
    rule: string;
  }>;
  drill_down_subject: "mention";
  visibility: SignalMetricVisibilityV1;
};

export type SignalMetricGroupV1 = {
  key: SignalMetricGroupKeyV1;
  name: string;
  description: string;
  metrics: SignalMetricDefinitionV1[];
};

const ALL_GRAINS: SignalGranularityV1[] = ["day", "week", "month"];
const COMMON_DIMENSIONS: SignalDimensionV1[] = [
  "platform",
  "source_type",
  "entity",
  "product",
  "campaign",
  "topic",
  "taxonomy",
  "signal",
  "signal_lifecycle",
  "audience",
  "demographic",
  "journey_stage",
  "trigger",
  "barrier",
  "sentiment_polarity",
  "emotion",
  "country",
  "language",
  "content_format"
];
const MIX_DIMENSIONS: SignalDimensionV1[] = ["platform", "source_type", "country", "language", "content_format"];
const TOPIC_DIMENSIONS: SignalDimensionV1[] = [
  "platform",
  "entity",
  "topic",
  "taxonomy",
  "signal",
  "trigger",
  "barrier",
  "country",
  "language"
];

export const SIGNAL_METRIC_CATALOG_V1: SignalMetricGroupV1[] = [
  {
    key: "conversation_volume_velocity",
    name: "Conversation volume and velocity",
    description: "Observed conversation size and change over comparable periods.",
    metrics: [
      metric({
        key: "conversation.volume",
        group: "conversation_volume_velocity",
        name: "Conversation volume",
        description: "Count of included canonical listening mentions in the period.",
        formula: countFormula("COUNT(mentions.id)", "mentions.inclusion_status = 'included'"),
        unit: "count",
        denominator: none("A count has no denominator."),
        dimensions: COMMON_DIMENSIONS,
        nullRule: "not_available when the governed corpus has no accepted coverage for the period",
        quality: [
          block("accepted_coverage", "At least one accepted source event must cover the requested period."),
          partial("known_source_gap", "Known source gaps mark the value partial, never zero.")
        ]
      }),
      metric({
        key: "conversation.velocity",
        group: "conversation_volume_velocity",
        name: "Conversation velocity",
        description: "Relative change in included mention volume versus the immediately previous equal-length period.",
        formula: {
          operator: "period_change",
          source: "mentions",
          expression: "(current_volume - previous_volume) / previous_volume",
          predicate: "mentions.inclusion_status = 'included'"
        },
        unit: "ratio",
        denominator: countDenominator("previous_period_volume", "Included mention count in the previous equal-length period."),
        dimensions: COMMON_DIMENSIONS,
        nullRule: "not_available when the previous comparable volume is missing or zero",
        quality: [
          block("equal_period_days", "Current and previous windows must contain the same number of calendar days."),
          block("positive_previous_denominator", "Previous-period volume must be greater than zero."),
          partial("watermark_comparability", "Coverage changes between periods mark the result partial.")
        ]
      })
    ]
  },
  {
    key: "sentiment_emotion",
    name: "Sentiment and emotion",
    description: "Governed polarity and emotion distributions over classified mentions.",
    metrics: [
      shareMetric({
        key: "sentiment.share",
        group: "sentiment_emotion",
        name: "Sentiment share",
        dimension: "sentiment_polarity",
        classifiedPredicate: "canonical sentiment_polarity IS NOT NULL"
      }),
      shareMetric({
        key: "emotion.share",
        group: "sentiment_emotion",
        name: "Emotion share",
        dimension: "emotion",
        classifiedPredicate: "governed emotion assertion is accepted"
      })
    ]
  },
  {
    key: "platform_source_mix",
    name: "Platform and source mix",
    description: "Conversation distribution across governed platform and source-type dimensions.",
    metrics: [
      shareMetric({
        key: "platform.share",
        group: "platform_source_mix",
        name: "Platform share",
        dimension: "platform",
        classifiedPredicate: "canonical platform IS NOT NULL"
      }),
      shareMetric({
        key: "source_type.share",
        group: "platform_source_mix",
        name: "Source type share",
        dimension: "source_type",
        classifiedPredicate: "governed source_type IS NOT NULL",
        visibility: "internal"
      })
    ]
  },
  {
    key: "engagement",
    name: "Engagement",
    description: "Observed provider interaction counters without imputing missing fields.",
    metrics: [
      metric({
        key: "engagement.total",
        group: "engagement",
        name: "Total engagement",
        description: "Sum of governed likes, comments, shares, reposts and saves when at least one component is observed.",
        formula: {
          operator: "sum",
          source: "mentions",
          expression: "SUM(likes + comments + shares + reposts + saves over observed components)",
          predicate: "mentions.inclusion_status = 'included' AND engagement has an observed governed component"
        },
        unit: "count",
        denominator: none("An interaction sum has no denominator."),
        dimensions: ["platform", "source_type", "entity", "campaign", "content_format", "country", "language"],
        nullRule: "not_available when no included mention has a governed engagement component",
        quality: [
          block("observed_component", "At least one governed engagement component must be observed."),
          partial("provider_component_coverage", "Inconsistent component coverage across sources marks the value partial.")
        ]
      }),
      metric({
        key: "engagement.average_per_mention",
        group: "engagement",
        name: "Average engagement per measured mention",
        description: "Total observed engagement divided by included mentions with at least one governed engagement component.",
        formula: {
          operator: "divide",
          source: "mentions",
          expression: "engagement_total / mentions_with_engagement_measurement",
          predicate: "mentions.inclusion_status = 'included' AND engagement has an observed governed component"
        },
        unit: "ratio",
        denominator: countDenominator(
          "mentions_with_engagement_measurement",
          "Included mentions with at least one governed engagement component."
        ),
        dimensions: ["platform", "source_type", "entity", "campaign", "content_format", "country", "language"],
        nullRule: "not_available when the measured-mention denominator is missing or zero",
        quality: [
          block("positive_measured_mentions", "Measured-mention denominator must be greater than zero."),
          partial("provider_component_coverage", "Inconsistent component coverage across sources marks the value partial.")
        ]
      })
    ]
  },
  {
    key: "topics_narratives_entities",
    name: "Topics, narratives and governed entities",
    description: "Counts of accepted governed classifications linked to canonical mentions.",
    metrics: [
      governedVolumeMetric("topic.volume", "Topic volume", "topic", "accepted topic tag"),
      governedVolumeMetric("narrative.volume", "Narrative volume", "taxonomy", "accepted narrative taxonomy tag"),
      governedVolumeMetric("governed_entity.volume", "Governed entity volume", "entity", "accepted governed entity link")
    ]
  }
];

export const SIGNAL_METRIC_DEFINITIONS_V1 = SIGNAL_METRIC_CATALOG_V1.flatMap((group) => group.metrics);

export function signalMetricDefinitionV1(key: string, version = 1) {
  return SIGNAL_METRIC_DEFINITIONS_V1.find((definition) => definition.key === key && definition.version === version) ?? null;
}

export function validateSignalMetricCatalogV1(catalog: SignalMetricGroupV1[] = SIGNAL_METRIC_CATALOG_V1) {
  const supportedDimensions = new Set<string>(SIGNAL_DIMENSIONS);
  const expectedGroups = new Set<string>(SIGNAL_METRIC_GROUPS_V1);
  const seenGroups = new Set<string>();
  const seenMetrics = new Set<string>();
  for (const group of catalog) {
    if (!expectedGroups.has(group.key)) throw new Error(`Unknown Signal metric group: ${group.key}`);
    if (seenGroups.has(group.key)) throw new Error(`Duplicate Signal metric group: ${group.key}`);
    if (group.metrics.length === 0) throw new Error(`Signal metric group has no metrics: ${group.key}`);
    seenGroups.add(group.key);
    for (const definition of group.metrics) {
      const identity = `${definition.key}@${definition.version}`;
      if (seenMetrics.has(identity)) throw new Error(`Duplicate Signal metric definition: ${identity}`);
      seenMetrics.add(identity);
      if (definition.group !== group.key) throw new Error(`Metric ${identity} is assigned to the wrong group.`);
      if (!(["count", "ratio", "score"] as string[]).includes(definition.unit)) {
        throw new Error(`Metric ${identity} has an unsupported unit.`);
      }
      if (definition.denominator.kind === "count" && !definition.denominator.key.trim()) {
        throw new Error(`Metric ${identity} has an empty denominator key.`);
      }
      if (definition.unit === "ratio" && definition.denominator.kind === "none") {
        throw new Error(`Ratio metric ${identity} requires a denominator.`);
      }
      for (const dimension of definition.dimensions) {
        if (!supportedDimensions.has(dimension.key)) {
          throw new Error(`Metric ${identity} uses unsupported dimension ${dimension.key}.`);
        }
      }
      if (definition.formula_hash !== formulaHash(definition.formula)) {
        throw new Error(`Metric ${identity} formula hash does not match its formula.`);
      }
      if (!definition.quality_rules.some((rule) => rule.severity === "block")) {
        throw new Error(`Metric ${identity} requires at least one blocking quality rule.`);
      }
    }
  }
  for (const required of SIGNAL_METRIC_GROUPS_V1) {
    if (!seenGroups.has(required)) throw new Error(`Missing Signal metric group: ${required}`);
  }
  return catalog;
}

export function signalMetricFormulaHashV1(formula: SignalMetricFormulaV1) {
  return formulaHash(formula);
}

function metric(input: {
  key: string;
  group: SignalMetricGroupKeyV1;
  name: string;
  description: string;
  formula: SignalMetricFormulaV1;
  unit: SignalMetricUnitV1;
  denominator: SignalMetricDenominatorV1;
  dimensions: SignalDimensionV1[];
  nullRule: string;
  quality: SignalMetricDefinitionV1["quality_rules"];
  visibility?: SignalMetricVisibilityV1;
}): SignalMetricDefinitionV1 {
  return {
    contract_version: SIGNAL_METRIC_CATALOG_VERSION,
    key: input.key,
    version: 1,
    group: input.group,
    name: input.name,
    description: input.description,
    formula: input.formula,
    formula_hash: formulaHash(input.formula),
    unit: input.unit,
    denominator: input.denominator,
    grains: [...ALL_GRAINS],
    dimensions: input.dimensions.map((key) => ({
      key,
      visibility: key === "source_type" ? "internal" : "both"
    })),
    null_semantics: {
      state: "not_available",
      rule: input.nullRule,
      zero_is_observed_value: true
    },
    comparability: {
      mode: "same_definition_watermark_and_scope",
      requires_equal_period_days: true,
      notes: "Compare only identical metric versions, normalized filters, dimensions and compatible data coverage."
    },
    quality_rules: input.quality,
    drill_down_subject: "mention",
    visibility: input.visibility ?? "both"
  };
}

function shareMetric(input: {
  key: string;
  group: SignalMetricGroupKeyV1;
  name: string;
  dimension: SignalDimensionV1;
  classifiedPredicate: string;
  visibility?: SignalMetricVisibilityV1;
}) {
  return metric({
    key: input.key,
    group: input.group,
    name: input.name,
    description: `${input.name} among included mentions with an accepted ${input.dimension} value.`,
    formula: {
      operator: "divide",
      source: "mentions",
      expression: `COUNT(mentions in ${input.dimension} bucket) / COUNT(classified mentions)`,
      predicate: `mentions.inclusion_status = 'included' AND ${input.classifiedPredicate}`
    },
    unit: "ratio",
    denominator: countDenominator(
      `mentions_classified_by_${input.dimension}`,
      `Included mentions with an accepted ${input.dimension} value.`
    ),
    dimensions: Array.from(new Set([...MIX_DIMENSIONS, input.dimension])),
    nullRule: `not_available when no included mention has an accepted ${input.dimension} value`,
    quality: [
      block(`classified_${input.dimension}`, `At least one accepted ${input.dimension} value is required.`),
      partial("classification_coverage", "Incomplete classification coverage marks the result partial.")
    ],
    visibility: input.visibility
  });
}

function governedVolumeMetric(
  key: string,
  name: string,
  dimension: SignalDimensionV1,
  acceptedPredicate: string
) {
  return metric({
    key,
    group: "topics_narratives_entities",
    name,
    description: `Count of distinct included mentions linked to an ${acceptedPredicate}.`,
    formula: countFormula(
      "COUNT(DISTINCT mentions.id)",
      `mentions.inclusion_status = 'included' AND ${acceptedPredicate}`
    ),
    unit: "count",
    denominator: none("A governed mention count has no denominator."),
    dimensions: Array.from(new Set([...TOPIC_DIMENSIONS, dimension])),
    nullRule: `not_available when no governed ${dimension} classification coverage exists`,
    quality: [
      block(`governed_${dimension}_coverage`, `Accepted ${dimension} linkage is required.`),
      partial("review_pending", "Pending or partially reviewed classifications mark the result partial.")
    ]
  });
}

function countFormula(expression: string, predicate: string): SignalMetricFormulaV1 {
  return { operator: "count", source: "mentions", expression, predicate };
}

function none(description: string): SignalMetricDenominatorV1 {
  return { kind: "none", description };
}

function countDenominator(key: string, description: string): SignalMetricDenominatorV1 {
  return { kind: "count", key, description };
}

function block(key: string, rule: string) {
  return { key, severity: "block", rule } as const;
}

function partial(key: string, rule: string) {
  return { key, severity: "partial", rule } as const;
}

function formulaHash(formula: SignalMetricFormulaV1) {
  return `sha256:${createHash("sha256").update(stableJson(formula), "utf8").digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
